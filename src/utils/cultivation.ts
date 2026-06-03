import type {
  CultivationRealm,
  CultivationSubRealm,
  CharacterRealmEvent,
  Character,
} from '@store/index';
import type { Chapter } from '@typings/index';

export interface ResolvedRealm {
  major: CultivationRealm;
  /** Present iff the referenced id is a sub-realm; absent if it points at the major itself. */
  sub?: CultivationSubRealm;
}

/**
 * Resolve a realm ID against the project's realm tree. Returns either:
 * - `{ major }` if the id points at a top-level realm
 * - `{ major, sub }` if the id points at a sub-realm (we always include the
 *   parent major so callers can render the full label)
 * - `null` if the id is no longer valid (realm was deleted)
 */
export function findRealmById(
  realms: CultivationRealm[],
  id: string
): ResolvedRealm | null {
  for (const r of realms) {
    if (r.id === id) return { major: r };
    if (r.subRealms) {
      const sub = r.subRealms.find((s) => s.id === id);
      if (sub) return { major: r, sub };
    }
  }
  return null;
}

/** Display label for a resolved realm. "炼气期 · 一层" or "筑基期" (when no sub). */
export function realmLabel(resolved: ResolvedRealm): string {
  return resolved.sub ? `${resolved.major.name} · ${resolved.sub.name}` : resolved.major.name;
}

/**
 * Resolve a character's current realm based on the latest realm event whose
 * chapter still exists. Cached `chapterOrderIndex` is the fallback if a chapter
 * has somehow been deleted without cleanup.
 */
export function computeCurrentRealm(
  characterId: string,
  events: CharacterRealmEvent[],
  chapterMap: Map<string, Chapter>,
  realms: CultivationRealm[]
): {
  major: CultivationRealm | null;
  sub: CultivationSubRealm | null;
  chapter: Chapter | null;
} {
  const usable = events
    .filter((e) => e.characterId === characterId)
    .filter((e) => chapterMap.has(e.chapterId));
  if (!usable.length) return { major: null, sub: null, chapter: null };

  usable.sort((a, b) => {
    const ca = chapterMap.get(a.chapterId);
    const cb = chapterMap.get(b.chapterId);
    const oa = ca ? ca.order_index : a.chapterOrderIndex;
    const ob = cb ? cb.order_index : b.chapterOrderIndex;
    return ob - oa;
  });

  const latest = usable[0];
  const resolved = findRealmById(realms, latest.realmId);
  return {
    major: resolved?.major ?? null,
    sub: resolved?.sub ?? null,
    chapter: chapterMap.get(latest.chapterId) ?? null,
  };
}

/**
 * Builds a TOP-PRIORITY hard constraint block from a volume's user-written 修为/境界规划 (`realmPlan`).
 * This is the fix for cultivation-realm drift in long xuanhuan novels: the user states a per-volume
 * ceiling (e.g. "only up to the peak of the first major realm"), and this block forbids the model from
 * over-leveling, skipping, dropping, repeating, or jumping erratically. It is injected (at high priority)
 * into both planning (arc / chapter outlines) and chapter-body generation.
 *
 * Returns '' when the volume has no realmPlan, so callers can append unconditionally.
 *
 * @param phase 'generate' = writing chapter bodies; 'plan' = planning arc/chapter outlines.
 */
export function buildVolumeRealmConstraint(
  realmPlan: string | undefined | null,
  volumeName: string,
  uiLanguage: 'zh' | 'en' = 'zh',
  phase: 'generate' | 'plan' = 'generate'
): string {
  const plan = (realmPlan || '').trim();
  if (!plan) return '';

  if (uiLanguage === 'en') {
    const rules = [
      `[HARD CULTIVATION LIMIT for volume "${volumeName}" — TOP PRIORITY, overrides everything else]`,
      plan,
      'Iron rules (must obey):',
      '- The protagonist\'s cultivation may ONLY rise within the range set above; never exceed this volume\'s ceiling.',
      '- Advance monotonically and gradually — climb sub-realms one step at a time. No level-skipping.',
      '- Never repeat a breakthrough into a realm already reached; never drop a realm without an explicit plot cause; no erratic up-and-down.',
      '- Most chapters keep cultivation UNCHANGED; only break through at a few key plot beats, by a small step.',
      phase === 'plan'
        ? '- When planning chapters/arcs, do NOT schedule breakthroughs that would exceed the ceiling by the end of this volume.'
        : '- Take the protagonist\'s "current realm (based on written chapters)" above as the floor — do not contradict or reset it.',
    ];
    return rules.join('\n');
  }

  const rules = [
    `【本副本「${volumeName}」修为/境界硬约束 —— 最高优先级，高于其它一切设定】`,
    plan,
    '铁律（必须遵守）：',
    '- 主角修为只能在上述范围内提升，绝不允许超过本副本设定的上限。',
    '- 修为只能单调、循序渐进地提升，小境界逐层突破，严禁跳级。',
    '- 严禁重复突破已经达到过的境界；无明确剧情理由不得跌落；不得忽高忽低。',
    '- 绝大多数章节修为保持不变，仅在少数关键剧情节点小幅突破。',
    phase === 'plan'
      ? '- 规划弧线/章节时，不得安排会令本副本结束时超过上限的突破节奏。'
      : '- 以上文「主要角色当前境界（基于已写章节）」为基准下限，不得与之矛盾或将其重置。',
  ];
  return rules.join('\n');
}

export interface BuildRealmContextOptions {
  /** If set, only "current realms as of this chapter" are computed (events from later chapters are ignored). */
  asOfChapterOrderIndex?: number;
  /** Skip the character grid (useful for prompts that don't have specific characters yet, e.g. outline gen). */
  ladderOnly?: boolean;
  /** Skip characters with no realm event (default false — include them as "未设定"). */
  hideUnsetCharacters?: boolean;
  uiLanguage?: 'zh' | 'en';
}

/**
 * Builds the "境界系统" / "Cultivation System" prompt block.
 *
 * Output shape (zh):
 *
 *   【修炼境界系统】（由低到高）
 *   1. 炼气期 — 体内有灵气流转
 *      1) 一层
 *      2) 二层 — 灵气可外放
 *   2. 筑基期
 *      1) 初期
 *
 *   【主要角色当前境界】（基于已写章节）
 *   - 林晓【主角】：炼气期 · 二层（于第 5 章突破）
 *   - 陈墨：筑基期（于第 12 章突破）
 *   - 苏婉：未设定境界
 *
 * Returns an empty string when no realms exist yet.
 */
export function buildRealmSystemContext(
  realms: CultivationRealm[],
  characters: Character[],
  events: CharacterRealmEvent[],
  chapters: Chapter[],
  options: BuildRealmContextOptions = {}
): string {
  if (realms.length === 0) return '';

  const { asOfChapterOrderIndex, ladderOnly, hideUnsetCharacters, uiLanguage = 'zh' } = options;
  const sortedRealms = [...realms].sort((a, b) => a.order - b.order);

  const lines: string[] = [];
  if (uiLanguage === 'en') {
    lines.push('[Cultivation Realm Ladder] (weakest → strongest)');
  } else {
    lines.push('【修炼境界系统】（由低到高）');
  }

  sortedRealms.forEach((r, i) => {
    const desc = r.description?.trim();
    lines.push(desc ? `${i + 1}. ${r.name} — ${desc}` : `${i + 1}. ${r.name}`);
    const subs = [...(r.subRealms || [])].sort((a, b) => a.order - b.order);
    subs.forEach((s, j) => {
      const subDesc = s.description?.trim();
      lines.push(subDesc ? `   ${j + 1}) ${s.name} — ${subDesc}` : `   ${j + 1}) ${s.name}`);
    });
  });

  if (ladderOnly || characters.length === 0) {
    return lines.join('\n');
  }

  const chapterMap = new Map<string, Chapter>();
  for (const c of chapters) {
    if (asOfChapterOrderIndex == null || c.order_index <= asOfChapterOrderIndex) {
      chapterMap.set(c.id, c);
    }
  }

  const charLines: string[] = [];
  const sortedChars = [...characters].sort((a, b) => {
    if (a.isProtagonist !== b.isProtagonist) return a.isProtagonist ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const char of sortedChars) {
    const { major, sub, chapter } = computeCurrentRealm(char.id, events, chapterMap, realms);
    if (!major) {
      if (hideUnsetCharacters) continue;
      if (uiLanguage === 'en') {
        charLines.push(`- ${char.name}${char.isProtagonist ? ' [protagonist]' : ''}: no realm set`);
      } else {
        charLines.push(`- ${char.name}${char.isProtagonist ? '【主角】' : ''}：未设定境界`);
      }
      continue;
    }
    const label = sub ? `${major.name} · ${sub.name}` : major.name;
    if (uiLanguage === 'en') {
      const where = chapter ? ` (advanced in Ch.${chapter.order_index})` : '';
      charLines.push(`- ${char.name}${char.isProtagonist ? ' [protagonist]' : ''}: ${label}${where}`);
    } else {
      const where = chapter ? `（于第 ${chapter.order_index} 章突破）` : '';
      charLines.push(`- ${char.name}${char.isProtagonist ? '【主角】' : ''}：${label}${where}`);
    }
  }

  if (charLines.length > 0) {
    lines.push('');
    if (uiLanguage === 'en') {
      lines.push('[Character Current Realms] (based on written chapters)');
    } else {
      lines.push('【主要角色当前境界】（基于已写章节）');
    }
    lines.push(...charLines);
  }

  return lines.join('\n');
}

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

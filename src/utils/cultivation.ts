import type { CultivationRealm, CharacterRealmEvent, Character } from '@store/index';
import type { Chapter } from '@typings/index';

/**
 * Resolve a character's current realm based on the latest realm event whose
 * chapter still exists. Cached `chapterOrderIndex` is the fallback if a chapter
 * has somehow been deleted without cleanup.
 */
export function computeCurrentRealm(
  characterId: string,
  events: CharacterRealmEvent[],
  chapterMap: Map<string, Chapter>,
  realmMap: Map<string, CultivationRealm>
): { realm: CultivationRealm | null; chapter: Chapter | null } {
  const usable = events
    .filter((e) => e.characterId === characterId)
    .filter((e) => chapterMap.has(e.chapterId));
  if (!usable.length) return { realm: null, chapter: null };

  usable.sort((a, b) => {
    const ca = chapterMap.get(a.chapterId);
    const cb = chapterMap.get(b.chapterId);
    const oa = ca ? ca.order_index : a.chapterOrderIndex;
    const ob = cb ? cb.order_index : b.chapterOrderIndex;
    return ob - oa;
  });

  const latest = usable[0];
  const realm = realmMap.get(latest.realmId) || null;
  const chapter = chapterMap.get(latest.chapterId) || null;
  return { realm, chapter };
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
 *   1. 炼气期一层 — 体内有灵气流转
 *   2. 炼气期二层
 *   ...
 *
 *   【主要角色当前境界】（基于已写章节）
 *   - 林晓【主角】：炼气三层（于第 5 章突破）
 *   - 陈墨：筑基初期（于第 12 章突破）
 *   - 苏婉：未设定境界
 *
 * Returns an empty string when the user hasn't defined any realms yet — so
 * adding this to a prompt is always safe and zero-cost when unused.
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

  // Section 1: ladder
  const lines: string[] = [];
  if (uiLanguage === 'en') {
    lines.push('[Cultivation Realm Ladder] (weakest → strongest)');
  } else {
    lines.push('【修炼境界系统】（由低到高）');
  }
  sortedRealms.forEach((r, i) => {
    const desc = r.description?.trim();
    lines.push(desc ? `${i + 1}. ${r.name} — ${desc}` : `${i + 1}. ${r.name}`);
  });

  if (ladderOnly || characters.length === 0) {
    return lines.join('\n');
  }

  // Section 2: character → current realm
  const chapterMap = new Map<string, Chapter>();
  for (const c of chapters) {
    if (asOfChapterOrderIndex == null || c.order_index <= asOfChapterOrderIndex) {
      chapterMap.set(c.id, c);
    }
  }
  const realmMap = new Map<string, CultivationRealm>();
  for (const r of realms) realmMap.set(r.id, r);

  const charLines: string[] = [];
  // Protagonists first, then by name.
  const sortedChars = [...characters].sort((a, b) => {
    if (a.isProtagonist !== b.isProtagonist) return a.isProtagonist ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const char of sortedChars) {
    const { realm, chapter } = computeCurrentRealm(char.id, events, chapterMap, realmMap);
    if (!realm) {
      if (hideUnsetCharacters) continue;
      if (uiLanguage === 'en') {
        charLines.push(`- ${char.name}${char.isProtagonist ? ' [protagonist]' : ''}: no realm set`);
      } else {
        charLines.push(`- ${char.name}${char.isProtagonist ? '【主角】' : ''}：未设定境界`);
      }
      continue;
    }
    if (uiLanguage === 'en') {
      const where = chapter ? ` (advanced in Ch.${chapter.order_index})` : '';
      charLines.push(`- ${char.name}${char.isProtagonist ? ' [protagonist]' : ''}: ${realm.name}${where}`);
    } else {
      const where = chapter ? `（于第 ${chapter.order_index} 章突破）` : '';
      charLines.push(`- ${char.name}${char.isProtagonist ? '【主角】' : ''}：${realm.name}${where}`);
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

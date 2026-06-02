// Container (容器) + Character Growth (成长路线) AI logic, ported from the Android app
// (data/ai/Prompts.kt + KbService container/growth updates).
//
// Two responsibilities:
//   1. buildGenerationGuidance — assemble the "soft guidance" text injected into generation
//      (chapter / arc / volume) from containers flagged affectsGeneration/Arc/Volume + the latest
//      character-growth entries.
//   2. runChapterAutoUpdates — after a chapter is saved, ask the AI to evolve every container with
//      autoUpdatePerChapter on (and any character with a growth route started), appending new
//      entries. Fire-and-forget; failures are logged, never surfaced.

import { useAppStore } from '@store/index';
import type { Character } from '@store/index';
import { CONTAINER_SINGLE_BLOCK_KEY } from '@store/index';
import { aiApi } from '@services/api';
import type { TextModelConfig } from '@typings/index';

type Lang = 'zh' | 'en';

const CHAPTER_TEXT_CAP = 4000;

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function isNoChange(s: string): boolean {
  return /^\s*NO_CHANGE\s*$/i.test(s.trim());
}

/** Strip ```json fences and parse a {name: value} object; returns {} on any failure. */
function parseNameValueJson(raw: string): Record<string, string> {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    if (obj && typeof obj === 'object') {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string' && v.trim()) out[k] = v.trim();
      }
      return out;
    }
  } catch {
    /* ignore */
  }
  return {};
}

// ── Prompts (mirrors Prompts.kt) ───────────────────────────────

function containerSingleSystem(name: string, lang: Lang): string {
  return lang === 'en'
    ? `You maintain a single-block knowledge container named "${name}" for a novel. Given its CURRENT value and the LATEST chapter, update the value based on this chapter. If the chapter adds nothing worth recording, output exactly NO_CHANGE. Otherwise output ONLY the full updated value text, no explanation.`
    : `你在维护一个名为「${name}」的资料容器（单块）。给你【当前值】和【最新章节】，请基于本章在当前值基础上更新。若本章没有带来需要记录的新信息，只输出 NO_CHANGE。否则只输出更新后的完整文本，不要任何解释。`;
}

function containerSingleUser(name: string, current: string, order: number, title: string, text: string, lang: Lang): string {
  const body = text.slice(0, CHAPTER_TEXT_CAP);
  return lang === 'en'
    ? `Container purpose: ${name}\n\n[Current value]\n${current || '(none)'}\n\n[Latest chapter] Ch.${order} ${title}\n${body}\n\nOutput the updated value or NO_CHANGE.`
    : `容器用途：${name}\n\n【当前值】\n${current || '（暂无）'}\n\n【最新章节】第${order}章 ${title}\n${body}\n\n请输出更新后的值或 NO_CHANGE。`;
}

function containerByCharacterSystem(name: string, lang: Lang): string {
  return lang === 'en'
    ? `You maintain a knowledge container named "${name}" for a novel; it is partitioned by character. You are given each character's CURRENT value and the LATEST chapter. Decide, per character, whether the chapter introduces new information that should update their value. Only include characters whose value should change; evolve from the current value and output the FULL updated value. Output ONLY a JSON object {"characterName":"updated value"}; output {} if nothing changed.`
    : `你在维护一个名为「${name}」的资料容器（按角色分块）。给你每个角色的【当前值】和【最新章节】。逐角色判断本章是否引入了应更新其值的新信息。只包含确需更新的角色；在当前值基础上演进并输出完整的新值。只输出 JSON 对象 {"角色名":"更新后的值"}；没有任何需要更新就输出 {}。`;
}

function containerByCharacterUser(name: string, perCharacter: string, order: number, title: string, text: string, lang: Lang): string {
  const body = text.slice(0, CHAPTER_TEXT_CAP);
  return lang === 'en'
    ? `Container purpose: ${name}\n\n[Each character's current value]\n${perCharacter}\n\n[Latest chapter] Ch.${order} ${title}\n${body}\n\nOutput the JSON of characters that need updating.`
    : `容器用途：${name}\n\n【各角色当前值】\n${perCharacter}\n\n【最新章节】第${order}章 ${title}\n${body}\n\n请输出需要更新的角色 JSON。`;
}

function containerByChapterSystem(name: string, lang: Lang): string {
  return lang === 'en'
    ? `You maintain a knowledge container named "${name}" for a novel, partitioned by chapter. Given a chapter, produce the value this container should hold for THIS chapter. Output ONLY that value text, no explanation. If the chapter has nothing relevant, output exactly NO_CHANGE.`
    : `你在维护一个名为「${name}」的资料容器（按章节分块）。请根据本章内容，产出该容器用途下、针对本章的值。只输出该值文本，不要解释。若本章无可记录内容，输出 NO_CHANGE。`;
}

function containerByChapterUser(name: string, order: number, title: string, text: string, lang: Lang): string {
  const body = text.slice(0, CHAPTER_TEXT_CAP);
  return lang === 'en'
    ? `Container purpose: ${name}\n\n[This chapter] Ch.${order} ${title}\n${body}\n\nOutput this chapter's value or NO_CHANGE.`
    : `容器用途：${name}\n\n【本章】第${order}章 ${title}\n${body}\n\n请输出本章对应的值或 NO_CHANGE。`;
}

function growthSystem(charName: string, lang: Lang): string {
  return lang === 'en'
    ? `You maintain the growth route of the character "${charName}" in a novel — how they develop chapter by chapter. Given their CURRENT growth state and the LATEST chapter, output the updated growth state (a concise paragraph reflecting any change this chapter). If nothing changed for this character, output exactly NO_CHANGE. Output ONLY the text, no explanation.`
    : `你在维护小说角色「${charName}」的成长路线（其逐章的发展变化）。给你该角色的【当前成长状态】和【最新章节】，请输出更新后的成长状态（简洁一段，反映本章的变化）。若本章该角色没有变化，只输出 NO_CHANGE。只输出文本，不要解释。`;
}

function growthUser(charName: string, current: string, order: number, title: string, text: string, lang: Lang): string {
  const body = text.slice(0, CHAPTER_TEXT_CAP);
  return lang === 'en'
    ? `Character: ${charName}\n\n[Current growth state]\n${current || '(none)'}\n\n[Latest chapter] Ch.${order} ${title}\n${body}\n\nOutput the updated growth state or NO_CHANGE.`
    : `角色：${charName}\n\n【当前成长状态】\n${current || '（暂无）'}\n\n【最新章节】第${order}章 ${title}\n${body}\n\n请输出更新后的成长状态或 NO_CHANGE。`;
}

// ── Generation-time soft guidance ──────────────────────────────

export type GuidanceScope = 'chapter' | 'arc' | 'volume';

/**
 * Build the soft-guidance block injected into generation: latest values of containers flagged for
 * this [scope], plus (chapter scope only) each character's latest growth entry.
 */
export function buildGenerationGuidance(
  projectId: string,
  scope: GuidanceScope,
  uiLanguage: Lang
): string {
  const state = useAppStore.getState();
  const characters = state.getCharacters(projectId);
  const charById = new Map(characters.map((c) => [c.id, c]));
  const containers = state.getContainers(projectId);

  const flag =
    scope === 'chapter' ? 'affectsGeneration'
    : scope === 'arc' ? 'affectsArcGeneration'
    : 'affectsVolumeGeneration';

  const sections: string[] = [];

  for (const c of containers) {
    if (!(c as unknown as Record<string, boolean>)[flag]) continue;
    const lines: string[] = [];
    if (c.type === 'single') {
      const entries = state.getContainerEntries(projectId, c.id, CONTAINER_SINGLE_BLOCK_KEY);
      const latest = entries[entries.length - 1]?.value?.trim();
      if (latest) lines.push(latest);
    } else if (c.type === 'by_character') {
      for (const ch of characters) {
        const entries = state.getContainerEntries(projectId, c.id, ch.id);
        const latest = entries[entries.length - 1]?.value?.trim();
        if (latest) lines.push(`- ${ch.name}：${latest}`);
      }
    } else {
      // by_chapter — inject only the most recent non-empty block to avoid flooding the prompt.
      const store = state.getContainerStore(projectId);
      const byBlock = store.entries[c.id] || {};
      let latestVal = '';
      for (const chain of Object.values(byBlock)) {
        const v = chain[chain.length - 1]?.value?.trim();
        if (v) latestVal = v; // last wins; chapters are appended in order
      }
      if (latestVal) lines.push(latestVal);
    }
    if (lines.length > 0) {
      sections.push(`【${c.name}】\n${lines.join('\n')}`);
    }
  }

  // Character growth (chapter scope only).
  if (scope === 'chapter') {
    const growthLines: string[] = [];
    for (const ch of characters) {
      const entries = state.getCharacterGrowth(projectId, ch.id);
      const latest = entries[entries.length - 1]?.value?.trim();
      if (latest) growthLines.push(`- ${ch.name}：${latest}`);
    }
    if (growthLines.length > 0) {
      const header = uiLanguage === 'en' ? '[Character Growth — latest state]' : '【角色成长 · 最新状态】';
      sections.push(`${header}\n${growthLines.join('\n')}`);
    }
  }
  void charById;

  if (sections.length === 0) return '';
  const header = uiLanguage === 'en' ? '[Knowledge Containers — soft guidance]' : '【资料容器 · 软性指引】';
  return `${header}\n${sections.join('\n\n')}`;
}

// ── Post-save AI auto-update ───────────────────────────────────

interface AutoUpdateOpts {
  projectId: string;
  chapterId: string;
  chapterOrder: number;
  chapterTitle: string;
  chapterText: string;
  textConfig: TextModelConfig;
  uiLanguage: Lang;
}

/**
 * After a chapter save, evolve every autoUpdatePerChapter container + every character that already
 * has a growth route. Runs sequentially (keeps API pressure modest); each call is independent and
 * its failure is swallowed. Mirrors the Android KbService per-chapter update.
 */
export async function runChapterAutoUpdates(opts: AutoUpdateOpts): Promise<void> {
  const { projectId, chapterId, chapterOrder, chapterTitle, chapterText, textConfig, uiLanguage } = opts;
  if (chapterText.trim().length < 200) return; // not enough content to learn from

  const state = useAppStore.getState();
  const characters: Character[] = state.getCharacters(projectId);
  const containers = state.getContainers(projectId);

  const source = {
    sourceChapterId: chapterId,
    sourceChapterOrder: chapterOrder,
    sourceChapterTitle: chapterTitle,
  };

  for (const c of containers) {
    if (!c.autoUpdatePerChapter) continue;
    try {
      if (c.type === 'single') {
        const entries = state.getContainerEntries(projectId, c.id, CONTAINER_SINGLE_BLOCK_KEY);
        const current = entries[entries.length - 1]?.value || '';
        const out = await aiApi.chat(
          containerSingleUser(c.name, current, chapterOrder, chapterTitle, chapterText, uiLanguage),
          textConfig,
          containerSingleSystem(c.name, uiLanguage)
        );
        if (out.trim() && !isNoChange(out)) {
          state.appendContainerEntry(projectId, c.id, CONTAINER_SINGLE_BLOCK_KEY, {
            id: uid('entry'), value: out.trim(), createdAt: new Date().toISOString(), manual: false, ...source,
          });
        }
      } else if (c.type === 'by_chapter') {
        const out = await aiApi.chat(
          containerByChapterUser(c.name, chapterOrder, chapterTitle, chapterText, uiLanguage),
          textConfig,
          containerByChapterSystem(c.name, uiLanguage)
        );
        if (out.trim() && !isNoChange(out)) {
          state.appendContainerEntry(projectId, c.id, chapterId, {
            id: uid('entry'), value: out.trim(), createdAt: new Date().toISOString(), manual: false, ...source,
          });
        }
      } else {
        // by_character
        const perCharacter = characters
          .map((ch) => {
            const entries = state.getContainerEntries(projectId, c.id, ch.id);
            const latest = entries[entries.length - 1]?.value || (uiLanguage === 'en' ? '(none)' : '（暂无）');
            return `${ch.name}: ${latest}`;
          })
          .join('\n');
        const out = await aiApi.chat(
          containerByCharacterUser(c.name, perCharacter, chapterOrder, chapterTitle, chapterText, uiLanguage),
          textConfig,
          containerByCharacterSystem(c.name, uiLanguage)
        );
        const updates = parseNameValueJson(out);
        for (const [charName, value] of Object.entries(updates)) {
          const ch = characters.find((x) => x.name === charName);
          if (!ch) continue;
          state.appendContainerEntry(projectId, c.id, ch.id, {
            id: uid('entry'), value, createdAt: new Date().toISOString(), manual: false, ...source,
          });
        }
      }
    } catch (e) {
      console.warn(`[Container] auto-update failed for "${c.name}":`, e);
    }
  }

  // Character growth — only for characters whose route has already been started.
  for (const ch of characters) {
    const entries = state.getCharacterGrowth(projectId, ch.id);
    if (entries.length === 0) continue;
    try {
      const current = entries[entries.length - 1]?.value || '';
      const out = await aiApi.chat(
        growthUser(ch.name, current, chapterOrder, chapterTitle, chapterText, uiLanguage),
        textConfig,
        growthSystem(ch.name, uiLanguage)
      );
      if (out.trim() && !isNoChange(out)) {
        state.appendCharacterGrowth(projectId, ch.id, {
          id: uid('growth'),
          value: out.trim(),
          chapterId,
          chapterOrder,
          chapterTitle,
          createdAt: new Date().toISOString(),
          manual: false,
        });
      }
    } catch (e) {
      console.warn(`[Growth] auto-update failed for "${ch.name}":`, e);
    }
  }
}

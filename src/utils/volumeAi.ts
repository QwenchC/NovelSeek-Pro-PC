// 副本 (Volume) + in-volume arc generation, ported from Android data/ai/Prompts.kt
// (volumePlanSystem/User, arcsForVolumeSystem/User). Runs entirely on the frontend via the
// generic `ai_chat` command — no dedicated Rust command needed.

import { aiApi } from '@services/api';
import type { TextModelConfig } from '@typings/index';

type Lang = 'zh' | 'en';

export interface GeneratedVolume {
  name: string;
  description: string;
}

export interface GeneratedArc {
  title: string;
  summary: string;
  chapter_count: number;
}

/** Strip ```json fences and parse the first JSON array found; [] on failure. */
function parseJsonArray(raw: string): unknown[] {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const arr = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// ── Prompts ────────────────────────────────────────────────────

function volumePlanSystem(lang: Lang): string {
  return lang === 'en'
    ? 'You plan VOLUMES (副本) for a long serialized novel — each volume is a self-contained stage of the story that will later hold several plot arcs. Do NOT plan individual arcs or chapters. Reply with a STRICT JSON array, no prose outside JSON: [{"name":"<volume name>","description":"<2-4 sentences: this stage\'s goal, core conflict, and outcome>"}]'
    : '你为长篇连载小说规划「副本」——每个副本是一段相对完整的故事阶段，之后会在其中容纳若干剧情弧线。不要规划具体的剧情弧线或章节。严格只输出 JSON 数组，不要 JSON 之外的任何文字：[{"name":"副本名称","description":"2-4句：该副本的阶段目标、核心矛盾与收束"}]';
}

function volumePlanUser(count: number, context: string, existingVolumes: string, requirements: string, lang: Lang): string {
  const lines: string[] = [];
  if (lang === 'en') {
    lines.push(`Plan ${count} new volume(s) that continue the story coherently.`);
    if (requirements.trim()) lines.push(`Author requirements (follow these; they may specify what specific volumes should cover):\n${requirements}`);
    if (existingVolumes.trim()) lines.push(`Existing volumes (do not duplicate):\n${existingVolumes}`);
    if (context.trim()) lines.push(`\nReference material:\n${context}`);
    lines.push(`\nOutput the JSON array of ${count} volume(s) only.`);
  } else {
    lines.push(`请规划 ${count} 个能让故事连贯推进的新副本。`);
    if (requirements.trim()) lines.push(`作者要求（请遵循，可能会指定第几个副本讲什么）：\n${requirements}`);
    if (existingVolumes.trim()) lines.push(`已有副本（不要重复）：\n${existingVolumes}`);
    if (context.trim()) lines.push(`\n参考资料：\n${context}`);
    lines.push(`\n只输出包含 ${count} 个副本的 JSON 数组。`);
  }
  return lines.join('\n');
}

function arcsForVolumeSystem(lang: Lang): string {
  return lang === 'en'
    ? 'You plan PLOT ARCS inside one volume (副本) of a long novel. Each arc is a multi-chapter narrative unit. Do NOT plan individual chapters (chapter planning is done separately). Reply with a STRICT JSON array, no prose outside JSON: [{"title":"<arc title>","summary":"<2-4 sentences>","chapter_count":<int>}]'
    : '你为长篇小说某个「副本」内部规划剧情弧线。每条弧线是一个跨多章的叙事单元。不要规划具体章节（章节规划另行进行）。严格只输出 JSON 数组，不要 JSON 之外的任何文字：[{"title":"弧线名称","summary":"2-4句概述","chapter_count":<整数>}]';
}

function arcsForVolumeUser(
  count: number, volumeName: string, volumeDescription: string,
  context: string, existingArcs: string, requirements: string, lang: Lang
): string {
  const lines: string[] = [];
  if (lang === 'en') {
    lines.push(`Volume: ${volumeName}`);
    if (volumeDescription.trim()) lines.push(`Volume description: ${volumeDescription}`);
    lines.push(`Plan ${count} plot arc(s) that fit WITHIN this volume.`);
    if (requirements.trim()) lines.push(`Author requirements (follow these; they may specify what specific arcs should cover):\n${requirements}`);
    if (existingArcs.trim()) lines.push(`Existing arcs in this volume (do not duplicate):\n${existingArcs}`);
    if (context.trim()) lines.push(`\nReference material:\n${context}`);
    lines.push(`\nOutput the JSON array of ${count} arc(s) only.`);
  } else {
    lines.push(`副本：${volumeName}`);
    if (volumeDescription.trim()) lines.push(`副本描述：${volumeDescription}`);
    lines.push(`请规划 ${count} 条契合本副本的剧情弧线。`);
    if (requirements.trim()) lines.push(`作者要求（请遵循，可能会指定第几条弧线讲什么）：\n${requirements}`);
    if (existingArcs.trim()) lines.push(`本副本已有弧线（不要重复）：\n${existingArcs}`);
    if (context.trim()) lines.push(`\n参考资料：\n${context}`);
    lines.push(`\n只输出包含 ${count} 条弧线的 JSON 数组。`);
  }
  return lines.join('\n');
}

// ── Public API ─────────────────────────────────────────────────

export async function generateVolumes(opts: {
  count: number;
  context: string;
  existingVolumes: string;
  requirements: string;
  textConfig: TextModelConfig;
  uiLanguage: Lang;
}): Promise<GeneratedVolume[]> {
  const { count, context, existingVolumes, requirements, textConfig, uiLanguage } = opts;
  const out = await aiApi.chat(
    volumePlanUser(count, context, existingVolumes, requirements, uiLanguage),
    textConfig,
    volumePlanSystem(uiLanguage)
  );
  return parseJsonArray(out)
    .map((v) => {
      const o = v as Record<string, unknown>;
      const name = typeof o.name === 'string' ? o.name.trim() : '';
      const description = typeof o.description === 'string' ? o.description.trim() : '';
      return name ? { name, description } : null;
    })
    .filter((v): v is GeneratedVolume => v !== null);
}

export async function generateArcsForVolume(opts: {
  count: number;
  volumeName: string;
  volumeDescription: string;
  context: string;
  existingArcs: string;
  requirements: string;
  textConfig: TextModelConfig;
  uiLanguage: Lang;
}): Promise<GeneratedArc[]> {
  const { count, volumeName, volumeDescription, context, existingArcs, requirements, textConfig, uiLanguage } = opts;
  const out = await aiApi.chat(
    arcsForVolumeUser(count, volumeName, volumeDescription, context, existingArcs, requirements, uiLanguage),
    textConfig,
    arcsForVolumeSystem(uiLanguage)
  );
  return parseJsonArray(out)
    .map((a) => {
      const o = a as Record<string, unknown>;
      const title = typeof o.title === 'string' ? o.title.trim() : '';
      const summary = typeof o.summary === 'string' ? o.summary.trim() : '';
      const n = Number(o.chapter_count);
      return title ? { title, summary, chapter_count: Number.isFinite(n) && n > 0 ? Math.floor(n) : 8 } : null;
    })
    .filter((a): a is GeneratedArc => a !== null);
}

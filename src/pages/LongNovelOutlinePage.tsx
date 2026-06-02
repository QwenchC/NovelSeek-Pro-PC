import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAppStore } from '@store/index';
import type { Character, PlotArc, Volume } from '@store/index';
import { projectApi } from '@services/api';
import { Button } from '@components/Button';
import {
  ArrowLeft, Sparkles, StopCircle, Save, Plus, Layers, RefreshCw,
  ChevronDown, ChevronUp, Edit2, Edit3, Trash2, GripVertical, CheckSquare, Square, Check,
  Library, FolderPlus,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { tx } from '@utils/i18n';
import { useSmartBack } from '@utils/useSmartBack';
import { buildRealmSystemContext } from '@utils/cultivation';
import { buildGenerationGuidance } from '@utils/containerAi';
import { generateVolumes, generateArcsForVolume } from '@utils/volumeAi';
import { VolumeEditModal } from '@components/VolumeEditModal';
import { confirmDialog } from '@utils/index';

// ── Section parser ─────────────────────────────────────────────
interface ParsedCharacter {
  name: string;
  role: string;
  personality: string;
  motivation: string;
  background: string;
}

interface ParsedOutlineSections {
  worldSetting?: string;
  timeline?: string;
  volumes?: Array<{ name: string; description: string }>;
  arcs?: Array<{ title: string; summary: string }>;
  characters?: ParsedCharacter[];
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSection(text: string, headers: string[]): string | undefined {
  for (const header of headers) {
    const re = new RegExp(
      `(?:^|\\n)#{1,3}\\s*${escapeRegex(header)}[^\\n]*\\n([\\s\\S]*?)(?=\\n#{1,3}|$)`,
      'i'
    );
    const m = text.match(re);
    if (m) return m[1].trim();
  }
  return undefined;
}

function parseOutlineSections(outline: string): ParsedOutlineSections {
  const worldSetting = extractSection(outline, ['世界观概述', '世界观设定', 'World Overview', 'World Setting']);
  const timeline = extractSection(outline, ['时间线', '故事时间线', 'Timeline', 'Story Timeline']);

  // 副本 (Volume) plan — mirrors Android's "## 副本规划" / "## Volume Plan" outline section.
  const volumeBlocks: Array<{ name: string; description: string }> = [];
  const volSection = extractSection(outline, ['副本规划', '副本', 'Volume Plan', 'Volumes']);
  if (volSection) {
    const volReZh = /#{2,4}\s+副本[^：:\n]*?[：:]\s*(.+?)(?:\n|$)([\s\S]*?)(?=\n#{2,4}|$)/g;
    let vm: RegExpExecArray | null;
    while ((vm = volReZh.exec(volSection)) !== null) {
      volumeBlocks.push({ name: vm[1].trim(), description: vm[2].trim() });
    }
    if (!volumeBlocks.length) {
      const volReEn = /#{2,4}\s+Volume\s+\d+[:：]?\s*(.+?)(?:\n|$)([\s\S]*?)(?=\n#{2,4}|$)/gi;
      while ((vm = volReEn.exec(volSection)) !== null) {
        volumeBlocks.push({ name: vm[1].trim(), description: vm[2].trim() });
      }
    }
  }

  const arcBlocks: Array<{ title: string; summary: string }> = [];
  // Chinese arc pattern: ### 弧线N: title  (N can be digit, Chinese number, or [N])
  const arcReZh = /#{2,3}\s+弧线[^：:\n]+?[：:]\s*(.+?)(?:\n|$)([\s\S]*?)(?=\n#{2,3}|$)/g;
  let m: RegExpExecArray | null;
  while ((m = arcReZh.exec(outline)) !== null) {
    arcBlocks.push({ title: m[1].trim(), summary: m[2].trim() });
  }
  if (!arcBlocks.length) {
    const arcReEn = /#{2,3}\s+Arc\s+\d+[:：]?\s*(.+?)(?:\n|$)([\s\S]*?)(?=\n#{2,3}|$)/gi;
    while ((m = arcReEn.exec(outline)) !== null) {
      arcBlocks.push({ title: m[1].trim(), summary: m[2].trim() });
    }
  }

  // ── Character parsing ──
  function extractCharField(block: string, keys: string[]): string {
    for (const key of keys) {
      const re = new RegExp(
        `(?:^|\\n)\\s*[-*]?\\s*\\*{0,2}${escapeRegex(key)}\\*{0,2}\\s*[：:][\\s]*(.*?)(?=\\n|$)`,
        'im'
      );
      const hit = block.match(re);
      if (hit) return hit[1].trim().replace(/^\*+|\*+$/g, '').trim();
    }
    return '';
  }

  const charBlocks: ParsedCharacter[] = [];
  const charSection = extractSection(outline, ['核心人物设定', '人物设定', 'Core Characters', 'Main Characters']);
  if (charSection) {
    const headRe = /#{2,3}\s+([^\n#（(【\[]{1,25})(?:[（(【\[][^\n）)】\]]{0,30}[）)】\]])?(?:\n|$)([\s\S]*?)(?=\n#{2,3}|\n#{1}\s|$)/g;
    while ((m = headRe.exec(charSection)) !== null) {
      const name = m[1].trim();
      if (!name) continue;
      charBlocks.push({
        name,
        role: extractCharField(m[2], ['身份', '身份定位', '定位', 'Role', 'Occupation']),
        personality: extractCharField(m[2], ['性格', '性格特点', 'Personality']),
        motivation: extractCharField(m[2], ['动机', '核心动机', 'Motivation', 'Goal']),
        background: extractCharField(m[2], ['背景', '人物弧线', '弧线成长', 'Background', 'Arc']),
      });
    }
    if (!charBlocks.length) {
      const numRe = /^\d+[.、]\s*\*{0,2}([^\n*（(]{1,25})\*{0,2}/gm;
      while ((m = numRe.exec(charSection)) !== null) {
        const name = m[1].trim();
        if (name) charBlocks.push({ name, role: '', personality: '', motivation: '', background: '' });
      }
    }
  }

  return {
    worldSetting: worldSetting || undefined,
    timeline: timeline || undefined,
    volumes: volumeBlocks.length > 0 ? volumeBlocks : undefined,
    arcs: arcBlocks.length > 0 ? arcBlocks : undefined,
    characters: charBlocks.length > 0 ? charBlocks.slice(0, 12) : undefined,
  };
}

// ── Existing context builder ───────────────────────────────────
function buildExistingContext(
  arcs: PlotArc[],
  worldSetting: string,
  timeline: string,
  lang: 'zh' | 'en'
): string | undefined {
  const parts: string[] = [];
  if (worldSetting.trim()) {
    parts.push(lang === 'zh'
      ? `【已有世界观设定】\n${worldSetting.trim()}`
      : `[Existing World Setting]\n${worldSetting.trim()}`);
  }
  if (timeline.trim()) {
    parts.push(lang === 'zh'
      ? `【已有时间线】\n${timeline.trim()}`
      : `[Existing Timeline]\n${timeline.trim()}`);
  }
  if (arcs.length > 0) {
    const arcText = [...arcs]
      .sort((a, b) => a.order - b.order)
      .map((a, i) =>
        `${lang === 'zh' ? `弧线${i + 1}` : `Arc ${i + 1}`}：${a.title}${a.summary ? `\n  ${a.summary}` : ''}`
      )
      .join('\n');
    parts.push(lang === 'zh'
      ? `【已有剧情弧线规划】\n${arcText}`
      : `[Existing Plot Arcs]\n${arcText}`);
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

// ── Save selection type ────────────────────────────────────────
interface SaveSelection {
  overwriteWorld: boolean;
  overwriteTimeline: boolean;
  overwriteVolumes: boolean;
  overwriteArcs: boolean;
  overwriteCharacters: boolean;
}

// ── Save Dialog ────────────────────────────────────────────────
function SaveOutlineDialog({
  parsed,
  currentWorldSetting,
  currentTimeline,
  currentArcCount,
  currentCharCount,
  uiLanguage,
  onConfirm,
  onClose,
}: {
  parsed: ParsedOutlineSections;
  currentWorldSetting: string;
  currentTimeline: string;
  currentArcCount: number;
  currentCharCount: number;
  uiLanguage: 'zh' | 'en';
  onConfirm: (sel: SaveSelection) => void;
  onClose: () => void;
}) {
  const [sel, setSel] = useState<SaveSelection>({
    overwriteWorld: true,
    overwriteTimeline: true,
    overwriteVolumes: true,
    overwriteArcs: true,
    overwriteCharacters: true,
  });

  const hasWorld = !!parsed.worldSetting;
  const hasTimeline = !!parsed.timeline;
  const hasVolumes = (parsed.volumes?.length ?? 0) > 0;
  const hasArcs = (parsed.arcs?.length ?? 0) > 0;
  const hasChars = (parsed.characters?.length ?? 0) > 0;

  const toggle = (key: keyof SaveSelection) =>
    setSel((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {tx(uiLanguage, '保存生成的大纲', 'Save Generated Outline')}
          </h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {tx(uiLanguage, 'AI大纲文本将始终保存。勾选需要同步覆盖的内容：', 'AI outline text is always saved. Check items to also overwrite:')}
          </p>
        </div>

        <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          {/* Always saved: outline text */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700">
            <CheckSquare className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-purple-800 dark:text-purple-300">
                {tx(uiLanguage, 'AI大纲文本（始终保存）', 'AI Outline Text (always saved)')}
              </p>
            </div>
          </div>

          {/* World setting */}
          {hasWorld && (
            <button
              onClick={() => toggle('overwriteWorld')}
              className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-colors ${
                sel.overwriteWorld
                  ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-600'
                  : 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 hover:border-blue-200'
              }`}
            >
              {sel.overwriteWorld
                ? <CheckSquare className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                : <Square className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {tx(uiLanguage, '覆盖世界观设定', 'Overwrite World Setting')}
                </p>
                {currentWorldSetting.trim() && (
                  <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">
                    {tx(uiLanguage, '⚠ 当前已有世界观设定，将被替换', '⚠ Existing world setting will be replaced')}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                  <span className="font-medium">{tx(uiLanguage, '新内容：', 'New: ')}</span>
                  {parsed.worldSetting?.slice(0, 150)}…
                </p>
              </div>
            </button>
          )}

          {/* Timeline */}
          {hasTimeline && (
            <button
              onClick={() => toggle('overwriteTimeline')}
              className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-colors ${
                sel.overwriteTimeline
                  ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-600'
                  : 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 hover:border-blue-200'
              }`}
            >
              {sel.overwriteTimeline
                ? <CheckSquare className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                : <Square className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {tx(uiLanguage, '覆盖时间线', 'Overwrite Timeline')}
                </p>
                {currentTimeline.trim() && (
                  <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">
                    {tx(uiLanguage, '⚠ 当前已有时间线内容，将被替换', '⚠ Existing timeline will be replaced')}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                  <span className="font-medium">{tx(uiLanguage, '新内容：', 'New: ')}</span>
                  {parsed.timeline?.slice(0, 150)}…
                </p>
              </div>
            </button>
          )}

          {/* Volumes (副本) */}
          {hasVolumes && (
            <button
              onClick={() => toggle('overwriteVolumes')}
              className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-colors ${
                sel.overwriteVolumes
                  ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-600'
                  : 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 hover:border-blue-200'
              }`}
            >
              {sel.overwriteVolumes
                ? <CheckSquare className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                : <Square className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {tx(uiLanguage, `创建副本（${parsed.volumes?.length} 个）`, `Create Volumes (${parsed.volumes?.length})`)}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {parsed.volumes?.slice(0, 8).map((v, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">{v.name}</span>
                  ))}
                </div>
              </div>
            </button>
          )}

          {/* Arcs */}
          {hasArcs && (
            <button
              onClick={() => toggle('overwriteArcs')}
              className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-colors ${
                sel.overwriteArcs
                  ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-600'
                  : 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 hover:border-blue-200'
              }`}
            >
              {sel.overwriteArcs
                ? <CheckSquare className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                : <Square className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {tx(
                    uiLanguage,
                    `覆盖剧情弧线（替换为 ${parsed.arcs?.length} 个新弧线）`,
                    `Overwrite Plot Arcs (replace with ${parsed.arcs?.length} new arcs)`
                  )}
                </p>
                {currentArcCount > 0 && (
                  <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">
                    {tx(uiLanguage, `⚠ 当前已有 ${currentArcCount} 个弧线，将全部替换`, `⚠ ${currentArcCount} existing arcs will be replaced`)}
                  </p>
                )}
                <div className="mt-1.5 space-y-0.5">
                  {parsed.arcs?.slice(0, 6).map((a, i) => (
                    <p key={i} className="text-xs text-gray-500">{i + 1}. {a.title}</p>
                  ))}
                  {(parsed.arcs?.length ?? 0) > 6 && (
                    <p className="text-xs text-gray-400 italic">
                      {tx(uiLanguage, `…还有 ${(parsed.arcs?.length ?? 0) - 6} 个弧线`, `…and ${(parsed.arcs?.length ?? 0) - 6} more arcs`)}
                    </p>
                  )}
                </div>
              </div>
            </button>
          )}

          {/* Characters */}
          {hasChars && (
            <button
              onClick={() => toggle('overwriteCharacters')}
              className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-colors ${
                sel.overwriteCharacters
                  ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-600'
                  : 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 hover:border-blue-200'
              }`}
            >
              {sel.overwriteCharacters
                ? <CheckSquare className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                : <Square className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {tx(
                    uiLanguage,
                    `导入角色到角色管理（${parsed.characters?.length} 个新角色）`,
                    `Import Characters (${parsed.characters?.length} new characters)`
                  )}
                </p>
                {currentCharCount > 0 && (
                  <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">
                    {tx(uiLanguage, `⚠ 已有 ${currentCharCount} 个角色，新角色将追加（不覆盖已有角色）`, `⚠ ${currentCharCount} existing characters — new ones will be appended`)}
                  </p>
                )}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {parsed.characters?.slice(0, 8).map((c, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                      {c.name}{c.role ? ` · ${c.role.slice(0, 8)}` : ''}
                    </span>
                  ))}
                  {(parsed.characters?.length ?? 0) > 8 && (
                    <span className="text-xs text-gray-400 italic">…+{(parsed.characters?.length ?? 0) - 8}</span>
                  )}
                </div>
              </div>
            </button>
          )}

          {!hasWorld && !hasTimeline && !hasVolumes && !hasArcs && !hasChars && (
            <p className="text-sm text-gray-500 italic">
              {tx(uiLanguage, '未能从大纲中识别出可解析的结构化内容，仅保存文本', 'No parseable structured content found — only outline text will be saved')}
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex gap-3">
          <Button variant="outline" onClick={onClose} className="flex-1">
            {tx(uiLanguage, '取消', 'Cancel')}
          </Button>
          <Button onClick={() => onConfirm(sel)} className="flex-1 bg-purple-600 hover:bg-purple-700">
            <Save className="w-4 h-4 mr-2" />
            {tx(uiLanguage, '确认保存', 'Confirm Save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────
export function LongNovelOutlinePage() {
  const { id } = useParams<{ id: string }>();
  const smartBack = useSmartBack(id ? `/long-novel/${id}` : '/long-novels');
  const {
    currentProject, setCurrentProject,
    textModelConfig, uiLanguage,
    getLongNovelOutline, setLongNovelOutline,
    getWorldSetting, setWorldSetting,
    getTimeline, setTimeline,
    getPlotArcs, setPlotArcs, addPlotArc, updatePlotArc, deletePlotArc,
    getCharacters, setCharacters,
    getCultivationRealms, getCharacterRealmEvents,
    getVolumes, setVolumes, ensureVolumes,
  } = useAppStore();

  const [worldSetting, setWorldSettingLocal] = useState('');
  const [timeline, setTimelineLocal] = useState('');
  const [outline, setOutline] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [requirements, setRequirements] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'outline' | 'arcs' | 'world' | 'timeline'>('outline');
  const [showArcModal, setShowArcModal] = useState<{ mode: 'create' | 'edit'; arc?: PlotArc } | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [isEditingOutline, setIsEditingOutline] = useState(false);
  // 副本 AI generation modal: generate volumes, or generate arcs inside a specific volume.
  const [volGen, setVolGen] = useState<{ mode: 'volumes' } | { mode: 'arcs'; volume: Volume } | null>(null);
  const [isVolGenerating, setIsVolGenerating] = useState(false);
  const [volGenError, setVolGenError] = useState<string | null>(null);
  const [editingVolume, setEditingVolume] = useState<Volume | null>(null);

  const cancelRef = useRef(false);

  const arcs = id ? getPlotArcs(id) : [];
  const sortedArcs = [...arcs].sort((a, b) => a.order - b.order);
  const volumes = id ? getVolumes(id) : [];

  const hasValidTextConfig =
    textModelConfig.apiKey.trim().length > 0 &&
    textModelConfig.apiUrl.trim().length > 0 &&
    textModelConfig.model.trim().length > 0;

  useEffect(() => {
    if (!id) return;
    projectApi.getById(id).then(setCurrentProject);
    setWorldSettingLocal(getWorldSetting(id));
    setTimelineLocal(getTimeline(id));
    setOutline(getLongNovelOutline(id));
    // Wrap any legacy/orphan arcs into a 副本 so the volume grouping is always coherent.
    ensureVolumes(id);
  }, [id]);

  // ── 副本 (Volume) operations ──────────────────────────────────
  const createVolume = () => {
    if (!id) return;
    const next: Volume = {
      id: `vol-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: tx(uiLanguage, `副本${volumes.length + 1}`, `Volume ${volumes.length + 1}`),
      description: '',
      order: volumes.length,
      createdAt: new Date().toISOString(),
    };
    setVolumes(id, [...volumes, next]);
    return next.id;
  };

  const saveVolumeEdit = (volumeId: string, name: string, description: string) => {
    if (!id) return;
    setVolumes(id, volumes.map((v) => (v.id === volumeId ? { ...v, name, description } : v)));
  };

  const deleteVolume = async (volumeId: string) => {
    if (!id) return;
    const confirmed = await confirmDialog(
      tx(uiLanguage, '删除该副本？其下弧线会移动到其它副本，不会删除。', 'Delete this volume? Its arcs move to another volume (arcs are kept).'),
      tx(uiLanguage, '删除副本', 'Delete Volume')
    );
    if (!confirmed) return;
    const remaining = volumes.filter((v) => v.id !== volumeId);
    const fallbackId = remaining[0]?.id;
    // Re-home this volume's arcs to the first remaining volume (or leave unassigned if none left).
    arcs
      .filter((a) => a.volumeId === volumeId)
      .forEach((a) => updatePlotArc(id, a.id, { volumeId: fallbackId }));
    setVolumes(id, remaining.map((v, i) => ({ ...v, order: i })));
  };

  const moveArcToVolume = (arcId: string, volumeId: string) => {
    if (!id) return;
    updatePlotArc(id, arcId, { volumeId });
  };

  // Reference material handed to the 副本/弧线 generators (outline + world + timeline, capped).
  const buildGenContext = (): string => {
    const parts: string[] = [];
    if (outline.trim()) parts.push(`${tx(uiLanguage, '【大纲】', '[Outline]')}\n${outline.slice(0, 3000)}`);
    if (worldSetting.trim()) parts.push(`${tx(uiLanguage, '【世界观】', '[World]')}\n${worldSetting.slice(0, 1500)}`);
    if (timeline.trim()) parts.push(`${tx(uiLanguage, '【时间线】', '[Timeline]')}\n${timeline.slice(0, 1000)}`);
    return parts.join('\n\n');
  };

  const handleGenerateVolumes = async (count: number, reqs: string) => {
    if (!id) return;
    setIsVolGenerating(true);
    setVolGenError(null);
    try {
      const existingVolumes = volumes.map((v) => `- ${v.name}：${v.description}`).join('\n');
      const gen = await generateVolumes({
        count, context: buildGenContext(), existingVolumes, requirements: reqs,
        textConfig: textModelConfig, uiLanguage,
      });
      if (gen.length === 0) {
        setVolGenError(tx(uiLanguage, 'AI 未返回有效副本，请重试或调整要求', 'AI returned no valid volumes — retry or adjust requirements'));
        return;
      }
      const base = getVolumes(id);
      const created: Volume[] = gen.map((v, i) => ({
        id: `vol-${Date.now()}-${i}`,
        name: v.name,
        description: v.description,
        order: base.length + i,
        createdAt: new Date().toISOString(),
      }));
      setVolumes(id, [...base, ...created]);
      setVolGen(null);
    } catch (e) {
      setVolGenError(typeof e === 'string' ? e : tx(uiLanguage, '生成失败', 'Generation failed'));
    } finally {
      setIsVolGenerating(false);
    }
  };

  const handleGenerateArcsForVolume = async (volume: Volume, count: number, reqs: string) => {
    if (!id) return;
    setIsVolGenerating(true);
    setVolGenError(null);
    try {
      const arcsInVol = arcs.filter((a) => a.volumeId === volume.id);
      const existingArcs = arcsInVol.map((a) => `- ${a.title}：${a.summary}`).join('\n');
      const gen = await generateArcsForVolume({
        count, volumeName: volume.name, volumeDescription: volume.description,
        context: buildGenContext(), existingArcs, requirements: reqs,
        textConfig: textModelConfig, uiLanguage,
      });
      if (gen.length === 0) {
        setVolGenError(tx(uiLanguage, 'AI 未返回有效弧线，请重试或调整要求', 'AI returned no valid arcs — retry or adjust requirements'));
        return;
      }
      let order = arcs.length;
      for (const g of gen) {
        addPlotArc(id, {
          title: g.title,
          summary: g.summary,
          order: order++,
          status: 'upcoming',
          chapterCount: g.chapter_count,
          volumeId: volume.id,
        });
      }
      setVolGen(null);
    } catch (e) {
      setVolGenError(typeof e === 'string' ? e : tx(uiLanguage, '生成失败', 'Generation failed'));
    } finally {
      setIsVolGenerating(false);
    }
  };

  const handleContinue = async () => {
    if (!id || !hasValidTextConfig || !outline) return;
    cancelRef.current = false;
    setIsGenerating(true);
    setError(null);

    const unlisten = await listen<string>('long-novel-outline-stream', (event) => {
      if (cancelRef.current) return;
      setOutline((prev) => prev + event.payload);
    });

    try {
      await invoke('continue_outline_stream', {
        partialOutline: outline,
        outputLanguage: uiLanguage,
        textConfig: textModelConfig,
      });
    } catch (e: unknown) {
      if (!cancelRef.current) {
        setError(typeof e === 'string' ? e : tx(uiLanguage, '续接生成失败', 'Continuation failed'));
      }
    } finally {
      unlisten();
      setIsGenerating(false);
    }
  };

  const handleGenerate = async () => {
    if (!id || !currentProject || !hasValidTextConfig) return;
    cancelRef.current = false;
    setIsGenerating(true);
    setError(null);
    setOutline('');

    const rawExistingContext = buildExistingContext(sortedArcs, worldSetting, timeline, uiLanguage);
    // Outline gen happens before any chapters exist; pass [] so we get realm ladder only.
    const realmContext = buildRealmSystemContext(
      getCultivationRealms(id),
      getCharacters(id),
      getCharacterRealmEvents(id),
      [],
      { uiLanguage, ladderOnly: true }
    );
    // Soft guidance from containers flagged "affects volume / outline generation".
    const containerGuidance = buildGenerationGuidance(id, 'volume', uiLanguage);
    // Mirror the Android outline structure: project → 副本(volume) → 剧情弧线(arc).
    const volumeDirective = tx(
      uiLanguage,
      '【结构要求】采用「项目→副本→剧情弧线」结构：在「## 剧情弧线规划」之前，先输出一节「## 副本规划」，列出 3-6 个副本，每个副本用标题 `### 副本N：副本名称`，并写 2-4 句（阶段目标 / 核心矛盾 / 收束）。',
      '[Structure] Use project → volume(副本) → arc: before "## Plot Arcs", output a "## Volume Plan" section listing 3-6 volumes, each as `### Volume N: Name` with 2-4 sentences (stage goal / core conflict / outcome).'
    );
    const existingContext = [rawExistingContext, realmContext, containerGuidance, volumeDirective]
      .filter((s) => s && s.trim())
      .join('\n\n')
      .trim() || undefined;

    const unlisten = await listen<string>('long-novel-outline-stream', (event) => {
      if (cancelRef.current) return;
      setOutline((prev) => prev + event.payload);
    });

    try {
      await invoke('generate_long_novel_outline_stream', {
        title: currentProject.title,
        genre: currentProject.genre || '',
        description: currentProject.description || '',
        requirements: requirements || undefined,
        existingContext: existingContext || undefined,
        outputLanguage: uiLanguage,
        textConfig: textModelConfig,
      });
    } catch (e: unknown) {
      if (!cancelRef.current) {
        setError(typeof e === 'string' ? e : tx(uiLanguage, '生成失败', 'Generation failed'));
      }
    } finally {
      unlisten();
      setIsGenerating(false);
    }
  };

  const handleCancel = async () => {
    cancelRef.current = true;
    try { await invoke('cancel_generation'); } catch {}
    setIsGenerating(false);
  };

  const handleSaveClick = () => {
    if (!outline.trim() || !id) return;
    setShowSaveDialog(true);
  };

  const handleConfirmSave = (sel: SaveSelection) => {
    if (!id) return;
    setLongNovelOutline(id, outline);

    const parsed = parseOutlineSections(outline);

    if (sel.overwriteWorld && parsed.worldSetting) {
      setWorldSetting(id, parsed.worldSetting);
      setWorldSettingLocal(parsed.worldSetting);
    }
    if (sel.overwriteTimeline && parsed.timeline) {
      setTimeline(id, parsed.timeline);
      setTimelineLocal(parsed.timeline);
    }
    // Volumes (副本) parsed from the outline — replace the project's volume set.
    if (sel.overwriteVolumes && parsed.volumes && parsed.volumes.length > 0) {
      const newVols: Volume[] = parsed.volumes.map((v, i) => ({
        id: `vol-${Date.now()}-${i}`,
        name: v.name,
        description: v.description,
        order: i,
        createdAt: new Date().toISOString(),
      }));
      setVolumes(id, newVols);
    }

    if (sel.overwriteArcs && parsed.arcs && parsed.arcs.length > 0) {
      // Ensure a 副本 exists to hold the freshly generated arcs (keep the first if present).
      let vols = getVolumes(id);
      if (vols.length === 0) {
        const vol: Volume = {
          id: `vol-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: tx(uiLanguage, '副本1', 'Volume 1'),
          description: '',
          order: 0,
          createdAt: new Date().toISOString(),
        };
        setVolumes(id, [vol]);
        vols = [vol];
      }
      const targetVolumeId = vols[0].id;
      const newArcs: PlotArc[] = parsed.arcs.map((a, i) => ({
        id: `arc-${Date.now()}-${i}`,
        title: a.title,
        summary: a.summary,
        order: i + 1,
        status: 'upcoming' as const,
        chapterCount: 0,
        volumeId: targetVolumeId,
      }));
      setPlotArcs(id, newArcs);
    }
    if (sel.overwriteCharacters && parsed.characters && parsed.characters.length > 0) {
      const existing = getCharacters(id);
      const existingNames = new Set(existing.map((c) => c.name));
      const newChars: Character[] = parsed.characters
        .filter((pc) => !existingNames.has(pc.name))
        .map((pc, i) => ({
          id: `char-outline-${Date.now()}-${i}`,
          name: pc.name,
          gender: '',
          role: pc.role,
          personality: pc.personality,
          background: pc.background,
          motivation: pc.motivation,
          appearance: '',
          isProtagonist: false,
        }));
      if (newChars.length > 0) {
        setCharacters(id, [...existing, ...newChars]);
      }
    }

    setShowSaveDialog(false);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleSaveWorldSetting = () => {
    if (!id) return;
    setWorldSetting(id, worldSetting);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleSaveTimeline = () => {
    if (!id) return;
    setTimeline(id, timeline);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleDeleteArc = async (arcId: string) => {
    const confirmed = await confirmDialog(
      tx(uiLanguage, '确定要删除这个剧情弧线吗？', 'Delete this plot arc?'),
      tx(uiLanguage, '删除弧线', 'Delete Arc')
    );
    if (!confirmed || !id) return;
    deletePlotArc(id, arcId);
  };

  const handleMoveArc = (arcId: string, direction: 'up' | 'down') => {
    if (!id) return;
    const idx = sortedArcs.findIndex((a) => a.id === arcId);
    const newSorted = [...sortedArcs];
    if (direction === 'up' && idx > 0) {
      [newSorted[idx], newSorted[idx - 1]] = [newSorted[idx - 1], newSorted[idx]];
    } else if (direction === 'down' && idx < sortedArcs.length - 1) {
      [newSorted[idx], newSorted[idx + 1]] = [newSorted[idx + 1], newSorted[idx]];
    } else {
      return;
    }
    setPlotArcs(id, newSorted.map((a, i) => ({ ...a, order: i + 1 })));
  };

  /** Move an arc to a 1-based position WITHIN its 副本, reusing the volume's existing order slots. */
  const moveArcToPosition = (arcId: string, position: number) => {
    if (!id) return;
    const arc = arcs.find((a) => a.id === arcId);
    if (!arc) return;
    const volArcs = [...arcs].filter((a) => a.volumeId === arc.volumeId).sort((a, b) => a.order - b.order);
    const slots = volArcs.map((a) => a.order);
    const without = volArcs.filter((a) => a.id !== arcId);
    const clamped = Math.max(1, Math.min(volArcs.length, Math.floor(position)));
    without.splice(clamped - 1, 0, arc);
    without.forEach((a, i) => {
      if (a.order !== slots[i]) updatePlotArc(id, a.id, { order: slots[i] });
    });
  };

  return (
    <div className="w-full max-w-[1500px] mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={smartBack}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            {tx(uiLanguage, '大纲与设定', 'Outline & World')}
          </h1>
          {currentProject && (
            <p className="text-sm text-gray-500">{currentProject.title}</p>
          )}
        </div>
      </div>

      {/* Tab bar — AI Outline is leftmost */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-700/50 rounded-xl p-1">
        {([
          { key: 'outline',  label: tx(uiLanguage, 'AI生成大纲', 'AI Outline'),    icon: Sparkles },
          { key: 'arcs',     label: tx(uiLanguage, '剧情弧线', 'Plot Arcs'),       icon: Layers },
          { key: 'world',    label: tx(uiLanguage, '世界观设定', 'World Setting'),  icon: undefined },
          { key: 'timeline', label: tx(uiLanguage, '时间线', 'Timeline'),           icon: undefined },
        ] as { key: string; label: string; icon?: React.ComponentType<{ className?: string }> }[]).map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {Icon && <Icon className="w-3.5 h-3.5" />}
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── AI Outline Tab ── */}
      {activeTab === 'outline' && (
        <div className="space-y-4">
          {/* Existing content hint */}
          {(worldSetting.trim() || timeline.trim() || arcs.length > 0) && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl px-4 py-3 text-sm text-blue-700 dark:text-blue-300">
              <span className="font-medium">
                {tx(uiLanguage, '已有内容将自动纳入提示词：', 'Existing content will be added to prompt: ')}
              </span>
              {[
                arcs.length > 0 && tx(uiLanguage, `${arcs.length} 个剧情弧线`, `${arcs.length} plot arcs`),
                worldSetting.trim() && tx(uiLanguage, '世界观设定', 'world setting'),
                timeline.trim() && tx(uiLanguage, '时间线', 'timeline'),
              ].filter(Boolean).join('、')}
            </div>
          )}

          {/* Controls */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <h3 className="font-medium text-gray-800 dark:text-gray-200">
              {tx(uiLanguage, 'AI生成故事大纲', 'AI Story Outline Generator')}
            </h3>
            <p className="text-xs text-gray-500">
              {tx(
                uiLanguage,
                '生成包含世界观、人物设定、时间线和剧情推进计划的详细大纲（不固定章节数）',
                'Generates world setting, characters, timeline, and story arc progression plan (no fixed chapter count)'
              )}
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {tx(uiLanguage, '额外要求（可选）', 'Additional Requirements (optional)')}
              </label>
              <textarea
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-20 resize-none text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder={tx(
                  uiLanguage,
                  '例如：主角要有成长弧、反转要在中段、结局留开放式悬念...',
                  'e.g. protagonist must have a growth arc, twist in the middle, open-ended finale...'
                )}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {!isGenerating ? (
                <Button
                  onClick={handleGenerate}
                  disabled={!hasValidTextConfig}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  {tx(uiLanguage, 'AI生成大纲', 'Generate Outline')}
                </Button>
              ) : (
                <Button onClick={handleCancel} variant="outline">
                  <StopCircle className="w-4 h-4 mr-2" />
                  {tx(uiLanguage, '停止生成', 'Stop')}
                </Button>
              )}
              {outline && !isGenerating && (
                <>
                  <Button onClick={handleContinue} variant="outline">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    {tx(uiLanguage, '续接生成', 'Continue')}
                  </Button>
                  {!isEditingOutline ? (
                    <Button onClick={() => setIsEditingOutline(true)} variant="outline">
                      <Edit3 className="w-4 h-4 mr-2" />
                      {tx(uiLanguage, '编辑大纲', 'Edit')}
                    </Button>
                  ) : (
                    <Button onClick={() => setIsEditingOutline(false)} variant="outline" className="text-green-600 border-green-400 hover:bg-green-50 dark:hover:bg-green-900/20">
                      <Check className="w-4 h-4 mr-2" />
                      {tx(uiLanguage, '完成编辑', 'Done')}
                    </Button>
                  )}
                  <Button onClick={handleSaveClick} className="bg-green-600 hover:bg-green-700">
                    <Save className="w-4 h-4 mr-2" />
                    {isSaved ? tx(uiLanguage, '已保存 ✓', 'Saved ✓') : tx(uiLanguage, '保存大纲', 'Save Outline')}
                  </Button>
                </>
              )}
            </div>
            {!hasValidTextConfig && (
              <p className="text-xs text-yellow-600 dark:text-yellow-400">
                {tx(uiLanguage, '请先在设置中配置AI模型', 'Please configure your AI model in Settings first')}
              </p>
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>

          {/* Streaming output / editor */}
          {(outline || isGenerating) && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
              {isEditingOutline ? (
                <textarea
                  value={outline}
                  onChange={(e) => setOutline(e.target.value)}
                  className="w-full h-[600px] px-6 py-5 bg-transparent text-gray-900 dark:text-gray-100 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 rounded-xl"
                  spellCheck={false}
                />
              ) : (
                <div className="p-6">
                  {outline ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{outline}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-gray-400 text-sm italic">{tx(uiLanguage, 'AI正在生成中...', 'Generating...')}</p>
                  )}
                  {isGenerating && (
                    <span className="inline-block w-2 h-4 bg-purple-500 animate-pulse ml-1 align-middle" />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Arcs Tab ── */}
      {activeTab === 'arcs' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {tx(uiLanguage, '规划故事的剧情推进节奏，每个弧线代表一段完整的剧情单元', 'Plan story pacing — each arc is a complete narrative unit')}
            </p>
            <Button onClick={() => setShowArcModal({ mode: 'create' })} className="text-sm bg-purple-600 hover:bg-purple-700">
              <Plus className="w-4 h-4 mr-1" />
              {tx(uiLanguage, '添加弧线', 'Add Arc')}
            </Button>
          </div>

          {sortedArcs.length === 0 ? (
            <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
              <Layers className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">{tx(uiLanguage, '还没有剧情弧线', 'No plot arcs yet')}</p>
              <p className="text-sm text-gray-400 mt-1 mb-4">
                {tx(uiLanguage, '可在"AI生成大纲"中生成并一键导入', 'Generate in the AI Outline tab and import with one click')}
              </p>
              <Button onClick={() => setShowArcModal({ mode: 'create' })} variant="outline">
                <Plus className="w-4 h-4 mr-1.5" />
                {tx(uiLanguage, '手动添加弧线', 'Add Arc Manually')}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Visual timeline */}
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  {tx(uiLanguage, '剧情进度总览', 'Story Progress Overview')}
                </h3>
                <div className="flex items-center overflow-x-auto pb-2">
                  {sortedArcs.map((arc, idx) => (
                    <div key={arc.id} className="flex items-center flex-shrink-0">
                      <div className={`flex flex-col items-center px-3 py-2 rounded-lg min-w-[100px] text-center ${
                        arc.status === 'completed'
                          ? 'bg-green-100 dark:bg-green-900/20 border border-green-300 dark:border-green-700'
                          : arc.status === 'active'
                          ? 'bg-blue-100 dark:bg-blue-900/20 border-2 border-blue-400 dark:border-blue-600'
                          : arc.status === 'ending'
                          ? 'bg-orange-100 dark:bg-orange-900/20 border-2 border-orange-400 dark:border-orange-600'
                          : 'bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600'
                      }`}>
                        <span className="text-xs font-bold text-gray-500 dark:text-gray-400">Arc {idx + 1}</span>
                        <span className="text-xs font-medium text-gray-800 dark:text-gray-200 mt-0.5 line-clamp-2 max-w-[90px]">
                          {arc.title}
                        </span>
                        <span className={`text-xs mt-1 ${
                          arc.status === 'completed' ? 'text-green-700 dark:text-green-400'
                          : arc.status === 'active' ? 'text-blue-700 dark:text-blue-400'
                          : arc.status === 'ending' ? 'text-orange-700 dark:text-orange-400'
                          : 'text-gray-400'
                        }`}>
                          {arc.status === 'completed' ? tx(uiLanguage, '完成', 'Done')
                           : arc.status === 'active' ? tx(uiLanguage, '进行中', 'Active')
                           : arc.status === 'ending'
                             ? tx(uiLanguage, `结尾 ${arc.chaptersUntilEnd ?? '?'}章`, `Ending ${arc.chaptersUntilEnd ?? '?'}ch`)
                           : tx(uiLanguage, '待开始', 'Upcoming')}
                        </span>
                      </div>
                      {idx < sortedArcs.length - 1 && (
                        <div className="w-6 h-0.5 bg-gray-300 dark:bg-gray-600 flex-shrink-0 mx-0.5" />
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => setShowArcModal({ mode: 'create' })}
                    className="flex-shrink-0 ml-2 flex items-center justify-center w-10 h-10 rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:border-purple-400 hover:text-purple-500 transition-colors"
                    title={tx(uiLanguage, '添加下一段剧情', 'Add next arc')}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Volume toolbar */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                  <Library className="w-3.5 h-3.5 text-purple-500" />
                  {tx(uiLanguage, '剧情弧线按「副本」组织', 'Arcs are organized into volumes (副本)')}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => { setVolGenError(null); setVolGen({ mode: 'volumes' }); }}
                    disabled={!hasValidTextConfig}
                    title={!hasValidTextConfig ? tx(uiLanguage, '请先配置文本模型', 'Configure text model first') : undefined}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 text-purple-700 dark:text-purple-300 hover:from-purple-100 hover:to-pink-100 disabled:opacity-40 transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {tx(uiLanguage, 'AI 生成副本', 'AI Volumes')}
                  </button>
                  <button
                    onClick={createVolume}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    {tx(uiLanguage, '新建副本', 'New Volume')}
                  </button>
                </div>
              </div>

              {/* Arcs grouped by volume */}
              {(() => {
                const assignedIds = new Set(volumes.map((v) => v.id));
                const orphanArcs = sortedArcs.filter((a) => !a.volumeId || !assignedIds.has(a.volumeId));
                const groups: { volume: Volume | null; volArcs: PlotArc[] }[] = volumes.map((v) => ({
                  volume: v,
                  volArcs: sortedArcs.filter((a) => a.volumeId === v.id),
                }));
                if (orphanArcs.length > 0) groups.push({ volume: null, volArcs: orphanArcs });

                return (
                  <div className="space-y-4">
                    {groups.map(({ volume, volArcs }) => (
                      <div
                        key={volume?.id ?? '__orphan'}
                        className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
                      >
                        <div className="flex items-start gap-2 px-4 py-2.5 bg-purple-50/60 dark:bg-purple-900/10 border-b border-gray-200 dark:border-gray-700">
                          <Library className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-sm text-gray-800 dark:text-gray-200 truncate block">
                              {volume ? volume.name : tx(uiLanguage, '未分配', 'Unassigned')}
                            </span>
                            {volume?.description && (
                              <span className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 block mt-0.5">
                                {volume.description}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">
                            {tx(uiLanguage, `${volArcs.length} 弧线`, `${volArcs.length} arcs`)}
                          </span>
                          {volume && (
                            <>
                              <button
                                onClick={() => { setVolGenError(null); setVolGen({ mode: 'arcs', volume }); }}
                                disabled={!hasValidTextConfig}
                                className="flex items-center gap-1 p-1 rounded text-purple-500 hover:text-purple-700 disabled:opacity-40 transition-colors"
                                title={tx(uiLanguage, 'AI 为本副本生成弧线', 'AI: generate arcs for this volume')}
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setEditingVolume(volume)}
                                className="p-1 rounded text-gray-400 hover:text-blue-600 transition-colors"
                                title={tx(uiLanguage, '编辑副本（名称 / 简介）', 'Edit volume (name / description)')}
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              {volumes.length > 1 && (
                                <button
                                  onClick={() => deleteVolume(volume.id)}
                                  className="p-1 rounded text-gray-400 hover:text-red-600 transition-colors"
                                  title={tx(uiLanguage, '删除副本', 'Delete volume')}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                        <div className="p-3 space-y-2">
                          {volArcs.length === 0 ? (
                            <p className="text-xs text-gray-400 text-center py-2">
                              {tx(uiLanguage, '该副本暂无弧线', 'No arcs in this volume')}
                            </p>
                          ) : (
                            volArcs.map((arc) => (
                              <OutlineArcRow
                                key={arc.id}
                                arc={arc}
                                index={sortedArcs.indexOf(arc)}
                                total={sortedArcs.length}
                                uiLanguage={uiLanguage}
                                volumes={volumes}
                                onChangeVolume={(vId) => moveArcToVolume(arc.id, vId)}
                                onEdit={() => setShowArcModal({ mode: 'edit', arc })}
                                onDelete={() => handleDeleteArc(arc.id)}
                                onMoveUp={() => handleMoveArc(arc.id, 'up')}
                                onMoveDown={() => handleMoveArc(arc.id, 'down')}
                              />
                            ))
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ── World Setting Tab ── */}
      {activeTab === 'world' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {tx(uiLanguage, '记录世界观、规则、势力等设定，生成章节时自动引用', 'Record world rules, factions, etc. — auto-referenced when generating chapters')}
          </p>
          <textarea
            value={worldSetting}
            onChange={(e) => setWorldSettingLocal(e.target.value)}
            className="w-full h-[500px] px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
            placeholder={tx(uiLanguage, '## 世界观设定\n\n### 时代背景\n...\n\n### 社会结构\n...\n\n### 特殊规则\n...', '## World Setting\n\n### Era & Background\n...')}
          />
          <div className="flex justify-end">
            <Button onClick={handleSaveWorldSetting}>
              <Save className="w-4 h-4 mr-2" />
              {isSaved ? tx(uiLanguage, '已保存 ✓', 'Saved ✓') : tx(uiLanguage, '保存', 'Save')}
            </Button>
          </div>
        </div>
      )}

      {/* ── Timeline Tab ── */}
      {activeTab === 'timeline' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {tx(uiLanguage, '记录重要历史事件和剧情时间线，确保章节时间顺序一致', 'Record important events and plot timeline for chapter consistency')}
          </p>
          <textarea
            value={timeline}
            onChange={(e) => setTimelineLocal(e.target.value)}
            className="w-full h-[500px] px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
            placeholder={tx(uiLanguage, '## 时间线\n\n### 历史事件（故事开始前）\n1. 【时间点】事件\n\n### 故事进行中\n1. 【第X弧线 第Y章】关键事件', '## Timeline\n\n### Historical Events (pre-story)\n1. [Timepoint] Event')}
          />
          <div className="flex justify-end">
            <Button onClick={handleSaveTimeline}>
              <Save className="w-4 h-4 mr-2" />
              {isSaved ? tx(uiLanguage, '已保存 ✓', 'Saved ✓') : tx(uiLanguage, '保存', 'Save')}
            </Button>
          </div>
        </div>
      )}

      {/* Arc modal */}
      {showArcModal && id && (() => {
        const editingArc = showArcModal.arc;
        const volArcs = editingArc ? sortedArcs.filter((a) => a.volumeId === editingArc.volumeId) : [];
        const arcPosition = editingArc ? volArcs.findIndex((a) => a.id === editingArc.id) + 1 : 0;
        return (
          <ArcModal
            mode={showArcModal.mode}
            arc={showArcModal.arc}
            nextOrder={arcs.length + 1}
            uiLanguage={uiLanguage}
            volumes={volumes}
            arcPosition={arcPosition}
            arcPositionMax={volArcs.length}
            onClose={() => setShowArcModal(null)}
            onSave={(data, position) => {
              if (showArcModal.mode === 'create') {
                // New arc lands in the chosen volume, or the first volume (created if none yet).
                let volumeId = data.volumeId;
                if (!volumeId) {
                  volumeId = volumes[0]?.id ?? createVolume();
                }
                addPlotArc(id, { ...data, volumeId });
              } else if (showArcModal.arc) {
                updatePlotArc(id, showArcModal.arc.id, data);
                if (position && position !== arcPosition) moveArcToPosition(showArcModal.arc.id, position);
              }
              setShowArcModal(null);
            }}
          />
        );
      })()}

      {/* Save dialog */}
      {showSaveDialog && (
        <SaveOutlineDialog
          parsed={parseOutlineSections(outline)}
          currentWorldSetting={worldSetting}
          currentTimeline={timeline}
          currentArcCount={arcs.length}
          currentCharCount={id ? getCharacters(id).length : 0}
          uiLanguage={uiLanguage}
          onConfirm={handleConfirmSave}
          onClose={() => setShowSaveDialog(false)}
        />
      )}

      {/* 副本 / 弧线 AI generation modal */}
      {volGen && (
        <VolumeGenModal
          mode={volGen.mode}
          volumeName={volGen.mode === 'arcs' ? volGen.volume.name : undefined}
          uiLanguage={uiLanguage}
          loading={isVolGenerating}
          error={volGenError}
          onClose={() => { if (!isVolGenerating) { setVolGen(null); setVolGenError(null); } }}
          onConfirm={(count, reqs) => {
            if (volGen.mode === 'volumes') handleGenerateVolumes(count, reqs);
            else handleGenerateArcsForVolume(volGen.volume, count, reqs);
          }}
        />
      )}

      {editingVolume && (
        <VolumeEditModal
          initialName={editingVolume.name}
          initialDescription={editingVolume.description}
          uiLanguage={uiLanguage}
          onClose={() => setEditingVolume(null)}
          onSave={(name, description) => { saveVolumeEdit(editingVolume.id, name, description); setEditingVolume(null); }}
        />
      )}
    </div>
  );
}

// ── 副本 / 弧线 AI generation modal ────────────────────────────
function VolumeGenModal({
  mode, volumeName, uiLanguage, loading, error, onClose, onConfirm,
}: {
  mode: 'volumes' | 'arcs';
  volumeName?: string;
  uiLanguage: 'zh' | 'en';
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (count: number, requirements: string) => void;
}) {
  const [count, setCount] = useState(mode === 'volumes' ? '3' : '4');
  const [reqs, setReqs] = useState('');
  const title = mode === 'volumes'
    ? tx(uiLanguage, 'AI 生成副本', 'AI Generate Volumes')
    : tx(uiLanguage, `AI 为「${volumeName}」生成弧线`, `AI Generate Arcs for "${volumeName}"`);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}>
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md shadow-2xl">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-500" />
          {title}
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {mode === 'volumes' ? tx(uiLanguage, '生成数量', 'Count') : tx(uiLanguage, '生成弧线数量', 'Arc count')}
            </label>
            <input
              type="number" min={1} max={12} value={count}
              onChange={(e) => setCount(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {tx(uiLanguage, '额外要求（可选）', 'Requirements (optional)')}
            </label>
            <textarea
              value={reqs}
              onChange={(e) => setReqs(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-24 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
              placeholder={mode === 'volumes'
                ? tx(uiLanguage, '例如：第一个副本写新手村，最后一个副本走向终局…', 'e.g. first volume is the origin, last drives to the finale…')
                : tx(uiLanguage, '例如：本副本要有一个反派转折…', 'e.g. include a villain twist in this volume…')}
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
        <div className="flex gap-3 mt-6">
          <Button variant="outline" onClick={onClose} disabled={loading} className="flex-1">
            {tx(uiLanguage, '取消', 'Cancel')}
          </Button>
          <Button
            onClick={() => onConfirm(Math.max(1, Math.min(12, parseInt(count, 10) || 3)), reqs.trim())}
            loading={loading}
            className="flex-1 bg-purple-600 hover:bg-purple-700"
          >
            <Sparkles className="w-4 h-4 mr-1.5" />
            {tx(uiLanguage, '生成', 'Generate')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Outline Arc Row ────────────────────────────────────────────
function OutlineArcRow({
  arc, index, total, uiLanguage, volumes, onChangeVolume, onEdit, onDelete, onMoveUp, onMoveDown,
}: {
  arc: PlotArc;
  index: number;
  total: number;
  uiLanguage: 'zh' | 'en';
  volumes: Volume[];
  onChangeVolume: (volumeId: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const statusColors = {
    upcoming:  'border-gray-200 dark:border-gray-700',
    active:    'border-blue-300 dark:border-blue-700',
    ending:    'border-orange-300 dark:border-orange-700',
    completed: 'border-green-300 dark:border-green-700',
  };

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border-2 ${statusColors[arc.status]} overflow-hidden`}>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
        onClick={() => setExpanded((v) => !v)}
      >
        <GripVertical className="w-4 h-4 text-gray-300 flex-shrink-0" />
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 text-white ${
          arc.status === 'completed' ? 'bg-green-500'
          : arc.status === 'active' || arc.status === 'ending' ? 'bg-purple-600'
          : 'bg-gray-400'
        }`}>
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-medium text-gray-900 dark:text-white">{arc.title}</span>
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onMoveUp}
            disabled={index === 0}
            className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 transition-colors"
            title={tx(uiLanguage, '上移', 'Move up')}
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 transition-colors"
            title={tx(uiLanguage, '下移', 'Move down')}
          >
            <ChevronDown className="w-4 h-4" />
          </button>
          <button
            onClick={onEdit}
            className="p-1 rounded text-gray-400 hover:text-blue-600 transition-colors"
            title={tx(uiLanguage, '编辑', 'Edit')}
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-1 rounded text-gray-400 hover:text-red-600 transition-colors"
            title={tx(uiLanguage, '删除', 'Delete')}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </div>
      {expanded && (
        <div className="px-4 pb-4 pt-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 space-y-3">
          {arc.summary && (
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{arc.summary}</p>
          )}
          {volumes.length > 0 && (
            <div className="flex items-center gap-2">
              <Library className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <label className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                {tx(uiLanguage, '所属副本', 'Volume')}
              </label>
              <select
                value={arc.volumeId ?? ''}
                onChange={(e) => onChangeVolume(e.target.value)}
                className="text-xs px-2 py-1 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
              >
                {volumes.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Arc Modal ──────────────────────────────────────────────────
const ARC_STATUSES: PlotArc['status'][] = ['upcoming', 'active', 'ending', 'completed'];
const ARC_STATUS_LABEL: Record<PlotArc['status'], { zh: string; en: string }> = {
  upcoming:  { zh: '未开始', en: 'Upcoming' },
  active:    { zh: '进行中', en: 'Active' },
  ending:    { zh: '结尾阶段', en: 'Ending Phase' },
  completed: { zh: '已完成', en: 'Completed' },
};

function ArcModal({
  mode, arc, nextOrder, uiLanguage, volumes, arcPosition, arcPositionMax, onClose, onSave,
}: {
  mode: 'create' | 'edit';
  arc?: PlotArc;
  nextOrder: number;
  uiLanguage: 'zh' | 'en';
  volumes: Volume[];
  arcPosition?: number;
  arcPositionMax?: number;
  onClose: () => void;
  onSave: (data: Omit<PlotArc, 'id'>, position?: number) => void;
}) {
  const [title, setTitle] = useState(arc?.title ?? '');
  const [summary, setSummary] = useState(arc?.summary ?? '');
  const [status, setStatus] = useState<PlotArc['status']>(arc?.status ?? 'upcoming');
  const [volumeId, setVolumeId] = useState<string>(arc?.volumeId ?? volumes[0]?.id ?? '');
  const [position, setPosition] = useState(String(arcPosition ?? 1));

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-lg shadow-2xl">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          {mode === 'create' ? tx(uiLanguage, '添加剧情弧线', 'Add Plot Arc') : tx(uiLanguage, '编辑剧情弧线', 'Edit Plot Arc')}
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {tx(uiLanguage, '弧线名称 *', 'Arc Title *')}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder={tx(uiLanguage, '例如：初入江湖、伏笔揭晓、终极决战', 'e.g. Awakening Arc, Rising Conflict, Final Battle')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {tx(uiLanguage, '剧情概述', 'Arc Summary')}
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-32 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder={tx(uiLanguage, '描述这段剧情的核心内容', "Describe this arc's core content")}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {tx(uiLanguage, '状态', 'Status')}
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as PlotArc['status'])}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {ARC_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {uiLanguage === 'zh' ? ARC_STATUS_LABEL[s].zh : ARC_STATUS_LABEL[s].en}
                </option>
              ))}
            </select>
          </div>
          {volumes.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {tx(uiLanguage, '所属副本', 'Volume')}
              </label>
              <select
                value={volumeId}
                onChange={(e) => setVolumeId(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {volumes.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
          )}
          {mode === 'edit' && (arcPositionMax ?? 0) > 1 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {tx(uiLanguage, `在副本内的顺序（1 - ${arcPositionMax}）`, `Position in volume (1 - ${arcPositionMax})`)}
              </label>
              <input
                type="number"
                min={1}
                max={arcPositionMax}
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                className="w-24 px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <p className="text-xs text-gray-400 mt-1">{tx(uiLanguage, '保存时移动到该序号。', 'Moved to this position on save.')}</p>
            </div>
          )}
        </div>
        <div className="flex gap-3 mt-6">
          <Button variant="outline" onClick={onClose} className="flex-1">
            {tx(uiLanguage, '取消', 'Cancel')}
          </Button>
          <Button
            onClick={() => {
              if (!title.trim()) return;
              onSave({
                title: title.trim(),
                summary: summary.trim(),
                order: arc?.order ?? nextOrder,
                status,
                chaptersUntilEnd: arc?.chaptersUntilEnd,
                chapterCount: arc?.chapterCount ?? 0,
                volumeId: volumeId || arc?.volumeId,
              }, mode === 'edit' ? parseInt(position, 10) || undefined : undefined);
            }}
            className="flex-1 bg-purple-600 hover:bg-purple-700"
            disabled={!title.trim()}
          >
            {tx(uiLanguage, '保存', 'Save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

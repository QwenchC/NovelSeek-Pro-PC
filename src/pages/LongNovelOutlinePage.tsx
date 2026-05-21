import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppStore } from '@store/index';
import type { Character, PlotArc } from '@store/index';
import { projectApi } from '@services/api';
import { Button } from '@components/Button';
import {
  ArrowLeft, Sparkles, StopCircle, Save, Plus, Layers, RefreshCw,
  ChevronDown, ChevronUp, Edit2, Trash2, GripVertical, CheckSquare, Square,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { tx } from '@utils/i18n';
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
    overwriteArcs: true,
    overwriteCharacters: true,
  });

  const hasWorld = !!parsed.worldSetting;
  const hasTimeline = !!parsed.timeline;
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

          {!hasWorld && !hasTimeline && !hasArcs && !hasChars && (
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
  const navigate = useNavigate();
  const {
    currentProject, setCurrentProject,
    textModelConfig, uiLanguage,
    getLongNovelOutline, setLongNovelOutline,
    getWorldSetting, setWorldSetting,
    getTimeline, setTimeline,
    getPlotArcs, setPlotArcs, addPlotArc, updatePlotArc, deletePlotArc,
    getCharacters, setCharacters,
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

  const cancelRef = useRef(false);

  const arcs = id ? getPlotArcs(id) : [];
  const sortedArcs = [...arcs].sort((a, b) => a.order - b.order);

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
  }, [id]);

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

    const existingContext = buildExistingContext(sortedArcs, worldSetting, timeline, uiLanguage);

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
    if (sel.overwriteArcs && parsed.arcs && parsed.arcs.length > 0) {
      const newArcs: PlotArc[] = parsed.arcs.map((a, i) => ({
        id: `arc-${Date.now()}-${i}`,
        title: a.title,
        summary: a.summary,
        order: i + 1,
        status: 'upcoming' as const,
        chapterCount: 0,
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
    if (direction === 'up' && idx > 0) {
      updatePlotArc(id, sortedArcs[idx].id, { order: sortedArcs[idx - 1].order });
      updatePlotArc(id, sortedArcs[idx - 1].id, { order: sortedArcs[idx].order });
    } else if (direction === 'down' && idx < sortedArcs.length - 1) {
      updatePlotArc(id, sortedArcs[idx].id, { order: sortedArcs[idx + 1].order });
      updatePlotArc(id, sortedArcs[idx + 1].id, { order: sortedArcs[idx].order });
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(`/long-novel/${id}`)}
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

          {/* Streaming output */}
          {(outline || isGenerating) && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
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

              <div className="space-y-2">
                {sortedArcs.map((arc, idx) => (
                  <OutlineArcRow
                    key={arc.id}
                    arc={arc}
                    index={idx}
                    total={sortedArcs.length}
                    uiLanguage={uiLanguage}
                    onEdit={() => setShowArcModal({ mode: 'edit', arc })}
                    onDelete={() => handleDeleteArc(arc.id)}
                    onMoveUp={() => handleMoveArc(arc.id, 'up')}
                    onMoveDown={() => handleMoveArc(arc.id, 'down')}
                  />
                ))}
              </div>
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
      {showArcModal && id && (
        <ArcModal
          mode={showArcModal.mode}
          arc={showArcModal.arc}
          nextOrder={arcs.length + 1}
          uiLanguage={uiLanguage}
          onClose={() => setShowArcModal(null)}
          onSave={(data) => {
            if (showArcModal.mode === 'create') {
              addPlotArc(id, data);
            } else if (showArcModal.arc) {
              updatePlotArc(id, showArcModal.arc.id, data);
            }
            setShowArcModal(null);
          }}
        />
      )}

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
    </div>
  );
}

// ── Outline Arc Row ────────────────────────────────────────────
function OutlineArcRow({
  arc, index, total, uiLanguage, onEdit, onDelete, onMoveUp, onMoveDown,
}: {
  arc: PlotArc;
  index: number;
  total: number;
  uiLanguage: 'zh' | 'en';
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
      {expanded && arc.summary && (
        <div className="px-4 pb-4 pt-0 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed pt-3">{arc.summary}</p>
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
  mode, arc, nextOrder, uiLanguage, onClose, onSave,
}: {
  mode: 'create' | 'edit';
  arc?: PlotArc;
  nextOrder: number;
  uiLanguage: 'zh' | 'en';
  onClose: () => void;
  onSave: (data: Omit<PlotArc, 'id'>) => void;
}) {
  const [title, setTitle] = useState(arc?.title ?? '');
  const [summary, setSummary] = useState(arc?.summary ?? '');
  const [status, setStatus] = useState<PlotArc['status']>(arc?.status ?? 'upcoming');

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
              });
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

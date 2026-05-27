import { useMemo, useState } from 'react';
import { useAppStore } from '@store/index';
import { aiApi } from '@services/api';
import { Button } from '@components/Button';
import { Sparkles, X, ChevronLeft } from 'lucide-react';
import { tx } from '@utils/i18n';
import { buildRealmSystemContext } from '@utils/cultivation';
import type { Chapter, PlotArcResult } from '@typings/index';

interface AiArcGenerateModalProps {
  projectId: string;
  projectTitle: string;
  projectDescription?: string | null;
  chapters: Chapter[];
  /** Called when the user accepts the generated arc; receives the data ready for addPlotArc. */
  onAccept: (data: { title: string; summary: string; chapterCount: number; miniOutline: string }) => void;
  onClose: () => void;
}

/**
 * AI-driven plot arc generator.
 *
 * Pulls the project's outline, world setting, existing arcs, characters and
 * cultivation realm system from the store, lets the user describe a rough idea,
 * then asks the LLM for a structured arc (title + summary + per-chapter beats).
 * The result is shown editable before the user commits to add it.
 */
export function AiArcGenerateModal({
  projectId, projectTitle, projectDescription, chapters, onAccept, onClose,
}: AiArcGenerateModalProps) {
  const {
    uiLanguage,
    textModelConfig,
    getLongNovelOutline,
    getPlotArcs,
    getCharacters,
    getCultivationRealms,
    getCharacterRealmEvents,
  } = useAppStore();

  const [userIdea, setUserIdea] = useState('');
  const [targetCount, setTargetCount] = useState('8');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlotArcResult | null>(null);

  // Editable copies of the result (so user can tweak before saving)
  const [editTitle, setEditTitle] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [editChapterCount, setEditChapterCount] = useState('');
  const [editMiniOutline, setEditMiniOutline] = useState('');

  const hasValidTextConfig =
    textModelConfig.apiKey.trim().length > 0 &&
    textModelConfig.apiUrl.trim().length > 0 &&
    textModelConfig.model.trim().length > 0;

  // Build the rich context inputs we'll pass to the backend.
  const arcsContextSummary = useMemo(() => {
    const arcs = getPlotArcs(projectId);
    if (arcs.length === 0) return '';
    return arcs
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((a) => `- [${a.status}] ${a.title}：${a.summary || '(无摘要)'}`)
      .join('\n');
  }, [projectId, getPlotArcs]);

  const realmContext = useMemo(
    () =>
      buildRealmSystemContext(
        getCultivationRealms(projectId),
        getCharacters(projectId),
        getCharacterRealmEvents(projectId),
        chapters,
        { uiLanguage }
      ),
    [projectId, chapters, uiLanguage, getCultivationRealms, getCharacters, getCharacterRealmEvents]
  );

  const charactersSummary = useMemo(() => {
    const chars = getCharacters(projectId);
    if (chars.length === 0) return '';
    return chars
      .slice(0, 20) // cap to avoid blowing prompt budget
      .map((c) => {
        const tag = c.isProtagonist ? '【主角】' : '';
        const role = c.role ? `（${c.role}）` : '';
        const motiv = c.motivation ? `动机：${c.motivation}` : '';
        return `- ${c.name}${tag}${role} ${motiv}`.trim();
      })
      .join('\n');
  }, [projectId, getCharacters]);

  const handleGenerate = async () => {
    if (!userIdea.trim()) {
      setError(tx(uiLanguage, '请先描述大致需求', 'Please describe your idea first'));
      return;
    }
    if (!hasValidTextConfig) {
      setError(tx(uiLanguage, '请先在设置中配置文本模型', 'Please configure the text model in Settings first'));
      return;
    }

    const n = Math.max(3, Math.min(30, parseInt(targetCount, 10) || 8));
    setIsGenerating(true);
    setError(null);
    setResult(null);

    try {
      const res = await aiApi.generatePlotArc({
        user_idea: userIdea.trim(),
        book_title: projectTitle,
        book_description: projectDescription || '',
        book_outline: getLongNovelOutline(projectId) || '',
        existing_arcs_summary: arcsContextSummary,
        realm_system_context: realmContext,
        characters_summary: charactersSummary,
        target_chapter_count: n,
        output_language: uiLanguage,
        text_config: textModelConfig,
      });
      setResult(res);
      setEditTitle(res.title);
      setEditSummary(res.summary);
      setEditChapterCount(String(res.chapter_count));
      setEditMiniOutline(res.mini_outline);
    } catch (e) {
      console.error('[AI Arc] failed:', e);
      setError(typeof e === 'string' ? e : tx(uiLanguage, '生成失败', 'Generation failed'));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAccept = () => {
    if (!editTitle.trim()) {
      setError(tx(uiLanguage, '标题不能为空', 'Title cannot be empty'));
      return;
    }
    const n = Math.max(3, Math.min(30, parseInt(editChapterCount, 10) || 8));
    onAccept({
      title: editTitle.trim(),
      summary: editSummary.trim(),
      chapterCount: n,
      miniOutline: editMiniOutline.trim(),
    });
  };

  const handleBack = () => {
    setResult(null);
    setError(null);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !isGenerating) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {tx(uiLanguage, 'AI 生成剧情弧线', 'AI Plot Arc Generator')}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 disabled:opacity-30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!result ? (
            // ── Input form ──────────────────────────────────────
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                {tx(uiLanguage,
                  'AI 会读取本书的「大纲、已有弧线、境界系统、主要角色」自动生成新弧线。你只需用一两句话描述大致想法。',
                  'AI reads this book\'s outline, existing arcs, realm system and main characters to generate a new arc. You just describe a rough idea in 1-2 sentences.')}
              </p>

              {/* Context preview chips */}
              <div className="flex flex-wrap gap-2 text-xs">
                <ContextChip
                  label={tx(uiLanguage, '大纲', 'Outline')}
                  ok={!!getLongNovelOutline(projectId).trim()}
                  uiLanguage={uiLanguage}
                />
                <ContextChip
                  label={tx(uiLanguage, '境界系统', 'Realm system')}
                  ok={!!realmContext}
                  uiLanguage={uiLanguage}
                />
                <ContextChip
                  label={tx(uiLanguage, `已有弧线 ${getPlotArcs(projectId).length}`, `${getPlotArcs(projectId).length} existing arcs`)}
                  ok={getPlotArcs(projectId).length > 0}
                  uiLanguage={uiLanguage}
                  neutral
                />
                <ContextChip
                  label={tx(uiLanguage, `角色 ${getCharacters(projectId).length}`, `${getCharacters(projectId).length} characters`)}
                  ok={getCharacters(projectId).length > 0}
                  uiLanguage={uiLanguage}
                  neutral
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {tx(uiLanguage, '大致需求（必填）', 'Rough idea (required)')}
                </label>
                <textarea
                  value={userIdea}
                  onChange={(e) => setUserIdea(e.target.value)}
                  rows={4}
                  placeholder={tx(uiLanguage,
                    '例如：主角进入"血泪谷"秘境，遭遇旧识的背叛，最终在筑基期突破中觉醒血脉异能。',
                    'e.g. The protagonist enters the Blood Tears Valley secret realm, faces betrayal from an old acquaintance, and awakens a bloodline ability during a Foundation Establishment breakthrough.')}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm resize-y"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {tx(uiLanguage, '目标章节数（3-30）', 'Target chapter count (3-30)')}
                </label>
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={targetCount}
                  onChange={(e) => setTargetCount(e.target.value)}
                  className="w-32 px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm"
                />
              </div>

              {error && (
                <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={onClose} disabled={isGenerating}>
                  {tx(uiLanguage, '取消', 'Cancel')}
                </Button>
                <Button
                  onClick={handleGenerate}
                  loading={isGenerating}
                  disabled={!userIdea.trim() || !hasValidTextConfig}
                >
                  <Sparkles className="w-4 h-4 mr-1.5" />
                  {tx(uiLanguage, '生成弧线', 'Generate Arc')}
                </Button>
              </div>
            </>
          ) : (
            // ── Result preview ──────────────────────────────────
            <>
              <button
                onClick={handleBack}
                className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              >
                <ChevronLeft className="w-4 h-4" />
                {tx(uiLanguage, '重新输入需求', 'Edit prompt')}
              </button>

              <p className="text-xs text-gray-500 dark:text-gray-400">
                {tx(uiLanguage,
                  '已生成。可在下方直接修改后保存为新弧线，章节列表会写入弧线的小纲，方便之后批量创建章节。',
                  'Generated. Edit inline before saving as a new arc. The chapter breakdown becomes the arc\'s mini-outline.')}
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {tx(uiLanguage, '弧线标题', 'Arc title')}
                </label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {tx(uiLanguage, '弧线摘要', 'Arc summary')}
                </label>
                <textarea
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                  rows={5}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm resize-y"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {tx(uiLanguage, '章节数', 'Chapter count')}
                </label>
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={editChapterCount}
                  onChange={(e) => setEditChapterCount(e.target.value)}
                  className="w-32 px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {tx(uiLanguage, '逐章细纲', 'Per-chapter beats')}
                </label>
                <textarea
                  value={editMiniOutline}
                  onChange={(e) => setEditMiniOutline(e.target.value)}
                  rows={10}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-xs font-mono resize-y"
                  spellCheck={false}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {tx(uiLanguage,
                    '格式：第N章：标题 — 本章目标。保留此格式才能在弧线编辑器里"一键创建章节"。',
                    'Format: "Chapter N: Title — Goal". Keep this format so the arc editor can bulk-create chapters from it later.')}
                </p>
              </div>

              {error && (
                <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                <Button variant="outline" onClick={onClose}>
                  {tx(uiLanguage, '放弃', 'Discard')}
                </Button>
                <Button onClick={handleAccept} disabled={!editTitle.trim()}>
                  {tx(uiLanguage, '保存为新弧线', 'Save as Arc')}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface ContextChipProps {
  label: string;
  ok: boolean;
  uiLanguage: 'zh' | 'en';
  neutral?: boolean;
}

function ContextChip({ label, ok, uiLanguage, neutral }: ContextChipProps) {
  const color = neutral
    ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
    : ok
      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
      : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400';
  const icon = neutral ? '' : (ok ? '✓ ' : '✗ ');
  return (
    <span className={`px-2 py-0.5 rounded-full ${color}`}>
      {icon}{label}
      {!ok && !neutral && (
        <span className="ml-1 text-[10px] opacity-70">
          {tx(uiLanguage, '未设置', 'unset')}
        </span>
      )}
    </span>
  );
}

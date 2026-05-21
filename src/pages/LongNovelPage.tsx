import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppStore } from '@store/index';
import type { PlotArc } from '@store/index';
import { projectApi, chapterApi } from '@services/api';
import { Button } from '@components/Button';
import {
  ArrowLeft, BookOpen, Layers, Users, FileText, Plus, Edit2,
  Trash2, ChevronDown, ChevronUp, Check, Play, Sunset,
  PenLine, ScrollText, Image, FileDown, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { formatDate, formatWordCount, confirmDialog } from '@utils/index';
import { tx } from '@utils/i18n';
import type { Chapter } from '@typings/index';

interface CoverImageItem {
  id: string;
  name: string;
  imageBase64: string;
  prompt?: string;
  createdAt?: string;
  config?: { model?: string; style?: string; width?: number; height?: number };
}

const createCoverId = () =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `cover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeCoverImages = (raw: string | null | undefined, labelPrefix = '封面'): CoverImageItem[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item, index) => {
      if (typeof item === 'string') return { id: createCoverId(), name: `${labelPrefix} ${index + 1}`, imageBase64: item, createdAt: new Date().toISOString() };
      if (item && typeof item === 'object') {
        const r = item as Record<string, unknown>;
        const imageBase64 = (r.imageBase64 || r.image_base64 || r.image || r.base64) as string | undefined;
        if (!imageBase64) return null;
        return { id: typeof r.id === 'string' && r.id ? r.id : createCoverId(), name: typeof r.name === 'string' && r.name ? r.name : `${labelPrefix} ${index + 1}`, imageBase64, prompt: typeof r.prompt === 'string' ? r.prompt : undefined, createdAt: typeof r.createdAt === 'string' ? r.createdAt : undefined, config: typeof r.config === 'object' ? r.config as CoverImageItem['config'] : undefined };
      }
      return null;
    }).filter(Boolean) as CoverImageItem[];
  } catch { return []; }
};

const ARC_STATUS_LABELS: Record<PlotArc['status'], { zh: string; en: string; color: string }> = {
  upcoming: { zh: '未开始', en: 'Upcoming', color: 'gray' },
  active:   { zh: '进行中', en: 'Active',    color: 'blue' },
  ending:   { zh: '结尾阶段', en: 'Ending',  color: 'orange' },
  completed:{ zh: '已完成', en: 'Completed', color: 'green' },
};

function arcStatusClass(status: PlotArc['status']) {
  const map = {
    upcoming:  'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    active:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    ending:    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  };
  return map[status] || map.upcoming;
}

export function LongNovelPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    uiLanguage,
    currentProject, setCurrentProject,
    chapters, setChapters,
    getPlotArcs, addPlotArc, updatePlotArc, deletePlotArc,
    textModelConfig, pollinationsKey, imageEngine, comfyUIUrl,
  } = useAppStore();

  const hasValidTextConfig =
    textModelConfig.apiKey.trim().length > 0 &&
    textModelConfig.apiUrl.trim().length > 0 &&
    textModelConfig.model.trim().length > 0;

  const [loading, setLoading] = useState(true);
  const [showArcModal, setShowArcModal] = useState<{ mode: 'create' | 'edit'; arc?: PlotArc } | null>(null);
  const [expandedArcs, setExpandedArcs] = useState<Record<string, boolean>>({});

  // Cover modal state
  const [showCoverModal, setShowCoverModal] = useState(false);
  const [coverImages, setCoverImages] = useState<CoverImageItem[]>([]);
  const [coverIndex, setCoverIndex] = useState(0);
  const [defaultCoverId, setDefaultCoverId] = useState<string | null>(null);
  const [coverGenerating, setCoverGenerating] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [coverConfig, setCoverConfig] = useState({ model: 'zimage', style: '', width: 1080, height: 1920 });

  const arcs = id ? getPlotArcs(id) : [];
  const activeArc = arcs.find((a) => a.status === 'active' || a.status === 'ending');

  useEffect(() => {
    if (!id) return;
    Promise.all([
      projectApi.getById(id).then(setCurrentProject),
      chapterApi.getByProject(id).then(setChapters),
    ]).finally(() => setLoading(false));
  }, [id]);

  // Load cover images when modal opens
  useEffect(() => {
    if (!showCoverModal || !currentProject) return;
    const parsed = normalizeCoverImages(currentProject.cover_images, tx(uiLanguage, '封面', 'Cover'));
    setCoverImages(parsed);
    const initDefault = currentProject.default_cover_id ?? null;
    setDefaultCoverId(initDefault);
    if (parsed.length > 0) {
      const defIdx = initDefault ? parsed.findIndex((c) => c.id === initDefault) : -1;
      setCoverIndex(defIdx >= 0 ? defIdx : 0);
    } else {
      setCoverIndex(0);
    }
  }, [showCoverModal, currentProject, uiLanguage]);

  // Keyboard navigation in cover modal
  useEffect(() => {
    if (!showCoverModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); setCoverIndex((p) => Math.max(0, p - 1)); }
      if (e.key === 'ArrowRight') { e.preventDefault(); setCoverIndex((p) => Math.min(coverImages.length - 1, p + 1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showCoverModal, coverImages.length]);

  const persistCoverState = async (nextCovers: CoverImageItem[], nextDefaultId: string | null) => {
    if (!currentProject) return;
    try {
      const cover_images = JSON.stringify(nextCovers);
      await projectApi.update(currentProject.id, {
        title: currentProject.title,
        author: currentProject.author,
        genre: currentProject.genre,
        description: currentProject.description,
        target_word_count: currentProject.target_word_count,
        cover_images,
        default_cover_id: nextDefaultId,
      });
      setCurrentProject({ ...currentProject, cover_images, default_cover_id: nextDefaultId });
    } catch {
      setCoverError(tx(uiLanguage, '保存封面失败', 'Failed to save cover'));
    }
  };

  const handleGenerateCover = async () => {
    if (!currentProject) return;
    if (!hasValidTextConfig) { setCoverError(tx(uiLanguage, '请先在设置中配置 DeepSeek API 密钥', 'Configure text model API key in Settings first')); return; }
    setCoverError(null);
    setCoverGenerating(true);
    try {
      const lang = currentProject.language === 'en' ? 'en' : 'zh';
      const baseText = lang === 'en'
        ? `Title: ${currentProject.title}\nGenre: ${currentProject.genre || 'Uncategorized'}\nOutline: ${currentProject.description || 'No outline'}`
        : `书名: ${currentProject.title}\n题材: ${currentProject.genre || '未分类'}\n简介: ${currentProject.description || '暂无简介'}`;
      const coverText = lang === 'en' ? `Cover design reference:\n${baseText}` : `封面设计：参考以下简介。\n${baseText}`;
      const prompt = await invoke<string>('generate_illustration_prompt', { text: coverText, style: coverConfig.style?.trim() || null, textConfig: textModelConfig });
      const imageBase64 = await invoke<string>('generate_promo_image', { prompt, width: coverConfig.width, height: coverConfig.height, model: coverConfig.model, pollinationsKey: pollinationsKey || null, engine: imageEngine, comfyuiUrl: comfyUIUrl || null });
      const newCover: CoverImageItem = { id: createCoverId(), name: `${tx(uiLanguage, '封面', 'Cover')} ${coverImages.length + 1}`, imageBase64, prompt, createdAt: new Date().toISOString(), config: { model: coverConfig.model, style: coverConfig.style, width: coverConfig.width, height: coverConfig.height } };
      const nextCovers = [...coverImages, newCover];
      const nextDefaultId = defaultCoverId ?? newCover.id;
      setCoverImages(nextCovers);
      setCoverIndex(nextCovers.length - 1);
      setDefaultCoverId(nextDefaultId);
      await persistCoverState(nextCovers, nextDefaultId);
    } catch (err) {
      setCoverError(typeof err === 'string' ? err : (err as Error)?.message || tx(uiLanguage, '生成封面失败', 'Failed to generate cover'));
    } finally {
      setCoverGenerating(false);
    }
  };

  const handleSetDefaultCover = async () => {
    const cur = coverImages[coverIndex];
    if (!cur) return;
    setDefaultCoverId(cur.id);
    await persistCoverState(coverImages, cur.id);
  };

  const handleRenameCover = async () => {
    const cur = coverImages[coverIndex];
    if (!cur) return;
    const nextName = window.prompt(tx(uiLanguage, '请输入新的封面名称', 'Enter new cover name'), cur.name);
    if (!nextName?.trim()) return;
    const nextCovers = coverImages.map((c, i) => (i === coverIndex ? { ...c, name: nextName.trim() } : c));
    setCoverImages(nextCovers);
    await persistCoverState(nextCovers, defaultCoverId);
  };

  const handleDeleteCover = async () => {
    const cur = coverImages[coverIndex];
    if (!cur) return;
    const confirmed = await confirmDialog(tx(uiLanguage, '确定删除该封面吗？', 'Delete this cover?'), tx(uiLanguage, '删除封面', 'Delete Cover'));
    if (!confirmed) return;
    const nextCovers = coverImages.filter((_, i) => i !== coverIndex);
    let nextDefaultId = defaultCoverId;
    if (cur.id === defaultCoverId) nextDefaultId = nextCovers.length > 0 ? nextCovers[0].id : null;
    const nextIndex = Math.min(coverIndex, Math.max(0, nextCovers.length - 1));
    setCoverImages(nextCovers);
    setCoverIndex(nextIndex);
    setDefaultCoverId(nextDefaultId);
    await persistCoverState(nextCovers, nextDefaultId);
  };

  const handleDeleteChapter = async (chapterId: string) => {
    const confirmed = await confirmDialog(
      tx(uiLanguage, '确定要删除这个章节吗？', 'Delete this chapter?'),
      tx(uiLanguage, '删除章节', 'Delete Chapter')
    );
    if (!confirmed || !id) return;
    await chapterApi.delete(chapterId);
    const updated = await chapterApi.getByProject(id);
    setChapters(updated);
  };

  const handleDeleteArc = async (arcId: string) => {
    const confirmed = await confirmDialog(
      tx(uiLanguage, '确定要删除这个剧情弧线吗？', 'Delete this plot arc?'),
      tx(uiLanguage, '删除弧线', 'Delete Arc')
    );
    if (!confirmed || !id) return;
    deletePlotArc(id, arcId);
  };

  const sortedArcs = [...arcs].sort((a, b) => a.order - b.order);
  const sortedChapters = [...chapters].sort((a, b) => a.order_index - b.order_index);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">{tx(uiLanguage, '加载中...', 'Loading...')}</div>
      </div>
    );
  }

  if (!currentProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-gray-500">{tx(uiLanguage, '项目不存在', 'Project not found')}</p>
        <Button onClick={() => navigate('/long-novels')} variant="outline">
          <ArrowLeft className="w-4 h-4 mr-2" />
          {tx(uiLanguage, '返回', 'Back')}
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={() => navigate('/long-novels')}
          className="mt-1 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs font-medium">
              <BookOpen className="w-3 h-3" />
              {tx(uiLanguage, '长篇小说', 'Long Novel')}
            </span>
            {currentProject.genre && (
              <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs">
                {currentProject.genre}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white truncate">
            {currentProject.title}
          </h1>
          {currentProject.author && (
            <p className="text-sm text-gray-500 dark:text-gray-400">{currentProject.author}</p>
          )}
          <div className="flex items-center gap-4 mt-2 text-sm text-gray-600 dark:text-gray-400">
            <span>{formatWordCount(currentProject.current_word_count)} {tx(uiLanguage, '字', 'words')}</span>
            <span>{sortedChapters.length} {tx(uiLanguage, '章', 'chapters')}</span>
            <span>{formatDate(currentProject.updated_at)}</span>
          </div>
        </div>
        {/* Action buttons */}
        <div className="flex gap-2 flex-shrink-0 flex-wrap">
          <Button
            variant="outline"
            onClick={() => navigate(`/long-novel/${id}/outline`)}
            className="text-sm"
          >
            <ScrollText className="w-4 h-4 mr-1.5" />
            {tx(uiLanguage, '世界观 / 大纲', 'Outline')}
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate(`/long-novel/${id}/characters`)}
            className="text-sm"
          >
            <Users className="w-4 h-4 mr-1.5" />
            {tx(uiLanguage, '角色', 'Characters')}
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowCoverModal(true)}
            className="text-sm"
          >
            <Image className="w-4 h-4 mr-1.5" />
            {tx(uiLanguage, '封面', 'Cover')}
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate(`/long-novel/${id}/export`)}
            className="text-sm"
          >
            <FileDown className="w-4 h-4 mr-1.5" />
            {tx(uiLanguage, '导出电子书', 'Export Ebook')}
          </Button>
          <Button
            onClick={() => navigate(`/long-novel/${id}/editor`)}
            className="text-sm bg-purple-600 hover:bg-purple-700"
          >
            <PenLine className="w-4 h-4 mr-1.5" />
            {tx(uiLanguage, '写章节', 'Write')}
          </Button>
        </div>
      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Arc progress — left col (2/5) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-600" />
                {tx(uiLanguage, '剧情弧线', 'Plot Arcs')}
              </h2>
              <button
                onClick={() => setShowArcModal({ mode: 'create' })}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {tx(uiLanguage, '添加弧线', 'Add Arc')}
              </button>
            </div>

            {sortedArcs.length === 0 ? (
              <div className="text-center py-6 text-sm text-gray-400">
                <Layers className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>{tx(uiLanguage, '还没有剧情弧线', 'No plot arcs yet')}</p>
                <p className="text-xs mt-1 opacity-70">
                  {tx(uiLanguage, '在大纲页生成或手动添加', 'Generate from outline or add manually')}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {sortedArcs.map((arc, idx) => (
                  <ArcCard
                    key={arc.id}
                    arc={arc}
                    index={idx}
                    uiLanguage={uiLanguage}
                    expanded={!!expandedArcs[arc.id]}
                    onToggle={() => setExpandedArcs((prev) => ({ ...prev, [arc.id]: !prev[arc.id] }))}
                    onEdit={() => setShowArcModal({ mode: 'edit', arc })}
                    onDelete={() => handleDeleteArc(arc.id)}
                    onStatusChange={(status) => id && updatePlotArc(id, arc.id, { status })}
                    onSetEndingChapters={(n) => id && updatePlotArc(id, arc.id, { status: 'ending', chaptersUntilEnd: n })}
                    onDecrementEnding={() =>
                      id &&
                      updatePlotArc(id, arc.id, {
                        chaptersUntilEnd: Math.max(0, (arc.chaptersUntilEnd ?? 1) - 1),
                      })
                    }
                  />
                ))}
              </div>
            )}
          </div>

          {/* Current arc status banner */}
          {activeArc && (
            <div
              className={`rounded-xl p-4 border ${
                activeArc.status === 'ending'
                  ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
                  : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
              }`}
            >
              {activeArc.status === 'ending' ? (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <Sunset className="w-4 h-4 text-orange-600" />
                    <span className="font-semibold text-orange-700 dark:text-orange-400 text-sm">
                      {tx(uiLanguage, '结尾阶段', 'Ending Phase')}
                    </span>
                  </div>
                  <p className="text-sm text-orange-700 dark:text-orange-300">
                    {tx(
                      uiLanguage,
                      `《${activeArc.title}》结尾阶段，预计还剩 ${activeArc.chaptersUntilEnd ?? '?'} 章结束本段剧情。`,
                      `"${activeArc.title}" is in ending phase — about ${activeArc.chaptersUntilEnd ?? '?'} chapters remaining.`
                    )}
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <Play className="w-4 h-4 text-blue-600" />
                    <span className="font-semibold text-blue-700 dark:text-blue-400 text-sm">
                      {tx(uiLanguage, '当前剧情', 'Active Arc')}
                    </span>
                  </div>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    {activeArc.title}
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Chapter list — right col (3/5) */}
        <div className="lg:col-span-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-purple-600" />
                {tx(uiLanguage, '章节列表', 'Chapters')}
                <span className="text-sm font-normal text-gray-500">({sortedChapters.length})</span>
              </h2>
              <Button
                onClick={() => navigate(`/long-novel/${id}/editor`)}
                className="text-sm bg-purple-600 hover:bg-purple-700 py-1.5"
              >
                <Plus className="w-4 h-4 mr-1" />
                {tx(uiLanguage, '写新章节', 'New Chapter')}
              </Button>
            </div>

            {sortedChapters.length === 0 ? (
              <div className="text-center py-10 text-sm text-gray-400">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p>{tx(uiLanguage, '还没有章节', 'No chapters yet')}</p>
                <p className="text-xs mt-1 opacity-70">
                  {tx(uiLanguage, '在大纲页设置世界观，然后开始写作', 'Set up the outline then start writing')}
                </p>
              </div>
            ) : (
              <div className="space-y-1 max-h-[600px] overflow-y-auto pr-1">
                {sortedChapters.map((chapter) => (
                  <ChapterRow
                    key={chapter.id}
                    chapter={chapter}
                    uiLanguage={uiLanguage}
                    onEdit={() => navigate(`/long-novel/${id}/editor/${chapter.id}`)}
                    onDelete={() => handleDeleteChapter(chapter.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {showArcModal && id && (
        <ArcEditModal
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

      {/* Cover modal */}
      {showCoverModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-4 shadow-2xl">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">{tx(uiLanguage, '生成封面', 'Generate Cover')}</h2>

            <div className="relative bg-gray-100 dark:bg-gray-900 rounded-lg overflow-hidden">
              {coverImages.length > 0 ? (
                <>
                  <img src={coverImages[coverIndex]?.imageBase64} alt="cover" className="w-full rounded-lg object-contain max-h-[45vh]" />
                  <button onClick={() => setCoverIndex((p) => Math.max(0, p - 1))} disabled={coverIndex === 0} className="absolute inset-y-0 left-0 px-3 flex items-center text-white/80 hover:text-white disabled:opacity-30"><ChevronLeft className="w-8 h-8" /></button>
                  <button onClick={() => setCoverIndex((p) => Math.min(coverImages.length - 1, p + 1))} disabled={coverIndex >= coverImages.length - 1} className="absolute inset-y-0 right-0 px-3 flex items-center text-white/80 hover:text-white disabled:opacity-30"><ChevronRight className="w-8 h-8" /></button>
                  <div className="absolute bottom-2 right-3 text-xs text-white/80">{coverIndex + 1} / {coverImages.length}</div>
                </>
              ) : (
                <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400 text-sm">{tx(uiLanguage, '暂无封面，点击下方按钮生成', 'No cover yet — click Generate')}</div>
              )}
            </div>

            {coverImages.length > 0 && (
              <p className="mt-1 text-xs text-gray-400">{tx(uiLanguage, '提示：可用键盘左右键翻页', 'Tip: Use ← → arrow keys to navigate')}</p>
            )}

            {coverImages[coverIndex] && (
              <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  {coverImages[coverIndex].name}
                  {coverImages[coverIndex].id === defaultCoverId && (
                    <span className="ml-2 px-1.5 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">{tx(uiLanguage, '默认', 'Default')}</span>
                  )}
                </span>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={handleSetDefaultCover} disabled={coverImages[coverIndex].id === defaultCoverId}>{tx(uiLanguage, '设为默认', 'Set Default')}</Button>
                  <Button variant="outline" size="sm" onClick={handleRenameCover}>{tx(uiLanguage, '重命名', 'Rename')}</Button>
                  <Button variant="outline" size="sm" onClick={handleDeleteCover} className="text-red-600 hover:text-red-700">{tx(uiLanguage, '删除', 'Delete')}</Button>
                </div>
              </div>
            )}

            {coverError && <p className="mt-2 text-sm text-red-500">{coverError}</p>}

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{tx(uiLanguage, '图片模型', 'Model')}</label>
                <input type="text" value={coverConfig.model} onChange={(e) => setCoverConfig((p) => ({ ...p, model: e.target.value }))} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm" placeholder="zimage" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{tx(uiLanguage, '图片风格', 'Style')}</label>
                <input type="text" list="cover-style-ln" value={coverConfig.style} onChange={(e) => setCoverConfig((p) => ({ ...p, style: e.target.value }))} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm" placeholder={tx(uiLanguage, '选择或输入（支持中文）', 'Select or type')} />
                <datalist id="cover-style-ln"><option value="cinematic" /><option value="watercolor" /><option value="anime" /></datalist>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{tx(uiLanguage, '宽度', 'Width')}</label>
                <input type="number" value={coverConfig.width} onChange={(e) => setCoverConfig((p) => ({ ...p, width: parseInt(e.target.value, 10) || p.width }))} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm" min={64} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{tx(uiLanguage, '高度', 'Height')}</label>
                <input type="number" value={coverConfig.height} onChange={(e) => setCoverConfig((p) => ({ ...p, height: parseInt(e.target.value, 10) || p.height }))} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm" min={64} />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button variant="outline" onClick={() => setShowCoverModal(false)} className="flex-1">{tx(uiLanguage, '关闭', 'Close')}</Button>
              <Button onClick={handleGenerateCover} loading={coverGenerating} className="flex-1">{tx(uiLanguage, '生成封面', 'Generate Cover')}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Arc Card ────────────────────────────────────────────────────
function ArcCard({
  arc, index, uiLanguage, expanded, onToggle, onEdit, onDelete,
  onStatusChange, onSetEndingChapters, onDecrementEnding: _onDecrementEnding,
}: {
  arc: PlotArc;
  index: number;
  uiLanguage: 'zh' | 'en';
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (s: PlotArc['status']) => void;
  onSetEndingChapters: (n: number) => void;
  onDecrementEnding: () => void;
}) {
  const [endingInput, setEndingInput] = useState('3');
  const [showEndingForm, setShowEndingForm] = useState(false);
  const info = ARC_STATUS_LABELS[arc.status];

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div
        className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
          arc.status === 'active' ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
        } ${arc.status === 'ending' ? 'bg-orange-50/50 dark:bg-orange-900/10' : ''}`}
        onClick={onToggle}
      >
        <div
          className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
            arc.status === 'completed'
              ? 'bg-green-500 text-white'
              : arc.status === 'active' || arc.status === 'ending'
              ? 'bg-purple-600 text-white'
              : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
          }`}
        >
          {arc.status === 'completed' ? <Check className="w-3 h-3" /> : index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate block">
            {arc.title}
          </span>
        </div>
        <span className={`text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 ${arcStatusClass(arc.status)}`}>
          {uiLanguage === 'zh' ? info.zh : info.en}
        </span>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 pt-2">
          {arc.summary && (
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              {arc.summary}
            </p>
          )}
          {arc.status === 'active' && (
            <>
              {!showEndingForm ? (
                <button
                  onClick={() => setShowEndingForm(true)}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-900/40 transition-colors w-full justify-center"
                >
                  <Sunset className="w-3.5 h-3.5" />
                  {tx(uiLanguage, '开始结束本段剧情', 'Start ending this arc')}
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    {tx(uiLanguage, '预计还需几章结束？', 'How many chapters to end?')}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={endingInput}
                    onChange={(e) => setEndingInput(e.target.value)}
                    className="w-14 px-1.5 py-1 text-xs border rounded dark:bg-gray-700 dark:border-gray-600"
                  />
                  <button
                    onClick={() => { onSetEndingChapters(parseInt(endingInput, 10) || 3); setShowEndingForm(false); }}
                    className="text-xs px-2 py-1 rounded bg-orange-500 text-white hover:bg-orange-600 transition-colors"
                  >
                    {tx(uiLanguage, '确认', 'OK')}
                  </button>
                  <button
                    onClick={() => setShowEndingForm(false)}
                    className="text-xs px-2 py-1 rounded bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-300 transition-colors"
                  >
                    {tx(uiLanguage, '取消', 'Cancel')}
                  </button>
                </div>
              )}
            </>
          )}
          {arc.status === 'ending' && (
            <div className="flex items-center gap-2 text-xs text-orange-700 dark:text-orange-400">
              <Sunset className="w-3.5 h-3.5" />
              <span>
                {tx(uiLanguage, `结尾倒计时：${arc.chaptersUntilEnd ?? '?'} 章`, `Ending countdown: ${arc.chaptersUntilEnd ?? '?'} chapters`)}
              </span>
            </div>
          )}
          {arc.status === 'ending' && (
            <button
              onClick={() => onStatusChange('completed')}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400 hover:bg-green-200 transition-colors w-full justify-center"
            >
              <Check className="w-3.5 h-3.5" />
              {tx(uiLanguage, '标记为已完成', 'Mark as completed')}
            </button>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onEdit}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-primary-600 transition-colors"
            >
              <Edit2 className="w-3 h-3" />
              {tx(uiLanguage, '编辑', 'Edit')}
            </button>
            <button
              onClick={onDelete}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              {tx(uiLanguage, '删除', 'Delete')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Chapter Row ────────────────────────────────────────────────
function ChapterRow({
  chapter, uiLanguage, onEdit, onDelete,
}: {
  chapter: Chapter;
  uiLanguage: 'zh' | 'en';
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer" onClick={onEdit}>
      <span className="text-xs text-gray-400 w-5 text-center flex-shrink-0">
        {chapter.order_index}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
          {chapter.title}
        </p>
        {chapter.outline_goal && (
          <p className="text-xs text-gray-500 truncate">{chapter.outline_goal}</p>
        )}
      </div>
      <span className="text-xs text-gray-400 flex-shrink-0">
        {chapter.word_count > 0 ? `${chapter.word_count.toLocaleString()}字` : ''}
      </span>
      <span
        className={`text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 ${
          chapter.status === 'final'
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : chapter.status === 'review'
            ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
            : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
        }`}
      >
        {chapter.status === 'final' ? tx(uiLanguage, '完成', 'Final') : chapter.status === 'review' ? tx(uiLanguage, '审阅', 'Review') : tx(uiLanguage, '草稿', 'Draft')}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-all flex-shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Arc Edit Modal ─────────────────────────────────────────────
function ArcEditModal({
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
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md shadow-2xl">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          {mode === 'create'
            ? tx(uiLanguage, '添加剧情弧线', 'Add Plot Arc')
            : tx(uiLanguage, '编辑剧情弧线', 'Edit Plot Arc')}
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
              placeholder={tx(uiLanguage, '例如：初入江湖、伏笔揭晓、终极决战', 'e.g. Prologue Arc, Revelation Arc, Climax Arc')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {tx(uiLanguage, '剧情概述', 'Arc Summary')}
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-24 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder={tx(uiLanguage, '简要描述这段剧情的核心内容、目的和结局...', 'Briefly describe the core content, purpose, and outcome of this arc...')}
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
              {(Object.keys(ARC_STATUS_LABELS) as PlotArc['status'][]).map((s) => (
                <option key={s} value={s}>
                  {uiLanguage === 'zh' ? ARC_STATUS_LABELS[s].zh : ARC_STATUS_LABELS[s].en}
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

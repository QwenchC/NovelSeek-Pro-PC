import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppStore } from '@store/index';
import { projectApi, chapterApi, knowledgeApi } from '@services/api';
import { Button } from '@components/Button';
import { BookSummaryButton } from '@components/BookSummaryButton';
import { CultivationSystemPanel } from '@components/CultivationSystemPanel';
import { MoreMenu, MoreMenuItem } from '@components/MoreMenu';
import { VolumeArcPanel } from '@components/VolumeArcPanel';
import { uiPrompt } from '@components/uiDialog';
import { useSmartBack } from '@utils/useSmartBack';
import {
  ArrowLeft, BookOpen, Library, Users, FileText, Plus, Edit2,
  Trash2, Play, Sunset,
  PenLine, ScrollText, Image, FileDown, ChevronLeft, ChevronRight, Sparkles,
  Boxes, MessageCircleQuestion, History, Headphones, ArrowUpDown, GripVertical,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { formatDate, formatWordCount, confirmDialog, chapterStructureLabel } from '@utils/index';
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

export function LongNovelPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const smartBack = useSmartBack('/long-novels');
  const {
    uiLanguage,
    currentProject, setCurrentProject,
    chapters, setChapters,
    getPlotArcs, getVolumes, ensureVolumes,
    cleanupRealmEventsForChapter,
    textModelConfig, pollinationsKey, imageEngine, comfyUIUrl,
  } = useAppStore();

  const hasValidTextConfig =
    textModelConfig.apiKey.trim().length > 0 &&
    textModelConfig.apiUrl.trim().length > 0 &&
    textModelConfig.model.trim().length > 0;

  const [loading, setLoading] = useState(true);

  // Cover modal state
  const [showCoverModal, setShowCoverModal] = useState(false);
  const [showCultivationModal, setShowCultivationModal] = useState(false);
  const [coverImages, setCoverImages] = useState<CoverImageItem[]>([]);
  const [coverIndex, setCoverIndex] = useState(0);
  const [defaultCoverId, setDefaultCoverId] = useState<string | null>(null);
  const [coverGenerating, setCoverGenerating] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [coverConfig, setCoverConfig] = useState({ model: 'zimage', style: '', width: 1080, height: 1920 });

  // ── Chapter reorder (sort toggle + long-press drag) ──────────────
  const [reorderMode, setReorderMode] = useState(false);
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const orderIdsRef = useRef<string[]>([]);
  const draggingIdRef = useRef<string | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const pressStartY = useRef(0);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const arcs = id ? getPlotArcs(id) : [];
  const activeArc = arcs.find((a) => a.status === 'active' || a.status === 'ending');
  const volumes = id ? getVolumes(id) : [];

  useEffect(() => {
    if (!id) return;
    Promise.all([
      projectApi.getById(id).then(setCurrentProject),
      chapterApi.getByProject(id).then(setChapters),
    ]).finally(() => setLoading(false));
    // Wrap legacy/imported arcs into a 副本 so the project→volume→arc→chapter structure is coherent.
    ensureVolumes(id);
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
    const nextName = await uiPrompt({ title: tx(uiLanguage, '重命名封面', 'Rename cover'), label: tx(uiLanguage, '封面名称', 'Cover name'), defaultValue: cur.name });
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
    // Best-effort cleanup of knowledge-base entries; never block the user on this.
    knowledgeApi
      .forgetSource({ projectId: id, sourceType: 'chapter', sourceId: chapterId })
      .catch((e) => console.warn('[KB] forgetSource failed:', e));
    knowledgeApi
      .forgetSummary({ projectId: id, scopeType: 'chapter', scopeId: chapterId })
      .catch((e) => console.warn('[KB] forgetSummary failed:', e));
    knowledgeApi
      .handleChapterDeletion(id, chapterId)
      .catch((e) => console.warn('[KB] handleChapterDeletion failed:', e));
    // Drop any cultivation realm events tied to this chapter (frontend-only state).
    cleanupRealmEventsForChapter(id, chapterId);
    const updated = await chapterApi.getByProject(id);
    setChapters(updated);
  };

  const handleRenameChapter = async (ch: Chapter) => {
    if (!id) return;
    const title = await uiPrompt({
      title: tx(uiLanguage, '章节重命名', 'Rename chapter'),
      label: tx(uiLanguage, '章节标题', 'Chapter title'),
      defaultValue: ch.title,
    });
    if (!title?.trim()) return;
    await chapterApi.updateMeta(ch.id, { title: title.trim() });
    setChapters(await chapterApi.getByProject(id));
  };

  const sortedArcs = [...arcs].sort((a, b) => a.order - b.order);
  const sortedVolumes = [...volumes].sort((a, b) => a.order - b.order);
  const sortedChapters = [...chapters].sort((a, b) => a.order_index - b.order_index);

  // Visual order while reordering; falls back to the natural sorted order otherwise.
  const displayChapters =
    reorderMode && orderIds.length
      ? (orderIds.map((cid) => chapters.find((c) => c.id === cid)).filter(Boolean) as Chapter[])
      : sortedChapters;

  // Keep the working order in sync with the store whenever we're not mid-drag.
  useEffect(() => {
    if (reorderMode && !draggingId) {
      const ids = [...chapters].sort((a, b) => a.order_index - b.order_index).map((c) => c.id);
      orderIdsRef.current = ids;
      setOrderIds(ids);
    } else if (!reorderMode) {
      orderIdsRef.current = [];
      setOrderIds([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reorderMode, chapters]);

  const cancelLongPress = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };

  const startLongPress = (e: React.PointerEvent, chapterId: string) => {
    pressStartY.current = e.clientY;
    cancelLongPress();
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      draggingIdRef.current = chapterId;
      setDraggingId(chapterId);
    }, 280);
  };

  const onRowPointerMove = (e: React.PointerEvent) => {
    // Cancel a pending long-press if the pointer moves too far before it fires (treat as scroll).
    if (longPressTimer.current && Math.abs(e.clientY - pressStartY.current) > 8) cancelLongPress();
  };

  const onRowPointerUp = () => {
    if (!draggingIdRef.current) cancelLongPress();
  };

  const persistChapterOrder = async (ids: string[]) => {
    if (!id) return;
    // Reassign the existing order_index value-set to the new order (preserves any 0-based prologue / gaps).
    const slots = [...chapters].map((c) => c.order_index).sort((a, b) => a - b);
    const updates: { cid: string; order: number }[] = [];
    ids.forEach((cid, i) => {
      const ch = chapters.find((c) => c.id === cid);
      if (ch && ch.order_index !== slots[i]) updates.push({ cid, order: slots[i] });
    });
    if (updates.length === 0) return;
    const next = chapters.map((c) => {
      const u = updates.find((x) => x.cid === c.id);
      return u ? { ...c, order_index: u.order } : c;
    });
    setChapters(next);
    try {
      for (const u of updates) await chapterApi.updateMeta(u.cid, { order_index: u.order });
    } catch {
      chapterApi.getByProject(id).then(setChapters);
    }
  };

  // Window-level drag tracking: reorder by pointer Y against each row's midpoint; commit on release.
  useEffect(() => {
    if (!draggingId) return;
    const move = (e: PointerEvent) => {
      const dragId = draggingIdRef.current;
      if (!dragId) return;
      const ids = orderIdsRef.current;
      let target = ids.length - 1;
      for (let i = 0; i < ids.length; i++) {
        const el = rowRefs.current[ids[i]];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) { target = i; break; }
      }
      const from = ids.indexOf(dragId);
      if (from === -1 || from === target) return;
      const reordered = [...ids];
      reordered.splice(from, 1);
      reordered.splice(target, 0, dragId);
      orderIdsRef.current = reordered;
      setOrderIds(reordered);
    };
    const up = () => {
      cancelLongPress();
      const dragId = draggingIdRef.current;
      draggingIdRef.current = null;
      setDraggingId(null);
      if (dragId) void persistChapterOrder(orderIdsRef.current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingId]);

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
        <Button onClick={smartBack} variant="outline">
          <ArrowLeft className="w-4 h-4 mr-2" />
          {tx(uiLanguage, '返回', 'Back')}
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1700px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={smartBack}
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
        {/* Action buttons — primary visible, the rest collapsed into a 更多 menu. */}
        <div className="flex gap-2 flex-shrink-0 flex-wrap items-center">
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
          <MoreMenu label={tx(uiLanguage, '更多', 'More')}>
            <MoreMenuItem icon={<Sparkles className="w-4 h-4 text-amber-500" />} label={tx(uiLanguage, '境界系统', 'Realms')} onClick={() => setShowCultivationModal(true)} />
            <MoreMenuItem icon={<Boxes className="w-4 h-4 text-purple-500" />} label={tx(uiLanguage, '容器', 'Containers')} onClick={() => navigate(`/long-novel/${id}/containers`)} />
            <MoreMenuItem icon={<MessageCircleQuestion className="w-4 h-4 text-blue-500" />} label={tx(uiLanguage, '问小说', 'Ask Novel')} onClick={() => navigate(`/long-novel/${id}/qa`)} />
            <MoreMenuItem icon={<History className="w-4 h-4 text-gray-500" />} label={tx(uiLanguage, '版本历史', 'History')} onClick={() => navigate(`/long-novel/${id}/history`)} />
            <MoreMenuItem icon={<Headphones className="w-4 h-4 text-teal-500" />} label={tx(uiLanguage, '听书', 'Listen')} onClick={() => navigate(`/long-novel/${id}/listen`)} />
            <MoreMenuItem icon={<Image className="w-4 h-4" />} label={tx(uiLanguage, '封面', 'Cover')} onClick={() => setShowCoverModal(true)} />
            <MoreMenuItem icon={<FileDown className="w-4 h-4" />} label={tx(uiLanguage, '导出电子书', 'Export Ebook')} onClick={() => navigate(`/long-novel/${id}/export`)} />
          </MoreMenu>
          {id && (
            <BookSummaryButton
              projectId={id}
              projectTitle={currentProject.title}
              projectDescription={currentProject.description}
              compact
            />
          )}
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
          {id && <VolumeArcPanel projectId={id} uiLanguage={uiLanguage} />}

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
              <div className="flex items-center gap-2">
                {sortedChapters.length > 1 && (
                  <button
                    onClick={() => setReorderMode((v) => !v)}
                    className={`flex items-center gap-1 text-sm px-2.5 py-1.5 rounded-lg transition-colors ${
                      reorderMode
                        ? 'bg-purple-600 text-white hover:bg-purple-700'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                    title={tx(uiLanguage, '调整章节顺序：长按章节后上下拖动', 'Reorder chapters: long-press a chapter then drag up/down')}
                  >
                    <ArrowUpDown className="w-4 h-4" />
                    {reorderMode ? tx(uiLanguage, '完成', 'Done') : tx(uiLanguage, '排序', 'Sort')}
                  </button>
                )}
                <Button
                  onClick={() => navigate(`/long-novel/${id}/editor`)}
                  className="text-sm bg-purple-600 hover:bg-purple-700 py-1.5"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  {tx(uiLanguage, '写新章节', 'New Chapter')}
                </Button>
              </div>
            </div>

            {reorderMode && (
              <p className="text-xs text-purple-500 dark:text-purple-400 mb-2 flex items-center gap-1">
                <GripVertical className="w-3 h-3" />
                {tx(uiLanguage, '长按某一章后上下拖动到目标位置，松开即保存。', 'Long-press a chapter, drag up/down to the target spot, release to save.')}
              </p>
            )}

            {sortedChapters.length === 0 ? (
              <div className="text-center py-10 text-sm text-gray-400">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p>{tx(uiLanguage, '还没有章节', 'No chapters yet')}</p>
                <p className="text-xs mt-1 opacity-70">
                  {tx(uiLanguage, '在大纲页设置世界观，然后开始写作', 'Set up the outline then start writing')}
                </p>
              </div>
            ) : (
              <div className="space-y-1 max-h-[calc(100vh-15rem)] overflow-y-auto pr-1">
                {displayChapters.map((chapter) => (
                  <ChapterRow
                    key={chapter.id}
                    chapter={chapter}
                    uiLanguage={uiLanguage}
                    structure={chapterStructureLabel(chapter.id, chapter.arc_id, sortedArcs, sortedVolumes)}
                    onEdit={() => navigate(`/long-novel/${id}/editor/${chapter.id}`)}
                    onRename={() => handleRenameChapter(chapter)}
                    onDelete={() => handleDeleteChapter(chapter.id)}
                    reorderMode={reorderMode}
                    isDragging={draggingId === chapter.id}
                    registerRef={(el) => { rowRefs.current[chapter.id] = el; }}
                    onReorderPointerDown={(e) => startLongPress(e, chapter.id)}
                    onReorderPointerMove={onRowPointerMove}
                    onReorderPointerUp={onRowPointerUp}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {showCultivationModal && id && (
        <CultivationSystemPanel
          projectId={id}
          chapters={sortedChapters}
          onClose={() => setShowCultivationModal(false)}
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

// ── Chapter Row ────────────────────────────────────────────────
function ChapterRow({
  chapter, uiLanguage, structure, onEdit, onRename, onDelete,
  reorderMode = false, isDragging = false, registerRef,
  onReorderPointerDown, onReorderPointerMove, onReorderPointerUp,
}: {
  chapter: Chapter;
  uiLanguage: 'zh' | 'en';
  structure: { volume: string | null; arc: string | null };
  onEdit: () => void;
  onRename: () => void;
  onDelete: () => void;
  reorderMode?: boolean;
  isDragging?: boolean;
  registerRef?: (el: HTMLDivElement | null) => void;
  onReorderPointerDown?: (e: React.PointerEvent) => void;
  onReorderPointerMove?: (e: React.PointerEvent) => void;
  onReorderPointerUp?: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      ref={registerRef}
      className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
        reorderMode
          ? `select-none touch-none ${isDragging
              ? 'bg-purple-100 dark:bg-purple-900/40 shadow-lg ring-2 ring-purple-400 cursor-grabbing'
              : 'bg-gray-50/70 dark:bg-gray-700/30 cursor-grab hover:bg-gray-100 dark:hover:bg-gray-700/50'}`
          : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer'
      }`}
      onClick={reorderMode ? undefined : onEdit}
      onPointerDown={reorderMode ? onReorderPointerDown : undefined}
      onPointerMove={reorderMode ? onReorderPointerMove : undefined}
      onPointerUp={reorderMode ? onReorderPointerUp : undefined}
    >
      {reorderMode && <GripVertical className="w-4 h-4 text-gray-400 flex-shrink-0" />}
      <span className="text-xs text-gray-400 w-5 text-center flex-shrink-0">
        {chapter.order_index}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
          {chapter.title}
        </p>
        {(structure.volume || structure.arc) && (
          <p className="text-xs text-purple-500 dark:text-purple-400 truncate flex items-center gap-1">
            <Library className="w-3 h-3 flex-shrink-0" />
            {[structure.volume, structure.arc].filter(Boolean).join(' · ')}
          </p>
        )}
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
      {!reorderMode && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); onRename(); }}
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 transition-all flex-shrink-0"
            title={tx(uiLanguage, '重命名', 'Rename')}
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-all flex-shrink-0"
            title={tx(uiLanguage, '删除', 'Delete')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  );
}

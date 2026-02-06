import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppStore } from '@store/index';
import { projectApi, chapterApi } from '@services/api';
import { Button } from '@components/Button';
import { ArrowLeft, Plus, Edit, Sparkles, Users, ChevronDown, ChevronUp, Trash2, Image, ChevronLeft, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Chapter, Project } from '@typings/index';
import { confirmDialog } from '@utils/index';

interface CoverImageItem {
  id: string;
  name: string;
  imageBase64: string;
  prompt?: string;
  createdAt?: string;
  config?: {
    model?: string;
    style?: string;
    width?: number;
    height?: number;
  };
}

const createCoverId = () =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `cover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeCoverImages = (raw: string | null | undefined): CoverImageItem[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item, index) => {
        if (typeof item === 'string') {
          return {
            id: createCoverId(),
            name: `封面 ${index + 1}`,
            imageBase64: item,
            createdAt: new Date().toISOString(),
          };
        }
        if (item && typeof item === 'object') {
          const rawItem = item as Record<string, unknown>;
          const imageBase64 =
            (rawItem.imageBase64 as string | undefined) ||
            (rawItem.image_base64 as string | undefined) ||
            (rawItem.image as string | undefined) ||
            (rawItem.base64 as string | undefined);

          if (!imageBase64 || typeof imageBase64 !== 'string') return null;

          return {
            id: typeof rawItem.id === 'string' && rawItem.id ? rawItem.id : createCoverId(),
            name:
              typeof rawItem.name === 'string' && rawItem.name ? rawItem.name : `封面 ${index + 1}`,
            imageBase64,
            prompt: typeof rawItem.prompt === 'string' ? rawItem.prompt : undefined,
            createdAt:
              typeof rawItem.createdAt === 'string'
                ? rawItem.createdAt
                : typeof rawItem.created_at === 'string'
                  ? (rawItem.created_at as string)
                  : undefined,
            config: typeof rawItem.config === 'object' ? (rawItem.config as CoverImageItem['config']) : undefined,
          };
        }
        return null;
      })
      .filter(Boolean) as CoverImageItem[];
  } catch {
    return [];
  }
};

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentProject, setCurrentProject, chapters, setChapters, deepseekKey, pollinationsKey } = useAppStore();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showOutlineModal, setShowOutlineModal] = useState(false);
  const [showCreateChapterModal, setShowCreateChapterModal] = useState(false);
  const [outlineExpanded, setOutlineExpanded] = useState(false);
  const [showCoverModal, setShowCoverModal] = useState(false);
  const [coverImages, setCoverImages] = useState<CoverImageItem[]>([]);
  const [coverIndex, setCoverIndex] = useState(0);
  const [defaultCoverId, setDefaultCoverId] = useState<string | null>(null);
  const [coverGenerating, setCoverGenerating] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [isGeneratingPrologue, setIsGeneratingPrologue] = useState(false);
  const [coverConfig, setCoverConfig] = useState({
    model: 'zimage',
    style: '',
    width: 1080,
    height: 1920,
  });

  useEffect(() => {
    if (id) {
      loadProject(id);
      loadChapters(id);
      // 重新计算并更新项目字数
      recalculateWordCount(id);
    }
  }, [id]);

  useEffect(() => {
    if (!showCoverModal) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!coverImages.length) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setCoverIndex(prev => Math.max(0, prev - 1));
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setCoverIndex(prev => Math.min(coverImages.length - 1, prev + 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showCoverModal, coverImages.length]);

  useEffect(() => {
    if (!showCoverModal || !currentProject) return;
    const parsed = normalizeCoverImages(currentProject.cover_images);
    setCoverImages(parsed);
    const initialDefaultId = currentProject.default_cover_id ?? null;
    setDefaultCoverId(initialDefaultId);
    if (parsed.length > 0) {
      const defaultIndex = initialDefaultId
        ? parsed.findIndex((item) => item.id === initialDefaultId)
        : -1;
      setCoverIndex(defaultIndex >= 0 ? defaultIndex : 0);
    } else {
      setCoverIndex(0);
    }
  }, [showCoverModal]);

  const recalculateWordCount = async (projectId: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke('recalculate_project_word_count', { projectId });
      // 重新加载项目以获取更新后的字数
      const project = await projectApi.getById(projectId);
      setCurrentProject(project);
    } catch (error) {
      console.error('Failed to recalculate word count:', error);
    }
  };

  const loadProject = async (projectId: string) => {
    try {
      const project = await projectApi.getById(projectId);
      setCurrentProject(project);
    } catch (error) {
      console.error('Failed to load project:', error);
    }
  };

  const loadChapters = async (projectId: string) => {
    try {
      const data = await chapterApi.getByProject(projectId);
      const prologue = data.find(ch => ch.title.trim() === '序章');
      if (prologue && prologue.order_index === 1) {
        const toShift = data.filter(ch => ch.id !== prologue.id && ch.order_index > 1);
        for (const chapter of toShift.sort((a, b) => a.order_index - b.order_index)) {
          await chapterApi.updateMeta(chapter.id, { order_index: chapter.order_index - 1 });
        }
        await chapterApi.updateMeta(prologue.id, { order_index: 0 });
        const refreshed = await chapterApi.getByProject(projectId);
        setChapters(refreshed);
        return;
      }
      if (!prologue && data.length > 0) {
        const minOrder = Math.min(...data.map(ch => ch.order_index));
        if (minOrder > 1) {
          for (const chapter of data.sort((a, b) => a.order_index - b.order_index)) {
            await chapterApi.updateMeta(chapter.id, { order_index: chapter.order_index - (minOrder - 1) });
          }
          const refreshed = await chapterApi.getByProject(projectId);
          setChapters(refreshed);
          return;
        }
      }
      setChapters(data);
    } catch (error) {
      console.error('Failed to load chapters:', error);
    }
  };

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
      setCurrentProject({
        ...currentProject,
        cover_images,
        default_cover_id: nextDefaultId,
      });
    } catch (error) {
      console.error('Failed to save cover images:', error);
      setCoverError('保存封面失败');
    }
  };

  const handleDeleteChapter = async (chapterId: string) => {
    const target = chapters.find(ch => ch.id === chapterId);
    const confirmed = await confirmDialog('确定要删除这个章节吗？删除后无法恢复！', '删除章节');
    if (!confirmed) {
      return;
    }
    try {
      await chapterApi.delete(chapterId);
      if (target && target.title.trim() === '序章' && target.order_index === 1) {
        const toShift = chapters.filter(ch => ch.id !== chapterId && ch.order_index > 1);
        for (const chapter of toShift.sort((a, b) => a.order_index - b.order_index)) {
          await chapterApi.updateMeta(chapter.id, { order_index: chapter.order_index - 1 });
        }
      }
      if (id) loadChapters(id);
    } catch (error) {
      console.error('Failed to delete chapter:', error);
      alert('删除章节失败');
    }
  };

  const handleGeneratePrologue = async () => {
    if (!currentProject) return;
    if (!currentProject.description || !currentProject.description.trim()) {
      alert('请先生成小说大纲');
      return;
    }
    if (!deepseekKey) {
      alert('请先在设置中配置 DeepSeek API 密钥');
      return;
    }
    if (chapters.some(ch => ch.title.trim() === '序章')) {
      alert('序章已存在');
      return;
    }

    if (chapters.some(ch => ch.order_index === 0)) {
      alert('\u5e8f\u7ae0\u5df2\u5b58\u5728');
      return;
    }
    setIsGeneratingPrologue(true);
    try {
      const prologueChapter = await chapterApi.create({
        project_id: currentProject.id,
        title: '序章',
        order_index: 0,
        outline_goal: '序章',
      });
      await chapterApi.updateMeta(prologueChapter.id, {
        title: '序章',
        outline_goal: '序章',
        order_index: 0,
      });
      await chapterApi.updateMeta(prologueChapter.id, {
        title: '\u5e8f\u7ae0',
        outline_goal: '\u5e8f\u7ae0',
        order_index: 0,
      });
      await loadChapters(currentProject.id);
      navigate(`/editor/${id}/${prologueChapter.id}?prologue=1`);
      return;
    } catch (error) {
      const message = typeof error === 'string' ? error : (error as Error)?.message || '序章生成失败';
      alert(message);
    } finally {
      setIsGeneratingPrologue(false);
    }
  };

  if (!currentProject) {
    return <div>加载中...</div>;
  }

  const nextOrderIndex = chapters.length === 0
    ? 1
    : Math.max(...chapters.map(ch => ch.order_index)) + 1;

  const handleGenerateCover = async () => {
    if (!deepseekKey) {
      setCoverError('请先在设置页面配置 DeepSeek API 密钥');
      return;
    }

    setCoverError(null);
    setCoverGenerating(true);

    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      const baseText = `书名: ${currentProject.title}\n题材: ${currentProject.genre || '未分类'}\n简介: ${currentProject.description || '暂无简介'}`;

      const coverPromptText = `封面设计：参考以下大纲。\n${baseText}`;
      const prompt = await invoke<string>('generate_illustration_prompt', {
        text: coverPromptText,
        style: coverConfig.style?.trim() || null,
        deepseekKey: deepseekKey,
      });

      const imageBase64 = await invoke<string>('generate_promo_image', {
        prompt: prompt,
        width: coverConfig.width,
        height: coverConfig.height,
        model: coverConfig.model,
        pollinationsKey: pollinationsKey || null,
      });

      const newCover: CoverImageItem = {
        id: createCoverId(),
        name: `封面 ${coverImages.length + 1}`,
        imageBase64,
        prompt,
        createdAt: new Date().toISOString(),
        config: {
          model: coverConfig.model,
          style: coverConfig.style,
          width: coverConfig.width,
          height: coverConfig.height,
        },
      };

      const nextCovers = [...coverImages, newCover];
      const nextDefaultId = defaultCoverId ?? newCover.id;
      setCoverImages(nextCovers);
      setCoverIndex(nextCovers.length - 1);
      setDefaultCoverId(nextDefaultId);
      await persistCoverState(nextCovers, nextDefaultId);
    } catch (error) {
      const message = typeof error === 'string' ? error : (error as Error)?.message || '生成封面失败';
      setCoverError(message);
    } finally {
      setCoverGenerating(false);
    }
  };

  const handleSetDefaultCover = async () => {
    const currentCover = coverImages[coverIndex];
    if (!currentCover) return;
    const nextDefaultId = currentCover.id;
    setDefaultCoverId(nextDefaultId);
    await persistCoverState(coverImages, nextDefaultId);
  };

  const handleRenameCover = async () => {
    const currentCover = coverImages[coverIndex];
    if (!currentCover) return;
    const nextName = prompt('请输入新的封面名称', currentCover.name);
    if (!nextName) return;
    const trimmed = nextName.trim();
    if (!trimmed) return;
    const nextCovers = coverImages.map((cover, idx) =>
      idx === coverIndex ? { ...cover, name: trimmed } : cover
    );
    setCoverImages(nextCovers);
    await persistCoverState(nextCovers, defaultCoverId);
  };

  const handleDeleteCover = async () => {
    const currentCover = coverImages[coverIndex];
    if (!currentCover) return;
    const confirmed = await confirmDialog('确定删除该封面吗？', '删除封面');
    if (!confirmed) return;
    const nextCovers = coverImages.filter((_, idx) => idx !== coverIndex);
    let nextDefaultId = defaultCoverId;
    if (currentCover.id === defaultCoverId) {
      nextDefaultId = nextCovers.length > 0 ? nextCovers[0].id : null;
    }
    const nextIndex = Math.min(coverIndex, Math.max(0, nextCovers.length - 1));
    setCoverImages(nextCovers);
    setCoverIndex(nextIndex);
    setDefaultCoverId(nextDefaultId);
    await persistCoverState(nextCovers, nextDefaultId);
  };

  const currentCover = coverImages[coverIndex];
  const isDefaultCover = currentCover && currentCover.id === defaultCoverId;

  return (
    <div className="w-full max-w-full xl:max-w-7xl mx-auto">
      <div className="mb-6">
        <Button variant="ghost" onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回
        </Button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 md:p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-2 truncate">
              {currentProject.title}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-gray-400 mb-4">
              {currentProject.author && <span>作者: {currentProject.author}</span>}
              {currentProject.genre && <span>题材: {currentProject.genre}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 flex-shrink-0">
            <Button variant="outline" onClick={() => navigate(`/project/${id}/outline`)} className="whitespace-nowrap">
              <Sparkles className="w-4 h-4 mr-2" />
              AI生成大纲&编辑
            </Button>
            <Button variant="outline" onClick={() => setShowCoverModal(true)} className="whitespace-nowrap">
              <Image className="w-4 h-4 mr-2" />
              封面
            </Button>
            <Button variant="outline" onClick={() => navigate(`/project/${id}/characters`)} className="whitespace-nowrap">
              <Users className="w-4 h-4 mr-2" />
              角色
            </Button>
            <Button variant="outline" onClick={() => setShowEditModal(true)} className="whitespace-nowrap">
              <Edit className="w-4 h-4 mr-2" />
              编辑
            </Button>
          </div>
        </div>

        {/* 大纲预览区域 - 可折叠 */}
        {currentProject.description && (
          <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
            <button
              onClick={() => setOutlineExpanded(!outlineExpanded)}
              className="flex items-center justify-between w-full text-left"
            >
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                大纲预览
              </span>
              {outlineExpanded ? (
                <ChevronUp className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              )}
            </button>
            
            {outlineExpanded ? (
              <div className="mt-3 prose prose-sm dark:prose-invert max-w-none max-h-96 overflow-y-auto">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {currentProject.description}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                {currentProject.description.replace(/#{1,6}\s+/g, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/[-*]\s+/g, '').substring(0, 150)}...
              </p>
            )}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">章节列表</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={handleGeneratePrologue}
              loading={isGeneratingPrologue}
              className="whitespace-nowrap"
            >
              <Sparkles className="w-4 h-4 mr-1 md:mr-2" />
              序章生成
            </Button>
            <Button onClick={() => setShowCreateChapterModal(true)} className="whitespace-nowrap">
              <Plus className="w-4 h-4 mr-1 md:mr-2" />
              新建
            </Button>
          </div>
        </div>

        {chapters.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            还没有章节，点击上方按钮开始创作
          </div>
        ) : (
          <div className="space-y-2">
            {chapters.map((chapter) => (
              <ChapterItem
                key={chapter.id}
                chapter={chapter}
                onClick={() => navigate(`/editor/${id}/${chapter.id}`)}
                onDelete={() => handleDeleteChapter(chapter.id)}
              />
            ))}
          </div>
        )}
      </div>

      {showEditModal && (
        <EditProjectModal
          project={currentProject}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            setShowEditModal(false);
            if (id) loadProject(id);
          }}
        />
      )}

      {showOutlineModal && (
        <GenerateOutlineModal
          onClose={() => setShowOutlineModal(false)}
          onSuccess={() => {
            setShowOutlineModal(false);
            if (id) loadChapters(id);
          }}
        />
      )}

      {showCreateChapterModal && (
        <CreateChapterModal
          projectId={id!}
          nextOrderIndex={nextOrderIndex}
          onClose={() => setShowCreateChapterModal(false)}
          onSuccess={() => {
            setShowCreateChapterModal(false);
            if (id) loadChapters(id);
          }}
        />
      )}

      {showCoverModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-4">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">生成封面</h2>

            <div className="relative bg-gray-100 dark:bg-gray-900 rounded-lg overflow-hidden">
              {coverImages.length > 0 ? (
                <>
                  <img
                    src={currentCover?.imageBase64}
                    alt="封面预览"
                    className="w-full rounded-lg object-contain max-h-[45vh]"
                  />
                  <button
                    onClick={() => setCoverIndex(prev => Math.max(0, prev - 1))}
                    disabled={coverIndex === 0}
                    className="absolute inset-y-0 left-0 px-3 flex items-center text-white/80 hover:text-white disabled:opacity-30"
                    title="上一张"
                  >
                    <ChevronLeft className="w-8 h-8" />
                  </button>
                  <button
                    onClick={() => setCoverIndex(prev => Math.min(coverImages.length - 1, prev + 1))}
                    disabled={coverIndex >= coverImages.length - 1}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-white/80 hover:text-white disabled:opacity-30"
                    title="下一张"
                  >
                    <ChevronRight className="w-8 h-8" />
                  </button>
                  <div className="absolute bottom-2 right-3 text-xs text-white/80">
                    {coverIndex + 1} / {coverImages.length}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
                  暂无封面，点击下方按钮生成
                </div>
              )}
            </div>

            {coverImages.length > 0 && (
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                提示：可用键盘左右键翻页
              </div>
            )}

            {currentCover && (
              <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  当前封面：
                  <span className="font-medium text-gray-900 dark:text-white ml-1">
                    {currentCover.name}
                  </span>
                  {isDefaultCover && (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                      默认
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSetDefaultCover}
                    disabled={isDefaultCover}
                  >
                    设为默认
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleRenameCover}>
                    重命名
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDeleteCover}
                    className="text-red-600 hover:text-red-700"
                  >
                    删除
                  </Button>
                </div>
              </div>
            )}

            {currentCover?.prompt && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  提示词
                </label>
                <textarea
                  value={currentCover.prompt}
                  readOnly
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-24 resize-none"
                />
              </div>
            )}

            {coverError && (
              <div className="mt-3 text-sm text-red-500">{coverError}</div>
            )}

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  图片生成模型
                </label>
                <input
                  type="text"
                  value={coverConfig.model}
                  onChange={e => setCoverConfig(prev => ({ ...prev, model: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                  placeholder="zimage"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  图片风格
                </label>
                <input
                  type="text"
                  list="cover-style-options"
                  value={coverConfig.style}
                  onChange={e => setCoverConfig(prev => ({ ...prev, style: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                  placeholder="选择或输入风格（支持中文，会自动翻译）"
                />
                <datalist id="cover-style-options">
                  <option value="cinematic" />
                  <option value="watercolor" />
                  <option value="anime" />
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  宽度
                </label>
                <input
                  type="number"
                  value={coverConfig.width}
                  onChange={e => setCoverConfig(prev => ({
                    ...prev,
                    width: parseInt(e.target.value, 10) || prev.width,
                  }))}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                  min={64}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  高度
                </label>
                <input
                  type="number"
                  value={coverConfig.height}
                  onChange={e => setCoverConfig(prev => ({
                    ...prev,
                    height: parseInt(e.target.value, 10) || prev.height,
                  }))}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                  min={64}
                />
              </div>
            </div>

            <div className="flex space-x-3 pt-6">
              <Button type="button" variant="outline" onClick={() => setShowCoverModal(false)} className="flex-1">
                关闭
              </Button>
              <Button onClick={handleGenerateCover} loading={coverGenerating} className="flex-1">
                生成封面
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface ChapterItemProps {
  chapter: Chapter;
  onClick: () => void;
  onDelete: () => void;
}

// 去除 Markdown 标记，提取纯文本
function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '') // 移除标题标记
    .replace(/\*\*(.+?)\*\*/g, '$1') // 移除加粗
    .replace(/\*(.+?)\*/g, '$1') // 移除斜体
    .replace(/^[-*+]\s+/gm, '') // 移除列表标记
    .replace(/^>\s+/gm, '') // 移除引用标记
    .replace(/`(.+?)`/g, '$1') // 移除行内代码
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // 移除链接
    .trim();
}

function ChapterItem({ chapter, onClick, onDelete }: ChapterItemProps) {
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  // 处理章节目标的预览文字
  const isPrologue = chapter.title.trim() === '序章' || chapter.order_index === 0;
  const displayTitle = isPrologue ? '序章' : `第${chapter.order_index}章 - ${chapter.title}`;
  const goalPreview = chapter.outline_goal ? stripMarkdown(chapter.outline_goal) : '';
  const previewText = isPrologue ? (chapter.final_text || chapter.draft_text || '') : goalPreview;

  return (
    <div
      onClick={onClick}
      className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors group"
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0 mr-4">
          <h3 className="font-medium text-gray-900 dark:text-white text-transparent">
            <span className="text-gray-900 dark:text-white">{displayTitle}</span>
            第{chapter.order_index}章 - {chapter.title}
          </h3>
          {(isPrologue || goalPreview) && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 truncate">
              {previewText || '待生成'}
            </p>
          )}
        </div>
        <div className="flex items-center space-x-2 flex-shrink-0">
          {/* 固定宽度的字数统计 */}
          <span className="w-20 text-right text-sm text-gray-600 dark:text-gray-400">
            {chapter.word_count}字
          </span>
          {/* 固定宽度的状态标签 */}
          <span
            className={`w-16 text-center px-2 py-1 rounded-full text-xs font-medium ${
              chapter.status === 'final'
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                : chapter.status === 'review'
                ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
            }`}
          >
            {chapter.status === 'final' ? '完成' : chapter.status === 'review' ? '待审核' : '草稿'}
          </span>
          {/* 删除按钮 */}
          <button
            onClick={handleDelete}
            className="p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"
            title="删除章节"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// 编辑项目模态框
interface EditProjectModalProps {
  project: Project;
  onClose: () => void;
  onSuccess: () => void;
}

function EditProjectModal({ project, onClose, onSuccess }: EditProjectModalProps) {
  const [title, setTitle] = useState(project.title);
  const [author, setAuthor] = useState(project.author || '');
  const [genre, setGenre] = useState(project.genre || '');
  const [description, setDescription] = useState(project.description || '');
  const [targetWordCount, setTargetWordCount] = useState(project.target_word_count?.toString() || '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await projectApi.update(project.id, {
        title,
        author: author || undefined,
        genre: genre || undefined,
        description: description || undefined,
        target_word_count: targetWordCount ? parseInt(targetWordCount) : undefined,
        cover_images: project.cover_images ?? null,
        default_cover_id: project.default_cover_id ?? null,
      });
      onSuccess();
    } catch (error) {
      console.error('Failed to update project:', error);
      alert('更新项目失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">编辑项目</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              书名 *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              作者笔名
            </label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              题材
            </label>
            <input
              type="text"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              简介
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-24 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              目标字数
            </label>
            <input
              type="number"
              value={targetWordCount}
              onChange={(e) => setTargetWordCount(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            />
          </div>

          <div className="flex space-x-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              取消
            </Button>
            <Button type="submit" loading={loading} className="flex-1">
              保存
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// AI生成大纲模态框
interface GenerateOutlineModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function GenerateOutlineModal({ onClose, onSuccess }: GenerateOutlineModalProps) {
  const { currentProject, deepseekKey } = useAppStore();
  const [chapterCount, setChapterCount] = useState('20');
  const [requirements, setRequirements] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    // 检查API密钥
    if (!deepseekKey) {
      alert('请先在设置页面配置 DeepSeek API 密钥');
      return;
    }

    // 检查项目信息
    if (!currentProject) {
      alert('未找到项目信息');
      return;
    }

    setLoading(true);
    try {
      // 调用Tauri命令生成大纲
      const { invoke } = await import('@tauri-apps/api/tauri');
      const result = await invoke('generate_outline', {
        input: {
          title: currentProject.title,
          genre: currentProject.genre || '未分类',
          description: currentProject.description || '暂无简介',
          target_chapters: parseInt(chapterCount),
          deepseek_key: deepseekKey,
        }
      });
      console.log('大纲生成成功:', result);
      alert('大纲生成成功！');
      onSuccess();
    } catch (error) {
      console.error('Failed to generate outline:', error);
      const errorMessage = typeof error === 'string' ? error : (error as Error)?.message || '未知错误';
      alert('生成大纲失败: ' + errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">AI生成大纲</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              章节数量
            </label>
            <input
              type="number"
              value={chapterCount}
              onChange={(e) => setChapterCount(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              min="1"
              max="100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              额外需求（可选）
            </label>
            <textarea
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-24 resize-none"
              placeholder="例如：主角需要经历三次转折，包含爱情线等..."
            />
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <p className="text-sm text-blue-800 dark:text-blue-300">
              💡 AI将基于项目信息和你的需求生成章节大纲，生成后可以手动调整
            </p>
          </div>

          <div className="flex space-x-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              取消
            </Button>
            <Button onClick={handleGenerate} loading={loading} className="flex-1">
              生成大纲
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 新建章节模态框
interface CreateChapterModalProps {
  projectId: string;
  nextOrderIndex: number;
  onClose: () => void;
  onSuccess: () => void;
}

function CreateChapterModal({ projectId, nextOrderIndex, onClose, onSuccess }: CreateChapterModalProps) {
  const [title, setTitle] = useState('');
  const [outlineGoal, setOutlineGoal] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await chapterApi.create({
        project_id: projectId,
        title,
        order_index: nextOrderIndex,
        outline_goal: outlineGoal || undefined,
      });
      onSuccess();
    } catch (error) {
      console.error('Failed to create chapter:', error);
      alert('创建章节失败: ' + ((error as Error)?.message || '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">新建章节</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              章节标题 *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              placeholder="例如：初入江湖"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              剧情目标（可选）
            </label>
            <textarea
              value={outlineGoal}
              onChange={(e) => setOutlineGoal(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-24 resize-none"
              placeholder="描述这一章的主要剧情和目标..."
            />
          </div>

          <div className="flex space-x-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              取消
            </Button>
            <Button type="submit" loading={loading} className="flex-1">
              创建
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

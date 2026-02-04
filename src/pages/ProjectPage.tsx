import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppStore } from '@store/index';
import { projectApi, chapterApi } from '@services/api';
import { Button } from '@components/Button';
import { ArrowLeft, Plus, Edit, Sparkles, Users, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Chapter, Project } from '@typings/index';

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentProject, setCurrentProject, chapters, setChapters } = useAppStore();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showOutlineModal, setShowOutlineModal] = useState(false);
  const [showCreateChapterModal, setShowCreateChapterModal] = useState(false);
  const [outlineExpanded, setOutlineExpanded] = useState(false);

  useEffect(() => {
    if (id) {
      loadProject(id);
      loadChapters(id);
      // 重新计算并更新项目字数
      recalculateWordCount(id);
    }
  }, [id]);

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
      setChapters(data);
    } catch (error) {
      console.error('Failed to load chapters:', error);
    }
  };

  const handleDeleteChapter = async (chapterId: string) => {
    if (!confirm('确定要删除这个章节吗？删除后无法恢复！')) {
      return;
    }
    try {
      await chapterApi.delete(chapterId);
      if (id) loadChapters(id);
    } catch (error) {
      console.error('Failed to delete chapter:', error);
      alert('删除章节失败');
    }
  };

  if (!currentProject) {
    return <div>加载中...</div>;
  }

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
            <Button variant="outline" onClick={() => navigate(`/project/${id}/outline`)} className="whitespace-nowrap">
              <Sparkles className="w-4 h-4 mr-1 md:mr-2" />
              <span className="hidden sm:inline">AI</span>大纲
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
          existingChaptersCount={chapters.length}
          onClose={() => setShowCreateChapterModal(false)}
          onSuccess={() => {
            setShowCreateChapterModal(false);
            if (id) loadChapters(id);
          }}
        />
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
  const goalPreview = chapter.outline_goal ? stripMarkdown(chapter.outline_goal) : '';

  return (
    <div
      onClick={onClick}
      className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors group"
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0 mr-4">
          <h3 className="font-medium text-gray-900 dark:text-white">
            第{chapter.order_index}章 - {chapter.title}
          </h3>
          {goalPreview && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 truncate">
              {goalPreview}
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
  existingChaptersCount: number;
  onClose: () => void;
  onSuccess: () => void;
}

function CreateChapterModal({ projectId, existingChaptersCount, onClose, onSuccess }: CreateChapterModalProps) {
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
        order_index: existingChaptersCount + 1,
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

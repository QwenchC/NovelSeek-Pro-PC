import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppStore } from '@store/index';
import { chapterApi } from '@services/api';
import { Button } from '@components/Button';
import { ArrowLeft, Save, Sparkles, StopCircle, Check, FileText, ChevronRight, RefreshCw, Image, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import type { Chapter } from '@typings/index';

// 单次生成的目标字数（控制在2500字左右避免中断）
const TARGET_WORDS_PER_GENERATION = 2500;

// 推文生成结果类型
interface PromoResult {
  imagePrompt: string;
  summary: string;
  imageBase64: string | null;
}

// 去除 Markdown 符号
function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s*/g, '')        // 移除标题符号
    .replace(/\*\*([^*]+)\*\*/g, '$1') // 移除加粗
    .replace(/\*([^*]+)\*/g, '$1')     // 移除斜体
    .replace(/`([^`]+)`/g, '$1')       // 移除行内代码
    .replace(/^[-*+]\s+/gm, '')        // 移除列表符号
    .replace(/^\d+\.\s+/gm, '')        // 移除有序列表
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 移除链接
    .replace(/>\s*/g, '')              // 移除引用符号
    .trim();
}

export function EditorPage() {
  const { projectId, chapterId } = useParams();
  const navigate = useNavigate();
  const { deepseekKey, pollinationsKey, getCharacters, getWorldSetting, getTimeline, getPromo, setPromo } = useAppStore();
  
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [allChapters, setAllChapters] = useState<Chapter[]>([]);
  const [content, setContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wordCount, setWordCount] = useState(0);
  
  // 推文相关状态
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);
  const [isPromoExpanded, setIsPromoExpanded] = useState(false);
  const [isGeneratingPromo, setIsGeneratingPromo] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (chapterId && projectId) {
      loadChapterData();
    }
  }, [chapterId, projectId]);

  // 加载已保存的推文数据
  useEffect(() => {
    if (chapterId) {
      const savedPromo = getPromo(chapterId);
      if (savedPromo) {
        setPromoResult(savedPromo);
      }
    }
  }, [chapterId, getPromo]);

  useEffect(() => {
    // 计算字数（排除空格）
    const count = content.replace(/\s/g, '').length;
    setWordCount(count);
  }, [content]);

  const loadChapterData = async () => {
    try {
      const chapters = await chapterApi.getByProject(projectId!);
      setAllChapters(chapters);
      const found = chapters.find(c => c.id === chapterId);
      if (found) {
        setChapter(found);
        setContent(found.draft_text || found.final_text || '');
        setIsSaved(true);
      }
    } catch (error) {
      console.error('Failed to load chapter:', error);
      setError('加载章节失败');
    }
  };

  // 获取前一章的内容摘要用于上下文连贯
  const getPreviousChapterSummary = (): string | null => {
    if (!chapter || !allChapters.length) return null;
    
    const prevChapter = allChapters.find(c => c.order_index === chapter.order_index - 1);
    if (!prevChapter) return null;
    
    const prevContent = prevChapter.draft_text || prevChapter.final_text;
    if (!prevContent) return null;
    
    // 取前一章最后1500字作为上下文
    const lastPart = prevContent.slice(-1500);
    return `【前一章结尾】\n${lastPart}`;
  };

  // 获取当前内容的结尾部分用于续写
  const getCurrentContentTail = (): string => {
    if (!content) return '';
    // 取最后800字作为续写上下文
    return content.slice(-800);
  };

  const handleSave = async () => {
    if (!chapterId || !content) return;
    
    setIsSaving(true);
    try {
      await chapterApi.update(chapterId, content, undefined);
      setIsSaved(true);
    } catch (error) {
      console.error('Failed to save:', error);
      setError('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    setIsSaved(false);
  };

  // 生成新内容（从头或续写）
  const handleGenerate = async (mode: 'new' | 'continue' = 'new') => {
    if (!deepseekKey) {
      setError('请先在设置页面配置 DeepSeek API 密钥');
      return;
    }

    if (!chapter) {
      setError('章节信息未加载');
      return;
    }

    setError(null);
    setIsGenerating(true);
    
    // 续写模式：在现有内容后追加
    if (mode === 'new') {
      setContent('');
    }

    try {
      const unlisten = await listen<string>('chapter-stream', (event) => {
        setContent(prev => prev + event.payload);
      });

      // 获取上下文信息
      const previousSummary = getPreviousChapterSummary();
      const currentTail = mode === 'continue' ? getCurrentContentTail() : null;

      // 获取角色信息，确保AI生成时保持角色一致性
      const characters = projectId ? getCharacters(projectId) : [];
      const charactersInfo = characters.length > 0 
        ? characters.map((c, i) => {
            const isProtag = c.isProtagonist ? '【主角】' : '';
            return `${i + 1}. ${c.name}${isProtag}\n   - 身份：${c.role || '未设定'}\n   - 性格：${c.personality || '未设定'}\n   - 背景：${c.background || '未设定'}\n   - 动机：${c.motivation || '未设定'}`;
          }).join('\n')
        : null;

      // 获取世界观设定和时间线，防止章节之间冲突
      const worldSetting = projectId ? getWorldSetting(projectId) : '';
      const timeline = projectId ? getTimeline(projectId) : '';

      await invoke<string>('generate_chapter_stream', {
        chapterTitle: chapter.title,
        outlineGoal: chapter.outline_goal || '推进剧情发展',
        conflict: chapter.conflict || '角色面临挑战',
        previousSummary: previousSummary,
        currentContent: currentTail,
        charactersInfo: charactersInfo,
        worldSetting: worldSetting || null,
        timeline: timeline || null,
        targetWords: TARGET_WORDS_PER_GENERATION,
        isContinuation: mode === 'continue',
        deepseekKey: deepseekKey,
      });

      unlisten();
      setIsSaved(false);
    } catch (err) {
      const errorMessage = typeof err === 'string' ? err : (err as Error)?.message || '生成失败';
      if (!errorMessage.includes('cancelled') && !errorMessage.includes('中断')) {
        setError(errorMessage);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStop = async () => {
    try {
      await invoke('cancel_generation');
    } catch (err) {
      console.error('Failed to cancel:', err);
    }
    setIsGenerating(false);
  };

  // 生成章节推文（封面+摘要）
  const handleGeneratePromo = async () => {
    if (!content || content.trim().length < 100) {
      setPromoError('章节内容太少，请先生成或编写更多内容（至少100字）');
      return;
    }

    if (!deepseekKey) {
      setPromoError('请先在设置中配置DeepSeek API Key');
      return;
    }

    setIsGeneratingPromo(true);
    setPromoError(null);

    try {
      // 第一步：生成摘要和图片提示词
      const promoData = await invoke<{ image_prompt: string; summary: string }>('generate_chapter_promo', {
        chapterTitle: chapter?.title || '未命名章节',
        chapterContent: content,
        deepseekKey: deepseekKey,
      });

      // 第二步：生成图片（3:1比例，1200x400）
      const imageBase64 = await invoke<string>('generate_promo_image', {
        prompt: promoData.image_prompt,
        width: 1200,
        height: 400,
        pollinationsKey: pollinationsKey || null,
      });

      const newPromoResult = {
        imagePrompt: promoData.image_prompt,
        summary: promoData.summary,
        imageBase64: imageBase64,
      };
      
      setPromoResult(newPromoResult);
      setIsPromoExpanded(true); // 生成成功后自动展开
      
      // 保存到store（持久化）
      if (chapterId) {
        setPromo(chapterId, newPromoResult);
      }
    } catch (err) {
      const errorMessage = typeof err === 'string' ? err : (err as Error)?.message || '推文生成失败';
      setPromoError(errorMessage);
    } finally {
      setIsGeneratingPromo(false);
    }
  };

  // 快捷键支持
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [content, chapterId]);

  return (
    <div className="h-full flex flex-col">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-200 dark:border-gray-700 flex-wrap gap-2">
        <div className="flex items-center space-x-4 min-w-0 flex-shrink">
          <Button variant="ghost" onClick={() => navigate(`/project/${projectId}`)} className="whitespace-nowrap flex-shrink-0">
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回
          </Button>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white truncate">
              {chapter ? `第${chapter.order_index}章 - ${chapter.title}` : '章节编辑器'}
            </h2>
            {chapter?.outline_goal && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 truncate max-w-md" title={chapter.outline_goal}>
                {stripMarkdown(chapter.outline_goal).replace(/^目标[：:]\s*/i, '目标：')}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-3 flex-shrink-0">
          {/* 字数统计 */}
          <div className="flex items-center text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
            <FileText className="w-4 h-4 mr-1" />
            <span>{wordCount}字</span>
          </div>
          
          {/* 保存状态 */}
          {isSaved ? (
            <span className="flex items-center text-green-600 dark:text-green-400 text-sm whitespace-nowrap">
              <Check className="w-4 h-4 mr-1" />
              已保存
            </span>
          ) : (
            <span className="text-orange-500 text-sm whitespace-nowrap">未保存</span>
          )}
          
          {/* 操作按钮 */}
          <div className="flex space-x-2 flex-shrink-0">
            {isGenerating ? (
              <Button onClick={handleStop} variant="outline" className="bg-red-50 border-red-300 text-red-600 hover:bg-red-100 whitespace-nowrap">
                <StopCircle className="w-4 h-4 mr-1" />
                停止
              </Button>
            ) : (
              <>
                {/* 如果没有内容，显示"AI生成"；如果有内容，显示"AI续写" */}
                {content ? (
                  <Button variant="outline" onClick={() => handleGenerate('continue')} className="whitespace-nowrap">
                    <ChevronRight className="w-4 h-4 mr-1" />
                    续写
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => handleGenerate('new')} className="whitespace-nowrap">
                    <Sparkles className="w-4 h-4 mr-1" />
                    生成
                  </Button>
                )}
                {/* 生成推文按钮 */}
                <Button 
                  variant="outline" 
                  onClick={handleGeneratePromo} 
                  disabled={isGeneratingPromo || !content || content.trim().length < 100}
                  className="whitespace-nowrap"
                  title={!content || content.trim().length < 100 ? '需要至少100字内容' : '生成章节封面和摘要'}
                >
                  {isGeneratingPromo ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Image className="w-4 h-4 mr-1" />
                  )}
                  推文
                </Button>
              </>
            )}
            <Button onClick={handleSave} loading={isSaving} disabled={isSaved} className="whitespace-nowrap">
              <Save className="w-4 h-4 mr-1" />
              保存
            </Button>
          </div>
        </div>
      </div>

      {/* 推文展示区域（封面+摘要） */}
      {(promoResult || promoError) && (
        <div className="mb-4 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          {/* 折叠/展开标题栏 */}
          <button
            onClick={() => setIsPromoExpanded(!isPromoExpanded)}
            className="w-full flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <div className="flex items-center space-x-2">
              <Image className="w-4 h-4 text-primary-600 dark:text-primary-400" />
              <span className="font-medium text-gray-700 dark:text-gray-300">章节推文</span>
              {promoResult && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  （封面 + 摘要）
                </span>
              )}
            </div>
            {isPromoExpanded ? (
              <ChevronUp className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-500" />
            )}
          </button>

          {/* 展开的内容 */}
          {isPromoExpanded && (
            <div className="p-4 bg-white dark:bg-gray-900">
              {promoError && (
                <div className="text-red-500 text-sm mb-3">
                  {promoError}
                  <button 
                    onClick={() => setPromoError(null)} 
                    className="ml-2 underline"
                  >
                    关闭
                  </button>
                </div>
              )}
              
              {promoResult && (
                <div className="space-y-4">
                  {/* 封面图片 */}
                  {promoResult.imageBase64 && (
                    <div className="relative">
                      <img 
                        src={promoResult.imageBase64} 
                        alt="章节封面" 
                        className="w-full rounded-lg shadow-md"
                        style={{ aspectRatio: '3/1', objectFit: 'cover' }}
                      />
                    </div>
                  )}
                  
                  {/* 摘要 */}
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                      摘要：
                    </div>
                    <p className="text-gray-800 dark:text-gray-200 leading-relaxed">
                      {promoResult.summary}
                    </p>
                  </div>

                  {/* 重新生成按钮 */}
                  <div className="flex justify-end">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={handleGeneratePromo}
                      disabled={isGeneratingPromo}
                    >
                      {isGeneratingPromo ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3 mr-1" />
                      )}
                      重新生成
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
          <p className="text-red-600 dark:text-red-400">{error}</p>
          <button 
            onClick={() => setError(null)} 
            className="text-sm text-red-500 underline mt-1"
          >
            关闭
          </button>
        </div>
      )}

      {/* 生成状态指示器 */}
      {isGenerating && (
        <div className="flex items-center mb-4 text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 p-3 rounded-lg">
          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
          <span>AI正在生成内容...</span>
        </div>
      )}

      {/* 编辑区域 */}
      <div className="flex-1 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleContentChange}
          className="w-full h-full resize-none border-none focus:outline-none dark:bg-gray-800 dark:text-white p-6 font-serif text-lg leading-relaxed"
          placeholder="在这里开始写作...

提示：
- 使用 Ctrl+S 快速保存
- 点击「AI续写」让AI继续创作
- 可以随时编辑AI生成的内容"
          disabled={isGenerating}
        />
      </div>
    </div>
  );
}

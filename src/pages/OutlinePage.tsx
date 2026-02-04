import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppStore, Character } from '@store/index';
import { projectApi } from '@services/api';
import { Button } from '@components/Button';
import { ArrowLeft, Sparkles, StopCircle, Save, RefreshCw, Check } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function OutlinePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { 
    currentProject, setCurrentProject, deepseekKey, 
    getCharacters, setCharacters,
    setWorldSetting, setTimeline 
  } = useAppStore();
  
  const [outline, setOutline] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [chapterCount, setChapterCount] = useState(20);
  const [requirements, setRequirements] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (id) {
      loadProject(id);
    }
  }, [id]);

  // 自动滚动到底部
  useEffect(() => {
    if (contentRef.current && isGenerating) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [outline, isGenerating]);

  const loadProject = async (projectId: string) => {
    try {
      const project = await projectApi.getById(projectId);
      setCurrentProject(project);
      // 如果项目已有大纲，加载它
      if (project?.description && project.description.includes('## 故事梗概')) {
        setOutline(project.description);
        setIsSaved(true);
      }
    } catch (error) {
      console.error('Failed to load project:', error);
    }
  };

  const handleGenerate = async () => {
    if (!deepseekKey) {
      setError('请先在设置页面配置 DeepSeek API 密钥');
      return;
    }

    if (!currentProject) {
      setError('项目信息未加载');
      return;
    }

    setError(null);
    setIsGenerating(true);
    setOutline('');
    setIsSaved(false);

    // 获取用户已设定的角色信息
    const existingCharacters = id ? getCharacters(id) : [];
    let charactersPrompt = '';
    if (existingCharacters.length > 0) {
      charactersPrompt = '\n\n【用户预设的角色】请在生成大纲时使用这些角色：\n';
      existingCharacters.forEach((char, idx) => {
        const isProtag = char.isProtagonist ? '（主角）' : '';
        charactersPrompt += `${idx + 1}. ${char.name}${isProtag}`;
        if (char.role) charactersPrompt += `，身份：${char.role}`;
        if (char.personality) charactersPrompt += `，性格：${char.personality}`;
        if (char.background) charactersPrompt += `，背景：${char.background}`;
        if (char.motivation) charactersPrompt += `，动机：${char.motivation}`;
        charactersPrompt += '\n';
      });
    }

    try {
      // 设置事件监听器接收流式内容
      const unlisten = await listen<string>('outline-stream', (event) => {
        setOutline(prev => prev + event.payload);
      });

      // 合并额外要求和角色信息
      const fullRequirements = (requirements || '') + charactersPrompt;

      // 调用后端生成大纲
      const result = await invoke<string>('generate_outline_stream', {
        input: {
          title: currentProject.title,
          genre: currentProject.genre || '未分类',
          description: currentProject.description || '暂无简介',
          target_chapters: chapterCount,
          deepseek_key: deepseekKey,
          requirements: fullRequirements || undefined,
        }
      });

      // 如果没有流式返回，使用完整结果
      if (!outline && result) {
        setOutline(result);
      }

      unlisten();
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

  const handleSave = async () => {
    if (!currentProject || !outline) return;

    try {
      // 保存大纲到项目描述字段（或专门的大纲字段）
      await projectApi.update(currentProject.id, {
        title: currentProject.title,
        author: currentProject.author,
        genre: currentProject.genre,
        description: outline, // 暂时保存到description
        target_word_count: currentProject.target_word_count,
      });
      
      // 更新本地状态，触发角色管理页面刷新
      setCurrentProject({
        ...currentProject,
        description: outline,
      });
      
      // 从新大纲解析角色并更新 store
      if (id) {
        console.log('OutlinePage handleSave: 开始解析并保存角色到 store, projectId=', id);
        const parsedCharacters = parseCharactersFromOutline(outline);
        console.log('OutlinePage handleSave: 解析到角色数量:', parsedCharacters.length);
        if (parsedCharacters.length > 0) {
          setCharacters(id, parsedCharacters);
          console.log('OutlinePage handleSave: 已调用 setCharacters 保存到 store');
        } else {
          console.log('OutlinePage handleSave: 未解析到角色，检查大纲格式');
        }
        
        // 解析并保存世界观设定
        const worldSetting = parseWorldSettingFromOutline(outline);
        if (worldSetting) {
          setWorldSetting(id, worldSetting);
          console.log('OutlinePage handleSave: 已保存世界观设定');
        }
        
        // 解析并保存时间线事件
        const timeline = parseTimelineFromOutline(outline);
        if (timeline) {
          setTimeline(id, timeline);
          console.log('OutlinePage handleSave: 已保存时间线事件');
        }
      }
      
      setIsSaved(true);
      
      // 解析大纲并创建章节
      const chaptersCreated = await parseAndCreateChapters(outline);
      if (chaptersCreated > 0) {
        alert(`大纲已保存，成功创建 ${chaptersCreated} 个章节！`);
      } else {
        alert('大纲已保存！');
      }
    } catch (err) {
      setError('保存失败: ' + ((err as Error)?.message || '未知错误'));
    }
  };

  // 从大纲解析角色信息
  const parseCharactersFromOutline = (outlineText: string): Character[] => {
    console.log('=== 开始解析角色 ===');
    console.log('大纲内容长度:', outlineText.length);
    
    // 匹配 "## 主要角色" 部分（支持中英文标题）
    const characterSection = outlineText.match(/##\s*主要角色[\s\S]*?(?=\n##\s|$)/i);
    if (!characterSection) {
      console.log('未找到主要角色部分');
      return [];
    }
    
    console.log('找到角色部分:', characterSection[0].substring(0, 200));

    const parsed: Character[] = [];
    // 按 ### 分割角色块
    const blocks = characterSection[0].split(/\n###\s+/).filter(block => block.trim() && !block.includes('主要角色'));
    
    console.log('角色块数量:', blocks.length);
    
    blocks.forEach((block, index) => {
      const lines = block.trim().split('\n');
      let nameLine = lines[0]?.trim() || '';
      if (!nameLine) return;

      // 清理名字：移除序号、星号等
      let name = nameLine
        .replace(/^[\d\.\s]+/, '')     // 移除开头的数字和点
        .replace(/\*\*/g, '')          // 移除 Markdown 加粗符号
        .replace(/^\s*[-*]\s*/, '')    // 移除列表符号
        .trim();
      
      console.log(`解析角色 ${index + 1}: 原始="${nameLine}", 清理后="${name}"`);
      
      if (!name) return;

      const char: Character = {
        id: `char-${Date.now()}-${index}`,
        name: name,
        role: '',
        personality: '',
        background: '',
        motivation: '',
        isProtagonist: index === 0,
      };

      lines.forEach(line => {
        const lowerLine = line.toLowerCase();
        // 提取值：支持 "- **身份**：xxx" 和 "身份：xxx" 两种格式
        const valueMatch = line.match(/[：:]\s*(.+)$/);
        const value = valueMatch ? valueMatch[1].replace(/\*\*/g, '').trim() : '';
        
        if (lowerLine.includes('身份')) {
          char.role = value;
        } else if (lowerLine.includes('性格')) {
          char.personality = value;
        } else if (lowerLine.includes('背景')) {
          char.background = value;
        } else if (lowerLine.includes('动机')) {
          char.motivation = value;
        }
      });

      if (char.name) {
        parsed.push(char);
        console.log('成功解析角色:', char);
      }
    });

    console.log('总共解析角色数:', parsed.length);
    return parsed;
  };

  // 从大纲解析世界观设定
  const parseWorldSettingFromOutline = (outlineText: string): string => {
    // 匹配 "## 世界观设定" 部分
    const worldSection = outlineText.match(/##\s*世界观设定[\s\S]*?(?=\n##\s|$)/i);
    if (!worldSection) {
      console.log('未找到世界观设定部分');
      return '';
    }
    return worldSection[0].trim();
  };

  // 从大纲解析时间线事件
  const parseTimelineFromOutline = (outlineText: string): string => {
    // 匹配 "## 时间线事件" 部分
    const timelineSection = outlineText.match(/##\s*时间线事件[\s\S]*?(?=\n##\s|$)/i);
    if (!timelineSection) {
      console.log('未找到时间线事件部分');
      return '';
    }
    return timelineSection[0].trim();
  };

  // 解析大纲内容，自动创建章节
  const parseAndCreateChapters = async (outlineText: string): Promise<number> => {
    // 匹配章节模式: 第X章、Chapter X、章节X 等
    const chapterPatterns = [
      /第(\d+)章[：:]\s*(.+?)(?:\n|$)/g,
      /第(\d+)章\s+(.+?)(?:\n|$)/g,
      /Chapter\s+(\d+)[：:]\s*(.+?)(?:\n|$)/gi,
      /(\d+)[.、]\s*(.+?)(?:\n|$)/g,
    ];

    const chapters: Array<{ order: number; title: string; goal: string }> = [];
    
    for (const pattern of chapterPatterns) {
      let match;
      const lines = outlineText.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const resetPattern = new RegExp(pattern.source, pattern.flags);
        match = resetPattern.exec(line);
        
        if (match) {
          const order = parseInt(match[1]);
          const title = match[2].trim();
          
          // 获取该章节后面的描述作为目标
          let goal = '';
          for (let j = i + 1; j < lines.length && j < i + 5; j++) {
            const nextLine = lines[j].trim();
            if (nextLine && !nextLine.match(/第\d+章|Chapter\s+\d+/i)) {
              goal += nextLine + '\n';
            } else if (nextLine.match(/第\d+章|Chapter\s+\d+/i)) {
              break;
            }
          }
          
          if (!chapters.find(c => c.order === order)) {
            chapters.push({ order, title, goal: goal.trim() });
          }
        }
      }
      
      if (chapters.length > 0) break;
    }

    // 创建章节
    let created = 0;
    for (const chapter of chapters.sort((a, b) => a.order - b.order)) {
      try {
        await invoke('create_chapter', {
          input: {
            project_id: id,
            title: chapter.title,
            order_index: chapter.order,
            outline_goal: chapter.goal || undefined,
          }
        });
        created++;
      } catch (err) {
        console.error(`Failed to create chapter ${chapter.order}:`, err);
      }
    }

    return created;
  };

  if (!currentProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col w-full max-w-full lg:max-w-6xl mx-auto">
      {/* 顶部工具栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 min-w-0">
          <Button variant="ghost" onClick={() => navigate(`/project/${id}`)} className="whitespace-nowrap self-start">
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回
          </Button>
          <h2 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white truncate">
            {currentProject.title} - 大纲
          </h2>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isSaved && (
            <span className="flex items-center text-green-600 dark:text-green-400 text-sm whitespace-nowrap">
              <Check className="w-4 h-4 mr-1" />
              已保存
            </span>
          )}
          {outline && !isGenerating && (
            <Button onClick={handleSave} disabled={isSaved} className="whitespace-nowrap">
              <Save className="w-4 h-4 mr-1 md:mr-2" />
              保存
            </Button>
          )}
        </div>
      </div>

      {/* 配置面板 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              目标章节数
            </label>
            <input
              type="number"
              value={chapterCount}
              onChange={(e) => setChapterCount(parseInt(e.target.value) || 20)}
              min={1}
              max={200}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              disabled={isGenerating}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              特殊要求（可选）
            </label>
            <input
              type="text"
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              placeholder="例如：需要包含多条支线剧情、主角要有重大转折..."
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              disabled={isGenerating}
            />
          </div>
        </div>
        
        <div className="flex justify-center mt-4">
          {isGenerating ? (
            <Button onClick={handleStop} variant="outline" className="bg-red-50 border-red-300 text-red-600 hover:bg-red-100">
              <StopCircle className="w-4 h-4 mr-2" />
              停止生成
            </Button>
          ) : (
            <Button onClick={handleGenerate}>
              <Sparkles className="w-4 h-4 mr-2" />
              {outline ? '重新生成' : '开始生成大纲'}
            </Button>
          )}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* 大纲内容显示区 */}
      <div 
        ref={contentRef}
        className="flex-1 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 overflow-y-auto"
      >
        {!outline && !isGenerating ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
            <Sparkles className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg">点击上方按钮开始生成大纲</p>
            <p className="text-sm mt-2">AI将根据项目信息生成详细的章节大纲</p>
          </div>
        ) : (
          <div className="prose dark:prose-invert max-w-none prose-headings:text-gray-900 dark:prose-headings:text-white prose-p:text-gray-700 dark:prose-p:text-gray-300">
            {isGenerating && (
              <div className="flex items-center mb-4 text-primary-600 dark:text-primary-400">
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                <span>正在生成中...</span>
              </div>
            )}
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {outline}
            </ReactMarkdown>
            {isGenerating && <span className="animate-pulse text-2xl">▌</span>}
          </div>
        )}
      </div>
    </div>
  );
}

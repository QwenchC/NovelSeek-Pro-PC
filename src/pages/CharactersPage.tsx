import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppStore, Character } from '@store/index';
import { projectApi } from '@services/api';
import { Button } from '@components/Button';
import { ArrowLeft, Plus, Edit, Trash2, User, Save, Star } from 'lucide-react';

export function CharactersPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { 
    currentProject, 
    setCurrentProject, 
    getCharacters, 
    setCharacters: setStoreCharacters 
  } = useAppStore();
  
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (projectId) {
      loadData(projectId);
    }
  }, [projectId]);

  // 监听 store 中角色数据的变化
  useEffect(() => {
    if (projectId) {
      const storedCharacters = getCharacters(projectId);
      console.log('CharactersPage: store 角色数据变化检测, 数量:', storedCharacters.length);
      if (storedCharacters.length > 0) {
        setCharacters(storedCharacters);
      }
    }
  }, [projectId, getCharacters]);

  const loadData = async (pid: string) => {
    try {
      // 加载项目
      const project = await projectApi.getById(pid);
      setCurrentProject(project);
      
      // 从 store 获取已保存的角色（始终获取最新状态）
      const storedCharacters = getCharacters(pid);
      console.log('CharactersPage loadData: store 中角色数量:', storedCharacters.length);
      
      if (storedCharacters.length > 0) {
        // 如果有已保存的角色，使用它们
        setCharacters(storedCharacters);
      } else if (project?.description) {
        // 否则尝试从大纲解析
        console.log('CharactersPage: store 为空，尝试从大纲解析');
        const parsed = parseCharactersFromOutline(project.description);
        if (parsed.length > 0) {
          setCharacters(parsed);
          // 保存到 store
          setStoreCharacters(pid, parsed);
        }
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  // 从大纲中解析角色信息
  const parseCharactersFromOutline = (outline: string): Character[] => {
    console.log('CharactersPage: 开始解析角色');
    
    // 匹配 "## 主要角色" 部分
    const characterSection = outline.match(/##\s*主要角色[\s\S]*?(?=\n##\s|$)/i);
    if (!characterSection) {
      console.log('CharactersPage: 未找到主要角色部分');
      return [];
    }

    const parsed: Character[] = [];
    // 按 ### 分割角色块
    const blocks = characterSection[0].split(/\n###\s+/).filter(block => block.trim() && !block.includes('主要角色'));
    
    console.log('CharactersPage: 角色块数量:', blocks.length);
    
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
      
      if (!name) return;

      const char: Character = {
        id: `char-${Date.now()}-${index}`,
        name: name,
        role: '',
        personality: '',
        background: '',
        motivation: '',
        isProtagonist: index === 0, // 第一个默认是主角
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
        console.log('CharactersPage: 解析角色:', char.name);
      }
    });

    console.log('CharactersPage: 总共解析角色数:', parsed.length);
    return parsed;
  };

  // 生成角色的 Markdown 格式（用于大纲）
  const generateCharactersMarkdown = (chars: Character[]): string => {
    // 主角排在前面
    const sorted = [...chars].sort((a, b) => {
      if (a.isProtagonist && !b.isProtagonist) return -1;
      if (!a.isProtagonist && b.isProtagonist) return 1;
      return 0;
    });

    return sorted.map((char, index) => `
### ${index + 1}. ${char.name}
- **身份**：${char.role || (char.isProtagonist ? '主角' : '配角')}
- **性格**：${char.personality || '待设定'}
- **背景**：${char.background || '待设定'}
- **动机**：${char.motivation || '待设定'}
`).join('\n');
  };

  const handleUpdateCharacter = (charId: string, field: keyof Character, value: string | boolean) => {
    setCharacters(prev => prev.map(c => 
      c.id === charId ? { ...c, [field]: value } : c
    ));
    setHasChanges(true);
  };

  const handleSetProtagonist = (charId: string) => {
    setCharacters(prev => prev.map(c => ({
      ...c,
      isProtagonist: c.id === charId,
    })));
    setHasChanges(true);
  };

  const handleDeleteCharacter = (charId: string) => {
    if (confirm('确定要删除这个角色吗？')) {
      setCharacters(prev => prev.filter(c => c.id !== charId));
      setHasChanges(true);
    }
  };

  const handleAddCharacter = () => {
    const isFirst = characters.length === 0;
    const newChar: Character = {
      id: `char-${Date.now()}`,
      name: isFirst ? '主角名' : '新角色',
      role: isFirst ? '主角' : '',
      personality: '',
      background: '',
      motivation: '',
      isProtagonist: isFirst,
    };
    setCharacters(prev => [...prev, newChar]);
    setEditingId(newChar.id);
    setHasChanges(true);
  };

  const handleSaveAll = async () => {
    if (!projectId || !currentProject) return;

    // 保存到 store（持久化）
    setStoreCharacters(projectId, characters);

    // 同步更新大纲中的角色部分
    const charactersMd = generateCharactersMarkdown(characters);
    let newDescription = currentProject.description || '';
    const characterSectionRegex = /## 主要角色[\s\S]*?(?=## |$)/;
    
    if (characterSectionRegex.test(newDescription)) {
      newDescription = newDescription.replace(characterSectionRegex, `## 主要角色\n${charactersMd}\n`);
    } else {
      // 如果大纲还没有角色部分，添加到开头
      newDescription = `## 主要角色\n${charactersMd}\n\n${newDescription}`;
    }

    try {
      await projectApi.update(currentProject.id, {
        title: currentProject.title,
        author: currentProject.author,
        genre: currentProject.genre,
        description: newDescription,
        target_word_count: currentProject.target_word_count,
        cover_images: currentProject.cover_images ?? null,
        default_cover_id: currentProject.default_cover_id ?? null,
      });
      
      setCurrentProject({
        ...currentProject,
        description: newDescription,
      });
      
      setHasChanges(false);
      alert('角色信息已保存！');
    } catch (error) {
      console.error('Failed to save characters:', error);
      alert('保存失败');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full">加载中...</div>;
  }

  return (
    <div className="w-full max-w-full lg:max-w-5xl mx-auto">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <Button variant="ghost" onClick={() => navigate(`/project/${projectId}`)} className="whitespace-nowrap self-start">
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleAddCharacter} className="whitespace-nowrap">
            <Plus className="w-4 h-4 mr-1 md:mr-2" />
            添加
          </Button>
          <Button onClick={handleSaveAll} disabled={!hasChanges} className="whitespace-nowrap">
            <Save className="w-4 h-4 mr-1 md:mr-2" />
            保存{hasChanges ? '*' : ''}
          </Button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          角色管理
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          管理小说中的角色信息。可以先创建角色再生成大纲，AI会参考你设定的角色信息。
        </p>
        <p className="text-sm text-primary-600 dark:text-primary-400 mt-2">
          💡 提示：第一个角色默认为主角，可以点击星标切换主角
        </p>
      </div>

      {characters.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <User className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <h3 className="text-xl font-medium text-gray-700 dark:text-gray-300 mb-2">
            暂无角色
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            添加角色后，生成大纲时 AI 会参考这些角色设定
          </p>
          <Button onClick={handleAddCharacter}>
            <Plus className="w-4 h-4 mr-2" />
            添加第一个角色（主角）
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {characters.map((char) => (
            <div
              key={char.id}
              className={`bg-white dark:bg-gray-800 rounded-lg border ${
                char.isProtagonist 
                  ? 'border-primary-400 dark:border-primary-600 ring-2 ring-primary-100 dark:ring-primary-900/50' 
                  : 'border-gray-200 dark:border-gray-700'
              } p-6`}
            >
              {editingId === char.id ? (
                <div className="space-y-4">
                  <div className="flex items-center space-x-4">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        角色名称
                      </label>
                      <input
                        type="text"
                        value={char.name}
                        onChange={(e) => handleUpdateCharacter(char.id, 'name', e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        身份定位
                      </label>
                      <input
                        type="text"
                        value={char.role}
                        onChange={(e) => handleUpdateCharacter(char.id, 'role', e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                        placeholder="如：主角、女主、导师、反派..."
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      性格特点
                    </label>
                    <input
                      type="text"
                      value={char.personality}
                      onChange={(e) => handleUpdateCharacter(char.id, 'personality', e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                      placeholder="如：沉稳、机智、热血、冷漠..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      背景故事
                    </label>
                    <textarea
                      value={char.background}
                      onChange={(e) => handleUpdateCharacter(char.id, 'background', e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-20 resize-none"
                      placeholder="角色的出身、经历、秘密..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      动机目标
                    </label>
                    <textarea
                      value={char.motivation}
                      onChange={(e) => handleUpdateCharacter(char.id, 'motivation', e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-20 resize-none"
                      placeholder="角色想要达成的目标，驱动他行动的原因..."
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={() => setEditingId(null)}>
                      完成编辑
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <button
                        onClick={() => handleSetProtagonist(char.id)}
                        className={`p-1 rounded-full ${
                          char.isProtagonist 
                            ? 'text-yellow-500' 
                            : 'text-gray-300 hover:text-yellow-400'
                        }`}
                        title={char.isProtagonist ? '主角' : '设为主角'}
                      >
                        <Star className={`w-5 h-5 ${char.isProtagonist ? 'fill-current' : ''}`} />
                      </button>
                      <div>
                        <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                          {char.name}
                        </h3>
                        {char.role && (
                          <span className={`inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded-full ${
                            char.isProtagonist
                              ? 'bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-400'
                              : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                          }`}>
                            {char.role}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingId(char.id)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteCharacter(char.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    {char.personality && (
                      <div>
                        <span className="font-medium text-gray-700 dark:text-gray-300">性格：</span>
                        <span className="text-gray-600 dark:text-gray-400">{char.personality}</span>
                      </div>
                    )}
                    {char.background && (
                      <div>
                        <span className="font-medium text-gray-700 dark:text-gray-300">背景：</span>
                        <span className="text-gray-600 dark:text-gray-400">{char.background}</span>
                      </div>
                    )}
                    {char.motivation && (
                      <div className="md:col-span-2">
                        <span className="font-medium text-gray-700 dark:text-gray-300">动机：</span>
                        <span className="text-gray-600 dark:text-gray-400">{char.motivation}</span>
                      </div>
                    )}
                    {!char.personality && !char.background && !char.motivation && (
                      <p className="text-gray-400 dark:text-gray-500 italic">点击编辑按钮添加详细信息</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

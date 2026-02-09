import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/tauri';
import { useAppStore, Character } from '@store/index';
import { aiApi, projectApi } from '@services/api';
import type { Project } from '@typings/index';
import { Button } from '@components/Button';
import { ArrowLeft, Plus, Edit, Trash2, User, Save, Star, Sparkles } from 'lucide-react';
import { confirmDialog } from '@utils/index';
import { tx } from '@utils/i18n';

const ONE_INCH_WIDTH = 500;
const ONE_INCH_HEIGHT = 700;
type StyleModalMode = 'appearance' | 'portrait';

const isCharacterSectionHeadingLine = (line: string): boolean =>
  /^\s*#{1,6}\s*(主要角色|Main Characters?)\s*$/i.test(line.trim());

const isCharacterFieldLine = (line: string): boolean => {
  const normalized = line.replace(/\*\*/g, '').trim();
  return (
    /(身份|性格|背景|动机|形象)\s*[：:]/.test(normalized) ||
    /(role|personality|background|motivation|appearance)\s*[:：]/i.test(normalized)
  );
};

const sanitizeCharacterName = (line: string): string =>
  line
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[\d.\s]+/, '')
    .replace(/^\s*[-*+]\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/[：:]\s*$/, '')
    .trim();

const isInvalidCharacterName = (name: string): boolean =>
  /^(主要角色|main characters?)$/i.test(name.trim());

const normalizeCharacter = (raw: Partial<Character>, index = 0): Character => ({
  id: raw.id || `char-${Date.now()}-${index}`,
  name: raw.name || `角色${index + 1}`,
  role: raw.role || '',
  personality: raw.personality || '',
  background: raw.background || '',
  motivation: raw.motivation || '',
  appearance: raw.appearance || '',
  portraitBase64: raw.portraitBase64 || undefined,
  portraitPrompt: raw.portraitPrompt || undefined,
  isProtagonist: Boolean(raw.isProtagonist),
});

const sortCharactersForOutline = (characters: Character[]): Character[] =>
  [...characters].sort((a, b) => {
    if (a.isProtagonist && !b.isProtagonist) return -1;
    if (!a.isProtagonist && b.isProtagonist) return 1;
    return 0;
  });

const buildCharactersMarkdown = (characters: Character[]): string =>
  sortCharactersForOutline(characters)
    .map(
      (char, index) => `
### ${index + 1}. ${char.name}
- **身份**：${char.role || (char.isProtagonist ? '主角' : '配角')}
- **性格**：${char.personality || '待设定'}
- **背景**：${char.background || '待设定'}
- **动机**：${char.motivation || '待设定'}
- **形象**：${char.appearance || '待设定'}
`
    )
    .join('\n');

const upsertCharacterSection = (originalOutline: string, charactersMarkdown: string): string => {
  const sectionRegex = /##\s*(主要角色|Main Characters?)\b[\s\S]*?(?=\n##\s|$)/i;
  const headingMatch = originalOutline.match(/^##\s*(主要角色|Main Characters?)\b/im);
  const sectionHeading =
    headingMatch && /main characters?/i.test(headingMatch[0])
      ? '## Main Characters'
      : '## 主要角色';
  if (sectionRegex.test(originalOutline)) {
    return originalOutline.replace(sectionRegex, `${sectionHeading}\n${charactersMarkdown}\n`);
  }
  return `${sectionHeading}\n${charactersMarkdown}\n\n${originalOutline}`;
};

const normalizeValidCharacters = (input: Character[]): Character[] =>
  input
    .filter((character) => !isInvalidCharacterName(character.name))
    .map((character, index) => normalizeCharacter(character, index));

export function CharactersPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    uiLanguage,
    currentProject,
    setCurrentProject,
    getCharacters,
    setCharacters: setStoreCharacters,
    textModelConfig,
    pollinationsKey,
  } = useAppStore();

  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const [showAppearanceStyleModal, setShowAppearanceStyleModal] = useState(false);
  const [appearanceTargetId, setAppearanceTargetId] = useState<string | null>(null);
  const [styleModalMode, setStyleModalMode] = useState<StyleModalMode>('appearance');
  const [appearanceStyle, setAppearanceStyle] = useState('cinematic');
  const [isGeneratingAppearance, setIsGeneratingAppearance] = useState(false);
  const [isRegeneratingPortrait, setIsRegeneratingPortrait] = useState(false);
  const [appearanceError, setAppearanceError] = useState<string | null>(null);

  const hasValidTextConfig = useMemo(
    () =>
      textModelConfig.apiKey.trim().length > 0 &&
      textModelConfig.apiUrl.trim().length > 0 &&
      textModelConfig.model.trim().length > 0 &&
      Number.isFinite(textModelConfig.temperature),
    [textModelConfig]
  );

  const hasPollinations = pollinationsKey.trim().length > 0;

  useEffect(() => {
    if (projectId) {
      void loadData(projectId);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    const storedCharacters = getCharacters(projectId);
    if (storedCharacters.length > 0) {
      const normalized = normalizeValidCharacters(storedCharacters);
      setCharacters(normalized);
      if (normalized.length !== storedCharacters.length) {
        setStoreCharacters(projectId, normalized);
      }
    }
  }, [projectId, getCharacters, setStoreCharacters]);

  const parseCharactersFromOutline = (outline: string): Character[] => {
    const characterSection = outline.match(/##\s*(主要角色|Main Characters?)\b[\s\S]*?(?=\n##\s|$)/i);
    if (!characterSection) {
      return [];
    }

    const parsed: Character[] = [];
    const blocks = characterSection[0]
      .split(/\n###\s+/)
      .filter(
        (block) =>
          block.trim() &&
          !/^\s*(主要角色|Main Characters?)\s*$/i.test(block.trim())
      );

    blocks.forEach((block, index) => {
      const lines = block
        .trim()
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length === 0) return;

      const candidateLine = lines.find(
        (line) => !isCharacterSectionHeadingLine(line) && !isCharacterFieldLine(line)
      );
      if (!candidateLine) return;

      const name = sanitizeCharacterName(candidateLine);
      if (!name || isInvalidCharacterName(name)) return;

      const character: Character = {
        id: `char-${Date.now()}-${index}`,
        name,
        role: '',
        personality: '',
        background: '',
        motivation: '',
        appearance: '',
        portraitBase64: undefined,
        portraitPrompt: undefined,
        isProtagonist: parsed.length === 0,
      };

      lines.forEach((line) => {
        const lowerLine = line.toLowerCase();
        const valueMatch = line.match(/[：:]\s*(.+)$/);
        const value = valueMatch ? valueMatch[1].replace(/\*\*/g, '').trim() : '';

        if (lowerLine.includes('身份') || lowerLine.includes('role')) {
          character.role = value;
        } else if (lowerLine.includes('性格') || lowerLine.includes('personality')) {
          character.personality = value;
        } else if (lowerLine.includes('背景') || lowerLine.includes('background')) {
          character.background = value;
        } else if (lowerLine.includes('动机') || lowerLine.includes('motivation')) {
          character.motivation = value;
        } else if (lowerLine.includes('形象') || lowerLine.includes('appearance')) {
          character.appearance = value;
        }
      });

      parsed.push(character);
    });

    return normalizeValidCharacters(parsed);
  };

  const loadData = async (pid: string) => {
    try {
      const project = await projectApi.getById(pid);
      setCurrentProject(project);

      const storedCharacters = getCharacters(pid);
      if (storedCharacters.length > 0) {
        const normalized = normalizeValidCharacters(storedCharacters);
        setCharacters(normalized);
        if (normalized.length !== storedCharacters.length) {
          setStoreCharacters(pid, normalized);
        }
      } else if (project?.description) {
        const parsed = parseCharactersFromOutline(project.description);
        if (parsed.length > 0) {
          setCharacters(parsed);
          setStoreCharacters(pid, parsed);
        }
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const ensureProjectLoaded = async (): Promise<Project> => {
    if (currentProject) {
      return currentProject;
    }
    if (!projectId) {
      throw new Error(tx(uiLanguage, '项目未加载', 'Project not loaded'));
    }
    const fetched = await projectApi.getById(projectId);
    if (!fetched) {
      throw new Error(tx(uiLanguage, '项目不存在', 'Project not found'));
    }
    setCurrentProject(fetched);
    return fetched;
  };

  const syncCharactersToOutline = async (nextCharacters: Character[]) => {
    if (!projectId) {
      throw new Error(tx(uiLanguage, '项目未加载', 'Project not loaded'));
    }

    const normalized = nextCharacters.map((char, index) => normalizeCharacter(char, index));
    setStoreCharacters(projectId, normalized);

    const project = await ensureProjectLoaded();
    const charactersMarkdown = buildCharactersMarkdown(normalized);
    const newDescription = upsertCharacterSection(project.description || '', charactersMarkdown);

    await projectApi.update(project.id, {
      title: project.title,
      author: project.author,
      genre: project.genre,
      description: newDescription,
      target_word_count: project.target_word_count,
      cover_images: project.cover_images ?? null,
      default_cover_id: project.default_cover_id ?? null,
    });

    setCurrentProject({
      ...project,
      description: newDescription,
    });
  };

  const handleUpdateCharacter = (
    charId: string,
    field: keyof Character,
    value: string | boolean | undefined
  ) => {
    setCharacters((prev) => prev.map((char) => (char.id === charId ? { ...char, [field]: value } : char)));
    setHasChanges(true);
  };

  const handleSetProtagonist = (charId: string) => {
    setCharacters((prev) =>
      prev.map((char) => ({
        ...char,
        isProtagonist: char.id === charId,
      }))
    );
    setHasChanges(true);
  };

  const handleDeleteCharacter = async (charId: string) => {
    const confirmed = await confirmDialog(
      tx(uiLanguage, '确定要删除这个角色吗？', 'Delete this character?'),
      tx(uiLanguage, '删除角色', 'Delete Character')
    );
    if (!confirmed) return;
    setCharacters((prev) => prev.filter((char) => char.id !== charId));
    setHasChanges(true);
  };

  const handleAddCharacter = () => {
    const isFirst = characters.length === 0;
    const newCharacter: Character = {
      id: `char-${Date.now()}`,
      name: isFirst ? tx(uiLanguage, '主角名', 'Protagonist') : tx(uiLanguage, '新角色', 'New Character'),
      role: isFirst ? tx(uiLanguage, '主角', 'Protagonist') : '',
      personality: '',
      background: '',
      motivation: '',
      appearance: '',
      portraitBase64: undefined,
      portraitPrompt: undefined,
      isProtagonist: isFirst,
    };
    setCharacters((prev) => [...prev, newCharacter]);
    setEditingId(newCharacter.id);
    setHasChanges(true);
  };

  const handleSaveAll = async () => {
    if (!projectId) return;
    try {
      await syncCharactersToOutline(characters);
      setHasChanges(false);
      alert(tx(uiLanguage, '角色信息已保存！', 'Character info saved!'));
    } catch (error) {
      console.error('Failed to save characters:', error);
      alert(typeof error === 'string' ? error : tx(uiLanguage, '保存失败', 'Save failed'));
    }
  };

  const openAppearanceStyleDialog = (charId: string) => {
    setAppearanceTargetId(charId);
    setStyleModalMode('appearance');
    setAppearanceStyle('cinematic');
    setAppearanceError(null);
    setShowAppearanceStyleModal(true);
  };

  const openPortraitStyleDialog = (charId: string) => {
    setAppearanceTargetId(charId);
    setStyleModalMode('portrait');
    setAppearanceStyle('cinematic');
    setAppearanceError(null);
    setShowAppearanceStyleModal(true);
  };

  const persistCharactersToStore = (nextCharacters: Character[]) => {
    if (!projectId) return;
    setStoreCharacters(projectId, nextCharacters.map((char, index) => normalizeCharacter(char, index)));
  };

  const handleGenerateAppearance = async () => {
    if (!appearanceTargetId) return;

    const target = characters.find((char) => char.id === appearanceTargetId);
    if (!target) {
      setAppearanceError(tx(uiLanguage, '目标角色不存在', 'Target character does not exist'));
      return;
    }

    if (!hasValidTextConfig) {
      setAppearanceError(
        tx(
          uiLanguage,
          '请先在设置页面配置文本模型的 API Key / API URL / 模型名称 / Temperature',
          'Configure text model API Key / API URL / model / temperature in Settings first'
        )
      );
      return;
    }

    setIsGeneratingAppearance(true);
    setAppearanceError(null);

    try {
      const result = await aiApi.generateCharacterAppearance({
        name: target.name,
        role: target.role || null,
        personality: target.personality || null,
        background: target.background || null,
        motivation: target.motivation || null,
        style: appearanceStyle.trim() || null,
        text_config: textModelConfig,
      });

      let portraitBase64 = target.portraitBase64;
      const portraitPrompt = result.image_prompt;
      let portraitWarning: string | null = null;

      if (hasPollinations) {
        try {
          portraitBase64 = await invoke<string>('generate_promo_image', {
            prompt: result.image_prompt,
            width: ONE_INCH_WIDTH,
            height: ONE_INCH_HEIGHT,
            model: 'zimage',
            pollinationsKey: pollinationsKey || null,
          });
        } catch (error) {
          const message =
            typeof error === 'string'
              ? error
              : (error as Error)?.message || tx(uiLanguage, '未知错误', 'Unknown error');
          portraitWarning = tx(
            uiLanguage,
            `人物形象文本已生成，但一寸照生成失败：${message}`,
            `Appearance text generated, but portrait generation failed: ${message}`
          );
        }
      } else {
        portraitWarning = tx(
          uiLanguage,
          '未配置 Pollinations API Key，已跳过一寸照生成。',
          'Pollinations API Key not configured, portrait generation skipped.'
        );
      }

      const nextCharacters = characters.map((char) =>
        char.id === target.id
          ? {
              ...char,
              appearance: result.appearance,
              portraitPrompt,
              portraitBase64,
            }
          : char
      );

      setCharacters(nextCharacters);
      await syncCharactersToOutline(nextCharacters);
      setHasChanges(false);
      setShowAppearanceStyleModal(false);
      setAppearanceTargetId(null);

      if (portraitWarning) {
        alert(
          tx(
            uiLanguage,
            `人物形象已同步到大纲。${portraitWarning}`,
            `Character appearance synced to outline. ${portraitWarning}`
          )
        );
      }
    } catch (error) {
      const message =
        typeof error === 'string'
          ? error
          : (error as Error)?.message || tx(uiLanguage, '人物形象生成失败', 'Character appearance generation failed');
      setAppearanceError(message);
      setHasChanges(true);
    } finally {
      setIsGeneratingAppearance(false);
    }
  };

  const handleRegeneratePortrait = async () => {
    if (!appearanceTargetId) return;

    const target = characters.find((char) => char.id === appearanceTargetId);
    if (!target) {
      setAppearanceError(tx(uiLanguage, '目标角色不存在', 'Target character does not exist'));
      return;
    }

    if (!hasPollinations) {
      setAppearanceError(tx(uiLanguage, '请先在设置页面配置 Pollinations API Key', 'Configure Pollinations API Key in Settings first'));
      return;
    }

    if (!hasValidTextConfig) {
      setAppearanceError(
        tx(
          uiLanguage,
          '请先在设置页面配置文本模型的 API Key / API URL / 模型名称 / Temperature',
          'Configure text model API Key / API URL / model / temperature in Settings first'
        )
      );
      return;
    }

    setIsRegeneratingPortrait(true);
    setAppearanceError(null);

    try {
      const promptResult = await aiApi.generateCharacterPortraitPrompt({
        name: target.name,
        appearance: target.appearance || null,
        role: target.role || null,
        personality: target.personality || null,
        background: target.background || null,
        motivation: target.motivation || null,
        style: appearanceStyle.trim() || null,
        text_config: textModelConfig,
      });

      const portraitBase64 = await invoke<string>('generate_promo_image', {
        prompt: promptResult.image_prompt,
        width: ONE_INCH_WIDTH,
        height: ONE_INCH_HEIGHT,
        model: 'zimage',
        pollinationsKey: pollinationsKey || null,
      });

      const nextCharacters = characters.map((char) =>
        char.id === target.id
          ? {
              ...char,
              portraitPrompt: promptResult.image_prompt,
              portraitBase64,
            }
          : char
      );

      setCharacters(nextCharacters);
      persistCharactersToStore(nextCharacters);
      setShowAppearanceStyleModal(false);
      setAppearanceTargetId(null);
    } catch (error) {
      const message =
        typeof error === 'string'
          ? error
          : (error as Error)?.message || tx(uiLanguage, '一寸照重生成失败', 'Portrait regeneration failed');
      setAppearanceError(message);
    } finally {
      setIsRegeneratingPortrait(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full">{tx(uiLanguage, '加载中...', 'Loading...')}</div>;
  }

  return (
    <div className="w-full max-w-full lg:max-w-5xl mx-auto">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <Button
          variant="ghost"
          onClick={() => navigate(`/project/${projectId}`)}
          className="whitespace-nowrap self-start"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          {tx(uiLanguage, '返回', 'Back')}
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleAddCharacter} className="whitespace-nowrap">
            <Plus className="w-4 h-4 mr-1 md:mr-2" />
            {tx(uiLanguage, '添加', 'Add')}
          </Button>
          <Button onClick={handleSaveAll} disabled={!hasChanges} className="whitespace-nowrap">
            <Save className="w-4 h-4 mr-1 md:mr-2" />
            {tx(uiLanguage, '保存', 'Save')}
            {hasChanges ? '*' : ''}
          </Button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{tx(uiLanguage, '角色管理', 'Character Management')}</h1>
        <p className="text-gray-600 dark:text-gray-400">
          {tx(
            uiLanguage,
            '管理小说中的角色信息。可以先创建角色再生成大纲，AI会参考你设定的角色信息。',
            'Manage characters in your novel. Create characters before generating outline so AI can follow your settings.'
          )}
        </p>
        <p className="text-sm text-primary-600 dark:text-primary-400 mt-2">
          {tx(
            uiLanguage,
            '点击“人物形象生成”可根据角色信息生成形象文本并同步到大纲；“重生一寸照”只更新照片，不会改动形象文本。',
            'Use "Generate Appearance" to create appearance text and sync it to outline; "Regenerate Portrait" only updates the photo.'
          )}
        </p>
      </div>

      {characters.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <User className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <h3 className="text-xl font-medium text-gray-700 dark:text-gray-300 mb-2">{tx(uiLanguage, '暂无角色', 'No Characters')}</h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {tx(uiLanguage, '添加角色后，生成大纲时 AI 会参考这些角色设定', 'After adding characters, AI will use these settings when generating outline')}
          </p>
          <Button onClick={handleAddCharacter}>
            <Plus className="w-4 h-4 mr-2" />
            {tx(uiLanguage, '添加第一个角色（主角）', 'Add first character (Protagonist)')}
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
              <div className="flex flex-col md:flex-row gap-4">
                <div className="w-24 md:w-28 shrink-0">
                  <div className="w-full aspect-[5/7] overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900/40">
                    {char.portraitBase64 ? (
                      <img
                        src={char.portraitBase64}
                        alt={`${char.name} ${tx(uiLanguage, '形象', 'Portrait')}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500">
                        <User className="w-8 h-8" />
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-center text-gray-500 dark:text-gray-400">
                    {tx(uiLanguage, '人物一寸照', 'Character Portrait')}
                  </p>
                </div>

                <div className="flex-1 min-w-0">
                  {editingId === char.id ? (
                    <div className="space-y-4">
                      <div className="flex items-center space-x-4">
                        <div className="flex-1">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            {tx(uiLanguage, '角色名称', 'Character Name')}
                          </label>
                          <input
                            type="text"
                            value={char.name}
                            onChange={(event) =>
                              handleUpdateCharacter(char.id, 'name', event.target.value)
                            }
                            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            {tx(uiLanguage, '身份定位', 'Role')}
                          </label>
                          <input
                            type="text"
                            value={char.role}
                            onChange={(event) =>
                              handleUpdateCharacter(char.id, 'role', event.target.value)
                            }
                            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                            placeholder={tx(uiLanguage, '如：主角、女主、导师、反派...', 'e.g. Protagonist, Mentor, Antagonist...')}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          {tx(uiLanguage, '性格特点', 'Personality')}
                        </label>
                        <input
                          type="text"
                          value={char.personality}
                          onChange={(event) =>
                            handleUpdateCharacter(char.id, 'personality', event.target.value)
                          }
                          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                          placeholder={tx(uiLanguage, '如：沉稳、机智、热血、冷漠...', 'e.g. Calm, Smart, Passionate, Cold...')}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          {tx(uiLanguage, '背景故事', 'Background')}
                        </label>
                        <textarea
                          value={char.background}
                          onChange={(event) =>
                            handleUpdateCharacter(char.id, 'background', event.target.value)
                          }
                          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-20 resize-none"
                          placeholder={tx(uiLanguage, '角色的出身、经历、秘密...', 'Origin, experiences, secrets...')}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          {tx(uiLanguage, '动机目标', 'Motivation')}
                        </label>
                        <textarea
                          value={char.motivation}
                          onChange={(event) =>
                            handleUpdateCharacter(char.id, 'motivation', event.target.value)
                          }
                          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-20 resize-none"
                          placeholder={tx(uiLanguage, '角色想要达成的目标，驱动他行动的原因...', 'Goals and reasons that drive this character...')}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          {tx(uiLanguage, '形象', 'Appearance')}
                        </label>
                        <textarea
                          value={char.appearance || ''}
                          onChange={(event) =>
                            handleUpdateCharacter(char.id, 'appearance', event.target.value)
                          }
                          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-24 resize-none"
                          placeholder={tx(
                            uiLanguage,
                            '可手动填写，或点击“人物形象生成”自动生成',
                            'Manual input, or click "Generate Appearance"'
                          )}
                        />
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          onClick={() => openAppearanceStyleDialog(char.id)}
                          loading={isGeneratingAppearance && appearanceTargetId === char.id}
                          disabled={isGeneratingAppearance || isRegeneratingPortrait}
                          className="whitespace-nowrap"
                        >
                          <Sparkles className="w-4 h-4 mr-1" />
                          {tx(uiLanguage, '人物形象生成', 'Generate Appearance')}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => openPortraitStyleDialog(char.id)}
                          loading={isRegeneratingPortrait && appearanceTargetId === char.id}
                          disabled={isGeneratingAppearance || isRegeneratingPortrait}
                          className="whitespace-nowrap"
                        >
                          {tx(uiLanguage, '重生一寸照', 'Regenerate Portrait')}
                        </Button>
                        <Button onClick={() => setEditingId(null)}>{tx(uiLanguage, '完成编辑', 'Done')}</Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-start justify-between mb-4 gap-3">
                        <div className="flex items-center space-x-3 min-w-0">
                          <button
                            onClick={() => handleSetProtagonist(char.id)}
                            className={`p-1 rounded-full ${
                              char.isProtagonist
                                ? 'text-yellow-500'
                                : 'text-gray-300 hover:text-yellow-400'
                            }`}
                            title={char.isProtagonist ? tx(uiLanguage, '主角', 'Protagonist') : tx(uiLanguage, '设为主角', 'Set as Protagonist')}
                          >
                            <Star className={`w-5 h-5 ${char.isProtagonist ? 'fill-current' : ''}`} />
                          </button>
                          <div className="min-w-0">
                            <h3 className="text-xl font-semibold text-gray-900 dark:text-white truncate">
                              {char.name}
                            </h3>
                            {char.role && (
                              <span
                                className={`inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded-full ${
                                  char.isProtagonist
                                    ? 'bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-400'
                                    : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                                }`}
                              >
                                {char.role}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center flex-wrap justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openAppearanceStyleDialog(char.id)}
                            loading={isGeneratingAppearance && appearanceTargetId === char.id}
                            disabled={isGeneratingAppearance || isRegeneratingPortrait}
                            className="whitespace-nowrap"
                          >
                            <Sparkles className="w-4 h-4 mr-1" />
                            {tx(uiLanguage, '人物形象生成', 'Generate Appearance')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openPortraitStyleDialog(char.id)}
                            loading={isRegeneratingPortrait && appearanceTargetId === char.id}
                            disabled={isGeneratingAppearance || isRegeneratingPortrait}
                            className="whitespace-nowrap"
                          >
                            {tx(uiLanguage, '重生一寸照', 'Regenerate Portrait')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditingId(char.id)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleDeleteCharacter(char.id)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        {char.personality && (
                          <div>
                            <span className="font-medium text-gray-700 dark:text-gray-300">{tx(uiLanguage, '性格：', 'Personality:')}</span>
                            <span className="text-gray-600 dark:text-gray-400">{char.personality}</span>
                          </div>
                        )}
                        {char.background && (
                          <div>
                            <span className="font-medium text-gray-700 dark:text-gray-300">{tx(uiLanguage, '背景：', 'Background:')}</span>
                            <span className="text-gray-600 dark:text-gray-400">{char.background}</span>
                          </div>
                        )}
                        {char.motivation && (
                          <div className="md:col-span-2">
                            <span className="font-medium text-gray-700 dark:text-gray-300">{tx(uiLanguage, '动机：', 'Motivation:')}</span>
                            <span className="text-gray-600 dark:text-gray-400">{char.motivation}</span>
                          </div>
                        )}
                        {char.appearance && (
                          <div className="md:col-span-2">
                            <span className="font-medium text-gray-700 dark:text-gray-300">{tx(uiLanguage, '形象：', 'Appearance:')}</span>
                            <span className="text-gray-600 dark:text-gray-400">{char.appearance}</span>
                          </div>
                        )}
                        {!char.personality && !char.background && !char.motivation && !char.appearance && (
                          <p className="text-gray-400 dark:text-gray-500 italic">
                            {tx(uiLanguage, '点击编辑按钮添加详细信息，或使用“人物形象生成”', 'Click edit to add details, or use "Generate Appearance"')}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAppearanceStyleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              {styleModalMode === 'appearance'
                ? tx(uiLanguage, '人物形象生成', 'Generate Appearance')
                : tx(uiLanguage, '重生人物一寸照', 'Regenerate Portrait')}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {styleModalMode === 'appearance'
                ? tx(
                  uiLanguage,
                  '将基于角色名称、身份、性格、背景、动机生成“形象”文本，并同步到大纲中。',
                  'Generate appearance text from name, role, personality, background, and motivation, then sync to outline.'
                )
                : tx(
                  uiLanguage,
                  '仅重新生成人物一寸照，不会改动角色“形象”文本。',
                  'Only regenerate portrait image, without changing appearance text.'
                )}
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {tx(uiLanguage, '图片风格', 'Image Style')}
              </label>
              <input
                type="text"
                list="character-style-options"
                value={appearanceStyle}
                onChange={(event) => setAppearanceStyle(event.target.value)}
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                placeholder={tx(uiLanguage, '选择或输入风格（支持中文）', 'Select or input style')}
              />
              <datalist id="character-style-options">
                <option value="cinematic" />
                <option value="watercolor" />
                <option value="anime" />
              </datalist>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
              {tx(
                uiLanguage,
                '支持手动输入风格，系统会将风格转化并融合为英文提示词。',
                'Manual style is supported and will be converted into English prompt terms.'
              )}
            </p>
            {!hasPollinations && styleModalMode === 'appearance' && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                {tx(
                  uiLanguage,
                  '未配置 Pollinations API Key：本次仅生成人物形象文本，不会生成一寸照。',
                  'Pollinations API Key not configured: only appearance text will be generated, no portrait image.'
                )}
              </p>
            )}
            {!hasPollinations && styleModalMode === 'portrait' && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                {tx(
                  uiLanguage,
                  '请先在设置页面配置 Pollinations API Key，否则无法重生一寸照。',
                  'Configure Pollinations API Key in Settings first, otherwise portrait cannot be regenerated.'
                )}
              </p>
            )}
            {appearanceError && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-3">{appearanceError}</p>
            )}

            <div className="flex space-x-3 pt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (isGeneratingAppearance || isRegeneratingPortrait) return;
                  setShowAppearanceStyleModal(false);
                  setAppearanceError(null);
                }}
                className="flex-1"
              >
                {tx(uiLanguage, '取消', 'Cancel')}
              </Button>
              <Button
                onClick={() =>
                  void (styleModalMode === 'appearance'
                    ? handleGenerateAppearance()
                    : handleRegeneratePortrait())
                }
                loading={styleModalMode === 'appearance' ? isGeneratingAppearance : isRegeneratingPortrait}
                className="flex-1"
              >
                {styleModalMode === 'appearance'
                  ? tx(uiLanguage, '生成', 'Generate')
                  : tx(uiLanguage, '重生', 'Regenerate')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@store/index';
import { aiApi } from '@services/api';
import { Button } from '@components/Button';
import type { TextModelConfig, TextModelProfile, TextModelProvider } from '@typings/index';
import { CheckCircle, ExternalLink, Eye, EyeOff, Image, Key, Plus, Trash2, XCircle } from 'lucide-react';
import { tx } from '@utils/i18n';

type Status = 'idle' | 'testing' | 'success' | 'error';

const CUSTOM_MODEL_DEFAULT: Pick<TextModelProfile, 'provider' | 'apiUrl' | 'model' | 'temperature'> = {
  provider: 'custom',
  apiUrl: 'https://your-api.example.com/v1',
  model: 'your-model-name',
  temperature: 0.7,
};

function clampTemperature(value: number): number {
  if (!Number.isFinite(value)) return 0.7;
  return Math.min(2, Math.max(0, value));
}

function isProfileConfigValid(profile: TextModelProfile): boolean {
  return (
    profile.apiKey.trim().length > 0 &&
    profile.apiUrl.trim().length > 0 &&
    profile.model.trim().length > 0 &&
    Number.isFinite(profile.temperature)
  );
}

function toTextConfig(profile: TextModelProfile): TextModelConfig {
  return {
    provider: profile.provider,
    apiKey: profile.apiKey.trim(),
    apiUrl: profile.apiUrl.trim(),
    model: profile.model.trim(),
    temperature: clampTemperature(profile.temperature),
  };
}

function createCustomProfile(
  profiles: TextModelProfile[],
  inputName: string,
  defaultNamePrefix: string
): TextModelProfile {
  let idx = profiles.length + 1;
  let id = `custom-${idx}`;
  while (profiles.some((profile) => profile.id === id)) {
    idx += 1;
    id = `custom-${idx}`;
  }

  const customCount = profiles.filter((profile) => !profile.builtIn).length + 1;
  const name = inputName.trim() || `${defaultNamePrefix} ${customCount}`;

  return {
    id,
    name,
    apiKey: '',
    builtIn: false,
    ...CUSTOM_MODEL_DEFAULT,
  };
}

function normalizeProfile(profile: TextModelProfile): TextModelProfile {
  return {
    ...profile,
    provider: (profile.provider || 'custom') as TextModelProvider,
    name: profile.name.trim() || profile.id,
    apiKey: profile.apiKey.trim(),
    apiUrl: profile.apiUrl.trim(),
    model: profile.model.trim(),
    temperature: clampTemperature(profile.temperature),
  };
}

export function SettingsPage() {
  const {
    uiLanguage,
    textModelProfiles,
    activeTextModelProfileId,
    pollinationsKey,
    setTextModelProfiles,
    setActiveTextModelProfileId,
    setTextModelConfig,
    setPollinationsKey,
  } = useAppStore();

  const [localProfiles, setLocalProfiles] = useState<TextModelProfile[]>(textModelProfiles);
  const [localActiveProfileId, setLocalActiveProfileId] = useState(activeTextModelProfileId);
  const [newPlatformName, setNewPlatformName] = useState('');
  const [localPollinationsKey, setLocalPollinationsKey] = useState(pollinationsKey);
  const [showTextKey, setShowTextKey] = useState(false);
  const [showPollinationsKey, setShowPollinationsKey] = useState(false);
  const [textStatus, setTextStatus] = useState<Status>('idle');
  const [pollinationsStatus, setPollinationsStatus] = useState<Status>('idle');

  useEffect(() => {
    setLocalProfiles(textModelProfiles);
    setLocalActiveProfileId(activeTextModelProfileId);
  }, [textModelProfiles, activeTextModelProfileId]);

  const activeProfile = useMemo(() => {
    return (
      localProfiles.find((profile) => profile.id === localActiveProfileId) ||
      localProfiles[0] ||
      null
    );
  }, [localProfiles, localActiveProfileId]);

  const updateActiveProfile = (patch: Partial<TextModelProfile>) => {
    if (!activeProfile) return;
    setLocalProfiles((prev) =>
      prev.map((profile) =>
        profile.id === activeProfile.id
          ? {
              ...profile,
              ...patch,
            }
          : profile
      )
    );
    setTextStatus('idle');
  };

  const switchActiveProfile = (profileId: string) => {
    setLocalActiveProfileId(profileId);
    setTextStatus('idle');
  };

  const addCustomPlatform = () => {
    const next = createCustomProfile(localProfiles, newPlatformName, tx(uiLanguage, '自定义平台', 'Custom Platform'));
    setLocalProfiles((prev) => [...prev, next]);
    setLocalActiveProfileId(next.id);
    setNewPlatformName('');
    setTextStatus('idle');
  };

  const deleteActiveCustomPlatform = () => {
    if (!activeProfile || activeProfile.builtIn) return;
    const nextProfiles = localProfiles.filter((profile) => profile.id !== activeProfile.id);
    const fallback = nextProfiles[0];
    setLocalProfiles(nextProfiles);
    if (fallback) {
      setLocalActiveProfileId(fallback.id);
    }
    setTextStatus('idle');
  };

  const testTextModel = async () => {
    if (!activeProfile || !isProfileConfigValid(activeProfile)) {
      alert(
        tx(
          uiLanguage,
          '请完整填写当前平台配置：API Key、API URL、模型、Temperature',
          'Please complete API Key, API URL, model, and temperature for current platform'
        )
      );
      return;
    }

    setTextStatus('testing');
    try {
      const result = await aiApi.testTextConnection(toTextConfig(activeProfile));
      setTextStatus(result ? 'success' : 'error');
    } catch {
      setTextStatus('error');
    }
  };

  const testPollinations = async () => {
    setPollinationsStatus('testing');
    try {
      const result = await aiApi.testPollinations(localPollinationsKey || undefined);
      setPollinationsStatus(result ? 'success' : 'error');
    } catch {
      setPollinationsStatus('error');
    }
  };

  const saveSettings = () => {
    if (!activeProfile || !isProfileConfigValid(activeProfile)) {
      alert(
        tx(
          uiLanguage,
          '请完整填写当前平台配置：API Key、API URL、模型、Temperature',
          'Please complete API Key, API URL, model, and temperature for current platform'
        )
      );
      return;
    }

    const normalizedProfiles = localProfiles.map((profile) => normalizeProfile(profile));
    const normalizedActive =
      normalizedProfiles.find((profile) => profile.id === localActiveProfileId) ||
      normalizedProfiles[0];
    if (!normalizedActive) {
      alert(tx(uiLanguage, '未找到可用平台配置', 'No available platform configuration found'));
      return;
    }

    setTextModelProfiles(normalizedProfiles);
    setActiveTextModelProfileId(normalizedActive.id);
    setTextModelConfig(toTextConfig(normalizedActive));
    setPollinationsKey(localPollinationsKey.trim());

    alert(tx(uiLanguage, '设置已保存', 'Settings saved'));
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">{tx(uiLanguage, '设置', 'Settings')}</h1>

      <div className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Key className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{tx(uiLanguage, '文本模型平台', 'Text Model Platforms')}</h2>
          </div>

          {activeProfile ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {tx(uiLanguage, '平台列表', 'Platform List')}
                  </label>
                  <select
                    value={localActiveProfileId}
                    onChange={(event) => switchActiveProfile(event.target.value)}
                    className="w-full px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                  >
                    {localProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                        {profile.builtIn ? tx(uiLanguage, '（内置）', ' (Built-in)') : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {tx(uiLanguage, '新增自定义平台', 'Add Custom Platform')}
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={newPlatformName}
                      onChange={(event) => setNewPlatformName(event.target.value)}
                      placeholder={tx(uiLanguage, '平台名称（可选）', 'Platform Name (Optional)')}
                      className="flex-1 px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                    />
                    <Button onClick={addCustomPlatform} className="px-3 whitespace-nowrap">
                      <Plus className="w-4 h-4 mr-1" />
                      {tx(uiLanguage, '新增', 'Add')}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-medium text-gray-900 dark:text-white">{tx(uiLanguage, '当前平台配置', 'Current Platform Configuration')}</h3>
                {!activeProfile.builtIn && (
                  <button
                    type="button"
                    onClick={deleteActiveCustomPlatform}
                    className="inline-flex items-center px-3 py-1.5 text-sm rounded-lg border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    {tx(uiLanguage, '删除当前自定义平台', 'Delete Current Custom Platform')}
                  </button>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {tx(uiLanguage, '平台名称', 'Platform Name')}
                </label>
                <input
                  value={activeProfile.name}
                  onChange={(event) => updateActiveProfile({ name: event.target.value })}
                  placeholder={tx(uiLanguage, '例如：OpenAI生产环境', 'e.g. OpenAI Production')}
                  className="w-full px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {tx(uiLanguage, '平台类型', 'Platform Type')}
                </label>
                <select
                  value={activeProfile.provider}
                  onChange={(event) =>
                    updateActiveProfile({ provider: event.target.value as TextModelProvider })
                  }
                  className="w-full px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                >
                  <option value="deepseek">DeepSeek</option>
                  <option value="openai">OpenAI</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="gemini">{tx(uiLanguage, 'Gemini(OpenAI兼容)', 'Gemini (OpenAI Compatible)')}</option>
                  <option value="custom">{tx(uiLanguage, '自定义(OpenAI兼容)', 'Custom (OpenAI Compatible)')}</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    API Key
                  </label>
                  {activeProfile.keyUrl && (
                    <a
                      href={activeProfile.keyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                    >
                      {tx(uiLanguage, '获取密钥', 'Get Key')}
                      <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showTextKey ? 'text' : 'password'}
                    value={activeProfile.apiKey}
                    onChange={(event) => updateActiveProfile({ apiKey: event.target.value })}
                    placeholder={tx(uiLanguage, '请输入 API Key', 'Enter API Key')}
                    className="w-full px-3 py-2 pr-11 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTextKey((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    title={showTextKey ? tx(uiLanguage, '隐藏密钥', 'Hide Key') : tx(uiLanguage, '显示密钥', 'Show Key')}
                  >
                    {showTextKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  API URL
                </label>
                <input
                  value={activeProfile.apiUrl}
                  onChange={(event) => updateActiveProfile({ apiUrl: event.target.value })}
                  placeholder={tx(uiLanguage, '例如：https://api.deepseek.com/v1', 'e.g. https://api.deepseek.com/v1')}
                  className="w-full px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {tx(uiLanguage, '模型名称', 'Model Name')}
                </label>
                <input
                  value={activeProfile.model}
                  onChange={(event) => updateActiveProfile({ model: event.target.value })}
                  placeholder={tx(uiLanguage, '例如：deepseek-chat / gpt-4o-mini', 'e.g. deepseek-chat / gpt-4o-mini')}
                  className="w-full px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {tx(uiLanguage, 'Temperature（0-2）', 'Temperature (0-2)')}
                </label>
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={activeProfile.temperature}
                  onChange={(event) =>
                    updateActiveProfile({ temperature: Number(event.target.value || 0) })
                  }
                  className="w-full px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                />
              </div>

              <p className="text-xs text-gray-500 dark:text-gray-400">
                {tx(
                  uiLanguage,
                  '每个平台配置独立保存。切换平台会自动切换对应 API Key、API URL、模型和 Temperature。',
                  'Each platform is saved independently. Switching platform also switches API Key, API URL, model, and temperature.'
                )}
              </p>

              <div className="flex items-center space-x-2">
                <Button onClick={testTextModel} loading={textStatus === 'testing'}>
                  {tx(uiLanguage, '测试当前平台连接', 'Test Current Platform')}
                </Button>
                {textStatus === 'success' && (
                  <div className="flex items-center text-green-600 dark:text-green-400">
                    <CheckCircle className="w-4 h-4 mr-1" />
                    <span className="text-sm">{tx(uiLanguage, '连接成功', 'Connected')}</span>
                  </div>
                )}
                {textStatus === 'error' && (
                  <div className="flex items-center text-red-600 dark:text-red-400">
                    <XCircle className="w-4 h-4 mr-1" />
                    <span className="text-sm">{tx(uiLanguage, '连接失败', 'Connection Failed')}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400">{tx(uiLanguage, '暂无可用文本模型平台', 'No available text model platform')}</div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Image className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Pollinations API</h2>
          </div>

          <div className="mb-3">
            <a
              href="https://pollinations.ai"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
            >
              {tx(uiLanguage, '访问 Pollinations 官网', 'Visit Pollinations Official Site')}
              <ExternalLink className="w-3 h-3 ml-1" />
            </a>
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {tx(uiLanguage, 'API Key（可选）', 'API Key (Optional)')}
                </label>
                <a
                  href="https://enter.pollinations.ai/"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                >
                  {tx(uiLanguage, '获取密钥', 'Get Key')}
                  <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              </div>
              <div className="relative">
                <input
                  type={showPollinationsKey ? 'text' : 'password'}
                  value={localPollinationsKey}
                  onChange={(event) => setLocalPollinationsKey(event.target.value)}
                  placeholder={tx(uiLanguage, 'pk_... 或 sk_...', 'pk_... or sk_...')}
                  className="w-full px-3 py-2 pr-11 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowPollinationsKey((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  title={showPollinationsKey ? tx(uiLanguage, '隐藏密钥', 'Hide Key') : tx(uiLanguage, '显示密钥', 'Show Key')}
                >
                  {showPollinationsKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <p className="text-sm text-gray-600 dark:text-gray-400">
              {tx(uiLanguage, '不配置 API Key 也可使用，但可能会受到频率限制。', 'Works without API key, but may be rate-limited.')}
            </p>

            <div className="flex items-center space-x-2">
              <Button onClick={testPollinations} loading={pollinationsStatus === 'testing'}>
                {tx(uiLanguage, '测试 Pollinations 连接', 'Test Pollinations Connection')}
              </Button>
              {pollinationsStatus === 'success' && (
                <div className="flex items-center text-green-600 dark:text-green-400">
                  <CheckCircle className="w-4 h-4 mr-1" />
                  <span className="text-sm">{tx(uiLanguage, '连接成功', 'Connected')}</span>
                </div>
              )}
              {pollinationsStatus === 'error' && (
                <div className="flex items-center text-red-600 dark:text-red-400">
                  <XCircle className="w-4 h-4 mr-1" />
                  <span className="text-sm">{tx(uiLanguage, '连接失败', 'Connection Failed')}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={saveSettings}>{tx(uiLanguage, '保存设置', 'Save Settings')}</Button>
        </div>
      </div>
    </div>
  );
}

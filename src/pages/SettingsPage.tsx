import { useState } from 'react';
import { useAppStore } from '@store/index';
import { aiApi } from '@services/api';
import { Button } from '@components/Button';
import { Key, Image, CheckCircle, XCircle, Eye, EyeOff, ExternalLink } from 'lucide-react';

export function SettingsPage() {
  const { deepseekKey, pollinationsKey, setDeepseekKey, setPollinationsKey } = useAppStore();
  const [localDeepSeekKey, setLocalDeepSeekKey] = useState(deepseekKey);
  const [localPollinationsKey, setLocalPollinationsKey] = useState(pollinationsKey);
  const [showDeepSeekKey, setShowDeepSeekKey] = useState(false);
  const [showPollinationsKey, setShowPollinationsKey] = useState(false);
  const [deepseekStatus, setDeepseekStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [pollinationsStatus, setPollinationsStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  const testDeepSeek = async () => {
    if (!localDeepSeekKey) return;
    
    setDeepseekStatus('testing');
    try {
      const result = await aiApi.testDeepSeek(localDeepSeekKey);
      setDeepseekStatus(result ? 'success' : 'error');
    } catch (error) {
      setDeepseekStatus('error');
    }
  };

  const testPollinations = async () => {
    setPollinationsStatus('testing');
    try {
      const result = await aiApi.testPollinations(localPollinationsKey || undefined);
      setPollinationsStatus(result ? 'success' : 'error');
    } catch (error) {
      setPollinationsStatus('error');
    }
  };

  const saveKeys = () => {
    setDeepseekKey(localDeepSeekKey);
    setPollinationsKey(localPollinationsKey);
    alert('API密钥已保存');
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">设置</h1>

      <div className="space-y-6">
        {/* DeepSeek API */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Key className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">DeepSeek API</h2>
          </div>
          
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">API Key</label>
                <a
                  href="https://platform.deepseek.com/api_keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                >
                  获取密钥
                  <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              </div>
              <div className="relative">
                <input
                  type={showDeepSeekKey ? 'text' : 'password'}
                  value={localDeepSeekKey}
                  onChange={(e) => setLocalDeepSeekKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 pr-11 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowDeepSeekKey((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  title={showDeepSeekKey ? '隐藏密钥' : '显示密钥'}
                >
                  {showDeepSeekKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <Button onClick={testDeepSeek} loading={deepseekStatus === 'testing'}>
                测试连接
              </Button>
              {deepseekStatus === 'success' && (
                <div className="flex items-center text-green-600 dark:text-green-400">
                  <CheckCircle className="w-4 h-4 mr-1" />
                  <span className="text-sm">连接成功</span>
                </div>
              )}
              {deepseekStatus === 'error' && (
                <div className="flex items-center text-red-600 dark:text-red-400">
                  <XCircle className="w-4 h-4 mr-1" />
                  <span className="text-sm">连接失败</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Pollinations API */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Image className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Pollinations API</h2>
          </div>
          
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">API Key (可选)</label>
                <a
                  href="https://enter.pollinations.ai/"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                >
                  获取密钥
                  <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              </div>
              <div className="relative">
                <input
                  type={showPollinationsKey ? 'text' : 'password'}
                  value={localPollinationsKey}
                  onChange={(e) => setLocalPollinationsKey(e.target.value)}
                  placeholder="pk_... 或 sk_..."
                  className="w-full px-3 py-2 pr-11 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowPollinationsKey((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  title={showPollinationsKey ? '隐藏密钥' : '显示密钥'}
                >
                  {showPollinationsKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            
            <p className="text-sm text-gray-600 dark:text-gray-400">
              注意：不提供API Key也可使用，但会有限流
            </p>
            
            <div className="flex items-center space-x-2">
              <Button onClick={testPollinations} loading={pollinationsStatus === 'testing'}>
                测试连接
              </Button>
              {pollinationsStatus === 'success' && (
                <div className="flex items-center text-green-600 dark:text-green-400">
                  <CheckCircle className="w-4 h-4 mr-1" />
                  <span className="text-sm">连接成功</span>
                </div>
              )}
              {pollinationsStatus === 'error' && (
                <div className="flex items-center text-red-600 dark:text-red-400">
                  <XCircle className="w-4 h-4 mr-1" />
                  <span className="text-sm">连接失败</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={saveKeys}>保存设置</Button>
        </div>
      </div>
    </div>
  );
}

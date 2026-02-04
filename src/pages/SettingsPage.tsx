import { useState } from 'react';
import { useAppStore } from '@store/index';
import { aiApi } from '@services/api';
import { Button } from '@components/Button';
import { Input } from '@components/Input';
import { Key, Image, CheckCircle, XCircle } from 'lucide-react';

export function SettingsPage() {
  const { deepseekKey, pollinationsKey, setDeepseekKey, setPollinationsKey } = useAppStore();
  const [localDeepSeekKey, setLocalDeepSeekKey] = useState(deepseekKey);
  const [localPollinationsKey, setLocalPollinationsKey] = useState(pollinationsKey);
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
            <Input
              label="API Key"
              type="password"
              value={localDeepSeekKey}
              onChange={(e) => setLocalDeepSeekKey(e.target.value)}
              placeholder="sk-..."
            />
            
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
            <Input
              label="API Key (可选)"
              type="password"
              value={localPollinationsKey}
              onChange={(e) => setLocalPollinationsKey(e.target.value)}
              placeholder="pk_... 或 sk_..."
            />
            
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

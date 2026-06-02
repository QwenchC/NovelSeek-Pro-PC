import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAppStore } from '@store/index';
import { aiApi, knowledgeApi, projectApi } from '@services/api';
import { Button } from '@components/Button';
import {
  ArrowLeft, Send, Trash2, MessageCircleQuestion, User, Bot,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSmartBack } from '@utils/useSmartBack';
import { tx } from '@utils/i18n';
import { confirmDialog } from '@utils/index';

function qaSystemPrompt(lang: 'zh' | 'en'): string {
  return lang === 'en'
    ? 'You are an assistant for this novel. Answer the user\'s questions about plot, characters, and settings strictly based on the [Retrieved Context]. If the context is insufficient, say so plainly — do not fabricate. Be concise and accurate, and you may cite chapters.'
    : '你是这部小说的资料助手。请严格依据【检索到的资料】回答用户关于剧情、人物、设定的问题；若资料不足以回答，请直说，不要编造。回答简洁准确，可引用章节。';
}

export function NovelQaPage() {
  const { id } = useParams<{ id: string }>();
  const smartBack = useSmartBack(id ? `/long-novel/${id}` : '/long-novels');
  const {
    uiLanguage,
    currentProject, setCurrentProject,
    textModelConfig, embeddingConfig, knowledgeBaseEnabled,
    getNovelChat, appendNovelChat, clearNovelChat,
  } = useAppStore();

  const [input, setInput] = useState('');
  const [isAnswering, setIsAnswering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = id ? getNovelChat(id) : [];

  const hasValidTextConfig =
    textModelConfig.apiKey.trim().length > 0 &&
    textModelConfig.apiUrl.trim().length > 0 &&
    textModelConfig.model.trim().length > 0;
  const hasValidEmbeddingConfig =
    knowledgeBaseEnabled &&
    embeddingConfig.apiKey.trim().length > 0 &&
    embeddingConfig.apiUrl.trim().length > 0 &&
    embeddingConfig.model.trim().length > 0;

  useEffect(() => {
    if (id) projectApi.getById(id).then(setCurrentProject);
  }, [id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, isAnswering]);

  const ask = async () => {
    const question = input.trim();
    if (!question || !id || isAnswering) return;
    if (!hasValidTextConfig) {
      setError(tx(uiLanguage, '请先在设置中配置文本模型平台', 'Configure a text model platform in Settings first'));
      return;
    }
    setError(null);
    setInput('');
    appendNovelChat(id, {
      id: `msg-${Date.now()}-u`,
      role: 'user',
      content: question,
      createdAt: new Date().toISOString(),
    });
    setIsAnswering(true);

    try {
      // Retrieve fresh context from the local knowledge base (best-effort).
      let context = '';
      if (hasValidEmbeddingConfig) {
        try {
          context = await knowledgeApi.retrieveContext({
            projectId: id,
            query: question,
            topK: 6,
            excludeChapterIds: [],
            embeddingConfig,
            includeSummaries: true,
            includeForeshadowing: true,
          });
        } catch (e) {
          console.warn('[QA] retrieve failed, answering without retrieval:', e);
        }
      }

      const userPrompt = context.trim()
        ? tx(uiLanguage,
            `【检索到的资料】\n${context}\n\n【问题】\n${question}`,
            `[Retrieved Context]\n${context}\n\n[Question]\n${question}`)
        : tx(uiLanguage,
            `（暂无检索资料，请根据常识谨慎回答，并提示用户开启本地知识库以获得基于原文的回答）\n\n【问题】\n${question}`,
            `(No retrieved context — answer cautiously and suggest enabling the local knowledge base for grounded answers)\n\n[Question]\n${question}`);

      const answer = await aiApi.chat(userPrompt, textModelConfig, qaSystemPrompt(uiLanguage));
      appendNovelChat(id, {
        id: `msg-${Date.now()}-a`,
        role: 'assistant',
        content: answer.trim() || tx(uiLanguage, '（无回答）', '(no answer)'),
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e as Error)?.message || tx(uiLanguage, '回答失败', 'Failed to answer');
      setError(msg);
      appendNovelChat(id, {
        id: `msg-${Date.now()}-a`,
        role: 'assistant',
        content: tx(uiLanguage, `（出错：${msg}）`, `(error: ${msg})`),
        createdAt: new Date().toISOString(),
      });
    } finally {
      setIsAnswering(false);
    }
  };

  const handleClear = async () => {
    if (!id || messages.length === 0) return;
    const ok = await confirmDialog(
      tx(uiLanguage, '清空本项目的问答历史？', 'Clear the Q&A history for this project?'),
      tx(uiLanguage, '清空历史', 'Clear History')
    );
    if (ok) clearNovelChat(id);
  };

  if (!id) return null;

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col h-[calc(100vh-7rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3 flex-shrink-0">
        <button onClick={smartBack} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <MessageCircleQuestion className="w-5 h-5 text-blue-600" />
            {tx(uiLanguage, '问小说', 'Ask the Novel')}
          </h1>
          {currentProject && <p className="text-sm text-gray-500">{currentProject.title}</p>}
        </div>
        {messages.length > 0 && (
          <Button variant="outline" onClick={handleClear} className="text-sm">
            <Trash2 className="w-4 h-4 mr-1.5" />
            {tx(uiLanguage, '清空', 'Clear')}
          </Button>
        )}
      </div>

      {!hasValidEmbeddingConfig && (
        <div className="mb-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 flex-shrink-0">
          {tx(
            uiLanguage,
            '提示：开启并配置「本地知识库」后，问答会基于全书检索给出更准确、可溯源的回答。',
            'Tip: enable & configure the Local Knowledge Base in Settings for grounded, source-based answers.'
          )}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <MessageCircleQuestion className="w-12 h-12 mx-auto opacity-40 mb-3" />
            <p className="text-sm">{tx(uiLanguage, '向这部小说提问，例如：主角的动机是什么？某条伏笔回收了吗？', 'Ask anything about this novel — e.g. what is the protagonist\'s motivation?')}</p>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                m.role === 'user' ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-purple-100 dark:bg-purple-900/30'
              }`}>
                {m.role === 'user'
                  ? <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  : <Bot className="w-4 h-4 text-purple-600 dark:text-purple-400" />}
              </div>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200'
              }`}>
                {m.role === 'assistant' ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none break-words">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  </div>
                ) : (
                  <span className="whitespace-pre-wrap break-words">{m.content}</span>
                )}
              </div>
            </div>
          ))
        )}
        {isAnswering && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="rounded-2xl px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
              <span className="inline-flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-500 mt-2 flex-shrink-0">{error}</p>}

      {/* Input */}
      <div className="mt-3 flex gap-2 flex-shrink-0">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
          }}
          rows={2}
          placeholder={tx(uiLanguage, '输入问题，Enter 发送，Shift+Enter 换行', 'Type a question — Enter to send, Shift+Enter for newline')}
          className="flex-1 px-3 py-2 border rounded-xl dark:bg-gray-800 dark:border-gray-600 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
        <Button onClick={ask} disabled={!input.trim() || isAnswering} className="bg-blue-600 hover:bg-blue-700 self-stretch px-4">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useAppStore } from '@store/index';
import { chapterApi, knowledgeApi } from '@services/api';
import { Button } from '@components/Button';
import { BookText } from 'lucide-react';
import { tx } from '@utils/i18n';

interface BookSummaryButtonProps {
  projectId: string;
  projectTitle: string;
  projectDescription?: string | null;
  variant?: 'primary' | 'outline' | 'ghost';
  className?: string;
  /** Compact mode hides the inline status text; show only the button (useful in tight toolbars). */
  compact?: boolean;
}

/**
 * One-click book-summary refresher.
 *
 * Tries to roll up the book summary directly. If no chapter summaries exist yet,
 * it confirms with the user and then auto-builds chapter summaries in sequence
 * before retrying the book summary. Renders nothing if v2 summaries are not
 * enabled or required credentials are missing.
 */
export function BookSummaryButton({
  projectId,
  projectTitle,
  projectDescription,
  variant = 'outline',
  className,
  compact = false,
}: BookSummaryButtonProps) {
  const {
    uiLanguage,
    knowledgeBaseEnabled,
    summariesEnabled,
    textModelConfig,
    embeddingConfig,
  } = useAppStore();

  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState<'idle' | 'progress' | 'success' | 'error'>('idle');

  const isReady =
    knowledgeBaseEnabled &&
    summariesEnabled &&
    textModelConfig.apiKey.trim().length > 0 &&
    textModelConfig.apiUrl.trim().length > 0 &&
    textModelConfig.model.trim().length > 0 &&
    embeddingConfig.apiKey.trim().length > 0;

  if (!isReady) return null;

  const setProgress = (msg: string) => {
    setStatus(msg);
    setStatusKind('progress');
  };

  const handleClick = async () => {
    setIsBusy(true);
    setStatus('');
    setStatusKind('idle');

    // Try the book summary directly first — cheapest path when chapter summaries exist.
    setProgress(tx(uiLanguage, '汇总全书…', 'Aggregating book…'));
    try {
      const s = await knowledgeApi.generateBookSummary({
        projectId,
        bookTitle: projectTitle,
        bookDescription: projectDescription || '',
        textConfig: textModelConfig,
        embeddingConfig,
      });
      setStatus(
        tx(uiLanguage, `已刷新，约 ${s.wordCount} 字`, `Refreshed, ~${s.wordCount} chars`)
      );
      setStatusKind('success');
      setTimeout(() => setStatusKind('idle'), 4000);
      setIsBusy(false);
      return;
    } catch (err) {
      const msg = String(err);
      if (!msg.includes('No chapter or arc summaries')) {
        setStatus(tx(uiLanguage, `失败：${msg}`, `Failed: ${msg}`));
        setStatusKind('error');
        setIsBusy(false);
        return;
      }
      // Fall through: need to bootstrap chapter summaries first.
    }

    // Bootstrap path: build chapter summaries, then retry book summary.
    let eligibleCount = 0;
    try {
      const chapters = await chapterApi.getByProject(projectId);
      const eligible = chapters.filter(
        (c) => (c.final_text || c.draft_text || '').trim().length > 200
      );
      eligibleCount = eligible.length;

      if (eligibleCount === 0) {
        setStatus(
          tx(
            uiLanguage,
            '没有可用章节（每章需 >200 字）',
            'No eligible chapters (need >200 chars each)'
          )
        );
        setStatusKind('error');
        setIsBusy(false);
        return;
      }

      const confirmed = window.confirm(
        tx(
          uiLanguage,
          `首次刷新需要先为 ${eligibleCount} 个章节生成摘要（按文本模型平台计费，约 ¥${(eligibleCount * 0.005).toFixed(2)}）。继续？`,
          `First refresh needs ${eligibleCount} chapter summaries (billed via text model, ≈ ¥${(eligibleCount * 0.005).toFixed(2)}). Continue?`
        )
      );
      if (!confirmed) {
        setStatus('');
        setStatusKind('idle');
        setIsBusy(false);
        return;
      }

      let done = 0;
      let failed = 0;
      for (const c of eligible) {
        setProgress(
          tx(
            uiLanguage,
            `章节摘要 ${done + 1}/${eligibleCount}：${c.title}`,
            `Chapter ${done + 1}/${eligibleCount}: ${c.title}`
          )
        );
        try {
          await knowledgeApi.generateChapterSummary({
            projectId,
            chapterId: c.id,
            chapterTitle: c.title,
            chapterText: c.final_text || c.draft_text || '',
            textConfig: textModelConfig,
            embeddingConfig,
          });
        } catch (e) {
          console.warn(`[KB] Chapter summary for ${c.id} failed:`, e);
          failed += 1;
        }
        done += 1;
      }

      if (done - failed === 0) {
        setStatus(tx(uiLanguage, '全部章节摘要生成失败', 'All chapter summaries failed'));
        setStatusKind('error');
        setIsBusy(false);
        return;
      }

      setProgress(tx(uiLanguage, '汇总全书…', 'Aggregating book…'));
      const s = await knowledgeApi.generateBookSummary({
        projectId,
        bookTitle: projectTitle,
        bookDescription: projectDescription || '',
        textConfig: textModelConfig,
        embeddingConfig,
      });
      setStatus(
        tx(
          uiLanguage,
          `完成。${done - failed}/${eligibleCount} 章摘要 + 全书梗概 (约 ${s.wordCount} 字)`,
          `Done. ${done - failed}/${eligibleCount} chapter summaries + book summary (~${s.wordCount} chars)`
        )
      );
      setStatusKind('success');
      setTimeout(() => setStatusKind('idle'), 5000);
    } catch (err) {
      console.error('[KB] Book summary refresh failed:', err);
      setStatus(tx(uiLanguage, `失败：${String(err)}`, `Failed: ${String(err)}`));
      setStatusKind('error');
    } finally {
      setIsBusy(false);
    }
  };

  const statusColor =
    statusKind === 'error'
      ? 'text-red-600 dark:text-red-400'
      : statusKind === 'success'
        ? 'text-green-600 dark:text-green-400'
        : 'text-gray-500 dark:text-gray-400';

  return (
    <div className={`flex items-center gap-2 ${className || ''}`}>
      <Button
        variant={variant}
        onClick={handleClick}
        loading={isBusy}
        className="text-sm"
        title={tx(uiLanguage, '基于已有章节汇总本书梗概，建议每 5-10 章刷新一次', 'Roll up book synopsis from chapter summaries; refresh every 5–10 chapters')}
      >
        <BookText className="w-4 h-4 mr-1.5" />
        {tx(uiLanguage, '刷新全书梗概', 'Refresh Synopsis')}
      </Button>
      {!compact && status && (
        <span className={`text-xs ${statusColor} truncate max-w-[280px]`} title={status}>
          {status}
        </span>
      )}
    </div>
  );
}

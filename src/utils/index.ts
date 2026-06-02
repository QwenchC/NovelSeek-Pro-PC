import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatWordCount(count: number): string {
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}万字`;
  }
  return `${count}字`;
}

/**
 * Resolve a chapter's place in the project → 副本 → 弧线 → 章节 hierarchy.
 * Matches by `arc_id` first, then falls back to an arc's `builtChapterIds`. Structurally typed so
 * it doesn't depend on the store module.
 */
export function chapterStructureLabel(
  chapterId: string,
  arcId: string | null | undefined,
  arcs: { id: string; title: string; volumeId?: string; builtChapterIds?: string[] }[],
  volumes: { id: string; name: string; order?: number }[]
): { volume: string | null; arc: string | null } {
  const arc =
    (arcId ? arcs.find((a) => a.id === arcId) : undefined) ||
    arcs.find((a) => a.builtChapterIds?.includes(chapterId)) ||
    null;
  const volume = arc?.volumeId ? volumes.find((v) => v.id === arc.volumeId) ?? null : null;
  return { volume: volume?.name ?? null, arc: arc?.title ?? null };
}

/**
 * Strip a stray leading chapter heading/title line that models sometimes prepend to the body
 * (e.g. "第3章 风起" / "Chapter 3" / "# 标题" / "标题：…" / a short line equal to the chapter title).
 * Only removes ONE clearly-heading-like leading line so it never eats real prose.
 */
export function stripChapterHeading(text: string, title?: string): string {
  if (!text) return text;
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i >= lines.length) return text;
  const first = lines[i].trim();
  const cleanTitle = (title || '').trim();
  const norm = (s: string) => s.replace(/[#*\s《》「」"'：:.,，。、~～\-—()（）【】]/g, '');
  const looksLikeHeading =
    /^#{1,6}\s/.test(first) ||
    /^第\s*[0-9〇零一二三四五六七八九十百千两]+\s*[章节回]/.test(first) ||
    /^chapter\s+\d+/i.test(first) ||
    /^(标题|title)\s*[：:]/i.test(first) ||
    (cleanTitle.length > 0 && first.length <= cleanTitle.length + 10 && first.length < 40 && norm(first).includes(norm(cleanTitle)) && norm(cleanTitle).length > 0);
  if (!looksLikeHeading) return text;
  lines.splice(0, i + 1);
  while (lines.length && !lines[0].trim()) lines.shift();
  return lines.join('\n');
}

export function calculateProgress(current: number, target: number): number {
  if (target === 0) return 0;
  return Math.min(Math.round((current / target) * 100), 100);
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}

export async function confirmDialog(message: string, title = '确认'): Promise<boolean> {
  // Centered in-app modal (see components/uiDialog). Dynamic import avoids a static import cycle.
  const { uiConfirm } = await import('@components/uiDialog');
  return uiConfirm({ title, message });
}

export async function alertDialog(message: string, title = '提示'): Promise<void> {
  const { uiAlert } = await import('@components/uiDialog');
  return uiAlert({ title, message });
}

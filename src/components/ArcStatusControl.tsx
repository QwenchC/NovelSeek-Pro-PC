import type { PlotArc } from '@store/index';
import { cn } from '@utils/index';

// 3-state manual progress control (未开始 / 进行中 / 已完成), mirroring the Android arc status
// toggle. The model also has a transient 'ending' status — it's shown as 进行中 here and any
// click resets to one of the three canonical states.
const OPTIONS: { value: 'upcoming' | 'active' | 'completed'; zh: string; en: string }[] = [
  { value: 'upcoming', zh: '未开始', en: 'Upcoming' },
  { value: 'active', zh: '进行中', en: 'Active' },
  { value: 'completed', zh: '已完成', en: 'Completed' },
];

function activeClass(value: string): string {
  if (value === 'completed') return 'bg-green-500 text-white';
  if (value === 'active') return 'bg-blue-500 text-white';
  return 'bg-gray-400 text-white';
}

export function ArcStatusControl({
  status,
  uiLanguage,
  onChange,
  className,
}: {
  status: PlotArc['status'];
  uiLanguage: 'zh' | 'en';
  onChange: (status: PlotArc['status']) => void;
  className?: string;
}) {
  const current = status === 'ending' ? 'active' : status;
  return (
    <div className={cn('inline-flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden', className)}>
      {OPTIONS.map((o, i) => (
        <button
          key={o.value}
          onClick={(e) => { e.stopPropagation(); onChange(o.value); }}
          className={cn(
            'px-2.5 py-1 text-xs font-medium transition-colors',
            i > 0 && 'border-l border-gray-200 dark:border-gray-600',
            current === o.value
              ? activeClass(o.value)
              : 'bg-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
          )}
        >
          {uiLanguage === 'zh' ? o.zh : o.en}
        </button>
      ))}
    </div>
  );
}

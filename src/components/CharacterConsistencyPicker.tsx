import type { Character } from '@store/index';
import { tx } from '@utils/i18n';

/**
 * Format the picked characters into the "- name：appearance" block that the image-prompt builders
 * consume, so generated images depict those characters with their saved appearance (consistency).
 * Mirrors Android `buildCharactersInfo`.
 */
export function buildCharactersInfo(characters: Character[], selectedIds: Set<string>): string | null {
  const picked = characters.filter((c) => selectedIds.has(c.id));
  if (picked.length === 0) return null;
  return picked
    .map((c) => (c.appearance?.trim() ? `- ${c.name}：${c.appearance.trim()}` : `- ${c.name}`))
    .join('\n');
}

/**
 * Multi-select chip row for "character consistency" in image-generation dialogs. Pick the characters
 * that appear in the picture; their appearance is injected into the prompt to keep them on-model.
 * Mirrors Android `CharacterConsistencyPicker`.
 */
export function CharacterConsistencyPicker({
  characters,
  selectedIds,
  onToggle,
  uiLanguage,
}: {
  characters: Character[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  uiLanguage: 'zh' | 'en';
}) {
  const missing = characters.filter((c) => selectedIds.has(c.id) && !c.appearance?.trim());
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-purple-600 dark:text-purple-400">
        {tx(uiLanguage, '人物一致性（可选，可多选；建议只选一个）', 'Character consistency (optional, multi-select; one recommended)')}
      </p>
      {characters.length === 0 ? (
        <p className="text-xs text-gray-400">
          {tx(uiLanguage, '本项目暂无角色，可在「角色」页添加。', 'No characters yet — add some on the Characters page.')}
        </p>
      ) : (
        <div className="flex gap-1.5 flex-wrap max-h-24 overflow-y-auto pr-1">
          {characters.map((c) => {
            const active = selectedIds.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onToggle(c.id)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  active
                    ? 'bg-purple-600 border-purple-600 text-white'
                    : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-purple-400'
                }`}
                title={c.appearance?.trim() || tx(uiLanguage, '（暂无外貌描述）', '(no appearance yet)')}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}
      {missing.length > 0 && (
        <p className="text-xs text-red-500">
          {tx(uiLanguage,
            `⚠ ${missing.map((c) => c.name).join('、')} 尚无「外貌」描述，一致性效果有限。`,
            `⚠ ${missing.map((c) => c.name).join(', ')} lack an appearance description — consistency will be limited.`)}
        </p>
      )}
    </div>
  );
}

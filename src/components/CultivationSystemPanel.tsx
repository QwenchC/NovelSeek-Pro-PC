import { useMemo, useState } from 'react';
import { useAppStore, CultivationRealm, CharacterRealmEvent } from '@store/index';
import { Button } from '@components/Button';
import type { Chapter } from '@typings/index';
import {
  X, Mountain, Users, Plus, Trash2, ArrowUp, ArrowDown,
  ChevronLeft, Star, Sparkles,
} from 'lucide-react';
import { tx } from '@utils/i18n';
import { computeCurrentRealm } from '@utils/cultivation';

interface CultivationSystemPanelProps {
  projectId: string;
  /** Chapters of this project, already loaded by the caller. */
  chapters: Chapter[];
  onClose: () => void;
}

type TabId = 'realms' | 'characters';

/**
 * Modal panel for managing the project's cultivation realm system.
 *
 * Tab 1 ("修炼境界表"): user-defined ordered list of realms.
 * Tab 2 ("主要角色境界"): character → current realm grid + per-character
 * advancement history. Current realm is derived from the latest realm event
 * whose chapter still exists in the project (deleted chapters are ignored).
 */
export function CultivationSystemPanel({ projectId, chapters, onClose }: CultivationSystemPanelProps) {
  const {
    uiLanguage,
    getCultivationRealms, setCultivationRealms,
    getCharacterRealmEvents, addCharacterRealmEvent, deleteCharacterRealmEvent,
    getCharacters,
  } = useAppStore();

  const [tab, setTab] = useState<TabId>('realms');
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);

  const realms = getCultivationRealms(projectId);
  const events = getCharacterRealmEvents(projectId);
  const characters = getCharacters(projectId);

  // Quick chapter lookup; used to resolve / filter out orphan events.
  const chapterMap = useMemo(() => {
    const m = new Map<string, Chapter>();
    for (const c of chapters) m.set(c.id, c);
    return m;
  }, [chapters]);

  // Realm name lookup for display.
  const realmMap = useMemo(() => {
    const m = new Map<string, CultivationRealm>();
    for (const r of realms) m.set(r.id, r);
    return m;
  }, [realms]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {tx(uiLanguage, '境界系统', 'Cultivation System')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <TabButton
            active={tab === 'realms'}
            onClick={() => { setTab('realms'); setSelectedCharacterId(null); }}
            icon={<Mountain className="w-4 h-4" />}
            label={tx(uiLanguage, '修炼境界表', 'Realm Ladder')}
            count={realms.length}
          />
          <TabButton
            active={tab === 'characters'}
            onClick={() => setTab('characters')}
            icon={<Users className="w-4 h-4" />}
            label={tx(uiLanguage, '主要角色境界', 'Character Realms')}
            count={characters.length}
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'realms' && (
            <RealmsTab
              uiLanguage={uiLanguage}
              realms={realms}
              onChange={(next) => setCultivationRealms(projectId, next)}
              referencedRealmIds={new Set(events.map((e) => e.realmId))}
            />
          )}
          {tab === 'characters' && (
            selectedCharacterId ? (
              <CharacterDetailView
                uiLanguage={uiLanguage}
                characterId={selectedCharacterId}
                characters={characters}
                realms={realms}
                events={events}
                chapters={chapters}
                chapterMap={chapterMap}
                realmMap={realmMap}
                onBack={() => setSelectedCharacterId(null)}
                onAddEvent={(payload) => addCharacterRealmEvent(projectId, payload)}
                onDeleteEvent={(eventId) => deleteCharacterRealmEvent(projectId, eventId)}
              />
            ) : (
              <CharactersGridView
                uiLanguage={uiLanguage}
                characters={characters}
                realms={realms}
                events={events}
                chapterMap={chapterMap}
                realmMap={realmMap}
                onSelect={setSelectedCharacterId}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tab button ────────────────────────────────────────────────

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}

function TabButton({ active, onClick, icon, label, count }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-amber-500 text-amber-700 dark:text-amber-400'
          : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
      }`}
    >
      {icon}
      <span>{label}</span>
      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
        active
          ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
      }`}>
        {count}
      </span>
    </button>
  );
}

// ── Tab 1: realms editor ──────────────────────────────────────

interface RealmsTabProps {
  uiLanguage: 'zh' | 'en';
  realms: CultivationRealm[];
  onChange: (next: CultivationRealm[]) => void;
  referencedRealmIds: Set<string>;
}

function RealmsTab({ uiLanguage, realms, onChange, referencedRealmIds }: RealmsTabProps) {
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');

  const addRealm = () => {
    const name = draftName.trim();
    if (!name) return;
    const maxOrder = realms.reduce((acc, r) => Math.max(acc, r.order), -1);
    const next: CultivationRealm = {
      id: `realm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      order: maxOrder + 1,
      name,
      description: draftDesc.trim() || undefined,
    };
    onChange([...realms, next]);
    setDraftName('');
    setDraftDesc('');
  };

  const updateRealm = (id: string, patch: Partial<CultivationRealm>) => {
    onChange(realms.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const move = (id: string, dir: -1 | 1) => {
    const sorted = [...realms].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((r) => r.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[swap];
    onChange(realms.map((r) => {
      if (r.id === a.id) return { ...r, order: b.order };
      if (r.id === b.id) return { ...r, order: a.order };
      return r;
    }));
  };

  const removeRealm = (id: string) => {
    const realm = realms.find((r) => r.id === id);
    if (!realm) return;
    if (referencedRealmIds.has(id)) {
      const ok = window.confirm(
        tx(uiLanguage,
          `境界「${realm.name}」已被角色进阶事件引用。删除会一并清除这些事件，确定继续？`,
          `Realm "${realm.name}" is referenced by character advancement events. Deleting will also remove those events. Continue?`)
      );
      if (!ok) return;
    }
    onChange(realms.filter((r) => r.id !== id));
    // Note: we don't touch events here — they keep dangling realmIds and simply
    // won't render. Cleaner than mutating two stores at once from a child component.
  };

  const sorted = [...realms].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
        {tx(uiLanguage,
          '为本书定义修炼境界阶梯，由低到高排列。例如：炼气期一层 → 炼气期二层 → 筑基初期 → 筑基中期 → ……',
          'Define this novel\'s cultivation ladder, weakest to strongest. e.g. Qi Refining I → Qi Refining II → Foundation Establishment Early → ...')}
      </p>

      {/* Add new */}
      <div className="border border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-3">
        <div className="flex flex-col md:flex-row gap-2">
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addRealm(); }}
            placeholder={tx(uiLanguage, '境界名称（必填）', 'Realm name (required)')}
            className="flex-1 px-3 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          />
          <input
            value={draftDesc}
            onChange={(e) => setDraftDesc(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addRealm(); }}
            placeholder={tx(uiLanguage, '简短描述（可选）', 'Short description (optional)')}
            className="flex-[2] px-3 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          />
          <Button onClick={addRealm} disabled={!draftName.trim()} className="text-sm py-1.5">
            <Plus className="w-4 h-4 mr-1" />
            {tx(uiLanguage, '添加', 'Add')}
          </Button>
        </div>
      </div>

      {/* List */}
      {sorted.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-500 dark:text-gray-400">
          {tx(uiLanguage, '还没有境界，先在上方添加第一个。', 'No realms yet. Add the first one above.')}
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((r, idx) => (
            <div
              key={r.id}
              className="flex items-start gap-2 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40"
            >
              <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 text-xs font-semibold">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0 space-y-1">
                <input
                  value={r.name}
                  onChange={(e) => updateRealm(r.id, { name: e.target.value })}
                  className="w-full px-2 py-1 text-sm font-medium border-0 bg-transparent focus:bg-white dark:focus:bg-gray-800 rounded focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-900 dark:text-white"
                />
                <input
                  value={r.description || ''}
                  onChange={(e) => updateRealm(r.id, { description: e.target.value || undefined })}
                  placeholder={tx(uiLanguage, '描述（可选）', 'Description (optional)')}
                  className="w-full px-2 py-1 text-xs border-0 bg-transparent focus:bg-white dark:focus:bg-gray-800 rounded focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-600 dark:text-gray-400"
                />
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => move(r.id, -1)}
                  disabled={idx === 0}
                  className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-gray-600 dark:text-gray-400"
                  title={tx(uiLanguage, '上移', 'Move up')}
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button
                  onClick={() => move(r.id, 1)}
                  disabled={idx === sorted.length - 1}
                  className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-gray-600 dark:text-gray-400"
                  title={tx(uiLanguage, '下移', 'Move down')}
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
                <button
                  onClick={() => removeRealm(r.id)}
                  className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600"
                  title={tx(uiLanguage, '删除境界', 'Delete realm')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab 2 / list view: characters grid ────────────────────────

interface CharactersGridViewProps {
  uiLanguage: 'zh' | 'en';
  characters: ReturnType<ReturnType<typeof useAppStore.getState>['getCharacters']>;
  realms: CultivationRealm[];
  events: CharacterRealmEvent[];
  chapterMap: Map<string, Chapter>;
  realmMap: Map<string, CultivationRealm>;
  onSelect: (characterId: string) => void;
}

function CharactersGridView({
  uiLanguage, characters, realms, events, chapterMap, realmMap, onSelect,
}: CharactersGridViewProps) {
  if (characters.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-gray-500 dark:text-gray-400">
        {tx(uiLanguage,
          '本项目暂无角色。请先在「角色」页面添加角色。',
          'No characters in this project yet. Add characters from the "Characters" page first.')}
      </div>
    );
  }

  if (realms.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-gray-500 dark:text-gray-400">
        {tx(uiLanguage,
          '请先在「修炼境界表」标签里定义境界，再回来这里记录角色进阶。',
          'Define the realm ladder in the first tab before tracking character advancement here.')}
      </div>
    );
  }

  // Sort: protagonist first, then by name
  const sorted = [...characters].sort((a, b) => {
    if (a.isProtagonist !== b.isProtagonist) return a.isProtagonist ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {tx(uiLanguage,
          '点击角色卡片查看该角色的全部进阶记录。当前境界基于该角色"最新仍存在的章节"自动计算。',
          'Click a character to view their full advancement history. Current realm is auto-computed from the latest still-existing chapter.')}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {sorted.map((char) => {
          const { realm, chapter } = computeCurrentRealm(char.id, events, chapterMap, realmMap);
          return (
            <button
              key={char.id}
              onClick={() => onSelect(char.id)}
              className="text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-amber-400 dark:hover:border-amber-600 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  {char.isProtagonist && <Star className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
                  <span className="font-medium text-gray-900 dark:text-white truncate">{char.name}</span>
                </div>
              </div>
              <div className="mt-2 text-xs">
                {realm ? (
                  <div className="space-y-0.5">
                    <div className="text-amber-700 dark:text-amber-400 font-medium">{realm.name}</div>
                    <div className="text-gray-500 dark:text-gray-400">
                      {chapter
                        ? tx(uiLanguage, `于第${chapter.order_index}章「${chapter.title}」达成`,
                            `Reached in Ch.${chapter.order_index} "${chapter.title}"`)
                        : ''}
                    </div>
                  </div>
                ) : (
                  <span className="text-gray-400 dark:text-gray-500 italic">
                    {tx(uiLanguage, '未设定境界', 'No realm set')}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Tab 2 / detail view: one character's full history ─────────

interface CharacterDetailViewProps {
  uiLanguage: 'zh' | 'en';
  characterId: string;
  characters: ReturnType<ReturnType<typeof useAppStore.getState>['getCharacters']>;
  realms: CultivationRealm[];
  events: CharacterRealmEvent[];
  chapters: Chapter[];
  chapterMap: Map<string, Chapter>;
  realmMap: Map<string, CultivationRealm>;
  onBack: () => void;
  onAddEvent: (payload: Omit<CharacterRealmEvent, 'id'>) => void;
  onDeleteEvent: (eventId: string) => void;
}

function CharacterDetailView({
  uiLanguage, characterId, characters, realms, events, chapters, chapterMap, realmMap,
  onBack, onAddEvent, onDeleteEvent,
}: CharacterDetailViewProps) {
  const character = characters.find((c) => c.id === characterId);
  const [draftRealmId, setDraftRealmId] = useState<string>('');
  const [draftChapterId, setDraftChapterId] = useState<string>('');
  const [draftNote, setDraftNote] = useState('');

  const charEvents = events
    .filter((e) => e.characterId === characterId)
    .map((e) => {
      const c = chapterMap.get(e.chapterId);
      const realm = realmMap.get(e.realmId);
      return {
        ...e,
        chapterExists: !!c,
        chapterTitle: c?.title ?? '',
        liveOrderIndex: c ? c.order_index : e.chapterOrderIndex,
        realmName: realm?.name ?? '?',
        realmExists: !!realm,
      };
    })
    .sort((a, b) => a.liveOrderIndex - b.liveOrderIndex);

  if (!character) {
    return (
      <div className="text-center py-10 text-sm text-gray-500 dark:text-gray-400">
        {tx(uiLanguage, '角色不存在', 'Character not found')}
      </div>
    );
  }

  const handleAdd = () => {
    if (!draftRealmId || !draftChapterId) return;
    const ch = chapters.find((c) => c.id === draftChapterId);
    if (!ch) return;
    onAddEvent({
      characterId,
      realmId: draftRealmId,
      chapterId: draftChapterId,
      chapterOrderIndex: ch.order_index,
      note: draftNote.trim() || undefined,
    });
    setDraftNote('');
    // Keep realmId/chapterId selections for quick repeat add
  };

  const sortedChapters = [...chapters].sort((a, b) => a.order_index - b.order_index);

  return (
    <div className="space-y-4">
      {/* Header with back button */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          <ChevronLeft className="w-4 h-4" />
          {tx(uiLanguage, '返回角色列表', 'Back to characters')}
        </button>
        <div className="flex items-center gap-1.5">
          {character.isProtagonist && <Star className="w-4 h-4 text-amber-500" />}
          <h3 className="font-semibold text-gray-900 dark:text-white">{character.name}</h3>
          {character.role && <span className="text-xs text-gray-500 dark:text-gray-400">— {character.role}</span>}
        </div>
      </div>

      {/* Add advancement form */}
      <div className="border border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-3 space-y-2">
        <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
          {tx(uiLanguage, '记录新的境界进阶', 'Record a new advancement')}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <select
            value={draftRealmId}
            onChange={(e) => setDraftRealmId(e.target.value)}
            className="px-3 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          >
            <option value="">{tx(uiLanguage, '选择境界…', 'Select realm...')}</option>
            {[...realms].sort((a, b) => a.order - b.order).map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <select
            value={draftChapterId}
            onChange={(e) => setDraftChapterId(e.target.value)}
            className="px-3 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          >
            <option value="">{tx(uiLanguage, '选择章节…', 'Select chapter...')}</option>
            {sortedChapters.map((c) => (
              <option key={c.id} value={c.id}>
                {tx(uiLanguage, `第${c.order_index}章 ${c.title}`, `Ch.${c.order_index} ${c.title}`)}
              </option>
            ))}
          </select>
        </div>
        <input
          value={draftNote}
          onChange={(e) => setDraftNote(e.target.value)}
          placeholder={tx(uiLanguage, '备注（可选，例如"得到机缘后"）', 'Note (optional, e.g. "after gaining the inheritance")')}
          className="w-full px-3 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
        />
        <div className="flex justify-end">
          <Button
            onClick={handleAdd}
            disabled={!draftRealmId || !draftChapterId}
            className="text-sm py-1.5"
          >
            <Plus className="w-4 h-4 mr-1" />
            {tx(uiLanguage, '添加进阶', 'Add Advancement')}
          </Button>
        </div>
      </div>

      {/* History list */}
      <div>
        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
          {tx(uiLanguage, `进阶历史（${charEvents.length} 条）`, `Advancement history (${charEvents.length})`)}
        </div>
        {charEvents.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
            {tx(uiLanguage, '该角色暂无进阶记录。', 'No advancements recorded for this character.')}
          </div>
        ) : (
          <ol className="space-y-2">
            {charEvents.map((ev, idx) => (
              <li
                key={ev.id}
                className="flex items-start gap-3 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40"
              >
                <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 text-xs font-semibold">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-amber-700 dark:text-amber-400">
                      {ev.realmExists ? ev.realmName : tx(uiLanguage, `（已删除的境界）`, '(deleted realm)')}
                    </span>
                    {ev.chapterExists ? (
                      <span className="text-xs text-gray-600 dark:text-gray-400">
                        {tx(uiLanguage,
                          `第${ev.liveOrderIndex}章「${ev.chapterTitle}」`,
                          `Ch.${ev.liveOrderIndex} "${ev.chapterTitle}"`)}
                      </span>
                    ) : (
                      <span className="text-xs text-red-500 italic">
                        {tx(uiLanguage,
                          `（章节已删除，原第${ev.chapterOrderIndex}章）`,
                          `(chapter deleted, was Ch.${ev.chapterOrderIndex})`)}
                      </span>
                    )}
                  </div>
                  {ev.note && (
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{ev.note}</div>
                  )}
                </div>
                <button
                  onClick={() => onDeleteEvent(ev.id)}
                  className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 flex-shrink-0"
                  title={tx(uiLanguage, '删除该记录', 'Delete this record')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

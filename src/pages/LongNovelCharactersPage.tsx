import { useState, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useAppStore } from '@store/index';
import type { Character, CharacterRelationship, CharacterEvent, PlotArc, CharacterGrowthEntry } from '@store/index';
import { Button } from '@components/Button';
import { uiConfirm } from '@components/uiDialog';
import {
  ArrowLeft, Plus, Edit2, Trash2, Users, Network,
  Clock, Save, X, Star, ChevronDown, ChevronUp, Sparkles, StopCircle, Sprout,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { tx } from '@utils/i18n';
import { useSmartBack } from '@utils/useSmartBack';
import { buildRealmSystemContext } from '@utils/cultivation';

/** A portrait may be a full data URL (newly generated / normalized import) or raw base64 (legacy /
 *  Android import). Return a directly-usable <img src>; never double-prefix. */
function portraitSrc(b64?: string | null): string {
  if (!b64) return '';
  return /^(data:|https?:|blob:)/.test(b64) ? b64 : `data:image/png;base64,${b64}`;
}

// ── AI output parsers ─────────────────────────────────────────────
/**
 * Extract every COMPLETE top-level `{...}` object from a (possibly truncated) JSON-ish blob.
 * Tracks string/escape state and brace depth, so a cut-off trailing object (common when the model
 * hits its token limit) is simply dropped while all preceding complete objects are recovered.
 */
function extractJsonObjects(text: string): any[] {
  const out: any[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') {
      if (depth > 0) depth--;
      if (depth === 0 && start >= 0) {
        try { out.push(JSON.parse(text.slice(start, i + 1))); } catch { /* skip */ }
        start = -1;
      }
    }
  }
  return out;
}

/**
 * Parse characters from the AI's outline analysis. Prefers a rich JSON array (name / gender /
 * isProtagonist / role / personality / motivation / background / appearance, each detailed —
 * mirrors the Android app); recovers complete objects even if the JSON was truncated; falls back
 * to the legacy pipe-delimited format.
 */
/**
 * Last-resort tolerant extractor for malformed JSON (e.g. a key missing its opening quote, an
 * unclosed trailing object). Splits into per-character blocks at each `name` key and pulls each
 * field with a quote-optional regex, so a partially-corrupt stream still yields usable characters.
 */
function parseCharsTolerant(text: string): Omit<Character, 'id'>[] {
  const fieldVal = (block: string, key: string): string => {
    const m = block.match(new RegExp(`"?${key}"?\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'i'));
    return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, ' ').trim() : '';
  };
  const starts: number[] = [];
  const nameRe = /"?name"?\s*:\s*"/g;
  let mm: RegExpExecArray | null;
  while ((mm = nameRe.exec(text))) starts.push(mm.index);
  const out: Omit<Character, 'id'>[] = [];
  for (let i = 0; i < starts.length; i++) {
    const block = text.slice(starts[i], starts[i + 1] ?? text.length);
    const name = fieldVal(block, 'name');
    if (!name) continue;
    out.push({
      name,
      gender: fieldVal(block, 'gender'),
      role: fieldVal(block, 'role'),
      personality: fieldVal(block, 'personality'),
      motivation: fieldVal(block, 'motivation'),
      background: fieldVal(block, 'background'),
      appearance: fieldVal(block, 'appearance'),
      isProtagonist: /"?isProtagonist"?\s*:\s*(?:"?true"?|1)/i.test(block),
    });
  }
  return out;
}

function parseCharactersFromAI(text: string): Omit<Character, 'id'>[] {
  const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
  const stripped = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const objs = extractJsonObjects(stripped).filter((o) => o && typeof o.name === 'string' && o.name.trim());
  if (objs.length) {
    return objs.map((o) => ({
      name: s(o.name),
      gender: s(o.gender),
      role: s(o.role),
      personality: s(o.personality),
      motivation: s(o.motivation),
      background: s(o.background),
      appearance: s(o.appearance),
      isProtagonist: o.isProtagonist === true || s(o.isProtagonist).toLowerCase() === 'true',
    }));
  }
  // Tolerant pass for malformed/corrupt JSON (recovers what it can).
  const tol = parseCharsTolerant(stripped);
  if (tol.length) return tol;
  // Legacy pipe-delimited fallback: name | gender | role | personality | motivation | background
  const result: Omit<Character, 'id'>[] = [];
  for (const line of text.split('\n')) {
    const raw = line.replace(/^[-*\d.\s]+/, '').trim();
    if (!raw.includes('|')) continue;
    const [name = '', gender = '', role = '', personality = '', motivation = '', background = ''] =
      raw.split('|').map((x) => x.trim());
    if (!name) continue;
    result.push({ name, gender, role, personality, motivation, background, appearance: '', isProtagonist: false });
  }
  return result;
}
function parseAIRelationships(text: string, characters: Character[]): CharacterRelationship[] {
  const nameToId: Record<string, string> = {};
  characters.forEach((c) => { nameToId[c.name] = c.id; });
  const result: CharacterRelationship[] = [];
  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    const raw = line.replace(/^[-*\d.\s]+/, '').trim();
    if (!raw.includes('|')) continue;
    const [a, type, b, desc = ''] = raw.split('|').map((s) => s.trim());
    const fromId = nameToId[a];
    const toId = nameToId[b];
    if (!fromId || !toId || fromId === toId) continue;
    const key = [fromId, toId].sort().join('-');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ id: `rel-ai-${Date.now()}-${result.length}`, fromCharId: fromId, toCharId: toId, type: type || '', description: desc });
  }
  return result;
}

function parseAIEvents(
  text: string,
  characters: Character[],
  arcs: PlotArc[],
): Omit<CharacterEvent, 'id'>[] {
  const nameToId: Record<string, string> = {};
  characters.forEach((c) => { nameToId[c.name] = c.id; });
  const arcTitleToId: Record<string, string> = {};
  arcs.forEach((a) => { arcTitleToId[a.title] = a.id; });
  const result: Omit<CharacterEvent, 'id'>[] = [];
  let idx = 1;
  for (const line of text.split('\n')) {
    const raw = line.replace(/^[-*\d.\s]+/, '').trim();
    if (!raw.includes('|')) continue;
    const [charName, arcTitle = '', title = '', desc = ''] = raw.split('|').map((s) => s.trim());
    const charId = nameToId[charName];
    if (!charId || !title) continue;
    result.push({
      characterId: charId,
      arcId: arcTitleToId[arcTitle] || '',
      chapterIndex: idx++,
      chapterTitle: '',
      title,
      description: desc,
    });
  }
  return result;
}
const RELATIONSHIP_TYPES_ZH = ['朋友', '敌人', '师徒', '恋人', '家人', '同伴', '对立', '主仆', '盟友', '竞争'];
const RELATIONSHIP_TYPES_EN = ['Friends', 'Enemies', 'Master/Disciple', 'Lovers', 'Family', 'Comrades', 'Rivals', 'Master/Servant', 'Allies', 'Competitors'];

// ── Relationship type colors ────────────────────────────────────
const REL_TYPE_COLOR: Record<string, string> = {
  朋友: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  敌人: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  师徒: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  恋人: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  家人: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  同伴: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  对立: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  主仆: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  盟友: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  竞争: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
};
const DEFAULT_REL_COLOR = 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';

function relColor(type: string) {
  return REL_TYPE_COLOR[type] ?? DEFAULT_REL_COLOR;
}

export function LongNovelCharactersPage() {
  const { id } = useParams<{ id: string }>();
  const smartBack = useSmartBack(id ? `/long-novel/${id}` : '/long-novels');
  const {
    uiLanguage,
    getCharacters, setCharacters,
    getCharacterRelationships, setCharacterRelationships,
    getCharacterEvents, addCharacterEvent, deleteCharacterEvent, setCharacterEvents,
    getPlotArcs,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<'characters' | 'network' | 'events' | 'growth'>('characters');
  const [editingChar, setEditingChar] = useState<Character | null>(null);
  const [showCharForm, setShowCharForm] = useState(false);

  const characters = id ? getCharacters(id) : [];
  const relationships: CharacterRelationship[] = id ? getCharacterRelationships(id) : [];
  const events: CharacterEvent[] = id ? getCharacterEvents(id) : [];
  const arcs: PlotArc[] = id ? getPlotArcs(id) : [];

  const handleDeleteChar = async (charId: string) => {
    if (!id) return;
    const ok = await uiConfirm({ title: tx(uiLanguage, '删除角色', 'Delete character'), message: tx(uiLanguage, '确定删除此角色？相关关系和事件也会一并删除。', 'Delete this character? Related relationships and events will also be removed.'), danger: true });
    if (!ok) return;
    setCharacters(id, characters.filter((c) => c.id !== charId));
    // Remove related relationships
    const updated = relationships.filter((r) => r.fromCharId !== charId && r.toCharId !== charId);
    setCharacterRelationships(id, updated);
  };

  return (
    <div className="w-full max-w-[1700px] mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={smartBack}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
          {tx(uiLanguage, '角色管理', 'Characters')}
        </h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-700/50 rounded-xl p-1">
        {([
          { key: 'characters', label: tx(uiLanguage, '角色列表', 'Characters'), icon: Users },
          { key: 'network', label: tx(uiLanguage, '关系网络', 'Relationship Network'), icon: Network },
          { key: 'events', label: tx(uiLanguage, '事件时间线', 'Event Timeline'), icon: Clock },
          { key: 'growth', label: tx(uiLanguage, '成长路线', 'Growth'), icon: Sprout },
        ] as { key: string; label: string; icon: React.ComponentType<{ className?: string }> }[]).map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'characters' && id && (
        <CharactersTab
          characters={characters}
          uiLanguage={uiLanguage}
          projectId={id}
          onEdit={(c) => { setEditingChar(c); setShowCharForm(true); }}
          onDelete={handleDeleteChar}
          onAdd={() => { setEditingChar(null); setShowCharForm(true); }}
          onImportChars={(newChars) => {
            const ts = Date.now();
            setCharacters(id, [
              ...characters,
              ...newChars.map((c, i) => ({ ...c, id: `char-import-${ts}-${i}` })),
            ]);
          }}
        />
      )}

      {activeTab === 'network' && id && (
        <RelationshipNetworkTab
          characters={characters}
          relationships={relationships}
          uiLanguage={uiLanguage}
          projectId={id}
          setCharacterRelationships={(rels) => setCharacterRelationships(id, rels)}
        />
      )}

      {activeTab === 'events' && id && (
        <EventTimelineTab
          characters={characters}
          arcs={arcs}
          events={events}
          uiLanguage={uiLanguage}
          projectId={id}
          onAddEvent={(e) => addCharacterEvent(id, e)}
          onDeleteEvent={(eid) => deleteCharacterEvent(id, eid)}
          onBulkAddEvents={(evts) => {
            const ts = Date.now();
            setCharacterEvents(id, [
              ...events,
              ...evts.map((e, i) => ({ ...e, id: `event-ai-${ts}-${i}` })),
            ]);
          }}
        />
      )}

      {activeTab === 'growth' && id && (
        <CharacterGrowthTab characters={characters} uiLanguage={uiLanguage} projectId={id} />
      )}

      {/* Character form modal */}
      {showCharForm && id && (
        <CharacterFormModal
          character={editingChar}
          uiLanguage={uiLanguage}
          onClose={() => { setShowCharForm(false); setEditingChar(null); }}
          onSave={(data) => {
            if (editingChar) {
              setCharacters(id, characters.map((c) => c.id === editingChar.id ? { ...c, ...data } : c));
            } else {
              const newChar = { ...data, id: `char-${Date.now()}` };
              setCharacters(id, [...characters, newChar]);
            }
            setShowCharForm(false);
            setEditingChar(null);
          }}
        />
      )}
    </div>
  );
}

// ── Characters Tab ────────────────────────────────────────────
function CharactersTab({
  characters, uiLanguage, onEdit, onDelete, onAdd, projectId, onImportChars,
}: {
  characters: Character[];
  uiLanguage: 'zh' | 'en';
  onEdit: (c: Character) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  projectId: string;
  onImportChars: (chars: Omit<Character, 'id'>[]) => void;
}) {
  const {
    getLongNovelOutline, textModelConfig,
    getCultivationRealms, getCharacterRealmEvents,
  } = useAppStore();
  const outline = getLongNovelOutline(projectId);
  const [isGenChars, setIsGenChars] = useState(false);
  const [genCharsText, setGenCharsText] = useState('');
  const [parsedChars, setParsedChars] = useState<Omit<Character, 'id'>[] | null>(null);
  const genCharsCancelRef = useRef(false);
  const genCharsTextRef = useRef('');
  const existingNames = useMemo(() => new Set(characters.map((c) => c.name)), [characters]);
  const newCharsToImport = useMemo(
    () => (parsedChars ?? []).filter((c) => !existingNames.has(c.name)),
    [parsedChars, existingNames]
  );

  const handleGenChars = async () => {
    if (!outline) return;
    genCharsCancelRef.current = false;
    genCharsTextRef.current = '';
    setGenCharsText('');
    setParsedChars(null);
    setIsGenChars(true);
    const unlisten = await listen<string>('characters-from-outline-stream', (e) => {
      if (genCharsCancelRef.current) return;
      genCharsTextRef.current += e.payload;
      setGenCharsText(genCharsTextRef.current);
    });
    // Inject realm ladder into the outline blob so the generated characters
    // are scoped to this power system (when one is defined).
    const realmBlock = buildRealmSystemContext(
      getCultivationRealms(projectId),
      [],
      getCharacterRealmEvents(projectId),
      [],
      { uiLanguage, ladderOnly: true }
    );
    const outlineWithRealms = realmBlock ? `${outline}\n\n${realmBlock}` : outline;
    try {
      await invoke('generate_characters_from_outline_stream', {
        outline: outlineWithRealms,
        outputLanguage: uiLanguage,
        textConfig: textModelConfig,
      });
      setParsedChars(parseCharactersFromAI(genCharsTextRef.current));
    } catch (e) {
      console.error('AI char gen failed:', e);
    } finally {
      unlisten();
      setIsGenChars(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <p className="text-sm text-gray-500">
          {tx(uiLanguage, `共 ${characters.length} 位角色`, `${characters.length} characters`)}
        </p>
        <div className="flex gap-2 flex-wrap">
          {isGenChars ? (
            <Button
              variant="outline"
              onClick={() => { genCharsCancelRef.current = true; }}
              className="border-red-300 text-red-600 hover:bg-red-50"
            >
              <StopCircle className="w-4 h-4 mr-1.5" />
              {tx(uiLanguage, '停止', 'Stop')}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={handleGenChars}
              disabled={!outline}
              title={!outline ? tx(uiLanguage, '请先前往大纲页保存大纲', 'Go to Outline page first') : undefined}
              className="border-purple-300 text-purple-700 hover:bg-purple-50 dark:hover:bg-purple-900/20 disabled:opacity-40"
            >
              <Sparkles className="w-4 h-4 mr-1.5" />
              {tx(uiLanguage, '从大纲导入', 'Import from Outline')}
            </Button>
          )}
          <Button onClick={onAdd} className="bg-purple-600 hover:bg-purple-700">
            <Plus className="w-4 h-4 mr-1.5" />
            {tx(uiLanguage, '添加角色', 'Add Character')}
          </Button>
        </div>
      </div>

      {/* AI result panel */}
      {(isGenChars || genCharsText) && (
        <div className="bg-purple-50 dark:bg-purple-900/10 rounded-xl border border-purple-200 dark:border-purple-700 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-purple-700 dark:text-purple-300">
              {isGenChars
                ? tx(uiLanguage, '正在从大纲中分析角色…', 'Analyzing outline for characters…')
                : tx(
                    uiLanguage,
                    `已识别 ${parsedChars?.length ?? 0} 位角色，${newCharsToImport.length} 位可导入`,
                    `Found ${parsedChars?.length ?? 0} characters, ${newCharsToImport.length} new to import`
                  )}
            </p>
            {!isGenChars && newCharsToImport.length > 0 && (
              <button
                onClick={() => {
                  onImportChars(newCharsToImport);
                  setGenCharsText('');
                  setParsedChars(null);
                }}
                className="text-xs px-3 py-1 rounded-lg bg-purple-600 text-white hover:bg-purple-700"
              >
                {tx(uiLanguage, `导入 ${newCharsToImport.length} 位新角色`, `Import ${newCharsToImport.length} characters`)}
              </button>
            )}
          </div>
          {parsedChars && parsedChars.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {parsedChars.map((c, i) => (
                <span
                  key={i}
                  className={`text-xs px-2.5 py-1 rounded-full border ${
                    existingNames.has(c.name)
                      ? 'bg-gray-100 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 text-gray-400'
                      : 'bg-purple-100 dark:bg-purple-900/30 border-purple-200 dark:border-purple-700 text-purple-700 dark:text-purple-300'
                  }`}
                >
                  {c.name}{c.role ? ` · ${c.role.slice(0, 14)}` : ''}
                  {existingNames.has(c.name) && <span className="ml-1">✓</span>}
                </span>
              ))}
            </div>
          ) : (
            <pre className="text-xs text-gray-500 whitespace-pre-wrap max-h-32 overflow-y-auto font-mono">{genCharsText.slice(-500)}</pre>
          )}
        </div>
      )}

      {characters.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
          <Users className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 mb-4">{tx(uiLanguage, '还没有角色', 'No characters yet')}</p>
          <Button onClick={onAdd} variant="outline">
            <Plus className="w-4 h-4 mr-1.5" />
            {tx(uiLanguage, '添加第一个角色', 'Add First Character')}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {characters.map((char) => (
            <div
              key={char.id}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3 relative group"
            >
              {char.isProtagonist && (
                <span className="absolute top-3 right-3 flex items-center gap-1 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-1.5 py-0.5 rounded-full font-medium">
                  <Star className="w-3 h-3" />主角
                </span>
              )}
              <div className="flex items-start gap-3">
                {char.portraitBase64 ? (
                  <img
                    src={portraitSrc(char.portraitBase64)}
                    className="w-20 h-28 rounded-lg object-cover flex-shrink-0 border border-gray-200 dark:border-gray-700 ring-1 ring-black/5 shadow-sm bg-gray-50 dark:bg-gray-900"
                    alt={char.name}
                  />
                ) : (
                  <div className="w-20 h-28 rounded-lg bg-gradient-to-br from-purple-100 to-purple-50 dark:from-purple-900/30 dark:to-purple-900/10 flex items-center justify-center flex-shrink-0 border border-gray-200 dark:border-gray-700 ring-1 ring-black/5 shadow-sm">
                    <span className="text-3xl font-bold text-purple-400 dark:text-purple-500">
                      {char.name.charAt(0)}
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-white">{char.name}</div>
                  {char.role && <div className="text-xs text-gray-500">{char.role}</div>}
                  {char.gender && <div className="text-xs text-gray-400">{char.gender}</div>}
                </div>
              </div>
              {char.personality && (
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed line-clamp-2">{char.personality}</p>
              )}
              {char.motivation && (
                <p className="text-xs text-gray-500 italic line-clamp-1">
                  {tx(uiLanguage, '动机：', 'Motivation: ')}{char.motivation}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => onEdit(char)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  {tx(uiLanguage, '编辑', 'Edit')}
                </button>
                <button
                  onClick={() => onDelete(char.id)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-600 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {tx(uiLanguage, '删除', 'Delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Character Form Modal ──────────────────────────────────────
function CharacterFormModal({
  character, uiLanguage, onClose, onSave,
}: {
  character: Character | null;
  uiLanguage: 'zh' | 'en';
  onClose: () => void;
  onSave: (data: Omit<Character, 'id'>) => void;
}) {
  const [name, setName] = useState(character?.name ?? '');
  const [gender, setGender] = useState(character?.gender ?? '');
  const [role, setRole] = useState(character?.role ?? '');
  const [personality, setPersonality] = useState(character?.personality ?? '');
  const [background, setBackground] = useState(character?.background ?? '');
  const [motivation, setMotivation] = useState(character?.motivation ?? '');
  const [appearance, setAppearance] = useState(character?.appearance ?? '');
  const [isProtagonist, setIsProtagonist] = useState(character?.isProtagonist ?? false);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {character ? tx(uiLanguage, '编辑角色', 'Edit Character') : tx(uiLanguage, '添加角色', 'Add Character')}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {tx(uiLanguage, '姓名 *', 'Name *')}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div className="w-28 pt-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isProtagonist}
                  onChange={(e) => setIsProtagonist(e.target.checked)}
                  className="rounded accent-purple-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">{tx(uiLanguage, '主角', 'Protagonist')}</span>
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tx(uiLanguage, '性别', 'Gender')}</label>
              <input type="text" value={gender} onChange={(e) => setGender(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder={tx(uiLanguage, '男/女/不明', 'Male/Female/...')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tx(uiLanguage, '身份/职业', 'Role/Occupation')}</label>
              <input type="text" value={role} onChange={(e) => setRole(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
          </div>
          {(['personality', 'appearance', 'background', 'motivation'] as const).map((field) => {
            const labels: Record<string, { zh: string; en: string }> = {
              personality: { zh: '性格', en: 'Personality' },
              appearance: { zh: '外貌', en: 'Appearance' },
              background: { zh: '背景', en: 'Background' },
              motivation: { zh: '动机', en: 'Motivation' },
            };
            const values: Record<string, string> = { personality, appearance, background, motivation };
            const setters: Record<string, (v: string) => void> = {
              personality: setPersonality, appearance: setAppearance,
              background: setBackground, motivation: setMotivation,
            };
            return (
              <div key={field}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {uiLanguage === 'zh' ? labels[field].zh : labels[field].en}
                </label>
                <textarea
                  value={values[field]}
                  onChange={(e) => setters[field](e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-16 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                />
              </div>
            );
          })}
        </div>
        <div className="flex gap-3 mt-5">
          <Button variant="outline" onClick={onClose} className="flex-1">{tx(uiLanguage, '取消', 'Cancel')}</Button>
          <Button
            onClick={() => {
              if (!name.trim()) return;
              onSave({ name: name.trim(), gender, role, personality, background, motivation, appearance, isProtagonist });
            }}
            className="flex-1 bg-purple-600 hover:bg-purple-700"
            disabled={!name.trim()}
          >
            {tx(uiLanguage, '保存', 'Save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Relationship Network Tab ──────────────────────────────────
function RelationshipNetworkTab({
  characters, relationships, uiLanguage, projectId, setCharacterRelationships,
}: {
  characters: Character[];
  relationships: CharacterRelationship[];
  uiLanguage: 'zh' | 'en';
  projectId: string;
  setCharacterRelationships: (rels: CharacterRelationship[]) => void;
}) {
  const { textModelConfig, getLongNovelOutline } = useAppStore();
  const [isGenRels, setIsGenRels] = useState(false);
  const [genRelsText, setGenRelsText] = useState('');
  const [parsedRels, setParsedRels] = useState<CharacterRelationship[] | null>(null);
  const genCancelRef = useRef(false);
  const genTextRef = useRef('');

  const outline = getLongNovelOutline(projectId);
  const [selectedChar, setSelectedChar] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingRel, setEditingRel] = useState<CharacterRelationship | null>(null);
  const [fromCharId, setFromCharId] = useState('');
  const [toCharId, setToCharId] = useState('');
  const [relType, setRelType] = useState('');
  const [relDesc, setRelDesc] = useState('');

  const filteredRels = selectedChar
    ? relationships.filter((r) => r.fromCharId === selectedChar || r.toCharId === selectedChar)
    : relationships;

  const handleSaveRel = () => {
    if (!fromCharId || !toCharId || fromCharId === toCharId) return;
    if (editingRel) {
      setCharacterRelationships(relationships.map((r) =>
        r.id === editingRel.id ? { ...r, fromCharId, toCharId, type: relType, description: relDesc } : r
      ));
    } else {
      const newRel: CharacterRelationship = {
        id: `rel-${Date.now()}`,
        fromCharId, toCharId, type: relType, description: relDesc,
      };
      setCharacterRelationships([...relationships, newRel]);
    }
    resetForm();
  };

  const handleDeleteRel = async (relId: string) => {
    const ok = await uiConfirm({ title: tx(uiLanguage, '删除关系', 'Delete relationship'), message: tx(uiLanguage, '删除此关系？', 'Delete this relationship?'), danger: true });
    if (!ok) return;
    setCharacterRelationships(relationships.filter((r) => r.id !== relId));
  };

  const handleEditRel = (rel: CharacterRelationship) => {
    setEditingRel(rel);
    setFromCharId(rel.fromCharId);
    setToCharId(rel.toCharId);
    setRelType(rel.type);
    setRelDesc(rel.description);
    setShowAddForm(true);
  };

  const resetForm = () => {
    setShowAddForm(false);
    setEditingRel(null);
    setFromCharId('');
    setToCharId('');
    setRelType('');
    setRelDesc('');
  };

  const handleGenRels = async () => {
    if (!outline || characters.length < 2) return;
    genCancelRef.current = false;
    genTextRef.current = '';
    setGenRelsText('');
    setParsedRels(null);
    setIsGenRels(true);

    const unlisten = await listen<string>('character-relations-stream', (e) => {
      if (genCancelRef.current) return;
      genTextRef.current += e.payload;
      setGenRelsText(genTextRef.current);
    });

    try {
      await invoke('generate_character_relationships_stream', {
        outline,
        characterNames: characters.map((c) => c.name),
        outputLanguage: uiLanguage,
        textConfig: textModelConfig,
      });
      const parsed = parseAIRelationships(genTextRef.current, characters);
      setParsedRels(parsed);
    } catch (e) {
      console.error('AI rel gen failed:', e);
    } finally {
      unlisten();
      setIsGenRels(false);
    }
  };

  const charMap = useMemo(
    () => Object.fromEntries(characters.map((c) => [c.id, c])),
    [characters]
  );

  const relTypeOptions = uiLanguage === 'zh' ? RELATIONSHIP_TYPES_ZH : RELATIONSHIP_TYPES_EN;

  if (characters.length < 2) {
    return (
      <div className="text-center py-16 text-gray-400">
        <Network className="w-12 h-12 mx-auto opacity-40 mb-3" />
        <p>{tx(uiLanguage, '至少需要2个角色才能建立关系网络', 'Need at least 2 characters to build a relationship network')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Button
          onClick={() => { resetForm(); setShowAddForm(true); }}
          className="bg-purple-600 hover:bg-purple-700"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          {tx(uiLanguage, '添加关系', 'Add Relationship')}
        </Button>
        {isGenRels ? (
          <Button
            variant="outline"
            onClick={() => { genCancelRef.current = true; }}
            className="border-red-300 text-red-600 hover:bg-red-50"
          >
            <StopCircle className="w-4 h-4 mr-1.5" />
            {tx(uiLanguage, '停止', 'Stop')}
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={handleGenRels}
            disabled={!outline}
            title={!outline ? tx(uiLanguage, '请先保存大纲', 'Save the outline first') : undefined}
            className="border-purple-300 text-purple-700 hover:bg-purple-50 dark:hover:bg-purple-900/20 disabled:opacity-40"
          >
            <Sparkles className="w-4 h-4 mr-1.5" />
            {tx(uiLanguage, '分析并生成', 'Analyze & Generate')}
          </Button>
        )}
        {/* Character filter */}
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setSelectedChar(null)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              !selectedChar ? 'bg-purple-600 text-white border-purple-600' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-purple-400'
            }`}
          >
            {tx(uiLanguage, '全部', 'All')}
          </button>
          {characters.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedChar(selectedChar === c.id ? null : c.id)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                selectedChar === c.id ? 'bg-purple-600 text-white border-purple-600' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-purple-400'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* AI generation result */}
      {(isGenRels || genRelsText) && (
        <div className="bg-purple-50 dark:bg-purple-900/10 rounded-xl border border-purple-200 dark:border-purple-700 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-purple-700 dark:text-purple-300">
              {isGenRels
                ? tx(uiLanguage, '正在生成…', 'Generating…')
                : tx(uiLanguage, `已解析 ${parsedRels?.length ?? 0} 对关系`, `Parsed ${parsedRels?.length ?? 0} relationships`)}
            </p>
            {!isGenRels && parsedRels && parsedRels.length > 0 && (
              <button
                onClick={() => {
                  const existingSet = new Set(relationships.map((r) => [r.fromCharId, r.toCharId].sort().join('-')));
                  const newRels = parsedRels.filter((r) => !existingSet.has([r.fromCharId, r.toCharId].sort().join('-')));
                  setCharacterRelationships([...relationships, ...newRels]);
                  setGenRelsText('');
                  setParsedRels(null);
                }}
                className="text-xs px-3 py-1 rounded-lg bg-purple-600 text-white hover:bg-purple-700"
              >
                {tx(uiLanguage, `导入 ${parsedRels.length} 对关系`, `Import ${parsedRels.length} relationships`)}
              </button>
            )}
          </div>
          {parsedRels && parsedRels.length > 0 ? (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {parsedRels.map((r, i) => {
                const a = characters.find((c) => c.id === r.fromCharId);
                const b = characters.find((c) => c.id === r.toCharId);
                return (
                  <p key={i} className="text-xs text-gray-600 dark:text-gray-400">
                    <span className="font-medium text-gray-800 dark:text-gray-200">{a?.name}</span>
                    {' '}—{' '}<span className="text-purple-600 dark:text-purple-400">{r.type}</span>
                    {' '}→{' '}<span className="font-medium text-gray-800 dark:text-gray-200">{b?.name}</span>
                    {r.description ? <span className="text-gray-400"> · {r.description.slice(0, 40)}</span> : null}
                  </p>
                );
              })}
            </div>
          ) : (
            <pre className="text-xs text-gray-500 whitespace-pre-wrap max-h-32 overflow-y-auto font-mono">{genRelsText.slice(-400)}</pre>
          )}
        </div>
      )}

      {/* Add/edit form */}
      {showAddForm && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-purple-200 dark:border-purple-700 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {editingRel ? tx(uiLanguage, '编辑关系', 'Edit Relationship') : tx(uiLanguage, '添加关系', 'Add Relationship')}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {tx(uiLanguage, '角色A', 'Character A')}
              </label>
              <select
                value={fromCharId}
                onChange={(e) => setFromCharId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="">{tx(uiLanguage, '选择角色', 'Select character')}</option>
                {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {tx(uiLanguage, '角色B', 'Character B')}
              </label>
              <select
                value={toCharId}
                onChange={(e) => setToCharId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="">{tx(uiLanguage, '选择角色', 'Select character')}</option>
                {characters.filter((c) => c.id !== fromCharId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {tx(uiLanguage, '关系类型', 'Relationship Type')}
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {relTypeOptions.map((t) => (
                <button
                  key={t}
                  onClick={() => setRelType(t)}
                  className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                    relType === t ? 'bg-purple-600 text-white border-purple-600' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-purple-400'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={relType}
              onChange={(e) => setRelType(e.target.value)}
              placeholder={tx(uiLanguage, '或自定义关系类型', 'Or enter custom type')}
              className="w-full px-2.5 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {tx(uiLanguage, '关系说明（可选）', 'Description (optional)')}
            </label>
            <input
              type="text"
              value={relDesc}
              onChange={(e) => setRelDesc(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder={tx(uiLanguage, '简短描述两人之间的具体关系', 'Briefly describe the relationship details')}
            />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleSaveRel}
              disabled={!fromCharId || !toCharId || fromCharId === toCharId}
              className="bg-purple-600 hover:bg-purple-700"
            >
              <Save className="w-4 h-4 mr-1.5" />
              {tx(uiLanguage, '保存', 'Save')}
            </Button>
            <Button variant="outline" onClick={resetForm}>
              {tx(uiLanguage, '取消', 'Cancel')}
            </Button>
          </div>
        </div>
      )}

      {/* Relationship list */}
      {filteredRels.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Network className="w-10 h-10 mx-auto opacity-40 mb-2" />
          <p className="text-sm">
            {selectedChar
              ? tx(uiLanguage, '此角色暂无关系记录', 'No relationships for this character')
              : tx(uiLanguage, '暂无关系记录', 'No relationships yet')}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
          {filteredRels.map((rel) => {
            const fromChar = charMap[rel.fromCharId];
            const toChar = charMap[rel.toCharId];
            if (!fromChar || !toChar) return null;
            return (
              <div key={rel.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="font-medium text-gray-900 dark:text-white text-sm">{fromChar.name}</span>
                  <div className="flex items-center gap-1">
                    <div className="h-0.5 w-8 bg-gray-300 dark:bg-gray-600" />
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${relColor(rel.type)}`}>
                      {rel.type || tx(uiLanguage, '未知', 'Unknown')}
                    </span>
                    <div className="h-0.5 w-8 bg-gray-300 dark:bg-gray-600" />
                  </div>
                  <span className="font-medium text-gray-900 dark:text-white text-sm">{toChar.name}</span>
                  {rel.description && (
                    <span className="text-xs text-gray-500 ml-2 truncate hidden sm:block">{rel.description}</span>
                  )}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleEditRel(rel)}
                    className="p-1 rounded text-gray-400 hover:text-blue-600 transition-colors"
                    title={tx(uiLanguage, '编辑', 'Edit')}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteRel(rel.id)}
                    className="p-1 rounded text-gray-400 hover:text-red-600 transition-colors"
                    title={tx(uiLanguage, '删除', 'Delete')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Event Timeline Tab ────────────────────────────────────────
function EventTimelineTab({
  characters, arcs, events, uiLanguage, projectId, onAddEvent, onDeleteEvent, onBulkAddEvents,
}: {
  characters: Character[];
  arcs: PlotArc[];
  events: CharacterEvent[];
  uiLanguage: 'zh' | 'en';
  projectId: string;
  onAddEvent: (e: Omit<CharacterEvent, 'id'>) => void;
  onDeleteEvent: (id: string) => void;
  onBulkAddEvents: (evts: Omit<CharacterEvent, 'id'>[]) => void;
}) {
  const { textModelConfig, getLongNovelOutline } = useAppStore();
  const [isGenEvts, setIsGenEvts] = useState(false);
  const [genEvtsText, setGenEvtsText] = useState('');
  const [parsedEvts, setParsedEvts] = useState<Omit<CharacterEvent, 'id'>[] | null>(null);
  const genEvtsCancelRef = useRef(false);
  const genEvtsTextRef = useRef('');

  const outline = getLongNovelOutline(projectId);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedChars, setExpandedChars] = useState<Set<string>>(new Set());
  const [filterArcId, setFilterArcId] = useState<string>('');
  const [formCharId, setFormCharId] = useState('');
  const [formArcId, setFormArcId] = useState('');
  const [formChapterIndex, setFormChapterIndex] = useState(1);
  const [formChapterTitle, setFormChapterTitle] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');

  const toggleChar = (charId: string) => {
    setExpandedChars((prev) => {
      const next = new Set(prev);
      if (next.has(charId)) { next.delete(charId); } else { next.add(charId); }
      return next;
    });
  };

  const filteredEvents = filterArcId ? events.filter((e) => e.arcId === filterArcId) : events;

  const handleSaveEvent = () => {
    if (!formCharId || !formTitle.trim()) return;
    onAddEvent({
      characterId: formCharId,
      arcId: formArcId,
      chapterIndex: formChapterIndex,
      chapterTitle: formChapterTitle,
      title: formTitle.trim(),
      description: formDesc,
    });
    setShowAddForm(false);
    setFormCharId(''); setFormArcId(''); setFormChapterIndex(1);
    setFormChapterTitle(''); setFormTitle(''); setFormDesc('');
    // Expand the character section
    if (formCharId) setExpandedChars((prev) => new Set([...prev, formCharId]));
  };

  const arcMap = Object.fromEntries(arcs.map((a) => [a.id, a]));

  const handleGenEvts = async () => {
    if (!outline || characters.length === 0) return;
    genEvtsCancelRef.current = false;
    genEvtsTextRef.current = '';
    setGenEvtsText('');
    setParsedEvts(null);
    setIsGenEvts(true);

    const unlisten = await listen<string>('character-events-stream', (e) => {
      if (genEvtsCancelRef.current) return;
      genEvtsTextRef.current += e.payload;
      setGenEvtsText(genEvtsTextRef.current);
    });

    try {
      await invoke('generate_character_events_stream', {
        outline,
        characterNames: characters.map((c) => c.name),
        arcTitles: arcs.map((a) => a.title),
        outputLanguage: uiLanguage,
        textConfig: textModelConfig,
      });
      const parsed = parseAIEvents(genEvtsTextRef.current, characters, arcs);
      setParsedEvts(parsed);
    } catch (e) {
      console.error('AI event gen failed:', e);
    } finally {
      unlisten();
      setIsGenEvts(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {arcs.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">{tx(uiLanguage, '按弧线筛选：', 'Filter by arc:')}</span>
              <select
                value={filterArcId}
                onChange={(e) => setFilterArcId(e.target.value)}
                className="text-xs px-2 py-1 border rounded dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
              >
                <option value="">{tx(uiLanguage, '全部', 'All')}</option>
                {arcs.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {isGenEvts ? (
            <Button
              variant="outline"
              onClick={() => { genEvtsCancelRef.current = true; }}
              className="border-red-300 text-red-600 hover:bg-red-50"
            >
              <StopCircle className="w-4 h-4 mr-1.5" />
              {tx(uiLanguage, '停止', 'Stop')}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={handleGenEvts}
              disabled={!outline}
              title={!outline ? tx(uiLanguage, '请先保存大纲', 'Save the outline first') : undefined}
              className="border-purple-300 text-purple-700 hover:bg-purple-50 dark:hover:bg-purple-900/20 disabled:opacity-40"
            >
              <Sparkles className="w-4 h-4 mr-1.5" />
              {tx(uiLanguage, '从大纲生成', 'Generate from Outline')}
            </Button>
          )}
          <Button
            onClick={() => setShowAddForm((v) => !v)}
            className="bg-purple-600 hover:bg-purple-700"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            {tx(uiLanguage, '添加事件', 'Add Event')}
          </Button>
        </div>
      </div>

      {/* AI generation result */}
      {(isGenEvts || genEvtsText) && (
        <div className="bg-purple-50 dark:bg-purple-900/10 rounded-xl border border-purple-200 dark:border-purple-700 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-purple-700 dark:text-purple-300">
              {isGenEvts
                ? tx(uiLanguage, '正在生成…', 'Generating…')
                : tx(uiLanguage, `已解析 ${parsedEvts?.length ?? 0} 个事件`, `Parsed ${parsedEvts?.length ?? 0} events`)}
            </p>
            {!isGenEvts && parsedEvts && parsedEvts.length > 0 && (
              <button
                onClick={() => {
                  onBulkAddEvents(parsedEvts);
                  setGenEvtsText('');
                  setParsedEvts(null);
                }}
                className="text-xs px-3 py-1 rounded-lg bg-purple-600 text-white hover:bg-purple-700"
              >
                {tx(uiLanguage, `导入 ${parsedEvts.length} 个事件`, `Import ${parsedEvts.length} events`)}
              </button>
            )}
          </div>
          {parsedEvts && parsedEvts.length > 0 ? (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {parsedEvts.map((e, i) => {
                const char = characters.find((c) => c.id === e.characterId);
                const arc = arcs.find((a) => a.id === e.arcId);
                return (
                  <p key={i} className="text-xs text-gray-600 dark:text-gray-400">
                    <span className="font-medium text-gray-800 dark:text-gray-200">{char?.name}</span>
                    {arc ? <span className="text-purple-500 dark:text-purple-400"> [{arc.title.slice(0, 12)}]</span> : null}
                    {' '}<span className="text-gray-700 dark:text-gray-300">{e.title}</span>
                    {e.description ? <span className="text-gray-400"> · {e.description.slice(0, 40)}</span> : null}
                  </p>
                );
              })}
            </div>
          ) : (
            <pre className="text-xs text-gray-500 whitespace-pre-wrap max-h-32 overflow-y-auto font-mono">{genEvtsText.slice(-400)}</pre>
          )}
        </div>
      )}
      {showAddForm && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-purple-200 dark:border-purple-700 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {tx(uiLanguage, '添加角色事件', 'Add Character Event')}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{tx(uiLanguage, '角色 *', 'Character *')}</label>
              <select
                value={formCharId}
                onChange={(e) => setFormCharId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="">{tx(uiLanguage, '选择角色', 'Select')}</option>
                {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{tx(uiLanguage, '所在弧线', 'Plot Arc')}</label>
              <select
                value={formArcId}
                onChange={(e) => setFormArcId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="">{tx(uiLanguage, '未指定', 'Unspecified')}</option>
                {arcs.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{tx(uiLanguage, '章节序号', 'Chapter #')}</label>
              <input
                type="number" min={1} value={formChapterIndex}
                onChange={(e) => setFormChapterIndex(parseInt(e.target.value, 10) || 1)}
                className="w-full px-2.5 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{tx(uiLanguage, '章节名（可选）', 'Chapter Title')}</label>
              <input
                type="text" value={formChapterTitle}
                onChange={(e) => setFormChapterTitle(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{tx(uiLanguage, '事件标题 *', 'Event Title *')}</label>
            <input
              type="text" value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder={tx(uiLanguage, '简短描述发生了什么', 'Brief event description')}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{tx(uiLanguage, '详细描述', 'Details')}</label>
            <textarea
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-16 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSaveEvent} disabled={!formCharId || !formTitle.trim()} className="bg-purple-600 hover:bg-purple-700">
              <Save className="w-4 h-4 mr-1.5" />
              {tx(uiLanguage, '保存', 'Save')}
            </Button>
            <Button variant="outline" onClick={() => setShowAddForm(false)}>
              {tx(uiLanguage, '取消', 'Cancel')}
            </Button>
          </div>
        </div>
      )}

      {/* Per-character timeline */}
      {characters.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Clock className="w-10 h-10 mx-auto opacity-40 mb-2" />
          <p className="text-sm">{tx(uiLanguage, '请先在角色列表中添加角色', 'Add characters first in the Characters tab')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {characters.map((char) => {
            const charEvents = filteredEvents
              .filter((e) => e.characterId === char.id)
              .sort((a, b) => a.chapterIndex - b.chapterIndex);
            const isExpanded = expandedChars.has(char.id);
            return (
              <div key={char.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  onClick={() => toggleChar(char.id)}
                >
                  <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-purple-600 dark:text-purple-400">{char.name.charAt(0)}</span>
                  </div>
                  <span className="font-medium text-gray-900 dark:text-white text-sm flex-1 text-left">{char.name}</span>
                  <span className="text-xs text-gray-400">
                    {charEvents.length} {tx(uiLanguage, '个事件', 'events')}
                  </span>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>
                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-700">
                    {charEvents.length === 0 ? (
                      <p className="text-center py-4 text-xs text-gray-400">{tx(uiLanguage, '暂无事件', 'No events')}</p>
                    ) : (
                      <div className="p-3 space-y-2">
                        {charEvents.map((evt, idx) => {
                          const arc = evt.arcId ? arcMap[evt.arcId] : null;
                          return (
                            <div key={evt.id} className="flex items-start gap-3">
                              <div className="flex flex-col items-center flex-shrink-0 mt-1">
                                <div className="w-2 h-2 rounded-full bg-purple-400" />
                                {idx < charEvents.length - 1 && <div className="w-0.5 h-full min-h-[16px] bg-purple-200 dark:bg-purple-800 mt-1" />}
                              </div>
                              <div className="flex-1 min-w-0 pb-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs text-gray-400">
                                    {tx(uiLanguage, `第${evt.chapterIndex}章`, `Ch.${evt.chapterIndex}`)}
                                    {evt.chapterTitle ? ` · ${evt.chapterTitle}` : ''}
                                  </span>
                                  {arc && (
                                    <span className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-1.5 py-0.5 rounded">
                                      {arc.title}
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mt-0.5">{evt.title}</p>
                                {evt.description && (
                                  <p className="text-xs text-gray-500 mt-0.5">{evt.description}</p>
                                )}
                              </div>
                              <button
                                onClick={() => onDeleteEvent(evt.id)}
                                className="p-1 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0 mt-1"
                                title={tx(uiLanguage, '删除', 'Delete')}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Character Growth Tab (成长路线) ────────────────────────────
// Mirrors Android `characterGrowthByProject` — a per-character chain of growth entries (oldest →
// newest). The latest entries are injected into chapter generation as soft guidance (see
// LongNovelEditorPage), and AI auto-appends a new entry after each chapter save when enabled.
function CharacterGrowthTab({
  characters, uiLanguage, projectId,
}: {
  characters: Character[];
  uiLanguage: 'zh' | 'en';
  projectId: string;
}) {
  const { getCharacterGrowth, setCharacterGrowth, appendCharacterGrowth } = useAppStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ charId: string; entryId: string } | null>(null);
  const [editValue, setEditValue] = useState('');

  const toggle = (charId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(charId)) next.delete(charId);
      else next.add(charId);
      return next;
    });
  };

  const addEntry = (charId: string) => {
    const value = (draft[charId] || '').trim();
    if (!value) return;
    appendCharacterGrowth(projectId, charId, {
      id: `growth-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      value,
      createdAt: new Date().toISOString(),
      manual: true,
    });
    setDraft((prev) => ({ ...prev, [charId]: '' }));
    setExpanded((prev) => new Set(prev).add(charId));
  };

  const saveEdit = (charId: string, entries: CharacterGrowthEntry[]) => {
    if (!editing) return;
    setCharacterGrowth(
      projectId,
      charId,
      entries.map((e) => (e.id === editing.entryId ? { ...e, value: editValue, manual: true } : e))
    );
    setEditing(null);
    setEditValue('');
  };

  const deleteEntry = (charId: string, entries: CharacterGrowthEntry[], entryId: string) => {
    setCharacterGrowth(projectId, charId, entries.filter((e) => e.id !== entryId));
  };

  if (characters.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <Sprout className="w-10 h-10 mx-auto opacity-40 mb-2" />
        <p className="text-sm">{tx(uiLanguage, '请先在角色列表中添加角色', 'Add characters first in the Characters tab')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {tx(
          uiLanguage,
          '记录每个角色逐章的成长变化。最新条目会作为软性指引注入章节生成；开启容器自动更新后，写完章节会自动追加新条目。',
          "Track each character's per-chapter development. The latest entry is injected into chapter generation as soft guidance; new entries are auto-appended after writing a chapter when enabled."
        )}
      </p>
      <div className="space-y-3">
        {characters.map((char) => {
          const entries = getCharacterGrowth(projectId, char.id);
          const isExpanded = expanded.has(char.id);
          const latest = entries[entries.length - 1];
          return (
            <div key={char.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                onClick={() => toggle(char.id)}
              >
                <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-green-600 dark:text-green-400">{char.name.charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <span className="font-medium text-gray-900 dark:text-white text-sm">{char.name}</span>
                  {!isExpanded && latest && (
                    <p className="text-xs text-gray-500 truncate">{latest.value}</p>
                  )}
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {entries.length} {tx(uiLanguage, '条', 'entries')}
                </span>
                {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>
              {isExpanded && (
                <div className="border-t border-gray-100 dark:border-gray-700 p-3 space-y-3">
                  {entries.length === 0 ? (
                    <p className="text-center py-2 text-xs text-gray-400">{tx(uiLanguage, '暂无成长记录', 'No growth entries yet')}</p>
                  ) : (
                    <div className="space-y-2">
                      {entries.map((entry, idx) => (
                        <div key={entry.id} className="flex items-start gap-3">
                          <div className="flex flex-col items-center flex-shrink-0 mt-1">
                            <div className={`w-2 h-2 rounded-full ${idx === entries.length - 1 ? 'bg-green-500' : 'bg-green-300'}`} />
                            {idx < entries.length - 1 && <div className="w-0.5 h-full min-h-[20px] bg-green-200 dark:bg-green-800 mt-1" />}
                          </div>
                          <div className="flex-1 min-w-0 pb-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              {entry.chapterOrder != null && (
                                <span className="text-xs text-gray-400">
                                  {tx(uiLanguage, `第${entry.chapterOrder}章`, `Ch.${entry.chapterOrder}`)}
                                  {entry.chapterTitle ? ` · ${entry.chapterTitle}` : ''}
                                </span>
                              )}
                              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                                entry.manual
                                  ? 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                                  : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              }`}>
                                {entry.manual ? tx(uiLanguage, '手动', 'Manual') : tx(uiLanguage, 'AI', 'AI')}
                              </span>
                            </div>
                            {editing && editing.charId === char.id && editing.entryId === entry.id ? (
                              <div className="mt-1 space-y-2">
                                <textarea
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  className="w-full px-2.5 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-20 resize-none focus:outline-none focus:ring-2 focus:ring-green-500"
                                />
                                <div className="flex gap-2">
                                  <button onClick={() => saveEdit(char.id, entries)} className="text-xs px-2.5 py-1 rounded bg-green-600 text-white hover:bg-green-700">{tx(uiLanguage, '保存', 'Save')}</button>
                                  <button onClick={() => { setEditing(null); setEditValue(''); }} className="text-xs px-2.5 py-1 rounded bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200">{tx(uiLanguage, '取消', 'Cancel')}</button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 whitespace-pre-wrap">{entry.value}</p>
                            )}
                          </div>
                          {!(editing && editing.entryId === entry.id) && (
                            <div className="flex gap-1 flex-shrink-0">
                              <button
                                onClick={() => { setEditing({ charId: char.id, entryId: entry.id }); setEditValue(entry.value); }}
                                className="p-1 text-gray-300 hover:text-blue-500 transition-colors"
                                title={tx(uiLanguage, '编辑', 'Edit')}
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => deleteEntry(char.id, entries, entry.id)}
                                className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                                title={tx(uiLanguage, '删除', 'Delete')}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Add manual entry */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={draft[char.id] || ''}
                      onChange={(e) => setDraft((prev) => ({ ...prev, [char.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') addEntry(char.id); }}
                      placeholder={tx(uiLanguage, '手动添加一条成长记录…', 'Add a growth entry manually…')}
                      className="flex-1 px-2.5 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                    <button
                      onClick={() => addEntry(char.id)}
                      disabled={!(draft[char.id] || '').trim()}
                      className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40"
                    >
                      <Plus className="w-3.5 h-3.5 inline mr-0.5" />
                      {tx(uiLanguage, '添加', 'Add')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

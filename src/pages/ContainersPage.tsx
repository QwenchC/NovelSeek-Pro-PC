import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAppStore } from '@store/index';
import type { Character, Container, ContainerEntry, ContainerType } from '@store/index';
import { CONTAINER_SINGLE_BLOCK_KEY } from '@store/index';
import { chapterApi, projectApi } from '@services/api';
import type { Chapter } from '@typings/index';
import { Button } from '@components/Button';
import {
  ArrowLeft, Plus, Trash2, Package, Save, X, ChevronDown, ChevronUp,
  Boxes, Settings2,
} from 'lucide-react';
import { useSmartBack } from '@utils/useSmartBack';
import { tx } from '@utils/i18n';
import { confirmDialog } from '@utils/index';

const CONTAINER_TYPE_LABELS: Record<ContainerType, { zh: string; en: string }> = {
  by_character: { zh: '按角色分块', en: 'By character' },
  by_chapter: { zh: '按章节分块', en: 'By chapter' },
  single: { zh: '单块', en: 'Single block' },
};

interface BlockDef {
  key: string;
  label: string;
}

function deriveBlocks(
  container: Container,
  characters: Character[],
  chapters: Chapter[],
  uiLanguage: 'zh' | 'en'
): BlockDef[] {
  if (container.type === 'single') {
    return [{ key: CONTAINER_SINGLE_BLOCK_KEY, label: tx(uiLanguage, '主块', 'Main') }];
  }
  if (container.type === 'by_character') {
    return characters.map((c) => ({ key: c.id, label: c.name }));
  }
  // by_chapter
  return [...chapters]
    .sort((a, b) => a.order_index - b.order_index)
    .map((c) => ({ key: c.id, label: tx(uiLanguage, `第${c.order_index}章 ${c.title}`, `Ch.${c.order_index} ${c.title}`) }));
}

export function ContainersPage() {
  const { id } = useParams<{ id: string }>();
  const smartBack = useSmartBack(id ? `/long-novel/${id}` : '/long-novels');
  const {
    uiLanguage,
    currentProject, setCurrentProject,
    getCharacters,
    getContainers, getContainerEntries,
    createContainer, updateContainerMeta, deleteContainer,
    appendContainerEntry, replaceLatestContainerEntry,
  } = useAppStore();

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingContainer, setEditingContainer] = useState<Container | null>(null);

  const characters = id ? getCharacters(id) : [];
  const containers = id ? getContainers(id) : [];

  useEffect(() => {
    if (!id) return;
    projectApi.getById(id).then(setCurrentProject);
    chapterApi.getByProject(id).then(setChapters).catch(() => setChapters([]));
  }, [id]);

  useEffect(() => {
    if (!selectedId && containers.length > 0) setSelectedId(containers[0].id);
  }, [containers, selectedId]);

  const selected = containers.find((c) => c.id === selectedId) || null;

  if (!id) return null;

  return (
    <div className="w-full max-w-[1500px] mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={smartBack} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Boxes className="w-5 h-5 text-purple-600" />
            {tx(uiLanguage, '容器', 'Containers')}
          </h1>
          {currentProject && <p className="text-sm text-gray-500">{currentProject.title}</p>}
        </div>
        <Button onClick={() => { setEditingContainer(null); setShowCreate(true); }} className="bg-purple-600 hover:bg-purple-700">
          <Plus className="w-4 h-4 mr-1.5" />
          {tx(uiLanguage, '新建容器', 'New Container')}
        </Button>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400">
        {tx(
          uiLanguage,
          '容器是可由 AI 逐章演进的资料块（按角色 / 按章节 / 单块）。开启「自动更新」后，写完章节会让 AI 追加新值；开启「影响生成」后，最新值会作为软性指引注入对应生成。',
          'Containers are AI-evolved knowledge blocks (by character / by chapter / single). When auto-update is on, AI appends a new value after each chapter; when "affects generation" is on, the latest values are injected as soft guidance.'
        )}
      </p>

      {containers.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
          <Boxes className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 mb-4">{tx(uiLanguage, '还没有容器', 'No containers yet')}</p>
          <Button onClick={() => { setEditingContainer(null); setShowCreate(true); }} variant="outline">
            <Plus className="w-4 h-4 mr-1.5" />
            {tx(uiLanguage, '新建第一个容器', 'Create your first container')}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Container list */}
          <div className="lg:col-span-1 space-y-2">
            {containers.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-left p-3 rounded-xl border transition-colors ${
                  selectedId === c.id
                    ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-600'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-purple-300'
                }`}
              >
                <div className="font-medium text-sm text-gray-900 dark:text-white truncate">{c.name}</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {tx(uiLanguage, CONTAINER_TYPE_LABELS[c.type].zh, CONTAINER_TYPE_LABELS[c.type].en)}
                </div>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {c.autoUpdatePerChapter && <Tag>{tx(uiLanguage, '自动更新', 'Auto')}</Tag>}
                  {c.affectsGeneration && <Tag>{tx(uiLanguage, '章节', 'Chapter')}</Tag>}
                  {c.affectsArcGeneration && <Tag>{tx(uiLanguage, '弧线', 'Arc')}</Tag>}
                  {c.affectsVolumeGeneration && <Tag>{tx(uiLanguage, '副本', 'Volume')}</Tag>}
                </div>
              </button>
            ))}
          </div>

          {/* Selected container detail */}
          <div className="lg:col-span-3">
            {selected ? (
              <ContainerDetail
                key={selected.id}
                projectId={id}
                container={selected}
                blocks={deriveBlocks(selected, characters, chapters, uiLanguage)}
                uiLanguage={uiLanguage}
                getContainerEntries={getContainerEntries}
                appendContainerEntry={appendContainerEntry}
                replaceLatestContainerEntry={replaceLatestContainerEntry}
                onEditMeta={() => { setEditingContainer(selected); setShowCreate(true); }}
                onDelete={async () => {
                  const ok = await confirmDialog(
                    tx(uiLanguage, `删除容器「${selected.name}」及其所有条目？`, `Delete container "${selected.name}" and all its entries?`),
                    tx(uiLanguage, '删除容器', 'Delete Container')
                  );
                  if (!ok) return;
                  deleteContainer(id, selected.id);
                  setSelectedId(null);
                }}
              />
            ) : (
              <div className="text-center py-16 text-gray-400">{tx(uiLanguage, '选择一个容器查看内容', 'Select a container')}</div>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <ContainerFormModal
          container={editingContainer}
          uiLanguage={uiLanguage}
          onClose={() => { setShowCreate(false); setEditingContainer(null); }}
          onSave={(data) => {
            if (editingContainer) {
              updateContainerMeta(id, editingContainer.id, {
                name: data.name,
                autoUpdatePerChapter: data.autoUpdatePerChapter,
                affectsGeneration: data.affectsGeneration,
                affectsArcGeneration: data.affectsArcGeneration,
                affectsVolumeGeneration: data.affectsVolumeGeneration,
              });
            } else {
              const newId = `cont-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
              createContainer(id, {
                id: newId,
                name: data.name,
                type: data.type,
                autoUpdatePerChapter: data.autoUpdatePerChapter,
                affectsGeneration: data.affectsGeneration,
                affectsArcGeneration: data.affectsArcGeneration,
                affectsVolumeGeneration: data.affectsVolumeGeneration,
                createdAt: new Date().toISOString(),
              });
              setSelectedId(newId);
            }
            setShowCreate(false);
            setEditingContainer(null);
          }}
        />
      )}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
      {children}
    </span>
  );
}

// ── Container detail (blocks + entry chains) ───────────────────
function ContainerDetail({
  projectId, container, blocks, uiLanguage,
  getContainerEntries, appendContainerEntry, replaceLatestContainerEntry,
  onEditMeta, onDelete,
}: {
  projectId: string;
  container: Container;
  blocks: BlockDef[];
  uiLanguage: 'zh' | 'en';
  getContainerEntries: (pid: string, cid: string, blockKey: string) => ContainerEntry[];
  appendContainerEntry: (pid: string, cid: string, blockKey: string, entry: ContainerEntry) => void;
  replaceLatestContainerEntry: (pid: string, cid: string, blockKey: string, value: string) => void;
  onEditMeta: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(blocks.length <= 3 ? blocks.map((b) => b.key) : []));
  const [draft, setDraft] = useState<Record<string, string>>({});

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const addEntry = (blockKey: string) => {
    const value = (draft[blockKey] || '').trim();
    if (!value) return;
    appendContainerEntry(projectId, container.id, blockKey, {
      id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      value,
      createdAt: new Date().toISOString(),
      manual: true,
    });
    setDraft((prev) => ({ ...prev, [blockKey]: '' }));
  };

  return (
    <div className="space-y-4">
      {/* Header / settings */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Package className="w-4 h-4 text-purple-600" />
              {container.name}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {tx(uiLanguage, CONTAINER_TYPE_LABELS[container.type].zh, CONTAINER_TYPE_LABELS[container.type].en)}
              {' · '}
              {tx(uiLanguage, `${blocks.length} 个块`, `${blocks.length} blocks`)}
            </p>
          </div>
          <div className="flex gap-1">
            <button onClick={onEditMeta} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 transition-colors" title={tx(uiLanguage, '设置', 'Settings')}>
              <Settings2 className="w-4 h-4" />
            </button>
            <button onClick={onDelete} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 transition-colors" title={tx(uiLanguage, '删除', 'Delete')}>
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {container.autoUpdatePerChapter && <Tag>{tx(uiLanguage, '写完章节自动更新', 'Auto-update per chapter')}</Tag>}
          {container.affectsGeneration && <Tag>{tx(uiLanguage, '影响章节生成', 'Affects chapter gen')}</Tag>}
          {container.affectsArcGeneration && <Tag>{tx(uiLanguage, '影响弧线生成', 'Affects arc gen')}</Tag>}
          {container.affectsVolumeGeneration && <Tag>{tx(uiLanguage, '影响副本生成', 'Affects volume gen')}</Tag>}
        </div>
      </div>

      {/* Blocks */}
      {blocks.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          {container.type === 'by_character'
            ? tx(uiLanguage, '该项目还没有角色，无法生成分块', 'No characters yet — no blocks')
            : tx(uiLanguage, '该项目还没有章节，无法生成分块', 'No chapters yet — no blocks')}
        </div>
      ) : (
        <div className="space-y-2">
          {blocks.map((block) => {
            const entries = getContainerEntries(projectId, container.id, block.key);
            const latest = entries[entries.length - 1];
            const isOpen = expanded.has(block.key);
            return (
              <div key={block.key} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <button onClick={() => toggle(block.key)} className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <span className="font-medium text-sm text-gray-800 dark:text-gray-200 truncate flex-1 text-left">{block.label}</span>
                  {!isOpen && latest && <span className="text-xs text-gray-400 truncate max-w-[40%]">{latest.value}</span>}
                  <span className="text-xs text-gray-400 flex-shrink-0">{entries.length}</span>
                  {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>
                {isOpen && (
                  <div className="border-t border-gray-100 dark:border-gray-700 p-3 space-y-2">
                    {entries.length === 0 ? (
                      <p className="text-center py-1 text-xs text-gray-400">{tx(uiLanguage, '暂无内容', 'Empty')}</p>
                    ) : (
                      entries.map((entry, idx) => {
                        const isLatest = idx === entries.length - 1;
                        return (
                          <div key={entry.id} className="text-sm">
                            <div className="flex items-center gap-2 mb-0.5">
                              {entry.sourceChapterOrder != null && (
                                <span className="text-xs text-gray-400">
                                  {tx(uiLanguage, `第${entry.sourceChapterOrder}章`, `Ch.${entry.sourceChapterOrder}`)}
                                  {entry.sourceChapterTitle ? ` · ${entry.sourceChapterTitle}` : ''}
                                </span>
                              )}
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                entry.manual ? 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                                : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              }`}>
                                {entry.manual ? tx(uiLanguage, '手动', 'Manual') : 'AI'}
                              </span>
                              {isLatest && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">{tx(uiLanguage, '最新', 'Latest')}</span>}
                            </div>
                            {isLatest ? (
                              <textarea
                                value={entry.value}
                                onChange={(e) => replaceLatestContainerEntry(projectId, container.id, block.key, e.target.value)}
                                className="w-full px-2.5 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 resize-y min-h-[60px] focus:outline-none focus:ring-2 focus:ring-purple-500"
                              />
                            ) : (
                              <p className="text-gray-600 dark:text-gray-400 whitespace-pre-wrap pl-1 border-l-2 border-gray-200 dark:border-gray-600">{entry.value}</p>
                            )}
                          </div>
                        );
                      })
                    )}
                    <div className="flex gap-2 pt-1">
                      <input
                        type="text"
                        value={draft[block.key] || ''}
                        onChange={(e) => setDraft((prev) => ({ ...prev, [block.key]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') addEntry(block.key); }}
                        placeholder={tx(uiLanguage, '追加一条新值…', 'Append a new value…')}
                        className="flex-1 px-2.5 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                      <button
                        onClick={() => addEntry(block.key)}
                        disabled={!(draft[block.key] || '').trim()}
                        className="text-xs px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40"
                      >
                        <Plus className="w-3.5 h-3.5 inline mr-0.5" />
                        {tx(uiLanguage, '追加', 'Append')}
                      </button>
                    </div>
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

// ── Create / edit container modal ──────────────────────────────
function ContainerFormModal({
  container, uiLanguage, onClose, onSave,
}: {
  container: Container | null;
  uiLanguage: 'zh' | 'en';
  onClose: () => void;
  onSave: (data: {
    name: string;
    type: ContainerType;
    autoUpdatePerChapter: boolean;
    affectsGeneration: boolean;
    affectsArcGeneration: boolean;
    affectsVolumeGeneration: boolean;
  }) => void;
}) {
  const isEdit = !!container;
  const [name, setName] = useState(container?.name ?? '');
  const [type, setType] = useState<ContainerType>(container?.type ?? 'single');
  const [autoUpdatePerChapter, setAuto] = useState(container?.autoUpdatePerChapter ?? false);
  const [affectsGeneration, setAffectsGen] = useState(container?.affectsGeneration ?? false);
  const [affectsArcGeneration, setAffectsArc] = useState(container?.affectsArcGeneration ?? false);
  const [affectsVolumeGeneration, setAffectsVol] = useState(container?.affectsVolumeGeneration ?? false);

  const toggleRow = (checked: boolean, set: (v: boolean) => void, label: string, hint: string) => (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} className="mt-1 accent-purple-600" />
      <div>
        <div className="text-sm text-gray-800 dark:text-gray-200">{label}</div>
        <div className="text-xs text-gray-400">{hint}</div>
      </div>
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {isEdit ? tx(uiLanguage, '容器设置', 'Container Settings') : tx(uiLanguage, '新建容器', 'New Container')}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tx(uiLanguage, '容器名称 / 用途 *', 'Container name / purpose *')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tx(uiLanguage, '例如：角色当前状态、伏笔清单、势力关系…', 'e.g. character status, foreshadowing list, faction relations…')}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tx(uiLanguage, '分块方式', 'Partition type')}</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ContainerType)}
              disabled={isEdit}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
            >
              {(Object.keys(CONTAINER_TYPE_LABELS) as ContainerType[]).map((t) => (
                <option key={t} value={t}>{tx(uiLanguage, CONTAINER_TYPE_LABELS[t].zh, CONTAINER_TYPE_LABELS[t].en)}</option>
              ))}
            </select>
            {isEdit && <p className="text-xs text-gray-400 mt-1">{tx(uiLanguage, '分块方式创建后不可更改', 'Type cannot be changed after creation')}</p>}
          </div>
          <div className="space-y-2.5 pt-1 border-t border-gray-100 dark:border-gray-700">
            {toggleRow(autoUpdatePerChapter, setAuto,
              tx(uiLanguage, '写完章节自动更新', 'Auto-update after each chapter'),
              tx(uiLanguage, '保存章节后由 AI 决定是否追加新值', 'AI appends a new value after saving a chapter'))}
            {toggleRow(affectsGeneration, setAffectsGen,
              tx(uiLanguage, '影响章节生成', 'Affects chapter generation'),
              tx(uiLanguage, '最新值作为软性指引注入正文生成', 'Latest values guide chapter generation'))}
            {toggleRow(affectsArcGeneration, setAffectsArc,
              tx(uiLanguage, '影响弧线生成', 'Affects arc generation'),
              tx(uiLanguage, '最新值注入 AI 弧线生成', 'Latest values guide arc generation'))}
            {toggleRow(affectsVolumeGeneration, setAffectsVol,
              tx(uiLanguage, '影响副本/大纲生成', 'Affects volume / outline generation'),
              tx(uiLanguage, '最新值注入大纲/副本生成', 'Latest values guide outline/volume generation'))}
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <Button variant="outline" onClick={onClose} className="flex-1">{tx(uiLanguage, '取消', 'Cancel')}</Button>
          <Button
            onClick={() => { if (name.trim()) onSave({ name: name.trim(), type, autoUpdatePerChapter, affectsGeneration, affectsArcGeneration, affectsVolumeGeneration }); }}
            disabled={!name.trim()}
            className="flex-1 bg-purple-600 hover:bg-purple-700"
          >
            <Save className="w-4 h-4 mr-1.5" />
            {tx(uiLanguage, '保存', 'Save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import {
  useAppStore, CultivationRealm, CultivationSubRealm, CharacterRealmEvent,
} from '@store/index';
import { Button } from '@components/Button';
import type { Chapter } from '@typings/index';
import {
  X, Mountain, Users, Plus, Trash2, ArrowUp, ArrowDown,
  ChevronLeft, Star, Sparkles, Download, Upload,
} from 'lucide-react';
import { tx } from '@utils/i18n';
import { computeCurrentRealm, findRealmById } from '@utils/cultivation';

interface CultivationSystemPanelProps {
  projectId: string;
  chapters: Chapter[];
  onClose: () => void;
}

type TabId = 'realms' | 'characters';

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

  const chapterMap = useMemo(() => {
    const m = new Map<string, Chapter>();
    for (const c of chapters) m.set(c.id, c);
    return m;
  }, [chapters]);

  // All realm-ids (major + sub) that are currently referenced by character events.
  // Used to gate "delete realm" confirmation.
  const referencedRealmIds = useMemo(
    () => new Set(events.map((e) => e.realmId)),
    [events]
  );

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden">
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

        {/* Body (no padding/scroll here — each tab manages its own) */}
        <div className="flex-1 overflow-hidden">
          {tab === 'realms' && (
            <RealmsTab
              uiLanguage={uiLanguage}
              realms={realms}
              onChange={(next) => setCultivationRealms(projectId, next)}
              referencedRealmIds={referencedRealmIds}
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

// ── Realms tab (hierarchical) ─────────────────────────────────

interface CultivationRealmsExportBundle {
  version: number;
  exportedAt: string;
  kind: 'cultivation-realms';
  realms: CultivationRealm[];
}

const REALMS_EXPORT_VERSION = 2;

interface RealmsTabProps {
  uiLanguage: 'zh' | 'en';
  realms: CultivationRealm[];
  onChange: (next: CultivationRealm[]) => void;
  referencedRealmIds: Set<string>;
}

function genId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function RealmsTab({ uiLanguage, realms, onChange, referencedRealmIds }: RealmsTabProps) {
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [exportStatus, setExportStatus] = useState('');
  const [pendingImport, setPendingImport] = useState<{
    realms: CultivationRealm[];
    fileName: string;
  } | null>(null);

  // ── major realm CRUD ─────────────────────────────────────────

  const addMajorRealm = () => {
    const name = draftName.trim();
    if (!name) return;
    const maxOrder = realms.reduce((acc, r) => Math.max(acc, r.order), -1);
    const next: CultivationRealm = {
      id: genId('realm'),
      order: maxOrder + 1,
      name,
      description: draftDesc.trim() || undefined,
      subRealms: [],
    };
    onChange([...realms, next]);
    setDraftName('');
    setDraftDesc('');
  };

  const updateMajor = (id: string, patch: Partial<CultivationRealm>) => {
    onChange(realms.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const moveMajor = (id: string, dir: -1 | 1) => {
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

  const removeMajor = (id: string) => {
    const realm = realms.find((r) => r.id === id);
    if (!realm) return;
    // Check whether the major OR any of its subs is referenced.
    const allIds = new Set<string>([id, ...(realm.subRealms || []).map((s) => s.id)]);
    const referenced = [...allIds].some((rid) => referencedRealmIds.has(rid));
    if (referenced) {
      const ok = window.confirm(
        tx(uiLanguage,
          `大境界「${realm.name}」或其下小境界已被角色进阶事件引用。删除会让这些事件失去关联（在角色境界 Tab 显示为"已删除的境界"）。继续？`,
          `"${realm.name}" or one of its sub-realms is referenced by character events. Deletion will leave those events dangling (shown as "deleted realm" in the Characters tab). Continue?`)
      );
      if (!ok) return;
    }
    onChange(realms.filter((r) => r.id !== id));
  };

  // ── sub realm CRUD (operates on a single major realm) ────────

  const addSub = (majorId: string, name: string, desc: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onChange(realms.map((r) => {
      if (r.id !== majorId) return r;
      const subs = r.subRealms || [];
      const maxOrder = subs.reduce((acc, s) => Math.max(acc, s.order), -1);
      const next: CultivationSubRealm = {
        id: genId('sub'),
        order: maxOrder + 1,
        name: trimmed,
        description: desc.trim() || undefined,
      };
      return { ...r, subRealms: [...subs, next] };
    }));
  };

  const updateSub = (majorId: string, subId: string, patch: Partial<CultivationSubRealm>) => {
    onChange(realms.map((r) => {
      if (r.id !== majorId) return r;
      const subs = (r.subRealms || []).map((s) => (s.id === subId ? { ...s, ...patch } : s));
      return { ...r, subRealms: subs };
    }));
  };

  const moveSub = (majorId: string, subId: string, dir: -1 | 1) => {
    onChange(realms.map((r) => {
      if (r.id !== majorId) return r;
      const subs = [...(r.subRealms || [])].sort((a, b) => a.order - b.order);
      const idx = subs.findIndex((s) => s.id === subId);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= subs.length) return r;
      const a = subs[idx];
      const b = subs[swap];
      const nextSubs = (r.subRealms || []).map((s) => {
        if (s.id === a.id) return { ...s, order: b.order };
        if (s.id === b.id) return { ...s, order: a.order };
        return s;
      });
      return { ...r, subRealms: nextSubs };
    }));
  };

  const removeSub = (majorId: string, subId: string) => {
    const major = realms.find((r) => r.id === majorId);
    const sub = major?.subRealms?.find((s) => s.id === subId);
    if (!sub) return;
    if (referencedRealmIds.has(subId)) {
      const ok = window.confirm(
        tx(uiLanguage,
          `小境界「${sub.name}」已被角色进阶事件引用。删除会让这些事件显示为"已删除的境界"。继续？`,
          `Sub-realm "${sub.name}" is referenced by character events. Deletion will dangle them. Continue?`)
      );
      if (!ok) return;
    }
    onChange(realms.map((r) => {
      if (r.id !== majorId) return r;
      return { ...r, subRealms: (r.subRealms || []).filter((s) => s.id !== subId) };
    }));
  };

  // ── export / import ──────────────────────────────────────────

  const handleExport = () => {
    if (realms.length === 0) {
      setExportStatus(tx(uiLanguage, '没有境界可以导出。', 'No realms to export.'));
      return;
    }
    const bundle: CultivationRealmsExportBundle = {
      version: REALMS_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      kind: 'cultivation-realms',
      realms: [...realms]
        .sort((a, b) => a.order - b.order)
        .map((r) => ({
          ...r,
          subRealms: r.subRealms
            ? [...r.subRealms].sort((a, b) => a.order - b.order)
            : [],
        })),
    };
    const json = JSON.stringify(bundle, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `cultivation-realms-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const subCount = realms.reduce((acc, r) => acc + (r.subRealms?.length || 0), 0);
    setExportStatus(
      tx(uiLanguage,
        `已导出 ${realms.length} 个大境界（含 ${subCount} 个小境界）到下载目录。`,
        `Exported ${realms.length} major realms (with ${subCount} sub-realms) to downloads.`)
    );
    setTimeout(() => setExportStatus(''), 4000);
  };

  /** Normalize any imported realm to the v2 shape. Accepts v1 flat realms too. */
  const normalizeImportedRealms = (raw: unknown): CultivationRealm[] => {
    const arr = Array.isArray(raw)
      ? raw
      : (raw && typeof raw === 'object' && Array.isArray((raw as any).realms))
        ? (raw as any).realms
        : null;
    if (!arr) return [];
    const out: CultivationRealm[] = [];
    for (const r of arr) {
      if (!r || typeof r !== 'object') continue;
      const ro = r as any;
      if (typeof ro.id !== 'string' || typeof ro.name !== 'string' || typeof ro.order !== 'number') {
        continue;
      }
      const subs: CultivationSubRealm[] = [];
      if (Array.isArray(ro.subRealms)) {
        for (const s of ro.subRealms) {
          if (!s || typeof s !== 'object') continue;
          const so = s as any;
          if (typeof so.id !== 'string' || typeof so.name !== 'string' || typeof so.order !== 'number') continue;
          subs.push({
            id: so.id,
            order: so.order,
            name: so.name,
            description: typeof so.description === 'string' ? so.description : undefined,
          });
        }
      }
      out.push({
        id: ro.id,
        order: ro.order,
        name: ro.name,
        description: typeof ro.description === 'string' ? ro.description : undefined,
        subRealms: subs,
      });
    }
    return out;
  };

  const handleImportPickFile = () => {
    setExportStatus('');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const imported = normalizeImportedRealms(parsed);
        if (imported.length === 0) {
          throw new Error('No valid realm entries found in file');
        }
        setPendingImport({ realms: imported, fileName: file.name });
      } catch (err) {
        console.error('[Realms import] parse failed:', err);
        setExportStatus(
          tx(uiLanguage, `导入失败：${String(err)}`, `Import failed: ${String(err)}`)
        );
      }
    };
    input.click();
  };

  const applyImportReplace = () => {
    if (!pendingImport) return;
    const sorted = [...pendingImport.realms].sort((a, b) => a.order - b.order);
    const next = sorted.map((r, i) => ({
      ...r,
      order: i,
      subRealms: r.subRealms
        ? [...r.subRealms].sort((a, b) => a.order - b.order).map((s, j) => ({ ...s, order: j }))
        : [],
    }));
    onChange(next);
    setPendingImport(null);
    const subCount = next.reduce((acc, r) => acc + (r.subRealms?.length || 0), 0);
    setExportStatus(
      tx(uiLanguage,
        `已替换为导入的 ${next.length} 个大境界（含 ${subCount} 个小境界）。引用旧境界 ID 的角色事件会显示为"已删除的境界"。`,
        `Replaced with ${next.length} major realms (with ${subCount} sub-realms). Old-id events will show as "deleted realm".`)
    );
  };

  const applyImportMerge = () => {
    if (!pendingImport) return;
    // Merge majors by id. Per major, also merge subRealms by id.
    const byId = new Map<string, CultivationRealm>();
    for (const r of realms) byId.set(r.id, r);
    let majorCollisions = 0;
    let subCollisions = 0;
    let majorAdded = 0;
    let subAdded = 0;
    for (const incoming of pendingImport.realms) {
      const existing = byId.get(incoming.id);
      if (!existing) {
        majorAdded += 1;
        majorAdded += 0; // (placeholder for clarity)
        subAdded += incoming.subRealms?.length || 0;
        byId.set(incoming.id, incoming);
        continue;
      }
      majorCollisions += 1;
      // Merge subs by id, import wins
      const subMap = new Map<string, CultivationSubRealm>();
      for (const s of existing.subRealms || []) subMap.set(s.id, s);
      for (const s of incoming.subRealms || []) {
        if (subMap.has(s.id)) subCollisions += 1;
        else subAdded += 1;
        subMap.set(s.id, s);
      }
      byId.set(incoming.id, {
        ...incoming,
        // keep existing order if the incoming one would shift things weirdly — we
        // renumber at the end anyway
        subRealms: Array.from(subMap.values()),
      });
    }
    const merged = Array.from(byId.values()).sort((a, b) => a.order - b.order);
    const renumbered = merged.map((r, i) => ({
      ...r,
      order: i,
      subRealms: r.subRealms
        ? [...r.subRealms].sort((a, b) => a.order - b.order).map((s, j) => ({ ...s, order: j }))
        : [],
    }));
    onChange(renumbered);
    setPendingImport(null);
    setExportStatus(
      tx(uiLanguage,
        `合并完成：大境界新增 ${majorAdded}，覆盖 ${majorCollisions}；小境界新增 ${subAdded}，覆盖 ${subCollisions}。已重新编号顺序。`,
        `Merged: ${majorAdded} new majors, ${majorCollisions} overwritten; ${subAdded} new subs, ${subCollisions} overwritten. Re-numbered.`)
    );
  };

  const sortedMajors = [...realms].sort((a, b) => a.order - b.order);

  return (
    <div className="flex flex-col h-full">
      {/* ── Sticky header: description + import/export + add-major form + import preview */}
      <div className="flex-shrink-0 px-5 pt-4 pb-3 space-y-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed flex-1 min-w-[220px]">
            {tx(uiLanguage,
              '为本书定义修炼境界阶梯。顶部输入新建大境界（XX境）；展开后可在每个大境界内添加小境界（XX境初期 等）。',
              'Define this book\'s cultivation ladder. Use the top input to add a major realm (e.g. "Foundation"). Each major realm can have sub-realms added inline below (e.g. "Foundation Early").')}
          </p>
          <div className="flex gap-1.5 flex-shrink-0">
            <button
              onClick={handleImportPickFile}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              title={tx(uiLanguage,
                '从其他项目 / 网上分享的境界系统 JSON 导入',
                'Import realms from another project or a shared JSON file')}
            >
              <Upload className="w-3.5 h-3.5" />
              {tx(uiLanguage, '导入', 'Import')}
            </button>
            <button
              onClick={handleExport}
              disabled={realms.length === 0}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              title={tx(uiLanguage,
                '把当前境界阶梯导出为 JSON 文件',
                'Export the current realm ladder as JSON')}
            >
              <Download className="w-3.5 h-3.5" />
              {tx(uiLanguage, '导出', 'Export')}
            </button>
          </div>
        </div>

        {exportStatus && !pendingImport && (
          <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40 rounded px-3 py-2 leading-relaxed">
            {exportStatus}
          </div>
        )}

        {pendingImport && (() => {
          const majorCollisions = pendingImport.realms.filter((r) => realms.some((x) => x.id === r.id)).length;
          const majorNew = pendingImport.realms.length - majorCollisions;
          const incomingSubTotal = pendingImport.realms.reduce((acc, r) => acc + (r.subRealms?.length || 0), 0);
          return (
            <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm text-amber-900 dark:text-amber-200">
                  <span className="font-medium">{tx(uiLanguage, '即将导入', 'Ready to import')}</span>
                  <span className="ml-2 text-xs text-amber-800 dark:text-amber-300 break-all">
                    {pendingImport.fileName}
                  </span>
                </div>
                <button
                  onClick={() => setPendingImport(null)}
                  className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                >
                  {tx(uiLanguage, '取消', 'Cancel')}
                </button>
              </div>
              <div className="text-xs text-gray-700 dark:text-gray-300 grid grid-cols-2 gap-x-3 gap-y-0.5">
                <div>{tx(uiLanguage, `备份中大境界：`, `Major realms in backup: `)}<span className="font-medium">{pendingImport.realms.length}</span></div>
                <div>{tx(uiLanguage, `备份中小境界：`, `Sub-realms in backup: `)}<span className="font-medium">{incomingSubTotal}</span></div>
                <div>{tx(uiLanguage, `当前大境界数：`, `Current majors: `)}<span className="font-medium">{realms.length}</span></div>
                <div>{tx(uiLanguage, `大境界 ID 冲突：`, `Major ID collisions: `)}<span className="font-medium">{majorCollisions}</span></div>
                <div>{tx(uiLanguage, `大境界新增：`, `New majors: `)}<span className="font-medium">{majorNew}</span></div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button onClick={applyImportMerge} className="text-xs py-1 flex-1">
                  {tx(uiLanguage, '智能合并', 'Smart Merge')}
                </Button>
                <Button
                  onClick={() => {
                    if (referencedRealmIds.size > 0 && realms.length > 0) {
                      const ok = window.confirm(
                        tx(uiLanguage,
                          '"替换全部" 会清掉当前所有境界。角色境界事件引用旧境界 ID 的会变成"已删除的境界"。继续？',
                          '"Replace all" wipes current realms; old-id events become dangling. Continue?')
                      );
                      if (!ok) return;
                    }
                    applyImportReplace();
                  }}
                  variant="outline"
                  className="text-xs py-1 flex-1 !border-red-300 !text-red-600 dark:!border-red-700 dark:!text-red-400"
                >
                  {tx(uiLanguage, '替换全部', 'Replace All')}
                </Button>
              </div>
            </div>
          );
        })()}

        {/* Add new major realm */}
        <div className="border border-dashed border-amber-300 dark:border-amber-700 rounded-lg p-2.5 bg-amber-50/40 dark:bg-amber-900/10">
          <div className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1.5">
            {tx(uiLanguage, '新建大境界', 'Add major realm')}
          </div>
          <div className="flex flex-col md:flex-row gap-2">
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addMajorRealm(); }}
              placeholder={tx(uiLanguage, '大境界名称（必填），例如：炼气期', 'Major realm name (required), e.g. Qi Refining')}
              className="flex-1 px-3 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
            <input
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addMajorRealm(); }}
              placeholder={tx(uiLanguage, '描述（可选）', 'Description (optional)')}
              className="flex-[1.5] px-3 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
            <Button onClick={addMajorRealm} disabled={!draftName.trim()} className="text-sm py-1.5">
              <Plus className="w-4 h-4 mr-1" />
              {tx(uiLanguage, '添加大境界', 'Add Major')}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Scrolling list of major realms (with nested subs inside each) */}
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
        {sortedMajors.length === 0 ? (
          <div className="text-center py-10 text-sm text-gray-500 dark:text-gray-400">
            {tx(uiLanguage,
              '还没有大境界，先在上方添加第一个。',
              'No major realms yet. Add the first one above.')}
          </div>
        ) : (
          sortedMajors.map((r, idx) => (
            <MajorRealmCard
              key={r.id}
              uiLanguage={uiLanguage}
              realm={r}
              index={idx}
              total={sortedMajors.length}
              onUpdate={(patch) => updateMajor(r.id, patch)}
              onMove={(dir) => moveMajor(r.id, dir)}
              onRemove={() => removeMajor(r.id)}
              onAddSub={(name, desc) => addSub(r.id, name, desc)}
              onUpdateSub={(subId, patch) => updateSub(r.id, subId, patch)}
              onMoveSub={(subId, dir) => moveSub(r.id, subId, dir)}
              onRemoveSub={(subId) => removeSub(r.id, subId)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Major realm card with nested sub-realms ──────────────────

interface MajorRealmCardProps {
  uiLanguage: 'zh' | 'en';
  realm: CultivationRealm;
  index: number;
  total: number;
  onUpdate: (patch: Partial<CultivationRealm>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onAddSub: (name: string, desc: string) => void;
  onUpdateSub: (subId: string, patch: Partial<CultivationSubRealm>) => void;
  onMoveSub: (subId: string, dir: -1 | 1) => void;
  onRemoveSub: (subId: string) => void;
}

function MajorRealmCard({
  uiLanguage, realm, index, total, onUpdate, onMove, onRemove,
  onAddSub, onUpdateSub, onMoveSub, onRemoveSub,
}: MajorRealmCardProps) {
  const [subDraftName, setSubDraftName] = useState('');
  const [subDraftDesc, setSubDraftDesc] = useState('');

  const submitSub = () => {
    const n = subDraftName.trim();
    if (!n) return;
    onAddSub(n, subDraftDesc);
    setSubDraftName('');
    setSubDraftDesc('');
  };

  const subs = [...(realm.subRealms || [])].sort((a, b) => a.order - b.order);

  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50/30 dark:bg-amber-900/10 overflow-hidden">
      {/* Major realm header row */}
      <div className="flex items-start gap-2 p-2.5 bg-amber-50 dark:bg-amber-900/20">
        <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 text-xs font-bold">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0 space-y-1">
          <input
            value={realm.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            className="w-full px-2 py-1 text-sm font-semibold border-0 bg-transparent focus:bg-white dark:focus:bg-gray-800 rounded focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-900 dark:text-white"
          />
          <input
            value={realm.description || ''}
            onChange={(e) => onUpdate({ description: e.target.value || undefined })}
            placeholder={tx(uiLanguage, '大境界描述（可选）', 'Description (optional)')}
            className="w-full px-2 py-1 text-xs border-0 bg-transparent focus:bg-white dark:focus:bg-gray-800 rounded focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-600 dark:text-gray-400"
          />
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className="p-1 rounded hover:bg-amber-200 dark:hover:bg-amber-800 disabled:opacity-30 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300"
            title={tx(uiLanguage, '上移', 'Move up')}
          >
            <ArrowUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            className="p-1 rounded hover:bg-amber-200 dark:hover:bg-amber-800 disabled:opacity-30 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300"
            title={tx(uiLanguage, '下移', 'Move down')}
          >
            <ArrowDown className="w-4 h-4" />
          </button>
          <button
            onClick={onRemove}
            className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600"
            title={tx(uiLanguage, '删除大境界', 'Delete major realm')}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Sub-realms list, indented inside the major card */}
      <div className="px-2.5 pt-2 pb-2.5 space-y-1.5">
        {subs.length > 0 && (
          <div className="pl-9 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
            {tx(uiLanguage, '小境界', 'Sub-realms')}
          </div>
        )}
        {subs.map((s, sIdx) => (
          <div
            key={s.id}
            className="ml-9 flex items-start gap-2 p-1.5 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
          >
            <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 text-[10px] font-semibold">
              {index + 1}.{sIdx + 1}
            </span>
            <div className="flex-1 min-w-0 space-y-0.5">
              <input
                value={s.name}
                onChange={(e) => onUpdateSub(s.id, { name: e.target.value })}
                className="w-full px-1.5 py-0.5 text-sm border-0 bg-transparent focus:bg-gray-50 dark:focus:bg-gray-900 rounded focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-900 dark:text-white"
              />
              <input
                value={s.description || ''}
                onChange={(e) => onUpdateSub(s.id, { description: e.target.value || undefined })}
                placeholder={tx(uiLanguage, '描述（可选）', 'Description (optional)')}
                className="w-full px-1.5 py-0.5 text-xs border-0 bg-transparent focus:bg-gray-50 dark:focus:bg-gray-900 rounded focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-500 dark:text-gray-400"
              />
            </div>
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button
                onClick={() => onMoveSub(s.id, -1)}
                disabled={sIdx === 0}
                className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-gray-500"
                title={tx(uiLanguage, '上移', 'Move up')}
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onMoveSub(s.id, 1)}
                disabled={sIdx === subs.length - 1}
                className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-gray-500"
                title={tx(uiLanguage, '下移', 'Move down')}
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onRemoveSub(s.id)}
                className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600"
                title={tx(uiLanguage, '删除小境界', 'Delete sub-realm')}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}

        {/* Inline add-sub form */}
        <div className="ml-9 flex flex-col sm:flex-row gap-1.5 mt-1">
          <input
            value={subDraftName}
            onChange={(e) => setSubDraftName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitSub(); }}
            placeholder={tx(uiLanguage,
              `添加小境界，例如：${realm.name}初期`,
              `Add sub-realm, e.g. ${realm.name} Early`)}
            className="flex-1 px-2 py-1 text-xs border border-dashed rounded dark:bg-gray-800 dark:border-gray-600 dark:text-white"
          />
          <input
            value={subDraftDesc}
            onChange={(e) => setSubDraftDesc(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitSub(); }}
            placeholder={tx(uiLanguage, '描述（可选）', 'Description (optional)')}
            className="flex-1 px-2 py-1 text-xs border border-dashed rounded dark:bg-gray-800 dark:border-gray-600 dark:text-white"
          />
          <button
            onClick={submitSub}
            disabled={!subDraftName.trim()}
            className="flex items-center justify-center gap-1 text-xs px-2 py-1 rounded bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 text-amber-800 dark:text-amber-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" />
            {tx(uiLanguage, '加', 'Add')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Characters grid view (uses new resolved-realm signature) ─

interface CharactersGridViewProps {
  uiLanguage: 'zh' | 'en';
  characters: ReturnType<ReturnType<typeof useAppStore.getState>['getCharacters']>;
  realms: CultivationRealm[];
  events: CharacterRealmEvent[];
  chapterMap: Map<string, Chapter>;
  onSelect: (characterId: string) => void;
}

function CharactersGridView({
  uiLanguage, characters, realms, events, chapterMap, onSelect,
}: CharactersGridViewProps) {
  if (characters.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-5">
        <div className="text-center py-10 text-sm text-gray-500 dark:text-gray-400">
          {tx(uiLanguage,
            '本项目暂无角色。请先在「角色」页面添加角色。',
            'No characters yet. Add characters from the "Characters" page first.')}
        </div>
      </div>
    );
  }

  if (realms.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-5">
        <div className="text-center py-10 text-sm text-gray-500 dark:text-gray-400">
          {tx(uiLanguage,
            '请先在「修炼境界表」标签里定义境界，再回来这里记录角色进阶。',
            'Define realms in the first tab before tracking character advancement here.')}
        </div>
      </div>
    );
  }

  const sorted = [...characters].sort((a, b) => {
    if (a.isProtagonist !== b.isProtagonist) return a.isProtagonist ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="h-full overflow-y-auto p-5 space-y-3">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {tx(uiLanguage,
          '点击角色卡片查看该角色的全部进阶记录。当前境界基于该角色"最新仍存在的章节"自动计算。',
          'Click a character to view their full advancement history. Current realm is auto-computed from the latest still-existing chapter.')}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {sorted.map((char) => {
          const { major, sub, chapter } = computeCurrentRealm(char.id, events, chapterMap, realms);
          const label = major ? (sub ? `${major.name} · ${sub.name}` : major.name) : null;
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
                {label ? (
                  <div className="space-y-0.5">
                    <div className="text-amber-700 dark:text-amber-400 font-medium">{label}</div>
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

// ── Character detail view ────────────────────────────────────

interface CharacterDetailViewProps {
  uiLanguage: 'zh' | 'en';
  characterId: string;
  characters: ReturnType<ReturnType<typeof useAppStore.getState>['getCharacters']>;
  realms: CultivationRealm[];
  events: CharacterRealmEvent[];
  chapters: Chapter[];
  chapterMap: Map<string, Chapter>;
  onBack: () => void;
  onAddEvent: (payload: Omit<CharacterRealmEvent, 'id'>) => void;
  onDeleteEvent: (eventId: string) => void;
}

function CharacterDetailView({
  uiLanguage, characterId, characters, realms, events, chapters, chapterMap,
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
      const resolved = findRealmById(realms, e.realmId);
      return {
        ...e,
        chapterExists: !!c,
        chapterTitle: c?.title ?? '',
        liveOrderIndex: c ? c.order_index : e.chapterOrderIndex,
        realmLabel: resolved
          ? (resolved.sub ? `${resolved.major.name} · ${resolved.sub.name}` : resolved.major.name)
          : null,
      };
    })
    .sort((a, b) => a.liveOrderIndex - b.liveOrderIndex);

  if (!character) {
    return (
      <div className="h-full overflow-y-auto p-5">
        <div className="text-center py-10 text-sm text-gray-500 dark:text-gray-400">
          {tx(uiLanguage, '角色不存在', 'Character not found')}
        </div>
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
  };

  const sortedChapters = [...chapters].sort((a, b) => a.order_index - b.order_index);
  const sortedRealms = [...realms].sort((a, b) => a.order - b.order);

  return (
    <div className="h-full overflow-y-auto p-5 space-y-4">
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
            {sortedRealms.flatMap((r) => {
              const subs = [...(r.subRealms || [])].sort((a, b) => a.order - b.order);
              return [
                <option key={r.id} value={r.id}>{r.name}</option>,
                ...subs.map((s) => (
                  <option key={s.id} value={s.id}>{`　　${r.name} · ${s.name}`}</option>
                )),
              ];
            })}
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
          placeholder={tx(uiLanguage, '备注（可选，例如"得到机缘后"）', 'Note (optional)')}
          className="w-full px-3 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
        />
        <div className="flex justify-end">
          <Button onClick={handleAdd} disabled={!draftRealmId || !draftChapterId} className="text-sm py-1.5">
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
            {tx(uiLanguage, '该角色暂无进阶记录。', 'No advancements recorded yet.')}
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
                      {ev.realmLabel || tx(uiLanguage, `（已删除的境界）`, '(deleted realm)')}
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

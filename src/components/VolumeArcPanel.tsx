import { useEffect, useState } from 'react';
import { useAppStore } from '@store/index';
import type { PlotArc, Volume } from '@store/index';
import { Button } from '@components/Button';
import { ArcStatusControl } from '@components/ArcStatusControl';
import { VolumeEditModal } from '@components/VolumeEditModal';
import {
  Library, FolderPlus, Sparkles, Plus, Edit2, Trash2, ChevronDown, ChevronUp, Check,
} from 'lucide-react';
import { generateVolumes, generateArcsForVolume } from '@utils/volumeAi';
import { buildVolumeRealmConstraint } from '@utils/cultivation';
import { confirmDialog } from '@utils/index';
import { uiPrompt } from '@components/uiDialog';
import { tx } from '@utils/i18n';

const ARC_STATUS_LABELS: Record<PlotArc['status'], { zh: string; en: string }> = {
  upcoming: { zh: '未开始', en: 'Upcoming' },
  active: { zh: '进行中', en: 'Active' },
  ending: { zh: '结尾阶段', en: 'Ending' },
  completed: { zh: '已完成', en: 'Completed' },
};

function arcStatusClass(status: PlotArc['status']) {
  const map = {
    upcoming: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    active: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    ending: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  };
  return map[status] || map.upcoming;
}

/**
 * Project → 副本(Volume) → 弧线(Arc) tree with full management (create/AI-generate volumes & arcs,
 * 3-state progress, reorder, edit, delete). Shared by the long-novel hub and the chapter editor's
 * arc-progress panel so both show the identical structure.
 */
export function VolumeArcPanel({ projectId, uiLanguage, compact = false }: { projectId: string; uiLanguage: 'zh' | 'en'; compact?: boolean }) {
  const {
    projects,
    getPlotArcs, addPlotArc, updatePlotArc, deletePlotArc,
    getVolumes, setVolumes, ensureVolumes,
    textModelConfig,
  } = useAppStore();

  const hasValidTextConfig =
    textModelConfig.apiKey.trim().length > 0 &&
    textModelConfig.apiUrl.trim().length > 0 &&
    textModelConfig.model.trim().length > 0;

  const [expandedVolumeId, setExpandedVolumeId] = useState<string | null>(null);
  const [expandedArcs, setExpandedArcs] = useState<Record<string, boolean>>({});
  const [editingVolume, setEditingVolume] = useState<Volume | null>(null);
  const [showArcModal, setShowArcModal] = useState<{ mode: 'create' | 'edit'; arc?: PlotArc; volumeId?: string } | null>(null);
  const [volGen, setVolGen] = useState<{ mode: 'volumes' } | { mode: 'arcs'; volume: Volume } | null>(null);
  const [isVolGenerating, setIsVolGenerating] = useState(false);
  const [volGenError, setVolGenError] = useState<string | null>(null);

  const arcs = getPlotArcs(projectId);
  const volumes = getVolumes(projectId);
  const sortedArcs = [...arcs].sort((a, b) => a.order - b.order);
  const sortedVolumes = [...volumes].sort((a, b) => a.order - b.order);
  const projectDescription = projects.find((p) => p.id === projectId)?.description || '';

  useEffect(() => { ensureVolumes(projectId); }, [projectId]);

  // ── Volume ops ───────────────────────────────────────────────
  const createVolume = async () => {
    const name = await uiPrompt({
      title: tx(uiLanguage, '新建副本', 'New Volume'),
      label: tx(uiLanguage, '副本名称', 'Volume name'),
      defaultValue: tx(uiLanguage, `副本${volumes.length + 1}`, `Volume ${volumes.length + 1}`),
    });
    if (name === null) return;
    const next: Volume = {
      id: `vol-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || tx(uiLanguage, `副本${volumes.length + 1}`, `Volume ${volumes.length + 1}`),
      description: '',
      order: volumes.length,
      createdAt: new Date().toISOString(),
    };
    setVolumes(projectId, [...volumes, next]);
    setExpandedVolumeId(next.id);
  };

  const saveVolumeEdit = (vol: Volume, name: string, description: string, realmPlan: string) => {
    setVolumes(projectId, volumes.map((v) => (v.id === vol.id ? { ...v, name, description, realmPlan } : v)));
  };

  const handleDeleteVolume = async (vol: Volume) => {
    const ok = await confirmDialog(
      tx(uiLanguage, '删除该副本？其下弧线会移动到其它副本（不会删除弧线）。', 'Delete this volume? Its arcs move to another volume (arcs are kept).'),
      tx(uiLanguage, '删除副本', 'Delete Volume')
    );
    if (!ok) return;
    const remaining = volumes.filter((v) => v.id !== vol.id);
    const fallbackId = remaining[0]?.id;
    arcs.filter((a) => a.volumeId === vol.id).forEach((a) => updatePlotArc(projectId, a.id, { volumeId: fallbackId }));
    setVolumes(projectId, remaining.map((v, i) => ({ ...v, order: i })));
  };

  const moveVolume = (vol: Volume, dir: 'up' | 'down') => {
    const sorted = [...volumes].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((v) => v.id === vol.id);
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= sorted.length) return;
    [sorted[idx], sorted[swap]] = [sorted[swap], sorted[idx]];
    setVolumes(projectId, sorted.map((v, i) => ({ ...v, order: i })));
  };

  // ── Arc ops ──────────────────────────────────────────────────
  const handleDeleteArc = async (arcId: string) => {
    const ok = await confirmDialog(
      tx(uiLanguage, '确定要删除这个剧情弧线吗？', 'Delete this plot arc?'),
      tx(uiLanguage, '删除弧线', 'Delete Arc')
    );
    if (!ok) return;
    deletePlotArc(projectId, arcId);
  };

  const moveArcToPosition = (arcId: string, position: number) => {
    const arc = arcs.find((a) => a.id === arcId);
    if (!arc) return;
    const volArcs = [...arcs].filter((a) => a.volumeId === arc.volumeId).sort((a, b) => a.order - b.order);
    const slots = volArcs.map((a) => a.order);
    const without = volArcs.filter((a) => a.id !== arcId);
    const clamped = Math.max(1, Math.min(volArcs.length, Math.floor(position)));
    without.splice(clamped - 1, 0, arc);
    without.forEach((a, i) => { if (a.order !== slots[i]) updatePlotArc(projectId, a.id, { order: slots[i] }); });
  };

  const moveArcInVolume = (arcId: string, dir: 'up' | 'down') => {
    const arc = arcs.find((a) => a.id === arcId);
    if (!arc) return;
    const volArcs = [...arcs].filter((a) => a.volumeId === arc.volumeId).sort((a, b) => a.order - b.order);
    const idx = volArcs.findIndex((a) => a.id === arcId);
    moveArcToPosition(arcId, idx + (dir === 'up' ? 0 : 2));
  };

  const handleGenerateVolumes = async (count: number, reqs: string) => {
    setIsVolGenerating(true);
    setVolGenError(null);
    try {
      const gen = await generateVolumes({
        count, context: projectDescription.slice(0, 2000),
        existingVolumes: volumes.map((v) => `- ${v.name}：${v.description}`).join('\n'),
        requirements: reqs, textConfig: textModelConfig, uiLanguage,
      });
      if (gen.length === 0) { setVolGenError(tx(uiLanguage, 'AI 未返回有效副本，请重试', 'AI returned no valid volumes — retry')); return; }
      const created: Volume[] = gen.map((v, i) => ({
        id: `vol-${Date.now()}-${i}`, name: v.name, description: v.description, order: volumes.length + i, createdAt: new Date().toISOString(),
      }));
      setVolumes(projectId, [...volumes, ...created]);
      setVolGen(null);
    } catch (e) {
      setVolGenError(typeof e === 'string' ? e : tx(uiLanguage, '生成失败', 'Generation failed'));
    } finally {
      setIsVolGenerating(false);
    }
  };

  const handleGenerateArcsForVolume = async (volume: Volume, count: number, reqs: string) => {
    setIsVolGenerating(true);
    setVolGenError(null);
    try {
      const inVol = arcs.filter((a) => a.volumeId === volume.id);
      const volConstraint = buildVolumeRealmConstraint(volume.realmPlan, volume.name, uiLanguage, 'plan');
      const requirements = [reqs, volConstraint].filter((x) => x && x.trim()).join('\n\n');
      const gen = await generateArcsForVolume({
        count, volumeName: volume.name, volumeDescription: volume.description,
        context: projectDescription.slice(0, 2000),
        existingArcs: inVol.map((a) => `- ${a.title}`).join('\n'),
        requirements, textConfig: textModelConfig, uiLanguage,
      });
      if (gen.length === 0) { setVolGenError(tx(uiLanguage, 'AI 未返回有效弧线，请重试', 'AI returned no valid arcs — retry')); return; }
      let order = arcs.length;
      for (const g of gen) {
        addPlotArc(projectId, { title: g.title, summary: g.summary, order: order++, status: 'upcoming', chapterCount: g.chapter_count, volumeId: volume.id });
      }
      setExpandedVolumeId(volume.id);
      setVolGen(null);
    } catch (e) {
      setVolGenError(typeof e === 'string' ? e : tx(uiLanguage, '生成失败', 'Generation failed'));
    } finally {
      setIsVolGenerating(false);
    }
  };

  const renderArcCard = (arc: PlotArc, move?: { onMoveUp?: () => void; onMoveDown?: () => void }) => (
    <ArcCard
      key={arc.id}
      arc={arc}
      index={sortedArcs.indexOf(arc)}
      uiLanguage={uiLanguage}
      expanded={!!expandedArcs[arc.id]}
      onToggle={() => setExpandedArcs((prev) => ({ ...prev, [arc.id]: !prev[arc.id] }))}
      onEdit={() => setShowArcModal({ mode: 'edit', arc })}
      onDelete={() => handleDeleteArc(arc.id)}
      onStatusChange={(status) => updatePlotArc(projectId, arc.id, { status })}
      onMoveUp={move?.onMoveUp}
      onMoveDown={move?.onMoveDown}
    />
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Library className="w-4 h-4 text-purple-600" />
          {tx(uiLanguage, '副本 / 弧线', 'Volumes / Arcs')}
        </h2>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => { setVolGenError(null); setVolGen({ mode: 'volumes' }); }}
            disabled={!hasValidTextConfig}
            className={`flex items-center gap-1 rounded-lg bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 text-purple-700 dark:text-purple-300 hover:from-purple-100 hover:to-pink-100 disabled:opacity-40 transition-colors ${compact ? 'p-1.5' : 'text-xs px-2.5 py-1.5'}`}
            title={tx(uiLanguage, 'AI 生成副本', 'AI generate volumes')}
          >
            <Sparkles className={compact ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
            {!compact && tx(uiLanguage, 'AI 副本', 'AI Volumes')}
          </button>
          <button
            onClick={createVolume}
            className={`flex items-center gap-1 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors ${compact ? 'p-1.5' : 'text-xs px-2.5 py-1.5'}`}
            title={tx(uiLanguage, '新建副本', 'New Volume')}
          >
            <FolderPlus className={compact ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
            {!compact && tx(uiLanguage, '新建副本', 'New Volume')}
          </button>
        </div>
      </div>

      {sortedVolumes.length === 0 && sortedArcs.length === 0 ? (
        <div className="text-center py-6 text-sm text-gray-400">
          <Library className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p>{tx(uiLanguage, '还没有副本', 'No volumes yet')}</p>
          <p className="text-xs mt-1 opacity-70">
            {tx(uiLanguage, '结构：项目 → 副本 → 弧线 → 章节。先建副本，再在副本内生成弧线。', 'Structure: project → volume → arc → chapter. Create a volume, then generate arcs in it.')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedVolumes.map((vol, vIdx) => {
            const volArcs = sortedArcs.filter((a) => a.volumeId === vol.id);
            const open = expandedVolumeId === vol.id;
            return (
              <div key={vol.id} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div
                  className="flex items-start gap-2 px-3 py-2.5 bg-purple-50/60 dark:bg-purple-900/10 cursor-pointer hover:bg-purple-100/60 dark:hover:bg-purple-900/20 transition-colors"
                  onClick={() => setExpandedVolumeId(open ? null : vol.id)}
                >
                  <Library className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm text-gray-800 dark:text-gray-200 truncate block">{vIdx + 1}. {vol.name}</span>
                    {vol.description && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 block mt-0.5">{vol.description}</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">{tx(uiLanguage, `${volArcs.length} 弧线`, `${volArcs.length} arcs`)}</span>
                  {open ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                </div>
                {open && (
                  <div className="p-2 space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5 px-1">
                      <button
                        onClick={() => { setVolGenError(null); setVolGen({ mode: 'arcs', volume: vol }); }}
                        disabled={!hasValidTextConfig}
                        className={`flex items-center gap-1 rounded bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 text-purple-700 dark:text-purple-300 hover:from-purple-100 hover:to-pink-100 disabled:opacity-40 ${compact ? 'p-1.5' : 'text-xs px-2 py-1'}`}
                        title={tx(uiLanguage, '在本副本内 AI 生成弧线', 'AI generate arcs in this volume')}
                      >
                        <Sparkles className={compact ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
                        {!compact && tx(uiLanguage, 'AI 弧线', 'AI Arcs')}
                      </button>
                      <button
                        onClick={() => setShowArcModal({ mode: 'create', volumeId: vol.id })}
                        className={`flex items-center gap-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 ${compact ? 'p-1.5' : 'text-xs px-2 py-1'}`}
                        title={tx(uiLanguage, '加弧线', 'Add Arc')}
                      >
                        <Plus className={compact ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
                        {!compact && tx(uiLanguage, '加弧线', 'Add Arc')}
                      </button>
                      <div className="flex-1" />
                      <button onClick={() => moveVolume(vol, 'up')} disabled={vIdx === 0} className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30" title={tx(uiLanguage, '上移', 'Move up')}><ChevronUp className="w-3.5 h-3.5" /></button>
                      <button onClick={() => moveVolume(vol, 'down')} disabled={vIdx === sortedVolumes.length - 1} className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30" title={tx(uiLanguage, '下移', 'Move down')}><ChevronDown className="w-3.5 h-3.5" /></button>
                      <button onClick={() => setEditingVolume(vol)} className="p-1 rounded text-gray-400 hover:text-blue-600" title={tx(uiLanguage, '编辑副本（名称 / 简介）', 'Edit volume (name / description)')}><Edit2 className="w-3.5 h-3.5" /></button>
                      {sortedVolumes.length > 1 && (
                        <button onClick={() => handleDeleteVolume(vol)} className="p-1 rounded text-gray-400 hover:text-red-600" title={tx(uiLanguage, '删除副本', 'Delete volume')}><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                    {volArcs.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-1">{tx(uiLanguage, '本副本暂无弧线', 'No arcs in this volume')}</p>
                    ) : (
                      volArcs.map((arc, i) => renderArcCard(arc, {
                        onMoveUp: i > 0 ? () => moveArcInVolume(arc.id, 'up') : undefined,
                        onMoveDown: i < volArcs.length - 1 ? () => moveArcInVolume(arc.id, 'down') : undefined,
                      }))
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {(() => {
            const ids = new Set(sortedVolumes.map((v) => v.id));
            const orphans = sortedArcs.filter((a) => !a.volumeId || !ids.has(a.volumeId));
            if (orphans.length === 0) return null;
            return (
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-2 space-y-2">
                <p className="text-xs text-gray-400 px-1">{tx(uiLanguage, '未分配副本', 'Unassigned')}</p>
                {orphans.map((arc) => renderArcCard(arc))}
              </div>
            );
          })()}
        </div>
      )}

      {/* Modals */}
      {volGen && (
        <VolumeGenModal
          mode={volGen.mode}
          volumeName={volGen.mode === 'arcs' ? volGen.volume.name : undefined}
          uiLanguage={uiLanguage}
          loading={isVolGenerating}
          error={volGenError}
          onClose={() => { if (!isVolGenerating) { setVolGen(null); setVolGenError(null); } }}
          onConfirm={(count, reqs) => {
            if (volGen.mode === 'volumes') handleGenerateVolumes(count, reqs);
            else handleGenerateArcsForVolume(volGen.volume, count, reqs);
          }}
        />
      )}

      {showArcModal && (() => {
        const editingArc = showArcModal.arc;
        const volArcs = editingArc ? sortedArcs.filter((a) => a.volumeId === editingArc.volumeId) : [];
        const arcPosition = editingArc ? volArcs.findIndex((a) => a.id === editingArc.id) + 1 : 0;
        return (
          <ArcEditModal
            mode={showArcModal.mode}
            arc={showArcModal.arc}
            nextOrder={arcs.length + 1}
            uiLanguage={uiLanguage}
            arcPosition={arcPosition}
            arcPositionMax={volArcs.length}
            onClose={() => setShowArcModal(null)}
            onSave={(data, position) => {
              if (showArcModal.mode === 'create') {
                const volumeId = showArcModal.volumeId ?? sortedVolumes[0]?.id;
                addPlotArc(projectId, { ...data, volumeId });
              } else if (showArcModal.arc) {
                updatePlotArc(projectId, showArcModal.arc.id, data);
                if (position && position !== arcPosition) moveArcToPosition(showArcModal.arc.id, position);
              }
              setShowArcModal(null);
            }}
          />
        );
      })()}

      {editingVolume && (
        <VolumeEditModal
          initialName={editingVolume.name}
          initialDescription={editingVolume.description}
          initialRealmPlan={editingVolume.realmPlan ?? ''}
          uiLanguage={uiLanguage}
          onClose={() => setEditingVolume(null)}
          onSave={(name, description, realmPlan) => { saveVolumeEdit(editingVolume, name, description, realmPlan); setEditingVolume(null); }}
        />
      )}
    </div>
  );
}

// ── Arc Card ────────────────────────────────────────────────────
function ArcCard({
  arc, index, uiLanguage, expanded, onToggle, onEdit, onDelete, onStatusChange, onMoveUp, onMoveDown,
}: {
  arc: PlotArc;
  index: number;
  uiLanguage: 'zh' | 'en';
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (s: PlotArc['status']) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const info = ARC_STATUS_LABELS[arc.status];
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div
        className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
          arc.status === 'active' || arc.status === 'ending' ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
        }`}
        onClick={onToggle}
      >
        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
          arc.status === 'completed' ? 'bg-green-500 text-white'
          : arc.status === 'active' || arc.status === 'ending' ? 'bg-blue-500 text-white'
          : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
        }`}>
          {arc.status === 'completed' ? <Check className="w-3 h-3" /> : index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate block">{arc.title}</span>
        </div>
        <span className={`text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 ${arcStatusClass(arc.status)}`}>
          {uiLanguage === 'zh' ? info.zh : info.en}
        </span>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
      </div>
      {expanded && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 pt-2.5">
          {arc.summary && <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{arc.summary}</p>}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">{tx(uiLanguage, '进度', 'Progress')}</span>
            <ArcStatusControl status={arc.status} uiLanguage={uiLanguage} onChange={onStatusChange} />
          </div>
          <div className="flex items-center gap-3 pt-0.5">
            <button onClick={onEdit} className="flex items-center gap-1 text-xs text-gray-500 hover:text-primary-600 transition-colors"><Edit2 className="w-3 h-3" />{tx(uiLanguage, '编辑', 'Edit')}</button>
            <button onClick={onDelete} className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 transition-colors"><Trash2 className="w-3 h-3" />{tx(uiLanguage, '删除', 'Delete')}</button>
            <div className="flex-1" />
            <button onClick={onMoveUp} disabled={!onMoveUp} className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 transition-colors" title={tx(uiLanguage, '在副本内上移', 'Move up in volume')}><ChevronUp className="w-3.5 h-3.5" /></button>
            <button onClick={onMoveDown} disabled={!onMoveDown} className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 transition-colors" title={tx(uiLanguage, '在副本内下移', 'Move down in volume')}><ChevronDown className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 副本 / 弧线 AI generation modal ────────────────────────────
function VolumeGenModal({
  mode, volumeName, uiLanguage, loading, error, onClose, onConfirm,
}: {
  mode: 'volumes' | 'arcs';
  volumeName?: string;
  uiLanguage: 'zh' | 'en';
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (count: number, requirements: string) => void;
}) {
  const [count, setCount] = useState(mode === 'volumes' ? '3' : '4');
  const [reqs, setReqs] = useState('');
  const title = mode === 'volumes'
    ? tx(uiLanguage, 'AI 生成副本', 'AI Generate Volumes')
    : tx(uiLanguage, `AI 为「${volumeName}」生成弧线`, `AI Generate Arcs for "${volumeName}"`);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}>
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md shadow-2xl">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-500" />
          {title}
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {mode === 'volumes' ? tx(uiLanguage, '生成数量', 'Count') : tx(uiLanguage, '生成弧线数量', 'Arc count')}
            </label>
            <input type="number" min={1} max={12} value={count} onChange={(e) => setCount(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tx(uiLanguage, '额外要求（可选）', 'Requirements (optional)')}</label>
            <textarea
              value={reqs}
              onChange={(e) => setReqs(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-24 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
              placeholder={mode === 'volumes'
                ? tx(uiLanguage, '例如：第一个副本写新手村，最后一个走向终局…', 'e.g. first volume is the origin, last drives to the finale…')
                : tx(uiLanguage, '例如：本副本要有一个反派转折…', 'e.g. include a villain twist in this volume…')}
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
        <div className="flex gap-3 mt-6">
          <Button variant="outline" onClick={onClose} disabled={loading} className="flex-1">{tx(uiLanguage, '取消', 'Cancel')}</Button>
          <Button onClick={() => onConfirm(Math.max(1, Math.min(12, parseInt(count, 10) || 3)), reqs.trim())} loading={loading} className="flex-1 bg-purple-600 hover:bg-purple-700">
            <Sparkles className="w-4 h-4 mr-1.5" />
            {tx(uiLanguage, '生成', 'Generate')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Arc Edit Modal ─────────────────────────────────────────────
function ArcEditModal({
  mode, arc, nextOrder, uiLanguage, arcPosition, arcPositionMax, onClose, onSave,
}: {
  mode: 'create' | 'edit';
  arc?: PlotArc;
  nextOrder: number;
  uiLanguage: 'zh' | 'en';
  arcPosition?: number;
  arcPositionMax?: number;
  onClose: () => void;
  onSave: (data: Omit<PlotArc, 'id'>, position?: number) => void;
}) {
  const [title, setTitle] = useState(arc?.title ?? '');
  const [summary, setSummary] = useState(arc?.summary ?? '');
  const [status, setStatus] = useState<PlotArc['status']>(arc?.status ?? 'upcoming');
  const [miniOutline, setMiniOutline] = useState(arc?.miniOutline ?? '');
  const [position, setPosition] = useState(String(arcPosition ?? 1));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          {mode === 'create' ? tx(uiLanguage, '添加剧情弧线', 'Add Plot Arc') : tx(uiLanguage, '编辑剧情弧线', 'Edit Plot Arc')}
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tx(uiLanguage, '弧线名称 *', 'Arc Title *')}</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder={tx(uiLanguage, '例如：初入江湖、伏笔揭晓、终极决战', 'e.g. Prologue Arc, Revelation Arc, Climax Arc')} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tx(uiLanguage, '剧情概述', 'Arc Summary')}</label>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-24 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder={tx(uiLanguage, '简要描述这段剧情的核心内容、目的和结局...', 'Briefly describe the core content, purpose, and outcome of this arc...')} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tx(uiLanguage, '状态', 'Status')}</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as PlotArc['status'])} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500">
              {(Object.keys(ARC_STATUS_LABELS) as PlotArc['status'][]).map((s) => (
                <option key={s} value={s}>{uiLanguage === 'zh' ? ARC_STATUS_LABELS[s].zh : ARC_STATUS_LABELS[s].en}</option>
              ))}
            </select>
          </div>
          {mode === 'edit' && (arcPositionMax ?? 0) > 1 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tx(uiLanguage, `在副本内的顺序（1 - ${arcPositionMax}）`, `Position in volume (1 - ${arcPositionMax})`)}</label>
              <input type="number" min={1} max={arcPositionMax} value={position} onChange={(e) => setPosition(e.target.value)} className="w-24 px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500" />
              <p className="text-xs text-gray-400 mt-1">{tx(uiLanguage, '保存时移动到该序号。', 'Moved to this position on save.')}</p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tx(uiLanguage, '弧线小纲（可选）', 'Arc Mini-Outline (Optional)')}</label>
            <textarea value={miniOutline} onChange={(e) => setMiniOutline(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-40 resize-y font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-purple-500" spellCheck={false} placeholder={tx(uiLanguage, '格式：第1章：标题 — 目标\\n第2章：标题 — 目标', 'Format: Chapter 1: Title — Goal\\nChapter 2: Title — Goal')} />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <Button variant="outline" onClick={onClose} className="flex-1">{tx(uiLanguage, '取消', 'Cancel')}</Button>
          <Button
            onClick={() => {
              if (!title.trim()) return;
              onSave({
                title: title.trim(),
                summary: summary.trim(),
                order: arc?.order ?? nextOrder,
                status,
                chaptersUntilEnd: arc?.chaptersUntilEnd,
                chapterCount: arc?.chapterCount ?? 0,
                miniOutline: miniOutline.trim() || undefined,
                builtChapterIds: arc?.builtChapterIds,
                volumeId: arc?.volumeId,
              }, mode === 'edit' ? parseInt(position, 10) || undefined : undefined);
            }}
            className="flex-1 bg-purple-600 hover:bg-purple-700"
            disabled={!title.trim()}
          >
            {tx(uiLanguage, '保存', 'Save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAppStore } from '@store/index';
import { projectApi, snapshotApi } from '@services/api';
import type { SnapshotMeta } from '@services/api';
import { Button } from '@components/Button';
import { ArrowLeft, History, Save, RotateCcw, Trash2, Edit2, Clock } from 'lucide-react';
import { useSmartBack } from '@utils/useSmartBack';
import { tx } from '@utils/i18n';
import { confirmDialog, formatDate } from '@utils/index';
import { buildSnapshotContent, restoreSnapshot } from '@utils/snapshots';
import { uiPrompt } from '@components/uiDialog';

export function SnapshotsPage() {
  const { id } = useParams<{ id: string }>();
  const smartBack = useSmartBack(id ? `/long-novel/${id}` : '/long-novels');
  const { uiLanguage, currentProject, setCurrentProject } = useAppStore();

  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const refresh = async () => {
    if (!id) return;
    setLoading(true);
    try {
      setSnapshots(await snapshotApi.list(id));
    } catch (e) {
      console.warn('[Snapshot] list failed:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    projectApi.getById(id).then(setCurrentProject);
    refresh();
  }, [id]);

  const handleCreate = async () => {
    if (!id || busy) return;
    const label = await uiPrompt({
      title: tx(uiLanguage, '保存快照', 'Save snapshot'),
      label: tx(uiLanguage, '快照名称（可选）', 'Snapshot name (optional)'),
      defaultValue: tx(uiLanguage, `快照 ${new Date().toLocaleString()}`, `Snapshot ${new Date().toLocaleString()}`),
    });
    if (label === null) return;
    setBusy(true);
    setStatus(tx(uiLanguage, '正在保存快照…', 'Saving snapshot…'));
    try {
      const content = await buildSnapshotContent(id);
      await snapshotApi.create(id, label.trim() || null, content);
      setStatus(tx(uiLanguage, '快照已保存', 'Snapshot saved'));
      await refresh();
    } catch (e) {
      setStatus(tx(uiLanguage, `保存失败：${String(e)}`, `Save failed: ${String(e)}`));
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async (snap: SnapshotMeta) => {
    if (!id || busy) return;
    const ok = await confirmDialog(
      tx(uiLanguage,
        '回退会用该快照覆盖当前项目（晚于快照创建的章节将被删除）。回退前会自动保存一个当前版本的快照。确定继续？',
        'Restoring overwrites the current project with this snapshot (chapters created after it will be deleted). A snapshot of the current state is saved automatically first. Continue?'),
      tx(uiLanguage, '回退到此版本', 'Restore this version')
    );
    if (!ok) return;
    setBusy(true);
    setStatus(tx(uiLanguage, '正在回退…', 'Restoring…'));
    try {
      // Auto-backup current state before overwriting.
      const backup = await buildSnapshotContent(id);
      await snapshotApi.create(id, tx(uiLanguage, '(自动) 回退前备份', '(auto) pre-restore backup'), backup);
      const content = await snapshotApi.get(snap.id);
      await restoreSnapshot(id, content);
      setStatus(tx(uiLanguage, '已回退。请刷新页面以确保 UI 同步。', 'Restored. Reload the page to make sure the UI is in sync.'));
      await refresh();
    } catch (e) {
      setStatus(tx(uiLanguage, `回退失败：${String(e)}`, `Restore failed: ${String(e)}`));
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (snap: SnapshotMeta) => {
    const name = await uiPrompt({ title: tx(uiLanguage, '重命名快照', 'Rename snapshot'), label: tx(uiLanguage, '快照名称', 'Snapshot name'), defaultValue: snap.note ?? '' });
    if (!name?.trim()) return;
    await snapshotApi.rename(snap.id, name.trim());
    await refresh();
  };

  const handleDelete = async (snap: SnapshotMeta) => {
    const ok = await confirmDialog(
      tx(uiLanguage, '删除此快照？不可恢复。', 'Delete this snapshot? This cannot be undone.'),
      tx(uiLanguage, '删除快照', 'Delete Snapshot')
    );
    if (!ok) return;
    await snapshotApi.delete(snap.id);
    await refresh();
  };

  if (!id) return null;

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={smartBack} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <History className="w-5 h-5 text-purple-600" />
            {tx(uiLanguage, '版本历史', 'Version History')}
          </h1>
          {currentProject && <p className="text-sm text-gray-500">{currentProject.title}</p>}
        </div>
        <Button onClick={handleCreate} loading={busy} className="bg-purple-600 hover:bg-purple-700">
          <Save className="w-4 h-4 mr-1.5" />
          {tx(uiLanguage, '保存当前为快照', 'Snapshot Now')}
        </Button>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400">
        {tx(uiLanguage,
          '快照会完整保存当前项目（章节正文、插图、副本/弧线、角色、容器、成长、问小说等）。随时可回退到任一版本。',
          'A snapshot captures the whole project (chapter text, illustrations, volumes/arcs, characters, containers, growth, Q&A…). Restore to any version anytime.')}
      </p>

      {status && <p className="text-sm text-purple-600 dark:text-purple-400">{status}</p>}

      {loading ? (
        <div className="text-center py-12 text-gray-400">{tx(uiLanguage, '加载中…', 'Loading…')}</div>
      ) : snapshots.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
          <History className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">{tx(uiLanguage, '还没有快照', 'No snapshots yet')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {snapshots.map((snap) => (
            <div key={snap.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                <Clock className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-gray-900 dark:text-white truncate">
                  {snap.note || tx(uiLanguage, '未命名快照', 'Untitled snapshot')}
                </p>
                <p className="text-xs text-gray-400">{formatDate(snap.created_at)}</p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={() => handleRestore(snap)} disabled={busy} className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 disabled:opacity-40 transition-colors" title={tx(uiLanguage, '回退到此版本', 'Restore')}>
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button onClick={() => handleRename(snap)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 transition-colors" title={tx(uiLanguage, '重命名', 'Rename')}>
                  <Edit2 className="w-4 h-4" />
                </button>
                <button onClick={() => handleDelete(snap)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 transition-colors" title={tx(uiLanguage, '删除', 'Delete')}>
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

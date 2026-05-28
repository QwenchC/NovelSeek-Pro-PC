import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@store/index';
import { aiApi, chapterApi, knowledgeApi } from '@services/api';
import { Button } from '@components/Button';
import type {
  EmbeddingConfig,
  ImageEngine,
  KbStats,
  TextModelConfig,
  TextModelProfile,
  TextModelProvider,
} from '@typings/index';
import {
  CheckCircle,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  HardDriveDownload,
  Image,
  Key,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { tx } from '@utils/i18n';

type Status = 'idle' | 'testing' | 'success' | 'error';

// ── Backup / Restore types ────────────────────────────────────

const BACKUP_VERSION = 1;

const PROJECT_MAP_FIELDS = [
  'novelTypeByProject',
  'plotArcsByProject',
  'charactersByProject',
  'worldSettingByProject',
  'timelineByProject',
  'longNovelOutlineByProject',
  'characterRelationshipsByProject',
  'characterEventsByProject',
  'cultivationRealmsByProject',
  'characterRealmEventsByProject',
  'promoByChapter',
] as const;

const APP_SETTINGS_FIELDS = [
  'textModelProfiles',
  'activeTextModelProfileId',
  'textModelConfig',
  'pollinationsKey',
  'imageEngine',
  'comfyUIUrl',
  'embeddingConfig',
  'knowledgeBaseEnabled',
  'summariesEnabled',
  'entitiesEnabled',
  'theme',
  'uiLanguage',
] as const;

interface BackupBundle {
  version: number;
  exportedAt: string;
  appVersion?: string;
  data: Record<string, unknown>;
}

interface BackupSummary {
  projectIdsInBackup: number;
  projectIdsInStore: number;
  projectIdsOverlap: number;
  chapterPromosInBackup: number;
  hasAppSettings: boolean;
}

function collectProjectIds(maps: Record<string, unknown>[]): Set<string> {
  const ids = new Set<string>();
  for (const m of maps) {
    if (m && typeof m === 'object') {
      for (const k of Object.keys(m)) ids.add(k);
    }
  }
  return ids;
}

function summarizeBackup(file: BackupBundle, currentState: any): BackupSummary {
  const inMaps = PROJECT_MAP_FIELDS
    .filter((k) => k !== 'promoByChapter')
    .map((k) => file.data[k] as Record<string, unknown>);
  const curMaps = PROJECT_MAP_FIELDS
    .filter((k) => k !== 'promoByChapter')
    .map((k) => currentState[k] as Record<string, unknown>);

  const inIds = collectProjectIds(inMaps);
  const curIds = collectProjectIds(curMaps);
  let overlap = 0;
  inIds.forEach((id) => {
    if (curIds.has(id)) overlap += 1;
  });

  const promosIn = file.data.promoByChapter
    ? Object.keys(file.data.promoByChapter as Record<string, unknown>).length
    : 0;

  const hasAppSettings = APP_SETTINGS_FIELDS.some((k) => k in file.data);

  return {
    projectIdsInBackup: inIds.size,
    projectIdsInStore: curIds.size,
    projectIdsOverlap: overlap,
    chapterPromosInBackup: promosIn,
    hasAppSettings,
  };
}

const CUSTOM_MODEL_DEFAULT: Pick<TextModelProfile, 'provider' | 'apiUrl' | 'model' | 'temperature'> = {
  provider: 'custom',
  apiUrl: 'https://your-api.example.com/v1',
  model: 'your-model-name',
  temperature: 0.7,
};

function clampTemperature(value: number): number {
  if (!Number.isFinite(value)) return 0.7;
  return Math.min(2, Math.max(0, value));
}

function isProfileConfigValid(profile: TextModelProfile): boolean {
  return (
    profile.apiKey.trim().length > 0 &&
    profile.apiUrl.trim().length > 0 &&
    profile.model.trim().length > 0 &&
    Number.isFinite(profile.temperature)
  );
}

function toTextConfig(profile: TextModelProfile): TextModelConfig {
  return {
    provider: profile.provider,
    apiKey: profile.apiKey.trim(),
    apiUrl: profile.apiUrl.trim(),
    model: profile.model.trim(),
    temperature: clampTemperature(profile.temperature),
  };
}

function createCustomProfile(
  profiles: TextModelProfile[],
  inputName: string,
  defaultNamePrefix: string
): TextModelProfile {
  let idx = profiles.length + 1;
  let id = `custom-${idx}`;
  while (profiles.some((profile) => profile.id === id)) {
    idx += 1;
    id = `custom-${idx}`;
  }

  const customCount = profiles.filter((profile) => !profile.builtIn).length + 1;
  const name = inputName.trim() || `${defaultNamePrefix} ${customCount}`;

  return {
    id,
    name,
    apiKey: '',
    builtIn: false,
    ...CUSTOM_MODEL_DEFAULT,
  };
}

function normalizeProfile(profile: TextModelProfile): TextModelProfile {
  return {
    ...profile,
    provider: (profile.provider || 'custom') as TextModelProvider,
    name: profile.name.trim() || profile.id,
    apiKey: profile.apiKey.trim(),
    apiUrl: profile.apiUrl.trim(),
    model: profile.model.trim(),
    temperature: clampTemperature(profile.temperature),
  };
}

export function SettingsPage() {
  const {
    uiLanguage,
    textModelProfiles,
    activeTextModelProfileId,
    pollinationsKey,
    imageEngine,
    comfyUIUrl,
    setTextModelProfiles,
    setActiveTextModelProfileId,
    setTextModelConfig,
    setPollinationsKey,
    setImageEngine,
    setComfyUIUrl,
    knowledgeBaseEnabled,
    embeddingConfig,
    setKnowledgeBaseEnabled,
    setEmbeddingConfig,
    projects,
    summariesEnabled,
    entitiesEnabled,
    setSummariesEnabled,
    setEntitiesEnabled,
  } = useAppStore();

  const [localProfiles, setLocalProfiles] = useState<TextModelProfile[]>(textModelProfiles);
  const [localActiveProfileId, setLocalActiveProfileId] = useState(activeTextModelProfileId);
  const [newPlatformName, setNewPlatformName] = useState('');
  const [localPollinationsKey, setLocalPollinationsKey] = useState(pollinationsKey);
  const [localImageEngine, setLocalImageEngine] = useState<ImageEngine>(imageEngine);
  const [localComfyUIUrl, setLocalComfyUIUrl] = useState(comfyUIUrl);
  const [showTextKey, setShowTextKey] = useState(false);
  const [showPollinationsKey, setShowPollinationsKey] = useState(false);
  const [textStatus, setTextStatus] = useState<Status>('idle');
  const [pollinationsStatus, setPollinationsStatus] = useState<Status>('idle');
  const [comfyUIStatus, setComfyUIStatus] = useState<Status>('idle');

  // Knowledge base local state
  const [localKnowledgeBaseEnabled, setLocalKnowledgeBaseEnabled] = useState(knowledgeBaseEnabled);
  const [localEmbeddingConfig, setLocalEmbeddingConfig] = useState<EmbeddingConfig>(embeddingConfig);
  const [showEmbeddingKey, setShowEmbeddingKey] = useState(false);
  const [embeddingStatus, setEmbeddingStatus] = useState<Status>('idle');
  const [rebuildProjectId, setRebuildProjectId] = useState<string>('');
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [rebuildProgress, setRebuildProgress] = useState('');
  const [kbStats, setKbStats] = useState<KbStats | null>(null);
  const [kbStatsLoading, setKbStatsLoading] = useState(false);

  // KB v2 local state
  const [localSummariesEnabled, setLocalSummariesEnabled] = useState(summariesEnabled);
  const [localEntitiesEnabled, setLocalEntitiesEnabled] = useState(entitiesEnabled);
  const [isBuildingBookSummary, setIsBuildingBookSummary] = useState(false);
  const [bookSummaryStatus, setBookSummaryStatus] = useState('');
  const [isBuildingChapterSummaries, setIsBuildingChapterSummaries] = useState(false);
  const [chapterSummariesProgress, setChapterSummariesProgress] = useState('');

  // Backup / Restore state
  const [backupStatus, setBackupStatus] = useState('');
  const [importPreview, setImportPreview] = useState<{
    file: BackupBundle;
    fileName: string;
    summary: BackupSummary;
  } | null>(null);
  const [importIncludeAppSettings, setImportIncludeAppSettings] = useState(false);

  useEffect(() => {
    setLocalProfiles(textModelProfiles);
    setLocalActiveProfileId(activeTextModelProfileId);
  }, [textModelProfiles, activeTextModelProfileId]);

  useEffect(() => {
    setLocalImageEngine(imageEngine);
    setLocalComfyUIUrl(comfyUIUrl);
  }, [imageEngine, comfyUIUrl]);

  useEffect(() => {
    setLocalKnowledgeBaseEnabled(knowledgeBaseEnabled);
    setLocalEmbeddingConfig(embeddingConfig);
  }, [knowledgeBaseEnabled, embeddingConfig]);

  useEffect(() => {
    setLocalSummariesEnabled(summariesEnabled);
    setLocalEntitiesEnabled(entitiesEnabled);
  }, [summariesEnabled, entitiesEnabled]);

  // Default the rebuild project selector to the first project once loaded.
  useEffect(() => {
    if (!rebuildProjectId && projects.length > 0) {
      setRebuildProjectId(projects[0].id);
    }
  }, [projects, rebuildProjectId]);

  // Refresh KB stats whenever the selected project changes.
  useEffect(() => {
    if (!rebuildProjectId) {
      setKbStats(null);
      return;
    }
    let cancelled = false;
    setKbStatsLoading(true);
    knowledgeApi
      .getStats(rebuildProjectId)
      .then((s) => {
        if (!cancelled) setKbStats(s);
      })
      .catch(() => {
        if (!cancelled) setKbStats(null);
      })
      .finally(() => {
        if (!cancelled) setKbStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rebuildProjectId]);

  const activeProfile = useMemo(() => {
    return (
      localProfiles.find((profile) => profile.id === localActiveProfileId) ||
      localProfiles[0] ||
      null
    );
  }, [localProfiles, localActiveProfileId]);

  const updateActiveProfile = (patch: Partial<TextModelProfile>) => {
    if (!activeProfile) return;
    setLocalProfiles((prev) =>
      prev.map((profile) =>
        profile.id === activeProfile.id
          ? {
              ...profile,
              ...patch,
            }
          : profile
      )
    );
    setTextStatus('idle');
  };

  const switchActiveProfile = (profileId: string) => {
    setLocalActiveProfileId(profileId);
    setTextStatus('idle');
  };

  const addCustomPlatform = () => {
    const next = createCustomProfile(localProfiles, newPlatformName, tx(uiLanguage, '自定义平台', 'Custom Platform'));
    setLocalProfiles((prev) => [...prev, next]);
    setLocalActiveProfileId(next.id);
    setNewPlatformName('');
    setTextStatus('idle');
  };

  const deleteActiveCustomPlatform = () => {
    if (!activeProfile || activeProfile.builtIn) return;
    const nextProfiles = localProfiles.filter((profile) => profile.id !== activeProfile.id);
    const fallback = nextProfiles[0];
    setLocalProfiles(nextProfiles);
    if (fallback) {
      setLocalActiveProfileId(fallback.id);
    }
    setTextStatus('idle');
  };

  const testTextModel = async () => {
    if (!activeProfile || !isProfileConfigValid(activeProfile)) {
      alert(
        tx(
          uiLanguage,
          '请完整填写当前平台配置：API Key、API URL、模型、Temperature',
          'Please complete API Key, API URL, model, and temperature for current platform'
        )
      );
      return;
    }

    setTextStatus('testing');
    try {
      const result = await aiApi.testTextConnection(toTextConfig(activeProfile));
      setTextStatus(result ? 'success' : 'error');
    } catch {
      setTextStatus('error');
    }
  };

  const testPollinations = async () => {
    setPollinationsStatus('testing');
    try {
      const result = await aiApi.testPollinations(localPollinationsKey || undefined);
      setPollinationsStatus(result ? 'success' : 'error');
    } catch {
      setPollinationsStatus('error');
    }
  };

  const testComfyUI = async () => {
    setComfyUIStatus('testing');
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      const result = await invoke<boolean>('test_comfyui_connection', {
        comfyuiUrl: localComfyUIUrl.trim() || undefined,
      });
      setComfyUIStatus(result ? 'success' : 'error');
    } catch {
      setComfyUIStatus('error');
    }
  };

  const isEmbeddingConfigValid = (cfg: EmbeddingConfig): boolean =>
    cfg.apiKey.trim().length > 0 &&
    cfg.apiUrl.trim().length > 0 &&
    cfg.model.trim().length > 0;

  const updateEmbeddingField = (patch: Partial<EmbeddingConfig>) => {
    setLocalEmbeddingConfig((prev) => ({ ...prev, ...patch }));
    setEmbeddingStatus('idle');
  };

  const testEmbedding = async () => {
    if (!isEmbeddingConfigValid(localEmbeddingConfig)) {
      alert(
        tx(
          uiLanguage,
          '请完整填写 Embedding 配置：API Key、API URL、模型',
          'Please complete Embedding API Key, API URL, and model'
        )
      );
      return;
    }
    setEmbeddingStatus('testing');
    try {
      const ok = await knowledgeApi.testEmbedding(localEmbeddingConfig);
      setEmbeddingStatus(ok ? 'success' : 'error');
    } catch (err) {
      console.warn('[KB] Test embedding failed:', err);
      setEmbeddingStatus('error');
    }
  };

  const rebuildKnowledgeBase = async () => {
    if (!rebuildProjectId) return;
    if (!isEmbeddingConfigValid(localEmbeddingConfig)) {
      alert(
        tx(
          uiLanguage,
          '请先填写并保存 Embedding 配置',
          'Please fill in and save Embedding configuration first'
        )
      );
      return;
    }
    const confirmed = window.confirm(
      tx(
        uiLanguage,
        '将为该项目下所有已写章节重新生成 Embedding，会消耗一定 API 额度。继续？',
        'This will re-embed every written chapter in this project and consume API quota. Continue?'
      )
    );
    if (!confirmed) return;

    setIsRebuilding(true);
    setRebuildProgress(tx(uiLanguage, '准备中…', 'Preparing…'));
    try {
      const chapters = await chapterApi.getByProject(rebuildProjectId);
      const eligible = chapters.filter(
        (c) => (c.final_text || c.draft_text || '').trim().length > 200
      );
      let done = 0;
      let totalChunks = 0;
      for (const c of eligible) {
        setRebuildProgress(
          tx(uiLanguage, `索引中 ${done + 1} / ${eligible.length}：${c.title}`,
            `Indexing ${done + 1} / ${eligible.length}: ${c.title}`)
        );
        try {
          const r = await knowledgeApi.indexChapter({
            projectId: rebuildProjectId,
            chapterId: c.id,
            text: c.final_text || c.draft_text || '',
            embeddingConfig: localEmbeddingConfig,
          });
          totalChunks += r.chunksIndexed;
        } catch (err) {
          console.warn(`[KB] Index chapter ${c.id} failed:`, err);
        }
        done += 1;
      }
      setRebuildProgress(
        tx(uiLanguage,
          `完成。共索引 ${done} 章，${totalChunks} 个片段。`,
          `Done. Indexed ${done} chapters, ${totalChunks} chunks.`)
      );
      // Refresh stats
      try {
        const s = await knowledgeApi.getStats(rebuildProjectId);
        setKbStats(s);
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.error('[KB] Rebuild failed:', err);
      setRebuildProgress(
        tx(uiLanguage, `失败：${String(err)}`, `Failed: ${String(err)}`)
      );
    } finally {
      setIsRebuilding(false);
    }
  };

  const saveSettings = () => {
    if (!activeProfile || !isProfileConfigValid(activeProfile)) {
      alert(
        tx(
          uiLanguage,
          '请完整填写当前平台配置：API Key、API URL、模型、Temperature',
          'Please complete API Key, API URL, model, and temperature for current platform'
        )
      );
      return;
    }

    const normalizedProfiles = localProfiles.map((profile) => normalizeProfile(profile));
    const normalizedActive =
      normalizedProfiles.find((profile) => profile.id === localActiveProfileId) ||
      normalizedProfiles[0];
    if (!normalizedActive) {
      alert(tx(uiLanguage, '未找到可用平台配置', 'No available platform configuration found'));
      return;
    }

    setTextModelProfiles(normalizedProfiles);
    setActiveTextModelProfileId(normalizedActive.id);
    setTextModelConfig(toTextConfig(normalizedActive));
    setPollinationsKey(localPollinationsKey.trim());
    setImageEngine(localImageEngine);
    setComfyUIUrl(localComfyUIUrl.trim() || 'http://localhost:8188');
    setKnowledgeBaseEnabled(localKnowledgeBaseEnabled);
    setEmbeddingConfig(localEmbeddingConfig);
    setSummariesEnabled(localSummariesEnabled);
    setEntitiesEnabled(localEntitiesEnabled);

    alert(tx(uiLanguage, '设置已保存', 'Settings saved'));
  };

  const buildAllChapterSummaries = async () => {
    if (!rebuildProjectId) return;
    if (!isEmbeddingConfigValid(localEmbeddingConfig)) {
      alert(
        tx(uiLanguage,
          '请先填写并保存 Embedding 配置',
          'Please fill in and save Embedding configuration first')
      );
      return;
    }
    if (!activeProfile || !isProfileConfigValid(activeProfile)) {
      alert(
        tx(uiLanguage,
          '请先完整配置文本模型平台',
          'Please complete a text model platform first')
      );
      return;
    }
    const confirmed = window.confirm(
      tx(uiLanguage,
        '将为该项目下所有正文 >200 字的章节生成 ~150 字摘要，按文本模型平台计费。继续？',
        'This will generate ~150-char summaries for every chapter with >200 chars of content, billed via your text model platform. Continue?')
    );
    if (!confirmed) return;

    setIsBuildingChapterSummaries(true);
    setChapterSummariesProgress(tx(uiLanguage, '加载章节中…', 'Loading chapters…'));
    try {
      const chapters = await chapterApi.getByProject(rebuildProjectId);
      const eligible = chapters.filter(
        (c) => (c.final_text || c.draft_text || '').trim().length > 200
      );
      let done = 0;
      let failed = 0;
      for (const c of eligible) {
        setChapterSummariesProgress(
          tx(uiLanguage,
            `生成摘要 ${done + 1} / ${eligible.length}：${c.title}`,
            `Summarizing ${done + 1} / ${eligible.length}: ${c.title}`)
        );
        try {
          await knowledgeApi.generateChapterSummary({
            projectId: rebuildProjectId,
            chapterId: c.id,
            chapterTitle: c.title,
            chapterText: c.final_text || c.draft_text || '',
            textConfig: toTextConfig(activeProfile),
            embeddingConfig: localEmbeddingConfig,
          });
        } catch (err) {
          console.warn(`[KB] Chapter summary for ${c.id} failed:`, err);
          failed += 1;
        }
        done += 1;
      }
      setChapterSummariesProgress(
        tx(uiLanguage,
          `完成。成功 ${done - failed} 章，失败 ${failed} 章。现在可以生成本书梗概。`,
          `Done. ${done - failed} succeeded, ${failed} failed. You can now build the book summary.`)
      );
    } catch (err) {
      console.error('[KB] Chapter summaries rebuild failed:', err);
      setChapterSummariesProgress(
        tx(uiLanguage, `失败：${String(err)}`, `Failed: ${String(err)}`)
      );
    } finally {
      setIsBuildingChapterSummaries(false);
    }
  };

  // ── Backup / Restore handlers ───────────────────────────────

  const handleExportBackup = () => {
    const state = useAppStore.getState() as any;
    const data: Record<string, unknown> = {};
    for (const k of PROJECT_MAP_FIELDS) {
      if (state[k]) data[k] = state[k];
    }
    if (Array.isArray(state.folders) && state.folders.length > 0) {
      data.folders = state.folders;
    }
    for (const k of APP_SETTINGS_FIELDS) {
      if (state[k] !== undefined) data[k] = state[k];
    }

    const bundle: BackupBundle = {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: '1.4.0',
      data,
    };

    const json = JSON.stringify(bundle, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `novelseek-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setBackupStatus(
      tx(uiLanguage, '已导出到浏览器下载目录。', 'Exported to your downloads folder.')
    );
  };

  const handleImportPickFile = () => {
    setBackupStatus('');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as BackupBundle;
        if (!parsed || typeof parsed !== 'object' || !parsed.data || typeof parsed.data !== 'object') {
          throw new Error('Not a valid backup file');
        }
        if (parsed.version !== BACKUP_VERSION) {
          // Allow but warn — fields may have evolved
          console.warn('[Backup] version mismatch:', parsed.version);
        }
        const summary = summarizeBackup(parsed, useAppStore.getState());
        setImportPreview({ file: parsed, fileName: file.name, summary });
        setImportIncludeAppSettings(false);
      } catch (err) {
        console.error('[Backup] import parse failed:', err);
        setBackupStatus(
          tx(uiLanguage, `导入失败：文件无法解析。${String(err)}`,
            `Import failed: cannot parse file. ${String(err)}`)
        );
      }
    };
    input.click();
  };

  const handleConfirmImport = () => {
    if (!importPreview) return;
    const incoming = importPreview.file.data;
    const state = useAppStore.getState() as any;
    const next: Record<string, unknown> = {};

    // Per-project maps: merge by key, import wins on conflict.
    for (const k of PROJECT_MAP_FIELDS) {
      const inc = incoming[k];
      if (inc && typeof inc === 'object') {
        next[k] = { ...(state[k] || {}), ...(inc as Record<string, unknown>) };
      }
    }

    // Folders: merge by id, import wins.
    if (Array.isArray(incoming.folders)) {
      const map = new Map<string, unknown>();
      for (const f of (state.folders as { id: string }[]) || []) map.set(f.id, f);
      for (const f of incoming.folders as { id: string }[]) map.set(f.id, f);
      next.folders = Array.from(map.values());
    }

    // App settings — only if user opted in.
    if (importIncludeAppSettings) {
      if (Array.isArray(incoming.textModelProfiles)) {
        const map = new Map<string, unknown>();
        for (const p of (state.textModelProfiles as { id: string }[]) || []) map.set(p.id, p);
        for (const p of incoming.textModelProfiles as { id: string }[]) map.set(p.id, p);
        next.textModelProfiles = Array.from(map.values());
      }
      for (const k of APP_SETTINGS_FIELDS) {
        if (k === 'textModelProfiles') continue;
        if (incoming[k] !== undefined) next[k] = incoming[k];
      }
    }

    useAppStore.setState(next as any);

    const merged = importPreview.summary.projectIdsInBackup;
    setImportPreview(null);
    setBackupStatus(
      tx(uiLanguage,
        `导入完成：合并了 ${merged} 个项目的元数据。${importIncludeAppSettings ? '应用设置已覆盖。' : ''}请刷新页面以确保 UI 同步。`,
        `Import done: merged metadata for ${merged} projects.${importIncludeAppSettings ? ' App settings overwritten.' : ''} Reload the page to make sure the UI is in sync.`)
    );
  };

  const buildBookSummary = async () => {
    if (!rebuildProjectId) return;
    if (!isEmbeddingConfigValid(localEmbeddingConfig)) {
      alert(
        tx(
          uiLanguage,
          '请先填写并保存 Embedding 配置',
          'Please fill in and save Embedding configuration first'
        )
      );
      return;
    }
    if (!activeProfile || !isProfileConfigValid(activeProfile)) {
      alert(
        tx(
          uiLanguage,
          '请先完整配置文本模型平台',
          'Please complete a text model platform first'
        )
      );
      return;
    }
    const proj = projects.find((p) => p.id === rebuildProjectId);
    if (!proj) return;

    setIsBuildingBookSummary(true);
    setBookSummaryStatus(tx(uiLanguage, '生成中…', 'Generating…'));
    try {
      const s = await knowledgeApi.generateBookSummary({
        projectId: rebuildProjectId,
        bookTitle: proj.title,
        bookDescription: proj.description || '',
        textConfig: toTextConfig(activeProfile),
        embeddingConfig: localEmbeddingConfig,
      });
      setBookSummaryStatus(
        tx(uiLanguage,
          `已生成全书梗概，约 ${s.wordCount} 字。`,
          `Book summary generated, ~${s.wordCount} chars.`)
      );
    } catch (err) {
      console.error('[KB] Book summary failed:', err);
      const msg = String(err);
      // Friendlier error when the underlying chapter summaries are missing.
      const hint = msg.includes('No chapter or arc summaries')
        ? tx(uiLanguage,
            '失败：还没有任何章节摘要可供汇总。请先点击上方「重建章节摘要」按钮。',
            'Failed: no chapter summaries to roll up. Click "Rebuild Chapter Summaries" above first.')
        : tx(uiLanguage, `失败：${msg}`, `Failed: ${msg}`);
      setBookSummaryStatus(hint);
    } finally {
      setIsBuildingBookSummary(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">{tx(uiLanguage, '设置', 'Settings')}</h1>

      <div className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Key className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{tx(uiLanguage, '文本模型平台', 'Text Model Platforms')}</h2>
          </div>

          {activeProfile ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {tx(uiLanguage, '平台列表', 'Platform List')}
                  </label>
                  <select
                    value={localActiveProfileId}
                    onChange={(event) => switchActiveProfile(event.target.value)}
                    className="w-full px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                  >
                    {localProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                        {profile.builtIn ? tx(uiLanguage, '（内置）', ' (Built-in)') : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {tx(uiLanguage, '新增自定义平台', 'Add Custom Platform')}
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={newPlatformName}
                      onChange={(event) => setNewPlatformName(event.target.value)}
                      placeholder={tx(uiLanguage, '平台名称（可选）', 'Platform Name (Optional)')}
                      className="flex-1 px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                    />
                    <Button onClick={addCustomPlatform} className="px-3 whitespace-nowrap">
                      <Plus className="w-4 h-4 mr-1" />
                      {tx(uiLanguage, '新增', 'Add')}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-medium text-gray-900 dark:text-white">{tx(uiLanguage, '当前平台配置', 'Current Platform Configuration')}</h3>
                {!activeProfile.builtIn && (
                  <button
                    type="button"
                    onClick={deleteActiveCustomPlatform}
                    className="inline-flex items-center px-3 py-1.5 text-sm rounded-lg border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    {tx(uiLanguage, '删除当前自定义平台', 'Delete Current Custom Platform')}
                  </button>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {tx(uiLanguage, '平台名称', 'Platform Name')}
                </label>
                <input
                  value={activeProfile.name}
                  onChange={(event) => updateActiveProfile({ name: event.target.value })}
                  placeholder={tx(uiLanguage, '例如：OpenAI生产环境', 'e.g. OpenAI Production')}
                  className="w-full px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {tx(uiLanguage, '平台类型', 'Platform Type')}
                </label>
                <select
                  value={activeProfile.provider}
                  onChange={(event) =>
                    updateActiveProfile({ provider: event.target.value as TextModelProvider })
                  }
                  className="w-full px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                >
                  <option value="deepseek">DeepSeek</option>
                  <option value="openai">OpenAI</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="gemini">{tx(uiLanguage, 'Gemini(OpenAI兼容)', 'Gemini (OpenAI Compatible)')}</option>
                  <option value="custom">{tx(uiLanguage, '自定义(OpenAI兼容)', 'Custom (OpenAI Compatible)')}</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    API Key
                  </label>
                  {activeProfile.keyUrl && (
                    <a
                      href={activeProfile.keyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                    >
                      {tx(uiLanguage, '获取密钥', 'Get Key')}
                      <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showTextKey ? 'text' : 'password'}
                    value={activeProfile.apiKey}
                    onChange={(event) => updateActiveProfile({ apiKey: event.target.value })}
                    placeholder={tx(uiLanguage, '请输入 API Key', 'Enter API Key')}
                    className="w-full px-3 py-2 pr-11 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTextKey((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    title={showTextKey ? tx(uiLanguage, '隐藏密钥', 'Hide Key') : tx(uiLanguage, '显示密钥', 'Show Key')}
                  >
                    {showTextKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  API URL
                </label>
                <input
                  value={activeProfile.apiUrl}
                  onChange={(event) => updateActiveProfile({ apiUrl: event.target.value })}
                  placeholder={tx(uiLanguage, '例如：https://api.deepseek.com/v1', 'e.g. https://api.deepseek.com/v1')}
                  className="w-full px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {tx(uiLanguage, '模型名称', 'Model Name')}
                </label>
                <input
                  value={activeProfile.model}
                  onChange={(event) => updateActiveProfile({ model: event.target.value })}
                  placeholder={tx(uiLanguage, '例如：deepseek-chat / gpt-4o-mini', 'e.g. deepseek-chat / gpt-4o-mini')}
                  className="w-full px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {tx(uiLanguage, 'Temperature（0-2）', 'Temperature (0-2)')}
                </label>
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={activeProfile.temperature}
                  onChange={(event) =>
                    updateActiveProfile({ temperature: Number(event.target.value || 0) })
                  }
                  className="w-full px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                />
              </div>

              <p className="text-xs text-gray-500 dark:text-gray-400">
                {tx(
                  uiLanguage,
                  '每个平台配置独立保存。切换平台会自动切换对应 API Key、API URL、模型和 Temperature。',
                  'Each platform is saved independently. Switching platform also switches API Key, API URL, model, and temperature.'
                )}
              </p>

              <div className="flex items-center space-x-2">
                <Button onClick={testTextModel} loading={textStatus === 'testing'}>
                  {tx(uiLanguage, '测试当前平台连接', 'Test Current Platform')}
                </Button>
                {textStatus === 'success' && (
                  <div className="flex items-center text-green-600 dark:text-green-400">
                    <CheckCircle className="w-4 h-4 mr-1" />
                    <span className="text-sm">{tx(uiLanguage, '连接成功', 'Connected')}</span>
                  </div>
                )}
                {textStatus === 'error' && (
                  <div className="flex items-center text-red-600 dark:text-red-400">
                    <XCircle className="w-4 h-4 mr-1" />
                    <span className="text-sm">{tx(uiLanguage, '连接失败', 'Connection Failed')}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400">{tx(uiLanguage, '暂无可用文本模型平台', 'No available text model platform')}</div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Image className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              {tx(uiLanguage, '图片生成引擎', 'Image Generation Engine')}
            </h2>
          </div>

          {/* Engine selector */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {tx(uiLanguage, '当前引擎', 'Active Engine')}
            </label>
            <div className="flex gap-3">
              {(['pollinations', 'comfyui'] as ImageEngine[]).map((eng) => (
                <label
                  key={eng}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors ${
                    localImageEngine === eng
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30 text-primary-700 dark:text-primary-300'
                      : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-primary-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="imageEngine"
                    value={eng}
                    checked={localImageEngine === eng}
                    onChange={() => setLocalImageEngine(eng)}
                    className="accent-primary-500"
                  />
                  {eng === 'pollinations' ? 'Pollinations' : 'ComfyUI'}
                </label>
              ))}
            </div>
          </div>

          {/* Pollinations config */}
          <div
            className={`space-y-4 rounded-lg border p-4 transition-opacity ${
              localImageEngine === 'pollinations'
                ? 'border-primary-300 dark:border-primary-700'
                : 'border-gray-200 dark:border-gray-700 opacity-60'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-800 dark:text-gray-200">Pollinations API</span>
              <a
                href="https://pollinations.ai"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
              >
                {tx(uiLanguage, '访问官网', 'Official Site')}
                <ExternalLink className="w-3 h-3 ml-1" />
              </a>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {tx(uiLanguage, 'API Key（可选）', 'API Key (Optional)')}
                </label>
                <a
                  href="https://enter.pollinations.ai/"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                >
                  {tx(uiLanguage, '获取密钥', 'Get Key')}
                  <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              </div>
              <div className="relative">
                <input
                  type={showPollinationsKey ? 'text' : 'password'}
                  value={localPollinationsKey}
                  onChange={(event) => setLocalPollinationsKey(event.target.value)}
                  placeholder={tx(uiLanguage, 'pk_... 或 sk_...', 'pk_... or sk_...')}
                  className="w-full px-3 py-2 pr-11 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowPollinationsKey((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  title={showPollinationsKey ? tx(uiLanguage, '隐藏密钥', 'Hide Key') : tx(uiLanguage, '显示密钥', 'Show Key')}
                >
                  {showPollinationsKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <p className="text-sm text-gray-600 dark:text-gray-400">
              {tx(uiLanguage, '不配置 API Key 也可使用，但可能受到频率限制。', 'Works without API key, but may be rate-limited.')}
            </p>

            <div className="flex items-center space-x-2">
              <Button onClick={testPollinations} loading={pollinationsStatus === 'testing'}>
                {tx(uiLanguage, '测试 Pollinations 连接', 'Test Pollinations')}
              </Button>
              {pollinationsStatus === 'success' && (
                <div className="flex items-center text-green-600 dark:text-green-400">
                  <CheckCircle className="w-4 h-4 mr-1" />
                  <span className="text-sm">{tx(uiLanguage, '连接成功', 'Connected')}</span>
                </div>
              )}
              {pollinationsStatus === 'error' && (
                <div className="flex items-center text-red-600 dark:text-red-400">
                  <XCircle className="w-4 h-4 mr-1" />
                  <span className="text-sm">{tx(uiLanguage, '连接失败', 'Failed')}</span>
                </div>
              )}
            </div>
          </div>

          {/* ComfyUI config */}
          <div
            className={`mt-4 space-y-4 rounded-lg border p-4 transition-opacity ${
              localImageEngine === 'comfyui'
                ? 'border-primary-300 dark:border-primary-700'
                : 'border-gray-200 dark:border-gray-700 opacity-60'
            }`}
          >
            <span className="font-medium text-gray-800 dark:text-gray-200">ComfyUI</span>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {tx(uiLanguage, '服务地址', 'Server URL')}
              </label>
              <input
                value={localComfyUIUrl}
                onChange={(event) => setLocalComfyUIUrl(event.target.value)}
                placeholder="http://localhost:8188"
                className="w-full px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
              />
            </div>

            <p className="text-sm text-gray-600 dark:text-gray-400">
              {tx(
                uiLanguage,
                '使用工作流：t2i-lumicreate（z-image-turbo 模型，无 LoRA）。请确保 ComfyUI 正在运行并已加载所需模型。',
                'Uses workflow: t2i-lumicreate (z-image-turbo, no LoRA). Ensure ComfyUI is running with required models loaded.'
              )}
            </p>

            <div className="flex items-center space-x-2">
              <Button onClick={testComfyUI} loading={comfyUIStatus === 'testing'}>
                {tx(uiLanguage, '测试 ComfyUI 连接', 'Test ComfyUI')}
              </Button>
              {comfyUIStatus === 'success' && (
                <div className="flex items-center text-green-600 dark:text-green-400">
                  <CheckCircle className="w-4 h-4 mr-1" />
                  <span className="text-sm">{tx(uiLanguage, '连接成功', 'Connected')}</span>
                </div>
              )}
              {comfyUIStatus === 'error' && (
                <div className="flex items-center text-red-600 dark:text-red-400">
                  <XCircle className="w-4 h-4 mr-1" />
                  <span className="text-sm">{tx(uiLanguage, '连接失败，请确认 ComfyUI 已启动', 'Connection failed. Ensure ComfyUI is running.')}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Local Knowledge Base (RAG) ─────────────────────────── */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Database className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              {tx(uiLanguage, '本地知识库（实验性）', 'Local Knowledge Base (Experimental)')}
            </h2>
          </div>

          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
            {tx(
              uiLanguage,
              '开启后，每次保存章节会将正文切片并通过 Embedding 模型转为向量存入本地数据库；生成新章节时会自动检索历史中最相关的片段，作为「长程相关记忆」拼到提示词末尾。原有的近 3 章上下文逻辑不变，KB 检索仅作增强。',
              'When enabled, saving a chapter chunks its text and embeds it locally; new chapter generation retrieves the most relevant past snippets and appends them as long-range memory. The legacy last-3-chapters context is unchanged — KB only augments it.'
            )}
          </p>

          {/* Enable toggle */}
          <label className="flex items-center gap-3 mb-5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={localKnowledgeBaseEnabled}
              onChange={(e) => setLocalKnowledgeBaseEnabled(e.target.checked)}
              className="w-4 h-4 accent-primary-500"
            />
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
              {tx(uiLanguage, '启用本地知识库', 'Enable local knowledge base')}
            </span>
          </label>

          <div
            className={`space-y-4 rounded-lg border p-4 transition-opacity ${
              localKnowledgeBaseEnabled
                ? 'border-primary-300 dark:border-primary-700'
                : 'border-gray-200 dark:border-gray-700 opacity-60'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-800 dark:text-gray-200">
                {tx(uiLanguage, 'Embedding 服务（OpenAI 兼容）', 'Embedding Provider (OpenAI Compatible)')}
              </span>
              <a
                href="https://bailian.console.aliyun.com/?apiKey=1#/api-key"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
              >
                {tx(uiLanguage, '获取百炼 API Key', 'Get Bailian API Key')}
                <ExternalLink className="w-3 h-3 ml-1" />
              </a>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                API Key
              </label>
              <div className="relative">
                <input
                  type={showEmbeddingKey ? 'text' : 'password'}
                  value={localEmbeddingConfig.apiKey}
                  onChange={(e) => updateEmbeddingField({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  disabled={!localKnowledgeBaseEnabled}
                  className="w-full px-3 py-2 pr-11 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowEmbeddingKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  {showEmbeddingKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr] gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  API URL
                </label>
                <input
                  value={localEmbeddingConfig.apiUrl}
                  onChange={(e) => updateEmbeddingField({ apiUrl: e.target.value })}
                  placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                  disabled={!localKnowledgeBaseEnabled}
                  className="w-full px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {tx(uiLanguage, '模型', 'Model')}
                </label>
                <input
                  value={localEmbeddingConfig.model}
                  onChange={(e) => updateEmbeddingField({ model: e.target.value })}
                  placeholder="text-embedding-v3"
                  disabled={!localKnowledgeBaseEnabled}
                  className="w-full px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {tx(uiLanguage, '维度（可选）', 'Dimensions (optional)')}
                </label>
                <input
                  type="number"
                  min={1}
                  value={localEmbeddingConfig.dimensions ?? ''}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    updateEmbeddingField({
                      dimensions: Number.isFinite(n) && n > 0 ? n : undefined,
                    });
                  }}
                  placeholder="1024"
                  disabled={!localKnowledgeBaseEnabled}
                  className="w-full px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                />
              </div>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              {tx(
                uiLanguage,
                '默认配置指向阿里云百炼。也支持任意 OpenAI 兼容的 Embedding 端点（硅基流动、智谱 GLM、OpenAI 等）。',
                'Defaults point to Alibaba Cloud Bailian (DashScope). Any OpenAI-compatible embedding endpoint also works (SiliconFlow, Zhipu GLM, OpenAI, etc.).'
              )}
            </p>

            <div className="flex items-center space-x-2">
              <Button
                onClick={testEmbedding}
                loading={embeddingStatus === 'testing'}
                disabled={!localKnowledgeBaseEnabled}
              >
                {tx(uiLanguage, '测试 Embedding 连接', 'Test Embedding')}
              </Button>
              {embeddingStatus === 'success' && (
                <div className="flex items-center text-green-600 dark:text-green-400">
                  <CheckCircle className="w-4 h-4 mr-1" />
                  <span className="text-sm">{tx(uiLanguage, '连接成功', 'Connected')}</span>
                </div>
              )}
              {embeddingStatus === 'error' && (
                <div className="flex items-center text-red-600 dark:text-red-400">
                  <XCircle className="w-4 h-4 mr-1" />
                  <span className="text-sm">{tx(uiLanguage, '连接失败', 'Connection Failed')}</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Rebuild / Stats panel ─────────────────────────────── */}
          <div className="mt-5 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <h3 className="text-base font-medium text-gray-900 dark:text-white">
              {tx(uiLanguage, '项目知识库管理', 'Project Knowledge Base')}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {tx(uiLanguage, '选择项目', 'Select Project')}
                </label>
                <select
                  value={rebuildProjectId}
                  onChange={(e) => setRebuildProjectId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                >
                  {projects.length === 0 && (
                    <option value="">{tx(uiLanguage, '（暂无项目）', '(No projects)')}</option>
                  )}
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={rebuildKnowledgeBase}
                  loading={isRebuilding}
                  disabled={!localKnowledgeBaseEnabled || !rebuildProjectId || isRebuilding}
                >
                  <RefreshCw className="w-4 h-4 mr-1" />
                  {tx(uiLanguage, '重建知识库', 'Rebuild')}
                </Button>
              </div>
            </div>

            {rebuildProgress && (
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {rebuildProgress}
              </p>
            )}

            <div className="text-xs text-gray-600 dark:text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
              {kbStatsLoading ? (
                <span>{tx(uiLanguage, '加载统计中…', 'Loading stats…')}</span>
              ) : kbStats ? (
                <>
                  <span>
                    {tx(uiLanguage, `已索引片段：${kbStats.totalChunks}`,
                      `Chunks indexed: ${kbStats.totalChunks}`)}
                  </span>
                  <span>
                    {tx(uiLanguage, `已索引来源：${kbStats.totalSources}`,
                      `Sources indexed: ${kbStats.totalSources}`)}
                  </span>
                  {kbStats.embeddingModels.length > 0 && (
                    <span>
                      {tx(uiLanguage, '使用模型：', 'Models: ')}
                      {kbStats.embeddingModels.join(', ')}
                    </span>
                  )}
                </>
              ) : (
                <span>
                  {tx(uiLanguage, '该项目暂无索引数据', 'No KB data for this project yet')}
                </span>
              )}
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              {tx(
                uiLanguage,
                '提示：日常保存章节时会自动入库，只有第一次接入 / 切换 embedding 模型时才需要"重建"。',
                'Tip: regular chapter saves auto-index. Use "Rebuild" only on first setup or after switching embedding models.'
              )}
            </p>
          </div>

          {/* ── v2 augmentation layers ─────────────────────────── */}
          <div className={`mt-5 rounded-lg border p-4 space-y-4 transition-opacity ${
              localKnowledgeBaseEnabled
                ? 'border-amber-300 dark:border-amber-700'
                : 'border-gray-200 dark:border-gray-700 opacity-60'
            }`}>
            <h3 className="text-base font-medium text-gray-900 dark:text-white">
              {tx(uiLanguage, '增强层（v2，可选）', 'Augmentation Layers (v2, optional)')}
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              {tx(uiLanguage,
                '这两层增强会在每次保存章节时额外调用一次 Chat Completion（按文本模型平台计费），并在生成新章节时把"全书梗概 / 当前弧线进度 / 未回收伏笔"塞进提示词。建议长篇（30 章以上）开启。',
                'Each layer triggers one extra Chat Completion per chapter save (billed via your text model platform), and injects book/arc summaries plus open foreshadowing into the prompt. Recommended for long novels (30+ chapters).')}
            </p>

            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={localSummariesEnabled}
                onChange={(e) => setLocalSummariesEnabled(e.target.checked)}
                disabled={!localKnowledgeBaseEnabled}
                className="mt-0.5 w-4 h-4 accent-primary-500"
              />
              <div>
                <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {tx(uiLanguage, '启用分层摘要（章节 / 弧线 / 全书）', 'Enable hierarchical summaries (chapter / arc / book)')}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {tx(uiLanguage,
                    '保存章节时自动生成 ~150 字章节摘要，提示词里追加「全书梗概」+「当前弧线进度」段。',
                    'Auto-generates ~150-char chapter summaries on save. Prompts gain "book synopsis" and "current arc progress" sections.')}
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={localEntitiesEnabled}
                onChange={(e) => setLocalEntitiesEnabled(e.target.checked)}
                disabled={!localKnowledgeBaseEnabled}
                className="mt-0.5 w-4 h-4 accent-primary-500"
              />
              <div>
                <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {tx(uiLanguage, '启用实体抽取（人物登场 / 伏笔 / 地点 / 事件 / 物品）', 'Enable entity extraction (characters / foreshadowing / locations / events / items)')}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {tx(uiLanguage,
                    '保存章节时自动结构化抽取，并在提示词里追加「未回收伏笔」清单，避免长篇写飞。',
                    'Structured extraction on save; "open foreshadowing" list is added to the prompt to keep long arcs coherent.')}
                </div>
              </div>
            </label>

            {/* Manual rebuild buttons */}
            <div className="pt-3 border-t border-gray-200 dark:border-gray-700 space-y-4">
              {/* Step 1: chapter summaries */}
              <div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {tx(uiLanguage, '步骤 1：重建所有章节摘要', 'Step 1: Rebuild all chapter summaries')}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {tx(uiLanguage,
                        '一次性为已有章节生成摘要（首次启用必跑）。开启摘要 toggle 后，日常保存章节会自动维护。',
                        'One-shot pass over existing chapters (required on first enable). After toggle is on, regular chapter saves keep summaries up-to-date.')}
                    </div>
                  </div>
                  <Button
                    onClick={buildAllChapterSummaries}
                    loading={isBuildingChapterSummaries}
                    disabled={!localKnowledgeBaseEnabled || !rebuildProjectId || isBuildingChapterSummaries}
                  >
                    {tx(uiLanguage, '重建章节摘要', 'Rebuild Chapter Summaries')}
                  </Button>
                </div>
                {chapterSummariesProgress && (
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">{chapterSummariesProgress}</p>
                )}
              </div>

              {/* Step 2: book summary */}
              <div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {tx(uiLanguage, '步骤 2：生成「全书梗概」', 'Step 2: Build book summary')}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {tx(uiLanguage,
                        '基于已有章节 / 弧线摘要汇总。建议每 5-10 章手动刷新一次。',
                        'Rolls up existing chapter / arc summaries. Refresh every 5–10 chapters.')}
                    </div>
                  </div>
                  <Button
                    onClick={buildBookSummary}
                    loading={isBuildingBookSummary}
                    disabled={!localKnowledgeBaseEnabled || !rebuildProjectId || isBuildingBookSummary}
                  >
                    {tx(uiLanguage, '生成本书梗概', 'Build Book Summary')}
                  </Button>
                </div>
                {bookSummaryStatus && (
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">{bookSummaryStatus}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Backup / Restore ──────────────────────────────────── */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center space-x-2 mb-4">
            <HardDriveDownload className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              {tx(uiLanguage, '数据备份 / 恢复', 'Data Backup / Restore')}
            </h2>
          </div>

          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
            {tx(uiLanguage,
              '将所有项目的角色、剧情弧线、世界观、时间线、境界系统等元数据导出为 JSON 文件。⚠ 章节正文不在备份里（它们存在 SQLite 数据库中、由 app 自动管理）。\n建议每次发布新版本前先「导出」，安装新版后再「导入」——这样可以避免 dev / 生产构建之间数据不互通的问题。',
              'Export all project metadata (characters, arcs, world setting, timeline, realm system, etc.) as a JSON file. ⚠ Chapter content is NOT in the backup (it lives in the SQLite DB, managed automatically).\nRecommended: export before installing a new build, import after — this avoids the dev/production webview-storage split.')}
          </p>

          <div className="flex flex-wrap gap-3">
            <Button onClick={handleExportBackup} variant="outline" className="whitespace-nowrap">
              <Download className="w-4 h-4 mr-2" />
              {tx(uiLanguage, '导出全部数据', 'Export Backup')}
            </Button>
            <Button onClick={handleImportPickFile} variant="outline" className="whitespace-nowrap">
              <Upload className="w-4 h-4 mr-2" />
              {tx(uiLanguage, '从备份导入', 'Import Backup')}
            </Button>
          </div>

          {backupStatus && (
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-3 whitespace-pre-line">
              {backupStatus}
            </p>
          )}

          <p className="text-xs text-amber-700 dark:text-amber-400 mt-3 leading-relaxed">
            {tx(uiLanguage,
              '⚠ 安全提示：导出文件包含你的 API Key 和所有项目内容。不要分享给不信任的人。',
              '⚠ Security note: the export file contains your API keys and all project content. Do not share it with untrusted parties.')}
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={saveSettings}>{tx(uiLanguage, '保存设置', 'Save Settings')}</Button>
        </div>
      </div>

      {/* Import preview modal */}
      {importPreview && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setImportPreview(null); }}
        >
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-primary-600" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {tx(uiLanguage, '确认导入', 'Confirm Import')}
              </h3>
            </div>

            <div className="text-xs text-gray-500 dark:text-gray-400 break-all">
              {importPreview.fileName}
              {importPreview.file.exportedAt && (
                <span className="ml-2 text-gray-400">
                  ({new Date(importPreview.file.exportedAt).toLocaleString()})
                </span>
              )}
            </div>

            <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg p-3 text-sm space-y-1.5">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">
                  {tx(uiLanguage, '备份中的项目数', 'Projects in backup')}
                </span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {importPreview.summary.projectIdsInBackup}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">
                  {tx(uiLanguage, '当前已有的项目数', 'Projects currently in app')}
                </span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {importPreview.summary.projectIdsInStore}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">
                  {tx(uiLanguage, '将被覆盖的项目数', 'Projects to be overwritten')}
                </span>
                <span className={`font-medium ${importPreview.summary.projectIdsOverlap > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white'}`}>
                  {importPreview.summary.projectIdsOverlap}
                </span>
              </div>
              {importPreview.summary.chapterPromosInBackup > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">
                    {tx(uiLanguage, '章节封面/摘要', 'Chapter promos')}
                  </span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {importPreview.summary.chapterPromosInBackup}
                  </span>
                </div>
              )}
            </div>

            {importPreview.summary.hasAppSettings && (
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={importIncludeAppSettings}
                  onChange={(e) => setImportIncludeAppSettings(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-primary-500"
                />
                <span className="text-sm text-gray-800 dark:text-gray-200">
                  {tx(uiLanguage,
                    '同时覆盖应用设置（API Key、文本/图像模型配置、主题、语言、KB 开关等）',
                    'Also overwrite app settings (API keys, model configs, theme, language, KB toggles, etc.)')}
                </span>
              </label>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setImportPreview(null)}>
                {tx(uiLanguage, '取消', 'Cancel')}
              </Button>
              <Button onClick={handleConfirmImport}>
                {tx(uiLanguage, '确认导入', 'Confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

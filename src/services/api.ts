import { invoke } from '@tauri-apps/api/tauri';
import type {
  Project,
  CreateProjectInput,
  Chapter,
  CreateChapterInput,
  UpdateChapterMetaInput,
  GenerateOutlineInput,
  GenerateChapterInput,
  GenerateRevisionInput,
  GenerateCharacterAppearanceInput,
  CharacterAppearanceResult,
  GenerateCharacterPortraitPromptInput,
  CharacterPortraitPromptResult,
  GenerateImageInput,
  GeneratePlotArcInput,
  PlotArcResult,
  SystemFontOption,
  TextModelConfig,
  EmbeddingConfig,
  KbIndexResult,
  KbStats,
  KbIndexChapterInput,
  KbRetrieveContextInput,
  KbForgetSourceInput,
  SummaryPayload,
  KbGenChapterSummaryInput,
  KbGenArcSummaryInput,
  KbGenBookSummaryInput,
  KbForgetSummaryInput,
  EntityPayload,
  KbExtractEntitiesInput,
  KbExtractStatsPayload,
  KbListEntitiesInput,
} from '@typings/index';

// ── Backup content import/export (full PC↔Android backup compatibility) ──────
// `projects`/`chapters` here mirror the Rust `ImportProject`/`ImportChapter` shapes (snake_case,
// most metadata optional). The SettingsPage assembles these from an Android-style backup.
export interface ImportChapterFull {
  id: string;
  project_id: string;
  title: string;
  order_index: number;
  outline_goal?: string | null;
  conflict?: string | null;
  twist?: string | null;
  cliffhanger?: string | null;
  draft_text?: string | null;
  final_text?: string | null;
  illustrations?: string | null;
  word_count?: number;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  arc_id?: string | null;
}

export interface ImportNovelContentInput {
  projects: Record<string, unknown>[];
  chapters: ImportChapterFull[];
}

export interface ExportNovelContent {
  projects: Project[];
  chapters: Chapter[];
}

// Project API
export const projectApi = {
  create: (input: CreateProjectInput) => invoke<Project>('create_project', { input }),
  getAll: () => invoke<Project[]>('get_projects'),
  getById: (id: string) => invoke<Project | null>('get_project', { id }),
  update: (id: string, input: CreateProjectInput) =>
    invoke<Project>('update_project', { id, input }),
  delete: (id: string) => invoke<void>('delete_project', { id }),
  /** Bulk-upsert whole projects + chapters from a backup (incoming wins on conflict). */
  importContent: (input: ImportNovelContentInput) =>
    invoke<void>('import_novel_content', { input }),
  /** Read every project + chapter back out, for assembling a full backup bundle. */
  exportContent: () => invoke<ExportNovelContent>('export_novel_content'),
};

// Chapter API
export const chapterApi = {
  create: (input: CreateChapterInput) => invoke<Chapter>('create_chapter', { input }),
  getByProject: (projectId: string) => invoke<Chapter[]>('get_chapters', { projectId }),
  update: (id: string, draftText?: string, finalText?: string, illustrations?: string) =>
    invoke<void>('update_chapter', { id, draftText, finalText, illustrations }),
  updateMeta: (id: string, input: UpdateChapterMetaInput) =>
    invoke<Chapter>('update_chapter_meta', { id, input }),
  delete: (id: string) => invoke<void>('delete_chapter', { id }),
  /** Lightweight per-project chapter counts (no chapter bodies). */
  getCounts: () => invoke<{ project_id: string; count: number }[]>('get_chapter_counts'),
};

// AI Generation API
export const aiApi = {
  generateOutline: (input: GenerateOutlineInput) =>
    invoke<string>('generate_outline', { input }),
  generateChapter: (input: GenerateChapterInput) =>
    invoke<string>('generate_chapter', { input }),
  generateRevision: (input: GenerateRevisionInput) =>
    invoke<string>('generate_revision', { input }),
  generateCharacterAppearance: (input: GenerateCharacterAppearanceInput) =>
    invoke<CharacterAppearanceResult>('generate_character_appearance', { input }),
  generateCharacterPortraitPrompt: (input: GenerateCharacterPortraitPromptInput) =>
    invoke<CharacterPortraitPromptResult>('generate_character_portrait_prompt', { input }),
  generateImage: (input: GenerateImageInput) => invoke<string>('generate_image', { input }),
  generatePlotArc: (input: GeneratePlotArcInput) =>
    invoke<PlotArcResult>('generate_plot_arc', { input }),
  testTextConnection: (textConfig: TextModelConfig) =>
    invoke<boolean>('test_text_connection', { textConfig }),
  /** Generic single-shot chat completion (system + user). Powers container/growth AI updates
   *  and novel-chat answering. */
  chat: (user: string, textConfig: TextModelConfig, system?: string) =>
    invoke<string>('ai_chat', { input: { system, user, text_config: textConfig } }),
  testDeepSeek: (apiKey: string) => invoke<boolean>('test_deepseek_connection', { apiKey }),
  testPollinations: (apiKey?: string) =>
    invoke<boolean>('test_pollinations_connection', { apiKey }),
};

// ── Version history / snapshots ──────────────────────────────
export interface SnapshotMeta {
  id: string;
  target_id: string;
  note?: string | null;
  created_at: string;
}

export const snapshotApi = {
  /** content is the full project-state JSON assembled on the frontend. */
  create: (targetId: string, note: string | null, content: string) =>
    invoke<SnapshotMeta>('snapshot_create', { targetId, note, content }),
  list: (targetId: string) => invoke<SnapshotMeta[]>('snapshot_list', { targetId }),
  get: (id: string) => invoke<string>('snapshot_get', { id }),
  rename: (id: string, note: string) => invoke<void>('snapshot_rename', { id, note }),
  delete: (id: string) => invoke<void>('snapshot_delete', { id }),
};

// ── Edge "Read Aloud" TTS (mirrors Android EdgeTtsService) ───
export const ttsApi = {
  /** Synthesize one text segment to MP3 (returned base64) via Microsoft Edge neural voices. */
  synthesize: (text: string, voice: string, ratePercent: number) =>
    invoke<string>('edge_tts_synthesize', { text, voice, ratePercent }),
};

/** Curated Edge Chinese voices (same set as the Android listen screen). */
export const EDGE_TTS_VOICES: { id: string; label: string }[] = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓（女声）' },
  { id: 'zh-CN-YunxiNeural', label: '云希（男声）' },
  { id: 'zh-CN-YunyangNeural', label: '云扬（男声·播音）' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊（女声）' },
  { id: 'zh-CN-YunjianNeural', label: '云健（男声·浑厚）' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北（东北女声）' },
];

// System API
export const systemApi = {
  listSystemFonts: () => invoke<SystemFontOption[]>('list_system_fonts'),
  getSystemFontBase64: (fileName: string) =>
    invoke<string>('get_system_font_base64', { fileName }),
};

// Knowledge base (local RAG) API
export const knowledgeApi = {
  // v1: chunks + retrieval
  indexChapter: (input: KbIndexChapterInput) =>
    invoke<KbIndexResult>('kb_index_chapter', { input }),
  retrieveContext: (input: KbRetrieveContextInput) =>
    invoke<string>('kb_retrieve_context', { input }),
  forgetSource: (input: KbForgetSourceInput) =>
    invoke<void>('kb_forget_source', { input }),
  testEmbedding: (embeddingConfig: EmbeddingConfig) =>
    invoke<boolean>('kb_test_embedding', { embeddingConfig }),
  getStats: (projectId: string) =>
    invoke<KbStats>('kb_get_stats', { projectId }),

  // v2.0: summaries
  generateChapterSummary: (input: KbGenChapterSummaryInput) =>
    invoke<SummaryPayload>('kb_generate_chapter_summary', { input }),
  generateArcSummary: (input: KbGenArcSummaryInput) =>
    invoke<SummaryPayload>('kb_generate_arc_summary', { input }),
  generateBookSummary: (input: KbGenBookSummaryInput) =>
    invoke<SummaryPayload>('kb_generate_book_summary', { input }),
  listSummaries: (projectId: string) =>
    invoke<SummaryPayload[]>('kb_list_summaries', { projectId }),
  markRollupsStale: (projectId: string) =>
    invoke<void>('kb_mark_rollups_stale', { projectId }),
  forgetSummary: (input: KbForgetSummaryInput) =>
    invoke<void>('kb_forget_summary', { input }),

  // v2.1: entities
  extractEntities: (input: KbExtractEntitiesInput) =>
    invoke<KbExtractStatsPayload>('kb_extract_entities', { input }),
  listEntities: (input: KbListEntitiesInput) =>
    invoke<EntityPayload[]>('kb_list_entities', { input }),
  setEntityStatus: (entityId: string, status: string) =>
    invoke<void>('kb_set_entity_status', { input: { entityId, status } }),
  handleChapterDeletion: (projectId: string, chapterId: string) =>
    invoke<void>('kb_handle_chapter_deletion', { input: { projectId, chapterId } }),
};

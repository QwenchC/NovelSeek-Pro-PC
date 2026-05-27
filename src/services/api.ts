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

// Project API
export const projectApi = {
  create: (input: CreateProjectInput) => invoke<Project>('create_project', { input }),
  getAll: () => invoke<Project[]>('get_projects'),
  getById: (id: string) => invoke<Project | null>('get_project', { id }),
  update: (id: string, input: CreateProjectInput) =>
    invoke<Project>('update_project', { id, input }),
  delete: (id: string) => invoke<void>('delete_project', { id }),
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
  testDeepSeek: (apiKey: string) => invoke<boolean>('test_deepseek_connection', { apiKey }),
  testPollinations: (apiKey?: string) =>
    invoke<boolean>('test_pollinations_connection', { apiKey }),
};

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

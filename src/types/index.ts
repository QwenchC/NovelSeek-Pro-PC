export type UiLanguage = 'zh' | 'en';

export interface ProjectFolder {
  id: string;
  name: string;
  emoji: string;
  projectIds: string[];
}

export interface Project {
  id: string;
  title: string;
  author?: string;
  genre?: string;
  description?: string;
  language?: UiLanguage;
  target_word_count?: number;
  current_word_count: number;
  status: 'draft' | 'in_progress' | 'completed';
  created_at: string;
  updated_at: string;
  cover_images?: string | null;
  default_cover_id?: string | null;
}

export interface CreateProjectInput {
  title: string;
  author?: string;
  genre?: string;
  description?: string;
  language?: UiLanguage;
  target_word_count?: number;
  cover_images?: string | null;
  default_cover_id?: string | null;
}

export interface Chapter {
  id: string;
  project_id: string;
  title: string;
  order_index: number;
  outline_goal?: string;
  conflict?: string;
  twist?: string;
  cliffhanger?: string;
  draft_text?: string;
  final_text?: string;
  illustrations?: string | null;
  word_count: number;
  status: 'draft' | 'review' | 'final';
  created_at: string;
  updated_at: string;
}

export interface CreateChapterInput {
  project_id: string;
  title: string;
  order_index: number;
  outline_goal?: string;
  conflict?: string;
}

export interface UpdateChapterMetaInput {
  title?: string;
  order_index?: number;
  outline_goal?: string;
  conflict?: string;
  twist?: string;
  cliffhanger?: string;
}

export interface Character {
  id: string;
  project_id: string;
  name: string;
  role?: string;
  description?: string;
  personality?: string;
  background?: string;
  motivation?: string;
  voice_style?: string;
  created_at: string;
  updated_at: string;
}

export interface GenerationTask {
  id: string;
  project_id: string;
  task_type: 'outline' | 'chapter' | 'image' | 'revision';
  status: 'pending' | 'running' | 'completed' | 'failed';
  input_params: string;
  output_result?: string;
  error_message?: string;
  token_count?: number;
  cost?: number;
  created_at: string;
  completed_at?: string;
}

export interface ApiConfig {
  deepseek_api_key?: string;
  deepseek_base_url: string;
  deepseek_model: string;
  pollinations_api_key?: string;
  pollinations_base_url: string;
}

export type TextModelProvider =
  | 'deepseek'
  | 'openai'
  | 'openrouter'
  | 'gemini'
  | 'custom';

export interface TextModelConfig {
  provider: TextModelProvider;
  apiKey: string;
  apiUrl: string;
  model: string;
  temperature: number;
}

export interface TextModelProfile extends TextModelConfig {
  id: string;
  name: string;
  builtIn?: boolean;
  keyUrl?: string;
}

export interface SystemFontOption {
  key: string;
  label: string;
  fileName: string;
  pdfFamily: string;
}

export interface GenerateOutlineInput {
  title: string;
  genre: string;
  description: string;
  target_chapters: number;
  text_config: TextModelConfig;
}

export interface GenerateChapterInput {
  chapter_title: string;
  outline_goal: string;
  conflict: string;
  previous_summary?: string;
  character_info?: string;
  world_info?: string;
  text_config: TextModelConfig;
}

export interface GenerateRevisionInput {
  text: string;
  goals?: string;
  text_config: TextModelConfig;
}

export interface GenerateCharacterAppearanceInput {
  name: string;
  role?: string | null;
  personality?: string | null;
  background?: string | null;
  motivation?: string | null;
  style?: string | null;
  text_config: TextModelConfig;
}

export interface CharacterAppearanceResult {
  appearance: string;
  image_prompt: string;
}

export interface GenerateCharacterPortraitPromptInput {
  name: string;
  appearance?: string | null;
  role?: string | null;
  personality?: string | null;
  background?: string | null;
  motivation?: string | null;
  style?: string | null;
  text_config: TextModelConfig;
}

export interface CharacterPortraitPromptResult {
  image_prompt: string;
}

export interface ImageGenerationParams {
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
  model?: string;
  nologo?: boolean;
  enhance?: boolean;
}

export interface GenerateImageInput {
  params: ImageGenerationParams;
  save_path: string;
  pollinations_key?: string;
}

export type ImageEngine = 'pollinations' | 'comfyui';

// ── Local knowledge base (RAG) ─────────────────────────────────

export interface EmbeddingConfig {
  apiKey: string;
  apiUrl: string;
  model: string;
  dimensions?: number;
}

export interface KbIndexResult {
  chunksIndexed: number;
  skipped: boolean;
}

export interface KbStats {
  totalChunks: number;
  totalSources: number;
  embeddingModels: string[];
}

export interface KbIndexChapterInput {
  projectId: string;
  chapterId: string;
  text: string;
  embeddingConfig: EmbeddingConfig;
}

export interface KbRetrieveContextInput {
  projectId: string;
  query: string;
  topK?: number;
  excludeChapterIds: string[];
  embeddingConfig: EmbeddingConfig;
  // v2 augmentation layers (all optional, default false on backend)
  includeSummaries?: boolean;
  activeArcId?: string;
  includeForeshadowing?: boolean;
  // v2.3 performance bound — defaults to 300 on backend
  maxRecentChapters?: number;
}

export interface KbForgetSourceInput {
  projectId: string;
  sourceType: string;
  sourceId: string;
}

// ── v2.0 Summaries ─────────────────────────────────────────────

export type SummaryScopeType = 'chapter' | 'arc' | 'book';

export interface SummaryPayload {
  id: string;
  scopeType: SummaryScopeType;
  scopeId: string;
  summaryText: string;
  isStale: boolean;
  wordCount: number;
}

export interface KbGenChapterSummaryInput {
  projectId: string;
  chapterId: string;
  chapterTitle: string;
  chapterText: string;
  textConfig: TextModelConfig;
  embeddingConfig: EmbeddingConfig;
}

export interface KbGenArcSummaryInput {
  projectId: string;
  arcId: string;
  arcTitle: string;
  arcDescription?: string;
  chapterIds: string[];
  textConfig: TextModelConfig;
  embeddingConfig: EmbeddingConfig;
}

export interface KbGenBookSummaryInput {
  projectId: string;
  bookTitle: string;
  bookDescription?: string;
  textConfig: TextModelConfig;
  embeddingConfig: EmbeddingConfig;
}

export interface KbForgetSummaryInput {
  projectId: string;
  scopeType: SummaryScopeType;
  scopeId: string;
}

// ── v2.1 Entities ──────────────────────────────────────────────

export type EntityType = 'character_ref' | 'foreshadowing' | 'location' | 'event' | 'item';
export type EntityStatus = 'open' | 'paid_off' | 'archived';

export interface EntityPayload {
  id: string;
  entityType: EntityType;
  canonicalName: string;
  aliases: string[];
  summary: string;
  status: EntityStatus;
  firstSeenChapterId: string | null;
  lastSeenChapterId: string | null;
}

export interface KbExtractEntitiesInput {
  projectId: string;
  chapterId: string;
  chapterTitle: string;
  chapterText: string;
  knownCharacterNames?: string[];
  textConfig: TextModelConfig;
  embeddingConfig: EmbeddingConfig;
}

export interface KbExtractStatsPayload {
  charactersAdded: number;
  charactersUpdated: number;
  foreshadowingAdded: number;
  foreshadowingUpdated: number;
  locationsAdded: number;
  locationsUpdated: number;
  eventsAdded: number;
  eventsUpdated: number;
  itemsAdded: number;
  itemsUpdated: number;
}

export interface KbListEntitiesInput {
  projectId: string;
  entityType?: EntityType;
  status?: EntityStatus;
}

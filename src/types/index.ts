export interface Project {
  id: string;
  title: string;
  author?: string;
  genre?: string;
  description?: string;
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

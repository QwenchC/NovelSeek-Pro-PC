import { invoke } from '@tauri-apps/api/tauri';
import type {
  Project,
  CreateProjectInput,
  Chapter,
  CreateChapterInput,
  GenerateOutlineInput,
  GenerateChapterInput,
  GenerateImageInput,
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
  update: (id: string, draftText?: string, finalText?: string) =>
    invoke<void>('update_chapter', { id, draftText, finalText }),
  delete: (id: string) => invoke<void>('delete_chapter', { id }),
};

// AI Generation API
export const aiApi = {
  generateOutline: (input: GenerateOutlineInput) =>
    invoke<string>('generate_outline', { input }),
  generateChapter: (input: GenerateChapterInput) =>
    invoke<string>('generate_chapter', { input }),
  generateImage: (input: GenerateImageInput) => invoke<string>('generate_image', { input }),
  testDeepSeek: (apiKey: string) => invoke<boolean>('test_deepseek_connection', { apiKey }),
  testPollinations: (apiKey?: string) =>
    invoke<boolean>('test_pollinations_connection', { apiKey }),
};

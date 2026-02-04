import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Project, Chapter } from '@typings/index';

// 角色接口
export interface Character {
  id: string;
  name: string;
  role: string; // 主角、配角、反派等
  personality: string;
  background: string;
  motivation: string;
  isProtagonist: boolean; // 是否是主角
}

interface AppState {
  // Projects
  projects: Project[];
  currentProject: Project | null;
  setProjects: (projects: Project[]) => void;
  setCurrentProject: (project: Project | null) => void;

  // Chapters
  chapters: Chapter[];
  currentChapter: Chapter | null;
  setChapters: (chapters: Chapter[]) => void;
  setCurrentChapter: (chapter: Chapter | null) => void;

  // Characters (按项目ID存储)
  charactersByProject: Record<string, Character[]>;
  setCharacters: (projectId: string, characters: Character[]) => void;
  getCharacters: (projectId: string) => Character[];

  // API Keys (persisted to localStorage)
  deepseekKey: string;
  pollinationsKey: string;
  setDeepseekKey: (key: string) => void;
  setPollinationsKey: (key: string) => void;

  // UI State
  sidebarOpen: boolean;
  mobileMenuOpen: boolean;
  toggleSidebar: () => void;
  setMobileMenuOpen: (open: boolean) => void;

  // Generation State
  isGenerating: boolean;
  generationProgress: string;
  setIsGenerating: (isGenerating: boolean) => void;
  setGenerationProgress: (progress: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Projects
      projects: [],
      currentProject: null,
      setProjects: (projects) => set({ projects }),
      setCurrentProject: (currentProject) => set({ currentProject }),

      // Chapters
      chapters: [],
      currentChapter: null,
      setChapters: (chapters) => set({ chapters }),
      setCurrentChapter: (currentChapter) => set({ currentChapter }),

      // Characters
      charactersByProject: {},
      setCharacters: (projectId, characters) => set((state) => ({
        charactersByProject: {
          ...state.charactersByProject,
          [projectId]: characters,
        },
      })),
      getCharacters: (projectId) => get().charactersByProject[projectId] || [],

      // API Keys
      deepseekKey: '',
      pollinationsKey: '',
      setDeepseekKey: (deepseekKey) => set({ deepseekKey }),
      setPollinationsKey: (pollinationsKey) => set({ pollinationsKey }),

      // UI State
      sidebarOpen: true,
      mobileMenuOpen: false,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),

      // Generation State
      isGenerating: false,
      generationProgress: '',
      setIsGenerating: (isGenerating) => set({ isGenerating }),
      setGenerationProgress: (generationProgress) => set({ generationProgress }),
    }),
    {
      name: 'novelseek-storage',
      // 持久化 API Keys 和角色数据
      partialize: (state) => ({
        deepseekKey: state.deepseekKey,
        pollinationsKey: state.pollinationsKey,
        charactersByProject: state.charactersByProject,
      }),
    }
  )
);
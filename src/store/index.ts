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

// 推文数据接口
export interface ChapterPromo {
  imagePrompt: string;
  summary: string;
  imageBase64: string | null;
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

  // 推文数据 (按章节ID存储)
  promoByChapter: Record<string, ChapterPromo>;
  setPromo: (chapterId: string, promo: ChapterPromo) => void;
  getPromo: (chapterId: string) => ChapterPromo | null;

  // 世界观设定 (按项目ID存储)
  worldSettingByProject: Record<string, string>;
  setWorldSetting: (projectId: string, worldSetting: string) => void;
  getWorldSetting: (projectId: string) => string;

  // 时间线事件 (按项目ID存储)
  timelineByProject: Record<string, string>;
  setTimeline: (projectId: string, timeline: string) => void;
  getTimeline: (projectId: string) => string;

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
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;

  // Generation State
  isGenerating: boolean;
  generationProgress: string;
  setIsGenerating: (isGenerating: boolean) => void;
  setGenerationProgress: (progress: string) => void;
}

function getInitialTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
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

      // 推文数据
      promoByChapter: {},
      setPromo: (chapterId, promo) => set((state) => ({
        promoByChapter: {
          ...state.promoByChapter,
          [chapterId]: promo,
        },
      })),
      getPromo: (chapterId) => get().promoByChapter[chapterId] || null,

      // World Setting
      worldSettingByProject: {},
      setWorldSetting: (projectId, worldSetting) => set((state) => ({
        worldSettingByProject: {
          ...state.worldSettingByProject,
          [projectId]: worldSetting,
        },
      })),
      getWorldSetting: (projectId) => get().worldSettingByProject[projectId] || '',

      // Timeline
      timelineByProject: {},
      setTimeline: (projectId, timeline) => set((state) => ({
        timelineByProject: {
          ...state.timelineByProject,
          [projectId]: timeline,
        },
      })),
      getTimeline: (projectId) => get().timelineByProject[projectId] || '',

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
      theme: getInitialTheme(),
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),

      // Generation State
      isGenerating: false,
      generationProgress: '',
      setIsGenerating: (isGenerating) => set({ isGenerating }),
      setGenerationProgress: (generationProgress) => set({ generationProgress }),
    }),
    {
      name: 'novelseek-storage',
      // 持久化 API Keys、角色、世界观、时间线和推文数据
      partialize: (state) => ({
        deepseekKey: state.deepseekKey,
        pollinationsKey: state.pollinationsKey,
        charactersByProject: state.charactersByProject,
        worldSettingByProject: state.worldSettingByProject,
        timelineByProject: state.timelineByProject,
        promoByChapter: state.promoByChapter,
        theme: state.theme,
      }),
    }
  )
);

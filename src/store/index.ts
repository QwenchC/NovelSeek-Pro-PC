import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Chapter,
  ImageEngine,
  Project,
  ProjectFolder,
  TextModelConfig,
  TextModelProfile,
  TextModelProvider,
  UiLanguage,
} from '@typings/index';

export type { ProjectFolder };

export interface Character {
  id: string;
  name: string;
  gender: string;
  role: string;
  personality: string;
  background: string;
  motivation: string;
  appearance: string;
  portraitBase64?: string;
  portraitPrompt?: string;
  isProtagonist: boolean;
}

export interface ChapterPromo {
  imagePrompt: string;
  summary: string;
  imageBase64: string | null;
}

// ── Long Novel types ──────────────────────────────────────────
export type NovelType = 'short' | 'long';

export interface PlotArc {
  id: string;
  title: string;
  summary: string;
  order: number;
  status: 'upcoming' | 'active' | 'ending' | 'completed';
  chaptersUntilEnd?: number;
  chapterCount: number;
  miniOutline?: string;
  builtChapterIds?: string[];
}

export interface CharacterRelationship {
  id: string;
  fromCharId: string;
  toCharId: string;
  type: string;
  description: string;
}

export interface CharacterEvent {
  id: string;
  characterId: string;
  arcId: string;
  chapterIndex: number;
  chapterTitle: string;
  title: string;
  description: string;
}

function normalizeCharacterRecord(character: Partial<Character>, index = 0): Character {
  return {
    id: character.id || `char-${Date.now()}-${index}`,
    name: character.name || `角色${index + 1}`,
    gender: character.gender || '',
    role: character.role || '',
    personality: character.personality || '',
    background: character.background || '',
    motivation: character.motivation || '',
    appearance: character.appearance || '',
    portraitBase64: character.portraitBase64 || undefined,
    portraitPrompt: character.portraitPrompt || undefined,
    isProtagonist: Boolean(character.isProtagonist),
  };
}

function normalizeCharacterList(characters: unknown): Character[] {
  if (!Array.isArray(characters)) return [];
  return characters.map((character, index) =>
    normalizeCharacterRecord((character as Partial<Character>) || {}, index)
  );
}

const TEXT_MODEL_PROVIDERS: TextModelProvider[] = [
  'deepseek',
  'openai',
  'openrouter',
  'gemini',
  'custom',
];

const DEFAULT_ACTIVE_PROFILE_ID = 'deepseek';

const BUILTIN_TEXT_MODEL_PROFILES: TextModelProfile[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    provider: 'deepseek',
    apiKey: '',
    apiUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.7,
    builtIn: true,
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    provider: 'openai',
    apiKey: '',
    apiUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    temperature: 0.7,
    builtIn: true,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    provider: 'openrouter',
    apiKey: '',
    apiUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    temperature: 0.7,
    builtIn: true,
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'gemini',
    name: 'Gemini(OpenAI兼容)',
    provider: 'gemini',
    apiKey: '',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.0-flash',
    temperature: 0.7,
    builtIn: true,
    keyUrl: 'https://aistudio.google.com/app/apikey',
  },
];

function getInitialTheme(): 'light' | 'dark' {
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

function getInitialUiLanguage(): UiLanguage {
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }
  return 'zh';
}

function clampTemperature(value: number): number {
  if (!Number.isFinite(value)) return 0.7;
  return Math.min(2, Math.max(0, value));
}

function normalizeProvider(value: unknown): TextModelProvider {
  if (typeof value === 'string' && TEXT_MODEL_PROVIDERS.includes(value as TextModelProvider)) {
    return value as TextModelProvider;
  }
  return 'custom';
}

function toTextModelConfig(profile: TextModelProfile): TextModelConfig {
  return {
    provider: profile.provider,
    apiKey: profile.apiKey,
    apiUrl: profile.apiUrl,
    model: profile.model,
    temperature: clampTemperature(profile.temperature),
  };
}

function cloneBuiltinProfiles(): TextModelProfile[] {
  return BUILTIN_TEXT_MODEL_PROFILES.map((profile) => ({ ...profile }));
}

function normalizeProfile(input: Partial<TextModelProfile> & { id: string }): TextModelProfile {
  const provider = normalizeProvider(input.provider);
  return {
    id: input.id,
    name: (input.name || input.id).trim() || input.id,
    provider,
    apiKey: (input.apiKey || '').trim(),
    apiUrl: (input.apiUrl || '').trim(),
    model: (input.model || '').trim(),
    temperature: clampTemperature(
      typeof input.temperature === 'number' ? input.temperature : 0.7
    ),
    builtIn: Boolean(input.builtIn),
    keyUrl: typeof input.keyUrl === 'string' ? input.keyUrl : undefined,
  };
}

function mergeProfilesWithBuiltins(rawProfiles: unknown[]): TextModelProfile[] {
  const merged = cloneBuiltinProfiles();

  if (!Array.isArray(rawProfiles)) {
    return merged;
  }

  for (const item of rawProfiles) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Partial<TextModelProfile>;
    if (!raw.id || typeof raw.id !== 'string') continue;

    const normalized = normalizeProfile({
      ...raw,
      id: raw.id,
    });

    const existingIndex = merged.findIndex((profile) => profile.id === normalized.id);
    if (existingIndex >= 0) {
      const existing = merged[existingIndex];
      merged[existingIndex] = {
        ...existing,
        ...normalized,
        builtIn: existing.builtIn,
        keyUrl: existing.keyUrl || normalized.keyUrl,
      };
    } else {
      merged.push({
        ...normalized,
        builtIn: false,
      });
    }
  }

  return merged;
}

function generateCustomProfileId(profiles: TextModelProfile[]): string {
  let seed = profiles.length + 1;
  let candidate = `custom-${seed}`;
  while (profiles.some((profile) => profile.id === candidate)) {
    seed += 1;
    candidate = `custom-${seed}`;
  }
  return candidate;
}

function pickActiveProfile(
  profiles: TextModelProfile[],
  activeProfileId?: string,
  preferredProvider?: TextModelProvider
): TextModelProfile {
  const byId = activeProfileId
    ? profiles.find((profile) => profile.id === activeProfileId)
    : undefined;
  if (byId) return byId;

  const byProvider = preferredProvider
    ? profiles.find((profile) => profile.provider === preferredProvider)
    : undefined;
  if (byProvider) return byProvider;

  return (
    profiles.find((profile) => profile.id === DEFAULT_ACTIVE_PROFILE_ID) ||
    profiles[0] ||
    cloneBuiltinProfiles()[0]
  );
}

interface AppState {
  projects: Project[];
  currentProject: Project | null;
  setProjects: (projects: Project[]) => void;
  setCurrentProject: (project: Project | null) => void;

  chapters: Chapter[];
  currentChapter: Chapter | null;
  setChapters: (chapters: Chapter[]) => void;
  setCurrentChapter: (chapter: Chapter | null) => void;

  charactersByProject: Record<string, Character[]>;
  setCharacters: (projectId: string, characters: Character[]) => void;
  getCharacters: (projectId: string) => Character[];

  promoByChapter: Record<string, ChapterPromo>;
  setPromo: (chapterId: string, promo: ChapterPromo) => void;
  getPromo: (chapterId: string) => ChapterPromo | null;

  worldSettingByProject: Record<string, string>;
  setWorldSetting: (projectId: string, worldSetting: string) => void;
  getWorldSetting: (projectId: string) => string;

  timelineByProject: Record<string, string>;
  setTimeline: (projectId: string, timeline: string) => void;
  getTimeline: (projectId: string) => string;

  textModelConfig: TextModelConfig;
  textModelProfiles: TextModelProfile[];
  activeTextModelProfileId: string;
  pollinationsKey: string;
  imageEngine: ImageEngine;
  comfyUIUrl: string;
  setTextModelConfig: (config: TextModelConfig) => void;
  updateTextModelConfig: (patch: Partial<TextModelConfig>) => void;
  setTextModelProfiles: (profiles: TextModelProfile[]) => void;
  setActiveTextModelProfileId: (profileId: string) => void;
  addTextModelProfile: (profile: Omit<TextModelProfile, 'id'> & { id?: string }) => string;
  updateTextModelProfile: (profileId: string, patch: Partial<TextModelProfile>) => void;
  removeTextModelProfile: (profileId: string) => void;
  setPollinationsKey: (key: string) => void;
  setImageEngine: (engine: ImageEngine) => void;
  setComfyUIUrl: (url: string) => void;

  sidebarOpen: boolean;
  mobileMenuOpen: boolean;
  toggleSidebar: () => void;
  setMobileMenuOpen: (open: boolean) => void;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  uiLanguage: UiLanguage;
  setUiLanguage: (language: UiLanguage) => void;
  toggleUiLanguage: () => void;

  isGenerating: boolean;
  generationProgress: string;
  setIsGenerating: (isGenerating: boolean) => void;
  setGenerationProgress: (progress: string) => void;

  folders: ProjectFolder[];
  addFolder: (name: string, emoji: string) => string;
  updateFolder: (folderId: string, name: string, emoji: string) => void;
  deleteFolder: (folderId: string) => void;
  moveProjectToFolder: (projectId: string, folderId: string | null) => void;

  // Long novel state
  novelTypeByProject: Record<string, NovelType>;
  setNovelType: (projectId: string, type: NovelType) => void;
  getNovelType: (projectId: string) => NovelType;

  plotArcsByProject: Record<string, PlotArc[]>;
  setPlotArcs: (projectId: string, arcs: PlotArc[]) => void;
  getPlotArcs: (projectId: string) => PlotArc[];
  addPlotArc: (projectId: string, arc: Omit<PlotArc, 'id'>) => string;
  updatePlotArc: (projectId: string, arcId: string, patch: Partial<PlotArc>) => void;
  deletePlotArc: (projectId: string, arcId: string) => void;

  longNovelOutlineByProject: Record<string, string>;
  setLongNovelOutline: (projectId: string, outline: string) => void;
  getLongNovelOutline: (projectId: string) => string;

  characterRelationshipsByProject: Record<string, CharacterRelationship[]>;
  setCharacterRelationships: (projectId: string, rels: CharacterRelationship[]) => void;
  getCharacterRelationships: (projectId: string) => CharacterRelationship[];

  characterEventsByProject: Record<string, CharacterEvent[]>;
  setCharacterEvents: (projectId: string, events: CharacterEvent[]) => void;
  getCharacterEvents: (projectId: string) => CharacterEvent[];
  addCharacterEvent: (projectId: string, event: Omit<CharacterEvent, 'id'>) => void;
  deleteCharacterEvent: (projectId: string, eventId: string) => void;
}

const initialProfiles = cloneBuiltinProfiles();
const initialActiveProfile = pickActiveProfile(initialProfiles, DEFAULT_ACTIVE_PROFILE_ID);

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      projects: [],
      currentProject: null,
      setProjects: (projects) => set({ projects }),
      setCurrentProject: (currentProject) => set({ currentProject }),

      chapters: [],
      currentChapter: null,
      setChapters: (chapters) => set({ chapters }),
      setCurrentChapter: (currentChapter) => set({ currentChapter }),

      charactersByProject: {},
      setCharacters: (projectId, characters) =>
        set((state) => ({
          charactersByProject: {
            ...state.charactersByProject,
            [projectId]: normalizeCharacterList(characters),
          },
        })),
      getCharacters: (projectId) => normalizeCharacterList(get().charactersByProject[projectId]),

      promoByChapter: {},
      setPromo: (chapterId, promo) =>
        set((state) => ({
          promoByChapter: {
            ...state.promoByChapter,
            [chapterId]: promo,
          },
        })),
      getPromo: (chapterId) => get().promoByChapter[chapterId] || null,

      worldSettingByProject: {},
      setWorldSetting: (projectId, worldSetting) =>
        set((state) => ({
          worldSettingByProject: {
            ...state.worldSettingByProject,
            [projectId]: worldSetting,
          },
        })),
      getWorldSetting: (projectId) => get().worldSettingByProject[projectId] || '',

      timelineByProject: {},
      setTimeline: (projectId, timeline) =>
        set((state) => ({
          timelineByProject: {
            ...state.timelineByProject,
            [projectId]: timeline,
          },
        })),
      getTimeline: (projectId) => get().timelineByProject[projectId] || '',

      textModelProfiles: initialProfiles,
      activeTextModelProfileId: initialActiveProfile.id,
      textModelConfig: toTextModelConfig(initialActiveProfile),
      pollinationsKey: '',

      imageEngine: 'pollinations' as ImageEngine,
      comfyUIUrl: 'http://localhost:8188',

      setTextModelConfig: (textModelConfig) =>
        set((state) => {
          const normalized: TextModelConfig = {
            provider: normalizeProvider(textModelConfig.provider),
            apiKey: (textModelConfig.apiKey || '').trim(),
            apiUrl: (textModelConfig.apiUrl || '').trim(),
            model: (textModelConfig.model || '').trim(),
            temperature: clampTemperature(textModelConfig.temperature),
          };
          const profiles = state.textModelProfiles.map((profile) =>
            profile.id === state.activeTextModelProfileId
              ? normalizeProfile({ ...profile, ...normalized, id: profile.id })
              : profile
          );
          return {
            textModelConfig: normalized,
            textModelProfiles: profiles,
          };
        }),

      updateTextModelConfig: (patch) =>
        set((state) => {
          const nextConfig: TextModelConfig = {
            ...state.textModelConfig,
            ...patch,
            provider: normalizeProvider((patch.provider ?? state.textModelConfig.provider) as TextModelProvider),
            temperature: clampTemperature(
              typeof patch.temperature === 'number'
                ? patch.temperature
                : state.textModelConfig.temperature
            ),
          };

          const profiles = state.textModelProfiles.map((profile) =>
            profile.id === state.activeTextModelProfileId
              ? normalizeProfile({ ...profile, ...nextConfig, id: profile.id })
              : profile
          );

          return {
            textModelConfig: nextConfig,
            textModelProfiles: profiles,
          };
        }),

      setTextModelProfiles: (profiles) =>
        set((state) => {
          const mergedProfiles = mergeProfilesWithBuiltins(profiles);
          const activeProfile = pickActiveProfile(
            mergedProfiles,
            state.activeTextModelProfileId,
            state.textModelConfig.provider
          );
          return {
            textModelProfiles: mergedProfiles,
            activeTextModelProfileId: activeProfile.id,
            textModelConfig: toTextModelConfig(activeProfile),
          };
        }),

      setActiveTextModelProfileId: (profileId) =>
        set((state) => {
          const activeProfile = pickActiveProfile(
            state.textModelProfiles,
            profileId,
            state.textModelConfig.provider
          );
          return {
            activeTextModelProfileId: activeProfile.id,
            textModelConfig: toTextModelConfig(activeProfile),
          };
        }),

      addTextModelProfile: (profile) => {
        const state = get();
        const id =
          typeof profile.id === 'string' && profile.id.trim()
            ? profile.id.trim()
            : generateCustomProfileId(state.textModelProfiles);
        const nextProfile = normalizeProfile({
          ...profile,
          id,
          builtIn: false,
          provider: profile.provider ?? 'custom',
        });

        set((current) => ({
          textModelProfiles: [...current.textModelProfiles, nextProfile],
        }));

        return id;
      },

      updateTextModelProfile: (profileId, patch) =>
        set((state) => {
          const profiles = state.textModelProfiles.map((profile) =>
            profile.id === profileId
              ? normalizeProfile({
                  ...profile,
                  ...patch,
                  id: profile.id,
                  builtIn: profile.builtIn,
                  keyUrl: profile.keyUrl || patch.keyUrl,
                })
              : profile
          );

          const activeProfile = pickActiveProfile(
            profiles,
            state.activeTextModelProfileId,
            state.textModelConfig.provider
          );

          return {
            textModelProfiles: profiles,
            activeTextModelProfileId: activeProfile.id,
            textModelConfig: toTextModelConfig(activeProfile),
          };
        }),

      removeTextModelProfile: (profileId) =>
        set((state) => {
          const target = state.textModelProfiles.find((profile) => profile.id === profileId);
          if (!target || target.builtIn) {
            return {};
          }

          const profiles = state.textModelProfiles.filter((profile) => profile.id !== profileId);
          const activeProfile = pickActiveProfile(
            profiles,
            state.activeTextModelProfileId === profileId
              ? DEFAULT_ACTIVE_PROFILE_ID
              : state.activeTextModelProfileId,
            state.textModelConfig.provider
          );

          return {
            textModelProfiles: profiles,
            activeTextModelProfileId: activeProfile.id,
            textModelConfig: toTextModelConfig(activeProfile),
          };
        }),

      setPollinationsKey: (pollinationsKey) => set({ pollinationsKey }),

      setImageEngine: (imageEngine) => set({ imageEngine }),
      setComfyUIUrl: (comfyUIUrl) => set({ comfyUIUrl }),

      sidebarOpen: true,
      mobileMenuOpen: false,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
      theme: getInitialTheme(),
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
      uiLanguage: getInitialUiLanguage(),
      setUiLanguage: (uiLanguage) => set({ uiLanguage }),
      toggleUiLanguage: () =>
        set((state) => ({
          uiLanguage: state.uiLanguage === 'zh' ? 'en' : 'zh',
        })),

      isGenerating: false,
      generationProgress: '',
      setIsGenerating: (isGenerating) => set({ isGenerating }),
      setGenerationProgress: (generationProgress) => set({ generationProgress }),

      folders: [],
      addFolder: (name, emoji) => {
        const id = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        set((state) => ({
          folders: [...state.folders, { id, name, emoji, projectIds: [] }],
        }));
        return id;
      },
      updateFolder: (folderId, name, emoji) =>
        set((state) => ({
          folders: state.folders.map((f) =>
            f.id === folderId ? { ...f, name, emoji } : f
          ),
        })),
      deleteFolder: (folderId) =>
        set((state) => ({
          folders: state.folders.filter((f) => f.id !== folderId),
        })),
      moveProjectToFolder: (projectId, folderId) =>
        set((state) => ({
          folders: state.folders.map((f) => {
            if (folderId === null || f.id !== folderId) {
              // Remove from this folder
              return { ...f, projectIds: f.projectIds.filter((pid) => pid !== projectId) };
            }
            // Add to this folder (avoid duplicates)
            if (f.projectIds.includes(projectId)) return f;
            return { ...f, projectIds: [...f.projectIds, projectId] };
          }),
        })),

      // ── Long novel implementations ──────────────────────────
      novelTypeByProject: {},
      setNovelType: (projectId, type) =>
        set((state) => ({
          novelTypeByProject: { ...state.novelTypeByProject, [projectId]: type },
        })),
      getNovelType: (projectId) => get().novelTypeByProject[projectId] || 'short',

      plotArcsByProject: {},
      setPlotArcs: (projectId, arcs) =>
        set((state) => ({
          plotArcsByProject: { ...state.plotArcsByProject, [projectId]: arcs },
        })),
      getPlotArcs: (projectId) => get().plotArcsByProject[projectId] || [],
      addPlotArc: (projectId, arc) => {
        const id = `arc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        set((state) => ({
          plotArcsByProject: {
            ...state.plotArcsByProject,
            [projectId]: [...(state.plotArcsByProject[projectId] || []), { ...arc, id }],
          },
        }));
        return id;
      },
      updatePlotArc: (projectId, arcId, patch) =>
        set((state) => ({
          plotArcsByProject: {
            ...state.plotArcsByProject,
            [projectId]: (state.plotArcsByProject[projectId] || []).map((a) =>
              a.id === arcId ? { ...a, ...patch } : a
            ),
          },
        })),
      deletePlotArc: (projectId, arcId) =>
        set((state) => ({
          plotArcsByProject: {
            ...state.plotArcsByProject,
            [projectId]: (state.plotArcsByProject[projectId] || []).filter((a) => a.id !== arcId),
          },
        })),

      longNovelOutlineByProject: {},
      setLongNovelOutline: (projectId, outline) =>
        set((state) => ({
          longNovelOutlineByProject: { ...state.longNovelOutlineByProject, [projectId]: outline },
        })),
      getLongNovelOutline: (projectId) => get().longNovelOutlineByProject[projectId] || '',

      characterRelationshipsByProject: {},
      setCharacterRelationships: (projectId, rels) =>
        set((state) => ({
          characterRelationshipsByProject: {
            ...state.characterRelationshipsByProject,
            [projectId]: rels,
          },
        })),
      getCharacterRelationships: (projectId) =>
        get().characterRelationshipsByProject[projectId] || [],

      characterEventsByProject: {},
      setCharacterEvents: (projectId, events) =>
        set((state) => ({
          characterEventsByProject: { ...state.characterEventsByProject, [projectId]: events },
        })),
      getCharacterEvents: (projectId) => get().characterEventsByProject[projectId] || [],
      addCharacterEvent: (projectId, event) =>
        set((state) => ({
          characterEventsByProject: {
            ...state.characterEventsByProject,
            [projectId]: [
              ...(state.characterEventsByProject[projectId] || []),
              { ...event, id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
            ],
          },
        })),
      deleteCharacterEvent: (projectId, eventId) =>
        set((state) => ({
          characterEventsByProject: {
            ...state.characterEventsByProject,
            [projectId]: (state.characterEventsByProject[projectId] || []).filter(
              (e) => e.id !== eventId
            ),
          },
        })),
    }),
    {
      name: 'novelseek-storage',
      version: 7,
      partialize: (state) => ({
        textModelConfig: state.textModelConfig,
        textModelProfiles: state.textModelProfiles,
        activeTextModelProfileId: state.activeTextModelProfileId,
        pollinationsKey: state.pollinationsKey,
        imageEngine: state.imageEngine,
        comfyUIUrl: state.comfyUIUrl,
        charactersByProject: state.charactersByProject,
        worldSettingByProject: state.worldSettingByProject,
        timelineByProject: state.timelineByProject,
        promoByChapter: state.promoByChapter,
        theme: state.theme,
        uiLanguage: state.uiLanguage,
        folders: state.folders,
        novelTypeByProject: state.novelTypeByProject,
        plotArcsByProject: state.plotArcsByProject,
        longNovelOutlineByProject: state.longNovelOutlineByProject,
        characterRelationshipsByProject: state.characterRelationshipsByProject,
        characterEventsByProject: state.characterEventsByProject,
      }),
      migrate: (persistedState: any, version) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return persistedState;
        }

        if (version < 2) {
          const legacyKey =
            typeof persistedState.deepseekKey === 'string' ? persistedState.deepseekKey : '';
          const existingConfig =
            persistedState.textModelConfig && typeof persistedState.textModelConfig === 'object'
              ? persistedState.textModelConfig
              : {};

          persistedState.textModelConfig = {
            provider: normalizeProvider(existingConfig.provider),
            apiKey: (existingConfig.apiKey || legacyKey || '').trim(),
            apiUrl: (existingConfig.apiUrl || 'https://api.deepseek.com/v1').trim(),
            model: (existingConfig.model || 'deepseek-chat').trim(),
            temperature: clampTemperature(
              typeof existingConfig.temperature === 'number' ? existingConfig.temperature : 0.7
            ),
          };

          delete persistedState.deepseekKey;
        }

        if (version < 3) {
          const existingConfig =
            persistedState.textModelConfig && typeof persistedState.textModelConfig === 'object'
              ? persistedState.textModelConfig
              : {};
          const mergedProfiles = mergeProfilesWithBuiltins(
            Array.isArray(persistedState.textModelProfiles) ? persistedState.textModelProfiles : []
          );

          const activeProfile = pickActiveProfile(
            mergedProfiles,
            typeof persistedState.activeTextModelProfileId === 'string'
              ? persistedState.activeTextModelProfileId
              : undefined,
            normalizeProvider(existingConfig.provider)
          );

          const configuredActive = normalizeProfile({
            ...activeProfile,
            id: activeProfile.id,
            apiKey:
              typeof existingConfig.apiKey === 'string'
                ? existingConfig.apiKey
                : activeProfile.apiKey,
            apiUrl:
              typeof existingConfig.apiUrl === 'string'
                ? existingConfig.apiUrl
                : activeProfile.apiUrl,
            model:
              typeof existingConfig.model === 'string'
                ? existingConfig.model
                : activeProfile.model,
            temperature:
              typeof existingConfig.temperature === 'number'
                ? existingConfig.temperature
                : activeProfile.temperature,
          });

          persistedState.textModelProfiles = mergedProfiles.map((profile) =>
            profile.id === configuredActive.id ? configuredActive : profile
          );
          persistedState.activeTextModelProfileId = configuredActive.id;
          persistedState.textModelConfig = toTextModelConfig(configuredActive);
        }

        if (version < 4) {
          persistedState.uiLanguage =
            persistedState.uiLanguage === 'en' || persistedState.uiLanguage === 'zh'
              ? persistedState.uiLanguage
              : getInitialUiLanguage();
        }

        if (version < 5) {
          if (!Array.isArray(persistedState.folders)) {
            persistedState.folders = [];
          }
        }

        if (version < 6) {
          if (!persistedState.imageEngine) {
            persistedState.imageEngine = 'pollinations';
          }
          if (!persistedState.comfyUIUrl) {
            persistedState.comfyUIUrl = 'http://localhost:8188';
          }
        }

        if (version < 7) {
          if (!persistedState.novelTypeByProject) persistedState.novelTypeByProject = {};
          if (!persistedState.plotArcsByProject) persistedState.plotArcsByProject = {};
          if (!persistedState.longNovelOutlineByProject) persistedState.longNovelOutlineByProject = {};
          if (!persistedState.characterRelationshipsByProject) persistedState.characterRelationshipsByProject = {};
          if (!persistedState.characterEventsByProject) persistedState.characterEventsByProject = {};
        }

        return persistedState;
      },
    }
  )
);

import type { Chapter, Project } from '@typings/index';

// Cross-mount, in-memory cache for the project LANDING pages (LongNovelPage / ProjectPage).
//
// Why: the Topbar tab strip lets several projects stay "open". But each tab switch is a React
// Router navigation that unmounts + remounts the landing page, which previously reset `loading` to
// true and refetched everything — so returning to an already-open tab flashed a spinner and felt
// like a full reload, defeating the point of multi-open tabs.
//
// This cache enables a stale-while-revalidate render: on revisit the page shows the last-known
// project + chapters INSTANTLY (no spinner), then silently refreshes in the background. Module
// scope = lives for the app session, cleared on reload. Keep it in sync wherever chapters/project
// change (the loaders below do this on every fetch).

const projectMetaCache = new Map<string, Project>();
const chaptersCache = new Map<string, Chapter[]>();

export const getCachedProject = (id: string): Project | undefined => projectMetaCache.get(id);
export const setCachedProject = (id: string, project: Project): void => {
  projectMetaCache.set(id, project);
};

export const getCachedChapters = (id: string): Chapter[] | undefined => chaptersCache.get(id);
export const setCachedChapters = (id: string, chapters: Chapter[]): void => {
  chaptersCache.set(id, chapters);
};

/** True when both the project meta and its chapters are cached → the page can render with no spinner. */
export const hasProjectPageCache = (id: string): boolean =>
  projectMetaCache.has(id) && chaptersCache.has(id);

/** Drop a project's cache (e.g. after deletion) so it won't linger as stale tab content. */
export const clearProjectPageCache = (id: string): void => {
  projectMetaCache.delete(id);
  chaptersCache.delete(id);
};

// Cheap signatures so the background refresh can skip setState (and the re-render it triggers) when
// the freshly-fetched data is identical to what's already shown — the common case on a tab switch.
export const chaptersSignature = (chapters?: Chapter[]): string =>
  (chapters ?? [])
    .map((c) => `${c.id}:${c.order_index}:${c.word_count}:${c.status}:${c.title}`)
    .join('|');

export const projectSignature = (project?: Project | null): string =>
  project
    ? `${project.updated_at}|${project.title}|${project.current_word_count}|${project.cover_images}|${project.default_cover_id}`
    : '';

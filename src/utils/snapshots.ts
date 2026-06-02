// Version-history snapshot assembly + restore. A snapshot captures the FULL state of one project:
// its project record, all chapters (metadata + bodies + illustrations), every per-project store map
// slice (characters / arcs / volumes / containers / growth / novel-chat / cultivation / …) and the
// promo entries for its chapters. Stored as a JSON blob via snapshotApi (SQLite). Restore re-applies
// that state, deleting chapters created after the snapshot so it's a true rollback.

import { useAppStore } from '@store/index';
import { chapterApi, projectApi } from '@services/api';
import type { ImportChapterFull } from '@services/api';
import type { Chapter, Project } from '@typings/index';

interface SnapshotContent {
  version: number;
  project: Project | null;
  chapters: Chapter[];
  store: Record<string, unknown>;
  promoByChapter: Record<string, unknown>;
}

/** Assemble the full project-state JSON for a snapshot. */
export async function buildSnapshotContent(projectId: string): Promise<string> {
  const project = await projectApi.getById(projectId);
  const chapters = await chapterApi.getByProject(projectId);
  const state = useAppStore.getState() as unknown as Record<string, unknown>;

  // Every per-project map slice for this project (incl. containers / volumes / growth / novelChats).
  const store: Record<string, unknown> = {};
  for (const key of Object.keys(state)) {
    if (!key.endsWith('ByProject')) continue;
    const map = state[key];
    if (map && typeof map === 'object' && projectId in (map as Record<string, unknown>)) {
      store[key] = (map as Record<string, unknown>)[projectId];
    }
  }

  // Promo entries keyed by this project's chapter ids.
  const promoAll = (state.promoByChapter as Record<string, unknown>) || {};
  const promoByChapter: Record<string, unknown> = {};
  for (const c of chapters) {
    if (promoAll[c.id] !== undefined) promoByChapter[c.id] = promoAll[c.id];
  }

  const content: SnapshotContent = { version: 1, project, chapters, store, promoByChapter };
  return JSON.stringify(content);
}

/** Re-apply a snapshot: upsert project + chapters, delete newer chapters, restore map slices. */
export async function restoreSnapshot(projectId: string, content: string): Promise<void> {
  const snap = JSON.parse(content) as SnapshotContent;

  // 1) Upsert the project record + its chapters (bodies + illustrations + arc_id) into SQLite.
  await projectApi.importContent({
    projects: snap.project ? [snap.project as unknown as Record<string, unknown>] : [],
    chapters: (snap.chapters || []) as unknown as ImportChapterFull[],
  });

  // 2) Delete chapters that exist now but were not in the snapshot (true rollback).
  const current = await chapterApi.getByProject(projectId);
  const keep = new Set((snap.chapters || []).map((c) => c.id));
  for (const c of current) {
    if (!keep.has(c.id)) {
      await chapterApi.delete(c.id).catch((e) => console.warn('[Snapshot] delete extra chapter failed:', e));
    }
  }

  // 3) Restore this project's slice of every per-project map + its promo entries.
  const state = useAppStore.getState() as unknown as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, slice] of Object.entries(snap.store || {})) {
    const existing = (state[key] as Record<string, unknown>) || {};
    next[key] = { ...existing, [projectId]: slice };
  }
  if (snap.promoByChapter) {
    next.promoByChapter = { ...((state.promoByChapter as Record<string, unknown>) || {}), ...snap.promoByChapter };
  }
  useAppStore.setState(next as never);

  // 4) Refresh the in-memory project list so word counts / titles reflect the rollback.
  const all = await projectApi.getAll();
  useAppStore.getState().setProjects(all);
}

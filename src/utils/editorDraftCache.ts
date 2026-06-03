// Per-chapter editor draft cache (session scope, cleared on app reload).
//
// The chapter editor (LongNovelEditorPage / EditorPage) is a heavy route component: switching to
// another Topbar tab unmounts it, so on return it remounts and reloads the chapter from disk —
// discarding any UNSAVED in-progress text and resetting scroll. That makes multi-open tabs feel
// lossy. This cache lets the editor restore exactly where you left off across tab switches.
//
// Semantics:
//   - `dirty` marks unsaved edits. On reload we restore the cached text ONLY when dirty, so a chapter
//     with no local edits still picks up fresh disk content (e.g. the background agent wrote into it).
//   - `scrollTop` restores the editor's scroll position.

export interface EditorDraft {
  content: string;
  dirty: boolean;
  scrollTop: number;
}

const drafts = new Map<string, EditorDraft>();

export const getEditorDraft = (chapterId: string): EditorDraft | undefined => drafts.get(chapterId);

/** Record the editor's current text + whether it has unsaved changes. */
export const setEditorDraftContent = (chapterId: string, content: string, dirty: boolean): void => {
  const prev = drafts.get(chapterId);
  drafts.set(chapterId, { content, dirty, scrollTop: prev?.scrollTop ?? 0 });
};

/** Record the editor's scroll position for this chapter. */
export const setEditorDraftScroll = (chapterId: string, scrollTop: number): void => {
  const prev = drafts.get(chapterId);
  drafts.set(chapterId, { content: prev?.content ?? '', dirty: prev?.dirty ?? false, scrollTop });
};

/** Forget a chapter's draft (e.g. on deletion). */
export const clearEditorDraft = (chapterId: string): void => {
  drafts.delete(chapterId);
};

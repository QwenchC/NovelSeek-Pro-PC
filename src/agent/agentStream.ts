import { create } from 'zustand';

/**
 * Ephemeral live-streaming text for the agent (chapter generation preview). Deliberately a SEPARATE,
 * NON-persisted store: routing per-delta updates through the main persisted store made zustand's
 * persist middleware serialize the entire (image-heavy) state to IndexedDB on every token, freezing
 * and eventually crashing the renderer. This store has no persistence, so updates are cheap.
 */
interface AgentStreamState {
  text: string;
  set: (text: string) => void;
}

export const useAgentStream = create<AgentStreamState>((set) => ({
  text: '',
  set: (text) => set({ text }),
}));

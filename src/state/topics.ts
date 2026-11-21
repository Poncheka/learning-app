// The topics on offer, and the one the listener picked. Kept here so the Listen, Length and
// Building screens can share them without passing data through the address bar.
import { create } from 'zustand';

import { listTopics, refillTopics, type Topic } from '@/lib/api';

type TopicsState = {
  topics: Topic[];
  loading: boolean;
  error: string | null;
  selected: Topic | null;
  /** True while the server is preparing more topics to fill the Listen screen. */
  refilling: boolean;
  load: () => Promise<void>;
  topUp: () => Promise<void>;
  select: (topic: Topic) => void;
};

/** How many topics the Listen screen shows, and so how many are kept waiting. */
export const WAITING = 3;

export const useTopics = create<TopicsState>((set, get) => ({
  topics: [],
  loading: false,
  error: null,
  selected: null,
  refilling: false,

  // Keeps three topics waiting. Each one the server prepares takes about a minute and costs
  // a few cents, so this runs one at a time and stops as soon as three are ready.
  topUp: async () => {
    if (get().refilling) return;
    set({ refilling: true });
    try {
      for (let round = 0; round < WAITING && get().topics.length < WAITING; round++) {
        const { prepared } = await refillTopics();
        if (!prepared) break;
        set({ topics: await listTopics() });
      }
    } catch {
      // Topping up is a background nicety. The topics already shown still work.
    } finally {
      set({ refilling: false });
    }
  },

  load: async () => {
    set({ loading: true, error: null });
    try {
      set({ topics: await listTopics(), loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Topics could not be loaded.' });
    }
  },
  select: (topic) => set({ selected: topic }),
}));

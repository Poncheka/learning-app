// The stories on offer, and the one the listener picked. Kept here so the Listen, Length and
// Building screens can share them without passing data through the address bar.
//
// The phone only reads this list. Stories are prepared by the server on its own schedule, with the
// app open or closed, so nothing here asks for one to be made or waits for one.
import { create } from 'zustand';

import { dismissTopic, listTopics, type Topic } from '@/lib/api';

type TopicsState = {
  topics: Topic[];
  loading: boolean;
  error: string | null;
  selected: Topic | null;
  /** Stories that arrived while the app was open, newest first. They lead the Listen screen, marked New. */
  fresh: string[];
  /** The first load, which holds the cards' places while it runs. */
  load: () => Promise<void>;
  /** A quiet look for new stories. It changes nothing on screen unless something arrived. */
  refresh: () => Promise<void>;
  select: (topic: Topic) => void;
  /** "Not interested": removes a story at once and tells the server, which lines up another. */
  dismiss: (topic: Topic) => void;
};

export const useTopics = create<TopicsState>((set, get) => ({
  topics: [],
  loading: false,
  error: null,
  selected: null,
  fresh: [],

  load: async () => {
    if (get().topics.length > 0) return get().refresh();
    set({ loading: true, error: null });
    try {
      set({ topics: await listTopics(), loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Stories could not be loaded.' });
    }
  },

  refresh: async () => {
    try {
      const next = await listTopics();
      const had = new Set(get().topics.map((t) => t.id));
      // With nothing on screen before, everything is new, so nothing is singled out.
      const arrived = had.size > 0 ? next.filter((t) => !had.has(t.id)).map((t) => t.id) : [];
      const here = new Set(next.map((t) => t.id));
      set({ topics: next, error: null, fresh: [...arrived, ...get().fresh].filter((id) => here.has(id)) });
    } catch {
      // What is already showing still works. The next look will try again.
    }
  },

  select: (topic) => set({ selected: topic }),

  dismiss: (topic) => {
    set({ topics: get().topics.filter((t) => t.id !== topic.id), fresh: get().fresh.filter((id) => id !== topic.id) });
    dismissTopic(topic.id)
      .catch(() => {})
      .then(() => get().refresh());
  },
}));

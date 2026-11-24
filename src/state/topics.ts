// The topics on offer, and the one the listener picked. Kept here so the Listen, Length and
// Building screens can share them without passing data through the address bar.
import { create } from 'zustand';

import { dismissTopic, listTopics, proposeTopics, refillTopics, type Topic } from '@/lib/api';

type TopicsState = {
  topics: Topic[];
  loading: boolean;
  error: string | null;
  selected: Topic | null;
  /** True while the server is preparing more topics to fill the Listen screen. */
  refilling: boolean;
  /** True when the last attempt to prepare topics went wrong, so the screen can offer to try again. */
  stuck: boolean;
  load: () => Promise<void>;
  topUp: () => Promise<void>;
  select: (topic: Topic) => void;
  /** "Not interested": removes a topic at once, tells the server, and makes room for another. */
  dismiss: (topic: Topic) => void;
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How many topics the Listen screen shows, and so how many are kept waiting. */
export const WAITING = 3;

export const useTopics = create<TopicsState>((set, get) => ({
  topics: [],
  loading: false,
  error: null,
  selected: null,
  refilling: false,
  stuck: false,

  // Keeps three topics waiting. Each one the server prepares takes about a minute and costs
  // a few cents, so this runs one at a time and stops as soon as three are ready.
  topUp: async () => {
    if (get().refilling) return;
    set({ refilling: true, stuck: false });
    try {
      // Each topic takes two steps, planning and finishing, so there are more rounds than topics.
      // The server decides when enough is ready: one story from this person's own interests,
      // with stories made for others filling the rest of the screen.
      // It runs until the server says nothing more is on its way, for a quarter of an hour at most.
      // A step that fails is tried again after a pause: the server cuts off a long step now and
      // then, and a phone that was asleep loses its connection. Three failures in a row end it.
      const until = Date.now() + 15 * 60 * 1000;
      let misses = 0;
      while (Date.now() < until) {
        try {
          const asked = Date.now();
          // First the choosing, which learns from the verdicts and swipes. Then the next step of preparing.
          await proposeTopics();
          const { prepared, working } = await refillTopics();
          misses = 0;
          if (prepared) set({ topics: await listTopics() });
          else if (!working) break;
          // An answer that came straight back means something is under way elsewhere. Give it a moment.
          else if (Date.now() - asked < 4000) await pause(5000);
        } catch (err) {
          if (++misses >= 3) throw err;
          await pause(5000);
        }
      }
      // Nothing to show and nothing on its way means it did not work.
      if (get().topics.length === 0) set({ stuck: true });
    } catch {
      // The topics already shown still work. With none to show, the screen offers to try again.
      set({ stuck: get().topics.length === 0 });
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
  dismiss: (topic) => {
    set({ topics: get().topics.filter((t) => t.id !== topic.id) });
    dismissTopic(topic.id)
      .catch(() => {})
      .then(() => get().topUp());
  },
}));

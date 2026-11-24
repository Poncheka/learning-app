// Everything the listener has started, shared by the Library and the playlists inside it, and the
// "Play all" queue: the stories still to come after the one playing.
import { create } from 'zustand';

import { hideLesson, listLessons, type LessonSummary, sendSignal } from '@/lib/api';
import { usePlayer } from '@/state/player';

type LibraryState = {
  lessons: LessonSummary[] | null;
  error: string | null;
  load: () => void;
  /** Gone from the lists at once. The server is told, and keeps the audio. */
  remove: (lesson: LessonSummary) => void;
  /** Takes back a thumbs up. The story stays in the Library and leaves the Liked playlist. */
  unlike: (lesson: LessonSummary) => void;
};

export const useLibrary = create<LibraryState>((set, get) => ({
  lessons: null,
  error: null,
  load: () => {
    set({ error: null });
    listLessons()
      .then((lessons) => set({ lessons }))
      .catch((err) => set({ error: err instanceof Error ? err.message : 'Your stories could not be loaded.' }));
  },
  remove: (lesson) => {
    set({ lessons: (get().lessons ?? []).filter((l) => l.id !== lesson.id) });
    hideLesson(lesson.id).catch(() => get().load());
  },
  unlike: (lesson) => {
    set({ lessons: (get().lessons ?? []).map((l) => (l.id === lesson.id ? { ...l, liked: false } : l)) });
    sendSignal('cleared', lesson.id);
  },
}));

export const EVERYTHING = 'Everything';
export const LIKED = 'Liked';
export const OFF_THE_MAP = 'Off the map';

/** Which playlist a story sits in besides Everything and Liked: its interest, or Off the map. */
export const shelfOf = (lesson: LessonSummary) => (lesson.tag && lesson.tag !== OFF_THE_MAP ? lesson.tag : OFF_THE_MAP);

export const inPlaylist = (lesson: LessonSummary, name: string) => (name === EVERYTHING ? true : name === LIKED ? Boolean(lesson.liked) : shelfOf(lesson) === name);

// ---------- Play all ----------

let upNext: LessonSummary[] = [];

/** True while "Play all" has another story lined up, so the wrap screen is skipped between them. */
export const hasNext = () => upNext.length > 0;

/** Plays a playlist back to back: stories part heard first, then the rest in the order shown. */
export function playAll(list: LessonSummary[]) {
  const ordered = [...list.filter((l) => !l.finished && l.left_minutes), ...list.filter((l) => l.finished || !l.left_minutes)];
  if (ordered.length === 0) return;
  upNext = ordered.slice(1);
  usePlayer.getState().resume(ordered[0]);
}

/** Choosing a single story to play ends any "Play all" under way. */
export function playOne(lesson: LessonSummary) {
  upNext = [];
  usePlayer.getState().resume(lesson);
}

// When a story ends and another is lined up, it starts after the closing sound has had a moment.
usePlayer.subscribe((now, before) => {
  if (now.phase !== 'finished' || before.phase === 'finished' || upNext.length === 0) return;
  const next = upNext[0];
  upNext = upNext.slice(1);
  setTimeout(() => usePlayer.getState().resume(next), 2500);
});

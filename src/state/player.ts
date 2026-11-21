// The lesson player. One lesson plays at a time, as a queue of chapters.
//
// The queue is the phone's own audio queue (an expo-audio playlist), not a timer in this
// code. That matters for the lock screen: moving from one chapter to the next is done by
// iOS itself, so it keeps working while the screen is off.
//
// Chapters are queued one ahead of the listener. Queuing a chapter is also what asks the
// server to make it, so an abandoned lesson costs only what was heard plus one chapter.
import { createAudioPlaylist, setAudioModeAsync, type AudioPlaylist, type AudioPlaylistStatus } from 'expo-audio';
import { create } from 'zustand';

import { MOCK, chapterAudioUrl, getLesson, startLesson, type Lesson, type LessonSummary, type Topic } from '@/lib/api';

export const RATES = [0.8, 0.9, 1, 1.1, 1.25] as const;

type Phase = 'idle' | 'starting' | 'playing' | 'finished' | 'error';

type PlayerState = {
  phase: Phase;
  topic: Topic | null;
  minutes: number;
  lesson: Lesson | null;
  /** The chapter being heard, counting from zero. */
  index: number;
  /** How many chapters are in the queue so far. Chapters past this are not made yet. */
  queued: number;
  playing: boolean;
  buffering: boolean;
  /** Seconds into the current chapter, and its length once the phone knows it. */
  time: number;
  duration: number;
  /** Real lengths of chapters already heard, so the progress bar firms up as the lesson goes. */
  durations: Record<number, number>;
  rate: number;
  error: string | null;
  begin: (topic: Topic, minutes: number) => Promise<void>;
  /** Plays a lesson from the Library again. Chapters already made are free to replay. */
  resume: (summary: LessonSummary) => Promise<void>;
  toggle: () => void;
  seekBy: (seconds: number) => void;
  jumpTo: (index: number) => void;
  cycleRate: () => void;
  /** Ends the lesson early: the audio stops and the Finished screen takes over. */
  finish: () => void;
  stop: () => void;
};

let playlist: AudioPlaylist | null = null;
let subscriptions: { remove: () => void }[] = [];
let mockClock: ReturnType<typeof setInterval> | null = null;
// Each lesson gets a number. Late answers from an abandoned lesson are ignored by checking it.
let run = 0;

const idle = {
  phase: 'idle' as Phase,
  topic: null,
  minutes: 0,
  lesson: null,
  index: 0,
  queued: 0,
  playing: false,
  buffering: false,
  time: 0,
  duration: 0,
  durations: {},
  error: null,
};

function teardown() {
  for (const subscription of subscriptions) subscription.remove();
  subscriptions = [];
  if (mockClock) clearInterval(mockClock);
  mockClock = null;
  if (playlist) {
    try {
      playlist.clearLockScreenControls();
      playlist.destroy();
    } catch {
      // Already gone.
    }
  }
  playlist = null;
}

export const usePlayer = create<PlayerState>((set, get) => {
  const showOnLockScreen = (index: number, first: boolean) => {
    const { lesson } = get();
    if (!playlist || !lesson) return;
    const metadata = { title: lesson.segments[index].title, artist: 'Pliny', albumTitle: lesson.title };
    if (first) playlist.setActiveForLockScreen(true, metadata, { showSeekBackward: true, showSeekForward: true });
    else playlist.updateLockScreenMetadata(metadata);
  };

  /** Keeps the queue one chapter ahead of the one being heard. */
  const queueAhead = (index: number) => {
    const { lesson, queued } = get();
    if (!lesson) return;
    const wanted = Math.min(lesson.segments.length, index + 2);
    for (let position = queued + 1; position <= wanted; position++) {
      playlist?.add({ uri: chapterAudioUrl(lesson.id, position) });
    }
    if (wanted > queued) set({ queued: wanted });
  };

  const onStatus = (status: AudioPlaylistStatus) => {
    const { phase, lesson, index } = get();
    if (!lesson) return;
    const duration = Number.isFinite(status.duration) && status.duration > 0 ? status.duration : 0;
    set({ playing: status.playing, buffering: status.isBuffering, time: status.currentTime || 0, duration });
    if (phase === 'starting' && status.playing && status.currentTime > 0) set({ phase: 'playing' });
    if (status.didJustFinish && index === lesson.segments.length - 1) set({ phase: 'finished', playing: false });
  };

  const onTrack = ({ currentIndex, previousIndex }: { currentIndex: number; previousIndex: number }) => {
    const { duration, durations } = get();
    set({
      index: currentIndex,
      time: 0,
      duration: 0,
      durations: duration > 0 && previousIndex >= 0 ? { ...durations, [previousIndex]: duration } : durations,
    });
    showOnLockScreen(currentIndex, false);
    queueAhead(currentIndex);
  };

  /** Mock mode: a silent clock that behaves like the real queue, for working on screens. */
  const startMockClock = () => {
    set({ phase: 'playing', playing: true });
    mockClock = setInterval(() => {
      const { lesson, index, time, playing, rate } = get();
      if (!lesson || !playing) return;
      const length = lesson.segments[index].target_minutes * 60;
      if (time + 0.5 * rate < length) return set({ time: time + 0.5 * rate, duration: length });
      if (index === lesson.segments.length - 1) return set({ phase: 'finished', playing: false });
      onTrack({ currentIndex: index + 1, previousIndex: index });
    }, 500);
  };

  /** Gets a lesson from the server and starts playing it from its first chapter. */
  const launch = async (topic: Topic, minutes: number, fetchLesson: () => Promise<Lesson>) => {
    teardown();
    const mine = ++run;
    set({ ...idle, phase: 'starting', topic, minutes });
    try {
      const lesson = await fetchLesson();
      if (mine !== run) return;
      set({ lesson, queued: Math.min(2, lesson.segments.length) });
      if (MOCK) {
        // A short pause, so the Building screen can be seen while working on it.
        setTimeout(() => mine === run && startMockClock(), 1500);
        return;
      }

      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' });
      if (mine !== run) return;
      // The opening and the chapter after it are queued at once: the opening is already
      // written, so the server can start on the next chapter while the opening plays.
      playlist = createAudioPlaylist({
        sources: lesson.segments.slice(0, 2).map((s) => ({ uri: chapterAudioUrl(lesson.id, s.position) })),
        updateInterval: 500,
      });
      playlist.playbackRate = get().rate;
      subscriptions = [playlist.addListener('playlistStatusUpdate', onStatus), playlist.addListener('trackChanged', onTrack)];
      showOnLockScreen(0, true);
      playlist.play();
    } catch (err) {
      if (mine !== run) return;
      teardown();
      set({ phase: 'error', error: err instanceof Error ? err.message : 'Something went wrong starting the lesson.' });
    }
  };

  return {
    ...idle,
    rate: 1,

    begin: (topic, minutes) => launch(topic, minutes, () => startLesson(topic.id, minutes)),

    resume: (summary) =>
      launch({ id: summary.id, title: summary.title, hook: '', chapters: [], max_minutes: summary.chosen_minutes }, summary.chosen_minutes, () => getLesson(summary.id)),

    toggle: () => {
      const { playing } = get();
      if (MOCK) return set({ playing: !playing });
      if (playing) playlist?.pause();
      else playlist?.play();
    },

    seekBy: (seconds) => {
      const { time, duration, lesson, index } = get();
      if (!lesson) return;
      const length = duration || lesson.segments[index].target_minutes * 60;
      const target = Math.max(0, Math.min(time + seconds, length - 1));
      if (MOCK) return set({ time: target });
      // A chapter that is still arriving cannot always be searched. If the phone refuses, stay put.
      playlist?.seekTo(target).catch(() => {});
    },

    jumpTo: (index) => {
      const { queued, lesson, index: current } = get();
      if (!lesson || index === current || index >= queued) return;
      if (MOCK) return onTrack({ currentIndex: index, previousIndex: current });
      playlist?.skipTo(index);
      playlist?.play();
    },

    cycleRate: () => {
      const next = RATES[(RATES.indexOf(get().rate as (typeof RATES)[number]) + 1) % RATES.length];
      if (playlist) playlist.playbackRate = next;
      set({ rate: next });
    },

    finish: () => {
      playlist?.pause();
      set({ phase: 'finished', playing: false });
    },

    stop: () => {
      run++;
      teardown();
      set({ ...idle });
    },
  };
});

/** How far into the whole lesson the listener is, in seconds, and how long the lesson is. */
export function lessonProgress(state: Pick<PlayerState, 'lesson' | 'index' | 'time' | 'duration' | 'durations'>) {
  const { lesson, index, time, duration, durations } = state;
  if (!lesson) return { elapsed: 0, total: 0 };
  // A chapter's real length is used once known. Until then, its planned length stands in.
  const length = (i: number) => durations[i] ?? (i === index && duration > 0 ? duration : lesson.segments[i].target_minutes * 60);
  let elapsed = time;
  let total = 0;
  lesson.segments.forEach((_, i) => {
    total += length(i);
    if (i < index) elapsed += length(i);
  });
  return { elapsed: Math.min(elapsed, total), total };
}

export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

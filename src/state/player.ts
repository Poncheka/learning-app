// The lesson player. One lesson plays at a time, as a queue of chapters.
//
// The queue is the phone's own audio queue (an expo-audio playlist), not a timer in this
// code. That matters for the lock screen: moving from one chapter to the next is done by
// iOS itself, so it keeps working while the screen is off.
//
// A short sting of music sits in the queue between the opening and the chapter after it.
// The two are recorded separately and the voice can shift a little between them, so the
// sting gives the ear a clean break, the way a podcast's intro music does.
//
// Chapters are queued one ahead of the listener, and the server is asked to make the next
// chapter as soon as the current one begins. That head start is what lets the next chapter
// begin the instant this one ends. An abandoned lesson costs what was heard plus one chapter.
import { Asset } from 'expo-asset';
import { createAudioPlaylist, setAudioModeAsync, setIsAudioActiveAsync, type AudioPlaylist, type AudioPlaylistStatus } from 'expo-audio';
import { create } from 'zustand';

import { useTopics } from '@/state/topics';
import { MOCK, chapterAudioUrl, getLesson, prewarmChapter, startLesson, type Lesson, type LessonSummary, type Topic } from '@/lib/api';

const STING = require('../../assets/audio/sting.mp3') as number;

export const RATES = [0.8, 0.9, 1, 1.1, 1.25] as const;

type Phase = 'idle' | 'starting' | 'playing' | 'finished' | 'error';

type PlayerState = {
  phase: Phase;
  topic: Topic | null;
  minutes: number;
  lesson: Lesson | null;
  /** The chapter being heard, counting from zero. */
  index: number;
  /** How many chapters are in the queue so far. */
  queued: number;
  /**
   * Which chapters are fully made and saved, by chapter number counting from zero. Only
   * these can be jumped to, skipped forward in or dragged into. Anything else would land
   * the listener on audio that does not exist yet.
   */
  made: boolean[];
  playing: boolean;
  buffering: boolean;
  /** True while the sting is playing, between the opening and the chapter after it. */
  interlude: boolean;
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
  /** Moves to a point in the whole lesson, in seconds. Only audio that has been made can be reached. */
  scrubTo: (seconds: number) => void;
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
// Where to land inside a chapter once the queue has moved to it, after a scrub across chapters.
let pendingSeek: number | null = null;
// Whether the listener means for sound to be playing, and whether the phone ran out of
// audio while they did. Together they let playback pick itself up after a stall.
// Checks every few seconds whether the chapters around the listener have finished being made.
let watch: ReturnType<typeof setInterval> | null = null;
// Whether the closing sting has been put at the end of the queue yet.
let endQueued = false;
// Whether queueing the closing sting has been attempted for this lesson, worked or not.
let endTried = false;
let wantPlaying = false;
let stalled = false;

const idle = {
  phase: 'idle' as Phase,
  topic: null,
  minutes: 0,
  lesson: null,
  index: 0,
  queued: 0,
  made: [] as boolean[],
  playing: false,
  buffering: false,
  interlude: false,
  time: 0,
  duration: 0,
  durations: {},
  error: null,
};

function teardown() {
  pendingSeek = null;
  endQueued = false;
  endTried = false;
  wantPlaying = false;
  stalled = false;
  for (const subscription of subscriptions) subscription.remove();
  subscriptions = [];
  if (mockClock) clearInterval(mockClock);
  mockClock = null;
  if (watch) clearInterval(watch);
  watch = null;
  // Each step is tried on its own. If one fails, the others must still run, or the old
  // lesson would keep playing underneath the next one.
  const old = playlist;
  playlist = null;
  if (old) {
    for (const step of [() => old.pause(), () => old.clearLockScreenControls(), () => old.destroy()]) {
      try {
        step();
      } catch {
        // Already gone.
      }
    }
  }
}

export const usePlayer = create<PlayerState>((set, get) => {
  // The sting is the second item in the queue, so every chapter after the opening sits one
  // place later in the queue than its chapter number. These two translate between them.
  const hasSting = () => !MOCK && (get().lesson?.segments.length ?? 0) > 1;
  const trackOf = (chapter: number) => chapter + (hasSting() && chapter >= 1 ? 1 : 0);

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
    // Once the last chapter is in the queue, the sting goes in after it, to mark the end.
    if (!MOCK && !endQueued && !endTried && Math.max(wanted, queued) >= lesson.segments.length && playlist) {
      // Tried once only. If it fails, the lesson still ends properly, just without the sting.
      endTried = true;
      try {
        // Adding to a running queue needs an address. The bundled file's number only works when the queue is first made.
        playlist.add({ uri: Asset.fromModule(STING).uri });
        endQueued = true;
      } catch (err) {
        console.log('[player] the closing sting could not be queued:', String(err));
      }
    }
    // Start the server on the chapter after this one now, minutes before it is needed.
    if (!MOCK && index + 2 <= lesson.segments.length) prewarmChapter(lesson.id, index + 2);
  };

  const onStatus = (status: AudioPlaylistStatus) => {
    const { phase, lesson, index } = get();
    if (!lesson) return;
    // If the phone ran dry waiting for audio, iOS pauses and stays paused. When the audio
    // has arrived and the listener never asked to pause, carry on without making them tap.
    if (status.playing) stalled = false;
    else if (status.isBuffering) stalled = true;
    else if (stalled && wantPlaying && !status.didJustFinish) {
      stalled = false;
      playlist?.play();
    }
    // During the sting, or for a late report about a chapter already left, only note
    // whether sound is playing. The clock belongs to the chapter on screen.
    const onSting = hasSting() && status.currentIndex === 1;
    if (onSting || status.currentIndex !== trackOf(index)) {
      return set({ playing: status.playing, buffering: onSting ? false : status.isBuffering });
    }
    const duration = Number.isFinite(status.duration) && status.duration > 0 ? status.duration : 0;
    set({ playing: status.playing, buffering: status.isBuffering, time: status.currentTime || 0, duration });
    if (phase === 'starting' && status.playing && status.currentTime > 0) set({ phase: 'playing' });
    // With no closing sting queued, the end of the last chapter is the end of the lesson.
    if (!endQueued && status.didJustFinish && index === lesson.segments.length - 1 && status.currentIndex === trackOf(index)) set({ phase: 'finished', playing: false });
  };

  const onTrack = ({ currentIndex, previousIndex }: { currentIndex: number; previousIndex: number }) => {
    const { duration, durations, interlude } = get();
    const sting = hasSting();
    const ending = get().lesson;
    // Past the last chapter there is only the closing sting. The lesson is over: the wrap
    // screen comes up while the sting plays out.
    if (ending && currentIndex > trackOf(ending.segments.length - 1)) {
      wantPlaying = false;
      set({ phase: 'finished', durations: duration > 0 ? { ...durations, [ending.segments.length - 1]: duration } : durations });
      return;
    }
    // The chapter just left, if it was a chapter. Its real length is now known.
    const left = sting && previousIndex === 1 ? -1 : sting && previousIndex > 1 ? previousIndex - 1 : previousIndex;
    const learned = !interlude && left >= 0 && duration > 0 ? { ...durations, [left]: duration } : durations;
    if (sting && currentIndex === 1) {
      // The sting has begun. The screen already shows the chapter it leads into.
      set({ interlude: true, index: 1, time: 0, duration: 0, durations: learned });
      showOnLockScreen(1, false);
      queueAhead(1);
      return;
    }
    const chapter = sting && currentIndex > 1 ? currentIndex - 1 : currentIndex;
    const land = pendingSeek;
    pendingSeek = null;
    set({ interlude: false, index: chapter, time: land ?? 0, duration: 0, durations: learned });
    if (land) playlist?.seekTo(land).catch(() => {});
    showOnLockScreen(chapter, false);
    queueAhead(chapter);
  };

  /** Asks the server which chapters are finished, while the ones near the listener are not. */
  const watchMade = () => {
    watch = setInterval(() => {
      const { lesson, index, made, phase } = get();
      if (!lesson || (phase !== 'playing' && phase !== 'starting')) return;
      const near = [index, index + 1].filter((i) => i < lesson.segments.length);
      if (near.every((i) => made[i])) return;
      getLesson(lesson.id)
        .then((fresh) => {
          const now = get();
          if (now.lesson?.id !== fresh.id) return;
          // A chapter once made stays made, whatever a late answer says.
          set({ made: fresh.segments.map((s, i) => now.made[i] || s.status === 'ready') });
        })
        .catch(() => {});
    }, 5000);
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
      // Pretend the server keeps one chapter ahead, so the locked look can be seen.
      set({ made: lesson.segments.map((_, i) => i <= index + 2) });
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
      set({
        lesson,
        queued: Math.min(2, lesson.segments.length),
        made: lesson.segments.map((s, i) => (MOCK ? i < 2 : s.status === 'ready')),
      });
      if (MOCK) {
        // A short pause, so the Building screen can be seen while working on it.
        setTimeout(() => mine === run && startMockClock(), 1500);
        return;
      }

      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' });
      if (mine !== run) return;
      // The opening and the chapter after it are queued at once: the opening is already
      // written, so the server can start on the next chapter while the opening plays.
      const first = lesson.segments.slice(0, 2).map((s) => ({ uri: chapterAudioUrl(lesson.id, s.position) }));
      // A two chapter lesson is all in the queue from the start, so its closing sting goes in now.
      endQueued = lesson.segments.length === 2;
      playlist = createAudioPlaylist({
        sources: first.length > 1 ? [first[0], STING, first[1], ...(endQueued ? [STING] : [])] : first,
        updateInterval: 500,
      });
      playlist.playbackRate = get().rate;
      subscriptions = [playlist.addListener('playlistStatusUpdate', onStatus), playlist.addListener('trackChanged', onTrack)];
      showOnLockScreen(0, true);
      wantPlaying = true;
      playlist.play();
      // The chapter after the opening is made while the opening plays, so it is ready
      // and waiting when the sting ends.
      if (lesson.segments.length > 1) prewarmChapter(lesson.id, 2);
      watchMade();
    } catch (err) {
      if (mine !== run) return;
      teardown();
      set({ phase: 'error', error: err instanceof Error ? err.message : 'Something went wrong starting the lesson.' });
    }
  };

  return {
    ...idle,
    rate: 1,

    begin: (topic, minutes) => {
      const started = launch(topic, minutes, () => startLesson(topic.id, minutes));
      // While this story plays, the next ones are lined up, so the Listen page is not empty
      // when it ends. It waits a little first, so this story's own chapters get a head start.
      setTimeout(() => {
        const shelf = useTopics.getState();
        useTopics.setState({ topics: shelf.topics.filter((t) => t.id !== topic.id) });
        shelf.topUp();
      }, 15000);
      return started;
    },

    resume: (summary) => {
      // Already loaded: carry on with it. Starting it again would stack a second copy on top.
      const { lesson, phase } = get();
      if (lesson?.id === summary.id && (phase === 'playing' || phase === 'starting')) {
        if (phase === 'playing' && !get().playing) get().toggle();
        return Promise.resolve();
      }
      return launch({ id: summary.id, title: summary.title, hook: '', chapters: [], max_minutes: summary.chosen_minutes }, summary.chosen_minutes, () => getLesson(summary.id));
    },

    toggle: () => {
      const { playing } = get();
      if (MOCK) return set({ playing: !playing });
      if (!playlist) return;
      // Go by what the phone is really doing, not by what the screen last heard.
      const sounding = playlist.playing;
      wantPlaying = !sounding;
      if (sounding) return playlist.pause();
      // Headphones coming out, or a call, can leave the phone's audio switched off. Switch
      // it back on first, so play works and the sound goes to whatever is connected now.
      const current = playlist;
      // Dictation or another app can also take the sound over and change how it is set up, so that is set again too.
      setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' })
        .catch(() => {})
        .then(() => setIsAudioActiveAsync(true))
        .catch(() => {})
        .then(() => current === playlist && current.play());
    },

    seekBy: (seconds) => {
      const { time, duration, lesson, index, interlude, made } = get();
      if (!lesson || interlude) return;
      // Forward only through audio that is finished. Back is always fine: it has been heard.
      if (seconds > 0 && !made[index]) return;
      const length = duration || lesson.segments[index].target_minutes * 60;
      const target = Math.max(0, Math.min(time + seconds, length - 1));
      if (MOCK) return set({ time: target });
      // A chapter that is still arriving cannot always be searched. If the phone refuses, stay put.
      playlist?.seekTo(target).catch(() => {});
    },

    jumpTo: (index) => {
      const { queued, lesson, index: current, made } = get();
      if (!lesson || index === current || index >= queued) return;
      // Earlier chapters have been heard. Later ones must be finished first.
      if (index > current && !made[index]) return;
      if (MOCK) return onTrack({ currentIndex: index, previousIndex: current });
      wantPlaying = true;
      playlist?.skipTo(trackOf(index));
      playlist?.play();
    },

    scrubTo: (seconds) => {
      const state = get();
      const { lesson, queued, index } = state;
      if (!lesson) return;
      // Walk the chapters to find which one holds that moment, and how far into it.
      let chapter = 0;
      let offset = Math.max(0, seconds);
      while (chapter < lesson.segments.length - 1 && offset >= chapterLength(state, chapter)) {
        offset -= chapterLength(state, chapter);
        chapter++;
      }
      // Forward only into audio that is finished. A drag past that point does nothing.
      const ahead = chapter > index || (chapter === index && offset > state.time);
      if (ahead && (chapter >= queued || !state.made[chapter])) return;
      offset = Math.max(0, Math.min(offset, chapterLength(state, chapter) - 2));
      if (chapter === index && !state.interlude) {
        if (MOCK) return set({ time: offset });
        set({ time: offset });
        playlist?.seekTo(offset).catch(() => {});
        return;
      }
      if (MOCK) {
        onTrack({ currentIndex: chapter, previousIndex: index });
        return set({ time: offset });
      }
      pendingSeek = offset;
      wantPlaying = true;
      playlist?.skipTo(trackOf(chapter));
      playlist?.play();
    },

    cycleRate: () => {
      const next = RATES[(RATES.indexOf(get().rate as (typeof RATES)[number]) + 1) % RATES.length];
      if (playlist) playlist.playbackRate = next;
      set({ rate: next });
    },

    finish: () => {
      wantPlaying = false;
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

type Timing = Pick<PlayerState, 'lesson' | 'index' | 'duration' | 'durations'>;

/** A chapter's real length once known. Until then, its planned length stands in. */
function chapterLength({ lesson, index, duration, durations }: Timing, i: number): number {
  return durations[i] ?? (i === index && duration > 0 ? duration : (lesson?.segments[i].target_minutes ?? 0) * 60);
}

/**
 * How far into the whole lesson the listener can go right now, in seconds: the end of the
 * last finished chapter in an unbroken run from where they are, or just where they are.
 */
export function reachable(state: Pick<PlayerState, 'lesson' | 'index' | 'time' | 'duration' | 'durations' | 'made' | 'queued'>): number {
  const { lesson, index, time, made, queued } = state;
  if (!lesson) return 0;
  let seconds = 0;
  for (let i = 0; i < index; i++) seconds += chapterLength(state, i);
  if (!made[index]) return seconds + time;
  for (let i = index; i < lesson.segments.length && i < queued && made[i]; i++) seconds += chapterLength(state, i);
  return seconds;
}

/** How far into the whole lesson the listener is, in seconds, and how long the lesson is. */
export function lessonProgress(state: Pick<PlayerState, 'lesson' | 'index' | 'time' | 'duration' | 'durations'>) {
  const { lesson, index, time } = state;
  if (!lesson) return { elapsed: 0, total: 0 };
  const length = (i: number) => chapterLength(state, i);
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

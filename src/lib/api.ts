// Everything the app asks of the server goes through here. Two edge functions answer:
// "lesson" for anything that makes a lesson, and "shelf" for the small free jobs around them.
// The app holds only the publishable key. The OpenAI key never leaves Supabase.
import { accessToken } from '@/lib/supabase';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '';

// With EXPO_PUBLIC_MOCK=1 the app runs on made-up data and a silent clock, so the screens
// can be worked on without preparing topics or spending anything.
export const MOCK = process.env.EXPO_PUBLIC_MOCK === '1';

export type Topic = {
  id: string;
  title: string;
  hook: string;
  chapters: string[];
  max_minutes: number;
  /** How long the whole story runs. Shorter lessons leave out some middle chapters. */
  recommended_minutes?: number | null;
  /** True when it was made from this person's interests. False for a shared story filling the screen. */
  for_you?: boolean;
  /** The interest this topic grew out of. "Off the map" marks a wildcard. */
  tag?: string | null;
};

export type Segment = {
  position: number;
  title: string;
  target_minutes: number;
  status: 'planned' | 'writing' | 'voicing' | 'ready' | 'failed';
  /** The sound of the recording: a digit per slice of time, 0 silent to 9 loud. Empty or missing when not known. */
  shape?: string | null;
  /** How long the recording runs. */
  seconds?: number | null;
};

export type Lesson = {
  id: string;
  title: string;
  chosen_minutes: number;
  segments: Segment[];
};

// "prepare" and "chapter" are the lesson function under two more names. The long jobs go to them, so
// each starts on a server worker of its own and is not cut off by one that is nearly out of time.
async function call<T>(body: Record<string, unknown>, fn: 'lesson' | 'shelf' | 'prepare' | 'chapter' = 'lesson'): Promise<T> {
  if (!URL || !KEY) throw new Error('The app is missing its Supabase address or key. Check the .env file.');
  // The signed-in person's pass rides along, so the server knows whose request this is.
  const token = await accessToken();
  const res = await fetch(`${URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
  return data as T;
}

export type LessonSummary = {
  id: string;
  title: string;
  chosen_minutes: number;
  started_at: string;
  /** How many chapters the lesson has, and how many of them have been made so far. */
  chapters: number;
  made: number;
  /** The interest this lesson grew out of. Lessons made before tags were recorded have none. */
  tag: string | null;
  /** True when the listener gave it a thumbs up. */
  liked?: boolean;
  /** True once it has been heard to the end. */
  finished?: boolean;
  /** About how many minutes are left to hear. Null when finished, or when it was played before this was recorded. */
  left_minutes?: number | null;
  /** The chapter last reached, counting from 1. */
  heard_position?: number | null;
};

/** Tells the server which chapter the listener has reached, so History can show what is left. */
export function reportHeard(lessonId: string, position: number, finished: boolean): void {
  if (MOCK) return;
  call({ action: 'heard', lesson_id: lessonId, position, finished }, 'shelf').catch(() => {});
}

export type Tag = { id: string; label: string };
export type Interests = { interests: Tag[]; suggestions: string[]; max: number };

/** Today's allowance of new stories: how many have been made, the most, and when the next one opens once used up. */
export type Limit = { made_today: number; per_day: number; opens_at: string | null };

export async function listTopics(): Promise<{ topics: Topic[]; limit?: Limit }> {
  if (MOCK) return { topics: mockTopics };
  return await call<{ topics: Topic[]; limit?: Limit }>({ action: 'topics' });
}

export async function startLesson(topicId: string, minutes: number): Promise<Lesson> {
  if (MOCK) return mockLesson(topicId, minutes);
  return await call<Lesson>({ action: 'start', topic_id: topicId, minutes });
}

/**
 * Asks the server to do the next step toward keeping three topics waiting. A topic takes two
 * steps of about a minute each, planning it and then finishing it, and costs a few cents.
 * `prepared` is set when a step finished a topic. `working` says whether to call again.
 */
export async function refillTopics(): Promise<{ ready: number; prepared: Topic | null; working?: boolean }> {
  if (MOCK) return { ready: mockTopics.length, prepared: null, working: false };
  return await call({ action: 'refill' }, 'prepare');
}

/**
 * The learning loop. Asks the server to think up the next topics from the tags and from
 * what was loved, turned down and swiped away. One short, cheap request, and it does
 * nothing while enough topics are already waiting.
 */
export async function proposeTopics(): Promise<void> {
  if (MOCK) return;
  await call({ action: 'propose' }, 'shelf');
}

/**
 * Asks the server to make a chapter now, ahead of the listener, so it is saved and ready
 * the moment the player reaches it. Safe to call for a chapter that is already made or
 * already being made: it is only ever made once.
 */
export function prewarmChapter(lessonId: string, position: number): void {
  if (MOCK) return;
  // Written first, then recorded, as two requests: together they can run longer than the server allows one to.
  call({ action: 'script', lesson_id: lessonId, position }, 'chapter')
    .catch(() => {})
    .then(() => call({ action: 'segment', lesson_id: lessonId, position }, 'chapter'))
    .catch(() => {});
}

/** The interest a lesson grew out of, for showing small on the Chapters screen. */
export async function lessonTag(lessonId: string): Promise<string | null> {
  if (MOCK) return 'Nepal';
  return (await call<{ tag: string | null }>({ action: 'tag', lesson_id: lessonId }, 'shelf')).tag;
}

export type Narrator = { id: string; name: string; note: string };
export type Voice = { voice: string; narrators: Narrator[] };

const mockVoice: Voice = {
  voice: 'cedar',
  narrators: [
    { id: 'cedar', name: 'Cedar', note: "A man's voice. Warm and unhurried." },
    { id: 'marin', name: 'Marin', note: "A woman's voice. Warm and unhurried." },
    { id: 'ash', name: 'Ash', note: "A man's voice. A little brighter." },
    { id: 'coral', name: 'Coral', note: "A woman's voice. A little brighter." },
  ],
};

/** Who reads the lessons, and who else could. */
export async function getVoice(): Promise<Voice> {
  if (MOCK) return { ...mockVoice };
  return await call<Voice>({ action: 'voice' }, 'shelf');
}

/** Changes the narrator for everything recorded from now on. */
export async function setVoice(voice: string): Promise<Voice> {
  if (MOCK) {
    mockVoice.voice = voice;
    return { ...mockVoice };
  }
  return await call<Voice>({ action: 'set_voice', voice }, 'shelf');
}

export async function listLessons(): Promise<LessonSummary[]> {
  if (MOCK) return mockLessons;
  return (await call<{ lessons: LessonSummary[] }>({ action: 'lessons' }, 'shelf')).lessons;
}

/** Takes a lesson off the Library. Its audio is kept on the server. */
export async function hideLesson(id: string): Promise<void> {
  if (MOCK) return;
  await call({ action: 'hide_lesson', lesson_id: id }, 'shelf');
}

/** "Not interested": takes a topic off the Listen screen for good. */
/** An idea for a story, on offer in Explore. Nothing has been made from it yet. */
/** `ready` marks a story that is already finished: picking it puts it on Listen at once. */
export type Idea = { id: string; title: string; tag: string | null; ready?: boolean };
export type Ideas = { ideas: Idea[]; tags?: string[]; in_queue?: number; opens_at?: string | null; queued_today: number; per_day: number; waiting: number; waiting_limit: number; preparing: number };

export async function listIdeas(): Promise<Ideas> {
  if (MOCK) return { ideas: [], queued_today: 0, per_day: 10, waiting: 0, waiting_limit: 3, preparing: 0 };
  return await call({ action: 'ideas' }, 'shelf');
}

/** Asks for a story to be made from an idea. It starts at once if there is room, and otherwise takes its turn in the queue. */
/** Fills a new person's Explore with ideas right away, rather than a few a minute. */
export function stockExplore(): void {
  if (MOCK) return;
  call({ action: 'stock' }, 'shelf').catch(() => {});
}

/** Interests with the most finished, best liked stories behind them, for someone signing up. */
export async function popularInterests(): Promise<string[]> {
  if (MOCK) return [];
  return ((await call({ action: 'popular_interests' }, 'shelf')) as { interests: string[] }).interests ?? [];
}

export async function queueIdea(id: string): Promise<{ starts: boolean; ready?: boolean; used_up?: boolean; opens_at?: string | null; per_day?: number; ahead: number; in_queue?: number }> {
  if (MOCK) return { starts: true, ahead: 0 };
  return await call({ action: 'queue', topic_id: id }, 'shelf');
}

export async function dismissIdea(id: string): Promise<void> {
  if (MOCK) return;
  await call({ action: 'dismiss_idea', topic_id: id }, 'shelf');
}

export async function dismissTopic(id: string): Promise<void> {
  if (MOCK) return;
  await call({ action: 'dismiss_topic', topic_id: id }, 'shelf');
}

export type Signal = 'thumbs_up' | 'thumbs_down' | 'loved' | 'not_for_me' | 'cleared';

/**
 * Saves a thumbs up or down. It is sent quietly: if it fails, the lesson carries on.
 * The server reads them back when it chooses the next topics.
 */
export function sendSignal(type: Signal, lessonId: string | undefined, position?: number): void {
  if (MOCK || !lessonId) return;
  call({ action: 'signal', type, lesson_id: lessonId, position }, 'shelf').catch(() => {});
}

export async function getLesson(id: string): Promise<Lesson> {
  if (MOCK) return mockLesson('mock-1', mockLessons.find((l) => l.id === id)?.chosen_minutes ?? 15);
  return await call<Lesson>({ action: 'get', lesson_id: id });
}

export async function getInterests(): Promise<Interests> {
  if (MOCK) return mockInterests();
  return await call<Interests>({ action: 'interests' });
}

export async function addInterest(label: string): Promise<Interests> {
  if (MOCK) {
    if (!mockTags.some((t) => t.label.toLowerCase() === label.toLowerCase())) mockTags.push({ id: `tag-${label}`, label });
    return mockInterests();
  }
  return await call<Interests>({ action: 'add_interest', label });
}

/** Saves a new person's first picks in one request. */
export async function addInterests(labels: string[]): Promise<Interests> {
  if (MOCK) {
    for (const label of labels) if (!mockTags.some((t) => t.label.toLowerCase() === label.toLowerCase())) mockTags.push({ id: `tag-${label}`, label });
    return mockInterests();
  }
  return await call<Interests>({ action: 'add_interests', labels });
}

export async function removeInterest(id: string): Promise<Interests> {
  if (MOCK) {
    mockTags = mockTags.filter((t) => t.id !== id);
    return mockInterests();
  }
  return await call<Interests>({ action: 'remove_interest', id });
}

/**
 * Where a chapter's audio comes from. If the chapter is already made this leads to the saved
 * file. If not, the server makes it and sends the audio while it is still being generated.
 */
export function chapterAudioUrl(lessonId: string, position: number): string {
  return `${URL}/functions/v1/lesson?lesson_id=${lessonId}&position=${position}&apikey=${encodeURIComponent(KEY)}`;
}

// ---------- Made-up data for mock mode ----------

const mockTopics: Topic[] = [
  { id: 'mock-1', title: 'Kathmandu, 1800 to 1900', hook: 'A valley kingdom that shut its doors for a century.', chapters: [], max_minutes: 18, recommended_minutes: 18, tag: 'Nepal' },
  { id: 'mock-2', title: 'How the Erie Canal got built', hook: 'Amateurs dug 363 miles and changed a continent.', chapters: [], max_minutes: 31, recommended_minutes: 31, tag: 'Canals' },
  { id: 'mock-3', title: 'The printing press, invented', hook: 'A goldsmith, a wine press and a lawsuit.', chapters: [], max_minutes: 60 },
];

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const mockLessons: LessonSummary[] = [
  { id: 'mock-a', title: 'Kathmandu, 1800 to 1900', chosen_minutes: 30, started_at: daysAgo(0), chapters: 6, made: 2, tag: 'Nepal' },
  { id: 'mock-b', title: 'The Silk Road at its peak', chosen_minutes: 60, started_at: daysAgo(1), chapters: 11, made: 11, tag: 'Trade routes' },
  { id: 'mock-c', title: 'How vaccines were found', chosen_minutes: 15, started_at: daysAgo(4), chapters: 4, made: 4, tag: 'History of science' },
  { id: 'mock-d', title: 'The Roman aqueducts', chosen_minutes: 30, started_at: daysAgo(9), chapters: 6, made: 6, tag: null },
];

let mockTags: Tag[] = ['Nepal', 'Trade routes', 'History of science', 'Canals', 'Medieval Europe', 'Printing'].map((label) => ({ id: `tag-${label}`, label }));
const mockInterests = (): Interests => ({
  interests: [...mockTags],
  suggestions: ['Himalayan trade', 'Gutenberg', 'Erie Canal', 'Byzantine Empire'].filter((s) => !mockTags.some((t) => t.label === s)),
  max: 10,
});

const mockChapters = ['A valley city in 1800', 'The Rana takeover', 'Trade, temples and treaties', 'Britain at the border', 'Daily life', 'A century in review', 'What came next', 'The long view', 'Loose ends', 'One more thing', 'Coda'];

function mockLesson(topicId: string, minutes: number): Lesson {
  const rest = minutes - 1;
  const count = Math.ceil(rest / 3);
  const base = Math.floor(rest / count);
  let extra = rest - base * count;
  const lengths = [1, ...Array.from({ length: count }, () => base + (extra-- > 0 ? 1 : 0))];
  return {
    id: 'mock-lesson',
    title: mockTopics.find((t) => t.id === topicId)?.title ?? 'A lesson',
    chosen_minutes: minutes,
    segments: lengths.map((target_minutes, i) => ({ position: i + 1, title: mockChapters[i], target_minutes, status: 'planned' })),
  };
}

// ---------- Profile ----------

export type Profile = { first_name: string | null; avatar_url: string | null };

/** The listener's first name and picture. */
export async function getProfile(): Promise<Profile> {
  if (MOCK) return { first_name: 'Jeff', avatar_url: null };
  return await call<Profile>({ action: 'profile' }, 'shelf');
}

/** Saves a new first name. */
export async function setFirstName(firstName: string): Promise<Profile> {
  if (MOCK) return { first_name: firstName, avatar_url: null };
  return await call<Profile>({ action: 'set_profile', first_name: firstName }, 'shelf');
}

/** Uploads a picture from the phone and makes it the listener's profile picture. */
export async function setAvatar(localUri: string): Promise<Profile> {
  if (MOCK) return { first_name: 'Jeff', avatar_url: localUri };
  const { path, url } = await call<{ path: string; url: string }>({ action: 'avatar_upload' }, 'shelf');
  const picture = await (await fetch(localUri)).blob();
  const sent = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: picture });
  if (!sent.ok) throw new Error('The picture could not be uploaded. Try again.');
  return await call<Profile>({ action: 'set_profile', avatar_path: path }, 'shelf');
}

// ---------- Sharing ----------

export type Shared = { url: string; code: string; show_name: boolean; finishing: boolean; art: number };

/**
 * A public link to a story on itspliny.com. Asked for as soon as a story is open, so the share sheet
 * shows it at once. `sent` marks it passed on, which is when a story not finished yet starts being finished.
 */
export async function shareLesson(lessonId: string, showName = true, sent = false): Promise<Shared> {
  if (MOCK) return { url: 'https://itspliny.com/s/a-story?r=abc234', code: 'abc234', show_name: showName, finishing: false, art: 6 };
  return await call<Shared>({ action: 'share', lesson_id: lessonId, show_name: showName, sent }, 'shelf');
}

const ready = new Map<string, Promise<Shared>>();
/** Gets a story's link ready in the background. Free: nothing is made until the link is sent. */
export function prepareShare(lessonId: string): Promise<Shared> {
  let asked = ready.get(lessonId);
  if (!asked) {
    asked = shareLesson(lessonId);
    asked.catch(() => ready.delete(lessonId));
    ready.set(lessonId, asked);
  }
  return asked;
}

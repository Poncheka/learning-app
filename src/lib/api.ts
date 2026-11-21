// Everything the app asks of the server goes through here: one edge function, "lesson".
// The app holds only the publishable key. The OpenAI key never leaves Supabase.
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
};

export type Segment = {
  position: number;
  title: string;
  target_minutes: number;
  status: 'planned' | 'writing' | 'voicing' | 'ready' | 'failed';
};

export type Lesson = {
  id: string;
  title: string;
  chosen_minutes: number;
  segments: Segment[];
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!URL || !KEY) throw new Error('The app is missing its Supabase address or key. Check the .env file.');
  const res = await fetch(`${URL}/functions/v1/lesson`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY },
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
};

export type Tag = { id: string; label: string };
export type Interests = { interests: Tag[]; suggestions: string[]; max: number };

export async function listTopics(): Promise<Topic[]> {
  if (MOCK) return mockTopics;
  return (await call<{ topics: Topic[] }>({ action: 'topics' })).topics;
}

export async function startLesson(topicId: string, minutes: number): Promise<Lesson> {
  if (MOCK) return mockLesson(topicId, minutes);
  return await call<Lesson>({ action: 'start', topic_id: topicId, minutes });
}

/**
 * Asks the server to top up the waiting topics. Each call proposes and prepares at most one,
 * which takes about a minute and costs a few cents. It does nothing if three are waiting.
 */
export async function refillTopics(): Promise<{ ready: number; prepared: Topic | null }> {
  if (MOCK) return { ready: mockTopics.length, prepared: null };
  return await call({ action: 'refill' });
}

export async function listLessons(): Promise<LessonSummary[]> {
  if (MOCK) return mockLessons;
  return (await call<{ lessons: LessonSummary[] }>({ action: 'lessons' })).lessons;
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
  { id: 'mock-1', title: 'Kathmandu, 1800 to 1900', hook: 'A valley kingdom that shut its doors for a century.', chapters: [], max_minutes: 60 },
  { id: 'mock-2', title: 'How the Erie Canal got built', hook: 'Amateurs dug 363 miles and changed a continent.', chapters: [], max_minutes: 60 },
  { id: 'mock-3', title: 'The printing press, invented', hook: 'A goldsmith, a wine press and a lawsuit.', chapters: [], max_minutes: 60 },
];

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const mockLessons: LessonSummary[] = [
  { id: 'mock-a', title: 'Kathmandu, 1800 to 1900', chosen_minutes: 30, started_at: daysAgo(0), chapters: 6, made: 2 },
  { id: 'mock-b', title: 'The Silk Road at its peak', chosen_minutes: 60, started_at: daysAgo(1), chapters: 11, made: 11 },
  { id: 'mock-c', title: 'How vaccines were found', chosen_minutes: 15, started_at: daysAgo(4), chapters: 4, made: 4 },
  { id: 'mock-d', title: 'The Roman aqueducts', chosen_minutes: 30, started_at: daysAgo(9), chapters: 6, made: 6 },
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
  const count = Math.ceil(rest / 6);
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

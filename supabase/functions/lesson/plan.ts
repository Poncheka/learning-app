// The parts of lesson planning that are plain arithmetic, kept apart from anything that
// talks to a model or the database so they can be tested on their own.
// Tested by scripts/test-plan.mjs.

/** One chapter of a story plan. The opening is the first. The payoff is the last. */
export type Chapter = {
  title: string;
  /** One line on what the chapter is for. Older plans have only this. */
  brief: string;
  fact_ids: number[];
  /** How long it should run, two to four minutes. Missing on plans made before blueprints. */
  minutes?: number;
  /** For middle chapters: 1 the story needs it, 2 strong but optional, 3 first to go. */
  priority?: number;
  situation?: string;
  development?: string;
  discovery?: string;
  turn?: string;
  matters?: string;
  transition?: string;
  tone?: string;
  /** Which earlier chapters this one cannot be understood without, as chapter numbers from 1. */
  needs?: number[];
  /** The chapter's essential beat in a sentence or two, for folding into a neighbor when it is not played. */
  short?: string;
  /** Engine 2: what happens in the chapter, in order, each weighted and tied to its notes. */
  beats?: { beat: string; weight: string; fact_ids: number[] }[];
  /** Engine 2: how the chapter ends, and what its last line lands on. */
  ending?: string;
  ending_note?: string;
};

const SHORTEST = 2;
const LONGEST = 4;

/** Older plans: a one minute opening, then chapters of two or three minutes that fill the time. */
export function chapterLengths(minutes: number, per = 3): number[] {
  if (minutes <= 2) return [minutes];
  const rest = minutes - 1;
  const count = Math.ceil(rest / per);
  const base = Math.floor(rest / count);
  let extra = rest - base * count;
  return [1, ...Array.from({ length: count }, () => base + (extra-- > 0 ? 1 : 0))];
}

/** True when every chapter after the opening says how long it should run. */
export function isBlueprint(outline: Chapter[]): boolean {
  return outline.length > 1 && outline.slice(1).every((c) => Number.isFinite(Number(c.minutes)) && Number(c.minutes) > 0);
}

/**
 * How long a chapter runs: two to four minutes. The first chapter of an older plan was a
 * one minute opening with no length of its own, and still counts as one minute.
 */
export function minutesOf(outline: Chapter[], i: number): number {
  if (i === 0) return Math.max(1, Math.min(LONGEST, Math.round(Number(outline[0].minutes) || 1)));
  return Math.max(SHORTEST, Math.min(LONGEST, Math.round(Number(outline[i].minutes) || 3)));
}

/** The whole story, start to finish, in minutes. A lesson is never padded past this. */
export function fullMinutes(outline: Chapter[]): number {
  return outline.reduce((sum, _, i) => sum + minutesOf(outline, i), 0);
}

/** Every earlier chapter a chapter depends on, directly or through another, counting from zero. */
export function dependencies(outline: Chapter[], i: number): number[] {
  const found = new Set<number>();
  const walk = (k: number) => {
    for (const number of outline[k].needs ?? []) {
      const j = Math.round(Number(number)) - 1;
      // A chapter can only depend on one that comes before it.
      if (!Number.isInteger(j) || j < 0 || j >= k || found.has(j)) continue;
      found.add(j);
      walk(j);
    }
  };
  walk(i);
  return [...found].sort((a, b) => a - b);
}

/**
 * Chooses the chapters for a lesson of the length asked for, keeping the story's chain of
 * cause and effect intact.
 *
 * The first chapter and the last, the payoff, are always in. Next come the chapters the
 * payoff depends on, so the ending makes sense. Then optional chapters by priority, each
 * brought in together with whatever it depends on, or not at all. What is chosen plays in
 * the story's own order.
 *
 * When there is no time for a chapter that a kept chapter depends on, it is not simply
 * dropped: it becomes a bridge. The kept chapter is told to fold that beat in, in a
 * sentence or two, so a short lesson is a compressed story and not one with a hole in it.
 * `bridges` lists, for each kept chapter, the chapters it has to carry that way.
 *
 * The lesson may come out shorter than asked: time is a ceiling, never a quota.
 */
export function pickChapters(outline: Chapter[], minutes: number): { picked: number[]; lengths: number[]; bridges: number[][] } {
  if (!isBlueprint(outline)) {
    const lengths = chapterLengths(minutes).slice(0, outline.length);
    return { picked: lengths.map((_, i) => i), lengths, bridges: lengths.map(() => []) };
  }
  const last = outline.length - 1;
  const chosen = new Set<number>([0, last]);
  let total = minutesOf(outline, 0) + (last > 0 ? minutesOf(outline, last) : 0);
  const cost = (group: number[]) => group.reduce((sum, i) => sum + minutesOf(outline, i), 0);
  const take = (group: number[]) => {
    const fresh = group.filter((i) => !chosen.has(i));
    if (total + cost(fresh) > minutes) return;
    for (const i of fresh) chosen.add(i);
    total += cost(fresh);
  };

  // What the ending needs comes first, earliest first, each with what it needs in turn.
  for (const i of dependencies(outline, last)) take([...dependencies(outline, i), i]);
  // Then the rest of the middle, most needed first.
  const priority = (i: number) => Math.max(1, Math.min(3, Math.round(Number(outline[i].priority) || 2)));
  const middle = Array.from({ length: Math.max(0, last - 1) }, (_, k) => k + 1).filter((i) => !chosen.has(i));
  middle.sort((a, b) => priority(a) - priority(b) || a - b);
  for (const i of middle) take([...dependencies(outline, i), i]);

  const picked = [...chosen].sort((a, b) => a - b);
  // Each missing beat is carried once, by the first kept chapter that depends on it.
  const carried = new Set<number>();
  const bridges = picked.map((i) => {
    const missing = dependencies(outline, i).filter((j) => !chosen.has(j) && !carried.has(j));
    for (const j of missing) carried.add(j);
    return missing;
  });
  return { picked, lengths: picked.map((i) => minutesOf(outline, i)), bridges };
}

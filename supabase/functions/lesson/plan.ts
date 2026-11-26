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
  beats?: { beat: string; weight: string; fact_ids: number[]; essential?: boolean | number }[];
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

// ---------- Tellings that keep the story's heart, within the old budget ----------
//
// pickChapters above keeps or drops whole chapters. With almost every chapter planned at the same
// priority, a shorter telling kept the earliest chapters that fitted and could drop the story's most
// important moment. tellStory chooses beat by beat instead, inside a hard budget: it never uses more
// minutes or more chapters than the previous engine did for the same story at the same length, and
// never more than the length asked for. Within that budget it takes the story's ranked moments in
// order, the one the story turns on first, and lets lesser moments go entirely. A moment whose own
// chapter has no room is folded into the next chapter that plays, still weighted, but folding never
// brings along extra material just to keep more facts.

export type Beat = { beat: string; weight: string; fact_ids: number[]; essential?: boolean | number };

/**
 * The one exception to the four minute ceiling on a chapter: one that carries moments folded in from
 * chapters that do not play on their own may run to five.
 */
export const FOLDED_LONGEST = 5;
/** How a chapter's planned minutes are shared among its beats: roughly 90, 30 and 10 seconds. */
const SHARE: Record<string, number> = { signature: 3, supporting: 1, connective: 0.3 };
/** The least time a moment is given when it has to be told tightly. */
export const ESSENTIAL_FLOOR = 1;

/** True when any beat in the plan says whether it is essential, so the plan's own choice is used. */
export function marksEssential(outline: Chapter[]): boolean {
  return outline.some((c) => (c.beats ?? []).some((b) => ["boolean", "number"].includes(typeof (b as Beat).essential)));
}

/**
 * How important a moment is: 1 is the moment the story turns on, then 2, 3 and so on. Null for a beat
 * that is not one of the story's essential moments. Plans may number them. Plans that only say true,
 * and older plans that say nothing, are ranked by place: the plan was asked to escalate, each chapter
 * more extraordinary than the last, so later moments come first. Older plans count the first signature
 * beat of each chapter they called part of the spine (priority 1) as essential.
 */
export function essentialRank(outline: Chapter[], i: number, k: number): number | null {
  const beat = (outline[i].beats ?? [])[k] as Beat | undefined;
  if (!beat || beat.weight !== "signature") return null;
  const byPlace = 100 + (outline.length - i);
  if (marksEssential(outline)) {
    if (typeof beat.essential === "number" && beat.essential >= 1) return Math.round(beat.essential);
    return beat.essential === true ? byPlace : null;
  }
  const priority = Math.round(Number(outline[i].priority) || 2);
  if (priority !== 1 && i !== 0 && i !== outline.length - 1) return null;
  // The last chapter's signature beats are how the story resolves, so in older plans each of them counts.
  // They follow the chapter before the last, so the climax that leads into the ending is kept first.
  if (i === outline.length - 1 && (outline[i].beats ?? []).findIndex((b) => b.weight === "signature") !== k) return byPlace + 1.5;
  return (outline[i].beats ?? []).findIndex((b) => b.weight === "signature") === k ? byPlace : null;
}

export const isEssential = (outline: Chapter[], i: number, k: number) => essentialRank(outline, i, k) !== null;

/** One chapter of a telling, with the beats it tells. */
export type Told = {
  /** The chapter's place in the plan, counting from zero. */
  chapter: number;
  minutes: number;
  /** In the order they are told. A beat folded in from another chapter carries that chapter's number in `from`. */
  beats: (Beat & { essential: boolean; from?: number })[];
  /** True when some of the chapter's own beats are left out, or told more tightly than planned. */
  compressed: boolean;
  /** Chapters folded into this one whose moments it carries. */
  folded: number[];
  /** Chapters left out that this one depends on: their one or two sentence summary is worked in. */
  bridges: number[];
};

/** True when the plan has beats to work with. Older plans are chosen whole chapter by whole chapter. */
export function hasBeats(outline: Chapter[]): boolean {
  return isBlueprint(outline) && outline.slice(1).every((c) => (c.beats ?? []).length > 0);
}

/**
 * The previous engine's telling, kept exactly: whole chapters by pickChapters, then any minutes left
 * over given to chapters that carry summaries of left-out ones, up to five minutes. Its minutes and
 * its number of chapters are the budget the new choice must stay within.
 */
export function previousTelling(outline: Chapter[], minutes: number): { picked: number[]; lengths: number[]; bridges: number[][] } {
  const { picked, lengths, bridges } = pickChapters(outline, minutes);
  const out = [...lengths];
  let spare = Math.round(minutes) - out.reduce((sum, m) => sum + m, 0);
  for (let k = out.length - 1; k >= 1 && spare > 0; k--) {
    const room = Math.min(spare, bridges[k].length, 5 - out[k]);
    if (room > 0) {
      out[k] += room;
      spare -= room;
    }
  }
  return { picked, lengths: out, bridges };
}

/**
 * Chooses what a telling plays. Never more minutes or chapters than the previous engine used for the
 * same story and length, and never more than the length asked for. Where the previous engine played
 * the plan's second chapter untouched, so does this, so a second chapter already written ahead is used
 * as it is and nothing is written again.
 */
export function tellStory(outline: Chapter[], minutes: number): { told: Told[]; total: number; over: boolean } {
  const last = outline.length - 1;
  const prev = previousTelling(outline, minutes);
  const budget = Math.min(Math.floor(minutes), prev.lengths.reduce((sum, m) => sum + m, 0));
  const slots = prev.picked.length;
  const full = (i: number, k: number) => {
    const list = outline[i].beats ?? [];
    const shares = list.reduce((sum, b) => sum + (SHARE[b.weight] ?? 1), 0) || 1;
    return (minutesOf(outline, i) * (SHARE[list[k].weight] ?? 1)) / shares;
  };
  const plain = (i: number, k: number) => ({ ...((outline[i].beats ?? [])[k] as Beat), essential: isEssential(outline, i, k) });

  // The whole story fits: it is played as planned.
  if (prev.picked.length === outline.length) {
    const told = outline.map((c, i) => ({ chapter: i, minutes: minutesOf(outline, i), beats: (c.beats ?? []).map((_, k) => plain(i, k)), compressed: false, folded: [], bridges: [] }));
    return { told, total: fullMinutes(outline), over: false };
  }

  // The previous engine played the plan's second chapter whole, and the third after it. That stays, so
  // the second chapter written ahead of time is used, and nothing already written is written again.
  const lockSecond = prev.picked[1] === 1 && prev.bridges[1].length === 0 && prev.lengths[1] === minutesOf(outline, 1) && (prev.picked[2] === 2 || outline.length === 2);

  // What is kept: for each beat, the minutes it is given, or nothing. Which chapters play on their own.
  const cost: (number | null)[][] = outline.map((c) => (c.beats ?? []).map(() => null));
  const playing = new Set<number>([0, last]);
  const home = (i: number) => [...playing].filter((c) => c >= i).sort((a, b) => a - b)[0];
  const exact = (c: number) => {
    let sum = 0;
    for (let i = 0; i <= c; i++) if (home(i) === c) cost[i].forEach((x) => (sum += x ?? 0));
    return sum;
  };
  const whole = (c: number) => cost[c].every((x, k) => x !== null && Math.abs(x - full(c, k)) < 1e-9) && !carries(c);
  const carries = (c: number) => outline.some((_, i) => i < c && !playing.has(i) && home(i) === c && cost[i].some((x) => x !== null));
  const length = (c: number) => (c === 0 || (lockSecond && c === 1) || whole(c) ? minutesOf(outline, c) : Math.max(1, Math.round(exact(c))));
  const total = () => [...playing].reduce((sum, c) => sum + length(c), 0);
  const fits = () =>
    total() <= budget &&
    playing.size <= slots &&
    [...playing].every((c) => c === 0 || (lockSecond && c === 1) || exact(c) <= (carries(c) ? FOLDED_LONGEST : 4) + 1e-9);

  // The opening, in full. The payoff, the last chapter's final beat, told tightly to begin with.
  (outline[0].beats ?? []).forEach((_, k) => (cost[0][k] = full(0, k)));
  const payoff = (outline[last].beats ?? []).length - 1;
  if (payoff >= 0) cost[last][payoff] = Math.min(full(last, payoff), ESSENTIAL_FLOOR);
  if (lockSecond && last > 1) {
    playing.add(1);
    (outline[1].beats ?? []).forEach((_, k) => (cost[1][k] = full(1, k)));
    if (last > 2) {
      playing.add(2);
      const list = outline[2].beats ?? [];
      const ranked = list.map((_, k) => k).filter((k) => isEssential(outline, 2, k));
      const first = ranked[0] ?? list.findIndex((b) => b.weight === "signature");
      const k = first >= 0 ? first : 0;
      if (list.length) cost[2][k] = Math.min(full(2, k), ESSENTIAL_FLOOR);
    }
  }

  // Tries a change. Kept only if everything still fits.
  const attempt = (change: () => () => void) => {
    const undo = change();
    if (fits()) return true;
    undo();
    return false;
  };
  const addBeat = (i: number, k: number, minutesGiven: number) => {
    // Its own chapter if there is a free one; otherwise folded into the next chapter that plays.
    if (!playing.has(i) && attempt(() => {
      playing.add(i);
      cost[i][k] = minutesGiven;
      return () => {
        playing.delete(i);
        cost[i][k] = null;
      };
    })) return true;
    return attempt(() => {
      const before = cost[i][k];
      cost[i][k] = minutesGiven;
      return () => (cost[i][k] = before);
    });
  };

  // 1. The story's ranked moments, the one it turns on first, each told in full before the next is
  //    taken: depth before breadth. A moment that will not fit in full is told tightly if that fits,
  //    and one that does not fit at all is let go. A shorter telling is narrower, not a list of highlights.
  const moments = outline
    .flatMap((c, i) => (c.beats ?? []).map((_, k) => ({ i, k, rank: essentialRank(outline, i, k) })))
    .filter((m) => m.i > 0 && m.rank !== null && cost[m.i][m.k] === null && !(m.i === last && m.k === payoff))
    .sort((a, b) => (a.rank as number) - (b.rank as number) || b.i - a.i || a.k - b.k);
  for (const m of moments) {
    if (!addBeat(m.i, m.k, Math.min(full(m.i, m.k), ESSENTIAL_FLOOR))) continue;
    attempt(() => {
      const before = cost[m.i][m.k];
      cost[m.i][m.k] = full(m.i, m.k);
      return () => (cost[m.i][m.k] = before);
    });
  }

  // 2. With time left, the kept moments and the payoff are told in full, the most important first.
  const rankOf = (i: number, k: number) => essentialRank(outline, i, k) ?? (i === last && k === payoff ? 0 : 999);
  const kept = () => outline.flatMap((c, i) => (c.beats ?? []).map((_, k) => ({ i, k }))).filter(({ i, k }) => i > 0 && cost[i][k] !== null);
  for (const { i, k } of kept().sort((a, b) => rankOf(a.i, a.k) - rankOf(b.i, b.k))) {
    if ((cost[i][k] as number) >= full(i, k)) continue;
    attempt(() => {
      const before = cost[i][k];
      cost[i][k] = full(i, k);
      return () => (cost[i][k] = before);
    });
  }

  // 3. Then the beats around them, but only in chapters that play on their own: a folded chapter brings
  //    its moment and nothing more. Supporting beats nearest a kept moment first, then other signature
  //    beats, then background lines.
  const order = outline.flatMap((c, i) => (c.beats ?? []).map((_, k) => ({ i, k })));
  const place = (i: number, k: number) => order.findIndex((x) => x.i === i && x.k === k);
  const distance = (i: number, k: number) => {
    const marks = kept().filter((x) => x.i > 0 && (isEssential(outline, x.i, x.k) || (x.i === last && x.k === payoff))).map((x) => place(x.i, x.k));
    return marks.length ? Math.min(...marks.map((at) => Math.abs(at - place(i, k)))) : place(i, k);
  };
  const weightOrder: Record<string, number> = { supporting: 0, signature: 1, connective: 2 };
  for (;;) {
    const choices = order
      .filter(({ i, k }) => i > 0 && playing.has(i) && cost[i][k] === null)
      .sort((a, b) => (weightOrder[outline[a.i].beats![a.k].weight] ?? 0) - (weightOrder[outline[b.i].beats![b.k].weight] ?? 0) || distance(a.i, a.k) - distance(b.i, b.k) || b.i - a.i || a.k - b.k);
    let added = false;
    for (const { i, k } of choices) {
      if (attempt(() => {
        cost[i][k] = full(i, k);
        return () => (cost[i][k] = null);
      })) {
        added = true;
        break;
      }
    }
    if (!added) break;
  }

  // Each left-out chapter that a played one depends on is summarized once, by the first that needs it.
  const told: Told[] = [];
  const summarized = new Set<number>();
  for (const c of [...playing].sort((a, b) => a - b)) {
    const folded = outline.map((_, i) => i).filter((i) => i < c && !playing.has(i) && home(i) === c && cost[i].some((x) => x !== null));
    const needed = [...new Set([...folded, c].flatMap((x) => dependencies(outline, x)))].sort((a, b) => a - b);
    const bridges = needed.filter((j) => !playing.has(j) && !folded.includes(j) && !summarized.has(j));
    // A chapter already folded into an earlier one has been heard, so it is not summarized again.
    for (const j of [...bridges, ...folded]) summarized.add(j);
    const own = (outline[c].beats ?? []).flatMap((_, k) => (cost[c][k] !== null ? [plain(c, k)] : []));
    const brought = folded.flatMap((j) => (outline[j].beats ?? []).flatMap((_, k) => (cost[j][k] !== null ? [{ ...plain(j, k), from: j }] : [])));
    told.push({ chapter: c, minutes: length(c), beats: [...brought, ...own], compressed: c !== 0 && !(lockSecond && c === 1) && !whole(c), folded, bridges });
  }
  const sum = told.reduce((s, t) => s + t.minutes, 0);
  return { told, total: sum, over: sum > minutes };
}

// ---------- Revisions ----------

/**
 * Whether a revision replaces the draft. Length is not a reason to refuse one: a revision that cut
 * repetition or padding is better for being shorter. Only a revision that lost most of the chapter,
 * which is a broken reply rather than an edit, is refused, unless the draft was far too long.
 */
export function keepRevision(o: { draftWords: number; revisedWords: number; overLong: boolean }): boolean {
  if (o.revisedWords <= 0) return false;
  return o.overLong || o.revisedWords >= o.draftWords * 0.5;
}

/**
 * Whether a fact correction replaces the revision. Untrue claims must go, so a correction is
 * refused only when it lost most of the chapter, a sign the reply broke. Then the revision stands
 * and the unresolved claims are put on record.
 */
export function keepCorrection(o: { revisedWords: number; correctedWords: number }): boolean {
  return o.correctedWords > 0 && o.correctedWords >= o.revisedWords * 0.5;
}

// ---------- The story's premise, as the Story Editor may revise it ----------

const PREMISE = ["central_curiosity", "promise", "final_payoff", "core_fascination"] as const;

/**
 * Applies the Story Editor's revision of the premise. Each field is taken only if it is a real
 * sentence; the mode only if it is one of the two. What it replaced is returned for the record.
 */
export function revisePremise(story: Record<string, unknown>, proposed: unknown): { story: Record<string, unknown>; before: Record<string, unknown> | null } {
  if (!proposed || typeof proposed !== "object") return { story, before: null };
  const given = proposed as Record<string, unknown>;
  const next: Record<string, unknown> = { ...story };
  const before: Record<string, unknown> = {};
  for (const key of PREMISE) {
    const value = typeof given[key] === "string" ? (given[key] as string).trim() : "";
    if (value.length >= 12 && value.length <= 600 && value !== story[key]) {
      before[key] = story[key] ?? null;
      next[key] = value;
    }
  }
  if ((given.mode === "focused" || given.mode === "broad") && given.mode !== story.mode) {
    before.mode = story.mode ?? null;
    next.mode = given.mode;
  }
  return Object.keys(before).length ? { story: next, before } : { story, before: null };
}

// ---------- How fast the narrator reads ----------

/** Words a minute assumed for a voice with too few recordings to measure. */
export const READING_RATE: Record<string, number> = { cedar: 176, ella: 158, marin: 169 };
export const DEFAULT_RATE = 150;

/**
 * A voice's reading speed in words a minute: the median of its recent recordings, when there are at
 * least fifteen, otherwise the measured figure for that voice, otherwise 150. Recordings whose length
 * could not be read properly give speeds far out of range, so the median, not the mean, is used, and
 * the result is held between 120 and 200.
 */
export function readingRate(voice: string, samples: { words: number; seconds: number }[]): number {
  const speeds = samples.filter((s) => s.words > 0 && s.seconds >= 45).map((s) => (s.words * 60) / s.seconds).sort((a, b) => a - b);
  const fallback = READING_RATE[voice] ?? DEFAULT_RATE;
  if (speeds.length < 15) return fallback;
  const mid = Math.floor(speeds.length / 2);
  const median = speeds.length % 2 ? speeds[mid] : (speeds[mid - 1] + speeds[mid]) / 2;
  return Math.round(Math.max(120, Math.min(200, median)));
}

// ---------- One subject, many titles ----------

const SUBJECT_STOPWORDS = new Set(["the", "a", "an", "of", "and", "in", "on", "at", "to", "for", "by", "with", "from", "s"]);
/** The words that name a subject, plain and singular, so "Defenestrations of Prague" matches "Defenestration of Prague". */
export function subjectWords(subject: unknown): Set<string> {
  const plain = String(subject ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ");
  return new Set(plain.split(" ").filter((w) => w && !SUBJECT_STOPWORDS.has(w)).map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)));
}
/**
 * True when two subjects are the same story under different wording: the same words, or every word of
 * a two-word-or-longer subject inside the other ("Great Stalacpipe Organ" and "the Great Stalacpipe Organ in
 * Luray Caverns"). Compares what a story is about, not its headline, so "Animal trial" catches both the
 * rats and the pig. Single words must match exactly, so "Yule" does not swallow "Yule log".
 */
export function sameSubject(a: unknown, b: unknown): boolean {
  const x = subjectWords(a), y = subjectWords(b);
  if (x.size === 0 || y.size === 0) return false;
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  if (![...small].every((w) => big.has(w))) return false;
  return small.size >= 2 || small.size === big.size;
}

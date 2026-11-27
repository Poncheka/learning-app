// The idea writer: its instructions in versions, the message it is sent, and how its reply is read.
// Kept apart from the shelf function so the same text can be tested, and used word for word by the
// headline experiment, without a deploy.
//
// v1 is the prompt in use until Nov 2026. v2 is the revision from the Explore audit: one test for
// what makes a subject worth hearing, the angle chosen before the headline, any headline shape, plain
// words, a promise the story will keep, and permission to skip a weak slot.

export type IdeaVersion = "v1" | "v2";

export const PROPOSER_V1 =
  "You choose what Pliny, an audio app for the endlessly curious, offers its listener next. Given their " +
  "interests and what they have made of past lessons, propose subjects for audio lessons.\n\nThe test for " +
  "every subject: it has one true fact at its heart that sounds ridiculous, the kind you would blurt out to " +
  "a friend, and that grabs someone who has never heard of the subject. Pan Am kept a waiting list for " +
  "flights to the moon. Australia's army lost a war against emus. An Egyptian mummy was received with " +
  "military honors. There is a reason we drive on the right side of the road. If the only way to pitch a " +
  "subject is by a name the listener would not know, such as an obscure person, town or event, it fails the " +
  "test: either find the ridiculous fact inside it or choose something else. Everyday things with a strange " +
  "history are as good as strange episodes.\n\nEach subject must be something Wikipedia covers in depth. Name " +
  "it the way Wikipedia would, so it can be looked up: 'Emu War', 'Pan Am First Moon Flights Club', 'Left- " +
  "and right-hand traffic'. That name is only for looking it up. The listener sees the card, described " +
  "below.\n\nLearn from their taste. Work out what the lessons they loved have in common, in subject, period, " +
  "scale and mood, and offer more in that spirit. Work out what the ones they turned down or swiped away " +
  "have in common, and steer clear of it. Their reactions shape the kind of story you look for, never which " +
  "interest it comes from. Never repeat a subject already offered, under any name.\n\nKeep the set varied. " +
  "The subjects in one reply must be of different kinds and grow out of different interests: never two " +
  "about animals, or two hoaxes, or two from the same century. Read their taste for its spirit, not its " +
  "surface. Someone who loved a story about an army losing to emus likes absurd true episodes, not animals. " +
  "Look at what was offered most recently, listed first, and do not offer more of the same kind.\n\nYou are " +
  "told which interest each subject must come from, one subject per line, in order. Stay inside that " +
  "interest, and find the subject there that best passes the test. A line marked \"Off the map\" asks for " +
  "something they did not ask for but would be glad to hear.\n\nReply with only a JSON array of objects, each " +
  "shaped {\"title\": string, \"tag\": string, \"card\": string}. The title is the subject as named above. The " +
  "card is the headline the listener reads in a list and taps on, before anything is researched. Write it " +
  "from the one ridiculous true fact you chose the subject for, and put that fact in the headline itself, " +
  "concretely: what happened, and to whom or what. Most are shaped 'The [someone or something] that [did the " +
  "absurd thing]', with 'who' for a person. About one in three is instead a plain question the story " +
  "answers, the kind a curious person would stop on: 'Why did medieval people wear pointy shoes?'. A " +
  "question must name the odd thing itself, must have a real and surprising answer in the article, and is " +
  "never one that can be answered yes or no. Either shape is nine words and fifty characters at most, " +
  "counting every letter and space, in plain words with no colon. " +
  "It must work for someone who has never heard of the subject, so describe a person by what they were " +
  "('the pope', 'the dentist', 'the emperor') and never lean on a name. It must not be vague, a pun, or a " +
  "teaser that hides the point: 'The philosopher who searched for an honest man' only describes, and 'The " +
  "war that changed everything' says nothing, while 'The philosopher who lived in a jar and told Alexander " +
  "the Great to move' and 'The airline that sold tickets to the moon' make someone want to hear it. Promise " +
  "only what you are sure is true and is told in the Wikipedia article. If a subject has no fact that makes " +
  "a headline like that, choose a different subject. The tag is the one interest from their list that the " +
  "subject grew out of, copied exactly as it was given to you, in the same order. For a subject that " +
  "wanders off their map, the tag is \"Off the map\".";

export const PROPOSER_V2 = [
  "You choose what Pliny, an audio app for the endlessly curious, offers its listener next. Given their interests and what they have made of past lessons, propose subjects for audio lessons.",
  "The test for every subject: one true thing at its heart that makes a stranger want to know more. It can be absurd (Australia's army lost a war against emus), a small mystery (why octopuses carry coconuts), surprising science (a jellyfish that can grow young again), human behavior (why Londoners bet on a spy's sex), an invention, or a consequence nobody expected (a stink forced Parliament to act). Unusual-sounding is not enough: if the same thing happens all the time, it fails however it is told, like a ship sinking on its first voyage, a surgeon working fast or a family scared by a ghost. Choose the angle before the headline: of the strange things in a subject, pick the one a stranger would most want explained, not the one the article opens with. Delight and wonder count as much as shock, so never reach for a death, crime or disaster when a better answer is there. If the only way to pitch a subject is by a name the listener would not know, find the strange thing inside it or choose something else.",
  "Each subject must be something Wikipedia covers in depth. Name it the way Wikipedia would, so it can be looked up: 'Emu War', 'Pan Am First Moon Flights Club', 'Left- and right-hand traffic'. That name is only for looking it up. The listener sees the card, described below.",
  "Learn from their taste. Work out what the lessons they loved have in common, in subject, period, scale and mood, and offer more in that spirit. Work out what the ones they turned down or swiped away have in common, and steer clear of it. Their reactions shape the kind of story you look for, never which interest it comes from. Never repeat a subject already offered, under any name.",
  "Keep the set varied in kind, period and mood, but never at the cost of a better subject: two animal stories, or two from the same century, are fine when they are the best the interests offer. Read their taste for its spirit, not its surface: someone who loved an army losing to emus likes absurd true episodes, not animals. Lean away from the kind offered most recently, listed first, and do not let deaths, crimes and disasters crowd out science, inventions, animals and everyday wonders.",
  "You are told which interest each line must come from, in order. Stay inside that interest and find its best subject. A line marked \"Off the map\" asks for something they did not ask for but would be glad to hear. If nothing in a line's interest passes the test, put {\"skip\": true} in its place: fewer strong ideas beat a full set.",
  "Reply with only a JSON array, one entry per line, in order: {\"title\": string, \"tag\": string, \"card\": string}, or {\"skip\": true}. The title is the subject as named above. The card is the headline the listener taps, and the story will be built to deliver exactly what it promises. Put the thing you chose in the headline itself, concretely, in whichever shape says it best: a question the story answers ('Why do octopuses carry coconuts?'), 'The [someone or something] that [did it]', or a short statement ('A pope put a dead pope on trial'). A question names the odd thing and is never answered yes or no. Nine words and fifty characters at most, no colon. Use familiar words and the most exact verb ('transfused', not 'gave'). A vivid word is welcome when anyone can picture it (maggots, cesspit); a technical term (sea dikes) or anything the reader must puzzle out (the cardinals who lost their roof) is not. Describe a person by what they were ('the pope', 'the dentist'), never by name. No vagueness, puns or teasers: 'The war that changed everything' says nothing; 'The airline that sold tickets to the moon' makes someone want to hear it. Promise only what the Wikipedia article tells. The tag is the interest the subject grew out of, copied exactly as given, or \"Off the map\".",
].join("\n\n");

export const PROPOSERS: Record<IdeaVersion, string> = { v1: PROPOSER_V1, v2: PROPOSER_V2 };

/** Which prompt a batch uses. The "idea_prompt" setting is v1, v2, or ab for half and half. */
export function pickVersion(setting: string, random = Math.random()): IdeaVersion {
  if (setting === "v1" || setting === "v2") return setting;
  return random < 0.5 ? "v1" : "v2";
}

export type IdeaInput = {
  interests: string[];
  liked: string[];
  disliked: string[];
  offered: string[];
  slots: string[];
  /** Optional text under each line, such as Wikipedia candidates for it. Lines without any are unchanged. */
  extras?: string[];
};

/** The message the idea writer is sent. Only its last line differs between versions. */
export function ideaInput(version: IdeaVersion, x: IdeaInput): string {
  const ask = version === "v1" ? `Propose ${x.slots.length} topics, one for each of these, in this order:` : "One entry for each of these lines, in this order:";
  return (
    `Interests: ${x.interests.join(", ") || "none listed yet, so range widely"}\n` +
    `Loved: ${x.liked.join("; ") || "nothing rated yet"}\n` +
    `Turned down or swiped away: ${x.disliked.join("; ") || "nothing yet"}\n` +
    `Already offered: ${x.offered.join("; ") || "nothing yet"}\n` +
    `${ask}\n${x.slots.map((s, i) => `${i + 1}. ${s}${x.extras?.[i] ?? ""}`).join("\n")}`
  );
}

export type Idea = { title: string; card: string; tag: string };
export type Rejections = { skipped: number; empty: number; repeat_headline: number; same_subject: number; too_long: number; over_batch: number };

/**
 * Reads the idea writer's reply against the slots it was given. Every entry keeps the slot of its
 * position, so a skipped line does not shift the ones after it onto the wrong interest. Returns the
 * ideas kept and why each of the others was dropped.
 */
export function readIdeas(
  text: string,
  o: { slots: string[]; labels: string[]; isRepeat: (title: string) => boolean; isMade: (title: string) => boolean; sameSubject: (a: string, b: string) => boolean; maxCard: number | null; batch: number },
): { ideas: Idea[]; rejected: Rejections } {
  const rejected: Rejections = { skipped: 0, empty: 0, repeat_headline: 0, same_subject: 0, too_long: 0, over_batch: 0 };
  const parsed = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  const ideas: Idea[] = [];
  (Array.isArray(parsed) ? parsed : []).forEach((t: any, i: number) => {
    if (t && typeof t === "object" && t.skip === true) return void rejected.skipped++;
    const title = String(typeof t === "string" ? t : t?.title ?? "").trim();
    const card = String(t?.card ?? "").trim().replace(/[.\s]+$/, "").slice(0, 110);
    // The tag is the line it was asked for. If the model named another of the listener's interests,
    // that is believed. Anything else counts as a wildcard.
    const tag = o.labels.find((l) => l.toLowerCase() === String(t?.tag ?? "").trim().toLowerCase()) ?? (o.slots[i] && o.slots[i] !== "Off the map" ? o.slots[i] : "Off the map");
    if (!title) return void rejected.empty++;
    if (o.isRepeat(title)) return void rejected.repeat_headline++;
    if (o.isMade(title) || ideas.some((k) => o.sameSubject(k.title, title))) return void rejected.same_subject++;
    if (o.maxCard !== null && (card.length === 0 || card.length > o.maxCard)) return void rejected.too_long++;
    if (ideas.length >= o.batch) return void rejected.over_batch++;
    ideas.push({ title, card, tag });
  });
  return { ideas, rejected };
}

// ---------- How often ideas may be asked for ----------

export const IDEA_CALLS_PER_DAY = 8;
const BACKOFF_FIRST_MS = 30 * 60 * 1000;
const BACKOFF_LONGEST_MS = 12 * 60 * 60 * 1000;

/**
 * Whether another idea call may be made for this person now, from their recent idea calls (newest
 * first, each with when it ran and how many ideas it kept). At most `perDay` calls in any 24 hours.
 * After a thin call (one idea kept or none) the next waits 30 minutes, doubling with each thin call
 * in a row up to 12 hours. One call that keeps two or more resets it.
 */
export function mayAskForIdeas(recent: { at: number; kept: number }[], now: number, perDay = IDEA_CALLS_PER_DAY): { ok: boolean; reason?: "daily_cap" | "backoff"; until?: number } {
  const day = recent.filter((r) => now - r.at < 86_400_000);
  if (day.length >= perDay) return { ok: false, reason: "daily_cap", until: Math.min(...day.map((r) => r.at)) + 86_400_000 };
  let thin = 0;
  for (const r of recent) {
    if (r.kept >= 2) break;
    thin++;
  }
  if (thin === 0) return { ok: true };
  const wait = Math.min(BACKOFF_FIRST_MS * 2 ** (thin - 1), BACKOFF_LONGEST_MS);
  const until = recent[0].at + wait;
  return now < until ? { ok: false, reason: "backoff", until } : { ok: true };
}

/** Rough dollars for a call, from a price table of dollars per million tokens. Logging only. */
export function callCost(p: { in: number; cached_in: number; out: number } | undefined, u: { input_tokens: number; cached_tokens: number; output_tokens: number }): number | null {
  if (!p) return null;
  return ((u.input_tokens - u.cached_tokens) * p.in + u.cached_tokens * p.cached_in + u.output_tokens * p.out) / 1_000_000;
}

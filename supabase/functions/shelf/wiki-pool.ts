// Wikipedia's "Unusual articles" list as an optional source of Explore subjects. Everything here is
// plain text handling: reading the list, choosing a small balanced pool, and matching it to a
// listener's interests. Nothing here calls a model. Tested by scripts/test-wiki-pool.mjs.
//
// The list's one-line descriptions are Wikipedia text, under CC BY-SA 4.0. They are shown to the idea
// writer only, never to listeners, and every candidate keeps its list page as provenance.

/** The list's subpages read into the pool. Questions, Lists, Categories and Other pages are not articles about one subject. */
export const UNUSUAL_PAGES = [
  "Places and infrastructure",
  "History",
  "Mathematics and numbers",
  "Language",
  "Science",
  "Technology, inventions and products",
  "Popular culture, entertainment and the arts",
  "Food",
  "Sports",
  "Folklore",
  "Society, economy and law",
  "Religion and spirituality",
  "Military",
  "Death",
];

export type Candidate = {
  title: string;
  url: string;
  blurb: string;
  /** The list subpage it came from, such as "History". */
  page: string;
  /** The heading it sits under on that page, such as "19th century" or "Cats". */
  section: string;
};

/** A description as plain text: links become their words, markup and references go. */
export function plainText(wikitext: string): string {
  // Templates can sit inside templates, so they are taken out from the inside until none are left.
  let t = wikitext;
  for (let i = 0; i < 5 && /\{\{[^{}]*\}\}/.test(t); i++) t = t.replace(/\{\{[^{}]*\}\}/g, "");
  return t
    .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[https?:\/\/\S+\s([^\]]*)\]/g, "$1")
    .replace(/'''?/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const articleUrl = (title: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/")}`;

/**
 * Reads one subpage of the list. Each entry is a table row: the article's bold link, then its one-line
 * description. Images, commented-out lines and anything else are skipped.
 */
export function parseUnusual(wikitext: string, page: string): Candidate[] {
  const found: Candidate[] = [];
  let section = page;
  let pending: { title: string; section: string } | null = null;
  for (const raw of wikitext.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const line = raw.trim();
    const heading = line.match(/^={2,5}\s*(.*?)\s*={2,5}$/);
    if (heading) {
      section = plainText(heading[1]) || page;
      pending = null;
      continue;
    }
    if (!line.startsWith("|") || line.startsWith("|-") || line.startsWith("|}")) continue;
    // A cell's own attributes, such as width="30%", come before a single bar.
    const cell = line.slice(1).replace(/^\s*[a-z]+="[^"]*"\s*\|(?!\|)/i, "").trim();
    const title = cell.match(/'''\s*\[\[([^|\]#]+)(?:#[^|\]]*)?(?:\|[^\]]*)?\]\]\s*'''/);
    if (title) {
      pending = { title: title[1].trim(), section };
      continue;
    }
    if (pending) {
      const blurb = plainText(cell);
      if (blurb) found.push({ title: pending.title, url: articleUrl(pending.title), blurb: blurb.slice(0, 240), page, section: pending.section });
      pending = null;
    }
  }
  return found;
}

/** A stable number for a string, so choices that look random are the same every time. */
export function stableHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** Sexual subjects are left out of the pool entirely. The list has a fair number, and none suit Pliny. */
const ADULT = /\b(sex|sexual|sexually|sexuality|porn|porno|pornographic|pornography|erotic|erotica|fetish|fetishism|nude|nudity|naked|genital|genitals|genitalia|penis|penises|vagina|vulva|testicle|testicles|scrotum|foreskin|circumcision|masturbation|masturbate|orgasm|intercourse|prostitute|prostitution|brothel|incest|rape|raped|bdsm|dildo|vibrator|massager|lingerie|pussy|stripper|stripping|intimate|aphrodisiac|condom|condoms|impotence|libido)\b/i;

/** Slurs in a title or description also keep an entry out. */
const SLUR = /nigg|\bfag(got)?s?\b|\bretard(ed|s)?\b|\btrann(y|ies)\b|\bspic(s)?\b|\bchink(s)?\b|\bkike(s)?\b/i;

/** True when a candidate is about a sexual subject, or uses a slur, by its title or description. */
export function isAdult(c: Candidate): boolean {
  return ADULT.test(`${c.title} ${c.blurb}`) || SLUR.test(`${c.title} ${c.blurb}`);
}

/**
 * Chooses the pool: up to `size` candidates, spread evenly over the list's pages, leaving out any
 * subject Pliny already has. Deterministic: the same list and the same subjects give the same pool.
 */
export function choosePool(
  all: Candidate[],
  o: { size: number; made: string[]; sameSubject: (a: string, b: string) => boolean; seed?: string; interests?: string[]; perInterest?: number },
): Candidate[] {
  const seen = new Set<string>();
  const unique = all.filter((c) => {
    const key = c.title.toLowerCase();
    if (seen.has(key) || isAdult(c)) return false;
    seen.add(key);
    return !o.made.some((m) => o.sameSubject(m, c.title));
  });
  const byPage = new Map<string, Candidate[]>();
  for (const c of unique) byPage.set(c.page, [...(byPage.get(c.page) ?? []), c]);
  for (const list of byPage.values()) list.sort((a, b) => stableHash(`${o.seed ?? ""}${a.title}`) - stableHash(`${o.seed ?? ""}${b.title}`));
  const pool: Candidate[] = [];
  const taken = new Set<string>();
  // First, a few for each interest people have chosen, so a specific interest is not left with nothing
  // in a pool drawn at random. Strict matching means some interests get none: they are left to the idea writer.
  for (const interest of o.interests ?? []) {
    const fits = unique
      .filter((c) => !taken.has(c.title) && matchScore(interest, c) >= MATCH)
      .sort((a, b) => stableHash(`${o.seed ?? ""}${a.title}`) - stableHash(`${o.seed ?? ""}${b.title}`))
      .slice(0, o.perInterest ?? 6);
    for (const c of fits) {
      if (pool.length >= Math.floor(o.size / 2)) break;
      pool.push(c);
      taken.add(c.title);
    }
  }
  for (const list of byPage.values()) for (let i = list.length - 1; i >= 0; i--) if (taken.has(list[i].title)) list.splice(i, 1);
  // Then the rest round by round, one from each page, so no page crowds out the rest.
  for (let round = 0; pool.length < o.size; round++) {
    let added = false;
    for (const list of byPage.values()) {
      if (round < list.length && pool.length < o.size) {
        pool.push(list[round]);
        added = true;
      }
    }
    if (!added) break;
  }
  return pool;
}

// ---------- Matching candidates to an interest ----------
//
// Strict on purpose: no suggestion is better than an unrelated one, since the idea writer fills any line
// on its own. An interest is split into alternatives at "and", "&", "/" or a comma ("Money and scams" is
// money or scams). Each alternative's specific words must ALL be found in the entry's title or
// description, through a short list of related words, or in the name of the list section it sits in.
// Broad words such as "history" or "science" never count on their own when an alternative has a specific
// word: "Marine biology" needs something about the sea, and a spider in "Names in biology" does not do.
// An interest made only of broad words ("Weird history") matches its own section of the list.

/** Words that only say how a story should feel. */
const MOOD = new Set(["weird", "strange", "odd", "oddities", "unusual", "bizarre", "curious", "funny", "fun", "amazing", "interesting", "obscure", "forgotten", "hidden", "little", "known"]);
const STOP = new Set(["the", "a", "an", "of", "in", "on", "to", "for", "how", "with", "about", "stories", "story", "things", "stuff", "facts"]);
/** Words that name a whole field. They narrow nothing when a more specific word is present. */
const BROAD = new Set(["history", "historical", "science", "sciences", "biology", "culture", "theories", "theory", "studies", "world"]);
/** Related words, so an entry about a squid counts as marine and one about a seance as occult. */
const RELATED: Record<string, string[]> = {
  marine: ["marine", "seabed", "seafloor", "reef", "coral", "whale", "whales", "shark", "sharks", "octopus", "octopuses", "squid", "jellyfish", "dolphin", "dolphins", "seaweed", "plankton", "starfish", "seahorse"],
  ocean: ["sea", "ocean", "marine", "underwater", "seabed"],
  occult: ["occult", "witch", "witches", "witchcraft", "seance", "séance", "alchemy", "alchemist", "satanic", "satanism", "demon", "demonic", "exorcism", "sorcery", "sorcerer", "tarot", "astrology", "curse", "cursed", "necromancy", "grimoire", "spiritualism", "spiritualist"],
  ghost: ["ghosts", "haunted", "haunting", "poltergeist", "apparition", "spectre", "specter"],
  conspiracy: ["conspiracy", "conspiracies", "hoax", "cover-up", "coverup", "secret", "plot"],
  cults: ["cult", "cults", "sect", "commune", "messiah", "prophet"],
  pseudoscience: ["pseudoscience", "pseudoscientific", "quack", "quackery", "fringe", "paranormal", "psychic"],
  particle: ["particle", "particles", "quantum", "atom", "atomic", "electron", "neutrino", "quark", "proton", "collider", "accelerator", "radiation", "radioactive", "nuclear"],
  physics: ["physics", "physicist", "quantum", "particle", "relativity"],
  space: ["spaceflight", "spacecraft", "spaceship", "astronaut", "astronauts", "cosmonaut", "cosmonauts", "moon", "lunar", "planet", "planets", "satellite", "rocket", "rockets", "nasa", "orbit", "orbital", "comet", "asteroid", "meteorite", "galaxy", "telescope", "astronomer", "astronomy"],
  cooking: ["food", "dish", "recipe", "cook", "cooking", "chef", "cuisine", "soup", "cheese", "cake", "bread", "meat", "restaurant", "sauce", "sandwich", "pie", "eaten", "eating"],
  food: ["food", "dish", "recipe", "cuisine", "soup", "cheese", "cake", "bread", "meat", "restaurant", "eaten", "eating", "drink"],
  inventions: ["invention", "inventions", "inventor", "patent", "patented", "prototype", "contraption", "automaton"],
  invention: ["invention", "inventions", "inventor", "patent", "patented", "prototype", "contraption", "automaton"],
  crime: ["murder", "murdered", "crime", "criminal", "theft", "stolen", "heist", "robbery", "police", "prison", "trial", "convicted", "killer", "kidnapping"],
  scams: ["scam", "scams", "scammer", "fraud", "fraudster", "fraudulent", "swindle", "swindled", "swindler", "ponzi", "counterfeit", "counterfeiter", "forgery", "forger", "embezzlement", "embezzled", "con artist"],
  money: ["money", "banking", "banker", "banknote", "banknotes", "currency", "debt", "bankrupt", "bankruptcy", "financial"],
  medical: ["disease", "surgery", "surgeon", "patient", "doctor", "medical", "medicine", "hospital", "syndrome", "condition", "illness", "epidemic"],
  medicine: ["disease", "surgery", "patient", "doctor", "medical", "medicine", "hospital", "syndrome", "illness"],
  christmas: ["christmas", "santa", "yule", "advent", "reindeer", "nativity"],
  yuletide: ["christmas", "santa", "yule", "advent", "reindeer", "nativity"],
  mysteries: ["mystery", "mysterious", "unexplained", "unsolved", "disappearance", "vanished"],
  unsolved: ["unsolved", "mystery", "mysterious", "unexplained", "disappearance", "vanished", "unknown"],
  founders: ["founder", "founders", "co-founder", "startup", "entrepreneur"],
  startups: ["startup", "start-up", "company", "founder", "entrepreneur"],
  venture: ["venture", "investor", "investors", "startup", "funding"],
  tech: ["technology", "computer", "software", "internet", "app", "digital", "device", "machine"],
};
/** List sections that are about exactly one interest word, beyond those whose own name contains it. */
// Only sections whose every entry is about the interest. Broad pages such as Folklore or Technology are
// left out: most of their entries are about something else.
const SECTIONS: Record<string, string[]> = {
  cooking: ["Food", "Beverages", "Restaurants"],
  food: ["Food", "Beverages", "Restaurants"],
  space: ["Space and astronomy"],
  medical: ["Medicine and health", "Individual patients and staff"],
  medicine: ["Medicine and health", "Individual patients and staff"],
};

const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9à-ÿ\s-]+/g, " ").split(/\s+/).filter(Boolean);
const stem = (w: string) => w.replace(/(ies|es|s)$/, "");
/** An interest's alternatives, each a list of its specific words and a list of its broad ones. */
function alternatives(interest: string): { specific: string[]; broad: string[] }[] {
  return interest
    .split(/\s+and\s+|&|\/|,/i)
    .map((part) => tokens(part).filter((w) => w.length > 2 && !STOP.has(w) && !MOOD.has(w)))
    .filter((ws) => ws.length)
    .map((ws) => ({ specific: ws.filter((w) => !BROAD.has(w)), broad: ws.filter((w) => BROAD.has(w)) }));
}
function wordFits(w: string, title: Set<string>, blurb: Set<string>, place: string): boolean {
  // A word with a list of related words is matched by that list alone, so "ghost" stories do not take
  // "Ghost riding" or a ghost field in physics. Other words are matched as themselves.
  const related = RELATED[w] ?? RELATED[stem(w)] ?? [w];
  // Exact words only: a list that wants plurals names them, so "ghosts" does not bring back "Ghost riding".
  const has = (set: Set<string>, r: string) => set.has(r);
  // In the title once is enough. In the description it takes two different related words, so one passing
  // mention ("weirder than fermented shark") does not make a banana farm marine biology.
  if (related.some((r) => has(title, r))) return true;
  if (new Set(related.filter((r) => has(blurb, r)).map(stem)).size >= 2) return true;
  // The heading the entry sits under, when its name is the word: "Physics" for physics. Only the heading,
  // never the whole page, so "Inventions" takes the inventions at the top of the technology page but not its
  // transport or computing sections.
  if (place.split(/[^a-z]+/).some((p) => p.length > 3 && stem(p) === stem(w))) return true;
  return false;
}

/** The least score that counts as a match. */
export const MATCH = 1;

/**
 * 1 when a candidate fits an interest, 0 when it does not. See the rules above. Kept as a number so a
 * finer score can replace it without changing the callers.
 */
export function matchScore(interest: string, c: Candidate): number {
  const set = (t: string) => new Set(tokens(t).flatMap((x) => [x, stem(x)]));
  const title = set(c.title);
  const blurb = set(c.blurb);
  const place = c.section.toLowerCase();
  const page = c.page.toLowerCase();
  for (const alt of alternatives(interest)) {
    if (alt.specific.length) {
      const fits = alt.specific.every((w) => wordFits(w, title, blurb, place) || (SECTIONS[w] ?? []).some((s) => c.section === s || c.page === s));
      if (fits) return 1;
    } else if (alt.broad.some((w) => `${page} ${place}`.split(/[^a-z]+/).some((p) => p.length > 3 && stem(p) === stem(w)))) {
      // An interest of broad words only, such as "Weird history", takes its whole page of the list.
      return 1;
    }
  }
  return 0;
}

/**
 * Up to `n` candidates for one line of an idea batch. An interest gets its best matches; "Off the
 * map" gets candidates that match none of the listener's interests. Candidates already offered to this
 * listener, already used, or given to another line of the same batch are left out. Ties go to the
 * candidate offered least, then to a stable order, so the same batch is the same every time.
 */
export function candidatesFor(
  line: string,
  pool: (Candidate & { offered?: number })[],
  o: { interests: string[]; n: number; skip: Set<string>; seed: string },
): Candidate[] {
  const open = pool.filter((c) => !o.skip.has(c.title.toLowerCase()));
  const order = (a: Candidate & { offered?: number }, b: Candidate & { offered?: number }) =>
    (a.offered ?? 0) - (b.offered ?? 0) || stableHash(`${o.seed}${a.title}`) - stableHash(`${o.seed}${b.title}`);
  if (line === "Off the map") {
    return open.filter((c) => o.interests.every((i) => matchScore(i, c) < MATCH)).sort(order).slice(0, o.n);
  }
  return open
    .map((c) => ({ c, s: matchScore(line, c) }))
    .filter((x) => x.s >= MATCH)
    .sort((a, b) => order(a.c, b.c))
    .slice(0, o.n)
    .map((x) => x.c);
}

/** The candidates as the idea writer sees them, under the line they belong to. */
export function candidateLines(cands: Candidate[]): string {
  return cands.length ? `\n   Optional subjects from Wikipedia's Unusual articles list:\n${cands.map((c) => `   - ${c.title}: ${c.blurb}`).join("\n")}` : "";
}

/** The candidate an idea was built on, if any: the same article by name or by subject. */
export function pickedCandidate(title: string, offered: Candidate[], sameSubject: (a: string, b: string) => boolean): Candidate | null {
  const plain = (t: string) => t.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  return offered.find((c) => plain(c.title) === plain(title)) ?? offered.find((c) => sameSubject(c.title, title)) ?? null;
}

/** The sentence added to the idea writer's instructions when a batch carries candidates. */
export const CANDIDATE_RULE =
  "Some lines list optional subjects from Wikipedia's Unusual articles list, with the list's one-line description. " +
  "Take one only if it passes the test better than anything you would find yourself, and write its headline by the " +
  "same rules, from what its article tells. Ignore the rest. You never have to use one. When you take one, use its " +
  "name exactly as listed for the title.";

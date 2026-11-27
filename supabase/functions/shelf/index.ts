// The shelf: the small jobs around lessons and topics. Only "propose" calls a paid service,
// and it is one short request to the cheapest model.
//
// POST { action: "lessons" }                     lessons in the Library, newest first.
// POST { action: "hide_lesson", lesson_id }      take a lesson off the Library. Its audio is kept.
// POST { action: "dismiss_topic", topic_id }     "not interested": take a topic off the Listen screen.
// POST { action: "signal", type, lesson_id?, position?, topic_id? }   save a thumbs up or down.
// POST { action: "propose" }                     think up the next topics, from tags and from taste.
// POST { action: "tag", lesson_id }              the interest a lesson grew out of, if known.
// POST { action: "voice" } / { action: "set_voice", voice }   the narrator, and choosing another.
// POST { action: "profile" }                      the listener's first name and picture.
// POST { action: "set_profile", first_name?, avatar_path? }   change either.
// POST { action: "seen", ids }                   ideas that came into view in Explore.
// POST { action: "avatar_upload" }                a one-time address to upload a new picture to.
// POST { action: "share", lesson_id, show_name?, sent? }  a public link to a story. Asked for ahead, so the
//                                                  share sheet opens at once; sent: true when it is passed on,
//                                                  which is when a story not finished yet starts being finished.
//
// The learning loop lives in "propose". It reads what the listener loved, what they turned
// down and what they swiped away, and asks for topics that lean toward the first and away
// from the rest. The lesson function then prepares whatever is proposed here.
//
// Callers must send the project's publishable key in the `apikey` header.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sameSubject } from "./subject.ts";
import { callCost, ideaInput, mayAskForIdeas, pickVersion, PROPOSERS, readIdeas } from "./ideas.ts";
import { type Candidate, CANDIDATE_RULE, candidateLines, candidatesFor, choosePool, parseUnusual, pickedCandidate, UNUSUAL_PAGES } from "./wiki-pool.ts";

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const SCOUT_MODEL = Deno.env.get("OPENAI_SCOUT_MODEL") ?? "gpt-6-luna";
// Ideas are what a listener judges Pliny by before hearing anything, so they get the stronger model. Each call is in the cost log (step "ideas").
const IDEA_MODEL = Deno.env.get("OPENAI_IDEA_MODEL") ?? "gpt-6.1-terra";
// How many topics are kept waiting on the Listen screen.
const READY_TARGET = 3;
// How many stories from a person's own interests are kept ready or on their way. See the lesson function.
const OWN_TARGET = 1;

// The idea writer's instructions, in versions, live in ideas.ts.

// The narrators offered in Settings. Each id is a voice the lesson function accepts.
const NARRATORS = [
  { id: "cedar", name: "Cedar", note: "A man's voice. Warm and unhurried." },
  { id: "marin", name: "Marin", note: "A woman's voice. Warm and unhurried." },
  { id: "ash", name: "Ash", note: "A man's voice. A little brighter." },
  { id: "coral", name: "Coral", note: "A woman's voice. A little brighter." },
];

async function currentVoice() {
  const { data } = await db.from("user_settings").select("value").eq("key", "voice").limit(1).maybeSingle();
  const voice = typeof data?.value === "string" ? data.value.trim() : "";
  return json({ voice: NARRATORS.some((n) => n.id === voice) ? voice : "cedar", narrators: NARRATORS });
}

const SIGNALS = ["thumbs_up", "thumbs_down", "loved", "not_for_me", "not_interested", "cleared"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function envKeys(name: string): string[] {
  try {
    const named = JSON.parse(Deno.env.get(name) ?? "{}");
    return Object.values(named).filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

function allowedKeys(): string[] {
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  return [...envKeys("SUPABASE_PUBLISHABLE_KEYS"), ...(anon ? [anon] : [])];
}

// The secret key lets this function past row level security. It never leaves the server.
const SECRET_KEY = envKeys("SUPABASE_SECRET_KEYS")[0] ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const service = createClient(Deno.env.get("SUPABASE_URL") ?? "", SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Each person's own things are read and written as that person, so the database itself
// keeps accounts apart. Stories are the server's, and are shared. See the lesson function.
const who = new AsyncLocalStorage<Record<string, unknown>>();
const OWN = new Set(["interests", "signals", "lessons", "segments", "dismissals", "user_settings", "wants", "profiles"]);
const mine = (): any => (who.getStore() as any)?.client ?? service;
const me = (): string | null => ((who.getStore() as any)?.user_id as string | undefined) ?? null;
const db = {
  from: (table: string) => (OWN.has(table) ? mine() : service).from(table),
  storage: service.storage,
};

/** A value from the settings table, so a limit can be changed without a deploy. */
async function setting(key: string, fallback: string): Promise<string> {
  const { data } = await service.from("settings").select("value").eq("key", key).maybeSingle();
  return data?.value == null ? fallback : String(data.value);
}

const isId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);

/** Lessons that have at least one chapter made and have not been removed, newest first. */
async function listLessons() {
  const { data, error } = await db
    .from("lessons")
    .select("id, title, chosen_minutes, started_at, heard_position, finished_at, segments(position, status, target_minutes), topics(tag)")
    .eq("hidden", false)
    .order("started_at", { ascending: false })
    .limit(60);
  if (error) return json({ error: "Your lessons could not be loaded.", detail: error.message }, 500);
  // Liked means the last word on a story was a thumbs up or a "loved".
  const { data: said } = await db.from("signals").select("lesson_id, type, created_at").not("lesson_id", "is", null).in("type", ["thumbs_up", "loved", "thumbs_down", "not_for_me", "cleared"]).order("created_at").limit(2000);
  const liked = new Set<string>();
  for (const s of (said ?? []) as any[]) {
    if (s.type === "thumbs_up" || s.type === "loved") liked.add(s.lesson_id);
    else liked.delete(s.lesson_id);
  }
  const lessons = (data ?? [])
    .map((l: any) => ({
      id: l.id,
      title: l.title,
      chosen_minutes: l.chosen_minutes,
      started_at: l.started_at,
      tag: l.topics?.tag ?? null,
      chapters: l.segments.length,
      made: l.segments.filter((s: any) => s.status === "ready").length,
      liked: liked.has(l.id),
      finished: Boolean(l.finished_at),
      heard_position: l.heard_position ?? null,
      // What is left counts the chapter they were in as still to hear, so it is "about" this much.
      // Stories played before this was recorded have no figure.
      left_minutes: l.finished_at || !l.heard_position ? null : Math.round(l.segments.filter((s: any) => s.position >= l.heard_position).reduce((sum: number, s: any) => sum + (Number(s.target_minutes) || 0), 0)),
    }))
    .filter((l) => l.made > 0);
  return json({ lessons });
}

/**
 * Proposes the next topics, if any are needed. Each lesson or topic counts once, by the
 * most recent thing the listener said about it, so a thumbs up that was later taken back
 * no longer counts.
 */
async function propose() {
  // Read as the signed-in person, so the lessons and dismissals that come back are only theirs.
  const { data: waiting } = await mine().from("topics").select("id, status, stage, tag, proposed_at, proposed_for, lessons(id, user_id), dismissals(topic_id, user_id)").in("status", ["ready", "preparing", "proposed"]);
  // Checked by name as well, for when the scheduled job reads on a person's behalf.
  const theirs = (rows: any[] | null) => (rows ?? []).filter((r: any) => r.user_id === me());
  // A topic that has sat in "preparing" for minutes without being planned was cut off. It is not on its way.
  const recent = new Date(Date.now() - 4 * 60 * 1000).toISOString();
  const unplayed = (waiting ?? []).filter((t: any) =>
    t.status === "ready"
      ? theirs(t.lessons).length === 0 && theirs(t.dismissals).length === 0
      : t.proposed_for === me() && (t.status === "proposed" || t.stage === "planned" || t.proposed_at > recent),
  );
  const { data: tags } = await db.from("interests").select("label").eq("hidden", false).eq("user_id", me());
  const labels = (tags ?? []).map((t) => t.label as string);
  // Shared stories fill a person's screen, but only stories thought up for them, or matching
  // their interests, count toward the three kept waiting. So a new person's own stories get
  // started as soon as they have interests, however full the shared shelf is.
  const known = new Set(labels.map((l) => l.toLowerCase()));
  const own = unplayed.filter((t: any) => t.proposed_for === me() || known.has(String(t.tag ?? "").toLowerCase()));
  // Enough means both: at least one story of their own ready or on its way, and three to choose
  // from in all. Shared stories make up the three where there are some. Where there are not,
  // more ideas of their own are thought up.
  // The scheduled job keeps a stock of ideas for Explore, so for it having some already is no reason to stop.
  const stocking = Boolean((who.getStore() as any)?.fill);
  // Stocking Explore asks for more at a time, so every interest gets its share sooner.
  const batch = stocking ? 6 : READY_TARGET;
  if (!stocking && (own.some((t: any) => t.status === "proposed") || (own.length >= OWN_TARGET && unplayed.length >= ((who.getStore() as any)?.reserve ? 6 : READY_TARGET)))) return json({ proposed: [] });
  // Someone with no interests yet listens from the shared shelf. Nothing is made for them until they pick some.
  if (labels.length === 0 && unplayed.length >= ((who.getStore() as any)?.reserve ? 6 : READY_TARGET)) return json({ proposed: [] });
  if (!OPENAI_KEY) return json({ error: "OPENAI_API_KEY is not set as an edge function secret." }, 500);

  const { data: seen } = await db.from("topics").select("asked, title").order("proposed_at", { ascending: false }).limit(300);
  // The model is told what has been offered, and is not trusted to obey: anything it
  // proposes that matches an earlier subject or title is thrown out here.
  const plain = (t: unknown) => String(t ?? "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/^the /, "").trim();
  const offered = new Set((seen ?? []).flatMap((t) => [plain(t.asked), plain(t.title)]).filter(Boolean));
  const { data: everySubject } = await service.from("topics").select("asked").limit(10000);
  const subjects = (everySubject ?? []).map((t: any) => String(t.asked ?? "")).filter(Boolean);
  const { data: signals } = await db
    .from("signals")
    .select("type, created_at, lessons(id, title), topics(id, title)")
    .order("created_at", { ascending: false })
    .limit(200);

  const latest = new Map<string, { type: string; title: string }>();
  for (const s of (signals ?? []) as any[]) {
    const about = s.lessons ?? s.topics;
    if (about && !latest.has(about.id)) latest.set(about.id, { type: s.type, title: about.title });
  }
  const titles = (types: string[]) => [...latest.values()].filter((s) => types.includes(s.type)).map((s) => s.title).slice(0, 25);
  const liked = titles(["thumbs_up", "loved"]);
  const disliked = titles(["thumbs_down", "not_for_me", "not_interested"]);

  // Every interest gets its turn. The interests with the fewest stories so far go first, so a
  // narrow tag is not crowded out by the broad ones or by what happened to be loved lately.
  // About one idea in six is a wildcard.
  const { data: made } = await db.from("topics").select("tag").not("tag", "is", null).limit(1000);
  const served = new Map<string, number>();
  for (const t of (made ?? []) as any[]) served.set(String(t.tag).toLowerCase(), (served.get(String(t.tag).toLowerCase()) ?? 0) + 1);
  const turns = labels
    .map((label) => ({ label, count: served.get(label.toLowerCase()) ?? 0, tie: Math.random() }))
    .sort((a, b) => a.count - b.count || a.tie - b.tie)
    .map((t) => t.label);
  const slots: string[] = turns.slice(0, batch);
  while (slots.length < batch) slots.push("Off the map");
  if (labels.length >= batch && Math.random() < 0.5) slots[batch - 1] = "Off the map";

  // A person can't set off paid calls without limit: at most eight idea calls a day, and after a
  // batch that kept one idea or none, a pause that doubles each time. See mayAskForIdeas.
  const { data: recentCalls } = await service
    .from("usage")
    .select("at, raw")
    .eq("step", "ideas")
    .eq("user_id", me())
    .gt("at", new Date(Date.now() - 2 * 86_400_000).toISOString())
    .order("at", { ascending: false })
    .limit(40);
  const perDay = Number(await setting("idea_calls_per_day", "8")) || 8;
  const allowed = mayAskForIdeas(
    (recentCalls ?? []).map((r: any) => ({ at: Date.parse(r.at), kept: Number(r.raw?.ideas?.kept ?? 6) })),
    Date.now(),
    perDay,
  );
  if (!allowed.ok) return json({ proposed: [], held: allowed.reason, until: allowed.until ? new Date(allowed.until).toISOString() : null });

  // Which version of the instructions this batch uses. "ab" sends half the batches to each, so the
  // new prompt can be compared with the old before it becomes the default.
  const version = pickVersion(await setting("idea_prompt", "ab"));
  const batchId = crypto.randomUUID();
  // Wikipedia's Unusual articles list, behind a flag: optional subjects under some lines of this same call.
  const wiki = await wikiForBatch(slots, labels, batchId, (title) => offered.has(plain(title)) || subjects.some((x: string) => sameSubject(x, title)));
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: IDEA_MODEL,
      instructions: wiki.arm === "wiki" ? `${PROPOSERS[version]}\n\n${CANDIDATE_RULE}` : PROPOSERS[version],
      input: ideaInput(version, {
        extras: wiki.offered.map(candidateLines),
        interests: (tags ?? []).map((t) => t.label),
        liked,
        disliked,
        offered: (seen ?? []).map((t) => (t.title && t.title !== t.asked ? `${t.asked} (${t.title})` : t.asked)),
        slots,
      }),
    }),
  });
  if (!res.ok) return json({ error: "Topics could not be proposed.", detail: (await res.text()).slice(0, 300) }, 502);
  const data = await res.json();
  let text = "";
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) if (part.type === "output_text" && typeof part.text === "string") text += part.text;
  }
  let proposed: { title: string; tag: string | null; card?: string }[] = [];
  let rejected: Record<string, number> = {};
  let unreadable = false;
  try {
    const read = readIdeas(text, {
      slots,
      labels,
      isRepeat: (title) => offered.has(plain(title)),
      // The same subject under other words ("A pope put a dead pope on trial" and "The pope who put a
      // dead pope on trial" are both the Cadaver Synod) is caught by the subject, across every topic.
      isMade: (title) => subjects.some((s: string) => sameSubject(s, title)),
      sameSubject,
      // In Explore every row is the same height, so a headline that would not fit is not offered.
      maxCard: stocking ? 56 : null,
      batch,
    });
    proposed = read.ideas;
    rejected = read.rejected;
    // Which kept ideas were built on a Wikipedia candidate.
    for (const idea of proposed as any[]) {
      const used = pickedCandidate(idea.title, wiki.offered.flat(), sameSubject);
      if (used) idea.candidate = used;
    }
  } catch {
    unreadable = true;
  }
  // Every idea call goes in the cost log, with what it kept and why the rest were dropped, so the
  // cost per idea is measured. The daily cap and the pause above are read back from these lines.
  const usage = data.usage ?? {};
  const counts = { input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0, cached_tokens: usage.input_tokens_details?.cached_tokens ?? 0 };
  const prices = await setting("prices", "");
  let price: any;
  try {
    price = JSON.parse(prices || "{}")[IDEA_MODEL];
  } catch {
    price = undefined;
  }
  await service
    .from("usage")
    .insert({
      kind: "text",
      step: "ideas",
      model: IDEA_MODEL,
      user_id: me(),
      ...counts,
      raw: {
        ...usage,
        service_tier: data.service_tier ?? null,
        ideas: {
          batch_id: batchId,
          prompt_version: version,
          asked: slots.length,
          kept: proposed.length,
          rejected,
          unreadable,
          stocking,
          cost_usd: callCost(price, counts),
          // The Wikipedia pilot: which arm this batch was in, what was offered, and what was taken.
          ...(wiki.mode !== "off" ? { wiki: wikiLog(wiki, proposed as any[]) } : {}),
        },
      },
    })
    .then(() => null, () => null);
  if (unreadable) return json({ error: "The proposed topics could not be read." }, 502);
  if (proposed.length === 0) return json({ proposed: [] });
  const { data: saved, error } = await db
    .from("topics")
    .insert(
      proposed.map((t: any) => ({
        asked: t.candidate?.title ?? t.title,
        title: t.card || t.title,
        card: t.card || null,
        prompt_version: version,
        batch_id: batchId,
        tag: t.tag,
        status: "proposed",
        proposed_for: me(),
        ...(wiki.mode !== "off" ? { origin: t.candidate ? "wikipedia_unusual_articles" : "ai", candidate_page_id: t.candidate?.page_id ?? null } : {}),
      })),
    )
    // The new columns are only read when the pilot is on, so this works before the migration too.
    .select(wiki.mode !== "off" ? "id, candidate_page_id" : "id");
  if (error) return json({ error: "The proposed topics could not be saved.", detail: error.message }, 500);
  if (wiki.arm === "wiki") await markCandidates(wiki.offered.flat(), (saved ?? []) as any[]);
  return json({ proposed, learnedFrom: { liked: liked.length, turnedDown: disliked.length } });
}

// ---------- Wikipedia's Unusual articles list, as optional idea candidates ----------
//
// Behind the "idea_wiki_pool" setting: off (the default), ab (half of idea batches carry candidates,
// the other half are the control) or on. A pilot stops by itself after "idea_wiki_pilot_batches"
// Wikipedia batches. Nothing here calls a model: the candidates ride along in the idea call already
// being made, and the writer is free to ignore every one. See wiki-pool.ts.

const WIKI_SOURCE = "wikipedia_unusual_articles";

/** Whether the signed-in person may run maintenance actions: their id is in the "admin_user_ids" setting. */
async function isAdmin(): Promise<boolean> {
  const id = me();
  return Boolean(id) && (await setting("admin_user_ids", "")).split(",").map((x) => x.trim()).includes(id as string);
}
type PoolRow = Candidate & { page_id: number; offered: number };
type WikiBatch = { mode: string; arm: "wiki" | "plain" | "off"; offered: PoolRow[][]; pilot_left: number };

async function wikiForBatch(slots: string[], interests: string[], batchId: string, taken: (title: string) => boolean): Promise<WikiBatch> {
  const mode = await setting("idea_wiki_pool", "off");
  const none: WikiBatch = { mode, arm: "off", offered: slots.map(() => []), pilot_left: 0 };
  if (mode !== "ab" && mode !== "on") return none;
  const cap = Number(await setting("idea_wiki_pilot_batches", "30")) || 0;
  const { count } = await service.from("usage").select("id", { count: "exact", head: true }).eq("step", "ideas").eq("raw->ideas->wiki->>arm", "wiki");
  const left = Math.max(0, cap - (count ?? 0));
  if (left === 0) return { ...none, mode: "off" };
  // The pool is read from the table, and topped up in the background when it is two weeks old.
  const refreshed = Date.parse(await setting("idea_candidates_refreshed_at", "1970-01-01"));
  if (!(Date.now() - refreshed < 14 * 86_400_000)) {
    await service.from("settings").upsert({ key: "idea_candidates_refreshed_at", value: new Date().toISOString() });
    try {
      EdgeRuntime.waitUntil(refreshCandidates().catch((err) => console.log("candidate refresh failed:", String(err))));
    } catch {
      // Refreshed next time.
    }
  }
  if (mode === "ab" && Math.random() >= 0.5) return { mode, arm: "plain", offered: slots.map(() => []), pilot_left: left };
  const { data } = await service.from("idea_candidates").select("page_id, title, url, blurb, list_page, section, offered").eq("in_pool", true).is("topic_id", null).limit(500);
  const pool: PoolRow[] = ((data ?? []) as any[])
    .map((r) => ({ page_id: r.page_id, title: r.title, url: r.url, blurb: r.blurb, page: String(r.list_page).replace(/^Wikipedia:Unusual articles\//, ""), section: r.section ?? "", offered: r.offered ?? 0 }))
    .filter((c) => !taken(c.title));
  const perLine = Math.max(1, Math.min(5, Number(await setting("idea_wiki_per_line", "4")) || 4));
  const skip = new Set<string>();
  const offered = slots.map((line) => {
    const picked = candidatesFor(line, pool, { interests, n: perLine, skip, seed: batchId }) as PoolRow[];
    for (const c of picked) skip.add(c.title.toLowerCase());
    return picked;
  });
  // A batch whose lines found no candidates is an ordinary batch, and is logged as one.
  return { mode, arm: offered.some((o) => o.length) ? "wiki" : "plain", offered, pilot_left: left };
}

function wikiLog(w: WikiBatch, kept: any[]) {
  const offered = w.offered.flat();
  const selected = kept.filter((k) => k.candidate).map((k) => k.candidate.title);
  return {
    arm: w.arm,
    mode: w.mode,
    offered: offered.length,
    offered_titles: offered.map((c) => c.title),
    lines_with_candidates: w.offered.filter((o) => o.length).length,
    selected,
    ignored: offered.length - selected.length,
    generated_kept: kept.length - selected.length,
    pilot_left_before: w.pilot_left,
  };
}

/** Counts each offer, and ties a candidate the writer took to the idea made from it, so it is not offered again. */
async function markCandidates(offered: PoolRow[], saved: { id: string; candidate_page_id: number | null }[]) {
  const now = new Date().toISOString();
  for (const c of offered) {
    const topic = saved.find((t) => t.candidate_page_id === c.page_id);
    await service
      .from("idea_candidates")
      .update({ offered: (c.offered ?? 0) + 1, last_offered_at: now, ...(topic ? { topic_id: topic.id } : {}) })
      .eq("page_id", c.page_id)
      .then(() => null, () => null);
  }
}

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WIKI_HEADERS = { "User-Agent": "Pliny/1.0 (https://itspliny.com; audio stories)", "Api-User-Agent": "Pliny/1.0 (https://itspliny.com)" };

/**
 * Reads the list's pages, chooses a balanced pool that leaves out subjects Pliny already has, looks up
 * each article's page id and canonical title, and saves it. Deterministic, and free: Wikipedia's API only.
 * Candidates that were offered before keep their counts, and ones already turned into ideas keep their link.
 */
async function refreshCandidates(): Promise<{ read: number; pooled: number }> {
  const all: Candidate[] = [];
  for (const page of UNUSUAL_PAGES) {
    // Wikipedia limits how fast its API may be read, so the pages are read slowly, and one it refuses is skipped this time.
    if (all.length) await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(`${WIKI_API}?action=parse&format=json&formatversion=2&prop=wikitext&page=${encodeURIComponent(`Wikipedia:Unusual articles/${page}`)}`, { headers: WIKI_HEADERS });
    if (!res.ok) continue;
    const wikitext = (await res.json())?.parse?.wikitext;
    if (typeof wikitext === "string") all.push(...parseUnusual(wikitext, page));
  }
  if (all.length < 100) throw new Error(`only ${all.length} entries read`);
  const { data: topics } = await service.from("topics").select("asked").limit(10000);
  const made = ((topics ?? []) as any[]).map((t) => String(t.asked ?? "")).filter(Boolean);
  const size = Math.max(50, Math.min(400, Number(await setting("idea_wiki_pool_size", "200")) || 200));
  // A few more than needed are chosen, since some titles turn out to be redirects to the same article.
  // Everyone's current interests, so the pool holds a few strict matches for each before the rest is drawn.
  const { data: tags } = await service.from("interests").select("label").eq("hidden", false).is("parent_id", null).limit(2000);
  const interests = [...new Map(((tags ?? []) as any[]).map((t) => [String(t.label).toLowerCase(), String(t.label)])).values()];
  const chosen = choosePool(all, { size: size + 20, made, sameSubject, seed: new Date().toISOString().slice(0, 7), interests, perInterest: 6 });
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < chosen.length; i += 50) {
    await new Promise((r) => setTimeout(r, 1500));
    const group = chosen.slice(i, i + 50);
    const res = await fetch(`${WIKI_API}?action=query&format=json&formatversion=2&redirects=1&prop=info&inprop=url&titles=${encodeURIComponent(group.map((c) => c.title).join("|"))}`, { headers: WIKI_HEADERS });
    if (!res.ok) continue;
    const q = (await res.json())?.query ?? {};
    const to = new Map<string, string>();
    for (const n of [...(q.normalized ?? []), ...(q.redirects ?? [])]) to.set(n.from, n.to);
    const byTitle = new Map<string, any>(((q.pages ?? []) as any[]).filter((p) => p.pageid).map((p) => [p.title, p]));
    for (const c of group) {
      let t = c.title;
      for (let k = 0; k < 3 && to.has(t); k++) t = to.get(t)!;
      const p = byTitle.get(t);
      if (!p || rows.some((r) => r.page_id === p.pageid)) continue;
      rows.push({ page_id: p.pageid, title: p.title, url: p.fullurl ?? c.url, blurb: c.blurb, source: WIKI_SOURCE, list_page: `Wikipedia:Unusual articles/${c.page}`, section: c.section, fetched_at: new Date().toISOString(), in_pool: true });
    }
  }
  const pool = rows.slice(0, size);
  // Only the chosen are in the pool. Older rows stay, out of the pool, with their history.
  await service.from("idea_candidates").update({ in_pool: false }).eq("source", WIKI_SOURCE);
  for (let i = 0; i < pool.length; i += 100) await service.from("idea_candidates").upsert(pool.slice(i, i + 100), { onConflict: "page_id" });
  await service.from("settings").upsert({ key: "idea_candidates_refreshed_at", value: new Date().toISOString() });
  return { read: all.length, pooled: pool.length };
}

// How many of a person's queued stories are made in a day, and how many of them may be made or waiting
// unheard at once. The same two numbers are in the lesson function, which does the making.
const QUEUE_PER_DAY = 10;
const QUEUE_WAITING = 3;
// The longest a queue may grow.
const QUEUE_LONGEST = 30;

/** Where this person stands against the two limits. */
async function queueState() {
  const { data } = await service
    .from("topics")
    .select("id, status, queued_at, proposed_at, lessons(id, user_id), dismissals(topic_id, user_id)")
    .eq("proposed_for", me())
    .not("queued_at", "is", null)
    .in("status", ["proposed", "preparing", "ready"]);
  const theirs = (rows: any[] | null) => (rows ?? []).filter((r: any) => r.user_id === me());
  const day = Date.now() - 86_400_000;
  const rows = data ?? [];
  // Waiting means asked for and not yet heard: still being made, or finished and neither played nor swiped away.
  const made = rows.filter((t: any) => t.status !== "proposed");
  // Waiting means being made, or finished and neither played nor swiped away.
  const waiting = made.filter((t: any) => t.status !== "ready" || (theirs(t.lessons).length === 0 && theirs(t.dismissals).length === 0));
  const recent = made.filter((t: any) => Date.parse(t.proposed_at) > day).map((t: any) => Date.parse(t.proposed_at)).sort((a: number, b: number) => a - b);
  return {
    // When the oldest of today's stories leaves the 24 hour window, room opens for the next one.
    opens_at: recent.length >= QUEUE_PER_DAY ? new Date(recent[0] + 86_400_000).toISOString() : null,
    today: made.filter((t: any) => Date.parse(t.proposed_at) > day).length,
    waiting: waiting.length,
    preparing: waiting.filter((t: any) => t.status !== "ready").length,
    // Asked for, and not yet begun.
    in_queue: rows.filter((t: any) => t.status === "proposed").length,
  };
}

/** The ideas on offer in Explore, newest first, with where the person stands against the limits. */
// ---------- What has done well ----------
//
// Every finished story has a score across all listeners: likes count three times, each person who
// heard it once, each length it is fully recorded at once (a recorded length plays again for free),
// and each "not for me" takes two away and each swipe half of one. See topic_scores() in the database.
type Score = { listeners: number; likes: number; passes: number; swipes: number; lengths: number; score: number };
async function scores(): Promise<Map<string, Score>> {
  const { data } = await service.rpc("topic_scores");
  return new Map((data ?? []).map((r: any) => [r.topic_id, { ...r, score: Number(r.score) || 0 }]));
}

/**
 * Interests to suggest to someone signing up: the ones with the most finished stories behind
 * them and the most hearts on those stories, across everyone. A pick from here starts with
 * stories that are already made, so the first ones cost nothing and play at once.
 */
async function popularInterests(): Promise<string[]> {
  const [{ data }, scored] = await Promise.all([service.from("topics").select("id, tag").eq("status", "ready").not("tag", "is", null).limit(1000), scores()]);
  const tags = new Map<string, { names: Map<string, number>; stories: number; likes: number }>();
  for (const t of (data ?? []) as any[]) {
    const name = String(t.tag).trim();
    if (!name || name.toLowerCase() === "off the map") continue;
    const key = name.toLowerCase();
    const tag = tags.get(key) ?? { names: new Map(), stories: 0, likes: 0 };
    tag.names.set(name, (tag.names.get(name) ?? 0) + 1);
    tag.stories += 1;
    tag.likes += scored.get(t.id)?.likes ?? 0;
    tags.set(key, tag);
  }
  return [...tags.values()]
    .sort((a, b) => b.stories + 2 * b.likes - (a.stories + 2 * a.likes) || b.likes - a.likes)
    // Shown the way it is most often written. A first letter is raised, the rest left as typed.
    .map((t) => [...t.names.entries()].sort((a, b) => b[1] - a[1])[0][0])
    .map((name) => name.charAt(0).toUpperCase() + name.slice(1))
    .slice(0, 12);
}

/**
 * Finished stories in this person's interests that they have not heard, swiped away or picked
 * already, best first. Explore leads with these: they play at once and cost nothing to make.
 */
async function madeForInterests(kept: Set<string>): Promise<{ id: string; asked: string; title: string; tag: string | null; ready: true }[]> {
  if (kept.size === 0) return [];
  const [{ data }, heard, gone, picked, scored] = await Promise.all([
    service.from("topics").select("id, asked, title, tag, proposed_for, prepared_at").eq("status", "ready").not("tag", "is", null).order("prepared_at", { ascending: false }).limit(1000),
    service.from("lessons").select("topic_id").eq("user_id", me()).limit(2000),
    service.from("dismissals").select("topic_id").eq("user_id", me()).limit(2000),
    service.from("wants").select("topic_id").eq("user_id", me()).limit(2000),
    scores(),
  ]);
  const skip = new Set<string>([...(heard.data ?? []), ...(gone.data ?? []), ...(picked.data ?? [])].map((r: any) => r.topic_id));
  return ((data ?? []) as any[])
    // Stories made for this person are already on their Listen tab.
    .filter((t) => !skip.has(t.id) && t.proposed_for !== me() && kept.has(String(t.tag).toLowerCase()) && String(t.title).length <= 60)
    .filter((t) => (scored.get(t.id)?.score ?? 0) >= 0)
    .map((t, i) => ({ t, i, score: scored.get(t.id)?.score ?? 0 }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 40)
    .map(({ t }) => ({ id: t.id, asked: String(t.asked ?? ""), title: t.title, tag: t.tag ?? null, ready: true as const }));
}

/** The subjects of every story this person has heard, swiped away, picked, or thrown out as an idea. */
async function doneSubjects(): Promise<string[]> {
  const [heard, gone, picked, binned] = await Promise.all([
    service.from("lessons").select("topics(asked)").eq("user_id", me()).limit(2000),
    service.from("dismissals").select("topics(asked)").eq("user_id", me()).limit(2000),
    service.from("wants").select("topics(asked)").eq("user_id", me()).limit(2000),
    service.from("topics").select("asked").eq("proposed_for", me()).eq("status", "hidden").limit(2000),
  ]);
  return [...(heard.data ?? []), ...(gone.data ?? []), ...(picked.data ?? [])]
    .map((r: any) => String(r.topics?.asked ?? ""))
    .concat((binned.data ?? []).map((t: any) => String(t.asked ?? "")))
    .filter(Boolean);
}

async function ideas() {
  const { data } = await service.from("topics").select("id, asked, title, tag").eq("proposed_for", me()).eq("status", "proposed").is("queued_at", null).order("proposed_at", { ascending: false }).limit(40);
  const state = await queueState();
  // The chips in Explore are the person's interests as they stand now. An idea from an interest
  // they have since removed is no longer offered.
  const { data: tags } = await service.from("interests").select("label").eq("hidden", false).eq("user_id", me()).order("created_at");
  const labels = (tags ?? []).map((t: any) => String(t.label));
  const kept = new Set<string>(labels.map((l: string) => l.toLowerCase()));
  const made = (await madeForInterests(kept).catch(() => [])).filter((t, i, all) => all.findIndex((o) => sameSubject(o.asked, t.asked)) === i);
  // Subjects this person has already heard, swiped away, picked or turned down, under any title.
  const done = await doneSubjects();
  return {
    tags: labels,
    // Finished stories first, the best liked and most heard at the top. Then ideas still to be made.
    ideas: [...made.slice(0, 20), ...(data ?? []).filter((t: any) => String(t.title).length <= 60).filter((t: any) => !t.tag || t.tag === "Off the map" || kept.has(String(t.tag).toLowerCase())).map((t: any) => ({ id: t.id, asked: String(t.asked ?? ""), title: t.title, tag: t.tag ?? null }))]
      .filter((t: any, i: number, all: any[]) => !done.some((d) => sameSubject(d, t.asked || t.title)) && all.findIndex((o: any) => sameSubject(o.asked || o.title, t.asked || t.title)) === i)
      .map(({ asked: _asked, ...t }: any) => t),
    queued_today: state.today,
    opens_at: state.opens_at,
    per_day: QUEUE_PER_DAY,
    waiting: state.waiting,
    waiting_limit: QUEUE_WAITING,
    preparing: state.preparing,
    in_queue: state.in_queue,
  };
}

Deno.serve((req: Request) => who.run({}, () => handle(req)));

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const key = req.headers.get("apikey") ?? "";
  if (!key || !allowedKeys().includes(key)) return json({ error: "Missing or wrong apikey." }, 401);

  // Who is asking. Everything here belongs to one person, so nobody gets in without signing in.
  const pass = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: asker } = pass.split(".").length === 3 ? await service.auth.getUser(pass).catch(() => ({ data: null as any })) : { data: null as any };
  // The scheduled job may think up ideas on a person's behalf. It proves itself with a secret kept in the settings table.
  const offered = req.headers.get("x-pliny-cron") ?? "";
  let scheduler = false;
  if (!asker?.user && offered) {
    const { data: kept } = await service.from("settings").select("value").eq("key", "cron_secret").maybeSingle();
    scheduler = typeof kept?.value === "string" && kept.value.length > 0 && kept.value === offered;
  }
  if (!asker?.user && !scheduler) return json({ error: "Sign in to use Pliny." }, 401);
  if (asker?.user) {
    Object.assign(who.getStore() ?? {}, {
      user_id: asker.user.id,
      client: createClient(Deno.env.get("SUPABASE_URL") ?? "", key, {
        global: { headers: { Authorization: `Bearer ${pass}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send a JSON body." }, 400);
  }
  if (scheduler) {
    // The scheduler may only think up ideas, and only for a named person.
    if (body.action !== "propose" || !isId(body.as_user)) return json({ error: "Not allowed." }, 401);
    Object.assign(who.getStore() ?? {}, { user_id: body.as_user, client: service, reserve: true, fill: body.fill === true });
  }

  if (body.action === "lessons") return await listLessons();

  // Where the listener has got to in a story. It only ever moves forward.
  if (body.action === "heard") {
    const position = Number(body.position);
    if (!isId(body.lesson_id) || !Number.isInteger(position) || position < 1) return json({ error: "Give a lesson_id and a position." }, 400);
    const { data: lesson } = await db.from("lessons").select("heard_position, finished_at").eq("id", body.lesson_id).maybeSingle();
    if (!lesson) return json({ error: "No such lesson." }, 404);
    await db
      .from("lessons")
      .update({ heard_position: Math.max(lesson.heard_position ?? 0, position), ...(body.finished === true && !lesson.finished_at ? { finished_at: new Date().toISOString() } : {}) })
      .eq("id", body.lesson_id);
    return json({ ok: true });
  }
  if (body.action === "propose") return await propose();
  // Fills the Wikipedia candidate pool now instead of waiting for the two-week refresh. Admin only.
  if (body.action === "refresh_candidates") {
    if (!(await isAdmin())) return json({ error: "Not allowed." }, 403);
    return json(await refreshCandidates());
  }

  if (body.action === "voice") return await currentVoice();
  if (body.action === "set_voice") {
    if (!NARRATORS.some((n) => n.id === body.voice)) return json({ error: "That is not one of the narrators." }, 400);
    // Used for every chapter recorded from now on. Chapters already recorded keep their voice.
    const { error } = await db.from("user_settings").upsert({ key: "voice", value: body.voice, updated_at: new Date().toISOString() }, { onConflict: "user_id,key" });
    if (error) return json({ error: "The narrator could not be changed.", detail: error.message }, 500);
    return await currentVoice();
  }

  if (body.action === "tag") {
    if (!isId(body.lesson_id)) return json({ error: "Give a lesson_id." }, 400);
    const { data } = await db.from("lessons").select("topics(tag)").eq("id", body.lesson_id).maybeSingle();
    return json({ tag: (data as any)?.topics?.tag ?? null });
  }

  if (body.action === "hide_lesson") {
    if (!isId(body.lesson_id)) return json({ error: "Give a lesson_id." }, 400);
    // Hidden, not deleted: the scripts and audio stay, so nothing paid for is thrown away.
    const { error } = await db.from("lessons").update({ hidden: true }).eq("id", body.lesson_id);
    if (error) return json({ error: "The lesson could not be removed.", detail: error.message }, 500);
    return json({ ok: true });
  }

  // ---------- Explore: ideas a person can ask for ----------
  if (body.action === "ideas") return json(await ideas());

  if (body.action === "popular_interests") return json({ interests: await popularInterests() });

  // Someone has just picked their first interests. Explore is filled at once, three batches in a row,
  // instead of a batch a minute from the scheduled job. These are the same ideas it would make anyway,
  // so it costs nothing extra: they only arrive sooner.
  if (body.action === "stock") {
    const { count } = await service.from("topics").select("id", { count: "exact", head: true }).eq("proposed_for", me()).eq("status", "proposed").is("queued_at", null);
    const short = (count ?? 0) < 12;
    if (short) {
      Object.assign(who.getStore() ?? {}, { fill: true });
      EdgeRuntime.waitUntil(
        (async () => {
          for (let i = 0; i < 3; i++) await propose().catch((err) => console.log("stock:", String(err)));
        })(),
      );
    }
    return json({ ok: true, stocking: short });
  }

  if (body.action === "queue") {
    if (!isId(body.topic_id)) return json({ error: "Give a topic_id." }, 400);
    // A story that is already finished needs no making. It goes straight to the front of Listen.
    const { data: finished } = await service.from("topics").select("id, proposed_for").eq("id", body.topic_id).eq("status", "ready").maybeSingle();
    if (finished) {
      // Written as the person, with their id, so the database accepts it as theirs.
      const { error } = await db.from("wants").upsert({ topic_id: body.topic_id, user_id: me() }, { onConflict: "user_id,topic_id" });
      if (error) return json({ error: "That story could not be added.", detail: error.message }, 500);
      return json({ ok: true, starts: true, ready: true, ahead: 0, ...(await ideas()) });
    }
    // Asking is never refused for being too keen. The queue is a list of wishes: the server makes them a few
    // at a time, and the limits apply to the making, not the asking. Only a very long queue is turned away.
    const state = await queueState();
    if (state.in_queue >= QUEUE_LONGEST) return json({ error: "Your queue is full. Listen to a few, then add more.", limit: "queue" }, 429);
    const { data: queued } = await service
      .from("topics")
      .update({ queued_at: new Date().toISOString() })
      .eq("id", body.topic_id)
      .eq("proposed_for", me())
      .eq("status", "proposed")
      .is("queued_at", null)
      .select("id")
      .maybeSingle();
    if (!queued) return json({ error: "That idea is no longer available." }, 409);
    // It starts now if there is room among the ones being made or waiting to be heard. Otherwise it takes its turn.
    const starts = state.in_queue === 0 && state.waiting < QUEUE_WAITING && state.today < QUEUE_PER_DAY;
    // Past today's allowance it still joins the queue, and the app says when it will be made.
    return json({ ok: true, starts, ahead: state.in_queue, used_up: state.today >= QUEUE_PER_DAY, ...(await ideas()) });
  }

  if (body.action === "dismiss_idea") {
    if (!isId(body.topic_id)) return json({ error: "Give a topic_id." }, 400);
    // A finished story is set aside for this person only. It stays available to everyone else.
    const { data: finished } = await service.from("topics").select("id").eq("id", body.topic_id).eq("status", "ready").maybeSingle();
    if (finished) {
      await db.from("dismissals").upsert({ topic_id: body.topic_id }, { onConflict: "user_id,topic_id" });
      return json({ ok: true });
    }
    // Only an idea of this person's own that nothing has been made from yet.
    await service.from("topics").update({ status: "hidden", error: "Swiped away in Explore." }).eq("id", body.topic_id).eq("proposed_for", me()).eq("status", "proposed").is("queued_at", null);
    return json({ ok: true });
  }

  if (body.action === "dismiss_topic") {
    if (!isId(body.topic_id)) return json({ error: "Give a topic_id." }, 400);
    // Swiped away for this person only. The story stays available to everyone else.
    const { error } = await db.from("dismissals").upsert({ topic_id: body.topic_id }, { onConflict: "user_id,topic_id" });
    if (error) return json({ error: "The topic could not be dismissed.", detail: error.message }, 500);
    await db.from("signals").insert({ type: "not_interested", topic_id: body.topic_id });
    return json({ ok: true });
  }

  if (body.action === "signal") {
    const type = String(body.type);
    if (!SIGNALS.includes(type)) return json({ error: `Type must be one of: ${SIGNALS.join(", ")}.` }, 400);
    const position = Number.isInteger(Number(body.position)) && Number(body.position) > 0 ? Number(body.position) : null;
    const { error } = await db.from("signals").insert({
      type,
      lesson_id: isId(body.lesson_id) ? body.lesson_id : null,
      topic_id: isId(body.topic_id) ? body.topic_id : null,
      position,
    });
    if (error) return json({ error: "That could not be saved.", detail: error.message }, 500);
    return json({ ok: true });
  }

  if (body.action === "profile") return json(await profile());

  if (body.action === "set_profile") {
    const change: Record<string, unknown> = { user_id: me(), updated_at: new Date().toISOString() };
    if (body.first_name !== undefined) {
      // A first name, as it would be said aloud: one or two words, no more than 40 letters.
      const name = String(body.first_name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
      if (!name) return json({ error: "Give a name." }, 400);
      change.first_name = name;
    }
    if (body.avatar_path !== undefined) {
      // Only a picture this person uploaded, in their own folder.
      const path = body.avatar_path === null ? null : String(body.avatar_path);
      if (path !== null && !path.startsWith(`${me()}/`)) return json({ error: "That picture is not yours." }, 400);
      change.avatar_path = path;
    }
    const { error } = await db.from("profiles").upsert(change, { onConflict: "user_id" });
    if (error) return json({ error: "Your profile could not be saved.", detail: error.message }, 500);
    return json(await profile());
  }

  if (body.action === "share") {
    if (!isId(body.lesson_id)) return json({ error: "Give a lesson_id." }, 400);
    const { data: lesson } = await db.from("lessons").select("id, topic_id, user_id, segments(status)").eq("id", body.lesson_id).maybeSingle();
    if (!lesson || lesson.user_id !== me()) return json({ error: "That story could not be found." }, 404);
    const showName = body.show_name !== false;
    const sent = body.sent === true;
    const slug = await storySlug(lesson.topic_id);
    if (!slug) return json({ error: "That story cannot be shared yet." }, 400);
    // One link per story per person. Sharing it again keeps the same link, with the name choice updated.
    const { data: had } = await service.from("shares").select("code").eq("lesson_id", lesson.id).eq("user_id", me()).maybeSingle();
    let code = had?.code as string | undefined;
    if (code) await service.from("shares").update({ show_name: showName, ...(sent ? { sent_at: new Date().toISOString() } : {}) }).eq("code", code);
    for (let tries = 0; !code && tries < 5; tries++) {
      const fresh = shareCode();
      const { error } = await service.from("shares").insert({ code: fresh, lesson_id: lesson.id, topic_id: lesson.topic_id, user_id: me(), show_name: showName, sent_at: sent ? new Date().toISOString() : null });
      if (!error) code = fresh;
    }
    if (!code) return json({ error: "The link could not be made. Try again." }, 500);
    // A story finished in the last hour may not have its page on itspliny.com yet, so its link would
    // show no artwork in a text. Sending it starts a build of the website at once.
    if (sent) {
      const built = rebuildSite();
      try {
        EdgeRuntime.waitUntil(built);
      } catch {
        /* the build was still asked for */
      }
    }
    // A story not finished yet is finished by the scheduled job, a chapter a minute, so it can all be heard.
    const unfinished = (lesson.segments ?? []).some((s: any) => s.status !== "ready");
    // The same background the app and the website show for this story.
    let art = 0;
    for (const c of String(lesson.topic_id)) art = (art * 31 + c.charCodeAt(0)) >>> 0;
    return json({ url: `https://itspliny.com/s/${slug}?r=${code}`, code, show_name: showName, finishing: unfinished, art: art % 30 });
  }

  if (body.action === "seen") {
    // Which ideas actually came into view in Explore, so the share queued is counted among ideas
    // people saw, not among everything generated. Ids that are not ideas are ignored by the join.
    const ids = (Array.isArray(body.ids) ? body.ids : []).filter(isId).slice(0, 100);
    if (ids.length === 0 || !me()) return json({ ok: true });
    const now = new Date().toISOString();
    await service.from("idea_views").upsert(ids.map((topic_id: string) => ({ user_id: me(), topic_id, last_seen: now })), { onConflict: "user_id,topic_id" });
    return json({ ok: true });
  }

  if (body.action === "avatar_upload") {
    // Each picture gets a new name, so the old one never shows from a cache after a change.
    const path = `${me()}/${Date.now()}.jpg`;
    const { data, error } = await service.storage.from("avatars").createSignedUploadUrl(path);
    if (error || !data) return json({ error: "The picture could not be uploaded.", detail: error?.message }, 500);
    return json({ path, url: data.signedUrl });
  }

  return json({ error: "Unknown action." }, 400);
}

/**
 * Asks GitHub to publish the website now rather than at its next scheduled run. Needs a GitHub
 * token allowed to run this repository's workflows, saved as the GITHUB_SITE_TOKEN secret. Without
 * one, pages are still made by the scheduled run. Asking twice in a row is harmless.
 */
async function rebuildSite(): Promise<void> {
  const token = Deno.env.get("GITHUB_SITE_TOKEN");
  if (!token) return;
  await fetch("https://api.github.com/repos/Poncheka/learning-app/actions/workflows/site.yml/dispatches", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "pliny-shelf" },
    body: JSON.stringify({ ref: "main" }),
  }).catch(() => null);
}

/** A short code for a share link: easy to read aloud, no look-alike letters. */
function shareCode(): string {
  const letters = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => letters[b % letters.length]).join("");
}

/**
 * The story's address on itspliny.com, made from its title the first time it is shared and kept
 * after that: "The pope who put a dead pope on trial" is /s/the-pope-who-put-a-dead-pope-on-trial.
 */
async function storySlug(topicId: string | null): Promise<string | null> {
  if (!topicId) return null;
  const { data: topic } = await service.from("topics").select("slug, title").eq("id", topicId).maybeSingle();
  if (!topic) return null;
  if (topic.slug) return topic.slug;
  const full = String(topic.title ?? "story")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // A long title is cut at a whole word.
  const base = (full.length > 70 ? full.slice(0, 70).replace(/-[^-]*$/, "") : full) || "story";
  for (let n = 1; n < 20; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const { error } = await service.from("topics").update({ slug }).eq("id", topicId).is("slug", null);
    if (!error) {
      const { data: kept } = await service.from("topics").select("slug").eq("id", topicId).maybeSingle();
      if (kept?.slug) return kept.slug;
    }
  }
  return null;
}

/** The listener's first name and a link to their picture, good for a week. */
async function profile(): Promise<{ first_name: string | null; avatar_url: string | null }> {
  const { data } = await db.from("profiles").select("first_name, avatar_path").eq("user_id", me()).maybeSingle();
  let avatar_url: string | null = null;
  if (data?.avatar_path) {
    const { data: link } = await service.storage.from("avatars").createSignedUrl(data.avatar_path, 7 * 86400);
    avatar_url = link?.signedUrl ?? null;
  }
  return { first_name: data?.first_name ?? null, avatar_url };
}

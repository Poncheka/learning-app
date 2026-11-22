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
//
// The learning loop lives in "propose". It reads what the listener loved, what they turned
// down and what they swiped away, and asks for topics that lean toward the first and away
// from the rest. The lesson function then prepares whatever is proposed here.
//
// Callers must send the project's publishable key in the `apikey` header.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "npm:@supabase/supabase-js@2";

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const SCOUT_MODEL = Deno.env.get("OPENAI_SCOUT_MODEL") ?? "gpt-6-luna";
// How many topics are kept waiting on the Listen screen.
const READY_TARGET = 3;
// How many stories from a person's own interests are kept ready or on their way. See the lesson function.
const OWN_TARGET = 1;

const PROPOSER_BRIEF =
  "You choose what Pliny, an audio app for the endlessly curious, offers its listener next. Given their " +
  "interests and what they have made of past lessons, propose subjects for audio lessons.\n\n" +
  "The test for every subject: it has one true fact at its heart that sounds ridiculous, the kind you " +
  "would blurt out to a friend, and that grabs someone who has never heard of the subject. Pan Am kept a " +
  "waiting list for flights to the moon. Australia's army lost a war against emus. An Egyptian mummy was " +
  "received with military honors. There is a reason we drive on the right side of the road. If the only " +
  "way to pitch a subject is by a name the listener would not know, such as an obscure person, town or " +
  "event, it fails the test: either find the ridiculous fact inside it or choose something else. Everyday " +
  "things with a strange history are as good as strange episodes.\n\n" +
  "Each subject must be something Wikipedia covers in depth. Name it the way Wikipedia would, so it can be " +
  "looked up: 'Emu War', 'Pan Am First Moon Flights Club', 'Left- and right-hand traffic'. The catchy " +
  "title is written later, from the facts, so do not try to write it here.\n\n" +
  "Learn from their taste. Work out what the lessons they loved have in common, in subject, period, scale " +
  "and mood, and offer more in that spirit. Work out what the ones they turned down or swiped away have " +
  "in common, and steer clear of it. Their own reactions outweigh their listed interests when the two " +
  "disagree. Never repeat a subject already offered, under any name.\n\n" +
  "Keep the set varied. The subjects in one reply must be of different kinds and grow out of different " +
  "interests: never two about animals, or two hoaxes, or two from the same century. Read their taste for " +
  "its spirit, not its surface. Someone who loved a story about an army losing to emus likes absurd true " +
  "episodes, not animals. Look at what was offered most recently, listed first, and do not offer more of " +
  "the same kind.\n\n" +
  "About one subject in four should wander off their map, into something they did not ask for but would be " +
  "glad to hear.\n\n" +
  "Reply with only a JSON array of objects, each shaped {\"title\": string, \"tag\": string}. The title is the " +
  "subject as named above. The tag is the one interest from their list that the subject grew out of, " +
  "copied exactly as they wrote it. For a subject that wanders off their map, the tag is \"Off the map\".";

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
const OWN = new Set(["interests", "signals", "lessons", "segments", "dismissals", "user_settings"]);
const mine = (): any => (who.getStore() as any)?.client ?? service;
const me = (): string | null => ((who.getStore() as any)?.user_id as string | undefined) ?? null;
const db = {
  from: (table: string) => (OWN.has(table) ? mine() : service).from(table),
  storage: service.storage,
};

const isId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);

/** Lessons that have at least one chapter made and have not been removed, newest first. */
async function listLessons() {
  const { data, error } = await db
    .from("lessons")
    .select("id, title, chosen_minutes, started_at, segments(position, status), topics(tag)")
    .eq("hidden", false)
    .order("started_at", { ascending: false })
    .limit(60);
  if (error) return json({ error: "Your lessons could not be loaded.", detail: error.message }, 500);
  const lessons = (data ?? [])
    .map((l: any) => ({
      id: l.id,
      title: l.title,
      chosen_minutes: l.chosen_minutes,
      started_at: l.started_at,
      tag: l.topics?.tag ?? null,
      chapters: l.segments.length,
      made: l.segments.filter((s: any) => s.status === "ready").length,
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
  const { data: waiting } = await mine().from("topics").select("id, status, stage, tag, proposed_at, proposed_for, lessons(id), dismissals(topic_id)").in("status", ["ready", "preparing", "proposed"]);
  // A topic that has sat in "preparing" for minutes without being planned was cut off. It is not on its way.
  const recent = new Date(Date.now() - 4 * 60 * 1000).toISOString();
  const unplayed = (waiting ?? []).filter((t: any) =>
    t.status === "ready"
      ? (t.lessons ?? []).length === 0 && (t.dismissals ?? []).length === 0
      : t.proposed_for === me() && (t.status === "proposed" || t.stage === "planned" || t.proposed_at > recent),
  );
  const { data: tags } = await db.from("interests").select("label").eq("hidden", false);
  const labels = (tags ?? []).map((t) => t.label as string);
  // Shared stories fill a person's screen, but only stories thought up for them, or matching
  // their interests, count toward the three kept waiting. So a new person's own stories get
  // started as soon as they have interests, however full the shared shelf is.
  const known = new Set(labels.map((l) => l.toLowerCase()));
  const own = unplayed.filter((t: any) => t.proposed_for === me() || known.has(String(t.tag ?? "").toLowerCase()));
  // Enough means both: at least one story of their own ready or on its way, and three to choose
  // from in all. Shared stories make up the three where there are some. Where there are not,
  // more ideas of their own are thought up.
  if (own.some((t: any) => t.status === "proposed") || (own.length >= OWN_TARGET && unplayed.length >= READY_TARGET)) return json({ proposed: [] });
  // Someone with no interests yet listens from the shared shelf. Nothing is made for them until they pick some.
  if (labels.length === 0 && unplayed.length >= READY_TARGET) return json({ proposed: [] });
  if (!OPENAI_KEY) return json({ error: "OPENAI_API_KEY is not set as an edge function secret." }, 500);

  const { data: seen } = await db.from("topics").select("asked, title").order("proposed_at", { ascending: false }).limit(300);
  // The model is told what has been offered, and is not trusted to obey: anything it
  // proposes that matches an earlier subject or title is thrown out here.
  const plain = (t: unknown) => String(t ?? "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/^the /, "").trim();
  const offered = new Set((seen ?? []).flatMap((t) => [plain(t.asked), plain(t.title)]).filter(Boolean));
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

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: SCOUT_MODEL,
      instructions: PROPOSER_BRIEF,
      input:
        `Interests: ${(tags ?? []).map((t) => t.label).join(", ") || "none listed yet, so range widely"}\n` +
        `Loved: ${liked.join("; ") || "nothing rated yet"}\n` +
        `Turned down or swiped away: ${disliked.join("; ") || "nothing yet"}\n` +
        `Already offered: ${(seen ?? []).map((t) => (t.title && t.title !== t.asked ? `${t.asked} (${t.title})` : t.asked)).join("; ") || "nothing yet"}\n` +
        `Propose ${READY_TARGET} topics.`,
    }),
  });
  if (!res.ok) return json({ error: "Topics could not be proposed.", detail: (await res.text()).slice(0, 300) }, 502);
  const data = await res.json();
  let text = "";
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) if (part.type === "output_text" && typeof part.text === "string") text += part.text;
  }
  let proposed: { title: string; tag: string | null }[] = [];
  try {
    const parsed = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
    proposed = (Array.isArray(parsed) ? parsed : [])
      .map((t: any) => ({
        title: String(typeof t === "string" ? t : t?.title ?? "").trim(),
        // Only a tag the listener really has is kept. Anything else counts as a wildcard.
        tag: labels.find((l) => l.toLowerCase() === String(t?.tag ?? "").trim().toLowerCase()) ?? "Off the map",
      }))
      .filter((t) => t.title.length > 0 && !offered.has(plain(t.title)))
      .slice(0, READY_TARGET);
  } catch {
    return json({ error: "The proposed topics could not be read." }, 502);
  }
  if (proposed.length === 0) return json({ proposed: [] });
  const { error } = await db.from("topics").insert(proposed.map((t) => ({ asked: t.title, title: t.title, tag: t.tag, status: "proposed", proposed_for: me() })));
  if (error) return json({ error: "The proposed topics could not be saved.", detail: error.message }, 500);
  return json({ proposed, learnedFrom: { liked: liked.length, turnedDown: disliked.length } });
}

Deno.serve((req: Request) => who.run({}, () => handle(req)));

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const key = req.headers.get("apikey") ?? "";
  if (!key || !allowedKeys().includes(key)) return json({ error: "Missing or wrong apikey." }, 401);

  // Who is asking. Everything here belongs to one person, so nobody gets in without signing in.
  const pass = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: asker } = pass.split(".").length === 3 ? await service.auth.getUser(pass).catch(() => ({ data: null as any })) : { data: null as any };
  if (!asker?.user) return json({ error: "Sign in to use Pliny." }, 401);
  Object.assign(who.getStore() ?? {}, {
    user_id: asker.user.id,
    client: createClient(Deno.env.get("SUPABASE_URL") ?? "", key, {
      global: { headers: { Authorization: `Bearer ${pass}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send a JSON body." }, 400);
  }

  if (body.action === "lessons") return await listLessons();
  if (body.action === "propose") return await propose();

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

  return json({ error: "Unknown action." }, 400);
}

// The lesson engine: prepares topics from real sources ahead of time, then writes and voices
// a lesson one chapter at a time, saving each chapter as it is made.
//
// POST { action: "prepare", topic }               read, take notes, outline, write the opening. Text only.
// POST { action: "topics" }                       prepared topics that have not been played yet.
// POST { action: "refill" }                       propose and prepare one more topic, if fewer than three are waiting.
// POST { action: "interests" }                    the listener's tags, and tags Pliny suggests.
// POST { action: "add_interest", label } / { action: "remove_interest", id }
// POST { action: "start", topic_id, minutes }     turn a prepared topic into a lesson. Instant, no model call.
// POST { action: "segment", lesson_id, position }  write and voice one chapter. Safe to call twice.
// POST { action: "get", lesson_id }               the lesson, its chapters, and links to finished audio.
// POST { action: "lessons" }                      lessons with something to replay, newest first.
// POST { action: "check", titles?: string[] }      free self-test. Calls no paid service.
// GET  ?lesson_id=...&position=...&apikey=...      the chapter's audio, played while it is being made.
//
// Why a lesson starts quickly: everything slow is done before the listener taps. Preparing a
// topic reads the sources, outlines the chapters and writes a one minute opening, all as
// text. Starting a lesson then only has to voice that opening, and the GET route sends the
// audio out while it is still being generated, so playback begins within a couple of seconds.
//
// No voice is made until it is asked for. The caller asks for chapters in order and stays a
// couple ahead of the listener, so an abandoned lesson costs only what was heard plus a buffer.
//
// How a lesson is grounded: a small model names Wikipedia articles worth reading, their text
// is fetched, and the writer model boils them down to short fact notes and an outline.
// Chapters are written from those notes. Dates, numbers and names come from the notes, never
// from the model's memory.
//
// Callers must send the project's publishable key, as an `apikey` header or query parameter.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const WRITER_MODEL = Deno.env.get("OPENAI_WRITER_MODEL") ?? "gpt-6.1-terra";
// Naming articles to read is a small job, so it goes to the cheapest model.
const SCOUT_MODEL = Deno.env.get("OPENAI_SCOUT_MODEL") ?? "gpt-6-luna";
const VOICE_MODEL = Deno.env.get("OPENAI_VOICE_MODEL") ?? "gpt-4o-mini-tts";
const VOICE = Deno.env.get("OPENAI_VOICE") ?? "cedar";
const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"];

const WORDS_PER_MINUTE = 150;
const MAX_MINUTES = 60;
// The opening plus ten chapters is enough for an hour.
const OUTLINE_CHAPTERS = 11;
const BUCKET = "lesson-audio";
// Wikipedia asks every client to say who it is.
const WIKI_AGENT = "LearningApp/0.1 (personal project; https://github.com/Poncheka/learning-app)";
const MAX_SOURCES = 5;
const SOURCE_CHARS = 14000;
// A chapter is voiced in a single request, because each request is a fresh performance and
// the narrator audibly shifts between them. The voice model takes about 2,000 tokens at a
// time, which is why no chapter is planned longer than six minutes. Splitting is only a
// fallback for a script that runs long.
const CHUNK_CHARS = 6500;
// Work claimed longer ago than this is assumed to have died and can be picked up again.
const STALE_MS = 4 * 60 * 1000;
const LINK_SECONDS = 6 * 60 * 60;

// The narrator's direction: who they are, their pace and their tone. The voice model has no
// speed setting, so pace is asked for in words. This is only the fallback. The live wording
// is the narrator_direction row in the settings table, which can be changed without a redeploy.
const VOICE_STYLE =
  "You are telling a friend something fascinating you just learned, across a kitchen table. " +
  "Relaxed and conversational, not a presenter and not a documentary announcer. " +
  "Pace: slow and easy, well under normal talking speed. Take your time. Let each sentence finish, " +
  "pause for a beat before the next one, and pause longer between ideas. " +
  "Tone: warm, low-key, a little amused at the surprising parts. " +
  "Keep exactly the same voice, pace and energy from the first word to the last. Never rushed, never performed.";

const SCOUT_BRIEF =
  "You help research an audio lesson. Name the English Wikipedia articles that would give the richest " +
  "material for the topic: one or two core articles, then narrower ones where the story lives. Look for " +
  "the people behind it, the argument over it, what it cost and what it changed, and any strange episode " +
  "along the way, not only the thing itself. " +
  "Use real article titles. Reply with only a JSON array of five strings.";

// The house view of what makes a lesson interesting. This is only the fallback: the live
// wording is the story_brief row in the settings table, which Jeff edits by ear.
const STORY_BRIEF =
  "Tell it like the best dinner-table storyteller you know, not like an encyclopedia. Find the angle first: " +
  "the question that makes someone lean in. Why did anyone want this? Who thought it was madness, and why " +
  "were they almost right? What was at stake, who paid for it, who got rich, who got hurt? What did it " +
  "change that we still live with? What is the strangest true thing about it? Lead with people, motives, " +
  "conflict and consequences. Describe how something was physically done only when the how is itself " +
  "astonishing, and then give it as one clear picture, not a procedure. Skip anything a listener could have " +
  "guessed. About once a minute the listener should think: wait, really?";

const plannerBrief = (story: string) =>
  "You are the researcher and planner for an audio lesson heard by one curious adult, often while driving. " +
  "You are given a topic and extracts from Wikipedia articles.\n\n" +
  `The house view of what makes a lesson worth hearing:\n${story}\n\n` +
  "First, choose the angle: one sentence naming the question or tension this lesson is really about. Use " +
  "your own general knowledge of the subject to choose it and to judge what matters.\n\n" +
  "Second, pull out fact notes that serve that angle: the most surprising, specific, story-worthy things in " +
  "the extracts. Motives, arguments, gambles, reversals, costs, consequences, strange details. Each note is " +
  "one or two sentences in your own words, understandable on its own, with every name, date and number " +
  "copied exactly from the extract. Note only what the extracts actually say, and say which article each " +
  "came from. Aim for about fifty notes, fewer if the extracts are thin.\n\n" +
  `Third, outline the lesson as an opening followed by up to ${OUTLINE_CHAPTERS - 1} chapters. The opening is a ` +
  "one minute cold open built on the single most surprising note or two. The listener picks the length " +
  "later, and a short lesson uses only the opening and the first few chapters. So put the best material " +
  "first, and make every chapter able to stand as the last one. A chapter is a turn in the story: a " +
  "question, a fight, a person, a consequence. It is not a step in a process. Give each a short title that " +
  "sounds natural read aloud, one sentence on what it is for, and the ids of the notes it is built on: one " +
  "or two for the opening, four to six for each chapter. Use each note in one place only. Stop adding " +
  "chapters when the notes run out.\n\n" +
  "Also give the lesson a title, and a hook: one sentence that would make someone want to hear it.\n\n" +
  'Reply with only JSON in this shape: {"title": "...", "hook": "...", "angle": "...", "facts": [{"id": 1, ' +
  '"fact": "...", "source": "Article title"}], "chapters": [{"title": "...", "brief": "...", "fact_ids": [1, 2]}]}';

const writerBrief = (story: string) =>
  "You write one chapter of an audio lesson that is read aloud to one curious adult, often while driving.\n\n" +
  `The house view of what makes a lesson worth hearing:\n${story}\n\n` +
  "Build the chapter around the fact notes you are given, and keep it pointed at the lesson's angle. " +
  "Be concrete: name the person or thing and say what happened. One vivid comparison beats three " +
  "adjectives. Cut any sentence that only sets up the next one. No 'today we will explore', no 'have you " +
  "ever wondered'.\n\n" +
  "Write for the ear: plain spoken sentences, one idea at a time, no lists, no headings, no markdown, " +
  "no parentheses, no stage directions. Spell out numbers the way a person would say them.\n\n" +
  "Accuracy matters more than color. Every date, number, name and quotation must come from the fact notes, " +
  "kept faithful to them. Use your own knowledge to connect ideas, give the big picture and say why " +
  "something mattered, never for a specific figure, date, name or quotation the notes do not support. " +
  "Do not repeat anything listed as already covered.\n\n" +
  "Reply with the narration only. Then, on its own line, write ===SUMMARY=== followed by two sentences " +
  "saying what this chapter covered, for the writer of the next chapter.";

const SUGGEST_BRIEF =
  "You suggest interests to a listener of Pliny, an audio app for the endlessly curious. Given the tags " +
  "they already have, name four more they are likely to enjoy: two close neighbors of what they like and " +
  "two a step further out. Each is one to three words, written like 'Himalayan trade' or 'Gutenberg'. " +
  "Do not repeat a tag they have. Reply with only a JSON array of four strings.";

const PROPOSER_BRIEF =
  "You choose what Pliny, an audio app for the endlessly curious, offers its listener next. Given their " +
  "interests, propose topics for audio lessons. Each topic is a specific story, not a field of study: a " +
  "place in a particular period, an invention, a gamble, a feud, a disaster, a strange episode, one " +
  "person's improbable project. It must be something Wikipedia covers in depth. Write each title the way " +
  "a magazine would put it on a cover: plain, short, six words at most, no colon and no question mark. " +
  "For example: 'Kathmandu, 1800 to 1900', 'How the Erie Canal got built', 'The printing press, invented'. " +
  "About one topic in four should wander off the listener's map, into something they did not ask for but " +
  "would be glad to hear. Never repeat a topic already offered. Reply with only a JSON array of strings.";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

class Problem extends Error {
  constructor(public status: number, message: string, public detail?: string) {
    super(message);
  }
}

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
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** A value from the settings table, which Jeff can change by hand, or the built-in default. */
async function setting(key: string, fallback: string): Promise<string> {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  const value = typeof data?.value === "string" ? data.value.trim() : "";
  return value || fallback;
}

async function narrator(): Promise<{ voice: string; direction: string }> {
  const voice = await setting("voice", VOICE);
  return { voice: VOICES.includes(voice) ? voice : VOICE, direction: await setting("narrator_direction", VOICE_STYLE) };
}

// ---------- OpenAI ----------

async function openaiProblem(step: string, res: Response): Promise<Problem> {
  let detail = await res.text();
  try {
    detail = JSON.parse(detail)?.error?.message ?? detail;
  } catch {
    // Keep the raw text.
  }
  return new Problem(502, `OpenAI failed while ${step}.`, `${res.status}: ${detail.slice(0, 500)}`);
}

async function ask(step: string, model: string, instructions: string, input: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, instructions, input }),
  });
  if (!res.ok) throw await openaiProblem(step, res);
  const data = await res.json();
  let text = "";
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") text += part.text;
    }
  }
  if (!text.trim()) throw new Problem(502, `OpenAI returned nothing while ${step}.`);
  return text.trim();
}

/** Reads JSON out of a model reply, tolerating code fences or a stray sentence around it. */
function parseJson(step: string, text: string, open: string, close: string): unknown {
  const from = text.indexOf(open);
  const to = text.lastIndexOf(close);
  try {
    if (from === -1 || to <= from) throw new Error("no JSON found");
    return JSON.parse(text.slice(from, to + 1));
  } catch {
    throw new Problem(502, `The model's reply could not be read while ${step}.`, text.slice(0, 300));
  }
}

/** Asks for speech. The reply's body arrives piece by piece while the audio is generated. */
async function speech(text: string, voice: string, direction: string): Promise<Response> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: VOICE_MODEL, voice, input: text, instructions: direction, response_format: "mp3" }),
  });
  if (!res.ok) throw await openaiProblem("voicing the chapter", res);
  return res;
}

function chunkScript(script: string): string[] {
  const sentences = script.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [script];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > CHUNK_CHARS) {
      chunks.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function speakAll(script: string, voice: string, direction: string): Promise<Uint8Array> {
  const parts = await Promise.all(
    chunkScript(script).map(async (chunk) => new Uint8Array(await (await speech(chunk, voice, direction)).arrayBuffer())),
  );
  const joined = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

// ---------- Wikipedia ----------

type Source = { title: string; url: string; text: string };

async function wiki(params: Record<string, string>): Promise<any> {
  const query = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${query}`, {
    headers: { "User-Agent": WIKI_AGENT, "Api-User-Agent": WIKI_AGENT },
  });
  if (!res.ok) throw new Problem(502, "Wikipedia could not be reached.", `${res.status}`);
  return await res.json();
}

/** Turns a guessed article name into a real page and its plain text, or null if there is none. */
async function readArticle(guess: string): Promise<Source | null> {
  const found = await wiki({ action: "query", list: "search", srsearch: guess, srlimit: "1" });
  const title = found?.query?.search?.[0]?.title;
  if (!title) return null;
  const page = await wiki({ action: "query", prop: "extracts", explaintext: "1", redirects: "1", titles: title });
  const hit = page?.query?.pages?.[0];
  const text = typeof hit?.extract === "string" ? hit.extract.trim() : "";
  if (text.length < 500) return null;
  return {
    title: hit.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`,
    text: text.slice(0, SOURCE_CHARS),
  };
}

async function readArticles(guesses: string[]): Promise<Source[]> {
  const results = await Promise.all(guesses.slice(0, MAX_SOURCES + 2).map((g) => readArticle(g).catch(() => null)));
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const source of results) {
    if (!source || seen.has(source.title)) continue;
    seen.add(source.title);
    sources.push(source);
  }
  return sources.slice(0, MAX_SOURCES);
}

// ---------- Preparing a topic ahead of time ----------

type Fact = { id: number; fact: string; source: string };
type Chapter = { title: string; brief: string; fact_ids: number[] };

const notesFor = (facts: Fact[], ids: number[]) => facts.filter((f) => ids.includes(f.id));
const noteLines = (notes: Fact[]) =>
  notes.map((f) => `- ${f.fact} (from ${f.source})`).join("\n") || "- None given. Stay general and state no specific figures.";

function splitReply(reply: string): { script: string; summary: string } {
  const [scriptPart, summaryPart] = reply.split("===SUMMARY===");
  return { script: scriptPart.trim(), summary: (summaryPart ?? "").trim() };
}

async function prepare(asked: string, proposed?: any) {
  let topic = proposed;
  if (!topic) {
    const { data, error } = await db.from("topics").insert({ asked, title: asked }).select().single();
    if (error) throw new Problem(500, "The topic could not be saved.", error.message);
    topic = data;
  }
  try {
    const story = await setting("story_brief", STORY_BRIEF);
    const guessesText = await ask("choosing what to read", SCOUT_MODEL, SCOUT_BRIEF, `Topic: ${asked}`);
    const guesses = (parseJson("choosing what to read", guessesText, "[", "]") as unknown[]).filter(
      (g): g is string => typeof g === "string",
    );
    const sources = await readArticles([...guesses, asked]);
    if (sources.length === 0) throw new Problem(502, "No Wikipedia articles could be found for that topic.");

    const planText = await ask(
      "outlining the lesson",
      WRITER_MODEL,
      plannerBrief(story),
      `Topic: ${asked}\n\n` + sources.map((s) => `=== ${s.title} ===\n${s.text}`).join("\n\n"),
    );
    const plan = parseJson("outlining the lesson", planText, "{", "}") as Record<string, unknown>;
    const facts: Fact[] = (Array.isArray(plan.facts) ? plan.facts : [])
      .filter((f: any) => f && typeof f.fact === "string" && Number.isFinite(Number(f.id)))
      .map((f: any) => ({ id: Number(f.id), fact: f.fact, source: String(f.source ?? "") }));
    const outline: Chapter[] = (Array.isArray(plan.chapters) ? plan.chapters : [])
      .filter((c: any) => c && typeof c.title === "string")
      .slice(0, OUTLINE_CHAPTERS)
      .map((c: any) => ({
        title: c.title.trim(),
        brief: String(c.brief ?? ""),
        fact_ids: (Array.isArray(c.fact_ids) ? c.fact_ids : []).map(Number),
      }));
    if (facts.length === 0 || outline.length < 2) {
      throw new Problem(502, "The outline came back incomplete. Try again.", `facts ${facts.length}, chapters ${outline.length}`);
    }
    const title = typeof plan.title === "string" && plan.title.trim() ? plan.title.trim() : asked;
    const angle = typeof plan.angle === "string" ? plan.angle.trim() : "";

    // The opening is written now, so that starting a lesson later only has to voice it.
    const opening = splitReply(
      await ask(
        "writing the opening",
        WRITER_MODEL,
        writerBrief(story),
        `Lesson: ${title}\nThe angle: ${angle || "not stated"}\n\nWrite the cold open: "${outline[0].title}"\nWhat it is for: ${outline[0].brief}\n` +
          `Length: about ${WORDS_PER_MINUTE} words, which is one minute read aloud.\n` +
          "Open on the most surprising note, with no greeting and no introduction. The listener has not yet " +
          "chosen how long the lesson will be, so end with one sentence that makes it clear there is more to " +
          "this story, without listing what comes next.\n\n" +
          `Fact notes for the opening:\n${noteLines(notesFor(facts, outline[0].fact_ids))}`,
      ),
    );

    const { data: ready, error: saveError } = await db
      .from("topics")
      .update({
        title,
        hook: typeof plan.hook === "string" ? plan.hook.trim() : "",
        angle,
        status: "ready",
        sources: sources.map(({ title, url }) => ({ title, url })),
        source_notes: facts,
        outline,
        opening_script: opening.script,
        opening_summary: opening.summary,
        prepared_at: new Date().toISOString(),
      })
      .eq("id", topic.id)
      .select()
      .single();
    if (saveError) throw new Problem(500, "The prepared topic could not be saved.", saveError.message);
    return describeTopic(ready);
  } catch (err) {
    const message = err instanceof Problem ? `${err.message} ${err.detail ?? ""}`.trim() : String(err);
    await db.from("topics").update({ status: "failed", error: message.slice(0, 500) }).eq("id", topic.id);
    throw err;
  }
}

function describeTopic(topic: any) {
  const outline: Chapter[] = Array.isArray(topic.outline) ? topic.outline : [];
  return {
    id: topic.id,
    title: topic.title,
    hook: topic.hook,
    sources: topic.sources,
    fact_count: Array.isArray(topic.source_notes) ? topic.source_notes.length : 0,
    chapters: outline.map((c) => c.title),
    max_minutes: Math.min(MAX_MINUTES, 1 + (outline.length - 1) * 6),
  };
}

/** Prepared topics that have never been started. Once a topic is played it lives in the Library. */
async function unplayedTopics(): Promise<any[]> {
  const { data } = await db.from("topics").select("*, lessons(id)").eq("status", "ready").order("prepared_at", { ascending: false }).limit(40);
  return (data ?? []).filter((t: any) => (t.lessons ?? []).length === 0);
}

async function listTopics() {
  return { topics: (await unplayedTopics()).slice(0, 6).map(describeTopic) };
}

// ---------- Interests and topic suggestions ----------

const MAX_TAGS = 10;
// How many prepared topics Pliny keeps waiting, so there is always something that starts at once.
const READY_TARGET = 3;

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : []);

async function listInterests() {
  const { data } = await db.from("interests").select("id, label").eq("hidden", false).order("created_at");
  const interests = data ?? [];
  const have = new Set(interests.map((t) => t.label.toLowerCase()));
  let suggestions: string[] = [];
  try {
    suggestions = strings(JSON.parse(await setting("interest_suggestions", "[]")));
  } catch {
    // Nothing usable saved. Show no suggestions.
  }
  return { interests, suggestions: suggestions.filter((s) => !have.has(s.toLowerCase())).slice(0, 4), max: MAX_TAGS };
}

async function refreshSuggestions() {
  const { data } = await db.from("interests").select("label").eq("hidden", false);
  const labels = (data ?? []).map((t) => t.label);
  if (labels.length === 0 || !OPENAI_KEY) return;
  try {
    const reply = await ask("suggesting interests", SCOUT_MODEL, SUGGEST_BRIEF, `Tags: ${labels.join(", ")}`);
    const list = strings(parseJson("suggesting interests", reply, "[", "]")).slice(0, 6);
    await db.from("settings").upsert({ key: "interest_suggestions", value: JSON.stringify(list), updated_at: new Date().toISOString() });
  } catch {
    // Suggestions are a nicety. The tags themselves are already saved.
  }
}

async function addInterest(label: string) {
  const { data: all } = await db.from("interests").select("id, label, hidden");
  const same = (all ?? []).find((t) => t.label.toLowerCase() === label.toLowerCase());
  if (same && !same.hidden) return await listInterests();
  if ((all ?? []).filter((t) => !t.hidden).length >= MAX_TAGS) throw new Problem(400, `You can have up to ${MAX_TAGS} tags. Remove one first.`);
  const { error } = same ? await db.from("interests").update({ hidden: false }).eq("id", same.id) : await db.from("interests").insert({ label });
  if (error) throw new Problem(500, "The tag could not be saved.", error.message);
  await refreshSuggestions();
  return await listInterests();
}

async function removeInterest(id: string) {
  // Hidden, not deleted, so anything learned about the tag is kept.
  await db.from("interests").update({ hidden: true }).eq("id", id);
  await refreshSuggestions();
  return await listInterests();
}

/**
 * Tops up the waiting topics, one per call, because preparing one takes about a minute.
 * If fewer than three are waiting, it proposes topics from the listener's interests and
 * prepares the next one. The app calls this quietly while the Listen screen is open.
 */
async function refill() {
  const ready = (await unplayedTopics()).length;
  const recent = new Date(Date.now() - STALE_MS).toISOString();
  const { count } = await db.from("topics").select("id", { count: "exact", head: true }).eq("status", "preparing").gt("proposed_at", recent);
  if (ready + (count ?? 0) >= READY_TARGET) return { ready, prepared: null };

  let { data: next } = await db.from("topics").select().eq("status", "proposed").order("proposed_at").limit(1).maybeSingle();
  if (!next) {
    const { data: tags } = await db.from("interests").select("label").eq("hidden", false);
    const { data: seen } = await db.from("topics").select("asked").order("proposed_at", { ascending: false }).limit(80);
    const reply = await ask(
      "proposing topics",
      SCOUT_MODEL,
      PROPOSER_BRIEF,
      `Interests: ${(tags ?? []).map((t) => t.label).join(", ") || "none listed yet, so range widely"}\n` +
        `Already offered: ${(seen ?? []).map((t) => t.asked).join("; ") || "nothing yet"}\n` +
        `Propose ${READY_TARGET} topics.`,
    );
    const titles = strings(parseJson("proposing topics", reply, "[", "]")).slice(0, READY_TARGET);
    if (titles.length === 0) throw new Problem(502, "No topics could be proposed. Try again.");
    const { data: rows, error } = await db.from("topics").insert(titles.map((t) => ({ asked: t.trim(), title: t.trim(), status: "proposed" }))).select();
    if (error || !rows?.length) throw new Problem(500, "The proposed topics could not be saved.", error?.message);
    next = rows[0];
  }

  // Claim it, so two calls at once cannot both pay to prepare the same topic.
  const { data: claimed } = await db
    .from("topics")
    .update({ status: "preparing", proposed_at: new Date().toISOString() })
    .eq("id", next.id)
    .eq("status", "proposed")
    .select()
    .maybeSingle();
  if (!claimed) return { ready, prepared: null };
  return { ready: ready + 1, prepared: await prepare(claimed.asked, claimed) };
}

/** Lessons that have at least one chapter made, newest first. This is what the Library shows. */
async function listLessons() {
  const { data } = await db
    .from("lessons")
    .select("id, title, chosen_minutes, started_at, segments(position, status)")
    .order("started_at", { ascending: false })
    .limit(40);
  const lessons = (data ?? [])
    .map((l: any) => ({
      id: l.id,
      title: l.title,
      chosen_minutes: l.chosen_minutes,
      started_at: l.started_at,
      chapters: l.segments.length,
      made: l.segments.filter((s: any) => s.status === "ready").length,
    }))
    .filter((l) => l.made > 0);
  return { lessons };
}

// ---------- Starting a lesson ----------

/**
 * Chapter lengths for a session: a one minute opening so the first audio is quick to make,
 * then chapters of four to six minutes that add up to exactly the minutes chosen.
 */
function chapterLengths(minutes: number): number[] {
  if (minutes <= 2) return [minutes];
  const rest = minutes - 1;
  const count = Math.ceil(rest / 6);
  const base = Math.floor(rest / count);
  let extra = rest - base * count;
  return [1, ...Array.from({ length: count }, () => base + (extra-- > 0 ? 1 : 0))];
}

async function start(topicId: string, minutes: number) {
  const { data: topic } = await db.from("topics").select().eq("id", topicId).maybeSingle();
  if (!topic) throw new Problem(404, "No topic with that id.");
  if (topic.status !== "ready") throw new Problem(409, `That topic is not ready yet. It is "${topic.status}".`);
  const outline: Chapter[] = topic.outline;

  // A lesson can be no longer than its outline. If it runs short, the lesson is shortened to fit.
  const lengths = chapterLengths(minutes).slice(0, outline.length);
  const total = lengths.reduce((sum, m) => sum + m, 0);

  // The same topic at the same length is the same lesson. Hand back the one that exists,
  // so its saved audio is reused and nothing is paid for twice.
  const { data: existing } = await db
    .from("lessons")
    .select("id")
    .eq("topic_id", topic.id)
    .eq("chosen_minutes", total)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return await get(existing.id);

  // The opening is the same whatever length is chosen. If it has been voiced before, for a
  // lesson of another length, that recording is used again.
  const { data: voiced } = await db
    .from("segments")
    .select("audio_path, voice, voice_model, lessons!inner(topic_id)")
    .eq("position", 1)
    .eq("status", "ready")
    .eq("lessons.topic_id", topic.id)
    .limit(1)
    .maybeSingle();

  const { data: lesson, error: lessonError } = await db
    .from("lessons")
    .insert({
      topic_id: topic.id,
      topic: topic.asked,
      title: topic.title,
      chosen_minutes: total,
      angle: topic.angle,
      source_notes: topic.source_notes,
      sources: topic.sources,
      covered_summary: `Chapter 1, ${outline[0].title}: ${topic.opening_summary || "the opening."}`,
      writer_model: WRITER_MODEL,
    })
    .select()
    .single();
  if (lessonError) throw new Problem(500, "The lesson could not be saved.", lessonError.message);

  const sourcesByTitle = new Map<string, any>((topic.sources ?? []).map((s: any) => [s.title, s]));
  const openingRefs = [...new Set(notesFor(topic.source_notes, outline[0].fact_ids).map((f) => f.source))].map(
    (t) => sourcesByTitle.get(t) ?? { title: t },
  );
  // The opening arrives already written. Every row carries the same fields, filled or
  // empty, because rows saved together in one request must all have the same shape.
  const rows = lengths.map((target_minutes, i) => ({
    lesson_id: lesson.id,
    position: i + 1,
    title: outline[i].title,
    target_minutes,
    brief: outline[i].brief,
    fact_ids: outline[i].fact_ids,
    script: i === 0 ? topic.opening_script : null,
    summary: i === 0 ? topic.opening_summary : null,
    writer_model: i === 0 ? WRITER_MODEL : null,
    source_refs: i === 0 ? openingRefs : [],
    status: i === 0 && voiced ? "ready" : "planned",
    audio_path: i === 0 && voiced ? voiced.audio_path : null,
    voice: i === 0 && voiced ? voiced.voice : null,
    voice_model: i === 0 && voiced ? voiced.voice_model : null,
    ready_at: i === 0 && voiced ? new Date().toISOString() : null,
  }));
  const { error: segmentsError } = await db.from("segments").insert(rows);
  if (segmentsError) {
    // Do not leave a lesson behind with no chapters in it.
    await db.from("lessons").delete().eq("id", lesson.id);
    throw new Problem(500, "The chapters could not be saved.", segmentsError.message);
  }
  return await get(lesson.id);
}

// ---------- Reading back ----------

async function link(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await db.storage.from(BUCKET).createSignedUrl(path, LINK_SECONDS);
  return data?.signedUrl ?? null;
}

async function describe(segment: any) {
  return {
    position: segment.position,
    title: segment.title,
    target_minutes: segment.target_minutes,
    status: segment.status,
    error: segment.error,
    script: segment.script,
    source_refs: segment.source_refs,
    audio_url: segment.status === "ready" ? await link(segment.audio_path) : null,
  };
}

async function get(lessonId: string) {
  const { data: lesson } = await db.from("lessons").select().eq("id", lessonId).maybeSingle();
  if (!lesson) throw new Problem(404, "No lesson with that id.");
  const { data: segments } = await db.from("segments").select().eq("lesson_id", lessonId).order("position");
  return {
    id: lesson.id,
    title: lesson.title,
    topic: lesson.topic,
    chosen_minutes: lesson.chosen_minutes,
    sources: lesson.sources,
    fact_count: Array.isArray(lesson.source_notes) ? lesson.source_notes.length : 0,
    segments: await Promise.all((segments ?? []).map(describe)),
  };
}

// ---------- Writing and voicing one chapter ----------

async function load(lessonId: string, position: number) {
  const { data: lesson } = await db.from("lessons").select().eq("id", lessonId).maybeSingle();
  if (!lesson) throw new Problem(404, "No lesson with that id.");
  const { data: all } = await db.from("segments").select().eq("lesson_id", lessonId).order("position");
  const segments = all ?? [];
  const segment = segments.find((s) => s.position === position);
  if (!segment) throw new Problem(404, "That lesson has no chapter at that position.");
  return { lesson, segments, segment };
}

/** Claims a chapter, so two requests for the same one cannot both pay to make it. */
async function claim(segment: any): Promise<boolean> {
  const stale = new Date(Date.now() - STALE_MS).toISOString();
  const { data } = await db
    .from("segments")
    .update({ status: segment.script ? "voicing" : "writing", error: null, claimed_at: new Date().toISOString() })
    .eq("id", segment.id)
    .or(`status.in.(planned,failed),claimed_at.lt."${stale}"`)
    .neq("status", "ready")
    .select()
    .maybeSingle();
  return Boolean(data);
}

async function fail(segment: any, err: unknown) {
  const message = err instanceof Problem ? `${err.message} ${err.detail ?? ""}`.trim() : String(err);
  await db.from("segments").update({ status: "failed", error: message.slice(0, 500) }).eq("id", segment.id);
}

/** Returns the chapter's script, writing it first if that has not been done. */
async function ensureScript(lesson: any, segments: any[], segment: any): Promise<string> {
  if (segment.script) return segment.script;
  // Chapters are written in order, because each one is told what the earlier ones covered.
  const previous = segments.find((s) => s.position === segment.position - 1);
  if (previous && !previous.script) throw new Problem(409, "The chapter before this one has not been written yet.");

  const facts: Fact[] = Array.isArray(lesson.source_notes) ? lesson.source_notes : [];
  const mine = notesFor(facts, segment.fact_ids ?? []);
  const sourcesByTitle = new Map<string, any>((lesson.sources ?? []).map((s: any) => [s.title, s]));
  const sourceRefs = [...new Set(mine.map((f) => f.source))].map((t) => sourcesByTitle.get(t) ?? { title: t });
  const next = segments.find((s) => s.position === segment.position + 1);
  const ending = next
    ? `End with one sentence that leans toward the next chapter, which is "${next.title}", without summarizing it.`
    : "This is the last chapter. End the whole lesson on one line that leaves the listener with something to think about.";

  const { script, summary } = splitReply(
    await ask(
      "writing the chapter",
      WRITER_MODEL,
      writerBrief(await setting("story_brief", STORY_BRIEF)),
      `Lesson: ${lesson.title}\nThe angle: ${lesson.angle || "not stated"}\nChapters: ${segments.map((s) => `${s.position}. ${s.title}`).join("; ")}\n\n` +
        `Write chapter ${segment.position}: "${segment.title}"\nWhat it is for: ${segment.brief}\n` +
        `Length: about ${segment.target_minutes * WORDS_PER_MINUTE} words, which is ${segment.target_minutes} minutes read aloud.\n` +
        "This continues a lesson already under way. Do not greet the listener or reintroduce the topic. " +
        `Pick up as the next part of the same telling.\n${ending}\n\n` +
        `Already covered in earlier chapters:\n${lesson.covered_summary || "Nothing yet."}\n\n` +
        `Fact notes for this chapter:\n${noteLines(mine)}`,
    ),
  );
  await db.from("segments").update({ script, summary, source_refs: sourceRefs, status: "voicing", writer_model: WRITER_MODEL }).eq("id", segment.id);
  await db
    .from("lessons")
    .update({ covered_summary: `${lesson.covered_summary}\nChapter ${segment.position}, ${segment.title}: ${summary || "no summary given."}`.trim() })
    .eq("id", lesson.id);
  return script;
}

async function saveAudio(segment: any, audio: Uint8Array, voice: string) {
  const path = `${segment.lesson_id}/${String(segment.position).padStart(2, "0")}.mp3`;
  const { error } = await db.storage.from(BUCKET).upload(path, audio, { contentType: "audio/mpeg", upsert: true });
  if (error) throw new Problem(500, "The audio could not be saved.", error.message);
  const { data } = await db
    .from("segments")
    .update({ status: "ready", audio_path: path, voice_model: VOICE_MODEL, voice, ready_at: new Date().toISOString() })
    .eq("id", segment.id)
    .select()
    .single();
  return data;
}

/** Makes a chapter and answers when it is finished and saved. Used to stay ahead of the listener. */
async function makeSegment(lessonId: string, position: number) {
  const { lesson, segments, segment } = await load(lessonId, position);
  if (segment.status === "ready" || !(await claim(segment))) return await describe(segment);
  try {
    const script = await ensureScript(lesson, segments, segment);
    const { voice, direction } = await narrator();
    return await describe(await saveAudio(segment, await speakAll(script, voice, direction), voice));
  } catch (err) {
    await fail(segment, err);
    throw err;
  }
}

/**
 * Sends a chapter's audio to the listener while it is still being generated, and saves a
 * copy as it goes by. If the listener leaves partway, the copy is still finished and saved.
 */
async function streamSegment(lessonId: string, position: number): Promise<Response> {
  const { lesson, segments, segment } = await load(lessonId, position);
  const saved = async (s: any) => Response.redirect((await link(s.audio_path)) ?? "", 302);
  if (segment.status === "ready") return await saved(segment);

  if (!(await claim(segment))) {
    // Someone else is already making it. Wait for them instead of paying twice.
    for (let waited = 0; waited < 110_000; waited += 2000) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const { data } = await db.from("segments").select().eq("id", segment.id).single();
      if (data?.status === "ready") return await saved(data);
      if (data?.status === "failed") break;
    }
    throw new Problem(503, "That chapter is still being made. Try again in a moment.");
  }

  try {
    const script = await ensureScript(lesson, segments, segment);
    const { voice, direction } = await narrator();
    if (script.length > CHUNK_CHARS) {
      const audio = await speakAll(script, voice, direction);
      await saveAudio(segment, audio, voice);
      return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
    }
    const res = await speech(script, voice, direction);
    const [toListener, toArchive] = res.body!.tee();
    EdgeRuntime.waitUntil(
      new Response(toArchive)
        .arrayBuffer()
        .then((buffer) => saveAudio(segment, new Uint8Array(buffer), voice))
        .catch((err) => fail(segment, err)),
    );
    return new Response(toListener, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (err) {
    await fail(segment, err);
    throw err;
  }
}

// ---------- A free self-test ----------

async function check(titles: unknown) {
  const reach = async (table: string) => {
    const { error } = await db.from(table).select("*").limit(1);
    return error ? `problem: ${error.message}` : "reachable";
  };
  const { data: bucket, error: bucketError } = await db.storage.getBucket(BUCKET);
  const result: Record<string, unknown> = {
    ok: true,
    openaiKeySet: OPENAI_KEY.length > 0,
    tables: { topics: await reach("topics"), lessons: await reach("lessons"), segments: await reach("segments") },
    audioBucket: bucketError || !bucket ? `problem: ${bucketError?.message ?? "missing"}` : "reachable",
    writerModel: WRITER_MODEL,
    scoutModel: SCOUT_MODEL,
    voiceModel: VOICE_MODEL,
    narrator: await narrator(),
    chapterLengths: { 3: chapterLengths(3), 8: chapterLengths(8), 15: chapterLengths(15), 30: chapterLengths(30), 60: chapterLengths(60) },
  };
  if (Array.isArray(titles)) {
    const sources = await readArticles(titles.filter((t): t is string => typeof t === "string"));
    result.wikipedia = sources.map((s) => ({ title: s.title, url: s.url, chars: s.text.length }));
  }
  return result;
}

const isId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);

function answer(err: unknown): Response {
  if (err instanceof Problem) {
    if (err.status >= 500) console.error(`lesson: ${err.message} ${err.detail ?? ""}`);
    return json({ error: err.message, detail: err.detail }, err.status);
  }
  console.error("lesson failed:", err);
  return json({ error: "Something went wrong in the function. Check its logs." }, 500);
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const key = req.headers.get("apikey") ?? url.searchParams.get("apikey") ?? "";
  if (!key || !allowedKeys().includes(key)) return json({ error: "Missing or wrong apikey." }, 401);

  // Audio players ask with GET, so the streaming route is the only one that answers it.
  if (req.method === "GET") {
    try {
      const lessonId = url.searchParams.get("lesson_id");
      const position = Number(url.searchParams.get("position"));
      if (!isId(lessonId) || !Number.isInteger(position) || position < 1) throw new Problem(400, "Give a lesson_id and a position.");
      if (!OPENAI_KEY) throw new Problem(500, "OPENAI_API_KEY is not set as an edge function secret.");
      return await streamSegment(lessonId, position);
    } catch (err) {
      return answer(err);
    }
  }
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send a JSON body." }, 400);
  }

  try {
    if (body.action === "check") return json(await check(body.titles));
    if (body.action === "topics") return json(await listTopics());
    if (body.action === "lessons") return json(await listLessons());
    if (body.action === "interests") return json(await listInterests());
    if (body.action === "remove_interest") {
      if (!isId(body.id)) throw new Problem(400, "Give the tag's id.");
      return json(await removeInterest(body.id));
    }
    if (body.action === "get") {
      if (!isId(body.lesson_id)) throw new Problem(400, "Give a lesson_id.");
      return json(await get(body.lesson_id));
    }
    if (body.action === "start") {
      const minutes = Math.round(Number(body.minutes));
      if (!isId(body.topic_id)) throw new Problem(400, "Give a topic_id.");
      if (!Number.isFinite(minutes) || minutes < 2 || minutes > MAX_MINUTES) {
        throw new Problem(400, `Minutes must be between 2 and ${MAX_MINUTES}.`);
      }
      return json(await start(body.topic_id, minutes));
    }

    if (!OPENAI_KEY) throw new Problem(500, "OPENAI_API_KEY is not set as an edge function secret.");
    if (body.action === "refill") return json(await refill());
    if (body.action === "add_interest") {
      const label = typeof body.label === "string" ? body.label.trim().replace(/\s+/g, " ").slice(0, 40) : "";
      if (!label) throw new Problem(400, "Give a tag.");
      return json(await addInterest(label));
    }
    if (body.action === "prepare") {
      const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
      if (!topic) throw new Problem(400, "Give a topic.");
      return json(await prepare(topic));
    }
    if (body.action === "segment") {
      const position = Number(body.position);
      if (!isId(body.lesson_id)) throw new Problem(400, "Give a lesson_id.");
      if (!Number.isInteger(position) || position < 1) throw new Problem(400, "Give a chapter position.");
      return json(await makeSegment(body.lesson_id, position));
    }
    throw new Problem(400, "Unknown action.");
  } catch (err) {
    return answer(err);
  }
});

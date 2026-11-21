// The lesson engine: prepares topics from real sources ahead of time, then writes and voices
// a lesson one chapter at a time, saving each chapter as it is made.
//
// POST { action: "prepare", topic }               read, take notes, outline, write the opening. Text only.
// POST { action: "topics" }                       topics that are prepared and ready to start.
// POST { action: "start", topic_id, minutes }     turn a prepared topic into a lesson. Instant, no model call.
// POST { action: "segment", lesson_id, position }  write and voice one chapter. Safe to call twice.
// POST { action: "get", lesson_id }               the lesson, its chapters, and links to finished audio.
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
  "material for the topic: two core articles, then three narrower ones where the strange, specific, " +
  "story-worthy details live, such as a particular species, person, event, place or experiment. " +
  "Use real article titles. Reply with only a JSON array of five strings.";

const PLANNER_BRIEF =
  "You are the researcher and planner for an audio lesson heard by one curious adult, often while driving. " +
  "You are given a topic and extracts from Wikipedia articles.\n\n" +
  "First, pull out fact notes: the most surprising, specific, story-worthy things in the extracts that fit " +
  "the topic. Strange mechanisms, named species, people, places, experiments, records, consequences nobody " +
  "expects. Skip the overview anyone could guess. Each note is one or two sentences in your own words, " +
  "understandable on its own, with every name, date and number copied exactly from the extract. Note only " +
  "what the extracts actually say, and say which article each came from. Aim for about fifty notes, fewer " +
  "if the extracts are thin.\n\n" +
  `Then outline the lesson as an opening followed by up to ${OUTLINE_CHAPTERS - 1} chapters. The opening is a ` +
  "one minute cold open built on the single most surprising note or two. The listener picks the length " +
  "later, and a short lesson uses only the opening and the first few chapters. So put the best material " +
  "first, and make every chapter able to stand as the last one. Give each a short title that sounds " +
  "natural read aloud, one sentence on what it is for, and the ids of the notes it is built on: one or two " +
  "for the opening, four to six for each chapter. Use each note in one place only. Stop adding chapters " +
  "when the notes run out.\n\n" +
  "Also give the lesson a title, and a hook: one sentence that would make someone want to hear it.\n\n" +
  'Reply with only JSON in this shape: {"title": "...", "hook": "...", "facts": [{"id": 1, "fact": "...", ' +
  '"source": "Article title"}], "chapters": [{"title": "...", "brief": "...", "fact_ids": [1, 2]}]}';

const WRITER_BRIEF =
  "You write one chapter of an audio lesson that is read aloud to one curious adult, often while driving.\n\n" +
  "What makes it worth hearing: about once a minute the listener should think 'wait, really?'. Build the " +
  "chapter around the fact notes you are given. For each one, explain how or why it works, because the " +
  "mechanism is where the interest is. Be concrete: name the thing and say what it does. One vivid " +
  "comparison beats three adjectives. Cut any sentence that only sets up the next one. No 'today we will " +
  "explore', no 'have you ever wondered'.\n\n" +
  "Write for the ear: plain spoken sentences, one idea at a time, no lists, no headings, no markdown, " +
  "no parentheses, no stage directions. Spell out numbers the way a person would say them.\n\n" +
  "Accuracy matters more than color. Every date, number, name and quotation must come from the fact notes, " +
  "kept faithful to them. Use your own knowledge only to connect ideas and explain how things work, never " +
  "for a specific figure, date or claim the notes do not support. If the notes do not cover something, " +
  "leave it out. Do not repeat anything listed as already covered.\n\n" +
  "Reply with the narration only. Then, on its own line, write ===SUMMARY=== followed by two sentences " +
  "saying what this chapter covered, for the writer of the next chapter.";

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

async function prepare(asked: string) {
  const { data: topic, error } = await db.from("topics").insert({ asked, title: asked }).select().single();
  if (error) throw new Problem(500, "The topic could not be saved.", error.message);
  try {
    const guessesText = await ask("choosing what to read", SCOUT_MODEL, SCOUT_BRIEF, `Topic: ${asked}`);
    const guesses = (parseJson("choosing what to read", guessesText, "[", "]") as unknown[]).filter(
      (g): g is string => typeof g === "string",
    );
    const sources = await readArticles([...guesses, asked]);
    if (sources.length === 0) throw new Problem(502, "No Wikipedia articles could be found for that topic.");

    const planText = await ask(
      "outlining the lesson",
      WRITER_MODEL,
      PLANNER_BRIEF,
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

    // The opening is written now, so that starting a lesson later only has to voice it.
    const opening = splitReply(
      await ask(
        "writing the opening",
        WRITER_MODEL,
        WRITER_BRIEF,
        `Lesson: ${title}\n\nWrite the cold open: "${outline[0].title}"\nWhat it is for: ${outline[0].brief}\n` +
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

async function listTopics() {
  const { data } = await db.from("topics").select().eq("status", "ready").order("prepared_at", { ascending: false }).limit(20);
  return { topics: (data ?? []).map(describeTopic) };
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
  const { data: lesson, error: lessonError } = await db
    .from("lessons")
    .insert({
      topic_id: topic.id,
      topic: topic.asked,
      title: topic.title,
      chosen_minutes: lengths.reduce((sum, m) => sum + m, 0),
      source_notes: topic.source_notes,
      sources: topic.sources,
      covered_summary: `Chapter 1, ${outline[0].title}: ${topic.opening_summary || "the opening."}`,
      writer_model: WRITER_MODEL,
    })
    .select()
    .single();
  if (lessonError) throw new Problem(500, "The lesson could not be saved.", lessonError.message);

  const sourcesByTitle = new Map<string, any>((topic.sources ?? []).map((s: any) => [s.title, s]));
  const rows = lengths.map((target_minutes, i) => ({
    lesson_id: lesson.id,
    position: i + 1,
    title: outline[i].title,
    target_minutes,
    brief: outline[i].brief,
    fact_ids: outline[i].fact_ids,
    // The opening arrives already written.
    ...(i === 0
      ? {
          script: topic.opening_script,
          summary: topic.opening_summary,
          writer_model: WRITER_MODEL,
          source_refs: [...new Set(notesFor(topic.source_notes, outline[0].fact_ids).map((f) => f.source))].map(
            (t) => sourcesByTitle.get(t) ?? { title: t },
          ),
        }
      : {}),
  }));
  const { error: segmentsError } = await db.from("segments").insert(rows);
  if (segmentsError) throw new Problem(500, "The chapters could not be saved.", segmentsError.message);
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
      WRITER_BRIEF,
      `Lesson: ${lesson.title}\nChapters: ${segments.map((s) => `${s.position}. ${s.title}`).join("; ")}\n\n` +
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
    throw new Problem(400, "Unknown action. Use prepare, topics, start, segment, get or check.");
  } catch (err) {
    return answer(err);
  }
});

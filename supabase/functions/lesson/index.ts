// The lesson engine: plans a lesson from real sources, then writes and voices it one chapter
// at a time, saving each chapter as it is made.
//
// POST { action: "start", topic, minutes }       research + plan. Returns the lesson and its chapters.
// POST { action: "segment", lesson_id, position }  write and voice one chapter. Safe to call twice.
// POST { action: "get", lesson_id }               the lesson, its chapters, and links to finished audio.
// POST { action: "check", titles?: string[] }      free self-test. Calls no paid service.
//
// Nothing is voiced until it is asked for. The caller asks for chapters in order and stays a
// couple ahead of the listener, so an abandoned lesson costs only what was heard plus a buffer.
//
// How a lesson is grounded: a small model names Wikipedia articles worth reading, their text
// is fetched, and the writer model boils them down to short fact notes and a chapter plan.
// Chapters are written from those notes. Dates, numbers and names come from the notes, never
// from the model's memory.
//
// Callers must send the project's publishable key in the `apikey` header (see config.toml).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const WRITER_MODEL = Deno.env.get("OPENAI_WRITER_MODEL") ?? "gpt-6.1-terra";
// Naming articles to read is a small job, so it goes to the cheapest model.
const SCOUT_MODEL = Deno.env.get("OPENAI_SCOUT_MODEL") ?? "gpt-6-luna";
const VOICE_MODEL = Deno.env.get("OPENAI_VOICE_MODEL") ?? "gpt-4o-mini-tts";
const VOICE = Deno.env.get("OPENAI_VOICE") ?? "cedar";

const WORDS_PER_MINUTE = 150;
const MAX_MINUTES = 60;
const BUCKET = "lesson-audio";
// Wikipedia asks every client to say who it is.
const WIKI_AGENT = "LearningApp/0.1 (personal project; https://github.com/Poncheka/learning-app)";
const MAX_SOURCES = 5;
const SOURCE_CHARS = 14000;
// A chapter is voiced in a single request, because each request is a fresh performance and
// the narrator audibly shifts between them. The voice model takes about 2,000 tokens at a
// time, which is why no chapter is planned longer than six minutes. This is only a fallback
// for a script that runs long.
const CHUNK_CHARS = 6500;
// Work claimed longer ago than this is assumed to have died and can be picked up again.
const STALE_MS = 4 * 60 * 1000;
const LINK_SECONDS = 6 * 60 * 60;

const VOICE_STYLE =
  "You are the narrator of a thoughtful audio documentary, talking to one person. " +
  "Pace: slow and measured, clearly slower than everyday conversation, with a real pause after each idea. " +
  "Tone: warm, calm and curious, with quiet delight at the surprising parts. " +
  "Keep exactly the same voice, pace and energy from the first word to the last. Never rushed, never theatrical.";

const SCOUT_BRIEF =
  "You help research an audio lesson. Name the English Wikipedia articles that would give the richest " +
  "material for the topic: two core articles, then three narrower ones where the strange, specific, " +
  "story-worthy details live, such as a particular species, person, event, place or experiment. " +
  "Use real article titles. Reply with only a JSON array of five strings.";

const PLANNER_BRIEF =
  "You are the researcher and planner for an audio lesson heard by one curious adult, often while driving. " +
  "You are given a topic, extracts from Wikipedia articles, and a list of chapter lengths.\n\n" +
  "First, pull out fact notes: the most surprising, specific, story-worthy things in the extracts that fit " +
  "the topic. Strange mechanisms, named species, people, places, experiments, records, consequences nobody " +
  "expects. Skip the overview anyone could guess. Each note is one or two sentences in your own words, " +
  "understandable on its own, with every name, date and number copied exactly from the extract. Note only " +
  "what the extracts actually say, and say which article each came from. Aim for about six notes per chapter.\n\n" +
  "Then plan the chapters, one per length given, in order. The first chapter opens on the single best hook. " +
  "The chapters should build on each other and the last should land somewhere worth ending. Give each a short " +
  "title that sounds natural read aloud, one sentence on what it is for, and the ids of the notes it is built " +
  "on. Use each note in one chapter only. A three minute chapter needs three or four notes, a five minute " +
  "chapter five to seven.\n\n" +
  'Reply with only JSON in this shape: {"title": "lesson title", "facts": [{"id": 1, "fact": "...", ' +
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

async function speak(text: string): Promise<Uint8Array> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: VOICE_MODEL, voice: VOICE, input: text, instructions: VOICE_STYLE, response_format: "mp3" }),
  });
  if (!res.ok) throw await openaiProblem("voicing the chapter", res);
  return new Uint8Array(await res.arrayBuffer());
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

async function speakAll(script: string): Promise<Uint8Array> {
  const parts = await Promise.all(chunkScript(script).map(speak));
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

// ---------- Planning ----------

/**
 * Chapter lengths for a session. The first is three minutes so audio can start quickly,
 * the rest are five, and the tail is shaped so the total lands on the minutes chosen.
 */
function chapterLengths(minutes: number): number[] {
  if (minutes <= 6) return [minutes];
  const lengths = [3];
  let left = minutes - 3;
  while (left > 0) {
    if (left <= 6) {
      if (left < 2) lengths[lengths.length - 1] += left;
      else lengths.push(left);
      left = 0;
    } else if (left <= 8) {
      lengths.push(Math.ceil(left / 2), Math.floor(left / 2));
      left = 0;
    } else {
      lengths.push(5);
      left -= 5;
    }
  }
  return lengths;
}

type Fact = { id: number; fact: string; source: string };

async function start(topic: string, minutes: number) {
  const guessesText = await ask("choosing what to read", SCOUT_MODEL, SCOUT_BRIEF, `Topic: ${topic}`);
  const guesses = (parseJson("choosing what to read", guessesText, "[", "]") as unknown[]).filter(
    (g): g is string => typeof g === "string",
  );
  const sources = await readArticles([...guesses, topic]);
  if (sources.length === 0) throw new Problem(502, "No Wikipedia articles could be found for that topic.");

  const lengths = chapterLengths(minutes);
  const planText = await ask(
    "planning the lesson",
    WRITER_MODEL,
    PLANNER_BRIEF,
    `Topic: ${topic}\n\nChapter lengths in minutes, in order: ${lengths.join(", ")}\n\n` +
      sources.map((s) => `=== ${s.title} ===\n${s.text}`).join("\n\n"),
  );
  const plan = parseJson("planning the lesson", planText, "{", "}") as {
    title?: unknown;
    facts?: unknown;
    chapters?: unknown;
  };

  const facts: Fact[] = (Array.isArray(plan.facts) ? plan.facts : [])
    .filter((f: any) => f && typeof f.fact === "string" && Number.isFinite(Number(f.id)))
    .map((f: any) => ({ id: Number(f.id), fact: f.fact, source: String(f.source ?? "") }));
  const chapters = (Array.isArray(plan.chapters) ? plan.chapters : []).filter(
    (c: any) => c && typeof c.title === "string",
  );
  if (facts.length === 0 || chapters.length < lengths.length) {
    throw new Problem(502, "The plan came back incomplete. Try again.", `facts ${facts.length}, chapters ${chapters.length}`);
  }

  const { data: lesson, error: lessonError } = await db
    .from("lessons")
    .insert({
      topic,
      title: typeof plan.title === "string" && plan.title.trim() ? plan.title.trim() : topic,
      chosen_minutes: minutes,
      source_notes: facts,
      sources: sources.map(({ title, url }) => ({ title, url })),
      writer_model: WRITER_MODEL,
    })
    .select()
    .single();
  if (lessonError) throw new Problem(500, "The lesson could not be saved.", lessonError.message);

  const rows = lengths.map((target_minutes, i) => ({
    lesson_id: lesson.id,
    position: i + 1,
    title: String((chapters[i] as any).title).trim(),
    target_minutes,
    brief: String((chapters[i] as any).brief ?? ""),
    fact_ids: (Array.isArray((chapters[i] as any).fact_ids) ? (chapters[i] as any).fact_ids : []).map(Number),
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

async function makeSegment(lessonId: string, position: number) {
  const { data: lesson } = await db.from("lessons").select().eq("id", lessonId).maybeSingle();
  if (!lesson) throw new Problem(404, "No lesson with that id.");
  const { data: all } = await db.from("segments").select().eq("lesson_id", lessonId).order("position");
  const segments = all ?? [];
  const segment = segments.find((s) => s.position === position);
  if (!segment) throw new Problem(404, "That lesson has no chapter at that position.");
  if (segment.status === "ready") return await describe(segment);

  // Chapters are written in order, because each one is told what the earlier ones covered.
  const previous = segments.find((s) => s.position === position - 1);
  if (previous && !previous.script) throw new Problem(409, "The chapter before this one has not been written yet.");

  // Claim the work, so two requests for the same chapter cannot both pay to make it.
  const stale = new Date(Date.now() - STALE_MS).toISOString();
  const { data: claimed } = await db
    .from("segments")
    .update({ status: "writing", error: null, claimed_at: new Date().toISOString() })
    .eq("id", segment.id)
    .or(`status.in.(planned,failed),claimed_at.lt."${stale}"`)
    .neq("status", "ready")
    .select()
    .maybeSingle();
  if (!claimed) return await describe(segment);

  try {
    const facts: Fact[] = Array.isArray(lesson.source_notes) ? lesson.source_notes : [];
    const mine = facts.filter((f) => (segment.fact_ids ?? []).includes(f.id));
    const sourcesByTitle = new Map<string, any>((lesson.sources ?? []).map((s: any) => [s.title, s]));
    const sourceRefs = [...new Set(mine.map((f) => f.source))].map((t) => sourcesByTitle.get(t) ?? { title: t });

    const isFirst = position === 1;
    const next = segments.find((s) => s.position === position + 1);
    const words = segment.target_minutes * WORDS_PER_MINUTE;
    const place = isFirst
      ? "This is the first chapter. Open cold on the most surprising note, with no greeting and no introduction."
      : "This continues a lesson already under way. Do not greet the listener or reintroduce the topic. Pick up as the next part of the same telling.";
    const ending = next
      ? `End with one sentence that leans toward the next chapter, which is "${next.title}", without summarizing it.`
      : "This is the last chapter. End the whole lesson on one line that leaves the listener with something to think about.";

    const reply = await ask(
      "writing the chapter",
      WRITER_MODEL,
      WRITER_BRIEF,
      `Lesson: ${lesson.title}\nChapters: ${segments.map((s) => `${s.position}. ${s.title}`).join("; ")}\n\n` +
        `Write chapter ${position}: "${segment.title}"\nWhat it is for: ${segment.brief}\n` +
        `Length: about ${words} words, which is ${segment.target_minutes} minutes read aloud.\n${place}\n${ending}\n\n` +
        `Already covered in earlier chapters:\n${lesson.covered_summary || "Nothing yet."}\n\n` +
        `Fact notes for this chapter:\n${mine.map((f) => `- ${f.fact} (from ${f.source})`).join("\n") || "- None given. Stay general and state no specific figures."}`,
    );
    const [scriptPart, summaryPart] = reply.split("===SUMMARY===");
    const script = scriptPart.trim();
    const summary = (summaryPart ?? "").trim();

    await db.from("segments").update({ script, summary, source_refs: sourceRefs, status: "voicing", writer_model: WRITER_MODEL }).eq("id", segment.id);
    await db
      .from("lessons")
      .update({ covered_summary: `${lesson.covered_summary}${lesson.covered_summary ? "\n" : ""}Chapter ${position}, ${segment.title}: ${summary || "no summary given."}` })
      .eq("id", lessonId);

    const audio = await speakAll(script);
    const path = `${lessonId}/${String(position).padStart(2, "0")}.mp3`;
    const { error: uploadError } = await db.storage.from(BUCKET).upload(path, audio, { contentType: "audio/mpeg", upsert: true });
    if (uploadError) throw new Problem(500, "The audio could not be saved.", uploadError.message);

    const { data: done } = await db
      .from("segments")
      .update({ status: "ready", audio_path: path, voice_model: VOICE_MODEL, voice: VOICE, ready_at: new Date().toISOString() })
      .eq("id", segment.id)
      .select()
      .single();
    return await describe(done);
  } catch (err) {
    const message = err instanceof Problem ? `${err.message} ${err.detail ?? ""}`.trim() : String(err);
    await db.from("segments").update({ status: "failed", error: message.slice(0, 500) }).eq("id", segment.id);
    throw err;
  }
}

// ---------- A free self-test ----------

async function check(titles: unknown) {
  const { error: tableError } = await db.from("lessons").select("id").limit(1);
  const { data: bucket, error: bucketError } = await db.storage.getBucket(BUCKET);
  const result: Record<string, unknown> = {
    ok: true,
    openaiKeySet: OPENAI_KEY.length > 0,
    database: tableError ? `problem: ${tableError.message}` : "reachable",
    audioBucket: bucketError || !bucket ? `problem: ${bucketError?.message ?? "missing"}` : "reachable",
    writerModel: WRITER_MODEL,
    scoutModel: SCOUT_MODEL,
    voiceModel: VOICE_MODEL,
    voice: VOICE,
    chapterLengths: { 8: chapterLengths(8), 15: chapterLengths(15), 30: chapterLengths(30), 60: chapterLengths(60) },
  };
  if (Array.isArray(titles)) {
    const sources = await readArticles(titles.filter((t): t is string => typeof t === "string"));
    result.wikipedia = sources.map((s) => ({ title: s.title, url: s.url, chars: s.text.length, opens: s.text.slice(0, 80) }));
  }
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const key = req.headers.get("apikey") ?? "";
  if (!key || !allowedKeys().includes(key)) return json({ error: "Missing or wrong apikey header." }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send a JSON body." }, 400);
  }

  try {
    if (body.action === "check") return json(await check(body.titles));
    if (!OPENAI_KEY && body.action !== "get") throw new Problem(500, "OPENAI_API_KEY is not set as an edge function secret.");

    if (body.action === "start") {
      const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
      const minutes = Math.round(Number(body.minutes));
      if (!topic) throw new Problem(400, "Give a topic.");
      if (!Number.isFinite(minutes) || minutes < 2 || minutes > MAX_MINUTES) {
        throw new Problem(400, `Minutes must be between 2 and ${MAX_MINUTES}.`);
      }
      return json(await start(topic, minutes));
    }

    const lessonId = typeof body.lesson_id === "string" ? body.lesson_id : "";
    if (!/^[0-9a-f-]{36}$/i.test(lessonId)) throw new Problem(400, "Give a lesson_id.");
    if (body.action === "get") return json(await get(lessonId));
    if (body.action === "segment") {
      const position = Number(body.position);
      if (!Number.isInteger(position) || position < 1) throw new Problem(400, "Give a chapter position.");
      return json(await makeSegment(lessonId, position));
    }
    throw new Problem(400, "Unknown action. Use start, segment, get or check.");
  } catch (err) {
    if (err instanceof Problem) {
      if (err.status >= 500) console.error(`lesson: ${err.message} ${err.detail ?? ""}`);
      return json({ error: err.message, detail: err.detail }, err.status);
    }
    console.error("lesson failed:", err);
    return json({ error: "Something went wrong in the function. Check its logs." }, 500);
  }
});

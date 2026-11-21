// Milestone 1, "prove the loop": a topic and a number of minutes go in, a spoken lesson comes out.
//
// This runs on the server for one reason: the OpenAI key must never sit in the app or the
// repo. It lives only as the OPENAI_API_KEY edge function secret.
//
// It is a proof, not the real pipeline. There is no retrieval from sources yet, so the
// writer is told to stay away from exact dates and figures it is not sure of. The planner,
// segments, storage and the Wikipedia grounding all arrive in milestone 2.
//
// POST { topic: string, minutes: number, writer?: "luna" | "terra", voice?: string }
//                                               ->  { title, script, words, writer, voice, audio_base64 }
// POST { dryRun: true }                        ->  { ok, openaiKeySet, writers, voiceModel, voice, voices }
//
// Callers must send the project's publishable key in the `apikey` header. The platform's
// own JWT check is off for this function (see supabase/config.toml), so that check is here.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
// Lowest tier first. A caller can ask for the next tier up by name, to compare by ear.
const WRITERS: Record<string, string> = { luna: "gpt-6-luna", terra: "gpt-6.1-terra" };
const DEFAULT_WRITER = "luna";
const VOICE_MODEL = Deno.env.get("OPENAI_VOICE_MODEL") ?? "gpt-4o-mini-tts";
// OpenAI's built-in voices. Stock voices only: this app never clones a real person.
const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"];
const DEFAULT_VOICE = Deno.env.get("OPENAI_VOICE") ?? "cedar";

// Narration runs at roughly 150 words a minute.
const WORDS_PER_MINUTE = 150;
// A single request has to finish inside the edge function time limit, so the proof is capped.
const MAX_MINUTES = 10;
// Every separate voice request is a fresh performance, and the delivery can shift between
// them, which is heard as the narrator briefly turning into someone else. So a script is
// voiced in as few requests as possible: a piece this size holds about five minutes, and
// only longer scripts are split, at sentence ends. The model's own limit is 2,000 tokens.
const CHUNK_CHARS = 5000;
const VOICE_CONCURRENCY = 4;

// The narrator's direction. The voice model has no speed setting; pace is asked for in words.
const VOICE_STYLE =
  "You are the narrator of a thoughtful audio documentary, talking to one person. " +
  "Pace: slow and measured, clearly slower than everyday conversation, with a real pause after each idea. " +
  "Tone: warm, calm and curious, with quiet delight at the surprising parts. " +
  "Keep exactly the same voice, pace and energy from the first word to the last. Never rushed, never theatrical.";

// What the writer is told. The first paragraph is the editorial brief: what makes a lesson
// worth hearing. The last is the accuracy rule, which matters most while there are no sources.
const WRITER_BRIEF =
  "You write short audio lessons that are read aloud to one curious adult, often while driving.\n\n" +
  "What makes a lesson worth hearing: about once a minute the listener should think 'wait, really?'. " +
  "Skip the overview anyone could guess. Before you write, think of the most surprising, specific, true " +
  "things about the topic: strange mechanisms, named species, people, places, experiments, records, and " +
  "consequences nobody expects. Build the lesson around the best three or four and leave the rest out. " +
  "Open cold with the single most surprising one. No 'today we will explore', no 'have you ever wondered'. " +
  "For each one, explain how or why it works, because the mechanism is where the interest is. " +
  "Be concrete: name the thing and say what it does. One vivid comparison beats three adjectives. " +
  "Cut any sentence that only sets up the next one. End on one line that leaves something to think about.\n\n" +
  "Write for the ear: plain spoken sentences, one idea at a time, no lists, no headings, no markdown, " +
  "no parentheses, no stage directions. Spell out numbers the way a person would say them.\n\n" +
  "Accuracy matters more than color. You have no sources in front of you, so use only facts you are " +
  "confident are well established. Named things and mechanisms are welcome. Give exact dates, figures " +
  "and quotations only when you are certain; otherwise say it roughly, such as 'about a third' or " +
  "'in the late eighteen hundreds'. Never invent names, numbers or quotes. If a popular claim is " +
  "disputed or overstated, say so in a few words rather than repeating it as fact.\n\n" +
  "Reply with a short title on the first line, then a blank line, then the narration and nothing else.";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function allowedKeys(): string[] {
  const keys: string[] = [];
  try {
    const named = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
    for (const value of Object.values(named)) if (typeof value === "string") keys.push(value);
  } catch {
    // Not set or not JSON: fall through to the legacy key.
  }
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (anon) keys.push(anon);
  return keys;
}

class UpstreamError extends Error {
  constructor(public step: string, public status: number, detail: string) {
    super(detail);
  }
}

async function openaiError(step: string, res: Response): Promise<UpstreamError> {
  let detail = await res.text();
  try {
    detail = JSON.parse(detail)?.error?.message ?? detail;
  } catch {
    // Keep the raw text.
  }
  return new UpstreamError(step, res.status, detail.slice(0, 500));
}

async function writeScript(topic: string, minutes: number, model: string): Promise<{ title: string; script: string }> {
  const words = Math.round(minutes * WORDS_PER_MINUTE);
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: WRITER_BRIEF,
      input: `Topic: ${topic}\nLength: about ${words} words, which is ${minutes} minutes read aloud.`,
    }),
  });
  if (!res.ok) throw await openaiError("writing the script", res);
  const data = await res.json();

  let text = "";
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") text += part.text;
    }
  }
  text = text.trim();
  if (!text) throw new UpstreamError("writing the script", 502, "The model returned no text.");

  const firstBreak = text.indexOf("\n");
  if (firstBreak === -1) return { title: topic, script: text };
  const title = text.slice(0, firstBreak).replace(/^[#*\s"]+|[*"\s]+$/g, "") || topic;
  return { title, script: text.slice(firstBreak).trim() };
}

/** Splits a script into pieces no longer than CHUNK_CHARS, breaking only between sentences. */
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

async function speak(text: string, voice: string): Promise<Uint8Array> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: VOICE_MODEL,
      voice,
      input: text,
      instructions: VOICE_STYLE,
      response_format: "mp3",
    }),
  });
  if (!res.ok) throw await openaiError("voicing the script", res);
  return new Uint8Array(await res.arrayBuffer());
}

/** Voices every chunk, a few at a time, and joins the mp3 pieces in order. */
async function speakAll(chunks: string[], voice: string): Promise<Uint8Array> {
  const parts: Uint8Array[] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      parts[i] = await speak(chunks[i], voice);
    }
  };
  await Promise.all(Array.from({ length: Math.min(VOICE_CONCURRENCY, chunks.length) }, worker));

  const joined = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const key = req.headers.get("apikey") ?? "";
  if (!key || !allowedKeys().includes(key)) return json({ error: "Missing or wrong apikey header." }, 401);

  let body: { topic?: unknown; minutes?: unknown; writer?: unknown; voice?: unknown; dryRun?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send a JSON body." }, 400);
  }

  // A free check that the function is deployed, reachable and has its key. Calls nothing.
  if (body.dryRun === true) {
    return json({ ok: true, openaiKeySet: OPENAI_KEY.length > 0, writers: WRITERS, voiceModel: VOICE_MODEL, voice: DEFAULT_VOICE, voices: VOICES });
  }

  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
  const minutes = Number(body.minutes);
  if (!topic) return json({ error: "Give a topic." }, 400);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
    return json({ error: `Minutes must be between 1 and ${MAX_MINUTES} for this test.` }, 400);
  }
  const writer = body.writer === undefined ? DEFAULT_WRITER : String(body.writer);
  if (!Object.hasOwn(WRITERS, writer)) return json({ error: `Writer must be one of: ${Object.keys(WRITERS).join(", ")}.` }, 400);
  const voice = body.voice === undefined ? DEFAULT_VOICE : String(body.voice);
  if (!VOICES.includes(voice)) return json({ error: `Voice must be one of: ${VOICES.join(", ")}.` }, 400);
  if (!OPENAI_KEY) return json({ error: "OPENAI_API_KEY is not set as an edge function secret." }, 500);

  try {
    const { title, script } = await writeScript(topic, minutes, WRITERS[writer]);
    const audio = await speakAll(chunkScript(script), voice);
    return json({
      title,
      script,
      words: script.split(/\s+/).length,
      writer: WRITERS[writer],
      voice,
      audio_base64: encodeBase64(audio),
    });
  } catch (err) {
    if (err instanceof UpstreamError) {
      console.error(`OpenAI failed while ${err.step}: ${err.status} ${err.message}`);
      return json({ error: `OpenAI failed while ${err.step}.`, status: err.status, detail: err.message }, 502);
    }
    console.error("prove-loop failed:", err);
    return json({ error: "Something went wrong in the function. Check its logs." }, 500);
  }
});

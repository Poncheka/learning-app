// The public website's server. It is open to anyone, so it checks what it is sent and only reads
// what a visitor may see: a sample opening to play, shared stories, and the waitlist.
//
// GET  ?                       a random saved story opening, for the home page's player.
// GET  ?stories=1              every shared story's address and title, to build its page and link preview.
// GET  ?story=slug&r=code      one shared story to play: its chapters, who sent it, its sources.
// POST { email, source?, ref?, interests?, story? }   join the waitlist. Answers with the joiner's own code.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const BUCKET = "lesson-audio";
const ART_COUNT = 30;
// The retired OpenAI voices. A chapter still in one is not played here: it is recorded again first.
const RETIRED = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"];
const playable = (s: any) => s.status === "ready" && s.audio_path && !RETIRED.includes(s.voice);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** The same pick of background the app makes for a story, so the website shows the same artwork. */
function artOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % ART_COUNT;
}

/** A random story opening that is saved and ready, with a link to its audio good for an hour. */
async function sample(not: string | null) {
  const { data } = await db.from("site_samples").select("id, title, audio_path").eq("active", true);
  let pool = data ?? [];
  if (pool.length > 1 && not) pool = pool.filter((s) => s.id !== not);
  // Try a few, in case a recording has since been removed.
  pool = pool.sort(() => Math.random() - 0.5).slice(0, 4);
  for (const pick of pool) {
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(pick.audio_path, 3600);
    if (signed?.signedUrl) return json({ id: pick.id, title: pick.title, url: signed.signedUrl });
  }
  return json({ error: "No sample is available right now." }, 503);
}

/** Every story that has been shared: enough to write its page and its link preview. */
async function stories() {
  const { data } = await db.from("topics").select("id, slug, title, hook, tag").not("slug", "is", null).eq("status", "ready").limit(5000);
  return json({
    stories: (data ?? []).map((t: any) => ({ slug: t.slug, title: t.title, hook: t.hook ?? "", tag: t.tag && t.tag !== "Off the map" ? t.tag : null, art: artOf(t.id) })),
  });
}

/**
 * One shared story, ready to play. With a share code, the lesson that was shared and the first name
 * of whoever sent it, if they chose to show it. Without one, the most complete recording there is.
 */
async function story(slug: string, code: string | null) {
  if (!/^[a-z0-9-]{1,90}$/.test(slug)) return json({ error: "No such story." }, 404);
  const { data: topic } = await db.from("topics").select("id, slug, title, hook, tag, sources").eq("slug", slug).maybeSingle();
  if (!topic) return json({ error: "No such story." }, 404);

  let lessonId: string | null = null;
  let sharer: string | null = null;
  if (code && /^[a-z0-9]{4,12}$/.test(code)) {
    const { data: share } = await db.from("shares").select("code, lesson_id, topic_id, user_id, show_name, opened").eq("code", code).maybeSingle();
    if (share && share.topic_id === topic.id) {
      lessonId = share.lesson_id;
      if (share.show_name) {
        const { data: profile } = await db.from("profiles").select("first_name").eq("user_id", share.user_id).maybeSingle();
        sharer = profile?.first_name ?? null;
      }
      await db.from("shares").update({ opened: (share.opened ?? 0) + 1 }).eq("code", share.code);
    }
  }
  if (!lessonId) {
    // No code, or one for another story: the recording with the most finished chapters.
    const { data: lessons } = await db.from("lessons").select("id, segments(status, audio_path, voice)").eq("topic_id", topic.id).limit(50);
    const best = (lessons ?? [])
      .map((l: any) => ({ id: l.id, ready: (l.segments ?? []).filter(playable).length, all: (l.segments ?? []).length }))
      .filter((l) => l.ready > 0)
      .sort((a, b) => Number(b.ready === b.all) - Number(a.ready === a.all) || b.ready - a.ready)[0];
    lessonId = best?.id ?? null;
  }
  if (!lessonId) return json({ error: "This story is not ready to play yet." }, 404);

  const { data: segments } = await db.from("segments").select("position, title, status, audio_path, voice, duration_sec, target_minutes").eq("lesson_id", lessonId).order("position");
  const chapters = [];
  for (const s of (segments ?? []) as any[]) {
    let url: string | null = null;
    if (playable(s)) {
      const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(s.audio_path, 6 * 3600);
      url = signed?.signedUrl ?? null;
    }
    chapters.push({ title: s.title, url, seconds: Number(s.duration_sec) || Math.round((Number(s.target_minutes) || 3) * 60), ready: Boolean(url) });
  }
  const minutes = Math.max(1, Math.round(chapters.reduce((sum, c) => sum + c.seconds, 0) / 60));
  const sources = (Array.isArray(topic.sources) ? topic.sources : [])
    .filter((s: any) => s && typeof s.title === "string" && typeof s.url === "string" && /^https:\/\//.test(s.url))
    .slice(0, 6)
    .map((s: any) => ({ title: s.title, url: s.url }));
  return json({
    slug: topic.slug,
    title: topic.title,
    hook: topic.hook ?? "",
    tag: topic.tag && topic.tag !== "Off the map" ? topic.tag : null,
    art: artOf(topic.id),
    sharer,
    minutes,
    chapters,
    finishing: chapters.some((c) => !c.ready),
    sources,
  });
}

/** A code of the joiner's own, so a story they pass on moves them up too. */
function newCode(): string {
  const letters = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => letters[b % letters.length]).join("");
}

async function join(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send an email address." }, 400);
  }
  // A field people never see. Only a script fills it in, and it is told all went well.
  if (typeof body.website === "string" && body.website) return json({ ok: true, code: null });
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
  const source = typeof body.source === "string" ? body.source.slice(0, 40) : null;
  const ref = typeof body.ref === "string" && /^[a-z0-9]{4,12}$/.test(body.ref) ? body.ref : null;
  const interests = Array.isArray(body.interests) ? body.interests.filter((i): i is string => typeof i === "string").map((i) => i.trim().slice(0, 40)).filter(Boolean).slice(0, 10) : null;
  const story = typeof body.story === "string" && /^[a-z0-9-]{1,90}$/.test(body.story) ? body.story : null;

  // Already on the list is the same good news to the person asking. Their own code is given back.
  const { data: had } = await db.from("waitlist").select("code").ilike("email", email).maybeSingle();
  if (had) {
    let code = had.code as string | null;
    if (!code) {
      code = newCode();
      await db.from("waitlist").update({ code }).ilike("email", email);
    }
    return json({ ok: true, code, already: true });
  }
  for (let tries = 0; tries < 5; tries++) {
    const code = newCode();
    const { error } = await db.from("waitlist").insert({ email, source, code, referred_by: ref, interests, story_slug: story });
    if (!error) return json({ ok: true, code });
    if (error.code === "23505" && /email/i.test(error.message)) return json({ ok: true, code: null, already: true });
    if (error.code !== "23505") return json({ error: "That did not save. Please try again." }, 500);
  }
  return json({ error: "That did not save. Please try again." }, 500);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    if (req.method === "GET") {
      const q = new URL(req.url).searchParams;
      if (q.get("stories")) return await stories();
      if (q.get("story")) return await story(q.get("story")!, q.get("r"));
      return await sample(q.get("not"));
    }
    if (req.method === "POST") return await join(req);
    return json({ error: "Not supported." }, 405);
  } catch {
    return json({ error: "Something went wrong." }, 500);
  }
});

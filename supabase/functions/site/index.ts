// The public website's server. It is open to anyone, so it checks what it is sent and only reads
// what a visitor may see: a sample opening to play, shared stories, and the waitlist.
//
// GET  ?                       a random saved story opening, for the home page's player.
// GET  ?stories=1              every finished story's address and title, and for sent ones the transcript, to build its page.
// GET  ?story=slug&r=code      one shared story to play: its chapters, who sent it, its sources.
// GET  ?who=code               just the first name of who sent a link, for the page's first line.
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

/**
 * The story's address on itspliny.com, made from its title once and kept: "The pope who put a dead
 * pope on trial" is /s/the-pope-who-put-a-dead-pope-on-trial. The same rule as in the shelf function.
 */
async function slugFor(topicId: string, title: string): Promise<string | null> {
  const full = String(title || "story")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = (full.length > 70 ? full.slice(0, 70).replace(/-[^-]*$/, "") : full) || "story";
  for (let n = 1; n < 20; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const { error } = await db.from("topics").update({ slug }).eq("id", topicId).is("slug", null);
    if (!error) {
      const { data: kept } = await db.from("topics").select("slug").eq("id", topicId).maybeSingle();
      if (kept?.slug) return kept.slug;
    }
  }
  return null;
}

const SEGMENT_FIELDS = "position, title, status, audio_path, voice, duration_sec, target_minutes, script";

/**
 * The telling a story page plays when its link has no share code, and the one its transcript is
 * written from, so the text matches the audio: the telling most recently sent by someone, or, if
 * that has nothing playable, the recording with the most finished chapters.
 */
async function pageTelling(topicId: string): Promise<{ lessonId: string; segments: any[] } | null> {
  const { data: sent } = await db.from("shares").select("lesson_id, sent_at").eq("topic_id", topicId).not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(10);
  for (const share of (sent ?? []) as any[]) {
    const { data } = await db.from("segments").select(SEGMENT_FIELDS).eq("lesson_id", share.lesson_id).order("position");
    if ((data ?? []).some(playable)) return { lessonId: share.lesson_id, segments: data ?? [] };
  }
  const { data: lessons } = await db.from("lessons").select(`id, segments(${SEGMENT_FIELDS})`).eq("topic_id", topicId).limit(50);
  const best = (lessons ?? [])
    .map((l: any) => ({ id: l.id, segs: (l.segments ?? []) as any[], ready: (l.segments ?? []).filter(playable).length, all: (l.segments ?? []).length }))
    .filter((l) => l.ready > 0)
    .sort((a, b) => Number(b.ready === b.all) - Number(a.ready === a.all) || b.ready - a.ready)[0];
  return best ? { lessonId: best.id, segments: [...best.segs].sort((a, b) => a.position - b.position) } : null;
}

/** A chapter's narration as plain paragraphs, with any stage or voice direction taken out. */
function readable(script: string): string[] {
  return String(script ?? "")
    .replace(/<[^>]*>/g, " ") // SSML or other markup, such as <break time="1s"/>
    .replace(/\[[^\]\n]{1,40}\]/g, " ") // voice tags such as [pause] or [laughs]
    .replace(/\((?:pause|beat|sighs?|laughs?|whispers?|softly|slowly|music|sound[^)]*)\)/gi, " ")
    .replace(/^\s*(?:narrator|host|voice)\s*:\s*/gim, "")
    .replace(/\*+/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim())
    .filter((p) => p.length > 0);
}

/** The sources a story was researched from, as links. Only https links are kept. */
function sourceLinks(sources: unknown): { title: string; url: string }[] {
  return (Array.isArray(sources) ? sources : [])
    .filter((s: any) => s && typeof s.title === "string" && typeof s.url === "string" && /^https:\/\//.test(s.url))
    .slice(0, 6)
    .map((s: any) => ({ title: s.title, url: s.url }));
}

/**
 * Every finished story, to write its page and its link preview ahead of time, so a link shows its
 * title and artwork in a text from the moment it is sent. A page shows only the title, the hook and
 * the artwork. Playing the story still needs a link someone has sent (see story below).
 */
async function stories() {
  const [{ data }, { data: sentRows }] = await Promise.all([
    db.from("topics").select("id, slug, title, hook, tag, sources").eq("status", "ready").limit(5000),
    db.from("shares").select("topic_id").not("sent_at", "is", null).limit(20000),
  ]);
  const rows = (data ?? []) as any[];
  const sent = new Set((sentRows ?? []).map((r: any) => r.topic_id));
  // Stories finished since the last build get their address now, a few at a time.
  let budget = 150;
  for (const t of rows) {
    if (t.slug || budget-- <= 0) continue;
    t.slug = await slugFor(t.id, t.title);
  }
  // A story someone has sent gets its transcript written into its page, from the telling the page
  // plays. Saved scripts only: nothing is generated here.
  const transcripts = new Map<string, { chapters: { title: string; paragraphs: string[] }[]; sources: { title: string; url: string }[] }>();
  for (const t of rows) {
    if (!t.slug || !sent.has(t.id)) continue;
    const telling = await pageTelling(t.id);
    if (!telling) continue;
    const chapters = telling.segments
      .filter((g: any) => g.status === "ready" && typeof g.script === "string" && g.script.trim())
      .map((g: any) => ({ title: String(g.title ?? ""), paragraphs: readable(g.script) }))
      .filter((c: any) => c.paragraphs.length > 0);
    if (chapters.length) transcripts.set(t.id, { chapters, sources: sourceLinks(t.sources) });
  }
  return json({
    stories: rows
      .filter((t) => t.slug)
      .map((t) => ({ slug: t.slug, title: t.title, hook: t.hook ?? "", tag: t.tag && t.tag !== "Off the map" ? t.tag : null, art: artOf(t.id), transcript: transcripts.get(t.id) ?? null })),
  });
}

/**
 * One shared story, ready to play. With a share code, the lesson that was shared and the first name
 * of whoever sent it, if they chose to show it. Without one, the most complete recording there is.
 * Lookups that do not depend on each other run at the same time, and every chapter's audio link is
 * signed in one request, so the page can start playing sooner.
 */
async function story(slug: string, code: string | null) {
  if (!/^[a-z0-9-]{1,90}$/.test(slug)) return json({ error: "No such story." }, 404);
  const goodCode = code && /^[a-z0-9]{4,12}$/.test(code) ? code : null;
  const [{ data: topic }, shareRes] = await Promise.all([
    db.from("topics").select("id, slug, title, hook, tag, sources").eq("slug", slug).maybeSingle(),
    goodCode ? db.from("shares").select("code, lesson_id, topic_id, user_id, show_name, opened").eq("code", goodCode).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!topic) return json({ error: "No such story." }, 404);

  let lessonId: string | null = null;
  let sharerAsk: Promise<{ data: any }> | null = null;
  const share: any = shareRes.data;
  if (share && share.topic_id === topic.id) {
    lessonId = share.lesson_id;
    if (share.show_name) sharerAsk = db.from("profiles").select("first_name").eq("user_id", share.user_id).maybeSingle() as any;
    // Counting the open does not hold up the answer.
    const count = db.from("shares").update({ opened: (share.opened ?? 0) + 1 }).eq("code", share.code).then(() => {});
    try {
      EdgeRuntime.waitUntil(count);
    } catch {
      /* counted anyway, just not waited for */
    }
  }

  if (!lessonId) {
    // Without a working code, only a story someone has sent can be played.
    const { count } = await db.from("shares").select("code", { count: "exact", head: true }).eq("topic_id", topic.id).not("sent_at", "is", null);
    if (!count) return json({ error: "No such story." }, 404);
  }

  let segments: any[] = [];
  if (lessonId) {
    const { data } = await db.from("segments").select(SEGMENT_FIELDS).eq("lesson_id", lessonId).order("position");
    segments = data ?? [];
  } else {
    // No code, or one for another story: the same telling the page's transcript was written from.
    const telling = await pageTelling(topic.id);
    if (telling) {
      lessonId = telling.lessonId;
      segments = telling.segments;
    }
  }
  if (!lessonId) return json({ error: "This story is not ready to play yet." }, 404);

  const paths = segments.filter(playable).map((s) => s.audio_path as string);
  const [signedRes, sharerRes] = await Promise.all([
    paths.length ? db.storage.from(BUCKET).createSignedUrls(paths, 6 * 3600) : Promise.resolve({ data: [] as any[] }),
    sharerAsk ?? Promise.resolve({ data: null }),
  ]);
  const urlFor = new Map<string, string>();
  for (const x of (signedRes.data ?? []) as any[]) if (x?.path && x?.signedUrl) urlFor.set(x.path, x.signedUrl);
  const chapters = segments.map((s) => {
    const url = playable(s) ? urlFor.get(s.audio_path) ?? null : null;
    return { title: s.title, url, seconds: Number(s.duration_sec) || Math.round((Number(s.target_minutes) || 3) * 60), ready: Boolean(url) };
  });
  const sharer: string | null = (sharerRes as any)?.data?.first_name ?? null;
  const minutes = Math.max(1, Math.round(chapters.reduce((sum, c) => sum + c.seconds, 0) / 60));
  const sources = sourceLinks(topic.sources);
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

/** Just the first name of whoever sent a share link, if they chose to show it. Answers faster than story(). */
async function who(code: string) {
  if (!/^[a-z0-9]{4,12}$/.test(code)) return json({ name: null });
  const { data: share } = await db.from("shares").select("user_id, show_name").eq("code", code).maybeSingle();
  if (!share?.show_name) return json({ name: null });
  const { data: profile } = await db.from("profiles").select("first_name").eq("user_id", share.user_id).maybeSingle();
  return json({ name: profile?.first_name ?? null });
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
      if (q.get("who")) return await who(q.get("who")!.toLowerCase());
      if (q.get("story")) return await story(q.get("story")!, q.get("r"));
      return await sample(q.get("not"));
    }
    if (req.method === "POST") return await join(req);
    return json({ error: "Not supported." }, 405);
  } catch {
    return json({ error: "Something went wrong." }, 500);
  }
});

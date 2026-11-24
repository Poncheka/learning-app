// The marketing site's two needs: a story opening to play, and a place to leave an email.
// It is open to anyone, so it checks what it is sent and only ever touches two tables.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const BUCKET = "lesson-audio";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

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

async function join(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send an email address." }, 400);
  }
  // A field people never see. Only a script fills it in, and it is told all went well.
  if (typeof body.website === "string" && body.website) return json({ ok: true });
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
  const source = typeof body.source === "string" ? body.source.slice(0, 40) : null;
  const { error } = await db.from("waitlist").insert({ email, source });
  // Already on the list is the same good news to the person asking.
  if (error && error.code !== "23505") return json({ error: "That did not save. Please try again." }, 500);
  return json({ ok: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    if (req.method === "GET") return await sample(new URL(req.url).searchParams.get("not"));
    if (req.method === "POST") return await join(req);
    return json({ error: "Not supported." }, 405);
  } catch {
    return json({ error: "Something went wrong." }, 500);
  }
});

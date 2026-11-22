// NOTE: the deployed open-app is version 3 and is newer than this file. It also keeps the
// code for the app to collect with a ticket (POST { to, ticket } and POST { claim }). Do not
// deploy this file until it has been brought up to date.
// The stepping stone between a sign-in email and the app while it runs inside Expo Go.
//
// Supabase refuses to send people on to an address that is a bare network number, and that
// is exactly what Expo Go's address is on a home network (exp://192.168...). So during
// development the email link lands here instead, and this passes the person on to Expo Go.
// A real installed build does not need this: its link goes straight to pliny://auth.
//
// POST { to }     the app, running in Expo Go, says where it can be reached right now.
// GET  ?code=...  the email link arrives, and is passed on to that address with its code.
//
// It only ever forwards to Expo Go (exp://) or the app (pliny://), never to a website. The
// code it carries is useless on its own: only the phone that asked for the link holds the
// other half needed to turn it into a session.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED = ["pliny://", "exp://"];
const KEY = "expo_go_return";

function envKeys(name: string): string[] {
  try {
    return Object.values(JSON.parse(Deno.env.get(name) ?? "{}")).filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}
const anon = Deno.env.get("SUPABASE_ANON_KEY");
const callers = [...envKeys("SUPABASE_PUBLISHABLE_KEYS"), ...(anon ? [anon] : [])];
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", envKeys("SUPABASE_SECRET_KEYS")[0] ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
  auth: { persistSession: false, autoRefreshToken: false },
});
const allowed = (to: string) => ALLOWED.some((scheme) => to.startsWith(scheme)) && to.length < 300;
const say = (text: string, status: number) => new Response(text, { status, headers: { "Content-Type": "text/plain" } });

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "POST") {
    if (!callers.includes(req.headers.get("apikey") ?? "")) return say("Not allowed.", 401);
    const body = await req.json().catch(() => ({}));
    const to = typeof body.to === "string" ? body.to : "";
    if (!to.startsWith("exp://") || !allowed(to)) return say("Give an Expo Go address.", 400);
    const { error } = await db.from("settings").upsert({ key: KEY, value: to });
    return error ? say("That could not be saved.", 500) : say("ok", 200);
  }

  let to = url.searchParams.get("to") ?? "";
  if (!to) {
    const { data } = await db.from("settings").select("value").eq("key", KEY).maybeSingle();
    to = typeof data?.value === "string" ? data.value : "";
  }
  if (!allowed(to)) return say("This sign-in link has nowhere to go. Ask for a new one from the app.", 400);

  // A good link arrives with a code. Anything else means the link was old or already used.
  const code = url.searchParams.get("code");
  const extra = code ? new URLSearchParams({ code }) : new URLSearchParams({ error: "access_denied", error_code: "otp_expired" });
  return new Response(null, { status: 302, headers: { Location: `${to}${to.includes("?") ? "&" : "?"}${extra}`, "Cache-Control": "no-store" } });
});

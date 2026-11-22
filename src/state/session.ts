// Who is signed in. Signing in is by email link only: ask for a link, tap it on this phone,
// and the link opens the app carrying the session.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { create } from 'zustand';

import { STORAGE_KEY, supabase } from '@/lib/supabase';

const MOCK = process.env.EXPO_PUBLIC_MOCK === '1';
const PENDING = 'pliny.pending-email';
/** Supabase will not send the same person a second link sooner than this. */
export const RESEND_SECONDS = 60;

type Opened = 'in' | 'expired' | null;

type Session = {
  status: 'loading' | 'in' | 'out';
  /** The signed-in email. */
  email: string | null;
  /** The email a link was last sent to, kept so a fresh link can be sent without retyping. */
  pending: string | null;
  sentAt: number | null;
  /** Why the last sign-in attempt failed, in the system's own words. Shown only while developing. */
  problem: string | null;
  start: () => Promise<void>;
  /** Sends a sign-in link. Returns null when it went out, or a sentence saying why it did not. */
  sendLink: (email: string) => Promise<string | null>;
  /** Reads a link that opened the app. 'in' when it signed someone in, 'expired' when it was a dead link. */
  open: (url: string) => Promise<Opened>;
  /** Turns the one-time code from a sign-in link into a session. */
  enter: (code: string) => Promise<Opened>;
  signOut: () => Promise<void>;
};

let started = false;
let sending = false;
let entering: { code: string; result: Promise<Opened> } | null = null;

// Where the email link should bring the person back to. An installed build is reached
// directly at pliny://auth. Inside Expo Go the app's address is a bare network number, which
// Supabase refuses to send anyone to, so the link goes to a small stepping stone of ours
// (the open-app function) after the app has told it where Expo Go is right now.
const TICKET = 'pliny.ticket';
// The phone's half of a sign-in code. The sign-in library keeps it, and has been seen to
// lose it when Expo Go restarts the app, so a second copy is kept here and put back if needed.
const HALF = `${STORAGE_KEY}-code-verifier`;
const HALF_COPY = 'pliny.half';
const TICKET_MINUTES = 20;
const stone = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/open-app`;
const asStone = (body: Record<string, unknown>) =>
  fetch(stone, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '' },
    body: JSON.stringify(body),
  });

async function comeBack(): Promise<string> {
  const here = Linking.createURL('auth');
  if (!here.startsWith('exp://')) return here;
  // A ticket only this phone knows, so only this phone can collect the code the link brings.
  const ticket = `${Date.now()}.${Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join('')}`;
  await AsyncStorage.setItem(TICKET, ticket);
  const res = await asStone({ to: here, ticket });
  if (!res.ok) throw new Error('The way back to the app could not be set up.');
  return stone;
}

/**
 * Inside Expo Go the app cannot count on being handed the link it was opened with. So while
 * someone is waiting to sign in, the app asks the stepping stone whether their link has been
 * tapped, and collects the code itself. Does nothing in an installed build, where no ticket exists.
 */
export async function collect(): Promise<'in' | 'expired' | null> {
  if (MOCK) return null;
  const ticket = await AsyncStorage.getItem(TICKET).catch(() => null);
  if (!ticket) return null;
  if (Date.now() - Number(ticket.split('.')[0]) > TICKET_MINUTES * 60 * 1000) {
    AsyncStorage.removeItem(TICKET).catch(() => {});
    return null;
  }
  const res = await asStone({ claim: ticket });
  const { code } = (await res.json().catch(() => ({}))) as { code?: string | null };
  if (!code) return null;
  console.log('[sign-in] collected the code from the stepping stone');
  return await useSession.getState().enter(code);
}

export const useSession = create<Session>((set, get) => ({
  status: MOCK ? 'in' : 'loading',
  email: MOCK ? 'you@email.com' : null,
  pending: MOCK ? 'you@email.com' : null,
  sentAt: null,
  problem: null,

  start: async () => {
    if (MOCK || started) return;
    started = true;
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ status: session ? 'in' : 'out', email: session?.user.email ?? null });
    });
    const pending = await AsyncStorage.getItem(PENDING).catch(() => null);
    const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    set({ pending, status: data.session ? 'in' : 'out', email: data.session?.user.email ?? null });
  },

  sendLink: async (raw) => {
    const email = raw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'That email does not look right.';
    if (MOCK) {
      set({ pending: email, sentAt: Date.now() });
      return null;
    }
    // A link that went to this email moments ago is still good. Asking again so soon would
    // only be refused, so carry on to the inbox instead.
    const recent = get().pending === email && Date.now() - (get().sentAt ?? 0) < RESEND_SECONDS * 1000;
    if (recent || sending) return null;
    sending = true;
    let error;
    try {
      // The way back is set up first, so no email is ever spent on a link that cannot return.
      const emailRedirectTo = await comeBack();
      ({ error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } }));
      const half = await AsyncStorage.getItem(HALF).catch(() => null);
      if (half) await AsyncStorage.setItem(HALF_COPY, half).catch(() => {});
      console.log('[sign-in] link requested', { keptHalf: Boolean(half), error: error?.message ?? null });
    } catch {
      return 'The link could not be sent. Check your connection and try again.';
    } finally {
      sending = false;
    }
    if (error) {
      if (error.code === 'email_address_not_authorized') return 'Pliny is invite only for now, and this email is not on the list yet.';
      if (error.status === 429 && /after \d+ seconds/.test(error.message)) {
        // Refused only for asking twice within a minute. The earlier link still works.
        if (get().pending === email) return null;
        return 'A link just went out. Give it a minute before asking for another.';
      }
      if (error.status === 429) return 'Too many links have gone out this hour. Try again a little later.';
      return 'The link could not be sent. Check your connection and try again.';
    }
    set({ pending: email, sentAt: Date.now() });
    AsyncStorage.setItem(PENDING, email).catch(() => {});
    return null;
  },

  open: async (url) => {
    const params = read(url);
    console.log('[sign-in] link arrived', { code: Boolean(params.code), error: params.error_code ?? params.error ?? null });
    if (params.error || params.error_code) return 'expired';
    if (!params.code) return null;
    return await get().enter(params.code);
  },

  enter: (code) => {
    // The same link can reach the app by two routes at once. Both get the one answer.
    if (entering?.code === code) return entering.result;
    const result = (async (): Promise<Opened> => {
      // The request can be cut off if it starts while the phone is still switching back from
      // the browser. The server never saw it, so the code is still good: wait and ask again.
      let last = '';
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          const [half, copy] = await Promise.all([AsyncStorage.getItem(HALF).catch(() => null), AsyncStorage.getItem(HALF_COPY).catch(() => null)]);
          console.log('[sign-in] exchanging the code', { attempt, half: Boolean(half), copy: Boolean(copy) });
          // A failed try throws away the phone's half of the code. Put it back from the copy.
          if (!half && copy) await AsyncStorage.setItem(HALF, copy);
          const slow = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out after 12 seconds')), 12000));
          const { error } = await Promise.race([supabase.auth.exchangeCodeForSession(code), slow]);
          if (!error) {
            console.log('[sign-in] signed in');
            AsyncStorage.removeItem(TICKET).catch(() => {});
            AsyncStorage.removeItem(HALF_COPY).catch(() => {});
            AsyncStorage.removeItem(PENDING).catch(() => {});
            set({ pending: null, sentAt: null, problem: null });
            return 'in';
          }
          last = `${error.name}: ${error.message}`;
          console.log('[sign-in] the code was refused:', last);
          // Only a dropped connection is worth another try. A real refusal is final.
          if (error.name !== 'AuthRetryableFetchError') break;
        } catch (err) {
          last = err instanceof Error ? err.message : String(err);
          console.log('[sign-in] the exchange failed:', last);
        }
        if (get().status === 'in') return 'in';
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      set({ problem: last });
      return get().status === 'in' ? 'in' : 'expired';
    })();
    entering = { code, result };
    return result;
  },

  signOut: async () => {
    if (MOCK) return;
    await supabase.auth.signOut().catch(() => {});
    set({ status: 'out', email: null });
  },
}));

// A sign-in link carries its details after a ? or a #.
function read(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const [beforeHash, hash = ''] = url.split('#');
  const query = beforeHash.split('?')[1] ?? '';
  for (const part of `${query}&${hash}`.split('&')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    try {
      out[part.slice(0, at)] = decodeURIComponent(part.slice(at + 1).replace(/\+/g, ' '));
    } catch {
      // A value that will not decode is not one we need.
    }
  }
  return out;
}

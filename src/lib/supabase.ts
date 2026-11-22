// The one Supabase client the app uses, and only for signing in. It keeps the session on the
// phone and renews it quietly. Everything else still goes through the edge functions in api.ts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'http://localhost';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY || 'missing';

/** The name the session, and the half of a sign-in code kept on this phone, are stored under. */
export const STORAGE_KEY = 'pliny-auth';

export const supabase = createClient(URL, KEY, {
  auth: {
    storage: AsyncStorage,
    // A fixed name for what is kept on the phone, so the app can find its own sign-in details.
    storageKey: STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    // The sign-in link is read by hand in state/session.ts, the same way on every platform.
    detectSessionInUrl: false,
    // The link brings back a one-time code that only this phone can turn into a session.
    flowType: 'pkce',
  },
});

// Renew the session only while the app is in front, as Supabase recommends for phones.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** The signed-in person's pass, sent with every request to the server. Null when signed out. */
export async function accessToken(): Promise<string | null> {
  try {
    return (await supabase.auth.getSession()).data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

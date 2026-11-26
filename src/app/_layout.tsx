import { InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic } from '@expo-google-fonts/instrument-serif';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import { Stack, router, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { arrive } from '@/lib/arrive';
import { watchForUpdates } from '@/lib/freshen';
import { hasNext } from '@/state/library';
import { usePlayer } from '@/state/player';
import { useSession } from '@/state/session';
import { colors } from '@/theme';

// Keep the splash screen up until the fonts are in, so no screen ever flashes in the wrong type.
SplashScreen.preventAutoHideAsync().catch(() => {});

// The screens a signed-out person may see. Anything else sends them to sign in.
const OPEN_DOORS = ['/welcome', '/check-email', '/link-expired', '/auth'];

// A new version is switched to as soon as the app opens, rather than on the open after that.
watchForUpdates();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  const sessionStatus = useSession((s) => s.status);
  useEffect(() => {
    if ((loaded || error) && sessionStatus !== 'loading') SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error, sessionStatus]);

  // When a lesson ends, the wrap screen comes up whichever screen is showing, so the
  // verdict is always asked for.
  const phase = usePlayer((s) => s.phase);
  const pathname = usePathname();
  useEffect(() => {
    // During "Play all" the next story is about to start, so the wrap screen stays out of the way.
    if (phase !== 'finished' || pathname === '/finished' || hasNext()) return;
    // From the player, the wrap screen takes its place. From anywhere else, it comes up on top.
    if (pathname === '/playing') router.replace('/finished');
    else router.push('/finished');
  }, [phase, pathname]);

  // Signing in. The session is read once at launch, and a sign-in link that opens the app
  // is read here, whichever screen was showing.
  const status = useSession((s) => s.status);
  const ready = loaded || !!error;
  useEffect(() => {
    useSession.getState().start();
  }, []);
  const link = Linking.useLinkingURL();
  const [verdict, setVerdict] = useState<'in' | 'expired' | null>(null);
  useEffect(() => {
    if (!link) return;
    useSession
      .getState()
      .open(link)
      .then(setVerdict)
      .catch((err) => console.log('[sign-in] reading the link failed:', String(err)));
  }, [link]);
  // The link can be read before the screens exist, so moving on waits until they do.
  useEffect(() => {
    if (!verdict || !ready || status === 'loading') return;
    setVerdict(null);
    if (verdict === 'in') arrive();
    else router.replace('/link-expired');
  }, [verdict, ready, status]);
  useEffect(() => {
    if (ready && status === 'out' && !OPEN_DOORS.includes(pathname)) router.replace('/welcome');
  }, [ready, status, pathname]);

  if (!ready || status === 'loading') return null;

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
        <Stack.Screen name="welcome" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="check-email" options={{ gestureEnabled: false }} />
        <Stack.Screen name="link-expired" options={{ gestureEnabled: false }} />
        <Stack.Screen name="auth" options={{ animation: 'none' }} />
        <Stack.Screen name="your-name" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="first-interests" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="listen" options={{ animation: 'fade' }} />
        <Stack.Screen name="library" options={{ animation: 'fade' }} />
        <Stack.Screen name="interests" options={{ animation: 'fade' }} />
        <Stack.Screen name="explore" options={{ animation: 'fade' }} />
        <Stack.Screen name="playlist" />
        <Stack.Screen name="chapters" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}

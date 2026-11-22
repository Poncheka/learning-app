// A3. The link was old or already used. One slide sends a fresh one.
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SlideToStart } from '@/components/SlideToStart';
import { Screen, Wordmark } from '@/components/ui';
import { useSession } from '@/state/session';
import { colors, fonts } from '@/theme';

export default function LinkExpired() {
  const pending = useSession((s) => s.pending);
  const problem = useSession((s) => s.problem);
  const [error, setError] = useState<string | null>(null);

  const again = async () => {
    // Without a remembered email there is nobody to send to, so ask for it again.
    if (!pending) {
      router.replace('/welcome');
      return;
    }
    setError(null);
    const problem = await useSession.getState().sendLink(pending);
    if (problem) {
      setError(problem);
      return false;
    }
    router.replace('/check-email');
  };

  return (
    <Screen style={{ paddingBottom: 16 }}>
      <View style={styles.disc} />
      <View style={styles.dot} />
      <Wordmark />
      <View style={{ flex: 1 }} />
      <Text style={styles.head} accessibilityRole="header">
        That link{'\n'}expired.
      </Text>
      <Text style={styles.line}>Sign-in links work once and only for 15 minutes. Grab a fresh one.</Text>
      <SlideToStart compact label="Send a new link" onDone={again} />
      <View style={styles.foot}>
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {__DEV__ && problem ? <Text style={styles.dev}>For Jeff, while testing: {problem}</Text> : null}
        <Pressable onPress={() => router.replace('/welcome')} hitSlop={8} accessibilityRole="button" style={styles.tap}>
          <Text style={styles.strong}>Use a different email</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  disc: { position: 'absolute', right: -60, top: 110, width: 280, height: 280, borderRadius: 140, backgroundColor: colors.vermilion },
  dot: { position: 'absolute', right: 30, top: 230, width: 120, height: 120, borderRadius: 60, backgroundColor: colors.ink },
  head: { fontFamily: fonts.display, fontSize: 48, lineHeight: 46, letterSpacing: -2, textTransform: 'uppercase', color: colors.ink },
  line: { fontFamily: fonts.serifItalic, fontSize: 26, lineHeight: 30, color: colors.ink, marginTop: 14, marginBottom: 22, paddingRight: 8 },
  foot: { minHeight: 88, paddingTop: 8 },
  tap: { height: 44, alignItems: 'center', justifyContent: 'center' },
  strong: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.ink },
  dev: { fontFamily: fonts.body, fontSize: 11, lineHeight: 15, color: colors.gray, textAlign: 'center' },
  error: { fontFamily: fonts.bodySemi, fontSize: 13, lineHeight: 19, color: colors.vermilion, textAlign: 'center' },
});

// Where a sign-in link lands. The link carries a one-time code, and this screen turns it
// into a session and moves on. The root layout reads the same link too. Whichever gets
// there first does the work, and both get the same answer.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { arrive } from '@/lib/arrive';
import { useSession } from '@/state/session';
import { colors, fonts } from '@/theme';

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';

export default function Auth() {
  const params = useLocalSearchParams<{ code?: string; error?: string; error_code?: string }>();
  const code = one(params.code);
  const failed = one(params.error) || one(params.error_code);

  useEffect(() => {
    console.log('[sign-in] landing screen', { code: Boolean(code), error: failed || null });
    if (failed) return router.replace('/link-expired');
    if (!code) {
      // Nothing usable arrived. Give the other route a moment, then start over.
      const giveUp = setTimeout(() => router.replace(useSession.getState().status === 'in' ? '/listen' : '/'), 4000);
      return () => clearTimeout(giveUp);
    }
    let gone = false;
    useSession
      .getState()
      .enter(code)
      .then((result) => {
        if (gone) return;
        if (result === 'in') arrive();
        else router.replace('/link-expired');
      });
    return () => {
      gone = true;
    };
  }, [code, failed]);

  return (
    <View style={styles.screen}>
      <ActivityIndicator color={colors.ink} />
      <Text style={styles.text}>Signing you in</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: colors.paper },
  text: { fontFamily: fonts.bodyMedium, fontSize: 16, color: colors.gray },
});

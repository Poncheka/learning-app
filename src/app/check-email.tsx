// A2. Check your email. The link is on its way. Opening it on this phone signs you in.
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { SlideToStart } from '@/components/SlideToStart';
import { Icon, RoundButton, Screen, Wordmark } from '@/components/ui';
import { useLinkWatch } from '@/lib/useLinkWatch';
import { RESEND_SECONDS, useSession } from '@/state/session';
import { colors, fonts } from '@/theme';

export default function CheckEmail() {
  const pending = useSession((s) => s.pending);
  useLinkWatch();
  const sentAt = useSession((s) => s.sentAt);
  const [now, setNow] = useState(Date.now());
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  const wait = Math.max(0, RESEND_SECONDS - Math.floor((now - (sentAt ?? 0)) / 1000));

  const resend = async () => {
    if (!pending) return router.replace('/welcome');
    setNote(null);
    const problem = await useSession.getState().sendLink(pending);
    setNote(problem ?? 'Sent again.');
  };

  // The Mail app on an iPhone. If there is none, the inbox is wherever they read email.
  const openMail = async () => {
    await Linking.openURL('message://').catch(() => setNote('Open your email app and look for the link from Pliny.'));
    return false;
  };

  return (
    <Screen style={{ paddingBottom: 16 }}>
      <View style={styles.top}>
        <RoundButton label="Back" onPress={() => router.replace('/welcome')}>
          <Icon name="back" size={22} />
        </RoundButton>
        <Wordmark />
        <View style={{ width: 48 }} />
      </View>
      <Rings />
      <Text style={styles.head} accessibilityRole="header">
        Check your{'\n'}inbox.
      </Text>
      <Text style={styles.line}>We sent a sign-in link to {pending ?? 'your email'}. Open it on this phone.</Text>
      <SlideToStart compact label="Open Mail" onDone={openMail} />
      <View style={styles.foot}>
        <View style={styles.row}>
          {wait > 0 ? (
            <Text style={styles.quiet}>Resend in 0:{String(wait).padStart(2, '0')}</Text>
          ) : (
            <Pressable onPress={resend} hitSlop={8} accessibilityRole="button" style={styles.tap}>
              <Text style={styles.strong}>Resend the link</Text>
            </Pressable>
          )}
          <Pressable onPress={() => router.replace('/welcome')} hitSlop={8} accessibilityRole="button" style={styles.tap}>
            <Text style={styles.strong}>Use a different email</Text>
          </Pressable>
        </View>
        {note ? (
          <Text style={styles.quiet} accessibilityLiveRegion="polite">
            {note}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

// Two rings turning opposite ways around a pulsing dot: something is on its way.
function Rings() {
  const turn = useRef(new Animated.Value(0)).current;
  const back = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loops = [
      Animated.loop(Animated.timing(turn, { toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: false })),
      Animated.loop(Animated.timing(back, { toValue: 1, duration: 5000, easing: Easing.linear, useNativeDriver: false })),
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
          Animated.timing(pulse, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        ]),
      ),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [turn, back, pulse]);
  return (
    <View style={styles.rings} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.outer, { transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]} />
      <Animated.View style={[styles.inner, { transform: [{ rotate: back.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] }) }] }]} />
      <Animated.View style={[styles.dot, { transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.08] }) }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rings: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  outer: { position: 'absolute', width: 230, height: 230, borderRadius: 115, borderWidth: 3, borderColor: colors.ink, borderRightColor: 'transparent' },
  inner: { position: 'absolute', width: 162, height: 162, borderRadius: 81, borderWidth: 3, borderColor: colors.blue, borderBottomColor: 'transparent' },
  dot: { position: 'absolute', width: 88, height: 88, borderRadius: 44, backgroundColor: colors.yellow, borderWidth: 3, borderColor: colors.ink },
  head: { fontFamily: fonts.display, fontSize: 44, lineHeight: 43, letterSpacing: -2, textTransform: 'uppercase', color: colors.ink },
  line: { fontFamily: fonts.serifItalic, fontSize: 26, lineHeight: 30, color: colors.ink, marginTop: 14, marginBottom: 22 },
  foot: { minHeight: 88, paddingTop: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  tap: { height: 44, justifyContent: 'center' },
  quiet: { fontFamily: fonts.body, fontSize: 14, lineHeight: 44, color: colors.gray },
  strong: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink },
});

// A1. Sign in. A new or signed-out person lands here: type an email, slide, get a link.
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { SlideToStart } from '@/components/SlideToStart';
import { Screen } from '@/components/ui';
import { useLinkWatch } from '@/lib/useLinkWatch';
import { useSession } from '@/state/session';
import { colors, fonts } from '@/theme';

export default function Welcome() {
  const pending = useSession((s) => s.pending);
  useLinkWatch();
  const [email, setEmail] = useState(pending ?? '');
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setError(null);
    const problem = await useSession.getState().sendLink(email);
    if (problem) {
      setError(problem);
      return false;
    }
    router.push('/check-email');
    return false;
  };

  return (
    <Screen style={{ paddingBottom: 16 }}>
      <View style={styles.disc} />
      <View style={styles.bar} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1 }} />
        <Text style={styles.name} accessibilityRole="header">
          pliny<Text style={{ color: colors.vermilion }}>.</Text>
        </Text>
        <Text style={styles.line}>get lost in something</Text>
        <Text style={styles.label}>Your email</Text>
        <TextInput
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            if (error) setError(null);
          }}
          placeholder="you@email.com"
          placeholderTextColor={colors.gray}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          onSubmitEditing={send}
          accessibilityLabel="Your email"
          style={styles.input}
        />
        <SlideToStart compact label="Send me a link" onDone={send} />
        <View style={styles.foot}>
          <Text style={[styles.small, error ? { color: colors.vermilion, fontFamily: fonts.bodySemi } : null]} accessibilityLiveRegion="polite">
            {error ?? 'No password. We email you a link and you are in.'}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  disc: { position: 'absolute', top: -130, right: -130, width: 320, height: 320, borderRadius: 160, backgroundColor: colors.vermilion },
  bar: { position: 'absolute', top: 150, left: -30, width: 130, height: 24, backgroundColor: colors.yellow },
  name: { fontFamily: fonts.display, fontSize: 104, lineHeight: 104, letterSpacing: -6, color: colors.ink, marginBottom: -6 },
  line: { fontFamily: fonts.serifItalic, fontSize: 38, lineHeight: 40, color: colors.ink, marginTop: 10, marginBottom: 28 },
  label: { fontFamily: fonts.bodySemi, fontSize: 12, letterSpacing: 2.5, textTransform: 'uppercase', color: colors.ink, marginBottom: 10 },
  input: { height: 64, borderRadius: 32, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.white, paddingHorizontal: 26, fontFamily: fonts.body, fontSize: 18, color: colors.ink, marginBottom: 16 },
  foot: { minHeight: 64, paddingTop: 10 },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.gray, marginHorizontal: 4 },
});

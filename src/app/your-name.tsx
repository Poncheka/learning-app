// A3. Your name. Asked once, before interests. It is how Pliny greets you, and the name your
// friends see on a story you send them ("Jeff sent you a story").
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { SlideToStart } from '@/components/SlideToStart';
import { Em, Screen, Wordmark } from '@/components/ui';
import { useProfile } from '@/state/profile';
import { colors, fonts } from '@/theme';

export default function YourName() {
  const [name, setName] = useState(useProfile.getState().first_name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name.trim().length > 0;

  const save = async () => {
    if (!ready || saving) return false;
    setSaving(true);
    setError(null);
    try {
      await useProfile.getState().rename(name.trim());
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? err.message : 'That did not save. Try again.');
      return false;
    }
    router.replace('/first-interests');
  };

  return (
    <Screen style={{ paddingBottom: 16 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Wordmark />
        <Text style={styles.head} accessibilityRole="header">
          What should we <Em>call you?</Em>
        </Text>
        <Text style={styles.lead}>Your first name is all we need. Friends see it when you send them a story.</Text>
        <TextInput
          value={name}
          onChangeText={(text) => {
            setError(null);
            setName(text);
          }}
          placeholder="First name"
          placeholderTextColor={colors.gray}
          accessibilityLabel="Your first name"
          autoFocus
          autoCapitalize="words"
          autoComplete="given-name"
          textContentType="givenName"
          returnKeyType="done"
          maxLength={40}
          onSubmitEditing={save}
          style={styles.input}
        />
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {ready && !saving ? (
          <SlideToStart compact label="Continue" onDone={save} />
        ) : (
          <View style={styles.wait}>
            <Text style={styles.waitText}>{saving ? 'Saving' : 'Type your name'}</Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { fontFamily: fonts.serif, fontSize: 44, lineHeight: 45, letterSpacing: -0.5, color: colors.ink, marginTop: 28 },
  lead: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.gray, marginTop: 12, marginBottom: 24 },
  input: { height: 64, borderRadius: 32, backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.ink, paddingHorizontal: 26, fontFamily: fonts.body, fontSize: 20, color: colors.ink },
  error: { fontFamily: fonts.bodySemi, fontSize: 13, lineHeight: 19, color: colors.vermilion, marginTop: 10 },
  wait: { height: 72, borderRadius: 36, backgroundColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  waitText: { fontFamily: fonts.bodySemi, fontSize: 20, color: colors.gray },
});

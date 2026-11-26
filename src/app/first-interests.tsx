// A4. First interests. A new person picks at least three things they are into, and Pliny
// starts from those. Laid out like the Interests tab: what you have picked on top, the box
// to add your own under it, and suggestions below. Picks can be changed any time later.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { SlideToStart } from '@/components/SlideToStart';
import { Em, Eyebrow, Screen, Wordmark } from '@/components/ui';
import { addInterests, popularInterests, stockExplore } from '@/lib/api';
import { useProfile } from '@/state/profile';
import { useTopics } from '@/state/topics';
import { colors, fonts } from '@/theme';

const STARTERS = [
  'Weird history',
  'Weird science',
  'How things work',
  'Inventions',
  'True crime',
  'Conspiracy theories',
  'Unsolved mysteries',
  'Heists and cons',
  'Spies',
  'Space',
  'Disasters',
  'Lost civilizations',
  'Medical oddities',
  'Food origins',
  'Money and scams',
  'Explorers',
];
const NEEDED = 3;
const MOST = 10;

export default function FirstInterests() {
  const firstName = useProfile((s) => s.first_name);
  const [picked, setPicked] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [typing, setTyping] = useState(false);
  // The interests with the most finished, best liked stories lead the suggestions. Picking one
  // means the first stories are already made. The fixed list fills in behind them.
  const [popular, setPopular] = useState<string[]>([]);
  useEffect(() => {
    popularInterests().then(setPopular).catch(() => {});
  }, []);
  const offered = [...popular, ...STARTERS].filter((label, i, all) => all.findIndex((l) => l.toLowerCase() === label.toLowerCase()) === i).slice(0, 16);

  // While the keyboard is up, everything that is not the picks and the box steps aside,
  // so what is being typed is always in view.
  useEffect(() => {
    const up = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setTyping(true));
    const down = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setTyping(false));
    return () => {
      up.remove();
      down.remove();
    };
  }, []);

  const has = (label: string) => picked.some((p) => p.toLowerCase() === label.toLowerCase());
  const add = (label: string) => {
    setError(null);
    if (has(label)) return;
    if (picked.length >= MOST) return setError(`${MOST} is the most for now. Remove one to add another.`);
    setPicked([...picked, label]);
  };
  const remove = (label: string) => {
    setError(null);
    setPicked(picked.filter((p) => p !== label));
  };
  const addOwn = () => {
    const label = typed.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!label) return;
    setTyped('');
    // The tag is in. The keyboard goes away, so the picks and the Continue slider are in view.
    Keyboard.dismiss();
    add(offered.find((s) => s.toLowerCase() === label.toLowerCase()) ?? label);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await addInterests(picked);
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? err.message : 'Those did not save. Try again.');
      return false;
    }
    // Stories and Explore ideas are thought up from these, so that starts right away.
    stockExplore();
    useTopics.getState().load();
    router.replace('/listen');
  };

  const need = Math.max(0, NEEDED - picked.length);
  const suggestions = offered.filter((s) => !has(s));

  return (
    <Screen style={{ paddingBottom: 16 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.top}>
          <Wordmark />
          <Text style={styles.count}>{picked.length} picked</Text>
        </View>
        {typing ? null : (
          <Text style={styles.head} accessibilityRole="header">
            {firstName ? `Welcome, ${firstName}.` : 'Welcome.'} What are you <Em>into?</Em>
          </Text>
        )}

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Eyebrow style={{ marginTop: typing ? 14 : 4, marginBottom: 8 }}>Your picks</Eyebrow>
          {picked.length === 0 ? (
            <Text style={styles.empty}>Nothing yet. Pick at least {NEEDED}, from the suggestions or your own.</Text>
          ) : (
            <View style={styles.chips}>
              {picked.map((label) => (
                <Pressable key={label} onPress={() => remove(label)} accessibilityRole="button" accessibilityLabel={`Remove ${label}`} style={[styles.chip, styles.chipOn]}>
                  <Text style={[styles.chipText, { color: colors.paper }]}>{label}</Text>
                  <Text style={styles.cross}>×</Text>
                </Pressable>
              ))}
            </View>
          )}

          <View style={styles.own}>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              placeholder="Add your own"
              placeholderTextColor={colors.gray}
              accessibilityLabel="Type your own interest"
              returnKeyType="done"
              autoCorrect
              onSubmitEditing={addOwn}
              maxLength={40}
              style={styles.input}
            />
            <Pressable onPress={addOwn} accessibilityRole="button" style={styles.add}>
              <Text style={styles.addText}>Add</Text>
            </Pressable>
          </View>
          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <Eyebrow style={{ marginTop: 20, marginBottom: 8 }}>Suggestions</Eyebrow>
          <View style={styles.chips}>
            {suggestions.map((label) => (
              <Pressable key={label} onPress={() => add(label)} accessibilityRole="button" accessibilityLabel={`Add ${label}`} style={styles.chip}>
                <Text style={styles.chipText}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        {typing ? null : (
          <>
            {need === 0 && !saving ? (
              <SlideToStart compact label="Continue" onDone={save} />
            ) : (
              <View style={styles.wait}>
                <Text style={styles.waitText}>{saving ? 'Saving' : `Pick ${need} more`}</Text>
              </View>
            )}
          </>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.gray },
  head: { fontFamily: fonts.serif, fontSize: 40, lineHeight: 41, letterSpacing: -0.5, color: colors.ink, marginTop: 14, marginBottom: 14 },
  empty: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.gray },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', gap: 8 },
  chipOn: { backgroundColor: colors.ink },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
  cross: { fontFamily: fonts.bodySemi, fontSize: 18, lineHeight: 20, color: colors.yellow },
  own: { flexDirection: 'row', gap: 8, marginTop: 16 },
  input: { flex: 1, minWidth: 0, height: 56, borderRadius: 28, backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.ink, paddingHorizontal: 22, fontFamily: fonts.body, fontSize: 17, color: colors.ink },
  add: { height: 56, paddingHorizontal: 22, borderRadius: 28, backgroundColor: colors.yellow, borderWidth: 1.5, borderColor: colors.ink, justifyContent: 'center' },
  addText: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.ink },
  error: { fontFamily: fonts.bodySemi, fontSize: 13, lineHeight: 19, color: colors.vermilion, marginTop: 10 },
  wait: { height: 72, borderRadius: 36, backgroundColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  waitText: { fontFamily: fonts.bodySemi, fontSize: 20, color: colors.gray },
});

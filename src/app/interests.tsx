// 10. Interests. The few tags Pliny draws its topics from.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { NowPlayingBar } from '@/components/NowPlayingBar';
import { Em, Eyebrow, Icon, OutlineButton, RoundButton, Screen, Serif, TabBar, Wordmark } from '@/components/ui';
import { addInterest, getInterests, removeInterest, type Interests as InterestsData } from '@/lib/api';
import { colors, fonts, gutter } from '@/theme';

// The last list the server sent, kept for as long as the app is open.
let remembered: InterestsData | null = null;
/** Forgets the last person's interests, so the next person to sign in never sees them. */
export const forgetInterests = () => {
  remembered = null;
};

export default function Interests() {
  // Opens with what was shown last time, so the screen is never blank while the server answers.
  const [data, setDataNow] = useState<InterestsData | null>(remembered);
  const setData = (fresh: InterestsData) => {
    remembered = fresh;
    setDataNow(fresh);
  };
  const [draft, setDraft] = useState('');
  // Counts requests in flight, so a slow answer to an earlier change never overwrites a newer one.
  const latest = useRef(0);
  const [error, setError] = useState<string | null>(null);

  // Every change goes to the server and comes back as the full, current list.
  const run = (change: () => Promise<InterestsData>) => {
    const mine = ++latest.current;
    setError(null);
    change()
      .then((fresh) => mine === latest.current && setData(fresh))
      .catch((err) => {
        if (mine !== latest.current) return;
        setError(err instanceof Error ? err.message : 'That did not save.');
        getInterests().then(setData).catch(() => {});
      });
  };
  useEffect(() => run(getInterests), []);

  const tags = data?.interests ?? [];
  const max = data?.max ?? 10;
  const full = tags.length >= max;
  // A change shows on screen at once. The server takes a few seconds, because it also
  // rethinks its suggestions, and its answer then replaces what is shown.
  const add = (label: string) => {
    const clean = label.trim();
    if (!clean || full || tags.some((t) => t.label.toLowerCase() === clean.toLowerCase())) return;
    setDraft('');
    if (data) setData({ ...data, interests: [...tags, { id: `pending-${clean}`, label: clean }], suggestions: data.suggestions.filter((s) => s !== clean) });
    run(() => addInterest(clean));
  };
  const remove = (id: string) => {
    if (id.startsWith('pending-')) return;
    if (data) setData({ ...data, interests: tags.filter((t) => t.id !== id) });
    run(() => removeInterest(id));
  };

  return (
    <Screen flush>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.top}>
            <RoundButton label="Back to Explore" onPress={() => router.replace('/explore')}>
              <Icon name="back" size={22} />
            </RoundButton>
            <Wordmark />
            <OutlineButton label="Settings" height={40} textSize={14} style={{ paddingHorizontal: 16 }} onPress={() => router.push('/settings')} />
          </View>
          <Serif size={38} style={{ marginTop: 18, paddingRight: 6 }}>
            What are you <Em>into?</Em>
          </Serif>
          <Text style={styles.lead}>{full ? `You have all ${max}.` : `Add up to ${max} tags.`}</Text>

          {data === null && !error ? <ActivityIndicator color={colors.ink} style={{ marginTop: 24 }} /> : null}

          <View style={styles.chips}>
            {tags.map((tag) => (
              <Pressable key={tag.id} accessibilityRole="button" accessibilityLabel={`Remove ${tag.label}`} onPress={() => remove(tag.id)} style={styles.chip}>
                <Text style={styles.chipLabel}>{tag.label}</Text>
                <Text style={styles.chipX}>×</Text>
              </Pressable>
            ))}
          </View>

          {full ? (
            <View style={styles.fullNote} accessibilityRole="text">
              <Text style={styles.fullTitle}>That is all {max}.</Text>
              <Text style={styles.fullText}>Tap a tag above to remove it, then you can add another.</Text>
            </View>
          ) : (
          <View style={styles.adder}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={() => add(draft)}
              placeholder="Add a tag"
              placeholderTextColor={colors.gray}
              returnKeyType="done"
              maxLength={40}
              autoCapitalize="words"
              accessibilityLabel="Add a tag"
              style={styles.input}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Add tag" disabled={full || !draft.trim()} onPress={() => add(draft)} style={[styles.add, (full || !draft.trim()) && { opacity: 0.5 }]}>
              <Text style={styles.addLabel}>Add</Text>
            </Pressable>
          </View>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {data && !full && data.suggestions.length > 0 ? (
            <>
              <Eyebrow style={{ marginTop: 26, marginBottom: 12 }}>Pliny suggests</Eyebrow>
              <View style={styles.chips}>
                {data.suggestions.map((label) => (
                  <Pressable key={label} accessibilityRole="button" accessibilityLabel={`Add ${label}`} disabled={full} onPress={() => add(label)} style={[styles.suggestion, full && { opacity: 0.5 }]}>
                    <Text style={styles.suggestionLabel}>+ {label}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

        </ScrollView>
      </KeyboardAvoidingView>
      <NowPlayingBar />
      <View style={{ height: 10 }} />
      <TabBar active="explore" within />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: gutter, paddingBottom: 24 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lead: { fontFamily: fonts.body, fontSize: 16, color: colors.gray, marginTop: 8, marginBottom: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { height: 48, borderRadius: 24, backgroundColor: colors.ink, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 18, paddingRight: 16 },
  chipLabel: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.paper },
  chipX: { fontFamily: fonts.body, fontSize: 22, lineHeight: 24, color: colors.paper },
  adder: { flexDirection: 'row', gap: 10, marginTop: 18 },
  input: { flex: 1, minWidth: 0, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.white, paddingHorizontal: 22, fontFamily: fonts.body, fontSize: 17, color: colors.ink },
  add: { height: 56, minWidth: 84, borderRadius: 28, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.yellow, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  addLabel: { fontFamily: fonts.bodySemi, fontSize: 17, color: colors.ink },
  fullNote: { marginTop: 18, borderWidth: 1.5, borderColor: colors.ink, borderStyle: 'dashed', paddingVertical: 16, paddingHorizontal: 18, gap: 4 },
  fullTitle: { fontFamily: fonts.bodySemi, fontSize: 17, color: colors.ink },
  fullText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.gray },
  error: { fontFamily: fonts.body, fontSize: 14, color: colors.vermilion, marginTop: 10 },
  suggestion: { height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: colors.ink, borderStyle: 'dashed', justifyContent: 'center', paddingHorizontal: 16 },
  suggestionLabel: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
});

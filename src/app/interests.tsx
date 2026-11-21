// 10. Interests. The few tags Pliny draws its topics from.
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { NowPlayingBar } from '@/components/NowPlayingBar';
import { Em, Eyebrow, Screen, Serif, TabBar, Wordmark } from '@/components/ui';
import { addInterest, getInterests, removeInterest, type Interests as InterestsData } from '@/lib/api';
import { colors, fonts, gutter } from '@/theme';

export default function Interests() {
  const [data, setData] = useState<InterestsData | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every change goes to the server and comes back as the full, current list.
  const run = (change: () => Promise<InterestsData>) => {
    setBusy(true);
    setError(null);
    change()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'That did not save.'))
      .finally(() => setBusy(false));
  };
  useEffect(() => run(getInterests), []);

  const tags = data?.interests ?? [];
  const max = data?.max ?? 10;
  const full = tags.length >= max;
  const add = (label: string) => {
    const clean = label.trim();
    if (!clean || full || busy) return;
    setDraft('');
    run(() => addInterest(clean));
  };

  return (
    <Screen flush>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.top}>
            <Wordmark />
            <Text style={styles.count}>
              {tags.length} of {max}
            </Text>
          </View>
          <Serif style={{ marginTop: 18 }}>
            What are you <Em>into?</Em>
          </Serif>
          <Text style={styles.lead}>Add up to {max} tags.</Text>

          {data === null && !error ? <ActivityIndicator color={colors.ink} style={{ marginTop: 24 }} /> : null}

          <View style={styles.chips}>
            {tags.map((tag) => (
              <Pressable key={tag.id} accessibilityRole="button" accessibilityLabel={`Remove ${tag.label}`} onPress={() => run(() => removeInterest(tag.id))} style={styles.chip}>
                <Text style={styles.chipLabel}>{tag.label}</Text>
                <Text style={styles.chipX}>×</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.adder}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={() => add(draft)}
              placeholder={full ? 'Remove a tag to add another' : 'Add a tag'}
              placeholderTextColor={colors.gray}
              editable={!full}
              returnKeyType="done"
              maxLength={40}
              autoCapitalize="words"
              accessibilityLabel="Add a tag"
              style={styles.input}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Add tag" disabled={full || busy || !draft.trim()} onPress={() => add(draft)} style={[styles.add, (full || busy || !draft.trim()) && { opacity: 0.5 }]}>
              {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.addLabel}>Add</Text>}
            </Pressable>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {data && data.suggestions.length > 0 ? (
            <>
              <Eyebrow style={{ marginTop: 26, marginBottom: 12 }}>Pliny suggests</Eyebrow>
              <View style={styles.chips}>
                {data.suggestions.map((label) => (
                  <Pressable key={label} accessibilityRole="button" accessibilityLabel={`Add ${label}`} disabled={full || busy} onPress={() => add(label)} style={[styles.suggestion, full && { opacity: 0.5 }]}>
                    <Text style={styles.suggestionLabel}>+ {label}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          <Text style={styles.wander}>About 1 in 4 lessons will wander off the map.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
      <NowPlayingBar />
      <View style={{ height: 10 }} />
      <TabBar active="interests" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: gutter, paddingBottom: 24 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.gray },
  lead: { fontFamily: fonts.body, fontSize: 16, color: colors.gray, marginTop: 8, marginBottom: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { height: 48, borderRadius: 24, backgroundColor: colors.ink, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 18, paddingRight: 16 },
  chipLabel: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.paper },
  chipX: { fontFamily: fonts.body, fontSize: 22, lineHeight: 24, color: colors.paper },
  adder: { flexDirection: 'row', gap: 10, marginTop: 18 },
  input: { flex: 1, minWidth: 0, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.white, paddingHorizontal: 22, fontFamily: fonts.body, fontSize: 17, color: colors.ink },
  add: { height: 56, minWidth: 84, borderRadius: 28, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.yellow, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  addLabel: { fontFamily: fonts.bodySemi, fontSize: 17, color: colors.ink },
  error: { fontFamily: fonts.body, fontSize: 14, color: colors.vermilion, marginTop: 10 },
  suggestion: { height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: colors.ink, borderStyle: 'dashed', justifyContent: 'center', paddingHorizontal: 16 },
  suggestionLabel: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
  wander: { fontFamily: fonts.serifItalic, fontSize: 22, lineHeight: 26, color: colors.ink, marginTop: 28 },
});

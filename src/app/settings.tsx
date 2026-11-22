// Settings. For now, one choice: who reads the lessons.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Em, Eyebrow, Icon, OutlineButton, RoundButton, Screen, Serif, Wordmark } from '@/components/ui';
import { getVoice, setVoice, type Voice } from '@/lib/api';
import { forgetInterests } from '@/app/interests';
import { usePlayer } from '@/state/player';
import { useTopics } from '@/state/topics';
import { useSession } from '@/state/session';
import { colors, fonts } from '@/theme';

export default function Settings() {
  const [data, setData] = useState<Voice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const email = useSession((s) => s.email);

  // Signing out stops whatever is playing. The root layout then shows the sign-in screen.
  const signOut = () => {
    usePlayer.getState().stop();
    // Nothing of this person's is left on screen for whoever signs in next.
    useTopics.setState({ topics: [], selected: null, error: null, stuck: false });
    forgetInterests();
    useSession.getState().signOut();
  };

  useEffect(() => {
    getVoice()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Settings could not be loaded.'));
  }, []);

  // The choice shows at once. If the server refuses it, the old choice comes back.
  const choose = (id: string) => {
    if (!data || data.voice === id) return;
    const before = data;
    setError(null);
    setData({ ...data, voice: id });
    setVoice(id)
      .then(setData)
      .catch((err) => {
        setData(before);
        setError(err instanceof Error ? err.message : 'That did not save.');
      });
  };

  return (
    <Screen>
      <View style={styles.top}>
        <RoundButton label="Back" onPress={() => router.back()}>
          <Icon name="back" size={22} />
        </RoundButton>
        <Wordmark />
        <View style={{ width: 48 }} />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <Serif style={{ marginTop: 18 }}>
          Your <Em>narrator.</Em>
        </Serif>
        <Text style={styles.lead}>Who reads to you. A new voice starts with the next chapter that is recorded. Chapters already saved keep the voice they were made with.</Text>

        {data === null && !error ? <ActivityIndicator color={colors.ink} style={{ marginTop: 24 }} /> : null}
        {data ? <Eyebrow style={{ marginBottom: 10 }}>Voice</Eyebrow> : null}
        <View accessibilityRole="radiogroup">
          {data?.narrators.map((narrator) => {
            const on = narrator.id === data.voice;
            return (
              <Pressable
                key={narrator.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${narrator.name}. ${narrator.note}`}
                onPress={() => choose(narrator.id)}
                style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && { opacity: 0.8 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{narrator.name}</Text>
                  <Text style={styles.note}>{narrator.note}</Text>
                </View>
                <View style={[styles.mark, on && styles.markOn]}>{on ? <Icon name="check" size={16} color={colors.paper} weight={3.5} /> : null}</View>
              </Pressable>
            );
          })}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Eyebrow style={{ marginTop: 26, marginBottom: 10 }}>Account</Eyebrow>
        <Text style={styles.account}>{email ? `Signed in as ${email}` : 'Signed in'}</Text>
        <OutlineButton label="Sign out" onPress={signOut} style={{ alignSelf: 'flex-start', marginTop: 12 }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lead: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.gray, marginTop: 10, marginBottom: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 76, paddingVertical: 12, paddingHorizontal: 18, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.white, marginBottom: 10 },
  rowOn: { backgroundColor: colors.yellow },
  name: { fontFamily: fonts.bodySemi, fontSize: 18, color: colors.ink },
  note: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.gray, marginTop: 2 },
  mark: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  markOn: { backgroundColor: colors.ink },
  error: { fontFamily: fonts.body, fontSize: 14, color: colors.vermilion, marginTop: 6 },
  account: { fontFamily: fonts.body, fontSize: 16, color: colors.ink },
});

// 3. Length. How long do you have? A few big cards, the last of them the whole story.
//
// A story has a length of its own now, so the choices are a handful of shorter tellings
// and the whole thing. Nothing is ever stretched to fill time.
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BigButton, Em, Eyebrow, Icon, RoundButton, Screen, Serif } from '@/components/ui';
import { usePlayer } from '@/state/player';
import { useTopics } from '@/state/topics';
import { colors, fonts } from '@/theme';

const SHORTER = [5, 10, 20, 30, 45];

export default function Length() {
  const topic = useTopics((s) => s.selected);
  const begin = usePlayer((s) => s.begin);
  // The whole story, start to finish. A lesson can be no longer than that.
  const whole = Math.max(5, Math.min(60, topic?.recommended_minutes ?? topic?.max_minutes ?? 60));
  // Shorter tellings are only offered when they are meaningfully shorter than the whole.
  const shorter = SHORTER.filter((m) => m <= whole - 3);
  const [minutes, setMinutes] = useState(whole <= 20 || shorter.length === 0 ? whole : shorter.includes(10) ? 10 : shorter[0]);

  if (!topic) {
    return (
      <Screen>
        <RoundButton label="Back" onPress={() => router.replace('/listen')}>
          <Icon name="back" size={22} />
        </RoundButton>
      </Screen>
    );
  }

  return (
    <Screen style={{ paddingBottom: 40 }}>
      <View style={{ flexDirection: 'row' }}>
        <RoundButton label="Back" onPress={() => router.back()}>
          <Icon name="back" size={22} />
        </RoundButton>
      </View>
      <Eyebrow style={{ marginTop: 24, marginBottom: 6 }}>{topic.title}</Eyebrow>
      <Serif style={{ marginBottom: 18 }}>
        How long do you <Em>have?</Em>
      </Serif>

      <View accessibilityRole="radiogroup" style={styles.cards}>
        {shorter.map((m) => {
          const on = minutes === m;
          return (
            <Pressable
              key={m}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${m} minutes`}
              onPress={() => setMinutes(m)}
              style={({ pressed }) => [styles.card, on && styles.cardOn, pressed && { opacity: 0.85 }]}
            >
              <Text style={[styles.number, on && { color: colors.paper }]}>{m}</Text>
              <Text style={[styles.unit, on && { color: colors.paper }]}>min</Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: minutes === whole }}
          accessibilityLabel={`The whole story, ${whole} minutes`}
          onPress={() => setMinutes(whole)}
          style={({ pressed }) => [styles.card, styles.whole, minutes === whole && styles.wholeOn, pressed && { opacity: 0.85 }]}
        >
          <View>
            <Text style={styles.wholeLabel}>Whole story</Text>
            <Text style={styles.wholeNote}>Every chapter, start to finish</Text>
          </View>
          <View style={styles.wholeTime}>
            <Text style={styles.number}>{whole}</Text>
            <Text style={styles.unit}>min</Text>
          </View>
        </Pressable>
      </View>
      {minutes < whole ? <Text style={styles.cut}>A shorter telling keeps the opening and the ending, and tightens the middle.</Text> : null}

      <View style={{ flex: 1 }} />
      <BigButton
        label="Start lesson"
        onPress={() => {
          begin(topic, minutes);
          router.replace('/building');
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // Two to a row. The whole story takes a row to itself.
  card: { flexGrow: 1, flexBasis: '45%', height: 96, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 12 },
  cardOn: { backgroundColor: colors.ink },
  number: { fontFamily: fonts.display, fontSize: 56, lineHeight: 56, letterSpacing: -3, color: colors.ink, marginBottom: -6 },
  unit: { fontFamily: fonts.displayMedium, fontSize: 18, color: colors.ink },
  whole: { flexBasis: '100%', height: 112, alignItems: 'center', paddingBottom: 0, borderTopRightRadius: 40 },
  wholeOn: { backgroundColor: colors.yellow },
  wholeLabel: { fontFamily: fonts.display, fontSize: 26, letterSpacing: -1, textTransform: 'uppercase', color: colors.ink },
  wholeNote: { fontFamily: fonts.body, fontSize: 14, color: colors.ink, marginTop: 2 },
  wholeTime: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  cut: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.gray, marginTop: 12 },
});

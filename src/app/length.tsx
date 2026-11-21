// 3. Length. How long do you have? Three big buttons, and a slider for anything in between.
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';

import { BigButton, Em, Eyebrow, Icon, OutlineButton, RoundButton, Screen, Serif } from '@/components/ui';
import { usePlayer } from '@/state/player';
import { useTopics } from '@/state/topics';
import { colors, fonts } from '@/theme';

const MIN = 5;
const STEP = 5;
const PRESETS = [
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
];

export default function Length() {
  const topic = useTopics((s) => s.selected);
  const begin = usePlayer((s) => s.begin);
  // A lesson can be no longer than the topic has material for.
  const max = Math.max(MIN, Math.floor(Math.min(60, topic?.max_minutes ?? 60) / STEP) * STEP);
  const [minutes, setMinutes] = useState(Math.min(30, max));
  const width = useRef(1);

  const fromTouch = (x: number) => {
    const share = Math.max(0, Math.min(1, x / width.current));
    setMinutes(Math.round((MIN + share * (max - MIN)) / STEP) * STEP);
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => fromTouch(e.nativeEvent.locationX),
      onPanResponderMove: (e) => fromTouch(e.nativeEvent.locationX),
    }),
  ).current;

  if (!topic) {
    return (
      <Screen>
        <RoundButton label="Back" onPress={() => router.replace('/listen')}>
          <Icon name="back" size={22} />
        </RoundButton>
      </Screen>
    );
  }

  const share = max === MIN ? 1 : (minutes - MIN) / (max - MIN);
  const hour = minutes === 60;

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

      <View style={styles.panel}>
        <View style={styles.ring} />
        <Text style={styles.big}>{hour ? 1 : minutes}</Text>
        <Text style={styles.unit}>{hour ? 'hour' : 'min'}</Text>
      </View>

      <View
        style={styles.slider}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Lesson length"
        accessibilityValue={{ min: MIN, max, now: minutes, text: `${minutes} minutes` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => setMinutes((m) => Math.max(MIN, Math.min(max, m + (e.nativeEvent.actionName === 'increment' ? STEP : -STEP))))}
        onLayout={(e) => (width.current = e.nativeEvent.layout.width)}
        {...pan.panHandlers}
      >
        <View style={styles.track} pointerEvents="none" />
        <View style={[styles.thumb, { left: `${share * 100}%` }]} pointerEvents="none" />
      </View>
      <View style={styles.ends}>
        <Text style={styles.end}>{MIN} min</Text>
        <Text style={styles.end}>{max === 60 ? '1 hour' : `${max} min`}</Text>
      </View>

      <View style={styles.presets}>
        {PRESETS.filter((p) => p.minutes <= max).map((p) => (
          <OutlineButton key={p.minutes} label={p.label} height={56} textSize={17} selected={minutes === p.minutes} style={{ flex: 1, paddingHorizontal: 0 }} onPress={() => setMinutes(p.minutes)} />
        ))}
      </View>

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
  panel: { height: 190, backgroundColor: colors.yellow, borderTopRightRadius: 40, overflow: 'hidden', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 24, paddingBottom: 20 },
  ring: { position: 'absolute', right: -40, top: -40, width: 130, height: 130, borderRadius: 65, borderWidth: 3, borderColor: colors.blue },
  big: { fontFamily: fonts.display, fontSize: 120, lineHeight: 120, letterSpacing: -6, color: colors.ink, marginBottom: -18 },
  unit: { fontFamily: fonts.displayMedium, fontSize: 24, color: colors.ink },
  slider: { marginTop: 22, height: 44, justifyContent: 'center', marginHorizontal: 20 },
  track: { position: 'absolute', left: -20, right: -20, height: 10, borderRadius: 5, backgroundColor: colors.ink },
  thumb: { position: 'absolute', width: 40, height: 40, marginLeft: -20, borderRadius: 20, backgroundColor: colors.vermilion, borderWidth: 2.5, borderColor: colors.ink },
  ends: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  end: { fontFamily: fonts.body, fontSize: 13, color: colors.gray },
  presets: { flexDirection: 'row', gap: 10, marginTop: 20 },
});

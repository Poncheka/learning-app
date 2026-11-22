// Pliny's geometric artwork, drawn in code.
//
// The moving compositions: the artwork on the Playing screen and the rings on the Building
// screen. The still backgrounds behind the topic cards are Jeff's drawings, in covers.tsx.
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors } from '@/theme';

const bars = [0, 20, 32, 12, 56, 80, 40, 60, 24, 72, 44, 8, 28, 52, 16, 4, 12, 0, 8, 0, 2, 0, 0, 0, 0, 0, 0];

/**
 * The artwork on the Playing screen: a disc, a line of sound, a bar and an arc.
 * The sound line fills in with the lesson, so the picture doubles as a quiet progress mark.
 */
export function PlayingArt({ progress, color, playing }: { progress: number; color: string; playing?: boolean }) {
  const disc = color;
  // While audio plays, the bars breathe. This is drawn motion, not a reading of the sound:
  // each bar swells and settles on its own slow rhythm. Paused, they hold still.
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setBeat((b) => b + 1), 110);
    return () => clearInterval(timer);
  }, [playing]);
  const live = (height: number, i: number) => (height === 0 ? 0 : height * (0.62 + 0.38 * Math.sin(beat * (0.35 + (i % 5) * 0.07) + i * 1.7)));
  const lit = Math.round(progress * bars.length);
  return (
    <View style={styles.playing} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.abs, { left: 34, top: '50%', marginTop: -100, width: 200, height: 200, borderRadius: 100, backgroundColor: disc }]} />
      <Svg style={[styles.abs, { left: 0, top: '50%', marginTop: -50 }]} width={342} height={100} viewBox="0 0 342 100" fill="none" strokeWidth={2} strokeLinecap="round">
        {bars.map((height, i) => (
          <Path key={i} d={`M${8 + i * 12} ${50 - live(height, i) / 2}v${Math.max(live(height, i), 0.01)}`} stroke={colors.ink} opacity={i < lit || height === 0 ? 1 : 0.35} />
        ))}
      </Svg>
      <View style={[styles.abs, { right: 16, top: 12, width: 90, height: 22, backgroundColor: colors.yellow }]} />
      <Svg style={[styles.abs, { right: 0, bottom: -70 }]} width={150} height={150} viewBox="0 0 150 150" fill="none">
        <Path d="M13 75a62 62 0 0 1 124 0v75" stroke={disc === colors.blue ? colors.vermilion : colors.blue} strokeWidth={26} />
      </Svg>
    </View>
  );
}

function useSpin(seconds: number, reverse?: boolean) {
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: seconds * 1000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [turn, seconds]);
  return { transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: reverse ? ['360deg', '0deg'] : ['0deg', '360deg'] }) }] };
}

/** The turning rings shown while a lesson gets going. */
export function BuildingArt() {
  const outer = useSpin(7);
  const inner = useSpin(4.5, true);
  const dot = useSpin(5, true);
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.center} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.abs, outer]}>
        <Svg width={290} height={290} viewBox="0 0 290 290" fill="none">
          <Circle cx={145} cy={145} r={143.5} stroke={colors.ink} strokeWidth={3} strokeDasharray="676 226" />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.abs, inner]}>
        <Svg width={210} height={210} viewBox="0 0 210 210" fill="none">
          <Circle cx={105} cy={105} r={103.5} stroke={colors.blue} strokeWidth={3} strokeDasharray="488 163" />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.abs, { width: 290, height: 290 }, dot]}>
        <View style={{ position: 'absolute', top: -2, left: 132, width: 26, height: 26, borderRadius: 13, backgroundColor: colors.yellow, borderWidth: 3, borderColor: colors.ink }} />
      </Animated.View>
      <Animated.View
        style={[styles.abs, { width: 112, height: 112, borderRadius: 56, backgroundColor: colors.vermilion }, { transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }] }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  ring: { borderWidth: 3, borderColor: colors.blue },
  playing: { flex: 1, minHeight: 150, marginVertical: 16, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

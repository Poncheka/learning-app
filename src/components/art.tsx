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
 *
 * The line of sound is the narrator's real voice. Each chapter arrives with its `shape`, a digit
 * for every slice of the recording, and the bars show the few seconds around this moment: what
 * was just said to the left of the mark, what is about to be said to the right. A pause in the
 * telling passes through as a gap. A chapter with no shape yet falls back to bars that breathe.
 */
const HEAD = 9; // The bar that stands for this very moment.

export function PlayingArt({ color, playing, shape, time = 0, length = 0 }: { color: string; playing?: boolean; shape?: string | null; time?: number; length?: number }) {
  const disc = color;
  const [beat, setBeat] = useState(0);
  // The player reports its place a couple of times a second. Between reports the clock runs on.
  const heard = useRef({ time, at: Date.now() });
  useEffect(() => {
    heard.current = { time, at: Date.now() };
  }, [time, playing]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setBeat((b) => b + 1), 90);
    return () => clearInterval(timer);
  }, [playing]);

  const real = typeof shape === 'string' && shape.length > 1 && length > 0;
  const now = heard.current.time + (playing ? Math.min(1.5, (Date.now() - heard.current.at) / 1000) : 0);
  const level = (slice: number) => (!real || slice < 0 || slice >= shape!.length ? 0 : shape!.charCodeAt(slice) - 48);
  const live = (height: number, i: number) => {
    if (!real) return height === 0 ? 0 : height * (0.62 + 0.38 * Math.sin(beat * (0.35 + (i % 5) * 0.07) + i * 1.7));
    // Where this bar falls in the recording, eased between its two nearest slices so the line flows.
    const at = (now / length) * shape!.length + (i - HEAD);
    const low = Math.floor(at);
    const loud = level(low) + (level(low + 1) - level(low)) * (at - low);
    // The line thins toward both ends, as the drawn one does.
    const edge = Math.min(1, (i + 1) / 3, (bars.length - i) / 5);
    return Math.max(2, (loud / 9) * 84 * edge);
  };
  const lit = real ? HEAD + 1 : bars.length;
  return (
    <View style={styles.playing} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.abs, { left: 34, top: '50%', marginTop: -100, width: 200, height: 200, borderRadius: 100, backgroundColor: disc }]} />
      <Svg style={[styles.abs, { left: 0, top: '50%', marginTop: -50 }]} width={342} height={100} viewBox="0 0 342 100" fill="none" strokeWidth={2} strokeLinecap="round">
        {bars.map((height, i) => (
          <Path key={i} d={`M${8 + i * 12} ${50 - live(height, i) / 2}v${Math.max(live(height, i), 0.01)}`} stroke={colors.ink} opacity={i < lit || (!real && height === 0) ? 1 : 0.35} />
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

// The slide to start control on the Open screen, from Jeff's design: a dark track, a yellow
// thumb that nudges and pulses to invite a drag, chevrons that ripple toward "Start", and
// a red fill that follows the thumb. Sliding most of the way across starts the app.
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, PanResponder, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Icon } from '@/components/ui';
import { colors, fonts, gutter } from '@/theme';

const INSET = 8;
// How far across counts as meaning it.
const FAR_ENOUGH = 0.88;

/**
 * `compact` is the smaller slider used on the sign-in screens. If `onDone` answers false,
 * the thumb slides back and the slider can be used again.
 */
export function SlideToStart({ label = 'Start', onDone, compact }: { label?: string; onDone: () => void | boolean | Promise<void | boolean>; compact?: boolean }) {
  const HEIGHT = compact ? 72 : 88;
  const THUMB = HEIGHT - INSET * 2;
  const travel = useWindowDimensions().width - gutter * 2 - THUMB - INSET * 2;
  const x = useRef(new Animated.Value(0)).current;
  const nudge = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const chevrons = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  const idle = useRef<Animated.CompositeAnimation | null>(null);
  // Kept in a ref so the gesture, which is set up once, always sees the latest values.
  const live = useRef({ travel, onDone, calm: false, leaving: false });
  live.current.travel = travel;
  live.current.onDone = onDone;

  const invite = () => {
    if (live.current.calm) return;
    idle.current?.stop();
    nudge.setValue(0);
    ring.setValue(0);
    // One beat every 2.6 seconds: rest, then lean right and settle while a ring spreads out.
    idle.current = Animated.loop(
      Animated.sequence([
        Animated.delay(1430),
        Animated.parallel([
          Animated.sequence([
            Animated.timing(nudge, { toValue: 14, duration: 390, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
            Animated.timing(nudge, { toValue: 0, duration: 390, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
          ]),
          Animated.timing(ring, { toValue: 1, duration: 1170, easing: Easing.out(Easing.ease), useNativeDriver: false }),
        ]),
        Animated.timing(ring, { toValue: 0, duration: 0, useNativeDriver: false }),
      ]),
    );
    idle.current.start();
  };
  const rest = () => {
    idle.current?.stop();
    nudge.setValue(0);
    ring.setValue(0);
  };

  useEffect(() => {
    let ripples: Animated.CompositeAnimation[] = [];
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((calm) => {
        live.current.calm = calm;
        if (calm) return chevrons.forEach((c) => c.setValue(1));
        invite();
        ripples = chevrons.map((value, i) =>
          Animated.loop(
            Animated.sequence([
              Animated.delay(i * 200),
              Animated.timing(value, { toValue: 1, duration: 640, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
              Animated.timing(value, { toValue: 0, duration: 960, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
              Animated.delay((2 - i) * 200),
            ]),
          ),
        );
        ripples.forEach((r) => r.start());
      });
    return () => {
      idle.current?.stop();
      ripples.forEach((r) => r.stop());
    };
    // Set up once. The animated values never change identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    live.current.leaving = true;
    Animated.timing(x, { toValue: live.current.travel, duration: 140, useNativeDriver: false }).start(() => {
      Promise.resolve(live.current.onDone())
        .catch(() => false)
        .then((ok) => {
          if (ok !== false) return;
          live.current.leaving = false;
          Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 6 }).start(invite);
        });
    });
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !live.current.leaving,
      onMoveShouldSetPanResponder: () => !live.current.leaving,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: rest,
      onPanResponderMove: (_, g) => x.setValue(Math.max(0, Math.min(g.dx, live.current.travel))),
      onPanResponderRelease: (_, g) => {
        if (g.dx > live.current.travel * FAR_ENOUGH || (g.vx > 1.2 && g.dx > live.current.travel * 0.4)) return finish();
        Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 6 }).start(invite);
      },
      onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: false }).start(invite),
    }),
  ).current;

  return (
    <View
      {...pan.panHandlers}
      style={[styles.track, { height: HEIGHT, borderRadius: HEIGHT / 2 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Slide right, or double tap, to start"
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'activate' && !live.current.leaving && finish()}
      onAccessibilityTap={() => !live.current.leaving && finish()}
    >
      <View style={[styles.hint, { left: THUMB + INSET + (compact ? 20 : 12) }]} pointerEvents="none">
        {chevrons.map((value, i) => (
          <Animated.View key={i} style={{ opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.18, 1] }) }}>
            <Icon name="chevron" size={compact ? 16 : 18} color={colors.paper} weight={3} />
          </Animated.View>
        ))}
      </View>
      <Text style={[styles.label, compact && { fontSize: 20, right: 28 }]}>{label}</Text>
      {/* The red fill trails the thumb, and is not there at all until the thumb has moved. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.fill, { borderRadius: HEIGHT / 2, width: Animated.add(x, THUMB + INSET * 2), opacity: x.interpolate({ inputRange: [0, 2], outputRange: [0, 1], extrapolate: 'clamp' }) }]}
      />
      <Animated.View pointerEvents="none" style={[styles.thumbBox, { width: THUMB, height: THUMB, transform: [{ translateX: Animated.add(x, nudge) }] }]}>
        <Animated.View
          style={[
            styles.ring,
            { width: THUMB, height: THUMB, borderRadius: THUMB / 2 },
            { opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.62] }) }] },
          ]}
        />
        <View style={[styles.thumb, { width: THUMB, height: THUMB, borderRadius: THUMB / 2 }]}>
          <Icon name="arrow" size={compact ? 24 : 28} weight={2.4} />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { backgroundColor: colors.ink, overflow: 'hidden', justifyContent: 'center' },
  hint: { position: 'absolute', top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center' },
  label: { position: 'absolute', right: 34, fontFamily: fonts.bodySemi, fontSize: 24, color: colors.paper },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.vermilion },
  thumbBox: { position: 'absolute', left: INSET, top: INSET },
  ring: { position: 'absolute', left: 0, top: 0, backgroundColor: colors.yellow },
  thumb: { backgroundColor: colors.yellow, alignItems: 'center', justifyContent: 'center' },
});

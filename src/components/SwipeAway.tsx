// Wraps a row or card so it can be swiped left to send it away. The label is shown behind
// it as it slides. A short or slow swipe springs back, so it is hard to do by accident.
import { useRef, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { colors, fonts } from '@/theme';

const FAR_ENOUGH = 110;

export function SwipeAway({ label, onAway, children, style, onLayout }: { label: string; onAway: () => void; children: ReactNode; style?: StyleProp<ViewStyle>; onLayout?: (e: LayoutChangeEvent) => void }) {
  const x = useRef(new Animated.Value(0)).current;
  // Kept in a ref so the gesture, which is set up once, always calls the latest version.
  const away = useRef(onAway);
  away.current = onAway;

  const back = () => Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
  const pan = useRef(
    PanResponder.create({
      // Only a clearly sideways drag counts, so scrolling and tapping still work.
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => x.setValue(Math.min(0, g.dx)),
      onPanResponderRelease: (_, g) => {
        if (g.dx < -FAR_ENOUGH || g.vx < -0.8) {
          Animated.timing(x, { toValue: -600, duration: 180, useNativeDriver: true }).start(() => {
            away.current();
            // On Listen the slot stays and the next story moves into it. Without this the slot
            // would keep its swiped-away position and show only the dark backing.
            requestAnimationFrame(() => x.setValue(0));
          });
        } else back();
      },
      onPanResponderTerminate: back,
    }),
  ).current;

  return (
    <View
      style={style}
      onLayout={onLayout}
      accessibilityActions={[{ name: 'delete', label }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'delete' && onAway()}
    >
      <View style={styles.behind} pointerEvents="none">
        <Text style={styles.label}>{label}</Text>
      </View>
      <Animated.View style={[styles.front, { transform: [{ translateX: x }] }]} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  behind: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.ink, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 20 },
  label: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.paper },
  front: { flex: 1, backgroundColor: colors.paper },
});

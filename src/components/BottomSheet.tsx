// A sheet that rises from the bottom of the screen. The dimmed page behind it fades in where it is,
// and only the sheet slides, so the dimming never travels up the screen with it.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/theme';

export function BottomSheet({ open, onClose, onClosed, children }: { open: boolean; onClose: () => void; onClosed?: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [shown, setShown] = useState(open);
  const dim = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(height)).current;
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;

  useEffect(() => {
    if (open) {
      setShown(true);
      rise.setValue(height);
      Animated.parallel([
        Animated.timing(dim, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(rise, { toValue: 0, damping: 26, stiffness: 260, mass: 0.9, useNativeDriver: true }),
      ]).start();
    } else if (shown) {
      Animated.parallel([
        Animated.timing(dim, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(rise, { toValue: height, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start(() => {
        setShown(false);
        closedRef.current?.();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal visible={shown} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.dim, { opacity: dim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <View style={styles.bottom} pointerEvents="box-none">
        <Animated.View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8, transform: [{ translateY: rise }] }]}>
          <View style={styles.grip} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { backgroundColor: 'rgba(23,25,27,0.5)' },
  bottom: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.paper, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 10 },
  grip: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line, marginBottom: 14 },
});

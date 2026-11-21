import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, type } from '@/theme';

// The opening screen. The real name and spoken opening line are still undecided,
// so this shows the placeholder name and a start button that does nothing yet.
export default function StartScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.center}>
        <Text style={styles.title}>Learning App</Text>
        <Text style={styles.subtitle}>to start</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start"
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={() => {}}
      >
        <Text style={styles.buttonLabel}>Start</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  title: {
    fontSize: type.title,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: type.body,
    color: colors.textSecondary,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 28,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonLabel: {
    fontSize: type.button,
    fontWeight: '700',
    color: colors.onAccent,
  },
});

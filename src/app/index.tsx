// 1. Open. The first thing you see: the name, the line, and a slide to start.
import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { SlideToStart } from '@/components/SlideToStart';
import { Icon, Screen } from '@/components/ui';
import { arrive } from '@/lib/arrive';
import { useSession } from '@/state/session';
import { colors, fonts } from '@/theme';

export default function Open() {
  // Signed out, the first screen is the sign-in one instead.
  const out = useSession((s) => s.status === 'out');
  if (out) return <Redirect href="/welcome" />;
  return (
    <Screen style={{ paddingBottom: 40 }}>
      <View style={styles.disc} />
      <View style={styles.bar} />
      <View style={styles.star}>
        <Icon name="star" size={44} />
      </View>
      <View style={{ flex: 1 }} />
      <Text style={styles.name} accessibilityRole="header">
        pliny<Text style={{ color: colors.vermilion }}>.</Text>
      </Text>
      <Text style={styles.line}>get lost in{'\n'}something</Text>
      {/* Someone who left before picking interests is taken back to pick them. Interests cannot be skipped. */}
      <SlideToStart onDone={() => arrive()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  disc: { position: 'absolute', top: -110, right: -120, width: 360, height: 360, borderRadius: 180, backgroundColor: colors.vermilion },
  bar: { position: 'absolute', top: 190, left: -30, width: 150, height: 26, backgroundColor: colors.yellow },
  star: { position: 'absolute', top: 150, right: 60 },
  name: { fontFamily: fonts.display, fontSize: 118, lineHeight: 118, letterSpacing: -7, color: colors.ink, marginBottom: -4 },
  line: { fontFamily: fonts.serifItalic, fontSize: 46, lineHeight: 46, color: colors.ink, marginTop: 14, marginBottom: 40 },
});

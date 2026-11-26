// The listener's badge, top right on the main screens: their picture, or the first letter of
// their name on a colored disc. Tap it for the profile: picture, name, interests, signing out.
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useProfile } from '@/state/profile';
import { colors, fonts } from '@/theme';

export function Avatar({ size = 40 }: { size?: number }) {
  const { first_name, avatar_url } = useProfile();
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (avatar_url) return <Image source={{ uri: avatar_url }} style={[styles.disc, round]} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />;
  return (
    <Text style={[styles.disc, styles.letter, round, { fontSize: size * 0.45, lineHeight: size - 3 }]} allowFontScaling={false}>
      {(first_name?.trim().charAt(0) || 'P').toUpperCase()}
    </Text>
  );
}

export function ProfileBadge() {
  const loaded = useProfile((s) => s.loaded);
  const load = useProfile((s) => s.load);
  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Your profile" hitSlop={8} onPress={() => router.push('/settings')} style={({ pressed }) => pressed && { opacity: 0.7 }}>
      <Avatar />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  disc: { borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.iris, overflow: 'hidden' },
  letter: { fontFamily: fonts.display, color: colors.ink, textAlign: 'center' },
});

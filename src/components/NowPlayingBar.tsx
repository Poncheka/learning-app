// The dark bar that shows a lesson is still playing after you leave the Playing screen.
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui';
import { usePlayer } from '@/state/player';
import { colors, fonts, gutter } from '@/theme';

export function NowPlayingBar() {
  const { phase, lesson, index, playing, toggle } = usePlayer();
  if (phase !== 'playing' || !lesson) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Now playing ${lesson.title}. Open player.`} onPress={() => router.push('/playing')} style={styles.bar}>
      <View style={styles.disc} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>
          {lesson.title}
        </Text>
        <Text style={styles.sub}>
          Chapter {index + 1} of {lesson.segments.length}
        </Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'} onPress={toggle} hitSlop={8} style={styles.toggle}>
        <Icon name={playing ? 'pause' : 'play'} size={20} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { marginHorizontal: gutter / 2, marginTop: 10, height: 64, borderRadius: 32, backgroundColor: colors.ink, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 10, paddingRight: 10 },
  disc: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.vermilion },
  title: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.paper },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.faint },
  toggle: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
});

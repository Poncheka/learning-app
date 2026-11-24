// Inside one playlist of the Library: its stories, and a button to play them back to back.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CardArt, pickBackgrounds } from '@/components/covers';
import { NowPlayingBar } from '@/components/NowPlayingBar';
import { StoryRow } from '@/components/StoryRow';
import { Icon, RoundButton, Screen, TabBar } from '@/components/ui';
import type { LessonSummary } from '@/lib/api';
import { EVERYTHING, inPlaylist, playAll, playOne, useLibrary } from '@/state/library';
import { colors, fonts, gutter } from '@/theme';

export default function Playlist() {
  const params = useLocalSearchParams<{ name?: string }>();
  const name = typeof params.name === 'string' && params.name ? params.name : EVERYTHING;
  const { lessons, load, remove, unlike } = useLibrary();
  useEffect(() => {
    if (lessons === null) load();
  }, [lessons, load]);

  const stories = (lessons ?? []).filter((l) => inPlaylist(l, name));
  const minutes = stories.reduce((sum, l) => sum + (l.chosen_minutes || 0), 0);
  const [look] = pickBackgrounds([`playlist-${name}`], true);

  const play = (lesson: LessonSummary) => {
    playOne(lesson);
    router.push('/playing');
  };
  const all = () => {
    if (stories.length === 0) return;
    playAll(stories);
    router.push('/playing');
  };

  return (
    <Screen flush>
      <View style={styles.top}>
        <RoundButton label="Back to Library" onPress={() => router.back()}>
          <Icon name="back" size={22} />
        </RoundButton>
        <Text style={styles.crumb}>Library</Text>
      </View>

      <View style={[styles.banner, { backgroundColor: look.background }]}>
        <CardArt background={look} />
        <Text style={[styles.name, { color: look.text }]} numberOfLines={2}>
          {name}.
        </Text>
        <View style={styles.bannerFoot}>
          <Text style={[styles.total, { color: look.text }]}>
            {stories.length} {stories.length === 1 ? 'story' : 'stories'}. {minutes} min
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Play all" onPress={all} style={({ pressed }) => [styles.playAll, pressed && { opacity: 0.85 }]}>
            <Icon name="play" size={16} color={colors.paper} />
            <Text style={styles.playAllText}>Play all</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
        {stories.map((lesson) => (
          <StoryRow key={lesson.id} lesson={lesson} onPlay={() => play(lesson)} onRemove={() => remove(lesson)} onUnlike={() => unlike(lesson)} />
        ))}
        {lessons !== null && stories.length === 0 ? <Text style={styles.note}>Nothing in this playlist yet.</Text> : null}
      </ScrollView>

      <NowPlayingBar />
      <View style={{ height: 10 }} />
      <TabBar active="library" within />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: gutter },
  crumb: { fontFamily: fonts.bodySemi, fontSize: 17, color: colors.ink },
  banner: { marginHorizontal: gutter, marginTop: 14, padding: 18, minHeight: 132, overflow: 'hidden', justifyContent: 'space-between' },
  name: { fontFamily: fonts.display, fontSize: 30, lineHeight: 30, letterSpacing: -1.2, textTransform: 'uppercase', maxWidth: '70%' },
  bannerFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  total: { fontFamily: fonts.bodySemi, fontSize: 15 },
  playAll: { height: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: colors.ink, flexDirection: 'row', alignItems: 'center', gap: 8 },
  playAllText: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.paper },
  list: { flex: 1, marginHorizontal: gutter },
  note: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: colors.gray, textAlign: 'center', marginTop: 28 },
});

// 9. Library. Every lesson you have started, newest first, ready to play again.
// Chapters that were already made replay from the saved audio and cost nothing.
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { CoverTile } from '@/components/covers';
import { NowPlayingBar } from '@/components/NowPlayingBar';
import { SwipeAway } from '@/components/SwipeAway';
import { Em, Icon, OutlineButton, Screen, Serif, TabBar, TagLabel, Wordmark } from '@/components/ui';
import { hideLesson, listLessons, type LessonSummary } from '@/lib/api';
import { usePlayer } from '@/state/player';
import { colors, fonts, gutter } from '@/theme';

const length = (minutes: number) => (minutes === 60 ? '1 hour' : `${minutes} minutes`);

export default function Library() {
  const resume = usePlayer((s) => s.resume);
  const [lessons, setLessons] = useState<LessonSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    setError(null);
    listLessons()
      .then(setLessons)
      .catch((err) => setError(err instanceof Error ? err.message : 'Your lessons could not be loaded.'));
  }, []);
  useEffect(load, [load]);

  // Gone from the list at once. The server is told, and keeps the audio.
  const remove = (lesson: LessonSummary) => {
    setLessons((all) => (all ?? []).filter((l) => l.id !== lesson.id));
    hideLesson(lesson.id).catch(load);
  };

  const wanted = search.trim().toLowerCase();
  const found = (lessons ?? []).filter((l) => l.title.toLowerCase().includes(wanted));

  const play = (lesson: LessonSummary) => {
    // Saved audio needs no building. Go straight to the player.
    resume(lesson);
    router.push('/playing');
  };

  return (
    <Screen flush>
      <View style={styles.head}>
        <Wordmark />
        <Serif style={{ marginTop: 18, marginBottom: 12 }}>
          Your <Em>lessons.</Em>
        </Serif>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search your lessons"
          placeholderTextColor={colors.gray}
          returnKeyType="search"
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Search your lessons"
          style={styles.search}
        />
      </View>

      {error ? (
        <View style={styles.center}>
          <Text style={styles.note}>{error}</Text>
          <OutlineButton label="Try again" onPress={load} />
        </View>
      ) : lessons === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.ink} />
        </View>
      ) : lessons.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.note}>Nothing here yet. Lessons you start will collect here, ready to play again.</Text>
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
          {found.length === 0 ? <Text style={[styles.note, { marginTop: 24 }]}>No lesson matches that.</Text> : null}
          {found.map((lesson) => {
            return (
              <SwipeAway key={lesson.id} label="Remove" onAway={() => remove(lesson)}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Play ${lesson.title}`}
                onPress={() => play(lesson)}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              >
                <CoverTile id={lesson.id} size={60} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={2}>
                    {lesson.title}
                  </Text>
                  <View style={styles.meta}>
                    <Text style={styles.sub}>{length(lesson.chosen_minutes)}</Text>
                    {/* A wildcard, picked from outside the tags, shows no tag at all. */}
                    {lesson.tag && lesson.tag !== 'Off the map' ? <TagLabel>{lesson.tag}</TagLabel> : null}
                  </View>
                </View>
                <View style={styles.play}>
                  <Icon name="play" size={18} />
                </View>
              </Pressable>
              </SwipeAway>
            );
          })}
        </ScrollView>
      )}

      <NowPlayingBar />
      <View style={{ height: 10 }} />
      <TabBar active="library" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: gutter },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: gutter + 12 },
  note: { fontFamily: fonts.body, fontSize: 17, lineHeight: 24, color: colors.gray, textAlign: 'center' },
  search: { height: 52, borderRadius: 26, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.white, paddingHorizontal: 20, fontFamily: fonts.body, fontSize: 16, color: colors.ink, marginBottom: 14 },
  list: { flex: 1, marginHorizontal: gutter, borderTopWidth: 1, borderTopColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, minHeight: 78, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontFamily: fonts.display, fontSize: 17, lineHeight: 19, letterSpacing: -0.5, textTransform: 'uppercase', color: colors.ink },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  sub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 17, color: colors.gray, flexShrink: 0 },
  play: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
});

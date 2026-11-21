// 9. Library. Every lesson you have started, newest first, ready to play again.
// Chapters that were already made replay from the saved audio and cost nothing.
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colorFor } from '@/components/covers';
import { NowPlayingBar } from '@/components/NowPlayingBar';
import { Em, Icon, OutlineButton, Screen, Serif, TabBar, Wordmark } from '@/components/ui';
import { listLessons, type LessonSummary } from '@/lib/api';
import { usePlayer } from '@/state/player';
import { colors, fonts, gutter } from '@/theme';

function when(iso: string): string {
  const then = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(then).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return then.toLocaleDateString(undefined, { weekday: 'long' });
  if (days < 14) return 'Last week';
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const length = (minutes: number) => (minutes === 60 ? '1 hour' : `${minutes} min`);

export default function Library() {
  const resume = usePlayer((s) => s.resume);
  const [lessons, setLessons] = useState<LessonSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    listLessons()
      .then(setLessons)
      .catch((err) => setError(err instanceof Error ? err.message : 'Your lessons could not be loaded.'));
  }, []);
  useEffect(load, [load]);

  const play = (lesson: LessonSummary) => {
    resume(lesson);
    router.push('/building');
  };

  return (
    <Screen flush>
      <View style={styles.head}>
        <Wordmark />
        <Serif style={{ marginTop: 18, marginBottom: 12 }}>
          Your <Em>lessons.</Em>
        </Serif>
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
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 12 }}>
          {lessons.map((lesson) => {
            const finished = lesson.made === lesson.chapters;
            return (
              <Pressable
                key={lesson.id}
                accessibilityRole="button"
                accessibilityLabel={`Play ${lesson.title}`}
                onPress={() => play(lesson)}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              >
                <View style={[styles.tile, { backgroundColor: colorFor(lesson.id) }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={2}>
                    {lesson.title}
                  </Text>
                  <Text style={styles.sub}>
                    {when(lesson.started_at)}. {length(lesson.chosen_minutes)}. {finished ? 'All chapters made' : `${lesson.made} of ${lesson.chapters} chapters made`}
                  </Text>
                </View>
                <View style={styles.play}>
                  <Icon name="play" size={18} />
                </View>
              </Pressable>
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
  list: { flex: 1, marginHorizontal: gutter, borderTopWidth: 1, borderTopColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, minHeight: 78, borderBottomWidth: 1, borderBottomColor: colors.line },
  tile: { width: 60, height: 60 },
  title: { fontFamily: fonts.display, fontSize: 17, lineHeight: 19, letterSpacing: -0.5, textTransform: 'uppercase', color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 17, color: colors.gray, marginTop: 4 },
  play: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
});

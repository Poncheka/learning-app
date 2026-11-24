// 1. Library. Everything the listener has started, gathered into playlists: all of it, the ones
// they liked, and one for each interest. Searching looks across all of them at once.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { CardArt, pickBackgrounds } from '@/components/covers';
import { NowPlayingBar } from '@/components/NowPlayingBar';
import { StoryRow } from '@/components/StoryRow';
import { Em, Eyebrow, OutlineButton, Screen, Serif, TabBar, Wordmark } from '@/components/ui';
import type { LessonSummary } from '@/lib/api';
import { EVERYTHING, LIKED, inPlaylist, playOne, shelfOf, useLibrary } from '@/state/library';
import { colors, fonts, gutter } from '@/theme';

export default function Library() {
  const { lessons, error, load, remove } = useLibrary();
  const [search, setSearch] = useState('');
  useEffect(load, [load]);

  const all = lessons ?? [];
  const wanted = search.trim().toLowerCase();
  const found = wanted ? all.filter((l) => l.title.toLowerCase().includes(wanted)) : [];

  // Everything and Liked come first, then one playlist per interest, the fullest first.
  const byInterest = new Map<string, number>();
  for (const l of all) byInterest.set(shelfOf(l), (byInterest.get(shelfOf(l)) ?? 0) + 1);
  const names = [EVERYTHING, LIKED, ...[...byInterest.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)];
  const lists = names.map((name) => ({ name, count: all.filter((l) => inPlaylist(l, name)).length })).filter((p) => p.count > 0 || p.name === EVERYTHING);
  const art = pickBackgrounds(lists.map((p) => `playlist-${p.name}`), true);

  const play = (lesson: LessonSummary) => {
    playOne(lesson);
    router.push('/playing');
  };

  return (
    <Screen flush>
      <View style={styles.head}>
        <Wordmark />
        <Serif style={{ marginTop: 18, marginBottom: 12 }}>
          Your <Em>library.</Em>
        </Serif>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search all your stories"
          placeholderTextColor={colors.gray}
          returnKeyType="search"
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Search all your stories"
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
      ) : all.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.note}>Nothing here yet. Stories you start will collect here, ready to play again.</Text>
        </View>
      ) : wanted ? (
        <ScrollView style={styles.results} contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
          {found.length === 0 ? <Text style={[styles.note, { marginTop: 24 }]}>No story matches that.</Text> : null}
          {found.map((lesson) => (
            <StoryRow key={lesson.id} lesson={lesson} onPlay={() => play(lesson)} onRemove={() => remove(lesson)} />
          ))}
        </ScrollView>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.grid} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Eyebrow style={styles.label}>Playlists by interest</Eyebrow>
          {lists.map((list, i) => (
            <Pressable
              key={list.name}
              accessibilityRole="button"
              accessibilityLabel={`${list.name}. ${list.count} ${list.count === 1 ? 'story' : 'stories'}`}
              onPress={() => router.push({ pathname: '/playlist', params: { name: list.name } })}
              style={({ pressed }) => [styles.cell, pressed && { opacity: 0.85 }]}
            >
              <View style={[styles.tile, { backgroundColor: art[i].background }]}>
                <CardArt background={art[i]} top="62%" />
                <Text style={[styles.tileName, { color: art[i].text }]} numberOfLines={3}>
                  {list.name}.
                </Text>
              </View>
              <Text style={styles.count}>
                {list.count} {list.count === 1 ? 'story' : 'stories'}
              </Text>
            </Pressable>
          ))}
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
  results: { flex: 1, marginHorizontal: gutter, borderTopWidth: 1, borderTopColor: colors.line },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: gutter, paddingBottom: 12, rowGap: 16 },
  label: { width: '100%', marginBottom: -4 },
  // Two to a row, each a square.
  cell: { width: '48.4%' },
  tile: { aspectRatio: 1, overflow: 'hidden', justifyContent: 'flex-end', padding: 14 },
  tileName: { fontFamily: fonts.display, fontSize: 22, lineHeight: 22, letterSpacing: -0.8, textTransform: 'uppercase' },
  count: { fontFamily: fonts.body, fontSize: 14, color: colors.gray, marginTop: 6 },
});

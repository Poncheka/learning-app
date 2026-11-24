// 3. Explore. Ideas for stories, thought up from the listener's interests. Tap one to have it made:
// it turns up on the Listen tab when it is finished. Swipe one away to say it is not for you.
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CoverTile } from '@/components/covers';
import { NowPlayingBar } from '@/components/NowPlayingBar';
import { SwipeAway } from '@/components/SwipeAway';
import { Em, Icon, Screen, Serif, TabBar, Wordmark } from '@/components/ui';
import { dismissIdea, listIdeas, queueIdea, type Idea } from '@/lib/api';
import { colors, fonts, gutter } from '@/theme';

const TILE = 76;
// What was last read, kept while the app is open, so coming back to this tab shows it at once.
let kept: { ideas: Idea[]; tags: string[] } | null = null;
type Banner = { title: string; note: string } | null;

export default function Explore() {
  const [ideas, setIdeasNow] = useState<Idea[] | null>(kept?.ideas ?? null);
  const [tags, setTags] = useState<string[]>(kept?.tags ?? []);
  const setIdeas = (next: Idea[] | ((had: Idea[] | null) => Idea[])) =>
    setIdeasNow((had) => {
      const value = typeof next === 'function' ? next(had) : next;
      if (kept) kept = { ...kept, ideas: value };
      return value;
    });
  const [filter, setFilter] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = (next: Banner) => {
    if (hide.current) clearTimeout(hide.current);
    setBanner(next);
    if (next) hide.current = setTimeout(() => setBanner(null), 6000);
  };

  const look = useCallback(() => {
    listIdeas()
      .then((found) => {
        kept = { ideas: found.ideas, tags: found.tags ?? [] };
        setIdeasNow(found.ideas);
        setTags(found.tags ?? []);
      })
      .catch(() => setIdeas((had) => had ?? []));
  }, []);

  // Ideas are thought up by the server on its own. This only reads them, now and every so often.
  useEffect(() => {
    look();
    const back = AppState.addEventListener('change', (state) => state === 'active' && look());
    const again = setInterval(() => AppState.currentState === 'active' && look(), 30000);
    return () => {
      back.remove();
      clearInterval(again);
      if (hide.current) clearTimeout(hide.current);
    };
  }, [look]);

  const queue = (idea: Idea) => {
    // It leaves the list at once. If the server says no, it comes back, with the reason.
    const before = ideas ?? [];
    setIdeas(before.filter((i) => i.id !== idea.id));
    queueIdea(idea.id)
      .then(() => say({ title: 'Queued. It will be on your Listen tab.', note: 'Ready in about 5 minutes' }))
      .catch((err) => {
        setIdeas(before);
        say({ title: 'Not queued.', note: err instanceof Error ? err.message : 'Please try again.' });
      });
  };

  const away = (idea: Idea) => {
    setIdeas((had) => (had ?? []).filter((i) => i.id !== idea.id));
    dismissIdea(idea.id).catch(() => {});
  };

  // An interest that has since been removed no longer filters anything.
  const chosen = filter && tags.includes(filter) ? filter : null;
  const shown = (ideas ?? []).filter((i) => !chosen || i.tag === chosen);

  return (
    <Screen flush>
      <View style={styles.top}>
        <Wordmark />
        <Pressable accessibilityRole="link" onPress={() => router.push('/interests')} hitSlop={12}>
          <Text style={styles.editText}>Edit interests</Text>
        </Pressable>
      </View>
      <Serif size={40} style={styles.heading}>
        Pick what comes <Em>next.</Em>
      </Serif>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipRow}>
        {[null, ...tags].map((tag) => {
          const on = chosen === tag;
          return (
            <Pressable key={tag ?? 'all'} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setFilter(tag)} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && { color: colors.paper }]}>{tag ?? 'All'}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={{ height: 12 }} />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {ideas === null ? <ActivityIndicator color={colors.ink} style={{ marginTop: 40 }} /> : null}
        {shown.map((idea) => (
          <SwipeAway key={idea.id} label="Not for me" onAway={() => away(idea)} style={styles.slot}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${idea.title}. Add to my stories.`} onPress={() => queue(idea)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}>
              <CoverTile id={idea.id} size={TILE} />
              <Text style={styles.title} numberOfLines={3}>
                {idea.title.replace(/[.\s]+$/, '')}
              </Text>
              <View style={styles.plus}>
                <Icon name="plus" size={20} />
              </View>
            </Pressable>
          </SwipeAway>
        ))}
        {ideas !== null && shown.length === 0 ? (
          <View style={styles.empty}>
            <Serif size={28} style={{ textAlign: 'center' }}>
              More ideas <Em>soon.</Em>
            </Serif>
            <Text style={styles.note}>{chosen ? 'Nothing under that interest yet. New ideas for it arrive within a few minutes.' : 'Pliny is thinking up new ideas from your interests. They appear here within a few minutes.'}</Text>
          </View>
        ) : null}
      </ScrollView>

      {banner ? (
        <View style={styles.banner} accessibilityLiveRegion="polite">
          <Text style={styles.bannerTitle}>{banner.title}</Text>
          <Text style={styles.bannerNote}>{banner.note}</Text>
        </View>
      ) : null}

      <NowPlayingBar />
      <View style={{ height: 10 }} />
      <TabBar active="explore" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: gutter, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { marginHorizontal: gutter, marginTop: 18, marginBottom: 14 },
  chips: { flexGrow: 0 },
  chipRow: { paddingHorizontal: gutter, gap: 8 },
  chip: { height: 44, paddingHorizontal: 18, borderRadius: 22, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.white, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.ink },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink },
  editText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink, textDecorationLine: 'underline' },
  scroll: { flex: 1, minHeight: 0 },
  list: { paddingHorizontal: gutter, paddingBottom: 12, gap: 8 },
  slot: { overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, minHeight: TILE },
  title: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 17, lineHeight: 21, color: colors.ink, paddingHorizontal: 14 },
  plus: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 48, paddingHorizontal: 12 },
  note: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: colors.gray, textAlign: 'center' },
  banner: { marginHorizontal: gutter, marginBottom: 8, backgroundColor: colors.ink, paddingVertical: 14, paddingHorizontal: 16 },
  bannerTitle: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.paper },
  bannerNote: { fontFamily: fonts.body, fontSize: 14, color: colors.paper, opacity: 0.8, marginTop: 2 },
});

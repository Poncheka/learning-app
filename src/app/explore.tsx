// 3. Explore. Ideas for stories, thought up from the listener's interests. Tap one to have it made:
// it turns up on the Listen tab when it is finished. Swipe one away to say it is not for you.
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CoverTile } from '@/components/covers';
import { ProfileBadge } from '@/components/ProfileBadge';
import { NowPlayingBar } from '@/components/NowPlayingBar';
import { SwipeAway } from '@/components/SwipeAway';
import { Em, Icon, Screen, Serif, TabBar, Wordmark } from '@/components/ui';
import { dismissIdea, listIdeas, queueIdea, type Idea } from '@/lib/api';
import { whenOpens } from '@/lib/when';
import { colors, fonts, gutter } from '@/theme';

// Every row is this tall, and its cover is a square of the same size, so the covers line up down the page.
const TILE = 84;
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
  // Stories asked for and not yet begun. They are made a few at a time.
  const [inQueue, setInQueue] = useState(0);
  // Set once today's allowance of new stories is used up: when the next opens, and how many a day.
  const [usedUp, setUsedUp] = useState<{ opens_at: string | null; per_day: number } | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The banner slides up as it appears, so a tap is answered the moment it lands.
  const rise = useRef(new Animated.Value(0)).current;
  const say = (next: Banner) => {
    if (hide.current) clearTimeout(hide.current);
    setBanner(next);
    if (!next) return;
    rise.setValue(0);
    Animated.spring(rise, { toValue: 1, useNativeDriver: true, bounciness: 6, speed: 18 }).start();
    hide.current = setTimeout(() => Animated.timing(rise, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setBanner(null)), 6000);
  };
  // The rows below close up smoothly when one leaves.
  const settle = () => LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));

  const look = useCallback(() => {
    listIdeas()
      .then((found) => {
        kept = { ideas: found.ideas, tags: found.tags ?? [] };
        setIdeasNow(found.ideas);
        setTags(found.tags ?? []);
        setInQueue(found.in_queue ?? 0);
        setUsedUp(found.queued_today >= found.per_day ? { opens_at: found.opens_at ?? null, per_day: found.per_day } : null);
      })
      .catch(() => setIdeas((had) => had ?? []));
  }, []);

  // Just after signing up, the only things in Explore may be finished stories, or nothing at all, while the
  // first new ideas are made. Until some arrive, say so, and look every few seconds.
  const empty = ideas !== null && !ideas.some((i) => !i.ready);
  useEffect(() => {
    if (!empty) return;
    const quick = setInterval(() => AppState.currentState === 'active' && look(), 5000);
    return () => clearInterval(quick);
  }, [empty, look]);

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
    settle();
    setIdeas(before.filter((i) => i.id !== idea.id));
    // Said at once, without waiting for the server. It nearly always agrees, and when it does not, the reason replaces this.
    // A finished story needs no making. It is on Listen at once.
    const later = (opens: string | null | undefined, perDay: number) => ({ title: 'Queued for later.', note: `You\u2019ve had today\u2019s ${perDay} new stories. This one is made ${whenOpens(opens)}. Your Library has every story you\u2019ve started.` });
    say(idea.ready ? { title: 'On your Listen tab now.', note: 'Already made, so it plays the moment you tap.' } : usedUp ? later(usedUp.opens_at, usedUp.per_day) : { title: 'Queued. It will be on your Listen tab.', note: 'Ready in about 5 minutes' });
    queueIdea(idea.id)
      .then((answer) => {
        setInQueue(answer.in_queue ?? 0);
        // With others ahead of it, say where it stands instead of promising minutes.
        if (answer.used_up) {
          setUsedUp({ opens_at: answer.opens_at ?? null, per_day: answer.per_day ?? usedUp?.per_day ?? 10 });
          say(later(answer.opens_at, answer.per_day ?? usedUp?.per_day ?? 10));
        } else if (!answer.starts) say({ title: 'Queued. It will be on your Listen tab.', note: answer.ahead > 0 ? `Number ${answer.ahead + 1} in your queue. Stories are made a few at a time.` : 'It is next. Stories are made a few at a time.' });
      })
      .catch((err) => {
        settle();
        setIdeas(before);
        say({ title: 'Not queued.', note: err instanceof Error ? err.message : 'Please try again.' });
      });
  };

  const away = (idea: Idea) => {
    settle();
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
        <View style={styles.topRight}>
          <Pressable accessibilityRole="link" onPress={() => router.push('/interests')} hitSlop={12}>
            <Text style={styles.editText}>Edit interests</Text>
          </Pressable>
          <ProfileBadge />
        </View>
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

      {usedUp ? <Text style={styles.queue}>Today{'\u2019'}s {usedUp.per_day} new stories are made. Anything you add now is made {whenOpens(usedUp.opens_at)}. Stories that are already made still play at once.</Text> : null}
      {inQueue > 0 ? <Text style={styles.queue}>{inQueue === 1 ? '1 story in your queue.' : `${inQueue} stories in your queue.`} They arrive on Listen as they are made.</Text> : null}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {ideas === null ? <ActivityIndicator color={colors.ink} style={{ marginTop: 40 }} /> : null}
        {shown.map((idea) => (
          <SwipeAway key={idea.id} label="Not for me" onAway={() => away(idea)} style={styles.slot}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${idea.title}. Add to my stories.`} onPress={() => queue(idea)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}>
              <CoverTile id={idea.id} size={TILE} />
              <View style={styles.words}>
                <Text style={styles.title} numberOfLines={3}>
                  {idea.title.replace(/[.\s]+$/, '')}
                </Text>
              </View>
              <View style={styles.plus}>
                <Icon name="plus" size={20} />
              </View>
            </Pressable>
          </SwipeAway>
        ))}
        {empty && shown.length > 0 && !chosen ? (
          <View style={styles.making} accessibilityLiveRegion="polite">
            <ActivityIndicator color={colors.ink} />
            <Text style={styles.makingText}>Making new ideas from your interests. They appear here as they{'\u2019'}re ready.</Text>
          </View>
        ) : null}
        {ideas !== null && shown.length === 0 ? (
          <View style={styles.empty}>
            {!chosen && empty ? <ActivityIndicator color={colors.ink} size="large" style={{ marginBottom: 6 }} /> : null}
            <Serif size={28} style={{ textAlign: 'center' }}>
              {!chosen && empty ? <>Making your <Em>ideas.</Em></> : <>More ideas <Em>soon.</Em></>}
            </Serif>
            <Text style={styles.note}>{chosen ? 'Nothing under that interest yet. New ideas for it arrive within a few minutes.' : 'Pliny is creating story ideas from your interests right now. The first ones appear here in about a minute.'}</Text>
          </View>
        ) : null}
      </ScrollView>

      {banner ? (
        <Animated.View style={[styles.banner, { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]} accessibilityLiveRegion="polite">
          <Text style={styles.bannerTitle}>{banner.title}</Text>
          <Text style={styles.bannerNote}>{banner.note}</Text>
        </Animated.View>
      ) : null}

      <NowPlayingBar />
      <View style={{ height: 10 }} />
      <TabBar active="explore" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: gutter, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heading: { marginHorizontal: gutter, marginTop: 18, marginBottom: 14 },
  chips: { flexGrow: 0 },
  chipRow: { paddingHorizontal: gutter, gap: 8 },
  chip: { height: 44, paddingHorizontal: 18, borderRadius: 22, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.white, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.ink },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink },
  editText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink, textDecorationLine: 'underline' },
  queue: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.gray, marginHorizontal: gutter, marginBottom: 10 },
  scroll: { flex: 1, minHeight: 0 },
  list: { paddingHorizontal: gutter, paddingBottom: 12, gap: 8 },
  slot: { overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, height: TILE },
  // The same lettering as story titles on Listen and in the Library. Headlines are kept to about fifty characters, so three lines always hold them.
  words: { flex: 1, justifyContent: 'center', paddingHorizontal: 14 },
  // Shown under finished stories while the first new ideas are still being made.
  making: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 18, paddingHorizontal: 4 },
  makingText: { flex: 1, fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.gray },
  title: { fontFamily: fonts.display, fontSize: 16, lineHeight: 18, letterSpacing: -0.4, textTransform: 'uppercase', color: colors.ink },
  plus: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center', marginRight: 12, alignSelf: 'center' },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 48, paddingHorizontal: 12 },
  note: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: colors.gray, textAlign: 'center' },
  banner: { marginHorizontal: gutter, marginBottom: 8, backgroundColor: colors.ink, paddingVertical: 14, paddingHorizontal: 16 },
  bannerTitle: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.paper },
  bannerNote: { fontFamily: fonts.body, fontSize: 14, color: colors.paper, opacity: 0.8, marginTop: 2 },
});

// 2. Listen. A few topics, shown large. Tap one, or let Pliny pick.
import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CardArt, pickBackgrounds } from '@/components/covers';
import { NowPlayingBar } from '@/components/NowPlayingBar';
import { SwipeAway } from '@/components/SwipeAway';
import { Em, OutlineButton, Screen, Serif, TabBar, Wordmark } from '@/components/ui';
import type { Topic } from '@/lib/api';
import { WAITING, useTopics } from '@/state/topics';
import { colors, fonts, gutter } from '@/theme';

// The smallest a card is ever drawn. Below this the artwork and the title collide.
const CARD = 118;

/** Short titles are set large. Longer ones step down a size, so they stay readable and fit. */
function sized(title: string) {
  // A long single word also steps the size down, so it is never broken across two lines.
  const longest = Math.max(...title.split(/\s+/).map((word) => word.length));
  const size = longest >= 12 ? 21 : title.length <= 26 && longest < 10 ? 27 : title.length <= 38 ? 24 : 21;
  return { fontSize: size, lineHeight: size };
}

export default function Listen() {
  const { topics, loading, error, refilling, stuck, load, topUp, select, dismiss } = useTopics();

  // Load what is waiting, then quietly ask for more if there are fewer than three.
  useEffect(() => {
    load().then(topUp);
    // Coming back to the app picks the preparing up again: a phone that was asleep drops what it was waiting for.
    const back = AppState.addEventListener('change', (state) => {
      if (state === 'active') load().then(topUp);
    });
    return () => back.remove();
  }, [load, topUp]);

  const choose = (topic: Topic) => {
    select(topic);
    router.push('/length');
  };

  // While a story from this person's own interests is being made and none is showing yet,
  // one place is kept for it, so it is plain that something of theirs is coming.
  const making = refilling && !topics.slice(0, WAITING).some((t) => t.for_you);
  const shown = topics.slice(0, making ? WAITING - 1 : WAITING);
  const backgrounds = pickBackgrounds(shown.map((t) => t.id));
  // Slots with no topic yet show that one is on its way, so the screen never looks broken.
  const onTheWay = refilling ? WAITING - shown.length : 0;

  return (
    <Screen flush>
      <View style={styles.top}>
        <Wordmark />
      </View>
      <Serif size={40} style={styles.question}>
        What are you <Em>curious</Em> about today?
      </Serif>

      {/* Cards share the room when it all fits. When it does not, they keep their size and the list scrolls. */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.cards} showsVerticalScrollIndicator={false}>
        {shown.map((topic, i) => (
          <SwipeAway key={topic.id} label="Not interested" onAway={() => dismiss(topic)} style={styles.slot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={topic.title}
            accessibilityHint={topic.hook}
            onPress={() => choose(topic)}
            style={({ pressed }) => [styles.card, { backgroundColor: backgrounds[i].background }, pressed && { opacity: 0.85 }]}
          >
            <CardArt background={backgrounds[i]} />
            <Text style={[styles.title, sized(topic.title), { color: backgrounds[i].text }]} numberOfLines={4}>
              {topic.title.replace(/[.\s]+$/, '')}.
            </Text>
            {/* The interest it grew out of, so the kind of story is clear at a glance. Wildcards show none. */}
            {topic.tag && topic.tag !== 'Off the map' ? (
              <View style={[styles.genre, { borderColor: backgrounds[i].text, backgroundColor: backgrounds[i].background }]}>
                <Text style={[styles.genreText, { color: backgrounds[i].text }]} numberOfLines={1}>
                  {topic.tag}
                </Text>
              </View>
            ) : null}
          </Pressable>
          </SwipeAway>
        ))}

        {Array.from({ length: onTheWay }, (_, i) => (
          <View key={`coming-${i}`} style={[styles.card, styles.coming]} accessibilityLabel="Another topic is being prepared">
            {i === 0 ? <ActivityIndicator color={colors.ink} style={styles.spinner} /> : null}
            <Text style={[styles.comingText, i > 0 && { color: colors.gray }]}>{i === 0 ? (shown.length > 0 ? 'Pliny is making one from your interests.' : 'Pliny is reading up on something new.') : 'Another one after that.'}</Text>
          </View>
        ))}

        {/* With fewer than three to show, the empty places are kept, so one card never grows to fill the screen. */}
        {shown.length > 0 ? Array.from({ length: Math.max(0, WAITING - shown.length - onTheWay) }, (_, i) => <View key={`space-${i}`} style={[styles.card, { opacity: 0 }]} pointerEvents="none" />) : null}

        {/* While the first topics load, the cards' places are held, so the screen does not jump. */}
        {shown.length === 0 && onTheWay === 0 && loading ? [0, 1, 2].map((i) => <View key={`holding-${i}`} style={[styles.card, styles.holding]} />) : null}

        {shown.length === 0 && onTheWay === 0 && !loading ? (
          <View style={styles.empty}>
            {loading ? null : (
              <>
                <Serif size={30} style={{ textAlign: 'center' }}>
                  {error || stuck ? <>Something went <Em>wrong.</Em></> : <>Nothing <Em>yet.</Em></>}
                </Serif>
                <Text style={styles.note}>
                  {error || stuck ? 'Pliny could not line up a story just now. It is usually a passing hiccup.' : 'Pliny is out of stories for the moment.'}
                </Text>
                <OutlineButton label="Try again" onPress={() => load().then(topUp)} />
              </>
            )}
          </View>
        ) : null}

      </ScrollView>

      <NowPlayingBar />
      <View style={{ height: 10 }} />
      <TabBar active="listen" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: gutter, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  question: { marginHorizontal: gutter, marginTop: 18, marginBottom: 16 },
  scroll: { flex: 1, minHeight: 0 },
  cards: { flexGrow: 1, gap: 10, paddingHorizontal: gutter, paddingBottom: 10 },
  slot: { flexGrow: 1, minHeight: CARD, overflow: 'hidden' },
  card: { flexGrow: 1, minHeight: CARD, overflow: 'hidden', justifyContent: 'flex-end', paddingVertical: 18, paddingHorizontal: 20 },
  // The title keeps to the left half. Every background keeps its artwork in the right half,
  // so the two never touch.
  title: { fontFamily: fonts.display, letterSpacing: -1, textTransform: 'uppercase', maxWidth: '52%' },
  genre: { position: 'absolute', right: 12, bottom: 12, height: 22, borderRadius: 11, borderWidth: 1, paddingHorizontal: 9, justifyContent: 'center', maxWidth: '42%' },
  genreText: { fontFamily: fonts.bodyMedium, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' },
  holding: { backgroundColor: colors.line, opacity: 0.6 },
  coming: { borderWidth: 1.5, borderColor: colors.ink, borderStyle: 'dashed' },
  spinner: { position: 'absolute', top: 18, left: 20 },
  comingText: { fontFamily: fonts.serifItalic, fontSize: 24, lineHeight: 26, color: colors.ink, maxWidth: '80%' },
  empty: { flexGrow: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 12 },
  note: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: colors.gray, textAlign: 'center' },
});

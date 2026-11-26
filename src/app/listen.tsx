// 2. Listen. Finished stories only, shown large: one lead card, then rows of two. Tap one to hear it.
import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CardArt, pickBackgrounds } from '@/components/covers';
import type { CardBackground } from '@/components/cardBackgrounds';
import { NowPlayingBar } from '@/components/NowPlayingBar';
import { ProfileBadge } from '@/components/ProfileBadge';
import { SwipeAway } from '@/components/SwipeAway';
import { Em, Icon, OutlineButton, Screen, Serif, TabBar, Wordmark } from '@/components/ui';
import type { Topic } from '@/lib/api';
import { whenOpens } from '@/lib/when';
import { useTopics } from '@/state/topics';
import { colors, fonts, gutter } from '@/theme';

// How often the screen quietly looks for stories the server has finished since it last looked.
const LOOK_EVERY = 20000;

/** Short titles are set large. Longer ones step down a size, so they stay readable and fit. */
function sized(title: string, lead: boolean) {
  // A long single word also steps the size down, so it is never broken across two lines.
  const longest = Math.max(...title.split(/\s+/).map((word) => word.length));
  const size = lead ? (longest >= 12 || title.length > 44 ? 24 : title.length <= 30 ? 30 : 27) : longest >= 11 || title.length > 40 ? 15 : title.length <= 26 ? 18 : 16;
  return { fontSize: size, lineHeight: size };
}

function Card({ topic, background, lead, isNew, onPress, onAway }: { topic: Topic; background: CardBackground; lead?: boolean; isNew?: boolean; onPress: () => void; onAway: () => void }) {
  const title = topic.title.replace(/[.\s]+$/, '');
  return (
    <SwipeAway label="Not interested" onAway={onAway} style={lead ? styles.leadSlot : styles.smallSlot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${isNew ? 'New. ' : ''}${topic.title}`}
        accessibilityHint={topic.hook}
        onPress={onPress}
        style={({ pressed }) => [styles.card, lead ? styles.leadCard : styles.smallCard, { backgroundColor: background.background }, pressed && { opacity: 0.85 }]}
      >
        <CardArt background={background} top={lead ? '64%' : '52%'} />
        {isNew ? <Text style={[styles.new, { color: background.text }]}>NEW</Text> : null}
        <Text style={[styles.title, lead ? styles.leadTitle : styles.smallTitle, sized(title, Boolean(lead)), { color: background.text }]} numberOfLines={lead ? 4 : 5}>
          {title}.
        </Text>
        {/* The interest it grew out of, so the kind of story is clear at a glance. Wildcards show none. */}
        {topic.tag && topic.tag !== 'Off the map' ? (
          <View style={[styles.tag, lead && styles.leadTag, { borderColor: background.text }]}>
            <Text style={[styles.tagText, lead && styles.leadTagText, { color: background.text }]} numberOfLines={1}>
              {topic.tag}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </SwipeAway>
  );
}

export default function Listen() {
  const { topics, limit, loading, error, fresh, load, refresh, select, dismiss } = useTopics();
  // Today's new stories are all made. Said plainly, with somewhere to go, rather than an empty promise.
  const usedUp = Boolean(limit && limit.made_today >= limit.per_day);

  // Read what is ready, then keep an eye out: when the app comes back to the front, and every so often while this screen is up.
  useEffect(() => {
    load();
    const back = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    const look = setInterval(() => {
      if (AppState.currentState === 'active') refresh();
    }, LOOK_EVERY);
    return () => {
      back.remove();
      clearInterval(look);
    };
  }, [load, refresh]);

  const choose = (topic: Topic) => {
    select(topic);
    router.push('/length');
  };

  // A story that arrived while the app was open takes the lead, marked New. The rest keep the server's order.
  const arrived = new Set(fresh);
  const shown = [...topics.filter((t) => arrived.has(t.id)), ...topics.filter((t) => !arrived.has(t.id))].slice(0, 7);
  const backgrounds = pickBackgrounds(shown.map((t) => t.id), true);
  const rest = shown.slice(1);
  const rows: number[][] = [];
  for (let i = 0; i < rest.length; i += 2) rows.push(rest[i + 1] ? [i + 1, i + 2] : [i + 1]);

  return (
    <Screen flush>
      <View style={styles.top}>
        <Wordmark />
        <ProfileBadge />
      </View>
      <Serif size={40} style={styles.question}>
        Get lost in <Em>something.</Em>
      </Serif>

      {/* Cards share the room when it all fits. When it does not, they keep their size and the list scrolls. */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.cards} showsVerticalScrollIndicator={false}>
        {shown[0] ? <Card topic={shown[0]} background={backgrounds[0]} lead isNew={arrived.has(shown[0].id)} onPress={() => choose(shown[0])} onAway={() => dismiss(shown[0])} /> : null}

        {rows.map((row) => (
          <View key={row.map((i) => shown[i].id).join('-')} style={styles.row}>
            {row.map((i) => (
              <Card key={shown[i].id} topic={shown[i]} background={backgrounds[i]} isNew={arrived.has(shown[i].id)} onPress={() => choose(shown[i])} onAway={() => dismiss(shown[i])} />
            ))}
            {/* An odd one out keeps to its half. The other half is the way to more stories. */}
            {row.length === 1 ? (
              // The plain outer box takes exactly half the row. A box with its own border and padding
              // is given that much extra width, which made this tile wider than the card beside it.
              <View style={styles.smallSlot}>
                <Pressable accessibilityRole="link" onPress={() => router.replace('/explore')} style={[styles.more, styles.moreTile, { flex: 1 }]}>
                  <Icon name="arrow" size={22} />
                  <Text style={styles.moreText}>Find more in Explore</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}

        {shown.length > 0 && rest.length % 2 === 0 ? (
          <Pressable accessibilityRole="link" onPress={() => router.replace('/explore')} style={[styles.more, styles.moreRow]}>
            <Text style={styles.moreText}>Find more in Explore</Text>
            <Icon name="arrow" size={22} />
          </Pressable>
        ) : null}

        {/* While the first stories load, the cards' places are held, so the screen does not jump. */}
        {shown.length === 0 && loading ? (
          <>
            <View style={[styles.leadSlot, styles.holding]} />
            <View style={styles.row}>
              <View style={[styles.smallSlot, styles.holding]} />
              <View style={[styles.smallSlot, styles.holding]} />
            </View>
          </>
        ) : null}

        {usedUp && shown.length > 0 ? (
          <Text style={[styles.note, { marginTop: 4 }]}>That{'\u2019'}s today{'\u2019'}s {limit!.per_day} new stories. More arrive {whenOpens(limit!.opens_at)}.</Text>
        ) : null}

        {shown.length === 0 && !loading && usedUp && !error ? (
          <View style={styles.empty}>
            <Serif size={30} style={{ textAlign: 'center' }}>
              That{'\u2019'}s today{'\u2019'}s <Em>stories.</Em>
            </Serif>
            <Text style={styles.note}>
              You{'\u2019'}ve had today{'\u2019'}s {limit!.per_day} new stories. More arrive {whenOpens(limit!.opens_at)}. Until then, play any story again from your Library, or pick some for later in Explore.
            </Text>
            <OutlineButton label="Open my Library" onPress={() => router.replace('/library')} />
            <OutlineButton label="Pick some for later" onPress={() => router.replace('/explore')} />
          </View>
        ) : null}

        {shown.length === 0 && !loading && !(usedUp && !error) ? (
          <View style={styles.empty}>
            <Serif size={30} style={{ textAlign: 'center' }}>
              {error ? <>Something went <Em>wrong.</Em></> : <>More on the <Em>way.</Em></>}
            </Serif>
            <Text style={styles.note}>{error ? 'Pliny could not reach its stories just now. It is usually a passing hiccup.' : 'Pliny is lining up your next stories. They will appear here in a few minutes.'}</Text>
            <OutlineButton label="Look again" onPress={() => load()} />
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
  // The lead card is about one and a half times the height of a row of two.
  leadSlot: { flexGrow: 3, minHeight: 230, overflow: 'hidden' },
  row: { flexGrow: 2, minHeight: 160, flexDirection: 'row', gap: 10 },
  smallSlot: { flex: 1, minWidth: 0, overflow: 'hidden' },
  card: { flex: 1, overflow: 'hidden', justifyContent: 'flex-end' },
  leadCard: { paddingVertical: 20, paddingHorizontal: 20 },
  smallCard: { paddingVertical: 14, paddingHorizontal: 14 },
  new: { position: 'absolute', top: 16, left: 20, fontFamily: fonts.bodyMedium, fontSize: 12, letterSpacing: 2.5 },
  title: { fontFamily: fonts.display, letterSpacing: -1, textTransform: 'uppercase' },
  // Every background keeps its artwork toward the top right, so the title holds to the lower left.
  leadTitle: { maxWidth: '88%' },
  smallTitle: { maxWidth: '96%', letterSpacing: -0.6 },
  tag: { alignSelf: 'flex-start', marginTop: 8, height: 24, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 10, justifyContent: 'center', maxWidth: '100%' },
  leadTag: { marginTop: 12, height: 28, borderRadius: 14, paddingHorizontal: 12 },
  tagText: { fontFamily: fonts.bodyMedium, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase' },
  leadTagText: { fontSize: 11, letterSpacing: 2 },
  more: { borderWidth: 1.5, borderColor: colors.ink, borderStyle: 'dashed' },
  moreTile: { justifyContent: 'flex-end', gap: 8, padding: 14 },
  moreRow: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  moreText: { fontFamily: fonts.bodySemi, fontSize: 16, lineHeight: 20, color: colors.ink },
  holding: { backgroundColor: colors.line, opacity: 0.6 },
  empty: { flexGrow: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 12 },
  note: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: colors.gray, textAlign: 'center' },
});

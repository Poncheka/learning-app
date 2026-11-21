// 2. Listen. A few topics, shown large. Tap one, or let Pliny pick.
import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { CardArt, pickBackgrounds } from '@/components/covers';
import { NowPlayingBar } from '@/components/NowPlayingBar';
import { Em, OutlineButton, Screen, Serif, TabBar, Wordmark } from '@/components/ui';
import type { Topic } from '@/lib/api';
import { WAITING, useTopics } from '@/state/topics';
import { colors, fonts, gutter } from '@/theme';

export default function Listen() {
  const { topics, loading, error, refilling, load, topUp, select } = useTopics();

  // Load what is waiting, then quietly ask for more if there are fewer than three.
  useEffect(() => {
    load().then(topUp);
  }, [load, topUp]);

  const choose = (topic: Topic) => {
    select(topic);
    router.push('/length');
  };

  const shown = topics.slice(0, WAITING);
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

      <View style={styles.cards}>
        {shown.map((topic, i) => (
          <Pressable
            key={topic.id}
            accessibilityRole="button"
            accessibilityLabel={topic.title}
            accessibilityHint={topic.hook}
            onPress={() => choose(topic)}
            style={({ pressed }) => [styles.card, { backgroundColor: backgrounds[i].background }, pressed && { opacity: 0.85 }]}
          >
            <CardArt background={backgrounds[i]} />
            <Text style={[styles.title, { color: backgrounds[i].text }]} numberOfLines={3} adjustsFontSizeToFit minimumFontScale={0.8}>
              {topic.title.replace(/[.\s]+$/, '')}.
            </Text>
          </Pressable>
        ))}

        {Array.from({ length: onTheWay }, (_, i) => (
          <View key={`coming-${i}`} style={[styles.card, styles.coming]} accessibilityLabel="Another topic is being prepared">
            <ActivityIndicator color={colors.ink} style={styles.spinner} />
            <Text style={styles.comingText}>Pliny is reading up on something new.</Text>
          </View>
        ))}

        {shown.length === 0 && onTheWay === 0 ? (
          <View style={styles.empty}>
            {loading ? (
              <ActivityIndicator color={colors.ink} />
            ) : (
              <>
                <Serif size={30} style={{ textAlign: 'center' }}>
                  {error ? 'Topics would not load.' : <>Nothing <Em>yet.</Em></>}
                </Serif>
                <Text style={styles.note}>{error ?? 'Add a few interests and Pliny will find something worth hearing.'}</Text>
                <OutlineButton label="Try again" onPress={() => load().then(topUp)} />
              </>
            )}
          </View>
        ) : null}

        {shown.length > 0 ? (
          <OutlineButton
            label="Surprise me"
            iconAfter="arrow"
            height={60}
            textSize={18}
            style={{ gap: 10 }}
            onPress={() => choose(shown[Math.floor(Math.random() * shown.length)])}
          />
        ) : null}
      </View>

      <NowPlayingBar />
      <View style={{ height: 10 }} />
      <TabBar active="listen" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: gutter, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  question: { marginHorizontal: gutter, marginTop: 18, marginBottom: 16 },
  cards: { flex: 1, minHeight: 0, gap: 10, paddingHorizontal: gutter },
  card: { flex: 1, minHeight: 0, overflow: 'hidden', justifyContent: 'flex-end', paddingVertical: 18, paddingHorizontal: 20 },
  // The title keeps to the left, where the artwork leaves room for it.
  title: { fontFamily: fonts.display, fontSize: 27, lineHeight: 27, letterSpacing: -1, textTransform: 'uppercase', maxWidth: '64%' },
  coming: { borderWidth: 1.5, borderColor: colors.ink, borderStyle: 'dashed' },
  spinner: { position: 'absolute', top: 18, left: 20 },
  comingText: { fontFamily: fonts.serifItalic, fontSize: 24, lineHeight: 26, color: colors.ink, maxWidth: '80%' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 12 },
  note: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: colors.gray, textAlign: 'center' },
});

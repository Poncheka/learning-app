// 7. Chapters. Where you are in the lesson, and a way to jump around in it.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Em, Icon, RoundButton, Screen, Serif, TagLabel, Wordmark } from '@/components/ui';
import { lessonTag } from '@/lib/api';
import { usePlayer } from '@/state/player';
import { colors, fonts } from '@/theme';

const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];

export default function Chapters() {
  const { lesson, index, queued, made, playing, jumpTo, toggle } = usePlayer();
  // The interest this lesson grew out of, shown small under the list.
  const [tag, setTag] = useState<string | null>(null);
  const lessonId = lesson?.id;
  useEffect(() => {
    if (lessonId) lessonTag(lessonId).then(setTag).catch(() => {});
  }, [lessonId]);
  if (!lesson) return <Screen>{null}</Screen>;
  const count = lesson.segments.length;

  return (
    // This screen slides up as a card, which already sits below the status bar, so it
    // needs far less room at the top than a full screen does.
    <Screen style={{ paddingTop: 22 }}>
      <View style={styles.top}>
        <RoundButton label="Back to player" onPress={() => router.back()}>
          <Icon name="down" size={22} />
        </RoundButton>
        <Wordmark />
        {/* The same control as the big button on the Playing screen, and always in step with it. */}
        <RoundButton label={playing ? 'Pause' : 'Play'} fill={colors.ink} onPress={toggle}>
          <Icon name={playing ? 'pause' : 'play'} size={20} color={colors.paper} />
        </RoundButton>
      </View>
      <Serif style={{ marginTop: 18, marginBottom: 4 }}>
        {words[count] ?? count} <Em>{count === 1 ? 'chapter.' : 'chapters.'}</Em>
      </Serif>
      <Text style={styles.sub}>
        {lesson.title}. {lesson.chosen_minutes} min
      </Text>

      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 12 }}>
        {lesson.segments.map((segment, i) => {
          const done = i < index;
          const now = i === index;
          // Chapters already heard can always be gone back to. A later one opens up only
          // once it is fully made, so a tap never lands on audio that is not there yet.
          const reachable = i <= index || (i < queued && Boolean(made[i]));
          const tone = now ? colors.ink : done || !reachable ? colors.gray : colors.ink;
          return (
            <Pressable
              key={segment.position}
              accessibilityRole="button"
              accessibilityLabel={`Chapter ${segment.position}, ${segment.title}, ${segment.target_minutes} minutes${now ? (playing ? ', playing now' : ', paused') : ''}${reachable ? '' : ', not made yet'}`}
              accessibilityState={{ selected: now, disabled: !reachable }}
              disabled={!reachable}
              onPress={() => {
                // Tapping the chapter you are on pauses or resumes it. Tapping another jumps to it.
                if (now) return toggle();
                jumpTo(i);
                router.back();
              }}
              style={[styles.row, now && { backgroundColor: colors.yellow }]}
            >
              <View style={styles.lead}>
                {done ? <Icon name="check" size={18} weight={3} /> : now ? <Icon name={playing ? 'pause' : 'play'} size={18} /> : <Text style={[styles.number, { color: tone }]}>{segment.position}</Text>}
              </View>
              <Text style={[styles.title, { color: tone }]}>{segment.title}</Text>
              <Text style={[styles.minutes, { color: tone }]}>{reachable ? `${segment.target_minutes} min` : i === index + 1 ? 'Almost ready' : 'Not yet'}</Text>
            </Pressable>
          );
        })}
        {/* "Off the map" marks a wildcard, picked from outside the listener's tags. It shows no tag. */}
        {tag && tag !== 'Off the map' ? (
          <View style={styles.from}>
            <Text style={styles.fromLabel}>From your interest</Text>
            <TagLabel>{tag}</TagLabel>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sub: { fontFamily: fonts.body, fontSize: 14, color: colors.gray, marginBottom: 14 },
  list: { flex: 1, borderTopWidth: 1, borderTopColor: colors.line, marginHorizontal: -12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 68, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  lead: { width: 32, alignItems: 'center' },
  number: { fontFamily: fonts.display, fontSize: 15 },
  title: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 18, lineHeight: 21 },
  minutes: { fontFamily: fonts.body, fontSize: 14 },
  from: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 18 },
  fromLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.gray },
});

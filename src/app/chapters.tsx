// 7. Chapters. Where you are in the lesson, and a way to jump around in it.
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Em, Icon, RoundButton, Screen, Serif, Wordmark } from '@/components/ui';
import { usePlayer } from '@/state/player';
import { colors, fonts } from '@/theme';

const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];

export default function Chapters() {
  const { lesson, index, queued, playing, jumpTo, toggle } = usePlayer();
  if (!lesson) return <Screen>{null}</Screen>;
  const count = lesson.segments.length;

  return (
    <Screen>
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
          // A chapter can be jumped to once it is in the queue. Later ones are not made yet.
          const reachable = i < queued;
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
              <Text style={[styles.minutes, { color: tone }]}>{segment.target_minutes} min</Text>
            </Pressable>
          );
        })}
        {queued < count ? <Text style={styles.note}>Later chapters are written as you get close to them.</Text> : null}
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
  note: { fontFamily: fonts.serifItalic, fontSize: 20, color: colors.gray, paddingHorizontal: 12, paddingTop: 16 },
});

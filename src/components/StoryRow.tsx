// One story in the Library: its cover, its title, and where the listener stands with it.
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CoverTile } from '@/components/covers';
import { SwipeAway } from '@/components/SwipeAway';
import { Icon } from '@/components/ui';
import type { LessonSummary } from '@/lib/api';
import { colors, fonts } from '@/theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Heard today", "Heard yesterday" or "Heard 22 Nov". */
function heard(when: string) {
  const day = new Date(when);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(day).setHours(0, 0, 0, 0)) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${day.getDate()} ${MONTHS[day.getMonth()]}`;
}

export function StoryRow({ lesson, onPlay, onRemove, onUnlike }: { lesson: LessonSummary; onPlay: () => void; onRemove: () => void; onUnlike: () => void }) {
  const part = !lesson.finished && lesson.left_minutes ? `Resume. ${lesson.left_minutes} min left` : null;
  return (
    <SwipeAway label="Remove" onAway={onRemove}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${lesson.title}. ${part ?? 'Play'}`} onPress={onPlay} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
        <CoverTile id={lesson.id} size={60} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={3}>
            {lesson.title}
          </Text>
          <Text style={[styles.sub, part ? styles.part : null]}>{part ?? `${lesson.chosen_minutes} min. ${lesson.finished ? 'Heard' : 'Started'} ${heard(lesson.started_at)}`}</Text>
        </View>
        {lesson.liked ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Liked. Tap to unlike" onPress={onUnlike} hitSlop={14} style={({ pressed }) => [{ padding: 6 }, pressed && { opacity: 0.4 }]}>
            <Icon name="heart" size={20} color={colors.vermilion} />
          </Pressable>
        ) : null}
      </Pressable>
    </SwipeAway>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, minHeight: 80, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.paper },
  title: { fontFamily: fonts.display, fontSize: 17, lineHeight: 19, letterSpacing: -0.5, textTransform: 'uppercase', color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 17, color: colors.gray, marginTop: 5 },
  part: { fontFamily: fonts.bodySemi, color: colors.ink },
});

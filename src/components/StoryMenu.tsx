// The "..." menu on a Library row: share the story, or play it again from the beginning.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { CoverTile } from '@/components/covers';
import { ShareSheet } from '@/components/ShareSheet';
import { Icon, type IconName } from '@/components/ui';
import { prepareShare, type LessonSummary } from '@/lib/api';
import { playOne } from '@/state/library';
import { colors, fonts } from '@/theme';

type Choice = 'share' | 'start';

export function StoryMenu({ lesson, onChoose, onClose, onClosed }: { lesson: LessonSummary | null; onChoose: (c: Choice) => void; onClose: () => void; onClosed?: () => void }) {
  // Kept while the sheet slides away, so its contents do not blank out mid-slide.
  const [shown, setShown] = useState<LessonSummary | null>(lesson);
  useEffect(() => {
    if (lesson) {
      setShown(lesson);
      // The link starts being made the moment the menu opens, so Share has it ready.
      prepareShare(lesson.id).catch(() => {});
    }
  }, [lesson]);

  const row = (label: string, icon: IconName, press: () => void) => (
    <Pressable accessibilityRole="button" onPress={press} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={24} />
      <Text style={styles.rowText}>{label}</Text>
    </Pressable>
  );
  return (
    <BottomSheet open={Boolean(lesson)} onClose={onClose} onClosed={onClosed}>
      {shown ? (
        <View style={styles.head}>
          <CoverTile id={shown.id} size={48} />
          <Text style={styles.title} numberOfLines={2}>
            {shown.title}
          </Text>
        </View>
      ) : null}
      {row('Share story', 'share', () => onChoose('share'))}
      {row('Play from the start', 'play', () => onChoose('start'))}
      {row('Cancel', 'close', onClose)}
    </BottomSheet>
  );
}

/** The menu and the share sheet together, for a screen that lists stories. */
export function StoryActions({ lesson, onClose }: { lesson: LessonSummary | null; onClose: () => void }) {
  const [sharing, setSharing] = useState<LessonSummary | null>(null);
  // What was picked waits until the menu has fully slid away. Two sheets on screen at once is
  // what iOS handles badly.
  const picked = useRef<{ c: Choice; lesson: LessonSummary } | null>(null);
  const choose = (c: Choice) => {
    if (lesson) picked.current = { c, lesson };
    onClose();
  };
  const closed = () => {
    const p = picked.current;
    picked.current = null;
    if (!p) return;
    if (p.c === 'share') setSharing(p.lesson);
    else {
      playOne(p.lesson, true);
      router.push('/playing');
    }
  };
  return (
    <>
      <StoryMenu lesson={lesson} onClose={onClose} onChoose={choose} onClosed={closed} />
      <ShareSheet lessonId={sharing?.id ?? null} title={sharing?.title ?? ''} onClose={() => setSharing(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: 6 },
  title: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 17, lineHeight: 21, color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, height: 58 },
  rowText: { fontFamily: fonts.bodySemi, fontSize: 18, color: colors.ink },
});

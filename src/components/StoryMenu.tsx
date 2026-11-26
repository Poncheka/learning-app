// The "..." menu on a Library row: share the story, or play it again from the beginning.
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CoverTile } from '@/components/covers';
import { ShareSheet } from '@/components/ShareSheet';
import { Icon, type IconName } from '@/components/ui';
import type { LessonSummary } from '@/lib/api';
import { playOne } from '@/state/library';
import { colors, fonts } from '@/theme';

export function StoryMenu({ lesson, onShare, onFromStart, onClose }: { lesson: LessonSummary | null; onShare: () => void; onFromStart: () => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const row = (label: string, icon: IconName, press: () => void) => (
    <Pressable accessibilityRole="button" onPress={press} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={24} />
      <Text style={styles.rowText}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal visible={Boolean(lesson)} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.grip} />
        {lesson ? (
          <View style={styles.head}>
            <CoverTile id={lesson.id} size={48} />
            <Text style={styles.title} numberOfLines={2}>
              {lesson.title}
            </Text>
          </View>
        ) : null}
        {row('Share story', 'share', onShare)}
        {row('Play from the start', 'play', onFromStart)}
        {row('Cancel', 'close', onClose)}
      </View>
    </Modal>
  );
}

/** The menu and the share sheet together, for a screen that lists stories. */
export function StoryActions({ lesson, onClose }: { lesson: LessonSummary | null; onClose: () => void }) {
  const [sharing, setSharing] = useState<LessonSummary | null>(null);
  return (
    <>
      <StoryMenu
        lesson={lesson}
        onClose={onClose}
        onShare={() => {
          setSharing(lesson);
          onClose();
        }}
        onFromStart={() => {
          if (lesson) playOne(lesson, true);
          onClose();
          router.push('/playing');
        }}
      />
      <ShareSheet lessonId={sharing?.id ?? null} title={sharing?.title ?? ''} onClose={() => setSharing(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(23,25,27,0.5)' },
  sheet: { backgroundColor: colors.paper, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 10 },
  grip: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line, marginBottom: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: 6 },
  title: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 17, lineHeight: 21, color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, height: 58 },
  rowText: { fontFamily: fonts.bodySemi, fontSize: 18, color: colors.ink },
});

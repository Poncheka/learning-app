// 4. Building. The few seconds between choosing a lesson and hearing it.
//
// The reading and the writing of the opening were done ahead of time, so the only thing
// left is the voice. This screen moves on by itself the moment sound begins.
import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BuildingArt } from '@/components/art';
import { BigButton, Display, Eyebrow, Icon, OutlineButton, Screen, Wordmark } from '@/components/ui';
import { usePlayer } from '@/state/player';
import { colors, fonts } from '@/theme';

function Step({ label, state }: { label: string; state: 'done' | 'now' | 'next' }) {
  return (
    <View style={styles.step}>
      <View style={[styles.mark, state === 'done' && styles.markDone, state === 'now' && styles.markNow]}>{state === 'done' ? <Icon name="check" size={14} color={colors.paper} weight={3.5} /> : null}</View>
      <Text style={[styles.stepLabel, state === 'now' && { fontFamily: fonts.bodySemi }, state === 'next' && { color: colors.gray }]}>{label}</Text>
    </View>
  );
}

export default function Building() {
  const { phase, topic, minutes, lesson, error, stop, begin } = usePlayer();

  useEffect(() => {
    if (phase === 'playing') router.replace('/playing');
    if (phase === 'idle') router.replace('/listen');
  }, [phase]);

  const cancel = () => {
    stop();
    router.replace('/listen');
  };

  return (
    <Screen style={{ paddingBottom: 40 }}>
      <View style={styles.top}>
        <OutlineButton label="Cancel" onPress={cancel} />
        <Wordmark />
      </View>
      <BuildingArt />
      <Eyebrow style={{ marginBottom: 8 }}>
        {topic?.title}. {minutes} min
      </Eyebrow>
      {phase === 'error' ? (
        <>
          <Display style={{ marginBottom: 12 }}>That did{'\n'}not start.</Display>
          <Text style={styles.problem}>{error}</Text>
          <BigButton label="Try again" onPress={() => topic && begin(topic, minutes)} />
        </>
      ) : (
        <>
          <Display style={{ marginBottom: 16 }}>Starting{'\n'}your lesson.</Display>
          <View accessibilityRole="progressbar" accessibilityLiveRegion="polite" style={{ marginBottom: 18 }}>
            <Step label="Found the sources" state="done" />
            <Step label="Wrote the opening" state="done" />
            <Step label={lesson ? 'Recording the voice' : 'Laying out the chapters'} state="now" />
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 40 },
  stepLabel: { fontFamily: fonts.body, fontSize: 17, color: colors.ink },
  mark: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  markDone: { backgroundColor: colors.ink, borderColor: colors.ink },
  markNow: { backgroundColor: colors.vermilion, borderColor: colors.ink },
  problem: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: colors.gray, marginBottom: 20 },
});

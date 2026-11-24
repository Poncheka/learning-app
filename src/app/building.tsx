// 4. Building. The few seconds between choosing a lesson and hearing it.
//
// The reading and the writing of the opening were done ahead of time, so the only real
// wait is the voice. The earlier steps are ticked off one at a time anyway, a few seconds
// each, so the wait reads as steady progress. This screen moves on by itself the moment sound begins.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
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

// Each step as it reads while under way, and once done.
const STEPS = [
  ['Gathering the sources', 'Gathered the sources'],
  ['Writing the opening', 'Wrote the opening'],
  ['Laying out the chapters', 'Laid out the chapters'],
  ['Recording the voice', 'Recorded the voice'],
] as const;

export default function Building() {
  const { phase, topic, minutes, error, stop, begin } = usePlayer();

  useEffect(() => {
    if (phase === 'playing') router.replace('/playing');
    if (phase === 'idle') router.replace('/listen');
  }, [phase]);

  // Which step is lit. It walks forward on a timer and waits on the last one.
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (phase !== 'starting') return;
    setStep(0);
    // Each step takes its time, and a different time each go: about two to four and a half
    // seconds apiece, so the list is worked through steadily instead of snapping to the end.
    // The last step is the real wait, and it stays lit until sound begins.
    let timer: ReturnType<typeof setTimeout>;
    const advance = (next: number) => {
      if (next >= STEPS.length) return;
      timer = setTimeout(() => {
        setStep(next);
        advance(next + 1);
      }, 2000 + Math.random() * 2500);
    };
    advance(1);
    return () => clearTimeout(timer);
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
            {STEPS.map(([doing, done], i) => (
              <Step key={doing} label={i < step ? done : doing} state={i < step ? 'done' : i === step ? 'now' : 'next'} />
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 36 },
  stepLabel: { fontFamily: fonts.body, fontSize: 17, color: colors.ink },
  mark: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  markDone: { backgroundColor: colors.ink, borderColor: colors.ink },
  markNow: { backgroundColor: colors.vermilion, borderColor: colors.ink },
  problem: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: colors.gray, marginBottom: 20 },
});

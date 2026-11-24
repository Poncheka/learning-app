// 8. Finished. The lesson is over: say how it was, then pick another.
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BigButton, Em, Eyebrow, OutlineButton, Screen, Serif, Wordmark } from '@/components/ui';
import { sendSignal } from '@/lib/api';
import { usePlayer } from '@/state/player';
import { colors, fonts } from '@/theme';

export default function Finished() {
  const { lesson, stop } = usePlayer();
  // The one place the listener says how it was. Saved against the lesson, and read back
  // when Pliny chooses what to offer next.
  const [verdict, setVerdict] = useState<'loved' | 'no' | null>(null);
  const leave = (to: '/listen') => {
    stop();
    router.replace(to);
  };
  // A verdict is the last thing asked here. It is saved, shown as chosen for a beat, and then
  // the listener is taken back to Listen without another tap.
  const give = (which: 'loved' | 'no') => {
    if (verdict) return;
    setVerdict(which);
    sendSignal(which === 'loved' ? 'loved' : 'not_for_me', lesson?.id);
    setTimeout(() => leave('/listen'), 550);
  };


  return (
    <Screen style={{ paddingBottom: 40 }}>
      <View style={styles.disc} />
      <View style={styles.bar} />
      <Wordmark />
      <View style={{ flex: 1 }} />
      <Eyebrow style={{ color: colors.ink, marginBottom: 8 }}>{lesson?.title}</Eyebrow>
      {/* Two separate lines, each with room above it. Squeezed into one tight block, the tops of the letters get clipped on iPhone. */}
      <Serif size={84} style={styles.wrap}>
        That{'\u2019'}s
      </Serif>
      <Serif size={84} style={[styles.wrap, { marginTop: -16 }]}>
        <Em>a wrap.</Em>
      </Serif>
      <Text style={styles.summary}>Saved to your library, if you want to listen again.</Text>
      <View style={styles.verdicts}>
        <OutlineButton label="Loved it" icon="thumbUp" height={64} textSize={17} selected={verdict === 'loved'} style={{ flex: 1, paddingHorizontal: 0 }} onPress={() => give('loved')} />
        <OutlineButton label="Not for me" icon="thumbDown" height={64} textSize={17} selected={verdict === 'no'} style={{ flex: 1, paddingHorizontal: 0 }} onPress={() => give('no')} />
      </View>
      <BigButton label="Pick the next one" onPress={() => leave('/listen')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  disc: { position: 'absolute', right: -70, top: 90, width: 300, height: 300, borderRadius: 150, backgroundColor: colors.iris },
  bar: { position: 'absolute', right: 50, top: 150, width: 110, height: 24, backgroundColor: colors.yellow },
  wrap: { lineHeight: 92, letterSpacing: -2 },
  summary: { fontFamily: fonts.body, fontSize: 17, lineHeight: 24, color: colors.ink, marginTop: 16, marginBottom: 22 },
  verdicts: { flexDirection: 'row', gap: 10, marginBottom: 12 },
});

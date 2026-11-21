// 6. Playing. Built to be used at a glance: one big pause button, everything else one tap away.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PlayingArt } from '@/components/art';
import { colorFor } from '@/components/covers';
import { Display, Eyebrow, Icon, OutlineButton, RoundButton, Screen, SkipIcon, Wordmark } from '@/components/ui';
import { clock, lessonProgress, usePlayer } from '@/state/player';
import { colors, fonts } from '@/theme';

export default function Playing() {
  const player = usePlayer();
  const { phase, lesson, index, playing, buffering, rate, toggle, seekBy, cycleRate, finish } = player;
  // Thumbs are remembered only on this screen for now. They start shaping suggestions in milestone 4.
  const [thumb, setThumb] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (phase === 'finished') router.replace('/finished');
    if (phase === 'idle' || phase === 'error') router.replace('/listen');
  }, [phase]);

  if (!lesson) return <Screen>{null}</Screen>;

  const { elapsed, total } = lessonProgress(player);
  const share = total > 0 ? elapsed / total : 0;
  const waiting = buffering && !playing;

  return (
    <Screen>
      <View style={styles.top}>
        <RoundButton label="Minimize player" onPress={() => router.replace('/listen')}>
          <Icon name="down" size={22} />
        </RoundButton>
        <Wordmark />
        <OutlineButton
          label="Done"
          textSize={15}
          style={{ paddingHorizontal: 18 }}
          onPress={finish}
        />
      </View>

      <PlayingArt progress={share} color={colorFor(player.topic?.id ?? lesson.id)} />

      <Eyebrow style={{ marginBottom: 6 }}>{lesson.title}</Eyebrow>
      <Display size={34} style={{ minHeight: 66 }}>
        {lesson.segments[index].title.replace(/[.\s]+$/, '')}.
      </Display>

      <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(share * 100) }}>
        <View style={[styles.fill, { width: `${share * 100}%` }]} />
      </View>
      <View style={styles.times}>
        <Text style={styles.time}>{clock(elapsed)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Speed ${rate} times. Tap to change.`} onPress={cycleRate} hitSlop={10} style={styles.speed}>
          <Text style={styles.speedLabel}>{rate}× speed</Text>
        </Pressable>
        <Text style={styles.time}>-{clock(total - elapsed)}</Text>
      </View>

      <View style={styles.controls}>
        <RoundButton label="Back 15 seconds" size={84} onPress={() => seekBy(-15)}>
          <SkipIcon />
        </RoundButton>
        <Pressable accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'} onPress={toggle} style={({ pressed }) => [styles.main, pressed && { opacity: 0.8 }]}>
          {waiting ? <ActivityIndicator color={colors.paper} size="large" /> : <Icon name={playing ? 'pause' : 'play'} size={42} color={colors.paper} />}
        </Pressable>
        <RoundButton label="Forward 15 seconds" size={84} onPress={() => seekBy(15)}>
          <SkipIcon forward />
        </RoundButton>
      </View>

      <View style={styles.bottom}>
        <RoundButton label="Thumbs down" size={60} fill={thumb === 'down' ? colors.ink : colors.white} onPress={() => setThumb(thumb === 'down' ? null : 'down')}>
          <Icon name="thumbDown" weight={2} color={thumb === 'down' ? colors.paper : colors.ink} />
        </RoundButton>
        <OutlineButton
          label={`Chapters ${index + 1} of ${lesson.segments.length}`}
          icon="list"
          height={60}
          fill={colors.yellow}
          style={{ flex: 1, gap: 10 }}
          onPress={() => router.push('/chapters')}
        />
        <RoundButton label="Thumbs up" size={60} fill={thumb === 'up' ? colors.ink : colors.white} onPress={() => setThumb(thumb === 'up' ? null : 'up')}>
          <Icon name="thumbUp" weight={2} color={thumb === 'up' ? colors.paper : colors.ink} />
        </RoundButton>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.line, marginTop: 18, marginBottom: 6 },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.ink },
  times: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  time: { fontFamily: fonts.body, fontSize: 13, color: colors.gray, minWidth: 48, fontVariant: ['tabular-nums'] },
  speed: { paddingHorizontal: 12, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: colors.ink, justifyContent: 'center', backgroundColor: colors.white },
  speedLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 22, marginHorizontal: 8 },
  main: { width: 104, height: 104, borderRadius: 52, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});

// 6. Playing. Built to be used at a glance: one big pause button, everything else one tap away.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { PlayingArt } from '@/components/art';
import { colorFor } from '@/components/covers';
import { ShareSheet } from '@/components/ShareSheet';
import { prepareShare } from '@/lib/api';
import { Display, Eyebrow, Icon, OutlineButton, RoundButton, Screen, SkipIcon, Wordmark } from '@/components/ui';
import { clock, lessonProgress, reachable, usePlayer } from '@/state/player';
import { colors, fonts, gutter } from '@/theme';

/** Where a touch falls along the progress bar, from 0 at its left end to 1 at its right. */
const at = (pageX: number, width: number) => Math.max(0, Math.min(1, (pageX - gutter) / width));

export default function Playing() {
  const player = usePlayer();
  const { phase, lesson, index, playing, buffering, rate, toggle, seekBy, scrubTo, cycleRate, finish } = player;

  useEffect(() => {
    if (phase === 'idle' || phase === 'error') router.replace('/listen');
  }, [phase]);

  const { elapsed, total } = lessonProgress(player);
  const real = total > 0 ? elapsed / total : 0;

  // Dragging the bar. While a finger is down the bar follows it. On letting go the audio
  // moves there, and the bar holds its place for a moment until the player catches up.
  const [drag, setDrag] = useState<number | null>(null);
  const [sharing, setSharing] = useState(false);
  // The share link is got ready now, so the share sheet has it the moment it opens.
  useEffect(() => {
    if (lesson?.id) prepareShare(lesson.id).catch(() => {});
  }, [lesson?.id]);
  const width = useWindowDimensions().width - gutter * 2;
  const live = useRef({ width, total, scrubTo });
  live.current = { width, total, scrubTo };
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrub = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        if (settle.current) clearTimeout(settle.current);
        setDrag(at(e.nativeEvent.pageX, live.current.width));
      },
      onPanResponderMove: (e) => setDrag(at(e.nativeEvent.pageX, live.current.width)),
      onPanResponderRelease: (e) => {
        const share = at(e.nativeEvent.pageX, live.current.width);
        live.current.scrubTo(share * live.current.total);
        settle.current = setTimeout(() => setDrag(null), 900);
      },
      onPanResponderTerminate: () => setDrag(null),
    }),
  ).current;

  // A lesson opened from the Library lands here before its details arrive. Hold the frame for a moment.
  if (!lesson) {
    return (
      <Screen>
        <View style={styles.top}>
          <RoundButton label="Back" onPress={() => router.replace('/library')}>
            <Icon name="down" size={22} />
          </RoundButton>
          <Wordmark />
          <View style={{ width: 48 }} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <ActivityIndicator color={colors.ink} size="large" />
          <Eyebrow>{player.topic?.title ?? ''}</Eyebrow>
        </View>
      </Screen>
    );
  }

  // How far along the bar there is finished audio to move through.
  const open = total > 0 ? Math.min(1, reachable(player) / total) : 0;
  const canSkipAhead = Boolean(player.made[index]);
  const share = drag ?? real;
  const shown = drag === null ? elapsed : drag * total;
  const waiting = (buffering || phase === 'starting') && !playing;

  return (
    <Screen>
      <View style={styles.top}>
        <RoundButton label="Minimize player" onPress={() => router.replace('/listen')}>
          <Icon name="down" size={22} />
        </RoundButton>
        <View style={styles.topRight}>
          <RoundButton label="Share this story" onPress={() => setSharing(true)}>
            <Icon name="share" size={22} />
          </RoundButton>
          <OutlineButton label="Done" textSize={15} style={{ paddingHorizontal: 18 }} onPress={finish} />
        </View>
      </View>
      <ShareSheet lessonId={sharing ? lesson.id : null} title={lesson.title} onClose={() => setSharing(false)} />

      <PlayingArt
        playing={playing}
        color={colorFor(player.topic?.id ?? lesson.id)}
        shape={player.interlude ? null : lesson.segments[index]?.shape}
        time={player.time}
        length={player.duration || lesson.segments[index]?.seconds || 0}
      />

      <Eyebrow style={{ marginBottom: 6 }}>{lesson.title}</Eyebrow>
      <Display size={34} style={{ minHeight: 66 }}>
        {lesson.segments[index].title.replace(/[.\s]+$/, '')}.
      </Display>

      <View
        {...scrub.panHandlers}
        style={styles.scrub}
        accessibilityRole="adjustable"
        accessibilityLabel="Position in the lesson. Drag to move."
        accessibilityValue={{ min: 0, max: 100, now: Math.round(share * 100) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => seekBy(e.nativeEvent.actionName === 'increment' ? 15 : -15)}
      >
        <View style={styles.track} pointerEvents="none">
          {/* The darker stretch is audio that is finished and can be moved through. */}
          <View style={[styles.ready, { width: `${Math.max(open, real) * 100}%` }]} />
          <View style={[styles.fill, { width: `${share * 100}%` }]} />
        </View>
        <View pointerEvents="none" style={[styles.knob, drag !== null && styles.knobHeld, { left: share * width }]} />
      </View>
      <View style={styles.times}>
        <Text style={styles.time}>{clock(shown)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Speed ${rate} times. Tap to change.`} onPress={cycleRate} hitSlop={10} style={styles.speed}>
          <Text style={styles.speedLabel}>{rate}× speed</Text>
        </Pressable>
        <Text style={[styles.time, { textAlign: 'right' }]}>-{clock(total - shown)}</Text>
      </View>

      <View style={styles.controls}>
        <RoundButton label="Back 15 seconds" size={60} onPress={() => seekBy(-15)}>
          <SkipIcon />
        </RoundButton>
        <Pressable accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'} onPress={toggle} style={({ pressed }) => [styles.main, pressed && { opacity: 0.8 }]}>
          {waiting ? <ActivityIndicator color={colors.paper} size="large" /> : <Icon name={playing ? 'pause' : 'play'} size={42} color={colors.paper} />}
        </Pressable>
        <RoundButton label={canSkipAhead ? 'Forward 15 seconds' : 'Forward 15 seconds. Not ready yet.'} size={60} disabled={!canSkipAhead} onPress={() => seekBy(15)}>
          <SkipIcon forward />
        </RoundButton>
      </View>

      <View style={styles.bottom}>
        <OutlineButton
          label={`Chapters ${index + 1} of ${lesson.segments.length}`}
          icon="list"
          height={60}
          fill={colors.yellow}
          style={{ flex: 1, gap: 10 }}
          onPress={() => router.push('/chapters')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // A tall, invisible strip around the thin bar, so a thumb can grab it without aiming.
  scrub: { height: 36, justifyContent: 'center', marginTop: 4 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.line },
  knob: { position: 'absolute', top: 10, width: 16, height: 16, borderRadius: 8, marginLeft: -8, backgroundColor: colors.ink },
  knobHeld: { top: 6, width: 24, height: 24, borderRadius: 12, marginLeft: -12, backgroundColor: colors.vermilion, borderWidth: 2, borderColor: colors.ink },
  ready: { position: 'absolute', left: 0, top: 0, height: 6, borderRadius: 3, backgroundColor: colors.faint },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.ink },
  times: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  time: { fontFamily: fonts.body, fontSize: 13, color: colors.gray, minWidth: 48, fontVariant: ['tabular-nums'] },
  speed: { paddingHorizontal: 12, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: colors.ink, justifyContent: 'center', backgroundColor: colors.white },
  speedLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28, marginTop: 14, marginBottom: 22 },
  main: { width: 104, height: 104, borderRadius: 52, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});

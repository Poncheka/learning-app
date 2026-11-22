// The shared building blocks: icons, buttons, the wordmark, the screen frame and the tab bar.
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';

import { colors, fonts, gutter } from '@/theme';

// ---------- Icons ----------
//
// Icons never take touches themselves. The button around them does, so a tap that lands
// on the drawing still counts.

const strokes = {
  arrow: 'M4 12h15M13 6l6 6-6 6',
  back: 'M15 5l-7 7 7 7',
  chevron: 'M9 5l7 7-7 7',
  down: 'M6 9l6 6 6-6',
  check: 'M5 12l5 5 9-10',
  list: 'M4 6h16M4 12h16M4 18h10',
  thumbUp: 'M7 10v11M7 10l4-7c1.5 0 2.5 1 2.5 2.5V8h5a2 2 0 0 1 2 2.3l-1.2 8A2 2 0 0 1 17.3 20H7',
  thumbDown: 'M17 14V3M17 14l-4 7c-1.5 0-2.5-1-2.5-2.5V16H5.5a2 2 0 0 1-2-2.3l1.2-8A2 2 0 0 1 6.7 4H17',
} as const;

const fills = {
  star: 'M12 1l1.6 8.4L22 12l-8.4 2.6L12 23l-1.6-8.4L2 12l8.4-2.6z',
  play: 'M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
} as const;

export type IconName = keyof typeof strokes | keyof typeof fills | 'interests';

export function Icon({ name, size = 24, color = colors.ink, weight = 2.2 }: { name: IconName; size?: number; color?: string; weight?: number }) {
  if (name === 'interests') {
    return (
      <Svg pointerEvents="none" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Circle cx={8} cy={8} r={3} />
        <Circle cx={16} cy={16} r={3} />
        <Path d="M13 8h8M3 16h8" />
      </Svg>
    );
  }
  if (name in fills) {
    return (
      <Svg pointerEvents="none" width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <Path d={fills[name as keyof typeof fills]} />
      </Svg>
    );
  }
  return (
    <Svg pointerEvents="none" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round">
      <Path d={strokes[name as keyof typeof strokes]} />
    </Svg>
  );
}

/** The circular arrow with "15" inside, for skipping back or forward. */
export function SkipIcon({ forward, size = 32 }: { forward?: boolean; size?: number }) {
  return (
    <Svg pointerEvents="none" width={size} height={size} viewBox="0 0 34 34" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <G transform={forward ? 'translate(34 0) scale(-1 1)' : undefined}>
        <Path d="M5 17a12 12 0 1 0 12-12" />
        <Path d="M17 1l-4 4 4 4" />
      </G>
      <SvgText x={17} y={22} textAnchor="middle" fontSize={11} fontWeight="700" fontFamily={fonts.display} fill={colors.ink} stroke="none">
        15
      </SvgText>
    </Svg>
  );
}

// ---------- Type ----------

export function Wordmark({ size = 28, dot }: { size?: number; dot?: boolean }) {
  return (
    <Text style={{ fontFamily: fonts.display, fontSize: size, letterSpacing: size * -0.043, color: colors.ink }}>
      pliny<Text style={dot ? { color: colors.vermilion } : undefined}>.</Text>
    </Text>
  );
}

export function Eyebrow({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.eyebrow, style]}>{children}</Text>;
}

/** An editorial headline in Instrument Serif. Wrap a word in <Em> to set it in italic. */
export function Serif({ children, size = 44, style }: { children: ReactNode; size?: number; style?: StyleProp<TextStyle> }) {
  return <Text style={[{ fontFamily: fonts.serif, fontSize: size, lineHeight: size * 1.02, letterSpacing: -0.5, color: colors.ink }, style]}>{children}</Text>;
}

export function Em({ children }: { children: ReactNode }) {
  return <Text style={{ fontFamily: fonts.serifItalic }}>{children}</Text>;
}

/**
 * A display headline in Space Grotesk, uppercase and tight. The space above it is built in,
 * because on iPhone tight capitals otherwise ride up into whatever sits over them.
 */
export function Display({ children, size = 44, color = colors.ink, style }: { children: ReactNode; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[{ fontFamily: fonts.display, fontSize: size, lineHeight: size, paddingTop: size * 0.12, letterSpacing: size * -0.042, textTransform: 'uppercase', color }, style]}>
      {children}
    </Text>
  );
}

/** A small outlined label naming the interest a lesson grew out of. */
export function TagLabel({ children }: { children: string }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

// ---------- Buttons ----------

/** The main action: a dark pill with a yellow circle at its right end. */
export function BigButton({ label, icon = 'arrow', onPress, height = 72, disabled }: { label: string; icon?: IconName; onPress: () => void; height?: number; disabled?: boolean }) {
  const circle = height === 88 ? 60 : 48;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.big, { height, borderRadius: height / 2, paddingLeft: height === 88 ? 32 : 28, paddingRight: height === 88 ? 14 : 12 }, (pressed || disabled) && styles.dim]}
    >
      <Text style={[styles.bigLabel, { fontSize: height === 88 ? 24 : 20 }]}>{label}</Text>
      <View style={[styles.bigCircle, { width: circle, height: circle, borderRadius: circle / 2 }]}>
        <Icon name={icon} size={icon === 'play' ? 22 : 26} />
      </View>
    </Pressable>
  );
}

/** A white pill with a dark outline, for secondary actions. */
export function OutlineButton({ label, onPress, height = 48, icon, iconAfter, fill = colors.white, style, textSize = 16, selected }: { label: string; onPress: () => void; height?: number; icon?: IconName; iconAfter?: IconName; fill?: string; style?: StyleProp<ViewStyle>; textSize?: number; selected?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.outline, { height, borderRadius: height / 2, backgroundColor: selected ? colors.ink : fill }, pressed && styles.dim, style]}
    >
      {icon ? <Icon name={icon} size={22} weight={2} color={selected ? colors.paper : colors.ink} /> : null}
      <Text style={{ fontFamily: fonts.bodySemi, fontSize: textSize, color: selected ? colors.paper : colors.ink }}>{label}</Text>
      {iconAfter ? <Icon name={iconAfter} size={26} /> : null}
    </Pressable>
  );
}

/** A round white button holding one icon. */
export function RoundButton({ label, onPress, size = 48, children, fill = colors.white, disabled }: { label: string; onPress: () => void; size?: number; children: ReactNode; fill?: string; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.round, { width: size, height: size, borderRadius: size / 2, backgroundColor: fill }, (pressed || disabled) && styles.dim]}
    >
      {children}
    </Pressable>
  );
}

// ---------- Frame ----------

/** The frame every screen sits in: paper background, with room for the status bar and home bar. */
export function Screen({ children, style, flush }: { children: ReactNode; style?: StyleProp<ViewStyle>; flush?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top > 0 ? insets.top + 9 : 56, paddingBottom: flush ? 0 : Math.max(insets.bottom + 6, 28), paddingHorizontal: flush ? 0 : gutter },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const tabs = [
  { key: 'library', label: 'History', icon: 'list', href: '/library' },
  { key: 'listen', label: 'Listen', icon: 'star', href: '/listen' },
  { key: 'interests', label: 'Interests', icon: 'interests', href: '/interests' },
] as const;

export function TabBar({ active }: { active: (typeof tabs)[number]['key'] }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom - 8, 18) }]} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected: on }} style={styles.tab} onPress={() => (on ? undefined : router.replace(tab.href))}>
            <Icon name={tab.icon} size={24} weight={2} color={on ? colors.ink : colors.gray} />
            <Text style={{ fontFamily: on ? fonts.bodySemi : fonts.body, fontSize: 13, color: on ? colors.ink : colors.gray }}>{tab.label}</Text>
            <View style={[styles.tabMark, on && { backgroundColor: colors.ink }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontFamily: fonts.bodySemi, fontSize: 12, letterSpacing: 2.5, textTransform: 'uppercase', color: colors.gray },
  tag: { height: 22, borderRadius: 11, borderWidth: 1, borderColor: colors.gray, paddingHorizontal: 9, justifyContent: 'center', flexShrink: 1 },
  tagText: { fontFamily: fonts.bodyMedium, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.gray },
  big: { backgroundColor: colors.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bigLabel: { fontFamily: fonts.bodySemi, color: colors.paper },
  bigCircle: { backgroundColor: colors.yellow, alignItems: 'center', justifyContent: 'center' },
  outline: { borderWidth: 1.5, borderColor: colors.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20 },
  round: { borderWidth: 1.5, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.6 },
  screen: { flex: 1, backgroundColor: colors.paper, overflow: 'hidden' },
  tabBar: { flexDirection: 'row', paddingTop: 6, paddingHorizontal: 8, backgroundColor: colors.paper, borderTopWidth: 1, borderTopColor: colors.line },
  tab: { flex: 1, height: 60, alignItems: 'center', justifyContent: 'center', gap: 4 },
  tabMark: { position: 'absolute', bottom: -4, left: '22%', right: '22%', height: 3, backgroundColor: 'transparent' },
});

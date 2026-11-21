// Which of Jeff's thirty backgrounds goes behind which topic.
//
// A topic always gets the same background, chosen from its id, so a card does not change
// its look every time the screen redraws. Because topics come and go, the Listen screen
// still looks fresh. Two rules from the artwork's own notes are kept: no background shows
// twice at once, and cards next to each other never share a background color.
import { StyleSheet } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { cardBackgrounds, type CardBackground } from '@/components/cardBackgrounds';
import { colors } from '@/theme';

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

/** One background per id, in order, honoring the two rules above. */
export function pickBackgrounds(ids: string[]): CardBackground[] {
  const picked: CardBackground[] = [];
  for (const id of ids) {
    const start = hash(id) % cardBackgrounds.length;
    let choice = cardBackgrounds[start];
    for (let step = 0; step < cardBackgrounds.length; step++) {
      const candidate = cardBackgrounds[(start + step) % cardBackgrounds.length];
      const previous = picked[picked.length - 1];
      if (picked.includes(candidate) || previous?.background === candidate.background) continue;
      choice = candidate;
      break;
    }
    picked.push(choice);
  }
  return picked;
}

/** The one strong color a lesson is known by, for the places that show it without its card. */
export function colorFor(id: string): string {
  const { background } = cardBackgrounds[hash(id) % cardBackgrounds.length];
  // Paper and ink are the page itself, so they would not read as a color.
  return background === colors.paper || background === colors.ink ? colors.vermilion : background;
}

/** Fills its parent with a background, cropped to cover, the way the artwork was drawn to be used. */
export function CardArt({ background }: { background: CardBackground }) {
  return <SvgXml xml={background.xml} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={StyleSheet.absoluteFill} pointerEvents="none" />;
}

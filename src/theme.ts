// Pliny's colors, type and spacing, from the brand book. Everything visual starts here.
export const colors = {
  // Foundation
  paper: '#F7F7F4',
  ink: '#17191B',
  white: '#FFFFFF',
  gray: '#66696B',
  line: '#D9D9D3',
  faint: '#B8B9B6',
  // Expressive. A composition favors one of these, with a second used sparingly.
  vermilion: '#FF5438',
  yellow: '#EFFF00',
  blue: '#2447FF',
  iris: '#8D82FF',
  coral: '#FF8068',
} as const;

// Space Grotesk for display, Instrument Serif for editorial lines, Inter for everything functional.
export const fonts = {
  display: 'SpaceGrotesk_700Bold',
  displayMedium: 'SpaceGrotesk_500Medium',
  serif: 'InstrumentSerif_400Regular',
  serifItalic: 'InstrumentSerif_400Regular_Italic',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
} as const;

// Side padding used by every screen.
export const gutter = 24;

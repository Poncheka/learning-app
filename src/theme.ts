// One place for colors, spacing and type sizes, the way Near Miss does it.
// Everything is sized large on purpose: this app is used at a glance, in a car or on a walk.
export const colors = {
  background: '#F7F2EA',
  text: '#1B1A17',
  textSecondary: '#6B665E',
  accent: '#1B1A17',
  onAccent: '#F7F2EA',
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 64 } as const;

export const type = { title: 40, button: 24, body: 18 } as const;

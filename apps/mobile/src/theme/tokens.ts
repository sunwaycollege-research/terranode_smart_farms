/**
 * TERANODE design tokens — light theme.
 * Ported from simulation/teranode-twin-themed.html (:root light block).
 * oklch values were converted to nearest sRGB hex (React Native has no oklch()).
 * "parchment + soil ink" palette.
 */

export const colors = {
  // text / ink
  ink: '#1a1916',
  inkSoft: '#3a352e',
  muted: '#6b6457',
  subtle: '#8a8275',

  // surfaces
  bg: '#f6f3ec',
  bgWarm: '#efeadd',
  surface: '#ffffff',
  surface2: '#f0ecdf',

  // borders
  border: '#d8d2c2',
  borderSoft: '#e6e0d0',
  borderStrong: '#b8b0a0',

  // brand
  primary: '#3f6b4e', // deep forest/olive green  (oklch .40 .06 145)
  primarySoft: '#e4efe2',
  primaryInk: '#2f5740',
  accent: '#bd6a43', // terracotta (oklch .60 .15 45)
  accentSoft: '#f2e7da',

  // signal palette (status)
  watering: '#3f78c9', // blue
  wateringSoft: '#e4edf7',
  healthy: '#3fa564', // green
  dry: '#d9a23b', // amber/sun
  warn: '#d99a2e',
  warnSoft: '#f6ecd6',
  critical: '#c14a3b', // red
  criticalSoft: '#f5e2dd',
  offline: '#8a8275', // grey
} as const;

export const radius = {
  r1: 6,
  r2: 12,
  r3: 16,
  r4: 22,
  pill: 9999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Font family keys. Loaded in app/_layout.tsx via @expo-google-fonts. */
export const fonts = {
  display: 'InstrumentSerif_400Regular', // headings / logo
  displayItalic: 'InstrumentSerif_400Regular_Italic',
  ui: 'Geist_400Regular',
  uiMedium: 'Geist_500Medium',
  uiSemibold: 'Geist_600SemiBold',
  uiBold: 'Geist_700Bold',
  mono: 'JetBrainsMono_500Medium', // numbers, telemetry, chips
} as const;

/** Soft elevation presets (iOS shadow + Android elevation). */
export const elevation = {
  e1: {
    shadowColor: '#1a1916',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  e2: {
    shadowColor: '#1a1916',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  e3: {
    shadowColor: '#1a1916',
    shadowOpacity: 0.16,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    elevation: 10,
  },
} as const;

export type Colors = typeof colors;

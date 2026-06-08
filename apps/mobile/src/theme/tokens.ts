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
  // `muted` is used for secondary copy & H3 eyebrows — darkened slightly so it
  // clears WCAG AA (~4.7:1) on the parchment bg for low-vision / sunlight use.
  muted: '#615b4e',
  subtle: '#7c7567',
  // Text that sits on a filled colour surface (primary/accent/danger buttons,
  // dark chips). Near-white but warm so it matches the parchment palette.
  onColor: '#fdfcf8',

  // surfaces
  bg: '#f6f3ec',
  bgWarm: '#efeadd',
  surface: '#ffffff',
  surface2: '#f0ecdf',
  // translucent ink for scrims / pressed overlays.
  overlay: 'rgba(26,25,22,0.45)',

  // borders
  border: '#d8d2c2',
  borderSoft: '#e6e0d0',
  borderStrong: '#b8b0a0',
  // hairline for dense lists / dividers.
  hairline: '#e9e3d5',
  // focus / keyboard ring — uses brand green so it reads as intentional.
  focus: '#3f6b4e',

  // brand
  primary: '#3f6b4e', // deep forest/olive green  (oklch .40 .06 145)
  primarySoft: '#e4efe2',
  primaryInk: '#2f5740',
  // pressed shade of primary for tactile button feedback.
  primaryPressed: '#345b41',
  accent: '#bd6a43', // terracotta (oklch .60 .15 45)
  accentSoft: '#f2e7da',
  accentPressed: '#a85a37',

  // signal palette (status) — paired soft tints + a darker "ink" per signal so
  // status text can sit on its own soft chip with strong contrast.
  watering: '#3f78c9', // blue
  wateringSoft: '#e4edf7',
  wateringInk: '#2c5da3',
  healthy: '#3fa564', // green = good
  healthySoft: '#e1f1e7',
  healthyInk: '#2f7d4c',
  dry: '#d9a23b', // amber/sun
  warn: '#c98a1e', // amber = watch  (darkened for AA on light chips)
  warnSoft: '#f6ecd6',
  warnInk: '#9c6c12',
  critical: '#c14a3b', // red = act
  criticalSoft: '#f5e2dd',
  criticalInk: '#9e3527',
  offline: '#7c7567', // grey
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

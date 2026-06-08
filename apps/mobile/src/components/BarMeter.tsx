import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, fonts, radius } from '../theme/tokens';
import { useScale } from '../theme/scale';
import { T } from './ui';

/**
 * Horizontal meter with a fill and an optional target "tick" — the pH/EC/N/P/K
 * bars from the Zone Inspector in the twin. Scale-aware label + value text.
 * An optional `acceptable` band [lo,hi] (0–100) shades the wider tolerance zone
 * behind the fill so stage-aware targets read clearly.
 *
 * Polish: the track grows in field mode (taller bars are easier to read at
 * arm's length), the value column is tabular-aligned mono so digits line up
 * across stacked rows, the acceptable band carries a faint border + the target
 * tick sits above with a soft outline so it reads against any fill colour, and
 * an a11y label voices the label + value.
 */
export function BarMeter({
  label,
  value,
  pct,
  tickPct,
  bandPct,
  color = colors.watering,
}: {
  label: string;
  value: string;
  pct: number; // 0–100 fill
  tickPct?: number; // 0–100 target marker
  bandPct?: [number, number]; // 0–100 acceptable band shading
  color?: string;
}) {
  const { fs, sp } = useScale();
  const clampedPct = Math.max(0, Math.min(100, pct));
  // Keep a sliver of fill visible for tiny-but-nonzero values.
  const fillW = clampedPct > 0 && clampedPct < 2 ? 2 : clampedPct;
  const trackH = sp(11);

  return (
    <View
      style={[s.row, { marginVertical: sp(5) }]}
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${value}`}
    >
      <T variant="label" style={{ width: sp(30) }}>{label}</T>
      <View style={[s.track, { height: trackH }]}>
        {bandPct && (
          <View
            style={[
              s.band,
              {
                left: `${Math.max(0, Math.min(100, bandPct[0]))}%`,
                width: `${Math.max(0, Math.min(100, bandPct[1] - bandPct[0]))}%`,
              },
            ]}
          />
        )}
        <View style={[s.fill, { width: `${fillW}%`, backgroundColor: color }]} />
        {tickPct != null && <View style={[s.tick, { left: `${Math.max(0, Math.min(100, tickPct))}%`, height: trackH + 6 }]} />}
      </View>
      <T
        style={{ fontFamily: fonts.mono, fontSize: fs(13), width: sp(46), textAlign: 'right', color: colors.ink, fontVariant: ['tabular-nums'] }}
      >
        {value}
      </T>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { flex: 1, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: radius.r1, overflow: 'visible', justifyContent: 'center' },
  band: { position: 'absolute', top: 0, bottom: 0, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.r1, opacity: 0.7 },
  fill: { height: '100%', borderRadius: radius.r1 },
  tick: { position: 'absolute', top: -3, width: 3, backgroundColor: colors.ink, borderRadius: 2, borderWidth: 1, borderColor: colors.surface },
});

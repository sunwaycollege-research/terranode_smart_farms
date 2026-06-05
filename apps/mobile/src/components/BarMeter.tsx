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
  const { fs } = useScale();
  return (
    <View style={s.row}>
      <T variant="label" style={{ width: 30 }}>{label}</T>
      <View style={s.track}>
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
        <View style={[s.fill, { width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: color }]} />
        {tickPct != null && <View style={[s.tick, { left: `${Math.max(0, Math.min(100, tickPct))}%` }]} />}
      </View>
      <T style={{ fontFamily: fonts.mono, fontSize: fs(13), width: 46, textAlign: 'right', color: colors.ink }}>{value}</T>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 5 },
  track: { flex: 1, height: 10, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: radius.r1, overflow: 'visible' },
  band: { position: 'absolute', top: 0, bottom: 0, backgroundColor: colors.primarySoft, borderRadius: radius.r1 },
  fill: { height: '100%', borderRadius: radius.r1 },
  tick: { position: 'absolute', top: -3, width: 2, height: 16, backgroundColor: colors.warn, borderRadius: 2 },
});

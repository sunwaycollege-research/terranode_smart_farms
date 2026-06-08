import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { colors, fonts } from '../theme/tokens';
import { useScale } from '../theme/scale';
import { T } from './ui';

/**
 * Circular gauge — the "moisture ring" from the digital twin.
 * Renders an arc proportional to `value` (0–100) in the given color.
 * Scale-aware: the centered number grows in field mode (the SVG diameter is
 * fixed by `size` so the gauge keeps its layout footprint).
 *
 * Polish: a soft tinted track (10% of the arc color) ties each gauge to its
 * status colour, the number uses tabular-aligned mono with a smaller dimmed
 * suffix for a clean readout, and an a11y label voices the value for screen
 * readers. The arc never fully disappears at 0 (a faint cap stays so the gauge
 * still reads as "a ring").
 */
export function GaugeRing({
  value,
  size = 128,
  stroke = 13,
  color = colors.healthy,
  label = 'moisture',
  suffix = '%',
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
  suffix?: string;
}) {
  const { fs } = useScale();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const dash = (pct / 100) * c;
  const numFont = fs(Math.round(size * 0.2));

  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessibilityRole="image"
      accessibilityLabel={`${label}: ${pct.toFixed(0)}${suffix}`}
    >
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} strokeOpacity={0.12} fill="none" />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash}, ${c}`}
            fill="none"
          />
        </G>
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <T
          style={{ fontFamily: fonts.mono, fontSize: numFont, color: colors.ink, fontVariant: ['tabular-nums'], includeFontPadding: false }}
          allowFontScaling={false}
        >
          {pct.toFixed(0)}
          <T style={{ fontFamily: fonts.mono, fontSize: numFont * 0.6, color: colors.muted }}>{suffix}</T>
        </T>
        <T variant="muted" style={{ marginTop: 1, textAlign: 'center' }}>
          {label}
        </T>
      </View>
    </View>
  );
}

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

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surface2} strokeWidth={stroke} fill="none" />
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
        <T style={{ fontFamily: fonts.mono, fontSize: fs(26), color: colors.ink }}>
          {pct.toFixed(0)}
          {suffix}
        </T>
        <T variant="muted">{label}</T>
      </View>
    </View>
  );
}

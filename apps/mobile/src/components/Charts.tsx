import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { colors, fonts } from '../theme/tokens';
import { useScale } from '../theme/scale';
import { T } from './ui';

/* ---------------------------------------------------------------------------
 * Charts — tiny dependency-free SVG primitives for History + Analytics.
 *   <Sparkline values=[...] />        line + soft area fill for telemetry rollups
 *   <BarChart  data=[{label,value}] /> vertical bars for daily usage/yield
 * Both are pure (no animation/state), color-from-token, and scale-aware.
 * ------------------------------------------------------------------------- */

const niceMax = (max: number): number => {
  if (max <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const norm = max / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
};

// ---------------------------------------------------------------------------
// Sparkline — line chart with optional area fill + last-point dot.
// ---------------------------------------------------------------------------
export function Sparkline({
  values,
  width = 280,
  height = 64,
  color = colors.primary,
  fill = true,
  dot = true,
  strokeWidth = 2,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  dot?: boolean;
  strokeWidth?: number;
}) {
  if (values.length === 0) {
    return <View style={{ width, height }} />;
  }

  const pad = strokeWidth + 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const n = values.length;

  const x = (i: number) => pad + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => pad + innerH - ((v - min) / span) * innerH;

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)},${(height - pad).toFixed(1)} L${x(0).toFixed(1)},${(height - pad).toFixed(1)} Z`;
  const gid = `spark-${Math.round(width)}-${Math.round(height)}`;

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.22} />
          <Stop offset="1" stopColor={color} stopOpacity={0.02} />
        </LinearGradient>
      </Defs>
      {fill && <Path d={area} fill={`url(#${gid})`} />}
      <Path d={line} stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {dot && <Circle cx={x(n - 1)} cy={y(values[n - 1])} r={strokeWidth + 1.5} fill={color} />}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// BarChart — vertical bars with value-derived scale + optional axis labels.
// ---------------------------------------------------------------------------
export interface BarDatum {
  label: string;
  value: number;
  /** Per-bar override; defaults to `color`. */
  color?: string;
}

export function BarChart({
  data,
  width = 300,
  height = 140,
  color = colors.watering,
  showLabels = true,
  showValues = false,
  unit = '',
}: {
  data: BarDatum[];
  width?: number;
  height?: number;
  color?: string;
  showLabels?: boolean;
  showValues?: boolean;
  unit?: string;
}) {
  const { fs } = useScale();
  if (data.length === 0) {
    return <View style={{ width, height }} />;
  }

  const labelH = showLabels ? 18 : 0;
  const valueH = showValues ? 16 : 0;
  const chartH = height - labelH - valueH;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const n = data.length;
  const gap = Math.min(10, width / (n * 4));
  const barW = (width - gap * (n - 1)) / n;

  return (
    <View style={{ width }}>
      <View style={{ flexDirection: 'row', height: valueH, justifyContent: showValues ? 'flex-start' : 'center' }}>
        {showValues &&
          data.map((d, i) => (
            <View key={`v${i}`} style={{ width: barW, marginRight: i < n - 1 ? gap : 0, alignItems: 'center' }}>
              <T style={{ fontFamily: fonts.mono, fontSize: fs(9), color: colors.muted }}>{Math.round(d.value)}</T>
            </View>
          ))}
      </View>
      <Svg width={width} height={chartH}>
        {/* baseline */}
        <Rect x={0} y={chartH - 1} width={width} height={1} fill={colors.border} />
        {data.map((d, i) => {
          const h = max > 0 ? Math.max(d.value <= 0 ? 0 : 2, (d.value / max) * (chartH - 2)) : 0;
          const xPos = i * (barW + gap);
          return (
            <Rect
              key={i}
              x={xPos}
              y={chartH - h}
              width={barW}
              height={h}
              rx={Math.min(4, barW / 3)}
              fill={d.color ?? color}
              opacity={0.9}
            />
          );
        })}
      </Svg>
      {showLabels && (
        <View style={{ flexDirection: 'row', height: labelH, marginTop: 2 }}>
          {data.map((d, i) => (
            <View key={`l${i}`} style={{ width: barW, marginRight: i < n - 1 ? gap : 0, alignItems: 'center' }}>
              <T style={{ fontFamily: fonts.mono, fontSize: fs(9), color: colors.muted }} numberOfLines={1}>
                {d.label}
              </T>
            </View>
          ))}
        </View>
      )}
      {unit !== '' && (
        <T variant="muted" style={{ marginTop: 2, alignSelf: 'flex-end', fontSize: fs(10) }}>
          {unit} · max {Math.round(max)}
        </T>
      )}
    </View>
  );
}

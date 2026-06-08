import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { colors, fonts } from '../theme/tokens';
import { useScale } from '../theme/scale';
import { T } from './ui';

/**
 * HealthRing — a 0..100 zone-health ring (companion to GaugeRing, same arc look).
 *
 * Renders a rounded arc proportional to the agronomy `score` with the centered
 * score number underneath an optional label. The color is derived from the
 * score band (icon+colour coding for low-literacy farmers — green=good,
 * amber=watch, red=act):
 *   >= 80  → healthy green
 *   50–79  → amber (dry/warn)
 *   <  50  → critical red
 *
 * Scale-aware: stroke + font scale with field mode unless an explicit `size`/
 * `stroke` is given. Use the small variant (size≈40) for the zone tiles.
 *
 * Polish: the track is a faint tint of the score colour (instead of flat grey)
 * so a glance at the ring reads good/watch/act even before the number; the
 * number is tabular mono and never font-scaled out of its circle; an a11y label
 * voices the score for screen-reader / low-vision farmers.
 */
export function healthColor(score: number): string {
  if (score >= 80) return colors.healthy;
  if (score >= 50) return colors.dry;
  return colors.critical;
}

export function HealthRing({
  score,
  size = 120,
  stroke,
  label,
  showLabel = true,
  trackColor,
  scaleWithField = false,
}: {
  /** 0..100 health score. */
  score: number;
  /** Outer diameter in px. */
  size?: number;
  /** Arc stroke width (defaults to ~11% of size). */
  stroke?: number;
  /** Optional caption under the number (e.g. "Health"). */
  label?: string;
  /** Hide the centered number/label entirely (badge-only ring). */
  showLabel?: boolean;
  /** Override the (otherwise colour-tinted) track. */
  trackColor?: string;
  /** When true the diameter scales up in field mode. */
  scaleWithField?: boolean;
}) {
  const { fs } = useScale();
  const dim = scaleWithField ? fs(size) : size;
  const sw = stroke ?? Math.max(3, Math.round(dim * 0.11));
  const r = (dim - sw) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, Math.round(score)));
  const dash = (pct / 100) * circ;
  const color = healthColor(pct);

  // numeric size: small rings drop the suffix label automatically.
  const numFont = Math.max(11, Math.round(dim * 0.28));
  const small = dim < 64;

  return (
    <View
      style={{ width: dim, height: dim, alignItems: 'center', justifyContent: 'center' }}
      accessibilityRole="image"
      accessibilityLabel={`${label ?? 'Health'}: ${pct}`}
    >
      <Svg width={dim} height={dim}>
        <G rotation={-90} origin={`${dim / 2}, ${dim / 2}`}>
          {trackColor ? (
            <Circle cx={dim / 2} cy={dim / 2} r={r} stroke={trackColor} strokeWidth={sw} fill="none" />
          ) : (
            <Circle cx={dim / 2} cy={dim / 2} r={r} stroke={color} strokeWidth={sw} strokeOpacity={0.14} fill="none" />
          )}
          <Circle
            cx={dim / 2}
            cy={dim / 2}
            r={r}
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeDasharray={`${dash}, ${circ}`}
            fill="none"
          />
        </G>
      </Svg>
      {showLabel && (
        <View style={{ position: 'absolute', alignItems: 'center' }}>
          <T
            style={{ fontFamily: fonts.mono, fontSize: numFont, color, fontVariant: ['tabular-nums'], includeFontPadding: false }}
            allowFontScaling={false}
          >
            {pct}
          </T>
          {!small && label && (
            <T variant="muted" style={{ marginTop: 1 }}>
              {label}
            </T>
          )}
        </View>
      )}
    </View>
  );
}

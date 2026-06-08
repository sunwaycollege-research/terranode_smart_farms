// TERANODE — Water status card (farmer-friendly).
//
// A dead-simple, icon + color coded "Water" card for the customer dashboard.
// It reads the live farm readings + the pump/valve actuator state and tells the
// farmer, in ONE short sentence, what the water is doing right now:
//
//   • Live FLOW (L/min) from the farm-level `flow` channel (YF-S201 meter):
//       "Water flowing: 11 L/min"  /  "No watering right now".
//   • A RED leak / blockage warning when something is ON (pump or a valve) but
//     flow is ~0 — "Pump is on but no water is flowing — check the pump or pipe".
//   • A blue rain note when the `rain` channel is wet — "Raining — watering paused".
//
// Pure presentational: the dashboard derives `flow` / `raining` from
// api.readings(farm.id) and passes the pump/valve state in, so this component
// never talks to the api seam directly. Scale-aware + bilingual throughout.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, fonts, radius, spacing } from '../theme/tokens';
import { useScale } from '../theme/scale';
import { useT } from '../i18n';
import { Card, CardTitle, T } from './ui';

/** Flow at or below this (L/min) counts as "no water moving" (sensor noise floor). */
const FLOW_EPSILON = 0.2;

export function WaterStatus({
  /** Live flow in L/min from the farm-level `flow` reading (null = no flow sensor / no data). */
  flowLpm,
  /** True when the `rain` channel reports rain. */
  raining,
  /** True when the pump (or any valve) is commanded/reported ON. */
  pumpOn,
}: {
  flowLpm: number | null;
  raining: boolean;
  pumpOn: boolean;
}) {
  const { fs } = useScale();
  const { t } = useT();

  const hasFlowSensor = flowLpm != null;
  const flowing = hasFlowSensor && flowLpm > FLOW_EPSILON;
  // Leak / blockage: something is driving water but the meter reads ~0.
  const leak = pumpOn && hasFlowSensor && !flowing;

  // Big headline: icon + plain status, color-coded green (flowing) / grey (idle).
  const headlineColor = flowing ? colors.watering : colors.muted;
  const headlineText = flowing
    ? t('water.flowing', { lpm: formatLpm(flowLpm) })
    : t('water.none');

  return (
    <Card>
      <CardTitle tx="water.title" />

      {/* headline — drop icon + one short sentence */}
      <View style={s.headline} accessibilityRole="text" accessibilityLabel={headlineText}>
        <T style={{ fontSize: fs(34) }} accessibilityElementsHidden importantForAccessibility="no">
          {flowing ? '💧' : '🚰'}
        </T>
        <View style={{ flex: 1 }}>
          <T
            style={{ fontFamily: fonts.uiBold, fontSize: fs(18), color: headlineColor, fontVariant: ['tabular-nums'] }}
          >
            {headlineText}
          </T>
          {hasFlowSensor && flowing && (
            <T variant="muted" tx="water.flowingHint" />
          )}
        </View>
      </View>

      {/* leak / blockage — RED, act now */}
      {leak && (
        <View
          style={[s.note, { backgroundColor: colors.criticalSoft, borderColor: colors.critical, borderLeftWidth: 4 }]}
          accessibilityRole="alert"
        >
          <T style={{ fontSize: fs(22) }} accessibilityElementsHidden importantForAccessibility="no">⚠️</T>
          <T
            style={{ flex: 1, fontFamily: fonts.uiSemibold, fontSize: fs(14), color: colors.critical, lineHeight: fs(19) }}
            tx="water.leak"
          />
        </View>
      )}

      {/* rain — blue, informational */}
      {raining && (
        <View
          style={[s.note, { backgroundColor: colors.wateringSoft, borderColor: colors.watering, borderLeftWidth: 4 }]}
          accessibilityRole="text"
        >
          <T style={{ fontSize: fs(22) }} accessibilityElementsHidden importantForAccessibility="no">🌧️</T>
          <T
            style={{ flex: 1, fontFamily: fonts.uiMedium, fontSize: fs(14), color: colors.watering, lineHeight: fs(19) }}
            tx="water.rain"
          />
        </View>
      )}
    </Card>
  );
}

/** Tidy L/min: one decimal only when it adds information (11 not 11.0; 0.5 stays). */
function formatLpm(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

const s = StyleSheet.create({
  headline: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.r2,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
});

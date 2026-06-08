// TERANODE — Fertilizer plan card.
//
// "What fertilizer should I add right now?" — the single most-asked farmer
// question. Reads the crop + current growth stage and shows the research-backed
// (TNAU / JICA / NAST), stage-aware dose with a low-cost ORGANIC alternative,
// bilingual. The advice comes from the shared agronomy engine (fertilizerPlan),
// so it stays consistent with the cloud + the digital twin.
//
// NOTE: the 7-in-1 probe's raw N/P/K are coarse EC-derived estimates, so this
// schedule — not the raw probe numbers — anchors what to apply (see NutrientCard
// for the "approximate" caveat on the live readings).

import React from 'react';
import { View } from 'react-native';
import { fertilizerPlan } from '@teranode/agronomy';
import type { GrowthStage } from '@teranode/types';
import { Card, CardTitle, T } from './ui';
import { colors, fonts, radius, spacing } from '../theme/tokens';
import { useT } from '../i18n';
import { useScale } from '../theme/scale';

export function FertilizerCard({
  cropId,
  stage,
}: {
  cropId: string | null | undefined;
  stage: GrowthStage | null | undefined;
}) {
  const { lang } = useT();
  const { fs, sp } = useScale();
  if (!cropId || !stage) return null;

  const plan = fertilizerPlan(cropId, stage);
  const ne = lang === 'ne';

  return (
    <Card style={{ gap: sp(spacing.sm) }}>
      <CardTitle tx="fertilizer.title" />
      <T variant="label" style={{ color: colors.primary, fontFamily: fonts.uiSemibold, fontSize: fs(13) }}>
        🧪 {ne ? plan.titleNe : plan.titleEn}
      </T>
      <T style={{ color: colors.ink, lineHeight: fs(20) }}>{ne ? plan.doseNe : plan.doseEn}</T>
      <View
        style={{
          backgroundColor: colors.primarySoft,
          borderRadius: radius.r2,
          borderLeftWidth: 3,
          borderLeftColor: colors.primary,
          padding: sp(spacing.md),
          gap: 3,
        }}
        accessibilityRole="text"
        accessibilityLabel={`${ne ? 'जैविक विकल्प' : 'Organic option'}: ${ne ? plan.organicNe : plan.organicEn}`}
      >
        <T style={{ fontFamily: fonts.uiSemibold, fontSize: fs(12), color: colors.primaryInk }}>
          🌱 {ne ? 'जैविक विकल्प' : 'Organic option'}
        </T>
        <T variant="muted" style={{ lineHeight: fs(18), color: colors.inkSoft }}>
          {ne ? plan.organicNe : plan.organicEn}
        </T>
      </View>
      <T variant="muted" style={{ fontSize: fs(11), lineHeight: fs(16) }}>
        {(ne ? 'स्रोत: ' : 'Guide: ') + plan.source + (ne ? ' · स्थानीय कृषि सेवासँग पुष्टि गर्नुहोस्' : ' · confirm with local extension')}
      </T>
    </Card>
  );
}

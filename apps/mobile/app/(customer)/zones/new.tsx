// app/(customer)/zones/new.tsx — Assign-zone wizard (BUILD-SPEC §7 "Add/assign zone").
//
// A guided three-step flow:
//   1) Pick a crop                  → <CropPicker> (search + category filter + climate-fit hint)
//   2) Set the planting date        → date stepper (+ optional zone name)
//   3) Confirm the ESP32 node       → serial confirm + sensor-channel toggles
//                                      (moisture / ph / ec / n / p / k / soiltemp)
//   submit → api.assignZone(...)    → auto-applies the crop-derived rule
//   then  → success state showing the resulting ideal bands + a link to the new zone.
//
// Everything is localized (useT) and scale-aware (useScale → field mode). The
// screen targets an existing zone id (re-assign) when navigated with ?zoneId, or
// resolves the customer's farm + first zone when opened as a plain "Add zone".

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import type {
  AssignZoneResponse,
  Channel,
  ChannelType,
  CropRef,
  Range,
} from '@teranode/types';
import { currentStage, deriveRule, getCrop } from '@teranode/agronomy';
import { Button, Card, CardTitle, Divider, Pill, Screen, T, Toggle } from '../../../src/components/ui';
import { CropPicker, climateFit } from '../../../src/components/CropPicker';
import { api } from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { useT, type TranslationKey } from '../../../src/i18n';
import { useScale } from '../../../src/theme/scale';
import { colors, elevation, fonts, radius, spacing } from '../../../src/theme/tokens';

/* ---------------------------------------------------------------------------
 * sensor channels offered at bind time (engine key ↔ DB channel_type)
 * ------------------------------------------------------------------------- */

interface ChannelOption {
  /** DB channel_type written to the API (lowercase). */
  type: Extract<ChannelType, 'moisture' | 'ph' | 'ec' | 'n' | 'p' | 'k' | 'soiltemp'>;
  /** Engine channel key (used to read the crop band for the summary). */
  engine: Channel;
  unit: string;
  emoji: string;
  /** Default-on for a soil probe. */
  on: boolean;
}

const CHANNEL_OPTIONS: ChannelOption[] = [
  { type: 'moisture', engine: 'moisture', unit: '%', emoji: '💧', on: true },
  { type: 'ph', engine: 'ph', unit: 'pH', emoji: '⚗️', on: true },
  { type: 'ec', engine: 'ec', unit: 'mS/cm', emoji: '⚡', on: true },
  { type: 'n', engine: 'n', unit: 'mg/kg', emoji: 'N', on: true },
  { type: 'p', engine: 'p', unit: 'mg/kg', emoji: 'P', on: true },
  { type: 'k', engine: 'k', unit: 'mg/kg', emoji: 'K', on: true },
  { type: 'soiltemp', engine: 'soilTemp', unit: '°C', emoji: '🌡️', on: true },
];

/** Localized label for each offered channel (reuses the zone-detail keys). */
const CHANNEL_LABEL: Record<ChannelOption['type'], TranslationKey> = {
  moisture: 'zone.moisture',
  ph: 'zone.ph',
  ec: 'zone.ec',
  n: 'zone.nitrogen',
  p: 'zone.phosphorus',
  k: 'zone.potassium',
  soiltemp: 'zone.soilTemp',
};

/* ---------------------------------------------------------------------------
 * date helpers — a tiny self-contained date stepper (no extra deps)
 * ------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const toISODate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISODate = (s: string): Date => {
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, day ?? 1);
};

function fmtRange([lo, hi]: Range, unit: string): string {
  const f = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return `${f(lo)}–${f(hi)}${unit ? ` ${unit}` : ''}`;
}

/* ---------------------------------------------------------------------------
 * step header (1 · 2 · 3 progress)
 * ------------------------------------------------------------------------- */

function Stepper({ step }: { step: 0 | 1 | 2 }) {
  const { fs, sp } = useScale();
  // Dot + bar scale with field mode so the progress rail stays legible outdoors.
  const dotSize = sp(30);
  const barH = sp(3);
  return (
    <View
      style={[s.stepper, { paddingVertical: sp(spacing.xs) }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: 3, now: step + 1 }}
    >
      {[0, 1, 2].map((i) => {
        const done = i < step;
        const active = i === step;
        return (
          <View key={i} style={s.stepWrap}>
            <View
              style={[
                s.stepDot,
                { width: dotSize, height: dotSize, borderRadius: dotSize / 2 },
                done && { backgroundColor: colors.primary, borderColor: colors.primary, ...elevation.e1 },
                // Active gets a stronger ring + soft fill so the current step pops
                // against the parchment bg in sunlight.
                active && { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primarySoft, ...elevation.e1 },
              ]}
            >
              <T
                style={{
                  fontFamily: active ? fonts.uiSemibold : fonts.mono,
                  fontSize: fs(13),
                  color: done ? colors.onColor : active ? colors.primaryInk : colors.subtle,
                }}
              >
                {done ? '✓' : i + 1}
              </T>
            </View>
            {i < 2 && (
              <View
                style={[
                  s.stepBar,
                  { marginHorizontal: sp(6), height: barH, borderRadius: barH / 2 },
                  i < step && { backgroundColor: colors.primary },
                ]}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

/* ===========================================================================
 * Screen
 * ======================================================================== */

type Step = 0 | 1 | 2;

export default function NewZone() {
  const { session } = useAuth();
  const { t, lang } = useT();
  const { fs, sp, lh, touch } = useScale();
  const params = useLocalSearchParams<{ zoneId?: string; farmId?: string }>();

  // The signed-in customer; everything we load is scoped to this account by the
  // API. We also key any per-account concerns off it so one farmer can never see
  // another customer's data (serials, zones, crops).
  const accountId = session?.account.id ?? null;

  // --- wizard state ---------------------------------------------------------
  const [step, setStep] = useState<Step>(0);
  const [crops, setCrops] = useState<CropRef[]>([]);
  const [cropsLoading, setCropsLoading] = useState(true);
  const [cropsError, setCropsError] = useState<string | null>(null);
  const [crop, setCrop] = useState<CropRef | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [plantISO, setPlantISO] = useState<string>(toISODate(new Date()));
  // No hardcoded serial: the field starts EMPTY and is prefilled from the
  // customer's real gateway (api.gateway(farmId)?.serial) once resolved.
  const [nodeSerial, setNodeSerial] = useState('');
  const [chOn, setChOn] = useState<Record<string, boolean>>(
    Object.fromEntries(CHANNEL_OPTIONS.map((c) => [c.type, c.on])),
  );

  // CREATE mode (no ?zoneId) = the farmer is adding a NEW zone (capped by the
  // zoneNodes entitlement they purchased). ASSIGN mode (?zoneId) = pick a crop
  // for an existing zone (e.g. from the "this zone needs a crop" prompt).
  const isCreate = !params.zoneId;

  // resolved assignment target (existing zone id) + node id
  const [zoneId, setZoneId] = useState<string | null>(params.zoneId ?? null);
  const [nodeId, setNodeId] = useState<string | undefined>(undefined);
  const [farmId, setFarmId] = useState<string | null>(params.farmId ?? null);
  // Zone quota = how many sensor nodes the customer bought (zoneNodes) vs zones used.
  const [zoneCap, setZoneCap] = useState<number | null>(null);
  const [zoneCount, setZoneCount] = useState(0);
  // Whether the customer actually has a farm set up (brand-new accounts
  // can return []). Null = still resolving.
  const [hasFarm, setHasFarm] = useState<boolean | null>(params.zoneId ? true : null);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AssignZoneResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // --- load crops (with its own loading/error so we can offer a Retry) ------
  const loadCrops = useCallback(async () => {
    setCropsLoading(true);
    setCropsError(null);
    try {
      setCrops(await api.crops());
    } catch (e) {
      setCrops([]);
      setCropsError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setCropsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadCrops();
  }, [loadCrops]);

  // --- resolve the farm, node serial + the zone quota -----------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      // ASSIGN mode: an explicit ?zoneId — just pick a crop for that zone.
      if (params.zoneId) {
        setHasFarm(true);
        return;
      }
      // CREATE mode: resolve the farm, count existing zones vs the purchased
      // zoneNodes cap, and prefill the new zone name + the real device serial.
      try {
        const farms = await api.farms();
        const resolvedFarm = params.farmId ?? farms[0]?.id ?? null;
        if (!resolvedFarm) {
          if (alive) setHasFarm(false); // brand-new account: no farm yet
          return;
        }
        const [zs, gateway, ents] = await Promise.all([
          api.zones(resolvedFarm),
          api.gateway(resolvedFarm).catch(() => null),
          api.entitlements().catch(() => null),
        ]);
        if (!alive) return;
        setFarmId(resolvedFarm);
        setHasFarm(true);
        setZoneCount(zs.length);
        const cap = ents && typeof ents.values.zoneNodes === 'number' ? ents.values.zoneNodes : null;
        setZoneCap(cap);
        // Default name for the new zone (farmer can rename); never a hardcoded sample.
        setZoneName((prev) => prev || `Zone ${zs.length + 1}`);
        if (gateway?.serial) setNodeSerial((prev) => prev || gateway.serial);
      } catch {
        if (alive) setHasFarm(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [params.zoneId, params.farmId, accountId]);

  // In create mode, the farmer is out of nodes when zones used ≥ the purchased cap.
  const atCap = isCreate && zoneCap !== null && zoneCount >= zoneCap;

  const fit = crop ? climateFit(crop) : null;
  const enabledChannels = useMemo(
    () => CHANNEL_OPTIONS.filter((c) => chOn[c.type]),
    [chOn],
  );

  // --- ideal-band preview for the success state (from the engine) ----------
  // Uses the full crop (with stages) so the bands match what assignZone derived.
  const summary = useMemo(() => {
    if (!crop) return null;
    const full = getCrop(crop.id);
    if (!full) return null;
    const stageInfo = currentStage(full, plantISO);
    const rule = deriveRule(full, stageInfo.def);
    return { full, stageInfo, rule, band: stageInfo.def.ideal };
  }, [crop, plantISO]);

  const stageLabelKey: Record<string, TranslationKey> = {
    germination: 'stage.germination',
    vegetative: 'stage.vegetative',
    flowering: 'stage.flowering',
    fruiting: 'stage.fruiting',
    harvest: 'stage.harvest',
  };

  // --- actions --------------------------------------------------------------
  function shiftDate(days: number) {
    setPlantISO(toISODate(new Date(fromISODate(plantISO).getTime() + days * DAY_MS)));
  }

  async function submit() {
    if (!crop) return;
    setSubmitting(true);
    setError(null);
    try {
      // CREATE mode: make the new zone first (server enforces the zoneNodes cap),
      // then assign the chosen crop to it. ASSIGN mode: use the existing zone.
      let targetZoneId = zoneId;
      if (isCreate) {
        if (!farmId) {
          setError(t('assign.noFarmBody'));
          setSubmitting(false);
          return;
        }
        const newZone = await api.createZone({
          farmId,
          name: zoneName.trim() || `Zone ${zoneCount + 1}`,
        });
        targetZoneId = newZone.id;
      }
      if (!targetZoneId) {
        setError(t('common.error'));
        setSubmitting(false);
        return;
      }
      const res = await api.assignZone(targetZoneId, {
        cropId: crop.id,
        plantingDate: plantISO,
        nodeId,
        channels: enabledChannels.map((c) => ({ type: c.type, unit: c.unit })),
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSubmitting(false);
    }
  }

  const canNext = step === 0 ? !!crop : true;

  // Plain-language title per step — reuses existing keys so low-literacy farmers
  // always see "Step N of 3 · <what this step is>" under the progress rail.
  const stepTitleKey: Record<Step, TranslationKey> = {
    0: 'assign.pickCrop',
    1: 'assign.plantingDate',
    2: 'assign.bindNode',
  };

  // ==========================================================================
  // SUCCESS STATE
  // ==========================================================================
  if (result) {
    const r = result.rule;
    const band = summary?.band;
    const cropName = crop ? (lang === 'ne' ? crop.nameNe : crop.nameEn) : '';
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: false, title: t('assign.title') }} />
        <View style={[s.successHero, { gap: sp(spacing.sm), paddingVertical: sp(spacing.md) }]}>
          <View style={[s.successBadge, { width: sp(76), height: sp(76), borderRadius: sp(38) }]}>
            <T style={{ fontSize: fs(42) }} accessibilityElementsHidden importantForAccessibility="no">
              {crop?.emoji ?? '🌱'}
            </T>
          </View>
          <T variant="display" style={{ textAlign: 'center' }} accessibilityRole="header">
            {result.zone.name}
          </T>
          <View style={{ flexDirection: 'row', gap: sp(spacing.xs), flexWrap: 'wrap', justifyContent: 'center' }}>
            <Pill label={cropName} color={colors.primary} dot />
            {summary && (
              <Pill
                label={t(stageLabelKey[summary.stageInfo.stage])}
                color={colors.accent}
                dot
              />
            )}
          </View>
          <T variant="muted" style={{ textAlign: 'center' }}>
            {summary
              ? t('zone.dayOf', {
                  day: summary.stageInfo.daysSincePlanting,
                  total: crop?.daysToHarvest ?? 0,
                })
              : ''}
          </T>
        </View>

        {/* derived rule (auto-applied) */}
        <Card style={{ gap: sp(spacing.sm) }}>
          <CardTitle tx="zone.target" />
          <View style={s.bandRow}>
            <T variant="label" tx="zone.moisture" />
            <T variant="mono" style={{ color: colors.watering }}>
              {r.moistureLow}–{r.moistureHigh} %
            </T>
          </View>
          <View style={s.bandRow}>
            <T variant="label" tx="zone.ph" />
            <T variant="mono" style={{ color: colors.accent }}>
              {r.phTarget != null ? `≈ ${r.phTarget}` : '—'}
            </T>
          </View>
          <View style={s.bandRow}>
            <T variant="label" tx="zone.ec" />
            <T variant="mono" style={{ color: colors.primaryInk }}>
              {r.ecTarget != null ? `≈ ${r.ecTarget} mS/cm` : '—'}
            </T>
          </View>
          <Divider style={{ marginTop: sp(spacing.xs) }} />
          <View style={[s.noteRow, { gap: sp(spacing.xs) }]}>
            <T style={{ fontSize: fs(13) }} accessibilityElementsHidden importantForAccessibility="no">
              ✓
            </T>
            <T variant="muted" style={{ flex: 1, color: colors.healthyInk, lineHeight: lh(12) }}>
              {lang === 'ne' ? 'बाली अनुसारको नियम स्वतः लागू भयो।' : 'Crop-derived rule applied automatically.'}
            </T>
          </View>
        </Card>

        {/* full ideal band for this stage */}
        {band && (
          <Card style={{ gap: sp(spacing.sm) }}>
            <CardTitle>{lang === 'ne' ? 'आदर्श दायरा' : 'Ideal bands'}</CardTitle>
            <View style={s.bandRow}>
              <T variant="label" tx="zone.nitrogen" />
              <T variant="mono">{fmtRange(band.n, 'mg/kg')}</T>
            </View>
            <View style={s.bandRow}>
              <T variant="label" tx="zone.phosphorus" />
              <T variant="mono">{fmtRange(band.p, 'mg/kg')}</T>
            </View>
            <View style={s.bandRow}>
              <T variant="label" tx="zone.potassium" />
              <T variant="mono">{fmtRange(band.k, 'mg/kg')}</T>
            </View>
            <View style={s.bandRow}>
              <T variant="label" tx="zone.soilTemp" />
              <T variant="mono">{fmtRange(band.soilTemp, '°C')}</T>
            </View>
            <View style={s.bandRow}>
              <T variant="label" tx="zone.airTemp" />
              <T variant="mono">{fmtRange(band.airTemp, '°C')}</T>
            </View>
            <Divider style={{ marginTop: sp(spacing.xs) }} />
            <View style={[s.bandRow, { paddingTop: sp(spacing.xs) }]}>
              <T variant="muted">{t('assign.channels')}</T>
              <T variant="mono" style={{ color: colors.primaryInk }}>{result.channels.length}</T>
            </View>
          </Card>
        )}

        <Button
          tx="field.health"
          onPress={() => router.replace(`/(customer)/zones/${result.zone.id}` as never)}
        />
        <Button variant="ghost" tx="common.done" onPress={() => router.replace('/(customer)/dashboard' as never)} />
      </Screen>
    );
  }

  // ==========================================================================
  // EMPTY STATE — brand-new account with no farm/zone set up yet.
  // ==========================================================================
  if (hasFarm === false) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: false, title: t('assign.title') }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(spacing.sm) }}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => [
              s.backBtn,
              { width: touch, height: touch },
              pressed && s.backBtnPressed,
              pressed && { transform: [{ scale: 0.96 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <T
              style={{ fontSize: fs(24), lineHeight: fs(24), color: colors.inkSoft, fontFamily: fonts.uiMedium, marginTop: -2 }}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              ‹
            </T>
          </Pressable>
          <T variant="display" tx="assign.title" style={{ flex: 1 }} accessibilityRole="header" />
        </View>
        <Card style={{ gap: sp(spacing.md), alignItems: 'center', paddingVertical: sp(spacing.xl) }}>
          <View style={[s.emptyIcon, { width: sp(64), height: sp(64), borderRadius: sp(32) }]}>
            <T style={{ fontSize: fs(34) }} accessibilityElementsHidden importantForAccessibility="no">🌱</T>
          </View>
          <T variant="h2" style={{ textAlign: 'center' }}>
            {lang === 'ne' ? 'अहिलेसम्म कुनै फार्म सेटअप भएको छैन' : 'No farm set up yet'}
          </T>
          <T variant="body" style={{ textAlign: 'center', color: colors.muted, maxWidth: 300, lineHeight: lh(15) }}>
            {lang === 'ne'
              ? 'तपाईंको खातामा अहिले कुनै क्षेत्र छैन। सेटअप पूरा भएपछि यहाँ बाली असाइन गर्न सकिन्छ।'
              : 'Your account has no zone yet. Once setup is complete you can assign a crop here.'}
          </T>
        </Card>
        <Button variant="ghost" tx="common.done" onPress={() => router.replace('/(customer)/dashboard' as never)} />
      </Screen>
    );
  }

  // ==========================================================================
  // AT CAP — the farmer has used every sensor node they purchased.
  // ==========================================================================
  if (atCap) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: false, title: t('assign.title') }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(spacing.sm) }}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => [s.backBtn, { width: touch, height: touch }, pressed && s.backBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <T style={{ fontSize: fs(20), color: colors.muted }}>‹</T>
          </Pressable>
          <T variant="display" tx="assign.title" style={{ flex: 1 }} accessibilityRole="header" />
        </View>
        <Card style={{ gap: sp(spacing.md), alignItems: 'center', paddingVertical: sp(spacing.xl) }}>
          <View style={[s.emptyIcon, { width: sp(64), height: sp(64), borderRadius: sp(32) }]}>
            <T style={{ fontSize: fs(34) }} accessibilityElementsHidden importantForAccessibility="no">🔌</T>
          </View>
          <T variant="h2" tx="assign.atCapTitle" style={{ textAlign: 'center' }} />
          <T variant="body" style={{ textAlign: 'center', color: colors.muted, maxWidth: 300, lineHeight: lh(15) }}>
            {t('assign.atCapBody', { used: zoneCount, cap: zoneCap ?? 0 })}
          </T>
        </Card>
        <Button variant="ghost" tx="common.done" onPress={() => router.replace('/(customer)/dashboard' as never)} />
      </Screen>
    );
  }

  // ==========================================================================
  // WIZARD
  // ==========================================================================
  return (
    <Screen scroll={step !== 0}>
      <Stack.Screen options={{ headerShown: false, title: t('assign.title') }} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(spacing.sm) }}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => [s.backBtn, { width: touch, height: touch }, pressed && s.backBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <T style={{ fontSize: fs(20), color: colors.muted }}>‹</T>
        </Pressable>
        <T variant="display" tx="assign.title" style={{ flex: 1 }} accessibilityRole="header" />
      </View>

      <Stepper step={step} />
      <T variant="h3" style={{ marginTop: sp(spacing.xs), color: colors.primaryInk }} accessibilityRole="header">
        {`${lang === 'ne' ? `चरण ${step + 1}/3` : `Step ${step + 1} of 3`} · ${t(stepTitleKey[step])}`}
      </T>
      {isCreate && zoneCap !== null && (
        <T variant="muted" style={{ marginTop: 2 }}>
          {t('assign.quota', { used: zoneCount, cap: zoneCap })}
        </T>
      )}

      {/* ----- STEP 1 · pick a crop ----- */}
      {step === 0 && (
        <View style={{ flex: 1, gap: sp(spacing.sm) }}>
          {cropsError ? (
            <Card style={s.errorCard} accessibilityLiveRegion="polite">
              <View style={s.errorRow}>
                <T style={{ fontSize: fs(18) }} accessibilityElementsHidden importantForAccessibility="no">
                  ⚠️
                </T>
                <T style={{ flex: 1, color: colors.criticalInk, fontFamily: fonts.uiMedium, lineHeight: lh(15) }}>
                  {cropsError}
                </T>
              </View>
              <Button variant="ghost" tx="common.retry" small onPress={() => void loadCrops()} />
            </Card>
          ) : (
            <CropPicker
              crops={crops}
              loading={cropsLoading}
              selectedId={crop?.id ?? null}
              onSelect={(c) => {
                setCrop(c);
                setZoneName((prev) => prev || (lang === 'ne' ? c.nameNe : c.nameEn));
              }}
            />
          )}
        </View>
      )}

      {/* ----- STEP 2 · planting date + name ----- */}
      {step === 1 && crop && (
        <View style={{ gap: sp(spacing.md) }}>
          <Card style={{ gap: sp(spacing.sm) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(spacing.md) }}>
              <T style={{ fontSize: fs(30) }} accessibilityElementsHidden importantForAccessibility="no">
                {crop.emoji}
              </T>
              <View style={{ flex: 1 }}>
                <T variant="h2">{lang === 'ne' ? crop.nameNe : crop.nameEn}</T>
                {fit && (
                  <T variant="muted" style={{ marginTop: 2, lineHeight: lh(12) }}>
                    {fit.emoji} {lang === 'ne' ? fit.ne : fit.en}
                  </T>
                )}
              </View>
              <Pill label={`${crop.daysToHarvest} ${t('common.days')}`} color={colors.primaryInk} dot />
            </View>
          </Card>

          <Card style={{ gap: sp(spacing.sm) }}>
            <CardTitle tx="assign.zoneName" />
            <TextInput
              value={zoneName}
              onChangeText={setZoneName}
              placeholder={t('assign.zoneName')}
              placeholderTextColor={colors.subtle}
              style={[s.input, { fontSize: fs(15), minHeight: touch }]}
              accessibilityLabel={t('assign.zoneName')}
            />
          </Card>

          <Card style={{ gap: sp(spacing.sm) }}>
            <CardTitle tx="assign.plantingDate" />
            <View style={[s.dateRow, { gap: sp(spacing.sm) }]}>
              <Pressable
                onPress={() => shiftDate(-1)}
                style={({ pressed }) => [
                  s.dateBtn,
                  { width: touch, height: touch },
                  pressed && s.dateBtnPressed,
                  pressed && { transform: [{ scale: 0.94 }] },
                ]}
                accessibilityRole="button"
                accessibilityLabel={lang === 'ne' ? 'एक दिन घटाउनुहोस्' : 'One day earlier'}
              >
                <T style={{ fontSize: fs(22), color: colors.primary, fontFamily: fonts.uiSemibold }}>−</T>
              </Pressable>
              <View style={{ flex: 1, alignItems: 'center', gap: 2 }} accessibilityRole="text">
                <T variant="mono" style={{ fontSize: fs(18), color: colors.ink, letterSpacing: 0.5 }}>
                  {plantISO}
                </T>
                <T variant="muted">
                  {summary
                    ? t('zone.dayOf', {
                        day: summary.stageInfo.daysSincePlanting,
                        total: crop.daysToHarvest,
                      })
                    : ''}
                </T>
              </View>
              <Pressable
                onPress={() => shiftDate(1)}
                style={({ pressed }) => [
                  s.dateBtn,
                  { width: touch, height: touch },
                  pressed && s.dateBtnPressed,
                  pressed && { transform: [{ scale: 0.94 }] },
                ]}
                accessibilityRole="button"
                accessibilityLabel={lang === 'ne' ? 'एक दिन थप्नुहोस्' : 'One day later'}
              >
                <T style={{ fontSize: fs(22), color: colors.primary, fontFamily: fonts.uiSemibold }}>+</T>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: sp(spacing.xs), flexWrap: 'wrap' }}>
              {[
                { d: 0, en: 'Today', ne: 'आज' },
                { d: -7, en: '1 wk ago', ne: '१ हप्ता' },
                { d: -30, en: '1 mo ago', ne: '१ महिना' },
                { d: -60, en: '2 mo ago', ne: '२ महिना' },
              ].map((q) => {
                const qISO = toISODate(new Date(Date.now() + q.d * DAY_MS));
                const active = qISO === plantISO;
                const label = lang === 'ne' ? q.ne : q.en;
                return (
                  <Pressable
                    key={q.d}
                    onPress={() => setPlantISO(qISO)}
                    style={({ pressed }) => [
                      s.quickChip,
                      { minHeight: Math.max(sp(36), touch - sp(8)) },
                      active && s.quickChipActive,
                      pressed && !active && { backgroundColor: colors.surface2 },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={label}
                  >
                    <T
                      style={{
                        fontFamily: active ? fonts.uiSemibold : fonts.uiMedium,
                        fontSize: fs(12),
                        color: active ? colors.primaryInk : colors.muted,
                      }}
                    >
                      {label}
                    </T>
                  </Pressable>
                );
              })}
            </View>
            {summary && (
              <Pill
                label={`${fit?.emoji ?? ''} ${t(stageLabelKey[summary.stageInfo.stage])}`}
                color={colors.accent}
                dot
              />
            )}
          </Card>
        </View>
      )}

      {/* ----- STEP 3 · node + channels ----- */}
      {step === 2 && crop && (
        <View style={{ gap: sp(spacing.md) }}>
          <Card style={{ gap: sp(spacing.sm) }}>
            <CardTitle tx="assign.bindNode" />
            <View style={[s.nodeRow, { gap: sp(spacing.sm) }]}>
              <T style={{ fontSize: fs(18) }} accessibilityElementsHidden importantForAccessibility="no">
                📡
              </T>
              <TextInput
                value={nodeSerial}
                onChangeText={setNodeSerial}
                placeholder="TN-ESP32-XXXX"
                placeholderTextColor={colors.subtle}
                autoCapitalize="characters"
                autoCorrect={false}
                style={[s.input, { flex: 1, fontSize: fs(15), fontFamily: fonts.mono, minHeight: touch }]}
                accessibilityLabel={t('assign.bindNode')}
              />
            </View>
            <T variant="muted" style={{ lineHeight: lh(12) }}>
              {lang === 'ne'
                ? 'यो क्षेत्रको माटो प्रोब चलाउने ESP32 नोड।'
                : 'The ESP32 node driving this zone’s soil probe.'}
            </T>
          </Card>

          <Card style={{ gap: sp(spacing.xs) }}>
            <CardTitle tx="assign.channels" />
            {CHANNEL_OPTIONS.map((c, i) => {
              const on = !!chOn[c.type];
              const band = summary?.band[c.engine];
              return (
                <React.Fragment key={c.type}>
                  <View
                    style={[s.chRow, { gap: sp(spacing.sm), minHeight: touch }]}
                    accessible
                    accessibilityRole="switch"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={t(CHANNEL_LABEL[c.type])}
                  >
                    <View style={{ width: sp(26), alignItems: 'center' }}>
                      <T
                        style={{
                          fontSize: fs(15),
                          fontFamily: fonts.uiSemibold,
                          color: on ? colors.primaryInk : colors.subtle,
                        }}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      >
                        {c.emoji}
                      </T>
                    </View>
                    <View style={{ flex: 1 }}>
                      <T variant="label" tx={CHANNEL_LABEL[c.type]} style={{ color: on ? colors.ink : colors.muted }} />
                      {band && on && (
                        <T variant="muted" style={{ color: colors.healthyInk, marginTop: 1 }}>
                          {fmtRange(band, c.unit)}
                        </T>
                      )}
                    </View>
                    <Toggle value={on} onChange={(v) => setChOn((m) => ({ ...m, [c.type]: v }))} />
                  </View>
                  {i < CHANNEL_OPTIONS.length - 1 && <Divider />}
                </React.Fragment>
              );
            })}
            <Divider style={{ marginTop: sp(spacing.xs) }} />
            <View style={[s.bandRow, { paddingTop: sp(spacing.xs) }]}>
              <T variant="muted">{t('assign.channels').toLowerCase()}</T>
              <T variant="mono" style={{ color: colors.primaryInk }}>
                {enabledChannels.length} / {CHANNEL_OPTIONS.length}
              </T>
            </View>
          </Card>
        </View>
      )}

      {/* ----- footer nav ----- */}
      {error && (
        <Card style={s.errorCard} accessibilityLiveRegion="polite">
          <View style={s.errorRow}>
            <T style={{ fontSize: fs(18) }} accessibilityElementsHidden importantForAccessibility="no">
              ⚠️
            </T>
            <T style={{ flex: 1, color: colors.criticalInk, fontFamily: fonts.uiMedium, lineHeight: lh(15) }}>
              {error}
            </T>
          </View>
        </Card>
      )}

      <View style={{ flexDirection: 'row', gap: sp(spacing.sm), marginTop: sp(spacing.sm) }}>
        {step > 0 && (
          <View style={{ flex: 1 }}>
            <Button variant="ghost" tx="common.back" onPress={() => setStep((step - 1) as Step)} />
          </View>
        )}
        <View style={{ flex: 2 }}>
          {step < 2 ? (
            <Button tx="common.next" disabled={!canNext} onPress={() => canNext && setStep((step + 1) as Step)} />
          ) : submitting ? (
            <View
              style={[s.submittingBtn, { minHeight: touch }]}
              accessibilityRole="progressbar"
              accessibilityLabel={t('common.saving')}
            >
              <ActivityIndicator color={colors.onColor} />
              <T style={{ color: colors.onColor, fontFamily: fonts.uiSemibold, fontSize: fs(15), letterSpacing: 0.2 }}>
                {t('common.saving')}
              </T>
            </View>
          ) : (
            <Button tx="assign.create" disabled={!crop} onPress={submit} />
          )}
        </View>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.r2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  backBtnPressed: { backgroundColor: colors.bgWarm, borderColor: colors.muted },
  emptyIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  errorCard: { borderColor: colors.critical, backgroundColor: colors.criticalSoft, gap: spacing.sm },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // stepper
  stepper: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  stepWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBar: { flex: 1, height: 2, backgroundColor: colors.border, marginHorizontal: 6 },
  // inputs
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.r2,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontFamily: fonts.ui,
    color: colors.ink,
  },
  // date stepper
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dateBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.r2,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateBtnPressed: { opacity: 0.6, backgroundColor: colors.bgWarm },
  quickChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickChipActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  // node
  nodeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // channels — rows are separated by <Divider/>, so no per-row border here.
  chRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
  },
  // success
  successHero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  successBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
    ...elevation.e1,
  },
  bandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  noteRow: { flexDirection: 'row', alignItems: 'center' },
  submittingBtn: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.r2,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
});

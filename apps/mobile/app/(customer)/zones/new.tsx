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

import React, { useEffect, useMemo, useState } from 'react';
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
import { Button, Card, CardTitle, Pill, Screen, T, Toggle } from '../../../src/components/ui';
import { CropPicker, climateFit } from '../../../src/components/CropPicker';
import { api } from '../../../src/api/client';
import { useT, type TranslationKey } from '../../../src/i18n';
import { useScale } from '../../../src/theme/scale';
import { colors, fonts, radius, spacing } from '../../../src/theme/tokens';

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
  const { fs } = useScale();
  return (
    <View style={s.stepper}>
      {[0, 1, 2].map((i) => {
        const done = i < step;
        const active = i === step;
        return (
          <View key={i} style={s.stepWrap}>
            <View
              style={[
                s.stepDot,
                done && { backgroundColor: colors.primary, borderColor: colors.primary },
                active && { borderColor: colors.primary },
              ]}
            >
              <T
                style={{
                  fontFamily: fonts.mono,
                  fontSize: fs(12),
                  color: done ? '#fff' : active ? colors.primary : colors.subtle,
                }}
              >
                {done ? '✓' : i + 1}
              </T>
            </View>
            {i < 2 && <View style={[s.stepBar, i < step && { backgroundColor: colors.primary }]} />}
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
  const { t, lang } = useT();
  const { fs, sp } = useScale();
  const params = useLocalSearchParams<{ zoneId?: string; farmId?: string }>();

  // --- wizard state ---------------------------------------------------------
  const [step, setStep] = useState<Step>(0);
  const [crops, setCrops] = useState<CropRef[]>([]);
  const [cropsLoading, setCropsLoading] = useState(true);
  const [crop, setCrop] = useState<CropRef | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [plantISO, setPlantISO] = useState<string>(toISODate(new Date()));
  const [nodeSerial, setNodeSerial] = useState('TN-ESP32-0001 · node-A');
  const [chOn, setChOn] = useState<Record<string, boolean>>(
    Object.fromEntries(CHANNEL_OPTIONS.map((c) => [c.type, c.on])),
  );

  // resolved assignment target (existing zone id) + node id
  const [zoneId, setZoneId] = useState<string | null>(params.zoneId ?? null);
  const [nodeId, setNodeId] = useState<string | undefined>(undefined);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AssignZoneResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // --- load crops + resolve the target zone/node ---------------------------
  useEffect(() => {
    (async () => {
      try {
        const list = await api.crops();
        setCrops(list);
      } catch {
        setCrops([]);
      } finally {
        setCropsLoading(false);
      }
      // Resolve a target zone when none was passed in: first farm → first zone.
      try {
        if (!params.zoneId) {
          const farms = await api.farms();
          const farmId = params.farmId ?? farms[0]?.id;
          if (farmId) {
            const zs = await api.zones(farmId);
            const target = zs[0];
            if (target) {
              setZoneId(target.id);
              setZoneName((prev) => prev || target.name);
              if (target.nodeId) setNodeId(target.nodeId);
            }
          }
        }
      } catch {
        /* leave unresolved; submit will surface a friendly error */
      }
    })();
  }, [params.zoneId, params.farmId]);

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
    if (!zoneId) {
      setError(t('common.error'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.assignZone(zoneId, {
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
        <View style={s.successHero}>
          <T style={{ fontSize: fs(46) }}>{crop?.emoji ?? '🌱'}</T>
          <T variant="display" style={{ textAlign: 'center' }}>
            {result.zone.name}
          </T>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
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
          <T variant="muted" style={{ marginTop: 4 }}>
            {lang === 'ne' ? 'बाली अनुसारको नियम स्वतः लागू भयो।' : 'Crop-derived rule applied automatically.'}
          </T>
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
            <View style={[s.bandRow, { borderTopWidth: 1, borderTopColor: colors.borderSoft, paddingTop: 8 }]}>
              <T variant="muted">{t('assign.channels')}</T>
              <T variant="muted">{result.channels.length}</T>
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
  // WIZARD
  // ==========================================================================
  return (
    <Screen scroll={step !== 0}>
      <Stack.Screen options={{ headerShown: false, title: t('assign.title') }} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
          <T style={{ fontSize: fs(18), color: colors.muted }}>‹</T>
        </Pressable>
        <T variant="display" tx="assign.title" style={{ flex: 1 }} />
      </View>

      <Stepper step={step} />

      {/* ----- STEP 1 · pick a crop ----- */}
      {step === 0 && (
        <View style={{ flex: 1, gap: sp(spacing.sm) }}>
          <T variant="h3" tx="assign.pickCrop" />
          <CropPicker
            crops={crops}
            loading={cropsLoading}
            selectedId={crop?.id ?? null}
            onSelect={(c) => {
              setCrop(c);
              setZoneName((prev) => prev || (lang === 'ne' ? c.nameNe : c.nameEn));
            }}
          />
        </View>
      )}

      {/* ----- STEP 2 · planting date + name ----- */}
      {step === 1 && crop && (
        <View style={{ gap: sp(spacing.md) }}>
          <Card style={{ gap: sp(spacing.sm) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <T style={{ fontSize: fs(30) }}>{crop.emoji}</T>
              <View style={{ flex: 1 }}>
                <T variant="h2">{lang === 'ne' ? crop.nameNe : crop.nameEn}</T>
                {fit && (
                  <T variant="muted">
                    {fit.emoji} {lang === 'ne' ? fit.ne : fit.en}
                  </T>
                )}
              </View>
              <Pill label={`${crop.daysToHarvest} ${t('common.days')}`} color={colors.primaryInk} />
            </View>
          </Card>

          <Card style={{ gap: sp(spacing.sm) }}>
            <CardTitle tx="assign.zoneName" />
            <TextInput
              value={zoneName}
              onChangeText={setZoneName}
              placeholder={t('assign.zoneName')}
              placeholderTextColor={colors.subtle}
              style={[s.input, { fontSize: fs(15) }]}
            />
          </Card>

          <Card style={{ gap: sp(spacing.sm) }}>
            <CardTitle tx="assign.plantingDate" />
            <View style={s.dateRow}>
              <Pressable onPress={() => shiftDate(-1)} style={s.dateBtn}>
                <T style={{ fontSize: fs(18), color: colors.primary }}>−</T>
              </Pressable>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <T variant="mono" style={{ fontSize: fs(18), color: colors.ink }}>
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
              <Pressable onPress={() => shiftDate(1)} style={s.dateBtn}>
                <T style={{ fontSize: fs(18), color: colors.primary }}>+</T>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {[
                { d: 0, en: 'Today', ne: 'आज' },
                { d: -7, en: '1 wk ago', ne: '१ हप्ता' },
                { d: -30, en: '1 mo ago', ne: '१ महिना' },
                { d: -60, en: '2 mo ago', ne: '२ महिना' },
              ].map((q) => (
                <Pressable
                  key={q.d}
                  onPress={() => setPlantISO(toISODate(new Date(Date.now() + q.d * DAY_MS)))}
                  style={s.quickChip}
                >
                  <T style={{ fontFamily: fonts.uiMedium, fontSize: fs(12), color: colors.muted }}>
                    {lang === 'ne' ? q.ne : q.en}
                  </T>
                </Pressable>
              ))}
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
            <View style={s.nodeRow}>
              <T style={{ fontSize: fs(18) }}>📡</T>
              <TextInput
                value={nodeSerial}
                onChangeText={setNodeSerial}
                placeholder="TN-ESP32-XXXX"
                placeholderTextColor={colors.subtle}
                autoCapitalize="characters"
                autoCorrect={false}
                style={[s.input, { flex: 1, fontSize: fs(15), fontFamily: fonts.mono }]}
              />
            </View>
            <T variant="muted">
              {lang === 'ne'
                ? 'यो क्षेत्रको माटो प्रोब चलाउने ESP32 नोड।'
                : 'The ESP32 node driving this zone’s soil probe.'}
            </T>
          </Card>

          <Card style={{ gap: sp(spacing.sm) }}>
            <CardTitle tx="assign.channels" />
            {CHANNEL_OPTIONS.map((c) => {
              const on = !!chOn[c.type];
              const band = summary?.band[c.engine];
              return (
                <View key={c.type} style={s.chRow}>
                  <View style={{ width: 26, alignItems: 'center' }}>
                    <T style={{ fontSize: fs(15), color: colors.muted }}>{c.emoji}</T>
                  </View>
                  <View style={{ flex: 1 }}>
                    <T variant="label" tx={CHANNEL_LABEL[c.type]} style={{ color: colors.ink }} />
                    {band && on && <T variant="muted">{fmtRange(band, c.unit)}</T>}
                  </View>
                  <Toggle value={on} onChange={(v) => setChOn((m) => ({ ...m, [c.type]: v }))} />
                </View>
              );
            })}
            <T variant="muted" style={{ marginTop: 2 }}>
              {enabledChannels.length} {t('assign.channels').toLowerCase()}
            </T>
          </Card>
        </View>
      )}

      {/* ----- footer nav ----- */}
      {error && (
        <Card style={{ borderColor: colors.critical, backgroundColor: colors.criticalSoft }}>
          <T style={{ color: colors.critical, fontFamily: fonts.uiMedium }}>{error}</T>
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
            <View style={s.submittingBtn}>
              <ActivityIndicator color="#fff" />
              <T style={{ color: '#fff', fontFamily: fonts.uiSemibold, fontSize: fs(15) }}>{t('common.saving')}</T>
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
  quickChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  // node
  nodeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // channels
  chRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSoft,
  },
  // success
  successHero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  bandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Share, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button, Card, CardTitle, Divider, EmptyState, Loading, Pill, Screen, T } from '../../src/components/ui';
import { BarChart, type BarDatum } from '../../src/components/Charts';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { useT, type TranslationKey } from '../../src/i18n';
import { useScale } from '../../src/theme/scale';
import { colors, fonts, radius, spacing } from '../../src/theme/tokens';
import { getCrop } from '@teranode/agronomy';
import type { Farm, HarvestLog, SavingsResponse, UsageBucket, ZoneWithCrop } from '@teranode/types';

// ---------------------------------------------------------------------------
// Analytics — water/fertilizer usage charts, savings vs baseline, harvest log
// with an add form, and a CSV share. Everything flows through api.* so the
// Phase-6 cutover is a flag flip; charts reuse the dependency-free Charts SVGs.
// ---------------------------------------------------------------------------

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** Sum the daily buckets of one usage kind into a per-day [date → total] series. */
function dailySeries(buckets: UsageBucket[], kind: string): { date: string; total: number }[] {
  const byDate = new Map<string, number>();
  for (const b of buckets) {
    if (b.kind !== kind) continue;
    byDate.set(b.bucket, (byDate.get(b.bucket) ?? 0) + b.total);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, total]) => ({ date, total: Math.round(total) }));
}

/** Short "DD/M" axis label from an ISO date (locale-neutral, fits the tiny axis). */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

/** Everything the screen renders, snapshotted so it can be cached per-account. */
interface AnalyticsData {
  farm: Farm | null;
  zones: ZoneWithCrop[];
  buckets: UsageBucket[];
  savings: SavingsResponse | null;
  harvest: HarvestLog[];
}

const EMPTY: AnalyticsData = { farm: null, zones: [], buckets: [], savings: null, harvest: [] };

export default function Analytics() {
  const { session } = useAuth();
  const { t, lang } = useT();
  const { fs, sp, lh, touch } = useScale();

  // Per-account cache key — NEVER global, so one farmer can never see another
  // account's cached analytics on a cold start. Falls back to a stable suffix
  // before the session resolves.
  const cacheKey = `teranode.analytics.${session?.account.id ?? 'anon'}`;

  const [data, setData] = useState<AnalyticsData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const hydrated = useRef(false);

  // -- harvest add-form state ------------------------------------------------
  const [showForm, setShowForm] = useState(false);
  const [formZone, setFormZone] = useState<string>('');
  const [formYield, setFormYield] = useState('');
  const [formDate, setFormDate] = useState(todayIso());
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const { farm, zones, buckets, savings, harvest } = data;

  const load = useCallback(async () => {
    setError(false);
    try {
      const farms = await api.farms();
      const f = farms[0] ?? null;
      if (!f) {
        const next = EMPTY;
        setData(next);
        await AsyncStorage.setItem(cacheKey, JSON.stringify(next)).catch(() => {});
        return;
      }
      const [zs, usage, sav, hv] = await Promise.all([
        api.zones(f.id),
        api.analyticsUsage(f.id, '1d'),
        api.analyticsSavings(f.id),
        api.harvest({ farmId: f.id }),
      ]);
      const next: AnalyticsData = { farm: f, zones: zs, buckets: usage.buckets, savings: sav, harvest: hv };
      setData(next);
      setFormZone((prev) => (prev && zs.some((z) => z.id === prev) ? prev : (zs[0]?.id ?? '')));
      await AsyncStorage.setItem(cacheKey, JSON.stringify(next)).catch(() => {});
    } catch {
      // Network/offline: fall back to this account's cached snapshot if present,
      // otherwise surface a retryable error.
      let restored = false;
      try {
        const raw = await AsyncStorage.getItem(cacheKey);
        if (raw) {
          setData(JSON.parse(raw) as AnalyticsData);
          restored = true;
        }
      } catch {
        /* ignore */
      }
      if (!restored) setError(true);
    } finally {
      hydrated.current = true;
      setLoading(false);
    }
  }, [cacheKey]);

  useEffect(() => {
    // Reset to a clean slate whenever the account changes so stale account data
    // never flashes before the new account's data loads.
    hydrated.current = false;
    setData(EMPTY);
    setLoading(true);
    setError(false);
    void load();
  }, [load]);

  const onRetry = useCallback(() => {
    setLoading(true);
    void load();
  }, [load]);

  const water = useMemo(() => dailySeries(buckets, 'water_liters'), [buckets]);
  const fertilizer = useMemo(() => dailySeries(buckets, 'fertilizer_ml'), [buckets]);

  // keep the bars readable: show the most recent ~10 days.
  const waterBars: BarDatum[] = water.slice(-10).map((d) => ({ label: dayLabel(d.date), value: d.total }));
  const fertBars: BarDatum[] = fertilizer.slice(-10).map((d) => ({ label: dayLabel(d.date), value: d.total, color: colors.accent }));

  const zoneName = useCallback(
    (zoneId: string | null): string => {
      const z = zones.find((zz) => zz.id === zoneId);
      return z?.name ?? zoneId ?? '—';
    },
    [zones]
  );

  const cropEmoji = useCallback((cropId: string): string => getCrop(cropId)?.emoji ?? '🌱', []);
  const cropName = useCallback(
    (cropId: string): string => {
      const c = getCrop(cropId);
      if (!c) return cropId;
      return lang === 'ne' ? c.nameNe : c.nameEn;
    },
    [lang]
  );

  async function submitHarvest() {
    if (!formZone) return;
    setSaving(true);
    try {
      await api.addHarvest({
        zoneId: formZone,
        harvestedAt: formDate || todayIso(),
        yieldKg: formYield ? Number(formYield) : undefined,
        notes: formNotes || undefined,
      });
      setFormYield('');
      setFormNotes('');
      setFormDate(todayIso());
      setShowForm(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function shareCsv() {
    if (!farm) return;
    const csv = await api.analyticsExportCsv(farm.id);
    try {
      await Share.share({
        title: `${farm.name} — ${t('analytics.title')}`,
        message: csv,
      });
    } catch {
      // user dismissed the share sheet — no-op.
    }
  }

  const inputStyle = {
    fontFamily: fonts.ui,
    fontSize: fs(15),
    lineHeight: lh(15), // keeps the typed value from clipping in field mode
    color: colors.ink,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.r2,
    paddingHorizontal: sp(spacing.md),
    paddingVertical: sp(spacing.sm),
    minHeight: touch, // ≥44px tap target for imprecise field taps
  };

  // -- branch: loading (first paint, nothing cached) ------------------------
  if (loading && !hydrated.current) {
    return (
      <Screen>
        <T variant="display" tx="analytics.title" />
        <Loading />
      </Screen>
    );
  }

  // -- branch: error (network failed, no cache to fall back to) -------------
  if (error) {
    return (
      <Screen>
        <T variant="display" tx="analytics.title" />
        <Card style={{ gap: sp(spacing.md), alignItems: 'center' }}>
          <View
            style={{
              width: sp(56),
              height: sp(56),
              borderRadius: sp(28),
              backgroundColor: colors.criticalSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <T style={{ fontSize: fs(30) }}>⚠️</T>
          </View>
          <T variant="body" tx="common.error" style={{ textAlign: 'center', color: colors.muted, maxWidth: sp(280) }} />
          <View style={{ alignSelf: 'stretch' }}>
            <Button tx="common.retry" onPress={onRetry} />
          </View>
        </Card>
      </Screen>
    );
  }

  // -- branch: no farm set up for this account ------------------------------
  if (!farm) {
    return (
      <Screen>
        <T variant="display" tx="analytics.title" />
        <EmptyState icon="🌱" tx="analytics.noFarm" />
      </Screen>
    );
  }

  return (
    <Screen>
      <T variant="display" tx="analytics.title" accessibilityRole="header" />
      <View style={{ flexDirection: 'row', gap: sp(spacing.sm), flexWrap: 'wrap', marginTop: -sp(4) }}>
        <Pill label={farm.name} color={colors.primary} dot />
      </View>

      {/* -- savings vs baseline -------------------------------------------- */}
      {savings ? (
        <Card style={{ gap: sp(spacing.md) }}>
          <CardTitle tx="analytics.savings" />
          {/* Hero metric: green = good. Read out as one phrase for screen readers. */}
          <View
            style={{ flexDirection: 'row', alignItems: 'flex-end', gap: sp(spacing.sm) }}
            accessible
            accessibilityRole="text"
            accessibilityLabel={`${savings.savedPct}% ${t('analytics.saved')}`}
          >
            <T style={{ fontFamily: fonts.mono, fontSize: fs(44), color: colors.healthyInk, lineHeight: lh(44, true), fontVariant: ['tabular-nums'] }}>
              {savings.savedPct}%
            </T>
            <T variant="label" tx="analytics.saved" style={{ marginBottom: sp(spacing.sm), color: colors.healthyInk }} />
          </View>
          <View
            style={{
              height: sp(12),
              borderRadius: radius.pill,
              backgroundColor: colors.surface2,
              borderWidth: 1,
              borderColor: colors.borderSoft,
              overflow: 'hidden',
            }}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(Math.min(100, savings.savedPct)) }}
          >
            <View
              style={{
                width: `${Math.min(100, Math.max(0, savings.savedPct))}%`,
                height: '100%',
                borderRadius: radius.pill,
                backgroundColor: colors.healthy,
              }}
            />
          </View>
          <Divider style={{ marginTop: sp(spacing.xs) }} />
          <View style={{ flexDirection: 'row', gap: sp(spacing.sm) }}>
            <Stat label={t('analytics.water')} value={`${Math.round(savings.waterUsedL)} ${t('common.liters')}`} />
            {/* TODO(i18n): add `analytics.baseline` key, then swap this literal. */}
            <Stat label="Baseline" value={`${Math.round(savings.baselineL)} ${t('common.liters')}`} />
            <Stat label={t('analytics.saved')} value={`${Math.round(savings.savedL)} ${t('common.liters')}`} accent />
          </View>
        </Card>
      ) : (
        <Card style={{ gap: sp(spacing.sm) }}>
          <CardTitle tx="analytics.savings" />
          <T variant="muted" tx="analytics.noUsage" />
        </Card>
      )}

      {/* -- water usage ---------------------------------------------------- */}
      <Card>
        <ChartTitle tx="analytics.water" swatch={colors.watering} />
        {waterBars.length ? (
          <View style={{ alignItems: 'center' }}>
            <BarChart data={waterBars} width={sp(300)} height={sp(150)} color={colors.watering} showValues unit={t('common.liters')} />
          </View>
        ) : (
          <T variant="muted" tx="analytics.noData" />
        )}
      </Card>

      {/* -- fertilizer usage ---------------------------------------------- */}
      <Card>
        <ChartTitle tx="analytics.fertilizer" swatch={colors.accent} />
        {fertBars.length ? (
          <View style={{ alignItems: 'center' }}>
            <BarChart data={fertBars} width={sp(300)} height={sp(150)} color={colors.accent} showValues unit="mL" />
          </View>
        ) : (
          <T variant="muted" tx="analytics.noData" />
        )}
      </Card>

      {/* -- harvest / yield log + add form -------------------------------- */}
      <Card style={{ gap: sp(spacing.md) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(spacing.sm) }}>
          <CardTitle tx="analytics.harvest" />
          <View style={{ flex: 1 }} />
          <Button small variant={showForm ? 'ghost' : 'primary'} title={showForm ? t('common.cancel') : '＋'} onPress={() => setShowForm((v) => !v)} />
        </View>

        {showForm && (
          <View style={{ gap: sp(spacing.md), paddingBottom: sp(spacing.md), borderBottomWidth: 1, borderBottomColor: colors.borderSoft }}>
            {zones.length > 0 && (
              <View>
                <T variant="label" tx="field.zones" style={{ marginBottom: sp(spacing.xs) }} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(spacing.sm) }} accessibilityRole="radiogroup">
                  {zones.map((z) => {
                    const active = z.id === formZone;
                    return (
                      <Pressable
                        key={z.id}
                        onPress={() => setFormZone(z.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={z.name}
                        style={({ pressed }) => ({
                          minHeight: touch,
                          justifyContent: 'center',
                          paddingHorizontal: sp(spacing.md),
                          paddingVertical: sp(spacing.sm),
                          borderRadius: radius.pill,
                          borderWidth: active ? 1.5 : 1,
                          borderColor: active ? colors.primary : colors.border,
                          backgroundColor: active ? colors.primarySoft : pressed ? colors.bgWarm : colors.surface,
                        })}
                      >
                        <T style={{ fontFamily: active ? fonts.uiSemibold : fonts.uiMedium, fontSize: fs(13), lineHeight: lh(13), color: active ? colors.primaryInk : colors.inkSoft }}>
                          {z.crop ? `${z.crop.emoji} ` : ''}
                          {z.name}
                        </T>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: sp(spacing.sm) }}>
              <View style={{ flex: 1 }}>
                <T variant="label" tx="analytics.yield" style={{ marginBottom: sp(spacing.xs) }} />
                <TextInput
                  value={formYield}
                  onChangeText={setFormYield}
                  keyboardType="numeric"
                  placeholder={t('common.kg')}
                  placeholderTextColor={colors.subtle}
                  accessibilityLabel={t('analytics.yield')}
                  style={inputStyle}
                />
              </View>
              <View style={{ flex: 1 }}>
                <T variant="label" tx="assign.plantingDate" style={{ marginBottom: sp(spacing.xs) }} />
                <TextInput
                  value={formDate}
                  onChangeText={setFormDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.subtle}
                  autoCapitalize="none"
                  accessibilityLabel={t('assign.plantingDate')}
                  style={inputStyle}
                />
              </View>
            </View>
            <TextInput
              value={formNotes}
              onChangeText={setFormNotes}
              placeholder={t('zone.coach')}
              placeholderTextColor={colors.subtle}
              accessibilityLabel={t('zone.coach')}
              style={inputStyle}
            />
            <Button
              title={saving ? t('common.saving') : t('common.save')}
              disabled={saving || !formZone}
              onPress={submitHarvest}
            />
          </View>
        )}

        {harvest.length === 0 ? (
          <T variant="muted" tx="analytics.noData" />
        ) : (
          harvest.map((h, i) => (
            <View key={h.id}>
              {i > 0 && <Divider />}
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp(spacing.md), paddingVertical: sp(spacing.sm), minHeight: touch }}
                accessible
                accessibilityRole="text"
                accessibilityLabel={`${cropName(h.cropId)}, ${zoneName(h.zoneId)}, ${h.harvestedAt}${h.yieldKg != null ? `, ${h.yieldKg} ${t('common.kg')}` : ''}${h.notes ? `, ${h.notes}` : ''}`}
              >
                <T style={{ fontSize: fs(22), lineHeight: lh(22, true) }}>{cropEmoji(h.cropId)}</T>
                <View style={{ flex: 1, gap: sp(spacing.xs) }}>
                  <T numberOfLines={1} style={{ fontFamily: fonts.uiMedium, color: colors.ink, fontSize: fs(15), lineHeight: lh(15) }}>
                    {cropName(h.cropId)} · {zoneName(h.zoneId)}
                  </T>
                  <T variant="muted" style={{ fontSize: fs(12), lineHeight: lh(12) }}>
                    {h.harvestedAt}
                    {h.notes ? ` — ${h.notes}` : ''}
                  </T>
                </View>
                {h.yieldKg != null && (
                  <Pill label={`${h.yieldKg} ${t('common.kg')}`} color={colors.healthyInk} dot />
                )}
              </View>
            </View>
          ))
        )}
      </Card>

      {/* -- CSV export / share -------------------------------------------- */}
      <Button title={t('analytics.export')} variant="ghost" onPress={shareCsv} disabled={!farm} />
    </Screen>
  );
}

/** A CardTitle with a leading colour swatch that matches the chart's bars, so the
 *  colour coding is self-explanatory (helps low-literacy / glance reading). */
function ChartTitle({ tx, swatch }: { tx: TranslationKey; swatch: string }) {
  const { fs, sp } = useScale();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(spacing.sm), marginBottom: sp(spacing.sm) }}>
      <View style={{ width: sp(10), height: sp(10), borderRadius: sp(3), backgroundColor: swatch }} />
      <T variant="h3" tx={tx} accessibilityRole="header" style={{ marginBottom: 0, fontSize: fs(11) }} />
    </View>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  const { fs, sp } = useScale();
  // Equal-width columns keep the three figures aligned no matter the label length;
  // the "saved" figure is colour-coded green (= good) for at-a-glance scanning.
  return (
    <View style={{ flex: 1, gap: sp(spacing.xs) }}>
      <T variant="muted" numberOfLines={1} style={{ fontSize: fs(10), textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {label}
      </T>
      <T
        style={{
          fontFamily: fonts.mono,
          fontSize: fs(15),
          color: accent ? colors.healthyInk : colors.ink,
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </T>
    </View>
  );
}

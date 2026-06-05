import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Share, TextInput, View } from 'react-native';
import { Button, Card, CardTitle, Pill, Screen, T } from '../../src/components/ui';
import { BarChart, type BarDatum } from '../../src/components/Charts';
import { api } from '../../src/api/client';
import { useT } from '../../src/i18n';
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

export default function Analytics() {
  const { t, lang } = useT();
  const { fs, sp } = useScale();

  const [farm, setFarm] = useState<Farm | null>(null);
  const [zones, setZones] = useState<ZoneWithCrop[]>([]);
  const [buckets, setBuckets] = useState<UsageBucket[]>([]);
  const [savings, setSavings] = useState<SavingsResponse | null>(null);
  const [harvest, setHarvest] = useState<HarvestLog[]>([]);

  // -- harvest add-form state ------------------------------------------------
  const [showForm, setShowForm] = useState(false);
  const [formZone, setFormZone] = useState<string>('');
  const [formYield, setFormYield] = useState('');
  const [formDate, setFormDate] = useState(todayIso());
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const farms = await api.farms();
    const f = farms[0] ?? null;
    setFarm(f);
    if (!f) return;
    const [zs, usage, sav, hv] = await Promise.all([
      api.zones(f.id),
      api.analyticsUsage(f.id, '1d'),
      api.analyticsSavings(f.id),
      api.harvest({ farmId: f.id }),
    ]);
    setZones(zs);
    setBuckets(usage.buckets);
    setSavings(sav);
    setHarvest(hv);
    if (!formZone && zs[0]) setFormZone(zs[0].id);
  }, [formZone]);

  useEffect(() => {
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
    fontSize: fs(14),
    color: colors.ink,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.r2,
    paddingHorizontal: sp(12),
    paddingVertical: sp(10),
  };

  return (
    <Screen>
      <T variant="display" tx="analytics.title" />
      {farm && (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Pill label={farm.name} color={colors.primary} dot />
        </View>
      )}

      {/* -- savings vs baseline -------------------------------------------- */}
      {savings && (
        <Card style={{ gap: spacing.sm }}>
          <CardTitle tx="analytics.savings" />
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
            <T style={{ fontFamily: fonts.mono, fontSize: fs(40), color: colors.healthy, lineHeight: fs(44) }}>
              {savings.savedPct}%
            </T>
            <T variant="muted" tx="analytics.saved" style={{ marginBottom: sp(8) }} />
          </View>
          <View style={{ height: 10, borderRadius: radius.pill, backgroundColor: colors.surface2, overflow: 'hidden' }}>
            <View style={{ width: `${Math.min(100, savings.savedPct)}%`, height: '100%', backgroundColor: colors.healthy }} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
            <Stat label={t('analytics.water')} value={`${Math.round(savings.waterUsedL)} ${t('common.liters')}`} />
            <Stat label="baseline" value={`${Math.round(savings.baselineL)} ${t('common.liters')}`} />
            <Stat label={t('analytics.saved')} value={`${Math.round(savings.savedL)} ${t('common.liters')}`} accent />
          </View>
        </Card>
      )}

      {/* -- water usage ---------------------------------------------------- */}
      <Card>
        <CardTitle tx="analytics.water" />
        {waterBars.length ? (
          <BarChart data={waterBars} width={300} height={150} color={colors.watering} showValues unit={t('common.liters')} />
        ) : (
          <T variant="muted" tx="analytics.noData" />
        )}
      </Card>

      {/* -- fertilizer usage ---------------------------------------------- */}
      <Card>
        <CardTitle tx="analytics.fertilizer" />
        {fertBars.length ? (
          <BarChart data={fertBars} width={300} height={150} color={colors.accent} showValues unit="mL" />
        ) : (
          <T variant="muted" tx="analytics.noData" />
        )}
      </Card>

      {/* -- harvest / yield log + add form -------------------------------- */}
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <CardTitle tx="analytics.harvest" />
          <View style={{ flex: 1 }} />
          <Button small variant={showForm ? 'ghost' : 'primary'} title={showForm ? t('common.cancel') : '＋'} onPress={() => setShowForm((v) => !v)} />
        </View>

        {showForm && (
          <View style={{ gap: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderSoft }}>
            {zones.length > 0 && (
              <View>
                <T variant="label" tx="field.zones" style={{ marginBottom: 6 }} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {zones.map((z) => (
                    <Pressable
                      key={z.id}
                      onPress={() => setFormZone(z.id)}
                      style={{
                        paddingHorizontal: sp(12),
                        paddingVertical: sp(8),
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: z.id === formZone ? colors.primary : colors.border,
                        backgroundColor: z.id === formZone ? colors.primarySoft : colors.surface,
                      }}
                    >
                      <T style={{ fontFamily: fonts.uiMedium, fontSize: fs(12), color: z.id === formZone ? colors.primaryInk : colors.muted }}>
                        {z.crop ? `${z.crop.emoji} ` : ''}
                        {z.name}
                      </T>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <T variant="label" tx="analytics.yield" style={{ marginBottom: 6 }} />
                <TextInput
                  value={formYield}
                  onChangeText={setFormYield}
                  keyboardType="numeric"
                  placeholder={t('common.kg')}
                  placeholderTextColor={colors.subtle}
                  style={inputStyle}
                />
              </View>
              <View style={{ flex: 1 }}>
                <T variant="label" tx="assign.plantingDate" style={{ marginBottom: 6 }} />
                <TextInput
                  value={formDate}
                  onChangeText={setFormDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.subtle}
                  autoCapitalize="none"
                  style={inputStyle}
                />
              </View>
            </View>
            <TextInput
              value={formNotes}
              onChangeText={setFormNotes}
              placeholder={t('zone.coach')}
              placeholderTextColor={colors.subtle}
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
          harvest.map((h) => (
            <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: sp(6) }}>
              <T style={{ fontSize: fs(20) }}>{cropEmoji(h.cropId)}</T>
              <View style={{ flex: 1 }}>
                <T style={{ fontFamily: fonts.uiMedium, color: colors.ink, fontSize: fs(14) }}>
                  {cropName(h.cropId)} · {zoneName(h.zoneId)}
                </T>
                <T variant="muted" style={{ fontSize: fs(11) }}>
                  {h.harvestedAt}
                  {h.notes ? ` — ${h.notes}` : ''}
                </T>
              </View>
              {h.yieldKg != null && (
                <Pill label={`${h.yieldKg} ${t('common.kg')}`} color={colors.healthy} dot />
              )}
            </View>
          ))
        )}
      </Card>

      {/* -- CSV export / share -------------------------------------------- */}
      <Button title={t('analytics.export')} variant="ghost" onPress={shareCsv} disabled={!farm} />
    </Screen>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  const { fs } = useScale();
  return (
    <View style={{ gap: 2 }}>
      <T variant="muted" style={{ fontSize: fs(10), textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {label}
      </T>
      <T style={{ fontFamily: fonts.mono, fontSize: fs(15), color: accent ? colors.healthy : colors.ink }}>{value}</T>
    </View>
  );
}

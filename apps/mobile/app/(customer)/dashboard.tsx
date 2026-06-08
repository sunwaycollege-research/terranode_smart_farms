// TERANODE — Field (customer dashboard).
//
// The farmer's home screen. It composes the live, crop-driven field view from
// the api.* seam ONLY (never the mock directly), so the Phase-6 cutover is a
// flag flip:
//   • api.farms()            → the signed-in customer's farm(s)
//   • api.gateway(farmId)    → the real ESP32 brain (serial + lifecycle status)
//   • api.zones(farmId)      → zone tiles (ZoneWithCrop)
//   • api.zoneAnalysis(id)   → per-zone health / stage / readings (FieldTile)
//   • api.actuators(farmId)  → systems strip (pump / dosing) + per-zone valve
//   • api.entitlements()     → which systems/weather tiles are unlocked
//   • api.analyticsSavings() → the water-saved tile
//
// Account isolation: every piece of field data is LIVE (no hardcoded farm name,
// device serial, or sample reading), and the offline cache is keyed PER ACCOUNT
// (`teranode.overview.${accountId}`) so one farmer can never see another's
// cached field. Loading / error+retry / empty (no farm) states are all handled.
//
// Live-ish: re-polls on an interval (the virtual gateway drifts state) and on
// pull-to-refresh. The last good overview is cached to AsyncStorage so the
// screen renders instantly offline / on cold start before the network returns.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  Actuator,
  ChannelReadings,
  Entitlements,
  FarmReading,
  Gateway,
  GatewayStatus,
  ZoneAnalysisResponse,
  ZoneWithCrop,
} from '@teranode/types';
import { Button, Card, CardTitle, EmptyState, Loading, Pill, T } from '../../src/components/ui';
import {
  FieldTile,
  SavingsTile,
  SystemCard,
  WeatherStrip,
  deriveWeather,
  type WeatherSummary,
} from '../../src/components/FieldTiles';
import { WaterStatus } from '../../src/components/WaterStatus';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { useT } from '../../src/i18n';
import { useScale } from '../../src/theme/scale';
import { colors, fonts, spacing } from '../../src/theme/tokens';

/** Per-account overview cache key — NEVER global, or one account leaks to the next.
 *  The `.v2.` version segment invalidates older caches written before the
 *  `gateway`/`readings` fields existed (a stale shape used to crash the tiles). */
const cacheKey = (accountId: string) => `teranode.overview.v2.${accountId}`;

/** Treat a count/toggle entitlement as enabled (count > 0 / truthy). */
function enabled(values: Entitlements | undefined, key: string): boolean {
  const v = values?.[key];
  if (typeof v === 'number') return v > 0;
  return Boolean(v);
}

interface Overview {
  farmId: string | null;
  gateway: Gateway | null;
  zones: ZoneWithCrop[];
  analyses: Record<string, ZoneAnalysisResponse>;
  actuators: Actuator[];
  entitlements: Entitlements;
  weather: WeatherSummary;
  /** Newest value per farm channel (soil + weather + flow); feeds the Water card. */
  readings: FarmReading[];
  savings: { savedL: number; savedPct: number; waterUsedL: number } | null;
}

/** Is the gateway reachable right now? (drives the online pill + gateway card). */
function gatewayOnline(g: Gateway | null): boolean {
  return g?.status === 'online';
}

export default function Dashboard() {
  const { session } = useAuth();
  const { t, lang } = useT();
  const { fs, sp } = useScale();

  const accountId = session?.account.id ?? null;

  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true); // first load (no data yet)
  const [error, setError] = useState(false); // fetch failed AND no cached data
  const [refreshing, setRefreshing] = useState(false);
  const [online, setOnline] = useState(true); // network reachable (server responded)
  const hydrated = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    if (!accountId) return;
    try {
      const [farms, ents] = await Promise.all([api.farms(), api.entitlements().catch(() => null)]);
      const farm = farms[0] ?? null;

      // The gateway, zones and analytics only exist once the customer has a farm.
      const [gateway, zones] = await Promise.all([
        farm ? api.gateway(farm.id).catch(() => null) : Promise.resolve(null),
        farm ? api.zones(farm.id) : Promise.resolve([] as ZoneWithCrop[]),
      ]);

      const analyses: Record<string, ZoneAnalysisResponse> = {};
      const readingsList: ChannelReadings[] = [];
      await Promise.all(
        zones.map(async (z) => {
          try {
            const a = await api.zoneAnalysis(z.id, lang);
            analyses[z.id] = a;
            readingsList.push(a.readings);
          } catch {
            /* skip a failing zone; keep the rest of the field rendering */
          }
        })
      );

      const [actuators, savings, readings] = await Promise.all([
        api.actuators(farm?.id).catch(() => [] as Actuator[]),
        farm ? api.analyticsSavings(farm.id).catch(() => null) : Promise.resolve(null),
        farm ? api.readings(farm.id).catch(() => [] as FarmReading[]) : Promise.resolve([] as FarmReading[]),
      ]);

      const overview: Overview = {
        farmId: farm?.id ?? null,
        gateway,
        zones,
        analyses,
        actuators,
        entitlements: ents?.values ?? {},
        weather: deriveWeather(readingsList),
        readings,
        savings: savings
          ? { savedL: savings.savedL, savedPct: savings.savedPct, waterUsedL: savings.waterUsedL }
          : null,
      };

      setData(overview);
      setOnline(true);
      setError(false);
      await AsyncStorage.setItem(cacheKey(accountId), JSON.stringify(overview)).catch(() => {});
    } catch {
      // Network/offline: fall back to THIS account's cached overview if we have one.
      setOnline(false);
      if (!hydrated.current) {
        try {
          const raw = await AsyncStorage.getItem(cacheKey(accountId));
          if (raw) {
            setData(JSON.parse(raw) as Overview);
            setError(false);
          } else {
            // First ever load for this account and the network is down → hard error.
            setError(true);
          }
        } catch {
          setError(true);
        }
      }
    } finally {
      hydrated.current = true;
      setLoading(false);
    }
  }, [accountId, lang]);

  // Initial + interval poll (virtual gateway drifts state every few seconds).
  // Re-keyed on accountId so a re-login swaps the cache + data cleanly.
  useEffect(() => {
    hydrated.current = false;
    setData(null);
    setLoading(true);
    setError(false);
    let alive = true;
    void load();
    const id = setInterval(() => {
      if (alive) void load();
    }, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onRetry = useCallback(() => {
    setLoading(true);
    setError(false);
    hydrated.current = false;
    void load();
  }, [load]);

  // ----- LOADING (first paint, no data yet) -----
  // Uses the shared, centred, accessible (progressbar) Loading primitive so the
  // first-paint spinner matches every other screen.
  if (loading && !data) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Loading />
        </View>
      </SafeAreaView>
    );
  }

  // ----- ERROR (fetch failed AND nothing cached for this account) -----
  // Shared EmptyState (📡 + plain-language line) + a full-width retry, vertically
  // centred. Generous gap so the retry tap target is clear of the copy.
  if (error && !data) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ flex: 1, justifyContent: 'center', padding: sp(spacing.xl), gap: sp(spacing.lg) }}>
          <EmptyState icon="📡" tx="field.loadError" />
          <Button tx="common.retry" onPress={onRetry} />
        </View>
      </SafeAreaView>
    );
  }

  const gw = data?.gateway ?? null;
  const gwUp = gatewayOnline(gw);
  const hasFarm = Boolean(data?.farmId);

  // NOTE: optional-chain the arrays too (not just `data`) — a cached overview
  // written by an older build may predate the `actuators`/`readings` fields, so
  // `data.readings` can be undefined even when `data` is set.
  const pump = data?.actuators?.find((a) => a.type === 'pump');
  const dosing = data?.actuators?.find((a) => a.type === 'dosing');
  const valveFor = (zoneId: string) => data?.actuators?.find((a) => a.type === 'valve' && a.zoneId === zoneId);

  // Water card: live flow (L/min) + rain from farm-level readings, and whether
  // anything is actually driving water (pump or any valve open) for leak detection.
  const flowReading = data?.readings?.find((r) => r.type === 'flow');
  const flowLpm = flowReading ? flowReading.value : null;
  const rainReading = data?.readings?.find((r) => r.type === 'rain');
  const raining = rainReading != null && rainReading.value > 0;
  const waterDriven =
    Boolean(pump?.state) || Boolean(data?.actuators.some((a) => a.type === 'valve' && a.state));

  const showWeather = enabled(data?.entitlements, 'weatherMast');
  const showPump = enabled(data?.entitlements, 'mainPump');
  const showDosing = enabled(data?.entitlements, 'fertigation');
  const showReservoir = enabled(data?.entitlements, 'reservoirMonitoring');
  const showAnalytics = enabled(data?.entitlements, 'analytics');

  // Gateway pill: reflect the REAL device lifecycle, then the offline-cache state.
  const gwPillByStatus: Record<GatewayStatus, { tx: 'field.gatewayOnline' | 'field.gatewayOffline' | 'field.gatewayClaimed'; color: string }> = {
    online: { tx: 'field.gatewayOnline', color: colors.healthy },
    offline: { tx: 'field.gatewayOffline', color: colors.critical },
    claimed: { tx: 'field.gatewayClaimed', color: colors.warn },
    unbound: { tx: 'field.gatewayClaimed', color: colors.warn },
    revoked: { tx: 'field.gatewayOffline', color: colors.muted },
  };
  const gwPill = !online
    ? { label: t('field.offlineCached'), color: colors.warn }
    : gw
      ? { label: t(gwPillByStatus[gw.status].tx), color: gwPillByStatus[gw.status].color }
      : { label: t('field.gatewayNone'), color: colors.muted };

  // ESP32 Gateway system card state string (real status / cache fallback).
  const gwCardState = !online
    ? t('field.gatewayOffline')
    : gw
      ? gw.status === 'online'
        ? t('common.on').toUpperCase()
        : gw.status === 'offline'
          ? t('field.gatewayOffline')
          : t('field.gatewayClaimed')
      : t('field.gatewayNone');

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: sp(spacing.lg), gap: sp(spacing.md), paddingBottom: sp(spacing.xxl) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* header — small eyebrow ("Field") over the live account name for a clear
            visual hierarchy. The name never clips: it wraps to two lines and keeps
            the display serif's roomy line-height. */}
        <View accessible accessibilityRole="header" style={{ gap: sp(spacing.xs) }}>
          <T variant="h3" tx="field.title" accessibilityElementsHidden importantForAccessibility="no" />
          <T variant="display" numberOfLines={2}>
            {session?.account.name ?? t('field.title')}
          </T>
        </View>

        {/* status pills: gateway lifecycle + (only when known) the real device serial */}
        <View style={{ flexDirection: 'row', gap: sp(spacing.sm), flexWrap: 'wrap', alignItems: 'center' }}>
          <Pill label={gwPill.label} dot color={gwPill.color} />
          {gw?.serial ? <Pill label={`${gw.compute.toUpperCase()} · ${gw.serial}`} color={colors.muted} /> : null}
        </View>

        {/* offline banner — amber "watch" colour + icon so it reads at a glance,
            with a coloured rule on the leading edge to match the in-app alerts. */}
        {!online && (
          <Card
            style={{
              borderColor: colors.warn,
              backgroundColor: colors.warnSoft,
              borderLeftWidth: 4,
              flexDirection: 'row',
              alignItems: 'center',
              gap: sp(spacing.md),
            }}
          >
            <T style={{ fontSize: fs(22) }} accessibilityElementsHidden importantForAccessibility="no">
              📴
            </T>
            <T
              style={{ flex: 1, color: colors.inkSoft, fontFamily: fonts.uiMedium }}
              tx="field.offlineNotice"
            />
          </Card>
        )}

        {/* ----- NO FARM: brand-new account. Show one clear card, nothing else. ----- */}
        {!hasFarm ? (
          <Card style={{ borderColor: colors.border, gap: sp(spacing.sm) }}>
            <CardTitle tx="field.systems" />
            <View
              accessible
              accessibilityRole="text"
              style={{ alignItems: 'center', paddingVertical: sp(spacing.lg), gap: sp(spacing.sm) }}
            >
              {/* Seedling badge echoes the shared EmptyState's circular treatment so
                  the brand-new account screen feels intentional, not empty. */}
              <View
                style={{
                  width: sp(64),
                  height: sp(64),
                  borderRadius: sp(32),
                  backgroundColor: colors.primarySoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: sp(spacing.xs),
                }}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                <T style={{ fontSize: fs(34) }}>🌱</T>
              </View>
              <T variant="h2" tx="field.noFarmTitle" style={{ textAlign: 'center' }} />
              <T
                variant="muted"
                tx="field.noFarmBody"
                style={{ textAlign: 'center', maxWidth: 300 }}
              />
            </View>
          </Card>
        ) : (
          <>
            {/* weather */}
            {showWeather && data?.weather && (
              <Card>
                <CardTitle tx="field.weather" />
                <WeatherStrip weather={data.weather} />
              </Card>
            )}

            {/* systems strip */}
            <Card>
              <CardTitle tx="field.systems" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(spacing.sm) }}>
                <SystemCard
                  icon="🧠"
                  label={t('field.gateway')}
                  state={gwCardState}
                  on={online && gwUp}
                  offline={!online || gw?.status === 'offline'}
                />
                {showPump && (
                  <SystemCard
                    icon="💧"
                    label={t('field.pump')}
                    state={pump?.state ? t('common.on').toUpperCase() : t('common.off').toUpperCase()}
                    on={Boolean(pump?.state)}
                  />
                )}
                {showDosing && (
                  <SystemCard
                    icon="🧪"
                    label={t('field.dosing')}
                    state={dosing?.state ? t('field.watering') : t('field.idle')}
                    on={Boolean(dosing?.state)}
                  />
                )}
                {/* No live reservoir telemetry on the client surface → neutral placeholder. */}
                {showReservoir && <SystemCard icon="🪣" label={t('field.reservoir')} state="—" />}
              </View>
            </Card>

            {/* water — live flow + leak/rain notes (farmer-friendly) */}
            <WaterStatus flowLpm={flowLpm} raining={raining} pumpOn={waterDriven} />

            {/* savings */}
            {showAnalytics && data?.savings && (
              <Card>
                <CardTitle tx="analytics.savings" />
                <SavingsTile
                  savedL={data.savings.savedL}
                  savedPct={data.savings.savedPct}
                  waterUsedL={data.savings.waterUsedL}
                />
              </Card>
            )}

            {/* zone tiles */}
            <Card>
              <CardTitle tx="field.zones" />
              {data && data.zones.length > 0 ? (
                <>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(spacing.sm) }}>
                    {data.zones.map((z) => (
                      <FieldTile
                        key={z.id}
                        zone={z}
                        analysis={data.analyses[z.id]}
                        valve={valveFor(z.id)}
                        onPress={() => router.push(`/(customer)/zones/${z.id}`)}
                      />
                    ))}
                  </View>
                  <T variant="muted" tx="field.zonesHint" style={{ marginTop: sp(spacing.sm) }} />
                </>
              ) : (
                // Shared EmptyState (🌱 + plain-language line) so a farm with no
                // zones yet reads as a friendly prompt, not a blank card.
                <EmptyState tx="field.noZones" />
              )}
              {/* Farmer self-service: add a zone (server caps it at purchased nodes). */}
              <View style={{ marginTop: sp(spacing.sm) }}>
                <Button
                  variant="ghost"
                  tx="field.addZone"
                  onPress={() => router.push('/(customer)/zones/new')}
                />
              </View>
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

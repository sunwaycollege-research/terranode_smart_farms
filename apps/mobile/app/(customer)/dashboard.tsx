// TERANODE — Field (customer dashboard).
//
// The farmer's home screen. It composes the live, crop-driven field view from
// the api.* seam ONLY (never the mock directly), so the Phase-6 cutover is a
// flag flip:
//   • api.farms()            → the signed-in customer's farm(s)
//   • api.zones(farmId)      → zone tiles (ZoneWithCrop)
//   • api.zoneAnalysis(id)   → per-zone health / stage / readings (FieldTile)
//   • api.actuators()        → systems strip (pump / dosing) + per-zone valve
//   • api.entitlements()     → which systems/weather tiles are unlocked
//   • api.analyticsSavings() → the water-saved tile
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
  ZoneAnalysisResponse,
  ZoneWithCrop,
} from '@teranode/types';
import { Card, CardTitle, Pill, T } from '../../src/components/ui';
import {
  FieldTile,
  SavingsTile,
  SystemCard,
  WeatherStrip,
  deriveWeather,
  type WeatherSummary,
} from '../../src/components/FieldTiles';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { useT } from '../../src/i18n';
import { useScale } from '../../src/theme/scale';
import { colors, fonts, spacing } from '../../src/theme/tokens';

const CACHE_KEY = 'teranode.overview';

/** Treat a count/toggle entitlement as enabled (count > 0 / truthy). */
function enabled(values: Entitlements | undefined, key: string): boolean {
  const v = values?.[key];
  if (typeof v === 'number') return v > 0;
  return Boolean(v);
}

interface Overview {
  farmId: string | null;
  zones: ZoneWithCrop[];
  analyses: Record<string, ZoneAnalysisResponse>;
  actuators: Actuator[];
  entitlements: Entitlements;
  weather: WeatherSummary;
  savings: { savedL: number; savedPct: number; waterUsedL: number } | null;
}

export default function Dashboard() {
  const { session } = useAuth();
  const { t, lang } = useT();
  const { sp } = useScale();

  const [data, setData] = useState<Overview | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [online, setOnline] = useState(true);
  const hydrated = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [farms, ents] = await Promise.all([api.farms(), api.entitlements().catch(() => null)]);
      const farm = farms[0] ?? null;
      const zones = farm ? await api.zones(farm.id) : [];

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

      const [actuators, savings] = await Promise.all([
        api.actuators().catch(() => [] as Actuator[]),
        farm ? api.analyticsSavings(farm.id).catch(() => null) : Promise.resolve(null),
      ]);

      const overview: Overview = {
        farmId: farm?.id ?? null,
        zones,
        analyses,
        actuators,
        entitlements: ents?.values ?? {},
        weather: deriveWeather(readingsList),
        savings: savings ? { savedL: savings.savedL, savedPct: savings.savedPct, waterUsedL: savings.waterUsedL } : null,
      };

      setData(overview);
      setOnline(true);
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(overview)).catch(() => {});
    } catch {
      // Network/offline: fall back to the cached overview if we have one.
      setOnline(false);
      if (!hydrated.current) {
        try {
          const raw = await AsyncStorage.getItem(CACHE_KEY);
          if (raw) setData(JSON.parse(raw) as Overview);
        } catch {
          /* ignore */
        }
      }
    } finally {
      hydrated.current = true;
    }
  }, [lang]);

  // Initial + interval poll (virtual gateway drifts state every few seconds).
  useEffect(() => {
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

  const pump = data?.actuators.find((a) => a.type === 'pump');
  const dosing = data?.actuators.find((a) => a.type === 'dosing');
  const valveFor = (zoneId: string) => data?.actuators.find((a) => a.type === 'valve' && a.zoneId === zoneId);

  const showWeather = enabled(data?.entitlements, 'weatherMast');
  const showPump = enabled(data?.entitlements, 'mainPump');
  const showDosing = enabled(data?.entitlements, 'fertigation');
  const showReservoir = enabled(data?.entitlements, 'reservoirMonitoring');
  const showAnalytics = enabled(data?.entitlements, 'analytics');

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: sp(spacing.lg), gap: sp(spacing.md), paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <T variant="display">{session?.account.name ?? t('field.title')}</T>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Pill
            label={online ? 'Gateway online' : 'Offline · cached'}
            dot
            color={online ? colors.healthy : colors.warn}
          />
          <Pill label="ESP32 · TN-0001" color={colors.muted} />
        </View>

        {!online && (
          <Card style={{ borderColor: colors.warn, backgroundColor: colors.warnSoft }}>
            <T style={{ color: colors.inkSoft, fontFamily: fonts.uiMedium }}>
              Showing the last cached field overview. Irrigation keeps running on the gateway; readings refresh when you
              reconnect.
            </T>
          </Card>
        )}

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
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <SystemCard icon="🧠" label="ESP32 Gateway" state={online ? 'online' : 'offline'} on={online} offline={!online} />
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
            {showReservoir && <SystemCard icon="🪣" label={t('field.reservoir')} state="78%" on />}
          </View>
        </Card>

        {/* savings */}
        {showAnalytics && data?.savings && (
          <Card>
            <CardTitle tx="analytics.savings" />
            <SavingsTile savedL={data.savings.savedL} savedPct={data.savings.savedPct} waterUsedL={data.savings.waterUsedL} />
          </Card>
        )}

        {/* zone tiles */}
        <Card>
          <CardTitle tx="field.zones" />
          {data && data.zones.length > 0 ? (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
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
              <T variant="muted" style={{ marginTop: 8 }}>
                Tap a zone to inspect readings, targets and the valve.
              </T>
            </>
          ) : (
            <T variant="muted" tx="field.noZones" />
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

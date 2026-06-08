import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button, Card, Divider, EmptyState, Loading, Pill, T } from '../../src/components/ui';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { useT, type TranslationKey } from '../../src/i18n';
import { useScale } from '../../src/theme/scale';
import { colors, fonts, radius, spacing } from '../../src/theme/tokens';
import type { Alert, AlertSeverity } from '@teranode/types';

// ---------------------------------------------------------------------------
// Alerts — localized (en/ne) severity-colored feed with acknowledge. All data
// is LIVE from api.alerts() / api.ackAlert(id) (no hardcoded/sample alerts).
// Messages carry both messageEn/messageNe from the server; we render per the
// current language. The last good feed is cached PER ACCOUNT so a different
// signed-in customer can never see the previous account's alerts on cold start.
// Push notifications (Expo push / FCM / APNs) surface here too.
// ---------------------------------------------------------------------------

// Severity is coded by BOTH colour AND a leading icon + a soft tinted surface,
// so meaning never depends on colour alone (low-vision / sunlight / colour-blind
// farmers). green = good · amber = watch · red = act.
const sev: Record<
  AlertSeverity,
  { color: string; soft: string; ink: string; icon: string; key: TranslationKey }
> = {
  info: { color: colors.watering, soft: colors.wateringSoft, ink: colors.wateringInk, icon: 'ℹ️', key: 'alerts.info' },
  warn: { color: colors.warn, soft: colors.warnSoft, ink: colors.warnInk, icon: '⚠️', key: 'alerts.warn' },
  critical: { color: colors.critical, soft: colors.criticalSoft, ink: colors.criticalInk, icon: '🛑', key: 'alerts.critical' },
};

/** Per-account cache key — NEVER a global key (would leak another customer's data). */
const cacheKey = (accountId: string) => `teranode.cache.alerts.${accountId}`;

/** "2h ago" style relative time, localized via the day unit. */
function relTime(iso: string, t: ReturnType<typeof useT>['t']): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.round(hr / 24);
  return `${d} ${t(d === 1 ? 'common.day' : 'common.days')}`;
}

export default function Alerts() {
  const { session } = useAuth();
  const { t, lang } = useT();
  const { fs, sp, lh, touch } = useScale();

  // accountId scopes both the cache key and every render — when the signed-in
  // account changes the effect below resets all state so no stale feed shows.
  const accountId = session?.account.id ?? null;

  const [alerts, setAlerts] = useState<Alert[] | null>(null); // null = not loaded yet
  const [error, setError] = useState(false);
  const [acking, setAcking] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const hydrated = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    if (!accountId) return;
    try {
      const list = await api.alerts();
      const sorted = [...list].sort((a, b) => b.ts.localeCompare(a.ts));
      setAlerts(sorted);
      setError(false);
      await AsyncStorage.setItem(cacheKey(accountId), JSON.stringify(sorted)).catch(() => {});
    } catch {
      // Network/offline: keep showing the last good feed if we have one; only
      // surface the error state when we have nothing to show.
      if (!hydrated.current) {
        try {
          const raw = await AsyncStorage.getItem(cacheKey(accountId));
          if (raw) {
            setAlerts(JSON.parse(raw) as Alert[]);
            setError(false);
            return;
          }
        } catch {
          /* ignore — fall through to the error state */
        }
      }
      setError(true);
    } finally {
      hydrated.current = true;
    }
  }, [accountId]);

  // Reset on account change so a new customer never briefly sees the previous
  // account's alerts, then start the live poll for the current account.
  useEffect(() => {
    setAlerts(null);
    setError(false);
    hydrated.current = false;
    if (!accountId) return;

    let alive = true;
    void load();
    const id = setInterval(() => {
      if (alive) void load();
    }, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [accountId, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const ack = useCallback(
    async (id: string) => {
      setAcking(id);
      try {
        const updated = await api.ackAlert(id);
        setAlerts((prev) => (prev ? prev.map((a) => (a.id === id ? updated : a)) : prev));
      } catch {
        // Re-sync from the server so the row reflects the true state.
        void load();
      } finally {
        setAcking(null);
      }
    },
    [load]
  );

  const message = (a: Alert): string => (lang === 'ne' && a.messageNe ? a.messageNe : a.messageEn);

  // Count of still-unacknowledged alerts — drives the header summary chip so the
  // farmer sees "how many need me" at a glance without reading every row.
  const unacked = useMemo(() => (alerts ? alerts.filter((a) => !a.acknowledgedAt).length : 0), [alerts]);

  // Shared title row (kept identical across loading/error/loaded states so the
  // header never jumps as the screen settles).
  const Header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(spacing.sm) }}>
      <T variant="display" tx="alerts.title" style={{ flexShrink: 1 }} />
      <View style={{ flex: 1 }} />
      {unacked > 0 && (
        <Pill label={String(unacked)} color={colors.critical} dot />
      )}
    </View>
  );

  // ---- loading (first load, nothing cached yet) ----------------------------
  if (alerts === null && !error) {
    return (
      <Screen>
        {Header}
        <Loading tx="common.loading" />
      </Screen>
    );
  }

  // ---- error (no data and the live call failed) ----------------------------
  if (error && (alerts === null || alerts.length === 0)) {
    return (
      <Screen>
        {Header}
        <Card
          accessible
          accessibilityRole="alert"
          style={{ borderColor: colors.warn, backgroundColor: colors.warnSoft, alignItems: 'center', gap: sp(spacing.md), paddingVertical: sp(spacing.xl) }}
        >
          <T style={{ fontSize: fs(34) }}>📡</T>
          <T
            style={{ color: colors.inkSoft, fontFamily: fonts.uiMedium, textAlign: 'center', fontSize: fs(15), lineHeight: lh(15) }}
            tx="alerts.error"
          />
          <Button tx="common.retry" onPress={() => void load()} />
        </Card>
      </Screen>
    );
  }

  const empty = !alerts || alerts.length === 0;

  // ---- loaded: empty or the live feed --------------------------------------
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: sp(spacing.lg), gap: sp(spacing.md), paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {Header}

        {empty ? (
          <EmptyState icon="✅" tx="alerts.none" />
        ) : (
          // accessibilityLiveRegion: a screen reader announces newly-arrived
          // alerts (incl. pushed ones) without the farmer re-opening the screen.
          <View style={{ gap: sp(spacing.md) }} accessibilityLiveRegion="polite">
            {alerts!.map((a) => {
              const meta = sev[a.severity];
              const isAcked = Boolean(a.acknowledgedAt);
              const busy = acking === a.id;
              // One spoken sentence per row: severity, the message, age, and
              // whether it still needs the farmer — beats reading 3 pills aloud.
              const a11y = `${t(meta.key)}. ${message(a)}. ${relTime(a.ts, t)}. ${
                isAcked ? t('alerts.acked') : t('alerts.ack')
              }`;
              return (
                <Card
                  key={a.id}
                  accessible
                  accessibilityLabel={a11y}
                  style={{
                    borderLeftWidth: 5,
                    borderLeftColor: meta.color,
                    gap: sp(spacing.sm),
                    // Acknowledged rows recede; live ones keep full presence.
                    opacity: isAcked ? 0.7 : 1,
                  }}
                >
                  {/* severity (icon + colour + label) ........... age */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(spacing.sm) }}>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: sp(6),
                        backgroundColor: meta.soft,
                        borderRadius: radius.pill,
                        paddingHorizontal: sp(10),
                        paddingVertical: sp(5),
                      }}
                    >
                      <T style={{ fontSize: fs(13) }}>{meta.icon}</T>
                      <T
                        style={{
                          fontFamily: fonts.uiSemibold,
                          color: meta.ink,
                          fontSize: fs(12),
                          letterSpacing: 0.3,
                          textTransform: 'uppercase',
                        }}
                      >
                        {t(meta.key)}
                      </T>
                    </View>
                    <View style={{ flex: 1 }} />
                    <T variant="muted" style={{ fontFamily: fonts.mono, fontSize: fs(11) }}>
                      {relTime(a.ts, t)}
                    </T>
                  </View>

                  {/* plain-language message — the primary content, roomy line-height */}
                  <T style={{ fontFamily: fonts.uiMedium, color: colors.ink, fontSize: fs(15), lineHeight: lh(15) }}>
                    {message(a)}
                  </T>

                  <Divider />

                  {/* type tag ........... acknowledged state OR action button */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(spacing.sm), minHeight: touch }}>
                    <Pill label={a.type} color={colors.muted} />
                    <View style={{ flex: 1 }} />
                    {isAcked ? (
                      <Pill label={t('alerts.acked')} color={colors.healthy} dot />
                    ) : (
                      <Button
                        small
                        variant="ghost"
                        title={busy ? t('common.saving') : t('alerts.ack')}
                        disabled={busy}
                        onPress={() => ack(a.id)}
                      />
                    )}
                  </View>
                </Card>
              );
            })}
          </View>
        )}

        <T
          variant="muted"
          tx="alerts.pushNote"
          style={{ textAlign: 'center', marginTop: sp(spacing.sm), fontSize: fs(11) }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

// Lightweight non-scrolling shell reused by the loading & error states so they
// match the loaded screen's padding/background exactly (the loaded state needs
// its own ScrollView for pull-to-refresh, so we can't share <Screen> there).
function Screen({ children }: { children: React.ReactNode }) {
  const { sp } = useScale();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: sp(spacing.lg), gap: sp(spacing.md) }}>{children}</View>
    </SafeAreaView>
  );
}

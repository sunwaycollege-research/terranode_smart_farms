import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, EmptyState, Pill, Screen, T } from '../../src/components/ui';
import { api } from '../../src/api/client';
import { useT, type TranslationKey } from '../../src/i18n';
import { useScale } from '../../src/theme/scale';
import { colors, fonts, spacing } from '../../src/theme/tokens';
import type { Alert, AlertSeverity } from '@teranode/types';

// ---------------------------------------------------------------------------
// Alerts — localized (en/ne) severity-colored feed with acknowledge. Messages
// carry both messageEn/messageNe from the server; we render per current lang.
// Push notifications (Expo push / FCM / APNs) surface here too.
// ---------------------------------------------------------------------------

const sevColor: Record<AlertSeverity, string> = {
  info: colors.watering,
  warn: colors.warn,
  critical: colors.critical,
};

const sevKey: Record<AlertSeverity, TranslationKey> = {
  info: 'alerts.info',
  warn: 'alerts.warn',
  critical: 'alerts.critical',
};

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
  const { t, lang } = useT();
  const { fs } = useScale();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [acking, setAcking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setAlerts(await api.alerts());
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load]);

  const ack = useCallback(
    async (id: string) => {
      setAcking(id);
      try {
        const updated = await api.ackAlert(id);
        setAlerts((prev) => prev.map((a) => (a.id === id ? updated : a)));
      } finally {
        setAcking(null);
      }
    },
    []
  );

  const message = (a: Alert): string => (lang === 'ne' && a.messageNe ? a.messageNe : a.messageEn);

  return (
    <Screen>
      <T variant="display" tx="alerts.title" />

      {alerts.length === 0 ? (
        <EmptyState icon="✅" tx="alerts.none" />
      ) : (
        alerts.map((a) => (
          <Card key={a.id} style={{ borderLeftWidth: 4, borderLeftColor: sevColor[a.severity], gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pill label={t(sevKey[a.severity])} color={sevColor[a.severity]} dot />
              <View style={{ flex: 1 }} />
              <T variant="muted" style={{ fontFamily: fonts.mono, fontSize: fs(11) }}>
                {relTime(a.ts, t)}
              </T>
            </View>

            <T style={{ fontFamily: fonts.uiMedium, color: colors.ink, fontSize: fs(15), lineHeight: fs(21) }}>
              {message(a)}
            </T>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Pill label={a.type} color={colors.muted} />
              <View style={{ flex: 1 }} />
              {a.acknowledgedAt ? (
                <Pill label={t('alerts.acked')} color={colors.healthy} dot />
              ) : (
                <Button
                  small
                  variant="ghost"
                  title={acking === a.id ? t('common.saving') : t('alerts.ack')}
                  disabled={acking === a.id}
                  onPress={() => ack(a.id)}
                />
              )}
            </View>
          </Card>
        ))
      )}

      <T variant="muted" style={{ textAlign: 'center', marginTop: spacing.sm, fontSize: fs(11) }}>
        Push notifications arrive here too (Expo push / FCM / APNs).
      </T>
    </Screen>
  );
}

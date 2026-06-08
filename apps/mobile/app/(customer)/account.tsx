import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import {
  Button,
  Card,
  CardTitle,
  Divider,
  EmptyState,
  Loading,
  Pill,
  Screen,
  Segmented,
  T,
  Toggle,
} from '../../src/components/ui';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { useT, type Lang } from '../../src/i18n';
import { useScale } from '../../src/theme/scale';
import { colors, fonts, radius, spacing } from '../../src/theme/tokens';
import type { DeviceCatalogItem, Entitlements } from '@teranode/types';

// ---------------------------------------------------------------------------
// Account — the REAL signed-in user/account (name, email, role, account name)
// straight from useAuth().session — never hardcoded. Plus a language toggle
// (en/ne, wired to setLanguage), a Field-mode (large-touch) toggle wired to the
// FieldModeProvider via useScale, the customer's device entitlements (live from
// api.entitlements, with loading / error+retry / empty states), and sign-out.
//
// Account isolation: nothing here is cached to a global key and no sample values
// are shown — every field is the live session or a neutral "—" placeholder, so a
// signed-in farmer can only ever see their own identity and plan.
// ---------------------------------------------------------------------------

const DASH = '—';

type DeviceLoad = 'loading' | 'ready' | 'error';

/** First letter of the farmer's name for the avatar chip — falls back to a leaf. */
function initialOf(name?: string): string {
  const ch = (name ?? '').trim().charAt(0);
  return ch ? ch.toUpperCase() : '🌱';
}

export default function Account() {
  const { session, signOut } = useAuth();
  const { t, lang, setLanguage } = useT();
  const { fieldMode, setFieldMode, fs, sp, touch } = useScale();

  const [values, setValues] = useState<Entitlements>({});
  const [catalog, setCatalog] = useState<DeviceCatalogItem[]>([]);
  const [status, setStatus] = useState<DeviceLoad>('loading');

  // Re-fetch whenever the signed-in account changes so one account's plan can
  // never linger on screen for the next. Keyed on session.account.id.
  const accountId = session?.account.id;

  const loadEntitlements = useCallback(() => {
    let cancelled = false;
    setStatus('loading');
    api
      .entitlements()
      .then((e) => {
        if (cancelled) return;
        setValues(e.values ?? {});
        setCatalog(e.catalog ?? []);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setValues({});
        setCatalog([]);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!accountId) return;
    const cancel = loadEntitlements();
    return cancel;
  }, [accountId, loadEntitlements]);

  const enabled = (item: DeviceCatalogItem): boolean => {
    const v = values[item.key];
    if (typeof v === 'number') return v > 0;
    return Boolean(v);
  };
  const countOf = (item: DeviceCatalogItem): number => {
    const v = values[item.key];
    return typeof v === 'number' ? v : v ? 1 : 0;
  };

  // Role label from the live session role — never a hardcoded profile string.
  const roleLabel = session
    ? session.user.role === 'admin'
      ? t('account.roleAdmin')
      : t('account.roleCustomer')
    : DASH;

  // Field-mode aware avatar dimensions — keeps the identity chip legible and on
  // the same baseline as the name in large-touch mode.
  const avatar = sp(48);

  return (
    <Screen>
      <T variant="display" tx="account.title" />

      {/* -- profile (live session — name, email, role, account) ----------- */}
      <Card style={{ gap: sp(spacing.md) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(spacing.md) }}>
          {/* Identity chip — first initial of the live name; quick at-a-glance
              "this is your account" cue for low-literacy / fast scanning. */}
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              width: avatar,
              height: avatar,
              borderRadius: radius.pill,
              backgroundColor: colors.primarySoft,
              borderWidth: 1,
              borderColor: colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <T style={{ fontFamily: fonts.uiSemibold, color: colors.primaryInk, fontSize: fs(20) }}>
              {initialOf(session?.user.name)}
            </T>
          </View>

          <View style={{ flex: 1, gap: sp(2) }}>
            <T
              accessibilityRole="header"
              style={{ fontFamily: fonts.uiSemibold, fontSize: fs(18), color: colors.ink }}
            >
              {session?.user.name || DASH}
            </T>
            <T variant="muted" numberOfLines={1}>
              {session?.user.email || DASH}
            </T>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: sp(spacing.sm), flexWrap: 'wrap' }}>
          <Pill label={session?.account.name || DASH} color={colors.primary} dot />
          <Pill label={roleLabel} color={colors.accent} dot />
          {session?.account.plan ? (
            <Pill label={session.account.plan} color={colors.healthyInk} dot />
          ) : null}
        </View>
      </Card>

      {/* -- language ------------------------------------------------------ */}
      <Card style={{ gap: sp(spacing.sm) }}>
        <CardTitle tx="account.language" />
        <Segmented<Lang>
          options={['en', 'ne']}
          value={lang}
          onChange={(l) => void setLanguage(l)}
          labels={{ en: t('account.english'), ne: t('account.nepali') }}
        />
      </Card>

      {/* -- field mode ---------------------------------------------------- */}
      <Card>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: sp(spacing.md), minHeight: touch }}
        >
          <View style={{ flex: 1, gap: sp(2) }}>
            <T
              accessibilityRole="header"
              style={{ fontFamily: fonts.uiSemibold, color: colors.ink, fontSize: fs(15) }}
              tx="account.fieldMode"
            />
            <T variant="muted" tx="account.fieldModeHint" />
          </View>
          <Toggle value={fieldMode} onChange={(on) => void setFieldMode(on)} />
        </View>
      </Card>

      {/* -- devices / entitlements (live, with load / error / empty) ------ */}
      <Card style={{ gap: sp(spacing.sm) }}>
        <CardTitle tx="account.plan" />

        {status === 'loading' && <Loading tx="account.devicesLoading" />}

        {status === 'error' && (
          <View
            style={{
              gap: sp(spacing.md),
              backgroundColor: colors.warnSoft,
              borderWidth: 1,
              borderColor: colors.warn,
              borderRadius: radius.r2,
              padding: sp(spacing.md),
            }}
          >
            <T
              style={{ color: colors.inkSoft, fontFamily: fonts.uiMedium, fontSize: fs(14) }}
              tx="account.devicesError"
            />
            <Button variant="ghost" small tx="common.retry" onPress={loadEntitlements} />
          </View>
        )}

        {status === 'ready' && catalog.length === 0 && (
          <EmptyState icon="📦" tx="account.devicesEmpty" />
        )}

        {status === 'ready' && catalog.length > 0 && (
          <>
            <View>
              {catalog.map((d, i) => {
                const on = enabled(d);
                const cnt = d.kind === 'count' ? countOf(d) : null;
                // Icon + colour coding: a green tick reads "active" at a glance;
                // inactive entries dim to a neutral dot so the eye lands on what
                // the farmer actually has.
                const statusLabel = cnt != null ? `×${cnt}` : on ? t('common.on') : t('common.off');
                return (
                  <View key={d.key}>
                    {i > 0 && <Divider style={{ marginVertical: sp(spacing.sm) }} />}
                    <View
                      accessible
                      accessibilityRole="text"
                      accessibilityLabel={`${d.label}, ${statusLabel}`}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: sp(spacing.sm),
                        minHeight: sp(28),
                      }}
                    >
                      <T
                        style={{
                          flex: 1,
                          fontFamily: fonts.uiMedium,
                          fontSize: fs(14),
                          color: on ? colors.ink : colors.subtle,
                        }}
                        numberOfLines={2}
                      >
                        {d.label}
                      </T>
                      <Pill
                        label={statusLabel}
                        color={on ? colors.healthyInk : colors.subtle}
                        dot
                      />
                    </View>
                  </View>
                );
              })}
            </View>

            <T variant="muted" style={{ marginTop: sp(spacing.xs), fontSize: fs(11) }}>
              {t('admin.noticeBody')}
            </T>
          </>
        )}

        {/* Connect a new TERANODE box (SoftAP onboarding flow). */}
        <View style={{ marginTop: sp(spacing.xs) }}>
          <Button
            variant="accent"
            tx="account.addDevice"
            onPress={() => router.push('/(customer)/devices/add' as never)}
          />
        </View>
      </Card>

      {/* -- sign out — set apart from the cards above so it is never a
           mis-tap, and full-width for a confident, easy field target. ---- */}
      <View style={{ marginTop: sp(spacing.sm) }}>
        <Button
          variant="ghost"
          tx="common.signOut"
          onPress={async () => {
            await signOut();
            router.replace('/(auth)/login');
          }}
        />
      </View>
    </Screen>
  );
}

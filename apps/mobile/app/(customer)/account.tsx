import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, CardTitle, Pill, Screen, Segmented, T, Toggle } from '../../src/components/ui';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { useT, type Lang } from '../../src/i18n';
import { useScale } from '../../src/theme/scale';
import { colors, fonts, spacing } from '../../src/theme/tokens';
import type { DeviceCatalogItem, Entitlements } from '@teranode/types';

// ---------------------------------------------------------------------------
// Account — profile + a language toggle (en/ne, wired to setLanguage) + a
// Field-mode (large-touch) toggle wired to the FieldModeProvider via useScale,
// the customer's device entitlements (from api.entitlements), and sign-out.
// ---------------------------------------------------------------------------

export default function Account() {
  const { session, signOut } = useAuth();
  const { t, lang, setLanguage } = useT();
  const { fieldMode, setFieldMode, fs } = useScale();

  const [values, setValues] = useState<Entitlements>({});
  const [catalog, setCatalog] = useState<DeviceCatalogItem[]>([]);

  useEffect(() => {
    api
      .entitlements()
      .then((e) => {
        setValues(e.values);
        setCatalog(e.catalog);
      })
      .catch(() => {
        /* offline / unauthed — leave the section empty */
      });
  }, []);

  const enabled = (item: DeviceCatalogItem): boolean => {
    const v = values[item.key];
    if (typeof v === 'number') return v > 0;
    return Boolean(v);
  };
  const countOf = (item: DeviceCatalogItem): number => {
    const v = values[item.key];
    return typeof v === 'number' ? v : v ? 1 : 0;
  };

  return (
    <Screen>
      <T variant="display" tx="account.title" />

      {/* -- profile ------------------------------------------------------- */}
      <Card style={{ gap: 6 }}>
        <T style={{ fontFamily: fonts.uiSemibold, fontSize: fs(17), color: colors.ink }}>{session?.user.name}</T>
        <T variant="muted">{session?.user.email}</T>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <Pill label={session?.account.name ?? ''} color={colors.primary} dot />
          {session?.account.plan ? <Pill label={session.account.plan} color={colors.accent} /> : null}
        </View>
      </Card>

      {/* -- language ------------------------------------------------------ */}
      <Card style={{ gap: spacing.sm }}>
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <T style={{ fontFamily: fonts.uiSemibold, color: colors.ink, fontSize: fs(15) }} tx="account.fieldMode" />
            <T variant="muted" tx="account.fieldModeHint" style={{ marginTop: 2 }} />
          </View>
          <Toggle value={fieldMode} onChange={(on) => void setFieldMode(on)} />
        </View>
      </Card>

      {/* -- devices / entitlements --------------------------------------- */}
      {catalog.length > 0 && (
        <Card>
          <CardTitle tx="account.plan" />
          <View style={{ gap: spacing.sm }}>
            {catalog.map((d) => {
              const on = enabled(d);
              const cnt = d.kind === 'count' ? countOf(d) : null;
              return (
                <View key={d.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <T
                    style={{ flex: 1, fontFamily: fonts.uiMedium, fontSize: fs(14), color: on ? colors.ink : colors.subtle }}
                  >
                    {d.label}
                  </T>
                  <Pill
                    label={cnt != null ? `×${cnt}` : on ? t('common.on') : t('common.off')}
                    color={on ? colors.healthy : colors.subtle}
                    dot
                  />
                </View>
              );
            })}
          </View>
          <T variant="muted" style={{ marginTop: spacing.sm, fontSize: fs(11) }}>
            {t('admin.noticeBody')}
          </T>
        </Card>
      )}

      {/* -- sign out ------------------------------------------------------ */}
      <Button
        variant="ghost"
        tx="common.signOut"
        onPress={async () => {
          await signOut();
          router.replace('/(auth)/login');
        }}
      />
    </Screen>
  );
}

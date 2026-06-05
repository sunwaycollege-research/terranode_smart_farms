import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useAuth } from '../src/auth/AuthContext';
import { useT } from '../src/i18n';
import { Button, Card, Screen, T } from '../src/components/ui';
import { colors, fonts, spacing } from '../src/theme/tokens';

export default function Index() {
  const { session, loading, role, signOut } = useAuth();
  const { t } = useT();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!session) return <Redirect href="/(auth)/login" />;

  // Customers use the mobile field app.
  if (role === 'customer') return <Redirect href="/(customer)/dashboard" />;

  // Admins manage the platform from the web console — show an in-app notice.
  return (
    <Screen>
      <View style={{ alignItems: 'center', marginTop: spacing.xxl, marginBottom: spacing.lg }}>
        <T variant="display" style={{ fontSize: 40 }}>
          TERA
          <T variant="display" style={{ fontSize: 40, color: colors.primary, fontStyle: 'italic', fontFamily: fonts.displayItalic }}>
            NODE
          </T>
        </T>
      </View>

      <Card style={{ gap: spacing.md, alignItems: 'center' }}>
        <T style={{ fontSize: 40 }}>🖥️</T>
        <T variant="h2" style={{ textAlign: 'center' }}>{t('admin.noticeTitle')}</T>
        <T variant="body" style={{ textAlign: 'center', color: colors.muted }}>{t('admin.noticeBody')}</T>
        <T variant="muted" style={{ textAlign: 'center' }}>{t('admin.noticeUrl')}</T>
      </Card>

      <Card style={{ gap: 4 }}>
        <T variant="muted">{session.user.name}</T>
        <T variant="muted">{session.user.email}</T>
      </Card>

      <Button
        variant="ghost"
        title={t('admin.signOut')}
        onPress={async () => {
          await signOut();
          router.replace('/(auth)/login');
        }}
      />
    </Screen>
  );
}

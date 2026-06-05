import React from 'react';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors, fonts } from '../../src/theme/tokens';
import { useT } from '../../src/i18n';
import { useScale } from '../../src/theme/scale';

function icon(emoji: string, size: number) {
  return ({ focused }: { focused: boolean }) => (
    <Text style={{ fontSize: size, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>
  );
}

export default function CustomerLayout() {
  const { t } = useT();
  const { fs, sp } = useScale();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: sp(62),
          paddingBottom: sp(8),
          paddingTop: sp(6),
        },
        tabBarLabelStyle: { fontFamily: fonts.uiMedium, fontSize: fs(11) },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: t('tabs.field'), tabBarIcon: icon('🌾', fs(20)) }} />
      <Tabs.Screen name="analytics" options={{ title: t('tabs.analytics'), tabBarIcon: icon('📊', fs(20)) }} />
      <Tabs.Screen name="alerts" options={{ title: t('tabs.alerts'), tabBarIcon: icon('🔔', fs(20)) }} />
      <Tabs.Screen name="account" options={{ title: t('tabs.account'), tabBarIcon: icon('⚙️', fs(20)) }} />

      {/* History is reachable from analytics/dashboard but kept off the bar. */}
      <Tabs.Screen name="history" options={{ href: null }} />
      {/* Zone detail + the add-zone flow are pushed on top of the tabs. */}
      <Tabs.Screen name="zones/[zoneId]" options={{ href: null }} />
      <Tabs.Screen name="zones/new" options={{ href: null }} />
    </Tabs>
  );
}

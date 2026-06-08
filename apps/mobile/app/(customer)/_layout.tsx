import React, { useEffect, useRef } from 'react';
import { Tabs } from 'expo-router';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '../../src/theme/tokens';
import { useT } from '../../src/i18n';
import { useScale } from '../../src/theme/scale';

/**
 * Customer bottom tab bar.
 *
 * Farmer-accessibility goals applied here:
 *   - Big touch targets: each tab item is at least the scaled `touch` (≥44px)
 *     tall, and the whole bar grows in field mode via fs()/sp().
 *   - Clear active state: icon+colour coding — the focused icon sits in a soft
 *     green "pill" (primarySoft) and its label switches to the semibold ink
 *     weight, so the current section is obvious at a glance / in sunlight.
 *   - Strong contrast: active = brand green (AA), inactive = darkened `muted`
 *     token (AA on the surface bar).
 *   - Tasteful micro-interaction: the focused icon springs up slightly and the
 *     highlight pill fades in — additive, no layout shift.
 *   - Safe-area aware so the bar clears the home indicator without shrinking the
 *     tap area.
 */

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/** Animated vector icon that lifts and gains a soft pill when focused. Vector
 *  icons tint properly, so the focused/idle state is the brand colour (filled)
 *  vs the muted token (outline) — no emoji opacity hack. */
function TabIcon({
  on,
  off,
  focused,
  size,
  pillW,
  pillH,
}: {
  on: IoniconName;
  off: IoniconName;
  focused: boolean;
  size: number;
  pillW: number;
  pillH: number;
}) {
  // 0 = inactive, 1 = active. Drives the lift + the highlight pill.
  const a = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(a, {
      toValue: focused ? 1 : 0,
      useNativeDriver: true,
      speed: 18,
      bounciness: 7,
    }).start();
  }, [focused, a]);

  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [0, -1] });
  const scale = a.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });

  return (
    <View style={[styles.iconWrap, { width: pillW, height: pillH }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.pill,
          { width: pillW, height: pillH, borderRadius: pillH / 2, opacity: a },
        ]}
      />
      <Animated.View style={{ transform: [{ translateY }, { scale }] }}>
        <Ionicons
          name={focused ? on : off}
          size={size}
          color={focused ? colors.primaryInk : colors.muted}
        />
      </Animated.View>
    </View>
  );
}

function makeIcon(on: IoniconName, off: IoniconName, size: number, pillW: number, pillH: number) {
  return ({ focused }: { focused: boolean }) => (
    <TabIcon on={on} off={off} focused={focused} size={size} pillW={pillW} pillH={pillH} />
  );
}

export default function CustomerLayout() {
  const { t } = useT();
  const { fs, sp, touch } = useScale();
  const insets = useSafeAreaInsets();

  const iconSize = fs(20);
  // The focused-icon highlight pill — comfortably larger than the glyph and
  // scales with field mode.
  const pillH = sp(34);
  const pillW = sp(52);

  // The bar's own content height (icon row + label), then add the device's
  // bottom safe-area inset so the touch area is never eaten by the home bar.
  const barContentHeight = Math.max(sp(58), touch + sp(14));

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primaryInk,
        tabBarInactiveTintColor: colors.muted,
        // Keep the focused-icon pill from being clipped by the bar's top edge.
        tabBarAllowFontScaling: true,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: barContentHeight + insets.bottom,
          paddingBottom: insets.bottom + sp(8),
          paddingTop: sp(8),
          // Soft lift so the bar separates from the parchment content above.
          ...Platform.select({
            ios: {
              shadowColor: '#1a1916',
              shadowOpacity: 0.06,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: -4 },
            },
            android: { elevation: 12 },
            default: {},
          }),
        },
        // Center each item and give it the full comfortable tap height.
        tabBarItemStyle: {
          minHeight: touch,
          paddingVertical: sp(2),
        },
        tabBarIconStyle: { marginBottom: sp(2) },
        tabBarLabelStyle: {
          fontFamily: fonts.uiMedium,
          fontSize: fs(11),
          letterSpacing: 0.2,
          marginTop: sp(2),
          // Never let a longer (e.g. Nepali) label clip — let it breathe.
          includeFontPadding: false,
        } as object,
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: t('tabs.field'),
          tabBarAccessibilityLabel: t('tabs.field'),
          tabBarIcon: makeIcon('leaf', 'leaf-outline', iconSize, pillW, pillH),
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: t('tabs.analytics'),
          tabBarAccessibilityLabel: t('tabs.analytics'),
          tabBarIcon: makeIcon('stats-chart', 'stats-chart-outline', iconSize, pillW, pillH),
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: t('tabs.alerts'),
          tabBarAccessibilityLabel: t('tabs.alerts'),
          tabBarIcon: makeIcon('notifications', 'notifications-outline', iconSize, pillW, pillH),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t('tabs.account'),
          tabBarAccessibilityLabel: t('tabs.account'),
          tabBarIcon: makeIcon('person-circle', 'person-circle-outline', iconSize, pillW, pillH),
        }}
      />

      {/* History is reachable from analytics/dashboard but kept off the bar. */}
      <Tabs.Screen name="history" options={{ href: null }} />
      {/* Zone detail + the add-zone flow are pushed on top of the tabs. */}
      <Tabs.Screen name="zones/[zoneId]" options={{ href: null }} />
      <Tabs.Screen name="zones/new" options={{ href: null }} />
      {/* Device onboarding is pushed on top of the tabs (off the bar). */}
      <Tabs.Screen name="devices/add" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  pill: {
    position: 'absolute',
    backgroundColor: colors.primarySoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primary,
  },
});

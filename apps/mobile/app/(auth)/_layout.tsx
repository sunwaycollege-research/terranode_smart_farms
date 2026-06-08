import React from 'react';
import { Stack } from 'expo-router';
import { colors } from '../../src/theme/tokens';

/**
 * Auth route group. Without this layout the `(auth)` group has no navigator, so
 * the root layout's `<Stack.Screen name="(auth)" />` resolves to nothing —
 * expo-router then logs "No route named (auth) exists" and crashes reconciling
 * the route tree ("Cannot read property 'find' of undefined"). A thin Stack here
 * makes `(auth)` a real group (mirrors `(customer)/_layout.tsx`).
 */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="login" />
    </Stack>
  );
}

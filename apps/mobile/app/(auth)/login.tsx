import React, { useState } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../../src/auth/AuthContext';
import { Button, Card, Screen, T } from '../../src/components/ui';
import { colors, fonts, radius, spacing } from '../../src/theme/tokens';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);

  async function go(em: string) {
    setBusy(true);
    try {
      await signIn(em, pw);
      router.replace('/');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ alignItems: 'center', marginTop: spacing.xxl, marginBottom: spacing.lg }}>
        <T variant="display" style={{ fontSize: 40 }}>
          TERA<T variant="display" style={{ fontSize: 40, color: colors.primary, fontStyle: 'italic', fontFamily: fonts.displayItalic }}>NODE</T>
        </T>
        <T variant="muted">Zoned soil intelligence · fertigation · field control</T>
      </View>

      <Card style={{ gap: spacing.md }}>
        <T variant="h3">Sign in</T>
        <TextInput
          placeholder="email"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          placeholderTextColor={colors.subtle}
          style={s.input}
        />
        <TextInput
          placeholder="password"
          secureTextEntry
          value={pw}
          onChangeText={setPw}
          placeholderTextColor={colors.subtle}
          style={s.input}
        />
        <Button title={busy ? 'Signing in…' : 'Sign in'} onPress={() => go(email || 'farmer@greenvalley.np')} disabled={busy} />
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <T variant="h3">Demo accounts</T>
        <T variant="muted">Tap to jump straight into a role.</T>
        <View style={{ gap: 8, marginTop: 4 }}>
          <Button variant="ghost" title="🏢  Company admin (TERANODE)" onPress={() => go('admin@teranode.io')} />
          <Button variant="ghost" title="🏪  Retailer (Himalayan AgriTech)" onPress={() => go('sales@himalayan.np')} />
          <Button variant="ghost" title="🌱  Farmer (Green Valley Farm)" onPress={() => go('farmer@greenvalley.np')} />
        </View>
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.r2, paddingHorizontal: 14, paddingVertical: 12, fontFamily: fonts.ui, fontSize: 15, color: colors.ink, backgroundColor: colors.surface2 },
});

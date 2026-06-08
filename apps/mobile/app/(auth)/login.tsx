import React, { useState } from 'react';
import { View, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../../src/auth/AuthContext';
import { Button, Card, Screen, T } from '../../src/components/ui';
import { colors, fonts, radius, spacing } from '../../src/theme/tokens';
import { useScale } from '../../src/theme/scale';
import { useT } from '../../src/i18n';

export default function Login() {
  const { signIn } = useAuth();
  const { t } = useT();
  const { fs, sp, touch } = useScale();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track which field has focus so we can lift its border to the brand focus
  // ring — a clear, high-contrast cue that reads in bright field light.
  const [focused, setFocused] = useState<'email' | 'pw' | null>(null);

  async function go(em: string, password: string) {
    const e = em.trim();
    // No silent fallback to a sample account — require real credentials.
    if (!e || !password) {
      setError(t('auth.invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(e, password);
      router.replace('/');
    } catch {
      setError(t('auth.invalid'));
    } finally {
      setBusy(false);
    }
  }

  // Inputs scale with field mode and never fall below the 44px touch target so
  // imprecise taps land reliably outdoors.
  const inputStyle = (key: 'email' | 'pw') => [
    s.input,
    {
      minHeight: touch,
      paddingHorizontal: sp(14),
      paddingVertical: sp(12),
      fontSize: fs(15),
      borderRadius: radius.r2,
    },
    focused === key && s.inputFocused,
  ];

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ gap: sp(spacing.md) }}
      >
        <View style={{ alignItems: 'center', marginTop: sp(spacing.xxl), marginBottom: sp(spacing.lg), gap: sp(spacing.xs) }}>
          <T variant="display" accessibilityRole="header" style={{ fontSize: fs(40), lineHeight: fs(46) }}>
            TERA
            <T
              variant="display"
              style={{ fontSize: fs(40), lineHeight: fs(46), color: colors.primary, fontStyle: 'italic', fontFamily: fonts.displayItalic }}
            >
              NODE
            </T>
          </T>
          <T variant="muted" style={{ textAlign: 'center' }} tx="common.tagline" />
        </View>

        <Card style={{ gap: sp(spacing.md) }}>
          <T variant="h3" accessibilityRole="header" tx="auth.signInTitle" />

          <View style={{ gap: sp(spacing.xs) }}>
            <T variant="label" nativeID="loginEmailLabel" tx="common.email" />
            <TextInput
              placeholder={t('common.email')}
              accessibilityLabel={t('common.email')}
              accessibilityLabelledBy="loginEmailLabel"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="next"
              editable={!busy}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setError(null);
              }}
              onFocus={() => setFocused('email')}
              onBlur={() => setFocused((f) => (f === 'email' ? null : f))}
              placeholderTextColor={colors.subtle}
              selectionColor={colors.primary}
              style={inputStyle('email')}
            />
          </View>

          <View style={{ gap: sp(spacing.xs) }}>
            <T variant="label" nativeID="loginPwLabel" tx="common.password" />
            <TextInput
              placeholder={t('common.password')}
              accessibilityLabel={t('common.password')}
              accessibilityLabelledBy="loginPwLabel"
              secureTextEntry
              autoComplete="password"
              returnKeyType="go"
              editable={!busy}
              value={pw}
              onChangeText={(v) => {
                setPw(v);
                setError(null);
              }}
              onFocus={() => setFocused('pw')}
              onBlur={() => setFocused((f) => (f === 'pw' ? null : f))}
              onSubmitEditing={() => go(email, pw)}
              placeholderTextColor={colors.subtle}
              selectionColor={colors.primary}
              style={inputStyle('pw')}
            />
          </View>

          {error && (
            <View
              style={[s.errorBox, { padding: sp(spacing.sm), gap: sp(spacing.sm), borderRadius: radius.r2 }]}
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
            >
              <T style={{ fontSize: fs(15) }} accessibilityElementsHidden importantForAccessibility="no">
                ⚠️
              </T>
              <T style={{ flex: 1, color: colors.criticalInk, fontFamily: fonts.uiMedium, fontSize: fs(13), lineHeight: fs(18) }}>
                {error}
              </T>
            </View>
          )}

          <Button
            tx={busy ? 'common.signingIn' : 'common.signIn'}
            onPress={() => go(email, pw)}
            disabled={busy}
          />
        </Card>

        {/* Demo quick-login — dev builds only (never shipped to production). */}
        {__DEV__ && (
          <Card style={{ gap: sp(spacing.sm) }}>
            <T variant="h3" accessibilityRole="header" tx="auth.demoTitle" />
            <T variant="muted" tx="auth.demoSubtitle" />
            <View style={{ marginTop: sp(spacing.xs) }}>
              <Button
                variant="ghost"
                tx="auth.demoFarmer"
                disabled={busy}
                onPress={() => {
                  setEmail('farmer@greenvalley.np');
                  setPw('teranode');
                  void go('farmer@greenvalley.np', 'teranode');
                }}
              />
            </View>
            <T variant="muted" tx="admin.noticeUrl" />
          </Card>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const s = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    fontFamily: fonts.ui,
    color: colors.ink,
    backgroundColor: colors.surface2,
  },
  // Brand focus ring — green border + soft fill so the active field is obvious
  // at a glance, including for low-vision users in sunlight.
  inputFocused: {
    borderColor: colors.focus,
    borderWidth: 2,
    backgroundColor: colors.surface,
  },
  // Red = act: a soft critical chip with an icon so the error is colour- AND
  // shape-coded, not colour alone.
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.criticalSoft,
    borderWidth: 1,
    borderColor: colors.critical,
  },
});

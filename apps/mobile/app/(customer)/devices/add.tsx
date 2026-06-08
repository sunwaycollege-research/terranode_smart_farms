// app/(customer)/devices/add.tsx — Device onboarding for a TERANODE box.
//
// A dead-simple, stepped flow for low-literacy smallholder farmers:
//   1) Power on the box and wait for the light (illustrated with big emoji).
//   2) Connect the phone to the box's SoftAP setup network (TERANODE-XXXX),
//      then enter the home WiFi name + password on the device's portal page.
//      We do NOT do BLE / native provisioning — the box runs its own captive
//      setup portal; we just guide the farmer to it.
//   3) "Waiting for your device…" — POLLS api.farms() (and api.gateway on the
//      first farm) every ~4s until a farm/gateway reports `online`, then shows
//      a big green "✓ connected" with a button back to the dashboard.
//
// Big touch targets, ICON + COLOR coding, one short sentence per step, fully
// bilingual (useT) and scale-aware (useScale → field mode). Loads gracefully
// when there is no farm/gateway yet (that's the expected pre-connect state).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { Button, Card, Divider, Screen, T } from '../../../src/components/ui';
import { api } from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { useT } from '../../../src/i18n';
import { useScale } from '../../../src/theme/scale';
import { colors, elevation, fonts, radius, spacing } from '../../../src/theme/tokens';

const POLL_MS = 4000;
const TOTAL_STEPS = 3;

type Step = 0 | 1 | 2;

/** 1 · 2 · 3 progress header (mirrors the add-zone wizard's stepper). */
function Stepper({ step, connected }: { step: Step; connected: boolean }) {
  const { fs, sp } = useScale();
  const { t } = useT();
  // One spoken summary for the whole progress row so screen-reader users hear
  // "Step 2 of 3" instead of three separate ambiguous dots.
  const current = connected ? TOTAL_STEPS : step + 1;
  const dot = sp(28);
  return (
    <View
      style={s.stepper}
      accessibilityRole="progressbar"
      accessible
      accessibilityLabel={t('onboard.step', { step: current, total: TOTAL_STEPS })}
      accessibilityValue={{ min: 1, max: TOTAL_STEPS, now: current }}
    >
      {[0, 1, 2].map((i) => {
        const done = connected ? true : i < step;
        const active = !connected && i === step;
        return (
          <View key={i} style={s.stepWrap}>
            <View
              importantForAccessibility="no-hide-descendants"
              style={[
                s.stepDot,
                { width: dot, height: dot, borderRadius: dot / 2 },
                done && { backgroundColor: colors.primary, borderColor: colors.primary, ...elevation.e1 },
                active && { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primarySoft },
              ]}
            >
              <T
                style={{
                  fontFamily: active ? fonts.uiBold : fonts.mono,
                  fontSize: fs(done ? 13 : 12),
                  lineHeight: fs(done ? 13 : 12),
                  color: done ? colors.onColor : active ? colors.primaryInk : colors.subtle,
                }}
              >
                {done ? '✓' : i + 1}
              </T>
            </View>
            {i < 2 && (
              <View
                importantForAccessibility="no-hide-descendants"
                style={[s.stepBar, (connected || i < step) && { backgroundColor: colors.primary }]}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

/** Numbered step badge — a small filled circle that mirrors the stepper dots,
 * giving the WiFi sub-steps a consistent, platform-stable look (vs. emoji
 * digits) and strong contrast. Decorative for screen readers (the row's body
 * copy carries the meaning). */
function NumBadge({ n, fs, sp }: { n: number; fs: (v: number) => number; sp: (v: number) => number }) {
  const d = sp(24);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[s.numBadge, { width: d, height: d, borderRadius: d / 2 }]}
    >
      <T style={{ fontFamily: fonts.uiBold, fontSize: fs(13), lineHeight: fs(13), color: colors.primaryInk }}>{n}</T>
    </View>
  );
}

/** Decorative emoji — carries no meaning for screen readers (the labels do). */
function Glyph({ size, children }: { size: number; children: string }) {
  return (
    <T
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ fontSize: size }}
    >
      {children}
    </T>
  );
}

export default function AddDevice() {
  const { session } = useAuth();
  const { t } = useT();
  const { fs, sp, touch } = useScale();

  const accountId = session?.account.id ?? null;

  const [step, setStep] = useState<Step>(0);
  const [connected, setConnected] = useState(false);
  // Whether at least one poll has completed (so the "waiting" copy doesn't flash
  // a stale state on first paint).
  const [polled, setPolled] = useState(false);

  // Keep the latest `connected` flag in a ref so the interval callback can stop
  // itself without being re-created (avoids tearing down/recreating the timer).
  const connectedRef = useRef(false);
  connectedRef.current = connected;

  // One poll tick: a farm with an online gateway (or an online gateway on the
  // first farm) means the box finished SoftAP setup and phoned home.
  const checkOnce = useCallback(async (): Promise<boolean> => {
    try {
      const farms = await api.farms();
      if (!farms.length) return false;
      // Check gateways across the customer's farms; the box binds to one of them.
      for (const f of farms) {
        const gw = await api.gateway(f.id).catch(() => null);
        if (gw?.status === 'online') return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  // Poll only while we're on the "waiting" step and not yet connected.
  useEffect(() => {
    if (step !== 2 || connected || !accountId) return;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      const ok = await checkOnce();
      if (!alive) return;
      setPolled(true);
      if (ok) {
        setConnected(true);
        if (timer) clearInterval(timer);
      }
    };

    void tick(); // immediate first check
    timer = setInterval(() => {
      if (connectedRef.current) {
        if (timer) clearInterval(timer);
        return;
      }
      void tick();
    }, POLL_MS);

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [step, connected, accountId, checkOnce]);

  const openWifiSettings = useCallback(() => {
    // Best-effort deep link to the OS WiFi settings; never throws at the farmer.
    const url = Platform.OS === 'ios' ? 'App-Prefs:root=WIFI' : 'android.settings.WIFI_SETTINGS';
    Linking.openURL(url).catch(() => {
      void Linking.openSettings().catch(() => {});
    });
  }, []);

  /* ----- header (title + back) ----- */
  const backSize = Math.max(sp(36), touch - sp(8));
  const Header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(spacing.sm) }}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        style={({ pressed }) => [
          s.backBtn,
          { width: backSize, height: backSize, borderRadius: radius.r2 },
          pressed && { backgroundColor: colors.bgWarm, borderColor: colors.borderStrong, transform: [{ scale: 0.96 }] },
        ]}
      >
        <T style={{ fontSize: fs(24), color: colors.inkSoft, lineHeight: fs(24), marginTop: -fs(2) }}>‹</T>
      </Pressable>
      <T variant="display" tx="onboard.title" style={{ flex: 1 }} accessibilityRole="header" />
    </View>
  );

  // ==========================================================================
  // CONNECTED — big green success.
  // ==========================================================================
  if (connected) {
    const ring = sp(120);
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: false, title: t('onboard.title') }} />
        {Header}
        <View style={[s.hero, { gap: sp(spacing.lg), paddingVertical: sp(spacing.xxl) }]}>
          <View
            style={[
              s.checkCircle,
              { width: ring, height: ring, borderRadius: ring / 2, backgroundColor: colors.healthySoft, borderColor: colors.healthy },
            ]}
          >
            <View
              style={[
                s.checkInner,
                { width: ring * 0.62, height: ring * 0.62, borderRadius: (ring * 0.62) / 2, backgroundColor: colors.healthy, ...elevation.e1 },
              ]}
            >
              <Glyph size={fs(46)}>✓</Glyph>
            </View>
          </View>
          <View style={{ gap: sp(spacing.xs), alignItems: 'center' }} accessible accessibilityRole="header">
            <T variant="display" style={{ textAlign: 'center', color: colors.primaryInk }} tx="onboard.connectedTitle" />
            <T variant="body" style={[s.centerCopy, { color: colors.muted }]} tx="onboard.connectedBody" />
          </View>
        </View>
        <Divider />
        <Button tx="onboard.goDashboard" onPress={() => router.replace('/(customer)/dashboard' as never)} />
      </Screen>
    );
  }

  // ==========================================================================
  // STEPPED FLOW
  // ==========================================================================
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false, title: t('onboard.title') }} />
      {Header}

      <Stepper step={step} connected={connected} />
      <T
        variant="label"
        style={{ color: colors.primaryInk, textAlign: 'center', marginTop: -sp(spacing.xs), letterSpacing: 0.3 }}
        tx="onboard.step"
        txVars={{ step: step + 1, total: TOTAL_STEPS }}
      />

      {/* ----- STEP 1 · power on ----- */}
      {step === 0 && (
        <Card style={{ gap: sp(spacing.lg), alignItems: 'center', paddingVertical: sp(spacing.xl) }}>
          <View style={[s.iconBubble, bubble(sp), { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}>
            <Glyph size={fs(54)}>🔌</Glyph>
          </View>
          <View style={{ gap: sp(spacing.xs), alignItems: 'center' }} accessible>
            <T variant="h2" style={{ textAlign: 'center' }} tx="onboard.step1Title" accessibilityRole="header" />
            <T variant="body" style={s.centerCopy} tx="onboard.step1Body" />
          </View>
          {/* box → steady green light: a tinted track makes the "goal" state read
              clearly for low-literacy users (icon + green = good). */}
          <View
            style={[s.lightRow, { gap: sp(spacing.sm), paddingHorizontal: sp(spacing.lg), paddingVertical: sp(spacing.sm) }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Glyph size={fs(34)}>📦</Glyph>
            <Glyph size={fs(18)}>→</Glyph>
            <Glyph size={fs(34)}>🟢</Glyph>
          </View>
          <T variant="muted" style={[s.centerCopy, { color: colors.subtle }]} tx="onboard.step1Hint" />
        </Card>
      )}

      {/* ----- STEP 2 · connect to the box / enter home WiFi ----- */}
      {step === 1 && (
        <Card style={{ gap: sp(spacing.lg), paddingVertical: sp(spacing.lg) }}>
          <View style={{ alignItems: 'center', gap: sp(spacing.sm) }}>
            <View style={[s.iconBubble, bubble(sp), { backgroundColor: colors.wateringSoft, borderColor: colors.watering }]}>
              <Glyph size={fs(48)}>📶</Glyph>
            </View>
            <T variant="h2" style={{ textAlign: 'center' }} tx="onboard.step2Title" accessibilityRole="header" />
          </View>

          {/* the network name to look for, shown as a clear mono chip */}
          <View
            style={[s.ssidChip, { gap: sp(spacing.sm), paddingHorizontal: sp(spacing.lg), paddingVertical: sp(10) }]}
            accessible
            accessibilityRole="text"
            accessibilityLabel="TERANODE-XXXX"
          >
            <Glyph size={fs(18)}>📡</Glyph>
            <T variant="mono" style={{ fontSize: fs(16), color: colors.ink, letterSpacing: 0.4 }}>
              TERANODE-XXXX
            </T>
          </View>

          {/* numbered steps — circular badges match the stepper's visual language
              (instead of platform-variable 1️⃣/2️⃣ emoji), with strong contrast. */}
          <View style={{ gap: sp(spacing.md) }}>
            <View style={[s.bulletRow, { gap: sp(spacing.md) }]} accessible>
              <NumBadge n={1} fs={fs} sp={sp} />
              <T variant="body" style={{ flex: 1 }} tx="onboard.step2Body" />
            </View>
            <View style={[s.bulletRow, { gap: sp(spacing.md) }]} accessible>
              <NumBadge n={2} fs={fs} sp={sp} />
              <T variant="body" style={{ flex: 1 }} tx="onboard.step2Body2" />
            </View>
          </View>

          <Button variant="accent" tx="onboard.openWifi" onPress={openWifiSettings} />
          <T variant="muted" style={[s.centerCopy, { color: colors.subtle }]} tx="onboard.step2Hint" />
        </Card>
      )}

      {/* ----- STEP 3 · waiting for the device ----- */}
      {step === 2 && (
        <Card style={{ gap: sp(spacing.lg), alignItems: 'center', paddingVertical: sp(spacing.xl) }}>
          <View
            style={[s.iconBubble, bubble(sp), { backgroundColor: colors.warnSoft, borderColor: colors.warn }]}
            accessibilityRole="progressbar"
          >
            <Glyph size={fs(48)}>📡</Glyph>
            <View style={[s.spinnerBadge, { width: sp(28), height: sp(28), borderRadius: sp(14) }]}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          </View>
          <View style={{ gap: sp(spacing.xs), alignItems: 'center' }} accessible accessibilityLiveRegion="polite">
            <T variant="h2" style={{ textAlign: 'center' }} tx="onboard.waitingTitle" accessibilityRole="header" />
            <T variant="body" style={[s.centerCopy, { color: colors.muted }]} tx="onboard.waitingBody" />
          </View>
          {polled && (
            <Button variant="ghost" small tx="onboard.tryAgain" onPress={() => void checkOnce().then((ok) => ok && setConnected(true))} />
          )}
        </Card>
      )}

      {/* ----- footer nav ----- */}
      <View style={{ flexDirection: 'row', gap: sp(spacing.sm), marginTop: sp(spacing.sm) }}>
        {step > 0 && (
          <View style={{ flex: 1 }}>
            <Button variant="ghost" tx="common.back" onPress={() => setStep((step - 1) as Step)} />
          </View>
        )}
        {step < 2 && (
          <View style={{ flex: 2 }}>
            <Button tx={step === 0 ? 'onboard.start' : 'common.next'} onPress={() => setStep((step + 1) as Step)} />
          </View>
        )}
      </View>
    </Screen>
  );
}

/** Scale-aware illustration-bubble dimensions (kept circular + ≥ field size). */
const bubble = (sp: (v: number) => number) => {
  const d = sp(96);
  return { width: d, height: d, borderRadius: d / 2 };
};

const s = StyleSheet.create({
  backBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  // stepper (shared visual language with zones/new.tsx)
  stepper: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  stepWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  stepDot: {
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBar: { flex: 1, height: 2, backgroundColor: colors.border, marginHorizontal: 6 },
  // illustration bubbles — a soft tinted disc with a thin signal-coloured ring
  // so each step is icon + colour coded (green/blue/amber) for low-literacy use.
  iconBubble: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  // small spinner tucked onto the waiting-step bubble so motion reads as "live".
  spinnerBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...elevation.e1,
  },
  lightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.surface2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  // numbered sub-step badge for the WiFi instructions (matches stepper dots).
  numBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
    marginTop: 1,
  },
  // centred plain-language copy — capped width keeps lines short & scannable.
  centerCopy: { textAlign: 'center', maxWidth: 300, alignSelf: 'center' },
  // wifi — the network name is the key thing to find, so give it a touch of
  // elevation + a brighter surface so it stands out as the actionable detail.
  ssidChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    ...elevation.e1,
  },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start' },
  // success
  hero: { alignItems: 'center' },
  checkCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  checkInner: { alignItems: 'center', justifyContent: 'center' },
});

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextProps,
  View,
  ViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, elevation, fonts, radius, spacing } from '../theme/tokens';
import { useScale } from '../theme/scale';
import { useT, type TranslationKey } from '../i18n';

/* ---------- Typography ----------
 * <T> is the single text primitive. It is now:
 *   - i18n-aware: pass `tx` (a typed translation key) + optional `txVars` and the
 *     current-language string is rendered; `children` still works for raw text.
 *   - scale-aware: the variant's base font size is multiplied by the field-mode
 *     scale so every label/number grows in large-touch mode automatically.
 * Existing call sites (variant + children + style) keep working unchanged. */
type TVariant = 'display' | 'h2' | 'h3' | 'body' | 'label' | 'mono' | 'muted';

const baseSize: Record<TVariant, number> = {
  display: 30,
  h2: 19,
  h3: 11,
  body: 15, // bumped 14→15 for farmer legibility (still scales in field mode)
  label: 13,
  mono: 14,
  muted: 12,
};

// Per-variant line-height multipliers — headings tight, body/copy roomy so
// multi-line plain-language text stays readable (and scales in field mode).
const lineMul: Record<TVariant, number> = {
  display: 1.13,
  h2: 1.25,
  h3: 1.3,
  body: 1.45,
  label: 1.3,
  mono: 1.3,
  muted: 1.4,
};

const typeStyle: Record<TVariant, object> = {
  display: { fontFamily: fonts.display, color: colors.ink },
  h2: { fontFamily: fonts.uiSemibold, color: colors.ink, letterSpacing: -0.2 },
  h3: { fontFamily: fonts.uiSemibold, color: colors.muted, letterSpacing: 0.9, textTransform: 'uppercase' },
  body: { fontFamily: fonts.ui, color: colors.inkSoft },
  label: { fontFamily: fonts.uiMedium, color: colors.muted },
  mono: { fontFamily: fonts.mono, color: colors.ink },
  muted: { fontFamily: fonts.ui, color: colors.muted },
};

export function T({
  variant = 'body',
  style,
  tx,
  txVars,
  children,
  ...p
}: TextProps & {
  variant?: TVariant;
  /** Typed i18n key — when set, the translated string is rendered. */
  tx?: TranslationKey;
  /** Interpolation vars for `tx` (e.g. { day: 3, total: 45 }). */
  txVars?: Record<string, string | number>;
}) {
  const { t } = useT();
  const { fs } = useScale();
  const content = tx != null ? t(tx, txVars) : children;
  // Font size AND line-height scale together so copy stays legible (and never
  // clips) in large-touch field mode, for every variant.
  const size = fs(baseSize[variant]);
  const scaled = { fontSize: size, lineHeight: Math.round(size * lineMul[variant]) };
  return (
    <Text {...p} style={[typeStyle[variant], scaled, style]}>
      {content}
    </Text>
  );
}

/* ---------- Screen ---------- */
export function Screen({ children, scroll = true, style }: { children: React.ReactNode; scroll?: boolean; style?: object }) {
  const { sp } = useScale();
  // In non-scroll mode the inner must fill the screen (flex:1) so flex children
  // — e.g. the CropPicker's category chips + crop list — get height instead of
  // collapsing to 0px (which made the Add-zone crop list look empty).
  const inner = (
    <View style={[{ padding: sp(spacing.lg), gap: sp(spacing.md) }, scroll ? null : { flex: 1 }, style]}>
      {children}
    </View>
  );
  return (
    <SafeAreaView edges={['top']} style={s.screen}>
      {scroll ? <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>{inner}</ScrollView> : inner}
    </SafeAreaView>
  );
}

/* ---------- Card ---------- */
export function Card({ children, style, ...p }: ViewProps & { children: React.ReactNode }) {
  return (
    <View {...p} style={[s.card, style]}>
      {children}
    </View>
  );
}
export function CardTitle({ children, tx }: { children?: React.ReactNode; tx?: TranslationKey }) {
  const { sp } = useScale();
  return (
    <T variant="h3" tx={tx} accessibilityRole="header" style={{ marginBottom: sp(spacing.sm) }}>
      {children}
    </T>
  );
}

/* ---------- Button ---------- */
export function Button({
  title,
  tx,
  onPress,
  variant = 'primary',
  disabled,
  small,
}: {
  title?: string;
  /** Typed i18n key for the label (preferred over `title`). */
  tx?: TranslationKey;
  onPress?: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'accent';
  disabled?: boolean;
  small?: boolean;
}) {
  const { t } = useT();
  const { fs, sp, touch } = useScale();
  const label = tx != null ? t(tx) : (title ?? '');
  // Resting + pressed backgrounds give a real tactile colour shift instead of a
  // flat opacity dip, which reads better in bright sunlight.
  const bg =
    variant === 'primary'
      ? colors.primary
      : variant === 'accent'
        ? colors.accent
        : variant === 'danger'
          ? colors.critical
          : colors.surface2;
  const bgPressed =
    variant === 'primary'
      ? colors.primaryPressed
      : variant === 'accent'
        ? colors.accentPressed
        : variant === 'danger'
          ? colors.criticalInk
          : colors.bgWarm;
  const fg = variant === 'ghost' ? colors.ink : colors.onColor;
  // Small buttons keep a comfortable tap area even when visually compact, via
  // hitSlop, so they still clear the 44px guideline for imprecise field taps.
  const slop = small ? Math.max(0, Math.round((touch - sp(36)) / 2)) : 0;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={label}
      hitSlop={slop}
      style={({ pressed }) => [
        s.btn,
        {
          backgroundColor: disabled ? bg : pressed ? bgPressed : bg,
          opacity: disabled ? 0.45 : 1,
          minHeight: small ? sp(36) : touch,
          paddingVertical: small ? sp(8) : sp(13),
          paddingHorizontal: sp(spacing.lg),
          borderWidth: variant === 'ghost' ? 1 : 0,
          borderColor: pressed && variant === 'ghost' ? colors.borderStrong : colors.border,
          transform: [{ scale: pressed && !disabled ? 0.98 : 1 }],
        },
      ]}
    >
      <Text style={{ fontFamily: fonts.uiSemibold, color: fg, fontSize: fs(small ? 13 : 15), letterSpacing: 0.2 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/* ---------- Pill ---------- */
export function Pill({ label, color = colors.muted, dot }: { label: string; color?: string; dot?: boolean }) {
  const { fs } = useScale();
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[s.pill, { borderColor: colors.border }]}
    >
      {dot && <View style={[s.dot, { backgroundColor: color }]} />}
      <Text style={{ fontFamily: fonts.mono, fontSize: fs(11), color, letterSpacing: 0.2 }}>{label}</Text>
    </View>
  );
}

/* ---------- Toggle (segmented switch) ---------- */
export function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={() => !disabled && onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      // Generous slop: the track itself is compact but the tap area is full-size.
      hitSlop={12}
      style={[
        s.toggleTrack,
        {
          backgroundColor: value ? colors.primary : colors.surface2,
          borderColor: value ? colors.primary : colors.borderStrong,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      <View style={[s.toggleKnob, { alignSelf: value ? 'flex-end' : 'flex-start' }]} />
    </Pressable>
  );
}

/* ---------- Segmented (Auto/Manual etc.) ---------- */
export function Segmented<O extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: O[];
  value: O;
  onChange: (o: O) => void;
  /** Optional display labels (e.g. localized); falls back to UPPERCASED option. */
  labels?: Partial<Record<O, string>>;
}) {
  const { fs, sp, touch } = useScale();
  // Each segment fills at least the comfortable touch height; the whole control
  // also acts as a radio group for screen readers.
  const segMin = Math.max(sp(34), touch - sp(10));
  return (
    <View style={[s.segmented, { padding: sp(3), gap: sp(3) }]} accessibilityRole="radiogroup">
      {options.map((o) => {
        const active = o === value;
        const text = labels?.[o] ?? o.toUpperCase();
        return (
          <Pressable
            key={o}
            onPress={() => onChange(o)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={text}
            style={({ pressed }) => [
              s.segItem,
              { minHeight: segMin, paddingVertical: sp(8) },
              active && s.segItemActive,
              pressed && !active && { backgroundColor: colors.bgWarm },
            ]}
          >
            <Text
              style={{
                fontFamily: active ? fonts.uiSemibold : fonts.mono,
                fontSize: fs(12),
                color: active ? colors.ink : colors.muted,
              }}
            >
              {text}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------- Loading ----------
 * Standardises the repeated "spinner + caption" first-load pattern so every
 * screen shows a consistent, centred, accessible loading state. Additive: opt
 * in per screen; existing inline spinners keep working. */
export function Loading({ tx = 'common.loading', message }: { tx?: TranslationKey; message?: string }) {
  const { sp } = useScale();
  return (
    <View style={[s.loading, { gap: sp(spacing.sm), paddingVertical: sp(spacing.xxl) }]} accessibilityRole="progressbar">
      <ActivityIndicator color={colors.primary} />
      <T variant="muted" tx={message == null ? tx : undefined}>
        {message}
      </T>
    </View>
  );
}

/* ---------- Divider ----------
 * Hairline separator for dense lists. `inset` indents it to align under text. */
export function Divider({ inset = 0, style }: { inset?: number; style?: object }) {
  return <View style={[s.divider, inset ? { marginLeft: inset } : null, style]} />;
}

/* ---------- EmptyState ---------- */
export function EmptyState({ icon = '🌱', tx, message }: { icon?: string; tx?: TranslationKey; message?: string }) {
  const { fs, sp } = useScale();
  return (
    <View style={[s.empty, { paddingVertical: sp(spacing.xxl) }]} accessible accessibilityRole="text">
      <View style={[s.emptyIcon, { width: sp(56), height: sp(56), borderRadius: sp(28), marginBottom: sp(spacing.md) }]}>
        <Text style={{ fontSize: fs(30) }}>{icon}</Text>
      </View>
      <T variant="body" tx={tx} style={{ textAlign: 'center', color: colors.muted, maxWidth: 280 }}>
        {message}
      </T>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.r3, padding: spacing.lg, ...elevation.e1 },
  btn: { borderRadius: radius.r2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface2, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 5 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  toggleTrack: { width: 46, height: 26, borderRadius: radius.pill, padding: 3, justifyContent: 'center', borderWidth: 1 },
  toggleKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', ...elevation.e1 },
  segmented: { flexDirection: 'row', backgroundColor: colors.surface2, borderRadius: radius.r2, borderWidth: 1, borderColor: colors.borderSoft },
  segItem: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.r1 },
  segItemActive: { backgroundColor: colors.surface, ...elevation.e1 },
  loading: { alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline },
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
});

import React from 'react';
import {
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
  body: 14,
  label: 13,
  mono: 14,
  muted: 12,
};

const typeStyle: Record<TVariant, object> = {
  display: { fontFamily: fonts.display, color: colors.ink, lineHeight: 34 },
  h2: { fontFamily: fonts.uiSemibold, color: colors.ink },
  h3: { fontFamily: fonts.uiSemibold, color: colors.muted, letterSpacing: 0.8, textTransform: 'uppercase' },
  body: { fontFamily: fonts.ui, color: colors.inkSoft, lineHeight: 20 },
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
  // line-height (display only) must scale alongside fontSize.
  const scaled =
    variant === 'display' ? { fontSize: fs(baseSize.display), lineHeight: fs(34) } : { fontSize: fs(baseSize[variant]) };
  return (
    <Text {...p} style={[typeStyle[variant], scaled, style]}>
      {content}
    </Text>
  );
}

/* ---------- Screen ---------- */
export function Screen({ children, scroll = true, style }: { children: React.ReactNode; scroll?: boolean; style?: object }) {
  const { sp } = useScale();
  const inner = <View style={[{ padding: sp(spacing.lg), gap: sp(spacing.md) }, style]}>{children}</View>;
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
  return (
    <T variant="h3" tx={tx} style={{ marginBottom: spacing.sm }}>
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
  const { fs, touch } = useScale();
  const label = tx != null ? t(tx) : (title ?? '');
  const bg =
    variant === 'primary'
      ? colors.primary
      : variant === 'accent'
        ? colors.accent
        : variant === 'danger'
          ? colors.critical
          : colors.surface2;
  const fg = variant === 'ghost' ? colors.ink : '#fff';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        {
          backgroundColor: bg,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
          minHeight: small ? undefined : touch,
          paddingVertical: small ? 8 : 13,
          borderWidth: variant === 'ghost' ? 1 : 0,
          borderColor: colors.border,
        },
      ]}
    >
      <Text style={{ fontFamily: fonts.uiSemibold, color: fg, fontSize: fs(small ? 13 : 15) }}>{label}</Text>
    </Pressable>
  );
}

/* ---------- Pill ---------- */
export function Pill({ label, color = colors.muted, dot }: { label: string; color?: string; dot?: boolean }) {
  const { fs } = useScale();
  return (
    <View style={[s.pill, { borderColor: colors.border }]}>
      {dot && <View style={[s.dot, { backgroundColor: color }]} />}
      <Text style={{ fontFamily: fonts.mono, fontSize: fs(11), color }}>{label}</Text>
    </View>
  );
}

/* ---------- Toggle (segmented switch) ---------- */
export function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={() => !disabled && onChange(!value)}
      style={[s.toggleTrack, { backgroundColor: value ? colors.primary : colors.surface2, opacity: disabled ? 0.45 : 1 }]}
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
  const { fs } = useScale();
  return (
    <View style={s.segmented}>
      {options.map((o) => {
        const active = o === value;
        return (
          <Pressable key={o} onPress={() => onChange(o)} style={[s.segItem, active && { backgroundColor: colors.surface }]}>
            <Text style={{ fontFamily: fonts.mono, fontSize: fs(12), color: active ? colors.ink : colors.muted }}>
              {labels?.[o] ?? o.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------- EmptyState ---------- */
export function EmptyState({ icon = '🌱', tx, message }: { icon?: string; tx?: TranslationKey; message?: string }) {
  return (
    <View style={s.empty}>
      <Text style={{ fontSize: 34, marginBottom: spacing.sm }}>{icon}</Text>
      <T variant="muted" tx={tx} style={{ textAlign: 'center' }}>
        {message}
      </T>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.r3, padding: spacing.lg, ...elevation.e1 },
  btn: { borderRadius: radius.r2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface2, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  toggleTrack: { width: 46, height: 26, borderRadius: radius.pill, padding: 3, justifyContent: 'center' },
  toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  segmented: { flexDirection: 'row', backgroundColor: colors.surface2, borderRadius: radius.r2, padding: 3, gap: 3 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.r1 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl },
});

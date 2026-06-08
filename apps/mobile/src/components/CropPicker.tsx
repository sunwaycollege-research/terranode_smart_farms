import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { CropRef, CropCategory } from '@teranode/types';
import { colors, fonts, radius, spacing } from '../theme/tokens';
import { useScale } from '../theme/scale';
import { useT, type Lang, type TranslationKey } from '../i18n';
import { EmptyState, T } from './ui';

/* ---------------------------------------------------------------------------
 * CropPicker — searchable, category-filterable crop list.
 *
 * Fed by api.crops() → CropRef[]. Each row shows the emoji, the localized name
 * (en/ne by current language, with the other script as a subtitle), days-to-
 * harvest, and a short climate-fit hint derived from the crop's ideal air/soil
 * temperature band. Tapping a row calls onSelect(crop).
 * ------------------------------------------------------------------------- */

const CATEGORIES: CropCategory[] = ['fruiting', 'leafy', 'root', 'bulb', 'legume', 'brassica'];

const CAT_KEY: Record<CropCategory, TranslationKey> = {
  fruiting: 'cat.fruiting',
  leafy: 'cat.leafy',
  root: 'cat.root',
  bulb: 'cat.bulb',
  legume: 'cat.legume',
  brassica: 'cat.brassica',
};

/** Localized name (current language first), with the alternate as subtitle. */
function names(crop: CropRef, lang: Lang): { primary: string; secondary: string } {
  return lang === 'ne'
    ? { primary: crop.nameNe, secondary: crop.nameEn }
    : { primary: crop.nameEn, secondary: crop.nameNe };
}

/**
 * A short climate-fit hint from the crop's ideal air-temperature band. Advisory
 * only — mirrors how the agronomy bands classify warm vs. cool-season crops.
 */
export function climateFit(crop: CropRef): { en: string; ne: string; emoji: string } {
  // Defensive: never let one crop with a missing/short airTemp band throw and
  // blank the whole list — fall back to a neutral hint.
  const band = crop.ideal?.airTemp;
  if (!band || band.length < 2) {
    return { en: 'Air temp —', ne: 'हावा तापक्रम —', emoji: '🌤️' };
  }
  const [lo, hi] = band;
  const mid = (lo + hi) / 2;
  if (mid >= 24) return { en: `Warm season · ${lo}–${hi}°C`, ne: `न्यानो मौसम · ${lo}–${hi}°C`, emoji: '🔥' };
  if (mid <= 18) return { en: `Cool season · ${lo}–${hi}°C`, ne: `चिसो मौसम · ${lo}–${hi}°C`, emoji: '❄️' };
  return { en: `Mild · ${lo}–${hi}°C`, ne: `सम मौसम · ${lo}–${hi}°C`, emoji: '🌤️' };
}

function CropRow({ crop, selected, onPress }: { crop: CropRef; selected: boolean; onPress: () => void }) {
  const { t, lang } = useT();
  const { fs, touch } = useScale();
  const nm = names(crop, lang);
  const fit = climateFit(crop);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        { minHeight: touch },
        selected && { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primarySoft },
        pressed && !selected && { borderColor: colors.borderStrong, backgroundColor: colors.surface2 },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${nm.primary}, ${crop.daysToHarvest} ${t('common.days')}`}
    >
      <T style={{ fontSize: fs(26), width: 34, textAlign: 'center' }} accessibilityElementsHidden importantForAccessibility="no">{crop.emoji}</T>
      <View style={{ flex: 1 }}>
        <View style={s.rowTop}>
          <T style={{ fontFamily: fonts.uiSemibold, fontSize: fs(15), color: colors.ink }}>{nm.primary}</T>
          <T variant="muted">· {nm.secondary}</T>
        </View>
        <View style={s.hint}>
          <T variant="muted">{fit.emoji}</T>
          <T variant="muted">{lang === 'ne' ? fit.ne : fit.en}</T>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <T style={{ fontFamily: fonts.mono, fontSize: fs(15), color: colors.primaryInk, fontVariant: ['tabular-nums'] }}>{crop.daysToHarvest}</T>
        <T variant="muted">{t('common.days')}</T>
      </View>
    </Pressable>
  );
}

export function CropPicker({
  crops,
  loading,
  selectedId,
  onSelect,
}: {
  crops: CropRef[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (crop: CropRef) => void;
}) {
  const { t, lang } = useT();
  const { fs, touch } = useScale();
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<CropCategory | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return crops.filter((c) => {
      if (cat && c.category !== cat) return false;
      if (!q) return true;
      return (
        c.nameEn.toLowerCase().includes(q) ||
        c.nameNe.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q)
      );
    });
  }, [crops, query, cat]);

  return (
    <View style={{ gap: spacing.md, flex: 1 }}>
      {/* search */}
      <View style={[s.search, { minHeight: touch }]}>
        <T style={{ fontSize: fs(15) }} accessibilityElementsHidden importantForAccessibility="no">🔍</T>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('common.search')}
          placeholderTextColor={colors.subtle}
          style={[s.input, { fontSize: fs(15) }]}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t('common.search')}
        />
      </View>

      {/* category chips */}
      <FlatList
        horizontal
        data={[null, ...CATEGORIES] as (CropCategory | null)[]}
        keyExtractor={(c) => c ?? 'all'}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6 }}
        renderItem={({ item }) => {
          const active = item === cat;
          const label = item == null ? t('assign.allCategories') : t(CAT_KEY[item]);
          return (
            <Pressable
              onPress={() => setCat(item)}
              style={({ pressed }) => [
                s.catChip,
                active && { backgroundColor: colors.primary, borderColor: colors.primary },
                pressed && !active && { backgroundColor: colors.surface2 },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={label}
            >
              <T style={{ fontFamily: active ? fonts.uiSemibold : fonts.uiMedium, fontSize: fs(12), color: active ? '#fff' : colors.muted }}>{label}</T>
            </Pressable>
          );
        }}
      />

      {/* list */}
      {loading ? (
        <View style={{ paddingVertical: spacing.xxl, alignItems: 'center', gap: spacing.sm }}>
          <ActivityIndicator color={colors.primary} />
          <T variant="muted">{t('common.loading')}</T>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ gap: 8, paddingBottom: spacing.lg }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<EmptyState icon="🔍" tx="assign.noCrops" />}
          renderItem={({ item }) => (
            <CropRow crop={item} selected={item.id === selectedId} onPress={() => onSelect(item)} />
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.r2,
    paddingHorizontal: spacing.md,
  },
  input: { flex: 1, paddingVertical: 11, fontFamily: fonts.ui, color: colors.ink },
  catChip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.r3,
    padding: spacing.md,
  },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
});

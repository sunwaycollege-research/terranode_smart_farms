// TERANODE "Field mode" — a global UI scale for outdoor / large-touch use.
//
// FieldModeProvider holds a boolean (persisted to AsyncStorage). useScale()
// returns the live multiplier plus tiny helpers so screens can scale spacing,
// font sizes and touch targets without each one re-implementing the math.
//
//   const { scale, fieldMode, setFieldMode, fs, sp, touch } = useScale();
//   <Text style={{ fontSize: fs(16) }}/>      // 16 normally, 20 in field mode
//   <View style={{ padding: sp(spacing.md) }}/>
//
// Default multiplier 1; field/large-touch 1.25.

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'teranode.fieldMode';

/** Normal vs. large-touch multipliers. */
export const SCALE_NORMAL = 1;
export const SCALE_FIELD = 1.25;

/** Minimum comfortable touch target (px) at scale 1 — grows with field mode. */
const BASE_TOUCH = 44;

interface ScaleState {
  /** true when large-touch field mode is on. */
  fieldMode: boolean;
  /** The active multiplier (SCALE_NORMAL | SCALE_FIELD). */
  scale: number;
  setFieldMode: (on: boolean) => Promise<void>;
  toggleFieldMode: () => Promise<void>;
  /** Scale a font size. */
  fs: (size: number) => number;
  /** Scale a spacing value. */
  sp: (value: number) => number;
  /**
   * Scale a line-height. Defaults to a comfortable 1.4× of the (already scaled)
   * font size for legibility, but a fixed value can be passed too. Keeping this
   * in one place means multi-line copy stays readable in field mode.
   */
  lh: (fontSizeOrLineHeight: number, isLineHeight?: boolean) => number;
  /** A scaled minimum touch target height. */
  touch: number;
}

const ScaleContext = createContext<ScaleState | undefined>(undefined);

async function loadStored(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(STORAGE_KEY)) === '1';
  } catch {
    return false;
  }
}

async function persist(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // best-effort
  }
}

export function FieldModeProvider({ children }: { children: React.ReactNode }) {
  const [fieldMode, setFieldModeState] = useState(false);

  useEffect(() => {
    (async () => {
      setFieldModeState(await loadStored());
    })();
  }, []);

  const setFieldMode = useMemo(
    () => async (on: boolean) => {
      setFieldModeState(on);
      await persist(on);
    },
    []
  );

  const value = useMemo<ScaleState>(() => {
    const scale = fieldMode ? SCALE_FIELD : SCALE_NORMAL;
    return {
      fieldMode,
      scale,
      setFieldMode,
      toggleFieldMode: () => setFieldMode(!fieldMode),
      fs: (size: number) => Math.round(size * scale),
      sp: (v: number) => Math.round(v * scale),
      lh: (v: number, isLineHeight = false) => Math.round((isLineHeight ? v : v * 1.4) * scale),
      touch: Math.round(BASE_TOUCH * scale),
    };
  }, [fieldMode, setFieldMode]);

  return <ScaleContext.Provider value={value}>{children}</ScaleContext.Provider>;
}

/** Access the field-mode scale state. Safe outside the provider (returns defaults). */
export function useScale(): ScaleState {
  const ctx = useContext(ScaleContext);
  if (ctx) return ctx;
  // Graceful fallback so a stray consumer never crashes (e.g. in tests).
  return {
    fieldMode: false,
    scale: SCALE_NORMAL,
    setFieldMode: async () => {},
    toggleFieldMode: async () => {},
    fs: (s: number) => s,
    sp: (v: number) => v,
    lh: (v: number, isLineHeight = false) => Math.round(isLineHeight ? v : v * 1.4),
    touch: BASE_TOUCH,
  };
}

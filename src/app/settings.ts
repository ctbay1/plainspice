/**
 * Display settings: text size, contrast and motion. Each one can follow the device (the default)
 * or be set by hand; they are remembered on the device and applied as attributes on <html>, which
 * the CSS of the app, the editor and the plots read:
 *   data-text-size="normal" | "large" | "x-large"  (125 % and 150 %; no attribute: follow the device)
 *   data-contrast="normal" | "more"                (no attribute: follow prefers-contrast)
 *   data-motion="normal" | "reduce"                (no attribute: follow prefers-reduced-motion)
 */
import { readStored, STORAGE_KEYS, writeStored } from './storage.ts';

export type TextSize = 'device' | 'normal' | 'large' | 'x-large';
export type Contrast = 'device' | 'normal' | 'more';
export type Motion = 'device' | 'normal' | 'reduce';

export interface Settings {
  textSize: TextSize;
  contrast: Contrast;
  motion: Motion;
}

export const DEFAULT_SETTINGS: Settings = { textSize: 'device', contrast: 'device', motion: 'device' };

export const TEXT_SIZES: readonly TextSize[] = ['device', 'normal', 'large', 'x-large'];
export const CONTRASTS: readonly Contrast[] = ['device', 'normal', 'more'];
export const MOTIONS: readonly Motion[] = ['device', 'normal', 'reduce'];

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

/** Settings from stored text; anything missing, unknown or damaged falls back to "follow my device". */
export function parseSettings(stored: string | null): Settings {
  if (!stored) return { ...DEFAULT_SETTINGS };
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    textSize: pick(r['textSize'], TEXT_SIZES, 'device'),
    contrast: pick(r['contrast'], CONTRASTS, 'device'),
    motion: pick(r['motion'], MOTIONS, 'device'),
  };
}

export function loadSettings(): Settings {
  return parseSettings(readStored(STORAGE_KEYS.settings));
}

export function saveSettings(settings: Settings): boolean {
  return writeStored(STORAGE_KEYS.settings, JSON.stringify(settings));
}

/** Put the settings on <html> (or another root, in tests). "device" removes the attribute. */
export function applySettings(settings: Settings, root: HTMLElement = document.documentElement): void {
  const set = (name: string, value: string): void => {
    if (value === 'device') root.removeAttribute(name);
    else if (root.getAttribute(name) !== value) root.setAttribute(name, value);
  };
  set('data-text-size', settings.textSize);
  set('data-contrast', settings.contrast);
  set('data-motion', settings.motion);
}

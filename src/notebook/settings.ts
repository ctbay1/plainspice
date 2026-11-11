/**
 * The "Handwriting / Plain font" setting (decision 0014): results on the drawing are handwritten in
 * Caveat, or written in the plain sans of the rest of the page for anyone who reads handwriting
 * slowly (dyslexia, low vision, a long session). It switches at once and is remembered on the
 * device. Storage can throw or be missing (a private window, blocked site data): the setting then
 * still works, it is only not remembered. Plain TypeScript: React reads it with
 * useSyncExternalStore (subscribe, get).
 */

export type ResultFont = 'handwriting' | 'plain';

export const RESULT_FONTS: readonly ResultFont[] = ['handwriting', 'plain'];

/** The key, with the app's prefix (src/app/storage.ts). */
export const RESULT_FONT_KEY = 'plainspice:result-font';

/** What the setting says, in the UI's words. */
export const RESULT_FONT_STRINGS = {
  label: 'Results on the drawing',
  handwriting: 'Handwriting',
  plain: 'Plain font',
  hint: 'The plain font is easier to read for some people; the numbers stay the same.',
  useHandwriting: 'Write results by hand',
  usePlain: 'Write results in the plain font',
} as const;

/** The part of Storage this needs (localStorage, or a stand-in in tests). */
export interface SettingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const defaultStorage = (): SettingStorage | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

/** The stored choice; handwriting when nothing (readable) is stored. */
export function readResultFont(storage: SettingStorage | undefined = defaultStorage()): ResultFont {
  try {
    const v = storage?.getItem(RESULT_FONT_KEY);
    return v === 'plain' ? 'plain' : 'handwriting';
  } catch {
    return 'handwriting';
  }
}

/** Remembers the choice; false when the device would not store it. */
export function writeResultFont(font: ResultFont, storage: SettingStorage | undefined = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(RESULT_FONT_KEY, font);
    return true;
  } catch {
    return false;
  }
}

export interface ResultFontStore {
  get(): ResultFont;
  set(font: ResultFont): void;
  toggle(): ResultFont;
  subscribe(listener: () => void): () => void;
}

/** The setting for one page: read once, changed at once, remembered when the device allows. */
export function createResultFontStore(storage: SettingStorage | undefined = defaultStorage()): ResultFontStore {
  let current = readResultFont(storage);
  const listeners = new Set<() => void>();
  const set = (font: ResultFont): void => {
    if (font === current) return;
    current = font;
    writeResultFont(font, storage);
    for (const l of Array.from(listeners)) l();
  };
  return {
    get: () => current,
    set,
    toggle() {
      set(current === 'plain' ? 'handwriting' : 'plain');
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

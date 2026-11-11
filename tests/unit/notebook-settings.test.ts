/** src/notebook/settings.ts: the Handwriting / Plain font setting, remembered when the device allows. */
import { describe, expect, it, vi } from 'vitest';
import { RESULT_FONT_KEY, createResultFontStore, readResultFont, writeResultFont, type SettingStorage } from '../../src/notebook/index.ts';

function memory(): SettingStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
const broken: SettingStorage = {
  getItem: () => {
    throw new Error('SecurityError: blocked');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('the stored choice', () => {
  it('is handwriting until the plain font is chosen', () => {
    const s = memory();
    expect(readResultFont(s)).toBe('handwriting');
    expect(writeResultFont('plain', s)).toBe(true);
    expect(s.data.get(RESULT_FONT_KEY)).toBe('plain');
    expect(readResultFont(s)).toBe('plain');
  });

  it('reads anything else as handwriting', () => {
    const s = memory();
    s.data.set(RESULT_FONT_KEY, 'comic sans');
    expect(readResultFont(s)).toBe('handwriting');
  });

  it('works without storage, or when storage throws: the choice is only not remembered', () => {
    expect(readResultFont(broken)).toBe('handwriting');
    expect(writeResultFont('plain', broken)).toBe(false);
    expect(readResultFont(undefined)).toBe('handwriting');
    expect(writeResultFont('plain', undefined)).toBe(false);
    const store = createResultFontStore(broken);
    store.set('plain');
    expect(store.get()).toBe('plain');
  });

  it('uses the app’s key prefix', () => {
    expect(RESULT_FONT_KEY.startsWith('plainspice:')).toBe(true);
  });
});

describe('the store', () => {
  it('switches at once, tells every listener, and remembers', () => {
    const s = memory();
    const store = createResultFontStore(s);
    const heard = vi.fn();
    const stop = store.subscribe(heard);
    expect(store.toggle()).toBe('plain');
    expect(heard).toHaveBeenCalledTimes(1);
    expect(s.data.get(RESULT_FONT_KEY)).toBe('plain');
    store.set('plain');
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    store.set('handwriting');
    expect(heard).toHaveBeenCalledTimes(1);
    expect(createResultFontStore(s).get()).toBe('handwriting');
  });
});

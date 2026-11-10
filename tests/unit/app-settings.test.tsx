// @vitest-environment jsdom
/**
 * Display settings (src/app/settings.ts) and safe storage (src/app/storage.ts): every setting
 * defaults to "follow my device", damaged or unknown stored values fall back to it, a storage that
 * throws (private windows, blocked site data) never breaks the app, and the settings land on <html>
 * as the attributes the CSS reads.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applySettings, DEFAULT_SETTINGS, loadSettings, parseSettings, saveSettings } from '../../src/app/settings.ts';
import { readStored, writeStored } from '../../src/app/storage.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  for (const a of ['data-text-size', 'data-contrast', 'data-motion']) document.documentElement.removeAttribute(a);
});

describe('parseSettings', () => {
  it('defaults to "follow my device" for everything', () => {
    expect(DEFAULT_SETTINGS).toEqual({ textSize: 'device', contrast: 'device', motion: 'device' });
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('reads what was saved', () => {
    expect(parseSettings('{"textSize":"x-large","contrast":"more","motion":"reduce"}')).toEqual({ textSize: 'x-large', contrast: 'more', motion: 'reduce' });
  });

  it('falls back per setting on unknown values, and entirely on damaged text', () => {
    expect(parseSettings('{"textSize":"huge","contrast":"more","motion":7}')).toEqual({ textSize: 'device', contrast: 'more', motion: 'device' });
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('"large"')).toEqual(DEFAULT_SETTINGS);
  });
});

describe('remembering settings', () => {
  it('saves and loads through localStorage', () => {
    expect(saveSettings({ textSize: 'large', contrast: 'normal', motion: 'reduce' })).toBe(true);
    expect(loadSettings()).toEqual({ textSize: 'large', contrast: 'normal', motion: 'reduce' });
    expect(localStorage.getItem('plainspice:settings')).toContain('"large"');
  });

  it('a storage that throws is the same as no storage', () => {
    const throwing = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    vi.stubGlobal('localStorage', throwing);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings({ textSize: 'large', contrast: 'more', motion: 'reduce' })).toBe(false);
    expect(readStored('netlist')).toBeNull();
    expect(writeStored('netlist', 'x')).toBe(false);
  });

  it('no storage at all', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
    try {
      expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
      expect(readStored('netlist')).toBeNull();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    }
  });
});

describe('applySettings', () => {
  it('sets the attributes the CSS reads, and removes them to follow the device', () => {
    const html = document.documentElement;
    applySettings({ textSize: 'x-large', contrast: 'more', motion: 'reduce' });
    expect(html.getAttribute('data-text-size')).toBe('x-large');
    expect(html.getAttribute('data-contrast')).toBe('more');
    expect(html.getAttribute('data-motion')).toBe('reduce');
    // "Normal" is a choice of its own: it overrides what the device asks for.
    applySettings({ textSize: 'normal', contrast: 'normal', motion: 'normal' });
    expect(html.getAttribute('data-contrast')).toBe('normal');
    applySettings(DEFAULT_SETTINGS);
    expect(html.hasAttribute('data-text-size')).toBe(false);
    expect(html.hasAttribute('data-contrast')).toBe(false);
    expect(html.hasAttribute('data-motion')).toBe(false);
  });
});

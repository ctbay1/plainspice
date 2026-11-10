/**
 * localStorage, read and written safely: it can throw (private windows, blocked site data,
 * storage full) or be missing, and the app must still work, just without remembering.
 */

const PREFIX = 'plainspice:';

export function readStored(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): boolean {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, value);
    return true;
  } catch {
    return false;
  }
}

/** The keys the app uses (the netlist is the only document; results are never stored). */
export const STORAGE_KEYS = {
  netlist: 'netlist',
  settings: 'settings',
} as const;

/**
 * The app's string catalog (src/i18n): placeholders, plurals, and a catalog a translator can
 * trust (every plural has both forms, nothing empty, and every key is used by the app).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '../../src/i18n/en.ts';
import { t, tn } from '../../src/i18n/index.ts';

describe('t and tn', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(t('lineButton', { line: 3 })).toBe('Line 3');
    expect(t('goToLine', {})).toBe('Go to line {line} in the netlist');
  });

  it('chooses plural forms (and the zero form where the catalog has one)', () => {
    expect(tn('checksCount', 0)).toBe('No traps found.');
    expect(tn('checksCount', 1)).toBe('1 check found.');
    expect(tn('checksCount', 3)).toBe('3 checks found.');
    expect(tn('shareLength', 182)).toBe('The link is 182 characters long.');
  });
});

describe('the catalog', () => {
  const keys = Object.keys(en) as (keyof typeof en)[];

  it('has no empty strings', () => {
    for (const k of keys) expect(en[k].trim(), k).not.toBe('');
  });

  it('every _one has an _other', () => {
    for (const k of keys.filter((k) => k.endsWith('_one'))) expect(keys, k).toContain(k.replace(/_one$/, '_other'));
  });

  it('every key is used by the app', () => {
    const root = resolve(import.meta.dirname, '../../src/app');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f)) files.push(readFileSync(p, 'utf8'));
      }
    };
    walk(root);
    const source = files.join('\n');
    const unused = keys.filter((k) => {
      const base = k.replace(/_(zero|one|other)$/, '');
      return !source.includes(`'${base}'`) && !source.includes(`"${base}"`);
    });
    expect(unused).toEqual([]);
  });
});

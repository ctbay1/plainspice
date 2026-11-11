/**
 * The Notebook look's pieces that must agree with each other: the font widths (metrics.ts, measured
 * from the shipped fonts) and the room they give, the ink symbols on the schematic model's pins and
 * bodies, the text colours' contrast (WCAG 2.2 AA: 4.5:1) and the fonts' licences.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARROW_ICON, INK, NODE_VOLTAGE_ROOM, TYPE, notebookMeasure, resultWidth, widthIn } from '../../src/notebook/index.ts';
import { METRICS } from '../../src/notebook/metrics.ts';
import { PART_LETTERS, SYMBOLS, TEXT } from '../../src/schematic/index.ts';
import { contrastRatio } from '../../src/theme/nodes.ts';

const root = resolve(import.meta.dirname, '../..');

describe('the font widths', () => {
  it('cover printable ASCII and the symbols PlainSpice writes, in every face', () => {
    for (const [face, m] of Object.entries(METRICS)) {
      expect(m.chars.length, face).toBe(m.widths.length);
      for (let c = 32; c < 127; c++) expect(m.chars.includes(String.fromCharCode(c)), `${face} ${String.fromCharCode(c)}`).toBe(true);
      for (const ch of ' µΩ−×…') expect(m.chars.includes(ch), `${face} ${ch}`).toBe(true);
      for (const w of m.widths) expect(w).toBeGreaterThan(0);
    }
  });

  it('keep room for any number: digits count as the widest digit', () => {
    for (const style of [TYPE.hand, TYPE.plain]) {
      const room = widthIn('888.8 mA', style, true);
      for (const n of ['111.1 mA', '444.4 mA', '666.6 mA', '999.9 mA', '123.4 mA']) expect(widthIn(n, style, false)).toBeLessThanOrEqual(room);
    }
    expect(resultWidth('→ 1 A')).toBeGreaterThan(ARROW_ICON.width);
  });

  it('keep the same room for a result in either font, so switching the font moves nothing', () => {
    for (const t of ['delivers', '888.8 mW', '→ 888.8 mA']) {
      expect(notebookMeasure(t, 'result')).toBeGreaterThanOrEqual(widthIn(t, TYPE.hand, true) - 1e-9);
      expect(notebookMeasure(t, 'result')).toBeGreaterThanOrEqual(widthIn(t, TYPE.plain, true) - 1e-9);
    }
    // The model's own sample for a node's result stands for a node voltage in the Notebook.
    expect(notebookMeasure(TEXT.resultChars, 'result')).toBe(resultWidth(NODE_VOLTAGE_ROOM, true));
  });
});

describe('the ink symbols', () => {
  /** The points a path passes through (its numbers, read in pairs; arcs' radii and flags skipped). */
  function points(d: string): [number, number][] {
    const out: [number, number][] = [];
    const re = /([MLHVAZ])([^MLHVAZ]*)/gi;
    let m: RegExpExecArray | null;
    let x = 0;
    let y = 0;
    while ((m = re.exec(d))) {
      const n = (m[2]!.match(/-?\d*\.?\d+/g) ?? []).map(Number);
      switch (m[1]) {
        case 'M':
        case 'L':
          for (let i = 0; i + 1 < n.length; i += 2) out.push([(x = n[i]!), (y = n[i + 1]!)]);
          break;
        case 'H':
          for (const v of n) out.push([(x = v), y]);
          break;
        case 'V':
          for (const v of n) out.push([x, (y = v)]);
          break;
        case 'A':
          for (let i = 0; i + 6 < n.length + 1; i += 7) out.push([(x = n[i + 5]!), (y = n[i + 6]!)]);
          break;
      }
    }
    return out;
  }

  it.each(PART_LETTERS)('%s: leads from its pins to its body, the body inside the model’s', (letter) => {
    const ink = INK[letter];
    const def = SYMBOLS[letter];
    expect(points(ink.leads[0])[0]).toEqual([0, -2]);
    expect(points(ink.leads[0]).at(-1)).toEqual([0, def.body.y0]);
    expect(points(ink.leads[1])[0]).toEqual([0, def.body.y1]);
    expect(points(ink.leads[1]).at(-1)).toEqual([0, 2]);
    for (const [x, y] of [...points(ink.body), ...points(ink.fill ?? '')]) {
      expect(x).toBeGreaterThanOrEqual(def.body.x0 - 1e-9);
      expect(x).toBeLessThanOrEqual(def.body.x1 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(def.body.y0 - 1e-9);
      expect(y).toBeLessThanOrEqual(def.body.y1 + 1e-9);
    }
  });
});

describe('text colours (WCAG 2.2 AA: 4.5:1)', () => {
  const css = readFileSync(resolve(root, 'src/notebook/notebook.css'), 'utf8');
  const token = (name: string): string => {
    const m = new RegExp(`--nb-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
    if (!m) throw new Error(`no --nb-${name}`);
    return m[1]!;
  };
  const backgrounds = ['paper', 'paper-raised', 'card'];
  it.each(['ink', 'ink-2', 'pencil', 'amber-text', 'red-text', 'green-text'])('--nb-%s on the paper and the cards', (name) => {
    for (const bg of backgrounds) expect(contrastRatio(token(name), token(bg)), `${name} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['screen-ink', 'screen-muted', 'screen-amber'])('--nb-%s on the simulator screen', (name) => {
    expect(contrastRatio(token(name), token('screen'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token(name), token('screen-line'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the fonts the site ships', () => {
  const dir = resolve(root, 'src/notebook/fonts');
  it('come with their SIL Open Font License, and THIRD_PARTY_NOTICES.md names each', () => {
    const files = readdirSync(dir);
    const notices = readFileSync(resolve(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    for (const [family, licence] of [
      ['Caveat', 'OFL-Caveat.txt'],
      ['Inter', 'OFL-Inter.txt'],
      ['JetBrains Mono', 'OFL-JetBrainsMono.txt'],
      ['Notebook Serif', 'OFL-NotebookSerif-CMU.txt'],
    ] as const) {
      expect(files, licence).toContain(licence);
      expect(readFileSync(resolve(dir, licence), 'utf8')).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/i);
      expect(notices, family).toContain(family);
    }
    for (const f of files.filter((x) => x.endsWith('.woff2'))) expect(existsSync(resolve(dir, f))).toBe(true);
    expect(notices).toMatch(/SIL Open Font\s+License/);
  });
});

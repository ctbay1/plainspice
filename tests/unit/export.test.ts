// @vitest-environment jsdom
/**
 * Export (src/export/export.ts): the ngspice file is the netlist as written; the LTspice file
 * makes small, listed changes; downloadFile saves a file without moving focus.
 *
 * The LTspice notes say how ngspice behaves, so those claims are checked here by running the
 * WebAssembly ngspice 47 (bit-identical to native ngspice 47 on the golden fixtures): the
 * exported file must be the same circuit for ngspice, and each note's reason must hold.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import createNgspice from '../../engine/dist/ngspice.mjs';
import { NgspiceEngine } from '../../src/engine/ngspice.ts';
import type { RunResult } from '../../src/engine/types.ts';
import { downloadFile, EXPORT_TEXT, exportLtspice, exportNgspice } from '../../src/export/export.ts';

const root = resolve(import.meta.dirname, '../..');
const fixturesDir = join(root, 'tests/fixtures');
const fixtures = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.cir'))
  .sort()
  .map((name) => ({ name, text: readFileSync(join(fixturesDir, name), 'utf8') }));

const MIXED = [
  '* Divider with gnd, GİRİŞ and ngspice extras',
  'V1 GİRİŞ gnd 12',
  'R1 GİRİŞ out 1k ; to gnd later',
  'R2 out GND 2k',
  'B1 sense 0 V=V(out,gnd)*2',
  'Rs sense',
  '+ gnd 1k',
  'Rgnd out mid 1k',
  'Vx mid gnd',
  '.options reltol=1e-4 savecurrents',
  '.op',
  '.control',
  'echo FROM-THE-CONTROL-BLOCK',
  'print all',
  '.endc',
  '.end',
].join('\r\n');

const MIXED_FOR_LTSPICE = [
  '* Divider with gnd, GİRİŞ and ngspice extras',
  'V1 GİRİŞ 0 12',
  'R1 GİRİŞ out 1k ; to gnd later',
  'R2 out 0 2k',
  'B1 sense 0 V=V(out,0)*2',
  'Rs sense',
  '+ 0 1k',
  'Rgnd out mid 1k',
  'Vx mid gnd',
  '.options reltol=1e-4',
  '.op',
  '.end',
  '',
].join('\n');

describe('exportNgspice: the netlist as written', () => {
  it.each(fixtures)('$name is saved unchanged', ({ text }) => {
    const file = exportNgspice(text);
    expect(file.text).toBe(text);
    expect(file.mime).toBe('text/plain;charset=utf-8');
    expect(file.filename).toMatch(/^[A-Za-z0-9_-]{1,60}\.cir$/);
  });

  it('names the file after the title line when no title is given', () => {
    expect(exportNgspice(fixtures.find((f) => f.name.startsWith('f1a'))!.text).filename).toBe(
      'F1a-a-6-V-source-across-a-2-ohm-resistor.cir',
    );
  });

  it('only tidies line ends: "\\n", and a final line break', () => {
    expect(exportNgspice('* t\r\nR1 a 0 1\r\n.end').text).toBe('* t\nR1 a 0 1\n.end\n');
    expect(exportNgspice('* t\rR1 a 0 1\r').text).toBe('* t\nR1 a 0 1\n');
    expect(exportNgspice('\uFEFF* keeps a BOM\n').text).toBe('\uFEFF* keeps a BOM\n');
    expect(exportNgspice('').text).toBe('\n');
  });

  it.each([
    ['F1a: a 6 V source', 'F1a-a-6-V-source.cir'],
    ['* Thévenin eşdeğeri: 1 kΩ, 10 µF', 'Thevenin-esdegeri-1-kohm-10-uF.cir'],
    ['Devre çözümü ÇĞİÖŞÜ çğıöşü', 'Devre-cozumu-CGIOSU-cgiosu.cir'],
    ['R = 4.7 kΩ (ohm sign) and 2 µs (micro sign) or 3 μs (mu)', 'R-4-7-kohm-ohm-sign-and-2-us-micro-sign-or-3-us-mu.cir'],
    ['../../etc/passwd', 'etc-passwd.cir'],
    ['C:\\Users\\me\\Desktop\\lab 3.cir', 'C-Users-me-Desktop-lab-3.cir'],
    ['.hidden', 'hidden.cir'],
    ['divider.cir', 'divider.cir'],
    ['divider.NET', 'divider.cir'],
    ['CON', 'CON-circuit.cir'],
    ['lpt1', 'lpt1-circuit.cir'],
    ['😀 👩‍🔬', 'circuit.cir'],
    ['Ω', 'ohm.cir'],
    ['__init__', 'init.cir'],
    ['a'.repeat(80), `${'a'.repeat(60)}.cir`],
    [
      'Episode 5, circuit 2: the Thevenin equivalent seen from the load resistor, with a dependent source',
      'Episode-5-circuit-2-the-Thevenin-equivalent-seen-from-the.cir',
    ],
  ])('title %j -> %s', (title, filename) => {
    expect(exportNgspice('* x\n', title).filename).toBe(filename);
  });

  it('falls back to the title line for a blank title, and to "circuit" for nothing usable', () => {
    expect(exportNgspice('* My divider\nR1 a 0 1\n', '   ').filename).toBe('My-divider.cir');
    expect(exportNgspice('').filename).toBe('circuit.cir');
    expect(exportNgspice('***\n').filename).toBe('circuit.cir');
  });
});

describe('exportLtspice: small, listed changes', () => {
  it.each(fixtures)('$name needs no change: only the "not checked" note', ({ text }) => {
    const file = exportLtspice(text);
    expect(file.text).toBe(text);
    expect(file.notes).toEqual([EXPORT_TEXT.notChecked]);
    expect(file.filename).toMatch(/\.net$/);
    expect(file.mime).toBe('text/plain;charset=utf-8');
  });

  it('changes a netlist with gnd, savecurrents and a .control block, and says what and why', () => {
    const file = exportLtspice(MIXED);
    expect(file.filename).toBe('Divider-with-gnd-GIRIS-and-ngspice-extras.net');
    expect(file.text).toBe(MIXED_FOR_LTSPICE);
    expect(file.notes).toEqual([
      EXPORT_TEXT.gndWrittenAs0('Lines 2, 4, 5 and 7'),
      EXPORT_TEXT.gndKept('Line 9'),
      EXPORT_TEXT.optionsWordRemoved('Line 10'),
      EXPORT_TEXT.controlRemoved('Lines 12–15'),
      'Not checked in LTspice yet: please try it and tell us.',
    ]);
  });

  it('takes a title for the file name', () => {
    expect(exportLtspice('* x\n', 'Episode 5: circuit 1').filename).toBe('Episode-5-circuit-1.net');
  });

  describe('.options savecurrents', () => {
    it.each([
      ['.options savecurrents', ''],
      ['.option savecurrents', ''],
      ['.OPT SaveCurrents', ''],
      ['  .options   savecurrents   ', ''],
      ['.options savecurrents ; save every current', ''],
    ])('removes the line %j (no option left)', (line, kept) => {
      const file = exportLtspice(`* t\nR1 a 0 1\n${line}\n.op\n.end\n`);
      expect(file.text).toBe(`* t\nR1 a 0 1\n${kept}.op\n.end\n`);
      expect(file.notes[0]).toBe(EXPORT_TEXT.optionsLineRemoved('Line 3'));
    });

    it.each([
      ['.options savecurrents reltol=1e-4', '.options reltol=1e-4'],
      ['.options reltol=1e-4 savecurrents abstol=1e-15', '.options reltol=1e-4 abstol=1e-15'],
      ['.options reltol=1e-4 savecurrents ; tidy', '.options reltol=1e-4 ; tidy'],
    ])('removes only the word from %j', (line, kept) => {
      const file = exportLtspice(`* t\n${line}\n.end\n`);
      expect(file.text).toBe(`* t\n${kept}\n.end\n`);
      expect(file.notes[0]).toBe(EXPORT_TEXT.optionsWordRemoved('Line 2'));
    });

    it('handles savecurrents on a continuation line', () => {
      expect(exportLtspice('* t\n.options reltol=1e-4\n+ savecurrents\n.end\n').text).toBe('* t\n.options reltol=1e-4\n.end\n');
      expect(exportLtspice('* t\n.options\n+savecurrents\n.end\n').text).toBe('* t\n.end\n');
    });

    it.each([
      '.options reltol=1e-3 ; savecurrents',
      '* .options savecurrents',
      '.optionsx savecurrents',
      '.param savecurrents=1',
      '.options savecurrentsx',
    ])('leaves %j alone', (line) => {
      const text = `* t\n${line}\n.end\n`;
      expect(exportLtspice(text)).toMatchObject({ text, notes: [EXPORT_TEXT.notChecked] });
    });
  });

  describe('.control blocks', () => {
    it('removes indented and upper-case blocks, each with a note', () => {
      const text = '* t\nR1 a 0 1\n.op\n  .CONTROL\n  run\n  .ENDC\n.control\nprint all\n.endc\n.end\n';
      const file = exportLtspice(text);
      expect(file.text).toBe('* t\nR1 a 0 1\n.op\n.end\n');
      expect(file.notes).toEqual([EXPORT_TEXT.controlRemoved('Lines 4–6'), EXPORT_TEXT.controlRemoved('Lines 7–9'), EXPORT_TEXT.notChecked]);
    });

    it('removes a block with no .endc up to .end, and keeps .end', () => {
      const file = exportLtspice('* t\nR1 a 0 1\n.op\n.control\nrun\n.end\n');
      expect(file.text).toBe('* t\nR1 a 0 1\n.op\n.end\n');
      expect(file.notes[0]).toBe(EXPORT_TEXT.controlRemovedNoEndc('Lines 4–5'));
    });

    it('removes a block with no .endc and no .end to the end', () => {
      expect(exportLtspice('* t\nR1 a 0 1\n.control\nrun\n').text).toBe('* t\nR1 a 0 1\n');
    });

    it('never treats the title line as a block, and leaves lines after .end alone', () => {
      const text = '.control title\nR1 a 0 1\n.end\n.control\nrun\n.endc\n';
      expect(exportLtspice(text)).toMatchObject({ text, notes: [EXPORT_TEXT.notChecked] });
    });
  });

  describe('gnd is written 0 exactly where ngspice reads it as ground', () => {
    it.each([
      ['R1 a gnd 1k', 'R1 a 0 1k'],
      ['R1 a GND 1k', 'R1 a 0 1k'],
      ['R1 Gnd a\t1k', 'R1 0 a\t1k'],
      ['B1 o 0 V=V(a,gnd)*2', 'B1 o 0 V=V(a,0)*2'],
      ['B1 o 0 V=V(gnd)+1', 'B1 o 0 V=V(0)+1'],
      ['E1 o gnd a gnd 2', 'E1 o 0 a 0 2'],
      ['.tf v(out,gnd) V1', '.tf v(out,0) V1'],
      ['V1 GİRİŞ gnd 12', 'V1 GİRİŞ 0 12'],
      ['  R1 a gnd 1k', '  R1 a 0 1k'],
    ])('%j -> %j', (line, expected) => {
      const file = exportLtspice(`* t\n${line}\n.end\n`);
      expect(file.text).toBe(`* t\n${expected}\n.end\n`);
      expect(file.notes).toEqual([EXPORT_TEXT.gndWrittenAs0('Line 2'), EXPORT_TEXT.notChecked]);
    });

    it.each([
      'Vx a gnd',
      'Vx a gnd   ',
      'Vx a gnd ; to ground',
      'Vx a gnd $ to ground',
      'Vx a gnd // to ground',
    ])('leaves %j alone and explains why: gnd ends the line', (line) => {
      const text = `* t\n${line}\n.end\n`;
      expect(exportLtspice(text)).toMatchObject({ text, notes: [EXPORT_TEXT.gndKept('Line 2'), EXPORT_TEXT.notChecked] });
    });

    it.each([
      'R1 gnd1 a 1k',
      'R1 vgnd a 1k',
      'R1 a_gnd a 1k',
      'Rgnd a b 1k',
      'Gnd a b c d 1',
      'R1 a b {gnd}',
      'R1 a b 1k ; tie to gnd',
      'R1 a b 1k $ gnd here',
      'R1 a b 1k// gnd',
      '* R1 a gnd 1k',
      '# R1 a gnd 1k',
    ])('leaves %j alone: not the node gnd for ngspice', (line) => {
      const text = `* t\n${line}\n.end\n`;
      expect(exportLtspice(text)).toMatchObject({ text, notes: [EXPORT_TEXT.notChecked] });
    });

    it('follows continuation lines: a "+" becomes a space when ngspice joins them', () => {
      expect(exportLtspice('* t\nRs sense\n+ gnd 1k\n.end\n').text).toBe('* t\nRs sense\n+ 0 1k\n.end\n');
      expect(exportLtspice('* t\nRs sense\n+gnd 1k\n.end\n').text).toBe('* t\nRs sense\n+0 1k\n.end\n');
      // gnd ends a physical line, but the logical line goes on: ground.
      expect(exportLtspice('* t\nVx a gnd\n* a comment in between\n+ 0\n.end\n').text).toBe('* t\nVx a 0\n* a comment in between\n+ 0\n.end\n');
      // gnd ends the logical line: not ground.
      const kept = exportLtspice('* t\nVx a\n+ gnd\n.end\n');
      expect(kept.text).toBe('* t\nVx a\n+ gnd\n.end\n');
      expect(kept.notes[0]).toBe(EXPORT_TEXT.gndKept('Line 3'));
    });

    it('never changes the title line or lines after .end', () => {
      const text = 'V1 a gnd 1 is the title\nR1 a 0 1\n.end\nR2 a gnd 1\n';
      expect(exportLtspice(text)).toMatchObject({ text, notes: [EXPORT_TEXT.notChecked] });
    });
  });

  it('lists lines in words', () => {
    expect(EXPORT_TEXT.lineList([3])).toBe('Line 3');
    expect(EXPORT_TEXT.lineList([2, 3])).toBe('Lines 2 and 3');
    expect(EXPORT_TEXT.lineList([2, 3, 9])).toBe('Lines 2, 3 and 9');
    expect(EXPORT_TEXT.lineRange(4, 4)).toBe('Line 4');
    expect(EXPORT_TEXT.lineRange(4, 7)).toBe('Lines 4–7');
  });
});

describe('the LTspice file is the same circuit for ngspice (WebAssembly ngspice 47)', () => {
  let engine: NgspiceEngine;
  beforeAll(async () => {
    // Compiled here, not passed as bytes: under jsdom, Node's Buffer fails the engine's
    // `instanceof Uint8Array` check (two realms), while WebAssembly is Node's own.
    engine = await NgspiceEngine.create(createNgspice, await WebAssembly.compile(readFileSync(join(root, 'engine/dist/ngspice.wasm'))));
  });

  /** Every vector of `exported` is in `original`, with the very same numbers. */
  function expectSameCircuit(original: RunResult, exported: RunResult): void {
    expect(original.ok, original.stderr).toBe(true);
    expect(exported.ok, exported.stderr).toBe(true);
    expect(exported.plots.map((p) => p.plotname)).toEqual(original.plots.map((p) => p.plotname));
    exported.plots.forEach((plot, i) => {
      const before = original.plots[i]!;
      expect(plot.points).toBe(before.points);
      plot.variables.forEach((variable, j) => {
        const k = before.variables.findIndex((v) => v.name === variable.name);
        expect(k, `${variable.name} in ${plot.plotname}`).toBeGreaterThanOrEqual(0);
        expect(Array.from(plot.real[j]!)).toEqual(Array.from(before.real[k]!));
      });
    });
  }

  const GND_HEAVY = [
    '* gnd in every place ngspice reads it as ground, and one where it does not',
    'V1 in GND 6',
    'R1 in mid 2',
    'R2 mid gnd\t4',
    'B1 bo 0 V=V(mid,gnd)*2',
    'Rb bo Gnd 1k',
    'Rs mid',
    '+ gnd 8',
    'R3 mid far 1k',
    'Vx far gnd',
    '.op',
    '.end',
  ].join('\n');

  it.each([...fixtures.map((f) => [f.name, f.text] as const), ['a netlist with gnd, savecurrents and .control', MIXED] as const, ['a netlist full of gnd', GND_HEAVY] as const])(
    '%s',
    async (_label, text) => {
      expectSameCircuit(await engine.run(text), await engine.run(exportLtspice(text).text));
    },
  );

  it('the reasons in the notes hold for ngspice', async () => {
    const original = await engine.run(MIXED);
    const exported = await engine.run(exportLtspice(MIXED).text);
    const names = (r: RunResult) => r.plots.flatMap((p) => p.variables.map((v) => v.name));
    // savecurrents makes ngspice save the current through every part ...
    expect(names(original)).toEqual(expect.arrayContaining(['i(@r1[i])', 'i(@r2[i])', 'i(@rgnd[i])']));
    expect(names(exported).some((n) => n.startsWith('i(@'))).toBe(false);
    // ... a gnd that ends its line is a separate node called gnd (here it is joined to mid by Vx) ...
    expect(names(original)).toContain('v(gnd)');
    expect(names(exported)).toContain('v(gnd)');
    // ... and the .control block holds commands for ngspice.
    expect(original.stdout).toContain('FROM-THE-CONTROL-BLOCK');
    expect(exported.stdout).not.toContain('FROM-THE-CONTROL-BLOCK');
  });
});

describe('downloadFile', () => {
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  afterEach(() => {
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('clicks a hidden, temporary <a download> for a Blob, keeps focus where it was, and revokes the Blob later', async () => {
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:plainspice/1';
    });
    URL.revokeObjectURL = vi.fn();
    const button = document.createElement('button');
    button.textContent = 'Save for ngspice';
    document.body.append(button);
    button.focus();
    let clicked: { connected: boolean; hidden: boolean; download: string; href: string } | undefined;
    document.addEventListener(
      'click',
      (event) => {
        const a = event.target as HTMLAnchorElement;
        clicked = { connected: a.isConnected, hidden: a.hidden === true, download: a.download, href: a.getAttribute('href') ?? '' };
        event.preventDefault(); // jsdom cannot download
      },
      { once: true },
    );
    vi.useFakeTimers();

    downloadFile(exportNgspice('* My divider\nR1 a 0 1k\n.op\n.end\n'));

    expect(clicked).toEqual({ connected: true, hidden: true, download: 'My-divider.cir', href: 'blob:plainspice/1' });
    expect(document.querySelectorAll('a')).toHaveLength(0);
    expect(document.activeElement).toBe(button);
    vi.advanceTimersByTime(39_999);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:plainspice/1');
    vi.useRealTimers();

    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.type).toBe('text/plain;charset=utf-8');
    const text = await new Promise<string>((done) => {
      const reader = new FileReader();
      reader.onload = () => done(String(reader.result));
      reader.readAsText(blobs[0]!);
    });
    expect(text).toBe('* My divider\nR1 a 0 1k\n.op\n.end\n');
  });

  it('removes the link and still revokes the Blob if the click throws', () => {
    URL.createObjectURL = vi.fn(() => 'blob:plainspice/2');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.useFakeTimers();
    expect(() => downloadFile({ filename: 'x.cir', text: 'x\n', mime: 'text/plain;charset=utf-8' })).toThrow('blocked');
    expect(document.querySelectorAll('a')).toHaveLength(0);
    vi.advanceTimersByTime(40_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:plainspice/2');
    click.mockRestore();
  });
});

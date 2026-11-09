import { describe, expect, it } from 'vitest';
import { agrees, maxRelativeDifference, parsePrinted, rawfileName } from '../../src/engine/compare.ts';
import { classifyOutput } from '../../src/engine/diagnostics.ts';
import { parseRawfile, RawfileError } from '../../src/engine/rawfile.ts';
import { interpretPlots, unitOf } from '../../src/engine/results.ts';

const enc = new TextEncoder();

/** Build a binary rawfile the way ngspice writes it (header lines, then float64 little-endian). */
function binaryRaw(plots: { plotname: string; vars: [string, string][]; rows: number[][]; title?: string }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const p of plots) {
    const header =
      `Title: ${p.title ?? 'test'}\nDate: Mon Nov  9 20:00:00  2026\nPlotname: ${p.plotname}\nFlags: real\n` +
      `No. Variables: ${p.vars.length}\nNo. Points: ${p.rows.length}\nVariables:\n` +
      p.vars.map(([n, t], i) => `\t${i}\t${n}\t${t}\n`).join('') +
      'Binary:\n';
    chunks.push(enc.encode(header));
    const data = new DataView(new ArrayBuffer(8 * p.vars.length * p.rows.length));
    p.rows.flat().forEach((x, i) => data.setFloat64(8 * i, x, true));
    chunks.push(new Uint8Array(data.buffer));
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

describe('agrees (6 significant figures)', () => {
  it('accepts values that round the same at 6 significant figures', () => {
    expect(agrees(5.999999994, 6)).toBe(true);
    expect(agrees(0.33333333333333337, 1 / 3)).toBe(true);
    expect(agrees(-12, -12.000004)).toBe(true);
  });
  it('rejects a difference in the 6th significant figure', () => {
    expect(agrees(4.00002, 4)).toBe(false);
    expect(agrees(1234567, 1234600)).toBe(false);
    expect(agrees(1, -1)).toBe(false);
  });
  it('treats tiny magnitudes as zero and compares non-finite values exactly', () => {
    expect(agrees(1e-15, -2e-13)).toBe(true);
    expect(agrees(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(true);
    expect(agrees(Number.NaN, 0)).toBe(false);
  });
  it('reports the largest relative difference', () => {
    expect(maxRelativeDifference([1, 2, 0], [1, 2, 0])).toBe(0);
    expect(maxRelativeDifference([1, 2], [1, 2.002])).toBeCloseTo(0.001 / 1.001, 9);
  });
});

describe('rawfileName and parsePrinted', () => {
  it('maps command-line names to rawfile names', () => {
    expect(rawfileName('vx#branch')).toBe('i(vx)');
    expect(rawfileName('v(n1)')).toBe('v(n1)');
    expect(rawfileName('n1')).toBe('v(n1)');
    expect(rawfileName('output_impedance_at_v(a)')).toBe('v(output_impedance_at_v(a))');
    expect(rawfileName('Transfer_function')).toBe('v(transfer_function)');
  });
  it('reads the node, source and .tf tables and skips device parameter listings', () => {
    const stdout = [
      'No. of Data Rows : 1',
      '\tNode                                  Voltage',
      '\t----                                  -------',
      '\t----\t-------',
      '\tn1                               1.200000e+01',
      '\ta                                -1.40000e+01',
      '',
      '\tSource\tCurrent',
      '\t------\t-------',
      '',
      '\tvx#branch                        1.000000e+00',
      '',
      ' Resistor models (Simple linear resistor)',
      '       defw                 1e-05',
      'Transfer function information:',
      'transfer_function = 3.333333e-01',
      'output_impedance_at_v(a) = 4.000000e+00',
    ].join('\n');
    const p = parsePrinted(stdout);
    expect([...p.keys()].sort()).toEqual(['i(vx)', 'v(a)', 'v(n1)', 'v(output_impedance_at_v(a))', 'v(transfer_function)']);
    expect(p.get('v(a)')).toEqual({ value: -14, text: '-1.40000e+01' });
  });
});

describe('parseRawfile', () => {
  it('reads several binary plots back to back at full precision', () => {
    const plots = parseRawfile(
      binaryRaw([
        { plotname: 'Operating Point', vars: [['v(n1)', 'voltage'], ['i(v1)', 'current']], rows: [[6, -3]] },
        { plotname: 'DC transfer characteristic', vars: [['v(v-sweep)', 'voltage'], ['v(out)', 'voltage']], rows: [[0, 0], [1, 2 / 3]] },
      ]),
    );
    expect(plots).toHaveLength(2);
    expect(plots[0]!.real[1]![0]).toBe(-3);
    expect(plots[1]!.real[1]![1]).toBe(2 / 3);
    expect(plots[1]!.variables.map((v) => v.name)).toEqual(['v(v-sweep)', 'v(out)']);
  });
  it('is not thrown off by a non-ASCII title (bytes, not string offsets)', () => {
    const plots = parseRawfile(binaryRaw([{ title: 'Ohm’s law – ΩΩ', plotname: 'Operating Point', vars: [['v(n1)', 'voltage']], rows: [[1.5]] }]));
    expect(plots[0]!.real[0]![0]).toBe(1.5);
  });
  it('reads an ASCII rawfile, real and complex', () => {
    const ascii =
      'Title: t\nDate: d\nPlotname: Operating Point\nFlags: real\nNo. Variables: 2\nNo. Points: 1\nVariables:\n\t0\tv(n1)\tvoltage\n\t1\ti(v1)\tcurrent\nValues:\n 0\t6.000000000000000e+00\n\t-3.000000000000000e+00\n' +
      'Title: t\nDate: d\nPlotname: AC Analysis\nFlags: complex\nNo. Variables: 1\nNo. Points: 1\nVariables:\n\t0\tfrequency\tfrequency\nValues:\n 0\t1.0e+03,0.0e+00\n';
    const plots = parseRawfile(enc.encode(ascii));
    expect(plots[0]!.real[0]![0]).toBe(6);
    expect(plots[0]!.real[1]![0]).toBe(-3);
    expect(plots[1]!.complex).toBe(true);
    expect(plots[1]!.real[0]![0]).toBe(1000);
    expect(plots[1]!.imag?.[0]![0]).toBe(0);
  });
  it('rejects a truncated file', () => {
    const raw = binaryRaw([{ plotname: 'Operating Point', vars: [['v(n1)', 'voltage']], rows: [[1]] }]);
    expect(() => parseRawfile(raw.subarray(0, raw.length - 3))).toThrow(RawfileError);
  });
});

describe('classifyOutput', () => {
  it('flags the singular-matrix fallback, naming the node', () => {
    const d = classifyOutput('', 'Warning: singular matrix:  check node b\nNote: Starting dynamic gmin stepping\nWarning: Dynamic gmin stepping failed\nNote: Transient op started\nNote: Transient op finished successfully');
    expect(d.map((x) => x.code)).toEqual(['singular-matrix', 'gmin-stepping-failed', 'transient-op-fallback']);
    expect(d[0]!.subject).toBe('b');
  });
  it('attaches the netlist line number to the error that follows it', () => {
    const d = classifyOutput('', 'Error on line 4 or its substitute:\n  r1 n1 0 4\ndevice already exists, bail out\n    Simulation interrupted due to error!\n\nError: circuit not parsed.');
    expect(d[0]).toMatchObject({ code: 'duplicate-name', line: 4, severity: 'error' });
    expect(d.map((x) => x.code)).toContain('circuit-not-parsed');
  });
  it('reads the line number of numparam errors and names the undefined parameter', () => {
    const d = classifyOutput('', 'Error in netlist line no. 4, new internal line no. 3:\n\nUndefined parameter [rx]\nError in netlist line no. 4, new internal line no. 3:\n\nCannot compute substitute\n\nERROR: fatal error in ngspice, exit(1)');
    expect(d[0]).toMatchObject({ code: 'undefined-parameter', subject: 'rx', line: 3 });
    expect(d.map((x) => x.code)).toContain('fatal');
  });
  it('recognises a device model that is not in this engine build', () => {
    const d = classifyOutput('', 'Error on line 3 or its substitute:\n  o1 a 0 b 0 lmod\nDevice type LossyXmissionLine not supported by this binary\n    Simulation interrupted due to error!\n\nError: circuit not parsed.\nNote: no resource usage information for \'time\',\n\tor no active circuit available');
    expect(d.map((x) => x.code)).toEqual(['model-not-in-build', 'circuit-not-parsed']);
    expect(d[0]).toMatchObject({ line: 3, subject: 'LossyXmissionLine' });
  });
  it('ignores the lines ngspice prints on every run', () => {
    expect(classifyOutput('Note: No compatibility mode selected!\nUsing SPARSE 1.3 as Direct Linear Solver\n', '')).toEqual([]);
  });
});

describe('interpretPlots', () => {
  const op = parseRawfile(
    binaryRaw([
      {
        plotname: 'Operating Point',
        vars: [['v(a)', 'voltage'], ['i(vx)', 'current'], ['i(@r1[i])', 'current'], ['i(@itest[current])', 'current']],
        rows: [[14, 1, 3, 1]],
      },
      {
        plotname: 'Transfer Function',
        vars: [['v(Transfer_function)', 'voltage'], ['v(v1#Input_impedance)', 'voltage'], ['v(output_impedance_at_V(a))', 'voltage']],
        rows: [[1 / 3, 9, 4]],
      },
      { plotname: 'Transient Analysis', vars: [['time', 'time'], ['v(out)', 'voltage']], rows: [[0, 0], [1e-3, 3.16]] },
    ]),
  );
  const r = interpretPlots(op);
  it('separates node voltages, branch currents and device currents', () => {
    expect(r.op?.nodes).toEqual([{ node: 'a', value: 14 }]);
    expect(r.op?.currents.map((c) => [c.element, c.origin])).toEqual([
      ['vx', 'branch'],
      ['r1', 'device'],
      ['itest', 'device'],
    ]);
  });
  it('reads .tf results whatever their case', () => {
    expect(r.tf).toEqual({ transferFunction: 1 / 3, inputImpedance: { source: 'v1', value: 9 }, outputImpedance: { at: 'v(a)', value: 4 } });
  });
  it('reads a transient sweep with units', () => {
    expect(r.tran?.scale.unit).toBe('s');
    expect(r.tran?.series[0]).toMatchObject({ name: 'v(out)', unit: 'V' });
    expect(unitOf('res-sweep', 'notype')).toBe('Ω');
  });
});

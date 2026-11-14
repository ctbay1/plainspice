/**
 * The facts records the last pass corrected after re-running native ngspice 47 and 42 (13 November 2026, the words
 * lane; round-1 critic C8). What the native builds did cannot be run again in a test, so the records themselves are
 * pinned here: what each results file holds where ngspice stops (F7), where ngspice 42's .tran time points differ
 * from 47's (F8), and the version length from which native ngspice stops (limit-9, F9). And a fact's ID heads one
 * section only in docs/spice-facts, so that two changes made apart can never give one ID two meanings.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = resolve(import.meta.dirname, '../../docs/spice-facts');
const read = (file: string): string => readFileSync(join(dir, file), 'utf8');
/** A fact's heading: "### P18. …" in most files, "## limit-9: …" in limits.md and drawing.md. */
const HEADING = /^#{2,3} (\S+?)[.:] /;

/** A facts file's sections by ID, each up to the next heading. */
function sections(file: string): Map<string, string> {
  const out = new Map<string, string>();
  let id: string | undefined;
  for (const line of read(file).split('\n')) {
    const m = HEADING.exec(line);
    if (m) {
      id = m[1]!;
      out.set(id, '');
    } else if (/^#{1,3} /.test(line)) id = undefined;
    else if (id) out.set(id, `${out.get(id)}${line}\n`);
  }
  return out;
}

/** The lines of a section that record one version's runs: from "ngspice 47…" up to the next version, our engine or the end of the block. */
function runsOf(file: string, id: string, who: 'ngspice 47' | 'ngspice 42'): string {
  const section = sections(file).get(id);
  if (section === undefined) throw new Error(`no ${id} in ${file}`);
  const out: string[] = [];
  let on = false;
  for (const line of section.split('\n')) {
    if (/^(ngspice 4[27]|our engine)/.test(line)) on = line.startsWith(who);
    else if (line.startsWith('```')) on = false;
    if (on) out.push(line);
  }
  return out.join('\n');
}

describe('F7: where ngspice stops, the results file it writes is said as it is', () => {
  const OP = 'an Operating Point plot';
  const DC = 'a DC transfer characteristic plot';
  const TRAN = 'a Transient Analysis plot';
  const v47 = ['ngspice 47'] as const;
  const v42 = ['ngspice 42'] as const;
  const both = ['ngspice 47', 'ngspice 42'] as const;
  // Each re-run with `ngspice -b -r` and the file read: a plot's header and 0 points, no Binary: or Values: section.
  it.each([
    ['traps.md', 'control-source-5', v47, OP],
    ['traps.md', 'current-source-no-path-4', v47, OP],
    ['traps.md', 'current-source-no-path-5', v47, OP],
    ['traps.md', 'floating-dc-4', v47, OP],
    ['traps.md', 'floating-dc-10', v47, OP],
    ['traps.md', 'voltage-loop-1', v47, OP],
    ['traps.md', 'voltage-loop-2', v47, OP],
    ['traps.md', 'voltage-loop-3', v47, OP],
    ['traps.md', 'voltage-loop-4', v47, OP],
    ['traps.md', 'voltage-loop-7', both, TRAN],
    ['traps.md', 'dc-sweep-problems-3', both, DC],
    ['traps.md', 'dc-sweep-problems-4', both, DC],
    ['traps.md', 'dc-sweep-problems-10', v42, DC],
    ['traps.md', 'dc-sweep-problems-22', both, DC],
    ['traps.md', 'invisible-character-33', both, DC],
    ['explanations.md', 'A11', v47, DC],
    ['explanations.md', 'M3', v47, OP],
    ['explanations.md', 'M3b', v47, OP],
  ] as const)('%s, %s: %s writes %s with 0 points, its header only', (file, id, versions, plot) => {
    for (const who of versions) {
      const runs = runsOf(file, id, who);
      expect(runs, `${id}, ${who}`).toContain(`${plot} with 0 points, its header only (no results)`);
      expect(runs, `${id}, ${who}`).not.toMatch(/\(no (rawfile|data)/);
    }
  });

  it('space-before-suffix-9: ngspice 42’s file has a header that says 0 points, then one point’s worth of zeros', () => {
    const runs = runsOf('traps.md', 'space-before-suffix-9', 'ngspice 42');
    expect(runs).toContain("rawfile: a Transient Analysis plot whose header says 0 points (no results); 40 bytes of zeros, one point's worth, follow its Binary: line");
    expect(runs).not.toMatch(/\(no (rawfile|data)/);
  });

  it('unknown-dot-command-2: ngspice 42’s file holds the .op point, then a PSS plot with 0 points', () => {
    const runs = runsOf('traps.md', 'unknown-dot-command-2', 'ngspice 42');
    expect(runs).toContain('rawfile: v(a) = 1, i(v1) = -0.001 (the .op), then a Time Domain Periodic Steady State Analysis plot with 0 points, its header only');
    expect(runs).not.toMatch(/\(no (rawfile|data)/);
  });
});

describe('F8: ngspice 42’s .tran time points are said where they differ from 47’s, never "the same … rawfile values"', () => {
  // Each compared point by point with 47's rawfile: the output, exit code and summary are the same, a few points are not.
  it.each([
    ['explanations.md', 'P18', /7 of its 156 time points differ slightly/],
    ['explanations.md', 'P19', /the same rawfile values except one\s+time point near the end \(0\.00199928 s where 47 has 0\.00199914 s\)/],
    ['explanations.md', 'P19b', /the same rawfile values except one\s+time point/],
    ['explanations.md', 'P19c', /the same rawfile values except one\s+time point/],
    ['explanations.md', 'P20b', /the same rawfile values except one\s+time point/],
    ['explanations.md', 'A17', /its time points part from 47's \(60 of the 73\s+differ\)/],
    ['explanations.md', 'A18', /its time points part from 47's \(2504 of the 2517\s+differ\)/],
    ['traps.md', 'non-ascii-node-12', /2 of its time points differ slightly \(9\.306e-7 s\s+where 47 has 8\.653e-7 s/],
  ] as const)('%s, %s', (file, id, said) => {
    const runs = runsOf(file, id, 'ngspice 42');
    expect(runs).toMatch(said);
    expect(runs).not.toMatch(/the same (output|printout), exit code and rawfile values/);
  });
});

describe('F9: limit-9 says where native ngspice stops on a long .model version', () => {
  it('"could not find a valid modelname" up to 104 bytes, a stop from 105 (exit 134), and no "150 bytes"', () => {
    const section = sections('limits.md').get('limit-9')!;
    const claim = section.slice(section.indexOf('**Claim.**'), section.indexOf('\n\n', section.indexOf('**Claim.**')));
    expect(claim).toMatch(/do not notice up to 104 bytes \(their own "could not find a valid modelname", exit 1\)/);
    expect(claim).toMatch(/stop from 105 bytes \(exit 134\)/);
    // The record keeps a note of what it said before (from 150 bytes); the claim itself never says 150.
    expect(claim).not.toMatch(/150/);
  });
});

describe('each fact’s ID heads one section in docs/spice-facts', () => {
  it('no ID is used twice, in one file or across them', () => {
    const where = new Map<string, string>();
    const twice: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      for (const line of read(file).split('\n')) {
        // A fact's ID has a letter in it; "## 1. How ngspice reads numbers" is a chapter.
        const id = HEADING.exec(line)?.[1];
        if (!id || !/[a-z]/i.test(id)) continue;
        if (where.has(id)) twice.push(`${id}: ${where.get(id)} and ${file}`);
        else where.set(id, file);
      }
    }
    expect(twice).toEqual([]);
    expect(where.size).toBeGreaterThan(600);
  });
});

describe('P6 (integration check, 14 November 2026): a header-only results file is said as it is in the formulas lane’s facts too', () => {
  const OP = 'an Operating Point plot with 0 points, its header only (no results)';
  const TRAN = 'a Transient Analysis plot with 0 points, its header only (no results)';
  const count = (text: string, part: string): number => text.split(part).length - 1;
  // Each run re-run with `ngspice -b -r` in native 47 and 42 and its file read: a plot's header and 0 points, no Binary:
  // section (47: 228 to 236 bytes, 42: 172 to 180). The base run's line, then the variants' lines.
  it.each([
    ['nbsp-8', 1, 0],
    ['non-ascii-node-15', 1, 0],
    ['non-ascii-node-20', 1, 0],
    ['non-ascii-node-25', 1, 0],
    ['non-ascii-node-26', 2, 0],
    ['invisible-character-68', 1, 0],
    ['look-alike-letter-19', 1, 0],
    ['space-character-32', 2, 2],
  ] as const)('%s', (id, op, tran) => {
    const section = sections('traps.md').get(id)!;
    expect(section).not.toContain('(no rawfile data)');
    expect([count(section, OP), count(section, TRAN)]).toEqual([op, tran]);
  });

  it('"(no rawfile data)" is left in traps.md only where ngspice writes no results file at all (non-ascii-node-4, -14)', () => {
    const left = [...sections('traps.md')].filter(([, text]) => text.includes('(no rawfile data)')).map(([id]) => id);
    expect(left).toEqual(['non-ascii-node-4', 'non-ascii-node-14']);
  });
});

describe('P5 (integration check, 14 November 2026): a run with a results file is recorded with what it prints, not with plain -b’s lines', () => {
  // "Error: incomplete or empty netlist" is printed by `ngspice -b` alone. Re-run in native 47 with -b -r, the 43
  // variant runs of 13 facts that listed it under "ngspice 47, -b -r" print every other recorded line, and not that one.
  it('no line recorded under a "-b -r" label in traps.md is that plain -b line', () => {
    const lines = read('traps.md').split('\n');
    const under: string[] = [];
    let id = '';
    lines.forEach((line, i) => {
      id = HEADING.exec(line)?.[1] ?? id;
      if (!line.includes('incomplete or empty netlist')) return;
      // The label a printed line belongs to: the nearest line above it with less indentation.
      const indent = line.length - line.trimStart().length;
      let j = i - 1;
      while (j >= 0 && (lines[j]!.trim() === '' || lines[j]!.length - lines[j]!.trimStart().length >= indent)) j -= 1;
      if (/-b -r/.test(lines[j] ?? '')) under.push(`${id}, line ${i + 1}: ${lines[j]!.trim()}`);
    });
    expect(under).toEqual([]);
  });

  it('missing-fields-10: with no bracket after the word, native 47 with a results file crashes (10 of 10 runs), where the record said it never finished', () => {
    const section = sections('traps.md').get('missing-fields-10')!;
    expect(section.split('ngspice 47, -b -r (exit signal SIGSEGV): (no rawfile), a crash').length - 1).toBe(2);
    expect(section).not.toContain('(exit null)');
  });
});

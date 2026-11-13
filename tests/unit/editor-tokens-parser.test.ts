/**
 * The editor's highlighter (src/editor/spice-tokens.ts) must read a netlist the way the verified
 * parser does (src/spice/parse.ts, checked against native ngspice in docs/spice-facts/). This test
 * runs every netlist of tests/golden/facts-numbers.test.ts (the facts, and one netlist per first
 * letter) and the fixtures through both and compares what a student sees:
 *
 * - what kind of line it is (title, comment, command, part, dot command, continuation, invalid);
 * - every node: same place, same name, ground or not ("Vx b gnd" ends with a node called gnd);
 * - where words start and end on part lines ("1d-3" is two words, "a(1)" is the node "a(1");
 * - the value ngspice uses is shown as a number;
 * - words ngspice stops at ("unknown parameter") are shown as invalid.
 *
 * Lines after .end are left out on purpose: ngspice still reads them after a plain .end, so the
 * editor styles them as usual, while the parser marks them 'after-end' (the checks explain it).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tokenizeNetlist, type SpiceToken } from '../../src/editor/spice-tokens.ts';
import { parseNetlist } from '../../src/spice/parse.ts';
import type { Netlist, Token } from '../../src/spice/types.ts';

const root = resolve(import.meta.dirname, '../..');

/** The facts' netlists, read from the golden test's source (its FACTS list is not exported). */
function factNetlists(): { name: string; text: string }[] {
  const source = readFileSync(resolve(root, 'tests/golden/facts-numbers.test.ts'), 'utf8');
  const out: { name: string; text: string }[] = [];
  for (const m of source.matchAll(/\{ code: '([A-Z]\d+)'.*?netlist: ("(?:[^"\\]|\\.)*")/g)) {
    out.push({ name: `fact ${m[1]}`, text: JSON.parse(m[2]!) as string });
  }
  const letters = /const LETTERS[^=]*= \[([\s\S]*?)\n\];/.exec(source)?.[1] ?? '';
  for (const m of letters.matchAll(/\['([A-Z])'/g)) {
    out.push({ name: `letter ${m[1]}`, text: `* first letter ${m[1]}\nRref a 0 1\n${m[1]}1 a 0 5\n.op\n.end\n` });
  }
  return out;
}

function fixtureNetlists(): { name: string; text: string }[] {
  const dir = resolve(root, 'tests/fixtures');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.cir'))
    .map((f) => ({ name: `fixture ${f}`, text: readFileSync(resolve(dir, f), 'utf8') }));
}

/** CodeMirror splits lines at \r\n, \r and \n and keeps "\n": the editor never holds a lone \r. */
const asInEditor = (text: string): string => text.split(/\r\n|\r|\n/).join('\n');

interface AbsoluteToken extends SpiceToken {
  line: number;
}

function highlighterTokens(text: string): AbsoluteToken[] {
  const lines = text.split('\n');
  const out: AbsoluteToken[] = [];
  let at = 0;
  tokenizeNetlist(text).forEach((tokens, i) => {
    for (const t of tokens) out.push({ ...t, from: t.from + at, to: t.to + at, line: i });
    at += (lines[i]?.length ?? 0) + 1;
  });
  return out;
}

/** Everything that disagrees, in words (an empty list passes). */
function compare(text: string): string[] {
  const n: Netlist = parseNetlist(text);
  const hl = highlighterTokens(text);
  const problems: string[] = [];
  const onLine = (i: number): AbsoluteToken[] => hl.filter((t) => t.line === i);
  const at = (span: Token): AbsoluteToken | undefined => hl.find((t) => t.from === span.from && t.to === span.to);

  for (const line of n.lines) {
    const first = onLine(line.index)[0]?.type;
    const ok = ((): boolean => {
      switch (line.kind) {
        case 'title':
          return onLine(line.index).every((t) => t.type === 'title');
        case 'blank':
          return first === undefined;
        case 'comment':
          return first === 'comment';
        case 'control':
          return first === 'control' || first === 'directive';
        case 'element':
          return first === 'element';
        case 'directive':
          return first === 'directive';
        case 'invalid':
          return first === 'invalid';
        case 'continuation': {
          if (!line.text.trimStart().startsWith('+')) return true; // after two backslashes: part of the statement
          const target = line.continues === undefined ? undefined : n.lines[line.continues];
          if (target === undefined) return first === 'invalid' || first === 'title'; // nothing to continue: ignored
          if (target.kind === 'comment') return first === 'comment'; // swallowed by a ';' or odd-character line
          return first === 'continuation';
        }
        case 'after-end':
          return true;
      }
    })();
    if (!ok) problems.push(`line ${line.number} is '${line.kind}' but the editor starts it with '${first}': ${JSON.stringify(line.text)}`);

    const element = line.element;
    if (!element) continue;
    for (const node of element.nodes) {
      const t = at(node.token);
      if (!t || (t.type !== 'node' && t.type !== 'ground') || t.node !== node.name || (t.type === 'ground') !== node.ground) {
        problems.push(
          `line ${line.number}: node ${JSON.stringify(node.token.text)} is ${node.ground ? 'ground' : `the node ${node.name}`}, the editor shows ${t ? `${t.type} ${t.node ?? ''}` : 'no word there'}`,
        );
      }
    }
    for (const field of element.fields) {
      const { from, to } = field.token;
      const crossing = hl.find((t) => (t.from < from && from < t.to) || (t.from < to && to < t.to));
      if (crossing) problems.push(`line ${line.number}: the word ${JSON.stringify(field.token.text)} is split differently: ${JSON.stringify(text.slice(crossing.from, crossing.to))}`);
      if (field.role === 'other' && element.letter !== 'K') {
        const inside = hl.filter((t) => t.from >= from && t.to <= to);
        if (!inside.length || inside.some((t) => t.type !== 'invalid')) {
          problems.push(`line ${line.number}: ngspice stops at ${JSON.stringify(field.token.text)}, the editor shows ${inside.map((t) => t.type).join(', ') || 'nothing'}`);
        }
      }
    }
    if (element.value?.number) {
      const t = hl.find((x) => x.from === element.value!.token.from);
      if (t?.type !== 'number') problems.push(`line ${line.number}: the value ${JSON.stringify(element.value.token.text)} is not shown as a number (${t?.type})`);
    }
  }

  // Nodes named in dot commands: v(a), v(gnd) ..., and the nodes a formula reads (Element.reads: a B line's
  // v(out), an E's VALUE={v(out)*2}), which the editor may show inside the formula's expression instead.
  const reads = new Set(n.lines.flatMap((l) => (l.element?.reads ?? []).map((r) => r.token.from)));
  for (const info of n.nodes.values()) {
    for (const ref of info.refs) {
      if (reads.has(ref.from) && hl.some((t) => t.type === 'expression' && t.from <= ref.from && ref.to <= t.to)) continue;
      const t = at(ref);
      if (!t || t.node !== info.name) problems.push(`the node ${info.name} at ${JSON.stringify(ref.text)} is shown as ${t ? `${t.type} ${t.node ?? ''}` : 'no word'}`);
    }
  }
  return problems;
}

describe('the editor highlighter reads netlists as the verified parser does', () => {
  const cases = [...factNetlists(), ...fixtureNetlists()];

  it('finds every netlist of the facts test (77 facts, 26 letters) and the fixtures', () => {
    expect(cases.filter((c) => c.name.startsWith('fact')).length).toBe(77);
    expect(cases.filter((c) => c.name.startsWith('letter')).length).toBe(26);
    expect(cases.filter((c) => c.name.startsWith('fixture')).length).toBeGreaterThanOrEqual(10);
  });

  for (const c of cases) {
    it(c.name, () => {
      expect(compare(asInEditor(c.text))).toEqual([]);
    });
  }

  it('the five cases the parser report found now agree', () => {
    // gnd as the last word is a node called gnd (W9); *# and ## run as commands (S16, S17);
    // 1d-3 is two words (N9); a(1) is the node a(1 (W5); a mid-line * stops ngspice (S7).
    for (const text of [
      '* t\nV1 a 0 6\nR1 a b 2\nVx b gnd\n.op\n.end\n',
      '* t\nI1 0 n1 1\n*# echo hi\n## echo hi\nR1 n1 0 2\n.op\n.end\n',
      '* t\nI1 0 n1 1\nR1 n1 0 1d-3\n.op\n.end\n',
      '* t\nI1 0 a(1) 1\nR1 a(1) 0 2\n.op\n.end\n',
      '* t\nI1 0 n1 1\nR1 n1 0 2 * 5\n.op\n.end\n',
      '* t\nV1 a 0 6\nR1 a b 2\nVx b gnd\n+ 0\n.op\n.end\n',
    ]) {
      expect(compare(text)).toEqual([]);
    }
  });

  it('E, F, G and H lines given by a formula, a table or POLY, or with HSPICE\'s word for their kind, agree (C3-5)', () => {
    const divider = '* t\nV1 in 0 5\nVx in out 0\nR2 out 0 1k\n';
    for (const line of [
      'E1 e 0 VALUE={v(out)*2}', 'E1 e 0 value = {v(out)*2}', 'E1 e 0 VALUE {v(out)*2}', 'E1 e 0 VALUE=v(out)*2', "E1 e 0 vol='v(out)*2'",
      'G1 0 e cur={v(out)*2m}', 'E1 e 0 in 0 VALUE={v(out)*2}', 'G1 0 e in 0 cur={v(out)*2m}',
      'E1 e 0 POLY(1) out 0 0 2', 'E1 e 0 POLY(2) out 0 in 0 0 1 1', 'G1 0 e poly(1) out 0 0 2m', 'F1 0 e POLY(1) Vx 0 2', 'H1 e 0 POLY(2) Vx V1 0 1k 1k',
      'E1 e 0 TABLE {v(out)} = (0,0) (5,10)', 'E1 e 0 out 0 table=(0,0,5,10)',
      'E1 e 0 vcvs out 0 2', 'G1 0 e vccs out 0 2m', 'F1 0 e cccs Vx 2', 'H1 e 0 ccvs Vx 1k', 'E1 e 0 vcvs out 2', 'E1 e 0 POLY(1) value 0 0 2',
      'E1 e 0 x VALUE={2}', 'E1 e 0 out 0 2 VALUE={v(out)*2}', 'E1 e 0 a b c d VALUE={2}', 'E1 e 0 VALUE=3', 'E1 e 0 VALUE v(out)*2',
      // The round-2 critic (CR2-1, CR2-6): a sign or a bracket first; what ngspice drops between VALUE (no =) and its {.
      'E1 e 0 VALUE=-v(out)*2', 'E1 e 0 VALUE=(1+v(out))*2', 'G1 0 e cur=(2m)', 'E1 e 0 x VALUE=(2)', 'E1 e 0 VALUE x {v(out)*2}', 'E1 e 0 VALUE v(out) {2}',
      'E1 e 0 VALUE \u00a0{v(out)*2}', 'E1 e 0 VALUE\u00a0{v(out)*2}', 'E1 e 0 VALUE\u2009{v(out)*2}', 'E1 e 0 VALUE\u00a0=v(out)*2', 'E1 e 0 VALUE\u00a0=\u00a0{v(out)*2}',
      'E1 e 0 VALUE\u00a0v(out)*2', 'G1 0 e VALUE\u200b{v(out)*2m}',
    ]) {
      expect(compare(`${divider}${line}\nRe e 0 1k\n.op\n.end\n`), line).toEqual([]);
    }
  });
});

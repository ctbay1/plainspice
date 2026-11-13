import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { highlightTree, tagHighlighter } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';
import { spiceLanguage, TOKEN_TAGS, type StyledTokenType } from '../../src/editor/spice-language.ts';
import { commentStart, MAX_STYLED_PIECES, splitNumber, START_STATE, tokenizeLine, tokenizeNetlist, valueParts, type SpiceToken } from '../../src/editor/spice-tokens.ts';

const FIXTURES = resolve(import.meta.dirname, '../fixtures');

/** "[text]type" for every token of a line, the easiest form to read in a failing test. */
function show(line: string, tokens: readonly SpiceToken[]): string[] {
  return tokens.map((t) => `${line.slice(t.from, t.to)}:${t.type}${t.node !== undefined ? `=${t.node}` : ''}${t.local ? ' local' : ''}`);
}

/** Tokenize `line` as line 2 of a netlist (line 1 is always the title). */
function tok(line: string, before: string[] = []): string[] {
  const lines = ['* title', ...before, line];
  const all = tokenizeNetlist(lines.join('\n'));
  return show(line, all[all.length - 1]!);
}

describe('tokenizer: typical lines', () => {
  it('line 1 is the title, whatever it says', () => {
    const [title] = tokenizeNetlist('R1 n1 0 2 ; looks like a part\nR1 n1 0 2');
    expect(show('R1 n1 0 2 ; looks like a part', title!)).toEqual(['R1 n1 0 2 ; looks like a part:title']);
  });

  it('parts: the first letter decides how many nodes come before the value', () => {
    expect(tok('V1 n1 0 6')).toEqual(['V1:element', 'n1:node=n1', '0:ground=0', '6:number']);
    expect(tok('R3 n1 a 2')).toEqual(['R3:element', 'n1:node=n1', 'a:node=a', '2:number']);
    expect(tok('E1 out 0 in 0 2')).toEqual(['E1:element', 'out:node=out', '0:ground=0', 'in:node=in', '0:ground=0', '2:number']);
    expect(tok('F1 0 n1 Vx 2')).toEqual(['F1:element', '0:ground=0', 'n1:node=n1', 'Vx:elementRef', '2:number']);
    expect(tok('H1 a b Vx 5')).toEqual(['H1:element', 'a:node=a', 'b:node=b', 'Vx:elementRef', '5:number']);
    expect(tok('D1 a k DMOD')).toEqual(['D1:element', 'a:node=a', 'k:node=k', 'DMOD:model']);
    expect(tok('X1 in out 0 opamp')).toEqual(['X1:element', 'in:node=in', 'out:node=out', '0:ground=0', 'opamp:model']);
    expect(tok('K1 L1 L2 0.99')).toEqual(['K1:element', 'L1:elementRef', 'L2:elementRef', '0.99:number']);
    expect(tok('Vx a x 0')).toEqual(['Vx:element', 'a:node=a', 'x:node=x', '0:number']); // the value 0, not a node
  });

  it('GND (any case) is ground, written as node "0"', () => {
    expect(tok('R1 a GND 1k')).toEqual(['R1:element', 'a:node=a', 'GND:ground=0', '1:number', 'k:scale']);
  });

  it('bipolar transistors: a 4th node only when a model name follows it', () => {
    expect(tok('Q1 c b e QMOD')).toEqual(['Q1:element', 'c:node=c', 'b:node=b', 'e:node=e', 'QMOD:model']);
    expect(tok('Q2 c b e s QMOD')).toEqual(['Q2:element', 'c:node=c', 'b:node=b', 'e:node=e', 's:node=s', 'QMOD:model']);
    expect(tok('Q3 c b e QMOD 2')).toEqual(['Q3:element', 'c:node=c', 'b:node=b', 'e:node=e', 'QMOD:model', '2:number']);
  });

  it('sources: DC/AC keywords and source functions', () => {
    expect(tok('V2 a 0 DC 5 AC 1')).toEqual(['V2:element', 'a:node=a', '0:ground=0', 'DC:keyword', '5:number', 'AC:keyword', '1:number']);
    expect(tok('V1 in 0 PULSE(0 5 0 1u 1u 1 2)')).toEqual([
      'V1:element', 'in:node=in', '0:ground=0', 'PULSE:function', '(:punctuation',
      '0:number', '5:number', '0:number', '1:number', 'u:scale', '1:number', 'u:scale', '1:number', '2:number', '):punctuation',
    ]);
  });

  it('parameters and expressions', () => {
    expect(tok('C1 out 0 1u ic=0')).toEqual(['C1:element', 'out:node=out', '0:ground=0', '1:number', 'u:scale', 'ic:parameter', '=:operator', '0:number']);
    expect(tok('B1 out 0 V=2*v(in)')).toEqual([
      'B1:element', 'out:node=out', '0:ground=0', 'V:parameter', '=:operator',
      '2*v:expression', '(:expression', 'in:expression', '):expression',
    ]);
    expect(tok('R1 a b {2*rval}')).toEqual(['R1:element', 'a:node=a', 'b:node=b', '{2*rval}:expression']);
  });

  it('dot commands', () => {
    expect(tok('.op')).toEqual(['.op:directive']);
    expect(tok('.tf v(a) V1')).toEqual(['.tf:directive', 'v:function', '(:punctuation', 'a:node=a', '):punctuation', 'V1:elementRef']);
    expect(tok('.dc V1 0 12 1')).toEqual(['.dc:directive', 'V1:elementRef', '0:number', '12:number', '1:number']);
    expect(tok('.tran 10u 5m')).toEqual(['.tran:directive', '10:number', 'u:scale', '5:number', 'm:scale']);
    expect(tok('.ac dec 10 1 1meg')).toEqual(['.ac:directive', 'dec:keyword', '10:number', '1:number', '1:number', 'meg:scale']);
    expect(tok('.ic v(n1)=0')).toEqual(['.ic:directive', 'v:function', '(:punctuation', 'n1:node=n1', '):punctuation', '=:operator', '0:number']);
    expect(tok('.print tran v(out) i(V1)')).toEqual([
      '.print:directive', 'tran:keyword', 'v:function', '(:punctuation', 'out:node=out', '):punctuation',
      'i:function', '(:punctuation', 'V1:elementRef', '):punctuation',
    ]);
    expect(tok('.model DMOD D(IS=1e-14)')).toEqual([
      '.model:directive', 'DMOD:model', 'D:keyword', '(:punctuation', 'IS:parameter', '=:operator', '1e-14:number', '):punctuation',
    ]);
    expect(tok('.end')).toEqual(['.end:directive']);
  });

  it('.title: the rest of the line is the title', () => {
    expect(tok('.title My divider')).toEqual(['.title:directive', 'My divider:title']);
  });

  it('a line starting with a digit is not a part', () => {
    expect(tok('5R a b 1')).toEqual(['5R:invalid', 'a:word', 'b:word', '1:word']);
  });

  it('lines after .end are read like any other (ngspice 47 still reads them)', () => {
    expect(tok('R9 n1 0 2', ['.end'])).toEqual(['R9:element', 'n1:node=n1', '0:ground=0', '2:number']);
  });
});

/*
 * The cases below were checked with native ngspice 47 on 9 Nov 2026 (V1 n 0 1 across R1, reading
 * I(V1); "*# let foo = 7" followed by ".control / print foo").
 */
describe('tokenizer: what ngspice 47 does with odd lines', () => {
  it('"*#" and "##" lines are commands ngspice runs, even outside .control; "* #" and "#" are comments', () => {
    expect(tok('*# let foo = 7')).toEqual(['*# let foo = 7:control']);
    expect(tok('## let foo = 7')).toEqual(['## let foo = 7:control']);
    expect(tok('  *# let foo = 7')).toEqual(['*# let foo = 7:control']);
    expect(tok('* # let foo = 7')).toEqual(['* # let foo = 7:comment']);
    expect(tok('# let foo = 7')).toEqual(['# let foo = 7:comment']);
  });

  it("a ';' or odd-character line swallows the '+' line after it (ngspice drops 'R1 n 0')", () => {
    expect(tok('+ 2', ['R1 n 0', ';note'])).toEqual(['+ 2:comment']);
    expect(tok('+ 2', ['R1 n 0', '=note'])).toEqual(['+ 2:comment']);
  });

  it("'*', '#', '$' and '//' lines do not (R1 gets its value 2 from the '+' line)", () => {
    for (const between of ['* note', '#note', '$note', '//note']) {
      expect(tok('+ 2', ['R1 n 0', between])).toEqual(['+:continuation', '2:number']);
    }
  });

  it('a value ends at + or - after a digit or letter, but not at the sign of an exponent', () => {
    const words = (text: string): string[] => valueParts(text).map((p) => text.slice(p.from, p.to));
    expect(words('1k-2')).toEqual(['1k', '-2']); // R1 n 0 1k-2 -> R = -2 ohms
    expect(words('1k+2')).toEqual(['1k', '+2']); // R = 2 ohms
    expect(words('1d-3')).toEqual(['1d', '-3']); // I1 0 n 1d-3 -> "unknown parameter (-3)"
    expect(words('1e-3')).toEqual(['1e-3']);
    expect(words('-6')).toEqual(['-6']);
    expect(tok('R1 n 0 1k-2')).toEqual(['R1:element', 'n:node=n', '0:ground=0', '1:number', 'k:scale', '-2:number']);
  });

  it('unbraced arithmetic in a value is an error (R1 n 0 2*3); braces or quotes make it an expression', () => {
    // ngspice's number reader ends "2" at the '*', which is a word of its own that stops ngspice
    // ("unknown parameter (*)"), so it and everything after it are invalid (as src/spice/parse.ts).
    expect(tok('R1 n 0 2*3')).toEqual(['R1:element', 'n:node=n', '0:ground=0', '2:number', '*:invalid', '3:invalid']);
    expect(tok('R1 n 0 2/4')).toEqual(['R1:element', 'n:node=n', '0:ground=0', '2:number', '/:invalid', '4:invalid']);
    expect(tok("R1 n 0 '2*3'")).toEqual(['R1:element', 'n:node=n', '0:ground=0', "'2*3':expression"]);
    expect(tok('R1 n 0 1,5k')).toEqual(['R1:element', 'n:node=n', '0:ground=0', '1:number', ',:punctuation', '5:number', 'k:scale']);
  });

  it('dot commands keep arithmetic as an expression (.param uses its own evaluator)', () => {
    expect(tok('.param r=2*1k')).toEqual(['.param:directive', 'r:parameter', '=:operator', '2*1k:expression']);
  });
});

describe('tokenizer: E, F, G and H given by a formula, POLY or the word for their kind (C3-5)', () => {
  it('an E or G formula is shown as on a B line; the two words before VALUE= that ngspice drops are not nodes', () => {
    expect(tok('E1 e 0 VALUE=v(out)*2')).toEqual([
      'E1:element', 'e:node=e', '0:ground=0', 'VALUE:parameter', '=:operator',
      'v:expression', '(:expression', 'out:expression', '):expression', '*:expression', '2:expression',
    ]);
    expect(tok('G1 0 e in 0 cur=v(out)*2m')).toEqual([
      'G1:element', '0:ground=0', 'e:node=e', 'in:word', '0:word', 'cur:parameter', '=:operator',
      'v:expression', '(:expression', 'out:expression', '):expression', '*:expression', '2m:expression',
    ]);
    expect(tok('E1 e 0 VALUE {v(out)*2}')).toEqual(['E1:element', 'e:node=e', '0:ground=0', 'VALUE:keyword', '{v(out)*2}:expression']);
  });

  it('POLY(n): n pairs of control nodes (E, G) or n voltage sources (F, H), then the coefficients', () => {
    expect(tok('E1 e 0 POLY(2) out 0 in 0 0 1 1')).toEqual([
      'E1:element', 'e:node=e', '0:ground=0', 'POLY:keyword', '(:punctuation', '2:number', '):punctuation',
      'out:node=out', '0:ground=0', 'in:node=in', '0:ground=0', '0:number', '1:number', '1:number',
    ]);
    expect(tok('H1 e 0 POLY(2) Vx V1 0 1k 1k')).toEqual([
      'H1:element', 'e:node=e', '0:ground=0', 'POLY:keyword', '(:punctuation', '2:number', '):punctuation',
      'Vx:elementRef', 'V1:elementRef', '0:number', '1:number', 'k:scale', '1:number', 'k:scale',
    ]);
  });

  it("HSPICE's word for the kind is a keyword on a line of exactly seven words (E, G) or six (F, H), else a node", () => {
    expect(tok('E1 e 0 vcvs out 0 2')).toEqual(['E1:element', 'e:node=e', '0:ground=0', 'vcvs:keyword', 'out:node=out', '0:ground=0', '2:number']);
    expect(tok('F1 0 e cccs Vx 2')).toEqual(['F1:element', '0:ground=0', 'e:node=e', 'cccs:keyword', 'Vx:elementRef', '2:number']);
    expect(tok('E1 e 0 vcvs out 2')).toEqual(['E1:element', 'e:node=e', '0:ground=0', 'vcvs:node=vcvs', 'out:node=out', '2:number']);
  });
});

describe('tokenizer: continuation lines', () => {
  it('a + line continues the part before it, across comment and blank lines', () => {
    expect(tok('+ 2', ['R1 n1 0'])).toEqual(['+:continuation', '2:number']);
    // ngspice joins "R1 n1" and "+ 0 2" (skipping the comment and blank line): 0 is the 2nd node.
    expect(tok('+ 0 2', ['R1 n1', '* a comment', ''])).toEqual(['+:continuation', '0:ground=0', '2:number']);
    expect(tok('+ PULSE(0 5)', ['V1 in 0'])).toEqual(['+:continuation', 'PULSE:function', '(:punctuation', '0:number', '5:number', '):punctuation']);
  });

  it('a + line with nothing to continue is marked invalid', () => {
    expect(tok('+ 2')).toEqual(['+:invalid', '2:word']);
  });
});

describe('tokenizer: subcircuits and .control', () => {
  it('nodes inside a .subckt definition are local; ground is not', () => {
    const lines = ['* t', '.subckt amp in out gnd', 'R1 in out 1k', '.ends amp', 'R2 in 0 1k'];
    const t = tokenizeNetlist(lines.join('\n'));
    // "gnd" as the last word of its line is not ground (inp_fix_gnd_name works the same on every
    // line, W9 in docs/spice-facts): here it is the subcircuit's own node called gnd.
    expect(show(lines[1]!, t[1]!)).toEqual(['.subckt:directive', 'amp:model', 'in:node=in local', 'out:node=out local', 'gnd:node=gnd local']);
    expect(show(lines[2]!, t[2]!)).toEqual(['R1:element', 'in:node=in local', 'out:node=out local', '1:number', 'k:scale']);
    expect(show(lines[4]!, t[4]!)).toEqual(['R2:element', 'in:node=in', '0:ground=0', '1:number', 'k:scale']);
  });

  it('.control blocks: control language, "$ " comments only', () => {
    const lines = ['* t', '.control', 'run $ go', 'set x=$y', '.endc', 'R1 a b 1 $c'];
    const t = tokenizeNetlist(lines.join('\n'));
    expect(show(lines[2]!, t[2]!)).toEqual(['run:control', '$ go:comment']);
    expect(show(lines[3]!, t[3]!)).toEqual(['set x=$y:control']);
    expect(show(lines[4]!, t[4]!)).toEqual(['.endc:directive']);
    expect(show(lines[5]!, t[5]!)).toEqual(['R1:element', 'a:node=a', 'b:node=b', '1:number', '$c:comment']);
  });
});

/*
 * Comments, as native ngspice 47 reads them (checked on 9 Nov 2026 by running
 * "V1 n1 0 6 / R1 n1 0 2<comment> / .op" and reading I(V1): -3 A means the text after R1's value
 * was ignored). Source: inp_stripcomments_line() in src/frontend/inpcom.c.
 */
describe('commentStart: where ngspice 47 starts a comment', () => {
  it.each([
    ['R1 n1 0 2 ; note 1k', 10, "';' after a space"],
    ['R1 n1 0 2;1k', 9, "';' glued to the value"],
    ['R1 n1 0 2 $ note 1k', 10, "'$ ' after a space"],
    ['R1 n1 0 2 $1k', 10, "'$' after a space, no space after"],
    ['R1 n1 0 2,$1k', 10, "'$' after a comma"],
    ['R1 n1 0 2\t$1k', 10, "'$' after a tab"],
    ['R1 n1 0 2 // note', 10, "'//' after a space"],
    ['R1 n1 0 2//1k', 9, "'//' glued to the value"],
    ['* R2 n1 0 2', 0, "'*' line"],
    ['   * R2 n1 0 2', 3, "'*' after spaces"],
    ['# R2 n1 0 2', 0, "'#' line (ngspice 47; ngspice 42 rejects it)"],
    [';R2 n1 0 2', 0, "';' line"],
    ['//R2 n1 0 2', 0, "'//' line"],
    ['$R2 n1 0 2', 0, "'$' line (ngspice warns: unusual leading character)"],
    ['&R2 n1 0 2', 0, "'&' line (ngspice warns)"],
  ])('%j -> %i (%s)', (line, at) => {
    const start = line.search(/\S/);
    expect(commentStart(line, start)).toBe(at);
  });

  it.each([
    ['R1 n1 0 2$1k', "'$' glued to the value is not a comment (ngspice reads 2 and ignores '$1k')"],
    ['R1 n1 0 2 * 1k', "'*' in the middle of a line is not a comment (ngspice: error)"],
    ['R1 n1 0 2 /1k', "a single '/' is not a comment (ngspice: model '/1k' not found)"],
    [".include 'a;b'", 'quoted text is skipped'],
  ])('%j has no comment (%s)', (line) => {
    expect(commentStart(line, 0)).toBe(-1);
  });

  it("inside .control only '$ ' with a space starts a comment", () => {
    expect(commentStart('set x=$y', 0, true)).toBe(-1);
    expect(commentStart('run $ go', 0, true)).toBe(4);
  });
});

/* Numbers, as native ngspice 47 reads them (checked by running R1 with each value, and I1 for f/a). */
describe('splitNumber: digits, scale suffix, ignored letters', () => {
  const parts = (text: string): string[] => {
    const n = splitNumber(text);
    if (!n) return [];
    const out = [text.slice(0, n.digits)];
    if (n.scale) out.push(`${text.slice(n.digits, n.digits + n.scale)}${n.capitalM ? '(capital M)' : ''}`);
    if (n.digits + n.scale < text.length) out.push(`ignored:${text.slice(n.digits + n.scale)}`);
    return out;
  };
  it.each([
    ['1T', ['1', 'T']],
    ['1Meg', ['1', 'Meg']],
    ['1MEG', ['1', 'MEG']],
    ['1mil', ['1', 'mil']],
    ['1m', ['1', 'm']],
    ['1M', ['1', 'M(capital M)']], // milli: R = 0.001 ohm
    ['1Mohm', ['1', 'M(capital M)', 'ignored:ohm']], // still milli
    ['10kOhm', ['10', 'k', 'ignored:Ohm']],
    ['3A', ['3', 'A']], // atto: 3e-18
    ['1F', ['1', 'F']], // femto: 1e-15
    ['1µ', ['1', 'µ']], // micro sign U+00B5: ngspice reads it as u
    ['1μ', ['1', 'ignored:μ']], // Greek mu U+03BC: ignored, so the value is 1
    ['10V', ['10', 'ignored:V']],
    ['1H', ['1', 'ignored:H']],
    ['1d3', ['1d3']], // d is an exponent: 1000
    ['2.5e-3k', ['2.5e-3', 'k']],
    ['.5', ['.5']],
    ['5.', ['5.']],
    ['1g5', ['1', 'g', 'ignored:5']],
    ['-6', ['-6']],
  ])('%s -> %j', (text, expected) => {
    expect(parts(text)).toEqual(expected);
  });
  it('words that do not start like a number', () => {
    expect(splitNumber('n1')).toBeNull();
    expect(splitNumber('.op')).toBeNull();
  });
});

describe('tokenizer: the fixtures', () => {
  const nodesOf = (text: string): string[] => [
    ...new Set(tokenizeNetlist(text).flat().filter((t) => t.node !== undefined).map((t) => t.node!)),
  ].sort();
  const expectedNodes: Record<string, string[]> = {
    'd1-dc-divider-sweep.cir': ['0', 'in', 'out'],
    'f1a-voltage-source.cir': ['0', 'n1'],
    'f1b-voltage-source-swapped.cir': ['0', 'n1'],
    'f2a-current-source.cir': ['0', 'n1'],
    'f2b-current-source-swapped.cir': ['0', 'n1'],
    'f3a-1M-trap.cir': ['0', 'n1', 'n2'],
    'f3b-1meg.cir': ['0', 'n1', 'n2'],
    'f4-tf-output-impedance.cir': ['0', 'a', 'n1', 's'],
    'f5-thevenin-cccs.cir': ['0', 'a', 'n1', 'x'],
    't1-tran-rc-charge.cir': ['0', 'in', 'out'],
  };
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.cir'));

  it('has expectations for every fixture', () => {
    expect(files.sort()).toEqual(Object.keys(expectedNodes).sort());
  });

  it.each(files)('%s: title, parts, dot commands and nodes', (file) => {
    const text = readFileSync(resolve(FIXTURES, file), 'utf8');
    const lines = text.split('\n');
    const tokens = tokenizeNetlist(text);
    expect(tokens[0]!.map((t) => t.type)).toEqual(['title']);
    lines.forEach((line, i) => {
      if (i === 0 || !line.trim()) return;
      const first = tokens[i]![0]!;
      expect(first.type).toBe(line.startsWith('.') ? 'directive' : 'element');
      // every character that is not a space belongs to a token
      const covered = tokens[i]!.reduce((n, t) => n + (t.to - t.from), 0);
      expect(covered).toBe(line.replace(/\s/g, '').length);
    });
    expect(nodesOf(text)).toEqual(expectedNodes[file]);
  });

  it('f3a: the capital M of 1M gets the capital-M style; 1meg does not', () => {
    const text = readFileSync(resolve(FIXTURES, 'f3a-1M-trap.cir'), 'utf8');
    const types = tokenizeNetlist(text).map((l) => l.map((t) => t.type));
    expect(types[2]).toContain('scaleCapitalM');
    expect(types[3]).toContain('scale');
    expect(types[3]).not.toContain('scaleCapitalM');
  });

  it('never returns an empty token and never overlaps', () => {
    for (const file of files) {
      for (const line of tokenizeNetlist(readFileSync(resolve(FIXTURES, file), 'utf8'))) {
        let end = 0;
        for (const t of line) {
          expect(t.to).toBeGreaterThan(t.from);
          expect(t.from).toBeGreaterThanOrEqual(end);
          end = t.to;
        }
      }
    }
  });
});

describe('tokenizeLine state', () => {
  it('is never mutated', () => {
    const state = START_STATE;
    const r1 = tokenizeLine('* title', state);
    const r2 = tokenizeLine('R1 a b 1k', r1.state);
    expect(state).toEqual({ line: 0, inControl: false, subckt: 0, statement: null });
    expect(r1.state.line).toBe(1);
    expect(r2.state.statement?.head).toBe('R');
  });
});

describe('the CodeMirror language gives each token its highlight tag', () => {
  it('highlights a netlist through the stream parser', () => {
    const doc = ['* T1: an RC circuit', 'V1 in 0 PULSE(0 5 0 1u 1u 1 2)', 'R1 in out 1M ; check', '.tran 10u 5m', '.end'].join('\n');
    const state = EditorState.create({ doc, extensions: [spiceLanguage] });
    const tree = ensureSyntaxTree(state, doc.length, 5000);
    expect(tree).not.toBeNull();
    const highlighter = tagHighlighter(
      (Object.keys(TOKEN_TAGS) as StyledTokenType[]).map((type) => ({ tag: TOKEN_TAGS[type], class: type })),
    );
    const spans: string[] = [];
    highlightTree(tree!, highlighter, (from, to, cls) => spans.push(`${doc.slice(from, to)}:${cls}`));
    expect(spans).toContain('* T1: an RC circuit:title');
    expect(spans).toContain('V1:element');
    expect(spans).toContain('in:node');
    expect(spans).toContain('0:ground');
    expect(spans).toContain('PULSE:function');
    expect(spans).toContain('M:scaleCapitalM');
    expect(spans).toContain('; check:comment');
    expect(spans).toContain('.tran:directive');
    expect(spans).toContain('u:scale');
  });
});

describe('very long statements (security review M3)', () => {
  it('tokenizes 25 000 continuation lines in a moment, styling the first MAX_STYLED_PIECES words', () => {
    const text = `* t\nV1 a 0 PWL(0 0\n${'+ 1 2\n'.repeat(25_000)}+ )\nR1 a 0 1k\n.op\n.end\n`;
    const t0 = performance.now();
    const lines = tokenizeNetlist(text);
    // It used to grow with the square of the number of lines: over a minute for this netlist.
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(lines[2]!.map((t) => t.type)).toEqual(['continuation', 'number', 'number']);
    expect(lines[20_000]!.map((t) => t.type)).toEqual(['continuation', 'word', 'word']);
    // The statement still ends where it ends: the next part is styled as usual.
    expect(lines[25_003]!.map((t) => t.type)).toContain('element');
    expect(MAX_STYLED_PIECES).toBeGreaterThanOrEqual(800);
  });
});

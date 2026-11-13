/**
 * The last pass before the release (13 November 2026), the words lane: the texts of older checks say what each
 * ngspice version does, from native runs of 47 and 42 (docs/spice-facts/traps.md; F4, F5, F10), and name a node
 * the way every other sentence on the page does (src/spice/node-words.ts; F6). Each case failed on c520a49.
 */
import { describe, expect, it } from 'vitest';
import { parseNetlist } from '../../src/spice/parse.ts';
import { checkTraps } from '../../src/spice/traps.ts';
import type { Trap } from '../../src/spice/types.ts';

const traps = (text: string): Trap[] => checkTraps(parseNetlist(text));
const first = (text: string, id: string): Trap => {
  const t = traps(text).find((x) => x.id === id);
  if (!t) throw new Error(`no ${id} trap in ${JSON.stringify(text)}`);
  return t;
};

/**
 * The version a quoted message is put to: the last "ngspice 47", "ngspice 42", "PlainSpice's engine" or plain
 * "ngspice" (both versions) before the quote in the text.
 */
function quotedBy(text: string, quote: string): string[] {
  const out: string[] = [];
  for (let at = text.indexOf(`'${quote}`); at >= 0; at = text.indexOf(`'${quote}`, at + 1)) {
    const marks = [...text.slice(0, at).matchAll(/ngspice 47 and 42|[Nn]ative ngspice 47|ngspice 47|ngspice 42|PlainSpice's engine|[Nn]gspice(?! 4)/g)];
    out.push(marks.at(-1)?.[0] ?? 'ngspice');
  }
  return out;
}

describe('F10: a message only ngspice 47 prints is said as ngspice 47’s, with ngspice 42’s beside it', () => {
  it('"no such parameter on this device or parameter is missing" is 47’s; 42 prints "no such parameter on this device" (space-before-suffix-12, unknown-word-6)', () => {
    expect(first('* a space before p on a resistor\nI1 0 n1 1\nR1 n1 0 1 p\n.op\n.end\n', 'space-before-suffix').ngspice).toBe(
      "ngspice 47 stops: 'no such parameter on this device or parameter is missing' (ngspice 42: 'no such parameter on this device'), as p is a value ngspice can report for the part, not one you can set. [space-before-suffix-12]",
    );
    expect(first('* a value the resistor can only report\nI1 0 n1 1\nR1 n1 0 1k i\n.op\n.end\n', 'unknown-word').ngspice).toBe(
      "ngspice 47 stops: 'no such parameter on this device or parameter is missing' (ngspice 42: 'no such parameter on this device'). [unknown-word-6]",
    );
    // A capacitor and an inductor give the same two messages (native 47 and 42, re-run after the last pass).
    for (const [line, id] of [['C1 out 0 1 p', 'space-before-suffix'], ['L1 out 0 1 v', 'space-before-suffix'], ['C1 out 0 1u i', 'unknown-word'], ['L1 out 0 1m flux', 'unknown-word'], ['R1 out 0 1k sens_dc', 'unknown-word']] as const) {
      const t = first(`* t\nV1 in 0 1\nR9 in out 1k\n${line}\n.op\n.end\n`, id);
      expect(quotedBy(t.ngspice, 'no such parameter on this device or parameter is missing'), line).toEqual(['ngspice 47']);
      expect(t.ngspice, line).toContain("(ngspice 42: 'no such parameter on this device')");
    }
  });

  it('a B line without V= or I=: 47’s "mal formed B source instance", 42’s "mal formed B line" (fatal-syntax-7)', () => {
    expect(first('* a B line without V= or I=\nV1 a 0 1\nR1 a 0 1\nB1 b 0 5\nR2 b 0 1\n.op\n.end\n', 'fatal-syntax').ngspice).toBe(
      "ngspice 47 stops with a fatal error: 'mal formed B source instance' (ngspice 42: 'mal formed B line'). [fatal-syntax-7]",
    );
  });

  it('no analysis: each version’s own last line in batch mode (no-analysis-1)', () => {
    expect(first('* no analysis line\nV1 a 0 6\nR1 a 0 2\n.end\n', 'no-analysis').ngspice).toBe(
      "ngspice reads the circuit and runs nothing. In batch mode ngspice 47 ends with 'no simulations run!' and ngspice 42 with 'Note: No \".plot\", \".print\", or \".fourier\" lines; no simulations run'; PlainSpice's engine gives no results and no message. [no-analysis-1]",
    );
  });

  it('.pss: ngspice 47 as built for PlainSpice does not know it, ngspice 42 does (unknown-dot-command-2, A29b); a typo stops both (unknown-dot-command-1)', () => {
    const pss = first('* .pss in a netlist\nV1 a 0 1\nR1 a 0 1k\n.pss 1k 1m a 1\n.op\n.end\n', 'unknown-dot-command');
    expect([pss.title, pss.why, pss.ngspice]).toEqual([
      'ngspice 47 does not know .pss',
      'A line starting with a dot is a dot command for SPICE, and .pss is not one ngspice 47 knows as built for PlainSpice (ngspice 42 knows it). To keep the line as a note, start it with * instead.',
      "ngspice 47 stops before running anything, with 'unimplemented dot command' for .pss; ngspice 42 knows .pss. [unknown-dot-command-2]",
    ]);
    expect(first('* t\nV1 a 0 1\nR1 a 0 1k\n.PSS 1k 1m a 1\n.op\n.end\n', 'unknown-dot-command').title).toBe('ngspice 47 does not know .PSS');
    const tarn = first('* a misspelt dot command\nV1 a 0 1\nR1 a 0 1k\n.tarn 1u 1m\n.op\n.end\n', 'unknown-dot-command');
    expect([tarn.title, tarn.ngspice]).toEqual(['ngspice does not know .tarn', "ngspice stops before running anything, with 'unimplemented dot command' for .tarn. [unknown-dot-command-1]"]);
  });

  it('the transient op is quoted as ngspice prints it: "Note: Transient op started" (no-ground-1, floating-dc-1, current-source-no-path-1, voltage-loop-5, -11)', () => {
    const cases: [string, string][] = [
      ['* t\nV1 a b 6\nR1 a b 2\n.op\n.end\n', 'no-ground'],
      ['* t\nV1 a 0 6\nC1 a b 1u\nC2 b 0 1u\n.op\n.end\n', 'floating-dc'],
      ['* t\nI1 0 b 1m\nC1 b 0 1u\nR1 a 0 1k\nV1 a 0 1\n.op\n.end\n', 'current-source-no-path'],
      ['* t\nV1 a 0 6\nR1 a 0 2\nL1 a 0 1m\n.op\n.end\n', 'voltage-loop'],
      ['* t\nV1 a 0 6\nR1 a 0 2\nL1 a a 1m\n.op\n.end\n', 'voltage-loop'],
    ];
    for (const [text, id] of cases) {
      const t = first(text, id);
      expect(t.ngspice, id).toContain("falls back to a transient op ('Note: Transient op started')");
      expect(t.ngspice, id).not.toContain("'transient op'");
    }
  });

  it('no other text puts these 47-only messages to plain "ngspice"', () => {
    const only47 = ['no such parameter on this device or parameter is missing', 'mal formed B source instance', 'no simulations run!'];
    const lines = ['R1 n1 0 1 p', 'R1 n1 0 1k i', 'C1 n1 0 1 p', 'L1 n1 0 1 v', 'L1 n1 0 1m i', 'B1 n1 0 5', 'E1 n1 0 n2 0 2 p', 'G1 0 n1 n2 0 2 i', 'V2 n2 0 PULSE(0 \u200b1 0 1n 1n 1 2)'];
    for (const line of lines) {
      for (const t of traps(`* t\nI1 0 n1 1\nR0 n1 0 1k\n${line}\nR8 n2 0 1k\n.op\n.end\n`)) {
        for (const q of only47) for (const who of quotedBy(t.ngspice, q)) expect([`${line}: ${who}`]).not.toContain(`${line}: ngspice`);
      }
    }
    for (const who of quotedBy(first('* t\nV1 a 0 6\nR1 a 0 2\n.end\n', 'no-analysis').ngspice, 'no simulations run!')) expect(who).toBe('ngspice 47');
  });
});

describe('F4, F5: a resistance below 1e-12 Ω, said as each ngspice version treats it (zero-ohm-1, -7, -8, P24)', () => {
  const warn47 = (name: string, sign = ''): string => `warns 'Value of resistor ${name} is too small, set to ${sign}1.000000e-12'`;

  it('3a on a resistor: one card, unit-letter’s, saying ngspice 47 warns and raises it and ngspice 42 keeps it; its fix writes 3 (P24, zero-ohm-8)', () => {
    const found = traps('* 3a on a resistor\nI1 0 n1 1\nR1 n1 0 3a\n.op\n.end\n');
    expect(found.map((t) => t.id)).toEqual(['unit-letter']);
    expect(found[0]!.ngspice).toBe(
      `ngspice reads 3a as 3 attoohms, which ngspice 47 cannot use: it uses 1e-12 Ω instead and ${warn47('r1')} (ngspice 42 keeps it as written, without a word). [unit-letter-1, unit-letter-2, zero-ohm-7]`,
    );
    expect(found[0]!.ngspice).not.toMatch(/says nothing|without a message|0\.001/);
    expect(found[0]!.fixes.map((f) => f.label)).toEqual(['Write 3 (3 ohms)']);
    // Across a source the error stays beside it, as for a 0 (zero-ohm-2, -8).
    const across = traps('* t\nV1 a 0 6\nR1 a 0 3a\n.op\n.end\n');
    expect(across.map((t) => [t.id, t.severity])).toEqual([['unit-letter', 'warning'], ['zero-ohm', 'error']]);
    expect(across[1]!.title).toBe('R1 shorts V1: its current comes out enormous');
    expect(across[1]!.why).toMatch(/^A resistance this close to 0 straight across a voltage source would need an enormous current/);
  });

  it('a plain value below 1e-12 Ω that is not 0: ngspice 42 keeps it as written, and a negative one is set to −1e-12 Ω (zero-ohm-7)', () => {
    const f = first('* t\nV1 a 0 6\nR1 a b 1f\nR2 b 0 2\n.op\n.end\n', 'zero-ohm');
    expect([f.title, f.ngspice]).toEqual(['R1 has a resistance of 1\u00a0fΩ', `ngspice 47 uses 1e-12 Ω instead and ${warn47('r1')}. ngspice 42 keeps it as written, without a word. [zero-ohm-7]`]);
    expect(f.why).toBe("A resistance this small is almost 0, and SPICE can't use a resistance of 0: a resistor's current is its voltage divided by its resistance. For a wire, give both ends the same node name; to measure the current in a wire, use a 0 V source (the ammeter trick).");
    expect(f.fixes.map((x) => x.label)).toEqual(['Use a 0 V source instead (VR1)']);
    const neg = first('* t\nV1 a 0 6\nR1 a b -3e-18\nR2 b 0 2\n.op\n.end\n', 'zero-ohm');
    expect(neg.ngspice).toBe(`ngspice 47 uses −1e-12 Ω instead and ${warn47('r1', '-')}. ngspice 42 keeps it as written, without a word. [zero-ohm-7]`);
    expect(first('* t\nV1 a 0 6\nR1 a b -3a\nR2 b 0 2\n.op\n.end\n', 'unit-letter').ngspice).toContain(`${warn47('r1', '-')} (ngspice 42 keeps it as written, without a word)`);
    // Inside a subcircuit, with ngspice's name for each use (zero-ohm-6).
    const sub = first('* t\n.subckt div a b\nR1 a b 1f\nR2 b 0 1\n.ends\nV1 in 0 1\nX1 in out div\n.op\n.end\n', 'zero-ohm');
    expect(sub.ngspice).toBe(`ngspice 47 uses 1e-12 Ω instead and ${warn47('r.x1.r1')}. ngspice 42 keeps it as written, without a word. [zero-ohm-7, zero-ohm-6]`);
  });

  it('a value of exactly 0 keeps ngspice 42’s 1 mΩ, with no digit of one test said as every circuit’s (zero-ohm-1; F5)', () => {
    const f = first('* a 0 ohm resistor\nV1 a 0 6\nR1 a b 0\nR2 b 0 2\n.op\n.end\n', 'zero-ohm');
    expect(f.ngspice).toBe(`ngspice 47 uses 1e-12 Ω instead and ${warn47('r1')}. ngspice 42 used 0.001 Ω without a word. [zero-ohm-1, zero-ohm-2]`);
    expect(f.ngspice).not.toMatch(/digit/);
    expect(f.why).toMatch(/^SPICE can't use a resistance of exactly 0/);
    // Never "0.001" or the 4th digit for a value that is not 0.
    for (const value of ['1f', '1e-15', '-1e-13', '0.5p', '999999a']) {
      for (const t of traps(`* t\nV1 a 0 6\nR1 a b ${value}\nR2 b 0 2\n.op\n.end\n`)) expect(`${value}: ${t.ngspice}`).not.toMatch(/0\.001|4th digit|says nothing|without a message/);
    }
    // 1e-12 itself is no trap: ngspice 47 warns only below it (zero-ohm-7's sweep: 1e-12, 1p and 1000000a run silently).
    expect(traps('* t\nV1 a 0 6\nR1 a b 1p\nR2 b 0 2\n.op\n.end\n')).toEqual([]);
  });

  it('every check that reads a tiny value says what ngspice 47 and 42 do with it, never "without a message" (mega-as-milli, a hidden character, a decimal comma)', () => {
    const mega = first('* t\nV1 a 0 6\nR1 a b 1e-10M\nR2 b 0 2\n.op\n.end\n', 'mega-as-milli');
    expect(mega.ngspice).toContain(`which ngspice 47 cannot use: it uses 1e-12 Ω instead and ${warn47('r1')} (ngspice 42 keeps it as written, without a word)`);
    const hidden = first('* t\nV1 a 0 6\nR1 a b 1e-15\u200b5\nR2 b 0 2\n.op\n.end\n', 'invisible-character');
    expect(hidden.ngspice).toContain(`which ngspice 47 cannot use: it uses 1e-12 Ω instead and ${warn47('r1')} (ngspice 42 keeps it as written, without a word)`);
    expect(hidden.ngspice).not.toContain('without a message');
    for (const text of ['* t\nV1 a 0 6\nR1 a b 1e-10M\nR2 b 0 2\n.op\n.end\n', '* t\nV1 a 0 6\nR1 a b 1e-15\u200b5\nR2 b 0 2\n.op\n.end\n']) {
      expect(traps(text).map((t) => t.id), text).not.toContain('zero-ohm');
    }
  });
});

describe('F6: every check names a node as the rest of the page does: "node in", "node1", \'node "ground"\', "ground" (node-words.ts)', () => {
  const all = (t: Trap): string[] => [t.title, t.why, ...t.fixes.map((f) => f.label)];

  it('floating-dc: the reviewer’s capacitors, in the title the status line shows, the why and the fix', () => {
    const t = first('* capacitors only\nV1 x 0 6\nC1 x in 1u\nC2 in 0 1u\n.op\n.end\n', 'floating-dc');
    expect(t.title).toBe('Node in has no DC path to ground');
    expect(t.why).toMatch(/^At DC a capacitor is an open circuit, so nothing connects node in to ground\./);
    expect(t.fixes.map((f) => f.label)).toEqual(['Add a 1 GΩ resistor from node in to ground']);
    // ngspice's own words stay as it prints them.
    expect(t.ngspice).toContain("ngspice warns 'singular matrix: check node in'");
    // Two nodes, one of them a name that says node: never "node node1", and node1 keeps its letters at the start.
    expect(first('* t\nV1 in 0 5\nC1 in node1 1u\nR1 node1 x 1k\nC2 x 0 1u\n.op\n.end\n', 'floating-dc').title).toBe('node1 and node x have no DC path to ground');
    // A control input alone: the node starts the why.
    expect(first('* t\nV1 a 0 6\nR1 a 0 2\nE1 out 0 c 0 2\nR2 out 0 1\n.op\n.end\n', 'floating-dc').why).toMatch(/^Node c is used only as the control input of E1/);
    // A current source into such a node.
    expect(first('* t\nI1 0 b 1m\nC1 b 0 1u\nR1 a 0 1k\nV1 a 0 1\n.op\n.end\n', 'current-source-no-path').why).toContain('Here node b has no DC path back to ground');
  });

  it('no-ground and ground-misnamed: "Make node b the ground", \'Node "ground" is not ground\', \'Rename node "00" to 0\'', () => {
    expect(first('* t\nV1 a b 6\nR1 a b 2\n.op\n.end\n', 'no-ground').fixes.map((f) => f.label)).toEqual(['Make node b the ground (rename it to 0)']);
    const g = first('* t\nV1 n1 ground 6\nR1 n1 0 2\n.op\n.end\n', 'ground-misnamed');
    expect(all(g)).toEqual([
      'Node "ground" is not ground: ground is node 0',
      'In SPICE, ground is the node called 0 (gnd works too). Node "ground" is just an ordinary node, so the parts on it are not connected to ground.',
      'Rename node "ground" to 0',
    ]);
    expect(g.ngspice).toMatch(/^ngspice says nothing and treats node "ground" as an ordinary node\./);
    expect(first('* t\nV1 n1 00 6\nR1 n1 0 2\n.op\n.end\n', 'ground-misnamed').title).toBe('Node "00" is not ground: ground is node 0');
    expect(first('* t\nV1 n1 earth 6\nR1 n1 0 2\n.op\n.end\n', 'ground-misnamed').fixes.map((f) => f.label)).toEqual(['Rename node earth to 0']);
    const last = first('* t\nV1 a 0 6\nR1 a b 2\nVx b gnd\n.op\n.end\n', 'ground-misnamed');
    expect([last.title, last.fixes.map((f) => f.label)]).toEqual(['Node "gnd" at the end of a line is not ground', ['Rename node "gnd" to 0']]);
  });

  it('dangling-node: "Only R2 touches node n12", "Did you mean node n2 or node n1?", "Rename node n12 to n2"', () => {
    const t = first('* t\nV1 n1 0 6\nR1 n1 n2 2\nR2 n12 0 4\nI1 0 n2 3\n.op\n.end\n', 'dangling-node');
    expect(all(t)).toEqual([
      'Only R2 touches node n12',
      'A node needs at least two connections for current to flow through it. Node n12 appears only here, so no current flows in R2. Did you mean node n2 or node n1?',
      'Rename node n12 to n2',
      'Rename node n12 to n1',
    ]);
    const open = first('* t\nV1 in 0 6\nR1 in 0 1k\nR2 in out 1k\n.op\n.end\n', 'dangling-node');
    expect([open.title, open.why]).toEqual(['Only R2 touches node out', 'No current flows in R2, so node out sits at the same voltage as node in. That is right for an open terminal where you measure a voltage; if R2 should connect to something, check this node name.']);
    expect(first('* t\nV1 in 0 6\nR1 in 0 1k\nR2 0 node1 1k\n.op\n.end\n', 'dangling-node').why).toBe('No current flows in R2, so node1 sits at the same voltage as ground (node 0). That is right for an open terminal where you measure a voltage; if R2 should connect to something, check this node name.');
  });

  it('voltage-loop: "V2 has both ends on node in", "L1 has both ends on node1", "connects node1 to itself"', () => {
    const found = traps('* t\nV1 in 0 6\nR1 in 0 1k\nV2 in in 1\nL1 node1 node1 1m\nR2 node1 0 1\n.op\n.end\n').filter((t) => t.id === 'voltage-loop');
    expect(found.map((t) => t.title)).toEqual(['V2 has both ends on node in', 'L1 has both ends on node1']);
    expect(found[1]!.why).toMatch(/^L1 connects node1 to itself, so it does nothing/);
    expect(first('* t\nV1 0 0 6\nR1 a 0 1k\nV2 a 0 1\n.op\n.end\n', 'voltage-loop').title).toBe('V1 has both ends on ground');
  });

  it('names outside a to z, the micro sign and the characters that are not what they look like', () => {
    expect(first('* t\nV1 ş 0 5\nR1 ş ç 1k\nR2 ç 0 1k\n.op\n.end\n', 'non-ascii-node').title).toBe('Node ş and node ç are one node for ngspice');
    expect(first('* t\nV1 giriş 0 5\nR1 giriş 0 1k\n.op\n.end\n', 'non-ascii-node').fixes.map((f) => f.label)).toEqual(['Rename node giriş to giris']);
    // A name that says node keeps it alone: never "the node nodeş" or "node nodeş".
    const own = first('* t\nV1 nodeş 0 5\nR1 nodeş 0 1k\n.op\n.end\n', 'non-ascii-node');
    expect([own.title, own.ngspice.slice(0, 40), own.fixes[0]!.label]).toEqual(['ngspice spells nodeş as node__', 'ngspice spells node__ in its printout an', 'Rename nodeş to nodes']);
    const micro = first('* t\nV1 in 0 5\nR1 in aµ 1k\nR2 au 0 1k\nR3 aµ au 1k\n.op\n.end\n', 'non-ascii-node');
    expect([micro.title, micro.fixes.map((f) => f.label)]).toEqual(['Node aµ and node au are one node for ngspice', ['Rename node aµ to au2']]);
    expect(micro.why).toContain('Give node aµ a name of its own in plain letters.');
    expect(first('* t\nV1 in 0 6\nR1 in out 1k\nR2 ou\u200bt 0 2k\n.op\n.end\n', 'invisible-character').fixes.map((f) => f.label)).toEqual(['Take it out: connect to node out']);
    const thin = first('* t\nV1 in 0 10\nR1 in o\u2009ut 2k\nR2 out 0 2k\n.op\n.end\n', 'space-character');
    expect(thin.why).toMatch(/the parts on it are not connected to node out\.$/);
    const cy = first('* t\nV1 in 0 6\nR1 in out 1k\nR2 оut 0 2k\n.op\n.end\n', 'look-alike-letter');
    expect([cy.why.replace(/^.*(the parts)/, '$1'), cy.fixes.map((f) => f.label)]).toEqual(['the parts on it are not connected to node out.', ['Connect to node out']]);
    // An ordinary node named like ground, hidden behind a character, is quoted as the other checks quote it.
    expect(first('* t\nV1 in 0 6\nR1 in ground 1k\nR2 gro\u200bund 0 2k\nR3 ground 0 1k\n.op\n.end\n', 'invisible-character').fixes.map((f) => f.label)).toEqual(['Take it out: connect to node "ground"']);
  });

  it('no check’s words say "node node1", or a bare node name where a sentence starts', () => {
    const nets = [
      '* t\nV1 node1 0 5\nC1 node1 node2 1u\nC2 node2 0 1u\nR9 node3 0 1k\nR8 node3 node4 1k\nR7 node4 0 1k\n.op\n.end\n',
      '* t\nV1 a b 6\nR1 a b 2\nR2 node7 b 1\n.op\n.end\n',
      '* t\nV1 node1 0 6\nR1 node1 node2 2\nR2 node12 0 4\nI1 0 node2 3\n.op\n.end\n',
      '* t\nI1 0 node9 1m\nC1 node9 0 1u\nR1 a 0 1k\nV1 a 0 1\n.op\n.end\n',
      '* t\nV1 node1 0 6\nR1 node1 0 2\nE1 out 0 node5 0 2\nR2 out 0 1\n.op\n.end\n',
      '* t\nV1 in 0 6\nR1 in 0 1k\nL1 node1 node1 1m\nR2 node1 0 1\n.op\n.end\n',
      '* t\nV1 x 0 6\nC1 x in 1u\nC2 in 0 1u\nR3 x out 1k\n.op\n.end\n',
      '* t\nV1 n1 0 6\nR1 n1 a 2\nR2 b 0 4\nR3 a 0 1\n.op\n.end\n',
    ];
    for (const text of nets) {
      for (const t of traps(text)) {
        for (const w of all(t)) expect(w, text).not.toMatch(/\bnode node\d|\bthe node node\d/i);
        if (['floating-dc', 'dangling-node', 'ground-misnamed'].includes(t.id)) expect(t.title, text).not.toMatch(/^(in|a|b|c|out|x)\b/);
      }
    }
  });
});

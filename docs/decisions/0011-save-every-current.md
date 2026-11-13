# 0011. For an operating point, the copy that runs saves every current

- Status: accepted
- Date: 2026-11-10
- Facts: A1 and A2 in [`../spice-facts/explanations.md`](../spice-facts/explanations.md)

## Context

The brief asks for "results on the circuit (node voltages, branch currents with direction)". In
an operating point (`.op`), ngspice saves every node voltage but only the currents of voltage
sources, E and H sources and inductors (A1). The current through a resistor, a capacitor, a
current source or an F or G source is saved only with `.options savecurrents` (A2). Beginners
rarely write that line, and without it PlainSpice could not say "3 A from n1 to 0 through R1".

PlainSpice also promises to run ngspice exactly like `ngspice -b -r`, so that what a student sees
is what ngspice on their own computer would give.

## Decision

When a netlist has `.op` and no `.options savecurrents`, PlainSpice adds the line
`.options savecurrents` just before `.end` in the copy it gives ngspice
(`src/spice/run-netlist.ts`). The student's text is never changed, and the ngspice output tab
shows the added line and why it was added. Netlists without `.op` run exactly as written.

## Why this is safe

- The node voltages and the voltage-source currents are the same, bit for bit, with or without
  the line: `tests/golden/run-netlist.test.ts` runs every fixture with `.op` both ways.
- The line goes just before `.end`, so it moves none of the student's lines: "line N" in
  ngspice's messages still points at line N of the editor.
- Export (ngspice and LTspice files) writes the student's text, not the copy that ran.
- ngspice's savecurrents values for switches (S, W) in `.op` are wrong (C8), so PlainSpice does
  not show them.

## Consequences

- ngspice's own printout in the output tab lists the extra currents (`@r1[i]` …), so it differs
  from what `ngspice -b` prints for the student's file; the tab says why.
- `.dc` and `.tran` runs are left alone: saving every current there would make the plots and the
  rawfile much larger for little gain. A student who wants those currents adds the line.

## After the final reviews (12 November 2026)

- **Added for every `.op` that runs, long names too** (second re-check, P1). To save a part's
  current, ngspice copies its full name (inside subcircuits its letter, the X lines and its name,
  `r.x1.x2.r1`) into a space of 512 bytes without checking (limit-3 in
  [`../spice-facts/limits.md`](../spice-facts/limits.md)); our engine crashed on a part name of 600
  bytes with the line added, and ran it without. A netlist with a name that long is not run at all
  (decision 0012: every name, as written or as ngspice makes it inside subcircuits, at most 250
  bytes), so the line can always be added: every name it saves fits, with `.save alli` too (limit-7).
  Not taken: leaving the line out when a name is too long to save, which an earlier version of this
  fix did. It saved fewer currents with only a note in the ngspice output tab, and the names it let
  through reach other spaces as well: a `.control` block's `print` and `display` (limit-10).
- **Not added when a `+` line just after `.end` continues the line before it** (round-2 critic of the
  second re-check). ngspice makes `.end` a comment and reads on, so such a `+` line continues the last
  line before `.end` (limit-18 in [`../spice-facts/limits.md`](../spice-facts/limits.md)); with
  `.options savecurrents` added just before `.end` it would continue that line instead: `B1 c 0 V=1+`,
  `.end`, `+ v(b)` runs natively with v(c) = 7 V, and with the line added stops with "YYparse error". The
  copy then runs as written, every voltage the same (A2), without the extra currents. Not taken: adding the
  line after the `+` lines, at the end of the text, where a `.control` block left open would take it as a
  command; the case is a `+` line after `.end`, which no netlist we have comes near.

## After the last pass (13 November 2026)

- **When the `+` line keeps the line out, the student is told** (the last pass, regress-3). What runs is
  the same; only the words change. S28 (`R1 n1 0 2`, `.end`, `+ 3`) gave the right 3 V with no current at
  all (I1's 1 A and R1's were gone), and nothing said why, while Explain's `.op` note said "PlainSpice adds
  that line to the copy it runs". Now the copy's notes (`RUN_COPY_WORDS.plusAfterEnd`, shown in the ngspice
  output panel where the added line is shown otherwise) name the `+` line and the line ngspice continues
  with it, the last line of its own before `.end` (past blank and comment lines, `+` lines before `.end`, a
  `.title` line and `*#` lines, which are comments to ngspice by then): "PlainSpice did not add .options
  savecurrents to the copy ngspice ran. Line 6, after .end, starts with +: ngspice does not stop reading at
  .end, so line 6 continues line 4, and with the line added just before .end it would continue that line
  instead. So ngspice saved the current only through voltage sources, E and H sources and inductors, not
  through every part. Move .end to the bottom (the Checks panel offers it) to see the current through every
  part." The way out is the after-end check's own fix, in its words. Explain's `.op` note says PlainSpice
  adds the line only where the copy does (`plusLineAfterEnd`, found once per netlist), and otherwise "…
  PlainSpice does not add that line to the copy it runs here, because of the + line after .end (line 6)."
  Fact A2c (native ngspice 47 and 42, and our engine): as written v(n1) = 3 V and no current saved; with
  the line just before `.end`, 2 V (the `+` line continues it); with `.end` moved to the bottom and the line
  before it, 3 V, 1 A through R1 and 1 A from I1. Tests: `tests/unit/spice-run-netlist.test.ts` (the note,
  naming lines 9 and 7 for the B source above and 6 and 4 for S28; the lines it skips; none with
  savecurrents written, without `.op`, or after a glued `.end`), `tests/unit/spice-explain.test.ts`,
  `tests/golden/facts-explain.test.ts` (A2c, the fix's copy and Explain), `tests/e2e/run-copy.spec.ts` (the
  S28 link's output panel). Not taken: a note in the Numbers panel, which would need a new place there and
  already sends the student to the Checks panel.
- **Still open, for after the release** (left as they are, as what runs does not change now):
  - The parser does not join a `+` line after `.end` to the line it continues (it stops reading at `.end`),
    so the drawing, the overview, R1's card ("SPICE reads it as 2 Ω") and Explain call R1 2 Ω where ngspice
    uses 3 Ω (S28). This is older, pinned by the S28 golden row; the results are ngspice's (3 V), and the
    after-end check's fix makes both agree.
  - After a `.end` with a comment glued to it (`.end;x`), ngspice stops reading (S27): a `+` line after it
    continues no line before it, yet the copy still leaves the line out, so the currents are gone with no
    note (none could say the `+` line continues a line, as it does not). Adding the line there changes
    nothing: native 47 and 42 give v(n1) = 2 V with it or without, and 1 A through R1 and from I1 with it.
  - A `+` line that brings no words (`+`, or `+ ; a note`) changes nothing either way (native 47 and 42:
    2 V, and both currents with the line), but keeps the line out; the note's words hold for it (line 6
    continues line 4, adding nothing).
  - Both would end with the line added there, and the currents back; adding it after the `+` lines when no
    `.control` block is left open (native 47 and 42: S28 3 V with both currents, the B source above 7 V)
    would bring them back for S28 too. Each changes what runs, so not in this pass.


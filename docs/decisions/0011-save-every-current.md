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

- **Not when a part's full name is too long to save** (second re-check, P1). To save a part's
  current, ngspice copies its full name (inside subcircuits its letter, the X lines and its name,
  `r.x1.x2.r1`) into a space of 512 bytes without checking (limit-3 in
  [`../spice-facts/limits.md`](../spice-facts/limits.md)); our engine crashed on a part name of 600
  bytes with the line added, and ran it without. So the line is added only while every part's full
  name is at most 500 bytes; else it is left out, and the ngspice output tab says why: then only the
  currents ngspice always saves are shown. Each name is at most 250 bytes (decision 0012), so only
  names nested in subcircuits can reach that. A netlist with its own `.options savecurrents` and such
  a name is not run (decision 0012).


# EEcircuit and PlainSpice: what we do differently

[EEcircuit](https://github.com/eelab-dev/EEcircuit) (MIT, by Danial Chitnis) is the closest existing
tool: ngspice compiled to WebAssembly, in the browser. We studied it before writing any code
(full study with evidence: [`research/eecircuit.md`](research/eecircuit.md), and its engine:
[`research/engine.md`](research/engine.md), fact-checked in
[`research/engine-factcheck.md`](research/engine-factcheck.md)).

**In one sentence:** EEcircuit is a polished schematic-first simulator for chip designers;
PlainSpice is netlist-first and made for first- and second-year students, who learn by reading
and writing the netlist and need every line, every trap and every result explained.

## What EEcircuit is (9 Nov 2026, branch `gen2-next`)

- **Audience:** "the VLSI and chip-design communities" (its README); the demo is a 90 nm MOSFET
  amplifier, and its engine ships chip-process model files.
- **Stack:** Svelte 5 + Ark UI, Monaco editor, its own WebGL plots, the `eecircuit-engine` npm
  package in Web Workers (started early, 30 s timeout, newest run wins, no Stop button).
- **Netlist second:** the netlist tab is locked until you press Simulate on the schematic, and
  hand edits count only in a "None" analysis mode.
- **Results:** plots and a CSV download. No `.op` or `.tf` view, no values on the circuit, no
  units on axes or cursor, raw vector names, no legend.
- **Errors:** raw ngspice text in pop-ups that vanish after 10 s; nothing marked in the editor.
- **Engine:** ngspice 45.2 (its build script skips the 46 and 47 tags), "emsdk latest", one 19.4 MiB
  JavaScript file (wasm inlined twice as base64, plus chip-process model cards: 5.4 MiB gzip).
  It can hang on a fatal netlist error, and can return a previous run's numbers or shifted
  numbers after some inputs (reproduced in the fact-check).
- **Strengths we keep:** the engine in a Web Worker started early; "latest run wins"; native
  controls with good labels; focusable disabled tabs that say why; units next to value fields;
  role-based Playwright tests; careful autosave; strong touch/iPad support.

## What we do differently

| | EEcircuit | PlainSpice | Why it matters for a student |
|---|---|---|---|
| Starting point | schematic; the netlist is generated | **the netlist**; a schematic editor later, kept in sync both ways | students learn SPICE by reading and writing netlists (the channel teaches it) |
| Line by line | snippet templates (`R node1 node2 value`) | **every line explained as a field table in plain words**: name, + node, − node, value; for current sources from node, to node, current | knowing which node is + and which way a current source pushes is exactly where beginners slip |
| Beginner traps | none in its own code; it silently rewrites `M`→`Meg` in one input path but not the other; its DC-current placeholder suggests `1A` (= 1 attoamp) | **checked before running, each with a reason and a one-click fix; never silent rewriting**: 1M (milliohm), 3A (attoamps), no ground, dangling nodes, current sources with no path, duplicates, unknown letters, and more | ngspice gives confident numbers for several of these (checked: no ground gives 9.0003 V and 3.0003 V for nodes it cannot actually pin down) |
| `.op` and `.tf` | not shown (an `.op` result would be read as a one-point plot; `.tf` impedances arrive labelled as voltages) | **first-class**: node voltages and currents with their direction, on the netlist lines and in tables; `.tf` as "transfer function 1/3, output resistance 4 Ω" | the questions of a first circuits course are "what is the voltage here, which way does the current flow, what is the Thévenin resistance" |
| Units | prefixes without units; `M` means mega on screen and milli in the netlist | **plain units everywhere** (12 V, 4 mA, 3 kΩ), with ngspice's own printout alongside | 1.200000e+01 should read as 12 V |
| Errors | raw text, vanishes after 10 s | **plain words, attached to the line, stays until fixed**; numbers from a failed DC solution are never shown as answers | "singular matrix: check node b" means nothing to a first-year student |
| Keyboard and screen readers | the netlist editor traps the Tab key (reproduced); plots are canvas-only and need a mouse | **WCAG 2.2 AA from day one**: CodeMirror (Tab leaves the editor), Run before the editor, plots with a keyboard cursor and a data table, results announced, the circuit described in words; axe in CI | accessibility is a requirement, not a later feature |
| Colours and modes | hash-based random trace colours; four colour pairs below AA; no high-contrast, large-text or reduced-motion handling | **a fixed colour-blind-safe palette** with dashes, markers and labels; high-contrast, large-text and reduced-motion modes | colour must never be the only signal |
| Sharing | a JSON file | **the whole circuit in the URL** (no server); every Solved Circuits video can link "Open this circuit" | one click from a video to the exact circuit |
| Export | JSON, CSV, images; its netlists start with `.include modelcard.ptm`, which native ngspice cannot find | **plain netlists for ngspice and LTspice**, no hidden includes or home-made syntax | students take the circuit to the tools their course uses |
| Correctness | tests check that plots appear | **golden tests against native ngspice 47 and 42 to 6 significant figures**; today bit-identical; pinned engine, reproducible build | every answer on the channel is checked in a simulator; the simulator must be checked too |
| Size and offline | ~20 MB of engine JavaScript per worker; no offline mode | **0.6 MB engine (gzip)**, only the device models students need; offline PWA | phones on student data plans |
| Openness | needs a private, obfuscated schematic package to build | **everything in this repository**, with the engine's exact source served next to it | anyone can rebuild, fix or reuse it |
| Language | English strings written inline | strings in catalogs from day one; **Turkish UI** next | Tarık's audience includes Turkish students |

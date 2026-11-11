# 0014. The look: Notebook, with a named toolbar, Ctrl+K and a plain-font setting

- Status: accepted (Tarık, 11 November 2026)
- Prototypes compared: <https://plainspice.com/design/> (`design/prototypes/`), screenshots in
  [`../design/m2/`](../design/m2/)

## Context

Milestone 2 makes PlainSpice look and work like a real simulator. Three visual directions were
built as clickable prototypes running real ngspice, each designed, critiqued by a second designer
and refined: **Notebook** (the Solved Circuits paper look), **Studio** (a dark pro tool) and
**Playground** (a light, hand-drawn whiteboard).

## Decision

PlainSpice is built in the **Notebook** direction: cream grid paper with the red margin line, the
circuit in dark ink with each node's wires in its colour, results written beside the parts by hand
(currents in amber, power in green, traps in red pen), the old value crossed out when a value
changes, the netlist on the dark "simulator screen" of the episodes, panels as paper cards.

With these additions, in Tarık's words:

- **From Playground, the parts toolbar with names, not just letters** ("E, F, G and H mean nothing
  to a beginner"), and **its hint line under the drawing** (what you can do next, in plain words).
- **From Studio, Ctrl+K** (a command palette) **and the status line** (what ngspice is doing, and
  how the last run went).
- **A setting that switches the handwriting to a plain font**, for anyone who reads handwriting
  slowly (dyslexia, low vision, a long session).
- **Part positions in the netlist**, with the `*@` block folded away by default
  ([decision 0013](0013-schematic-model.md)).

Before the rest is built, Notebook is shown on one of p02's dependent-source circuits, on a computer
and a phone, for Tarık to check.

## Consequences

- The handwriting (Caveat) is only for results on the drawing; every control, label and panel uses
  a plain sans font, so handwriting always means "this is what ngspice found".
- The fonts ship with the site under the SIL Open Font License (Caveat, Inter, JetBrains Mono, and
  a subset of CMU Serif renamed "Notebook Serif" as its licence asks).
- Node colours stay the colour-blind-safe set of `src/theme/nodes.ts` (the channel's violet is left
  out as too close to blue for some readers), and a node is never shown by colour alone.
- The Studio and Playground prototypes stay on the site as a record; they are not maintained.

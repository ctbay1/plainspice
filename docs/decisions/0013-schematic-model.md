# 0013. The schematic model: the circuit drawn from its netlist, in step both ways

- Status: accepted. **Positions live in the netlist** (Tarık, 11 November 2026), with the `*@`
  block folded away by default in the netlist panel. Still open: whether format v1 says enough for
  the drawings in the videos (see the end)
- Date: 2026-11-10 (revised the same day after a review: limits, hidden connections, version
  blocks, word sides, reverse, partial drawings)
- Code: `src/schematic/`; for contributors: [`../schematic.md`](../schematic.md); layouts to judge:
  `design/lab/` and [`../design/lab/`](../design/lab/); evidence that ngspice ignores the drawing
  lines: [`../spice-facts/drawing.md`](../spice-facts/drawing.md) (drawing-1)

## Context

Milestone 2 makes PlainSpice look and work like a real simulator: the circuit drawn from the
netlist with results on it, a schematic editor whose netlist stays in step both ways, and share
links that open a circuit from a video drawn exactly as in the video. Three visual directions are
being prototyped (`design/prototypes/`) and Tarık will pick one. Every direction needs the same
thing underneath: where each symbol goes, which wires join what, where the words go, how an edit
changes the netlist, and how a keyboard or screen-reader user moves through the circuit.

## Decision

**One style-independent model, plain TypeScript** (like `src/spice/`, decision 0002): geometry,
connectivity and text, no React, no CSS, no colours. A visual style renders `Schematic.scene` and
calls `applyEdit`; it never computes geometry itself. Text widths come from the style when it gives
a `measure` function (its own font, measured on a canvas, say); otherwise from an estimate for an
ordinary sans-serif font.

**The netlist wins.** The netlist text is the one source of truth for the circuit. The drawing is
separate data (part positions, ground symbols, wires, node labels) that never changes the circuit:
`buildSchematic` repairs the drawing until it connects exactly what the netlist connects, and an
edit in the drawing is turned into text changes to the netlist (`TextChange`, the shape of the
checks' fixes), so undo and redo stay text undo and redo. Building never throws and never takes
long, whatever the drawing lines say: they come from share links, which anyone can write.

**Geometry.** An integer grid; every two-terminal symbol is 4 units from pin to pin, pin 0 being
the line's first node (V, E, H: the + side; I, F, G: current flows from pin 0 to pin 1, so the
arrow points from pin 0 to pin 1). Four rotations, clockwise as in SVG, and mirroring. E, F, G and
H are two-terminal diamonds as in textbooks and the channel's videos: their output is wired, their
control is written as a label ("2 × V(c)", "3 × I(Vs)"), never wired; the source an F or H reads
knows it (`sensedBy`), so a style can draw the direction of that current on it. A ground symbol has
one pin, is node 0, and a drawing may have several.

**What the drawing cannot show is never hidden.** Lines the drawing cannot show (X, B, K, D, Q, M,
switches, lines, parts inside `.subckt`, parts after `.end`, a second part with the same name) are
listed with their line and reason. A node that such a line also names is not drawn as an open end:
its end is a stub, its name carries "to D1, X1", the connectivity check reports it (`hidden`), and
its description says so. Inductors know the K lines that couple them.

**Automatic layout: a ladder.** Textbook circuits for first-year students are ladders, and so are
the channel's: ground along the bottom, the first independent source on the left (upright, + at the
top), parts in series along a top rail, parts from a node to ground standing upright below it
(side by side when in parallel, in netlist order), short chains to ground as one column (a 0 V
ammeter in series with one part to ground stands in that branch, as the channel draws it),
parts between non-neighbouring nodes on rails above (their parts kept clear of the wires rising to
higher rails), an open terminal ("a") ending the top rail on the right, and circuits that only meet
at ground standing side by side on one rail. The layout tries every path of series parts from the
first source as the top rail and keeps the one that leaves the fewest parts outside the pattern,
the lowest drawing and an open terminal at the right end; spacing then grows until nothing
overlaps. Anything outside the pattern is placed next to its nodes and wired by an A* router
(orthogonal, fewest bends and crossings, never touching another node's copper, a pin left along its
lead unless that is blocked). Every choice follows netlist order: the same netlist always gives the
same drawing. All 20 examples, all 10 fixtures and the 114 corpus netlists lay out with no overlap
and exact connectivity, checked by the model and by an independent check in the tests; random
circuits never put a wire through a symbol.

**Partial drawings.** A drawing that gives only some positions keeps them. When it gives only
positions and the automatic layout agrees with all of them up to a shift, the whole layout is used,
shifted onto them (a hand-written line for one source gives the textbook drawing). Otherwise one or
two missing parts are placed next to their nodes, and more are laid out together beside the given
parts, their top rail starting level with the node they share, and wired to them.

**The drawing format.** Positions are comment lines in the netlist, which ngspice ignores
(drawing-1: the same printout and the same results file byte for byte in native ngspice 47 and 42
and in our engine; other simulators were not checked):

```
* plainspice-drawing v1
*@ V1 0 3 0 m
*@ R1 4 0 270 side=below
*@ ground 0 6 0
*@ wire 0,1 0,0 2,0
*@ label in 0 0 side=above-right
```

Parts are named, so editing a value or a node name in the text keeps the drawing; a renamed part
keeps its position when the match is unambiguous and the place is still free, and a node renamed
in the text keeps its label where it was. `side=` (optional) says where a part's words or a node's
name go; without it they go where they fit. Fields a version does not know (`key=value`) are read
past and reported, so a later v1 writer can add fields. Reading never fails: a line PlainSpice
cannot read, a coordinate beyond ±2000, or lines past the limits (2000 lines, 20 000 units of wire)
are kept as written and reported; positions of parts the netlist does not have (yet) are kept until
the next change made in the drawing. Lines below a header of another version belong to it: they
stay where they are, unused, and edits that change the drawing are refused with a reason (a newer
PlainSpice wrote them; editing here would leave them behind), while values, names and parts can
still be changed. The block is written just before `.end` (so no other line's number moves) and
replaced where it is.

**Editing.** Add a part or a ground symbol, move, turn, mirror, reverse, delete, draw and delete
wires, rename nodes, move labels and say where words go, set values and controls. A new part is
named like `R3`, starts with a small default value (`1k`, `1u`, `1m`, `5` …, never a trap such as
`1M`) and its line goes before the analysis lines (an empty text gets a title line first, since
SPICE skips line 1). A wire or ground symbol joining two nodes merges them (ground wins, then a name
a dot command or a `.control` line uses, then the first one) and the joined copper keeps one name;
removing one can split a node (the piece with its label keeps the name). Deleting a part leaves the
lines that still name it or its nodes as the student wrote them, and says which. Reversing swaps a
part's two node names and turns its symbol round, so its wires stay. A move or turn whose wires
would find no way, or a half turn that could only loop the wires round the part, is refused with a
reason. The student's lines, comments, spacing and order stay.

**Keyboard and screen readers.** A reading order (top to bottom, left to right), arrow-key moves
along the wires, and descriptions: a part's is exactly the sentence the circuit overview already
says (`src/spice/describe.ts`), so the drawing makes no claim about SPICE of its own; a node's says
which parts it connects, including those the drawing does not show.

## Open questions for Tarık

**Where do the positions live? Decided on 11 November 2026: in the netlist,** as recommended, with the
`*@` block folded away by default in the netlist panel. What was weighed: the code supports both answers: `buildSchematic(text, { lines })`
reads positions kept elsewhere, `applyEdit(…, { drawingInText: false })` changes only part lines
and returns the drawing lines to keep, and `stripDrawing` removes the block.

- **In the netlist (built, recommended).** One text holds everything: share links need no new
  format (they already carry the netlist), a copied or exported netlist keeps its drawing (ngspice
  ignores it, drawing-1; other simulators were not checked), and undo and redo stay plain text.
  The cost: the student sees a block of `*@` lines at the end of the netlist, which the editor can
  fold away.
- **Only in the share link.** The netlist stays exactly what the student typed, but the link needs
  a new parameter with its own promise to open forever (decision 0008), positions are lost when the
  netlist is copied or exported, and the app must store and undo the drawing beside the text.

**Does v1 say enough before links are public?** Links must open forever (decision 0008), so v1
should be able to reproduce the drawings in the videos. It stores part positions, turns and
mirroring, where a part's words go (`side=`), wires, ground symbols, and where each node name goes
(its point and `side=`). It cannot store a word placed anywhere else (a value written far from its
part, say), a part's words in another order, or text that is not a name, a value or a node name.
Before links with drawings are public, 3–4 frames from the channel's videos should be drawn in v1
and compared; anything they need that v1 cannot say becomes a new field (read past by v1).

## Alternatives considered

- **A general graph-layout library** (ELK, dagre): large, layered layouts that ignore circuit
  conventions (where ground and sources go), and a dependency to ship for small circuits.
- **Force-directed layout**: does not give the straight rails and columns of a textbook drawing,
  and small changes move everything.
- **No automatic layout** (draw by hand only): every example and every netlist typed as text would
  open with nothing to see.
- **A separate JSON drawing file**: a second file to keep in step, invisible in share links.
- **Writing a v1 block beside another version's block**: edits would work, but the two drawings
  would disagree and a newer PlainSpice would not know which to trust; refusing drawing edits until
  the page is reloaded (which gets the newest PlainSpice) keeps one drawing.
- **Turning a part round in place by looping its wires round it**: correct, but no textbook draws
  it; Reverse does what a student turning a source round usually wants.

## Consequences

- The visual styles render the scene: symbols (standard US/ANSI shapes are provided, a style may
  draw its own on the same pins and boxes), words at the given anchors, junction dots, terminals,
  stubs, crossings (for hops), and the room kept for results (a node voltage under each node name,
  a current line under each part's value). A style with its own font passes `measure`.
- Large netlists still lay out (a 300-part ladder in about 0.35 s, a dense 150-part mesh in about
  0.8 s), but the drawing is meant for small circuits; the app may skip it above some size. Small
  circuits rebuild in a few milliseconds, fast enough to redraw on every keystroke.
- A drawing line can make the drawing ignore it, but never make building slow or fail: the
  coordinates, the number of lines, the wire length and every route's search area are bounded, and
  a last-resort fallback lays the circuit out again.

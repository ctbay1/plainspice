# 0018. The examples drawn as in the videos: recorded from the channel's drawing code, converted to the grid, checked

- Status: accepted (milestone 2, step C; the brief's item 2: "a share link can carry exact positions,
  so a video's circuit opens drawn exactly as in the video"; the phone's "As in the video" is decision
  [0015](0015-notebook-canvas.md), Tarık's)
- Date: 2026-11-11
- Code: `scripts/video-drawings/` (`record.py`, `recorded.json`, `plan.ts`, `convert.ts`,
  `pictures.ts`, and its [README](../../scripts/video-drawings/README.md)); the 20 examples' drawing
  blocks (`examples/*/*.cir`); `drawnAsInVideo` (`src/app/examples.ts`); `nameShift`
  (`src/notebook/results.ts`) and `turnedQuarter` (`src/notebook/turn.ts`); tests in
  `tests/unit/video-drawings.test.ts`, `tests/unit/notebook-names.test.tsx` and
  `tests/e2e/phone.spec.ts`; pictures and the per-example report in
  [`../design/video/`](../design/video/README.md)

## Context

Until now every example was laid out by PlainSpice (decision 0013's automatic layout): clean, but not
the drawing the student just watched. A student who opens "Open this circuit" under a video should
find the circuit drawn as the video draws it, with the node names the video writes, so the numbers
PlainSpice writes on it can be compared with the video's at a glance. The drawing format (decision
0013) already carries positions in the netlist's `*@` lines, which ngspice ignores (fact drawing-1),
so a share link or an exported file keeps them. What was missing: the positions themselves, made
the same way for all 20 examples and again whenever a video's drawing changes.

## Decision

- **Recorded from the videos' own drawing code, never by hand.** The channel's repository draws every
  circuit with Python (Manim) code: `episodes/*/circuits.py` and `scenes.py`. `record.py` reads those
  files (the repository is only read) and writes `recorded.json`: each drawing's parts, wires, open
  ends and the node names the video writes, in the video's own units, with the file and line each
  comes from and a SHA-256 of every file read. It never imports or runs the episode files: it parses
  them with Python's `ast` and runs, with a small interpreter of its own, only the statements that
  draw (a circuit function's body, the module constants and helpers it uses, and the slice of a
  scene that builds a named object such as a test source or a 0 V ammeter). Anything else (an
  import, `open`, `eval`, a dunder, a `while` ...) stops the recording with the file and line, and
  its self-test, run by the unit tests, checks that. `recorded.json` is committed, so CI checks the
  examples without the channel's repository.
- **One plan per example, every change with its reason.** `plan.ts` says which of the video's
  drawings each example is (the version the netlist is: the SPICE check with its 0 V ammeter or its
  short when the video has one, else the hand-solved drawing) and every change the netlist needs:
  a part the video names otherwise (`Is` is `I1`), a part the netlist does not have (sp01-6 has no
  I1), a 0 V source the video draws as a wire (Vshort stands in the wire from a to b), copies side
  by side (sp01-3's four output circuits). Each change carries a sentence, and the report prints it.
- **Converted to the grid, at a scale chosen for the student.** The format is on a grid (decision
  0013), so `convert.ts` maps the video's units to grid points times a scale k, snaps the parts and
  wires, writes each node name where the video writes it when it fits there, and always beside its
  own wire, never nearer another node's. k is grid squares per video unit (2.5 to 6.15 here). Of the
  scales at which the drawing is clean (no overlap, the netlist's connections exactly, every part
  where the block puts it), from the smallest clean k up to 0.4 more, it takes the one that opens
  whole on a phone held upright, then the one that keeps the most names on the side the video writes
  them, then the smallest; then up to 0.1 more if that keeps more of the video's equal spans equal.
  Examples that show one drawing of a video (p02-4 and p02-5, the three of e04's example 3, ...)
  share one scale, so every part they share is in the same place.
- **The values never change.** The block goes just before `.end`; the netlist's other lines are the
  channel's, untouched, so the golden tests against the channel's native ngspice runs still hold.
- **"As in the video" on a phone (decision 0015).** When the netlist's `*@` lines are exactly a video
  example's, a phone that turned the drawing to fit offers "As in the video" (the button, the hint
  line, Ctrl+K) where any other drawing gets "As drawn". A value changed on the drawing keeps it the
  video's drawing; a part moved, turned, added or deleted, or a node renamed, makes it the student's,
  and the words go back to "As drawn" (`drawnAsInVideo`).
- **Two drawing fixes the examples showed.** (1) A node name written on the left of its point with
  its value on the same line ("s = 40 V") is drawn up to its point: the room kept for any value
  stays where it was (so nothing new can overlap), but the words no longer start at its far end,
  2 to 5 grid squares from the point (`nameShift`; the focus ring, the highlighter and the card's
  clear space follow it). (2) A phone's turned view places the names again when one kept at its
  point has no room once turned; the names at open ends stay (`turnedQuarter`). With both, 12 of the
  20 examples open whole on a phone held upright (a Pixel 7), up from 8.

## Considered

- **Drawing each example by hand in the editor.** Twenty drawings to keep in step with the videos by
  eye, with nothing to say where a part came from or why it moved. The recording can be made again
  in a minute when a video's drawing changes, and `git diff` of `recorded.json` shows what moved.
- **Importing the episode files and asking Manim for the positions.** That runs another repository's
  code here, and needs Manim and LaTeX in CI. The interpreter runs only the drawing statements and
  refuses the rest, which is also why it is safe to run on the channel's files as they change.
- **A scale per example, each as small as it can be.** Two examples of one drawing would then open at
  different sizes with their parts in different places, which reads as two different circuits.
- **Writing the terminal "b" and the "0" some videos write beside the ground wire.** The format names
  ground only by its symbol, and a label must name its own node; a format addition (a label that
  writes another name, `name=b`) would be published in every share link made from then on, so it
  waits for Tarık (docs/plan.md, open questions). Until then the ground wire is b, as in the
  netlist, and the report lists each such gap.

## Consequences

- The examples open drawn as in their videos on a computer and on a phone, and a link made from one
  carries its drawing: about 200 characters longer (`scripts/make-link.ts` on e04's six examples:
  3,188 characters in all, 1,798 without the drawings, of a YouTube description's 5,000). Links made
  before carry no drawing and open laid out automatically, as they always did.
- On a Pixel 7 held upright: 12 examples open whole (sp01-1, -4, -5, -6, p01-1, -2, p02-1, -2, -3,
  e04-1, -2, -3); 4 open turned but need dragging (sp01-3, p02-4, p02-5, e04-5); 4 are shown as drawn
  and need dragging (sp01-2, p01-3, e04-4, e04-6). p02-4, the circuit of Tarık's checkpoint, is among
  the ones that need dragging: the video's drawing is less long and low than the automatic layout's.
- The checkpoint page (`design/checkpoint/`) keeps the automatic layout Tarık approved; unit tests that
  are about the automatic layout read the examples without their blocks (`stripDrawing`).
- A block is never edited by hand: change `plan.ts` (or record again) and run `convert.ts --write`;
  `video-drawings.test.ts` fails when a block is not what the converter makes.
- Some of the videos' name spots have no match in the format (centred above a point): those names go
  above and to one side, and the report says so for each.

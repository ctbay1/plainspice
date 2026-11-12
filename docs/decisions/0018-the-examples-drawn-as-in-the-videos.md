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

## After the final reviews (12 November 2026)

The final reviews of milestone 2 (the phone review, with one finding each from the accessibility and
the first-year student's reviews) found the phone's view of the drawing hard to use in several places,
most of them on the examples this record made: they open turned but need a drag, or as drawn. What
changed, each with a test that fails without it (`tests/e2e/phone.spec.ts`,
`tests/unit/notebook-canvas.test.tsx`, `notebook-fit.test.ts`, `app-words.test.ts`). The phone's
view is decision [0015](0015-notebook-canvas.md)'s and the editor's pointer decision
[0017](0017-the-schematic-editor.md)'s; the changes are recorded here, with the examples that showed them.

- **A finger moves the paper from anywhere.** In the turned view (another drawing, which the editor
  does not change) a press on a part, a node's name or the ground was only that item's tap: a finger
  that moved from there did nothing, and a second finger did not pinch, so the drag the hint asks for
  failed on p02-4, the checkpoint circuit. Now such a press is the item's tap while it holds still,
  and as soon as it moves (8 px for a finger, 4 px for a mouse or a pen) it pans the paper, as from
  empty paper, and the item gets no click; with a second finger it is a pinch (0017: a finger pans
  unless it holds still). The turned view also gets "more" at an edge where the drawing is cut off,
  as the view as drawn has.
- **A sheet leaves the drawing where it found it.** When a sheet or a panel opens over the selected
  item, the drawing is still moved just enough to keep that item in view (WCAG 2.4.11). When the sheet
  goes (its ×, or a tool chosen in it) the drawing goes back to where it was, unless the reader moved
  it in the meantime, and at once rather than sliding, so a tap made just after (a pin, once Wire is
  chosen) lands on what is under it. It used to stay moved, with the top of the circuit under the top
  bar, where a tap opened the Examples menu instead.
- **The drawing never leaves the screen.** A drag, a scroll or a zoom stops where a third of the free
  paper (at least 48 px) still shows the drawing, or all of it when it is smaller than that
  (`keepInView`). Considered: 48 px only, as the skeptic proposed; that leaves a sliver at the edge of
  the screen, while a third keeps the circuit recognisable and still lets a student push it aside to
  place a part on free paper. A part the page brings into view (one moved with the keys, in hand away
  from the drawing) is shown wherever it is. On a phone, once the drawing has been moved partly out of
  view (not by a sheet, which covers it only for a while), the status line offers "Show the whole
  drawing" (Fit, below), which is otherwise at the end of the More sheet.
- **"Whole" means what is drawn.** The canvas says the drawing is whole when everything drawn (the
  symbols, the wires, the words and numbers as written, not the room kept around them for longer
  numbers) is in the free paper, wherever the fit or the reader put it. The hint says "drag the paper
  to see the rest" only when something drawn is cut off: at 360 px, four turned examples shown whole
  (sp01-4, sp01-5, p01-2, p02-3) told the student to drag; now they say "Turned to fit the screen".
- **Fit shows the whole drawing, and is called so.** Fit fits all of the drawing, smaller than its
  words' readable size if it must be, down to 4 px a grid unit (as the phone's view while editing
  already did). Before, it stopped at the readable size, so it changed nothing for a drawing too
  long for the screen. Its one name is now what it does, "Show the whole drawing", wherever it is
  offered (the More sheet, Ctrl+K, Shift+1 in Help, the computer's zoom bar, and the phone's status
  line); it was "Fit the drawing to the window" everywhere but on the status line, two names for one
  action. "Fit" is left to the turn ("Turn to fit", "Turned to fit the screen"), and Ctrl+K still
  finds the command by "fit". The whole fit stays until something else fits the drawing again
  (another circuit, a part typed in the Netlist panel), and a phone's card still fits its own part.
  Zoom out (its buttons and keys) now goes as far as two fingers do, to half the readable size, and
  never jumps in from a view that is already smaller.
- **As drawn, at the smallest readable size.** A drawing shown as drawn on a phone that needs panning
  ("As in the video", or a drawing that cannot be turned cleanly) opens at the smallest size its
  words can be read (names 10.5 px), from its left end, instead of as tall as the screen allows up to
  30 px a grid unit: most of the circuit shows at once. A ladder built with the mouse and shared to a
  Pixel 7 showed V1 and half of R1; it now shows all five parts, F1's words cut at the edge, and Fit
  shows all of it. This changes how "As in the video" looked at Tarık's checkpoint (decision 0015: 30
  px a unit); the canvas keeps its `fill: 'height'`, so `App.tsx` can take it back in a few lines.
- **Old numbers only when there are some.** A paused status adds "The numbers are from before your last
  change." only when the drawing shows some of the last run's numbers, in pencil: that run gave answers,
  and the drawing writes them where a part or a node still has its name. After a run that gave none (a
  check found an error), or with the netlist replaced in the Netlist panel by a circuit whose parts and
  nodes have other names, the paper shows none, and the sentence was untrue there.
- **A keyboard on a touch screen.** The editing strip (the value field held above the on-screen
  keyboard) is for a field tapped on a touch screen, or for any field while an on-screen keyboard is
  up. A value field reached with the keys (a tablet with a keyboard, switch access) keeps the card's
  sheet, so Tab goes on to Explain, Turn, Mirror, Reverse, Move, Connections and Delete (WCAG 2.4.3);
  the strip took them all out of the page. Not by the keyboard's inset alone, as the reviewer first
  proposed: with `interactive-widget=resizes-content` Chrome for Android may report none, and a tapped
  field must still get the strip there.
- **A very short window.** Below 300 px of height (a laptop at 300 % or 400 %), a calm status
  ("Finished in 32 ms") folds to its dot, in the paper's margin left of the red line where the drawing
  never goes, its words still read by screen readers; with buttons on it (Undo, Show the whole
  drawing) it keeps them. Running, paused or an error keep their words, their reason and their buttons.
  The status line keeps its height, so the drawing does not move as runs come and go.
- **Two buttons on one row.** On a phone, when "Show the whole drawing" shares the status line with
  another button (the turn, Undo), a calm status keeps its words for screen readers only and leaves
  out its dot, so the line is just the buttons, on one row: at 360 px the two buttons take 175 and
  115 px of the 328 px there are, and with the words beside them the line grew from one row to two
  (36 to 74 px tall) over the drawing as soon as the reader moved it. The words come back with the
  whole drawing. A status to read (running, paused, an error) keeps its words.

Still open: when a circuit opens, and after each pan or zoom, the drawing slides to its new place over
a third of a second (`.nb-world`'s transition), and a tap during a slide is read against where the
drawing is going, not where it is (seen in the tests, which wait for the drawing to settle; a sheet
going away no longer slides). The ladder above still opens as drawn: its turn is the schematic's to fix.

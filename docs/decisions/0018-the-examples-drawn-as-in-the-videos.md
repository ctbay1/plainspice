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
  The hint names the view by its fit (`CanvasViewInfo.fits`): a drawing whose fit shows all of it,
  moved partly off the screen by the reader, keeps its words ("Turned to fit the screen · tap a part
  to change it", "Tap a part to see its numbers and change it"), and the status line offers "Show the
  whole drawing"; "as well as it can · drag the paper to see the rest" is said only when the fit itself
  cuts something off (the critic of these fixes found the turned hint claiming the turn could not fit
  Mistake 2 after a swipe). Considered: a hint of its own for a drawing moved off ("… · Show the
  whole drawing brings all of it back"), as the critic suggested; not taken, because the button with
  those words is right under the hint, and the hint would change as the reader pans.
- **Fit shows the whole drawing, and is called so.** Fit fits all of the drawing, smaller than its
  words' readable size if it must be, down to 4 px a grid unit (as the phone's view while editing
  already did). Before, it stopped at the readable size, so it changed nothing for a drawing too
  long for the screen. Its one name is now what it does, "Show the whole drawing", wherever it is
  offered (the More sheet, Ctrl+K, Shift+1 in Help, the computer's zoom bar, and the phone's status
  line); it was "Fit the drawing to the window" everywhere but on the status line, two names for one
  action. "Fit" is left to the turn ("Turn to fit", "Turned to fit the screen"), and Ctrl+K still
  finds the command by "fit". The whole fit stays until something else fits the drawing again
  (another circuit, a part typed in the Netlist panel) or the reader changes the view: "Turn to
  fit", "As drawn" and "As in the video" give the other view at its own fit (they went on fitting
  whole, below the readable size, until another circuit was opened). It belongs to the view it was
  asked in, turned or as drawn: the whole drawing asked for while editing (a tool shows a turned
  drawing as drawn) is not the turned view's, so Select turns the drawing back at the turned view's
  own fit, the smallest readable size for p02-4, where it came back at 12.3 px a grid unit (words
  of 8.4 px) and said it was "turned to fit the screen"; one asked for in the turned view comes back
  with it after a tool, as the student left it. A phone turned on its side shows the drawing as
  drawn, at that view's own fit unless the whole drawing was asked for as drawn (p02-4 asked for
  whole turned now shows at the readable size on its side, where it showed whole at 14.2 px a grid
  unit), and upright again the turned view comes back as it was left.
  On a phone it waits while a sheet or a card is open: in the strip of paper left above a sheet the
  whole drawing was a stamp (p02-4 at 4.3 px a grid unit). So the More sheet's "Show the whole
  drawing" closes the sheet, as Export does, and the whole drawing shows at once, the focus back on
  More; it kept the sheet open, as Zoom in and Zoom out do, and then changed nothing on the screen
  until the sheet was closed, with the hint above still saying to drag (the critic of these fixes).
  Zoom in and Zoom out keep the sheet open, their change seen above it; a card still fits its own
  part. Zoom out (its buttons and keys) now goes as far as two fingers do, to half the readable
  size, and never jumps in from a view that is already smaller.
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
  nodes have other names, the paper shows none, and the sentence was untrue there. The same holds for
  the numbers kept in pencil while a circuit is built on the drawing: "The numbers in pencil are from
  before your last changes." (on the status line and the phone's card) and the pencil itself, with
  "Before your last changes:" for screen readers, only while the drawing still shows some. With every
  part deleted, the status line spoke of numbers in pencil over an empty paper.
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
  whole drawing. "Running…" does the same (the numbers in pencil show the run): each edit on the
  drawing starts a run, and with its words and dot back for it the line grew to two rows and folded
  again a fifth of a second later, the hint and the "more" at the edge jumping with it, and Undo
  sliding to where "Show the whole drawing" had been, under a finger about to tap it (the critic of
  these fixes, at 360 px; on a Pixel 7 the buttons slid sideways). A status to read (paused, an
  error, a run with a reason beside it, such as the numbers kept in pencil) keeps its words. Where
  even the buttons alone are too wide (a 320 px phone, large text, or Undo as a third), they take
  two rows, each centred.
- **Every bar and sheet on the screen, at every text size.** On an iPhone SE (320 × 568) with the
  Settings' largest text (150 %), a resistor in hand put the hand bar under the top bar: Place could not
  be tapped (a critic of these fixes). The stack along the bottom (the hint and status lines, a sheet, the
  bar) had no greatest height, and the hand bar sat on top of it. Checked on four phones (320 × 568,
  360 × 640, 375 × 667, the Pixel 7), upright and on their side, at the three text sizes, through the
  first screen, a blank page, the Parts sheet, a part in hand, its card's sheet, the strip, the part
  placed, the drawing moved, the More sheet and a turned example: before, every one of the 24 had
  something off the screen or under the top bar (212 places, some at the usual text size: the Parts
  sheet pushed the hint under the top bar on a 375 × 667 phone); now none. What changed:
  the stack never covers more than leaves the free paper a share of the window below the top bar
  (15 %, at least 48 px), and room for the hand bar above it while one is shown. The bar and the hand
  bar keep their size; the lines give way before a sheet (the sheet is what the student is using), and
  within them the hint gives way first: its box keeps its first line and scrolls, the status and its
  buttons stay whole below it; should even the status not fit, the lines scroll as a whole. What scrolls
  is then a named region a finger and the keys can scroll (WCAG 2.1.1), as a table too wide for the
  screen is. Above a sheet the lines give way in two steps (the next point), never as a sliver of half
  a line over the sheet. A window wider than tall is short for its text, as the phone's layout itself
  is chosen: below 420 px of height at the usual text size, 630 px at 150 % (a phone on its side, a
  laptop window with large text); there the hint is out of sight (screen readers keep it) and the bars
  get compact (their buttons 44 px, the smallest target the phone's main buttons have, larger only for
  large text's icons; less padding; a sheet's head without its grab), and below 300 px at the usual
  size (450 px at 150 %) a calm status folds to its dot. An upright phone is short only below 420 px,
  whatever its text size (the next point). The
  card for a blank page scrolls inside the free paper, and the "more" at a cut edge stays below the
  top bar. Considered: the hand bar inside the stack, which would count in the drawing's free paper
  and move the drawing as a part is taken in hand; the status's reason or the hint cut to a line or two,
  which loses words (WCAG 1.4.4 and 1.4.10 allow scrolling, not cutting); the lines out of sight whenever
  a sheet is open, which changes the usual layout, where there is room for both. Test:
  `tests/e2e/phone.spec.ts`, "a small phone with the largest text keeps the hand bar, the sheets, the
  strip and the status line usable, and some paper" (on fix-base it stops at Place, at 48 to 102 px with
  the top bar ending at 85).
- **The status line stays above a sheet while the sheet keeps its rows, and what is out of sight takes
  no Tab stop.** The critic of these fixes found two things wrong in them. In a short window any sheet
  put the hint and status lines out of sight (for screen readers only), the status line's buttons still
  Tab stops: a keyboard user reached an Undo nobody could see, and Enter undid a change with nothing on
  the screen to say so (WCAG 2.4.7); and a phone on its side at the usual text size, or a laptop at 200
  %, lost the run's status and Undo while a panel was open, which it had shown before. And an iPhone SE
  upright at 150 % counted as short, so its hint line, what a beginner reads first, was never on the
  screen. Now the lines above a sheet (Parts, More, a panel) give way in two steps, each kept until the
  sheet closes or the room around it changes (the window, the text size, the bar, the sheet's head;
  measured again in the same room, the lines would come back and go again): first the hint steps out of
  sight (whatever the sheet is about, the hint is about the drawing), and the status line stays whole
  above the sheet, which gives way below it and scrolls, down to its head and about two of its rows (6
  rem below its head: `SHEET_ROWS_KEPT_REM`); only when even the status line would leave the sheet less
  do the lines step out of sight, their words still there for screen readers and none of their buttons
  with them (More keeps Undo). Only a window wider than tall is short for its text, so an upright phone
  keeps its hint line at every text size, in its box that keeps the first line and scrolls. Checked as
  before (four phones, upright and on their side, three text sizes, the same sixteen screens): no
  control out of reach, at least 48 px of paper, the hint line on an iPhone SE's screen at 150 % as at
  the usual size (the first screen, a blank page, a part in hand, a change made); the status line above
  the More, Numbers and Checks sheets on every phone held upright but the iPhone SE at 150 %, and on
  every phone on its side at the usual text size but the iPhone SE (320 px of height); and above the
  Parts sheet over a blank page, whose status line explains why there is nothing to run, on the larger
  phones upright. Where it is out of sight the Tab order reaches nothing that cannot be seen (also at
  1280 × 600 and 1366 × 768 with the largest text, and at 640 × 400, a laptop at 200 %). A box in the
  lines scrolls only while it is squeezed (scrolling always, it cut the focus ring of the first screen's
  "Change R1" at the usual text size), and fades at the end where it hides words, as the computer's
  divider tabs do: a box cut exactly between two lines gave no sign that it scrolled. The stack and its
  lines take a new size at once, also where motion is reduced (where every property otherwise keeps its
  old value for a frame, and the lines measured that frame as no room). Considered: the lines kept with
  their buttons made inert, or taken out of the accessibility tree altogether, as the critic suggested
  first; their words stay for screen readers (how the run went is what one asks for), without the
  buttons. Tests (`tests/e2e/phone.spec.ts`): "a sheet on a phone on its side keeps the status line and
  its Undo above it…" (863 × 360; on the previous fix the status line is out of sight), "a sheet that
  leaves the status line no room puts it out of sight…" (568 × 320 at 150 %; on the previous fix the Tab
  order reaches Undo at x = −43), and the 320 × 568 test checks the hint line on the first screen, on a
  blank page, with a part in hand and once it is placed (on the previous fix the first screen's hint is
  out of sight).

Still open: when a circuit opens, and after each pan or zoom, the drawing slides to its new place over
a third of a second (`.nb-world`'s transition), and a tap during a slide is read against where the
drawing is going, not where it is (seen in the tests, which wait for the drawing to settle; a sheet
going away no longer slides). The ladder above still opens as drawn: its turn is the schematic's to fix.

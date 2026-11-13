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
  ("Finished in 32 ms") folds to its dot, in the paper's margin left of the red line, where the fit of
  the whole drawing puts none of it (a view that follows a part reached with the keys, or one the
  reader moved, may: a word cut off at the screen's edge can then lie under the 9 px dot, as "1.8 A" of
  Example 2 does at 427 × 267 with n1 reached), its words still read by screen readers; with buttons on
  it (Undo; Show the whole drawing until the second re-check, below) it keeps them. Running, paused or
  an error keep their words, their reason and their buttons. The status line keeps its height, so the
  drawing does not move as runs come and go.
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
- **A new status is measured again, and a short sheet keeps only what it has.** The second critic of
  these fixes found the steps above a sheet kept too long in two places. A step was kept for the sheet
  and the room, never for what the status line said: a change that brought an error put the lines out
  of sight above the sheet (its reason is long), and undoing it left the short status out of sight too
  until the sheet closed, in the same room as before. A step is now also kept for the status line's
  tone, its words (not the run's time, which changes with every run), its reason and its buttons (Undo,
  the turn): a new status is measured again from the first step, before the page is drawn, so nothing
  flickers. (Not so, the second re-check found: each run's "Running…" counted as a new status, so while an
  error stood the status line came back above the sheet for each edit's run and went again, the sheet
  moving with it; a run now keeps the step of the status before it, below.) And a sheet kept its head and
  6 rem below it whatever it had: on an iPhone SE on its side at the usual text size, Plot before a sweep
  (one line of words, 36 px below its head) put the status line out of sight with 126 px of paper free. A
  sheet now keeps the less of 6 rem and all it has below its head: there the status line stays above Plot,
  with 84 px of paper left (in the audit, above Checks too, in 16 of the 24 phone views where it was 14).
  Tests (`tests/e2e/phone.spec.ts`): the 863 × 360 test deletes the ground with Parts open and undoes it,
  and expects the status line back (on the previous fix it stays out of sight); "an upright phone keeps
  the status line and its Undo above More and Parts, and a short sheet keeps them above it on its side"
  checks an iPhone SE upright at the usual text size, the first step, which no test checked on an upright
  phone (with a sheet that puts the lines straight out of sight it fails above More), and on its side with
  Plot (out of sight on the previous fix).
- **A squeezed hint box keeps a line and a half.** Cut to its first line (an iPhone SE at 150 % with a
  part in hand: "Tap the paper where a"), the box's fade fell on the bottoms of its letters, and nothing
  showed that more words followed. A box that hides words now keeps its first line whole and the top of
  the next, which fades (`.hint-scroll[data-more]`: the mark is set as the box is measured, before the
  page is drawn, so the box never shows one line first). It takes 17 px more of the stack there; the
  status line below it scrolls in the lines' box as before (the audit flags the same four places: a part
  in hand on a blank page, on the iPhone SE at 150 %). The fade test runs at 320 × 568 too, and checks
  that at least half of the second line shows (0.1 of it on the previous fix).
- **The drawing's part that the keys reach is never under a sheet.** With a sheet open, the Tab key
  reached the drawing's part (its one Tab stop) under the sheet, and nothing on the screen showed where
  the focus was (WCAG 2.4.11): a sheet moves a selected part clear of it only when the part fits in the
  paper left above the sheet, which on a phone it rarely does. Now a part, a node's name or the ground
  that gets the focus from the keys while less than half of it shows (or, larger than the paper left,
  while it fills less than half of that) is brought into the free paper: all of it when it fits, else
  its middle, with its focus ring; the drawing slides there and stays, as for a part revealed. Not done:
  a sheet that opens over a selected part larger than the paper above it still leaves it where it is
  until the keys reach it, so the drawing does not move every time a sheet opens over it. Tests: every
  Tab walk in `tests/e2e/phone.spec.ts` (on its side, upright, and at 150 %) now also checks that no Tab
  stop is under something else: some of what shows of it, inside the window and whatever scrolls around
  it, is the stop itself. On the previous fix each walk finds R2 under the sheet.

- **In a very short window "Show the whole drawing" is under More, and a part the keys reach moves no
  view of the reader's.** The second re-check (AP-1) found the pill back over the strip of drawing at
  400 % (320 × 200: at the first key a 210 × 36 px pill over V1, 6 V and 2 mA, there to stay; at 320 ×
  256 at End). A part reached with the keys and brought into view (the point before) took the view over
  as the reader's, so the status line offered "Show the whole drawing", and a calm status with a button
  keeps it (the point "A very short window" above). Two changes. A part the keys reach is brought into
  view by the fit itself where the fit, which follows the selection, shows it: the view stays the fit's,
  nobody's move; only where that fit cannot show it (a sheet leaving less paper than the part needs, a
  view held while a card is open or something is moved, or the reader's own view) is the view moved for
  it and becomes the reader's, as before. And in a very short window (`is-shorter`) the status line
  never offers "Show the whole drawing", whatever moved the drawing (a key, a drag, a scroll, a zoom: on
  30f3eec a drag already unfolded the pill): More keeps it, as do Ctrl+K and Shift+1. Undo after a change
  made on the drawing still unfolds the dot there, as before. "Show the whole drawing" pressed on the
  status line with the keys now gives the focus to the drawing's Tab stop: the button goes with the move
  it undoes, and the focus fell to the page (the next Tab went to Select). Considered: the status line's
  buttons as icons beside the dot in the margin (the reviewer's second way); the margin is 16 px wide, so
  24 px targets would spill over the drawing. Tests: "a very short window (a laptop at 400 %): walking
  the drawing with the keys or dragging it keeps a calm status a dot over none of the drawing, and a
  scroll or a zoom unfolds nothing…" (`tests/e2e/a11y.spec.ts`, on a computer, which is what a laptop at
  400 % is, and on a phone) walks Start here at 320 × 200 and 320 × 256 (Tab, Enter, End, Home,
  ArrowRight twice, ArrowDown) and wants at each stop no button on the status and no word of the drawing
  under its painted dot or pill; then, from the first screen, a 34 px drag of the paper (the mouse from
  the margin, where the fit draws nothing, since a press near a part or a node's name is the editor's; a
  finger on a phone), a scroll and a zoom, each of which must move the drawing, and wants no button and
  only the dot painted (and, after the drag, no word under it; after a scroll or a zoom of the reader's
  own, the drawing may lie anywhere, under the 9 px dot too). On b060bc8 it fails at the skip link (the
  pill at 61..271, 105..141, "Show the whole drawing"); without the very short window's rule, at the drag
  (the same pill). In a very short window that rule alone keeps the dot, so the fit's change is guarded by
  `tests/unit/notebook-canvas.test.tsx`: a part the keys reach that the fit shows leaves the view not moved
  (moved on b060bc8 and without the change). "'Show the whole drawing' pressed on the status line with the
  keys gives the focus to the drawing" (`tests/e2e/phone.spec.ts`; on b060bc8 the focus is on nothing).
  Pressed under More it gives the focus back to More's button, from Ctrl+K and with Shift+1 it leaves it
  where it was, as before (measured at 320 × 200, 320 × 256, 427 × 267 and 320 × 178).

- **An open sheet keeps its rows where they are: a run, a new status or an undo moves none of them.**
  The second re-check (AP-2) found a sheet and its rows moving under the student's finger, on 8 of 12
  phone views and at 640 × 400 and 1280 × 800 with 150 % text (never on fix-base). While an error stood,
  each edit's "Running…" was a new status (its key held the run's tone), measured again from the first
  step: it fitted, so the lines came back above the sheet for about 220 ms and went again with the
  error, the sheet's top dropping 34 to 118 px and coming back; where the lines stayed in sight, a
  "Running…" of another height moved the sheet too (the stack has a ceiling, and a sheet that scrolls
  takes whatever the lines leave); and a new settled status of another height moved it once (More's
  Undo on an iPhone SE from 463–509 to 404–450 when the error was undone). Double taps 150 ms apart
  pressed Undo then Redo, Redo then Share; six quick taps left the ground deleted. Now:
  - A run's own "Running…" (a change's or Run's; not ngspice loading) is no new status above a sheet: the
    step and the key of the status before it are kept through it, and the lines keep that status's height
    (a "Running…" shorter than an error's reason sits on the sheet's edge; one taller, with a button the
    change brought, takes the room it needs). The run's result is measured again only if it differs.
  - While a sheet is open its rows stay where they are on the screen, whatever the lines above it do (a
    new status, the hint's words, an undo). When the lines need more room the sheet gives it from its
    top, and its scroll moves on by as much: the rows stay, the head comes down over the top ones (never
    over the row a finger last pressed, nor over the row the keys are on: the points "The head never
    comes down over the row a finger last pressed" and "The row the keys are on stays whole" below). When
    the lines need less room, or step out of sight, the sheet takes back what it gave them while held,
    and no more than its scroll gives back; the paper takes the rest. Its own scroll never changes its
    height: held to grow as far as its scroll gave back at every change above it, a run after the student
    had scrolled More lifted its head and its × by the distance scrolled (40 px at 640 × 400 and on an
    iPhone SE, after the error was undone; found while this lane's first fix was measured), its rows
    staying. So the step
    logic is unchanged and a new settled status still comes back above the sheet when there is room (R2-2:
    the sheet gives it the room, its rows staying put).
    Only opening, closing or scrolling the sheet, rows that are all new, Checks' own rows changing (a
    check found or fixed), or a new window, text size or stack (the keyboard, a part in hand) lay it out
    afresh; its other rows coming or going keep the rows in view where they are (the point "A sheet's
    own rows" below; first fixed, every sheet whose own rows changed was laid out afresh, and the
    Numbers and Plot sheets moved their rows with every run). An opened sheet is held from the frame it
    is first drawn in, so the step the lines take as it opens is still its own to follow (held at once,
    the Parts sheet of an iPhone SE on its side at 150 % kept the room the lines had before they stepped
    aside, 55 px of paper where 48 is the least, and its tall last rows could not be scrolled clear of
    the bar: the phone audit and the 320 × 568 test check it); Checks, whose own rows change, is laid
    out afresh in that frame and held at once, so the error's row stays put while the lines step aside
    for the error (followed for two frames more, it moved up to 110 px with the largest text).
    Considered: the lines only (the skeptic's first fix, the busy tone out of the key and their height
    kept), which leaves the move a new settled status makes; a sheet that never gives room, its lines
    stepping aside instead, which hides the status line above a sheet opened while an error stood even
    once the error is undone; and letting the stack grow past its ceiling, which leaves under 48 px of
    paper on the small phones.
  - A part's card, a sheet on a phone, keeps the note it had settled on while a run is under way, and a
    run that takes a moment still says "Running…" (after 0.4 s, as before) in at least the room that note
    took. While an error stood, its note ("No numbers yet: a check found an error on line 2 …") went for
    each run of a value typed and came back with its answer, so the card's actions below it (Explain,
    Turn, Mirror, Reverse, Move, Connections, Delete) went up and down with each key: 47.2 px on an iPhone
    SE, 27.6 px on a Pixel 7 on its side and at 640 × 400, 102.2 px on a Galaxy S5 with the largest text
    (b060bc8 and the first fix of this round alike); now 0 px on those views. On a phone a value is typed
    on a card or in the Netlist sheet, which take the place of Checks and More: that is where "a value
    typed" was measured.
  - **A sheet's own rows.** The critic of these fixes found the Numbers and Plot sheets still moving
    their rows with every run, as on b060bc8: each run puts Numbers' "ngspice is running the netlist…"
    above its tables, and the Plot panel took its figures away ("Loading the plot…" in their place) and
    drew new ones; a sheet whose own rows changed was laid out afresh, and at the top of what scrolls
    the browser's own scroll anchoring does nothing. Rows went 20 px down and back with every Ctrl+Enter
    at 863 × 360, up to 175 px with the error's rows on a Pixel 7 at 150 %, and the plot's Zoom in 452 →
    670 → 475 on an iPhone SE. Now the rows in view at the top of an open sheet are noted (the boxes in
    view, then those inside the first of them, and so on), and when rows come or go above them its
    scroll follows, so they stay where they are: the run's note sits above them, out of sight, and goes
    with the run. When rows below them go (a part's row in Numbers' tables), room is kept below its
    rows (`--sheet-kept`), so neither the scroll nor the sheet's height moves them; it goes as rows come
    back, or as the student scrolls up (the point "Room kept below a sheet's rows" below). The browser's own anchoring is off in a phone's sheet
    (`overflow-anchor: none`): two would move the rows twice. Rows that are all new (the first numbers
    where "No numbers yet" stood, a plot where there was none or "Loading the plot…") lay the sheet out
    afresh, as nothing is left to keep, and Checks still lays itself out afresh in the frame its rows
    change, so a check found shows at once where it belongs, at the top (the critic's other way, once no
    run is under way, shows it 0.2 s later with the same move; kept by its scroll, the error's row would
    come in above the rows in view, out of sight). The Plot panel shows each new result in the figures
    it has drawn, with the plot module's `update`, which keeps the cursor and the zoom where they still
    fit; other plots are drawn before the old ones go, and "Loading the plot…" stands only where the
    first plot goes, which takes its place at once. The rows a sheet keeps below its head
    (`SHEET_ROWS_KEPT_REM`, or all it has) are held through a run, as its status is. Measured on every
    frame on the 14 views, each row of the panel (not the box around them all, which the note moves up
    with the scroll): Numbers through two Ctrl+Enter, and through the ground deleted, T, T, two undos
    and the error undone, and Plot (RC charging) through T, T, two undos and a redo, 0 px on all 14
    (b060bc8 and the previous fix: 20 to 197.8 px); More, 0 px, and Checks as on the previous fix (its
    rows move only at the error and at its undo). Explain and the "ngspice output" sheet, whose rows
    below the view moved with each T: their rows in view 0 px on an iPhone SE and at most 12.6 px on a
    Pixel 7 on its side (b060bc8: 23.1 and 58.2 px); the Netlist sheet's editor still scrolls to the
    line chosen, as on b060bc8 (T chooses R2's line).
  - **The head never comes down over the row a finger last pressed.** When the lines above a held sheet
    need more room the sheet gives it from its top: its rows stay, its head and × come down over the top
    rows. The critic of these fixes scrolled More's Undo to just under the head and tapped it twice, 300
    ms apart, the first clearing the error (863 × 360): the second pressed the head; Redo at the top of an
    iPhone SE's More, the first bringing the error back: the second pressed Close More (b060bc8 alike).
    Fixed first with a wait (the lines waited until 600 ms after the last press on the sheet), which its
    critic found only moved the wrong press later: a tap 0.65 to 0.95 s after the one before, as a student
    taps, looks at the drawing and taps again, met the head (a Pixel 7 on its side) or Close More (an
    iPhone SE, More closed). Now the head never comes down over the row a finger or the mouse last pressed
    while some of it is in view: lines that need more room wait at the height they had, squeezed and
    scrolling (out of sight if they were), and the sheet keeps its room and its head, however long, until
    the student presses anything else (another row, the paper, the bar, the lines), uses the keys or
    scrolls the sheet; then the lines take their room, the head comes down and the rows stay. A press the
    head would not reach (a row lower down) does not wait. The cost: until the student does something
    else, a status line that needs more room keeps the height it had (its first line and a fade, a region
    the keys and a finger can scroll) or stays out of sight, where otherwise a new settled status comes
    back above the sheet at once (R2-2); the drawing shows the change meanwhile, and the polite region
    says it. Not taken: a longer wait (1.5 s, the critic's other way), which moves the wrong press later
    again; and the paper's room first, down to its 48 px least, which the first critic proposed: above
    that least a phone keeps 28.6 px on an iPhone SE upright, 4 px at 640 × 400 and none on a phone on its
    side, where the head came down 34 to 41 px, and a taller stack would refit the drawing. Real taps (a
    40 ms touch, the critic's probe): Undo on a Pixel 7 on its side and Redo at the right end of an iPhone
    SE's row, the second tap 300, 650, 900, 1500 or 3000 ms after the first, pressed the row twice each
    time, More open (the 600 ms wait: Undo then the head, Redo then Close More, from 650 ms); the head
    stayed where it was until the paper was tapped, another row was pressed or the sheet scrolled, and the
    tapped row stayed where it was as the head came down (0.4 px); a key pressed brings it down too, the
    row the focus is then on kept whole (the next point). Taps 150 ms apart give two presses on eight
    views, as before.
  - **The row the keys are on stays whole.** With the keys there is no finger to wait for, and the head
    came down at once over the top rows: Shift+Tab back up More's rows puts the row at the top edge (the
    browser scrolls it to the nearest edge), and Enter on Undo cleared the error and brought the status
    line back above the sheet, the head over Undo and its focus ring: 0 of 69 px in sight on an iPhone SE
    (3rd generation) and a Galaxy S5 at 150 %, 7 of 46 on an iPhone SE with Redo, 21 of 58 at 640 × 400
    with 125 % (b060bc8 kept the row whole, moving the whole sheet down: WCAG 2.4.11 and 2.4.7). Now the
    row the keys are on (its focus ring showing) is never hidden more than it was when the head comes
    down: the rows go down with it as far as that needs (no finger aims at them, so a change made with
    the keys may move them), and the status line takes its room at once. Not taken: treating the focus
    as a finger and keeping the lines waiting, which keeps the new status squeezed for as long as the
    focus stays on the row. The critic's six cases now show all of the row (69 of 69, 46 of 46, 58 of 58
    px).
  - **A run keeps the step, whatever the sheet's head says meanwhile.** Checks' head says "before every
    run" until a check finds something, then "1 found", and the check is found while the run of the
    change is under way. The head is part of the room a step is kept for, and the step is not measured
    during a run, so the step was lost for the run: the lines came back above Checks for about 0.2 s (61
    px on an iPhone SE at 150 %, the sheet's top 161.9 → 223 → 161.9), and on a Galaxy S5 at 150 % the
    hint came back inside the held lines, squeezed, its fade making it a line and a half tall as it was
    measured, which the window reported as a "ResizeObserver loop completed with undelivered
    notifications" error (5 of 5 runs under load; b060bc8 none). The head's height is now kept through a
    run, as the status and the rows it keeps are; the error and the lost step are gone (Galaxy S5 at
    150 % with 4× and 6× slower CPU, and at full speed). The error was missed because the probes and the
    tests listened to the console and the page's own errors only, and Chrome reports this one as a window
    error: the AP-2 tests now listen to the window's errors.
  - **Room kept below a sheet's rows, measured as the browser measures it.** What a sheet's body holds
    was measured from its rows' own boxes and margins, which miss a margin that ends a row inside its box
    (Numbers' last table, 12 px, inside its panel's box): after each run with Numbers scrolled to its end
    12 px of empty paper was kept below its last row (an iPhone SE: what it scrolls 415 → 427), and it
    stayed until the student scrolled up. It is now what the body scrolls less the room kept (the room is
    the body's last box), and a run at Numbers' end keeps none (415 → 415). The kept room itself is
    needed: Example 1 (V1, R1, R2, I1) on an iPhone SE, Numbers scrolled to its end, I1 deleted with the
    keys: the Currents table loses I1's row below the rows in view, and without the room the scroll the
    browser cuts back took V1's, R1's and R2's rows 71.1 px down; with it they stay, and the room goes as
    I1's row comes back with the undo.
  Measured on every frame on the 12 phone views, 640 × 400 and 1280 × 800 at 150 % (56 runs, no console
  error, load 2 to 10; the window's own errors were not listened to: the point "A run keeps the step"
  above): each of More's rows and each box and list item of Checks through
  the ground deleted, T, T, Ctrl+Z, Ctrl+Z and the error undone, at most 0.6 px (More) and 0.8 px
  (Checks), where b060bc8 moved them up to 175.6 px (a Pixel 7 upright at 150 %), 59.5 px (an iPhone SE)
  and 55 px (640 × 400); the Netlist sheet's lines through a value typed while the error stood, 0 px (as
  on b060bc8: the lines are out of sight while the netlist is typed); the card's field and every button on
  it through "3", "k", "0" typed and "2k" put back, with and without the error, at most 0.4 px but for the
  card's own words answering the value: its two numbers wrap to a second line on a Pixel 7 upright at 150
  % once R2 is 3 Ω ("2 mA" crossed out beside "5.982 mA"; 114 → 138 px, so the actions below go 24.3 px
  down with the answer and back with the next one, as on b060bc8), and the line under the field changes
  for "3k0" (2.2 px with the largest text). Real taps on More's rows 150 ms apart (a 40 ms touch, 110 ms
  between) while an error stood: Undo twice, Redo twice, Redo twice on a Pixel 7 on its side, and six taps
  undoing all three changes with the ground back (b060bc8: Undo then Redo, Redo then Share, Redo then
  Undo, and the ground left deleted). Tests (`tests/e2e/phone.spec.ts`): "an open sheet keeps its rows
  where they are through each run, a new status and an undo" (863 × 360 and 640 × 400 with Checks, 320 ×
  568 with More and the error undone, and with Checks at 150 %; Checks' new rows from their first frame;
  and a run that keeps its status moves not even the sheet's head): on b060bc8 the sheet's top goes 105.4
  → 143 at 863 × 360 with T again; without the sheet held, rows move 25 px at an undo at 640 × 400;
  without the hold through a run, the sheet's top goes 148 → 199 there. "Two quick taps on More's Undo,
  150 ms apart, undo twice while an error stands": b060bc8 pressed Undo, then Redo. "An open sheet the
  student scrolled keeps its head where it is" (640 × 400 and 320 × 568, More scrolled 40 px after the
  error is undone, then T twice): with the hold as first fixed, the head goes 159 → 199. "A value typed on
  a part's card while an error stands moves none of the card's rows" (320 × 568 and 863 × 360): on b060bc8
  the actions move 47 px (Explain at 464..511); and `tests/unit/index-card-note.test.tsx`, the note kept
  through a quick run and "Running…" after 0.4 s (on b060bc8 the note is gone at once). "The Numbers and Plot sheets keep their rows
  where they are through each run" (Numbers at 863 × 360 through two Ctrl+Enter, and on an iPhone SE
  while an error stands; Plot of RC charging through T on R1, T again and an undo): on b060bc8 and the
  previous fix rows go 20 px down and back with each Ctrl+Enter; with the Plot panel drawn anew, the plot
  goes 275 → 493 → 473; without the rows in view kept, 20 px again. "Taps meant for the row just under
  More's head press it, quick or slow" (Undo at 863 × 360, Redo at the right end of an iPhone SE's row, the
  second tap once the first one's status has come, the third 800 ms after the second; the head where it
  was 1.2 s later, then coming down once the paper is tapped): on b060bc8 and without the lines' wait,
  Undo then the head; with the 600 ms wait, the third tap pressed the head. "The row the keys are on in
  More stays whole when the status line takes more room" (375 × 667 at 150 %, keys only: Shift+Tab back to
  Undo, Enter): with the 600 ms wait, 0 of 69 px of Undo in sight on every frame once the head came down.
  "An open sheet keeps its rows where they are…" also checks that a run keeps the lines' step and that the
  window reports no ResizeObserver loop: with the 600 ms wait, "the ground deleted: is-hint-aside is-aside
  → all in sight" at 320 × 568 with the largest text. "A sheet scrolled to its end keeps no empty room
  below its last row after a run" (Numbers through two Ctrl+Enter at 320 × 568 and 863 × 360): with the
  600 ms wait, what it scrolls goes 415 → 427. "A part deleted with Numbers scrolled to its end moves none
  of its rows" (Example 1, I1 deleted and the deletion undone, 320 × 568): without the room kept, V1's,
  R1's and R2's rows go 71.1 px down.

Still open: when a circuit opens, and after each pan or zoom, the drawing slides to its new place over
a third of a second (`.nb-world`'s transition), and a tap during a slide is read against where the
drawing is going, not where it is (seen in the tests, which wait for the drawing to settle; a sheet
going away no longer slides). The ladder above still opens as drawn: its turn is the schematic's to fix.

## After the last pass (13 November 2026)

- **Nothing a ResizeObserver watches changes size inside its delivery** (the last pass, a11y-phone-4).
  Opening the Plot sheet on a phone (RC charging; an iPhone SE, a Pixel 7 on its side, 640 × 400) raised
  the window's "ResizeObserver loop completed with undelivered notifications" error: about 1 run in 3 for
  the reviewer, 5 of 5 on each of the three at a load of 10 to 20 (c520a49). Two watchers wrote layout
  inside a delivery. The hint's watcher (`hooks.ts`, `useOverflowing`) marked the hidden words
  (`data-more`), which gives the hint a line and a half (`.hint-scroll[data-more]`, 22 → 33 px), and the
  open sheet's hold laid the sheet out afresh as its plot came in (all its rows new), changing its
  height (120 → 318 px) and so the stack's, which other watchers watch. Now the hint is marked in the next
  frame after a change its watchers see (at once when it is first watched, and as it scrolls), and the
  sheet's hold lays it out afresh in the next frame when a watcher sees all its rows new or Checks' own
  rows change; keeping rows in place (its scroll and the room below its rows) stays in the delivery, before
  the frame is drawn, so a run, a new status or an undo still moves none of them. The cost is one frame:
  the plot can show in the sheet's old height for one frame before the sheet grows to it (the sheet's top
  402 → 201 px a frame later on an iPhone SE in one of six runs). Measured with the reviewer's way of
  opening it (More, then Plot, by touch, `plotopen.cjs`): 0 of 6, 0 of 5 and 0 of 5 runs with the error
  on the three views at a load of 14 to 20 (c520a49: 5 of 5 each at 10 to 20). Test
  (`tests/e2e/phone.spec.ts`, "the Plot sheet opened on a phone, and opened again, raises no
  "ResizeObserver loop" error"): the three views, opened twice each, the window's errors watched from
  before the first opening (c520a49: the error at 320 × 568).


# 0015. The Notebook canvas: words, results and phones

- Status: accepted (Tarık approved the checkpoint on 11 November 2026: "Build the rest"; a phone
  opens a wide drawing **turned to fit**, with "As in the video" one tap away)
- Date: 2026-11-11
- Code: `src/notebook/` (the canvas the app will use), `design/checkpoint/` (Tarık's checkpoint page);
  screenshots in [`../design/checkpoint/`](../design/checkpoint/)

## Context

Tarık chose the Notebook look ([decision 0014](0014-the-look.md)) and asked to see it on one of p02's
dependent-source circuits, on a computer and on a phone, before the rest of milestone 2 is built. The
canvas has to draw any circuit the schematic model lays out ([decision 0013](0013-schematic-model.md))
with ngspice's results on it, and nothing may overlap. A design review of the first checkpoint found
that the drawing jumped and shrank when a card opened, that the card's line ran through words, and
that a phone left no room to watch the numbers move; this record says what the canvas does now.

## Decision

- **Four voices.** Names (parts and nodes) in the plain sans (Inter), values typeset in Notebook Serif,
  results handwritten in Caveat (or Inter with the plain-font setting), the netlist in JetBrains Mono.
  The sticky note, the field names in Explain and every control are in the plain sans: handwriting
  means "ngspice found this".
- **Exact room for words.** The canvas passes the model a `measure` built from the shipped fonts' own
  character widths (`src/notebook/metrics.ts`, measured in Chromium by `scripts/notebook-metrics.ts`),
  so the room the layout keeps is the room the words are drawn in. A result's room is the wider of
  Caveat and Inter, so switching the font moves nothing. Every digit counts as the widest digit, so
  any four-digit result fits; a longer one (an exponent) is written smaller to fit.
- **Results in their own room** (small additions to the model, `SceneOptions.resultRoom` and
  `SceneOptions.nodeResultInline`): a node's voltage on its name's line, "s = 12 V" (the name in
  the sans with its colour bar, "= 12 V" handwritten, as the prototype's tags); a part's current after
  an arrow pointing the way it flows on the drawing (SPICE's sign, turned with the symbol); a source's
  power on two lines ("delivers" or "absorbs", then the watts, which keeps the drawing narrow); a 0 V
  source as a meter, "measures" and its current. The words are the model's (describe.ts), the
  numbers formatSI's, as everywhere else.
- **What a dependent source reads, on the drawing.** In its control label the node it reads is
  underlined in that node's colour, the source whose current it reads underlined in ink (that source
  also carries the arrowhead of the current read); selecting it highlights them.
- **The card never changes the drawing's size** (review, issues 1 and 2). It is not in the fit's
  insets. On a computer it goes beside its part where the paper is free (`src/notebook/place.ts`,
  `placeCard`), as tall as its tallest state from the start (the "Was" row is kept, hidden, until the
  value changes), so typing moves nothing; if no side is free but the bands above and below the drawing
  (or left and right) add up to the card, the drawing is panned once, and back when the card closes.
  Only then may it cover some of the drawing, and never its part or the part's words. While a card is
  open the canvas holds its view (`hold`): a value label a little narrower or wider does not fit the
  drawing again. A line joins the card to its part only when it crosses no word, no wire and no
  symbol on the way; otherwise the card's notch and the part's highlight say which part it is. The
  tests place a card for every part of p02's three circuits in a 1440 × 900 and a 1280 × 720 window:
  it covers nothing, and every leader drawn is clear.
- **Red pen on the paper** (`src/notebook/notes.ts`): a check's title next to its part, the misread
  value circled; "No single answer at node n1" (the model's words) next to the node ngspice points
  at; while a card is open, each node voltage from before the change crossed out next to the new one.
  Each goes on free paper next to what it is about, wrapped narrower if that brings it nearer, and
  nowhere when there is no room (the card and the Checks panel still say it).
- **A phone held upright sees a wide drawing turned a quarter**, when the drawing as drawn would not
  fit whole at a readable size (names at least 10.5 px) and turning makes it larger. A narrow screen
  that can show it whole and readable (an iPad held upright: the page uses the phone's layout below
  900 px) shows it as drawn. Turned, the ladder stands up (source at the top, ground down the left)
  and fits whole. Only the view turns: the drawing in the netlist is not
  touched, a phone held sideways sees it as drawn, and "As in the video" switches back. The turned
  drawing is rebuilt by the model (reconcile, buildScene); when the rails are set further apart for a
  part's words, the parts' leads are lengthened by straight wire, so the router redraws nothing. It is
  used only when it is clean and has no more bends than the drawing as drawn (25 of the 30 circuits
  today; p02-5's ground is now one straight wire). "As in the video" opens at the drawing's left end
  (V1 and s), as tall as the screen allows up to 30 px a grid unit, its edges fading with "more".
- **A phone's controls** (review, issues 3 and 5): one bar along the bottom, Select · Parts · Netlist ·
  Checks · Explain (Playground's phone design); Parts opens a sheet of named parts that starts with the
  controlled sources. A part's card is a short sheet; while its value is typed it is one strip (the
  part, the field, Put back, Done) held above the keyboard (`visualViewport`), the bar, hint and status
  hidden, and the drawing fitted to the part and the nodes it changes.

## Alternatives considered

- **Fit the whole drawing on a phone, whatever the size**: p02-4's names would be about 7 px tall.
- **Pan only**: readable, but the first look at a circuit from a video shows two thirds of it.
- **Wrap or re-lay out the circuit for phones**: a different drawing from the netlist's; the turned
  view keeps every part's neighbours and every wire, only rotated.
- **Results beside the parts on free paper (the prototype)**: the model would not know they are
  there, so nothing would keep other words off them. Red pen is placed that way (notes.ts), but only
  where the model's boxes say the paper is free.
- **Dock the card in the right-hand column on a computer** (the review's suggestion): p02's drawings
  fill the width at the size that reads best, so a docked card would cover G1 or shrink the drawing;
  beside the part, after one pan, it covers nothing in both window sizes tested.
- **Fit the drawing to the space left by the card** (the first checkpoint): the drawing jumped and
  shrank (176 % to 107 %) as the card opened and grew.

## Consequences

- Fonts' character widths must be measured again when a font file changes (the README in
  `src/notebook/fonts/` says how).
- The schematic model's chain spacing does not count words, so a 0 V source keeps one result line (two
  would reach the node name below it in sp01-3).
- Some words still come from `src/spice` as they are (read only in this step): the field table's
  "250 mA for every volt it reads (amps per volt)" and the card's sentence "pushing 250 mA for every
  volt at n1". The page strips the summary's "Open the results for details." (it has no results view)
  and builds currents with "ground" from the model's own templates; the card shows a gain as SPICE
  reads the number ("0.25"). Proposed for `src/spice`, with tests: name what a controlled source
  senses ("0.25 A for every volt at n1", "2 × the current in Vsense") instead of "it reads", keep a
  gain's number as typed, a summary without the pointer for pages that have no results view, and
  "ground" in current texts.
- To ask Tarık: is the turned drawing right for phones, or should a phone always show the drawing as
  in the video and pan? (`p02-4-open-phone-views.png` shows both.)

## After the final reviews (12 November 2026)

- **The first numbers are handwritten from the start on an ordinary visit** (phone review F6). A
  browser asks for a font only when text needs it, and no text needs Caveat 700 before ngspice's
  first results: on a first visit on a slow phone (a Pixel 7 on Slow 4G with its CPU slowed four
  times) they were drawn in a fallback face for about 0.8 s, then changed to Caveat (nothing moved:
  the room is Caveat's). The page now loads that face once its own CSS and scripts are in
  (DOMContentLoaded, a line in its head that `vite.config.ts` writes from the family and weight the
  CSS declares) and before the engine's Worker asks for ngspice.wasm: the face is there seconds
  before the first numbers. Measured on that phone, first visits taken in turn with the build before
  (six, then four more after the change below): the first paint, the first drawing and the first
  results came no later, within the runs' spread (about 0.1 s on a busy machine; the results at
  11.52 to 11.62 s against 11.48 to 11.59 s), and the face was there at about 3.0 s. The review's
  `<link rel="preload">` brought the font as early but shared the first second's bandwidth with the
  page's CSS and scripts, and the first paint came about 0.15 s later, with low priority too. With
  the plain font chosen the face is loaded all the same (49 kB; from the service worker's cache after
  the first visit).
- **On a run=1 link the numbers come first** (the critic of F6). There the page's head preloads
  ngspice.wasm from the start (perf review 3), and the font, loaded at DOMContentLoaded too at first,
  downloaded beside it: the first numbers came about 0.24 s later (the font's 49 kB at 1.6 Mbps),
  in Caveat. Bringing the numbers early is what the preload is for, so on those links the font now
  waits until the preload has ended (its load or error event), then is asked for at once, about
  0.04 s after ngspice.wasm is in, while ngspice compiles and runs. Five first visits of the
  published F1a link on that phone, taken in turn with the build before: the first numbers came no
  later (10.86 to 10.89 s against 10.86 to 10.95 s; each pair within 0.06 s), drawn in the fallback
  face for 0.53 to 0.65 s (0.73 to 0.82 s before) while the font arrives behind them, sharing the
  connection with the parts of the app it downloads once the first run is done (menus, dialogs, the
  Netlist panel's editor). Nothing moves when the face changes.
- **Rounding noise is written as 0 A, but only where nothing real flows** (student review; corrected
  after the critic of the fixes, and again after the critic of round 2). Where a current is 0,
  ngspice's arithmetic can leave about 10⁻¹⁸ A (C9, C9b in `docs/spice-facts/explanations.md`), which
  the drawing wrote with an arrow ("R5 ← 8.882e-19 A") and as power ("V1 delivers 20.82 aW"). The
  first fix compared each current with the circuit's largest one, and zeroed the 2 aA of a source
  written 2A next to a 4 mA divider (C9e). The second decided part by part, but its "same voltage"
  (to 10⁻¹² of the voltage) and its use of Kirchhoff's current law still zeroed real currents: the
  2 aA of that source in a loop with 1 kΩ, where R1 and V1 were "0 A" next to "I1 2 aA" (C9h), a
  10 Ω resistor in series with 10¹⁴ Ω across 12 V (C9i), the nanovolts and femtoamps of a ladder of
  1000 sections (C9k), and R5 in 42 of 300 bridges with random values (C9l). So `describe.ts`
  (`roundingNoise`) first finds the currents that are real, and never calls them noise: one of at
  least 1 pA (ngspice's current tolerance abstol, C9c); a current source's own value; a resistor with
  a real voltage across it (at least 1 µV and more than 4 steps of a double), a G that reads one; an
  F that copies a real current; a part next to one whose current PlainSpice does not read (a diode, a
  transistor, a subcircuit, a switch), which may carry that part's current; and, since the currents
  at a node add up to 0, the parts that carry the difference where the real currents at a node do not
  add up to 0 (by more than 10⁻⁹ of the largest; rounding left up to 8e−11 in the random bridges),
  and a part in series with a real current (C9h to C9k). Only then is a current below 1 pA noise of a
  0, when the circuit makes it 0: a resistor whose two ends are at the same voltage, at most 4 steps of
  a double apart (a balanced circuit leaves 1 or 2: C9, C9b; in the random bridges the noise was never
  more than 2 steps, and beyond 4 the current was the circuit's own, C9l), or joined by parts with no
  voltage across them by their own numbers (an inductor, a 0 V source, an E or H whose control is 0, a
  resistor whose ends are the same); a part that carries the only current left at one of its nodes;
  an F that copies a current that is 0, a G that reads a voltage that is 0. A number below the
  smallest normal double, 2⁻¹⁰²² (about 2.2e−308), is never noise: it is what is left of a real value
  too small for a double (C9k). A node voltage below 1 µV, ngspice's voltage tolerance vntol (C9c), is
  shown as 0 V when the node is joined to ground through parts with no voltage across them, a resistor
  whose current is noise among them, so the drawing never writes "out = −216.8 fV" next to "0 A" for
  every part at out (C9d). The check looks again only at the parts a change can affect, so its time
  grows with the size of the circuit, not faster: about 10 ms for a ladder of 1000 sections or a bridge
  with 4000 ammeters, which took seconds (a unit test keeps it under 100 ms, and all the words of such a
  run under 400 ms). Such a current gets no arrow,
  no "delivers" or "absorbs", "0 A" at the end of its line and "no current flows" in speech; a note in
  the Numbers panel says what ngspice gave and why the true value is 0 ("ngspice gave R5 -8.881784e-19
  A. That is rounding noise, what its arithmetic leaves of a current that is 0: the two ends of R5,
  node a and node b, are at the same voltage, 4.5 V. …"; for several parts, "each of these parts has
  its two ends at the same voltage or carries the only current left at one of its nodes").
  `CurrentWords.noise` and `NodeVoltageWords.noise` keep ngspice's values for the panel's ngspice
  columns. The floors are ngspice's defaults: a netlist's `.options abstol` or `vntol` does not move
  them. Across the 184 netlists with `.op` we have (the examples, the fixtures, the trap corpus, the
  docs and the channel's episode netlists) no current or voltage is shown as noise. In the 300 random
  bridges, R5's current is shown as noise in the 133 whose ends are at most 4 steps apart (104 where
  ngspice's number is rounding noise, and 29 where the circuit's own current is no larger than the
  rounding), the 42 beyond keep their currents, and nothing else is shown as noise.
- **A 0 V source is "a wire, through which ngspice measures the current (the ammeter trick)"** in the
  circuit's description and on its card (student review): true of every 0 V source (P9), the
  turned-off source of a Thevenin example too, where "used as an ammeter" claimed a purpose the
  circuit does not have. The drawing keeps "measures". After the critic of this fix: a source with an
  AC value, the input of every Bode-plot exercise, is no wire and no ammeter, though it is 0 V in .op:
  "V1: an AC source of 1 V in an .ac analysis, 0 V in DC, with its + side at node in and its − side at
  ground" (P16, A20, P21). In an .op run its current is said as a current, with no "measures" and no
  power (it makes 0 V). The drawing's part description (`src/schematic/navigate.ts`) builds its own
  sentence and still calls such a source a wire until it takes the overview's own sentence
  (`partSentenceFor`, exported for it); its lane can change that at the merge.

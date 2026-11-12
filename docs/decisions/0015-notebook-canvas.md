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
- **Rounding noise is written as 0 A, but only where the circuit makes 0** (student review; corrected
  after the critic of the fixes, after the critic of round 2, and after the re-check of 12 November).
  Where a current is 0, ngspice's arithmetic can leave about 10⁻¹⁸ A (C9, C9b in
  `docs/spice-facts/explanations.md`), which the drawing wrote with an arrow ("R5 ← 8.882e-19 A") and
  as power ("V1 delivers 20.82 aW"). The first fix compared each current with the circuit's largest
  one, and zeroed the 2 aA of a source written 2A next to a 4 mA divider (C9e). The second decided
  part by part from ngspice's own numbers, by rules (two ends at most 4 steps of a double apart are at
  the same voltage, "the only current left at a node" is 0, a node below 1 µV joined to ground is at
  0 V), and the re-check showed that ngspice's numbers alone cannot tell a 0 from a tiny real value:
  that rule wrote a ladder node read by a 1 TΩ voltmeter as 0 V, though it is at a real 732.4 nV with
  61.04 nA flowing from it (C9n; a 1e20 Ω meter on a divider and a node set by a 1 nV source the
  same); it drew the link between two equal arms with its noise, because ngspice left its ends 7 or 9
  steps apart (C9m); it drew 193.5 pA, the noise of a 0 that an H of 1 GΩ lifts, next to a node it
  wrote as 0 V (C9o); and it drew the loads of an F or a G that copies or reads a 0 (C9r).
- **So PlainSpice solves the circuit exactly where it can, and shows as 0 only what is exactly 0**
  (`src/spice/exact.ts`, `roundingNoise` in `src/spice/describe.ts`). It solves a circuit of
  resistors, capacitors (open in .op), inductors (wires), V and I sources with a plain DC value or
  none (0), E and G with four nodes and a plain gain, and F and H with a plain gain. Each value is read
  as ngspice reads the word (the same grammar: its scale letters, "2A" as 2 attoamps, "10M" as 10
  milli), but as the exact decimal the netlist writes, and the double ngspice makes of the word (as
  `readNumber` computes it) must be within 4 units in the last place of that decimal; unit tests hold
  every value word of our netlists to that, and the decimals of the suffix corpus to native ngspice
  47's own doubles. The equations are solved with whole numbers only (Bareiss's
  elimination: every division is exact, and the sizes stay those of the determinants). Then
  PlainSpice checks that ngspice simulated that same circuit: it names the same nodes and parts, its
  values put into the exact equations leave at most 2⁻³⁰ of the largest sum of the sizes of an
  equation's terms (measured: at most 4.4e−14 over 7,756 circuits, most below 2⁻⁵²), and each current
  it reports is its own numbers' product to 2⁻⁴⁰ (measured: at most 3.4e−16). In a circuit with every
  kind of part, any value 1 ppm off fails one or the other (a unit test keeps it so); a source is
  weighed against the circuit's largest voltage, so a 1 pV source read as 1 nV in a 9 V circuit
  passes. The check is there for a part ngspice simulates differently from the model: the values are
  read by ngspice's own grammar. Its values are not compared one by one with the exact ones: in a
  circuit with a 10 mΩ wire beside attoamps, rounding makes a source's current 21 fA where the exact
  one is 4 aA, and that is still ngspice's arithmetic on this circuit. Then a current or node voltage
  whose exact value is 0 is rounding noise of a 0, whatever its size (193.5 pA in C9o), and one whose
  exact value is not 0 is real and shown as ngspice gives it, however tiny (732.4 nV in C9n, 2 aA in
  C9q). Two nodes are at the same voltage when their exact voltages are equal.
- **What the page shows for a value that is noise of a 0.** A current: no arrow, no "delivers" or
  "absorbs", "0 A" at the end of its line and "no current flows" in speech; a node voltage: 0 V. A
  part's card says 0 V across it when its two ends are at the same voltage, and so does the crossed-out
  number from before a change, with no "node b is higher" (it said "0 A through" next to "888.2 aV
  across"). A note in the Numbers panel says what ngspice gave and why the true value is 0: for one
  part its own reason ("the two ends of R5, node a and node b, are at the same voltage, 4.5 V"), for
  several the kinds of reason, each true of every value it names, and it ends "Solved exactly, with
  fractions, from the netlist's values, the circuit makes it exactly 0, so PlainSpice shows 0 A." Its
  lists stop at 4 values when there are more than 5 ("… and 3991 more currents, each in the tables
  above"), never "and 1 more". `CurrentWords.noise` and `NodeVoltageWords.noise` keep ngspice's values
  for the panel's ngspice columns.
- **.tf and .dc of a circuit solved exactly are decided the same way** (C9p). Every value is a + b·s in
  the source s, so one more exact solution, with that source at 1 V or 1 A and the others at 0, gives
  the .tf ratio (b of the output) and every point of a .dc sweep of one V or I source. ngspice's .tf
  gives no node voltages to check its circuit against, so its input and output resistances (and a
  ratio) must be the exact ones within its reltol, 10⁻³, and a ratio shown as 0 must be
  smaller than 2⁻³⁰ of the largest change the input makes in a value of the output's kind. A .dc sweep
  is checked at 5 of its points (its first, its last, and three between). The Numbers panel then shows
  "v(a,b)/V1 = 0 (V/V)" with ngspice's −5.551115e-17 in its "In ngspice's format" column; the Plot panel
  draws the sweep's noise points at 0 and its table has a column "… as ngspice gave it" with ngspice's
  values. A sweep of two sources, and a .tran run, are shown as ngspice gives them: a .tran's values
  come from ngspice's own time steps and their error, not from one solution PlainSpice can repeat
  exactly.
- **Other circuits keep a rule** (a diode, a transistor, a subcircuit, a switch, a part with settings,
  .param, other .options lines, more than 150 unknowns, or more work than the limits below). It is
  the rule above with the false zeros of C9n removed: a resistor's current that ngspice gives as exactly
  0 proves nothing (rounding hides 7.3e−25 V across a 1 µΩ wire at 732 nV) and joins nothing; only a
  source, never a resistor or a capacitor, is 0 as "the only current left at a node"; and a node below
  1 µV is shown as 0 V only when every current at it is shown as 0 A. So the bridge of C9d with a
  diode added is drawn with ngspice's noise: Vm −2.2e−19 A, F1 and R6 −2.2e−16 A, out −216.8 fV, since
  R5's 0 there cannot be told from the wire's 0 in C9n. What it gives up, measured on
  1,000 random circuits with diodes (991 ran; judged by solving each exactly with every diode replaced
  by the current ngspice gives it): 13 real currents are still shown as 0 A, all where ngspice's own
  number is more than 1 % off the exact one, so ngspice does not resolve them either (19 at cd20fe9);
  303 of the 1,340 currents that are exactly 0 are shown with ngspice's noise (204 at cd20fe9), 8 of
  them above 1 pA and 14 with a power; 90 node voltages that are exactly 0 are shown with ngspice's
  noise (57); and no node is at 0 V next to a real current (18 at cd20fe9). Taking two ends as the
  same only within 2 steps of a double would show 4 fewer real currents as 0 and 16 more noise values,
  more wrong values in all (328 against 316), so the 4 steps stay.
- **Measured on circuits generated at random** (each solved exactly in Python, from the netlist, as
  the judge; a diode replaced by the current ngspice gives it). In every circuit decided by the exact
  solution, nothing is left: no real value shown as 0, no exact 0 shown as a current or a voltage.
  2,000 linear circuits of equal arms, symmetric networks, dependent sources driving loads and tiny
  sources (19,150 currents, 5,340 of them exactly 0), all decided exactly: cd20fe9 drew 634 of those
  zeros as currents (37 above 1 pA) and 209 as node voltages, and put 12 nodes at 0 V next to a real
  current. 3,000 mixed circuits (104,400 currents; 613 with a diode): cd20fe9 showed 368 real
  currents as 0 A (24 that ngspice resolves to 1 %) and 37 real node voltages as 0 V, drew 682 zeros
  as currents, and put 21 nodes at 0 V next to a real current; now 36 real currents are shown as 0 A
  (none that ngspice resolves), 412 zeros as currents and no node at 0 V next to a real current, every
  one in a circuit with a diode or above the limits. 4,000 circuits of tiny real values beside noise
  (ladders, dividers and bridges read by meters of up to 1e20 Ω; 193 with a diode): cd20fe9 showed 19
  real currents as 0 A and 4 real node voltages as 0 V; now none, and the 52 zeros still drawn as
  currents (178 at cd20fe9) are all in circuits with a diode or above the limits. 1,500 circuits where
  a meter or a probe reads a node of a ladder or a divider: cd20fe9 showed 37 real currents as 0 A
  and 50 real node voltages as 0 V; now none.
- **Its speed.** The exact solution is worked out once per netlist (and kept for its .tf and .dc), on
  the main thread after each run. It stops at a counted amount of work, the same on every computer: at
  most 150 unknowns, 600 row combinations, 12,000 entry combinations and whole numbers of 4,096
  bits; beyond, the rule decides. Measured with `describeResults` (processor time, best of 5, the
  worst of 5 random circuits of each kind, under load): 3 to 5 ms for 60 parts, 6 to 23 ms for 150,
  at most 39 ms for 400 parts that go past the limits (a random network of resistors); with a .dc
  sweep of 1001 points 10 to 18 ms for 60 parts and up to 53 ms for 150. cd20fe9 took up to 4 ms. A
  unit test keeps 60 parts under 50 ms and the limits under 200 ms.
- **Our own netlists.** The words of all 186 netlists with `.op` we have (the 20 examples, the 7
  fixtures, the trap and letter corpora's 99, and the channel's 60 episode netlists) are the same,
  letter for letter, as at cd20fe9: none of them has rounding noise that cd20fe9 decided wrongly. The
  floors are ngspice's defaults: a netlist's `.options abstol` or `vntol` does not move them.
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

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
  after the critic of the fixes, after the critic of round 2, after the re-check of 12 November, and
  after the critic of the re-check's fixes). Where a current is 0, ngspice's arithmetic can leave about
  10⁻¹⁸ A (C9, C9b in `docs/spice-facts/explanations.md`), which the drawing wrote with an arrow
  ("R5 ← 8.882e-19 A") and as power ("V1 delivers 20.82 aW"). The first fix compared each current with
  the circuit's largest one, and zeroed the 2 aA of a source written 2A next to a 4 mA divider (C9e).
  The second decided part by part from ngspice's own numbers, by rules (two ends at most 4 steps of a
  double apart are at the same voltage, "the only current left at a node" is 0, a node below 1 µV
  joined to ground is at 0 V), and the re-check showed that ngspice's numbers alone cannot tell a 0
  from a tiny real value: that rule wrote a ladder node read by a 1 TΩ voltmeter as 0 V, though it is
  at a real 732.4 nV with 61.04 nA flowing from it (C9n; a 1e20 Ω meter on a divider and a node set by
  a 1 nV source the same); it drew the link between two equal arms with its noise, because ngspice
  left its ends 7 or 9 steps apart (C9m); it drew 193.5 pA, the noise of a 0 that an H of 1 GΩ lifts,
  next to a node it wrote as 0 V (C9o); and it drew the loads of an F or a G that copies or reads a 0
  (C9r).
- **So PlainSpice solves the circuit exactly where it can, and shows as 0 only what is exactly 0**
  (`src/spice/exact.ts`, `roundingNoise` in `src/spice/describe.ts`). It solves a circuit of
  resistors, capacitors (open in .op), inductors (wires), V and I sources with a plain DC value or
  none (0), E and G with four nodes and a plain gain, and F and H with a plain gain. Each value is read
  as ngspice reads the word (the same grammar: its scale letters, "2A" as 2 attoamps, "10M" as 10
  milli), but as the exact decimal the netlist writes, and the double ngspice makes of the word (as
  `readNumber` computes it) must be within 4 units in the last place of that decimal; unit tests hold
  every value word of our netlists to that, and the decimals of the suffix corpus to native ngspice
  47's own doubles. A word no double can be (outside 10^−325 to 10^310, which ngspice reads as 0 or as
  infinity, such as 1e-999999999), or with more than 100 significant digits, is not read exactly, and
  no power of ten is built for it: 10^999999999 alone took half a minute, then failed, and the page
  froze for 66 s and lost every current (the critic of the re-check's fixes). The equations are solved
  with whole numbers only (Bareiss's elimination: every division is exact, and the sizes stay those of
  the determinants).
- **ngspice must have simulated that circuit, and solved it to the digits the page shows.** It names
  the same nodes and parts; its values put into the exact equations leave at most 2⁻³⁰ of the largest
  sum of the sizes of an equation's terms, Kirchhoff's law at the nodes weighed against the nodes'
  own sizes (in amps) and the branches' own equations against theirs (in volts): weighed together, a
  9 V source's equation hid a node's misread nanoamps (measured over the 11,645 netlists of the
  re-check's corpora and the repository: at most 3.8e−15 for the nodes, 4.4e−11 for the branches);
  and each current it reports is its own numbers' product to 2⁻⁴⁰ (measured: at most 3.4e−16). In a
  circuit with every kind of part any value 1 ppm off fails one or the other, and so does a .dc
  point's value 1 ppm off (unit tests keep it so); a source is weighed against the circuit's largest
  voltage, so a 1 pV source read as 1 nV in a 9 V circuit passes. Those checks alone passed runs that
  ngspice solved far from the exact answer: a wire far smaller than the resistors around it makes the
  equations ill-conditioned, its huge terms hide what ngspice's values leave of them, and with a
  1e−12 Ω wire in a balanced bridge ngspice gives 4.321 V and 4.374 V where the circuit makes 4.5 V
  (C9s). PlainSpice then wrote 0 A between nodes it wrote 53 mV apart, with a note saying both were at
  4.5 V; with a G of 1000 it wrote 0 A next to ngspice's 16.61 V. So ngspice's answers must also be
  the exact ones: each node voltage and each V, E, H and L current whose exact value is not 0 and not
  below 1e−3 of the largest of its kind must be within 5e−5 of its exact value (exact.ts
  `answersAgree`). 5e−5 is less than half a unit in the last of the 4 significant digits the page
  shows, whatever the first digits (half a unit of 9.999 is 5e−5 of it), so where ngspice is within it
  its numbers carry the exact value's digits (or one unit off in the last, where the exact value lies
  that close to a rounding boundary), and the 0s the exact solution puts beside them agree with them.
  A smaller value is not compared: there ngspice's rounding can be as large as the value with nothing
  wrong (a 10 mΩ wire beside attoamps leaves a source's 4 aA at 21 fA), and such a value is shown as
  ngspice gives it. Nor is a resistor's, G's or F's current: ngspice works it out from those answers,
  a resistor's from the voltages at its ends, which can cancel to a few digits, and the product check
  holds it to that. Of the 9,565 linear circuits of the corpora PlainSpice models exactly, 317 give
  answers farther off than 5e−5 (yA none, gA 155, rA 132, pA 30); 1e−6 would send 389, 5e−4 253.
- **Then a value whose exact value is 0 is noise, and one whose exact value is not 0 is real.** A
  current or node voltage whose exact value is 0 is rounding noise of a 0, whatever its size (193.5 pA
  in C9o), and one whose exact value is not 0 is real and shown as ngspice gives it, however tiny
  (732.4 nV in C9n, 2 aA in C9q). Two nodes are at the same voltage when their exact voltages are
  equal.
- **A real value that ngspice gives as exactly 0 is shown exactly** (the critic of the re-check's
  fixes). A 1 nΩ wire in series with 10 MΩ carries 454.1 pA, as the 10 MΩ does, but the 4.5e−19 V
  across it is about half a step of a double at the 4.541 mV of its ends, which come out as the same
  double, so ngspice gives the wire exactly 0 A; the page read "no current through R3" next to "R4
  454.1 pA" in series with it (C9n.4; so did C9n's 1 µΩ wire). Such a 0 has no correct digit, as
  noise of a 0 has none, so it is the second place PlainSpice's numbers differ from ngspice's: the
  exact 454.1 pA, with ngspice's 0 in the Numbers panel's ngspice column (`CurrentWords.given`,
  `NodeVoltageWords.given`) and a note: "ngspice gave R3 exactly 0 A. But a current flows through R3:
  the 4.541e-19 V across it is too small beside the 4.541 mV at its ends, node d2 and node p3, for
  ngspice's arithmetic (about 16 significant digits), so both ends come out as the same number. Solved
  exactly, with fractions, from the netlist's values, R3 carries 454.1 pA, so PlainSpice shows
  454.1 pA." For several values the reason is one true of each ("each is too small beside the larger
  numbers ngspice works it out from"). A resistor's card says the exact voltage across it
  (`CurrentWords.across`), so it keeps Ohm's law. The other choice, keeping ngspice's 0 and saying it
  is too small for ngspice, would still show a 0 for a real current. A value below the smallest double
  (about 4.9e−324, the far end of a long ladder, C9k) has no number to show, and stays 0.
- **Where ngspice's answers are farther off, the rule decides, helped by the exact solution.** A 0 from
  the exact solution next to ngspice's imprecise numbers breaks Ohm's law on the page, so the rule for
  other circuits (below) decides from ngspice's own numbers, which agree with each other; the exact
  solution keeps it from calling a value noise whose exact value is not 0, keeps a level only for
  nodes whose exact voltages are equal, and gives the real values ngspice gave as exactly 0, shown
  exactly as above. So the 1e−12 Ω wire's bridge shows 4.321 V, 4.374 V and R5's 53.56 µA, as ngspice
  gives them, with no note.
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
  gives no node voltages to check its circuit against, so its input and output resistances must be
  the exact ones to within 5e−5, as an operating point's answers, and a ratio shown as 0 must be
  smaller than 2⁻³⁰ of the largest change the input makes in a value of the output's kind. A .dc
  sweep is checked at 5 of its points (its first, its last, and three between), each as an operating
  point is. Each point is judged at the value ngspice swept the source to, its own x read exactly:
  ngspice adds the step in doubles, so "-1 1 0.1" reaches −1.39e−16 V where the student wrote 0, and
  a node that follows the source is a real −1.39e−16 V there, as the Plot panel's x says; judged at
  the student's 0 it was called noise (C9p.5). So a + b·s is 0 at every point when a and b are, and
  otherwise only where ngspice's x is −a/b exactly: a search through the doubles, with no fractions at
  each point, so a sweep of 99,999 points takes a few milliseconds (it took 705 ms, about 7 µs a
  point), and the note puts only the points it names into words. The Numbers panel then shows
  "v(a,b)/V1 = 0 (V/V)" with ngspice's −5.551115e-17 in its "In ngspice's format" column; the Plot
  panel draws the sweep's noise points at 0 and its table has a column "… as ngspice gave it" with
  ngspice's values. A sweep point ngspice gives as exactly 0 for a real value is still shown as 0:
  the exact value would cost a fraction at each such point, and a sweep can have 99,999 of them (a
  1 aA current that ngspice gives as 0 at every point of a sweep of its source); it is left open. A
  sweep of two sources, and a .tran run, are shown as ngspice gives them: a .tran's values come from ngspice's own time steps and their error, not from one solution
  PlainSpice can repeat exactly.
- **Other circuits keep a rule** (a diode, a transistor, a subcircuit, a switch, a part with settings,
  .param, other .options lines, more than 150 unknowns, or more work than the limit below). It is
  the rule above with the false zeros of C9n removed: a resistor's current that ngspice gives as exactly
  0 proves nothing (rounding hides 7.3e−25 V across a 1 µΩ wire at 732 nV) and joins nothing; only a
  source, never a resistor or a capacitor, is 0 as "the only current left at a node"; and a node below
  1 µV is shown as 0 V only when every current at it is shown as 0 A. Its levels agree with what the
  page shows (the critic of the re-check's fixes): a node of ground's group has ground's level only
  when it is shown as 0 V, and a group with a resistor between two of its nodes whose current is shown
  as real has no level, so an H of 1 GΩ reading a balanced bridge, with a diode, leaves out at
  −193.5 nV beside Rl's 193.5 pA, and Rl's card says the 193.5 nV across it, not 0 V (C9o.4). The
  bridge of C9d with a diode added is drawn with ngspice's noise: Vm −2.2e−19 A, F1 and R6 −2.2e−16 A,
  out −216.8 fV, since R5's 0 there cannot be told from the wire's 0 in C9n. Taking two ends as the
  same only within 2 steps of a double showed more wrong values in all (328 against 316 on 1,000
  circuits with diodes), so the 4 steps stay.
- **Measured on circuits generated at random** (re-judged after the critic of the re-check's fixes:
  each circuit solved exactly in Python, from the netlist, as the judge, a diode replaced by the
  current ngspice gives it; a "real value shown as 0" counts every 0 the page shows for a value whose
  exact value is not 0, ngspice's own 0s too, which the earlier count left out). Of 11,500 circuits
  (yA, gA, rA, pA, yD; 11,487 ran), 9,248 are decided by the exact solution. No real value is shown
  as 0 there, but 15 in one ladder of rA whose far end is below the smallest double; no exact 0 is
  shown as a number; no two parts in series show 0 A beside a current; and a resistor is shown as 0 A
  between voltages written differently 3 times: once at a rounding boundary (0.3437 and 0.3438 V),
  once between two values too tiny beside the others to be compared (9.99e-21 and 9.987e-21 V), once
  below the smallest double. ngspice's own 0s for real values are shown exactly: 324 values in gA,
  242 in rA and 203 in pA; 112 of them sit next to a part in series whose tiny current ngspice gives
  with no correct digit, so the two disagree (they read "0 A" beside that number before). In these
  same circuits cd20fe9 showed 1,238 real values as 0 and drew 984 exact 0s as currents and 241 as
  node voltages, and 69515dc showed 784 real values as 0. 317 linear circuits are decided by the rule
  with the exact solution (their answers farther off): no real value is shown as 0 (cd20fe9: 313),
  and 96 exact 0s are drawn with ngspice's numbers (18 above 1 pA, 8 with a power) and 7 node
  voltages, as ngspice's own numbers show them, where 69515dc wrote 0 next to numbers that
  contradicted it (15 resistors at 0 A between nodes written differently). 125 circuits are past
  150 unknowns and 1,797 have a diode, decided by the rule as before: in those with a diode 187 real
  values are still shown as 0 (cd20fe9: 235), and 750 exact 0s are drawn as currents (619) and 223
  as node voltages (183).
- **Its speed.** The exact solution is worked out once per netlist (and kept for its .tf and .dc), on
  the main thread after each run. It stops at a counted amount of work, the same on every computer
  (`MAX_WORK`): each combination of two rows counts, and each entry it writes counts more the larger
  its numbers are (the square of their size in 64-bit words, which is what multiplying and dividing
  them costs), the back substitution too, before it starts; at most 150 unknowns, and whole numbers of
  4,096 bits. The old limits counted rows and entries alone, and grids of resistors with 3-digit
  values took up to 165 ms within them (the critic's 9 × 9 grid with .op, .dc and .tf: 226 ms).
  Measured on 174 grids, meshes, ladders and networks of E and G of up to 146 unknowns with values of
  1, 3 and 7 digits, on a machine shared with other builds (processor time): a solve takes at most
  43 ms, the work until it stops at most 62 ms, between 2.6e−6 and 9.1e−6 ms a unit of work. The
  checks no longer search for common factors in thousands of bits (Euclid's algorithm took 2 ms a step
  there): `describeResults` takes 45 to 81 ms near the limits with .op, a 1001-point .dc and a .tf
  (grids of 9 × 9 to 12 × 12, meshes of 60 to 145 nodes), 8 ms for a 99,901-point sweep of a bridge.
  Unit tests keep 60 parts under 50 ms, the limits and grids of 3-digit values under 200 ms, and a
  99,999-point sweep under 50 ms.
- **Our own netlists.** The words of all 210 netlists we have (the examples, the fixtures, the trap
  and letter corpora, the engine settings' goldens and the channel's episode netlists; 186 of them
  with `.op`), their line notes too, are the same, letter for letter, as at cd20fe9, and no point of a
  sweep is drawn differently; so are the cards of every part of the 186, also with a crossed-out
  number from before a change of every resistor by 20 % (633 such readouts): none of them has
  rounding noise that cd20fe9 decided wrongly, nor a real value ngspice gives as 0. The floors are
  ngspice's defaults: a netlist's `.options abstol` or `vntol` does not move them.
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

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
  after the critic of the fixes, after the critic of round 2, after the re-check of 12 November, after
  the critic of the re-check's fixes, and after the critic of round 2 of those fixes). Where a current is 0, ngspice's arithmetic can leave about
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
  none (0), E and G with four nodes and a plain gain, and F and H with a plain gain; a diode as a part
  whose current is left free (below). Each value is read
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
  9 V source's equation hid a node's misread nanoamps (measured over the 9,627 netlists of the
  re-check's corpora and the repository that it models exactly: at most 3.8e−15 for the nodes, 4.4e−11 for the branches);
  and each current it reports is its own numbers' product to 2⁻⁴⁰ (measured: at most 3.4e−16). In a
  circuit with every kind of part any value 1 ppm off fails one or the other, and so does a .dc
  point's value 1 ppm off (unit tests keep it so); a source is weighed against the circuit's largest
  voltage, so a 1 pV source read as 1 nV in a 9 V circuit passes. Those checks alone passed runs that
  ngspice solved far from the exact answer: a wire far smaller than the resistors around it makes the
  equations ill-conditioned, its huge terms hide what ngspice's values leave of them, and with a
  1e−12 Ω wire in a balanced bridge ngspice gives 4.321 V and 4.374 V where the circuit makes 4.5 V
  (C9s). So ngspice's answers must also be the exact ones: each node voltage and each V, E, H and L
  current whose exact value is not 0 must be within 5e−5 of it, beyond what ngspice's rounding leaves,
  2⁻³⁰ of the largest exact value of its kind (exact.ts `answersAgree`, `ANSWER_FLOOR`). 5e−5 is less
  than half a unit in the last of the 4 significant digits the page shows, whatever the first digits
  (half a unit of 9.999 is 5e−5 of it), so where ngspice is within it its numbers carry the exact
  value's digits (or one unit off in the last, where the exact value lies that close to a rounding
  boundary). A value tiny beside the others of its kind is held only to the floor: ngspice's arithmetic
  can leave it no correct digit with nothing wrong (a 10 mΩ wire beside attoamps leaves a source's 4 aA
  at 21 fA), and it is shown as ngspice gives it, so two such values in series can differ on the page
  (counted below). Until the critic of round 2 of the re-check's fixes the comparison skipped every
  value below 1e−3 of the largest of its kind, and so never compared a bridge at a few millivolts beside
  a 12 or 15 V source, however far off ngspice was there: ngspice's 2.097 V and −82.78 mV for exact 0s
  were called rounding noise and drawn as 0 beside its other numbers, 1.8e−4 and 6 % off (C9s.3, C9s.4),
  and the page broke Ohm's law and the gain of the G and the E. Those answers are 1.75 µV and 0.31 mV
  off, far beyond the floor's 1.4e−8 and 1.1e−8 V. Nor is a resistor's, G's or F's current compared for
  the decision: ngspice works it out from those answers, a resistor's from the voltages at its ends,
  which can cancel to a few digits, and the product check holds it to that. Of the 9,565 linear
  circuits of the corpora PlainSpice models exactly, 344 give answers farther off (yA none, gA 180,
  rA 123, pA 41); the skip sent 317.
- **Then a value whose exact value is 0 is noise, and one whose exact value is not 0 is real.** A
  current or node voltage whose exact value is 0 is rounding noise of a 0, whatever its size (193.5 pA
  in C9o), and one whose exact value is not 0 is real and shown as ngspice gives it, however tiny
  (732.4 nV in C9n, 2 aA in C9q). Two nodes are at the same voltage when their exact voltages are
  equal. With diodes, "exactly 0" means 0 whatever current the diodes carry (below).
- **A real value that ngspice gives as exactly 0 is shown exactly** (the critic of the re-check's fixes).
  A 1 nΩ wire in series with 10 MΩ carries 454.1 pA, as the 10 MΩ does, but the 4.5e−19 V across it is
  about half a step of a double at the 4.541 mV of its ends, which come out as the same double, so
  ngspice gives the wire exactly 0 A; the page read "no current through R3" next to "R4 454.1 pA" in
  series with it (C9n.4; so did C9n's 1 µΩ wire). Such a 0 has no correct digit, as noise of a 0 has
  none, so it is the second place PlainSpice's numbers differ from ngspice's: the exact 454.1 pA, with
  ngspice's 0 in the Numbers panel's ngspice column (`CurrentWords.given`, `NodeVoltageWords.given`) and
  a note: "ngspice gave R3 exactly 0 A. But a current flows through R3: the 4.541e-19 V across it is too
  small beside the 4.541 mV at its ends, node d2 and node p3, for ngspice's arithmetic (about 16
  significant digits), so both ends come out as the same number. Solved exactly, with fractions, from the
  netlist's values, R3 carries 454.1 pA, so PlainSpice shows 454.1 pA." For several values the reason is
  one true of each ("each is too small beside the larger numbers ngspice works it out from"), and the
  lists stop at 4 values when there are more than 5. A resistor's card says the exact voltage across it
  (`CurrentWords.across`), and so does its crossed-out number from before a change, so it keeps Ohm's
  law. The other choice, keeping ngspice's 0 and saying it is too small for ngspice, would still show a 0
  for a real current. A value below the smallest double (about 4.9e−324, the far end of a long ladder,
  C9k) has no number to show, and stays 0, with no note. A sweep's points are treated the same way (.dc,
  below). Not where ngspice's answers are off (below); with diodes, only a value that no diode's current
  changes, whose exact value is the circuit's whatever current the diodes carry (the 1 nΩ wire of C9n.4
  with a diode across V1 shows its 454.1 pA in the .op and at each point of the sweep, C9n.6). A value a
  diode's current changes keeps ngspice's 0: its exact value depends on that current, which only
  ngspice's numbers give, to their rounding (two equal diode arms whose ends ngspice gives as one double
  leave R5's 0, ngspice's own, where a value worked out from the two currents was their rounding; two
  diode-fed rails leave their middle node at ngspice's exact 0 V, which the currents worked out with V1's
  current a step off made 1.7e−15 V), so such a 0 stays as ngspice gives it (counted below). Before, any
  diode in the circuit kept every such 0.
- **Where ngspice's answers are farther off, every number is ngspice's, with a warning.** A 0 from the
  exact solution next to ngspice's imprecise numbers breaks Ohm's law on the page, and so does an exact
  value put in their place: C9s.5's unbalanced bridge has its 1e−12 Ω wire carry 46.46 µA, which ngspice
  gives as 0 A beside R5's 53.56 µA the other way, and the exact 46.46 µA beside them pushed current into
  node m from both sides (the critic of round 2). So the rule for other circuits (below) decides from
  ngspice's own numbers, and every number on the page is ngspice's; the exact solution only keeps the
  rule from calling a value noise whose exact value is not 0, keeps a level only for nodes whose exact
  voltages are equal, and keeps the reason "every other current at this node is 0" only where it is true.
  A warning says the numbers are off: "Some of ngspice's answers here are off. Solved exactly, with
  fractions, from the netlist's values, R5 carries no current, where ngspice gives 53.56 µA; R1 carries
  450 µA, where ngspice gives 467.9 µA; node a is at 4.5 V, where ngspice gives 4.321 V; node m is at 4.5
  V, where ngspice gives 4.321 V; and 5 more. ngspice computes with about 16 significant digits, and
  solving this circuit loses most of them. PlainSpice shows ngspice's numbers as it gives them, so they
  may not agree with each other." (C9s). It names node voltages, the currents of the V, E, H and L, and
  those of the R, G and F that ngspice reports, off by more than 5e−5 beyond the floor: the exact 0s
  ngspice gives as numbers first, node voltages before currents, then by how far off, a current given the
  other way before one given as 0 A where a current flows; at most 4 when there are more than 5, the rest
  counted. Every answer named is off by more than 5e−5 of itself, so ngspice has kept fewer than 5 of its
  16 digits there: "loses most of them" is true of each. It names no part as the cause. With diodes it
  names only values that no diode's current changes: the exact value of any other depends on the diodes'
  currents, which only ngspice's numbers give, and they are off there too (C9t.8: the bridge of C9s fed
  through 100 Ω beside a diode names Rw and R5, which the balance makes 0 whatever top is, not node a,
  half of top). When every value that is off depends on a diode's current there is no warning, and the
  rule decides, held by the exact solution as above.
- **What the page shows for a value that is noise of a 0.** A current: no arrow, no "delivers" or
  "absorbs", "0 A" at the end of its line and "no current flows" in speech; a node voltage: 0 V. A
  part's card says 0 V across it when its two ends are at the same voltage, and so does the crossed-out
  number from before a change, with no "node b is higher" (it said "0 A through" next to "888.2 aV
  across"). A note in the Numbers panel says what ngspice gave and why the true value is 0: for one
  part its own reason ("the two ends of R5, node a and node b, are at the same voltage, 4.5 V"), for
  several the kinds of reason, each true of every value it names, and it ends "Solved exactly, with
  fractions, from the netlist's values, the circuit makes it exactly 0, so PlainSpice shows 0 A" (with
  diodes, "from the netlist's values and its diodes' currents"). Its lists stop at 4 values when there
  are more than 5 ("… and 3991 more currents, each in the tables above"), never "and 1 more".
  `CurrentWords.noise` and `NodeVoltageWords.noise` keep ngspice's values for the panel's ngspice
  columns.
- **.tf and .dc of a circuit solved exactly are decided the same way** (C9p). Every value is a + b·s in
  the source s, so one more exact solution, with that source at 1 V or 1 A and the others at 0, gives the
  .tf ratio (b of the output) and every point of a .dc sweep of one V or I source. ngspice's .tf gives no
  node voltages to check its circuit against, so its input and output resistances must be the exact ones
  to within 5e−5, as an operating point's answers. Where the netlist's .op is decided exactly (ngspice
  simulated this circuit and solved it to the page's digits; its .tf solves the same equations), an exact
  0 ratio is 0 whatever size ngspice gives it, as the .op's values are: a gain lifts the .tf's rounding
  as it does the .op's, and the H of 1 GΩ reading a balanced bridge gave v(out)/V1 = −2.15e−8 (V/V)
  beside the .op's "out 0 V, exactly 0" (C9p.6, the critic of round 2). Without such an .op, a ratio
  shown as 0 must be smaller than 2⁻³⁰ of the largest change the input makes in a value of the output's
  kind, which keeps a real 1e−18 V/V (C9p.4). A .dc sweep is checked at 5 of its points (its first, its
  last, and three between), each as an operating point is. Each point is judged at the value ngspice
  swept the source to, its own x read exactly: ngspice adds the step in doubles, so "-1 1 0.1" reaches
  −1.39e−16 V where the student wrote 0, and a node that follows the source is a real −1.39e−16 V there,
  as the Plot panel's x says; judged at the student's 0 it was called noise (C9p.5). So a + b·s is 0 at
  every point when a and b are, and otherwise only where ngspice's x is −a/b exactly: a search through
  the doubles, with no fractions at each point, so a sweep of 99,999 points takes a few milliseconds, and
  the note puts only the points it names into words. A point where ngspice gives exactly 0 for a value
  whose a + b·s is not 0 there is shown as that exact value, as in an operating point (C9n.5: the .op's
  words said R3 454.1 pA while the sweep's said 0 A at the same point, the critic of round 2), with a
  note and ngspice's 0 in the Plot table's column "… as ngspice gave it": with whole numbers for the
  first 2,000 such points of a run and at its last point (3 to 6.5 µs a point); past them in doubles from
  the exact a and b, which keeps 8 significant digits or more wherever a + b·s is not within 2⁻²⁴ of a
  and b·s, and with whole numbers again where it is (where it crosses 0). The Numbers panel shows
  "v(a,b)/V1 = 0 (V/V)" with ngspice's −5.551115e-17 in its "In ngspice's format" column; the Plot panel
  draws the sweep's noise points at 0 and its table has a column "… as ngspice gave it". A run's .op and
  .dc are decided exactly together or not at all: their checks share the run's budget (below), and an .op
  decided exactly beside a sweep left as ngspice gives it said 0 V where the sweep's words, at the same
  point, said ngspice's −931.3 pV. A sweep of a circuit with diodes is decided as its operating point is
  (below). A sweep of two sources, a .tf of a circuit with a diode (its ratio depends on the diode's
  conductance at the operating point), and a .tran run are shown as ngspice gives them: a .tran's values
  come from ngspice's own time steps and their error, not from one solution PlainSpice can repeat
  exactly.
- **A diode's current is left free** (the critic of round 2: the rule, which decided circuits with a
  diode, only moved N2's contradiction there, undid the fed E's correct 0, and called a real 433.7 fV 0
  V). A diode is a part with two ends whose current, whatever it is, flows in at one end and out at the
  other; its model, its settings, its series resistance and its gmin change only that current. So
  PlainSpice solves the circuit with each diode as a current left free: the operating point with every
  diode at 0 A, and one more solution for each branch of a forest of the diodes' graph, a unit current
  through it (diodes side by side or in a loop reach the rest of the circuit only as the forest's
  currents). A value that is 0 in each of these solutions is 0 whatever current the diodes carry: exactly
  0. A diode with exactly 0 V across it when every diode carries 0 A, whose voltage no other diode's
  current changes, carries 0 A (0 V across a diode makes 0 A, its series resistance then dropping
  nothing; C9t.2), so its solution is left out. Such a diode must carry less than ngspice's current
  tolerance, 1 pA, by Kirchhoff's law with ngspice's other values, or the rule decides: in the generated
  s5-137 nothing drives a loop of a diode and 2.2 MΩ, and ngspice settles on 0.31 µA around it (its diode
  at 2.5 mA, which does not add up), which the circuit's 2 GV and 90 kA hid from the checks above, and
  the page called it rounding noise beside nodes drawn at 100.7 V and 100 V (C9t.10). Each diode's
  current in the operating point is the one Kirchhoff's law gives it from ngspice's other values, worked
  from the forest's leaves in, and the checks above run against that; ngspice's own @d1[id] is its last
  iteration's, 1.4e−4 off with a 10 Ω series resistance (C9t.4). Each tree of diodes leaves out the node
  whose law ngspice's rounding leaves farthest from 0, by an estimate in doubles (a resistor's current
  can be off by a step of each end's voltage over its resistance), and ground can be one of the others:
  next to a 1 nΩ wire, the wire's node gave a diode 4.1e−10 A for its 6.5e−15 A, and a warning said d2 is
  at 4.542 mV where it is at 4.541 mV, as ngspice gives it (C9t.7; ground's law has only V1's, R2's and
  R4's currents). A .dc sweep is decided the same way at each point, each diode's current there left free
  and taken from that point's values (the H of 1 GΩ with a diode said out 0 V in the .op beside the
  sweep's −193.5 nV at the same 9 V, C9t.5): a value is 0 at a point where a + b·s is 0 and no diode free
  there changes it; a diode with exactly 0 V across it at one point, whatever the free ones carry,
  carries 0 A there only (C9t.6); and at a point where the circuit makes every value 0 (a source swept
  through 0 V), no equation weighs ngspice's Newton leftovers (−7.4e−25 V) against anything larger, so
  each of its values there is held to 2⁻³⁰ of the largest it gives of that kind over the sweep, the
  answers check's floor (C9t.9), and that point counts in the run's budget as the check it stands for. So
  the H of 1 GΩ with a diode shows out 0 V and Rl 0 A (C9o.4), the fed E carries its 5 mA at exactly 0 V
  with no power (C9t), and a real −433.7 fV behind a bridge 1e−13 off balance is shown (C9t.3). A circuit
  with a node whose only DC path goes through diodes (its equations have no single answer with the diodes
  taken as free currents), or with more than 16 diodes, is left to the rule. The direction left diodes to
  the rule; this decides them exactly where the rule could not, measured below. What it cannot know is a
  value that is 0 only because two diodes carry equal currents (two equal arms): it is taken as real and
  shown as ngspice gives it.
- **Other circuits keep a rule** (a transistor, a switch, a subcircuit, a B source, a part with settings,
  .param, .temp and other .options lines, more than 150 unknowns, 1,600 parts or 16 diodes, or more work
  than the limit below; and where ngspice's answers are farther off, above). It decides from ngspice's
  numbers alone, and each 0 it writes must agree with the numbers the page shows beside it: a resistor or
  capacitor is 0 only where its two ends are within 4 steps of a double, never as "the only current left
  at a node", and a resistor's current that ngspice gives as exactly 0 proves nothing and joins nothing
  (rounding hides 7.3e−25 V across a 1 µΩ wire at 732 nV, C9n); an F that copies a 0 and a G that reads
  two nodes shown alike are 0; a source carrying the only current left at a node is 0. The current an F
  or an H turns into a real value is real (an F of 1e6 showed 193.5 pA beside "Vm measures no current"),
  and each F that copies a current given back gets its number back too (C9r.3: an F of 1 reading the Vm
  an F of 1000 had given back kept "it pushes 1 × the current in Vm, which is 0" beside Vm's 193.5 aA);
  an F that copies a real current is real (an F of 1e−17 copying a real 1 mA carries a real 1e−20 A,
  which the rule wrote as 0 A once the resistor beside it, its two ends a step apart, was taken as 0).
  Where the currents shown at a node do not add up to 0, every 0 written there gets ngspice's number
  back, and so on from node to node (a G reading a balanced bridge into two loads keeps its attoamps
  beside theirs, S3). A controlled source's equation holds on the page the same way: an F whose current
  is shown copies a current that is shown, and an E whose two ends are shown at voltages that are not
  alike, or a G whose current is shown, reads a voltage that is not 0, so the resistors written as 0 that
  join its two control nodes into one group of nodes (whose 0s claim one voltage for all of them) get
  ngspice's numbers back, the whole group at once, until nothing changes (C9o.5: with a .temp line, the E
  of 10⁶ reading the bridge of C9 showed R5 as 0 A, "its two ends at the same voltage", beside out's
  −931.3 pV, which E1 makes from that voltage; the critic of round 2). A chain of controlled sources (an
  E reading what another E makes), and a source whose value is an expression (value=, a B source), are
  not followed. And it writes no node voltage as 0 V: no guard could tell a node's real 433.7 fV, behind
  a bridge 1e−13 off balance, from noise (the critic of round 2 found 5 real node voltages and 49 real
  currents that the rule's chain turned into 0 in the corpora's circuits with a diode). What that gives
  up: an exact 0 node voltage is drawn with ngspice's noise, and so is what follows from it; with a
  transistor or a .temp line beside it, the H of 1 GΩ shows out −193.5 nV and Rl and H1 193.5 pA, H1 with
  the power that makes, and the fed E delivers 4.657 pW at out's −931.3 pV (C9o.4), R5 keeping ngspice's
  8.882e−19 A as in C9o.5; and since those numbers agree with each other only to ngspice's rounding, Vm's
  193.5 aA and R5's 377.9 aA, alone in series at m, do not add up there. Its levels agree with what the
  page shows: ground's level only for a node shown as 0 V; no level for a group with a resistor between
  two of its nodes whose current is shown as real, nor for one whose nodes are shown at voltages that are
  not alike. Taking two ends as the same only within 2 steps of a double showed more wrong values in all
  (328 against 316 on 1,000 circuits with diodes, when the rule decided those), so the 4 steps stay.
- **Measured on circuits generated at random** (re-judged after the second fix of the critic of round 2:
  each circuit solved exactly in Python, from the netlist, as the judge, a diode replaced by the current
  ngspice gives it, or by 0 A where it has exactly 0 V across it with its own current at 0 A, which 0 V
  across a diode makes; a "real value shown as 0" counts every 0 the page shows for a value whose exact
  value is not 0, split into the page's own 0s and ngspice's). Of 11,500 circuits (yA, gA, rA, pA, yD;
  11,487 ran):
  - 9,221 linear circuits decided by the exact solution: no real value is shown as 0 by the page; ngspice
    gives 10 currents and 5 node voltages of one ladder of rA as 0 whose exact values are below the
    smallest double; no exact 0 is drawn as a number; a resistor is shown as 0 A between voltages written
    differently 3 times (at a rounding boundary, 0.3437 and 0.3438 V; between two values too tiny beside
    the others to be held to 5e−5, 9.99e−21 and 9.987e−21 V; below the smallest double). ngspice's own 0s
    for real values are shown exactly: 746 currents and 28 node voltages; 113 of them sit next to a part
    in series whose tiny current ngspice gives with no correct digit, and at 1,096 nodes the tiny currents
    shown do not add up to 0 within 1e−3: real values ngspice gives with no correct digit, shown as it
    gives them.
  - 1,691 circuits with a diode decided exactly: no real value is shown as 0 by the page, and no exact 0
    is drawn as a number (326 diodes carry exactly 0 A at 0 V). Of the real values ngspice gives as
    exactly 0, the 56 currents and 4 node voltages that no diode's current changes are shown exactly (17
    beside a part in series whose tiny current ngspice gives with no correct digit), and the 24 currents
    and 1 node voltage that a diode's current changes stay 0 (above; before, all 78 currents and 5 node
    voltages stayed 0). At 9 resistors shown as 0 A, both ends are below 2e−20 V, values a diode's current
    changes, which ngspice gives at that noise level and the page writes differently. Decided by the rule,
    as before round 2, these circuits had 49 real currents and 5 real node voltages turned into 0 by the
    rule (the critic of round 2), and 750 exact 0s drawn as currents and 223 as node voltages.
  - 387 circuits whose answers are off, with the warning (43 with a diode): every number is ngspice's;
    ngspice gives 293 real currents and 24 real node voltages as exactly 0, and 164 exact 0s as currents
    (26 above 1 pA, 10 with a power) and 16 as node voltages; the warning names the worst of them, with a
    diode only values no diode's current changes.
  - 188 circuits left to the rule, with no warning: 125 without a diode, past the exact solution's
    limits; 63 with a diode, past those limits, or whose values ngspice gives differently from the exact
    solution (in s2-2 a diode in a loop with 8.2 MΩ and nothing to drive it, which carries 0 A at 0 V,
    conducts 7.2 nA in native ngspice 47 too, 59 mV across it; 4 more with such a diode the checks had
    let through, C9t.10), or whose answers are off only where a diode's current changes them (13, whose
    warning had given exact values worked out from ngspice's diode currents). No real value is turned
    into 0 by the rule (11 are ngspice's own 0s); 217 exact 0s are drawn as currents (14 above 1 pA, 7
    with a power) and 106 as node voltages, as ngspice's numbers show them.
  In the same circuits cd20fe9 showed 1,238 real values as 0 on the exact path alone and drew 984 exact
  0s as currents and 241 as node voltages. describeResults took at most 12 ms of processor time on any of
  them.
- **Its speed.** The exact solution is worked out once per netlist (and kept for its .tf and .dc), on
  the main thread after each run. Each run's checks of ngspice's values get what that work leaves of a
  counted amount, `MAX_WORK`, afresh: a budget kept with the parsed netlist and spent run after run made
  the same text, run again (Run pressed twice, or an undo back to it, which gives the same parsed
  netlist), lose its sweep's decision on the second run and its exact 0s on the third. The count is the
  same on every computer: building the equations and each check of ngspice's values count 1,000 a term
  before they start (a term costs up to about 3 µs with numbers of 4,096 bits); each combination of two
  rows in the elimination counts 2,000, and each entry it writes 16 plus the square of its size in
  64-bit words; the back substitution the same, before it starts; with diodes, the currents Kirchhoff's
  law gives them count as a check. A whole number past 4,096 bits stops it too, in the elimination and
  in the one denominator of an equation's terms or of a check's sum (a node with hundreds of resistors
  of different values has thousands of bits there); at most 150 unknowns, 1,600 parts (past them no
  value is read: reading the values of a 256 kB netlist of 12,000 resistors alone took 40 to 80 ms) and
  16 diodes. Only the elimination was counted before, and 1,000 resistors of prime values side by side,
  which add no unknown, froze the page for 12.9 s (2,000: 90 s of processor time; the critic of round
  2). Measured in processor time on a machine shared with other builds (load average 3 to 10):
  describeResults with annotateLines takes at most 22 ms on any of the 11,500 circuits; 1,000, 1,599 and
  2,000 resistors of prime values side by side 11 to 32 ms, 1,599 of 1 kΩ with a sweep 34 to 41 ms, 150
  of 17 digits at most 5 ms, a 60-part ladder 4 to 8 ms, 16 diodes in a chain each with 60 resistors of
  17 digits 16 to 26 ms; netlists of 256 kB (a mesh of 12,000 resistors, the largest a link opens) 151
  to 216 ms, of which deciding the noise is 41 to 89 ms and the rest the words for 12,000 currents. The
  rule gives a group of 0s back with one look at the group, and looks at a node again only when a 0 at
  it has changed: 10,000 resistors of 1 TΩ written as 0 between the two nodes an E reads take 138 to 162
  ms in all, the rule 38 to 109 ms (one path of 0s at a time, each node balanced again for each of its
  parts, took 16 s). Earlier measurements (174 grids, meshes, ladders and networks of E and G of up to
  146 unknowns): a solve at most 43 ms, between 2.6e−6 and 9.1e−6 ms a unit of work; describeResults 45
  to 81 ms near the limits with .op, a 1001-point .dc and a .tf. Unit tests keep 60 parts under 50 ms;
  the limits, grids of 3-digit values, 1,000 resistors of prime values and 150 of 17 digits under 200
  ms; the rule on those 10,000 resistors under 200 ms; and a 99,999-point sweep under 50 ms. With
  diodes, each checked point of a sweep counts their currents as a check too, and so does the .op's,
  so that both still fit in one run's budget together or neither is decided exactly. Measured after
  the second fix of the critic of round 2 (load average 4 to 8): describeResults took at most 12 ms on
  any of the 11,500 circuits; a sweep of 100,001 points of the H of 1 GΩ with a diode 23 to 54 ms, the
  same without the diode 20 to 74 ms (17 to 44 ms with the code before it: looking through every point
  of a sweep for its largest values, which a point where the circuit makes every value 0 needs, is
  done only when ngspice's values there are not all exactly 0, as a linear circuit's are).
- **Our own netlists.** The words of all 210 netlists we have (the examples, the fixtures, the trap
  and letter corpora, the engine settings' goldens and the channel's episode netlists; 186 of them
  with `.op`), their line notes, sweeps and messages too, are the same, letter for letter, as at
  cd20fe9, and no point of a sweep is drawn differently; so are the cards of every part of the 186, also
  with a crossed-out number from before a change of every resistor by 20 % (633 such readouts): none of
  them has rounding noise that cd20fe9 decided wrongly, a real value ngspice gives as 0, answers far off
  or a diode the rule decided differently. The floors are ngspice's defaults: a netlist's
  `.options abstol` or `vntol` does not move them.
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

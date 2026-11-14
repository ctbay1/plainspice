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
  re-check's corpora and the repository that it models exactly: at most 3.8e−15 for the nodes, 4.4e−11 for the branches;
  no bound, as the last pass found: a 1 nΩ to 10 µΩ wire into 0 V ammeters leaves 1.07e−7 to 1.9e−3, and the
  check now allows 2⁻³⁰ times the spread of the circuit's conductances, see "After the last pass");
  and each current it reports is its own numbers' product to 2⁻⁴⁰ (measured: at most 3.4e−16). In a
  circuit with every kind of part any value 1 ppm off fails one or the other, and so does a .dc
  point's value 1 ppm off (unit tests keep it so); a source is weighed against the circuit's largest
  voltage, so a 1 pV source read as 1 nV in a 9 V circuit passes. Those checks alone passed runs that
  ngspice solved far from the exact answer: a wire far smaller than the resistors around it makes the
  equations ill-conditioned, its huge terms hide what ngspice's values leave of them, and with a
  1e−12 Ω wire in a balanced bridge ngspice gives 4.321 V and 4.374 V where the circuit makes 4.5 V
  (C9s). So ngspice's answers must also be the exact ones: each node voltage and each V, E, H and L
  current whose exact value is not 0 must be within 5e−5 of it, beyond what ngspice's rounding leaves of
  the numbers it is worked out from, 2⁻³⁰ of its own scale (exact.ts `answersAgree`, `answerScales`,
  `ANSWER_FLOOR`): a node's, the sizes of the terms of Kirchhoff's law at it over its conductance, or of
  the own equation of a V, E, H or L there; a current's, the largest current that flows at its nodes (at
  every node a chain of V, E, H and L joins: a chain of 0 V ammeters carries a current fixed at its ends).
  Parts of the circuit that conduct to each other are weighed on their own. A controlled source that reads
  another part adds its gain times the floor of what it reads to the answers its output moves, by how much
  it moves each: one more exact solution for each such source, a unit change of what it makes, gives every
  unknown's change (an H of 1 GΩ multiplies the rounding of the ammeter it reads, all of it at its own
  output). Until the critic of round 4 it added that to every answer of the part its output reaches: an
  open-loop comparator, an E of 1e5 reading a 12 V reference and pulled up by 10 kΩ to the rail that feeds
  the bridge of C9s.4, made every bridge node's floor 2.2 mV, though V1 holds the rail and E1 moves no node
  of the bridge, and ngspice's 4.961 mV for 5.189 mV passed, R5 drawn as 0 A "at the same voltage" between
  tags of 4.961 and 5.023 mV (C9v; in the critic's 600 such generated circuits, 63 of the 385 decided
  exactly drew a rounding-noise 0 beside ngspice's numbers up to 10.5 % off). Until the critic of round 3 the floor was 2⁻³⁰ of the largest exact
  value of its kind anywhere in the circuit, and one huge value hid ngspice's errors everywhere: an
  open-loop E making 1.2 MV beside the bridge of C9s.4 made it 1.1 mV, ngspice's 4.882 mV for 5.189 mV
  passed, and R5 was drawn as 0 A "at the same voltage, 5.189 mV" between tags of 4.882 and 4.965 mV
  (C9u.2); in the corpora a 1 nΩ probe wire on a ladder (ngspice 5.5e−5 off from the wire on, C9u.8), a
  9.9 kV E output beside a 1 pΩ wire and 100 Ω beside 1e15 Ω were hidden the same way. 5e−5 is less
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
  off, far beyond the floor's 1.4e−8 and 1.1e−8 V. Since the critic of round 4 an answer is off only
  where the page shows it: when the page draws it with other digits than its exact value (formatSI, four
  significant digits) and it is beyond 5e−5 of it, or when it is a node at exactly the voltage of another
  (its level on the page) whose numbers ngspice gives are drawn differently, beyond rounding (a 1 nΩ wire
  in a bridge: a2 and m4 drawn 64.62 mV beside b3's 64.63 mV, each within 5e−5 of the exact 64.6255 mV,
  and R6 between them a 0 "at the same voltage", C9v.4). The currents of the R, G and F that ngspice
  reports count too, each beyond what rounding leaves of the numbers it is worked out from (a resistor's
  |v(a)| + |v(b)| over its resistance; a 1 nΩ wire's current, worked out from two voltages a step of a
  double apart, has no digit ngspice can give, however well it solved the circuit): with nodes held only
  to the page's digits, k9401-89's R3 is drawn 2.829 µA beside R4's 2.827 µA, both exactly 2.828 µA. An
  answer drawn with the exact value's digits is not off, however far: C9m fed through a 30 nΩ wire gives V1
  372.4098 µA for 372.4395 µA, 8e−5 of it, drawn "372.4 µA" either way, and it is decided exactly, R7 0 A
  with the note (C9v.3); held to 5e−5, the run was off, the warning (which names only values drawn
  differently) was empty, and the rule drew R7's exact 0 as 6.217e−20 A with nothing said (the critic of
  round 4). Two nodes at exactly one voltage drawn differently within rounding are not off: at 343.75 mV,
  a rounding boundary, ngspice's two numbers a step apart are drawn 343.7 and 343.8 mV with R6 0 A
  between them, and ngspice lost nothing (C9v.5; recorded below). Where the only answers off are
  ngspice's exact 0s, each R, G and F current is held to the currents at its nodes instead (below). With each answer's own floor, of the 11,500 circuits of
  the corpora (below), 61 that the old floor let through give answers farther off (gA 27, rA 6, pA 28,
  where the probe wire is), shown with the warning, or with none where every value off reads the same at
  the page's digits (2); 97 it called off are decided exactly, their answers off only where ngspice gives
  exactly 0, now shown exactly; 7 lose a warning that named only values reading the same; 6 with a diode
  gain one (below). A loop of a 12 V source, 1 kΩ and a source of 2 aA keeps its warning (C9h): ngspice's
  1.735 aA is 13 % from the circuit's 2 aA, and no other current at its nodes is larger.
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
  for a real current. Where ngspice's exact 0s are the only answers off, every other value (the currents
  of the R, G and F too) being the exact one, the run is this circuit's, solved to the page's digits, and is
  decided exactly with those values shown exactly: a 1 aA loop that ngspice gives as 0 in V1 and R1 showed
  the warning beside "V1: no current", "R1: no current" and "I1: 1 aA" (C9u.6; the critic of round 3).
  Where ngspice gives another current there with no correct digit (R1 of 150 Ω at 5 V, 5.921 aA the other
  way for 3 aA), the exact value would break Kirchhoff's law beside it, and the warning stays. A value below the smallest double (about 4.9e−324, the far end of a long ladder,
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
  half of top). It also names a value whose diode terms, with the currents worked out from ngspice's
  numbers, are below 5e−5 of it and a thousandth of its gap from ngspice's: those currents cannot move
  its digits (C9u.7: a diode's 167 fA moves a bridge's node by 5 nV where ngspice is 0.26 mV off; leaving
  every such value out left ngspice's numbers, 48,000 times off, with no warning, the critic of round 3).
  When every value that is off depends on a diode's current more than that there is no warning, and the
  rule decides, held by the exact solution as above. A value whose exact and given numbers read the same
  at the page's digits (24 nA where ngspice gives 24.003 nA) is not named; and since the critic of round 4
  a run is off only by a value drawn differently (above), so the warning names at least one, unless every
  value off depends on a diode's current.
- **What the page shows for a value that is noise of a 0.** A current: no arrow, no "delivers" or
  "absorbs", "0 A" at the end of its line and "no current flows" in speech; a node voltage: 0 V. A
  part's card says 0 V across it when its two ends are at the same voltage, and so does the crossed-out
  number from before a change, with no "node b is higher" (it said "0 A through" next to "888.2 aV
  across"). A note in the Numbers panel says what ngspice gave and why the true value is 0: for one
  part its own reason ("the two ends of R5, node a and node b, are at the same voltage, 4.5 V"), for
  several the kinds of reason, each true of every value it names, and it ends "Solved exactly, with
  fractions, from the netlist's values, the circuit makes it exactly 0, so PlainSpice shows 0 A". With
  diodes it says what the 0 needs of them: ", whatever current its diodes carry" where it holds for any,
  or "(D1 has 0 V across it, so it carries no current)", "(D1 and D2, placed alike in the circuit, carry
  the same current)" (the critic of round 3: "from the netlist's values and its diodes' currents" said the
  opposite of how the 0 was found, and "whatever current" alone would be false at rest). Its lists stop at 4 values when there
  are more than 5 ("… and 3991 more currents, each in the tables above"), never "and 1 more".
  `CurrentWords.noise` and `NodeVoltageWords.noise` keep ngspice's values for the panel's ngspice
  columns.
- **.tf and .dc of a circuit solved exactly are decided the same way** (C9p; a real ratio ngspice gives as 0, and
  one it gives off, since the last pass, C9w.10 to C9w.12). Every value is a + b·s in
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
  .dc are decided exactly together or not at all: the .op is decided exactly only beside a sweep that is
  too, and the sweep is shown decided only beside an .op that is (an .op decided exactly beside a sweep
  left as ngspice gives it said 0 V where the sweep's words, at the same point, said ngspice's −931.3 pV;
  the critic of round 3 found it again beside sweeps of the temperature, of a resistor and of two
  sources, and beside an .op the rule decided while its sweep was decided exactly; beside an .op the rule decides,
  the sweep's points at the .op's own state show the .op's 0s since the last pass, below). Their checks share the
  run's budget (below), the .op's check keeping what the sweep's points need. A sweep of the temperature
  is decided exactly: no part modelled exactly changes with it (a resistor's temperature coefficients are
  settings, which leave the netlist to the rule), so each point is the .op's circuit (C9u.4). A sweep of a
  resistor or of two sources is not followed (a resistor changes the circuit at each point; the second
  source's values are not in the results), but its points at the .op's own state are: where every swept
  part is at its netlist value (ngspice sets a resistor to the sweep's value and works its conductance out
  as in the .op, dctrcurv.c; the outer source of two is at its start plus its step added once for each run
  of the inner one, in doubles, as ngspice adds it), the circuit is the .op's, so the .op is decided
  exactly and each such point is checked as an operating point and shown with the .op's 0s and exact
  values (C9u.5, C9v.7, C9v.8; the note names the point, "at R1 = 15 kΩ", "at V1 = 9 V, V2 = 1 V"). With
  no such point nothing in the sweep is marked; a point there that is not this circuit's to the page's
  digits leaves both to the rule. Round 3 left the .op beside such a sweep to the rule, which drew C9m's
  exact 0 as 6.217e−20 A with an arrow and no note (the critic of round 4). What this gives up: the other
  points keep ngspice's numbers, though some are exact 0s too (C9u.5's R5 at 1.5 and 2 kΩ, the bridge
  balanced whatever R5 is, drawn with ngspice's −5.921e−19 and −4.441e−19 A). A sweep of a
  circuit with diodes is decided as its operating point is (below). A .tf of a circuit with a diode (its
  ratio depends on the diode's conductance at the operating point) and a .tran run are shown as ngspice
  gives them: a .tran's values come from ngspice's own time steps and their error, not from one solution
  PlainSpice can repeat exactly.
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
  each of its values there is held to 2⁻³⁰ of the largest it gives of that kind at the sweep's checked
  points, or of ngspice's own tolerances, vntol and abstol, the larger (C9t.9), and that point counts in
  the run's budget as the check it stands for. A swept current source is at each point's value when the
  diodes' currents are worked out there (until the critic of round 4 at its netlist value, so a sweep of a
  current source into a diode was decided at no point but that one, and its .op went to the rule with it,
  C9v.2). An operating point at rest is held the same way (C9u: the
  .op of a diode's I-V sweep from 0 V drew 7.3e−32 A with arrows beside a sweep note calling the same
  values exact 0s; 289 of 296 diode circuits with every source at 0 are now decided exactly, where the rule
  drew 5,056 exact 0s as currents). A circuit where no current flows but a source holds a voltage is
  checked as any other first, and where its equations hold nothing but leftovers, so that the check that
  ngspice simulated this circuit weighs them against themselves (a 5 V source charging only a capacitor
  beside the diode), as one at rest, each held voltage within 2⁻³⁰ of its exact value (C9v.6; the critic
  of round 4). Checked as one at rest first, a circuit whose held voltages sit across resistors fell to
  the rule: H1 reading V1's rounding beside 24 V gives 1e−8 V, far above what a circuit at rest leaves
  (42 exact 0s drawn with arrows in 5 runs of one corpus). Every point where a diode may carry 0 A is
  checked, not only the five.
  Diodes placed alike carry the same current (C9u.3): the same model line, their own currents (on no loop
  of diodes), the same voltage across each with every diode at 0 A, and the same voltage across each from
  each class's currents together (an equitable partition of the diodes' own equations, refined until it
  holds, found together with the diodes that carry 0 A); then the circuit's equations have a solution with
  their currents equal, and ngspice's numbers must show it (the currents Kirchhoff's law gives the two
  within 2⁻³⁰ of the largest sum of a node's terms, or they are taken one by one, as for a latch that
  settles unevenly), and a value is 0 when it is 0 in the operating point and in each class's summed
  solution. The link between two equal diode arms was drawn with ngspice's 1.89e−19 A (the critic of round
  3: 244 exact 0s drawn as currents in 188 symmetric networks with diodes, 150 at cd20fe9). A run's .op and
  its sweep must take diodes placed alike the same way, except where no diodes sit alike in one of them (at
  rest none is free): two equal arms at rest in the .op beside their sweep from 0 V were left to the rule
  for the mismatch, their leftovers drawn with arrows (as at cd20fe9). So
  the H of 1 GΩ with a diode shows out 0 V and Rl 0 A (C9o.4), the fed E carries its 5 mA at exactly 0 V
  with no power (C9t), and a real −433.7 fV behind a bridge 1e−13 off balance is shown (C9t.3). A circuit
  with a node whose only DC path goes through diodes (its equations have no single answer with the diodes
  taken as free currents), or with more than 16 diodes, is left to the rule. The direction left diodes to
  the rule; this decides them exactly where the rule could not, measured below. What it cannot know is a
  value that is 0 only because two diodes carry currents in some other relation, or two diodes alike in
  their circuit but written with different model lines: it is taken as real and shown as ngspice gives it.
- **Other circuits keep a rule** (a transistor, a switch, a subcircuit, a B source, a part with settings
  other than m=1, .param, two temperatures and .options lines other than the temperature (a .temp line and
  a DC value beside a transient function are modelled since the last pass, below), more than 150 unknowns,
  1,600 parts or 16 diodes, or more work
  than the limit below; and where ngspice's answers are farther off, above). It decides from ngspice's
  numbers alone, and each 0 it writes must agree with the numbers the page shows beside it: a resistor or
  capacitor is 0 only where its two ends are within 4 steps of a double, never as "the only current left
  at a node", and a resistor's current that ngspice gives as exactly 0 proves nothing and joins nothing
  (rounding hides 7.3e−25 V across a 1 µΩ wire at 732 nV, C9n), but where it is a source's only partner
  at a node (since the last pass, below); an F that copies a 0 and a G that reads
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
  ngspice's numbers back, the whole group at once, until nothing changes (C9o.5: with a line it does not model exactly, the E
  of 10⁶ reading the bridge of C9 showed R5 as 0 A, "its two ends at the same voltage", beside out's
  −931.3 pV, which E1 makes from that voltage; the critic of round 2). A chain of controlled sources (an
  E reading what another E makes), and a source whose value is an expression (value=, a B source), are
  not followed. And it writes no node voltage as 0 V: no guard could tell a node's real 433.7 fV, behind
  a bridge 1e−13 off balance, from noise (the critic of round 2 found 5 real node voltages and 49 real
  currents that the rule's chain turned into 0 in the corpora's circuits with a diode). What that gives
  up: an exact 0 node voltage is drawn with ngspice's noise, and so is what follows from it; with a
  transistor or a line it does not model exactly beside it, the H of 1 GΩ shows out −193.5 nV and Rl and H1 193.5 pA, H1 with
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
  After the critic of round 3, judged again (mirrored diodes given their mean current, since the circuit's
  one solution has them equal; quiet diodes found from all those at 0 V down), on those 11,500 circuits
  and the critic's 4,292 (1,500, 1,000 and 600 generated, 600 mirror-symmetric networks, 296 circuits with
  diodes and the same 296 with every source at 0): no real value is shown as 0 by the page on any path,
  and no exact 0 is drawn as a number on the exact path. The 188 symmetric networks with diodes went from
  354 exact 0s drawn as currents (66 with a power) and 66 as node voltages to none; 187 are decided
  exactly. The 296 at rest went from 5,056 exact 0s drawn as currents and 2,800 as node voltages to none
  on the exact path, 289 decided exactly; the 7 left to the rule draw 435 and 225, as ngspice gives them.
  Of 749 .op runs beside a sweep of their own V1 to its value (the critic's diode and symmetric circuits),
  none shows a value as 0 in one and as a number in the other because of a 0 PlainSpice made; the 15 that
  differ are ngspice's own, a value it gives as exactly 0 in one run and as a number in the other.
  After the critic of round 4, judged again on those and the critic's 5,400 (2,000, 1,000 and 1,000
  generated, 800 mirror-symmetric networks, and 600 bridges each beside a controlled source of a high gain
  reading another part, with the same 600 without it): 23,936 runs, base 002c616 against this build. No
  real value is shown as 0 by the page on any path, and no exact 0 is drawn as a number on the exact path
  (16,814 linear and 3,405 diode runs). A resistor is shown as 0 A between voltages written differently 6
  times on the exact path (54 before: 45 of them the critic's carried floor, 3 straddles beyond rounding):
  4 below the smallest double and 2 at an exact rounding boundary (C9v.5; one of them only as Python's
  rounding writes 2.0625). The 600 bridges beside a controlled source: 316 decided exactly (385 before),
  of which 13 draw a 0 beside a node more than 5e−5 from its exact value, each node drawn with its exact
  value's digits (63 before, up to 10.5 % off and drawn so); 284 with the warning (204), none left to the
  rule silently (11). Elsewhere a controlled source's own output can still be far from its exact value and
  drawn so, its gain lifting ngspice's rounding of what it reads (11 runs of gA and 2 of g9501, as before:
  an H's −251.4 nV for −4.164 nV); its floor carries that rounding, with no warning, as for C9o's H.
  Linear runs within the exact solution's limits that the rule decides with no warning: 0
  (28 before, 15 exact 0s drawn as currents). That held for those corpora only: the last pass found 131 of
  1,500 such runs (a tiny wire into 0 V ammeters, a .save line), now none (see "After the last pass"). The rule draws 571 exact 0s as currents (1,242 before) and 240
  as node voltages (622), the imprecise path 1,222 and 14 beside its warning (1,114 and 14). 2 runs with a
  diode go from the exact path to the rule with no warning, their every off value one a diode's current
  changes (their pages are the same: no value of either is noise); 75 go the other way (circuits at rest
  beside a source that drives nothing, diodes placed alike at rest beside their sweep, a swept current
  source), and so do 24 linear runs (most of them the silent runs above). 107 linear
  runs go from the exact path to the warning, and 39 the other way (off only where the page draws the
  exact digits).
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
  done only when ngspice's values there are not all exactly 0, as a linear circuit's are). After the
  critic of round 3 (load 4 to 7): describeResults with annotateLines took at most 18.2 ms on any of the
  17,936 runs of the corpora; a 60-part bridge with 53 ammeters and a 99,999-point sweep, every current
  saved, 41 ms (least of five; 142 to 191 ms before, when the note listed every point of every series that
  is noise at every point, now marked once and counted in one pass), and 16 diodes swept from 0 V over
  99,999 points 12 ms (98 to 174 ms, when a point at rest looked through every value of the sweep); unit
  tests keep them under 100 and 50 ms. After the critic of round 4 (load 5 to 14): describeResults with
  annotateLines took at most 25.6 ms on any of the 23,936 runs above (the first run of a corpus, which
  compiles the code). Each controlled source that reads another part adds one solution to the netlist's
  exact solve: a chain of 10 such sources (22 parts) takes 1.5 ms, of 30 (62 parts) 7.6 ms (2.1 ms
  before); a chain of 70 (142 parts, 107 unknowns) no longer fits in the counted work and is left to the
  rule, where it was decided exactly.
- **Our own netlists.** The words of all 210 netlists we have (the examples, the fixtures, the trap
  and letter corpora, the engine settings' goldens and the channel's episode netlists; 186 of them
  with `.op`), their line notes, sweeps and messages too, are the same, letter for letter, as at
  cd20fe9 (checked again after the critics of rounds 3 and 4), and no point of a sweep is drawn differently; so are the cards of every part of the 186, also
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

## After the last pass (13 November 2026)

- **The notes name a node as the rest of the page does** (code C3-3, facts F1 and its skeptic). The
  rounding-noise note, the note for real values ngspice gave as 0 and the warning that ngspice's answers
  are off wrote "node" before the node's key: "node node1 is at 4.5 V, where ngspice gives 4.321 V",
  "node node9's voltage", "node ÇikiŞ", and a hidden character left unnamed. They now say each node as
  the summary and the currents do (`nodeIn`, `said`, the name as first written): "node1 is at 4.5 V, where
  ngspice gives 4.321 V", "node ÇIKIŞ", "node out (written with a zero-width space in it)". The title of
  the second note says "The voltage at node9 is not 0, though ngspice gave 0": "node9's voltage" read
  "Node9's" at a sentence's start, and put a possessive after "(written with a zero-width space in it)".
  The notes' reasons name their nodes the same way ("the two ends of R5, node ÇIKIŞ and node b", where they
  said "node ÇikiŞ"). Decisions 0016 and 0017 no longer list the rounding-noise note as a gap.
- **"1 times 10 to the power minus 29 amps flow"** (regress-4): the verb was chosen from the first word of
  the spoken value, so the exact 1e-29 A of C9n.3 "flows". It is singular only for a singular unit word,
  "1 amp flows", "1 milliamp flows".
- **A transistor's currents are named by their terminals** (transistor-currents-same-name; C8b). A sweep's
  words said "the current in Q1" for each of its four currents. ngspice's own `devhelp` describes each
  vector savecurrents gives (C8b, native 47 and 42): a BJT's ic, ib, ie and is are its collector, base,
  emitter and substrate currents, a MOSFET's id, ig, is and ib its drain, gate, source and bulk currents, a
  JFET's igd "Current G-D". These are the model's own quantities by devhelp's names, not always the current
  through the pin, and they keep no one direction ([is] flows out of the part at the substrate, [ie] is
  −(ic + ib + is): C8b's ammeters on every terminal, since the critic of the last pass's fixes). The words say
  "the collector current of Q1 is 8.171 milliamps", "the gate-to-drain current of J1", with no direction; any
  other current keeps "the current in …".
- **The work of a sweep's decision is bounded** (sweep-points-unbounded-time). Deciding a sweep reads each
  of its series a few times, so its work grew with its points times its results, with no cap: a beginner's
  ".dc I1 0 2A 0.5A" (2A is 2 attoamps) runs 444,094 points, to 222 fA (native 47 and 42 alike), and a
  51-part ladder's 444,094 points of 78 results took 66 to 77 ms of processor time at c520a49 (load 6;
  the reviewer: 74 to 84 ms, and 303 to 327 ms at 2.2 million points). A sweep of more than
  `SWEEP_VALUES`, 2,000,000 values (points × results), is now left as ngspice gives it, except at its
  points at the .op's own state, which show the .op's 0s and exact values as for a sweep of a resistor
  (`opStateSweep`; a sweep of the temperature alone at the .op's 27 °C), and a note says so: "It has
  444094 points of 11 results, more values than PlainSpice looks through for rounding noise (2000000 in
  all). So at its points a value the circuit makes exactly 0 may show ngspice's rounding noise, and a tiny
  value ngspice's arithmetic rounded to 0 shows 0[, except at V1 = 9 V, the operating point's own state,
  where the sweep shows what the operating point shows]." (Since the critic of round 2 of these fixes, a point found
  within the step's rounding of the .op's value is said "ngspice's point nearest the operating point's 9 V,
  8.999999999999853 V (its 10 mV step added up in doubles)", and is one only where it shows what the .op shows: below.)
  Measured (thread CPU, load 5 to 6): the ladder
  4.0 to 8.0 ms, the beginner's sweep on the bridge of C9 3.4 to 5.8 ms (10.9 to 17.4 ms before), 888,187
  points 1.5 to 9.5 ms; the 53-ammeter bridge of the critic of round 3 just under the cap (17,000 points
  of 115 results) is decided at every point in 9.9 ms (least of five), and over it in 0.6 to 1.6 ms.
  What it gives up: that bridge swept over 99,999 points, decided at every point since round 3 (41 ms),
  now keeps ngspice's numbers there, with the note; the .op beside it is still decided exactly. The Plot
  panel still copies a series that has points marked, as it draws it.
- **An attoamp is never drawn as an answer with nothing said** (regress-1; C9w). The noise lane of the
  first re-check made the rule take no resistor's 0 as proof (C9n), so a balanced bridge's 0 V ammeter in
  series with R5, which ngspice gives exactly 0 A, was drawn "Vm measures 2.168e-19 A" beside "R5: no
  current", with no note, wherever the rule decided: with a .param line, a .temp line, a .control block, a DC
  value beside a SIN or a PULSE, or m=1 (13 of the 23 rounding-noise facts drew such noise with a .temp line).
  Three changes:
  - Lines that leave the operating point as it is are modelled exactly, still behind the check that ngspice
    simulated this circuit: a .temp line with one temperature and `.options temp` (no part modelled exactly
    depends on the temperature with no settings; a diode's current, which does, is left free), a DC value
    written beside a transient function (P3b, P4c), and m=1 on an R, C or L. Native 47 and 42 give every
    vector the same double with each, alone and together, in the bridge and in a circuit of every kind
    PlainSpice models (C9w). With a .temp line, none of the 63 C9 facts that have an .op draws an exact 0 as
    a number with no note (20 did at c520a49). A source with a function and no DC value (its value at time 0, P17), m
    other than 1, two temperatures and .param stay with the rule: a .param value is written into the line by
    ngspice's own expression reader, whose numbers this record has not checked. This record also said that a .control
    block that only runs makes ngspice write the operating point twice, with other vectors: that is wrong (the critic
    of the last pass's fixes; C9x.6): ngspice runs the analyses twice but writes one results file, the very doubles of
    the netlist without the block, and such a block is now modelled exactly (below).
    The tests that reached the rule with `.temp 27` now use `.options gmin=1e-12`, ngspice's own gmin (the
    same doubles), as do facts C9o.5 and C9r.3.
  - The rule takes a source whose only partner at a node is a resistor that ngspice gives exactly 0 A, its two
    ends one double, as carrying 0: the page shows 0 V across that resistor and no current through it (as
    b060bc8 did, C9w.2). Where the source's current is real, the next node gives it back: a real 0.73 aA after
    a 1 µΩ wire that ngspice gives 0 A reaches a 1 TΩ meter, whose current is shown, so Kirchhoff's law at
    that node gives the ammeter its number back (C9w.3).
  - The rule says which tiny values it can prove neither real nor noise: a current below abstol and a node
    voltage below vntol that it leaves as ngspice gives them get a note, "Vm's current may be rounding noise:
    ngspice gave Vm -1.935098e-16 A. It is below 1 pA, … so it may be rounding noise, what its arithmetic
    leaves of a value that is exactly 0, or a real value that small. PlainSpice cannot tell which from ngspice's
    numbers alone, so it shows it as ngspice gives it." Proven real here is only a current of
    at least abstol, a current source's own, a resistor's or a G's with a real voltage across or read, what
    an F copies of one, and the last current at a node whose proven currents do not add up to 0; the rule's
    other reasons to keep a number (what an H makes, a part beside a transistor, a share of a node's tiny
    difference) keep it, but prove nothing. A node voltage is proven real by a resistor to ground with a
    proven current, a voltage source that holds it, or the very double of such a node. On the rule path
    (`.options gmin=1e-12` added to the 63 C9 facts that have an .op), 20 drew an exact 0 as a number with
    no note at c520a49; 5 do now, each the recorded give-up above: what a gain lifts above 1 pA (the H of
    1 GΩ's 193.5 pA in H1 and Rl, the E of 10⁶'s 9.3 pA) is real by ngspice's tolerance, and so is the node
    it drives (out's −193.5 nV), and the rule cannot tell; the note names their attoamps (R5, Vm). Our own netlists:
    the words of the 352 netlists of the repository and the facts' golden tests are the same as at c520a49
    but for the meant changes (the transistor's currents, the 1 nV source's verb, and C9o.5's and C9r.3's
    new notes).
- **A number the page draws is an answer only with its exact digits** (carrier-zero-beside-own-noise; C9w.4,
  C9w.7). The exact path took a value drawn with other digits than its exact value as off only where it was
  more than ANSWER_GAP from it beyond what rounding leaves of the numbers it is worked out from (its floor). A
  floor that large means ngspice cannot give the value's digits, yet the page drew them: in g520d a G of 10⁶ S
  reads a 1e15 Ω resistor whose two ends ngspice gives a step apart, so G1 carries 444.1 pA where the circuit
  makes it 0, and lifts node g to 1.465 mV for 820 µV; the page drew "G1: no current" beside R3's 1.786 nA out of
  g and I1's 1 nA in, with no warning (i9751-450: g4 520.1 V for 715.3 fV, G1 727 µA). A value is now off when
  the page draws it with other digits and it is more than ANSWER_GAP from its exact value, whatever its floor
  (two nodes at one voltage drawn differently still need a gap beyond rounding: C9v.5's boundary stays recorded). g520d
  is shown as ngspice gives it, with the warning "G1 carries no current, where ngspice gives 444.1 pA; R1 …; node g
  is at 820 µV, where ngspice gives 1.465 mV; and R3 carries 1 nA, where ngspice gives 1.786 nA". This also settles
  what round 4 left above, a controlled source's output drawn far from its exact value, its floor carrying the
  rounding of what it reads, with no warning (C9t.3's h5, −433.7 fV for −425.9 fV): where the exact solution
  decides, it now gets the warning (gA's s6-426, the H's −251.4 nV, is past the exact solution's work since
  round 4 and goes to the rule, as at c520a49). A sweep's checked point
  is judged the same way: where one is off, the sweep is shown as ngspice gives it (but at the .op's own state
  when the .op is decided exactly), with a warning, "Some of ngspice's answers in the DC sweep are off": "…, at
  V1 = 1.125 V, R3 carries 340.6 pA, where ngspice gives 433.7 pA. … PlainSpice shows the sweep as ngspice gives
  it, so its numbers may not agree with each other." (C9w.7; g520d swept over I1: v(g) 1.953 mV for 1.64 mV).
  With diodes, a value whose exact value hangs on a diode's current, which only ngspice's numbers give, is off
  only beyond its floor, as before, and the warning names only values whose digits are known (s9701-47: a
  diode's current 1e−4 off left such values drawn with other digits, and a warning could name none). Such a run
  is decided by the rule beside the exact solution with no warning, and its tiny values keep the rule's note
  that they may be rounding noise, but those the exact solution shows real whatever the diodes carry, and those a
  warning names (C9w.8: until now that path dropped the note, and "V2 measures 510 fA" was drawn with nothing
  said). What it gives up: many more runs carry the warning. Of the critic's 3,000 bridges beside controlled
  sources of high gain (gA), 2,270 are decided exactly (2,732 at c520a49), 642 with the warning (176), 16 with
  diodes by the rule with no warning (20); of the generated g9701, 1,139 exactly (1,363), 327 with the warning
  (99), 12 with diodes by the rule with no warning (16). Open: in one of those 12 (s9701-1341, as at c520a49
  and b060bc8), a 1 nΩ resistor whose ends ngspice gives a step apart is drawn 3.553 µA in series with a 1e14 Ω
  resistor's 3.027e−19 A, with no warning: every value there hangs on the diode's current.
- **ngspice's own rounding no longer sends a run to the rule unsaid** (silent-rule-same-circuit-check; C9w.5,
  C9w.6, C9w.9). Two ways in led to the rule with no warning and no exact solution beside it. (1) What
  ngspice's arithmetic leaves of the equations grows with how far apart the circuit's conductances are: a 1 nΩ
  to 10 µΩ wire into two 0 V ammeters in series left 1.07e−7, 3.3e−5 and 1.9e−3 of the equations' sizes (the
  skeptic of the last pass), far beyond 2⁻³⁰, and C9m fed that way drew R7's exact 0 as 5.329e−20 A; a 1 nΩ wire
  into two ammeters drew "Vm1 measures 10.97 mA" beside the wire's 10.98 mA. The check now allows 2⁻³⁰ times
  that spread (the largest conductance of an R or a G over the smallest; `conductanceSpread`); the products of
  the R, F, G and I keep their own share. Such a run is then judged by the page's digits: C9m through the 1 µΩ
  wire has every answer drawn with its exact digits, so it is decided exactly, R7 0 A with the note (C9w.5);
  the 1 nΩ wire into two ammeters is shown as ngspice gives it, with the warning "V1 carries 10.98 mA, where
  ngspice gives 10.97 mA; Vm1 …" (C9w.9). What it gives up: where conductances are 2³⁰ or more apart, the check
  that these are this circuit's numbers rests on the products and the names; a run of another circuit there
  is judged by the page's digits and shown as ngspice gives it, with the warning, which then blames ngspice's
  rounding (the unit tests' 1 ppm-off runs, of a bridge whose spread is 2, still fail the check). (2) A .save
  line that leaves values out: the values ngspice gives are judged by the page's digits with no same-circuit
  check, which needs every equation's values (C9m saving v(n3), v(n5) and R7's current: R7 0 A with the note,
  where the rule drew 6.217e−20 A; C9w.6). With diodes, whose currents need every value, such a run goes to the
  rule; a node missing with no .save line is still not this circuit. The corpus: of i9751's 1,500, 131 were
  decided by the rule with no warning within the exact solution's limits at c520a49, none now (690 exactly,
  775 before; 769 with the warning, 553). "Linear runs within the exact solution's limits that the rule decides
  with no warning: 0" (after round 4, above) held for those corpora only; ngspice's leftovers of 3.8e−15 and
  4.4e−11 are what that set of netlists measured, not a bound. And "none now" held for i9751 only: an op-amp
  modelled as an E of 1e9 to 1e15 still went to the rule with nothing said (the critic of these fixes: 12 of 300
  random op-amp circuits; out 9.5 V for 9.15 V); the check now counts what the circuit amplifies too, and a run it
  still cannot check gets a note (below).
- **The .tf ratio is judged as the .op beside it is** (tf-lost-ratio-contradiction; C9w.10 to C9w.12). A ratio
  ngspice gives as exactly 0 was never compared with the exact one, nor was a ratio other than 0: C9n.5 with ".tf
  v(d2,p3) V1" read "0 V/V" beside R3's card, "V(d2) − V(p3) = 4.541e-19 V", and a bridge read through a chain
  showed ngspice's 1.11e−16 V/V for −2.656e−20 V/V with nothing said. Now a real ratio ngspice gives as exactly 0
  is shown as the exact one where an .op beside it (with none, a sweep) is decided exactly, with a note, the
  Numbers panel keeping ngspice's 0 in its own column (`given`, as for the .op's lost values); with nothing beside
  it decided exactly (a .tf alone, an .op whose answers are off), ngspice's 0 stays, with the warning "ngspice's
  transfer function is off", which names the exact ratio; and a ratio drawn with other digits than the exact one,
  more than ANSWER_GAP from it, gets that warning too. Its input and output resistances must still be the exact
  ones to within 5e−5, a ratio below the smallest double stays ngspice's, and a circuit with a diode keeps its
  ratio. NumbersPanel's `tfRows` takes ngspice's value from `given` before `noise` (a two-line change outside the
  noise lane's files).
- **Beside an .op the rule decides, the sweep says what the .op says at the .op's own state** (rule-op-vs-sweep-tf;
  C9w.13, C9w.14). The rule's 0s were the .op's alone: C9 with a .param line or a transistor showed R5 "0 A", with
  the note, beside "At V1 = 9 V: … i(@r5[i]) = −8.882e-19 A" and a Plot panel that fell to −8.882e-19 A at 9 V
  (the sentence that recorded it was dropped in round 4). Now, beside such an .op, the sweep's points at the .op's
  own state (one source at its netlist value, where the netlist writes it as a number since the integration check, below;
  a resistor at its own, two sources at theirs; found from the netlist's parts, as the rule path has no exact model) show a current the .op shows as 0 as 0 too, where ngspice
  gives there the very number the .op's 0 stands for, or the rule, run on the point's own values, writes it as 0
  (a transistor's isolated nodes differ there by a few steps of a double); a note says so ("ngspice gave
  i(@r5[i]) -8.881784e-19 A at V1 = 9 V. At V1 = 9 V, the operating point's own state, ngspice gives it the very
  number the operating point shows as 0, as the operating point's note says. So PlainSpice shows 0 there too, in these
  words and in the Plot panel; at the other points the sweep is as ngspice gives it."; it said "where ngspice gives the
  operating point's numbers" until the critic of round 2 of these fixes, which beside a transistor need not hold). The other
  points keep ngspice's numbers, as before. Measured on the generated r9731 and a9721 (rule-path runs with an .op
  and a .dc whose sweep, at a point with all the .op's node voltages, shows a number the .op shows as 0): 36 runs
  (66 values) and 1 at c520a49, none now. What stays: the .tf beside such an .op keeps ngspice's ratio
  (v(a,b)/V1 = −5.551e−17 V/V beside R5's 0): the ratio is a slope, which the rule cannot decide from the .op's
  numbers (with a transistor it depends on its small-signal model), and it says how the voltage changes, not
  what it is; since the critic of these fixes, with a note that it may be rounding noise (below). The point at the
  .op's state was found only where ngspice's x was its netlist value bit for bit, which most decimal steps never reach
  (below).
- **Our own netlists after the last pass.** Of the 366 netlists of the repository and the facts' golden tests, 23
  give other words than c520a49's code: the new facts (C8b, C9w to C9w.14) and the meant changes to older ones. C9l's
  2.696 fA through R5 and C9u.7's R7 now carry the warning (each drawn with other digits than the exact value);
  C9t.3's h5 and C9t.7's R3 too (their texts say so); C9o.5, C9r.3 and C9u.7 add the note for tiny values the rule
  cannot tell from noise; C9n.3's 1e−29 A "flow"; A24, with a .save line, is decided exactly, so its node's level
  is counted with the node .save leaves out (the same words).
- **After the critic of the last pass's fixes: the check that ngspice simulated this circuit counts what it amplifies,
  and a run it still cannot check is said to be so** (C1; C9x, C9x.2, C9x.3). An op-amp modelled as an E of high gain:
  ngspice's arithmetic leaves a step of a double at the E's inputs, which its gain lifts at the output, and its numbers
  left 9.2e−3, 1.5e−5 and 2.4e−8 of the equations' sizes for E of 1e15, 1e12 and 1e9 (each about 1e−17 of its gain),
  past what the spread of the conductances allowed, so the rule decided with nothing said: node out 9.5 V for 9.15 V,
  R1 15 mA in series with R2's 15.9 mA, and a balanced amplifier's exact 0 V drawn −476.8 nV with "E1 delivers
  119.2 pW". The check's allowance is now RESIDUAL_SHARE times the conductances' spread times what the E, F and H
  amplify (`amplification`: the product of the E and F gains above 1 and of each H's transresistance times the largest
  conductance; a G is a conductance, which the spread counts), and such runs are judged by the page's digits: the
  warning names 9.15 V and −1 V, and the balanced amplifier is 0 V with the note. Of the critic's 300 random op-amps,
  31 failed the check before and none now; 12 have other words (the warning, or 0 V with the note), as the critic's
  trial found; none of the other corpora changes for this. A spread past the largest double (1e−12 Ω beside 1e300 Ω)
  made the allowance infinite and the check threw, so the page lost its words: an allowance of 1 or more now holds
  whatever is left (no equation's sum is larger than the sum of its terms' sizes). Where ngspice's numbers agree with
  their own products but still leave more of the equations than that allowance, PlainSpice cannot tell whether
  ngspice lost its digits or reads the netlist otherwise: S28's "+ 3" after .end makes ngspice's R1 3 Ω, and treating
  that as lost digits would say "node n1 is at 2 V, where ngspice gives 3 V", which is false. Such a run is decided by
  the rule, as another circuit's, and a note says that ngspice's numbers could not be checked (`unchecked`,
  "PlainSpice could not check ngspice's numbers"; a sweep's checked point likewise); it was the rule with nothing said.
  The skeptic of the last pass proposed taking such runs as ngspice's lost digits, with the warning; S28 shows why the
  note says only what is known. With diodes, whose currents ngspice settles to its tolerances only, such leftovers say
  neither (z9771-103, a circuit at rest beside a diode), and the rule decides with its own notes, as before. What stays:
  where conductances or gains make the allowance large, a run of another circuit that agrees with its products passes
  the check and is judged by the page's digits. This record said no such input was known: the critic of round 2 of
  these fixes found S28 beside an op-amp of 1e6, whose gain widened the whole circuit's allowance (below; C9y.5).
- **A sweep's point at the .op's own state is found within what ngspice's adding up of the step leaves** (C2, C3;
  C9x.4, C9w.7). ngspice adds a sweep's step once a point, in doubles, so ".dc V1 0 9 0.01" ends a few steps of a
  double from 9 V (8.999999999999853; the critic found the same for steps of 0.02, 0.05, 0.09 and 0.15), which the
  page names "V1 = 9 V"; the .op's state was found
  only bit for bit, so beside an .op the rule decides (a .param line, a transistor, a .control block) the sweep still
  said "i(@r5[i]) = −8.882e-19 A" there beside "R5: no current". Each run of the swept source now takes the point
  nearest its netlist value, within a few steps of a double for each point added and within a quarter of the step,
  never its neighbour. Beside the rule's .op, that point is decided by the rule on its own values, as before; on the
  exact path, a point the exact solution follows (one source, no diode whose current is free) is judged at its own x,
  a + b·x, as every point of a decided sweep is, and a temperature point is the .op's own circuit (no part modelled
  exactly follows the temperature). So C9w.7's last point, 1.5000000000000846 V, shows R3's exact 454.1 pA beside the
  .op's 454.1 pA, where it showed ngspice's 0 A (a9721-747's and r9731-747's L1 likewise). Elsewhere (a sweep of a
  resistor or of two sources, with diodes) the point must still be the netlist's value bit for bit. Measured: sweeps
  whose .op's state is now found, where it was not, a9721 5, r9731 5, d9761 4 (a9761-898's I1 = 1 aA point of 888,183,
  past the size cap, now shows R7's exact value); their warnings and size notes now say "but at V1 = 3.3 V, the
  operating point's own state".
- **A .tf ratio the rule cannot judge gets a note where the .op shows its output as 0** (C2; C9x.5). Beside an .op the
  rule decides, the .tf of C9's bridge beside a transistor, v(a,b)/V1 = −5.551e−17 V/V, sat beside "the two ends of R5,
  node a and node b, are at the same voltage" with nothing said. A ratio is a slope, which the rule cannot decide, so
  it stays ngspice's; where the .op beside it shows the output as 0 (its two nodes at one level, its node at ground's,
  its ammeter's current as none) or says the output's own values may be noise, and the ratio is less than
  RESIDUAL_SHARE of what the input makes of itself in the output's unit (a volt for each volt; the current through the
  input for each of its volts, or the voltage across it for each of its amps, from ngspice's input resistance), a note
  says it may be rounding noise or a real ratio that small. A first trial weighed the ratio by the .op's node voltages
  for each volt of the input there, and called a 3.6 V/A ratio fed by a source of 1 aA, and the far node of a ladder
  the .op shows real, maybe noise; neither is now. Where the .op's own note says the output node's voltage may be noise
  (a ladder's node the rule cannot prove real), the .tf's note says so of the ratio too, so the two never disagree: so
  it is in every one of the corpora's new .tf notes (r9731 17, d9761 4, a9721 3); the bridge's own case is C9x.5.
- **The real values a sweep's points lose are counted, then filled in one pass** (C4). SWEEP_VALUES bounded the scans,
  but each real value ngspice gives as 0 cost a search and two pushes of a growing list: 40 wires of 1 µΩ into a 1 TΩ
  meter, 45,000 points of 44 results with such a value at every point, took 135 to 159 ms of thread CPU (load 3,
  min to max of five). Each series' zeros are now counted, and their exact values written into arrays of that size in
  one pass over the series: 46 to 63 ms (51 median), and 40 ms least of three as the unit test times it; 249,001 points
  of 8 results 28 to 38 ms (63 to 67 ms before); 16,001 points of 122 results 7 to 12 ms; the beginner's 444,094 points,
  left as ngspice gives them, 0 to 4 ms. The words and the Plot panel are the same, value for value.
- **A transistor inside a subcircuit is named by its terminals too** (C6): ngspice names it by its letter, then its
  instance's path ("q.x1.q1", "m.x2.x3.m1"), so its letter is the name's first: "the collector current of q.x1.q1",
  where it said "the current in q.x1.q1" four times (C8b, native 47 and 42).
- **By the rule, a node proven real proves the current of a resistor from it to ground** (C7; C9w.3). The rule's note
  for tiny values it cannot tell from noise called Rvm's 732.4 aA, q over 1 TΩ, maybe noise of an exact 0, while node q
  beside it, the very double of n3, was shown real: a resistor between a node proven real and ground carries its
  voltage over its resistance, real, and Kirchhoff's law spreads that proof (Vm, in series with Rvm, is real too). The
  proof grows node by node and part by part, each looked at once. In 105 runs of the corpora (g9701 10, a9721 8, i9751
  15, r9731 35, d9761 17, r9743 17, the repository's facts 3) the note names 1 to 8 fewer currents, and in none more;
  traps.md's 1 A through 1e−12 Ω no longer calls R2's real 1 pA, beside its proven node, maybe noise.
- **A .control block that only runs is modelled exactly** (C8; C9x.6), behind the same-circuit check: ngspice runs
  the analyses again but writes one results file, the same doubles as without the block (.op, .dc and .tf alike, native
  47 and 42), as the critic found; C9o run from it is 0 V with the note, where the rule drew "node out: −193.5 nV" and
  "H1 delivers 37.45 aW". A block with any other line (op, set, print, alter, write) stays with the rule.
- **The corpora after the critic's fixes** (base 63e7cb2 against these fixes, one engine run each, every word and note
  compared): the repository's 846 netlists and facts 14 (the new and changed facts, S28's note, traps.md's 1 pA); the
  critic's 300 op-amps 12; g9701 10, a9721 15, i9751 15, r9731 52, d9761 23, r9743 17, each of the kinds above; k9741,
  p9744, s9742, w9711, z9771 and tfscan none. One netlist threw at the base and not now (C9x.2).
- **After the critic of round 2 of these fixes: a sweep's point is named by ngspice's own value where its label would
  say otherwise** (N1; C9y, C9y.2). ngspice adds a sweep's step once a point, in doubles, so ".dc V1 0 9 0.01" ends at
  8.999999999999853 V, which the page named "V1 = 9 V". A source idle at 9 V (V2 holding node b at its own 6 V) carries
  a real 32.76 aA there, which ngspice gives as 32.96 aA: the page warned "at V1 = 9 V, V2 carries 32.76 aA, where
  ngspice gives 32.96 aA", false at 9 V, where the circuit makes it 0 and the .op beside it says "V2: no current", and
  left the sweep as ngspice gives it (rc3 showed ngspice's −32.96 aA there with nothing said). One mechanism names every
  point the words and notes name (`sweepNames`): its label, the 4 digits of x, unless the label reads as the value the
  point is meant to have (start + k·step, read exactly; or the .op's own double for a point found near its state), x has
  drifted from that value's double (adding up the step; a point at that very double is where the steps say, as any value
  of the netlist is, READ_ULPS), and a value there reads otherwise than at the meant value, other digits and more than
  ANSWER_GAP apart, as an answer is off (`differ`): by the exact solution wherever it is this run's circuit (`exactRun`:
  the .op checked as this circuit's, its answers off or not; with no .op, the sweep) and follows the sweep
  (`exactOtherwise`, a + b·s at both), else by the rule at the point nearest the .op's state, where the .op's own values
  stand for it. Then the point is named by its shortest exact decimal, "At V1 = 8.999999999999853 V", and a note says
  why, with the meant value in all its digits: "The DC sweep's last point is V1 = 8.999999999999853 V, not 9 V: ngspice
  adds the step, 10 mV, to V1 once a point, in doubles (about 16 significant digits), so its points drift from the
  values the steps say: its last point is 8.999999999999853 V, 147.4 fV short of 9 V. There the circuit makes i(v2)
  −32.76 aA, where at 9 V it makes 0 A. So PlainSpice names that point by ngspice's own value." A point whose label
  already reads otherwise ("V1 = −55.51 aV" for a point meant to be 0 V) keeps it. On the rule path (C9y.3) only the
  point nearest the .op's state can be told: a point at a value the .op is not at keeps its label, and the page cannot
  know whether a tiny value there is 0 at the label's value (recorded below). Three refinements came from the corpora
  (C9y.6): the note wrote the meant value to 4 digits, "not 9.123 V" for 9.12345 V (and "where at 9.123 V it makes 0 A",
  false there), and "is V1 = 3.3 V, not 3.3 V" where the .op's V1 is ngspice's 3.3000000000000003 (N15); a value on a
  rounding boundary of the 4 digits named a point for nothing (a9761-1102, the only such run in the corpora:
  5.287500000000001 V "5.288 V" at 9.000000000000002 V, 5.2875 V "5.287 V" at 9 V); and beside an .op whose answers are
  off, ngspice's own rounding at the point was taken for the drift's doing (a9761-156: V1's −499.6 aA there, −506.5 aA
  in the .op, where the circuit makes 500 aA at both; "There ngspice gives i(v1) −499.6 aA, where the operating point,
  at 500 mV, shows −506.5 aA"), in 11 of d9761's runs, 2 of r9731's, 2 of a9721's and C9y.6's own. A trial that let
  values differ by ngspice's Newton tolerances (reltol, abstol, vntol) before they count changed, of the corpora run
  with it (d9761, r9731, a9721, w9711, s9742 and the repository), only r9731-909 and r9731-1119, where it kept the label
  beside a value other than the .op's ("R5 0 A" at the point, "−2 aA" in the .op), and is not kept.
- **Near a series' own 0, the page draws the exact digits** (N1; C9y). At ngspice's x, a value within ANSWER_FLOOR of its
  series' largest size is the small difference of that series' larger values, and its 4th digit is not ngspice's to give
  (V2's 32.96 aA for 32.76 aA, worked out from node b's 6 V); judging it as an answer called a three-resistor circuit off.
  At a sweep's checked points such a value is no sign that ngspice's answers are off (`excused` in judgeAnswers), and at
  every point where ngspice's number is that close to its exact value and drawn with other digits, the page draws the
  exact one (`rounded`, in the words and the Plot panel), with a note, "2 results are shown with their exact digits near
  0 in the DC sweep: ngspice gave i(v2) -3.295975e-17 A at V1 = 8.999999999999853 V … Solved exactly, …". The scale is the
  series' own, so a value tiny all along its series is held to its digits as before: C9h's loop of 2 aA, C9w.7's wire
  (340.6 pA for 433.7 pA, beside its own 454.1 pA) and g520d keep their warnings. A + b·s comes within the floor at a few
  points (at most NEAR_POINTS a series are looked at); never where a diode's current changes the series. The .op is held
  to ANSWER_GAP as before: there no x drifts, and a tiny real value ngspice gives with other digits keeps the warning (C9h).
- **A point found within the step's rounding stands for the .op's state only where it shows what the .op shows** (N2;
  C9y.4, C9x.4, C9w.7). Round 1 of these fixes took ngspice's point nearest the .op's value as its state and wrote "That
  is the operating point's own state, where ngspice gives the operating point's numbers", and the size note "where the
  sweep shows what the operating point shows", beside "i(v2) = −38.12 fA" and the .op's "V2: no current" (idle3 in 10 µV
  steps, past SWEEP_VALUES, ending at 8.999999999828448 V). Now such a point (not the .op's value bit for bit) is the
  .op's state only where every value it shows, with the marks the rule or the exact solution makes there, reads as the
  .op shows it, no two drawn with other digits more than ANSWER_GAP apart (`readsOtherwise` against the .op's own words,
  `exactOtherwise` against the exact solution at the .op's value); otherwise it is left as ngspice gives it, unmarked,
  and named by its x where the naming above finds a value that reads otherwise. By the rule it is held only to what the
  .op's words show: a transistor's currents are not among them, and a value the .op's own note calls maybe rounding
  noise claims nothing (the floating nodes of r9731's isolated transistors give −1.628e-26 V in the .op and 1.761e-66 V
  at the sweep's last point, run after run; held to those, 27 such points were named by their x for nothing). The notes
  say what it is: "At ngspice's point nearest the operating point's 9 V, 8.999999999999853 V (its 10 mV step added up in
  doubles), ngspice gives it the very number the operating point shows as 0" (or "ngspice's own numbers there show that
  it is rounding noise of a 0", where the rule run on the point's own values wrote it); "the operating point's own
  state" only for a point at the .op's value bit for bit. With this guarantee a point judged at its own x or at the
  .op's values reads the same on the page (to its 4 digits, or within ANSWER_GAP across a rounding boundary of them),
  but not to all of their digits: judged at its own x (`ownX`), C9w.7's R3 at 1.5000000000000846 V is the circuit's
  4.5413907894837533e-10 A there, which the Plot panel's data carries, where judged at the .op's values it would be the
  .op's 4.5413907894834974e-10 A (r9731-747's L1 likewise); a test now holds that (the critic's mutation R10).
  `exactly`'s level of a swept current source (R13) only matters where that source is at 0 in the .op and not at its
  point nearest it, which the guarantee turns away whenever a value shown there follows the source; the corpora read the
  same without it.
- **Each connected part of the circuit gets its own allowance in the same-circuit check** (N4; C9y.5). The allowance was
  RESIDUAL_SHARE times the whole circuit's conductance spread times the product of every gain, so an op-amp buffer of 1e6
  (or three of 1e5, 1e15) widened it for S28's I1 and R1, which nothing joins to the op-amps, and S28's "+ 3" after .end got
  "node n1 is at 2 V, where ngspice gives 3 V" again. Now each equation is held to the allowance of its own part (the parts
  that conduct to each other, ground taken out) and of every part it reads through its controlled sources, as far as they
  go (`allowances`): ngspice's rounding in what an E reads comes out at its output times its gain, but a part nothing joins
  to it keeps its own. S28 beside either gets the note that ngspice's numbers could not be checked; C9x's amplifier of 1e15
  keeps its warning beside a separate 1 A source. The 300 random op-amps read as before. What stays: within a part an
  op-amp drives, a misread line could still pass as lost digits; none is known. The H's term (its transresistance times
  the largest conductance) is gone: it never decided a run. ngspice leaves 2e-17 to 6e-17 of the equations of an H in a
  feedback loop of 1e9 to 1e18 (an H reads its control current directly, where an E multiplies a near-cancelling
  difference: 9.2e-3 at 1e15), no test could hold the term (the critic's mutation R2), and with it set to 1 every corpus
  read the same (the 300 op-amps, g9701, i9751, a9721, w9711, r9731, d9761 and the repository's 851 netlists); an
  amplifier whose op-amp is an H of 1e15 is decided exactly, out 9.15 V, with no note. An allowance only loosens the
  check, so one that never decides a run is left out. What it gives up: in d9761's a9761-706, two diodes at 0 V when V1
  is 0 V leave ngspice's Newton leftovers there (v(d2) −4.726e-11 V where the circuit makes 0), which passed the check only
  under the spread of a part a capacitor keeps apart from them (R3 and R4, 180 kΩ beside 3.3 Ω, fed by I1); the sweep was
  decided and drew 0 V there with the note. Under the diodes' own allowance it is shown as ngspice gives it, with nothing
  said, as the same diodes alone were at round 2's code (a diode's leftovers say neither, z9771-103).
- **By the rule, Kirchhoff's law gives back a real current ngspice gives as exactly 0** (N6; C9w.3; reverted after the integration
  check, below: it made currents up). Once Vm and Rvm were
  proven real (7.324e−19 A), C9w.3's 1 µΩ wire Rw, ngspice's exact 0 A, its two ends one double, was drawn "no current"
  beside them at node p, and Kirchhoff's law failed on the page. Now where every other current at one of a resistor's (or
  a G's) nodes is proven real and those do not add up to 0, it carries what they leave, shown with ngspice's 0 kept as
  `given` and a note ("But Vm, the only other part at node p, carries 7.324e-19 A, and the currents at a node add up to 0,
  so Rw carries 7.324e-19 A too. …"), node after node along a chain. Only a current the rounding of its equal end voltages
  can hide (within SAME_VOLTAGE_ULPS of them): w9711-10's 2.33e18 A "through" a resistor at 0 V is ngspice's numbers
  breaking Kirchhoff's law, and nothing is given back. Corpora: r9731 29 runs, w9711 38, d9761, s9742 and the repository's
  C9w.3 one each; none elsewhere.
- **The rule's proof that a node is real looks at each node once** (N3). Marking a node real walked every node at its
  double on each call: 7,600 dividers from one source took 1.1 to 1.2 s of describeResults (rc3 0.15 to 0.17 s). Now 0.21 s
  (load 4), linear in the dividers; a unit test holds 6,000 against 1,500 to less than 7 times the work (8.97 without it).
- **The corpora after these fixes** (round 2's code, 2a975ee, against them at 6d6e004, one engine run each, every word and
  note compared; no run threw): the repository's 854 netlists and facts 11 (the new facts C9y to C9y.6, and C9w.3's fill,
  C9w.7's, C9w.13's and C9w.14's note words, C9x.4); the 300 op-amps, g9701, i9751, r9743, k9741, p9744, z9771 and tfscan
  none; r9731 62 (29 Kirchhoff's fills, 3 of them beside a point named by its x; 28 the rule note's new words; 5 the
  nearest point's words in a warning or the size note), d9761 19 (13 the rule note's words, 4 the nearest point's, 1 fill,
  and a9761-706 above), a9721 8 (the rule note's and the nearest point's words), w9711 39 (38 fills; w9711-141's fill in a
  run whose numbers the page says cannot be trusted, with no note: below), s9742 1 (a fill).
- **What stays open** (refix4-noise.md's items 1 to 6): 1, a rounding boundary drawn two ways, unchanged; 2, the points of
  a resistor or two-source sweep other than the .op's state keep ngspice's numbers, unchanged (its .op-state point must
  still be bit for bit); 3, settled by the last pass where the exact solution decides, unchanged here; 4, a chain of 70
  controlled sources goes to the rule, unchanged; 5, diode runs decided by the rule beside the exact solution with no
  warning, unchanged; 6, the two-source .op-state point relies on ngspice adding the outer step, unchanged (the inner
  one is now matched within its rounding). New: a .tf alone, or beside an .op that shows its output as real, keeps
  ngspice's ratio with nothing said where the rule decides; a run whose numbers the check cannot place, with diodes,
  is left to the rule without the note; and the allowance that counts gains cannot tell a run of another circuit from
  ngspice's lost digits where gains are large, now only within the part of the circuit a gain drives (none is known).
  After the critic of round 2 of these fixes (none of items 1 to 6 changes): a sweep's point is named by its own x only
  for a sweep of one source; by the rule, only the point nearest the .op's state can be told to read otherwise than its
  label, so at a value the .op is not at (".dc V1 0 12 0.1" beside an .op at 9 V) a tiny value that is 0 only at the
  label's value keeps the label, as ngspice gives it; and where no exact solution is this run's circuit (a transistor,
  a .param line), the point nearest the .op's state is named by its x wherever ngspice's numbers there and in the .op
  read otherwise, whatever made them differ, so its note can read as if the drift had made a difference that ngspice's
  own rounding or Newton tolerances made (r9731-909: "There ngspice gives i(@r81[i]) 0 A, where the operating point, at
  1 nA, shows 2.247 fA"), true in what it says but not in what it suggests; by the rule beside an exact solution that is
  the run's circuit (an .op whose answers are off), that point is held to ngspice's numbers there and the .op's, not to
  the exact solution at its own x, so a value the rule marks 0 there could be one the circuit makes real at that x (no
  run of d9761, r9731, a9721, w9711, s9742 or the repository has such a point); in a run ngspice could not solve (a
  singular matrix, the numbers of its fallback), Kirchhoff's law still gives a wire's current back, where the page says
  those numbers cannot be trusted and shows no note.

## After the integration check (14 November 2026)

The integration check of the merged last-pass lanes found four problems in the rounding-noise rule (noise-0 to noise-3)
and two where it meets another lane (regress-3 P4; cross-2 X3 and regress-2 P3, one problem). Each was checked by a
skeptic. This last fix round makes the most conservative change that makes each right, reverts the change that brought a
problem where a fix would be complex, and adds no new mechanism.

- **By the rule, Kirchhoff's law gives no current back: the fill of N6 is reverted** (noise-0, fill-fabricates-currents;
  C9z, C9w.3). Where every other current at one of a wire's nodes was proven real and they did not add up to 0, the rule
  gave the wire what they left. What they leave is ngspice's own rounding as often as a real current: the 1e9 S of a 1 nΩ
  wire costs ngspice about ten digits at its node, and the guard (a current the rounding of the wire's equal end voltages
  can hide) admits exactly the size of that residual. A divider with a .param line, a 1 nΩ wire and a 10 MΩ load drew
  "Rw 1.431 nA from node p to node n1" where 198 nA flows the other way, with a note that cited Kirchhoff's law beside a
  node p whose two currents then broke it (C9z). Of the integration check's 300 generated circuits on the rule path, 102
  got a fill and all 102 were wrong; of its skeptic's, 121 got one and 117 were wrong; of r9731's 31 fills, 10 were wrong
  (r9731-503: "R5 461.5 µA" for an exact −261 fA; r9731-1029: 27.27 nA for an exact 0); a chain of 149 wires of 1 µΩ was
  drawn 1.735 pA the wrong way at every wire; and the fill recursed once a wire, so about 4,000 wires or more overflowed
  the stack and the page lost its words (4,500 wires now take 121 to 192 ms of describeResults, load 3.4; at 3e61833 they
  threw "Maximum call stack size exceeded"). Step 6 of the rule, the note's words for it and the `node` and `others` of a
  lost current are taken out, back to c520a49's code: such a wire keeps ngspice's exact 0 with nothing said, and a run
  whose exact solution is its circuit still warns that ngspice's 0 is off (c4-58 without its .param line: "Rw carries
  198 nA, where ngspice gives 0 A"). Open again (N6): beside a current proven real at a node of two parts, a wire ngspice
  gives exactly 0 A is drawn "no current" with nothing said, so Kirchhoff's law fails on the page there (C9w.3's Rw beside
  Vm's 7.324e−19 A; C9z's beside Rload's 198 nA). The noise-0 skeptic's trial, a fill only of a strict series pair, walked
  as a queue, still copies a partner's own error (r9731-1138: 5.048 pA the wrong way; r9731-1029: 2.17 fA for an exact
  0), so it needs its own review after the release. The may-be-noise note (C9w) is kept as it is: it speaks only of
  values ngspice gives as tiny but not 0 (maybeNote leaves out a 0), so such a wire gets no note, as at c520a49; a note
  of the wire's own that gives no number, as the noise-0 skeptic worded one, would be new words with a new trigger, and
  is left with N6.
- **A sweep's point at the .op's own value of its source, bit for bit, or at the very double of the decimal its steps
  say, is that value** (noise-1, sweep-point-at-decimal-judged-at-binary; noise-2, point-name-collapses-with-prefix; C9z.2,
  C9z.3). The .op is judged at the netlist's decimals (exact.ts READ_ULPS), but every point of a decided sweep was judged
  at its binary x, even where that x is the decimal's own double: ".dc V1 0 0.3 0.15" ends at 0.3's double, where V2,
  idle at 300 mV, carries no current and ngspice gives 0 A, and the page drew −3.701e−21 A there, the circuit at
  0.29999999999999998890 V, with "Solved exactly … none of them is 0", beside the .op's "V2: no current"; at the .op's own
  1.2000000000000002 V for "1.2" it drew the exact digits at the binary value beside the .op's note that called the very
  same ngspice number noise. Now findSweepNoise judges each checked point and each point where a series may be 0 at the
  value it stands for (`standsFor`): the netlist's value where ngspice's x is the .op's own double of the swept source or
  the very double of the decimal the netlist writes for it (ngspice reads "4.5m" as 0.0045000000000000005, N15), the
  decimal start + k·step where x is that decimal's nearest double (C9z.2: ".dc V1 0 0.6 0.15" passes 0.3's double, which is
  neither the netlist's 0.6 nor the .op's, and showed −3.701e−21 A there; no test reached this until the critic of this
  lane's first fix), else x itself; the series' 0s and lost values follow.
  sweepNames no longer names a point at the .op's own double otherwise: ".dc I1 0 0.0045 0.03m" ends at ngspice's own 4.5m,
  0.0045000000000000005, which read "The DC sweep's last point is I1 = 4.5 mA, not 4.5 mA" beside "i(v2) 4.047e-19 A" and
  is now "I1 = 4.5 mA" with V2's 0. A point that drifted from both is named by ngspice's own value with that value's own
  digits, the decimal point moved, never divided by the prefix (`exactSI`): formatSI's division turned
  0.0045000000000000005 A into "4.5 mA", 3.0000000000000004e−7 A into "300 nA" and 0.0012000000000000003 A into
  "1.2000000000000004 mA". Measured with the integration check's own judge, at the value each point stands for: its 393
  current sweeps (isrc2) had 18 labels beside a value the .op contradicts, 39 wrong "There the circuit makes" claims, 21
  points renamed for nothing, 68 exact 0s drawn as ngspice's noise and 214 filled in from ngspice's 0, and have none now
  (252 of 252 claims right); its drift corpus's 298 runs on the exact path had 1, 8, 6, 18 and 16 of these, and none now.
  What it gives up: a point that drifted even one step of a double from both is still judged at its own x and named by
  it ("I1 = 1.2000000000000003 mA"), true but long; the noise-1 skeptic's wider rule (within READ_ULPS of either value)
  would call such a point the value too, and is not taken: it is a new judgement of points ngspice did not compute at that
  value, and the integration asked for the very double. With diodes, a point that stands for a decimal at which a diode
  has 0 V across it is not one of the diodes' special points: the series a diode changes keep ngspice's numbers there.
  What it costs: the decision now finds the .op's value of the swept source on the exact path too, one pass over the
  points, and compares each point with two values where it compared one. describeResults' main-thread CPU (the least of
  three tries, the median of ten such, load 2.7 to 3.6) is 49 ms for 45,000 points of 44 results against 3e61833's 45.5,
  and 44 ms for 150,001 points against 40; that pass made an array at each nearer point (`nearest`), 7.5 ms more than
  3e61833 on the 150,001 points, until it assigned its two numbers instead.
- **By the rule, a point's own numbers show the .op's 0s only at the .op's value** (noise-3,
  rule-nearest-point-real-value-called-noise; C9z.4, C9x.4). Round 1 of the last pass's fixes took ngspice's point nearest
  the .op's value as its state on the rule path too, and the rule, run on that point's own values, wrote real values 0
  there: ".dc V1 -8.15 4.95 0.05" passes 4.499999999999973 V, where the circuit makes −2.436 aA through an idle source,
  drawn 0 with "ngspice's own numbers there show that each of them is rounding noise of a 0". With no exact solution the
  rule cannot tell a real value there from noise, so its verdict on a point's own values now counts only at the .op's
  value: ngspice's double of it, bit for bit, or the very double of the decimal the netlist writes for it, as for naming
  (C9z.4: ".dc I1 0 0.0045 0.3m" beside a .param line ends at 0.0045's own double, where ngspice gives V2 −6.939 aA and
  its .op exactly 0; it was named "I1 = 4.5 mA, not 4.5 mA" with words about drifting, which this point does not). At
  such a point a current the .op gives as exactly 0 is held to it too, where the rule run on the point's own values writes
  it 0; its note then says "and the operating point shows them as 0", since a value ngspice gives as exactly 0 has no note
  of its own. At the point nearest the .op's value, a few steps of a double from it, a value is still shown 0 where ngspice
  gives it the very number the .op's 0 stands for, and that point stands for the .op's state only where every value then
  reads as the .op shows it, as at 3e61833: the noise-3 skeptic's narrower change. This lane's first fix skipped such
  points altogether, and its critic found that this undid C9x.4: by the rule, a balanced bridge swept in an everyday step
  showed ngspice's −1.776 aA for R5 at its drifted last point beside the .op's "R5: rounding noise, 0 A", named the point
  "9.99999999999998 V, not 10 V", said nothing in a sweep of two sources, and the Plot panel drew R5 going "from 0 A to
  −1.776 aA" (118 of the critic's 672 balanced bridges with a .param line, 55 of them read by an ammeter beside "Vm
  measures no current"; 96 show 0 again, with the note). On the exact path the point is still judged at its own x by the
  exact solution (C9w.7). In the drift corpus's 386 rule-path runs, the values drawn 0 where the circuit makes them real
  at ngspice's x fall from 106 to 52 (in 26 runs), the "very number" claims are 70 (71 at 3e61833), each true bit for
  bit, and 9 bridge runs are renamed for nothing (8 at 3e61833, 27 with the first fix). What stays open: (a) a value drawn
  0 at a drifted point because ngspice gives it the .op's very number, where the circuit makes a smaller real value there:
  those 52 values, of which the 0 is nearer the exact value than ngspice's number in 47 and ngspice's number has the other
  sign in 28; 36 of the critic's 756 idle-source sweeps on the rule path (26 nearer, 15 of the other sign; idle-4: 2.03e−20 A
  at 1.5000000000000002 V, where ngspice gives the .op's 4.337e−19 A), and 39 of the noise-3 skeptic's 400; (b) 22 of the
  critic's 672 bridges lose 3e61833's 0 from the rule's own verdict at the drifted point, where ngspice's number for R5 or
  Vm is not the .op's very double: that point keeps ngspice's noise and is named by its own x (r9731-909's open item),
  though R5's current is 0 at every V1 there; (c) the skeptic's later refinement: the rule's verdict at a drifted point
  only where the series' own slope from its neighbours, times the drift, is far below the value.
- **A swept source whose value is not a written number has no point at the .op's state** (regress-3, P4; C9z.5, C9w.13).
  findStatePoints read a V or I set by a .param, braces or a transient function with no DC value as 0 V or 0 A, so the
  sweep's 0 V point was "the operating point's own state" and its values the .op zeroes were zeroed there, with that note,
  while the .op is at 9 V. One guarded line (the skeptic's) now finds no such point: those sweeps are shown as ngspice gives
  them, as at c520a49. What stays open, as the skeptic advised: regress-1's ammeter bridge with its supply set by a .param
  shows, at the sweep's 9 V point, ngspice's −2.168e−19 A for Vm (the .op's very double) beside the .op's "Vm measures no
  current", and its .tf keeps −5.551e−17 V/V with no note, since the rule joins no level across R5, whose 0 A is
  ngspice's exact 0. Taking such a source's value from the .op's own vectors (a grounded V's node, an I's own current, the
  skeptic's fixB) would close it, but a node can come out a step of a double off its source's value, and it is a new
  reading of the .op: left for after the release.
- **A .tf of nodes inside a subcircuit gets the rule's note** (cross-2, X3-inner-tf-noise; regress-2, P3; C9z.6). The
  rule reads only the main circuit's parts, so it puts no two nodes inside a subcircuit at one level, and C9x.5's note,
  which needs them at one level, never came: v(x1.p,x1.q)/V1 = 1.11e−16 V/V for a bridge balanced exactly had nothing
  said, beside x1.p and x1.q at 210 mV. ruleRatio now judges an output with a node inside a subcircuit by the .op's own
  values: shown alike, the ratio gets the note "In the operating point node x1.p and node x1.q are at the same voltage, …".
  And the note named an ammeter inside a subcircuit as a node, "i(v.x1.vs) is at 0 V, ground's voltage"; it now says
  "v.x1.vs measures no current". The same circuits in the main circuit read as before. What stays open: main-circuit
  nodes joined only inside a subcircuit (v(p,q)/V1 = 1.11e−16 V/V with nothing said, as at c520a49), and a part inside a
  subcircuit whose .op current ngspice gives as tiny but not 0 (3.974e−18 A, a ratio of 7.727e−19 A/V, nothing said).
- **Corrections of this record.** The N6 bullet above describes what is now reverted; by the rule, "found within what
  ngspice's adding up of the step leaves" (C2) holds for ngspice's very number for the .op's 0, and the N2 bullet's
  "ngspice's own numbers there show that it is rounding noise of a 0" only at the .op's value itself; "one source at its
  netlist value" (C9w.13) holds where the netlist writes that value as a number; and the corpora's counts of Kirchhoff's
  fills (r9731 29, w9711 38, d9761, s9742 and C9w.3) are none now.
- **Our own netlists.** Of the repository's 984 netlists and facts blocks, 12 give other words than at 3e61833, each a
  meant change: C9w.3's wire ("no current", without the note) and the new facts C9z to C9z.6, all but C9z.5's ammeter
  bridge (the open item above), which reads as at 3e61833; C9x.4's last point reads as at 3e61833 again (R5's 0, with the
  note); the 21 examples, the fixtures and tests/corpus read word for word the same.

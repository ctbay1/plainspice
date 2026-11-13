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

## After the final reviews (12 November 2026)

**Wire work is bounded at the format's limits** (security:F1, with decision 0012):

- Segments at a point are found by their row or column (sorted, a binary search) or, for slanted
  ones, by the grid points they pass; the wires through a box (a place for a ground symbol, for a
  node's name) by the rows and columns inside it and, for slanted ones, the squares of the grid it
  covers; islands of copper visit each point once; the obstacles words avoid are filed by squares of
  the grid. The rows and columns are kept in a few flat sorted arrays, not an object each, and
  reconcile indexes and merges each version of the copper once.
- Corrected after the critic of the fix round: "no lookup scans the whole drawing" was not true. The
  search for a ground symbol's place, added by the phone fix below, checked every point of ground's
  copper against every wire: a 31 kB link with a wire through every such point and a 9,900-piece
  wave of another node took about 4 s to build and half a minute on a slowed phone (decision 0012).
  It now looks only at the wires near each place and tries at most 100 places, lowest first (and as
  many ends for a lead); real drawings have a few dozen. Checking overlaps (`findOverlaps`, used to
  judge a turned view and an edit's stored sides) compared every symbol and name with every wire
  and every other one; since the second re-check it looks only near each (below).
- **The phone tries to turn a drawing only up to 100 parts and 1000 pieces of wire**
  (`TURN_LIMITS`, `src/notebook/turn.ts`). Each try rebuilds the whole drawing, up to four tries, so
  a drawing line with thousands of pieces kept the phone busy to find no clean turn. No circuit a
  student draws comes near (the largest example has 9 parts and 21 pieces), and a drawing that
  large does not fit a phone at a size its words can be read, turned or not: it is shown as drawn,
  and the phone can pan it.
- The copper is merged once when the lines are read, and a slanted piece drawn twice is kept once,
  so no later step sees repeats.
- **A piece of wire drawn twice over the same place is one piece**: its copy no longer keeps the
  other's dead end alive (before, two stacked copies of a dead end both stayed). Dead ends are cut
  in the same rounds as before, but each round looks only at what the last one changed, so a chain
  of wire hanging from one pin goes in one sweep. The drawing written is pruned once more after
  merging, so it reads back the same.
- Every example, fixture and corpus netlist builds to exactly the same drawing and scene as
  before, and a 300-part ladder and a dense mesh build faster. After this round's changes too, all
  145 repository netlists give the same drawing, scene, problems and turned view as the first fix,
  and the wire functions match the release reviewed on 25,000 random wire sets.

**Corrected after the second re-check: building and drawing a crafted drawing is bounded too**
(P2 and P3, with decision 0012). The wires were bounded; other things the drawing lines can pile up
were not: parts on other nodes' pins, names and ground symbols at one point, what the drawing draws
for each wire, and the places tried for a card or a note. "Bounded" now covers reconcile's first
step and the render as well as the wires.

- **The parts to move are moved from one scene.** Reconcile's first step moved one part at a time
  and built a whole scene for each, every name piled at the point placed again each time: 59 scenes
  for the 542-character link that puts V1 and R2 … R60 at one point, and with 1900 names there too,
  37 to 47 s on a computer. The parts to move are now found from the pins alone (the last part at a
  point with pins of two nodes, until no such point is left), then placed one by one from one scene
  of the drawing with the others still standing (`placeMoved`, `src/schematic/layout.ts`): each
  leaves its place as it is placed, so the parts still to move keep pulling their neighbours near
  (their pins are copper) and stay in the way, and each part placed is in the way of the next, its
  words on the first free side. The first part is placed exactly as before, so a drawing with one
  part to move draws as it did; none of the repository's netlists has more. The 60 parts come out in
  66 × 44 squares (a scene each gave 56 × 61; taking them all out first, without the parts still to
  move, gave a row of 358 × 11). A place for a part is tried without making the symbol's geometry for
  each place tried (the symbol turned at (0, 0), moved by the place's point: the same numbers), and
  what is in the way is filed in numbered cells, each look marking what it took. The loop that moved
  one part at a time stays after it, for a part placed on another node's pin all the same (none is).
- **What the lines pile at one point counts once.** A ground symbol drawn twice at one place, turned
  the same way, is one symbol, as wire drawn over wire is one piece; a node's name written twice at
  one point is written once (the repairs kept only the first anyway); and the scenes made to place a
  part (renamed, added or moved) see the first name at each point, while every name is still put in
  order by the repairs (step 3). A drawing PlainSpice writes has none of these.
- **A look at what words avoid takes each thing once with a mark**, not a Set, and sorts nothing it
  need not: it looks at everything in order when its squares hold as many entries as there are things
  at all, and puts several squares' entries in order by reading the marks in order when that is less
  work than sorting them. `findOverlaps` now compares each symbol and name only with what shares a
  square with it, in the order a comparison of every pair takes them, so the list is the same (1,600
  ground symbols on a mesh: 75,000 checks, where every pair was 3.75 million).
- **A repair round that changes nothing ends the step.** A pin that a slanted piece of wire runs
  through is joined to it (the copper is filed at every grid point a slanted piece passes), but a cut
  splits only straight pieces, so it cannot free that pin, and reconcile's second step went round 50
  times, each over the whole drawing, three times for each edit: a refused Disconnect on a slanted
  lattice at the limits took 1.8 s. Each round after one that changes nothing would start from the
  same drawing. Each route also takes the pins its islands came from, not every ground symbol's
  geometry afresh. (Such a pin stays joined to the other node, so the drawing shows that short, as
  the build re-checked did, though the warning about slanted wires says they connect only at their
  ends; slanted copper is only ever typed, never drawn by the editor. Left as it is for now.)
- **The render finds each junction dot's and hop's colour at its point.** The drawing looked for the
  wire under each dot and each hop in every wire piece: 47 million looks on every hover, click and
  key on a slanted lattice at the limits (4,898 dots, 9,666 pieces), and dots on slanted copper never
  got their node's colour. The scene now gives each junction its node (`junctionNodes`, from the
  islands it already finds) and each crossing the node of the wire that hops (`crossingNodes`), and
  the drawing is drawn in layers that are drawn again only when what they show changes, so a hover, a
  selection or the focus ring draws the highlights and the ring only. A dot on slanted copper, or
  where only pins meet, now takes its node's colour too.
- **A place beside something is looked for nearest first, without making every place on the paper**
  (`src/notebook/place.ts`). A card's place summed what each place it tried covers, every word,
  symbol and piece of wire, until it found a free one: a click on the fitted lattice checked 140
  million pieces (two seconds of work). It now looks only near each place (the room filed by squares)
  and stops at the first thing a place covers. And every place along each side of the paper was made
  and sorted before the nearest free one was looked for, so a red-pen note on a drawing that reaches
  ±2000 sorted 1.6 million places, a second of work each time the notes were drawn; the places are now
  made a band of their order at a time (each band twice as wide as the one before) and each band put
  in order as all the places were, so the place found is the same: 270 places sorted there. The
  card, the notes, the old voltages crossed out and the sticky note keep only a free place, so they
  ask for one (`freeOnly`) and nothing sums what every place covers to find the least.

All 147 netlists of the repository, as written and without their drawing lines, give the same drawing
lines, scene, problems and turned view as before (294 builds), and every edit on them the same result
(6,843 edits: each kind on each part, wire, node, name and ground symbol); 1,857 drawings with a part
put on another node's pin (each part of the examples and fixtures on each other part's pins) draw as
before; the same overlaps on 334 scenes; the same 702 dots and their colours; the same places for
4,443 cards and as many sticky notes, 1,508 notes and 150 sets of old voltages (every netlist and the
crafted shapes, at several zooms and pans), and on 1,500 random rooms; and every example, opened from
the menu and solved, the same drawing: the same SVG at 1280 × 800 and on a Pixel 7 (42 pictures), and
the same picture as a second run of the build re-checked (two runs of that build differ by 12 to 65
pixels of the netlist panel over the drawing on six pictures). The tests count the work, not the
time (`tests/unit/schematic-piles.test.ts`, `schematic-shapes-work.test.ts`,
`notebook-drawing-work.test.tsx`, `app-card-builds.test.tsx`), and those of each fix fail on the
build re-checked.

**A node's name goes where it is read clear of the parts, wherever its copper or its end leaves
room** (student:label-on-part). A name with no spot of its own (no `side=`) that touches a symbol,
words or a wire at every spot around its point moves along its own piece of copper to the nearest
point where it touches none (the 40 nearest are tried; never off its piece, never onto a point where
another node's wire crosses). Junction dots and terminals still steer where a name goes but no
longer count as something it sits on. This is done only in the scene a schematic keeps, and
`buildSchematic` writes the new point into the drawing, so the lines written by the next change in
the drawing say what the page shows; the scenes made along the way (layout, routing, the turned
phone view) leave every name where it is. A spot chosen on purpose (`side=`) never moves.

A name at an open end (a pin not wired yet, an output terminal, a stub) is that end's name, so its
point stays at the end. When no spot there is clear, the same spots are tried one and then two grid
units further out, the way a wire would leave the end, but never onto a point with copper on it (a
wire or a pin), where the name would be read as that copper's; the first clear one is taken (the
critic of the fix round found names at open ends still written on parts while a circuit is built: n7
across R3's zigzag, n9 over F1's name). When none is clear either (parts dropped a few squares apart
leave no room for a name and the room kept for its value), the least bad of those places is taken in
this order: where the name, as it is written before it has a value (on the left of its point the
Notebook writes the pair up against the point, `results.ts` nameShift), lies least on a symbol, then
least on another node's name (with the room kept for its value); then where the room kept for its
own value lies least on symbols and other names together; then the least in the way. Areas that
differ only by rounding (less than a millionth of a square) count as the same.

Corrected after the second critic of the fix round: names at open ends are kept off each other too,
and never step out onto other copper. The order before looked only at symbols and compared areas
exactly, so a rounding difference decided between two places and the one twice as much in the way
could win; and it ignored other names. Two open ends facing each other across a gap not wired yet
(V1, R1, the gap, R2, ground: the Notebook runs it, since its checks only say "Only R1 touches n3")
were written on one line, and after the run their values over each other: "n34==12 V" at a 4-unit
gap. At a 2-unit gap the two names lay on each other even before a run, and the order the critic
proposed (areas within rounding, names kept apart) wrote n4's name two units out, at R1's end. Now,
at gaps of 2 to 6 units, each name is written nearer its own end than the other, and the names and
values stay apart, for the run's values and for the widest value the room is kept for. In the
critic's random builds (three seeds, 60 builds each, checked after every wire, a value "= 12.35 V"
written as the Notebook writes it) no name or value lies on another's (18, 28 and 10 did before this
correction); with the widest value ("= −888.8 mV"), 28 of 1512 names still touch another at the far
ends of their rooms, where no shorter value reaches.

After a run, a name written on the left of its point moves left with its value: the pair "n4 = 0 V"
ends at the point, as the videos write a name (nameShift). So where the room kept for the value lies
on a part, the name itself may then touch the part: in the circuit above, n4's name touches R1's lead
once its value is written at a 3-unit gap, and R1's zigzag at a 2-unit gap.

In 600 seeded mouse-like builds (parts on a grid, then pin-to-pin wires) no name, as written before it
has a value, lies on a symbol, a part's name or value, or another name (the first fix wrote 57 names
on a symbol and 85 on a part's words, all at open ends). The boxes that include the room kept for a
value still overlap a part or a part's words 518 times in those builds (513 on the first fix, 548
before this correction), since that room is what does not fit. So "never on a part" holds for what
is written while a circuit is built, and wherever there is room for a name and its value; where there
is none, a name or a value written after a run may still touch a part. The repository's netlists draw
exactly as before.

A name the student moves (dragged, Shift+arrow keys, or "Move its name" on the node card) lands
where it was put, even on a crowded point: there it gets the spot the scene picks there (the least in
the way), stored as `side=` and kept as the student's choice, as a part's side the student chose is
kept. The first fix let the rebuild carry such a name back to a free point while the editor said "it
can go here" and "The name of node n4 moved." (critic of the fix round). A spot stored for a name
belongs to its point: moved to another point, the name no longer takes it along, as a part turned
lets its words' side go (the second critic of the fix round found n4, stepped with Shift+arrows to
(8,0), (7,0) and (6,0), still had the spot picked at (8,0), where one move to (6,0) gives a freer
one). So a name stepped somewhere is written as one moved there at once; only a spot the edit itself
names (`move-label` with `side`) goes along. Moved on to a point with room, it is written with the
spot the scene chooses there.

**A ground symbol is put where no wire runs through it, wherever there is room** (student:phone-link-unturned). When
the drawing has no ground symbol (the turned phone view never has one), the symbol goes at the
lowest point of ground's copper that is clear of symbols, words and wires (the 100 lowest points
are tried); when none is (a ground wire drawn straight through the pins, turned upright), it hangs on
a one-unit lead below the lowest end of ground's copper that has room, best where the lead goes
straight on from a wire coming down, and the lead is drawn as wire. When no place and no lead has
room (none of the repository's drawings), it goes at the lowest point, as before this round, and a
wire may run through it there (the critic's last edge case, not met in practice). Ladders built with the mouse now turn for a phone held
upright; of the other netlists, 52 corpus drawings now turn that did not, 4 fixtures and 28 corpus
drawings turn one unit tighter, the examples' turned views are unchanged, and none lost its turn.

**Three sentences of the editor** (words:W6, W7, W10):

- Renaming a node to a name that differs from an existing node's only in capital letters joins
  them, as before, but the netlist now gets the existing node's spelling, and the editor says why
  (fact W6): "Node out renamed to IN. SPICE ignores capital letters in node names, so IN is node in,
  which was already there: the two are now one node, in."
- A half turn of a wired part where it stands is refused in words that no longer call it "turning
  round" (which also named Reverse): "A half turn of R1 where it stands would loop its wires round
  it. To swap its two ends, use Reverse once R1 is back in place." The same words are the hint
  while R1 is in hand ("R1 can't go here: ..."), what is said when it goes back ("R1 went back:
  ..."), and the answer to a half turn of a placed part, so they never ask to put R1 down where it
  cannot go (the first wording, "put it down, then use Reverse", did; critic of the fix round).
  They do not say Reverse leaves the part unturned: Reverse turns its symbol round so its wires
  stay.
- Reverse refused on a line ending with gnd names the Checks panel's own button, spelled as the
  panel spells it: "... Rename gnd first: the Checks panel says why and offers “Rename gnd to 0”."

# The schematic model (`src/schematic/`)

The circuit drawn from its netlist, kept in step with it both ways. Plain TypeScript with no React,
CSS or colours: geometry, connectivity and text. A visual style renders `schematic.scene` and edits
through `applyEdit`. Why it is built this way: [decision 0013](decisions/0013-schematic-model.md).
Everything is exported from `src/schematic/index.ts`.

## From text to drawing

```text
netlist text ─ parseNetlist ─▶ Netlist ─ circuitFromNetlist ─▶ Circuit
                                   │                               │
                                   └─ readDrawing ─▶ DrawingLines ─┤  (or lines kept elsewhere)
                                                                   ▼
                          autoLayout / placeParts ─▶ Drawing ─ reconcile ─▶ Drawing (in step)
                                                                   │
                                                          buildScene ─▶ Scene ─▶ renderer
```

```ts
import { buildSchematic, applyEdit, describeItem, readingOrder } from '../schematic/index.ts';

const s = buildSchematic(text, { measure });  // never throws; measure: the style's text widths (optional)
s.scene.parts;                            // symbols in place: pins, boxes, + and − marks, words
s.scene.wires;                            // orthogonal polylines, each with its node
s.scene.junctions; s.scene.terminals;     // dots, open ends
s.scene.stubs;                            // ends of nodes that go on to parts not drawn
s.scene.crossings;                        // where wires cross without joining (for hops)
s.scene.nodeLabels;                       // node names, placed clear of everything
s.circuit.notDrawn; s.circuit.dotLines;   // what the drawing does not show, listed for the UI
s.problems;                               // what was wrong with the drawing lines, what was repaired

const r = applyEdit(s, { kind: 'add-part', letter: 'R', at: { x: 12, y: 3 } });
if (r.ok) editor.applyChanges(r.changes); // like a check's fix; r.summary for a live region
else announce(r.reason);
```

- **`Circuit`** (`circuit.ts`): the drawn parts (R C L V I E F G H) with their name as written,
  nodes (ngspice's lower-case names, ground `0`), value as written, AC value and transient function,
  control (E, G: two nodes; F, H: a voltage source), the K lines that couple an inductor
  (`coupled`) and the F and H parts that read a source's current (`sensedBy`); the nodes with their
  pins and the lines not drawn that also name them (`hidden`); the lines not drawn, each with its
  reason; the dot lines.
- **`Drawing`** (`drawing.ts`): what the drawing lines store. Part placements by key
  (`{ at, rot, mirror, side? }`, `at` being the point midway between the pins, `side` where its
  words go), ground symbols (`at` is the pin), wires (polylines), node labels (a node written at a
  point of its copper, `side` the spot for its name).
- **`Scene`** (`scene.ts`): everything derived from a circuit and a drawing, for a renderer.

## Coordinates and symbols

- Grid units, x to the right, y down (SVG). Pins, wires and placements are whole numbers; words
  are not.
- Every two-terminal symbol at rotation 0 is upright with pin 0 at (0, −2) and pin 1 at (0, 2).
  Pin 0 is the line's first node: the + side of V, E and H; the "from" side of I, F and G, whose
  arrow points from pin 0 to pin 1. Rotation turns clockwise (`rotate(90)` puts pin 0 on the
  right, 270 on the left); mirroring flips across the axis (it never moves the pins). Draw a symbol
  with `translate(x y) rotate(rot)` plus `scale(-1 1)` when mirrored.
- `SYMBOLS` gives each symbol's pins, outward directions, body box, whole box (pin to pin), and
  standard US/ANSI shapes as SVG path data. Polarity marks come separately in the scene
  (`part.marks`) because they must stay upright.
- Words (`TextLine`): draw `text` at (x, y) with `text-anchor` = `align` and
  `dominant-baseline="central"`, at `TEXT.size` (0.7 grid units). Roles: `name`, `value` (a part
  may have several value lines: a source's DC value, its AC value as written, its function in a few
  words), `result` (empty: room kept for a node voltage under each node name and a current under
  each part's values), `node`, and `hidden` (under a node name: "to D1, X1", the parts on it the
  drawing does not show).
- Widths: by default `textWidth`, an estimate for an ordinary sans-serif font. A style with another
  font passes `measure(text, role)` (grid units) in the options; the layout, the scene, the router
  and the edits then all use it, and `applyEdit` reuses the options the schematic was built with.
- Result lines: by default one under each part's values, as wide as `TEXT.resultChars`. A style
  that writes more passes `resultRoom(part)` in the options: the result lines it keeps for that part,
  each as a sample of the widest text it will hold (measured with the `result` role); the layout
  spaces the drawing for them. The Notebook look (`src/notebook/results.ts`) keeps three for a
  source (its current, "delivers" or "absorbs", the watts) and one for a 0 V source ("measures"
  and its current).
- A node's result goes on a line of its own under (or over) its name by default. With
  `nodeResultInline` (a sample of the widest result, e.g. `'= −888.8 mV'`) it shares the name's line
  instead, just after the name (`INLINE_RESULT_GAP`): both lines are aligned to their start and
  placed where one line as wide as both would go, so the name never moves when the number's width
  changes. The Notebook writes "s = 12 V" there.
- `part.arrow` is where a current arrow goes, pointing the way a positive SPICE current flows (pin 0
  into the part; flip it for a negative one). On a source in `part.sensedBy` it shows the current an
  F or H reads. A stub's `box` is the room kept for its mark (`STUB_LENGTH` on from the wire end).

## The automatic layout (`layout.ts`)

1. **The rail**: ground (node 0), or in a circuit without ground the − side of its first source.
2. **Blocks**: groups of nodes joined by parts not on the rail; the first source's block first.
3. **The spine** of each block: every path of series parts from its first source (or first part on
   the rail) is tried, and the best kept (`plan`'s score: fewest parts outside the pattern, lowest
   drawing, an open terminal at the right end, an ammeter standing in the branch it measures, the
   channel's terminal names `a`, `b`, `out` last).
4. **Columns** below each spine node, in netlist order: parts to the rail, chains to the rail, parts
   in parallel at the bottom of a chain (a "fan"), open ends. **Bridges** above: a second part
   between neighbours, a part between non-neighbours, or a chain of parts between two spine nodes;
   a bridge's parts keep clear of the wires rising past it to higher bridges.
5. **Spacing**: slots left to right; gaps grow until `findOverlaps` finds nothing (words running
   into a wire widen the gap before them).
6. **The rest** (`placeParts`): one by one, next to their nodes' copper, where nothing overlaps;
   `reconcile` wires them with the router (`route.ts`).

`layOut(circuit, options, start)` is the same layout with the top rail starting at a given node; a
partial drawing uses it for the parts it lays out beside the given ones.

## The drawing format (`format.ts`)

```text
* plainspice-drawing v1
*@ <part name> <x> <y> <rot> [m] [side=right|left|above|below]
*@ part <name> <x> <y> <rot> [m] [side=...]   for a part named ground, wire, label or part
*@ ground <x> <y> [rot]                         a ground symbol (its pin)
*@ wire <x1>,<y1> <x2>,<y2> ...                 an orthogonal polyline
*@ label <node> <x> <y> [side=<spot>]           a node's name at a point of its copper
```

Whole numbers only, within ±`COORD_LIMIT` (2000); rotation 0, 90, 180 or 270; `m` mirrors;
`side=` is optional (spots: `above-right`, `above-left`, `below-right`, `below-left`, `right`,
`left`, `far-right`, `far-left`). ngspice ignores all of it (drawing-1 in
[spice-facts/drawing.md](spice-facts/drawing.md)).

- A `key=value` field PlainSpice does not know is read past and reported (`unknown-field`); a plain
  word after a field makes the line unreadable.
- Unreadable lines, coordinates out of range and lines past the limits (`MAX_DRAWING_LINES`,
  `MAX_WIRE_LENGTH`, `MAX_WIRE_POINTS`) are kept as written (`schematic.kept`) and reported.
- Positions of parts and labels of nodes the netlist does not have are kept as written
  (`schematic.orphans`) until the next change made in the drawing, which drops them with a note.
- `*@` lines before any header are read as v1 (`no-header`), and so are the lines under a header
  without a version. Lines under a header of another version belong to it (`schematic.foreign`):
  they stay where they are, unused; `applyEdit` then refuses edits that change the drawing and does
  the others (values, names, parts) without touching any drawing line.
- Writing: `serializeDrawing` then `drawingBlockChanges` (a new block goes just before `.end`, or
  at the end after a title line if the text is empty; an old one is replaced where it is). To keep
  positions somewhere else, pass `{ lines }` to `buildSchematic` and `{ drawingInText: false }` to
  `applyEdit`, and store `result.lines`; `stripDrawing` removes every drawing line.

## Keeping in step (`schematic.ts`, `reconcile`)

The netlist always wins. When the lines give positions: a renamed part keeps its position if the
place is free; a label whose node was renamed in the text names the new node; missing parts are
placed (the whole layout shifted onto the given positions when they agree with it; else one or two
next to their nodes, more laid out together beside the given ones). Then, in order: a part whose pin
sits on another node's pin moves; wires that join different nodes are cut where the odd pin touches
them; labels on the wrong node are moved or dropped, and each node is named once per piece of
copper (ground by its symbol); wires touching nothing and wire ends leading nowhere go (a labelled
end stays: a terminal); the pieces of each node are joined by the router (or, past a fixed amount of
searching or a search area over `MAX_ROUTE_CELLS`, by writing the node's name on each piece); a
circuit with ground gets a ground symbol if it has none; every node gets its name written once,
where it fits. `checkConnectivity` must then find nothing but `hidden` notes: the tests check it on
every example, fixture, corpus netlist and random circuit, with the model and with an independent
check that shares no code with it. A wire the router adds to join a node's pieces keeps clear of
other nodes' words but not of the node's own (its name, the words of the parts on it): the scene
places those again around the new wire, where a detour round them made re-routed wires snake.

Connectivity rules (`connectivity.ts`): wire ends and corners connect where they touch a wire or a
pin (a T); crossings do not; pins at the same point connect; ground symbols are all node 0; labels
with the same name connect; a junction dot goes where three or more ends, sides and pins meet.

## Editing (`edit.ts`)

`applyEdit(schematic, op, options?)` → `EditResult { ok, reason?, changes, text, drawing, lines, summary, notes, select? }`.
Operations: `add-part`, `add-ground`, `move-part` (with an optional `rot` and `mirror`: moved and
turned on the way, in one edit), `move-ground`, `rotate-part`, `mirror-part`,
`reverse-part`, `delete-part`, `delete-ground`, `add-wire` (between pins, ground pins or points on
wires; `via` for an exact route), `delete-wire` (a whole wire, one `segment` of it, or a `piece` of a
segment: the stretch between two points on it), `rename-node`, `move-label` (a new point and/or a
`side`), `set-side` (where a part's words go, or `'auto'`), `set-value`, `set-control`, and
`disconnect-pin` (one end of a part onto a node of its own, with a fresh name, in the part's line;
refused when that end is already alone on its node). The drawing keeps its lines, except where they
would still join that end to its old node: an end drawn pin-on-pin on another part's pin drops the
part's own `*@` line, so the layout draws it apart; a ground symbol on that end, with no wire there,
is removed. What each does to nodes is in the module comment. A refused edit (a place taken or off the grid, a pin on
another node, wires that would find no way, a half turn in place, an F or H with no source to read,
another version's drawing) returns `ok: false` and a reason in plain words. `notes` are what the
rebuild repaired; `select` is a part, a node, or a netlist line that still names something the edit
removed. Every sentence is in `EDIT_STRINGS`.

What the reviews of step B pinned down (`tests/unit/schematic-edit-review.test.ts`):

- **A move never changes the netlist**, the ground symbol's included: moved off its wire, the
  rebuild wires it to ground's copper (as it re-routes a moved part's wires), and a place no wire
  reaches is refused (`noWay`).
- **What the lines say is what the drawing shows.** `finish` reads the drawing back from the lines
  it writes and, where that reading repairs it again (a wire's dead end where a wire doubled back),
  writes the repaired drawing instead; and an edit whose rebuilt drawing would connect other than the
  netlist (a piece of a node left apart) is refused (`outOfStep`) rather than written. A drawing
  left with nothing on it (its last part deleted) takes its lines away, header and all.
- **Symbols are a body and thin leads** when placing: bodies keep apart from bodies and leads, a lead
  may not run along or across another, pins meet only pins. So a part may meet another end to end at
  a shared pin, in line or at a right angle; a wire may end at a pin but not cross a body or a lead.
- **A new wire keeps clear of other nodes' words, not of the words of the nodes it joins** (they
  are placed again around it), and never passes through the point another node's name is written
  at (the name would sit on a crossing of two nodes' wires; the rebuild's joining wires likewise).
  `wireRoute`'s later legs keep off the earlier ones, so a wire never doubles back at a corner.
- **Reverse swaps what the ends mean, not their words**: ground is written `0` (gnd at the end of
  a line is an ordinary node to ngspice, fact W9); a part on a node called gnd that is not ground is
  refused (`gndNode`), since swapped, gnd would become ground.
- **Which name stays when nodes become one**: ground, then a node a dot command names, then a name
  the student chose over one PlainSpice gave (n1, n2 ...), then the lower of two given names, then
  the first in the netlist; a node called gnd that is not ground never stays (it could not be
  written elsewhere).
- **`pinDrawing(text, options)`**: the text with its drawing lines written for the drawing it shows,
  read back until they agree. The Add a part form uses it when the circuit is drawn by hand, so a
  part it adds is placed in the same step and never moves when other lines are typed.

For the editor (decision 0017) the module also exports what it needs to show an edit before it is
made: `wireRoute(schematic, from, to, corners?)` (the route `add-wire` would take, or a point on the
paper for a wire on its way; each leg between corners may touch only the copper at its own two ends),
`freshNodeName` and `freshPartName` (the names a new node or part would get), `insertLine` (where a
new part line goes: before the analyses, the drawing lines and `.end`), `DEFAULT_VALUES` (a new
part's value) and `mergeChanges`.

## Keyboard and screen readers (`navigate.ts`)

`readingOrder` (top to bottom, then left to right), `neighbour(s, item, direction)` for the arrow
keys (part → the node at its pin that way; node → the part that way), `connections`,
`describePart` (the overview's own sentence from `src/spice/describe.ts`), `describeNode` (with
the parts on it the drawing does not show), `describeSchematic`. Words are in `NAVIGATE_STRINGS`
and `SCENE_STRINGS` for translation; descriptions never say anything about how SPICE behaves that
`describe.ts` does not already say.

## Tests and the lab

- `tests/unit/schematic-*.test.ts`: symbols and the scene, the circuit, layouts (every example,
  fixture and corpus netlist, an independent connectivity check, random circuits, a wider font),
  the format (limits, fuzzing, fields, versions, a round trip over every netlist, partial drawings),
  editing, navigation, routing, and the lab's own typecheck and lint (`schematic-lab.test.ts`, with
  `design/lab/tsconfig.json`).
- `tests/golden/facts-drawing.test.ts`: ngspice ignores the drawing lines.
- The lab: `npm run dev`, then open `/design/lab/` (add `?boxes` to see the room kept for words).
  `node --experimental-strip-types scripts/lab-shots.ts` writes `docs/design/lab/<name>.png` and
  fails if a drawing is not clean. Look at the images after changing the layout.

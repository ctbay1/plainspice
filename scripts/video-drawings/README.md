# The examples drawn as in their videos

Every example in [`examples/`](../../examples/) opens drawn the way its Solved Circuits video draws
it. The drawing travels in the netlist as its `*@` block (decision 0013, [docs/schematic.md](../../docs/schematic.md)
"The drawing format"), which ngspice ignores (drawing-1), so a share link or an export of an example
keeps the video's drawing too (decision 0016). The blocks are made here, in two steps:

1. **`record.py`** reads the channel's repository (`solved-circuits`, read only) and writes
   **`recorded.json`**: the geometry of every drawing the examples use, in the videos' own units
   (Manim units, y up), with the file and line each part comes from and a SHA-256 of each file read.
2. **`convert.ts`** turns `recorded.json` and **`plan.ts`** (which drawing each example uses, and
   every change, with its reason) into each example's block, written just before `.end`.

`recorded.json` is committed, so CI checks the blocks without the channel's repository
(`tests/unit/video-drawings.test.ts`).

## Record again (when the channel changes a drawing)

```sh
python3 -I scripts/video-drawings/record.py /path/to/solved-circuits scripts/video-drawings/recorded.json
python3 -I scripts/video-drawings/record.py --self-test
node --experimental-strip-types scripts/video-drawings/convert.ts --write
npx vitest run tests/unit/video-drawings.test.ts tests/golden
```

`git diff scripts/video-drawings/recorded.json` then shows what moved in the videos, part by part.

**Safe by construction.** The episode files are never imported or `exec`'d. `record.py` parses them
with `ast` and runs, with a small interpreter of its own, only the statements that draw: a circuit
function's own body (`circuit_ex1`, `circuit_e3_spice` ...) with the module constants and helpers it
uses, and, for what a scene draws itself (the 0 V ammeter of S6, a test source, the short-circuit
wire, the node names of a SPICE check), only the statements of that scene that build the named
objects (a backward slice of its `construct`). The interpreter knows numbers, strings, tuples, lists,
dicts, arithmetic, `if`, `for`, the episode's own functions and a fixed set of stand-ins (`P`, `Sch`,
`np.array`, `mk`, `VGroup`, `Line` ...); anything else (an import, `open`, `eval`, a dunder, a lambda,
a `while`, a method of a string or a dict) stops the recording with the file and line. `--self-test`
checks that, and the unit tests run it.

What is recorded (`SPECS` in `record.py`): SPICE for Beginners S6 (example 1, its node names, the
ammeter Vm), S7 (the dependent-source circuit, its four outputs, its node names) and S9 (the typo:
R2's lead moved off n2); p01's `circuit_e1` with the names S2 writes on it (v_1, v_2), `circuit_e2`
with the names S4 writes on it (v_1 to v_3, in a loop: the slice keeps a `for` or an `if` with only
the statements that write the names), and SK (example 3 with Vsense, its node names, the 0 beside
the ground wire); p02's `circuit_e1` with its own `test_source`, S4 (example 2 with its test source)
and SK (example 3, its node names, the 0 beside the ground wire, the short); e04's `circuit_e1`, S5
(example 2 and its short) and SK (`circuit_e3_spice`, its node names, the short).

## Convert

```sh
node --experimental-strip-types scripts/video-drawings/convert.ts            # check: exit 1 if a block differs
node --experimental-strip-types scripts/video-drawings/convert.ts --write    # write the blocks into examples/
node --experimental-strip-types scripts/video-drawings/convert.ts --report   # what each drawing is, its scale, gaps
node --experimental-strip-types scripts/video-drawings/convert.ts --only p02-4-open --report
```

For each example (`convert.ts` says how in its header):

- **Compose** the video's drawing as `plan.ts` says: the recorded pieces, parts the video itself
  replaces (`drop`), parts this netlist does not have (`absent`), copies side by side (`shift`, sp01-3),
  a 0 V source put on a lead (`inserts`) or in a wire (`inWires`), the typo's moved lead. Wire ends the
  video starts at a terminal's ring (0.085 off its point) join that point.
- **Match** each part to the netlist's: by name, else by kind and nodes (a diamond with + and − is an
  E or H, with an arrow an F or G; the video's node `gnd` is 0). Its nodes and polarity are checked:
  the + side of V, E and H is the netlist's first node; the arrow of I, F and G points to its second. A
  mismatch stops the conversion; it is never fixed silently.
- **Map** to the grid: x → round(k·x), y → round(−k·y), one scale k for both. Each symbol (4 units pin
  to pin) is centred on the video's segment, turned so pin 0 is the netlist's first node, wired to the
  segment's ends, its words on the video's side. Parts in series in a straight line, meeting at a point
  nothing else touches (Vm and R2, Vx and R1), share their segments, each as near as it can be to
  where the video draws it, with room between them for the name of the node there. Ground symbols go
  at the video's ground points, and a terminal is a label of its node at the wire end.
- **Name every node** (`nameNodes`): each name goes on the cheapest spot that touches nothing (no
  symbol, words, wire, junction dot or terminal ring) and reads as its own node's: its words nearer
  its own wires and leads than any other node's, by half a grid unit (`nameProblems`; a name under a
  resistor, or beside another node's wire, fails). The names the video writes go at its point and on
  its side when they fit; else on a spot turned as little as can be from that side, at a point of the
  node's copper as near as can be (up to 4 grid units). A name the video writes on the right never
  goes on the left: there the Notebook writes it at the far end of the room it keeps for the value,
  away from its point (see "What the format cannot say"). The nodes the video does not name go beside
  their own wire near where the model would write them, on the right where there is room. Last, for
  a phone held upright: when the turned view (`src/notebook/turn.ts`) has no room for a name, or
  writes one where it reads as another node's, that name tries its next clean spots (`turnFriendly`),
  kept only if the phone then shows the drawing better.
- **Choose k** (`chooseScale`): the smallest (from 2.5, the scale at which the symbols are the size the
  videos draw theirs, in steps of 0.05) at which the drawing is clean with the Notebook look's words
  and result room (`NOTEBOOK_OPTIONS`): no problem with the lines, nothing overlapping, exactly the
  netlist's connections, every part, wire, ground symbol and label kept where the converter put it,
  and every name reading as its own. Then up to 0.4 larger if that lets a phone held upright (a Pixel
  7, as `src/app/App.tsx` decides) show the whole drawing when it opens, and up to 0.1 larger if that
  keeps spans the video draws equal equal on the grid (e04 example 1's load midway between its
  sources). Examples that show one drawing of a video (`scaleGroup` in `plan.ts`: example 1 of SPICE
  for Beginners and its two mistakes drawn from it, a circuit and its version with Vshort) share the
  smallest scale at which all of them are clean, so the circuit keeps its size and place from one to
  the next. The block written is the model's drawing, so building it again changes nothing.
- The phone's view comes from `src/notebook/turn.ts` and the app's rule for turning a drawing
  (`src/app/App.tsx`, copied in `phoneView`): when either changes, run `--write` again (the unit tests
  say when a block is no longer what the converter makes).

What the format cannot say yet (`--report` lists it per example):

- The videos' terminal **b** at the end of the ground wire: a label must name its node, and ground is
  named by its symbol, so b is left out with the wire that only leads to it (p02 and e04 examples 2
  and 3: there the ground wire is b). When `src/schematic` reads a label's own words
  (`*@ label 0 14 6 name=b`, proposed), `convert.ts` notices (`LABEL_NAMES`) and writes the b
  terminals; run `--write` again then. For the same reason the **0** that four drawings write beside
  the ground wire as well as the ground symbol (SPICE for Beginners S6, p01 SK, p02 SK, e04 SK) is left
  out, and `--report` says so.
- A ring is drawn only at an open end, and at every node with one pin: where the video draws a's ring
  with a test source or the short attached, a is a name on the wire; where the video ends a lead
  plainly (sp01-3's unloaded outputs out1 and out4, sp01-5's n12), PlainSpice draws a ring.
- No spot is centred above or below a point: a name the video centres (a, out1 to out4, s2, nx) goes
  to one side.
- A name on the left of its point: the Notebook keeps room after a node's name for any value
  ("= −888.8 mV") and writes the pair where the widest one would end at the point, so a shorter value
  leaves a gap of 2 to 5 grid units between the words and the point (`src/notebook/Drawing.tsx`). The
  names the video writes on the left (s, m, n1 ...) keep their side; the change that moves the words
  up to their point is proposed for `src/notebook`, and needs no change to the blocks.

## Pictures

```sh
node --experimental-strip-types scripts/video-drawings/pictures.ts [--only <id>] [--port 5361]
```

Builds the app into a folder of its own, serves it with `vite preview`, opens every example from the
Examples menu and writes [`docs/design/video/<id>.png`](../../docs/design/video/): the video's drawing
(drawn from the recording; what the plan adds in magenta, what the netlist lacks in grey), then the
example on a computer (1280 × 800) and on a phone (Pixel 7, turned to fit when it turns, and as drawn).
`--quick` draws the model's scene itself instead of opening the app, for working on the converter:
each name with the room kept for its value (blue) and each part's result lines (green).

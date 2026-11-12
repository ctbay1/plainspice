# 0017. The schematic editor: place, wire, move, turn and delete on the drawing, by mouse, finger and keyboard

- Status: accepted (milestone 2, step B; the look and the canvas are Tarık's, decisions
  [0014](0014-the-look.md) and [0015](0015-notebook-canvas.md); the model is decision
  [0013](0013-schematic-model.md); the store and live runs are decision [0016](0016-the-app-shell.md))
- Date: 2026-11-11
- Code: `src/app/editing.ts` (the editing controller: what a press, a drag or a key would do, in plain
  TypeScript), `src/app/tools.ts`, `src/app/words.ts` (the hint line), `src/app/App.tsx` (wiring it to
  the store), `src/app/components/CardEdit.tsx` (the card's actions and Connections), `NodeCard.tsx`,
  `src/app/overlays/AddPartDialog.tsx` (the Add a part form), `src/notebook/EditLayer.tsx` (what is in
  hand, a wire on its way, the points a wire can end on), `src/notebook/NotebookCanvas.tsx` (presses,
  drags, taps); in the model, `disconnect-pin`, `wireRoute`, `freshNodeName` and `insertLine`
  (`src/schematic/edit.ts`, [docs/schematic.md](../schematic.md)); tests in
  `tests/unit/app-editing.test.ts`, `app-words.test.ts`, `app-store.test.ts`, `app-smoke.test.tsx`,
  `schematic-edit-disconnect.test.ts`, `notebook-canvas.test.tsx` and `tests/e2e/editor.spec.ts`

## Context

Step A drew any netlist and let a value be typed on the drawing; the part tools could be chosen but
said placing would come next. Step B is the editor: a beginner must be able to build Start here on a
blank page and change any circuit on its drawing, with a mouse, a finger, or only the keyboard and a
screen reader, and every change must be the netlist's (one text, one undo, live runs). The model
already had the edits (`applyEdit`: add, move, turn, mirror, reverse, delete, wire, rename, decision
0013); what was missing is how a person asks for them, sees what they will do before doing it, and
hears what they did.

## Decision

- **Every edit is the model's, through the store.** A press, a key, a card button or a form becomes
  one `applyEdit` operation (`editing.ts` chooses it); the text it returns goes into the store as a
  change from the drawing with a label ("R2 moved"), so it is one undo step, runs live, and is what
  Undo and Redo announce ("Undone: R2 moved."). A refused edit changes nothing and the hint line and
  the live region say the model's reason ("That place is taken by R1."). The model's summary of what
  happened to the nodes is announced after each edit ("Wire added. n1 and ground are now one node,
  ground.").
- **Seen before it is done.** A part in hand follows the pointer snapped to the grid, its pins marked
  where they land (filled where they would join a node, open where a new node starts), and the hint
  line says which nodes it would join or why it cannot go there, before the click. A wire on its way is
  drawn along the route the model would take, the points it can end on are marked and the one under the
  pointer ringed. A part being dragged is drawn where it would land with its wires re-routed and its
  results kept (previews at most once per animation frame); where it cannot go it is drawn in red and
  the hint says why.
- **Placing** (R, C, L, V, I, E, F, G, H, 0 for ground, from the toolbar, its keys, the phone's Parts
  sheet or Ctrl+K): a click places the part with its default value (`DEFAULT_VALUES`) and the next free
  name. Then the tool goes back to Select, the new part is selected and its card opens with its value
  selected, so "place, type 2k, Enter" is one movement; Shift+click places and keeps the tool, for
  several of the same. A controlled source chooses what it reads on its card (two nodes for E and G, a
  voltage source for F and H: the model's `set-control`). Ground goes on a pin (its node becomes 0);
  on a page with no parts it is refused with why.
- **A blank page comes out solvable.** The first part placed on a page with no parts and no analysis
  also writes `.op` (before the drawing lines) and `.end`, and the announcement says so in one
  sentence: ".op asks ngspice for the DC voltages and currents, so the circuit runs as you build it."
  The model writes the title line (`* circuit`) a SPICE file needs first. Start here built from a blank
  page by mouse, and again by keyboard, is solved by ngspice to out = 4 V (`editor.spec.ts`).
- **Turn, Mirror, Reverse**: T turns a quarter turn, M mirrors, Shift+R reverses, on the part in hand
  or the selected part; also on the card (each button says what it changes: Turn and Mirror "drawing
  only", Reverse "in the netlist", and the card's toolbar description says it in a sentence) and in
  Ctrl+K. A half turn in place, which the model refuses, is said as the model says it.
- **Moving**: drag a part, a ground symbol or a node's name; a press that moves less than 4 px (8 px
  for a finger) is a click; dragging the paper pans it. The drop is one undo step; a refused drop goes
  back and says why. From the keyboard, Shift+arrows move the selected item one grid step, and moves
  in a row are one undo step. Without dragging (WCAG 2.5.7), the card's Move picks the part up: a click
  or a tap puts it down (on a phone, Place), the arrow keys move it, Enter puts it down, Esc puts it
  back.
- **Wires**: the Wire tool (W): click a pin, a wire or a node's name, then another; clicks on the
  paper in between make corners; Esc drops the wire on its way, a second Esc goes back to Select.
  A piece of wire is selected with a click and deleted with Delete or Backspace (or its own Delete
  button, which a phone needs); the model says when a node splits ("Part of ground is now a separate
  node, n1.").
- **Without a pointer** (WCAG 2.1.1): the Add a part form (A, the toolbar's last button, Ctrl+K)
  takes a kind, a value and two nodes chosen from the circuit's nodes or "a new node" (named in the
  form), shows the line the netlist will get, and adds it (the model's `insertLine`: before the
  analyses, the drawing lines and `.end`); a card's Connections list each end with its node, and
  Connect to… (the other nodes, as buttons) and Disconnect (the model's new `disconnect-pin`) rewire
  it. A node's card (Enter on a node) renames it, and renaming it to a name another node has joins
  the two, as SPICE does; ground's card keeps its name and offers to delete its symbol.
- **Deleting**: Delete or Backspace, the card's Delete, or Ctrl+K. When a line still names what was
  deleted (a `.tf` naming V1, an F reading V2), the notice says which line and offers to open the
  Netlist panel at it. The focus goes to the node the part was on.
- **The keys work only while the drawing or the parts toolbar has the focus** (WCAG 2.1.4); a click
  on the paper gives the drawing the focus, so Delete works on a piece of wire just clicked. Each key
  is shown on its button, in the hint line, in Help (a table of the editing keys) and in Ctrl+K, which
  has every editing command by name.
- **One word for one idea**: Turn, Mirror, Reverse, Wire, Delete, Move, Connect, and "in hand" for a
  part about to be placed; the hint line always ends with the way out ("Esc goes back to Select").
- **On a phone**: the Parts sheet puts a part in hand; with no hover, the first tap shows where it
  would go and what it would join, and Place (or a second tap on it) places it. A finger on a part
  drags it, on the paper pans, two fingers zoom; a wire is drawn by taps; every action is a button on
  the card (at least 24 px). A drawing turned to fit the phone (decision 0015) is shown as drawn while
  editing, the hint says so, and "Turn to fit" is offered again.

## The keys, and why these

| Key | Does | Why this key |
|---|---|---|
| R C L V I E F G H | a part in hand | SPICE's own first letters, as the toolbar already showed |
| 0 | ground | SPICE's name for ground |
| W | Wire | the word; no part uses W |
| Esc | Select; stops what is in progress first | the way out everywhere in the app |
| A | Add a part (the form) | the word; no part uses A |
| T | Turn a quarter turn | R is Resistor, and Ctrl+R reloads the page; T is Turn's first letter |
| M | Mirror | the word; no part uses M |
| Shift+R | Reverse (swap the two ends) | "R" for Reverse, with Shift so it is not Resistor |
| Shift+arrows | Move one grid step | plain arrows already walk the drawing (decision 0013); Alt+arrows go back and forward in browsers |
| Delete, Backspace | Delete | a Mac's delete key sends Backspace; on a card only Delete (Backspace there is too easily pressed) |
| T, M, Shift+R, Delete on a card | act on the card's part, as its buttons say | the card's value opens selected: no value starts with those letters, so they act until a value is typed; then Esc closes the card and they act on the drawing |
| T, M while moving | turn or mirror the part being dragged or picked up | it lands that way, in one step with the move (Shift+R waits: it changes the netlist) |
| Enter | open the selected part's or node's card | as in step A |

## Considered

- **Staying in the tool after placing** (as LTspice does). A beginner would place a second resistor
  by accident with the next click, and every new part needs its value anyway; going back to Select
  with the value selected makes the common case one movement. Shift+click keeps the tool.
- **Writing `.op` silently, or not at all.** Without an analysis nothing runs and the drawing stays
  empty of numbers; written silently, the student would not know where `.op` came from. Written and
  said.
- **Dragging from the toolbar or the Parts sheet onto the paper.** A drag is hard with one hand on a
  phone and would need another way anyway (WCAG 2.5.7); click to choose, then click (or tap and
  Place) to put down works everywhere.
- **Alt+arrows or Ctrl+arrows to move.** Alt+Left and Alt+Right go back and forward in browsers, and
  Ctrl+arrows move by word or paragraph in text and in screen readers' reading modes. Shift+arrows.
- **A free-text node field in the Add a part form.** Typos would make new nodes silently; the form
  lists the circuit's nodes, ground first, and "a new node" with its name checked as it is typed.
- **Our own edits in the app.** Every edit stays the model's (`applyEdit`); the app only adds what a
  person needs around it (a preview, the starter lines, the words). The model got four additions,
  each tested (`disconnect-pin`, `wireRoute`, `freshNodeName`, `insertLine`); its existing behaviour
  and tests are unchanged.

## Consequences

- The netlist gets `*@` lines (decision 0013) as soon as something is placed or moved by hand; a
  part added with the form, or typed, is laid out automatically until then. Share links and exports
  carry the netlist exactly as it is, `*@` lines included, and a link opens the same drawing
  (`editor.spec.ts`).
- The drawing no longer jumps after an edit: the view is kept where it was until Fit (or another
  circuit), and a card opened by an edit is placed without panning.
- A part's card keeps its place while it grows (a refused value's words, its Connections shown) as
  long as it still fits there covering nothing, else it finds a new place.
- The view no longer pulls a selected item back into sight while the reader pans or zooms (it used
  to, and zoomed in past the item's size it could loop): the item is brought into view when it is
  selected, not on every move of the view.
- Known gaps (after the reviews, below): a node's name sits beside its pin with room kept for its
  result, so with no result yet it can look far from it; turning a part in a crowded drawing can put
  its words on a wire (the scene finds no free side); a piece of wire can be deleted but not dragged
  (moving a part re-routes its wires). Only Chromium was tested, and no real screen reader: both are
  on the plan.

## After the reviews of step B

Three reviews (interaction, accessibility, the netlist kept in step) tried step B hard. What changed:

- **Data never lost or changed behind the student's back.** A move's preview remembers the text it
  was made from: when the text changes while a part is in hand (typed in the Netlist panel, a fix),
  the preview is made again, and a drop never puts back an older text. T and M while a part is
  dragged or picked up turn it in the air (the model's `move-part` takes a `rot` and `mirror`), one
  step with the move. Moving the ground symbol never renames a node: a wire follows it. The folded
  `*@` block never swallows a line: Backspace or Delete at its edges, or typing over a selection
  into it, unfolds it instead, and it is not folded while the cursor is in it. A part added with the
  form to a circuit drawn by hand gets its `*@` line in the same step (`pinDrawing`). Reverse writes
  ground as 0 (gnd at the end of a line is not ground, W9). The model refuses an edit whose drawing
  would connect other than the netlist, and writes exactly the drawing it shows (no stub of wire the
  rebuild prunes).
- **Hand-drawn circuits stay square.** A new wire, and the wires the rebuild re-routes, keep clear
  of other nodes' words but not of the words of the nodes they join (the scene places those again);
  a later leg of a wire keeps off its earlier legs. A part may meet another end to end at a right
  angle. A click on a wire selects the piece between the places something joins it (junctions,
  corners, pins), outlined in ink, and Delete takes only that. With the Wire tool a click on a part
  means its nearer pin; a corner goes only where the wire can reach, and a way that cannot be drawn
  shows in red pen. A current source starts with its arrow up. When two nodes become one, a name
  the student chose stays over n1, n2 ..., and of two such names the lower.
- **Focus and keys.** One rule after every edit, undo, redo, closed palette and new circuit: once
  the drawing has caught up, the focus is where it was if that is still there, else on the selected
  item, else the first, else (a blank page) its Add a part, where A works too. A renamed node's card
  stays open, seen, with the focus in its name. Letters pressed on a card's buttons never switch the
  tool; T, M, Shift+R and Delete there act on the card's part. The card's value opens selected, and
  T, M and Shift+R act on the part until a value is typed (their keys then fade on the buttons, and
  the hint says to close the card first). Connections take the focus when they open. The toolbar's
  tab stop follows a tool chosen by its key; a tool chosen by its key gets the keyboard's words in
  the hint (Enter on a node). A part moved with the arrow keys stays in view above the bar of what
  is in hand, and where it is ("2 squares right and 1 square down from where it was: it can go
  here") is said once the keys pause. Keys that do nothing say why. The drawing is an application to
  screen readers (`role="application"`, "circuit drawing"), so NVDA and JAWS pass it its keys.
- **A finger pans unless it holds still** for 350 ms on a part's symbol (the part lifts, a phone that
  can buzzes); a part's words are no handle for a finger. A phone that turned the drawing to fit
  shows the whole drawing as drawn while editing. The phone's strip above the keyboard is for touch
  screens; the phone's layout on a laptop (large text, zoom) keeps the sheet, whose actions Tab reaches.
- **Calmer while building.** A run with no answers (a part not connected yet) keeps the circuit's
  last answers in pencil, "before your last change", as while ngspice runs; the red pen writes one
  note, about the part being worked on. A controlled source just placed says what it reads for now
  and is marked until the student chooses (its lists say which parts each node joins). Drawing-line
  problems (a `*@` line PlainSpice cannot use) are in the Checks panel with their line, and edits'
  notes ("the drawing lines of R2 ... were removed") are said.

Where the reviews were not followed, and why:

- **Focus on the card, not in its value, when it opens** (interaction 2). Opening on the value is step
  A's flow ("click R1, type a new value"; Enter opens the card on its value, one Esc closes it). The
  value now opens selected instead, so T, M and Shift+R act on the part as the buttons say until a
  value is typed, and a digit typed on the card's buttons or title starts a new value.
- **Never pan the drawing for a card** (interaction 3). The pan is decision 0015's (Tarık's): the
  card never covers the numbers it changes. What it broke is mended instead: the pan slides (instant
  where motion is reduced), a press just after a pan that a click caused is not taken, and a double
  click keeps the first click's place, so a double click on a value still opens that part's card.
- **No name on a pin connected to nothing** (interaction 13). Every node's name is its handle: its
  button for the keyboard and screen readers, an end for the Wire tool and Connect to. The name the
  student chose now stays over PlainSpice's, and of two given names the lower, so fewer gaps.
- **Choose what a controlled source reads by tapping the drawing** (interaction 9): not yet; it is
  said, marked in red pen until chosen, and its lists say which parts each node joins.
- **Drag a wire to tidy it** (interaction 15): not yet (a piece can be deleted and drawn again with
  corners; moving a part re-routes its wires). On the plan.
- **A new circuit's title** (`* circuit`, accessibility 15): a name for Tarık to choose.

Measured after the changes, with the model's own boxes: 1123 single turns, mirrors, reverses and
moves of every part of the 21 examples, of which 180 put words on other words, on a wire or on a
symbol where there were none before (174 before the routing change; the measure counts symbols too).
Turning a part in a crowded drawing is most of them (80 of 111 turns): the scene finds no free side
for its words. The wires themselves no longer snake (`schematic-edit-review.test.ts`), and random
edits on the examples keep the lines written exactly what the drawing shows and the drawing
connecting what the netlist connects (about 1500 edits checked while fixing; a seeded run in the tests).

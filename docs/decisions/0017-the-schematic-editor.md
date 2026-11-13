# 0017. The schematic editor: place, wire, move, turn and delete on the drawing, by mouse, finger and keyboard

- Status: accepted (milestone 2, step B; the look and the canvas are Tarık's, decisions
  [0014](0014-the-look.md) and [0015](0015-notebook-canvas.md); the model is decision
  [0013](0013-schematic-model.md); the store and live runs are decision [0016](0016-the-app-shell.md))
- Date: 2026-11-11
- Code: `src/app/editing.ts` (the editing controller: what a press, a drag or a key would do, in plain
  TypeScript), `src/app/tools.ts`, `src/app/words.ts` (the hint line), `src/app/App.tsx` (wiring it to
  the store), `src/app/card-edit.ts` (a value checked as SPICE reads it, for the card and the form),
  `src/app/components/CardEdit.tsx` (the card's actions and Connections), `NodeCard.tsx`,
  `src/app/overlays/AddPartDialog.tsx` (the Add a part form), `src/notebook/EditLayer.tsx` (what is in
  hand, a wire on its way, the points a wire can end on), `src/notebook/NotebookCanvas.tsx` (presses,
  drags, taps); in the model, `disconnect-pin`, `wireRoute`, `freshNodeName`, `insertLine`,
  `pinDrawing`, `readsWords`, `move-part`'s `rot` and `mirror` and `delete-wire`'s `piece`
  (`src/schematic/edit.ts`, [docs/schematic.md](../schematic.md)); tests in
  `tests/unit/app-editing.test.ts`, `app-words.test.ts`, `app-store.test.ts`, `app-smoke.test.tsx`,
  `app-card-edit.test.ts`, `schematic-edit.test.ts`, `schematic-edit-disconnect.test.ts`,
  `schematic-edit-review.test.ts`, `editor-api.test.ts`, `notebook-canvas.test.tsx`,
  `tests/e2e/editor.spec.ts` and `tests/e2e/editor-review.spec.ts`

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
  happened to the nodes is announced after each edit ("Wire added. Node n1 and ground are now one
  node, ground.").
- **Seen before it is done.** A part in hand follows the pointer snapped to the grid, its pins marked
  where they land (filled where they would connect to a node, open where a new node starts), and the
  hint line says which nodes it would connect to or why it cannot go there, before the click (or at
  once, when it can go nowhere yet: an F or H with no voltage source to read, ground on a page with
  no parts). A wire on its way is drawn along the route the model would take, the points it can end
  on are marked and the one under the pointer ringed. A part being dragged is drawn where it would
  land with its wires re-routed and its results kept (previews at most once per animation frame);
  where it cannot go it is drawn in red and the hint says why.
- **Placing** (R, C, L, V, I, E, F, G, H, 0 for ground, from the toolbar, its keys, the phone's Parts
  sheet or Ctrl+K): a click places the part with its default value (`DEFAULT_VALUES`) and the next free
  name. Then the tool goes back to Select, the new part is selected and its card opens with its value
  selected, so "place, type 2k, Enter" is one movement; Shift+click places and keeps the tool, for
  several of the same. A controlled source chooses what it reads on its card (two nodes for E and G, a
  voltage source for F and H: the model's `set-control`). Ground goes on a pin (its node becomes 0);
  on a page with no parts it is refused with why.
- **A blank page gets `.op` and `.end`.** The first part placed on a page with no parts and no analysis
  also writes `.op` (before the drawing lines) and, when the netlist has none, `.end`, and the
  announcement says why: "PlainSpice also wrote .op, which asks ngspice for the DC voltages and
  currents (the operating point), so the circuit runs as you build it. Keep .end as the netlist’s
  last line, with new lines above it: ngspice still reads lines after .end." (facts A1,
  no-analysis-1, missing-end-1, S25 and after-end-1: `.end` stops nothing). It never says who wrote
  `.end`, so it is true whether PlainSpice wrote it or the student had typed it. It does not make the
  circuit solvable: until a ground symbol is placed, the checks say there is no ground (no-ground-1).
  The model writes the title line (`* circuit`) a SPICE file needs first. Start here built from a blank
  page by mouse, and again by keyboard, is solved by ngspice to out = 4 V (`editor.spec.ts`).
- **Turn, Mirror, Reverse**: T turns a quarter turn, M mirrors, Shift+R reverses, on the part in hand
  or the selected part; also on the card (each button says what it changes: Turn and Mirror "drawing
  only", Reverse "in the netlist", and the card's toolbar description says it in a sentence) and in
  Ctrl+K. A half turn in place, which the model refuses, is said as the model says it.
- **Moving**: drag a part, a ground symbol or a node's name; a press that moves less than 4 px (8 px
  for a finger) is a click; dragging the paper pans it. The drop is one undo step; a refused drop goes
  back and says why. From the keyboard, Shift+arrow keys move the selected item one grid step, and moves
  in a row are one undo step. Without dragging (WCAG 2.5.7), the card's Move picks the part up: a click
  or a tap puts it down (on a phone, Place), the arrow keys move it, Enter puts it down, Esc puts it
  back.
- **Wires**: the Wire tool (W): click a pin, a wire or a node's name, then another; clicks on the
  paper in between make corners; Esc drops the wire on its way, a second Esc goes back to Select.
  A piece of wire is selected with a click and deleted with Delete or Backspace (or its own Delete
  button, which a phone needs); the model says when a node splits, naming the parts whose ends moved
  ("R2 no longer connects to ground: that end is now on a node of its own, n1."), and when no part is
  left on a ground symbol (the last one deleted, or the wires to it cut), that the circuit has no
  ground until one is connected again. While a piece is selected, Shift+arrow keys and Enter say why
  they do nothing to it (they would act on its node); a click on the node's name chooses the node and
  opens its card.
- **Without a pointer** (WCAG 2.1.1): the Add a part form (A, the toolbar's last button, Ctrl+K)
  takes a kind, a value and two nodes chosen from the circuit's nodes or "a new node" (named in the
  form), shows the line the netlist will get, and adds it (the model's `insertLine`: before the
  analyses, the drawing lines and `.end`); a card's Connections list each end with its node. Connect
  to… (the other nodes, as buttons) makes the end's node and the node chosen one node, with every
  part on them. It draws a wire from the end to the nearest point of that node the router reaches;
  for ground, when no wire can (a circuit without ground yet), a ground symbol at the end; failing
  both, it joins the two by name, as a node's card does (a node made ground gets a ground symbol on
  each of its pieces), and the summary says which. Disconnect (the model's new `disconnect-pin`)
  gives the end a node of its own; to move only one end, Disconnect it, then Connect to. A node's
  card (Enter on a node) renames it, and renaming it to a name another node has makes
  the two one node, as SPICE does; ground's card says why it keeps its name and offers to move or
  delete its symbol. The form checks its value as a part's card does: what SPICE reads it as, or why
  SPICE cannot use it, with the checks' fix ("4,7k: SPICE reads the comma as a space", Write 4.7k).
- **Deleting**: Delete or Backspace, the card's Delete, or Ctrl+K. When a line still names what was
  deleted (a `.tf` naming V1, an F reading V2), the notice says which line (its number in the netlist
  after the delete) and offers to open the Netlist panel at it. The focus goes to the node the part
  was on. A node is not deleted by itself: Delete on one says why and what to do instead.
- **The keys work only while the drawing or the parts toolbar has the focus** (WCAG 2.1.4); a click
  on the paper gives the drawing the focus, so Delete works on a piece of wire just clicked. Each key
  is shown on its button, in the hint line, in Help (a table of the editing keys) and in Ctrl+K, which
  has every editing command by name.
- **One word for one idea**: Turn, Mirror, Reverse (a part "reversed", its two ends swapped; never
  "turned round", which would also name the half turn the model refuses), Wire, Delete, Move, Connect
  (an end connects to a node), a part's "end", a node's "name", "in hand" for a part about to be
  placed, "dependent source" for E, F, G and H as one tool and one group (the channel's word, as in
  "Thévenin Equivalent with Dependent Sources"; each keeps its catalog name, "voltage-controlled
  voltage source" ...), "skips" for whole lines ngspice does not read (the `*@` lines, after fact
  drawing-1; "ignores" is kept for characters inside a line), and "node out" in sentences (a name
  may be an ordinary word: "Wire started at node s."); keys spelled one way (Ctrl+K, Shift+R, Esc,
  Shift+arrow keys). While a part is in hand or a wire on its way, the hint line ends
  with the way out, after a refusal too: on a computer "Esc goes back to Select" (or "Esc cancels this
  wire"), on a phone "Select goes back".
- **On a phone**: the Parts sheet puts a part in hand; with no hover, the first tap shows where it
  would go and what it would connect to, and Place (or a second tap on it) places it. A finger that
  holds still on a part's symbol for a moment (350 ms) lifts it and drags it; a finger that moves at
  once pans the paper; two fingers zoom; a wire is drawn by taps; every action is a button on
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
| Shift+arrow keys | Move one grid step | plain arrows already walk the drawing (decision 0013); Alt+arrows go back and forward in browsers |
| Arrow keys, Enter, Esc with something picked up by Move | move it a grid step, put it down, put it back | a card's Move (or Ctrl+K's) picks a part, the ground symbol or a node's name up without dragging (WCAG 2.5.7); Enter and Esc as everywhere |
| Delete, Backspace | Delete | a Mac's delete key sends Backspace; on a card only Delete (Backspace there is too easily pressed) |
| T, M, Shift+R on a card; Delete on its buttons | act on the card's part, as its buttons say | the card's value opens selected: no value starts with those letters, so they act until a value is typed (then they are letters: Esc closes the card first); in the value field Delete erases the value, so only the card's buttons take it |
| A digit, ., + or − on a card's buttons or title | start a new value in its field | as in a spreadsheet |
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
  Ctrl+arrows move by word or paragraph in text and in screen readers' reading modes. Shift+arrow keys.
- **A free-text node field in the Add a part form.** Typos would make new nodes silently; the form
  lists the circuit's nodes, ground first, and "a new node" with its name checked as it is typed.
- **Our own edits in the app.** Every edit stays the model's (`applyEdit`); the app only adds what a
  person needs around it (a preview, the starter lines, the words). The model got additions
  (`disconnect-pin`, `wireRoute`, `freshNodeName`, `insertLine`, then `pinDrawing`, `move-part` with
  `rot` and `mirror`, `delete-wire` with a `piece`, `readsWords`), and after the reviews some of its
  behaviour changed on purpose (below, and docs/schematic.md); its earlier tests pass, and where a
  test pinned a sentence or a line number the change corrected, it says so.

## Consequences

- The netlist gets `*@` lines (decision 0013) at the first edit made on the drawing or with a card's
  buttons (place, move, turn, mirror, reverse, wire, delete, rename, connect, choose what a controlled
  source reads), and the announcement says so, as the hint line does for a moment: "The netlist now
  also says where each part is drawn, in lines starting with *@ that ngspice skips, so the drawing
  stays as it is." (fact drawing-1). A part added with the form or typed keeps the automatic layout
  until then; a value typed on a card writes them only when the new value would move a part
  (decision 0016), and says so then. Share links and exports carry the netlist exactly as it is, `*@`
  lines included, and a link opens the same drawing (`editor.spec.ts`).
- The drawing does not jump after an edit: the view stays where it was, except that what was made or
  moved is brought into view clear of the bars, and a part added with the Add a part form (placed
  where the drawing finds room) is shown by fitting the drawing again; a card opened by an edit is
  placed without panning.
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
  of other nodes' words but not of the words of the nodes they connect (the scene places those again);
  a later leg of a wire keeps off its earlier legs. A part may meet another end to end at a right
  angle. A click on a wire selects the piece between the places something meets it (junctions,
  corners, pins), outlined in ink, and Delete takes only that. With the Wire tool a click on a part
  means its nearer pin; a corner goes only where the wire can reach, and a way that cannot be drawn
  shows in red pen. A current source starts with its arrow up. When two nodes become one, a name
  the student chose stays over PlainSpice's (n1, n2 ...), and of two of PlainSpice's names the lower
  number.
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
  screen readers (`role="application"`, "circuit drawing"), so NVDA and JAWS should pass it its keys
  (not yet tried with them).
- **A finger pans unless it holds still** for 350 ms on a part's symbol (the part lifts, a phone that
  can buzzes); a part's words are no handle for a finger. A phone that turned the drawing to fit
  shows the whole drawing as drawn while editing. The phone's strip above the keyboard is for touch
  screens; the phone's layout on a laptop (large text, zoom) keeps the sheet, whose actions Tab reaches.
- **Calmer while building.** A run with no answers (a part not connected yet) keeps the circuit's
  last answers in pencil, "before your last change", as while ngspice runs; the red pen writes one
  note, about the part being worked on. A controlled source just placed says what it reads for now
  and is marked until the student chooses (its lists say which parts each node connects). Drawing-line
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
  student chose now stays over PlainSpice's, and of two of PlainSpice's names the lower number, so
  fewer gaps.
- **Choose what a controlled source reads by tapping the drawing** (interaction 9): not yet; it is
  said, marked in red pen until chosen, and its lists say which parts each node connects.
- **Drag a wire to tidy it** (interaction 15): not yet (a piece can be deleted and drawn again with
  corners; moving a part re-routes its wires). On the plan.
- **A new circuit's title** (`* circuit`, accessibility 15): a name for Tarık to choose.

Measured after the changes, with the model's own boxes: 1123 single turns, mirrors, reverses and
moves of every part of the 21 examples, of which 180 put words on other words, on a wire or on a
symbol where there were none before (174 before the routing change; the measure counts symbols too).
Turning a part in a crowded drawing is most of them (80 of 111 turns): the scene finds no free side
for its words. The wires themselves no longer snake (`schematic-edit-review.test.ts`), and random
edits on the examples keep the lines written exactly what the drawing shows and the drawing
connecting what the netlist connects (more were run while fixing; the tests keep a seeded run: 144
edits made of 168 tried, on the 14 e04, p02 and p01 netlists).

## After the re-check of step B

The three reviews' findings were checked again on a clean build, item by item, with a fourth look for
what the fixes themselves broke and a fifth at the words and these documents. What was still wrong,
and what changed (each with a test that fails without it):

- **Nothing typed or kept out of sight.** The `*@` block shows while the cursor is at either edge of
  its folded line, so typing there, or Backspace or Delete next to it, acts on lines the student sees
  (it took a whole block, or hid the typing in its last line). The pencil numbers kept while building
  are only this circuit's: any change not made on the drawing (an undo past an opened example, typing,
  a fix) lets them go, and the status line says in words that the numbers in pencil are from before
  the last changes (not by their grey alone, WCAG 1.4.1).
- **The card: one rule for its keys, its badges and the hint.** In the value field, T, M and Shift+R
  act on the part only while the value is as it opened and all selected; once the caret is placed in
  it they are letters of the value (6m is 6 milliohms), the badges are struck through and the hint
  says to close the card first. Delete in the field edits the text (its badge is struck there), and an
  empty field says the netlist still has the old value. A click on the card's own paper keeps the
  focus on the card. A card says its own check once, and another part's as another line's.
- **What is drawn.** A turned part chooses its words' side again; a side stored for a part's words or
  a node's name (the video's or the student's) stays while it is free, and where an edit put
  something on it, goes back to automatic when that is freer, so the `*@` lines still store what is
  shown; words with no free side slide to the nearest free place. Turning a part of the videos'
  drawings now puts words on something in 22 of 108 turns (before: every turn); on the automatic
  layouts 50 (78 before). A wire between two pins on one line is the straight rail between them.
  A node's name cannot be moved where another node's wire crosses its own (random edits on the
  videos' drawings found it), and a node called gnd that is not ground (fact W9) keeps its own name.
- **Seen before it is done, and said after.** The Wire tool ends where its preview showed (a symbol's
  middle was a tie), and the hint names the two nodes a click makes one. A controlled source placed on
  the drawing stays marked in red pen, and listed in the Checks panel, until the student chooses what
  it reads. A refused drop says the part went back and why. An edit's notes are shown in the hint line,
  not only said. The view holds still while a part is moved (it zoomed out under a drag outwards).
- **Keyboard and screen reader.** Undo and Redo stay focusable when there is nothing left
  (aria-disabled) and say so. Connections scroll into view on a small window. A rename to the name a
  node has, and Backspace on a card, say why nothing happens. The skip link finds the blank page after
  a new circuit. Enter on the tool in hand keeps it. Ctrl+K ranks a command whose name starts with
  the words typed first. Struck badges keep full contrast; old current arrows are drawn in pencil.
- **Phone.** Undo is on the status line after a change made on the drawing; a status reason has a
  line of its own; the whole as-drawn view while editing says two fingers zoom in, and the turned view
  comes back when editing ends.
- **A slow device.** A tap or a click is acted on once, however long the edit takes. The click a
  browser sends after a tap was set aside only for 400 ms; on a busy machine (a slow phone, a loaded
  test run) it came later and was taken again: as a refusal on the part's button, or as a wire's end
  followed by a new wire (found when an end-to-end test failed once). Now the click that ends a
  gesture the editor took is set aside whenever it comes, and a click from the keys never is (Enter
  right after a tap was swallowed too). With the Wire tool, a click anywhere on a node's name (the
  value written after it too, which its button covers) means the node, as the name does; it was
  refused as no place to start a wire.
- **Words, and these documents.** Each sentence says what the netlist now has, one word for one idea.
  A line that still names a deleted part is given, and offered, by its number after the delete (it
  was the number before). A piece cut off a node names the parts whose ends moved, and when no part
  is left on a ground symbol (the last one deleted, or the wires to it cut) the sentence says the
  circuit has no ground until one is connected again (no-ground-1). "Connect" (not join, in the 0 Ω
  explanation too: "To make two nodes one, give them the same name"); a part's "end" in Connections
  and the form ("+ end", "end 1", where "node 1" meant an end); a node's "name" (not label); "node out"
  in sentences ("Node out renamed to in. A node called in was already there, so the two are now one
  node, in."). Every refusal says why and what to do: a place on a wire (for a ground symbol: only its
  pin may touch one), an F or H with no voltage source to read (said at once, without "Not here"),
  Delete on a node, T on the ground symbol (one answer for T in hand and placed), keys after Esc,
  Shift+arrow keys and Enter on a piece of wire (they would have acted on its node; a click on the
  node's name still opens its card), Reverse on a line ending with gnd (W8, W9), renaming ground (W8).
  The Add a part form checks its value as the card does, and shows the reason once. The first edit
  made on the drawing of a netlist without `*@` lines says it wrote them (drawing-1). T, M and
  Shift+R on the part in hand are said; a controlled source just placed says what it reads in its
  Connections' words. Help has every editing key and says the screen-reader behaviour is not yet
  tried; Ctrl+K moves the ground symbol and a node's name; key names are spelled one way (Ctrl+K's
  Delete too). With Connections open the hint says what can be done there; Undo with nothing left,
  and Esc (even with nothing left to let go of), replace an older refusal or an edit's note in the
  hint line; a refused wire end ends with the way out, on a phone "Select goes back".

Still open, on the plan: dragging a piece of wire; choosing what a controlled source reads by tapping
the drawing; the phone's layout used with a keyboard and a mouse (large text on a laptop) gives touch
words; automatic node names keep their numbers (n1, n4) when nodes merge; real screen readers and
browsers other than Chromium.

## After the final reviews (12 November 2026)

- **The first part on a blank page shows why .op and .end were written**, first in the hint line, not
  only in what is said (words W9; the sentence is `starterAdded`, the words lane's), and holds it there
  until it can have been read. (Held as the drawing note, it went at the first pointer move after
  1.5 s, after 6 s at most, and a phone never showed it: the critic of W9.) The hold is its reading
  time, 60 ms a character, about 170 words a minute (never less than a refusal's 6 s; about 19 s for
  the sentence and the drawing note together), counted only while the hint line shows it: on a phone
  the new part's card opens as a sheet in the hint line's place, so the time starts when the sheet
  closes (`src/app/hint-note.ts`). It shows with a part still in hand too: Shift+click keeps the tool,
  as the hint line offers, and the why shows at once, as after a plain click (the second critic of W9:
  placed that way, it was never shown). Moving the pointer, typing the new part's value, another change
  with nothing to say (another part placed with Shift+click), going back to Select (Escape, Cancel, the
  Select tool, or the click that places the last part), and closing or stopping something, with Escape
  or with its own button (the card, a panel, a sheet, a part being moved), leave it in place. A change
  with a note of its own, a refusal, another tool chosen, Undo or Redo, another circuit opened, or the
  Escape that lets go of the selection (or has nothing left to stop) takes it away at once: the student
  is done with it. An Escape typed in the netlist editor is the editor's, and leaves it. (An Escape that
  closed a panel, such as the Netlist panel opened to look at the new lines, or put back a part being
  moved, took it away unread too.)
- **A new node never takes a name the circuit had** (student node-name-reused: right after "Node n2 is
  now ground", a resistor on empty paper got node n2 again, which reads as grounded). New nodes skip
  every node name in the circuit's undo history: the texts Undo can go back to since the circuit was
  opened (an example, a link, a new circuit), and the text now (the store's `circuitTexts`). Not the
  steps Redo would bring back: after undoing a part, the next one takes the names it had. The model's
  `freshNodeName` reads these names from the drawing's options (`usedNodeNames`); the app passes them
  with every drawing it edits.

The words review of the final reviews found sentences that said something other than what happens.
What they say now (`src/i18n/en.ts`; `tests/unit/app-words-review.test.tsx` and
`tests/e2e/words-review.spec.ts` check each):

- **.end in the blank page's sentence** (W1). It said .end "marks where the netlist stops", but
  ngspice still reads the lines after .end (S25, after-end-1; native ngspice 47 and 42 give V1
  −12 mA with a 1 kΩ resistor written after .end, −6 mA without it). It also said PlainSpice wrote
  .end when the student had typed it (a page with a title and .end only gets .op alone: the critic
  of W1). Now: "PlainSpice also wrote .op, … so the circuit runs as you build it. Keep .end as the
  netlist’s last line, with new lines above it: ngspice still reads lines after .end.", as Explain's
  .end line ("Keep .end as the last line.") and the missing-end check say it, and true whoever wrote
  .end. One sentence for both: telling them apart would take `starterWords` in `editing.ts`, which
  the hint line of words W9 also shows, not the words alone. Nothing about other SPICE programs: no
  fact here backs a claim about them.
- **Connections** (W2). Connect to makes the end's node and the chosen node one, every part on them
  included (on Start here, end 2 of R1 connected to ground shorted R2), while the hint line said it
  "rewires an end". The card's intro, the hint line and the buttons now say what happens and how to
  move one end alone: "Connect to… makes an end’s node and another node one node, with every part
  on them. To move only one end, Disconnect it first, then Connect to." (the hint line: "Connect to…
  makes an end’s node and another node one node · Disconnect gives an end a node of its own · …").
  They say what always holds and not how it is drawn: a first wording, "draws a wire from an end to
  another node", was untrue for ground in a circuit without one, where no wire can reach and the node
  is made ground by name, with a ground symbol (Mistake 1: no ground; 8 of 900 Connect to's over the
  examples and fixtures, all of them that case, drew no wire: the critic of W2). The button is named
  "Connect to another node: the node at the end 2 of R1" (its own words first, WCAG 2.5.3) and its
  list "Connect the node at the end 2 of R1 to …". Not done here: a check for a resistor with both
  ends on one node (only sources are checked).
- **Dependent source** (W4). E, F, G and H as one tool, its menu, the phone's Parts sheet and the
  Checks panel say "dependent source", the channel's word, as the examples and the model's refusals
  already did; each keeps its catalog name ("voltage-controlled current source").
- **Reverse, and turning while moving** (W7). Shift+R on the part in hand is "A resistor in hand,
  reversed: its two ends swapped." ("turned round" also named the half turn the model refuses); M or
  Shift+R on the ground symbol in hand, "A ground symbol has one end and looks the same mirrored: T
  turns it."; T or M on a part being moved says "R1 turned." or "R1 mirrored." and the sentence after
  it says whether it can go there (it said "it lands that way" before a refusal); the ground
  symbol's hint over empty paper keeps one colon: "it touches nothing yet (draw a wire to it)".
  Shift+R on a part being moved says "Put R1 down first (Esc puts it back), then Reverse swaps its
  two ends in the netlist.", as Delete does, where the part can go. Where it can't (a half turn where
  it stands, which the refusal answers with "use Reverse once R1 is back in place", decision 0013; a
  place taken), both say so instead of asking to put it down there: "R1 can’t go here: Esc puts it
  back, then Reverse swaps its two ends in the netlist." and "…, then Delete deletes it." (words
  re-check 11: until then Shift+R said "Put R1 down first" beside the hint's "R1 can’t go here"). The
  sentence follows the move's preview, made again when the one drawn is of an older place, turn or
  text, as Enter's is, so a key pressed before the next frame gets the right one. Delete on the ground
  symbol in hand says the same with its name in lower case where it does not start the sentence: "Put
  the ground symbol down first (Esc puts it back), then Delete deletes it." (it said "Put The ground
  symbol": critic of the fix), and "The ground symbol can’t go here: …" where it can't go.
- **"node in" on the card** (W8). The card's "in is higher", and its spoken "2 volts across R1, in is
  higher", say "node in is higher" ("ground is higher" for ground). The short line under a current
  stays a label, "from in to out", as the drawing writes "in = 6 V". The Disconnect button was
  "Disconnect the end 1 of R1 from in", then "…from its node, in": either ends on a bare name, heard
  as "from (its node) in…". It is now "Disconnect the end 1 of R1 from node in" ("…from ground (node
  0)" for ground): the card passes each end's node as a sentence says it (`PartEnd.said`, from
  `nodeSaid`), not as its list writes it (done when the lanes were merged).
- **"skips"** (W11). Whole lines ngspice does not read are lines it "skips", in the Netlist panel's
  foot and the README as in the hint line and the Checks panel; "ignores" stays for characters inside
  a line (a unit after a number).
- **Thévenin** (W12). The basics' F5 is "Thévenin resistance with a dependent source", as the channel
  spells it, in the Examples menu, Ctrl+K and "Opened the example …", so Ctrl+K finds it with the
  video's examples; the .tf words (the output resistance in the results, what is said, and Explain's
  .tf line) say "the Thévenin resistance" too (done when the lanes were merged). Known gap: the title line of its netlist (`tests/fixtures/f5-thevenin-cccs.cir`)
  still says "Thevenin", and F5 opened from the menu shows that line as the page's heading and the
  drawing's name ("F5: Thevenin resistance with a dependent source (test source method)"). The
  fixture stays as it is (the golden runs record it, and the published F5 link decodes to it); an
  accented title line for F5 opened as an example belongs to `src/app/examples.ts`, not done this
  round.
- **"node out" in the model's sentences too** (words review W8). The circuit overview, the drawing's
  part descriptions, the cards and the run summary are built from `DESCRIBE_STRINGS`
  (`src/spice/describe.ts`), and its templates now write a node the way the editor does: "R1: a 1 kΩ
  resistor between node in and node out.", "3 A from node n1 to ground through R1", "Simulation
  finished: node in is 6 volts"; ground stays "ground". The templates add the word; a page that
  builds a sentence from them passes the name through `sentenceNode` first (`src/schematic/navigate.ts`,
  `src/app/card.ts`, `src/notebook/NotebookCanvas.tsx`), so it says it the same way (words re-check 2:
  the node's own sentences, its description on the drawing and its card, said the bare name, "in is 6
  volts", until then). Left bare, because they are not sentences: the short notes at the end of netlist lines
  ("3 A, n1 → 0"), the value beside a node's name on the drawing ("s = 12 V") and the names listed after
  the counts ("2 nodes besides ground (in, out)"). After the critic of this fix: a terminal at ground
  loses the word "node" ("D1: a diode (+ node a, − side at ground)", as the V sentence says "its − side
  at ground"; "from ground"), and a subcircuit's nodes read as one list ("X1: a subcircuit (node a and
  ground, subcircuit sub1)"). A node named like ground that is not ground (ground, W13; gnd as an
  ordinary node, W9; 00, W14) is quoted, as Explain quotes it, in the words `describe.ts` alone builds:
  the run summary ('node "ground" is 5 volts'), the currents ('5 mA from ground to node "ground"'), the
  notes, the sweep and .tf words, the rounding-noise note and the names after the counts. The part
  sentences of the overview are also built by `src/schematic/navigate.ts`, and a test holds the two to
  the same words; both pass the word "ground" for ground. When the lanes were merged, navigate.ts took
  the overview's own sentence (`partSentenceFor`), and `src/app/card.ts` and `src/notebook/words.ts`
  pass node names through `sentenceNode`, so the drawing's descriptions and the card quote such a name
  too: 'R1: a 1 kΩ resistor between node "ground" and ground.', 'node "ground" is higher'. Explain's
  own sentences say it too (also done when the lanes were merged): "R1 is a 1 kΩ resistor between
  node in and node out.", "Ground is 0 V, so node in sits at 6 V.", "So node a sits 3 V above node
  b.", and the field rows "one end is at node in". Formulas keep each name as written ("SPICE reads
  that as V(in) − V(0) = 6 V"); ground stays "ground (node 0)" ("ground" in the sentences after a
  formula: "flowing from ground, through G1, into node c"); a name like ground stays quoted (the node
  "ground"); a label that already says node keeps the name alone ("D1 is a diode: + node a and − node
  ground (node 0)"), a name like ground quoted on its own ('+ node "00"', never '+ node the node "00"':
  words re-check 5), and other labels say where ("collector at node c").
- **The missing-end check says what the blank page's sentence says** (words review W1): .end is the
  netlist's last line, new lines go above it, and ngspice still reads lines written after .end
  (missing-end-1, after-end-1, S25); nothing about other SPICE programs, which no fact here backs.

The words re-check of the merged fixes found sentences that still named a node another way than the
ones beside them (`tests/unit/words-recheck.test.ts` and `tests/unit/app-words-recheck.test.tsx`
check each; decision 0016 has the names outside ASCII, decision 0012 the characters that are not
what they look like):

- **"node1", never "node node1"** (words re-check 4). The word "node" goes before a name because a
  name may be an ordinary word, but not before a name that already says it is a node: one rule,
  `nameSaysNode` in `src/spice/node-words.ts` (the name starts with "node" and goes on: node1,
  Node_A, nodeB), which each page's own template applies, so a translation keeps its own word:
  `DESCRIBE_STRINGS.node`, `labelled`, `EXPLAIN_STRINGS.nodeWord`, `labelledNode`, `EDIT_STRINGS.node`
  and the app's `nodeInSentence` (Connections, the card, the hints, Ctrl+K); the .tf check says it the
  same way (".tf asks about node5, which is not in the circuit"). So "node1 is 6 volts",
  "between node1 and node2", "+ node1", "Type a new name for node1", "Rename node1", and at the start
  of a sentence the name keeps its own letters ("node1 connects V1 and R1.", never "Node1"). A node
  called just "node" keeps the word ("node node is 6 volts"), or nothing would say what "node" is.
  Kept as labels, a kind and a name: the node's button on the drawing and its card's title ("Node
  node1", as a part's is "R1, resistor"). Not changed here (another lane's, or rare): the check "R1 has
  both ends on node …", and the notes about drawing
  lines PlainSpice moved or dropped ("The name of node … was moved onto its node's wire").
- **A node named like ground is quoted wherever the editor says it** (words re-check 3), as the
  model's sentences do: the Disconnect button ('Disconnect the end 2 of R1 from node "ground"'), the
  editor's sentences ('R3 added between node in and node "ground"', the joins), and the rename
  summary, which says such a name is an ordinary node, in Explain's words: 'Node out renamed to
  "ground", an ordinary node name: only 0 and gnd are ground (node 0).' (ground, GROUND and 00, W13,
  W14; gnd is ground, and says so: "Node out is now ground (node 0)").
- **The .tf words name each output node one way** (code review 1, 4, 5; words re-check 3). The .tf
  reading carries its output nodes as the parser reads them (`outputNodes`): a gnd before ')' or ','
  is ground, as ngspice makes it (A3b: `.tf v(out,gnd) V1` is v(out,0), even beside an ordinary node
  called gnd), so the text, the speech and Explain say "between node out and ground", never "node
  gnd" nor 'node "gnd"'; an ordinary node named like ground is quoted in the text and the speech alike
  ('the output resistance at node "ground"'; Explain: 'at the node "ground"'), where the text said "at
  ground", the word for node 0, and so is it in the .tf check when no part connects to it ('.tf asks
  about node "ground", which is not in the circuit'); and a .tf written after .end, which ngspice runs (S25, A3c) but
  PlainSpice does not read as a dot command, takes its nodes from ngspice's own name for the output,
  as the netlist writes them: "between node out and node mid", "at node çıkış", never "at node
  v(out,mid)"; its source is named as written ("V1"), and so is the part a current output reads
  ("i(Vm)", "the current in Vm", never "the current in i(vm)": A3e), and the input's kind comes from
  that part's letter, so a current source gives V/A or A/A after `.end` as above it (A3d: "1 volt per
  amp, which is an ohm", where it said "1 volt per volt"; critic of the fix). The .tf check never offers "Use gnd" for a
  typo of an ordinary node called gnd: written in v( ), gnd is ground (`.tf v(gnd) V1` gives
  output_impedance_at_V(0), A3b), so the fix would measure ground; a name like ground is offered
  quoted ('Use "ground"'). After the second critic of the fix: a .tf in a subcircuit no X line uses,
  which ngspice skips (A3f: it ran the .tf after .ends, whose 0.5 and 500 Ω were labelled
  "Transfer function v(a,gnd) / V1"), is left out of the .tf words, the check, the missing-node
  message and the overview's analyses, and Explain says that ngspice skips it (so for a .op, .dc,
  .tran, .ac or .noise line there, which A3f ran too); in a subcircuit an X line uses, ngspice runs the
  line as the main circuit's, so it is
  read as before. A .tf after .end is checked as one above it is, and its words take its nodes from
  that line as written when ngspice spells them otherwise ("node out (written with a zero-width space
  in it)", never "node ou___t"). The .tf box and the Numbers panel's .tf table say a ratio of 1 in the
  singular, "1 volt per amp", as the live region does, where they said "1 volts per amp".
- **A node name with a letter outside a to z** (words re-check 9). The card's rename and the Add a
  part form keep node names to the letters a to z (or A to Z), digits and _, and now say it in those
  words, the non-ascii-node check's ("PlainSpice keeps node names to letters" refused çıkış, whose ç,
  ı and ş are letters). For such a letter the refusal gives the why in the check's words and the name
  in plain letters, which the card then takes: 'ngspice writes each letter other than a to z (or A
  to Z) in a node name as underscores (ç as __), so PlainSpice can't use "çıkış": ngspice would call
  it ____k____. Write cikis.' (W16). The suggestion is never a name another node already has, nor 0,
  gnd, ground or 00, which would join it to ground or set off the ground-misnamed check: a number goes
  after it (cikis2, gnd2 for gñd). The micro sign has its own why (ngspice reads µ as u: "Write au."),
  and beside another such letter both are said, as the non-ascii-node check says them ("ngspice reads
  the micro sign µ as u and writes the other letters outside a to z (or A to Z) in a node name as
  underscores (ş as __), so PlainSpice can't use "şµ": ngspice would call it __u. Write su.", where the
  rule said only underscores: critic of the fix),
  a look-alike letter is named as the checks name it, and a hidden character is named, never shown in
  quotes. `badNodeName` in `src/schematic/edit.ts`, PlainSpice's own rule; the check's fix
  (`freeNodeName` in traps.ts) is another lane's.
- **A source with a negative value** (words re-check 12). Explain said "So node a sits −3 V above node
  b." for `V2 a b -3`, a signed statement a beginner reads backwards; it says the size and the word
  that fits, "So node a sits 3 V below node b.", as the card says the size and which end is higher,
  the formula before it keeping the sign ("V(a) − V(b) = −3 V"). A current source with a negative value
  is said the way its current flows: "Its value is negative, so the current flows the other way: I1
  pushes 3 mA from node a, through the source, into ground (node 0)." (P3 and P4 now run both.) The
  overview and the drawing's description of the part say it the same way, "I1: a −2 mA current
  source: its value is negative, so it pushes 2 mA from ground into node a.", where they said "pushing
  current from node a into ground" beside Explain's sentence (critic of the fix). Those sentences are
  about the source's value, and the second critic of the fix found them where no run uses it: a
  current source that .dc sweeps is said as a swept voltage source is ("I1: a current source pushing
  current from node a into ground, swept by .dc."; Explain: "The .dc on line 4 sweeps this source, so
  in that analysis its value changes.", P4b, where at 5 mA the current flows from a into ground), and a
  value beside a transient function is said to be .op's, since .tran follows the function from time 0
  ("In .op the source has that value; in .tran it follows its SIN from time 0 instead."; the overview:
  "so in .op it pushes 2 mA", P3b, P4c), for a voltage source too ("So node a sits 3 V below node b"
  was true of .op only); a 0 V source with a SIN is no ammeter there.

Two of the pointer's ways went wrong when the page drew late (end-to-end tests on a busy machine, load
10 to 20 on 4 cores, and a quick hand). Each has a test now that sends the events in the order a busy
page meets them, and fails without the change (`tests/e2e/editor.spec.ts`):

- **A click acts on where the pointer is, not on the last preview drawn.** With the Wire tool, a click
  on a part's symbol takes the end its preview showed (at the symbol's middle both ends are about as
  near, and the pointer's last move chose). The preview is drawn a moment after the move; when the
  press came first (a busy page, or a quick move from one end of a part to its other end and a click),
  the wire started at the end the pointer had left, and the hint offered to join two nodes ("Click to
  end the wire here: node n4 and node n6 become one node"). The end is now found from where the
  pointer last moved, kept as it moves, not from the preview the page last drew.
- **A double click on a part's words opens its card on the value, wherever the card comes to rest.**
  The first click opens the card beside the part and the page moves the drawing to make room (55 ms
  after the press on a quiet machine). Where the card came to rest under the pointer (R2's value on
  Start here, at 1280 × 800), the second click landed on the card's title, took the focus from the
  value, and the double click was lost: at a hand's pace on a quiet machine, at once on a busy one. Now,
  for about a double click's time after a move a press caused (450 ms, `PAGE_MOVE_QUIET_MS`, counted
  from the move to the next press's own time, not to when a busy page got to it), the card lets a press
  through to the drawing, which sets the press aside and gives the double click the first click's
  place, as it already did for a press on the drawing. A move is a press's doing when no other press
  and no key came between them, however long the page took: a time limit (250 ms) took a slow
  machine's move for nobody's, and the second click was then taken where the drawing had slid to.
  Considered: a card that never comes to rest under the pointer; its place is decided by the drawing
  and the window (decision 0015), and a keyboard opens it with no pointer at all.

## After the last pass (13 November 2026)

- **The checks name a node by the node-words rule too** (last pass F6). The trap checks' titles, whys
  and fixes named nodes bare, unlike every other sentence on the page: the status line said "A check
  found an error: in has no DC path to ground." and the Checks panel "nothing connects in to ground"
  and "Add a 1 GΩ resistor from in to ground", while the Numbers panel just below said "Node in has no
  DC path to ground". `src/spice/traps.ts` now says each node the way `describe.ts` does (`nodeIn`,
  `nodeSaid`: `nameSaysNode` and `atSentenceStart` from `src/spice/node-words.ts`, the name as
  `nodeWords` shows it): "Node in has no DC path to ground", "nothing connects node in to ground",
  "Add a 1 GΩ resistor from node in to ground", "node1 and node x have no DC path to ground" (never
  "node node1"), 'Node "ground" is not ground: ground is node 0', "V1 has both ends on ground", "Only
  R2 touches node n12 … Did you mean node n2 or node n1?", "Make node b the ground (rename it to 0)",
  "Rename node n12 to n2", "Node ş and node ç are one node for ngspice", "Take it out: connect to node
  out", "Connect to node out", in floating-dc, current-source-no-path, no-ground, ground-misnamed,
  dangling-node, voltage-loop (a part with both ends on one node, which said "node node1" for such a
  name) and the checks of names outside a to z, the micro sign, hidden characters, characters that look
  like a space and look-alike letters. Kept as they were: the sentences that already say "the node …"
  ("ngspice spells the node çıkış as ____k____"; a name that says node goes alone there too), the words
  a fix writes ("Rename node n12 to n2" names the new name bare, as the editor's "Node out renamed to
  IN" does), the names inside ngspice's quoted messages ("check node in") and a name as written in plain
  ASCII where a check showed it so ("Only R3 touches node OUTT"). The .tf check, already so, is the
  subcircuit lane's. The rename buttons say "node" too ("Rename node n12 to n2", 'Rename node "ground"
  to 0'), as the editor's own rename and Disconnect buttons do ("Rename node1", "Disconnect the end 1 of
  R1 from node in"), where the skeptic of the problem would have kept them bare as words to write
  ("Rename n12 to n2"): the name after "to" is the text written, the one before it a node. So decision
  0016's examples of these checks now read "Node ÇIKIŞ has no DC path to ground", "Did you mean node
  ÇIKIŞ?" and "Rename node ÇIKIŞS to ÇIKIŞ". The editor's refusal to reverse a part whose line ends
  with gnd quotes the Checks panel's button, so it follows it: 'Rename node "gnd" first: the Checks
  panel says why and offers “Rename node "gnd" to 0”.' (`src/schematic/edit.ts`, decision 0013's W10).
- **gnd at the end of a line** (the words lane's round-1 critic, C2). The why said "As the last word,
  it is an ordinary node, node "gnd""; it now names the word as written, then the node it makes: "As the
  last word, gnd names an ordinary node, node "gnd", so this part is not connected to ground", with the
  word as it is written (GND stays GND).

The last pass before the release found four problems with `.tf` and the other analysis lines inside
subcircuits, and with the word for lines ngspice skips (`src/spice/explain.ts`, `src/spice/describe.ts`,
`src/spice/traps.ts`; `tests/unit/last-pass-subckt.test.ts` and `tests/golden/facts-explain.test.ts`
check each, A3f to A3h in `docs/spice-facts/explanations.md`):

- **`x1.m` is a node** (code review C3-6). ngspice names a node inside a subcircuit by the X lines that
  lead to it and a dot, in lower case (`x1.m`; `x1.x2.m` for X2 inside X1's subcircuit, and `x1.n` for
  that subcircuit's own n), and `.tf v(x1.m) V1` measures it: 0.5 and 500 Ω in native 47 and 42 (A3h).
  PlainSpice looked such a name up among the main circuit's nodes only, so it gave an error ('.tf asks
  about node x1.m, which is not in the circuit'), the status "check" and a warning that the right
  numbers meant nothing. `innerNode` now reads the name back the way ngspice builds it (the X lines of
  the main circuit, those after a plain `.end` too, then each subcircuit's own X lines, then a node of
  that subcircuit's own lines that is not on its `.subckt` line and not ground), and the .tf check, the
  .tf warning and Explain's note take it as a node. Explain says which node it is: "x1.m is ngspice's
  name for node m of the subcircuit div (from line 4), inside X1: ngspice names a node inside a
  subcircuit by its X line, then a dot." The .tf words keep the name as written, "at node x1.m", as the
  `.op` words name the same node (`node x1.n = 6.25 V`): one name for one node. A dotted name that is no
  such node keeps its error, as ngspice makes it a new node with nothing on it (0 and 1 Ω): `x1.a` for
  a node of the `.subckt` line (that node is the X line's own, `in`), `x2.m` where X2 is only a line
  of a subcircuit no X line uses, and `x1.vdd` for a node a `.global` line names, which is the main
  circuit's. The skeptic of C3-6 found the same for parts: ngspice names Vs inside X1 `v.x1.vs`, after
  its first letter, and a `.tf` takes it as its input or its `i( )` (0.3333 and 3.333e-4 A/V), where
  the check said ngspice stops ("Transfer function source v.x1.vs not in circuit"). `innerPart` reads
  such a name back, so the .tf check takes it as that part, the input's kind (V/A for `i.x1.is`) and
  its line come from it, and Explain says which part it is. `x1.vs` is no part's name and keeps its
  error. Not done: telling the student that `x1.a` is node in, with a "Use in" fix; the error says what
  holds.
- **gnd in a used subcircuit's `.tf` is ground** (regress-2). ngspice turns gnd into 0 on every line,
  the subcircuit's lines included, before it runs such a `.tf` as the main circuit's (A3g: `.tf
  v(out,gnd) V1` there is `v(out,0)`, 1/3). The parser files no node for the words of a line inside
  `.subckt` … `.ends` (a subcircuit's nodes are its own), so the .tf reading took that gnd for an
  ordinary node: 'between node out and node "gnd"' and the warning '"gnd" is not a node of the
  circuit … these .tf numbers mean nothing' under the right 0.3333. Explain now reads those words as the
  parser reads the same line in the main circuit (`subcircuitWords`: the line and its continuation lines
  parsed alone), so gnd is ground there by the parser's own rule (`gndIsGround`), and the text, the
  speech, Explain and the warning say "between node out and ground", as for the line above `.subckt`.
- **The summary names the warnings it counts** (regress-2). It said "2 warnings:" and named the first
  ("2 warnings: a is not a node of the circuit."), in the Numbers panel and in what the polite region
  says after a run. It now names them as it names the nodes (decision 0010): the first four, joined by
  semicolons since a title may hold a comma, then how many more ("6 warnings: R1 is too small for
  ngspice; …; R4 is too small for ngspice; and 2 more warnings."). The skeptic of the problem found this
  older than the regression and asked to leave it; it was kept because the count and the names
  disagreed for every run with two warnings or more, and the list stops at four.
- **Why nothing ran, where students look first** (facts F3). With every analysis line in a subcircuit
  no X line uses, ngspice runs nothing and, with a results file, says nothing (A3f), and the page said
  "ngspice finished but gave no results: no results." and "it printed no message that says why"; only
  Explain had the reason. The run's first message now gives it, and the status line with it:
  "ngspice finished but gave no results: .tf is inside the subcircuit s, which no X line uses.", and in
  the Numbers panel "ngspice skips an analysis line between .subckt and .ends when no X line uses that
  subcircuit, so it ran nothing, and with a results file it says nothing about it. Put analysis lines
  in the main circuit, outside .subckt … .ends.", with "Go to line 7". It comes first even when ngspice
  printed a note (`.ac` and `.noise`: "V1 has no value"), which is no reason. Not through the
  no-analysis check: the app stops running on that check and says "This netlist has no analysis line
  … The Checks panel offers to add one." (`noAnalysis`, `statusNothingDetail`), which is false here, and
  its fix, a `.op` before `.end`, would leave the student's line skipped (the skeptic of F3). Considered
  and left for after the release: a check of its own in the Checks panel, whose fix moves the line out
  of the subcircuit. And no title said twice: with no message from ngspice the summary is "ngspice
  finished without writing any results, and it printed no message that says why." (`summaryEmptyNoWhy`),
  never "gave no results: no results".
- **"skips" for those lines** (facts F2, W11). Explain's note ("ngspice skips this line: it is inside the
  subcircuit s …") and the overview ("… where ngspice skips them, so ngspice will run nothing.") said
  "ignores", the word for characters inside a line. ngspice runs none of such a subcircuit's analysis
  lines, parts and dot commands: a `.tran 0 -1` and a `.foo` it stops at elsewhere say nothing there, and
  stop it in a subcircuit an X line uses (A3f); it still reads an `.include` there, and a missing file
  stops it (A3f). Not changed: Explain's `.print` and `.plot` sentence ("then ngspice leaves the .print
  line out") and the node-name checks' "PlainSpice's run leaves .print and .plot lines out", which the
  reviewer also listed. ngspice reads such a line and answers ".print line ignored since rawfile was
  produced" (A25, A25b), so it is no line it skips: decision 0016 chose "leaves … out" for it (names lane,
  second critic, 6), and the skeptic of F2 showed it holds.

The round-1 critic of these fixes (the same day) found eight more problems, all minor; each is fixed,
with a test that fails without it (`tests/unit/last-pass-subckt.test.ts`, `last-pass-subckt-panel.test.tsx`,
and golden rows in A3f and A3h):

- **`.subckt` and `.ends` lines that do not pair up** (critic1-1). With a `.subckt` and no `.ends`,
  Explain said the `.op` after it is skipped and to put it outside `.subckt … .ends`, but ngspice stops
  before it skips or runs anything: "Mismatch of .subckt ... .ends statements!" (A3f), and the missing
  line is `.ends`. PlainSpice now counts as ngspice counts (`inp_check_syntax`): every line it reads that
  starts with `.subckt` or `.ends`, the lines after `.end` too, up to a line starting with @, and not
  `.macro` or `.eom`. When the counts differ, nothing says a line is skipped (Explain's note, the overview,
  the run's first message), and ngspice's message is the reason. A count of the whole netlist, not only
  the lines inside a subcircuit left open (the critic's way), because ngspice stops on any difference: a
  stray `.ends`, or a `.subckt` left open after the subcircuit that holds the `.op`. An unclosed `.macro`
  keeps the words as they were: ngspice does not count it, and runs nothing with nothing said, as A3f.
  The checks still leave such a line alone, as before. Considered and left: a note of its own on the open
  `.subckt` line ("This .subckt has no .ends …"); ngspice's message already names the trouble.
- **No "No results" twice in the Numbers panel** (critic1-2). Where ngspice said nothing, the panel read
  "No results … The message below says why." over "ERROR No results … it printed no message that says
  why". The message's title is now "ngspice gave no reason" (`noResultsTitle`), and the panel's lead
  drops its promise for that message alone (`statusEmptyNoWhyText`); where a message gives the reason
  (A3f's, the `.control` block's), the lead keeps it. This touches `en.ts` and `NumbersPanel.tsx`, the ui
  lane's, by one key and one choice.
- **A dot inside a name ngspice builds** (critic1-3). ngspice names m.1 inside X1 `x1.m.1`, m inside X1.a
  `x1.a.m`, and Vs.1 inside X1 `v.x1.vs.1` (A3h); PlainSpice split the name at every dot and gave
  `x1.m.1` the error of a node no part connects to. The name is now read back as ngspice builds it: each
  X line whose name starts what is left, longest first, then a node or a part of the subcircuit that X
  line uses, each subcircuit and place in the name tried once (`readBack`).
- **A subcircuit only an unused subcircuit's X line uses** (critic1-4). ngspice skips it too (A3f), but
  PlainSpice counted any X line as a use, so the status said ngspice gave no reason, Explain called the
  `.op` one that runs, and an `.ac` there got "V1 has no value" as its reason. "Used" now means what
  ngspice builds: the subcircuits the main circuit's X lines use, then those their X lines use, and so on
  (one walk, each name once), for the words, the checks and the names read back alike. The words name
  the X lines out to one no X line uses: ".op is inside the subcircuit inner, which only X2 uses, and X2
  is inside the subcircuit outer, which no X line uses", and the reason says "unless the main circuit uses
  that subcircuit, through its own X lines or those of the subcircuits they use". Where X lines in two
  subcircuits use one, or two use only each other, the words stop there with "which the main circuit
  does not use, directly or through other subcircuits": true, and shorter than every path. The common
  case, no X line at all, keeps its words.
- **The guards have tests** (critic1-5): `x1.0` and `x1.gnd` (ground is the main circuit's: new nodes, 0
  and 1 Ω), `i.x1.vs` (a part's name starts with its own letter: ngspice stops), and a run ngspice stops
  at another line first, which gets that line's reason only.
- **One reading of the netlist** (critic1-6). The walk read every line of each circuit, and parsed every
  line after `.end`, for each name it read back: work that grew with (.tf lines) × (lines), about 3 s of
  CPU in the checks for 1000 `.tf` lines and 1000 parts after `.end`. The circuits are now read once for
  each netlist, and each name's answer kept; the test counts the lines read, not the time, so the load
  cannot change it. The lists of X lines that use each subcircuit grow one entry at a time: copied whole
  at each one, 40,000 X lines that use one subcircuit took 9 s (a test compares CPU times, 4× the lines
  for less than 10× the time). Seen and left, older (rc3 has it): Explain's words for each line after
  `.end` look through every line for an @ line.
- **No stack overflow** (critic1-7): the last continuation line is taken from the list, never by
  spreading 150,000 of them into `Math.max`.
- **Words** (critic1-8): A3f and the "skips" bullet above say ngspice runs none of such a subcircuit's
  analysis lines, parts and dot commands, where they said it reads none of its lines (it reads an
  `.include` there: a missing file stops it); the overview names two subcircuits as two ("inside
  subcircuits that no X line uses"); Explain says ngspice names a node "by its X line, a dot and the
  node's own name"; and the code comments say "skips".

- **Renaming a node renames it wherever ngspice reads it** (code review C3-1, the older half). The
  editor's node Rename, joining two nodes by a wire, and a ground placed on a node changed the node's
  name on the part lines, in the dot commands' `v(...)` and in a `.control` block's `v(...)`, but not in a
  formula that reads it, so "Rename out to vout" left `B1 b 0 V=v(out)*2` on a node with nothing on it
  (native 47: "singular matrix: check node out"), nor on a `.pz` line, a `.print dc out` or after `save`,
  nor on the lines after a plain `.end`, which ngspice reads (S25: an `R3 out 0 1k` there was cut off).
  They now take their words from the same list as the checks' renames (`nodeReferences` in
  `src/spice/traps.ts`; decision 0016, after the last pass). A node's names in plain letters are renamed
  only where that list finds them: a word in a command that names the node bare outside `save`
  (`print out`) may as well be a vector the command made, so it stays.
- **The rename reaches `.save`, `.global` and `.func`, and every spelling ngspice reads as the node** (round-1
  critic of these fixes, CR1-3, CR1-1). The list the editor's rename takes its words from now also holds a
  name bare on `.save` (left there, `.save out` saved nothing after "Rename out to vout", and the node
  voltages were gone with no check), the names on `.global` and the words of a subcircuit's lines that name
  a `.global` node, and the `v(...)` of a `.func`'s formula, before and after a plain `.end`
  (non-ascii-node-23 to -25); and a name only read that ngspice spells as the node (`v(Çıkış)` for the node
  `çıkış`, decision 0016). A bare name on `.probe` stays: ngspice reads no node there.

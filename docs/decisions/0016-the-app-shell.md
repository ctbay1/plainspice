# 0016. The app shell: one netlist, live runs, the paper with panels on demand

- Status: accepted (milestone 2, step A; the look and the canvas are Tarık's, decisions
  [0014](0014-the-look.md) and [0015](0015-notebook-canvas.md))
- Date: 2026-11-11
- Code: `src/app/` (`store.ts`, `live.ts`, `model.ts`, `words.ts`, `card.ts`, `card-edit.ts`,
  `App.tsx`, `components/`), `src/editor/` (one history, `syncDoc`, the folded drawing lines, the screen look),
  `examples/start-here.cir`; tests in `tests/unit/app-*.test.*` and `tests/e2e/`

## Context

The first app was netlist-first: an editor on the left, results in tabs on the right, Run to
simulate. Tarık chose the Notebook look for milestone 2: the circuit drawn on the Solved Circuits
page, solved by ngspice, the results written on it (decisions 0014, 0015). Step A rebuilds the app at
`/` in that look and keeps every feature of the first one. The circuit can now be changed in two
places, a value typed on the drawing and the netlist typed in the Netlist panel, and a beginner
should see the numbers move as they type. Two places that change one circuit need one place where
the circuit is, one undo, and runs that keep up without piling up.

## Decision

- **One source of truth: the netlist text, in a small store** (`store.ts`, plain TypeScript). Every
  change goes through it and says who made it: typing in the editor, a value set on the drawing, a
  fix, a circuit opened (an example, a link), an undo or a redo. The drawing (`buildSchematic`), the
  checks, the editor, the autosave and the runs all follow the store; the editor is told only the
  part that changed (`syncDoc`), so its cursor stays where it was.
- **One undo history, of whole texts.** The store keeps snapshots of the text (the last 200). Keys
  typed without a pause of 750 ms are one step; every value typed into one card while it is open is
  one step (none, when the card ends where it started); a fix is one; opening a circuit is one.
  CodeMirror keeps no history of its own here: its Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y are the store's.
- **Each text knows whose it is.** The netlist saved on this device, and anything typed, changed on
  the drawing or fixed, is the student's; an example or a link just opened is not, until the student
  changes it (then it is theirs, as it was opened too). Only the student's texts are saved: an undo
  or a redo that lands on a circuit opened and never changed is like opening it again, so an example
  never replaces the homework saved on the device, and the save writes the student's last text even
  when a redo has moved on to an example since.
- **A part's card types into the netlist, never around it** (`card-edit.ts`). When the card opens it
  finds where the value is written (all its words: "4,7k" and "1 k" are one value written badly);
  every keystroke rebuilds the text from that moment with those words replaced, so nothing typed on
  the way ("-" on the way to "-12", "4,") is ever left behind, and Put back gives the line exactly as
  it was. Only a value SPICE reads as one number goes in (the parser's reading, checked against
  ngspice; "1M", a number with a trap, goes in and the card points the trap out). Anything else stays
  in the field, marked invalid, and the card says why in the checks' own words, with their fix when
  it is a value ("4,7k: SPICE reads the comma as a space · Write 4.7k"), a moment after typing pauses;
  the netlist, the drawing and the numbers keep the last value SPICE read. The field takes letters
  (`inputmode="text"`): values need k, meg and u, and a phone's decimal key may be a comma.
- **Where the parts are drawn is written only when it must be.** The `*@` lines (decision 0013) go
  into the netlist when the drawing would otherwise move: a value that changes the automatic layout
  (a 0 V ammeter given a voltage) writes the positions it had, so the drawing stays still; and in
  step B every part moved by hand. A netlist whose drawing did not move keeps its text exactly as
  written, and Share and Export carry the netlist as it is: a link made in the app is the link
  `make-link.ts` makes for the same netlist, and the ngspice file is the student's text, `*@` lines
  included when it has them. A part typed in the Netlist panel is laid out where it fits until it
  has a line of its own.
- **Live runs** (`live.ts`). ngspice runs the text about 200 ms after the last change. Runs never
  overlap: while one runs only the newest text waits, and it runs next, so the numbers always end on
  the text as it is now. Results change in place; while a part's card is open, the numbers from before
  it opened are crossed out next to the new ones. Run (Ctrl+Enter) runs at once, and a run that has
  taken 300 ms turns Run into Stop. Live runs pause, and the status line says why and to press Run,
  when the last run took longer than 1.5 s, when the netlist asks ngspice for about 100,000 points or
  more (judged again at every change), after Stop or a 20 s time-out, and when a link was opened
  without run=1; Run then stands out, and a Run that comes back quickly turns them on again. A link
  with run=1 runs as Run would, however many points it asks for. While ngspice itself downloads (the
  first visit), the run waits and the status line says so; Run turns into Stop only for a run that has
  been going for a while once ngspice is in. A netlist without an analysis, or without a single part,
  is never sent to ngspice; the status line and the Checks panel say what to add, and an empty paper
  says where to start. While ngspice has not answered the newest text, the drawing and the card keep
  the last numbers in pencil, and screen readers hear "Before your last change"; when nothing will
  run without Run, the card says so in the status line's words. One verb for it all: ngspice runs
  ("Running…", "Finished in 5 ms").
- **The paper first, panels when you want them.** The drawing fills the screen. Around it: the top
  bar (the circuit's title, Examples, undo and redo, Ctrl+K, Share, Export, Help, Settings, Run), the
  parts toolbar with names in the page's margin, the hint line (what to do next) and the status line
  (what ngspice did) along the bottom. Six panels share the screen with the drawing, each opened when
  wanted and focused on its heading: Netlist (CodeMirror on the dark "simulator screen" of the
  episodes, the `*@` lines folded into one line until shown, traps underlined, results at the ends of
  the lines), Checks (each trap with its one-click fixes), Explain (the circuit in words, then every
  line, the selected part's first), Numbers (every result in tables, with ngspice's own spelling),
  Plot (`.dc` and `.tran`, with its table and CSV), and ngspice output (what it printed, the command,
  the line PlainSpice added). On a computer they open from divider tabs down the right edge and the
  drawing fits in the rest; on a phone, from one bar along the bottom, as sheets (each takes the
  focus to its heading and gives it back to its button). Under the Netlist panel's editor, "This
  line" explains the cursor's line field by field, so a line can be read while it is typed; the SPICE
  for Beginners examples open with the Netlist panel beside the drawing. A part's card opens beside
  its part (decision 0015), measured when it opens and never moved while a value is typed; where no
  side of the part has room (large text, a short window) it is docked along the bottom of the paper
  and the drawing fits above it, so it never covers the numbers it changes. Results the drawing
  cannot show (`.tf`, a sweep's summary) are on a card on the paper. Ctrl+K reaches every command,
  panel, part, example (a video's examples named with their video) and setting.
- **Every size of screen and text.** The phone's layout is used below 900 px wide and below 520 px
  tall (a phone on its side, 400 % zoom), measured in text sizes as a browser's zoom measures them:
  a 1280 × 800 window with the Text size setting at 150 % holds what an 853 × 533 one holds, and
  gets the phone's layout too (its card a sheet below the drawing). The drawing's smallest and
  largest sizes grow with the Text size setting; with larger text on a computer the top bar's
  buttons keep their icons and lose their words to the eye (names kept), the parts toolbar tightens
  and then keeps its icons and keys when the window is short, the divider tabs drop their icons and
  their column fades where it has more, and the circuit's title always keeps room. In Windows High Contrast the drawing takes the system's colours itself (the browser
  does not force an SVG's ink), in light and dark themes.
- **The first screen.** A first visit (no link, nothing saved) opens **Start here**, a 6 V source and
  two resistors (`examples/start-here.cir`), already solved, with a sticky note (on a phone, the hint
  line) inviting the student to change R1 and watch the numbers move. It is the first item of the
  Examples menu. Which circuit opens is decided as before (`startup.ts`: a link, then the saved
  netlist, then the default example), and share links are unchanged: the same format and decoder;
  a link carries the netlist exactly as it is (see above).
- **Placing parts is step B, and the app says so.** The part tools can be chosen (by click, by key,
  from the phone's Parts sheet); the hint line then says plainly that placing comes in the next update
  and that a click on a part changes its value, and a click on a part does exactly that. Nothing
  pretends to place.
- **The words are functions of the state** (`words.ts`: the status and hint lines), testable without a
  browser; every string is in `src/i18n/en.ts`. React only renders (decision 0002).

## Considered

- **Adding the `*@` lines to every link and every exported file.** Links twice as long, files with
  lines the student never wrote, and a published format before anything can be moved by hand; the
  automatic layout draws an unmoved netlist the same wherever it opens. Rejected until positions
  matter (above).
- **Letting the card write whatever is typed.** Every keystroke of "-12" or "4,7k" would have put a
  broken line in the netlist for a moment (an error, the numbers gone, the card jumping), and a
  half-typed value is not a mistake. Rejected for the card's own check (above); the Netlist panel
  still writes exactly what is typed, as a text editor must.
- **Keeping CodeMirror's own history next to the store.** Two histories disagree as soon as the
  drawing changes the text (an undo in the editor would undo only its own typing). Rejected.
- **Running on every keystroke.** ngspice would run for every letter of "4.7k"; most runs would be
  thrown away and a slow phone would lag. Rejected for a short pause (200 ms) and newest-wins.
- **Keeping the editor and the result tabs as the main screen, with a drawing beside them.** The
  drawing is what the channel's students know from the videos, and what Tarık chose; the netlist is
  one panel away. Rejected.
- **Pausing a netlist that asks for very many points until Run, for good.** Then fixing the `.tran`
  line would leave live runs off for no reason; the size is a property of the text, so it is judged
  again at each change.

## What step B adds

(Written before step B; what step B did is decision [0017](0017-the-schematic-editor.md): wires are
not dragged, the card gained Turn, Mirror, Reverse, Move, Delete and Connections, Ctrl+K the editing
commands, and the Checks panel the drawing lines PlainSpice cannot use and the controlled sources
whose control it chose.)

Placing, moving and wiring parts on the drawing with the toolbar's tools (and the phone's Parts
sheet), deleting them, and dragging the drawing's parts and wires, each written to the netlist and its
`*@` lines through the same store, with the same undo and the same live runs. The panels, the card and
Ctrl+K stay as they are.

## Consequences

- The status line's words follow the Numbers panel's ("Not reliable", "Error", "No results"), and its
  time is ngspice's own (the ngspice output panel's).
- On a phone the turn button offers "As drawn" (not "As in the video", decision 0015) until a drawing
  really comes from a video's own `*@` lines (step C): an automatic layout is not the video's. (Done in
  step C, decision 0018: a video's own drawing gets "As in the video", any other "As drawn".)
- Some sentences of the model use "tab" for what are now panels opened from tabs ("in the ngspice
  output tab", src/spice/describe.ts and explain.ts); the tab is now named "ngspice output", so they
  stay true on a computer. Changing them is a model change, left to Tarık's review.
- The focus ring is ink, as in the approved checkpoint (it was blue); it is at least 3:1 everywhere
  (`tests/unit/app-contrast.test.tsx`).
- A panel's text box is a Tab stop when it can scroll (large text), so the keyboard can scroll it.
- The tests follow the new screen: the store and live runs (`app-store`, `app-live`), the words
  (`app-words`), the model (`app-model`), the whole app in jsdom with the real ngspice (`app-smoke`:
  the first screen, a card's live re-run and undo, typing that redraws, the folded `*@` lines, live
  runs pausing, Ctrl+K, the plain font, links), and end to end on a computer and a phone (the first
  screen, live runs, every fixture and every video example against native ngspice, traps and fixes,
  share links including a link made for the old address, export, plots, keyboard only, the phone's
  turned drawing and sheets, offline, and axe in every main state).

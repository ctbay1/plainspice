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

## After the final reviews (12 November 2026)

- **The service worker leaves the site's other pages alone.** It answers a page it does not keep with
  the app's own (share links live in the fragment, so every link is that page), except the pages on
  its list. The design pages (design/, its lab, the checkpoint Tarık approved and the three
  prototypes) were not on it, as the engine check, the licences and the engine's files were: once a
  student had opened the app, they opened as a broken copy of it, its scripts looked for under design/.
  The end-to-end policy test saw it whenever the service worker was installed before it got there
  (on a busy machine its checkpoint never said "Solved in"). They are on the list now, with or without
  their closing slash (a link typed as …/design was still answered with the app; the site sends it on to
  …/design/), as are the engine check and the licences; they are still not kept offline (`vite.config.ts`,
  `navigateFallbackDenylist`; `tests/e2e/offline.spec.ts`). A browser that already has the old service
  worker keeps its answers until the new one takes over: a new version waits (`registerType: 'prompt'`,
  above) until every PlainSpice tab has been closed once, or the student reloads from the app's "new
  version" message. Not changed for this: a new version that took over at once could leave an open
  page with scripts that are no longer there.
- **Ctrl+K keeps the focus in its field** (a11y A1). The field is the dialog's one Tab stop: Tab and
  Shift+Tab stay in it, as in every other dialog here (React Aria keeps Tab inside), so the focus
  never reaches the page behind (the skip link is inert too while Ctrl+K is open). The list is never
  a Tab stop (`tabIndex -1`: Chromium made the scrolling list one, where the arrows, Enter and Esc did
  nothing). A press anywhere in the dialog but the field keeps the focus in the field; an option
  still runs on its click, and the list still scrolls with the wheel, a finger and its scrollbar.
  Escape closes Ctrl+K wherever the focus is, as its Esc badge says.
- **Its list is a `<div role=listbox>`** of `<div role=group>`s, each a name and a `<ul role=none>` of
  `<li role=option>`s (a11y A3: an `<li>` may not be a group, and a list may hold only `<li>`s). The
  accessibility tree is as it was; axe's best-practice rules pass on it.
- **What is typed is cut into words as the commands are** (words W5, W12): at anything that is not a
  letter, a digit, _ or a dot, any case, accents or not. So a command's own name, typed as it is shown
  ("Place a current-controlled current source", "Example 3: short", "(V_Th)"), finds it, and
  "Thévenin" and "Thevenin" find the same examples. The four dependent sources' Place commands have
  other names of their own (a command's `aliases`, found and ranked as words of its name are, never as
  the start of its name): "Dependent source", the channel's word and the tool's name in the margin;
  "Dependent sources", their group's name in the margin's menu and the phone's Parts sheet, so the
  group's name typed as shown finds them too (done when the lanes were merged); and their textbook
  initials, "vcvs", "cccs", "vccs" and "ccvs" (read off the catalog's names). So "dependent" lists them first, before the
  eight examples named with the word (their group, Edit the drawing, comes before Examples), in view on
  a phone too, and Enter places a source rather than opening an example over the open circuit (words W4
  and its critic); "controlled", the textbook's word, is in their names. A short query keeps the
  command whose name it starts: "v" the voltage source, "d" Draw a wire, "de" Delete R1. (Counted as
  the start of a name, "vcvs" and "dependent source" put E first for all three: the second critic.)
- **A fix keeps the drawing lines in step** (kept F1 and its critic). A check's fix changes part lines
  only. When it renames a node ("Make n3 the ground", "Rename n12 to n2"), the `*@ label` line of the
  old name goes in the same step, as the editor's own rename takes a node's name off the drawing. When
  it renames a part whose old name then names nothing (a 0 V source in place of a 0 Ω resistor, "VR1";
  a 0 V source for a W written as a wire, "VW1"), the part's `*@` position line takes the new name, the
  rest as written, so the new part stands where the old one was drawn and no wire is redrawn (unless the
  new name already has a position line of its own). A second part renamed ("Rename it R3") leaves the
  line to the part that keeps the name, and is placed. No fix takes a part away; a position line whose
  part a change takes away goes too. So the Checks tab never warns about a line the student never
  wrote. A drawing line that already named nothing before the fix stays (the student's, and the panel
  says what is wrong with it). Every fix offered on every video example now ends with no trap and no
  drawing warning (`app-fixes.test.ts`).
- **A value typed on a crafted pile writes the drawing shown** (second re-check P3, and the critic of
  its fixes, D5 and D6). Where the drawing lines put parts on other nodes' pins, every build moves
  those parts again, whatever the value, and each key typed on a card built the pile again: 1.5 to
  3.5 s a key on the 542-character link of 60 parts at one point. Where the build moves ten parts or
  more, or any part on a drawing of a thousand pieces of wire or more, the first value typed now
  writes, in place of the drawing lines, the drawing as the page shows it: the parts where they are
  drawn, and the wires, names and ground symbols the repairs drew. Only crafted lines do that: a
  student's own drawing has a part moved only when a node renamed in the text leaves two parts
  meeting pin to pin on different nodes, one or two at a time, and there a value still changes only
  the value, so naming the node back draws the circuit as it was. The lines are written only when a
  reading takes them all and reads them back as the drawing shown (checked once, on the first value,
  by building the text it writes, which the page then draws); else each value changes only the value
  and builds the pile again, so the picture never changes under the student's eyes. Put back, or the
  value typed back as it was, gives the text the card opened on, exactly. And a value that would move
  a part writes its lines only when a reading takes them all; else the value is written alone, and
  the drawing is the new value's (decision 0012 has the times).
- **What is said is the number the Checks tab shows**: after a fix and after an edit, the count says
  the checks, the drawing lines PlainSpice cannot use and the dependent sources still to choose, as
  the tab counts them. While everything counted is a trap it is said as before ("1 trap found.": the
  checks find traps); otherwise in the tab's own words, "2 found in Checks."
- **The Netlist panel a SPICE for Beginners example opens closes again** when an example of another
  video (or of the basics) opens, so that drawing has the paper to itself (student
  netlist-panel-stays). A panel the student opened or closed is the student's: no example closes it.
  A panel opened or closed along with an example leaves the focus where the example was chosen.
- **A card offers the fix only where there is one** (words review W3). A part's card writes a check
  on its line in red pen, and linked it with "See the fix in Checks" even when the check has no fix
  (a current source whose current has nowhere to go: no fix can know where it should go; an F or H
  that reads a source the circuit does not have, when no name in it is close), and the Checks panel
  then offered none. The link now says "See the fix in Checks" when the Checks panel has a fix for
  that check, and "See why in Checks" when it has not (`CardContent.trapFix`); both open the Checks
  panel at the check, whose first line now says it offers a fix "where there is one".
- **Explain lists the drawing lines once** (kept review F2, words review W11). A run of drawing lines
  (`* plainspice-drawing v1` and the `*@` lines after it, found the way `src/schematic/format.ts` finds
  them) is one entry in "Every line, explained": "Lines 11–32: Drawing lines", what they are for
  (where each part, wire and node name is drawn, which PlainSpice reads to draw the circuit) and that
  ngspice skips them, a line starting with `*` being a comment (drawing-1, S6), with one "Go to line
  11" button, which unfolds them. Every line of the run gives that same entry, so the list shows it
  once, also within the first lines shown before "Show the other n lines", and those lines are not
  counted again. Explain says "skips" for whole lines ngspice does not read (comments, blank lines,
  lines after a glued `.end` or an `@` line) and keeps "ignores" for characters inside a line, as the
  Netlist and Checks panels do.
- **Node names with letters outside a to z** (kept review F3). ngspice writes each byte of such a
  letter as `_` (W16: `giriş` is `giri__`), and joins names it spells the same (W17: `ş` and `ç` are
  both `__`). `describe.ts` maps ngspice's names back to the netlist's when exactly one netlist name is
  spelled that way, so the drawing, the Numbers panel, the cards, the announcement and the Plot
  panel's lines (`netlistVector`, when the lanes were merged) say `giriş`;
  `NodeVoltageWords.ngspice` and `CurrentWords.vector` keep ngspice's spelling for the panel's ngspice
  column. A check (non-ascii-node) warns about such a name, with a fix to plain letters (`giris`, the
  letters with no plain form left out), and is an error when two names become one node, because
  ngspice then simulates another circuit; part names that become one are a duplicate-name error
  (duplicate-name-3). Chosen: a warning, not a note, as the review asked, although the numbers are
  right, because a name in plain letters is what keeps two nodes apart; a fix never gives a name
  another node has (it would join them), so `giriş` next to a node `giris` becomes `giris2`; the fix
  renames the node on the drawing's `*@ label` line too.
- **A node's new name is never ground's** (code review of the merged build, code-3). The plain letters
  of `gñd` are `gnd`, ground's other name for ngspice (W8), so "Rename gñd to gnd" joined the node to
  ground and changed the circuit with no check left (R2 between it and ground carried nothing, native
  47 and 42), and `gröund` became `ground`, which the ground-misnamed check then flagged. Ground's names
  (0 and gnd, in any case) now count as taken, and the names that read as ground (ground, earth, agnd,
  dgnd, gnd0, 00 …) are skipped too: `gñd` becomes `gnd2`, `0°` `02`, `gröund` `ground2`
  (non-ascii-node-6: g__d and gnd2 are ordinary nodes, gnd is ground). The other node checks (a
  look-alike, an invisible character, a character that looks like a space) still connect `ｇnd` and
  `g<zero-width space>nd` to ground: that is the node the student typed.
- **"ngspice spells the node giriş as giri__"** (words re-check 7). The warning's title put the two
  names side by side, "ngspice calls the node çıkış ____k____", and for a one-letter name "… ç __"
  read like a blank to fill in; the card, the red pen and the announcement show the title alone. It
  now says "as", as the check's other sentences do ("ngspice spells ş and ç as __").
- **What ngspice does with such a name, as far as it holds in every run** (SPICE re-check S10). The
  warning said "ngspice runs it and spells the node ____k____, without a message", recorded on an .op
  netlist. But ngspice reads a .print or .plot line as written (it leaves those lines out of the step
  that writes such letters as `_`): run as `ngspice -b`, as a student may run the exported file, it
  warns "can't parse 'çıkış'" and prints nothing for it, and runs no .dc, .tran or .ac when nothing
  else can be printed or saved (non-ascii-node-3, -13; corrected below, after the second critic of the
  names lane). A command for ngspice (a .control line, a `*#` line) reads the name
  as written too, so a `save v(çıkış)` there that leaves nothing else saved stops the analysis, in
  PlainSpice's own run as well (non-ascii-node-4; narrowed below). Now the sentence says only "ngspice
  spells the node ____k____ in its printout and results" (and "without a message" when nothing else
  names the node), and adds a sentence for each
  kind of line only when such a line names the node; .save, .tf, .ic and .meas lines are read like part
  lines and work, so they get none. The rename fix also writes the plain name inside `v(...)` on the
  .control lines (it already did on .print lines): without that, the fixed netlist still stopped.
- **aµ and au: one node, now said** (words re-check 8, the merge half). ngspice reads the micro sign as
  u (W15), and so does PlainSpice's parser, so a netlist that writes a node `aµ` in one place and `au`
  in another has one node, and the drawing shows it so, but nothing said why: R1 between them showed
  0 A with "No traps found". When a part has an end on each spelling, the non-ascii-node check now
  warns "aµ and au are one node for ngspice … R1 has both ends on it and carries no current" and offers
  a plain name of its own for the µ spelling ("Rename aµ to au2", a divider again: non-ascii-node-5).
  A warning, not the error that ş and ç get: here the drawing and the numbers are the circuit ngspice
  simulates. When no part has an end on each, it is a note, "… written two ways", whose fix writes the
  node one way. Only the spellings on part lines count, so `.save v(au)` for a node written `aµ` is no
  trap. The check's other sentences now say what µ becomes when a name has it: "ngspice reads the micro
  sign µ as u and writes the other letters outside a to z … as underscores". The names the drawing, the
  Numbers panel and the Plot panel show for such a node (`au` for `aµ`) are the words lane's.
- **Two part names ngspice reads as one, said the same way in the Numbers panel** (SPICE re-check
  S9). For `Rş` and `Rç` the Numbers panel said "Two parts are called Rç … SPICE ignores capital
  letters": it looked for the earlier part by the lower-case name, found Rç itself, and gave the
  reason for R1 and r1. It now finds the earlier part the way ngspice compares names (as it spells
  them) and, when the two differ by more than capital letters, says what the check says: "Rş and Rç
  are the same name for ngspice … so Rç here is the same name as Rş on line 3: both are r__", and to
  rename one of them with the letters a to z (`Rö` for `Rç` still stops, M4b). For `Rµ` and `Ru` both
  say "ngspice reads the micro sign µ as u … both are ru" (M4c, duplicate-name-4): the check decided
  "capital letters or not" by the key, which already reads µ as u, and its fix for `Ru` then `Rµ` was
  "Rename it Rµ", which changed nothing; new names are now compared as ngspice reads them (`Ru2`).
  The run's one-line summary keeps such a title's capitals ("… error: Rş and Rç are the same name …").
- **"skips" in the Checks panel too** (words re-check 10). Explain said "skips" for whole lines
  ngspice does not read (W11, above), but the checks still said the lines after `.end;done` "are
  ignored" and "ignores everything after it", a + line right after the title "ignores it silently",
  and a command on line 1 "is ignored": now "so it skips the lines after it", "skips every line after
  it", "skips it silently", and "Line 1 is the title, so .op never runs", as its own text says. After
  a plain .end ngspice does read the lines, so that check no longer says they "look ignored": it says
  Explain's words for .end, "ngspice does not stop reading at .end: it still reads these lines …". The
  W11 test (`tests/unit/app-words-review.test.tsx`) now reads these checks too, and that Explain says
  "skips" for the same lines.
- **A label written with µ goes with its node** (names lane critic, 5). The node-name fixes found the
  drawing's `*@ label` lines by the name as written (`µş`) but looked them up by the node, which the
  parser keys as ngspice reads it (`uş`), so "Rename µş to us" left `*@ label µş`, a label of no node.
  The label lines are now kept by the node they name as ngspice reads it (µ as u), as the nodes are;
  the aµ/au check, which renames one spelling only, takes the labels written that way.
- **A save stops PlainSpice's run only when it leaves nothing to save** (names lane critic, 1 and 3).
  The .control sentence said "save v(çıkış) leaves nothing to save: the analysis does not run, in
  PlainSpice too" whenever any save named the node, but the analysis runs when the save also names
  something ngspice finds (`save v(çıkış) i(v1)`, non-ascii-node-7), after `save all` (the node is saved
  as ____k____, non-ascii-node-8), with a `.save` line, and with .options savecurrents, which PlainSpice
  adds for .op (only the currents are saved, non-ascii-node-9); the results beside the card showed it.
  Now the check says "save v(çıkış) saves nothing, and since nothing else is saved, PlainSpice's run
  gives no results" only when every save names nothing ngspice finds, for .dc, .tran and .ac (a .tf
  saves no node voltage, so there the plain name would not help either), and not when a delete, a
  .probe line or lines after .end could change what is saved; "in PlainSpice's run", because under
  plain `ngspice -b` a run placed before the save works. `save çıkış`, without `v(...)`, counts too, and
  the rename now writes the plain name there. The .print sentence says that -b "prints nothing for that
  line" (its "and when that line was all it had to print it runs no analysis" did not hold: see "No
  analysis only when nothing else is printed or saved" below), and that PlainSpice's run "leaves .print
  and .plot lines out" (ngspice reads them: ".print line ignored since rawfile was produced."), not that
  it skips them (W11); its quote spells the name as ngspice does (`uş` for `µş`). The error for ş and ç
  made one node drops "without a message" on the same terms.
- **The other node-name checks say what a .print or .control line does too** (names lane critic, 4).
  An invisible character, a look-alike letter or a character that looks like a space in a node name
  reads on a .print or .plot line and in a .control block exactly as a Turkish letter does
  (invisible-character-65, -66, look-alike-letter-16, -17, space-character-20, -21), but those checks
  still said "makes a separate node, without a message". They now use the same sentences as the
  non-ASCII check, and say "without a message" only when no such line names the node; for an invisible
  character or a space-like one the sentences say "the name" and never show it. Their fixes now rename
  the node on the .control line too: before, the fixed netlist still saved nothing.
- **"Carries no current" only for a resistor, a capacitor or a diode** (names lane critic, 2). The aµ/au
  warning said "<part> has both ends on it and carries no current" for any part with an end on each
  spelling, which a dependent source (E1 delivered 666.7 µA beside the card), a current source, a
  transistor, a voltage source (ngspice stops: "shorted VSRC") and an inductor (singular matrix) all
  belie (non-ascii-node-11). Only a resistor, a capacitor or a diode with an end on each has no voltage
  across it and carries no current at any point (non-ascii-node-5, -10), so only for those does the
  check still say so (not for a capacitor given a starting voltage, `ic=`: under `uic` it carries
  −5000 A at the first point, as the second critic found; see below); for any other part it says
  which ends the one node joins ("which joins two ends
  of E1", "both ends of V2") and that ngspice makes the two spellings one node, and still warns, with
  the fix that gives the µ spelling a name of its own. For V2 and L1 the voltage-loop check says the
  rest, as before.
- **A save claims no results when something else decides it** (names lane, second critic, 4). The
  .control sentence still said "PlainSpice's run gives no results" beside a finished sweep in three
  netlists that run and give results (native 47 and 42, `-b -r`, and our engine): `savecurrents` on
  a continuation line of `.options` (the check read only the line's own text), a `reset` after the
  save (ngspice loads the circuit again and saves every vector), and a save inside `if 0 … end`. Now
  savecurrents is found as the run finds it (`hasSaveCurrents`, continuation lines too), and any
  command that loads, resets or switches the circuit (`reset`, `source`, `remcirc`, `setcirc`,
  `circbyline`, `edit`, `snload`), takes saves back (`delete`) or decides which commands run (`if`,
  `while`, `repeat`, `dowhile`, `foreach`, `goto`, `label` …) leaves the claim undecided, so the check
  says only that ngspice finds no such node there (non-ascii-node-7 lists the three).
- **No current claim for a capacitor that starts charged** (names lane, second critic, 5). With
  `C1 aµ au 1u ic=5` and `.tran … uic`, ngspice starts C1 at 5 V although both its ends are on one
  node, and it discharges in the first step: i(@c1[i]) = −5000 A at the first point, then 0 (native
  47 and 42, and our engine; without uic, or with an `.ic` line, it stays at 0, and a diode with
  `ic=0.7` stays at 0). The warning said "C1 has both ends on it and carries no current". A capacitor
  with an `ic=` value now gets the words for the other parts, "which joins both ends of C1", and
  cites non-ascii-node-12, which records the runs.
- **No analysis only when nothing else is printed or saved** (names lane, second critic, 1). Every
  .print sentence of the node-name checks ended "and when that line was all it had to print it runs
  no analysis", but native ngspice 47 and 42 (`-b`) run the analysis, exit 0, with an .op or a .tf
  (they save everything for themselves), with a name it finds on the line (`.print dc v(in) v(çıkış)`,
  which the S10 test used, prints no table but runs), with `v(çıkış,in)`, and with a .save line,
  savecurrents, a .meas or a .four line (non-ascii-node-13). The sentence now says "it warns … and
  prints nothing for that line", which held in every run, and adds "; with nothing else it can print
  or save, it runs no analysis ("no data saved")" only when that holds: every analysis is a .dc, .tran
  or .ac, every word of every .print and .plot line is one name ngspice can't parse (bare or alone in
  `v(...)`, `vdb(...)` …), and nothing else saves anything (no .save, .probe, .meas, .four,
  savecurrents, command for ngspice or line after .end). The lines are read as ngspice's own reading
  (`gettoks`) reads them: words split at blanks and at commas outside brackets, `xlog` and the other
  .plot options dropped, a word with a bracket naming what follows its last opening bracket, `i(…)`
  and `vi(…)` a source's current. The sentence is said only for a line whose analysis the netlist runs
  (ngspice saves a `.print tran` line's names only for a .tran, and warns about them only then: with
  only a .dc it says nothing about the name), and the warning is quoted only when ngspice gives it:
  ngspice saves a name once, and reads the commands for ngspice first, so a `save v(çıkış)` in a
  .control block or on a `*#` line, or an earlier `.print tran v(çıkış)`, takes the warning away
  (non-ascii-node-14); then the sentence says only that ngspice prints nothing for that line. A fuzz of
  900 netlists with such names on .print and .plot lines of every form, run as native ngspice 47 -b (a
  third of them under 42 too), found no quoted warning missing (167 quoted), no "runs no analysis" for a
  run that ran (57), and no "without a message" beside a warning about the node.
- **A bare name on a .print or .plot line** (names lane, second critic, 3). ngspice's .print takes a
  node name without `v(...)` (`.print dc out` prints v(out)), but PlainSpice's parser takes node names on
  these lines only inside `v(...)`, so `.print dc çıkış` got "without a message" while ngspice -b warns
  "can't parse 'çıkış'" and runs no analysis, and the rename left the line as it was, so the fixed
  netlist failed the same way. The node-name checks now read these lines as ngspice does (above), once
  for the whole netlist, and count a bare name for their sentences; all four checks (non-ascii-node,
  invisible-character, space-character and nbsp, look-alike-letter) and the aµ/au split rename it, so
  after "Rename çıkış to cikis" `.print dc cikis` prints its table (native 47 and 42; non-ascii-node-3
  lists the forms).
- **One sentence for names ngspice makes one node** (names lane, second critic, 7). The error for ş and
  ç made one node repeated the whole .print sentence, the "leaves .print and .plot lines out" sentence
  and the .control sentence for each name (about 1,250 characters for two names). It now says each
  once, listing the names: "it reads each name as written, so it finds no node ş or ç there", "it warns
  "can't parse 'ş'" and "can't parse 'ç'"", and "save v(ş) v(ç) saves nothing" (one save line) or "save
  v(ş) and save ç save nothing" (two).
- **Explain leaves a .print line out too** (names lane, second critic, 6). The Checks panel says
  PlainSpice's run "leaves .print and .plot lines out", since ngspice reads such a line and answers
  ".print line ignored since rawfile was produced" (W11 keeps "skips" for whole lines ngspice does not
  read), but Explain said for the same line "and then ngspice skips .print". Explain now says "and then
  ngspice leaves the .print line out" (`src/spice/explain.ts`, the words lane's file: one sentence),
  and the W11 test checks both panels' words for a .print and a .plot line. Explain's ".meas" sentence
  ("ngspice skips .meas", with ngspice's own "No .measure possible …") is the same case, left to the
  words lane.
- **A node name outside ASCII is said as first written** (re-check S7 and words re-check 8). The
  results' words named a node by its key, the name with lowerAscii applied, which lower-cases only A
  to Z: `GİRİŞ` was "gİrİŞ" in the Numbers panel's Node column, the summary and the live region, the
  currents, the sweeps, the Plot and the overview's list, beside the drawing's GİRİŞ, and `aµ` was
  "au", ngspice's spelling. `NodeVoltageWords.name` (and `shownNode` in `describe.ts`, for the other
  words) is the node's name as first written (its first reference in the netlist) when it has a
  character outside printable ASCII, else the key; `CurrentWords.fromName` and `toName` are a current's
  two nodes so named, which the Numbers panel's current table uses (it took the names from the node
  rows, and said "from ground to gİrİŞ" for results with no node voltage, a `.save` of a current only:
  critic of the fix). So does the no-single-answer message: ngspice points at a node in its own
  spelling ("singular matrix: check node __iki__", M2d), which the message said as it came ("No single
  answer at node __iki__"); it is mapped back to the node (`netlistNode`), which finds it and its
  parts, so the words say "Node ÇIKIŞ has no DC path to ground" and the drawing writes that note at
  ÇIKIŞ. The checks that name a node by its key do the same (floating-dc, current-source-no-path,
  dangling-node; they belong to no lane, and the critic of the fix found "ÇikiŞ has no DC path to
  ground"): "ÇIKIŞ has no DC path to ground", "Did you mean ÇIKIŞ?", a name like ground quoted, a hidden
  character named; their fixes write the node as first written ("Rename ÇIKIŞS to ÇIKIŞ", "Rdc1 ÇIKIŞ
  0 1g", the same node for ngspice), and ngspice's warning is quoted as it prints it ("singular
  matrix: check node __iki__", M2d) only when that node is the only node with no DC path: ngspice
  names one node, and in a group of two or more, or beside another such group, it may name any of
  them, not the group's first (node1 and x: "check node x", floating-dc-7; a and b apart: "check node
  a" only, floating-dc-8, -10), so the check then says it names one of the nodes with no DC path (the
  second critic of the fix found "check node node1" beside the Numbers panel's "ngspice points at node
  x"). Control inputs joined by a resistor are no longer said to stop ngspice: its transient op
  finishes there and prints numbers that mean nothing (floating-dc-9), so the check says it either
  stops or prints such numbers. The key, `node`, stays for every lookup: the
  Numbers panel's colours and row keys, the card's and the drawing's voltages (lowerAscii of a name
  with µ is not its key), the rounding-noise sets; ngspice's column keeps ngspice's spelling
  (g__r____, au). The .tf check's fix offers such a node as first written too ("Use ÇIKIŞ", never
  "Use ÇikiŞ"), and writes it so: the same node for ngspice. Chosen for this release: a name in plain ASCII keeps ngspice's own spelling, in
  lower case ("in" for IN, as W6 says SPICE reads it), as these words always said it; every name as
  written, which would make the words agree with the drawing for capitals too, changes the words of
  every circuit written in capitals, and is left for after the release. Nothing is lower-cased with
  toLowerCase, which turns İ into i with a combining dot and knows no Turkish ı. The rounding-noise
  note and the notes beside it name a node as first written too (the last pass, decision 0015).

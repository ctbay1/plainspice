# Decision records

Each record says what we decided, why, what else we considered, and what follows. Research
behind them is in [`../research/`](../research/).

| # | Decision | Status |
|---|---|---|
| [0001](0001-typescript-and-vite.md) | TypeScript and Vite | accepted (Tarık's brief) |
| [0002](0002-ui-framework.md) | React 19 with React Aria Components | accepted (Tarık) |
| [0003](0003-ngspice-to-webassembly.md) | Our own pinned, reproducible build of ngspice 47 in WebAssembly, run like the command line | accepted |
| [0004](0004-plotting-library.md) | uPlot behind our own accessible plot module | accepted |
| [0005](0005-license.md) | MIT for our code; ngspice's terms for the engine; docs CC BY 4.0 | accepted (Tarık) |
| [0006](0006-project-name.md) | The name: PlainSpice | accepted (Tarık) |
| [0007](0007-editor-codemirror.md) | CodeMirror 6 for the netlist editor | accepted |
| [0008](0008-share-links.md) | Share links: the whole circuit in the URL fragment, versioned | accepted |
| [0009](0009-testing-and-ci.md) | Unit, golden, fact and end-to-end tests in CI | accepted |
| [0010](0010-accessibility.md) | WCAG 2.2 AA from day one | accepted |
| [0011](0011-save-every-current.md) | For an operating point, the copy that runs saves every current | accepted |
| [0012](0012-netlists-and-links-are-data.md) | Netlists and links are data, never code | accepted |
| [0013](0013-schematic-model.md) | The schematic model: the circuit drawn from its netlist, in step both ways; positions in the netlist | accepted (Tarık chose the netlist) |
| [0014](0014-the-look.md) | The look: Notebook, with a named toolbar, Ctrl+K and a plain-font setting | accepted (Tarık) |
| [0015](0015-notebook-canvas.md) | The Notebook canvas: four voices, exact room for words, results in their own lines, a turned drawing on phones | accepted (the phone's turned drawing waits for Tarık) |
| [0016](0016-the-app-shell.md) | The app shell: one netlist text with one undo history (only the student's texts saved), a card that types only values SPICE reads, live runs, links and files exactly as written, the paper with panels on demand, every size of screen and text, the Start here first screen | accepted (its step B forecast is replaced by 0017) |
| [0017](0017-the-schematic-editor.md) | The schematic editor: every edit the model's, through the store (one undo step, live runs, said aloud); seen before it is done; place, wire, move, Turn (T), Mirror (M), Reverse (Shift+R), delete by mouse, finger and keyboard; a form and the card's Connections for building without a pointer; a blank page given `.op` and `.end`; after its reviews: no edit changes the text behind the student's back (each says what it wrote, `*@` lines included), square hand-drawn wires, the focus never lost, a finger holds a part to drag it | accepted |
| [0018](0018-the-examples-drawn-as-in-the-videos.md) | The examples drawn as in the videos: recorded from the channel's drawing code (parsed, never imported or run as Python), converted to the grid at a scale chosen for the phone and the video's name sides, checked by the tests; "As in the video" on a phone; names on the left drawn up to their point | accepted |

Also: [what we do differently from EEcircuit](../eecircuit-comparison.md) and the
[fixture results](../fixture-results.md).

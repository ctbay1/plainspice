# 0007. Netlist editor: CodeMirror 6

- Status: accepted
- Date: 2026-11-09

## Context

The netlist editor is the heart of a netlist-first app. It needs syntax highlighting,
underlined trap warnings with fixes, results shown at the end of lines, keyboard use that never
traps focus, screen-reader support, and it must work on a phone.

## Options

- **CodeMirror 6** (MIT): a `contenteditable`-based editor, so screen readers and mobile
  keyboards treat it as a text field; modular (we load only what we use); by default Tab is not
  captured, so keyboard users can leave the editor; lint diagnostics with actions; decorations
  and widgets for inline results. A full `basicSetup` is about 122 kB gzip; we use a smaller set.
- **Monaco** (MIT): powerful, but heavy (megabytes), weak on phones, and the way EEcircuit sets
  it up traps the Tab key (reproduced in the EEcircuit study: Tab, Shift+Tab and Esc+Tab all
  stay inside); fixing it needs extra modules and a hint.
- **A plain `<textarea>`**: perfectly accessible, but no highlighting, no inline warnings, no
  inline results.

## Decision

**CodeMirror 6**, wrapped in our own module `src/editor/` (`createEditor(...)`), mounted
imperatively by the React app (decision 0002). Rules:

- Tab and Shift+Tab leave the editor (no `indentWithTab`); a visible hint says so, and
  Ctrl/⌘+Enter runs the simulation.
- The editor has an accessible name and description; line numbers are on.
- Traps appear as lint diagnostics (error/warning/info, never colour alone) with their fixes as
  actions, and also in the app's own Checks panel, so nothing depends on hovering.
- Results appear at the end of lines as decorations hidden from screen readers; screen readers
  get the same information from the results tables and the live summary.
- At least 16 px text (no zoom on iOS), no spell-check or auto-capitalisation.
- Node names get a colour from a fixed colour-blind-safe palette (`src/theme/nodes.ts`), always
  with the name written.

## Consequences

- The textarea fallback remains an option if a screen reader user reports problems we cannot fix.
- A future schematic editor shares the netlist model (`src/spice/`), not the editor.

/**
 * Every user-facing string of the netlist editor, in one object so the Turkish UI can replace it
 * later. Words follow the project's vocabulary: a "trap" is a beginner mistake found before
 * running; "run" means simulate.
 */

import type { TrapSeverity } from '../spice/types.ts';

export const EDITOR_STRINGS = {
  /** A visible hint for next to the editor; point `describedBy` at it. */
  hint: 'Ctrl+Enter runs ngspice now. Tab leaves the editor. F8 jumps to the next trap; Ctrl+Shift+M lists them.',

  /** Every key the editor adds or keeps, for a help dialog. */
  keys: [
    { keys: 'Ctrl+Enter (Cmd+Enter on a Mac)', action: 'Run ngspice now' },
    { keys: 'Tab, Shift+Tab', action: 'Leave the editor (Tab never types a tab here)' },
    { keys: 'F8', action: 'Select the next trap and show what it means (Tab reaches its fix button, Escape closes it)' },
    { keys: 'Ctrl+Shift+M (Cmd+Shift+M on a Mac)', action: 'Open the list of traps' },
    { keys: 'In the trap list: arrow keys, a letter, Enter, Escape', action: 'Move between traps, apply the fix with that letter, go back to the netlist, close the list' },
    { keys: 'Shift+F8', action: 'Select the previous trap' },
    { keys: 'Ctrl+/ (Cmd+/ on a Mac)', action: 'Turn the selected lines into comments, or back' },
    { keys: 'Ctrl+Z, Ctrl+Shift+Z', action: 'Undo, redo' },
  ],

  /** Labels that say how serious a trap is in words, so colour is never the only signal. */
  severity: {
    error: 'Error',
    warning: 'Warning',
    info: 'Note',
  } satisfies Record<TrapSeverity, string>,

  /** "Error, line 3:" in the trap list and the trap pop-up. */
  trapHeading: (severity: string, line: number): string => `${severity}, line ${line}:`,

  /** In the trap list: "Press C: Change 1M to 1meg." */
  fixKey: (key: string, label: string): string => `Press ${key}: ${label.trim().replace(/[.!]$/, '')}.`,

  /** The drawing's lines folded into one line (drawing-fold.ts): "Drawing: 16 lines, positions of the parts". */
  drawingFolded: (lines: number): string => `Drawing: ${lines} ${lines === 1 ? 'line' : 'lines'}, positions of the parts`,
  /** The folded line's tooltip. */
  drawingUnfold: 'Click to show the drawing lines',

  /** Said when a fix cannot be used because its line was edited after the trap check. */
  fixOutOfDate: 'This fix no longer fits: the line changed after the check. The checks will run again.',

  /**
   * CodeMirror's own words (EditorState.phrases). Keys are CodeMirror's English phrases; only
   * the ones the editor can show are listed.
   */
  phrases: {
    Diagnostics: 'Traps in this netlist',
    'No diagnostics': 'No traps found',
    close: 'Close',
    'Control character': 'Control character',
    'Selection deleted': 'Selection deleted',
  } as Record<string, string>,
} as const;

/** The editor's keyboard hint (also EDITOR_STRINGS.hint). */
export const EDITOR_HINT: string = EDITOR_STRINGS.hint;

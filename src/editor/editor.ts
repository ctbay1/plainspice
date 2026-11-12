/**
 * The netlist editor: CodeMirror 6 with SPICE highlighting, trap underlines with one-click fixes,
 * results at the end of lines and node colour marks. Plain TypeScript and DOM (no React): the
 * app mounts it once and talks to it through PlainSpiceEditor (decision 0002: the netlist text
 * never lives in React state).
 *
 * Keyboard (WCAG 2.1.1, 2.1.2): Tab and Shift+Tab leave the editor (Tab is never bound, so the
 * browser moves focus); Ctrl/Cmd+Enter runs; F8 / Shift+F8 select the next / previous trap;
 * Ctrl/Cmd+Shift+M opens the trap list. EDITOR_STRINGS.hint says so in words.
 */

import './editor.css';
import { defaultKeymap, history, historyKeymap, isolateHistory } from '@codemirror/commands';
import { bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { forEachDiagnostic, linter, lintGutter, lintKeymap, nextDiagnostic, openLintPanel, previousDiagnostic, setDiagnosticsEffect, type Diagnostic } from '@codemirror/lint';
import { ChangeSet, EditorSelection, EditorState, Prec, Transaction, type Extension } from '@codemirror/state';
import {
  closeHoverTooltips,
  EditorView,
  hasHoverTooltips,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { INVISIBLE, nameOfCharacter } from '../spice/characters.ts';
import type { Fix, Span, TextChange, Trap } from '../spice/types.ts';
import { mapFix, trapsToDiagnostics } from './diagnostics.ts';
import { drawingFold, setDrawingFoldedEffect } from './drawing-fold.ts';
import { editorColourTheme, editorScreenTheme, spiceHighlightStyle } from './highlight.ts';
import { inlineNotesField, setInlineNotesEffect, type InlineNote } from './inline-notes.ts';
import { nodeColourExtension, setNodeColoursEffect } from './node-colours.ts';
import { spiceLanguage } from './spice-language.ts';
import { EDITOR_STRINGS } from './strings.ts';

export type { InlineNote } from './inline-notes.ts';

export interface EditorOptions {
  parent: HTMLElement;
  /** The netlist to start with. */
  doc: string;
  /** Accessible name of the text field, e.g. "Netlist". */
  label: string;
  /** id of the element that describes the editor (the visible EDITOR_STRINGS.hint). */
  describedBy?: string;
  /** Called after every change of the text, whoever made it (typing, setDoc, applyChanges, a fix). */
  onChange?: (doc: string) => void;
  /** Ctrl+Enter (Cmd+Enter on a Mac). */
  onRun?: () => void;
  /** Called when the cursor moves to another line (1-based); not called for the starting line 1. */
  onCursorLine?: (line: number) => void;
  /**
   * The editor's own undo history (default true). The app keeps one history for the whole netlist
   * (src/app/store.ts): with false the editor keeps none, and Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y call
   * onUndo and onRedo instead.
   */
  history?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  /** 'screen': the dark "simulator screen" of the episodes (the app's Netlist panel); default 'paper'. */
  look?: 'paper' | 'screen';
  /** Fold the drawing's lines into one line (drawing-fold.ts) from the start: true or false; leave out for no fold. */
  foldDrawing?: boolean;
  /** The drawing's lines were folded or unfolded (a click on the folded line, or setDrawingFolded). */
  onDrawingFold?: (folded: boolean) => void;
}

export interface PlainSpiceEditor {
  view: EditorView;
  getDoc(): string;
  /** Replace the whole text (one undo step); clears traps and inline notes, cursor to the start. */
  setDoc(text: string): void;
  /**
   * Make the text this one, changing only the part that differs, so the cursor stays where it was
   * (the app's store changed the text: a value set on the drawing, an undo). No undo step of its
   * own, and not reported to onChange (the text came from the app).
   */
  syncDoc(text: string): void;
  /** Put the cursor at the start of a line (1-based) and bring it into view, without taking the focus. */
  showLine(line: number): void;
  /** Fold or unfold the drawing's lines (when the editor was made with foldDrawing). */
  setDrawingFolded(folded: boolean): void;
  drawingFolded(): boolean;
  focus(): void;
  /** Select a span (or the whole line), scroll it to the middle and focus the editor. */
  goToLine(line: number, span?: Span): void;
  /** Show traps as underlines, gutter markers and the trap list; fix buttons call onFix. */
  setTraps(traps: Trap[], onFix: (fix: Fix) => void): void;
  /** Apply text changes (offsets in the current text), as one undo step. */
  applyChanges(changes: TextChange[]): void;
  setInlineNotes(notes: InlineNote[]): void;
  clearInlineNotes(): void;
  /** Node name (lower-case, ground "0") -> CSS colour, e.g. from assignNodeColours() in src/theme/nodes.ts. */
  setNodeColours(colours: Map<string, string>): void;
  destroy(): void;
}

/** Escape closes a trap pop-up (WCAG 1.4.13: content shown on hover or focus can be dismissed). */
const closePopUps = (view: EditorView): boolean => {
  if (!hasHoverTooltips(view.state)) return false;
  view.dispatch({ effects: closeHoverTooltips });
  return true;
};

/**
 * At most this many traps are underlined. A netlist with thousands of mistakes (pasted, or opened
 * from a link) froze the editor while each got its mark (security review M2); the Checks tab
 * counts them all. Errors come first, then warnings, then notes.
 */
export const MAX_TRAP_MARKS = 200;

export function trapsToMark(traps: readonly Trap[]): Trap[] {
  if (traps.length <= MAX_TRAP_MARKS) return traps.slice();
  const order: Trap['severity'][] = ['error', 'warning', 'info'];
  const picked = order.flatMap((severity) => traps.filter((t) => t.severity === severity)).slice(0, MAX_TRAP_MARKS);
  return picked.sort((a, b) => a.span.from - b.span.from || a.span.to - b.span.to);
}

/**
 * F8 and Shift+F8 select a trap and show its pop-up, which a screen reader does not read: say the
 * trap's message too (a11y review F8), as the pop-up shows it ("Warning, line 3: 1M means …").
 */
function moveToTrap(command: (view: EditorView) => boolean): (view: EditorView) => boolean {
  return (view) => {
    if (!command(view)) return false;
    const { from, to } = view.state.selection.main;
    let found: Diagnostic | undefined;
    forEachDiagnostic(view.state, (d, a, b) => {
      if (!found && a === from && b === to) found = d;
    });
    if (found) {
      const line = view.state.doc.lineAt(from).number;
      const heading = EDITOR_STRINGS.trapHeading(EDITOR_STRINGS.severity[found.severity === 'hint' ? 'info' : found.severity], line);
      view.dispatch({ effects: EditorView.announce.of(`${heading} ${found.message}`) });
    }
    return true;
  };
}

const validChange = (c: TextChange, length: number): boolean =>
  Number.isInteger(c.from) && Number.isInteger(c.to) && c.from >= 0 && c.from <= c.to && c.to <= length && typeof c.insert === 'string';

export function createEditor(opts: EditorOptions): PlainSpiceEditor {
  let lastLine = 1;
  /** Edits since the last setTraps, to keep fix offsets right (null when no traps are shown). */
  let sinceTraps: ChangeSet | null = null;
  let onFix: ((fix: Fix) => void) | null = null;

  const contentAttributes: Record<string, string> = {
    'aria-label': opts.label,
    'aria-multiline': 'true',
    // A netlist is not prose: no spelling marks, no capital letters or "corrections" on phones.
    spellcheck: 'false',
    autocorrect: 'off',
    autocapitalize: 'off',
    translate: 'no',
    // Already a Tab stop (contenteditable); said out loud for checkers such as axe, which then see
    // that the editor's scrolling box has something focusable inside (scrollable-region-focusable).
    tabindex: '0',
  };
  if (opts.describedBy) contentAttributes['aria-describedby'] = opts.describedBy;

  const run = (): boolean => {
    opts.onRun?.();
    return true; // Ctrl+Enter never inserts a blank line here, with or without onRun
  };

  const ownHistory = opts.history !== false;
  const fold = opts.foldDrawing === undefined ? undefined : drawingFold(opts.foldDrawing);
  const undo = (): boolean => {
    opts.onUndo?.();
    return true;
  };
  const redo = (): boolean => {
    opts.onRedo?.();
    return true;
  };

  const extensions: Extension[] = [
    EditorState.phrases.of(EDITOR_STRINGS.phrases),
    EditorView.editorAttributes.of({ class: opts.look === 'screen' ? 'ps-editor ps-editor--screen' : 'ps-editor' }),
    EditorView.contentAttributes.of(contentAttributes),
    // Long lines and results wrap instead of scrolling sideways (WCAG 1.4.10 at 320 px).
    EditorView.lineWrapping,
    lineNumbers(),
    // Invisible characters (a zero-width space, a word joiner, a direction mark ...) are shown as a
    // dot named in words, so a value that reads 1k but is 1 Ω shows why (security review F2;
    // invisible-character-1). CodeMirror's own set has some of them; INVISIBLE adds the rest.
    highlightSpecialChars({ addSpecialChars: INVISIBLE, render: specialChar }),
    // No pop-up on the gutter markers: it cannot be closed with Escape, and hovering the
    // underlined text (or F8) shows the same pop-up.
    lintGutter({ tooltipFilter: () => [] }),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    ownHistory ? history() : [],
    bracketMatching(),
    spiceLanguage,
    syntaxHighlighting(spiceHighlightStyle),
    opts.look === 'screen' ? editorScreenTheme : editorColourTheme,
    fold ?? [],
    linter(null), // diagnostics come from the app's trap checks (setTraps), not from a lint source
    inlineNotesField,
    nodeColourExtension,
    Prec.highest(
      keymap.of([
        { key: 'Mod-Enter', run, preventDefault: true },
        { key: 'Ctrl-Enter', run, preventDefault: true }, // also on a Mac, so "Ctrl+Enter runs" is true everywhere
        { key: 'Ctrl-Shift-m', run: openLintPanel, preventDefault: true },
        { key: 'F8', run: moveToTrap(nextDiagnostic) },
        { key: 'Shift-F8', run: moveToTrap(previousDiagnostic) },
        { key: 'Escape', run: closePopUps },
        ...(ownHistory
          ? []
          : [
              { key: 'Mod-z', run: undo, preventDefault: true },
              { key: 'Mod-Shift-z', run: redo, preventDefault: true },
              { key: 'Mod-y', run: redo, preventDefault: true },
            ]),
      ]),
    ),
    // No indentWithTab: Tab must move focus out of the editor.
    keymap.of([...lintKeymap, ...(ownHistory ? historyKeymap : []), ...defaultKeymap]),
    EditorView.updateListener.of((update) => {
      if (fold && update.startState.field(fold).folded !== update.state.field(fold).folded) opts.onDrawingFold?.(update.state.field(fold).folded);
      if (update.docChanged) {
        if (sinceTraps) sinceTraps = sinceTraps.compose(update.changes);
        // A text the app put in (syncDoc) is not a change to report back to it.
        const synced = update.transactions.every((tr) => !tr.docChanged || tr.isUserEvent('sync'));
        if (!synced) opts.onChange?.(update.state.doc.toString());
      }
      if (update.docChanged || update.selectionSet) {
        const line = update.state.doc.lineAt(update.state.selection.main.head).number;
        if (line !== lastLine) {
          lastLine = line;
          opts.onCursorLine?.(line);
        }
      }
    }),
  ];

  const view = new EditorView({ parent: opts.parent, state: EditorState.create({ doc: opts.doc, extensions }) });

  // Text size and contrast are switched on <html>; line heights change, so measure again.
  const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => view.requestMeasure());
  observer?.observe(opts.parent.ownerDocument.documentElement, {
    attributes: true,
    attributeFilter: ['data-text-size', 'data-contrast', 'style'],
  });

  // Escape inside a pop-up (e.g. on its fix button, reached with Tab) closes it and returns to the
  // text; pop-ups also close when focus leaves the editor.
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !(event.target instanceof Element) || !event.target.closest('.cm-tooltip')) return;
    if (closePopUps(view)) {
      event.preventDefault();
      view.focus();
    }
  };
  const onFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !view.dom.contains(next)) closePopUps(view);
  };
  // A pop-up opened by the mouse while focus is elsewhere (on Run, say) closes with Escape too
  // (a11y review F9, WCAG 1.4.13); inside the editor the keymap above does it.
  const doc = opts.parent.ownerDocument;
  const onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || (event.target instanceof Node && view.dom.contains(event.target))) return;
    closePopUps(view);
  };
  view.dom.addEventListener('keydown', onKeydown);
  view.dom.addEventListener('focusout', onFocusOut);
  doc.addEventListener('keydown', onDocumentKeydown);

  const handleFix = (fix: Fix): void => {
    const mapped = sinceTraps ? mapFix(fix, sinceTraps) : fix;
    if (!mapped) {
      view.dispatch({ effects: EditorView.announce.of(EDITOR_STRINGS.fixOutOfDate) });
      return;
    }
    // The fix's button is in the pop-up, which goes away with its trap: focus would fall to the
    // page (a11y review F3, WCAG 2.4.3). It goes back to the text instead.
    const fromPopUp = doc.activeElement instanceof Element && doc.activeElement.closest('.cm-tooltip') !== null;
    onFix?.(mapped);
    if (fromPopUp && !view.hasFocus) view.focus();
  };

  return {
    view,
    getDoc: () => view.state.doc.toString(),
    setDoc(text) {
      if (text === view.state.doc.toString()) return;
      sinceTraps = null;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: EditorSelection.cursor(0),
        effects: setDiagnosticsEffect.of([]),
        annotations: isolateHistory.of('full'),
        scrollIntoView: true,
      });
    },
    syncDoc(text) {
      const current = view.state.doc.toString();
      if (text === current) return;
      // Only the part that differs changes, so the cursor (and the trap marks) stay where they were.
      let start = 0;
      const max = Math.min(current.length, text.length);
      while (start < max && current.charCodeAt(start) === text.charCodeAt(start)) start += 1;
      let endA = current.length;
      let endB = text.length;
      while (endA > start && endB > start && current.charCodeAt(endA - 1) === text.charCodeAt(endB - 1)) {
        endA -= 1;
        endB -= 1;
      }
      view.dispatch({
        changes: { from: start, to: endA, insert: text.slice(start, endB) },
        annotations: Transaction.addToHistory.of(false),
        userEvent: 'sync',
      });
    },
    showLine(line) {
      const doc = view.state.doc;
      if (!Number.isFinite(line)) return;
      const n = Math.min(Math.max(Math.round(line), 1), doc.lines);
      const at = doc.line(n).from;
      if (view.state.selection.main.head === at) return;
      view.dispatch({ selection: EditorSelection.cursor(at), effects: EditorView.scrollIntoView(at, { y: 'nearest' }), userEvent: 'select' });
    },
    setDrawingFolded(folded) {
      if (fold && view.state.field(fold).folded !== folded) view.dispatch({ effects: setDrawingFoldedEffect.of(folded) });
    },
    drawingFolded: () => (fold ? view.state.field(fold).folded : false),
    focus: () => view.focus(),
    goToLine(line, span) {
      const doc = view.state.doc;
      const n = Math.min(Math.max(Math.round(Number.isFinite(line) ? line : 1), 1), doc.lines);
      let { from, to } = doc.line(n);
      if (span && validChange({ ...span, insert: '' }, doc.length)) ({ from, to } = span);
      view.dispatch({
        selection: EditorSelection.single(from, to),
        effects: EditorView.scrollIntoView(EditorSelection.range(from, to), { y: 'center' }),
        userEvent: 'select',
      });
      view.focus();
    },
    setTraps(traps, callback) {
      onFix = callback;
      sinceTraps = ChangeSet.empty(view.state.doc.length);
      view.dispatch({ effects: setDiagnosticsEffect.of(trapsToDiagnostics(trapsToMark(traps), view.state.doc, handleFix)) });
    },
    applyChanges(changes) {
      const length = view.state.doc.length;
      const valid = changes.filter((c) => validChange(c, length)).sort((a, b) => a.from - b.from || a.to - b.to);
      if (valid.length !== changes.length) console.warn('PlainSpice editor: ignored text changes outside the netlist', changes);
      if (!valid.length) return;
      let set: ChangeSet;
      try {
        set = view.state.changes(valid);
      } catch (error) {
        console.warn('PlainSpice editor: could not apply overlapping text changes', error);
        return;
      }
      view.dispatch({
        changes: set,
        effects: EditorView.scrollIntoView(set.mapPos(valid[0]!.from, 1), { y: 'nearest' }),
        userEvent: 'input.fix',
      });
    },
    setInlineNotes: (notes) => view.dispatch({ effects: setInlineNotesEffect.of(notes.slice()) }),
    clearInlineNotes: () => view.dispatch({ effects: setInlineNotesEffect.of([]) }),
    setNodeColours: (colours) => view.dispatch({ effects: setNodeColoursEffect.of(new Map(colours)) }),
    destroy() {
      observer?.disconnect();
      view.dom.removeEventListener('keydown', onKeydown);
      view.dom.removeEventListener('focusout', onFocusOut);
      doc.removeEventListener('keydown', onDocumentKeydown);
      view.destroy();
    },
  };
}

/** A special character's placeholder: CodeMirror's dot, with the character named in plain words for screen readers and on hover. */
function specialChar(code: number, description: string | null, placeholder: string): HTMLElement {
  const span = document.createElement('span');
  const label = nameOfCharacter(String.fromCodePoint(code)) ?? description ?? '';
  span.textContent = placeholder;
  span.title = label;
  span.setAttribute('aria-label', label);
  span.className = 'cm-specialChar ps-special';
  return span;
}

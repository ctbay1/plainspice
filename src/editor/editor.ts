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
import { linter, lintGutter, lintKeymap, openLintPanel, previousDiagnostic, setDiagnosticsEffect } from '@codemirror/lint';
import { ChangeSet, EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state';
import {
  closeHoverTooltips,
  EditorView,
  hasHoverTooltips,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import type { Fix, Span, TextChange, Trap } from '../spice/types.ts';
import { mapFix, trapsToDiagnostics } from './diagnostics.ts';
import { editorColourTheme, spiceHighlightStyle } from './highlight.ts';
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
}

export interface PlainSpiceEditor {
  view: EditorView;
  getDoc(): string;
  /** Replace the whole text (one undo step); clears traps and inline notes, cursor to the start. */
  setDoc(text: string): void;
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
  };
  if (opts.describedBy) contentAttributes['aria-describedby'] = opts.describedBy;

  const run = (): boolean => {
    opts.onRun?.();
    return true; // Ctrl+Enter never inserts a blank line here, with or without onRun
  };

  const extensions: Extension[] = [
    EditorState.phrases.of(EDITOR_STRINGS.phrases),
    EditorView.editorAttributes.of({ class: 'ps-editor' }),
    EditorView.contentAttributes.of(contentAttributes),
    // Long lines and results wrap instead of scrolling sideways (WCAG 1.4.10 at 320 px).
    EditorView.lineWrapping,
    lineNumbers(),
    // No pop-up on the gutter markers: it cannot be closed with Escape, and hovering the
    // underlined text (or F8) shows the same pop-up.
    lintGutter({ tooltipFilter: () => [] }),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    history(),
    bracketMatching(),
    spiceLanguage,
    syntaxHighlighting(spiceHighlightStyle),
    editorColourTheme,
    linter(null), // diagnostics come from the app's trap checks (setTraps), not from a lint source
    inlineNotesField,
    nodeColourExtension,
    Prec.highest(
      keymap.of([
        { key: 'Mod-Enter', run, preventDefault: true },
        { key: 'Ctrl-Enter', run, preventDefault: true }, // also on a Mac, so "Ctrl+Enter runs" is true everywhere
        { key: 'Ctrl-Shift-m', run: openLintPanel, preventDefault: true },
        { key: 'Shift-F8', run: previousDiagnostic },
        { key: 'Escape', run: closePopUps },
      ]),
    ),
    // No indentWithTab: Tab must move focus out of the editor.
    keymap.of([...lintKeymap, ...historyKeymap, ...defaultKeymap]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        if (sinceTraps) sinceTraps = sinceTraps.compose(update.changes);
        opts.onChange?.(update.state.doc.toString());
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
  view.dom.addEventListener('keydown', onKeydown);
  view.dom.addEventListener('focusout', onFocusOut);

  const handleFix = (fix: Fix): void => {
    const mapped = sinceTraps ? mapFix(fix, sinceTraps) : fix;
    if (!mapped) {
      view.dispatch({ effects: EditorView.announce.of(EDITOR_STRINGS.fixOutOfDate) });
      return;
    }
    onFix?.(mapped);
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
      view.dispatch({ effects: setDiagnosticsEffect.of(trapsToDiagnostics(traps, view.state.doc, handleFix)) });
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
      view.destroy();
    },
  };
}

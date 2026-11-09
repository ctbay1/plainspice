/**
 * Short results at the end of netlist lines ("→ 3 A, n1 → 0"), shown after a run.
 *
 * The notes are hidden from screen readers (aria-hidden): the app gives the same information in
 * its results table, and text inside an edit field that is not part of the netlist would be
 * read as if it were. `speech` (the same result in words) becomes the note's tooltip.
 * Notes belong to the netlist that was run, so any edit clears them.
 */

import { StateEffect, StateField, type Text } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

export interface InlineNote {
  /** 1-based line number. */
  line: number;
  /** What is shown, e.g. "→ 3 A, n1 → 0". */
  text: string;
  /** The same in words, for the tooltip, e.g. "3 amperes flow from n1 to node 0". */
  speech: string;
}

export const setInlineNotesEffect = StateEffect.define<readonly InlineNote[]>();

class InlineNoteWidget extends WidgetType {
  readonly text: string;
  readonly speech: string;

  constructor(text: string, speech: string) {
    super();
    this.text = text;
    this.speech = speech;
  }

  override eq(other: InlineNoteWidget): boolean {
    return other.text === this.text && other.speech === this.speech;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'ps-inline-note';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = this.text;
    if (this.speech) span.title = this.speech;
    return span;
  }
}

function buildNotes(notes: readonly InlineNote[], doc: Text): DecorationSet {
  const ranges = [];
  for (const note of notes) {
    if (!Number.isInteger(note.line) || note.line < 1 || note.line > doc.lines || !note.text) continue;
    const end = doc.line(note.line).to;
    // side: 1 keeps the cursor at the end of the line before the note.
    ranges.push(Decoration.widget({ widget: new InlineNoteWidget(note.text, note.speech), side: 1 }).range(end));
  }
  return Decoration.set(ranges, true);
}

export const inlineNotesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(notes, tr) {
    let next = tr.docChanged ? Decoration.none : notes;
    for (const e of tr.effects) if (e.is(setInlineNotesEffect)) next = buildNotes(e.value, tr.state.doc);
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * The drawing's lines folded away (decisions 0013 and 0014): part positions live in the netlist as
 * a block of comment lines ("* plainspice-drawing v1" and the "*@" lines after it), which ngspice
 * ignores and a student rarely needs to read. While folded, the block shows as one line, "Drawing:
 * 16 lines, positions of the parts", which unfolds on a click; the app's Netlist panel also has a
 * button that folds and unfolds it from the keyboard. The lines are still in the text (copying the
 * netlist copies them); only the view hides them, and the cursor steps over the folded line.
 *
 * The fold follows the text: when the block is written again (a value changed on the drawing), it
 * stays folded.
 *
 * Nothing typed goes into the folded lines unseen (critique of step B): the block is shown while the
 * cursor is inside it (a line just typed to start with "*@" joins it, and stays in view while it
 * is typed), and a change that would join a folded drawing line to a line around it (Backspace at
 * the start of the line after the block, Delete at the end of the line before it, typing over a
 * selection that ends in the fold) is not made: the block unfolds instead, so the student sees
 * what is there.
 */
import { EditorState, StateEffect, StateField, type EditorSelection, type Text, type Transaction } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { isDrawingLine } from '../schematic/format.ts';
import { EDITOR_STRINGS } from './strings.ts';

/** Fold (true) or unfold (false) the drawing lines. */
export const setDrawingFoldedEffect = StateEffect.define<boolean>();

/** The drawing block: the first run of drawing lines after the title line. */
export function drawingBlock(doc: Text): { from: number; to: number; lines: number; firstLine: number } | undefined {
  for (let n = 2; n <= doc.lines; n++) {
    if (!isDrawingLine(doc.line(n).text)) continue;
    let last = n;
    while (last + 1 <= doc.lines && isDrawingLine(doc.line(last + 1).text)) last += 1;
    return { from: doc.line(n).from, to: doc.line(last).to, lines: last - n + 1, firstLine: n };
  }
  return undefined;
}

class FoldWidget extends WidgetType {
  readonly lines: number;
  constructor(lines: number) {
    super();
    this.lines = lines;
  }
  override eq(other: FoldWidget): boolean {
    return other.lines === this.lines;
  }
  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className = 'ps-fold';
    span.title = EDITOR_STRINGS.drawingUnfold;
    const mark = document.createElement('span');
    mark.className = 'ps-fold__mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '▸';
    span.append(mark, ` ${EDITOR_STRINGS.drawingFolded(this.lines)}`);
    span.addEventListener('mousedown', (event) => {
      event.preventDefault();
      view.dispatch({ effects: setDrawingFoldedEffect.of(false) });
    });
    return span;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

interface FoldState {
  folded: boolean;
  decorations: DecorationSet;
}

/** The selection is inside the block (not just at its edges, where the cursor steps over the fold). */
function selectionInside(selection: EditorSelection, block: { from: number; to: number }): boolean {
  return selection.ranges.some((r) => (r.head > block.from && r.head < block.to) || (r.anchor > block.from && r.anchor < block.to));
}

function build(doc: Text, folded: boolean, selection?: EditorSelection): DecorationSet {
  const block = folded ? drawingBlock(doc) : undefined;
  if (!block || (selection && selectionInside(selection, block))) return Decoration.none;
  return Decoration.set([Decoration.replace({ widget: new FoldWidget(block.lines) }).range(block.from, block.to)]);
}

/**
 * True when a change would join a folded drawing line to the line before or after the block: it
 * takes away the line break at either edge of the block without taking the whole block with it.
 */
function joinsBlock(tr: Transaction, block: { from: number; to: number }): boolean {
  const doc = tr.startState.doc;
  let joins = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    const before = block.from > 0 && fromA <= block.from - 1 && toA >= block.from;
    const after = block.to < doc.length && fromA <= block.to && toA >= block.to + 1;
    const whole = fromA <= block.from && toA >= block.to;
    if ((before || after) && !whole) joins = true;
  });
  return joins;
}

/** The fold, folded from the start unless `folded` is false. */
export function drawingFold(folded = true): StateField<FoldState> {
  const field: StateField<FoldState> = StateField.define<FoldState>({
    create: (state) => ({ folded, decorations: build(state.doc, folded, state.selection) }),
    update(value, tr) {
      let next = value.folded;
      for (const e of tr.effects) if (e.is(setDrawingFoldedEffect)) next = e.value;
      if (!tr.docChanged && !tr.selection && next === value.folded) return value;
      return { folded: next, decorations: build(tr.state.doc, next, tr.state.selection) };
    },
    provide: (f) => [
      EditorView.decorations.from(f, (v) => v.decorations),
      // The cursor steps over the folded line instead of into the hidden text.
      EditorView.atomicRanges.of((view) => view.state.field(f).decorations),
      // A change that would join a folded drawing line to its neighbour unfolds the block instead.
      EditorState.transactionFilter.of((tr) => {
        if (!tr.docChanged || tr.isUserEvent('sync')) return tr;
        const state = tr.startState.field(field, false);
        const block = state?.folded && state.decorations.size ? drawingBlock(tr.startState.doc) : undefined;
        if (!block || !joinsBlock(tr, block)) return tr;
        return { effects: setDrawingFoldedEffect.of(false) };
      }),
    ],
  });
  return field;
}

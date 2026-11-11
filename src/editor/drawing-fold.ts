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
 */
import { StateEffect, StateField, type Text } from '@codemirror/state';
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

function build(doc: Text, folded: boolean): DecorationSet {
  const block = folded ? drawingBlock(doc) : undefined;
  if (!block) return Decoration.none;
  return Decoration.set([Decoration.replace({ widget: new FoldWidget(block.lines) }).range(block.from, block.to)]);
}

/** The fold, folded from the start unless `folded` is false. */
export function drawingFold(folded = true): StateField<FoldState> {
  return StateField.define<FoldState>({
    create: (state) => ({ folded, decorations: build(state.doc, folded) }),
    update(value, tr) {
      let next = value.folded;
      for (const e of tr.effects) if (e.is(setDrawingFoldedEffect)) next = e.value;
      if (!tr.docChanged && next === value.folded) return value;
      return { folded: next, decorations: build(tr.state.doc, next) };
    },
    provide: (field) => [
      EditorView.decorations.from(field, (v) => v.decorations),
      // The cursor steps over the folded line instead of into the hidden text.
      EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
    ],
  });
}

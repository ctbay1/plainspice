/**
 * Node marks: every node name in the netlist is underlined (so nodes stand out from numbers
 * without relying on colour), and when the app gives node colours, the underline becomes a bar in
 * the node's colour. The same colour marks the node in the results and plots, and the name is
 * always written next to it.
 *
 * Nodes inside a .subckt definition belong to the subcircuit, so they never get a top-level
 * node's colour (ground is the same everywhere and keeps its plain underline unless coloured).
 *
 * Only the lines on screen are marked, from the tokenizer's state at their start, which is kept
 * for every line read so far and worked out again only from the first edited line on. Marking the
 * whole netlist on every keystroke cost time growing with its length: a 60–100 ms pause per key at
 * 2000 lines on a slow phone (perf review 6).
 */

import { StateEffect, StateField, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { START_STATE, blankLineState, tokenizeLine, type LineState } from './spice-tokens.ts';

export interface NodeMark {
  from: number;
  to: number;
  /** Lower-case name; ground is "0". */
  node: string;
  /** The text as written. */
  text: string;
  ground: boolean;
  local: boolean;
}

export const setNodeColoursEffect = StateEffect.define<ReadonlyMap<string, string>>();

/** Line n's node marks (pushed to `marks`) and the tokenizer state after it. */
function markLine(doc: Text, n: number, state: LineState, marks: NodeMark[] | null): LineState {
  const line = doc.line(n);
  if (line.length === 0) return blankLineState(state);
  // The look-ahead lets "gnd" at the end of a line followed by a '+' line count as ground.
  const r = tokenizeLine(line.text, state, (k) => (n + k <= doc.lines ? doc.line(n + k).text : undefined));
  if (marks) {
    for (const t of r.tokens) {
      if (t.node === undefined) continue;
      marks.push({
        from: line.from + t.from,
        to: line.from + t.to,
        node: t.node,
        text: line.text.slice(t.from, t.to),
        ground: t.type === 'ground',
        local: t.local === true,
      });
    }
  }
  return r.state;
}

/** Find every node name in a document, with the same tokenizer as the highlighting. */
export function findNodeMarks(doc: Text): NodeMark[] {
  const marks: NodeMark[] = [];
  let state: LineState = START_STATE;
  for (let n = 1; n <= doc.lines; n++) state = markLine(doc, n, state, marks);
  return marks;
}

/**
 * Accept only plain CSS colour values (#hex, rgb(...), var(--x, #hex), names), so a colour can
 * never add other declarations to the style attribute.
 */
export function isSafeCssColour(value: string): boolean {
  return value.length > 0 && value.length <= 100 && /^[#(),./%\w\s-]+$/.test(value);
}

export const nodeColoursField = StateField.define<ReadonlyMap<string, string>>({
  create: () => new Map(),
  update(colours, tr) {
    for (const e of tr.effects) if (e.is(setNodeColoursEffect)) colours = e.value;
    return colours;
  },
});

const plainMark = Decoration.mark({ class: 'ps-node' });
const groundMark = Decoration.mark({ class: 'ps-node ps-ground' });

function colourFor(mark: NodeMark, colours: ReadonlyMap<string, string>): string | undefined {
  if (mark.local && !mark.ground) return undefined;
  return colours.get(mark.node) ?? colours.get(mark.text) ?? colours.get(mark.text.toLowerCase());
}

function buildDecorations(marks: readonly NodeMark[], colours: ReadonlyMap<string, string>): DecorationSet {
  const cache = new Map<string, Decoration>();
  const ranges = marks.map((m) => {
    const colour = colourFor(m, colours);
    if (colour === undefined || !isSafeCssColour(colour)) return (m.ground ? groundMark : plainMark).range(m.from, m.to);
    const key = `${m.ground ? 'g' : 'n'}${colour}`;
    let deco = cache.get(key);
    if (!deco) {
      deco = Decoration.mark({
        class: `ps-node ps-node-coloured${m.ground ? ' ps-ground' : ''}`,
        attributes: { style: `--ps-node-colour: ${colour}` },
      });
      cache.set(key, deco);
    }
    return deco.range(m.from, m.to);
  });
  return Decoration.set(ranges, true);
}

/** Marks the lines on screen; keeps the tokenizer's state at the start of each line read so far. */
class NodeMarker {
  /** states[k]: the state before line k + 1 (states[0] is the state before line 1). */
  private readonly states: LineState[] = [START_STATE];
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.build(view);
  }

  update(u: ViewUpdate): void {
    if (u.docChanged) {
      // A line's state depends only on the lines before it: keep those before the first edit.
      let first = u.state.doc.lines + 1;
      u.changes.iterChangedRanges((_fromA, _toA, fromB) => {
        first = Math.min(first, u.state.doc.lineAt(fromB).number);
      });
      if (this.states.length > first) this.states.length = first;
    }
    if (u.docChanged || u.viewportChanged || u.startState.field(nodeColoursField) !== u.state.field(nodeColoursField)) {
      this.decorations = this.build(u.view);
    }
  }

  /** The state before line n, reading on from the last line known. */
  private stateBefore(doc: Text, n: number): LineState {
    while (this.states.length < n) {
      const k = this.states.length; // the next line to read
      this.states.push(markLine(doc, k, this.states[k - 1]!, null));
    }
    return this.states[n - 1]!;
  }

  private build(view: EditorView): DecorationSet {
    const doc = view.state.doc;
    const marks: NodeMark[] = [];
    let done = 0; // visible ranges are in order; a line is marked once
    for (const { from, to } of view.visibleRanges) {
      const last = doc.lineAt(to).number;
      let n = Math.max(doc.lineAt(from).number, done + 1);
      if (n > last) continue;
      let state = this.stateBefore(doc, n);
      for (; n <= last; n++) {
        state = markLine(doc, n, state, marks);
        if (this.states.length === n) this.states.push(state);
      }
      done = last;
    }
    return buildDecorations(marks, view.state.field(nodeColoursField));
  }
}

export const nodeColourExtension = [nodeColoursField, ViewPlugin.fromClass(NodeMarker, { decorations: (p) => p.decorations })];

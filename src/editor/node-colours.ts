/**
 * Node marks: every node name in the netlist is underlined (so nodes stand out from numbers
 * without relying on colour), and when the app gives node colours, the underline becomes a bar in
 * the node's colour. The same colour marks the node in the results and plots, and the name is
 * always written next to it.
 *
 * Nodes inside a .subckt definition belong to the subcircuit, so they never get a top-level
 * node's colour (ground is the same everywhere and keeps its plain underline unless coloured).
 */

import { StateEffect, StateField, type Text } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
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

/** Find every node name in a document, with the same tokenizer as the highlighting. */
export function findNodeMarks(doc: Text): NodeMark[] {
  const marks: NodeMark[] = [];
  let state: LineState = START_STATE;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.length === 0) {
      state = blankLineState(state);
      continue;
    }
    const r = tokenizeLine(line.text, state);
    state = r.state;
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
  return marks;
}

/**
 * Accept only plain CSS colour values (#hex, rgb(...), var(--x, #hex), names), so a colour can
 * never add other declarations to the style attribute.
 */
export function isSafeCssColour(value: string): boolean {
  return value.length > 0 && value.length <= 100 && /^[#(),./%\w\s-]+$/.test(value);
}

const nodeMarksField = StateField.define<readonly NodeMark[]>({
  create: (state) => findNodeMarks(state.doc),
  update: (marks, tr) => (tr.docChanged ? findNodeMarks(tr.state.doc) : marks),
});

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

export const nodeColourExtension = [
  nodeMarksField,
  nodeColoursField,
  EditorView.decorations.compute([nodeMarksField, nodeColoursField], (state) =>
    buildDecorations(state.field(nodeMarksField), state.field(nodeColoursField)),
  ),
];

/**
 * Every word the Notebook canvas writes itself, in one object so a Turkish UI can replace it later.
 * Sentences about the circuit and about SPICE are not here: they come from the model
 * (src/spice/describe.ts, explain.ts, traps.ts and src/schematic/navigate.ts), so the drawing never
 * says anything about SPICE the rest of PlainSpice does not already say.
 */
export const NOTEBOOK_STRINGS = {
  /** The first result line of a 0 V source: it measures the current (describe.ts: "Vx measures 1 A ..."). */
  measures: 'measures',
  /** The drawing's name for screen readers (its parts and nodes, as buttons). */
  drawingLabel: (title: string): string => `Drawing of the circuit: ${title}`,
  /** The picture of the drawing (the SVG), named apart from the group of its buttons. */
  pictureLabel: (title: string): string => `Picture of the circuit: ${title}`,
  /** Before results that are for the netlist as it was (ngspice has not answered the newest text yet). */
  beforeChange: 'Before your last change:',
  /** Before a check's title in a part's or a node's description (the red pen beside it on the drawing). */
  check: (title: string): string => `Check: ${title}`,
  /** A part's button on the drawing: its name and kind. */
  partButton: (name: string, kind: string): string => `${name}, ${kind}`,
  /** A node's button on the drawing. */
  nodeButton: (name: string): string => `Node ${name}`,
  groundButton: 'Ground, node 0',
  /** Read after a part's or a node's description when results are shown. */
  noNumbers: 'No numbers yet.',
  /** How to use the drawing from the keyboard (aria-description of the drawing group). */
  keys: 'Arrow keys move along the wires; Enter opens the selected part; Escape lets go.',
  /** The arrow before a current, said in words. */
  direction: { up: 'up', down: 'down', left: 'to the left', right: 'to the right' },
} as const;

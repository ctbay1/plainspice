/**
 * The schematic model as the Notebook look uses it: the circuit laid out with the room its fonts
 * need (measure.ts) and the result lines it writes (results.ts), and the netlist with its drawing
 * block, since part positions live in the netlist (decision 0013, Tarık, 11 November 2026).
 */
import { applyChanges, buildSchematic, drawingBlockChanges, readDrawing, serializeDrawing, type Schematic, type SchematicOptions } from '../schematic/index.ts';
import type { Netlist } from '../spice/types.ts';
import { NODE_INLINE_ROOM, notebookMeasure } from './measure.ts';
import { resultRoom } from './results.ts';

/**
 * The schematic options of the Notebook look: its fonts' widths, the result lines it writes under
 * each part, and each node's voltage on its name's line ("s = 12 V", as the prototype's tags).
 */
export const NOTEBOOK_OPTIONS: SchematicOptions = { measure: notebookMeasure, resultRoom, nodeResultInline: NODE_INLINE_ROOM };

export function notebookSchematic(text: string): Schematic {
  return buildSchematic(text, NOTEBOOK_OPTIONS);
}

/**
 * The netlist with its drawing block written in (serializeDrawing, just before .end, so no other
 * line moves), when the netlist has none yet or it is out of step. Lines of another version's
 * drawing are left alone (format.ts), and so is the text then.
 */
export function withDrawingBlock(text: string, s: Schematic = notebookSchematic(text)): string {
  if (s.foreign.length) return text;
  return applyChanges(text, drawingBlockChanges(s.netlist, serializeDrawing(s.circuit, s.drawing, s.kept)));
}

/** The 0-based indexes of the netlist's drawing lines (the header and the *@ lines), in order. */
export function drawingLineIndexes(netlist: Netlist): number[] {
  return readDrawing(netlist).lineIndexes;
}

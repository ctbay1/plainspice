/**
 * A drawing: where each part and ground symbol sits, the wires, and where node names are written.
 * This is what the drawing format stores (format.ts) and what the editor changes (edit.ts); the
 * rest (symbols in place, label positions, junction dots, terminals) is derived from it (scene.ts).
 * Plain TypeScript: no DOM.
 */
import { formatNumber, formatSI } from '../format/si.ts';
import { readNumber } from '../spice/numbers.ts';
import type { CircuitPart } from './circuit.ts';
import { transform, transformBox, transformDirection, type Box, type Direction, type Point, type Rotation } from './geometry.ts';
import { SYMBOLS, type PinRole, type SymbolKind } from './symbols.ts';

/** Which side of a part its words (name, value, result) go on. */
export type LabelSide = 'right' | 'left' | 'above' | 'below';

export const LABEL_SIDES: readonly LabelSide[] = ['right', 'left', 'above', 'below'];

/** Where a node's name goes around its label point. The far spots clear the widest symbol on a vertical wire. */
export type NodeSpot = 'above-right' | 'above-left' | 'below-right' | 'below-left' | 'right' | 'left' | 'far-right' | 'far-left';

export const NODE_SPOTS: readonly NodeSpot[] = ['above-right', 'above-left', 'below-right', 'below-left', 'right', 'left', 'far-right', 'far-left'];

/** Where a part sits: its centre (midway between its pins), its turn and whether it is mirrored. */
export interface PartPlacement {
  at: Point;
  rot: Rotation;
  mirror: boolean;
  /** Where its words go; automatic when undefined (the side the turn and mirroring give, else the other). */
  side?: LabelSide;
}

/** A ground symbol: its pin, and its turn (0: the bars point down). */
export interface GroundPlacement {
  at: Point;
  rot: Rotation;
}

/** A node's name written at a point on its wires or pins. */
export interface NodeLabel {
  /** ngspice's name of the node (lower-case). */
  node: string;
  at: Point;
  /** Where the name goes around the point; automatic (the first free spot) when undefined. */
  side?: NodeSpot;
}

export interface Drawing {
  /** By part key (lower-case name). */
  parts: Map<string, PartPlacement>;
  grounds: GroundPlacement[];
  /** Orthogonal polylines on the grid. */
  wires: Point[][];
  labels: NodeLabel[];
}

export function emptyDrawing(): Drawing {
  return { parts: new Map(), grounds: [], wires: [], labels: [] };
}

export const clonePlacement = (p: PartPlacement): PartPlacement => (p.side ? { at: p.at, rot: p.rot, mirror: p.mirror, side: p.side } : { at: p.at, rot: p.rot, mirror: p.mirror });

export const cloneLabel = (l: NodeLabel): NodeLabel => (l.side ? { node: l.node, at: l.at, side: l.side } : { node: l.node, at: l.at });

export function cloneDrawing(d: Drawing): Drawing {
  return {
    parts: new Map([...d.parts].map(([k, p]) => [k, clonePlacement(p)])),
    grounds: d.grounds.map((g) => ({ at: g.at, rot: g.rot })),
    wires: d.wires.map((w) => w.slice()),
    labels: d.labels.map(cloneLabel),
  };
}

/** A symbol in place: its pins and boxes in drawing coordinates. */
export interface SymbolGeometry {
  kind: SymbolKind;
  at: Point;
  rot: Rotation;
  mirror: boolean;
  pins: Point[];
  outward: Direction[];
  roles: PinRole[];
  body: Box;
  /** Body and leads: nothing else may enter it, except at the pins. */
  box: Box;
}

export function symbolGeometry(kind: SymbolKind, at: Point, rot: Rotation, mirror: boolean): SymbolGeometry {
  const def = SYMBOLS[kind];
  return {
    kind,
    at,
    rot,
    mirror,
    pins: def.pins.map((p) => transform(p, at, rot, mirror)),
    outward: def.outward.map((d) => transformDirection(d, rot, mirror)),
    roles: def.roles.slice(),
    body: transformBox(def.body, at, rot, mirror),
    box: transformBox(def.box, at, rot, mirror),
  };
}

export const partGeometry = (part: CircuitPart, p: PartPlacement): SymbolGeometry => symbolGeometry(part.letter, p.at, p.rot, p.mirror);

export const groundGeometry = (g: GroundPlacement): SymbolGeometry => symbolGeometry('ground', g.at, g.rot, false);

/** True for a part turned so that its pins are one above the other. */
export const isUpright = (rot: Rotation): boolean => rot === 0 || rot === 180;

// ------------------------------------------------------------------ the words on a part

const UNITS: Partial<Record<string, string>> = { R: 'Ω', C: 'F', L: 'H', V: 'V', I: 'A' };
/** The longest line of a value before it is shortened (the full text is in the netlist and the descriptions). */
export const MAX_VALUE_CHARS = 18;

const CLOSERS: Readonly<Record<string, string>> = { '(': ')', '{': '}', '[': ']' };

/** A long value shortened with "…", its brackets still closed: "{2*rload+…}". */
export function shorten(s: string, max: number = MAX_VALUE_CHARS): string {
  if (s.length <= max) return s;
  const open: string[] = [];
  let keep = '';
  for (const ch of s.slice(0, max - 1)) {
    keep += ch;
    if (CLOSERS[ch]) open.push(CLOSERS[ch]);
    else if (open[open.length - 1] === ch) open.pop();
  }
  return `${keep}…${open.reverse().join('')}`;
}

/** What controls a dependent source, written short: "V(c)", "V(c, d)", "I(Vs)". */
export function controlText(part: CircuitPart): string {
  const c = part.control;
  if (!c) return '';
  if (c.kind === 'current') return `I(${c.sourceText || '?'})`;
  const plus = c.plusText || '?';
  return c.minus === '0' ? `V(${plus})` : `V(${plus}, ${c.minusText || '?'})`;
}

const plainNumber = (t: string | undefined): number | undefined => (t === undefined ? undefined : readNumber(t)?.value);

/**
 * A transient source function in a few words, from the meaning of its numbers in
 * docs/spice-facts/explanations.md: PULSE's start and pulse values (P18), SIN's offset, amplitude
 * and frequency (P19), EXP's start and end values (P20b), PWL's (time, value) points (P20). Other
 * functions, and functions whose numbers are not plain numbers, are written as they are, shortened
 * to their name when long ("SFFM(…)").
 */
export function functionWords(fn: { name: string; args: readonly string[] }, unit: string): string {
  const name = fn.name.toUpperCase();
  const n = fn.args.map(plainNumber);
  const v = (x: number): string => formatSI(x, unit);
  const [a, b, c] = n;
  switch (fn.name) {
    case 'pulse':
    case 'exp':
      if (a !== undefined && b !== undefined) return `${name} ${v(a)} → ${v(b)}`;
      break;
    case 'sin':
    case 'sine':
      if (a !== undefined && b !== undefined) return `SIN ${a === 0 ? '' : `${v(a)} `}± ${v(b)}${c !== undefined && c !== 0 ? `, ${formatSI(c, 'Hz')}` : ''}`;
      break;
    case 'pwl':
      if (n.length >= 2 && n.length % 2 === 0 && n.every((x) => x !== undefined)) return `PWL, ${n.length / 2} points`;
      break;
  }
  const written = `${name}(${fn.args.join(' ')})`;
  return written.length <= MAX_VALUE_CHARS ? written : `${name}(…)`;
}

/**
 * The value lines written next to a part, the main one first: "4 Ω", "1 µF", "6 V", "3 A"; a source's
 * DC value, then its AC value as written ("AC 1"), then its transient function in a few words
 * ("PULSE 0 V → 5 V"); a dependent source's gain and control: "2 × V(c)", "3 × I(Vs)",
 * "0.5 A/V × V(c)", "4 V/A × I(Vs)". "?" when the line has no value.
 */
export function valueLines(part: CircuitPart): string[] {
  const v = part.value;
  switch (part.letter) {
    case 'E':
    case 'F':
    case 'G':
    case 'H': {
      const gain = v !== undefined ? formatNumber(v) : part.valueText ? shorten(part.valueText, 8) : '?';
      const unit = part.letter === 'G' ? ' A/V' : part.letter === 'H' ? ' V/A' : '';
      return [`${gain}${unit} × ${controlText(part)}`];
    }
    case 'V':
    case 'I': {
      const unit = UNITS[part.letter]!;
      const lines: string[] = [];
      if (v !== undefined) lines.push(formatSI(v, unit));
      else if (part.valueText && !/^dc$/i.test(part.valueText)) lines.push(shorten(part.valueText));
      if (part.ac) lines.push(shorten(part.ac));
      if (part.fn) lines.push(functionWords(part.fn, unit));
      return lines.length ? lines : ['?'];
    }
    default:
      if (v !== undefined) return [formatSI(v, UNITS[part.letter] ?? '')];
      return [part.valueText ? shorten(part.valueText) : '?'];
  }
}

/** The main value written next to a part (the first of `valueLines`). */
export const valueLabel = (part: CircuitPart): string => valueLines(part)[0]!;

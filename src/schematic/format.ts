/**
 * The drawing format: exact positions kept inside the netlist as comment lines, which ngspice
 * ignores (drawing-1 in docs/spice-facts/drawing.md: checked in native ngspice 47 and 42 and in our
 * engine), so a circuit from a video opens drawn exactly as in the video. Plain TypeScript.
 *
 *   * plainspice-drawing v1
 *   *@ V1 0 3 0 m              a part by name: centre x, y (grid units), rotation 0/90/180/270, m = mirrored
 *   *@ R1 4 0 270 side=below   ... and where its words go (right, left, above, below; else automatic)
 *   *@ part Ground 8 3 0       the same, for a part named like a keyword (ground, wire, label, part)
 *   *@ ground 0 6 0            a ground symbol: its pin x, y and rotation (0: bars down)
 *   *@ wire 0,0 6,0 6,1        a wire: a polyline of x,y points
 *   *@ label out 6 0           a node's name written at a point on its wires or pins
 *   *@ label out 6 0 side=below-right   ... and where its words go (see NODE_SPOTS; else automatic)
 *
 * Positions refer to parts by name, so editing a value or a node in the text keeps the drawing.
 * Reading never fails and never takes long, whatever the lines say:
 * - a line PlainSpice cannot read, a coordinate beyond ±COORD_LIMIT, or lines past the limits on
 *   their number and on the wires' length are kept as written and reported, never used;
 * - a key=value field PlainSpice does not know is ignored and reported, so a later version can add
 *   fields that this one reads past;
 * - lines below a header of another version ("* plainspice-drawing v2") belong to that version: they
 *   are kept exactly where they are, header included, and not used; a header without a version is
 *   read as version 1, like *@ lines without a header.
 * A drawing that gives only some parts keeps those positions; the rest are laid out (schematic.ts).
 *
 * This module only reads and writes the lines; the drawing itself (drawing.ts) does not depend on
 * where they are kept, so the same lines can travel in a share link instead of the netlist.
 */
import type { Netlist, TextChange } from '../spice/types.ts';
import { lowerAscii, parseNetlist } from '../spice/parse.ts';
import type { Circuit } from './circuit.ts';
import type { Drawing, GroundPlacement, LabelSide, NodeSpot } from './drawing.ts';
import { LABEL_SIDES, NODE_SPOTS } from './drawing.ts';
import { pt, type Point, type Rotation } from './geometry.ts';

export const DRAWING_VERSION = 1;
export const DRAWING_HEADER = `* plainspice-drawing v${DRAWING_VERSION}`;
/** Every drawing line starts with this. */
export const DRAWING_PREFIX = '*@';
/** The largest coordinate a drawing line may use, either sign (grid units). */
export const COORD_LIMIT = 2000;
/** The most drawing lines read; more are kept as written but not used. */
export const MAX_DRAWING_LINES = 2000;
/** The most wire, in grid units, and the most wire points, read in all. */
export const MAX_WIRE_LENGTH = 20_000;
export const MAX_WIRE_POINTS = 20_000;

const HEADER = /^\s*\*\s*plainspice-drawing\b(?:\s+v(\d+))?/i;
const LINE = /^\s*\*@/;
const KEYWORDS = new Set(['ground', 'wire', 'label', 'part']);

export type DrawingProblemKind =
  | 'unreadable-line'
  | 'out-of-range'
  | 'too-many-lines'
  | 'unknown-field'
  | 'unknown-version'
  | 'no-header'
  | 'unknown-part'
  | 'unknown-label'
  | 'duplicate-position'
  | 'renamed-part'
  | 'placed-part'
  | 'moved-part'
  | 'label-moved'
  | 'label-renamed'
  | 'label-dropped'
  | 'ground-added'
  | 'ground-removed'
  | 'wires-redrawn'
  | 'connected-by-name'
  | 'slanted-wire'
  | 'orphans-dropped'
  | 'drawing-failed';

/** Something about the drawing lines worth telling (they never stop the drawing). */
export interface DrawingProblem {
  kind: DrawingProblemKind;
  /** 'warning': something in the lines was wrong or ignored; 'info': what PlainSpice did. */
  severity: 'warning' | 'info';
  /** 1-based netlist line, when it is about one line. */
  line?: number;
  message: string;
}

export interface PositionLine {
  /** As written. */
  name: string;
  at: Point;
  rot: Rotation;
  mirror: boolean;
  /** Where the part's words go, when the line says. */
  side?: LabelSide;
  /** 1-based netlist line (0 when not from a netlist). */
  line: number;
  /** The line as written. */
  text: string;
}

export interface LabelLine {
  /** ngspice's name of the node (lower-case). */
  node: string;
  at: Point;
  /** Where the name goes around the point, when the line says. */
  side?: NodeSpot;
  line: number;
  /** The line as written. */
  text: string;
}

/** What the drawing lines say. */
export interface DrawingLines {
  /** Part positions by lower-case name (the first line for a name wins). */
  parts: Map<string, PositionLine>;
  grounds: GroundPlacement[];
  wires: Point[][];
  labels: LabelLine[];
  /** Lines kept exactly as written because PlainSpice cannot read or use them. */
  unreadable: { line: number; text: string }[];
  /**
   * Lines of another version's drawing (its header included), in order. They stay where they are;
   * while there are any, changes made in the drawing are refused (edit.ts).
   */
  foreign: { line: number; text: string }[];
  problems: DrawingProblem[];
  /** 0-based indexes in the netlist of this version's drawing lines (header included). */
  lineIndexes: number[];
  /** True when there is any drawing line at all. */
  present: boolean;
}

const INT = /^[+-]?\d{1,9}$/;
const int = (s: string | undefined): number | undefined => (s !== undefined && INT.test(s) ? Number(s) : undefined);
const rotation = (s: string | undefined): Rotation | undefined => {
  const n = int(s);
  return n === 0 || n === 90 || n === 180 || n === 270 ? n : undefined;
};
const coord = (s: string): Point | undefined => {
  const m = /^([+-]?\d{1,9}),([+-]?\d{1,9})$/.exec(s);
  return m ? pt(Number(m[1]), Number(m[2])) : undefined;
};
const inRange = (...values: number[]): boolean => values.every((v) => Math.abs(v) <= COORD_LIMIT);

const MESSAGES = {
  unreadable: (line: number, text: string): string => `Line ${line} is not a drawing line PlainSpice can read, so it is kept as written: ${text.trim()}`,
  outOfRange: (line: number): string =>
    `Line ${line} puts something farther than ${COORD_LIMIT} grid units from the middle of the drawing, so it is kept as written but not used.`,
  tooMany: (line: number): string => `There are too many drawing lines: the ones from line ${line} on are kept as written but not used.`,
  unknownField: (line: number, field: string): string => `Line ${line} says "${field}", which this version of PlainSpice does not know, so that part of the line is ignored.`,
  otherVersion: (line: number, header: string): string =>
    `The drawing lines from line ${line} were written by another version of PlainSpice (${header}), so they are kept as written but not used.`,
  versionless: (line: number): string => `The drawing header on line ${line} has no version; its lines are read as version ${DRAWING_VERSION}.`,
  noHeader: (line: number): string => `The *@ lines have no "${DRAWING_HEADER}" line above them (line ${line}); they are read as version ${DRAWING_VERSION}.`,
  duplicate: (name: string, first: number, line: number): string => `${name} already has a position on line ${first}; line ${line} is kept as written but not used.`,
} as const;

/** Splits "key=value" words off the end of a line's words; `bad` when a plain word follows a field. */
function fieldsOf(words: readonly string[]): { plain: string[]; fields: [string, string][]; bad: boolean } {
  const plain: string[] = [];
  const fields: [string, string][] = [];
  for (const w of words) {
    const eq = w.indexOf('=');
    if (eq > 0) fields.push([lowerAscii(w.slice(0, eq)), w.slice(eq + 1)]);
    else if (fields.length || eq === 0) return { plain, fields, bad: true };
    else plain.push(w);
  }
  return { plain, fields, bad: false };
}

type Reading = { ok: true } | { ok: false; why: 'unreadable' | 'range' };

/** Reads drawing lines (headers and *@ lines, in order). `line` is the 1-based netlist line. */
export function parseDrawingLines(input: readonly { text: string; line: number }[]): DrawingLines {
  const out: DrawingLines = { parts: new Map(), grounds: [], wires: [], labels: [], unreadable: [], foreign: [], problems: [], lineIndexes: [], present: input.length > 0 };
  // The block each line belongs to: undefined before any header, else the version of the header above it.
  let version: number | undefined;
  let headerless = false;
  let read = 0;
  const budget = { length: 0, points: 0 };
  let full = false;
  for (const l of input) {
    const header = HEADER.exec(l.text);
    if (header && !LINE.test(l.text)) {
      version = header[1] === undefined ? DRAWING_VERSION : Number(header[1]);
      if (version !== DRAWING_VERSION) {
        out.foreign.push(l);
        out.problems.push({ kind: 'unknown-version', severity: 'warning', line: l.line, message: MESSAGES.otherVersion(l.line, l.text.trim().replace(/^\*\s*/, '')) });
      } else if (header[1] === undefined) {
        out.problems.push({ kind: 'no-header', severity: 'info', line: l.line, message: MESSAGES.versionless(l.line) });
      }
      continue;
    }
    if (!LINE.test(l.text)) continue;
    if (version !== undefined && version !== DRAWING_VERSION) {
      out.foreign.push(l);
      continue;
    }
    if (version === undefined && !headerless) {
      headerless = true;
      out.problems.push({ kind: 'no-header', severity: 'info', line: l.line, message: MESSAGES.noHeader(l.line) });
    }
    if (full || read >= MAX_DRAWING_LINES) {
      if (!full) out.problems.push({ kind: 'too-many-lines', severity: 'warning', line: l.line, message: MESSAGES.tooMany(l.line) });
      full = true;
      out.unreadable.push(l);
      continue;
    }
    read += 1;
    const r = readLine(l, out, budget);
    if (!r.ok) {
      out.unreadable.push(l);
      if (r.why === 'range') out.problems.push({ kind: 'out-of-range', severity: 'warning', line: l.line, message: MESSAGES.outOfRange(l.line) });
      else out.problems.push({ kind: 'unreadable-line', severity: 'warning', line: l.line, message: MESSAGES.unreadable(l.line, l.text) });
    }
  }
  return out;
}

function readLine(l: { text: string; line: number }, out: DrawingLines, budget: { length: number; points: number }): Reading {
  const words = l.text.replace(LINE, '').trim().split(/\s+/).filter(Boolean);
  const kw = lowerAscii(words[0] ?? '');
  const unknownFields = (fields: readonly [string, string][], known: Record<string, (v: string) => boolean>): boolean => {
    for (const [k, v] of fields) {
      if (known[k]?.(v)) continue;
      out.problems.push({ kind: 'unknown-field', severity: 'info', line: l.line, message: MESSAGES.unknownField(l.line, `${k}=${v}`) });
    }
    return true;
  };
  if (kw === 'wire') {
    const points = words.slice(1).map(coord);
    if (points.length < 2 || points.some((p) => !p)) return { ok: false, why: 'unreadable' };
    const ps = points as Point[];
    if (!ps.every((p) => inRange(p.x, p.y))) return { ok: false, why: 'range' };
    let length = 0;
    for (let i = 1; i < ps.length; i++) length += Math.abs(ps[i]!.x - ps[i - 1]!.x) + Math.abs(ps[i]!.y - ps[i - 1]!.y);
    if (budget.length + length > MAX_WIRE_LENGTH || budget.points + ps.length > MAX_WIRE_POINTS) return { ok: false, why: 'range' };
    budget.length += length;
    budget.points += ps.length;
    out.wires.push(ps);
    return { ok: true };
  }
  const { plain, fields, bad } = fieldsOf(words.slice(1));
  if ((kw === 'ground' || kw === 'label') && bad) return { ok: false, why: 'unreadable' };
  if (kw === 'ground') {
    const x = int(plain[0]);
    const y = int(plain[1]);
    const rot = plain[2] === undefined ? 0 : rotation(plain[2]);
    if (x === undefined || y === undefined || rot === undefined || plain.length > 3) return { ok: false, why: 'unreadable' };
    if (!inRange(x, y)) return { ok: false, why: 'range' };
    unknownFields(fields, {});
    out.grounds.push({ at: pt(x, y), rot });
    return { ok: true };
  }
  if (kw === 'label') {
    const node = plain[0];
    const x = int(plain[1]);
    const y = int(plain[2]);
    if (!node || x === undefined || y === undefined || plain.length > 3) return { ok: false, why: 'unreadable' };
    if (!inRange(x, y)) return { ok: false, why: 'range' };
    const label: LabelLine = { node: lowerAscii(node) === 'gnd' ? '0' : lowerAscii(node), at: pt(x, y), line: l.line, text: l.text };
    unknownFields(fields, {
      side: (v) => {
        const s = lowerAscii(v) as NodeSpot;
        if (!NODE_SPOTS.includes(s)) return false;
        label.side = s;
        return true;
      },
    });
    out.labels.push(label);
    return { ok: true };
  }
  const rest = kw === 'part' ? words.slice(1) : words;
  const split = fieldsOf(rest.slice(1));
  const name = rest[0];
  const [xs, ys, rs, flag] = split.plain;
  const x = int(xs);
  const y = int(ys);
  const rot = rotation(rs);
  if (split.bad || !name || name.includes('=') || x === undefined || y === undefined || rot === undefined || split.plain.length > 4) return { ok: false, why: 'unreadable' };
  if (flag !== undefined && lowerAscii(flag) !== 'm') return { ok: false, why: 'unreadable' };
  if (!inRange(x, y)) return { ok: false, why: 'range' };
  const key = lowerAscii(name);
  if (out.parts.has(key)) {
    out.problems.push({ kind: 'duplicate-position', severity: 'warning', line: l.line, message: MESSAGES.duplicate(name, out.parts.get(key)!.line, l.line) });
    out.unreadable.push(l);
    return { ok: true };
  }
  const position: PositionLine = { name, at: pt(x, y), rot, mirror: flag !== undefined, line: l.line, text: l.text };
  unknownFields(split.fields, {
    side: (v) => {
      const s = lowerAscii(v) as LabelSide;
      if (!LABEL_SIDES.includes(s)) return false;
      position.side = s;
      return true;
    },
  });
  out.parts.set(key, position);
  return { ok: true };
}

/** The drawing lines of a parsed netlist (the title line never is one). */
export function readDrawing(netlist: Netlist): DrawingLines {
  const picked = netlist.lines.filter((l) => l.index > 0 && l.kind === 'comment' && (LINE.test(l.text) || HEADER.test(l.text)));
  const out = parseDrawingLines(picked.map((l) => ({ text: l.text, line: l.number })));
  const foreign = new Set(out.foreign.map((f) => f.line));
  out.lineIndexes = picked.filter((l) => !foreign.has(l.number)).map((l) => l.index);
  return out;
}

/** True when a netlist line is a drawing line (a header or a *@ line). */
export const isDrawingLine = (text: string): boolean => LINE.test(text) || HEADER.test(text);

const fmt = (p: Point): string => `${p.x},${p.y}`;

/**
 * The drawing lines for a drawing, header first: parts in netlist order, then ground symbols, wires
 * and labels, then the lines to keep as written (`kept`).
 */
export function serializeDrawing(circuit: Circuit, drawing: Drawing, kept: readonly string[] = []): string[] {
  const out = [DRAWING_HEADER];
  for (const part of circuit.parts) {
    const p = drawing.parts.get(part.key);
    if (!p) continue;
    const name = KEYWORDS.has(lowerAscii(part.name)) ? `part ${part.name}` : part.name;
    out.push(`${DRAWING_PREFIX} ${name} ${p.at.x} ${p.at.y} ${p.rot}${p.mirror ? ' m' : ''}${p.side ? ` side=${p.side}` : ''}`);
  }
  for (const g of drawing.grounds) out.push(`${DRAWING_PREFIX} ground ${g.at.x} ${g.at.y} ${g.rot}`);
  for (const w of drawing.wires) out.push(`${DRAWING_PREFIX} wire ${w.map(fmt).join(' ')}`);
  for (const l of drawing.labels) out.push(`${DRAWING_PREFIX} label ${circuit.nodes.get(l.node)?.text ?? l.node} ${l.at.x} ${l.at.y}${l.side ? ` side=${l.side}` : ''}`);
  for (const k of kept) out.push(k.trim());
  return out;
}

const lineStart = (netlist: Netlist, i: number): number => netlist.lines[i]!.span.from;
const lineEnd = (netlist: Netlist, i: number): number => netlist.lines[i + 1]?.span.from ?? netlist.text.length;

/** The line break the netlist uses. */
export const newlineOf = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n');

/** The title line a netlist gets when a line must be written into an empty text (SPICE always skips line 1). */
export const NEW_TITLE = '* circuit';

/**
 * Text changes that replace the netlist's drawing lines with `block` (from serializeDrawing; [] to
 * remove them). An existing block is replaced where it is; a new one goes just before .end, or at
 * the end when there is no .end (never on line 1, which SPICE skips: an empty text gets a title
 * line first). Lines of another version's drawing stay as they are. Positions refer to `netlist.text`.
 */
export function drawingBlockChanges(netlist: Netlist, block: readonly string[]): TextChange[] {
  const text = netlist.text;
  const nl = newlineOf(text);
  const blockText = block.map((l) => `${l}${nl}`).join('');
  const existing = readDrawing(netlist).lineIndexes;
  if (existing.length) {
    const first = existing[0]!;
    const last = existing[existing.length - 1]!;
    const contiguous = last - first + 1 === existing.length;
    if (contiguous) {
      const from = lineStart(netlist, first);
      const to = lineEnd(netlist, last);
      let insert = blockText;
      // The last line of a file without a final line break keeps having none.
      if (to === text.length && !text.slice(from, to).endsWith('\n')) insert = insert.replace(/\r?\n$/, '');
      return text.slice(from, to) === insert ? [] : [{ from, to, insert }];
    }
    const changes: TextChange[] = existing.map((i) => ({ from: lineStart(netlist, i), to: lineEnd(netlist, i), insert: '' }));
    changes[0] = { ...changes[0]!, insert: blockText };
    return changes;
  }
  if (!blockText) return [];
  if (netlist.end !== undefined) {
    const at = lineStart(netlist, netlist.end);
    return [{ from: at, to: at, insert: blockText }];
  }
  const at = text.length;
  if (!text.length) return [{ from: 0, to: 0, insert: `${NEW_TITLE}${nl}${blockText}` }];
  const lead = text.endsWith('\n') ? '' : nl;
  return [{ from: at, to: at, insert: `${lead}${blockText}` }];
}

/** The netlist without its drawing lines, of any version (for keeping positions somewhere else, such as a share link). */
export function stripDrawing(text: string): string {
  const netlist = parseNetlist(text);
  const lines = readDrawing(netlist);
  const foreign = new Set(lines.foreign.map((f) => f.line - 1));
  const changes = drawingBlockChanges(netlist, []);
  for (const i of foreign) changes.push({ from: lineStart(netlist, i), to: lineEnd(netlist, i), insert: '' });
  return applyChanges(text, changes);
}

/** Applies text changes computed on `text` (positions refer to it), like a check's fix. */
export function applyChanges(text: string, changes: readonly TextChange[]): string {
  let out = text;
  for (const c of [...changes].sort((a, b) => b.from - a.from || b.to - a.to)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return out;
}

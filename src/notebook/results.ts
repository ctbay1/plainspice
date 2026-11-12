/**
 * The results of a run, placed on the drawing: each node's voltage next to its name, each part's
 * current with an arrow the way it flows, each source's power ("delivers" or "absorbs"), and a 0 V
 * source as what it is, a meter ("measures"). Every number and word comes from the model's results
 * in words (src/spice/describe.ts, describeResults), formatted by src/format/si.ts as there; this
 * file only decides where each goes: in the lines the schematic model keeps free for results
 * (SceneOptions.resultRoom), so a result never lands on a symbol, a wire or other words. Plain
 * TypeScript: no DOM, no React.
 */
import { formatSI } from '../format/si.ts';
import { DESCRIBE_STRINGS, type CurrentWords, type NodeVoltageWords, type ResultsInWords } from '../spice/describe.ts';
import { lowerAscii } from '../spice/parse.ts';
import { INLINE_RESULT_GAP, OPPOSITE, type Box, type CircuitPart, type Direction, type PlacedNodeLabel, type Scene, type TextLine } from '../schematic/index.ts';
import { ARROW_ICON, TYPE, resultWidth, widthIn } from './measure.ts';
import { NOTEBOOK_STRINGS } from './strings.ts';

/**
 * A voltage source whose DC value is 0 (written or missing) and that has no transient function:
 * describe.ts reads its current as a meter (the ammeter trick, P9, P16) and claims no power for it.
 * A source with only an AC value is no meter there (it is an AC source), but it is 0 V in .op too, so
 * it has no power either and the one line kept here fits its current.
 */
export function isAmmeter(part: CircuitPart): boolean {
  return part.letter === 'V' && !part.sourceFunction && (part.valueText === '' || part.value === 0);
}

/** Parts with a power to write: describe.ts gives power for sources (an ammeter excepted). */
const SOURCES: ReadonlySet<string> = new Set(['V', 'I', 'E', 'F', 'G', 'H']);

/** The power words without their number ("delivers", "absorbs"): the number goes on the line below. */
const POWER_WORDS = [DESCRIBE_STRINGS.noteDelivers('').trim(), DESCRIBE_STRINGS.noteAbsorbs('').trim()] as const;

/** Room for any current of four digits with a prefix, after its arrow. */
export const CURRENT_ROOM = '→ 888.8 mA';
/** Room for any power of four digits with a prefix. */
export const POWER_ROOM = '888.8 mW';
/** Room for the wider power word. */
export const POWER_WORD_ROOM = POWER_WORDS.reduce((a, b) => (resultWidth(a) >= resultWidth(b) ? a : b));
/** Room for a 0 V source's one line: "measures", then its current. */
export const METER_ROOM = `${NOTEBOOK_STRINGS.measures} ${CURRENT_ROOM}`;

/**
 * The result lines the Notebook keeps under a part's values (SceneOptions.resultRoom): its current;
 * for a source also its power, the word on one line and the number on the next (narrow, so the
 * drawing stays as narrow as it can for a phone); for a 0 V source one line, "measures" and its
 * current. (Two lines there would make a 0 V source in a column of parts reach the node name
 * below it, as in sp01-3: the layout spaces a column by its symbols, not by its words.)
 */
export function resultRoom(part: CircuitPart): string[] {
  if (isAmmeter(part)) return [METER_ROOM];
  if (SOURCES.has(part.letter)) return [CURRENT_ROOM, POWER_WORD_ROOM, POWER_ROOM];
  return [CURRENT_ROOM];
}

export type ResultTone = 'current' | 'power' | 'voltage';

/** One result written on the drawing: [lead] [arrow] text, e.g. "measures → 3 A", "→ 4 A", "96 W". */
export interface ResultMark {
  /** The line the scene keeps for it: where it goes, its alignment and its room. */
  line: TextLine;
  /** Words before the arrow ("measures"). */
  lead?: string;
  /** An arrow before the text, pointing the way the current flows on the drawing. */
  arrow?: Direction;
  text: string;
  tone: ResultTone;
  /** 1 when it fits the room kept; below 1 when it is written smaller to fit (a number in exponent form, say). */
  scale: number;
}

export interface PartMarks {
  key: string;
  current: CurrentWords;
  /** The way the part's current flows on the drawing; undefined when no current flows. */
  direction?: Direction;
  marks: ResultMark[];
  /** The same results in the model's words, for screen readers. */
  speech: string;
}

export interface NodeMarks {
  /** Index of the node's name in scene.nodeLabels. */
  label: number;
  node: string;
  words: NodeVoltageWords;
  mark?: ResultMark;
}

export interface DrawingResults {
  parts: Map<string, PartMarks>;
  nodes: NodeMarks[];
  /** Marks written smaller than their room (none for the examples: the tests check it). */
  squeezed: ResultMark[];
}

export const NO_RESULTS: DrawingResults = { parts: new Map(), nodes: [], squeezed: [] };

/** A node's result line on the same row as its name (SceneOptions.nodeResultInline). */
export const isInline = (lines: readonly TextLine[], result: TextLine): boolean => lines.some((l) => l.role === 'node' && Math.abs(l.y - result.y) < 1e-9);

/** A value written after a name on its line, in the model's notation (describe.ts, valueIs): "= 12 V". */
export const inlineValue = (text: string): string => DESCRIBE_STRINGS.valueIs('', text).trim();

/** The room a line keeps, in grid units (its box less the margin lineBox adds on each side). */
export const roomOf = (line: TextLine): number => line.box.x1 - line.box.x0 - 0.1;

/** The text a mark stands for, its arrow written "→" (measure.ts counts it as the arrow icon). */
export const markText = (m: Pick<ResultMark, 'lead' | 'arrow' | 'text'>): string => `${m.lead ? `${m.lead} ` : ''}${m.arrow ? '→' : ''}${m.text}`;

/** How wide a mark is drawn, in the wider of the handwriting and the plain font. */
export const markWidth = (m: Pick<ResultMark, 'lead' | 'arrow' | 'text'>): number => resultWidth(markText(m));

function makeMark(line: TextLine, parts: Pick<ResultMark, 'lead' | 'arrow' | 'text'>, tone: ResultTone): ResultMark {
  const width = markWidth(parts);
  const room = roomOf(line);
  const scale = width <= room + 1e-9 ? 1 : room / width;
  const m: ResultMark = { line, text: parts.text, tone, scale };
  if (parts.lead) m.lead = parts.lead;
  if (parts.arrow) m.arrow = parts.arrow;
  return m;
}

/**
 * Places a run's results on the scene. `words` must be numbers worth showing (describeResults with
 * status 'ok' and no error-level check: solve.ts's `answers`): a failed run's numbers are never
 * shown as answers.
 */
export function placeResults(scene: Scene, words: ResultsInWords | undefined): DrawingResults {
  if (!words) return NO_RESULTS;
  const parts = new Map<string, PartMarks>();
  const squeezed: ResultMark[] = [];
  const currents = new Map(words.currents.map((c) => [c.element, c]));
  for (const p of scene.parts) {
    const c = currents.get(p.key);
    if (!c) continue;
    const lines = p.labels.filter((l) => l.role === 'result');
    // SPICE's sign: positive from the first node (pin 0) through the part to the second (C1-C8).
    const direction = c.value > 0 ? p.arrow.direction : c.value < 0 ? OPPOSITE[p.arrow.direction] : undefined;
    const amps = formatSI(Math.abs(c.value), 'A');
    const marks: ResultMark[] = [];
    const add = (i: number, m: Pick<ResultMark, 'lead' | 'arrow' | 'text'>, tone: ResultTone): void => {
      const line = lines[i];
      if (!line) return;
      const made = makeMark(line, m, tone);
      if (made.scale < 1) squeezed.push(made);
      marks.push(made);
    };
    const arrow = direction ? { arrow: direction } : {};
    if (c.ammeter) add(0, { lead: NOTEBOOK_STRINGS.measures, text: amps, ...arrow }, 'current');
    else {
      add(0, { text: amps, ...arrow }, 'current');
      if (c.power) {
        add(1, { text: c.power.delivers ? POWER_WORDS[0] : POWER_WORDS[1] }, 'power');
        add(2, { text: formatSI(c.power.watts, 'W') }, 'power');
      }
    }
    const speech = [c.speech, c.power?.speech].filter(Boolean).join('. ');
    parts.set(p.key, direction ? { key: p.key, current: c, direction, marks, speech } : { key: p.key, current: c, marks, speech });
  }
  const voltages = new Map(words.nodes.map((n) => [lowerAscii(n.node), n]));
  const nodes: NodeMarks[] = [];
  scene.nodeLabels.forEach((label, i) => {
    const w = voltages.get(label.node);
    if (!w) return;
    const line = label.lines.find((l) => l.role === 'result');
    if (!line) {
      nodes.push({ label: i, node: label.node, words: w });
      return;
    }
    // On the name's line (NOTEBOOK_OPTIONS.nodeResultInline) it reads on from the name: "s = 12 V".
    const m = makeMark(line, { text: isInline(label.lines, line) ? inlineValue(w.text) : w.text }, 'voltage');
    if (m.scale < 1) squeezed.push(m);
    nodes.push({ label: i, node: label.node, words: w, mark: m });
  });
  return { parts, nodes, squeezed };
}

export interface MarkLayout {
  /** Where the lead and the text start, and where the arrow's centre is, in grid units. */
  leadX?: number;
  arrowX?: number;
  textX: number;
  /** The text's anchor (SVG text-anchor). */
  anchor: 'start' | 'middle' | 'end';
}

/**
 * Where a mark's pieces go on its line, in the font being used (handwriting or plain). Text aligned
 * to the end stays anchored at the end, so it lines up with the name and value above it.
 */
export function markLayout(m: ResultMark, plain: boolean): MarkLayout {
  const { x, align } = m.line;
  if (!m.arrow && !m.lead) return { textX: x, anchor: align };
  const style = plain ? TYPE.plain : TYPE.hand;
  const k = m.scale;
  const lead = m.lead ? widthIn(`${m.lead} `, style, false, false) * k : 0;
  const icon = m.arrow ? ARROW_ICON.width * k : 0;
  const gap = m.arrow ? ARROW_ICON.gap * k : 0;
  const text = widthIn(m.text, style, false, false) * k;
  const at = (start: number): MarkLayout => {
    const l: MarkLayout = { textX: start + lead + icon + gap, anchor: 'start' };
    if (m.lead) l.leadX = start;
    if (m.arrow) l.arrowX = start + lead + icon / 2;
    return l;
  };
  if (align === 'end') return { ...at(x - lead - icon - gap - text), textX: x, anchor: 'end' };
  return at(align === 'start' ? x : x - (lead + icon + gap + text) / 2);
}

/** The box of a mark's words as drawn (its own width, not the room kept for it), grid units. */
export function markBox(m: ResultMark): Box {
  const w = markWidth(m) * m.scale;
  const { x, align, box } = m.line;
  const x0 = align === 'start' ? x : align === 'end' ? x - w : x - w / 2;
  return { x0, y0: box.y0, x1: x0 + w, y1: box.y1 };
}

/**
 * How far right a node's name and its value are drawn from where the scene puts them, when they are
 * written on the left of their point with the value on the name's line ("s = 12 V" left of s): the
 * scene keeps room there for any value and places the pair so that the widest one would end at the
 * point; the value written is narrower (or there is none), so the pair moves right by what it leaves
 * of that room, and ends at its point, as the videos write a name. Within the room the scene kept,
 * so nothing new can overlap.
 */
export function nameShift(label: PlacedNodeLabel, mark: ResultMark | undefined): number {
  if (!label.spot.endsWith('left')) return 0;
  const result = label.lines.find((l) => l.role === 'result');
  if (!result || !isInline(label.lines, result)) return 0;
  const room = roomOf(result);
  return mark ? Math.max(0, room - markWidth(mark) * mark.scale) : room + INLINE_RESULT_GAP;
}

/** nameShift for each of the scene's node names, by its index in scene.nodeLabels. */
export function nameShifts(scene: Scene, results: DrawingResults): number[] {
  const marks = new Map(results.nodes.map((n) => [n.label, n.mark]));
  return scene.nodeLabels.map((l, i) => nameShift(l, marks.get(i)));
}

const moved = (b: Box, dx: number): Box => (dx ? { ...b, x0: b.x0 + dx, x1: b.x1 + dx } : b);

/**
 * Everything written on the drawing, as drawn: names, values, node names (moved up to their point,
 * nameShift), and the results' own widths (a result's line keeps room for any number; a pen stroke
 * may pass where none is written).
 */
export function inkBoxes(scene: Scene, results: DrawingResults): Box[] {
  const out: Box[] = [];
  const shifts = nameShifts(scene, results);
  for (const p of scene.parts) for (const l of p.labels) if (l.role !== 'result') out.push(l.box);
  scene.nodeLabels.forEach((l, i) => {
    for (const line of l.lines) if (line.role !== 'result') out.push(moved(line.box, line.role === 'node' ? shifts[i]! : 0));
  });
  for (const pm of results.parts.values()) for (const m of pm.marks) out.push(markBox(m));
  for (const n of results.nodes) if (n.mark) out.push(moved(markBox(n.mark), shifts[n.label] ?? 0));
  return out;
}

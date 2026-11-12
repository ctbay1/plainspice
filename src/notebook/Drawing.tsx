/**
 * The drawing itself, in the Notebook look: the schematic model's scene (src/schematic, buildScene)
 * as SVG, with the results of a run written on it (results.ts). Ink symbols on the scene's pins and
 * bodies, each wire and lead in its node's colour (src/theme/nodes.ts, colour-blind safe, and never
 * the only signal: every node is named), junction dots, open terminals, stubs where a node goes on
 * to parts the drawing does not show, hops where wires cross; names in the plain sans, values
 * typeset, results handwritten (or in the plain font). Every word is drawn where the scene put it,
 * in the room the model kept for it (measure.ts), so nothing overlaps. Rendering only: no state.
 *
 * Coordinates: grid units times UNIT_PX user units (20, as TEXT.size assumes), so font sizes are
 * ordinary numbers; NotebookCanvas scales the whole drawing to the window.
 */
import { memo, useMemo, type CSSProperties, type ReactNode } from 'react';
import { GROUND, unionBoxes, type Box, type Direction, type NavItem, type PlacedPart, type Scene, type Schematic, type TextLine } from '../schematic/index.ts';
import { TYPE, widthIn } from './measure.ts';
import { NOTE_SIZE, WAS_SCALE, type PenNote, type WasMark } from './notes.ts';
import { markLayout, nameShifts, type DrawingResults, type ResultMark } from './results.ts';
import { ARROWHEAD, GROUND_INK, INK, currentArrow, markPath } from './symbols.ts';

/** User units per grid unit. */
export const UNIT_PX = 20;

const u = (n: number): number => Math.round(n * UNIT_PX * 100) / 100;

const ROTATE: Readonly<Record<Direction, number>> = { right: 0, down: 90, left: 180, up: 270 };

/** A group drawn in grid units (scaled by `k`): notebook.css divides its pen widths by --nb-s, so ink keeps one width. */
const scaled = (k: number): CSSProperties & Record<string, string> => ({ '--nb-s': String(k) });
const SCALED = scaled(UNIT_PX);

export const itemKey = (i: NavItem): string => (i.kind === 'part' ? `p:${i.key}` : `n:${i.name}`);

/** Red pen on the drawing (notes.ts): notes next to what they are about, crossed-out old values, circled values. */
export interface PenMarks {
  notes?: readonly PenNote[];
  was?: readonly WasMark[];
  /** Parts whose value a check says SPICE reads differently from what was meant: circled. */
  circled?: ReadonlySet<string>;
}

export interface DrawingProps {
  schematic: Schematic;
  results: DrawingResults;
  /** CSS colour of each node (ground is drawn in ink). */
  colours: ReadonlyMap<string, string>;
  plain: boolean;
  selected: NavItem | undefined;
  related: readonly NavItem[];
  hovered: NavItem | undefined;
  /** The item the keyboard is on: a ring round its symbol's body (or its name), clear of its words. */
  focused?: NavItem | undefined;
  /** Parts a check found a trap on: their symbols in red pen. */
  traps: ReadonlySet<string>;
  pen?: PenMarks | undefined;
}

function nodeColour(colours: ReadonlyMap<string, string>, node: string | undefined): string | undefined {
  return node && node !== GROUND ? colours.get(node) : undefined;
}

function textAnchor(align: TextLine['align']): 'start' | 'middle' | 'end' {
  return align;
}

/** The room the scene kept for a line, in user units (data-room: the page checks the words fit it). */
const room = (line: TextLine): number => u(line.box.x1 - line.box.x0 - 0.1);

/** A line of words on the drawing. */
function Words({ line, className, children }: { line: TextLine; className: string; children?: ReactNode }): ReactNode {
  return (
    <text className={className} x={u(line.x)} y={u(line.y)} textAnchor={textAnchor(line.align)} dominantBaseline="central" data-room={room(line)}>
      {children ?? line.text}
    </text>
  );
}

/** The arrow before a current, pointing the way it flows. */
function CurrentArrow({ x, y, direction, scale }: { x: number; y: number; direction: Direction; scale: number }): ReactNode {
  const a = currentArrow(0.56);
  return (
    <g className="nb-flow" transform={`translate(${u(x)} ${u(y)}) rotate(${ROTATE[direction]}) scale(${UNIT_PX * scale})`} style={scaled(UNIT_PX * scale)}>
      <path className="nb-flow__shaft" d={a.shaft} />
      <path className="nb-flow__head" d={a.head} />
    </g>
  );
}

/** One result, handwritten (or in the plain font), in the line the scene kept for it. */
function Mark({ m, plain }: { m: ResultMark; plain: boolean }): ReactNode {
  const l = markLayout(m, plain);
  const size = (plain ? TYPE.plain.size : TYPE.hand.size) * m.scale;
  const style = m.scale < 1 ? { fontSize: `${u(size)}px` } : undefined;
  const cls = `nb-result nb-result--${m.tone}`;
  return (
    <g className={cls} data-room={room(m.line)}>
      {m.lead !== undefined && l.leadX !== undefined ? (
        <text className="nb-result__text" x={u(l.leadX)} y={u(m.line.y)} dominantBaseline="central" style={style}>
          {m.lead}
        </text>
      ) : null}
      {m.arrow && l.arrowX !== undefined ? <CurrentArrow x={l.arrowX} y={m.line.y} direction={m.arrow} scale={m.scale} /> : null}
      {/* Keyed by its text: a new number settles in (notebook.css), the old one never blanks out. */}
      <text key={m.text} className="nb-result__text nb-settle" x={u(l.textX)} y={u(m.line.y)} textAnchor={l.anchor} dominantBaseline="central" style={style}>
        {m.text}
      </text>
    </g>
  );
}

/** The keyboard's focus ring: round a symbol's body or a node's name, a little away from it, never across words. */
function FocusRing({ box }: { box: Box }): ReactNode {
  const pad = 0.16;
  return <rect className="nb-focus" x={u(box.x0 - pad)} y={u(box.y0 - pad)} width={u(box.x1 - box.x0 + 2 * pad)} height={u(box.y1 - box.y0 + 2 * pad)} rx={u(0.24)} />;
}

/** Where the focus ring goes for an item: a part's body, a node's name (where it is drawn, nameShift), ground's first symbol. */
function focusBox(s: Schematic, item: NavItem, shifts: readonly number[]): Box | undefined {
  if (item.kind === 'part') return s.scene.parts.find((p) => p.key === item.key)?.body;
  if (item.name === GROUND) return s.scene.grounds[0]?.body;
  const i = s.scene.nodeLabels.findIndex((l) => l.node === item.name);
  const label = s.scene.nodeLabels[i];
  const name = label?.lines.find((l) => l.role === 'node')?.box;
  const dx = shifts[i] ?? 0;
  return name ? { ...name, x0: name.x0 + dx, x1: name.x1 + dx } : label?.box;
}

/** A group moved right by `dx` grid units (a node's name and value drawn up to their point). */
const shifted = (dx: number): string | undefined => (dx ? `translate(${u(dx)} 0)` : undefined);

/** Red pen: a note's words, a stroke to what it is about; old values crossed out; misread values circled. */
function Pen({ pen, schematic }: { pen: PenMarks; schematic: Schematic }): ReactNode {
  const circled = [...(pen.circled ?? [])].flatMap((key) => {
    const p = schematic.scene.parts.find((x) => x.key === key);
    const box = p ? unionBoxes(p.labels.filter((l) => l.role === 'value').map((l) => l.box)) : undefined;
    return box ? [{ key, box }] : [];
  });
  return (
    <g className="nb-pen" aria-hidden="true">
      {circled.map(({ key, box }) => {
        const cx = (box.x0 + box.x1) / 2;
        const cy = (box.y0 + box.y1) / 2;
        return <ellipse key={`c:${key}`} className="nb-pen__circle" cx={u(cx)} cy={u(cy)} rx={u((box.x1 - box.x0) / 2 + 0.32)} ry={u((box.y1 - box.y0) / 2 + 0.12)} transform={`rotate(-4 ${u(cx)} ${u(cy)})`} />;
      })}
      {(pen.notes ?? []).map((n, i) => (
        <g key={`n:${i}`} className="nb-pen__note">
          {n.lines.map((l, k) => (
            <text key={k} className="nb-pen__text" x={u(l.x)} y={u(l.y)} dominantBaseline="central" style={{ fontSize: `${u(NOTE_SIZE)}px` }}>
              {l.text}
            </text>
          ))}
          {n.arrow ? <path className="nb-pen__stroke" d={penArrow(n.arrow.from, n.arrow.to)} /> : null}
        </g>
      ))}
      {(pen.was ?? []).map((w) => (
        <g key={`w:${w.node}`} className="nb-was">
          <text className="nb-was__text" x={u(w.x)} y={u(w.y)} dominantBaseline="central" style={{ fontSize: `${u(TYPE.hand.size * WAS_SCALE)}px` }}>
            {w.text}
          </text>
          <path className="nb-was__strike" d={`M${u(w.box.x0 + 0.02)},${u(w.y + 0.04)} L${u(w.box.x1 - 0.04)},${u(w.y - 0.06)}`} />
        </g>
      ))}
    </g>
  );
}

/** A pen stroke with an open arrowhead at its end (grid units in, user units out). */
function penArrow(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const l = 0.42;
  const w = 0.5;
  const h1 = { x: to.x - l * Math.cos(a - w), y: to.y - l * Math.sin(a - w) };
  const h2 = { x: to.x - l * Math.cos(a + w), y: to.y - l * Math.sin(a + w) };
  return `M${u(from.x)},${u(from.y)} L${u(to.x)},${u(to.y)} M${u(h1.x)},${u(h1.y)} L${u(to.x)},${u(to.y)} L${u(h2.x)},${u(h2.y)}`;
}

function Highlight({ part }: { part: PlacedPart }): ReactNode {
  const b = part.box;
  const pad = 0.38;
  const x = u(b.x0 - pad);
  const y = u(b.y0 - pad);
  const w = u(b.x1 - b.x0 + 2 * pad);
  const h = u(b.y1 - b.y0 + 2 * pad);
  return <rect x={x} y={y} width={w} height={h} rx={u(0.32)} transform={`rotate(-1.6 ${x + w / 2} ${y + h / 2})`} />;
}

function Part({ part, colours, trap }: { part: PlacedPart; colours: ReadonlyMap<string, string>; trap: boolean }): ReactNode {
  const ink = INK[part.letter];
  const t = `translate(${u(part.at.x)} ${u(part.at.y)}) rotate(${part.rot})${part.mirror ? ' scale(-1 1)' : ''} scale(${UNIT_PX})`;
  const lead = (i: 0 | 1): ReactNode => {
    const c = nodeColour(colours, part.pins[i].node);
    return <path className="nb-lead" d={ink.leads[i]} style={c ? { stroke: c } : undefined} />;
  };
  return (
    // A part ngspice leaves out of the circuit (an R, C or L with nothing after its nodes) is drawn
    // in pencil, broken: it is in the netlist but not in what ngspice solved.
    <g className={`nb-part${trap ? ' is-trap' : ''}${part.part.built ? '' : ' is-left-out'}`} data-part={part.key}>
      <g transform={t} style={SCALED}>
        {lead(0)}
        {lead(1)}
        <path className="nb-sym" d={ink.body} />
        {ink.fill ? <path className="nb-sym-fill" d={ink.fill} /> : null}
      </g>
      {part.marks.length ? <path className="nb-signs" d={part.marks.map((m) => markPath(m.text, u(m.at.x), u(m.at.y), 0.19 * UNIT_PX)).join(' ')} /> : null}
      {/* A source whose current an F or H reads: an arrowhead on its lead, the way that current is counted. */}
      {part.part.sensedBy.length ? (
        <path className="nb-sym-fill" d={ARROWHEAD} transform={`translate(${u(part.arrow.at.x)} ${u(part.arrow.at.y)}) rotate(${ROTATE[part.arrow.direction]}) scale(${UNIT_PX})`} />
      ) : null}
    </g>
  );
}

/** A node name with its colour under it (colour plus name, never colour alone). */
function NodeName({ line, colour }: { line: TextLine; colour: string | undefined }): ReactNode {
  const w = widthIn(line.text, TYPE.node, false, false);
  const x0 = line.align === 'start' ? line.x : line.align === 'end' ? line.x - w : line.x - w / 2;
  return (
    <g className="nb-node">
      <Words line={line} className="nb-node__name" />
      <path className="nb-node__bar" d={`M${u(x0)},${u(line.y + 0.36)} H${u(x0 + w)}`} style={colour ? { stroke: colour } : undefined} />
    </g>
  );
}

/**
 * What a dependent source reads, tied to the drawing: in its control label ("0.25 A/V × V(n1)",
 * "2 × I(Vsense)") a node it reads is underlined in that node's colour, like the node's own name,
 * and the source whose current it reads is underlined in ink, like that source's arrowhead.
 */
function ControlMarks({ part, colours }: { part: PlacedPart; colours: ReadonlyMap<string, string> }): ReactNode {
  const c = part.part.control;
  const line = part.labels.find((l) => l.role === 'value');
  if (!c || !line) return null;
  const marks: { from: number; text: string; node?: string }[] = [];
  if (c.kind === 'voltage') {
    const at = line.text.lastIndexOf(`V(${c.plusText}`);
    if (at < 0 || !c.plusText) return null;
    if (c.plus !== GROUND) marks.push({ from: at + 2, text: c.plusText, node: c.plus });
    const minusAt = line.text.indexOf(`, ${c.minusText})`, at);
    if (c.minus !== GROUND && c.minusText && minusAt > 0) marks.push({ from: minusAt + 2, text: c.minusText, node: c.minus });
  } else {
    const at = line.text.lastIndexOf(`I(${c.sourceText})`);
    if (at < 0 || !c.sourceText) return null;
    marks.push({ from: at + 2, text: c.sourceText });
  }
  const total = widthIn(line.text, TYPE.value, false, false);
  const x0 = line.align === 'start' ? line.x : line.align === 'end' ? line.x - total : line.x - total / 2;
  return (
    <g className="nb-control" aria-hidden="true">
      {marks.map((m, i) => {
        const a = x0 + widthIn(line.text.slice(0, m.from), TYPE.value, false, false);
        const b = a + widthIn(m.text, TYPE.value, false, false);
        const colour = m.node ? nodeColour(colours, m.node) : undefined;
        return <path key={i} className={m.node ? 'nb-control__node' : 'nb-control__source'} d={`M${u(a)},${u(line.y + 0.38)} H${u(b)}`} style={colour ? { stroke: colour } : undefined} />;
      })}
    </g>
  );
}

function sameItem(a: NavItem | undefined, b: NavItem): boolean {
  return !!a && itemKey(a) === itemKey(b);
}

export const Drawing = memo(function Drawing({ schematic, results, colours, plain, selected, related, hovered, focused, traps, pen }: DrawingProps): ReactNode {
  const sc = schematic.scene;
  // Names written on the left of their point, moved up to it (nameShift).
  const shifts = useMemo(() => nameShifts(sc, results), [sc, results]);
  const focusedBox = focused ? focusBox(schematic, focused, shifts) : undefined;
  // Each layer is drawn again only when what it shows changes: a hover, a selection or the focus
  // ring changes the highlights and the ring, never the copper, the symbols or the words (second
  // re-check, P2: a drawing at the format's limits took a second to draw again for each hover).
  return (
    <g className={`nb-drawing${plain ? ' is-plain' : ''}`}>
      <Highlights scene={sc} shifts={shifts} selected={selected} related={related} hovered={hovered} />
      <Copper scene={sc} colours={colours} />
      <Symbols scene={sc} colours={colours} traps={traps} />
      <Labels scene={sc} colours={colours} shifts={shifts} />
      <Results results={results} plain={plain} shifts={shifts} />
      {pen ? <Pen pen={pen} schematic={schematic} /> : null}
      {focusedBox ? <FocusRing box={focusedBox} /> : null}
    </g>
  );
});

/** The highlighter under what is selected, related to it, or under the pointer. */
const Highlights = memo(function Highlights({ scene: sc, shifts, selected, related, hovered }: { scene: Scene; shifts: readonly number[]; selected: NavItem | undefined; related: readonly NavItem[]; hovered: NavItem | undefined }): ReactNode {
  const isOn = (item: NavItem, list: readonly NavItem[]): boolean => list.some((x) => sameItem(x, item));
  const highlightClass = (item: NavItem): string | undefined => {
    if (sameItem(selected, item)) return 'is-selected';
    if (isOn(item, related)) return 'is-related';
    if (sameItem(hovered, item)) return 'is-hover';
    return undefined;
  };
  return (
    <g className="nb-highlights" aria-hidden="true">
      {sc.parts.map((p) => {
        const cls = highlightClass({ kind: 'part', key: p.key });
        return cls ? (
          <g key={p.key} className={`nb-hl ${cls}`}>
            <Highlight part={p} />
          </g>
        ) : null;
      })}
      {sc.wires.map((w, i) => {
        const cls = w.node ? highlightClass({ kind: 'node', name: w.node }) : undefined;
        return cls ? <polyline key={`w${i}`} className={`nb-hl nb-hl--wire ${cls}`} points={w.points.map((p) => `${u(p.x)},${u(p.y)}`).join(' ')} /> : null;
      })}
      {sc.nodeLabels.map((l, i) => {
        const cls = highlightClass({ kind: 'node', name: l.node });
        // A highlighter stroke under the name only: its value stays plain to read.
        const b = l.lines.find((x) => x.role === 'node')?.box ?? l.box;
        return cls ? <rect key={`l${i}`} className={`nb-hl nb-hl--name ${cls}`} x={u(b.x0 - 0.1 + shifts[i]!)} y={u(b.y0 + 0.08)} width={u(b.x1 - b.x0 + 0.2)} height={u(b.y1 - b.y0 - 0.12)} rx={u(0.2)} /> : null;
      })}
      {sc.grounds.map((g) => {
        const cls = highlightClass({ kind: 'node', name: GROUND });
        return cls ? <rect key={`g${g.index}`} className={`nb-hl ${cls}`} x={u(g.box.x0 - 0.3)} y={u(g.box.y0 - 0.2)} width={u(g.box.x1 - g.box.x0 + 0.6)} height={u(g.box.y1 - g.box.y0 + 0.5)} rx={u(0.25)} /> : null;
      })}
    </g>
  );
});

/** The wires in their nodes' colours, and a hop where two cross: the horizontal wire hops over the vertical one, in its own colour. */
const Copper = memo(function Copper({ scene: sc, colours }: { scene: Scene; colours: ReadonlyMap<string, string> }): ReactNode {
  return (
    <g className="nb-wires">
      {sc.wires.map((w, i) => {
        const c = nodeColour(colours, w.node);
        return <polyline key={i} className="nb-wire" points={w.points.map((p) => `${u(p.x)},${u(p.y)}`).join(' ')} style={c ? { stroke: c } : undefined} />;
      })}
      {sc.crossings.map((p, i) => {
        // The hopping wire's node, which the scene found at the crossing (scene.ts, crossingNodes).
        const c = nodeColour(colours, sc.crossingNodes[i]) ?? 'var(--nb-ink)';
        return (
          <g key={`x${i}`}>
            <path className="nb-hop-gap" d={`M${u(p.x - 0.3)},${u(p.y)} H${u(p.x + 0.3)}`} />
            <path className="nb-wire" d={`M${u(p.x - 0.3)},${u(p.y)} A${u(0.3)},${u(0.3)} 0 0 1 ${u(p.x + 0.3)},${u(p.y)}`} style={{ stroke: c }} />
          </g>
        );
      })}
    </g>
  );
});

/** The symbols: parts, ground symbols, junction dots, open terminals and stubs. */
const Symbols = memo(function Symbols({ scene: sc, colours, traps }: { scene: Scene; colours: ReadonlyMap<string, string>; traps: ReadonlySet<string> }): ReactNode {
  return (
    <g className="nb-parts">
      {sc.parts.map((p) => (
        <Part key={p.key} part={p} colours={colours} trap={traps.has(p.key)} />
      ))}
      {sc.grounds.map((g) => (
        <g key={`g${g.index}`} className="nb-ground" transform={`translate(${u(g.at.x)} ${u(g.at.y)}) rotate(${g.rot}) scale(${UNIT_PX})`} style={SCALED}>
          <path className="nb-sym" d={`${GROUND_INK.lead} ${GROUND_INK.bars}`} />
        </g>
      ))}
      {sc.junctions.map((j, i) => {
        // The node of the copper at the dot, which the scene found at its point (scene.ts, junctionNodes).
        const c = nodeColour(colours, sc.junctionNodes[i]);
        return <circle key={`j${i}`} className="nb-junction" cx={u(j.x)} cy={u(j.y)} r={u(0.17)} style={c ? { fill: c } : undefined} />;
      })}
      {sc.terminals.map((t, i) => {
        const c = nodeColour(colours, t.node);
        return <circle key={`t${i}`} className="nb-terminal" cx={u(t.at.x)} cy={u(t.at.y)} r={u(0.2)} style={c ? { stroke: c } : undefined} />;
      })}
      {sc.stubs.map((t, i) => {
        const c = nodeColour(colours, t.node);
        return (
          <path
            key={`s${i}`}
            className="nb-stub"
            d="M0.05,-0.26 L0.55,0 L0.05,0.26 Z"
            transform={`translate(${u(t.at.x)} ${u(t.at.y)}) rotate(${ROTATE[t.direction]}) scale(${UNIT_PX})`}
            style={c ? { ...SCALED, stroke: c } : SCALED}
          />
        );
      })}
    </g>
  );
});

/** The words: each part's name and values, and each node's name (moved up to its point, `shifts`). */
const Labels = memo(function Labels({ scene: sc, colours, shifts }: { scene: Scene; colours: ReadonlyMap<string, string>; shifts: readonly number[] }): ReactNode {
  return (
    <g className="nb-words">
      {sc.parts.map((p) => (
        <g key={p.key} className="nb-part-words">
          {p.labels.map((l, i) =>
            l.role === 'name' ? <Words key={i} line={l} className="nb-name" /> : l.role === 'value' ? <Words key={i} line={l} className="nb-value" /> : null,
          )}
          <ControlMarks part={p} colours={colours} />
        </g>
      ))}
      {sc.nodeLabels.map((l, i) => (
        <g key={`n${i}`}>
          {l.lines.map((line, k) =>
            line.role === 'node' ? (
              <g key={k} transform={shifted(shifts[i]!)}>
                <NodeName line={line} colour={nodeColour(colours, l.node)} />
              </g>
            ) : line.role === 'hidden' ? (
              <Words key={k} line={line} className="nb-hidden" />
            ) : null,
          )}
        </g>
      ))}
    </g>
  );
});

/** The results of a run, handwritten in the room the scene kept for them. */
const Results = memo(function Results({ results, plain, shifts }: { results: DrawingResults; plain: boolean; shifts: readonly number[] }): ReactNode {
  return (
    <g className="nb-results">
      {[...results.parts.values()].flatMap((pm) => pm.marks.map((m, i) => <Mark key={`${pm.key}:${i}`} m={m} plain={plain} />))}
      {results.nodes.map((n) =>
        n.mark ? (
          <g key={`node:${n.label}`} transform={shifted(shifts[n.label] ?? 0)}>
            <Mark m={n.mark} plain={plain} />
          </g>
        ) : null,
      )}
    </g>
  );
});

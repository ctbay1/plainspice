/**
 * What the schematic editor shows on the paper while an edit is being chosen (decision 0017),
 * drawn over the drawing in the same coordinates (grid units times UNIT_PX): the part in hand where
 * it would land, each pin marked with the node it would join (a dot in that node's colour) or as a
 * new node (an open ring); a place the model refuses in red pen; a wire on its way, from its start
 * through its corners; the points a wire can start or end at, the one under the pointer ringed; a
 * piece of wire selected. Every mark is at least 3:1 against the paper (ink, the node colours, red
 * pen), and takes the system's colours in forced colours (notebook.css). Rendering only.
 */
import type { CSSProperties, ReactNode } from 'react';
import { GROUND, SYMBOLS, transform, type PartLetter, type Point, type Rotation } from '../schematic/index.ts';
import { UNIT_PX } from './Drawing.tsx';
import { GROUND_INK, INK, markPath } from './symbols.ts';

export interface EditMarks {
  /** The part in hand (or one that cannot go where it is dragged): its symbol, its pins and the node each would join. */
  ghost?: {
    kind: PartLetter | 'ground';
    at: Point;
    rot: Rotation;
    mirror: boolean;
    refused: boolean;
    pins: readonly { at: Point; node: string | undefined }[];
  };
  /** A wire on its way: the way it goes (to the pointer), its node, its start and its corners. */
  wire?: { points: readonly Point[]; node: string | undefined; start: Point; corners: readonly Point[]; refused: boolean };
  /** Where a wire can start or end (the Wire tool). */
  targets?: readonly { at: Point; node: string | undefined }[];
  /** The wire end under the pointer. */
  target?: Point;
  /** A piece of wire selected: its two ends and its node. */
  piece?: { from: Point; to: Point; node: string | undefined };
}

const u = (n: number): number => Math.round(n * UNIT_PX * 100) / 100;
const SCALED: CSSProperties & Record<string, string> = { '--nb-s': String(UNIT_PX) };

const colourOf = (colours: ReadonlyMap<string, string>, node: string | undefined): string | undefined => (node && node !== GROUND ? colours.get(node) : undefined);

function Ghost({ g, colours }: { g: NonNullable<EditMarks['ghost']>; colours: ReadonlyMap<string, string> }): ReactNode {
  const t = `translate(${u(g.at.x)} ${u(g.at.y)}) rotate(${g.rot})${g.mirror ? ' scale(-1 1)' : ''} scale(${UNIT_PX})`;
  const def = SYMBOLS[g.kind];
  const marks = g.kind === 'ground' ? [] : def.marks.map((m) => ({ text: m.text, at: transform(m.at, g.at, g.rot, g.mirror) }));
  return (
    <g className={`nb-hand${g.refused ? ' is-refused' : ''}`} data-hand={g.kind}>
      <g transform={t} style={SCALED}>
        {g.kind === 'ground' ? (
          <path className="nb-hand__sym" d={`${GROUND_INK.lead} ${GROUND_INK.bars}`} />
        ) : (
          <>
            <path className="nb-hand__sym" d={`${INK[g.kind].leads[0]} ${INK[g.kind].leads[1]} ${INK[g.kind].body}`} />
            {INK[g.kind].fill ? <path className="nb-hand__fill" d={INK[g.kind].fill} /> : null}
          </>
        )}
      </g>
      {marks.length ? <path className="nb-hand__signs" d={marks.map((m) => markPath(m.text, u(m.at.x), u(m.at.y), 0.19 * UNIT_PX)).join(' ')} /> : null}
      {/* Refused: a cross over it as well as the red, so it reads in any colours (forced colours, a part on top of the one in the way). */}
      {g.refused ? <path className="nb-hand__cross" d={`M${u(g.at.x - 0.55)} ${u(g.at.y - 0.55)} L${u(g.at.x + 0.55)} ${u(g.at.y + 0.55)} M${u(g.at.x + 0.55)} ${u(g.at.y - 0.55)} L${u(g.at.x - 0.55)} ${u(g.at.y + 0.55)}`} /> : null}
      {g.pins.map((p, i) => {
        const c = colourOf(colours, p.node);
        // A pin that joins a node: a dot in its colour (ink for ground); a new node: an open ring.
        return p.node === undefined || g.refused ? (
          <circle key={i} className="nb-hand__pin is-new" cx={u(p.at.x)} cy={u(p.at.y)} r={u(0.24)} />
        ) : (
          <g key={i}>
            <circle className="nb-hand__halo" cx={u(p.at.x)} cy={u(p.at.y)} r={u(0.42)} />
            <circle className="nb-hand__pin is-joined" cx={u(p.at.x)} cy={u(p.at.y)} r={u(0.26)} style={c ? { fill: c } : undefined} />
          </g>
        );
      })}
    </g>
  );
}

export function EditLayer({ marks, colours }: { marks: EditMarks; colours: ReadonlyMap<string, string> }): ReactNode {
  const w = marks.wire;
  const wc = colourOf(colours, w?.node);
  return (
    <g className="nb-edit" aria-hidden="true">
      {marks.piece ? (
        <g className="nb-piece">
          <line className="nb-piece__swipe" x1={u(marks.piece.from.x)} y1={u(marks.piece.from.y)} x2={u(marks.piece.to.x)} y2={u(marks.piece.to.y)} />
          {/* Outlined in ink, dashed (the highlighter alone is too pale against the paper: WCAG 1.4.11). */}
          <rect
            className="nb-piece__outline"
            x={u(Math.min(marks.piece.from.x, marks.piece.to.x) - 0.34)}
            y={u(Math.min(marks.piece.from.y, marks.piece.to.y) - 0.34)}
            width={u(Math.abs(marks.piece.to.x - marks.piece.from.x) + 0.68)}
            height={u(Math.abs(marks.piece.to.y - marks.piece.from.y) + 0.68)}
            rx={u(0.3)}
          />
          {[marks.piece.from, marks.piece.to].map((p, i) => (
            <rect key={i} className="nb-piece__end" x={u(p.x - 0.24)} y={u(p.y - 0.24)} width={u(0.48)} height={u(0.48)} rx={u(0.06)} />
          ))}
        </g>
      ) : null}
      {(marks.targets ?? []).map((p) => {
        const c = colourOf(colours, p.node);
        return <circle key={`${p.at.x},${p.at.y}`} className="nb-target" cx={u(p.at.x)} cy={u(p.at.y)} r={u(0.2)} style={c ? { stroke: c } : undefined} />;
      })}
      {w ? (
        <g className={`nb-draft${w.refused ? ' is-refused' : ''}`}>
          {w.points.length > 1 ? <polyline className="nb-draft__line" points={w.points.map((p) => `${u(p.x)},${u(p.y)}`).join(' ')} style={wc && !w.refused ? { stroke: wc } : undefined} /> : null}
          <circle className="nb-draft__start" cx={u(w.start.x)} cy={u(w.start.y)} r={u(0.26)} style={wc ? { fill: wc } : undefined} />
          {w.corners.map((p, i) => (
            <circle key={i} className="nb-draft__corner" cx={u(p.x)} cy={u(p.y)} r={u(0.16)} />
          ))}
        </g>
      ) : null}
      {marks.target ? <circle className="nb-target-on" cx={u(marks.target.x)} cy={u(marks.target.y)} r={u(0.38)} /> : null}
      {marks.ghost ? <Ghost g={marks.ghost} colours={colours} /> : null}
    </g>
  );
}

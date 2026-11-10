/**
 * Hand-drawn strokes for the Playground whiteboard, without a library: every line, circle and arc is
 * drawn twice with a little deterministic wobble, the way a marker goes over a line twice. The
 * wobble comes from a seeded random generator, so a part looks the same on every redraw (no
 * flicker while the numbers move) and two parts never wobble alike.
 *
 * Plain functions that return SVG path data in world coordinates.
 */

export type Pt = readonly [number, number];

/** FNV-1a: a stable 32-bit seed from a string such as "R1:body". */
export function seedOf(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: a small, fast, seeded random generator (0 <= r < 1). */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n = (v: number): string => (Math.round(v * 100) / 100).toString();

/** How sketchy a stroke is: 0 is a ruler, 1 is a steady hand, 2 is a hurried one. */
export interface Hand {
  seed: string;
  rough?: number;
  /**
   * Keep the first and last points exactly where they are (no wobble), for strokes that end on a
   * pin or a junction: a wire and a lead that meet there must meet exactly, or the join reads as a
   * break in the circuit.
   */
  anchored?: boolean;
}

/** Two passes of the same stroke: the first is the main line, the second the lighter re-trace. */
export interface Strokes {
  main: string;
  retrace: string;
}

function linePass(a: Pt, b: Pt, r: () => number, rough: number, pass: number, fixA = false, fixB = false): string {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const j = (s: number): number => (r() * 2 - 1) * s;
  const end = rough * (pass === 0 ? 0.35 : 0.75);
  const bow = j(Math.min(len * 0.01, 1.8) * rough) * (pass === 0 ? 1 : 1.4);
  const ja = j(end);
  const jb = j(end);
  const jc = j(end);
  const jd = j(end);
  const ax = a[0] + (fixA ? 0 : ja);
  const ay = a[1] + (fixA ? 0 : jb);
  const bx = b[0] + (fixB ? 0 : jc);
  const by = b[1] + (fixB ? 0 : jd);
  const t1 = 0.28 + r() * 0.12;
  const t2 = 0.62 + r() * 0.12;
  const c1x = a[0] + dx * t1 + nx * bow + j(rough * 0.3);
  const c1y = a[1] + dy * t1 + ny * bow + j(rough * 0.3);
  const c2x = a[0] + dx * t2 + nx * bow * 0.8 + j(rough * 0.3);
  const c2y = a[1] + dy * t2 + ny * bow * 0.8 + j(rough * 0.3);
  return `M${n(ax)} ${n(ay)}C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(bx)} ${n(by)}`;
}

/** A straight line, wobbled. */
export function line(a: Pt, b: Pt, hand: Hand): Strokes {
  const rough = hand.rough ?? 1;
  const r = random(seedOf(hand.seed));
  const fix = !!hand.anchored;
  return { main: linePass(a, b, r, rough, 0, fix, fix), retrace: linePass(a, b, r, rough, 1, fix, fix) };
}

/**
 * A polyline (a wire with corners, a zigzag): each corner is moved once, so both strokes meet at
 * the same corner and sharp shapes stay sharp.
 */
export function polyline(points: readonly Pt[], hand: Hand): Strokes {
  const rough = hand.rough ?? 1;
  const r = random(seedOf(hand.seed));
  const passes = [0, 1].map((pass) => {
    const last = points.length - 1;
    const moved = points.map(([x, y], i): Pt => {
      const end = i === 0 || i === last;
      const s = rough * (end ? 0.25 : 0.55) * (pass === 0 ? 1 : 1.5);
      const dx = (r() * 2 - 1) * s;
      const dy = (r() * 2 - 1) * s;
      return end && hand.anchored ? [x, y] : [x + dx, y + dy];
    });
    let d = '';
    for (let i = 0; i < moved.length - 1; i++) {
      const seg = linePass(moved[i]!, moved[i + 1]!, r, rough * 0.55, pass, !!hand.anchored && i === 0, !!hand.anchored && i + 1 === last);
      d += i === 0 ? seg : seg.replace(/^M[^C]+/, `L${n(moved[i]![0])} ${n(moved[i]![1])}`);
    }
    return d;
  });
  return { main: passes[0]!, retrace: passes[1]! };
}

/** Catmull-Rom through the points, as cubic Bézier curves. */
function smooth(points: readonly Pt[]): string {
  let d = `M${n(points[0]![0])} ${n(points[0]![1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    d += `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d;
}

/** An ellipse that starts and ends a little past itself, like a circle drawn in one go. */
export function ellipse(c: Pt, rx: number, ry: number, hand: Hand): Strokes {
  const rough = hand.rough ?? 1;
  const r = random(seedOf(hand.seed));
  const passes = [0, 1].map((pass) => {
    const count = 18;
    const start = r() * Math.PI * 2;
    const overlap = (pass === 0 ? 0.32 : 0.14) + r() * 0.18;
    const total = Math.PI * 2 + overlap;
    const pts: Pt[] = [];
    for (let i = 0; i <= count; i++) {
      const a = start + (total * i) / count;
      const k = 1 + (r() * 2 - 1) * 0.022 * rough * (pass === 0 ? 1 : 1.6);
      pts.push([c[0] + Math.cos(a) * rx * k, c[1] + Math.sin(a) * ry * k]);
    }
    return smooth(pts);
  });
  return { main: passes[0]!, retrace: passes[1]! };
}

/** An arc from angle a0 to a1 (radians, clockwise on screen), wobbled. */
export function arc(c: Pt, radius: number, a0: number, a1: number, hand: Hand): Strokes {
  const rough = hand.rough ?? 1;
  const r = random(seedOf(hand.seed));
  const passes = [0, 1].map((pass) => {
    const count = Math.max(6, Math.round(Math.abs(a1 - a0) * 3.5));
    const pts: Pt[] = [];
    for (let i = 0; i <= count; i++) {
      const a = a0 + ((a1 - a0) * i) / count;
      const k = 1 + (r() * 2 - 1) * 0.03 * rough * (pass === 0 ? 1 : 1.6);
      pts.push([c[0] + Math.cos(a) * radius * k, c[1] + Math.sin(a) * radius * k]);
    }
    return smooth(pts);
  });
  return { main: passes[0]!, retrace: passes[1]! };
}

/** A path through a few points, smoothed (for hand-drawn arrows and the highlighter swash). */
export function curve(points: readonly Pt[], hand: Hand): Strokes {
  const rough = hand.rough ?? 1;
  const r = random(seedOf(hand.seed));
  const passes = [0, 1].map((pass) =>
    smooth(points.map(([x, y]): Pt => [x + (r() * 2 - 1) * rough * (pass + 0.5), y + (r() * 2 - 1) * rough * (pass + 0.5)])),
  );
  return { main: passes[0]!, retrace: passes[1]! };
}

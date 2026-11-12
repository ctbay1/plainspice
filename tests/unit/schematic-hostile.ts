/**
 * Drawings at the format's limits that the schematic tests build (security:F1, and the second
 * re-check's P2 and P3): not a test file itself, shared by schematic-format.test.ts,
 * schematic-ground-search.test.ts, schematic-piles.test.ts and notebook-drawing-work.test.tsx.
 */

/**
 * The critic of the fix round (critic1/gsattack2.ts): no ground line, so a ground symbol is looked
 * for; K rows of ground wire, each joined to the next by a slanted wire just under it, so a wire runs
 * through every ground symbol hung on any point of it; and far above, a square wave of `steps`
 * one-unit pieces of another node between two resistors. At (25, 199, 9900) it is a 31 kB link inside
 * the format's limits that kept a phone slowed four times busy for half a minute: the ground search
 * checked every point of ground's wire against every wire, and the phone then rebuilt it four times
 * to find no clean turn. `extra`: drawing lines added after the ground rows (a ground symbol, say).
 */
export function groundRowsAndWave(K: number, w: number, steps: number, extra: readonly string[] = []): string {
  const out = ['* ground rows and a square wave', 'V1 n1 0 6', 'R1 n3 n2 1k', 'R4 n2 n3 1k', 'R2 0 n1 1k', '.op', '* plainspice-drawing v1'];
  for (let k = 0; k < K; k++) out.push(`*@ wire 0,${k} ${w},${k}`);
  for (let k = 0; k + 1 < K; k++) out.push(`*@ wire 0,${k} ${w},${k + 1}`);
  out.push('*@ V1 0 -2 0', `*@ R2 ${w} ${K + 2} 0`, `*@ wire 0,${K - 1} ${w},${K}`, '*@ label n1 0 -4', `*@ label n1 ${w} ${K + 4}`, ...extra);
  const pts: [number, number][] = [[-1990, -1900]];
  let [x, y, dir, up] = [-1990, -1900, 1, false];
  for (let i = 0; i < steps; i++) {
    if (i % 2 === 0) {
      if ((dir > 0 && x >= 1990) || (dir < 0 && x <= -1990)) {
        [y, up, dir] = [y + (up ? 1 : 0) + 3, false, -dir];
        pts.push([x, y]);
        continue;
      }
      x += dir;
    } else [y, up] = [up ? y - 1 : y + 1, !up];
    pts.push([x, y]);
  }
  const [[sx, sy], [ex, ey]] = [pts[0]!, pts[pts.length - 1]!];
  out.push(`*@ R1 ${sx - 2} ${sy} 270`, dir > 0 ? `*@ R4 ${ex + 2} ${ey} 270` : `*@ R4 ${ex - 2} ${ey} 90`, `*@ wire ${pts.map(([a, b]) => `${a},${b}`).join(' ')}`, '.end');
  return `${out.join('\n')}\n`;
}

/**
 * The second re-check's pile (P3): V1 and R2 … Rn in a chain, every part at one point, as a
 * 542-character link holds them (no header line, every position "*@ X 0 0 0"), with `extra` drawing
 * lines after them (names or ground symbols piled there too). Each part's pins sit on pins of other
 * nodes, so the build moves all but one.
 */
export function partsAtOnePoint(n: number, extra: readonly string[] = []): string {
  const out = ['*', 'V1 1 0 1'];
  for (let i = 2; i <= n; i++) out.push(`R${i} ${i - 1} ${i} 1`);
  out.push('.op', '*@ V1 0 0 0');
  for (let i = 2; i <= n; i++) out.push(`*@ R${i} 0 0 0`);
  return `${[...out, ...extra].join('\n')}\n`;
}

/**
 * `count` drawing lines piled where the parts of partsAtOnePoint(60) are: names of its nodes 1 … 59 in
 * turn (or of node 1 only, `oneNode`), or ground symbols; at the point (0, 0), or spread over the 16
 * points of one 4 × 4 square (`spread`, ground symbols turned every way there too).
 */
export function piled(kind: 'names' | 'grounds', count: number, { spread = false, oneNode = false } = {}): string[] {
  const at = (i: number): string => (spread ? `${(i % 4) - 2} ${(Math.floor(i / 4) % 4) - 2}` : '0 0');
  return Array.from({ length: count }, (_, i) => (kind === 'names' ? `*@ label ${oneNode ? 1 : 1 + (i % 59)} ${at(i)}` : `*@ ground ${at(i)} ${spread ? [0, 90, 180, 270][Math.floor(i / 16) % 4] : 0}`));
}

/**
 * A slanted lattice of k × k points (the security reviewer's lat70 at k = 70: 9,666 pieces and 4,898
 * junctions, a 30 kB link), every point joined, hanging on R2's upper pin (node out) or, `onGround`,
 * on its lower pin (ground), under a divider.
 */
export function slantedLattice(k: number, onGround = false): string {
  const head = ['* divider', 'V1 in 0 6', 'R1 in out 1k', 'R2 out 0 2k', '.op', '* plainspice-drawing v1', '*@ V1 0 3 0 m', '*@ R1 4 0 270', '*@ R2 7 3 0'];
  const P = (a: number, b: number): string => (onGround ? `${7 + a + b},${5 + b - a}` : `${7 + a + b},${1 - (b - a)}`);
  const lines: string[] = [];
  for (let a = 0; a < k; a++) lines.push(`*@ wire ${Array.from({ length: k }, (_, b) => P(a, b)).join(' ')}`);
  for (let b = 0; b < k; b++) lines.push(`*@ wire ${Array.from({ length: k }, (_, a) => P(a, b)).join(' ')}`);
  return `${[...head, ...lines, '.end'].join('\n')}\n`;
}

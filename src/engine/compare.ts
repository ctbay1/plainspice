/**
 * Compare simulation results to a given number of significant figures.
 * Used by the golden tests and by the spike page.
 */

/**
 * True when a and b agree to `digits` significant figures: they differ by at most half a unit
 * in the last kept digit of the larger one. Magnitudes at or below `zero` count as 0.
 *   agrees(5.999999994, 6, 6)  -> true    agrees(4.00002, 4, 6) -> false
 */
export function agrees(a: number, b: number, digits = 6, zero = 1e-12): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  const aa = Math.abs(a);
  const bb = Math.abs(b);
  if (aa <= zero && bb <= zero) return true;
  const exponent = Math.floor(Math.log10(Math.max(aa, bb)));
  return Math.abs(a - b) <= 0.5 * 10 ** (exponent - (digits - 1));
}

/** Largest relative difference |a-b| / max(|a|,|b|) over two equal-length arrays (0 when identical). */
export function maxRelativeDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let worst = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    const scale = Math.max(Math.abs(x), Math.abs(y));
    if (scale === 0) continue;
    worst = Math.max(worst, Math.abs(x - y) / scale);
  }
  return worst;
}

/**
 * The rawfile name (lower-case) for a name as the ngspice command line prints it:
 *   n1 / v(n1) -> v(n1)      vx#branch -> i(vx)      transfer_function -> v(transfer_function)
 *   output_impedance_at_v(a) -> v(output_impedance_at_v(a))      v1#input_impedance -> v(v1#input_impedance)
 * (The rawfile writer wraps every name in v() or i(); .tf results are typed "voltage".)
 */
export function rawfileName(printedName: string): string {
  const name = printedName.trim().toLowerCase();
  const branch = /^(.+)#branch$/.exec(name);
  if (branch) return `i(${branch[1]})`;
  if (/^[vi]\(.+\)$/.test(name) && !name.includes(')(')) return name;
  return `v(${name})`;
}

/** A value as ngspice printed it: the number and the exact text (e.g. "-6.00000e+00"). */
export interface PrintedValue {
  value: number;
  text: string;
}

/**
 * Numbers from ngspice's batch-mode printout (`ngspice -b`), keyed by rawfile name:
 *   "Node Voltage" table:  "n1   1.200000e+01"            -> v(n1)
 *   "Source Current" table: "vx#branch   1.000000e+00"    -> i(vx)
 *   "Transfer function information:" block:
 *        "output_impedance_at_v(a) = 4.000000e+00"        -> v(output_impedance_at_v(a))
 * Device-parameter listings that follow the tables are ignored. Batch mode prints 7
 * significant digits for positive values and 6 for negative ones (printf %.6e / %.5e).
 */
export function parsePrinted(stdout: string): Map<string, PrintedValue> {
  const values = new Map<string, PrintedValue>();
  const num = String.raw`([-+]?\d+(?:\.\d+)?e[-+]\d+)`;
  const tableRow = new RegExp(String.raw`^\s*(\S+)\s+${num}\s*$`, 'i');
  const tfRow = new RegExp(String.raw`^\s*(\S+)\s*=\s*${num}\s*$`, 'i');
  let section: 'none' | 'table' | 'tf' = 'none';
  for (const line of stdout.split(/\r?\n/)) {
    if (/^\s*Node\s+Voltage\s*$/i.test(line) || /^\s*Source\s+Current\s*$/i.test(line)) {
      section = 'table';
      continue;
    }
    if (/^\s*Transfer function information:/i.test(line)) {
      section = 'tf';
      continue;
    }
    if (section === 'none') continue;
    if (!line.trim() || /^[\s-]+$/.test(line)) continue; // blank lines and ---- underlines
    const m = (section === 'table' ? tableRow : tfRow).exec(line);
    if (m) values.set(rawfileName(m[1]!), { value: Number(m[2]), text: m[2]! });
    else section = 'none';
  }
  return values;
}

/**
 * Turn ngspice's raw plots into the quantities a student reads: node voltages, currents with
 * their sign convention, .tf results, and .dc / .tran sweeps.
 *
 * Vector names as ngspice 47 writes them to the rawfile (checked by running it):
 *   .op   v(n1) [voltage], i(v1) [current]  (voltage sources, E and H: their branch current)
 *         with `.options savecurrents` also i(@r1[i]), i(@f1[i]), i(@g1[i]), i(@c1[i]),
 *         i(@l1[i]) and i(@i1[current])
 *   .tf   v(Transfer_function), v(output_impedance_at_V(a)), v(v1#Input_impedance)
 *         (all typed "voltage"; for a current output: v(vm#Output_impedance))
 *   .dc   scale v(v-sweep) / i(i-sweep) / res-sweep / temp-sweep, then the saved vectors
 *   .tran scale time, then the saved vectors
 * ngspice lower-cases the netlist, so names here are lower-case except ngspice's own words.
 */
import type { RawPlot } from './types.ts';

export type Unit = 'V' | 'A' | 'Ω' | 's' | '°C' | '';

export interface NodeVoltage {
  /** Node name as ngspice reports it (lower-case). Measured from ground, node 0. */
  node: string;
  value: number;
}

export interface ElementCurrent {
  /** Element name as ngspice reports it (lower-case), e.g. `v1`, `r1`, `f1`, `itest`. */
  element: string;
  /**
   * The current in amperes with SPICE's sign: positive when it flows from the element's
   * first node, through the element, to its second node. (For a voltage source that means a
   * current entering at its + node; a source delivering power reads negative.)
   */
  value: number;
  /** `branch`: i(v1) of a voltage-type element; `device`: @r1[i] etc. from savecurrents. */
  origin: 'branch' | 'device';
  /** The rawfile vector it came from, e.g. `i(v1)` or `i(@r1[i])`. */
  vector: string;
}

export interface OperatingPoint {
  nodes: NodeVoltage[];
  currents: ElementCurrent[];
}

export interface TransferFunction {
  /** Output/input ratio (V/V, A/V, V/A or A/A depending on what .tf names). */
  transferFunction?: number;
  /** The output named in .tf, e.g. `v(a)` or `i(vm)`, with ngspice's "output impedance" there. */
  outputImpedance?: { at: string; value: number };
  /** The input source named in .tf, e.g. `v1`, with ngspice's "input impedance" seen by it. */
  inputImpedance?: { source: string; value: number };
}

export interface SweepSeries {
  /** Rawfile name, e.g. `v(out)`, `i(v1)`. */
  name: string;
  values: Float64Array;
  unit: Unit;
}

export interface Sweep {
  scale: SweepSeries;
  series: SweepSeries[];
}

export interface AnalysisResults {
  op?: OperatingPoint;
  tf?: TransferFunction;
  dc?: Sweep;
  tran?: Sweep;
  /** Plots this module does not interpret yet (e.g. AC), passed through unchanged. */
  other: RawPlot[];
}

const unwrap = (name: string, fn: 'v' | 'i'): string | undefined => {
  const m = new RegExp(`^${fn}\\((.*)\\)$`, 'i').exec(name);
  return m ? m[1] : undefined;
};

/** Unit of a rawfile vector from its name and ngspice's type word. */
export function unitOf(name: string, type: string): Unit {
  const lower = name.toLowerCase();
  if (lower === 'time') return 's';
  if (lower.includes('res-sweep')) return 'Ω';
  if (lower.includes('temp-sweep')) return '°C';
  if (type === 'current') return 'A';
  if (type === 'voltage') return 'V';
  return '';
}

function classifyPlot(plot: RawPlot): 'op' | 'tf' | 'dc' | 'tran' | 'other' {
  const p = plot.plotname.toLowerCase();
  if (p.startsWith('operating point')) return 'op';
  if (p.startsWith('transfer function')) return 'tf';
  if (p.startsWith('dc transfer')) return 'dc';
  if (p.startsWith('transient')) return 'tran';
  return 'other';
}

export function interpretOperatingPoint(plot: RawPlot): OperatingPoint {
  const nodes: NodeVoltage[] = [];
  const currents: ElementCurrent[] = [];
  plot.variables.forEach((v, i) => {
    const value = plot.real[i]?.[0];
    if (value === undefined) return;
    if (v.type === 'voltage') {
      const node = unwrap(v.name, 'v');
      if (node !== undefined) nodes.push({ node, value });
      return;
    }
    if (v.type === 'current') {
      const inner = unwrap(v.name, 'i') ?? v.name;
      const dev = /^@([^[\]]+)\[(i|current)\]$/i.exec(inner);
      if (dev) currents.push({ element: dev[1]!, value, origin: 'device', vector: v.name });
      else currents.push({ element: inner, value, origin: 'branch', vector: v.name });
    }
  });
  return { nodes, currents };
}

export function interpretTransferFunction(plot: RawPlot): TransferFunction {
  const tf: TransferFunction = {};
  plot.variables.forEach((v, i) => {
    const value = plot.real[i]?.[0];
    if (value === undefined) return;
    const inner = unwrap(v.name, 'v') ?? v.name;
    let m: RegExpExecArray | null;
    if (/^transfer_function$/i.test(inner)) {
      tf.transferFunction = value;
    } else if ((m = /^output_impedance_at_(.+)$/i.exec(inner))) {
      tf.outputImpedance = { at: m[1]!.toLowerCase(), value };
    } else if ((m = /^(.+)#output_impedance$/i.exec(inner))) {
      tf.outputImpedance = { at: `i(${m[1]!.toLowerCase()})`, value };
    } else if ((m = /^(.+)#input_impedance$/i.exec(inner))) {
      tf.inputImpedance = { source: m[1]!.toLowerCase(), value };
    }
  });
  return tf;
}

export function interpretSweep(plot: RawPlot): Sweep | undefined {
  const [scaleVar, ...rest] = plot.variables;
  const scaleValues = plot.real[0];
  if (!scaleVar || !scaleValues) return undefined;
  return {
    scale: { name: scaleVar.name, values: scaleValues, unit: unitOf(scaleVar.name, scaleVar.type) },
    series: rest.map((v, k) => ({
      name: v.name,
      values: plot.real[k + 1] ?? new Float64Array(0),
      unit: unitOf(v.name, v.type),
    })),
  };
}

/** Interpret every plot of one run. If an analysis appears twice, the last one wins. */
export function interpretPlots(plots: RawPlot[]): AnalysisResults {
  const results: AnalysisResults = { other: [] };
  for (const plot of plots) {
    switch (classifyPlot(plot)) {
      case 'op':
        results.op = interpretOperatingPoint(plot);
        break;
      case 'tf':
        results.tf = interpretTransferFunction(plot);
        break;
      case 'dc': {
        const s = interpretSweep(plot);
        if (s) results.dc = s;
        break;
      }
      case 'tran': {
        const s = interpretSweep(plot);
        if (s) results.tran = s;
        break;
      }
      default:
        results.other.push(plot);
    }
  }
  return results;
}

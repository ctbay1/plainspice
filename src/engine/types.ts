/**
 * Types shared by the ngspice engine (Web Worker and Node) and the code that reads its results.
 * Nothing in here depends on the browser or on a UI framework.
 */

/** One vector (column) of an ngspice rawfile. */
export interface RawVariable {
  /** Position in the rawfile (0 is the scale: time, sweep, or the first .op value). */
  index: number;
  /** Name exactly as ngspice wrote it, e.g. `v(n1)`, `i(v1)`, `v(output_impedance_at_V(a))`. */
  name: string;
  /** ngspice's type word: `voltage`, `current`, `time`, ... (.tf results are typed `voltage`). */
  type: string;
}

/** One plot (one analysis) from an ngspice rawfile. */
export interface RawPlot {
  title: string;
  date: string;
  /** e.g. `Operating Point`, `Transfer Function`, `DC transfer characteristic`, `Transient Analysis`. */
  plotname: string;
  flags: string;
  complex: boolean;
  points: number;
  variables: RawVariable[];
  /** Real parts (or the values, for real plots), one Float64Array per variable. */
  real: Float64Array[];
  /** Imaginary parts, only for complex plots (AC analysis). */
  imag?: Float64Array[];
}

export type DiagnosticSeverity = 'error' | 'warning' | 'note';

/** A message ngspice printed, classified so the UI can explain it in plain words. */
export interface EngineDiagnostic {
  severity: DiagnosticSeverity;
  /** Stable machine-readable code, e.g. `singular-matrix`, `duplicate-name`, `engine-crash`. */
  code: string;
  /** The ngspice text the classification is based on (one or more lines). */
  text: string;
  /** Netlist line number when ngspice names one ("Error on line 4 ..."). */
  line?: number;
  /** Node or device ngspice names, e.g. the node in "singular matrix: check node b". */
  subject?: string;
}

export interface RunTimings {
  instantiateMs: number;
  runMs: number;
  parseMs: number;
}

/** Everything one ngspice batch run produced. */
export interface RunResult {
  /** True when ngspice exited 0, the rawfile was read, and no error-level diagnostic was found. */
  ok: boolean;
  /**
   * True when ngspice warned that its DC solution failed and it fell back to a "transient op"
   * (singular matrix, gmin/source stepping failed). ngspice still prints numbers, but they may be
   * wrong, so the UI must not present them as answers.
   */
  unreliable: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  plots: RawPlot[];
  diagnostics: EngineDiagnostic[];
  timings: RunTimings;
}

/** What the page asks the engine to do. */
export interface RunRequest {
  /** The netlist exactly as the user wrote it: title line first, `.end` last. */
  netlist: string;
}

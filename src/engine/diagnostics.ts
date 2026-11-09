/**
 * Classify what ngspice printed into diagnostics the UI can explain.
 *
 * Every pattern here was observed by running ngspice 42 and 47 natively and the WebAssembly
 * build on small netlists (docs/spice-facts.md lists the netlists and the verbatim output).
 * The main lesson: ngspice's exit code and "results" are not enough. With a singular DC matrix
 * it falls back to a "transient op" and still prints numbers, which can be wrong.
 */
import type { EngineDiagnostic } from './types.ts';

interface Rule {
  re: RegExp;
  severity: EngineDiagnostic['severity'];
  code: string;
  /** Capture group index holding the node/device the message names. */
  subjectGroup?: number;
}

const RULES: Rule[] = [
  // --- the DC solution failed; ngspice may still print (unreliable) numbers
  { re: /singular matrix:\s*check node\s+(\S+)/i, severity: 'warning', code: 'singular-matrix', subjectGroup: 1 },
  { re: /gmin stepping failed/i, severity: 'warning', code: 'gmin-stepping-failed' },
  { re: /source stepping failed/i, severity: 'warning', code: 'source-stepping-failed' },
  { re: /Transient op started/i, severity: 'warning', code: 'transient-op-fallback' },
  { re: /Transient op failed/i, severity: 'error', code: 'transient-op-failed' },
  { re: /operating point could not be simulated/i, severity: 'error', code: 'op-failed' },
  { re: /Timestep too small/i, severity: 'error', code: 'timestep-too-small' },
  // --- the netlist was not accepted
  { re: /device already exists/i, severity: 'error', code: 'duplicate-name' },
  { re: /unknown device type/i, severity: 'error', code: 'unknown-device' },
  { re: /unknown subckt:\s*(\S+)/i, severity: 'error', code: 'unknown-subcircuit', subjectGroup: 1 },
  { re: /could not find a valid modelname|Unable to find definition of model|model name is not found/i, severity: 'error', code: 'missing-model' },
  { re: /not enough parameters in line/i, severity: 'error', code: 'missing-fields' },
  { re: /unknown parameter\s*\(([^)]*)\)/i, severity: 'error', code: 'unknown-parameter', subjectGroup: 1 },
  { re: /no such parameter on this device/i, severity: 'error', code: 'unknown-parameter' },
  { re: /is not a valid (\w+) instance line, ignored/i, severity: 'warning', code: 'line-ignored', subjectGroup: 1 },
  { re: /(\S+): has no value, DC 0 assumed/i, severity: 'note', code: 'no-value-dc0', subjectGroup: 1 },
  { re: /Value of resistor (\S+) is too small/i, severity: 'warning', code: 'resistor-too-small', subjectGroup: 1 },
  { re: /Transfer function source (\S+) not in circuit/i, severity: 'error', code: 'tf-source-missing', subjectGroup: 1 },
  { re: /Transfer function source (\S+) not of proper type/i, severity: 'error', code: 'tf-source-type', subjectGroup: 1 },
  { re: /named "([^"]+)" is not in the circuit/i, severity: 'error', code: 'sweep-source-missing', subjectGroup: 1 },
  { re: /Bad syntax!/i, severity: 'error', code: 'bad-syntax' },
  { re: /(TSTOP|TSTEP|TSTART) is invalid/i, severity: 'error', code: 'bad-tran-arguments', subjectGroup: 1 },
  { re: /coupling to non-existent inductor/i, severity: 'error', code: 'missing-inductor' },
  { re: /Undefined parameter \[([^\]]+)\]/i, severity: 'error', code: 'undefined-parameter', subjectGroup: 1 },
  { re: /Closing "}" not found|mal formed B/i, severity: 'error', code: 'fatal-syntax' },
  { re: /fatal error in ngspice/i, severity: 'error', code: 'fatal' },
  { re: /circuit not parsed/i, severity: 'error', code: 'circuit-not-parsed' },
  { re: /run simulation\(s\) aborted/i, severity: 'error', code: 'run-aborted' },
  { re: /incomplete or empty netlist|no simulations run/i, severity: 'error', code: 'nothing-to-run' },
  { re: /Unusual leading characters/i, severity: 'warning', code: 'unusual-leading-character' },
  { re: /^\s*Error\b/i, severity: 'error', code: 'error' },
];

/** Lines ngspice prints on every run that carry no meaning for the user. */
const IGNORE: RegExp[] = [
  /^\s*$/,
  /^Note: No compatibility mode selected!/i,
  /^Using SPARSE 1\.3 as Direct Linear Solver/i,
  /can't find the initialization file spinit/i,
  /^Note: Starting (dynamic gmin|true gmin|source) stepping/i, // the "failed" lines carry the meaning
  /^Note: Transient op finished successfully/i, // covered by transient-op-fallback
  /^Simulation interrupted due to error!/i,
  /^doAnalyses:/i,
  /^Cannot compute substitute/i, // follows "Undefined parameter"
];

/** Classify ngspice's stdout + stderr. Unmatched "Warning"/"Error" lines are kept generically. */
export function classifyOutput(stdout: string, stderr: string): EngineDiagnostic[] {
  const out: EngineDiagnostic[] = [];
  const seen = new Set<string>();
  // ngspice prints "Error on line N or its substitute:" and the offending line before the reason.
  let pendingLine: number | undefined;

  for (const raw of `${stderr}\n${stdout}`.split(/\r?\n/)) {
    const line = raw.trimEnd();
    // Device errors: "Error on line 4 or its substitute:" (physical line, 1-based).
    // numparam errors: "Error in netlist line no. 4, new internal line no. 3:"; the internal
    // number is the physical line (checked on .param and {expression} errors).
    const lineNo = /Error on line (\d+)/i.exec(line) ?? /new internal line no\. (\d+)/i.exec(line);
    if (lineNo) {
      pendingLine = Number(lineNo[1]);
      continue;
    }
    if (IGNORE.some((re) => re.test(line))) continue;

    let matched = false;
    for (const rule of RULES) {
      const m = rule.re.exec(line);
      if (!m) continue;
      matched = true;
      const d: EngineDiagnostic = { severity: rule.severity, code: rule.code, text: line.trim() };
      if (rule.subjectGroup !== undefined && m[rule.subjectGroup]) d.subject = m[rule.subjectGroup]!;
      if (pendingLine !== undefined && rule.severity === 'error') {
        d.line = pendingLine;
        pendingLine = undefined;
      }
      const key = `${d.code}|${d.subject ?? ''}|${d.line ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(d);
      }
      break;
    }
    if (!matched && /^\s*Warning\b/i.test(line)) {
      const key = `warning|${line}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ severity: 'warning', code: 'warning', text: line.trim() });
      }
    }
  }
  return out;
}

/** Codes meaning "ngspice printed numbers, but its DC solution failed: don't trust them". */
export const UNRELIABLE_CODES = new Set([
  'singular-matrix',
  'gmin-stepping-failed',
  'source-stepping-failed',
  'transient-op-fallback',
]);

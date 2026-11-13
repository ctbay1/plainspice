/**
 * Spike page: ngspice (WebAssembly) in a Web Worker, checked against recorded native ngspice.
 * Plain DOM code on purpose: the engine is independent of the UI framework.
 */
import expectedJson from '../../tests/fixtures/expected.json';
import { EngineClient } from '../engine/client.ts';
import { agrees, maxRelativeDifference, parsePrinted, rawfileName, type PrintedValue } from '../engine/compare.ts';
import { interpretPlots, type ElementCurrent } from '../engine/results.ts';
import type { RawPlot, RunResult } from '../engine/types.ts';
import { formatLikeNgspice, formatNumber, formatSI } from '../format/si.ts';
import { parseNetlist } from '../spice/parse.ts';
import { cutTitles, whyNotRun } from '../spice/run-netlist.ts';

interface NativeRecord {
  ngspice: { version: string };
  printed: { exitCode: number | null; stdout: string };
  plots: { plotname: string; points: number; vectors: { name: string; type: string; values: number[] }[] }[];
}
interface Check {
  quantity: string;
  expected: number | string;
  unit: string;
}

const fixtureFiles = import.meta.glob<string>('../../tests/fixtures/*.cir', { query: '?raw', import: 'default', eager: true });
const native47 = import.meta.glob<NativeRecord>('../../tests/golden/native/ngspice-47/*.json', { import: 'default', eager: true });
const native42 = import.meta.glob<NativeRecord>('../../tests/golden/native/ngspice-42/*.json', { import: 'default', eager: true });
const expected = (expectedJson as { fixtures: Record<string, { checks: Check[] }> }).fixtures;

const idOf = (path: string): string => path.split('/').pop()!.replace(/\.(cir|json)$/, '');
const fixtures = Object.entries(fixtureFiles)
  .map(([path, text]) => ({ id: idOf(path), text }))
  .sort((a, b) => a.id.localeCompare(b.id));
const nativeFor = (records: Record<string, NativeRecord>, id: string): NativeRecord | undefined =>
  Object.entries(records).find(([path]) => idOf(path) === id)?.[1];

const $ = <T extends HTMLElement>(selector: string): T => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
};
const status = $<HTMLParagraphElement>('#engine-status');
const runAllButton = $<HTMLButtonElement>('#run-all');
const runButton = $<HTMLButtonElement>('#run');
const netlistBox = $<HTMLTextAreaElement>('#netlist');
const saveCurrents = $<HTMLInputElement>('#savecurrents');
const ownResults = $<HTMLDivElement>('#own-results');
const summary = $<HTMLParagraphElement>('#fixtures-summary');

const engine = new EngineClient();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function row(cells: (string | HTMLElement)[], numeric: boolean[] = []): HTMLTableRowElement {
  const tr = el('tr');
  cells.forEach((c, i) => {
    const td = el('td');
    if (numeric[i]) td.className = 'num';
    if (typeof c === 'string') td.textContent = c;
    else td.append(c);
    tr.append(td);
  });
  return tr;
}

function verdict(ok: boolean, detail = ''): HTMLElement {
  const span = el('span', `${ok ? '✓ Yes' : '✗ No'}${detail ? ` (${detail})` : ''}`, ok ? 'yes' : 'no');
  return span;
}

function vectorOf(plots: { variables?: { name: string }[]; vectors?: { name: string; values: number[] }[] }[], name: string): ArrayLike<number> | undefined {
  const wanted = name.toLowerCase();
  for (const p of plots as RawPlot[]) {
    const i = p.variables?.findIndex((v) => v.name.toLowerCase() === wanted) ?? -1;
    if (i >= 0) return p.real[i];
  }
  for (const p of plots as NativeRecord['plots']) {
    const v = p.vectors?.find((x) => x.name.toLowerCase() === wanted);
    if (v) return v.values;
  }
  return undefined;
}

const UNIT: Record<string, string> = { V: 'V', A: 'A', ohm: 'Ω', '': '' };

/** The quantity rows for one fixture: [label, by hand, rawfile name, index of the point]. */
function keyQuantities(id: string, wasm: RunResult): { label: string; byHand: number; name: string; index: number; unit: string }[] {
  const checks = expected[id]?.checks ?? [];
  return checks.map((c) => {
    const name = rawfileName(c.quantity);
    const unit = UNIT[c.unit] ?? c.unit;
    if (typeof c.expected === 'number') return { label: c.quantity, byHand: c.expected, name, index: 0, unit };
    if (id.startsWith('d1')) {
      const sweep = vectorOf(wasm.plots, 'v(v-sweep)')!;
      const last = sweep.length - 1;
      return { label: `${c.quantity} at V1 = ${sweep[last]} V`, byHand: (2 / 3) * sweep[last]!, name, index: last, unit };
    }
    const time = vectorOf(wasm.plots, 'time')!;
    const last = time.length - 1;
    const t = time[last]!;
    const tau = 1e-3;
    const tr = 1e-6;
    const exact = 5 - 5 * (tau / tr) * (Math.exp(tr / tau) - 1) * Math.exp(-t / tau);
    return { label: `${c.quantity} at t = ${formatSI(t, 's')}`, byHand: exact, name, index: last, unit };
  });
}

async function runAll(): Promise<void> {
  runAllButton.disabled = true;
  const keyBody = $<HTMLTableSectionElement>('#key-table tbody');
  const vectorBody = $<HTMLTableSectionElement>('#vector-table tbody');
  keyBody.replaceChildren();
  vectorBody.replaceChildren();
  summary.textContent = 'Running the fixtures…';
  let checks = 0;
  let passed = 0;
  const t0 = performance.now();

  for (const fx of fixtures) {
    const wasm = await engine.run(fx.text);
    const n47 = nativeFor(native47, fx.id);
    const n42 = nativeFor(native42, fx.id);
    const printed47 = n47 && n47.printed.exitCode === 0 ? parsePrinted(n47.printed.stdout) : undefined;
    const printed42 = n42 && n42.printed.exitCode === 0 ? parsePrinted(n42.printed.stdout) : undefined;

    for (const q of keyQuantities(fx.id, wasm)) {
      const w = vectorOf(wasm.plots, q.name)?.[q.index];
      const a47 = n47 ? vectorOf(n47.plots, q.name)?.[q.index] : undefined;
      const a42 = n42 ? vectorOf(n42.plots, q.name)?.[n42.plots[0]!.points === n47?.plots[0]?.points ? q.index : -1] : undefined;
      const show = (printed: Map<string, PrintedValue> | undefined, raw: number | undefined): string => {
        const p = printed?.get(q.name.toLowerCase());
        if (p !== undefined) return p.text;
        return raw === undefined ? '— (different time grid)' : `${formatLikeNgspice(raw)} (rawfile)`;
      };
      const ok =
        w !== undefined &&
        wasm.ok &&
        agrees(w, q.byHand) &&
        (a47 === undefined || agrees(w, a47)) &&
        (a42 === undefined || agrees(w, a42));
      checks += 1;
      if (ok) passed += 1;
      const plain = (x: number): string => (q.unit ? formatSI(x, q.unit) : formatNumber(x));
      const browser = w === undefined ? 'missing' : `${plain(w)} (${formatLikeNgspice(w)})`;
      keyBody.append(
        row([fx.id, q.label, plain(q.byHand), show(printed47, a47), show(printed42, a42), browser, verdict(ok)], [false, false, true, true, true, true]),
      );
    }

    // Every vector, every point.
    for (const np of n47?.plots ?? []) {
      for (const nv of np.vectors) {
        const w = vectorOf(wasm.plots, nv.name);
        const v42 = n42 ? vectorOf(n42.plots, nv.name) : undefined;
        const same47 = w !== undefined && w.length === nv.values.length;
        const same42 = w !== undefined && v42 !== undefined && v42.length === w.length;
        const ok47 = same47 && Array.from(w!).every((x, i) => agrees(x, nv.values[i]!));
        const ok42 = same42 && Array.from(w!).every((x, i) => agrees(x, v42![i]!));
        checks += 1;
        if (ok47) passed += 1;
        vectorBody.append(
          row(
            [
              fx.id,
              nv.name,
              String(nv.values.length),
              same47 ? verdict(ok47, `max ${maxRelativeDifference(w!, nv.values).toExponential(1)}`) : verdict(false, 'missing'),
              same42 ? verdict(ok42, `max ${maxRelativeDifference(w!, v42!).toExponential(1)}`) : el('span', `different time grid (${v42?.length ?? 0} points)`),
            ],
            [false, false, true, true, true],
          ),
        );
      }
    }
  }
  const ms = performance.now() - t0;
  summary.textContent = `${passed} of ${checks} checks agree to 6 significant figures (${fixtures.length} fixtures in ${Math.round(ms)} ms).`;
  runAllButton.disabled = false;
}

// ---------------------------------------------------------------- your own netlist

const DEFAULT_NETLIST = `* F5: Thevenin resistance with a dependent source (test source method)
Itest 0 a 1
Vx a x 0
R2 x n1 2
R1 n1 0 4
F1 0 n1 Vx 2
.op
.end
`;

/** The two main nodes of each element, from a whitespace split (enough for R C L V I E F G H). */
function elementNodes(netlist: string): Map<string, [string, string]> {
  const nodes = new Map<string, [string, string]>();
  netlist.split(/\r?\n/).slice(1).forEach((line) => {
    const t = line.trim().split(/\s+/);
    if (t.length >= 3 && /^[a-z]/i.test(t[0]!)) nodes.set(t[0]!.toLowerCase(), [t[1]!.toLowerCase(), t[2]!.toLowerCase()]);
  });
  return nodes;
}

function describeCurrent(c: ElementCurrent, nodes: Map<string, [string, string]>, voltage: (node: string) => number | undefined): string {
  const n = nodes.get(c.element);
  const name = c.element.toUpperCase();
  if (!n) return '';
  if (c.value === 0) return 'no current';
  // SPICE's sign: positive means from the element's first node, through it, to its second node.
  const [a, b] = n;
  const [from, to] = c.value > 0 ? [a, b] : [b, a];
  let text = `${formatSI(Math.abs(c.value), 'A')} from ${from} to ${to}, through ${name}`;
  if (c.origin === 'branch') {
    // A voltage-type source: its power is (v(+) - v(-)) x current, with current into + positive.
    const va = voltage(a);
    const vb = voltage(b);
    if (va !== undefined && vb !== undefined) {
      const p = (va - vb) * c.value;
      if (Math.abs(va - vb) < 1e-12) text += ` (a 0 V source: it only measures the current)`;
      else text += p < 0 ? `: ${name} delivers ${formatSI(-p, 'W')}` : `: ${name} absorbs ${formatSI(p, 'W')}`;
    }
  }
  return text;
}

function table(caption: string, headers: string[], rows: (string | HTMLElement)[][], numeric: boolean[]): HTMLElement {
  const wrap = el('div', undefined, 'table-wrap');
  const t = el('table');
  t.append(el('caption', caption));
  const head = el('thead');
  const hr = el('tr');
  for (const h of headers) {
    const th = el('th', h);
    th.scope = 'col';
    hr.append(th);
  }
  head.append(hr);
  const body = el('tbody');
  for (const r of rows) body.append(row(r, numeric));
  t.append(head, body);
  wrap.append(t);
  return wrap;
}

async function runOwn(): Promise<void> {
  // As in the app (src/spice/run-netlist.ts, decision 0012): nothing that would make ngspice write past
  // one of its fixed spaces, and each title cut to the 504 bytes ngspice can write.
  const refused = whyNotRun(parseNetlist(netlistBox.value));
  if (refused) {
    ownResults.replaceChildren(el('p', refused.reason, 'error'));
    return;
  }
  const { text: cut, notes } = cutTitles(netlistBox.value);
  let netlist = cut;
  if (saveCurrents.checked && !/^\s*\.options?\s+.*savecurrents/im.test(netlist)) {
    // Before .end, so the line numbers ngspice reports for the user's lines stay the same.
    netlist = /^\s*\.end\b/im.test(netlist)
      ? netlist.replace(/^(\s*\.end\b)/im, '.options savecurrents\n$1')
      : `${netlist.replace(/\s*$/, '')}\n.options savecurrents\n`;
  }
  runButton.disabled = true;
  ownResults.replaceChildren(el('p', 'Running…', 'status'));
  let result: RunResult;
  try {
    result = await engine.run(netlist);
  } catch (err) {
    ownResults.replaceChildren(el('p', err instanceof Error ? err.message : String(err), 'error'));
    runButton.disabled = false;
    return;
  }
  runButton.disabled = false;
  const out: HTMLElement[] = [];
  const headline = result.ok
    ? result.unreliable
      ? 'ngspice finished, but its DC solution failed (see the warnings): the numbers below are not trustworthy.'
      : `ngspice finished in ${Math.round(result.timings.runMs)} ms.`
    : 'ngspice could not simulate this netlist (see the messages below).';
  out.push(el('p', headline, result.ok && !result.unreliable ? 'status' : result.ok ? 'warning' : 'error'));
  for (const note of notes) out.push(el('p', note, 'status'));

  if (result.diagnostics.length) {
    const list = el('ul');
    for (const d of result.diagnostics) {
      list.append(el('li', `${d.severity}${d.line ? ` (line ${d.line})` : ''}: ${d.text}`));
    }
    out.push(el('h3', 'Messages from ngspice'), list);
  }

  const results = interpretPlots(result.plots);
  const nodes = elementNodes(netlistBox.value);
  if (results.op) {
    const op = results.op;
    const voltage = (node: string): number | undefined =>
      node === '0' || node === 'gnd' ? 0 : op.nodes.find((x) => x.node === node)?.value;
    out.push(
      table(
        'Node voltages (measured from ground, node 0)',
        ['Node', 'Voltage', 'ngspice prints'],
        op.nodes.map((n) => [n.node, formatSI(n.value, 'V'), formatLikeNgspice(n.value)]),
        [false, true, true],
      ),
    );
    out.push(
      table(
        'Currents',
        ['Part', 'Current', 'Which way it flows', 'ngspice vector'],
        op.currents.map((c) => [c.element.toUpperCase(), formatSI(c.value, 'A'), describeCurrent(c, nodes, voltage), `${c.vector} = ${formatLikeNgspice(c.value)}`]),
        [false, true, false, true],
      ),
    );
  }
  if (results.tf) {
    const tf = results.tf;
    const rows: string[][] = [];
    if (tf.transferFunction !== undefined) rows.push(['Transfer function (output ÷ input)', formatNumber(tf.transferFunction), formatLikeNgspice(tf.transferFunction)]);
    if (tf.outputImpedance) rows.push([`Output resistance at ${tf.outputImpedance.at}`, formatSI(tf.outputImpedance.value, 'Ω'), formatLikeNgspice(tf.outputImpedance.value)]);
    if (tf.inputImpedance) rows.push([`Input resistance seen by ${tf.inputImpedance.source.toUpperCase()}`, formatSI(tf.inputImpedance.value, 'Ω'), formatLikeNgspice(tf.inputImpedance.value)]);
    out.push(table('.tf results (ngspice calls the resistances "impedance")', ['Quantity', 'Value', 'ngspice prints'], rows, [false, true, true]));
  }
  for (const [label, sweep] of [['.dc sweep', results.dc], ['.tran (time) results', results.tran]] as const) {
    if (!sweep) continue;
    const n = sweep.scale.values.length;
    const pick = n <= 15 ? [...Array(n).keys()] : [...Array(15).keys()].map((k) => Math.round((k * (n - 1)) / 14));
    out.push(
      table(
        `${label}: ${n} points${n > 15 ? ' (15 shown, evenly spaced)' : ''}`,
        [sweep.scale.name, ...sweep.series.map((s) => s.name)],
        pick.map((i) => [formatSI(sweep.scale.values[i]!, sweep.scale.unit), ...sweep.series.map((s) => formatSI(s.values[i]!, s.unit))]),
        [true, ...sweep.series.map(() => true)],
      ),
    );
  }
  const raw = el('details');
  raw.append(el('summary', 'What ngspice printed'), el('pre', `${result.stdout}\n${result.stderr}`.trim()));
  out.push(raw);
  ownResults.replaceChildren(...out);
}

netlistBox.value = DEFAULT_NETLIST;
netlistBox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    void runOwn();
  }
});
runButton.addEventListener('click', () => void runOwn());
runAllButton.addEventListener('click', () => void runAll());

engine
  .warmUp()
  .then(async (ms) => {
    status.textContent = `ngspice 47 is ready (loaded in ${Math.round(ms)} ms).`;
    runButton.disabled = false;
    await runAll();
  })
  .catch((err: unknown) => {
    status.textContent = `Could not start ngspice: ${err instanceof Error ? err.message : String(err)}`;
    status.className = 'error';
  });

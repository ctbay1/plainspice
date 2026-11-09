/**
 * Run ngspice (compiled to WebAssembly) exactly like the command line in batch mode:
 *
 *     ngspice -b -r /out.raw /circuit.cir
 *
 * The .wasm is compiled once; every run gets a fresh instance (a few milliseconds), because
 * ngspice's main() keeps global state and cannot be called twice in one instance. The same
 * class runs in the page's Web Worker and in Node for the golden tests.
 */
import { classifyOutput, UNRELIABLE_CODES } from './diagnostics.ts';
import { parseRawfile } from './rawfile.ts';
import type { EngineDiagnostic, RawPlot, RunResult } from './types.ts';

/** The parts of the Emscripten module we use (see engine/dist/ngspice.d.mts). */
export interface NgspiceModule {
  FS: {
    writeFile(path: string, data: string | Uint8Array): void;
    readFile(path: string): Uint8Array;
    mkdirTree(path: string): void;
  };
  callMain(args: string[]): number;
}

export type NgspiceFactory = (moduleArg: Record<string, unknown>) => Promise<NgspiceModule>;

/** ngspice reads spinit at start-up. The stock one loads XSPICE code models, which this build has not got. */
const SPINIT = '* spinit for the WebAssembly build (no XSPICE code models)\nalias exit quit\n';
/**
 * ngspice's end-of-run resource report reads these Linux files. They do not exist in
 * WebAssembly, so without them every run would print fopen errors to stderr.
 */
const PROC_MEMINFO = 'MemTotal:        2097152 kB\nMemFree:         1048576 kB\nMemAvailable:    1048576 kB\n';
const PROC_STATM = '0 0 0 0 0 0 0\n';

export const NGSPICE_ARGS = ['-b', '-r', '/out.raw', '/circuit.cir'] as const;

type ProcessLike = { exitCode?: number | string | undefined };

export class NgspiceEngine {
  private readonly factory: NgspiceFactory;
  private readonly compiled: WebAssembly.Module;

  private constructor(factory: NgspiceFactory, compiled: WebAssembly.Module) {
    this.factory = factory;
    this.compiled = compiled;
  }

  /**
   * @param factory the default export of engine/dist/ngspice.mjs
   * @param wasm    a compiled module, the .wasm bytes, or a fetch() response for the .wasm
   */
  static async create(
    factory: NgspiceFactory,
    wasm: WebAssembly.Module | ArrayBuffer | Uint8Array | Response | Promise<Response>,
  ): Promise<NgspiceEngine> {
    let compiled: WebAssembly.Module;
    if (wasm instanceof WebAssembly.Module) {
      compiled = wasm;
    } else if (wasm instanceof ArrayBuffer || ArrayBuffer.isView(wasm)) {
      // ArrayBuffer.isView, not instanceof Uint8Array: a Node Buffer created in another realm
      // (e.g. under Vitest's jsdom environment) fails instanceof but is still bytes.
      compiled = await WebAssembly.compile(wasm as BufferSource);
    } else {
      const response = await wasm;
      if (!response.ok) throw new Error(`could not load ngspice.wasm (HTTP ${response.status})`);
      compiled =
        typeof WebAssembly.compileStreaming === 'function' &&
        response.headers.get('content-type')?.startsWith('application/wasm')
          ? await WebAssembly.compileStreaming(response)
          : await WebAssembly.compile(await response.arrayBuffer());
    }
    return new NgspiceEngine(factory, compiled);
  }

  /** Run one netlist (title line first, `.end` last) in a fresh ngspice instance. */
  async run(netlist: string): Promise<RunResult> {
    const out: string[] = [];
    const err: string[] = [];
    const t0 = now();
    const compiled = this.compiled;
    const mod = await this.factory({
      noInitialRun: true,
      // End of input: ngspice must never wait for a keyboard (in Node, Emscripten would
      // otherwise read the real terminal).
      stdin: () => null,
      print: (s: string) => out.push(s),
      printErr: (s: string) => err.push(s),
      instantiateWasm(
        imports: WebAssembly.Imports,
        receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
      ) {
        void WebAssembly.instantiate(compiled, imports).then((instance) => receive(instance, compiled));
        return {};
      },
    });
    mod.FS.mkdirTree('/usr/local/share/ngspice/scripts');
    mod.FS.writeFile('/usr/local/share/ngspice/scripts/spinit', SPINIT);
    mod.FS.mkdirTree('/proc/self');
    mod.FS.writeFile('/proc/meminfo', PROC_MEMINFO);
    mod.FS.writeFile('/proc/self/statm', PROC_STATM);
    mod.FS.writeFile('/circuit.cir', netlist.endsWith('\n') ? netlist : `${netlist}\n`);
    const t1 = now();

    const proc = (globalThis as { process?: ProcessLike }).process;
    const savedExitCode = proc?.exitCode;
    let exitCode: number | null = null;
    let crash: string | undefined;
    try {
      exitCode = mod.callMain([...NGSPICE_ARGS]);
    } catch (e) {
      // A WebAssembly trap (e.g. a null-pointer read inside ngspice) or an unexpected throw.
      crash = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    } finally {
      // Emscripten's Node code sets process.exitCode when ngspice calls exit(); undo that.
      if (proc) proc.exitCode = savedExitCode;
    }
    const t2 = now();

    let plots: RawPlot[] = [];
    let rawError: string | undefined;
    try {
      plots = parseRawfile(mod.FS.readFile('/out.raw'));
    } catch (e) {
      // No rawfile is normal when ngspice stopped on an error (Emscripten throws an
      // ErrnoError with errno 44, ENOENT); anything else is reported.
      // After a failed run (exit code not 0) a half-written rawfile is expected, not news.
      if ((e as { errno?: unknown } | null)?.errno !== 44 && exitCode === 0) {
        rawError = e instanceof Error ? e.message : JSON.stringify(e);
      }
    }
    const t3 = now();

    const stdout = out.join('\n');
    const stderr = err.join('\n');
    const diagnostics: EngineDiagnostic[] = classifyOutput(stdout, stderr);
    if (crash !== undefined) {
      diagnostics.push({ severity: 'error', code: 'engine-crash', text: crash });
    }
    if (rawError !== undefined) {
      diagnostics.push({ severity: 'error', code: 'rawfile', text: rawError });
    }
    const unreliable = diagnostics.some((d) => UNRELIABLE_CODES.has(d.code));
    const ok =
      exitCode === 0 &&
      crash === undefined &&
      plots.length > 0 &&
      !diagnostics.some((d) => d.severity === 'error');

    return {
      ok,
      unreliable,
      exitCode,
      stdout,
      stderr,
      plots,
      diagnostics,
      timings: { instantiateMs: t1 - t0, runMs: t2 - t1, parseMs: t3 - t2 },
    };
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

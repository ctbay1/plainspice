/**
 * The engine's Web Worker: loads ngspice (WebAssembly) once and runs netlists on request,
 * so a long simulation never freezes the page. One run at a time; the page's EngineClient
 * terminates this worker if a run takes too long and starts a new one.
 */
import createNgspice from '../../engine/dist/ngspice.mjs';
import { NgspiceEngine } from './ngspice.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

const wasmUrl = new URL('../../engine/dist/ngspice.wasm', import.meta.url);
let engine: Promise<NgspiceEngine> | undefined;
let loadMs = 0;

function getEngine(): Promise<NgspiceEngine> {
  if (!engine) {
    const t0 = performance.now();
    engine = NgspiceEngine.create(createNgspice, fetch(wasmUrl)).then((e) => {
      loadMs = performance.now() - t0;
      return e;
    });
    engine.catch(() => {
      engine = undefined; // let the next request try again
    });
  }
  return engine;
}

// Runs are queued so that two requests never share one ngspice instance.
let queue: Promise<void> = Promise.resolve();

scope.onmessage = (event) => {
  const msg = event.data;
  queue = queue.then(async () => {
    try {
      const e = await getEngine();
      if (msg.type === 'init') {
        scope.postMessage({ type: 'ready', id: msg.id, loadMs });
        return;
      }
      const result = await e.run(msg.netlist);
      const transfer: Transferable[] = [];
      for (const plot of result.plots) {
        for (const column of plot.real) transfer.push(column.buffer);
        for (const column of plot.imag ?? []) transfer.push(column.buffer);
      }
      scope.postMessage({ type: 'result', id: msg.id, result }, transfer);
    } catch (err) {
      scope.postMessage({ type: 'failed', id: msg.id, error: err instanceof Error ? err.message : String(err) });
    }
  });
};

/**
 * The page's handle on the engine Worker. Promise-based; a run that takes longer than its
 * timeout (or is cancelled) terminates the Worker, and the next run starts a fresh one.
 */
import type { WorkerRequest, WorkerResponse } from './protocol.ts';
import type { RunResult } from './types.ts';

export class EngineTimeoutError extends Error {
  override name = 'EngineTimeoutError';
}
export class EngineCancelledError extends Error {
  override name = 'EngineCancelledError';
}

interface Pending {
  resolve: (value: WorkerResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export interface EngineClientOptions {
  /** Default per-run timeout in milliseconds (default 20 s). */
  timeoutMs?: number;
  /** Creates the Worker; replaceable in tests. */
  createWorker?: () => Worker;
}

export class EngineClient {
  private worker: Worker | undefined;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private readonly timeoutMs: number;
  private readonly createWorker: () => Worker;

  constructor(options: EngineClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.createWorker =
      options.createWorker ?? (() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }));
  }

  /** Load ngspice now (it is about 1.5 MB), so the first Run is quick. Resolves with the load time. */
  async warmUp(): Promise<number> {
    const response = await this.send({ type: 'init', id: this.nextId++ }, 60_000);
    if (response.type === 'ready') return response.loadMs;
    throw new Error(response.type === 'failed' ? response.error : 'unexpected reply');
  }

  async run(netlist: string, timeoutMs = this.timeoutMs): Promise<RunResult> {
    const response = await this.send({ type: 'run', id: this.nextId++, netlist }, timeoutMs);
    if (response.type === 'result') return response.result;
    throw new Error(response.type === 'failed' ? response.error : 'unexpected reply');
  }

  /** Stop whatever is running: the Worker is terminated and pending runs are rejected. */
  cancel(): void {
    this.reset(new EngineCancelledError('The simulation was stopped.'));
  }

  dispose(): void {
    this.cancel();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(event.data.id);
      if (!p) return;
      this.pending.delete(event.data.id);
      if (p.timer !== undefined) clearTimeout(p.timer);
      p.resolve(event.data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.reset(new Error(`The simulation engine stopped unexpectedly: ${event.message || 'unknown error'}`));
    };
    this.worker = worker;
    return worker;
  }

  private send(request: WorkerRequest, timeoutMs: number): Promise<WorkerResponse> {
    const worker = this.ensureWorker();
    return new Promise<WorkerResponse>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.reset(new EngineTimeoutError(`The simulation took longer than ${Math.round(timeoutMs / 1000)} s and was stopped.`));
            }, timeoutMs)
          : undefined;
      this.pending.set(request.id, { resolve, reject, timer });
      worker.postMessage(request);
    });
  }

  private reset(reason: Error): void {
    this.worker?.terminate();
    this.worker = undefined;
    for (const p of this.pending.values()) {
      if (p.timer !== undefined) clearTimeout(p.timer);
      p.reject(reason);
    }
    this.pending.clear();
  }
}

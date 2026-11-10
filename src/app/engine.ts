/**
 * The app's view of the simulation engine: EngineClient (src/engine/client.ts, ngspice in a Web
 * Worker) behind a small interface, so tests can give the app a fake engine.
 */
import { EngineCancelledError, EngineClient, EngineTimeoutError } from '../engine/client.ts';
import type { RunResult } from '../engine/types.ts';

export interface Engine {
  /** Load ngspice now so the first Run is quick; resolves with the load time in ms. */
  warmUp(): Promise<number>;
  run(netlist: string, timeoutMs?: number): Promise<RunResult>;
  /** Stop the run in progress (the Worker is terminated; the next run loads ngspice again). */
  cancel(): void;
}

/** A run that takes longer than this is stopped (decided in the brief: 20 s). */
export const RUN_TIMEOUT_MS = 20_000;

export function createEngine(): Engine {
  return new EngineClient({ timeoutMs: RUN_TIMEOUT_MS });
}

export const isCancelled = (e: unknown): boolean => e instanceof EngineCancelledError;
export const isTimeout = (e: unknown): boolean => e instanceof EngineTimeoutError;

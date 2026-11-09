/** Messages between the page and the engine's Web Worker. */
import type { RunResult } from './types.ts';

export type WorkerRequest =
  | { type: 'init'; id: number }
  | { type: 'run'; id: number; netlist: string };

export type WorkerResponse =
  | { type: 'ready'; id: number; loadMs: number }
  | { type: 'result'; id: number; result: RunResult }
  | { type: 'failed'; id: number; error: string };

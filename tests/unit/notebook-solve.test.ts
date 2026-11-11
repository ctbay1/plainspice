/** src/notebook/solve.ts: live solving (runs never overlap, the newest text wins) and when numbers are answers. */
import { describe, expect, it } from 'vitest';
import { answers, liveSolver, type Solution } from '../../src/notebook/index.ts';

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('liveSolver', () => {
  it('never runs two at once, and only the newest waiting text is solved', async () => {
    const started: string[] = [];
    const finishing: ((v: string) => void)[] = [];
    let running = 0;
    let most = 0;
    const solved: string[] = [];
    const live = liveSolver(
      (text) => {
        started.push(text);
        running += 1;
        most = Math.max(most, running);
        const d = deferred<string>();
        finishing.push((v) => {
          running -= 1;
          d.resolve(v);
        });
        return d.promise;
      },
      (r) => solved.push(r),
    );
    live.request('3');
    live.request('3k');
    live.request('3k3');
    live.request('33k');
    expect(started).toEqual(['3']);
    expect(live.busy()).toBe(true);
    finishing[0]!('solved 3');
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(['3', '33k']);
    finishing[1]!('solved 33k');
    await live.idle();
    expect(solved).toEqual(['solved 3', 'solved 33k']);
    expect(most).toBe(1);
    expect(live.busy()).toBe(false);
  });

  it('goes on after a run that fails', async () => {
    const errors: string[] = [];
    const solved: string[] = [];
    const live = liveSolver(
      (text) => (text === 'bad' ? Promise.reject(new Error('engine stopped')) : Promise.resolve(text)),
      (r) => solved.push(r),
      (e, text) => errors.push(`${text}: ${(e as Error).message}`),
    );
    live.request('bad');
    await live.idle();
    live.request('good');
    await live.idle();
    expect(errors).toEqual(['bad: engine stopped']);
    expect(solved).toEqual(['good']);
  });
});

describe('answers', () => {
  const sol = (status: Solution['status']): Solution =>
    ({ text: '', status, words: { status: 'ok', ngspiceError: false, nodes: [], currents: [], sweeps: [], warnings: [], summary: '', summarySpeech: '' }, annotations: [], checks: [], ms: 1 }) as Solution;
  it('are only the numbers of a trustworthy run with no error-level check', () => {
    expect(answers(sol('ok'))).toBeDefined();
    expect(answers(sol('check'))).toBeUndefined();
    expect(answers(sol('unreliable'))).toBeUndefined();
    expect(answers(sol('failed'))).toBeUndefined();
    expect(answers(undefined)).toBeUndefined();
  });
});

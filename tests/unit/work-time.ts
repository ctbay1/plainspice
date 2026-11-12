/**
 * How long a piece of work keeps the processor busy, for the tests that check a speed (the parser, the
 * trap checks). By this thread's own processor time where Node counts it (`process.threadCpuUsage`), else
 * by the clock. On a machine shared with other builds and tests (load 25 on 4 cores) the clock also
 * counts the wait for a processor, which says nothing about the code: there a parse of 10 000 lines took
 * 190 ms by the clock for about 30 ms of work, and the check that its time grows with the number of
 * lines failed. The processor time is counted in steps (4 ms here), so what is timed should take a few
 * tens of milliseconds at least.
 */
const threadTime = typeof process.threadCpuUsage === 'function' ? (): number => {
  const { user, system } = process.threadCpuUsage();
  return (user + system) / 1000;
} : undefined;

/** Milliseconds of work (processor time where Node counts it, else the clock). */
export function workMs(work: () => void): number {
  const now = threadTime ?? (() => performance.now());
  const start = now();
  work();
  return now() - start;
}

/**
 * The least time of each piece of work over `tries` tries, taken in turns (one of each, then again), so
 * that a busy spell of the machine falls on all of them alike, and the least of each is its own work.
 */
export function leastWorkMs<const T extends readonly (() => void)[]>(works: T, tries: number): { [K in keyof T]: number } {
  const least = works.map(() => Number.POSITIVE_INFINITY);
  for (let k = 0; k < tries; k++) works.forEach((work, i) => (least[i] = Math.min(least[i]!, workMs(work))));
  return least as { [K in keyof T]: number };
}

// @vitest-environment jsdom
/**
 * How long an edit's note stays in the hint line (src/app/hint-note.ts): an ordinary note a few
 * seconds; a note that must be read (the starter's why: the critic of words W9) its reading time,
 * counted only while the hint line shows it, so a phone's card sheet over the hint line does not
 * use it up.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { starterWords } from '../../src/app/editing.ts';
import { READ_MS_PER_CHAR, REFUSAL_SHOWN_MS, readingMs, useNoteTimer, type HintNote } from '../../src/app/hint-note.ts';
import { t } from '../../src/i18n/index.ts';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] }));
afterEach(() => vi.useRealTimers());

/** The hook with a note and whether the hint line shows it; `cleared` lists the notes it took away. */
function timer(note: HintNote | undefined, inView: boolean) {
  const cleared: HintNote[] = [];
  const clear = (n: HintNote): void => void cleared.push(n);
  const hook = renderHook(({ n, v }: { n: HintNote | undefined; v: boolean }) => useNoteTimer(n, v, clear), { initialProps: { n: note, v: inView } });
  return { cleared, show: (n: HintNote | undefined, v: boolean) => hook.rerender({ n, v }) };
}

describe('the reading time of a note that must be read', () => {
  it('is 60 ms a character, never less than a refusal’s few seconds', () => {
    expect(READ_MS_PER_CHAR).toBe(60);
    expect(readingMs('Short.')).toBe(REFUSAL_SHOWN_MS);
    expect(readingMs('x'.repeat(200))).toBe(12_000);
    // The starter's why and the drawing note, as the first part on a blank page writes them: well over the old 6 s.
    const note = `${starterWords()} ${t('drawingWritten')}`;
    expect(readingMs(note)).toBe(note.length * 60);
    expect(readingMs(note)).toBeGreaterThan(15_000);
  });
});

describe('an edit’s note in the hint line', () => {
  it('an ordinary note goes after a few seconds, in view or not', () => {
    const note = { words: t('drawingWritten') };
    const { cleared } = timer(note, false);
    vi.advanceTimersByTime(REFUSAL_SHOWN_MS - 1);
    expect(cleared).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(cleared).toEqual([note]);
  });

  it('one that must be read waits, unseen, while the hint line is covered (a phone’s card sheet), however long', () => {
    const note = { words: `${starterWords()} ${t('drawingWritten')}`, read: true };
    const { cleared, show } = timer(note, false);
    vi.advanceTimersByTime(60_000);
    expect(cleared).toEqual([]);
    // The sheet closes: the hint line shows it, for its whole reading time from now.
    show(note, true);
    vi.advanceTimersByTime(readingMs(note.words) - 1);
    expect(cleared).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(cleared).toEqual([note]);
  });

  it('counts only the time it is in view: shown, covered, shown again, it stays for the rest of its reading time', () => {
    const note = { words: starterWords(), read: true };
    const read = readingMs(note.words);
    const { cleared, show } = timer(note, true);
    vi.advanceTimersByTime(5000);
    show(note, false);
    vi.advanceTimersByTime(30_000);
    expect(cleared).toEqual([]);
    show(note, true);
    vi.advanceTimersByTime(read - 5000 - 1);
    expect(cleared).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(cleared).toEqual([note]);
  });

  it('a new note starts its own time', () => {
    const first = { words: starterWords(), read: true };
    const { cleared, show } = timer(first, true);
    vi.advanceTimersByTime(4000);
    const next = { words: t('drawingWritten') };
    show(next, true);
    vi.advanceTimersByTime(REFUSAL_SHOWN_MS);
    expect(cleared).toEqual([next]);
    const again = { words: starterWords(), read: true };
    show(again, true);
    vi.advanceTimersByTime(readingMs(again.words) - 1);
    expect(cleared).toEqual([next]);
    vi.advanceTimersByTime(1);
    expect(cleared).toEqual([next, again]);
  });
});

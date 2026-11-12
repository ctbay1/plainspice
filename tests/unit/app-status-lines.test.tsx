// @vitest-environment jsdom
/**
 * The phone's status line when "Show the whole drawing" shares it with another button (the turn,
 * Undo): decision 0018, "Two buttons on one row". A calm status and "Running…" keep their words for
 * screen readers only, and no dot, so the line keeps its one row through each run an edit starts; a
 * status to read (paused, an error, a run with a reason beside it) keeps its words.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusLines } from '../../src/app/components/Frame.tsx';
import type { StatusWords } from '../../src/app/words.ts';
import { t } from '../../src/i18n/index.ts';

afterEach(cleanup);

const noop = (): void => undefined;

/** The status line drawn with these buttons (default: "Show the whole drawing" and Undo, on a phone). */
function pill(status: StatusWords, buttons: { whole?: boolean; undo?: boolean; turn?: boolean } = { whole: true, undo: true }, phone = true): HTMLElement {
  const { container } = render(
    <StatusLines
      hint=""
      status={status}
      analysis={undefined}
      phone={phone}
      {...(buttons.whole ? { whole: noop } : {})}
      {...(buttons.undo ? { undo: noop } : {})}
      {...(buttons.turn ? { turn: { turned: true, video: true, onToggle: noop } } : {})}
    />,
  );
  return container.querySelector<HTMLElement>('.status')!;
}

/** Its words are there for screen readers, out of sight, with no dot: the line is only its buttons. */
function crowded(s: HTMLElement): boolean {
  return s.classList.contains('is-crowded') && !s.querySelector('.status__dot') && !!s.querySelector('.status__main.visually-hidden');
}

const finished: StatusWords = { main: t('statusSolved', { ms: 12 }), tone: 'ok' };
const running: StatusWords = { main: t('statusSolving'), tone: 'busy' };

describe('the status line of a phone with two buttons', () => {
  it('keeps "Finished" and "Running…" for screen readers only, so the line does not change as an edit runs', () => {
    for (const status of [finished, running]) {
      for (const buttons of [{ whole: true, undo: true }, { whole: true, turn: true }, { whole: true, undo: true, turn: true }]) {
        const s = pill(status, buttons);
        expect(crowded(s), `${status.main} with ${JSON.stringify(buttons)}`).toBe(true);
        expect(s.textContent).toContain(status.main);
        cleanup();
      }
    }
  });

  it('keeps the words of a status to read, and of a run with a reason beside it', () => {
    const toRead: StatusWords[] = [
      { main: t('statusSolving'), detail: t('statusOldPencil'), tone: 'busy' },
      { main: t('statusLoading'), detail: t('statusLoadingDetail'), tone: 'busy' },
      { main: t('statusPaused'), detail: t('statusPausedStopped', { run: t('pressRunPhone') }), tone: 'paused' },
      { main: t('statusRunFailed'), detail: 'ngspice stopped', tone: 'bad' },
    ];
    for (const status of toRead) {
      const s = pill(status);
      expect(crowded(s), status.main).toBe(false);
      expect(s.querySelector('.status__main')!.classList.contains('visually-hidden')).toBe(false);
      expect(s.querySelector('.status__dot')).not.toBeNull();
      cleanup();
    }
  });

  it('keeps the words with one button, and on a computer', () => {
    for (const status of [finished, running]) {
      expect(crowded(pill(status, { whole: true }))).toBe(false);
      cleanup();
      expect(crowded(pill(status, { undo: true, turn: true }))).toBe(false);
      cleanup();
      expect(crowded(pill(status, { whole: true, undo: true }, false))).toBe(false);
      cleanup();
    }
  });
});

// @vitest-environment jsdom
/**
 * A part's card through a run (the second re-check, AP-2; decision 0018): while an error stood, the card's
 * note ("No numbers yet: a check found an error on line 2 …") went for each run of a value typed and came
 * back with its answer, so the card's actions below it went up and down under the finger with each key.
 * The note it had settled on now stays while a run that comes quickly is under way; "Running…" shows only
 * once ngspice takes a moment (BUSY_AFTER_MS), as before; and a card opened afresh keeps nothing of the last.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUSY_AFTER_MS, IndexCard, type CardNote } from '../../src/app/components/IndexCard.tsx';
import { t } from '../../src/i18n/index.ts';

const base = { name: 'R2', kind: 'resistor', line: 4, icon: 'R', label: 'value', start: '2k', readouts: [], sentence: 'R2 joins out and n1.', typeHint: 'Type a resistance' } as const;
const handlers = { onValue: () => undefined, onPutBack: () => undefined, onClose: () => undefined, onExplain: () => undefined };
const error: CardNote = { text: 'No numbers yet: a check found an error on line 2 (No ground: no node is called 0).', tone: 'bad' };
const running: CardNote = { text: t('cardSolving'), tone: 'busy' };
const noteNow = (): string => document.querySelector('.index-card__note')?.textContent ?? '';

describe('a part’s card through a run (AP-2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps the note it had while a quick run is under way, and says "Running…" only once ngspice takes a moment', () => {
    const card = (value: string, note: CardNote | undefined, session = 1) => <IndexCard {...base} {...handlers} value={value} {...(note ? { note } : {})} session={session} variant="sheet" />;
    const { rerender } = render(card('2k', error));
    expect(noteNow()).toBe(error.text);
    // A value typed: its run is under way. The error's note stays (on b060bc8 it went at once: '').
    rerender(card('3', running));
    expect(noteNow()).toBe(error.text);
    act(() => {
      vi.advanceTimersByTime(BUSY_AFTER_MS - 50);
    });
    expect(noteNow()).toBe(error.text);
    // The answer: the same error, the same note.
    rerender(card('3', error));
    expect(noteNow()).toBe(error.text);
    // A run that takes a moment says so.
    rerender(card('3k', running));
    expect(noteNow()).toBe(error.text);
    act(() => {
      vi.advanceTimersByTime(BUSY_AFTER_MS);
    });
    expect(noteNow()).toBe(t('cardSolving'));
    rerender(card('3k', error));
    expect(noteNow()).toBe(error.text);
    // Another card opened (a new session) keeps nothing of this one's note while its first run goes.
    rerender(card('1k', running, 2));
    expect(noteNow()).toBe('');
  });

  it('keeps no note through a run when it had none (the numbers stay, dimmed, until the answer)', () => {
    const card = (value: string, note: CardNote | undefined) => <IndexCard {...base} {...handlers} value={value} {...(note ? { note } : {})} session={1} variant="sheet" />;
    const { rerender } = render(card('2k', undefined));
    expect(noteNow()).toBe('');
    rerender(card('3', running));
    expect(noteNow()).toBe('');
    act(() => {
      vi.advanceTimersByTime(BUSY_AFTER_MS);
    });
    expect(noteNow()).toBe(t('cardSolving'));
  });
});

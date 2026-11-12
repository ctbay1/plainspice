/**
 * An edit's note in the hint line (what PlainSpice also did to the netlist, said aloud as well), and
 * how long it stays there. Plain TypeScript and one React hook (decision 0002).
 *
 * A note stays a few seconds, as a refused edit's reason does, or until the pointer moves on the
 * paper a moment later (App.tsx). A note that must be read, not only heard (`read`: why the first
 * part on a blank page also wrote .op and .end, words W9), is held for its reading time instead: about
 * 60 ms a character, counted only while the hint line shows it, whatever the pointer does. On a phone
 * the new part's card opens as a sheet over the hint line, so that time starts when the sheet closes.
 * (Held only as long as the drawing note, it went 1.5 s after the first part at the first pointer
 * move, after 6 s at most, and a phone never showed it: the critic of words W9.)
 */
import { useEffect, useRef } from 'react';

/** How long a refused edit's reason, or an edit's note, stays in the hint line (each is announced as well). */
export const REFUSAL_SHOWN_MS = 6000;
/**
 * A note that must be read is held this long a character: 60 ms, about 170 words a minute, a
 * beginner's pace through words such as .op, .end and operating point.
 */
export const READ_MS_PER_CHAR = 60;

/** An edit's note in the hint line. `read`: it must be read there, not only heard (held for its reading time). */
export interface HintNote {
  words: string;
  read?: boolean;
}

/** How long a note that must be read stays in view: its length at READ_MS_PER_CHAR, never less than REFUSAL_SHOWN_MS. */
export const readingMs = (words: string): number => Math.max(REFUSAL_SHOWN_MS, words.length * READ_MS_PER_CHAR);

/**
 * Takes the note out of the hint line when its time is up (`clear`, called with the note it was
 * for): an ordinary note after REFUSAL_SHOWN_MS; a note that must be read once it has been in view
 * (`inView`: the hint line shows it now) for its reading time in all, however often it went out of
 * view meanwhile.
 */
export function useNoteTimer(note: HintNote | undefined, inView: boolean, clear: (note: HintNote) => void): void {
  /** How long the note that must be read has been in view so far. */
  const seen = useRef<{ note: HintNote; ms: number } | undefined>(undefined);
  useEffect(() => {
    if (!note || note.read) return undefined;
    const timer = window.setTimeout(() => clear(note), REFUSAL_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [note, clear]);
  useEffect(() => {
    if (!note?.read || !inView) return undefined;
    if (seen.current?.note !== note) seen.current = { note, ms: 0 };
    const shown = seen.current;
    const from = performance.now();
    const timer = window.setTimeout(() => clear(note), Math.max(0, readingMs(note.words) - shown.ms));
    return () => {
      window.clearTimeout(timer);
      shown.ms += performance.now() - from;
    };
  }, [note, inView, clear]);
}

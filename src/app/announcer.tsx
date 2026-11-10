/**
 * Live regions: one polite region for news (a run finished, a link was copied, the number of
 * checks changed) and one alert region, used sparingly, for errors that need attention now.
 * Both are always in the page (screen readers only watch regions that exist before they change).
 * Each message is added as its own element, so two messages close together are both read (a new
 * one never overwrites the last), and the same message can be announced again.
 *
 * - aria-atomic="false": role="status" and role="alert" are atomic by default, which makes a screen
 *   reader read the whole region on each addition, the last run's numbers before the new ones
 *   (a11y review F4). Only the new message is read.
 * - data-live-announcer: while a dialog is open, React Aria makes the rest of the page inert, these
 *   regions included, so "Link copied." in the Share dialog was never heard (a11y review F1). React
 *   Aria leaves elements with this attribute out of that, as it does for its own announcer.
 */
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';

export type Politeness = 'polite' | 'assertive';
export type Announce = (message: string, politeness?: Politeness) => void;

const AnnounceContext = createContext<Announce>(() => undefined);

export function useAnnounce(): Announce {
  return useContext(AnnounceContext);
}

/** How long a message stays in the region; removed afterwards so it is not read again later. */
const CLEAR_AFTER_MS = 10_000;
/** A short wait before adding, so a region that was just created (or emptied) is watched. */
const ADD_AFTER_MS = 50;

export function AnnouncerProvider({ children }: { children: ReactNode }): ReactNode {
  const polite = useRef<HTMLDivElement>(null);
  const assertive = useRef<HTMLDivElement>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const id of all) clearTimeout(id);
      all.clear();
    };
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  const announce = useCallback<Announce>(
    (message, politeness = 'polite') => {
      if (!message) return;
      later(() => {
        const region = politeness === 'assertive' ? assertive.current : polite.current;
        if (!region) return;
        const item = document.createElement('p');
        item.textContent = message;
        region.append(item);
        later(() => item.remove(), CLEAR_AFTER_MS);
      }, ADD_AFTER_MS);
    },
    [later],
  );

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      {/* role="status" on a div, not <output>: <output> is a form control and is announced less reliably. */}
      <div
        ref={polite}
        className="visually-hidden"
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="status"
        aria-live="polite"
        aria-atomic="false"
        aria-relevant="additions"
        data-live-announcer="true"
        data-testid="live-polite"
      />
      <div
        ref={assertive}
        className="visually-hidden"
        role="alert"
        aria-live="assertive"
        aria-atomic="false"
        aria-relevant="additions"
        data-live-announcer="true"
        data-testid="live-alert"
      />
    </AnnounceContext.Provider>
  );
}

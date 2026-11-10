/**
 * How the keyboard moves in the header's toolbar (the ARIA APG toolbar pattern): it is one Tab
 * stop; ArrowLeft and ArrowRight move between its buttons; Tab and Shift+Tab leave it; coming back
 * with the keyboard returns to the button used last.
 *
 * React Aria's Toolbar does all this too, but it also sends focus back to the button used last when
 * a mouse or a finger presses another button. If that button is off-screen (a phone, large text, a
 * page scrolled down to the results), focusing it scrolls the page under the pointer, the press
 * ends over another button, and nothing happens: Help would not open. The 320 px test caught this
 * with the fonts of GitHub's runners. Here focus goes back only when the keyboard brings it.
 */
import { useRef, type FocusEvent, type KeyboardEvent, type RefObject } from 'react';

export interface ToolbarFocusProps {
  onPointerDownCapture: () => void;
  onKeyDownCapture: (e: KeyboardEvent<HTMLElement>) => void;
  onFocusCapture: (e: FocusEvent<HTMLElement>) => void;
  onBlurCapture: (e: FocusEvent<HTMLElement>) => void;
}

export function useToolbarFocus(ref: RefObject<HTMLElement | null>): ToolbarFocusProps {
  /** The button to go back to when the keyboard comes back into the toolbar. */
  const last = useRef<HTMLElement | null>(null);
  /** A pointer is pressing inside the toolbar: the focus that follows is that press's own. */
  const pressing = useRef(false);

  const buttons = (): HTMLElement[] => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []);
  const inside = (node: EventTarget | null): boolean => node instanceof Node && (ref.current?.contains(node) ?? false);

  return {
    onPointerDownCapture: () => {
      pressing.current = true;
      // Released or cancelled anywhere (the pointer may leave the button first).
      const done = (): void => {
        pressing.current = false;
        window.removeEventListener('pointerup', done, true);
        window.removeEventListener('pointercancel', done, true);
      };
      window.addEventListener('pointerup', done, true);
      window.addEventListener('pointercancel', done, true);
    },
    onKeyDownCapture: (e) => {
      const list = buttons();
      const at = list.indexOf(e.target as HTMLElement);
      if (at < 0) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        // No wrapping at the ends, as in React Aria's Toolbar.
        list[at + (e.key === 'ArrowRight' ? 1 : -1)]?.focus();
        e.preventDefault();
        e.stopPropagation();
      } else if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        // Leave the whole toolbar: the browser's own Tab move then starts from its last button
        // (Tab) or its first (Shift+Tab), and so goes past it.
        last.current = e.target as HTMLElement;
        (e.shiftKey ? list[0] : list[list.length - 1])?.focus();
      }
    },
    onBlurCapture: (e) => {
      // Focus leaves the toolbar (unless Tab already noted where it was).
      if (!inside(e.relatedTarget) && !last.current) last.current = e.target as HTMLElement;
    },
    onFocusCapture: (e) => {
      if (inside(e.relatedTarget)) return; // moving within the toolbar
      const previous = last.current;
      last.current = null;
      if (pressing.current || !previous || previous === e.target || !previous.isConnected || !inside(previous)) return;
      previous.focus();
    },
  };
}

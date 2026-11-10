// @vitest-environment jsdom
/**
 * The toolbar's focus rules (src/app/toolbar-focus.ts): arrow keys, one Tab stop, the keyboard
 * comes back to the button used last, and a press with a mouse or finger keeps focus on the
 * pressed button (React Aria's Toolbar sent it back to the button used last, which could scroll
 * the page under the pointer and lose the press).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useToolbarFocus } from '../../src/app/toolbar-focus.ts';

function Bar(): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const focus = useToolbarFocus(ref);
  return (
    <>
      <button type="button">Before</button>
      <div ref={ref} role="toolbar" aria-label="Actions" {...focus}>
        <button type="button">Run</button>
        <button type="button">Share</button>
        <button type="button">Help</button>
      </div>
      <button type="button">After</button>
    </>
  );
}

const button = (name: string): HTMLElement => screen.getByRole('button', { name });

afterEach(cleanup);

describe('useToolbarFocus', () => {
  it('moves between the buttons with the arrow keys, without wrapping', () => {
    render(<Bar />);
    button('Run').focus();
    fireEvent.keyDown(button('Run'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(button('Share'));
    fireEvent.keyDown(button('Share'), { key: 'ArrowRight' });
    fireEvent.keyDown(button('Help'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(button('Help'));
    fireEvent.keyDown(button('Help'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(button('Share'));
  });

  it('Tab leaves from the last button and Shift+Tab from the first, so the toolbar is one Tab stop', () => {
    render(<Bar />);
    button('Share').focus();
    fireEvent.keyDown(button('Share'), { key: 'Tab' });
    expect(document.activeElement).toBe(button('Help'));
    button('Share').focus();
    fireEvent.keyDown(button('Share'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(button('Run'));
  });

  it('when the keyboard comes back, focus returns to the button used last', () => {
    render(<Bar />);
    button('Share').focus();
    fireEvent.keyDown(button('Share'), { key: 'Tab' }); // the browser then moves on from Help
    button('After').focus();
    button('Help').focus(); // Shift+Tab from "After" lands on the last button
    expect(document.activeElement).toBe(button('Share'));
    // Leaving without Tab (e.g. a click elsewhere) remembers the button too.
    button('Before').focus();
    button('Run').focus();
    expect(document.activeElement).toBe(button('Share'));
  });

  it('a press with a mouse or a finger keeps focus on the pressed button', () => {
    render(<Bar />);
    button('Run').focus();
    button('After').focus(); // focus left the toolbar from Run
    fireEvent.pointerDown(button('Help'));
    button('Help').focus(); // what React Aria's press does on pointerdown
    expect(document.activeElement).toBe(button('Help'));
    fireEvent.pointerUp(window);
    // The pressed button is now the one the keyboard comes back to (not Run any more).
    button('After').focus();
    button('Run').focus();
    expect(document.activeElement).toBe(button('Help'));
  });
});

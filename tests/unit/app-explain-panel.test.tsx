// @vitest-environment jsdom
/**
 * The Explain panel's list of lines (src/app/components/ExplainPanel.tsx): a run of drawing lines is
 * one entry, "Lines 11–32: Drawing lines", with one "Go to line" button, also in the first
 * FIRST_LINES lines it shows before "Show the other n lines" (final reviews, kept F2 and words W11).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExplainPanel, FIRST_LINES } from '../../src/app/components/ExplainPanel.tsx';
import { parseNetlist } from '../../src/spice/parse.ts';

afterEach(cleanup);

const root = resolve(import.meta.dirname, '../..');

function show(text: string, onGoToLine = vi.fn()): HTMLElement {
  render(<ExplainPanel netlist={parseNetlist(text)} selection={undefined} parts={[]} colours={new Map()} onGoToLine={onGoToLine} onPick={() => {}} />);
  return screen.getByRole('region', { name: 'Every line, explained' });
}

describe('the Explain panel after the final reviews (12 November 2026)', () => {
  it('lists the drawing lines of a video example once, with one Go to line button (kept F2)', () => {
    const go = vi.fn();
    const list = show(readFileSync(join(root, 'examples/p01/p01-3-ccvs-supernode.cir'), 'utf8'), go);
    const headings = within(list).getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(headings).toContain('Lines 11–32: Drawing lines');
    expect(headings.filter((h) => h?.endsWith(': Comment'))).toEqual(['Line 2: Comment']);
    expect(within(list).getByRole('article', { name: 'Lines 11–32: Drawing lines' }).textContent).toContain('ngspice skips them: a line that starts with * is a comment.');
    expect(within(list).queryByRole('button', { name: 'Go to line 12 in the netlist' })).toBeNull();
    fireEvent.click(within(list).getByRole('button', { name: 'Go to line 11 in the netlist' }));
    expect(go).toHaveBeenCalledWith(11);
  });

  it('does not count again the drawing lines past the first lines that their entry already shows', () => {
    const parts = Array.from({ length: FIRST_LINES - 10 }, (_, i) => `R${i + 1} a 0 1k`);
    const drawing = Array.from({ length: 30 }, (_, i) => `*@ R${i + 1} ${i} 0 0`);
    const text = ['* t', 'V1 a 0 1', ...parts, '* plainspice-drawing v1', ...drawing, '.op', '.end', ''].join('\n');
    const list = show(text);
    const first = FIRST_LINES - 7;
    const last = first + 30;
    expect(within(list).getByRole('heading', { name: `Lines ${first}–${last}: Drawing lines` })).toBeTruthy();
    // After the block: .op, .end and the empty last line.
    expect(within(list).getByRole('button', { name: 'Show the other 3 lines' })).toBeTruthy();
  });
});

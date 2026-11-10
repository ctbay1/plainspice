// @vitest-environment jsdom
import { undo } from '@codemirror/commands';
import { diagnosticCount, forEachDiagnostic, type Diagnostic } from '@codemirror/lint';
import { EditorSelection } from '@codemirror/state';
import { hasHoverTooltips } from '@codemirror/view';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MAX_TRAP_MARKS, trapsToMark } from '../../src/editor/editor.ts';
import { createEditor, EDITOR_HINT, EDITOR_STRINGS, type EditorOptions, type PlainSpiceEditor } from '../../src/editor/index.ts';
import type { Fix, Trap } from '../../src/spice/types.ts';

const F3A = ['* F3a: the 1M trap', 'V1 n1 0 6', 'R1 n1 n2 1M', 'R2 n2 0 1meg', '.op', '.end'].join('\n');
/** Where R1's value "1M" starts (the title mentions 1M too). */
const AT_1M = F3A.indexOf('n2 1M') + 3;

beforeAll(() => {
  // jsdom has no layout. CodeMirror measures text with these; zero-sized boxes are enough here.
  const empty = (): DOMRectList => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  const rect = (): DOMRect => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = empty;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = rect;
});

let editors: PlainSpiceEditor[] = [];
afterEach(() => {
  for (const e of editors) e.destroy();
  editors = [];
  document.body.innerHTML = '';
});

function make(options: Partial<EditorOptions> = {}): { editor: PlainSpiceEditor; parent: HTMLElement } {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor({ parent, doc: F3A, label: 'Netlist', ...options });
  editors.push(editor);
  return { editor, parent };
}

function key(editor: PlainSpiceEditor, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  editor.view.contentDOM.dispatchEvent(event);
  return event;
}

function diagnostics(editor: PlainSpiceEditor): { d: Diagnostic; from: number; to: number }[] {
  const out: { d: Diagnostic; from: number; to: number }[] = [];
  forEachDiagnostic(editor.view.state, (d, from, to) => out.push({ d, from, to }));
  return out;
}

/** The first diagnostic (fails the test when there is none). */
function firstDiagnostic(editor: PlainSpiceEditor): { d: Diagnostic; from: number; to: number } {
  const [first] = diagnostics(editor);
  if (!first) throw new Error('no diagnostics');
  return first;
}

const lineRange = (text: string, line: number): { from: number; to: number } => {
  const lines = text.split('\n');
  const from = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  return { from, to: from + lines[line - 1]!.length };
};

/** The 1M trap on line 3, with one fix that replaces "1M" by "1meg". */
function megaTrap(): Trap {
  const at = AT_1M;
  return {
    id: 'mega-as-milli',
    severity: 'warning',
    line: 3,
    span: { from: at, to: at + 2 },
    title: '1M means one milliohm',
    why: 'In SPICE, M is milli. Write 1meg for one megaohm.',
    ngspice: 'ngspice reads 1M as 0.001 ohm and says nothing.',
    fixes: [{ label: 'Change 1M to 1meg', changes: [{ from: at, to: at + 2, insert: '1meg' }] }],
  };
}

describe('accessibility attributes', () => {
  it('labels the text field, links the hint and turns off phone text corrections', () => {
    const { editor } = make({ describedBy: 'netlist-hint' });
    const content = editor.view.contentDOM;
    expect(content.getAttribute('role')).toBe('textbox');
    expect(content.getAttribute('aria-label')).toBe('Netlist');
    expect(content.getAttribute('aria-describedby')).toBe('netlist-hint');
    expect(content.getAttribute('aria-multiline')).toBe('true');
    expect(content.getAttribute('spellcheck')).toBe('false');
    expect(content.getAttribute('autocorrect')).toBe('off');
    expect(content.getAttribute('autocapitalize')).toBe('off');
    expect(editor.view.dom.classList.contains('ps-editor')).toBe(true);
  });

  it('has no aria-describedby when none is given', () => {
    const { editor } = make();
    expect(editor.view.contentDOM.hasAttribute('aria-describedby')).toBe(false);
  });

  it('shows line numbers (hidden from screen readers, like all CodeMirror gutters)', () => {
    const { editor } = make();
    const gutters = editor.view.dom.querySelector('.cm-gutters');
    expect(gutters?.getAttribute('aria-hidden')).toBe('true');
    expect(editor.view.dom.querySelector('.cm-lineNumbers')).not.toBeNull();
  });

  it('the visible hint says how to run and how to leave', () => {
    expect(EDITOR_HINT).toBe(EDITOR_STRINGS.hint);
    expect(EDITOR_HINT).toMatch(/Ctrl\+Enter runs/);
    expect(EDITOR_HINT).toMatch(/Tab leaves the editor/);
  });
});

describe('keyboard', () => {
  it('Ctrl+Enter runs and does not insert a line', () => {
    const onRun = vi.fn();
    const { editor } = make({ onRun });
    const event = key(editor, { key: 'Enter', code: 'Enter', keyCode: 13, ctrlKey: true });
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getDoc()).toBe(F3A);
  });

  it('Tab and Shift+Tab are left to the browser, so focus moves on', () => {
    const { editor } = make();
    for (const shiftKey of [false, true]) {
      const event = key(editor, { key: 'Tab', code: 'Tab', keyCode: 9, shiftKey });
      expect(event.defaultPrevented).toBe(false);
    }
    expect(editor.getDoc()).toBe(F3A);
  });

  it('Escape closes the trap pop-up that F8 opened (WCAG 1.4.13)', () => {
    const { editor } = make();
    editor.setTraps([megaTrap()], () => {});
    key(editor, { key: 'F8', code: 'F8', keyCode: 119 });
    expect(hasHoverTooltips(editor.view.state)).toBe(true);
    const event = key(editor, { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(hasHoverTooltips(editor.view.state)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('F8 also says the trap in words, for screen readers (the pop-up alone is silent)', () => {
    const { editor } = make();
    editor.setTraps([megaTrap()], () => {});
    key(editor, { key: 'F8', code: 'F8', keyCode: 119 });
    const said = editor.view.dom.querySelector('.cm-announced')?.textContent ?? '';
    expect(said).toBe('Warning, line 3: 1M means one milliohm. In SPICE, M is milli. Write 1meg for one megaohm.');
    key(editor, { key: 'F8', code: 'F8', keyCode: 119, shiftKey: true });
    expect(editor.view.dom.querySelector('.cm-announced')?.textContent).toContain('Warning, line 3:');
  });

  it('Escape closes a trap pop-up even when focus is outside the editor (WCAG 1.4.13)', () => {
    const { editor } = make();
    editor.setTraps([megaTrap()], () => {});
    key(editor, { key: 'F8', code: 'F8', keyCode: 119 });
    expect(hasHoverTooltips(editor.view.state)).toBe(true);
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(hasHoverTooltips(editor.view.state)).toBe(false);
  });

  it('a fix pressed in the pop-up brings focus back to the text, not to the page (WCAG 2.4.3)', () => {
    const { editor } = make();
    editor.setTraps([megaTrap()], (fix) => {
      editor.applyChanges(fix.changes);
      editor.setTraps([], () => {}); // the checks run again and the trap, with its pop-up, is gone
    });
    key(editor, { key: 'F8', code: 'F8', keyCode: 119 });
    const button = editor.view.dom.querySelector<HTMLButtonElement>('.cm-tooltip .cm-diagnosticAction');
    expect(button).not.toBeNull();
    button!.focus();
    button!.click();
    expect(editor.getDoc()).toContain('R1 n1 n2 1meg');
    expect(editor.view.hasFocus).toBe(true);
  });

  it('underlines at most MAX_TRAP_MARKS traps, errors first (thousands froze the page)', () => {
    const lines = Array.from({ length: MAX_TRAP_MARKS + 50 }, (_, i) => `R${i} a 0 1M`);
    const text = ['* many traps', ...lines].join('\n');
    const { editor } = make({ doc: text });
    // One trap per line, apart from each other; the last one is an error.
    const many: Trap[] = lines.map((l, i) => {
      const from = text.indexOf(`${l}\n`) >= 0 ? text.indexOf(`${l}\n`) : text.lastIndexOf(l);
      return { ...megaTrap(), line: i + 2, severity: i === lines.length - 1 ? 'error' : 'warning', span: { from, to: from + 2 }, fixes: [] };
    });
    editor.setTraps(many, () => {});
    expect(diagnostics(editor)).toHaveLength(MAX_TRAP_MARKS);
    expect(diagnostics(editor).some(({ d }) => d.severity === 'error')).toBe(true);
    const marked = trapsToMark(many);
    expect(marked).toHaveLength(MAX_TRAP_MARKS);
    expect(marked.map((t) => t.span.from)).toEqual(marked.map((t) => t.span.from).sort((a, b) => a - b));
    expect(trapsToMark(many.slice(0, 3))).toHaveLength(3);
  });

  it('Ctrl+/ turns a line into a comment with "*", the comment every SPICE reads', () => {
    const { editor } = make();
    editor.view.dispatch({ selection: EditorSelection.cursor(lineRange(F3A, 3).from) });
    key(editor, { key: '/', code: 'Slash', keyCode: 191, ctrlKey: true });
    expect(editor.getDoc().split('\n')[2]).toBe('* R1 n1 n2 1M');
  });

  it('F8 selects the next trap; Ctrl+Shift+M opens the trap list with plain-word labels', () => {
    const { editor } = make();
    editor.setTraps([megaTrap()], () => {});
    key(editor, { key: 'F8', code: 'F8', keyCode: 119 });
    const sel = editor.view.state.selection.main;
    expect(F3A.slice(sel.from, sel.to)).toBe('1M');

    key(editor, { key: 'M', code: 'KeyM', keyCode: 77, ctrlKey: true, shiftKey: true });
    const list = editor.view.dom.querySelector('.cm-panel-lint ul');
    expect(list).not.toBeNull();
    expect(list!.getAttribute('aria-label')).toBe('Traps in this netlist');
    expect(list!.textContent).toContain('Warning, line 3:');
  });
});

describe('text', () => {
  it('getDoc / setDoc, with onChange for every change', () => {
    const onChange = vi.fn();
    const { editor } = make({ onChange });
    expect(editor.getDoc()).toBe(F3A);
    editor.setDoc('* new\nR1 a 0 1k\n.op\n.end');
    expect(editor.getDoc()).toBe('* new\nR1 a 0 1k\n.op\n.end');
    expect(onChange).toHaveBeenLastCalledWith('* new\nR1 a 0 1k\n.op\n.end');
    editor.setDoc(editor.getDoc()); // the same text: nothing happens
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(editor.view.state.selection.main.head).toBe(0);
  });

  it('setDoc is one undo step', () => {
    const { editor } = make();
    editor.setDoc('* other\n.end');
    undo(editor.view);
    expect(editor.getDoc()).toBe(F3A);
  });

  it('applyChanges applies several changes (any order) in one step and ignores changes outside the text', () => {
    const onChange = vi.fn();
    const { editor } = make({ onChange });
    const at = AT_1M;
    const op = F3A.indexOf('.op');
    editor.applyChanges([
      { from: op, to: op + 3, insert: '.op ; operating point' },
      { from: at, to: at + 2, insert: '1meg' },
    ]);
    expect(editor.getDoc()).toContain('R1 n1 n2 1meg\n');
    expect(editor.getDoc()).toContain('.op ; operating point');
    expect(onChange).toHaveBeenCalledTimes(1);
    undo(editor.view);
    expect(editor.getDoc()).toBe(F3A);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    editor.applyChanges([{ from: 0, to: 10_000, insert: 'x' }]);
    expect(editor.getDoc()).toBe(F3A);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('traps as diagnostics', () => {
  it('each trap becomes a diagnostic: span, severity, title + why, and its fixes as actions', () => {
    const { editor } = make();
    const trap = megaTrap();
    editor.setTraps([trap, { ...trap, id: 'no-ground', severity: 'error', line: 2, span: { from: -1, to: -1 }, title: 'Another', why: 'Why.', fixes: [] }], () => {});
    expect(diagnosticCount(editor.view.state)).toBe(2);
    const all = diagnostics(editor);
    const mega = all.find((x) => x.d.severity === 'warning')!;
    expect(F3A.slice(mega.from, mega.to)).toBe('1M');
    expect(mega.d.message).toBe('1M means one milliohm. In SPICE, M is milli. Write 1meg for one megaohm.');
    expect(mega.d.actions?.map((a) => a.name)).toEqual(['Change 1M to 1meg']);
    // A span that does not fit the text falls back to the trap's line.
    const other = all.find((x) => x.d.severity === 'error')!;
    expect({ from: other.from, to: other.to }).toEqual(lineRange(F3A, 2));
  });

  it('the trap text says the severity and line in words', () => {
    const { editor } = make();
    editor.setTraps([megaTrap()], () => {});
    const { d } = firstDiagnostic(editor);
    const el = d.renderMessage!(editor.view) as HTMLElement;
    expect(el.querySelector('.ps-trap-severity-warning')?.textContent).toBe('Warning, line 3:');
    expect(el.querySelector('.ps-trap-title')?.textContent).toBe('1M means one milliohm.');
    expect(el.querySelector('.ps-trap-why')?.textContent).toBe('In SPICE, M is milli. Write 1meg for one megaohm.');
    // Shown only in the trap list (editor.css), where fixes are applied with a letter key.
    expect(el.querySelector('.ps-trap-keys')?.textContent).toBe('Press C: Change 1M to 1meg.');
  });

  it('in the trap list, the letter written under a trap applies its fix', () => {
    const onFix = vi.fn();
    const { editor } = make();
    const trap = megaTrap();
    trap.fixes.push({ label: 'Comment out the line', changes: [{ from: lineRange(F3A, 3).from, to: lineRange(F3A, 3).from, insert: '* ' }] });
    editor.setTraps([trap], onFix);
    key(editor, { key: 'M', code: 'KeyM', keyCode: 77, ctrlKey: true, shiftKey: true });
    const list = editor.view.dom.querySelector<HTMLElement>('.cm-panel-lint ul')!;
    expect(list.textContent).toContain('Press C: Change 1M to 1meg.');
    expect(list.textContent).toContain('Press O: Comment out the line.');
    // Select the first trap (as the arrow keys do), then press O.
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true, cancelable: true }));
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', keyCode: 79, bubbles: true, cancelable: true }));
    expect(onFix).toHaveBeenCalledWith(trap.fixes[1]);
  });

  it('an action calls onFix with the fix; the app applies it with applyChanges', () => {
    const onFix = vi.fn((fix: Fix) => editor.applyChanges(fix.changes));
    const { editor } = make();
    const trap = megaTrap();
    editor.setTraps([trap], onFix);
    const { d, from, to } = firstDiagnostic(editor);
    d.actions![0]!.apply(editor.view, from, to);
    expect(onFix).toHaveBeenCalledWith(trap.fixes[0]); // the same object when nothing changed since the check
    expect(editor.getDoc()).toContain('R1 n1 n2 1meg');
  });

  it('fix offsets follow edits made after the check; a fix whose text was edited is refused', () => {
    const onFix = vi.fn();
    const { editor } = make();
    editor.setTraps([megaTrap()], onFix);
    editor.view.dispatch({ changes: { from: 0, insert: '* note\n' } }); // 7 characters before the trap
    const { d, from, to } = firstDiagnostic(editor);
    d.actions![0]!.apply(editor.view, from, to);
    const mapped = onFix.mock.calls[0]![0] as Fix;
    expect(mapped.changes[0]).toEqual({ from: AT_1M + 7, to: AT_1M + 9, insert: '1meg' });

    // Now edit the "1M" itself: the fix no longer fits and is not applied.
    const at = editor.getDoc().indexOf('n2 1M') + 3;
    editor.view.dispatch({ changes: { from: at + 1, to: at + 2, insert: 'k' } });
    onFix.mockClear();
    for (const { d: diag, from: f, to: t } of diagnostics(editor)) diag.actions?.[0]?.apply(editor.view, f, t);
    expect(onFix).not.toHaveBeenCalled();
  });

  it('setTraps([]) clears them, and so does setDoc', () => {
    const { editor } = make();
    editor.setTraps([megaTrap()], () => {});
    editor.setTraps([], () => {});
    expect(diagnosticCount(editor.view.state)).toBe(0);
    editor.setTraps([megaTrap()], () => {});
    editor.setDoc('* other\n.end');
    expect(diagnosticCount(editor.view.state)).toBe(0);
  });

  it('marks the trap line in the gutter, with the severity in the class (the shape comes from CSS)', () => {
    const { editor } = make();
    editor.setTraps([megaTrap()], () => {});
    expect(editor.view.dom.querySelector('.cm-lint-marker-warning')).not.toBeNull();
    expect(editor.view.dom.querySelector('.cm-lintRange-warning')?.textContent).toBe('1M');
  });
});

describe('inline results', () => {
  it('appear at the end of their lines, hidden from screen readers, with the words as tooltip', () => {
    const { editor } = make();
    editor.setInlineNotes([
      { line: 2, text: '→ −3 A', speech: 'V1 delivers 3 amps' },
      { line: 3, text: 'n1 → n2: 6 V', speech: '6 volts across R1' },
      { line: 99, text: 'ignored', speech: '' },
    ]);
    const notes = [...editor.view.dom.querySelectorAll<HTMLElement>('.ps-inline-note')];
    expect(notes.map((n) => n.textContent)).toEqual(['→ −3 A', 'n1 → n2: 6 V']);
    for (const n of notes) expect(n.getAttribute('aria-hidden')).toBe('true');
    expect(notes[0]!.title).toBe('V1 delivers 3 amps');
    // the note sits after the line's text
    expect(notes[0]!.closest('.cm-line')?.textContent).toBe('V1 n1 0 6→ −3 A');
  });

  it('clearInlineNotes removes them, and any edit clears them (they belong to the run)', () => {
    const { editor } = make();
    editor.setInlineNotes([{ line: 2, text: '→ −3 A', speech: '' }]);
    editor.clearInlineNotes();
    expect(editor.view.dom.querySelectorAll('.ps-inline-note')).toHaveLength(0);
    editor.setInlineNotes([{ line: 2, text: '→ −3 A', speech: '' }]);
    editor.view.dispatch({ changes: { from: editor.getDoc().length, insert: '\n' } });
    expect(editor.view.dom.querySelectorAll('.ps-inline-note')).toHaveLength(0);
  });
});

describe('node marks', () => {
  it('underlines every node name, and colours the ones the app gives colours for', () => {
    const { editor } = make();
    const marks = (): HTMLElement[] => [...editor.view.dom.querySelectorAll<HTMLElement>('.ps-node')];
    expect(marks().map((m) => m.textContent)).toEqual(['n1', '0', 'n1', 'n2', 'n2', '0']);
    expect(editor.view.dom.querySelectorAll('.ps-ground')).toHaveLength(2);

    editor.setNodeColours(new Map([['n1', 'var(--ps-node-1, #E8590C)'], ['n2', '#1971C2']]));
    const coloured = [...editor.view.dom.querySelectorAll<HTMLElement>('.ps-node-coloured')];
    expect(coloured.map((m) => m.textContent)).toEqual(['n1', 'n1', 'n2', 'n2']);
    expect(coloured[0]!.style.getPropertyValue('--ps-node-colour').trim()).toBe('var(--ps-node-1, #E8590C)');
    expect(coloured[2]!.style.getPropertyValue('--ps-node-colour').trim()).toBe('#1971C2');
  });

  it('ignores colour values that are not plain colours', () => {
    const { editor } = make();
    editor.setNodeColours(new Map([['n1', 'red; background: url(x)']]));
    expect(editor.view.dom.querySelectorAll('.ps-node-coloured')).toHaveLength(0);
  });

  it('keeps colours of top-level nodes away from nodes inside a .subckt definition', () => {
    const { editor } = make({ doc: '* t\n.subckt amp n1 out\nR1 n1 out 1k\n.ends\nX1 n1 0 amp\n.end' });
    editor.setNodeColours(new Map([['n1', '#E8590C']]));
    const coloured = [...editor.view.dom.querySelectorAll<HTMLElement>('.ps-node-coloured')];
    expect(coloured).toHaveLength(1);
    expect(coloured[0]!.closest('.cm-line')?.textContent).toBe('X1 n1 0 amp');
  });
});

describe('cursor line and goToLine', () => {
  it('onCursorLine fires when the cursor moves to another line, not within a line', () => {
    const onCursorLine = vi.fn();
    const { editor } = make({ onCursorLine });
    const { from } = lineRange(F3A, 3);
    editor.view.dispatch({ selection: EditorSelection.cursor(from) });
    editor.view.dispatch({ selection: EditorSelection.cursor(from + 3) });
    expect(onCursorLine.mock.calls).toEqual([[3]]);
  });

  it('goToLine selects the line (or a span), scrolls to it and focuses the editor', () => {
    const onCursorLine = vi.fn();
    const { editor } = make({ onCursorLine });
    const focus = vi.spyOn(editor.view, 'focus');
    editor.goToLine(4);
    expect(editor.view.state.selection.main).toMatchObject({ ...lineRange(F3A, 4) });
    expect(onCursorLine).toHaveBeenLastCalledWith(4);
    const at = AT_1M;
    editor.goToLine(3, { from: at, to: at + 2 });
    const sel = editor.view.state.selection.main;
    expect(F3A.slice(sel.from, sel.to)).toBe('1M');
    editor.goToLine(1000); // clamped to the last line
    expect(editor.view.state.doc.lineAt(editor.view.state.selection.main.head).number).toBe(F3A.split('\n').length);
    expect(focus).toHaveBeenCalledTimes(3);
  });
});

describe('destroy', () => {
  it('removes the editor from the page', () => {
    const { editor, parent } = make();
    editor.destroy();
    editors = [];
    expect(parent.querySelector('.cm-editor')).toBeNull();
  });
});

describe('accessKeys (the letters of the trap list)', () => {
  it('takes the first letter not used by an earlier fix, like @codemirror/lint', async () => {
    const { accessKeys } = await import('../../src/editor/diagnostics.ts');
    expect(accessKeys(['Change 1M to 1meg', 'Comment out the line', '123'])).toEqual(['C', 'o', '']);
  });
});

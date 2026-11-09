/**
 * Traps (src/spice/types.ts) as CodeMirror lint diagnostics: underlined in the text, a marker in
 * the gutter, a pop-up on hover or F8, and the keyboard list (Ctrl+Shift+M). Each trap's fixes
 * become the diagnostic's action buttons.
 *
 * Severity is said in words ("Error, line 3:") and drawn with different shapes (wavy, dashed and
 * dotted underlines; octagon, triangle and circle markers, see editor.css), never by colour alone.
 */

import type { Action, Diagnostic } from '@codemirror/lint';
import { MapMode, type ChangeDesc, type Text } from '@codemirror/state';
import type { Fix, TextChange, Trap } from '../spice/types.ts';
import { EDITOR_STRINGS } from './strings.ts';

/** "Title. Why" without doubling the full stop. */
export function trapMessage(trap: Pick<Trap, 'title' | 'why'>): string {
  const title = trap.title.trim();
  const why = trap.why.trim();
  if (!why) return title;
  return /[.!?:]$/.test(title) ? `${title} ${why}` : `${title}. ${why}`;
}

/** The range a trap underlines: its span when it fits the text, otherwise its whole line. */
export function trapRange(trap: Pick<Trap, 'span' | 'line'>, doc: Text): { from: number; to: number } | null {
  const { from, to } = trap.span;
  if (Number.isInteger(from) && Number.isInteger(to) && from >= 0 && from <= to && to <= doc.length) return { from, to };
  if (Number.isInteger(trap.line) && trap.line >= 1 && trap.line <= doc.lines) {
    const line = doc.line(trap.line);
    return { from: line.from, to: line.to };
  }
  return null;
}

/** The pop-up and list text: severity and line in words, then the title (bold) and why. */
export function renderTrapMessage(trap: Trap, line: number): HTMLElement {
  const root = document.createElement('span');
  root.className = 'ps-trap';
  const heading = document.createElement('strong');
  heading.className = `ps-trap-severity ps-trap-severity-${trap.severity}`;
  heading.textContent = EDITOR_STRINGS.trapHeading(EDITOR_STRINGS.severity[trap.severity], line);
  const title = document.createElement('span');
  title.className = 'ps-trap-title';
  // End the title with a full stop, so a screen reader pauses before the explanation.
  title.textContent = /[.!?:]$/.test(trap.title.trim()) || !trap.why.trim() ? trap.title.trim() : `${trap.title.trim()}.`;
  root.append(heading, ' ', title);
  if (trap.why.trim()) {
    const why = document.createElement('span');
    why.className = 'ps-trap-why';
    why.textContent = trap.why.trim();
    root.append(' ', why);
  }
  // In the trap list (Ctrl+Shift+M) fixes are applied with a letter key; editor.css shows these
  // lines only there, and hides the buttons there (a button inside a list option breaks ARIA's
  // rules). The pop-up keeps the buttons.
  const keys = accessKeys(trap.fixes.map((f) => f.label));
  trap.fixes.forEach((fix, i) => {
    if (!keys[i]) return;
    const hint = document.createElement('span');
    hint.className = 'ps-trap-keys';
    hint.textContent = EDITOR_STRINGS.fixKey(keys[i]!.toUpperCase(), fix.label);
    root.append(' ', hint);
  });
  return root;
}

/**
 * The letter that applies each fix while CodeMirror's trap list has focus: the first letter of the
 * label not taken by an earlier fix (the same rule as assignKeys() in @codemirror/lint 6.9).
 * '' when no letter is free.
 */
export function accessKeys(labels: readonly string[]): string[] {
  const assigned: string[] = [];
  for (const label of labels) {
    const ch = [...label].find((c) => /[a-zA-Z]/.test(c) && !assigned.some((a) => a.toLowerCase() === c.toLowerCase()));
    assigned.push(ch ?? '');
  }
  return assigned;
}

/**
 * Convert traps to diagnostics. `onAction` is called with the fix a button stands for; the editor
 * maps its offsets through any edits made since the traps were set (see mapFix).
 */
export function trapsToDiagnostics(traps: readonly Trap[], doc: Text, onAction: (fix: Fix) => void): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const trap of traps) {
    const range = trapRange(trap, doc);
    if (!range) continue;
    const line = doc.lineAt(range.from).number;
    const actions: Action[] = trap.fixes.map((fix) => ({ name: fix.label, apply: () => onAction(fix) }));
    out.push({
      from: range.from,
      to: range.to,
      severity: trap.severity,
      message: trapMessage(trap),
      renderMessage: () => renderTrapMessage(trap, line),
      actions,
    });
  }
  return out;
}

/**
 * A fix's changes, moved through the edits made since the trap check (`since` maps the text the
 * traps were computed on to the current text). Returns the fix itself when nothing changed, and
 * null when an edit touched the text the fix would replace (the fix no longer fits).
 */
export function mapFix(fix: Fix, since: ChangeDesc): Fix | null {
  if (since.empty) return fix;
  const changes: TextChange[] = [];
  for (const c of fix.changes) {
    if (c.from < 0 || c.to < c.from || c.to > since.length) return null;
    if (since.touchesRange(c.from, c.to)) return null;
    const from = since.mapPos(c.from, 1, MapMode.TrackDel);
    const to = c.to === c.from ? from : since.mapPos(c.to, -1, MapMode.TrackDel);
    if (from === null || to === null) return null;
    changes.push({ from, to, insert: c.insert });
  }
  return { label: fix.label, changes };
}

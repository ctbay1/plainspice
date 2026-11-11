/**
 * Small line icons for the checkpoint page (stroked in currentColor, hidden from screen readers:
 * every button says what it does in words), and the parts toolbar's icons, drawn by
 * src/notebook/symbols.ts so a part looks the same in the toolbar and on the page.
 */
import type { ReactNode } from 'react';
import { toolIcon, type ToolKind } from '../../src/notebook/index.ts';

export type IconName =
  | 'close'
  | 'run'
  | 'search'
  | 'settings'
  | 'undo'
  | 'redo'
  | 'copy'
  | 'netlist'
  | 'checks'
  | 'explain'
  | 'chevron-right'
  | 'chevron-left'
  | 'chevron-down'
  | 'parts'
  | 'zoom-in'
  | 'zoom-out'
  | 'fit'
  | 'warning'
  | 'error'
  | 'note'
  | 'circuit';

const PATHS: Readonly<Record<IconName, string>> = {
  close: 'M5.5 5.5l9 9m0-9l-9 9',
  run: 'M6.5 4.5l9 5.5-9 5.5z',
  search: 'M8.6 3.5a5.1 5.1 0 1 1 0 10.2a5.1 5.1 0 1 1 0-10.2zM12.4 12.4L16.5 16.5',
  // A gear: the page's settings (a sun would suggest light and dark).
  settings:
    'M15.62 7.89L17.55 8.47L17.55 11.53L15.62 12.11L15.47 12.48L16.42 14.25L14.25 16.42L12.48 15.47L12.11 15.62L11.53 17.55L8.47 17.55L7.89 15.62L7.52 15.47L5.75 16.42L3.58 14.25L4.53 12.48L4.38 12.11L2.45 11.53L2.45 8.47L4.38 7.89L4.53 7.52L3.58 5.75L5.75 3.58L7.52 4.53L7.89 4.38L8.47 2.45L11.53 2.45L12.11 4.38L12.48 4.53L14.25 3.58L16.42 5.75L15.47 7.52Z M12.6 10a2.6 2.6 0 1 1-5.2 0a2.6 2.6 0 1 1 5.2 0Z',
  undo: 'M7.5 6.5L4 10l3.5 3.5M4.5 10H12a4 4 0 0 1 0 8h-1.5',
  redo: 'M12.5 6.5L16 10l-3.5 3.5M15.5 10H8a4 4 0 0 0 0 8h1.5',
  copy: 'M7.5 7.5h8v8h-8zM12.5 5V4.5a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1H5',
  netlist: 'M4 5.5h12M4 10h8M4 14.5h10',
  checks: 'M4.5 10.5l3.5 3.5 7.5-8',
  explain: 'M10 3.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13zM10 9v4.5M10 6.6v.1',
  'chevron-right': 'M8 5l5 5-5 5',
  'chevron-left': 'M12 5l-5 5 5 5',
  // The parts: a resistor's zigzag over a source's circle (the Parts sheet on a phone).
  parts: 'M2.5 6h3l1.2-2.4 2.2 4.8 2.2-4.8 2.2 4.8 1.2-2.4h3M10 11.2a3.4 3.4 0 1 1 0 6.8a3.4 3.4 0 1 1 0-6.8zM10 13v3.2M8.4 14.6h3.2',
  'chevron-down': 'M5 8l5 5 5-5',
  'zoom-in': 'M5 10h10M10 5v10',
  'zoom-out': 'M5 10h10',
  fit: 'M4 7.5V4h3.5M12.5 4H16v3.5M16 12.5V16h-3.5M7.5 16H4v-3.5',
  warning: 'M10 2.8l7.6 13.4H2.4zM10 8v3.8M10 13.9v.1',
  error: 'M6.5 2.5h7l4 4v7l-4 4h-7l-4-4v-7zM7.5 7.5l5 5m0-5l-5 5',
  note: 'M10 3.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13zM10 9v4.5M10 6.6v.1',
  circuit: 'M3 10h3l1.5-3 3 6 3-6 1.5 3h3',
};

export function Icon({ name, className }: { name: IconName; className?: string }): ReactNode {
  return (
    <svg className={className ? `ck-icon ${className}` : 'ck-icon'} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** A part's icon for the toolbar and the cards. */
export function ToolGlyph({ kind, className }: { kind: ToolKind; className?: string }): ReactNode {
  const icon = toolIcon(kind);
  return (
    <svg className={className ? `ck-glyph ${className}` : 'ck-glyph'} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      {icon.strokes.map((s, i) => (
        <path key={`s${i}`} d={s.d} fill="none" stroke="currentColor" strokeWidth={s.width ?? 1.75} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {icon.fills.map((d, i) => (
        <path key={`f${i}`} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

/** The PlainSpice mark: a resistor's zigzag and a tick. */
export function Mark(): ReactNode {
  return (
    <svg className="ck-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path className="ck-mark__zig" d="M4 36h8l4-10 6 20 6-20 6 20 4-10" />
      <path className="ck-mark__check" d="M38 36l7 9L60 18" />
    </svg>
  );
}

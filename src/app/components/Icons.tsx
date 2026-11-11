/**
 * Small inline icons. Every icon is decorative (aria-hidden): the words next to it, or the button's
 * name, carry the meaning, so colour and shape are never the only signal. Strokes use currentColor,
 * so the icons follow the text colour, high contrast and forced colours. The parts' icons are drawn
 * by src/notebook/symbols.ts (toolIcon), so a part looks the same in the toolbar, on the card and on
 * the page.
 */
import type { ReactNode } from 'react';
import { toolIcon, type ToolKind } from '../../notebook/index.ts';

interface IconProps {
  className?: string;
}

function Svg({ children, className, viewBox = '0 0 20 20' }: { children: ReactNode; className?: string | undefined; viewBox?: string }): ReactNode {
  return (
    <svg className={`icon ${className ?? ''}`} viewBox={viewBox} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/**
 * The PlainSpice mark: a resistor zigzag whose last stroke becomes a green check (public/favicon.svg
 * is the same drawing).
 */
export function Mark({ className }: IconProps): ReactNode {
  return (
    <svg className={`mark ${className ?? ''}`} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path className="mark__zigzag" d="M4 36h8l4-10 6 20 6-20 6 20 4-10" fill="none" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path className="mark__check" d="M38 36l7 9L60 18" fill="none" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export type LineIconName =
  | 'close'
  | 'run'
  | 'stop'
  | 'search'
  | 'settings'
  | 'undo'
  | 'redo'
  | 'copy'
  | 'netlist'
  | 'checks'
  | 'explain'
  | 'numbers'
  | 'plot'
  | 'output'
  | 'more'
  | 'share'
  | 'export'
  | 'help'
  | 'examples'
  | 'chevron-right'
  | 'chevron-left'
  | 'chevron-down'
  | 'parts'
  | 'zoom-in'
  | 'zoom-out'
  | 'fit';

const PATHS: Readonly<Record<LineIconName, string>> = {
  close: 'M5.5 5.5l9 9m0-9l-9 9',
  run: 'M6.5 4.5l9 5.5-9 5.5z',
  stop: 'M5.5 5.5h9v9h-9z',
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
  numbers: 'M3.5 4.5h13v11h-13zM3.5 8.5h13M3.5 12h13M8.5 4.5v11',
  plot: 'M3.5 3.5v13h13M5.5 13.5c2.5-6 4.5-8 6-8s2.5 3 4.5 3',
  output: 'M3.5 4.5h13v11h-13zM6 8l2.5 2L6 12M10 12.5h4',
  more: 'M5 10h.1M10 10h.1M15 10h.1',
  share: 'M8.5 11.5l3-3M7 9.5L5.6 10.9a2.5 2.5 0 0 0 3.5 3.5l1.4-1.4M13 10.5l1.4-1.4a2.5 2.5 0 0 0-3.5-3.5L9.5 7',
  export: 'M10 3.5v9M6.5 9l3.5 3.5L13.5 9M4 15.5h12',
  help: 'M10 3.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13zM8 8a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.8M10 13.6v.1',
  examples: 'M4.5 3.5h8l3 3v10h-11zM12.5 3.5v3h3M7 10h6M7 13h4',
  'chevron-right': 'M8 5l5 5-5 5',
  'chevron-left': 'M12 5l-5 5 5 5',
  'chevron-down': 'M5 8l5 5 5-5',
  // The parts: a resistor's zigzag over a source's circle (the Parts sheet on a phone).
  parts: 'M2.5 6h3l1.2-2.4 2.2 4.8 2.2-4.8 2.2 4.8 1.2-2.4h3M10 11.2a3.4 3.4 0 1 1 0 6.8a3.4 3.4 0 1 1 0-6.8zM10 13v3.2M8.4 14.6h3.2',
  'zoom-in': 'M5 10h10M10 5v10',
  'zoom-out': 'M5 10h10',
  fit: 'M4 7.5V4h3.5M12.5 4H16v3.5M16 12.5V16h-3.5M7.5 16H4v-3.5',
};

/** A line icon (stroked in currentColor). */
export function LineIcon({ name, className }: { name: LineIconName; className?: string }): ReactNode {
  return (
    <svg className={className ? `line-icon ${className}` : 'line-icon'} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** A part's icon for the toolbar, the Parts sheet and the card. */
export function ToolGlyph({ kind, className }: { kind: ToolKind; className?: string }): ReactNode {
  const icon = toolIcon(kind);
  return (
    <svg className={className ? `glyph ${className}` : 'glyph'} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      {icon.strokes.map((s, i) => (
        <path key={`s${i}`} d={s.d} fill="none" stroke="currentColor" strokeWidth={s.width ?? 1.75} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {icon.fills.map((d, i) => (
        <path key={`f${i}`} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

export function ChevronDown({ className }: IconProps): ReactNode {
  return (
    <Svg className={className}>
      <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Error: an octagon with a cross (shape differs from warning and note). */
export function ErrorIcon({ className }: IconProps): ReactNode {
  return (
    <Svg className={className}>
      <path d="M6.5 2h7L18 6.5v7L13.5 18h-7L2 13.5v-7z" fill="currentColor" />
      <path d="M7 7l6 6M13 7l-6 6" stroke="var(--icon-on, #fff)" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

/** Warning: a triangle with an exclamation mark. */
export function WarningIcon({ className }: IconProps): ReactNode {
  return (
    <Svg className={className}>
      <path d="M10 2l9 16H1z" fill="currentColor" />
      <path d="M10 8v4.5" stroke="var(--icon-on, #fff)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="10" cy="15.2" r="1.2" fill="var(--icon-on, #fff)" />
    </Svg>
  );
}

/** Note: a circle with an i. */
export function InfoIcon({ className }: IconProps): ReactNode {
  return (
    <Svg className={className}>
      <circle cx="10" cy="10" r="8.5" fill="currentColor" />
      <path d="M10 9v5" stroke="var(--icon-on, #fff)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="10" cy="6.2" r="1.2" fill="var(--icon-on, #fff)" />
    </Svg>
  );
}

/** Finished: a check in a circle. */
export function OkIcon({ className }: IconProps): ReactNode {
  return (
    <Svg className={className}>
      <circle cx="10" cy="10" r="8.5" fill="currentColor" />
      <path d="M6 10.5l2.7 2.7L14.2 7.3" fill="none" stroke="var(--icon-on, #fff)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function StopIcon({ className }: IconProps): ReactNode {
  return (
    <Svg className={className}>
      <rect x="5" y="5" width="10" height="10" rx="1" fill="currentColor" />
    </Svg>
  );
}

export function CloseIcon({ className }: IconProps): ReactNode {
  return (
    <Svg className={className}>
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

export const SEVERITY_ICON = {
  error: ErrorIcon,
  warning: WarningIcon,
  info: InfoIcon,
} as const;

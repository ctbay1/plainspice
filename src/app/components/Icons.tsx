/**
 * Small inline icons. Every icon is decorative (aria-hidden): the words next to it carry the
 * meaning, so colour and shape are never the only signal. Strokes use currentColor, so the icons
 * follow the text colour, high contrast and forced colours.
 */
import type { ReactNode } from 'react';

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

export function RunIcon({ className }: IconProps): ReactNode {
  return (
    <Svg className={className}>
      <path d="M6 4l10 6-10 6z" fill="currentColor" />
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

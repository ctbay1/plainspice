/**
 * Studio prototype: every icon, drawn here as inline SVG (24-unit grid, 1.6 strokes, currentColor).
 * Decorative: each one is aria-hidden; the button around it carries the accessible name.
 */
import type { Kind } from './geometry.ts';

const PATHS: Record<string, string> = {
  select: '<path d="M6 3.5 18.5 12l-5.6 1.3 3.3 6-2.3 1.2-3.3-6.1L6.5 18.5Z" stroke-linejoin="round"/>',
  wire: '<path d="M4 18.5h6.5V5.5H20" stroke-linecap="round" stroke-linejoin="round"/><circle cx="4" cy="18.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="20" cy="5.5" r="1.6" fill="currentColor" stroke="none"/>',
  play: '<path d="M8 5.6v12.8a.6.6 0 0 0 .9.5l10.2-6.4a.6.6 0 0 0 0-1L8.9 5.1a.6.6 0 0 0-.9.5Z" fill="currentColor" stroke="none"/>',
  share: '<path d="M12 4v11M7.5 8.5 12 4l4.5 4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 13v5.2c0 .9.7 1.6 1.6 1.6h10.8c.9 0 1.6-.7 1.6-1.6V13" stroke-linecap="round"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5l1.5 1.5M17 17l1.5 1.5M5.5 18.5 7 17M17 7l1.5-1.5" stroke-linecap="round"/>',
  moon: '<path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1Z" stroke-linejoin="round"/>',
  search: '<circle cx="11" cy="11" r="6.2"/><path d="m20 20-4.6-4.6" stroke-linecap="round"/>',
  netlist: '<path d="M4.5 6h3M4.5 10h3M4.5 14h3M4.5 18h3M10.5 6h9M10.5 10h6M10.5 14h9M10.5 18h5" stroke-linecap="round"/>',
  checks: '<path d="M12 3.2 19 6v5.4c0 4.3-2.9 7.9-7 9.4-4.1-1.5-7-5.1-7-9.4V6Z" stroke-linejoin="round"/><path d="m8.8 12.1 2.3 2.3 4.3-4.6" stroke-linecap="round" stroke-linejoin="round"/>',
  explain: '<path d="M4.5 5.5c2.6-1 5.2-.8 7.5.8 2.3-1.6 4.9-1.8 7.5-.8v12.7c-2.6-1-5.2-.8-7.5.8-2.3-1.6-4.9-1.8-7.5-.8Z" stroke-linejoin="round"/><path d="M12 6.3v12.5"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11" stroke-linecap="round"/>',
  chevronDown: '<path d="m7 10 5 5 5-5" stroke-linecap="round" stroke-linejoin="round"/>',
  chevronRight: '<path d="m10 7 5 5-5 5" stroke-linecap="round" stroke-linejoin="round"/>',
  undo: '<path d="M9 7 5 11l4 4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 11H14a5 5 0 0 1 0 10h-2.5" stroke-linecap="round"/>',
  redo: '<path d="m15 7 4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 11H10a5 5 0 0 0 0 10h2.5" stroke-linecap="round"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13" stroke-linecap="round"/>',
  minus: '<path d="M5.5 12h13" stroke-linecap="round"/>',
  fit: '<path d="M4.5 9V5.6c0-.6.5-1.1 1.1-1.1H9M15 4.5h3.4c.6 0 1.1.5 1.1 1.1V9M19.5 15v3.4c0 .6-.5 1.1-1.1 1.1H15M9 19.5H5.6c-.6 0-1.1-.5-1.1-1.1V15" stroke-linecap="round"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  dockBottom: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 13.5h17" /><path d="M6.5 16.5h5" stroke-linecap="round"/>',
  dockRight: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M14 4.5v15"/><path d="M16.5 8h1.5M16.5 11h1.5" stroke-linecap="round"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.2c0-.9-.7-1.7-1.7-1.7H6.2c-.9 0-1.7.8-1.7 1.7v7.6c0 1 .8 1.7 1.7 1.7h2.3"/>',
  warning: '<path d="M10.4 4.6 3.3 17.4c-.7 1.2.2 2.6 1.6 2.6h14.2c1.4 0 2.3-1.4 1.6-2.6L13.6 4.6c-.7-1.2-2.5-1.2-3.2 0Z" stroke-linejoin="round"/><path d="M12 9.5v4.2" stroke-linecap="round"/><circle cx="12" cy="16.9" r="1" fill="currentColor" stroke="none"/>',
  error: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.6v5.2" stroke-linecap="round"/><circle cx="12" cy="16" r="1" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5" stroke-linecap="round"/><circle cx="12" cy="7.9" r="1" fill="currentColor" stroke="none"/>',
  check: '<path d="m5.5 12.5 4.2 4.2 8.8-9.4" stroke-linecap="round" stroke-linejoin="round"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.4 12.3 2.5 2.5 4.9-5.3" stroke-linecap="round" stroke-linejoin="round"/>',
  rotate: '<path d="M19 12a7 7 0 1 1-2.1-5" stroke-linecap="round"/><path d="M17.5 3.8v3.7h-3.7" stroke-linecap="round" stroke-linejoin="round"/>',
  trash: '<path d="M5 7h14M10 4.5h4M7 7l.8 11.3c.1.9.8 1.7 1.8 1.7h4.8c1 0 1.7-.8 1.8-1.7L17 7" stroke-linecap="round" stroke-linejoin="round"/>',
  more: '<circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  bolt: '<path d="M13.2 3.5 6 13.2h5.3l-.8 7.3 7.5-9.9h-5.4Z" stroke-linejoin="round"/>',
  arrow: '<path d="M4.5 12h14M13.5 6.5 19 12l-5.5 5.5" stroke-linecap="round" stroke-linejoin="round"/>',
  keyboard: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M8 14h8" stroke-linecap="round" stroke-width="2"/>',
  parts: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
  live: '<path d="M2.5 12h3.2l2.1-5.5 3.4 11 3-8 1.9 2.5h5.4" stroke-linecap="round" stroke-linejoin="round"/>',
  link: '<path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1 1" stroke-linecap="round"/><path d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1-1" stroke-linecap="round"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" stroke-linecap="round"/><path d="M4.5 4.5v3.7h3.7" stroke-linecap="round" stroke-linejoin="round"/>',
  trap: '<path d="M12 3.5 21 19.5H3Z" stroke-linejoin="round"/><path d="M12 10v4" stroke-linecap="round"/><circle cx="12" cy="16.6" r=".9" fill="currentColor" stroke="none"/>',
  cursorClick: '<path d="M9 9.5 19.5 13l-4.4 1.6 3.3 3.3-1.6 1.6-3.3-3.3-1.6 4.4Z" stroke-linejoin="round"/><path d="M5.5 3.5v2.2M2.5 6.5h2.2M3.4 3.4 5 5M9.5 2.5v2" stroke-linecap="round"/>',
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M15 4.5v15"/>',
  edit: '<path d="M14.6 5.6 18.4 9.4M5 19l1-4.4L15.9 4.7a1.6 1.6 0 0 1 2.3 0l1.1 1.1a1.6 1.6 0 0 1 0 2.3L9.4 18Z" stroke-linejoin="round" stroke-linecap="round"/>',
};

/** Part symbols for the tool rail and the palette, drawn across (left to right). */
const PART_PATHS: Record<Kind, string> = {
  R: '<path d="M1.5 12h4l1.4-3.6 2.8 7.2 2.8-7.2 2.8 7.2 2.8-7.2L19.1 12h3.4" stroke-linejoin="round" stroke-linecap="round"/>',
  C: '<path d="M1.5 12h8.5M14 12h8.5M10 6.2v11.6M14 6.2v11.6" stroke-linecap="round"/>',
  L: '<path d="M1.5 14h3.2a2.6 2.6 0 0 1 5.2 0 2.6 2.6 0 0 1 5.2 0 2.6 2.6 0 0 1 5.2 0h2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  V: '<circle cx="12" cy="12" r="6.6"/><path d="M1.5 12h3.9M18.6 12h3.9M7.9 12h2.8M9.3 10.6v2.8M13.3 12h2.8" stroke-linecap="round"/>',
  I: '<circle cx="12" cy="12" r="6.6"/><path d="M1.5 12h3.9M18.6 12h3.9M8.4 12h5.6" stroke-linecap="round"/><path d="m13 9.6 3.2 2.4-3.2 2.4Z" fill="currentColor" stroke-linejoin="round"/>',
  E: '<path d="M12 4.8 19.2 12 12 19.2 4.8 12Z" stroke-linejoin="round"/><path d="M1.5 12h3.3M19.2 12h3.3M8.2 12h2.6M9.5 10.7v2.6M13.4 12h2.6" stroke-linecap="round"/>',
  F: '<path d="M12 4.8 19.2 12 12 19.2 4.8 12Z" stroke-linejoin="round"/><path d="M1.5 12h3.3M19.2 12h3.3M8.6 12h4.8" stroke-linecap="round"/><path d="m12.6 10 2.8 2-2.8 2Z" fill="currentColor" stroke-linejoin="round"/>',
  G: '<path d="M12 4.8 19.2 12 12 19.2 4.8 12Z" stroke-linejoin="round"/><path d="M1.5 12h3.3M19.2 12h3.3M8.6 12h4.8" stroke-linecap="round"/><path d="m12.6 10 2.8 2-2.8 2Z" fill="currentColor" stroke-linejoin="round"/>',
  H: '<path d="M12 4.8 19.2 12 12 19.2 4.8 12Z" stroke-linejoin="round"/><path d="M1.5 12h3.3M19.2 12h3.3M8.2 12h2.6M9.5 10.7v2.6M13.4 12h2.6" stroke-linecap="round"/>',
  GND: '<path d="M12 3.5v8M5.5 11.5h13M8.2 15h7.6M10.6 18.5h2.8" stroke-linecap="round"/>',
};

export function icon(name: string, size = 16, extraClass = ''): string {
  const body = PATHS[name] ?? '';
  return `<svg class="ico ${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false">${body}</svg>`;
}

export function partIcon(kind: Kind, size = 20, extraClass = ''): string {
  return `<svg class="ico ico--part ${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" focusable="false">${PART_PATHS[kind]}</svg>`;
}

/** The PlainSpice mark, redrawn for Studio: a resistor zigzag that ends in a check. */
export function logo(size = 24): string {
  return `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <defs><linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--logo-a)"/><stop offset="1" stop-color="var(--logo-b)"/></linearGradient></defs>
    <rect width="32" height="32" rx="8" fill="url(#logo-g)"/>
    <path d="M4.5 17.5h3l2-5 3 9 3-9 2 5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="m19.5 17.5 3 3.5 5.5-9" fill="none" stroke="#fff" stroke-opacity=".92" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

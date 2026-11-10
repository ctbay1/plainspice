/**
 * The interface icons of the Playground, drawn here (no icon font, no library): 24 × 24, round
 * caps, stroked with currentColor so they follow the text colour and the theme.
 */
const PATHS: Record<string, string> = {
  select: '<path d="M6 3.5l11.5 8.2-5.3 1 3.1 5.8-2.3 1.2-3.1-5.8-3.9 3.6z" stroke-linejoin="round"/>',
  wire: '<path d="M4 18h6V6h10"/><circle cx="4" cy="18" r="1.8" fill="currentColor" stroke="none"/><circle cx="20" cy="6" r="1.8" fill="currentColor" stroke="none"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V5.5A1.5 1.5 0 015.5 4H9M15 4h3.5A1.5 1.5 0 0120 5.5V9M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15M9 20H5.5A1.5 1.5 0 014 18.5V15"/><rect x="8.5" y="8.5" width="7" height="7" rx="1.5"/>',
  netlist: '<path d="M8 6h11M8 12h11M8 18h7"/><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="2.6"/>',
  checks: '<path d="M12 3.5l7 2.8v5.2c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6.3z"/><path d="M8.8 12.2l2.2 2.2 4.4-4.6"/>',
  explain: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 014.8.9c0 1.7-2.4 2.1-2.4 3.6"/><path d="M12 17.2h.01" stroke-width="2.6"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke-linejoin="round"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6A1.5 1.5 0 0014 4.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5"/>',
  rotate: '<path d="M19.5 12a7.5 7.5 0 11-2.2-5.3"/><path d="M19.8 4.5v4.2h-4.2"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7"/><path d="M10.5 10.5v6M13.5 10.5v6"/>',
  bolt: '<path d="M13 3L6 13.5h5.5L10.5 21 18 10h-5.5z" fill="currentColor" stroke-linejoin="round"/>',
  ok: '<circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.3l2.5 2.5 5-5.2"/>',
  warn: '<path d="M12 4l9 15.5H3z" stroke-linejoin="round"/><path d="M12 10v4.2"/><path d="M12 17.2h.01" stroke-width="2.6"/>',
  error: '<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.8h.01" stroke-width="2.6"/>',
  chevronDown: '<path d="M6.5 9.5l5.5 5.5 5.5-5.5"/>',
  chevronRight: '<path d="M9.5 6.5l5.5 5.5-5.5 5.5"/>',
  arrowRight: '<path d="M5 12h13M13 7l5 5-5 5"/>',
  keyboard: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 10h.01M10.5 10h.01M14 10h.01M17 10h.01M8 14.2h8" stroke-width="2"/>',
  wand: '<path d="M5 19L15.5 8.5"/><path d="M14 7l3 3"/><path d="M18.5 3.5v3M17 5h3M7 4v2M6 5h2M19.5 13v2M18.5 14h2"/>',
  hand: '<path d="M8 13V6.5a1.5 1.5 0 013 0V11m0-5.5V4.5a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V14a6 6 0 01-6 6h-.7a6 6 0 01-4.9-2.6L4.3 14a1.6 1.6 0 012.5-2L8 13.4"/>',
  sparkle: '<path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z" stroke-linejoin="round"/><path d="M18.5 15.5v4M16.5 17.5h4"/>',
  menu: '<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>',
  parts: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><path d="M17 13.5v7M13.5 17h7"/>',
  tick: '<path d="M5.5 12.5l4.2 4.2 8.8-9.2"/>',
  caret: '<path d="M8 10l4 4 4-4"/>',
  pointer: '<path d="M9 11V5.5a1.5 1.5 0 013 0V11m0-1.5a1.5 1.5 0 013 0V11m0-.5a1.5 1.5 0 013 0V15a5.5 5.5 0 01-5.5 5.5h-1a5.5 5.5 0 01-4.6-2.5l-2.2-3.4a1.5 1.5 0 012.4-1.8L9 14"/>',
};

export type IconName = keyof typeof PATHS;

export function icon(name: string, size = 20, extraClass = ''): string {
  const body = PATHS[name] ?? '';
  return `<svg class="icon ${extraClass}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** The PlainSpice mark, Playground edition: a resistor squiggle on a sunny tile. */
export function logo(size = 34): string {
  return `<svg class="logo" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true" focusable="false">
    <rect x="1.5" y="1.5" width="37" height="37" rx="11" fill="var(--sun-300)" stroke="var(--ink)" stroke-width="2.2"/>
    <path d="M6.5 22.5h5l2.6-7.5 4 13 4-13 4 13 2.6-7.5h4.8" fill="none" stroke="var(--ink)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

# 0010. Accessibility baseline: WCAG 2.2 AA from day one

- Status: accepted
- Date: 2026-11-09

## Decision

PlainSpice targets **WCAG 2.2 level AA** in every release, checked automatically (axe-core in
Playwright) and by hand. Concretely:

- **Keyboard:** everything works without a mouse; the tab order follows the page (Run comes
  before the editor; Tab leaves the editor); visible focus everywhere (2.4.7, 2.4.11 not
  obscured); shortcuts are listed and never single printable keys without a modifier (2.1.4);
  dragging always has a button alternative (2.5.7); targets at least 24 × 24 px (2.5.8), 44 px
  for main buttons.
- **Screen readers:** landmarks and headings; React Aria widgets (tabs, dialogs, menus,
  toggles) for correct roles and keyboard patterns; results in real tables with captions; a
  polite live region announces "Simulation finished …" and errors; the circuit and its results
  are also described in words (`src/spice/describe.ts`); numbers are spoken with units in words
  ("minus 6 volts"); decorative canvases and inline widgets are hidden from screen readers
  because the same information is in the tables.
- **Colour:** text contrast at least 4.5:1 and UI parts 3:1 in every theme (tested); node and
  plot colours from colour-blind-safe palettes (tested by simulation for protanopia,
  deuteranopia and tritanopia), and never the only signal: names, icons, dashes and markers too.
- **Modes:** high contrast (a toggle, and `prefers-contrast: more`), forced colours (Windows
  High Contrast keeps working), large text (125 % and 150 %, everything sized in rem; reflow at
  320 px without horizontal scrolling, 1.4.10), reduced motion (a toggle and
  `prefers-reduced-motion`: no animations or smooth scrolling). Settings are remembered on the
  device.
- **Language:** plain words a first-year student can follow; one word for one idea; `lang`
  attributes; strings in catalogs so a Turkish UI can follow.
- **Phone:** works at 320 px wide and with touch; no feature needs hover.

## Consequences

- Every pull request runs axe on the main states; a violation fails CI.
- Manual checks before each release: keyboard-only walk-through, NVDA + Firefox, VoiceOver +
  Safari (macOS and iOS), TalkBack + Chrome, 200 % zoom, Windows High Contrast. These need people
  and devices; they are in the plan.

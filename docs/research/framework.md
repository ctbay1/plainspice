# UI framework for the circuit simulator: recommendation

Research for the "UI framework" decision record. 9 Nov 2026. Everything here was measured in this session
unless a source URL is given. Sizes use kB = 1000 bytes. Raw data, apps and scripts:
`<scratch>/research/fw/` (see "How to reproduce").

## 1. The answer in plain words

**Recommendation: React 19 + React Aria Components** (react 19.3.1, react-aria-components 1.22.1).
**Runner-up: Svelte 5 + Bits UI** (svelte 5.57.3, bits-ui 2.20.6).

**Why React + React Aria**

- Accessibility is your first criterion, and React Aria has the most thorough accessible component kit we found in any framework:
  - Adobe documents testing with VoiceOver (Mac and iPhone), JAWS, NVDA and TalkBack.
  - Its spoken announcements come translated into 34 languages, Turkish included.
  - It covers every widget on our list.
  - It also has the parts a keyboard-driven schematic editor will need later: accessible drag and drop, keyboard moves, toolbars and trees.

  In our own automated checks, the other libraries' tabs were just as correct. The difference is depth and breadth, not the basics.
- It type-checks with TypeScript 7 today. Svelte's and Vue's checkers still need TypeScript 6.
- Testing Library began as a React library, and `@testing-library/react` is by far its most used package (92M weekly downloads).
- It has by far the biggest contributor pool. Since February 2026 React belongs to the React Foundation (Linux Foundation) rather than to Meta.
- It has the most public code and documentation, so Claude-run sessions are least likely to slip.

**What it costs (measured)**

- **Size.** The full widget set (tabs, dialog, menu, disclosure, toggle button, combobox, tooltip, toast) is 143 kB gzip with React + React Aria. That drops to 133 kB if we keep only English and Turkish strings. The other options need 53–75 kB.
- **Start-up on a slow phone** (6× CPU slowdown). On a first visit, React + React Aria does about 0.73 s of work before the UI is ready; the others take 0.22–0.36 s. On repeat visits (cached, as the PWA will be) it's about 0.25 s against 0.11–0.23 s. About 0.07 s of React Aria's cost is the browser's one-time `Intl` start-up, which our own number formatting will trigger anyway.
- **Schematic updates.** React redraws more than Svelte when a part is dragged: 0.3–1.5 ms per step with `memo`, against under 0.1 ms. At classroom scale that is still far inside one 16.7 ms frame.

**Why Svelte is the runner-up.** It is smaller (72 kB gzip for the same kit) and starts faster (0.31 s). It needs the least code, and its compiler warns about accessibility mistakes with no setup. It updates only what changed, which suits the schematic editor. It loses on four points:

- accessibility depth: Bits UI follows the ARIA patterns but publishes no screen-reader test matrix, and has no toast and no translated announcements;
- TypeScript 7: `svelte-check` needs TS ≤ 6;
- i18n libraries;
- contributor pool.

**What would flip it.** If a fast first start on cheap phones matters as much to you as accessibility depth, pick Svelte 5 + Bits UI. Weighting start-up equal to accessibility puts Svelte first (4.10 against 4.07). React and Svelte are within 0.1 of each other in the main scoring, which is a tie at this precision. The tie-break is the first criterion: React's weaknesses can be bounded (code-splitting, caching, memoised drawing), but React Aria's depth would have to be rebuilt by hand in Svelte.

**Not recommended**

- **Preact.** React Aria crashes on Preact 11 (measured), and its only full accessible kit (Zag) needed 161 lines of wiring for our widget set, against 81–106 lines for the other kits.
- **Lit / web components.** Shadow DOM breaks label and description references between components (measured). Only Chromium has the fix; Safari has given no signal. Web Awesome's tab list also can't be given a name.
- **SolidJS.** Solid 2 has been in release candidates since August with breaking changes, Kobalte 2 is still alpha, and Kobalte's tab panels have no name (measured).
- **Vanilla TypeScript.** We would hand-write every ARIA pattern (menus, combobox, toasts) and our own rendering layer.
- **Vue 3 + Reka UI.** A sound all-rounder, but it beats neither finalist where it matters, and `vue-tsc` also needs TS 6.

## 2. Scored table

Scores are 1 (poor) to 5 (best). Weights follow your priority order (7 for criterion 1 down to 1 for criterion 7). Each score is explained in section 5.

| Criterion | Weight | React 19 + React Aria | Svelte 5 + Bits UI | Vue 3 + Reka UI | Preact + signals (+ Zag) | SolidJS + Kobalte | Vanilla TS (+ Zag) | Lit + Web Awesome |
|---|---|---|---|---|---|---|---|---|
| 1 Accessibility (WCAG 2.2 AA) | 7 | **5** | 4 | 4 | 3 | 3 | 2 | 2 |
| 2 CodeMirror + schematic editor | 6 | 4 | **5** | 4 | 4 | 4 | 3 | 3 |
| 3 Size + start-up on phones | 5 | 2 | 4 | 4 | **5** | 4 | **5** | 4 |
| 4 TypeScript + testing | 4 | **5** | 3 | 3 | 4 | 4 | 4 | 3 |
| 5 i18n (Turkish later) | 3 | **5** | 4 | 4 | 3 | 3 | 3 | 2 |
| 6 Contributors + longevity | 2 | **5** | 4 | 4 | 3 | 2 | 2 | 3 |
| 7 Simplicity (solo + Claude) | 1 | 4 | **5** | 4 | 3 | 3 | 2 | 3 |
| **Weighted score** | | **4.21** | 4.11 | 3.86 | 3.71 | 3.46 | 3.14 | 2.82 |
| Equal weights (check) | | **4.29** | 4.14 | 3.86 | 3.57 | 3.29 | 3.00 | 2.86 |
| Start-up weighted like accessibility (7) | | 4.07 | **4.10** | 3.87 | 3.80 | 3.50 | 3.27 | 2.90 |

## 3. What we would regret with each

- **React 19 + React Aria (recommended)**
  - The heaviest start: about 0.4 s more main-thread work than the others on a slow phone's first visit (0.37–0.51 s), and 0.02–0.15 s more on repeat visits.
  - About 70–90 kB more JavaScript.
  - A large API (300 exports), and the toast is still `UNSTABLE_` (1.22.1).
  - Drawing discipline in the schematic editor: an external store plus `memo` or the React Compiler.
  - React 19's StrictMode mounts effects twice in development, so the CodeMirror mount must clean up properly.
  - The classic `eslint-plugin-jsx-a11y` is stale; use Oxlint's jsx-a11y rules instead.
- **Svelte 5 + Bits UI (runner-up)**
  - If screen-reader users report problems, there is no published test matrix behind Bits UI to lean on.
  - Bits UI has one main maintainer (one npm maintainer; huntabyte).
  - No toast (use svelte-sonner) and no accessible drag and drop or keyboard-move primitives for the schematic editor.
  - `svelte-check` keeps us on TypeScript 6 until it supports TS 7.
  - `svelte-i18n` hasn't released since Oct 2024 (use Paraglide or FormatJS).
  - A smaller contributor pool.
- **Vue 3 + Reka UI**
  - `vue-tsc` keeps us on TypeScript 6.
  - `vue-i18n` uses its own message syntax rather than ICU.
  - Vapor mode (fine-grained updates) is still a release candidate.
  - It is neither the most accessible nor the smallest option.
- **Preact + signals (+ Zag)**
  - React's ecosystem only works "mostly": React Aria crashes outright.
  - The Zag Preact adapter has about 5.5k weekly downloads.
  - Every widget needs hand wiring: 161 lines for the kit, against 81–106 for the others.
  - Two type errors in library typings under our strict flags.
- **SolidJS + Kobalte**
  - Migrating to Solid 2 (renamed packages and APIs) and Kobalte 2 soon after we start.
  - Kobalte's tab panels have no accessible name.
  - Kobalte went 11 months between releases (Jul 2025 to Jun 2026).
  - The smallest community of the frameworks.
- **Lit + Web Awesome**
  - Shadow DOM accessibility gaps in Safari and Firefox (label and description references across components are dropped).
  - The tab list can't be named; there is no combobox and no toggle button.
  - Testing Library needs an extra shadow-DOM layer.
  - Web Awesome is a styled design system, so our own high-contrast and large-text themes will be fighting its styles.
- **Vanilla TypeScript**
  - We become the maintainers of a framework and of an accessibility library.
  - Every new widget is new accessibility risk.
  - New contributors must learn our home-made patterns.

## 4. How to use React so the choice stays cheap to live with

1. **Keep a plain-TypeScript core with no React imports.** It holds the netlist parser, explanations, trap checks and their fixes, the circuit model, the undo/redo history (a list of commands or patches), the share-link codec, unit formatting and the Web Worker protocol. It is unit-tested in Node and shared later by the schematic editor; if we ever change framework, only the UI layer moves.
2. **Treat CodeMirror 6 as an island.** One component creates the `EditorView` on mount and destroys it on unmount. Text flows editor → model through CodeMirror transactions, and model → editor through `dispatch`. Never put the netlist text in React state on every keystroke.
3. **Draw the future schematic with SVG components fed from an external store with selectors** (`useSyncExternalStore`), plus `React.memo` or the React Compiler. `@vitejs/plugin-react` 6.3.0 supports the compiler through `@rolldown/plugin-babel` + `babel-plugin-react-compiler` 1.0.0, or an experimental Rust port (`node_modules/@vitejs/plugin-react/README.md`, lines 80–120). Use React Aria's `useMove`, `useKeyboard`, `FocusScope`, `useToolbar` and `useDrag`/`useDrop` for keyboard editing.
4. **Ship only English and Turkish React Aria strings** with `@react-aria/optimize-locales-plugin` 2.1.0. Measured: 142.6 → 133.4 kB gzip for the kit.
5. **Lazy-load widgets that aren't on the first screen** (dialogs, menus, combobox, toast).
6. **Wrap React Aria's `UNSTABLE_Toast` in our own component**, or use a plain `aria-live` region, so an API change touches one file.
7. **Lint with Oxlint's jsx-a11y rules and run axe-core in Playwright.** We tried a fork that supports ESLint 10; it catches the same problems.
8. **Have a native Turkish speaker review React Aria's `tr-TR` strings.** The combobox says "3 seçenekler kullanılabilir"; after a number Turkish keeps the noun singular ("3 seçenek") (`react-aria/dist/private/intl/combobox/tr-TR.mjs:6`).

## 5. Evidence

### 5.0 Method

- **Machine.** Cloud VM with 4 vCPU (Intel Xeon @ 2.10 GHz) and 16 GB RAM. Node 22.23.4.
- **Build.** Vite 8.3.7 (Rolldown 1.2.18, Oxc minifier, target `baseline-widely-available`). TypeScript 7.0.2, or 6.0.3 where a checker requires it.
- **Browser.** Chromium 153.0.8010.12 through Playwright 1.63.0.
- **Each candidate is a tiny Vite + TS app with three pages:**
  - **base:** heading, counter button, list of 20 items.
  - **tabs:** base plus an accessible tabs widget from that ecosystem's headless library.
  - **kit:** tabs plus dialog, menu, disclosure, toggle button, combobox, tooltip and toast. This is the realistic widget set; one widget alone hides how much a library's shared core costs.
- **Strict compiler flags everywhere:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, as in decision 0001.
- **Sizes.** Every built JS file compressed on its own, as served: gzip level 9 and brotli quality 11 (`_scripts/sizes.mjs`).
- **Start-up.** "Ready" is when the DOM is complete. An inline observer in every page (`_scripts/template/page.html`, lines 7–23) records when 20 list items, 3 tabs and a tab panel exist; shadow-DOM pages report it after `updateComplete`. Each figure is the median of 15 cold loads in a fresh browser context after a warm-up, at 1× and 6× CPU slowdown via CDP (`_scripts/runtime.cjs`). Lighthouse uses 4× on a fast desktop to stand in for a mid-range phone, so read 6× on this VM as "a slow phone". The ranking and ratios matter more than the absolute numbers.
- **Accessibility.** axe-core 4.14.0 (tags wcag2a/aa, wcag21a/aa, wcag22aa, best-practice), Chromium's real accessibility tree via CDP `Accessibility.getFullAXTree`, and a keyboard walk following the WAI-ARIA APG tabs pattern (`_scripts/a11y.cjs`).
- **Not done.** No test with a real screen reader; this machine has none. Screen-reader depth is judged from the libraries' published testing and from what ships in their packages.

### 5.1 Accessibility (criterion 1)

**Our automated checks (tabs pages, `_data/a11y.log`)**

| Ecosystem / library | Renders | APG keyboard (Tab in, ←/→, Home/End, wrap) | Tab list named | Panel named by its tab | Tab → panel | axe violations |
|---|---|---|---|---|---|---|
| React + React Aria 1.22.1 | yes | pass | yes ("Views") | yes | yes | 0 |
| React + Radix 1.8.1 | yes | pass | yes | yes | yes | 0 |
| React + Base UI 1.9.0 | yes | arrows move focus only: manual activation by default (allowed by APG) | yes | yes | yes | 0 |
| Svelte + Bits UI 2.20.6 | yes | pass | yes | yes | yes | 0 |
| Svelte + Ark UI 5.25.1 (EEcircuit's choice) | yes | pass | yes | yes | yes | 0 |
| Vue + Reka UI 2.11.0 | yes | pass | yes | yes | yes | 0 |
| Solid + Kobalte 0.13.14 | yes | pass | yes | **no**: panel has no `aria-labelledby` | yes | 0 |
| Preact + Zag 1.47.0 | yes | pass | yes | yes | yes | 0 |
| **Preact 11.2.0 (compat) + React Aria** | **no: blank page**, `TypeError: y.createElementNS is not a function` | n/a | n/a | n/a | n/a | n/a |
| Lit + Web Awesome 3.14.0 | yes | pass | **no**: `role="tablist"` sits inside the shadow root with no way to label it | yes | **no**: panel not focusable | 0 |
| Vanilla, hand-written APG (41 lines) | yes | pass | yes | yes | yes | 0 |
| Vanilla + Zag | yes | pass | yes | yes | yes | 0 |

On the kit pages axe reported only `target-size` (WCAG 2.2 2.5.8: our unstyled test buttons are smaller than 24 px) and, for React Aria, `heading-order`: its `Heading` defaults to h3 and our page went from h1 to h3. Both are styling issues, and axe catching them in CI is what we want.

**Why the Preact + React Aria route fails**

- React Aria builds each collection (Tabs, ListBox, Menu, ComboBox, Select, Table, Tree) by rendering into a stand-in `Document` that implements only `createElement(type)` (`react-aria/dist/types/src/collections/Document.d.ts:90`).
- Preact 11 always calls `doc.createElementNS(...)` on the parent's `ownerDocument` (`preact/src/diff/index.js:577`).
- The page dies before rendering anything.

**Shadow DOM pitfall, measured** (`_shadowdemo/index.html`, `_scripts/shadow-ax.cjs`, Chromium 153 accessibility tree):

| Case | Accessible name / description |
|---|---|
| A: light-DOM input, `aria-labelledby` pointing into a shadow root | name **""** (lost) |
| B: input inside a shadow root, `aria-describedby` pointing to a light-DOM hint | description **""** (lost) |
| C: like A, host uses `referenceTarget` (new Reference Target feature) | name "Resistance (C)" (works, Chromium only) |
| D: label and input in the same tree | name "Resistance (D)" |

Chrome's Intent to Ship for Reference Target lists milestone 151; Gecko has a prototype; WebKit has given no signal (search summary of https://groups.google.com/a/chromium.org/g/blink-dev/c/eBx3sXIfJnw; the page itself was not reachable from here). For iPhone VoiceOver users, references across shadow roots stay broken.

**Depth and coverage of each kit** (installed packages):

| Needed widget | React Aria | Bits UI | Reka UI | Kobalte | Zag (Preact/vanilla) | Web Awesome |
|---|---|---|---|---|---|---|
| tabs, dialog, menu, disclosure | yes | yes | yes | yes | yes | yes |
| toggle button | yes | yes (Toggle) | yes | yes | yes | no (switch only) |
| listbox / combobox | yes | yes | yes | yes | yes | select only, no combobox |
| tooltip | yes | yes | yes | yes | yes | yes |
| toast / live region | `UNSTABLE_Toast` | **none**, svelte-sonner 1.2.3 used | yes | yes | yes | yes |
| Turkish built-in strings | yes: 34 locales incl. tr-TR announcements | date placeholders only | date placeholders only | none found | none found | yes (`dist/translations/tr.js`) |
| Extras for a schematic editor | `useMove`, `useKeyboard`, `useDrag`/`useDrop` (keyboard and screen-reader drag and drop), `useToolbar`, `FocusScope`, `useLandmark`, Tree, GridList, NumberField | none | none | none | none | none |

React Aria exports listed with `node -e "require('react-aria')"` (react-aria 3.53.1, 160 exports) and `react-aria-components` (300 exports). Turkish files: `react-aria-components/dist/private/intl/tr-TR.mjs` and `react-aria/dist/private/intl/combobox/tr-TR.mjs`.

**Published testing**

- React Aria: Adobe says components are tested with VoiceOver on macOS (Safari, Chrome), JAWS and NVDA on Windows (Firefox, Chrome), VoiceOver on iOS and TalkBack on Android. Sources: https://react-spectrum.adobe.com/react-aria/accessibility.html and https://react-aria.adobe.com/quality (seen through search summaries).
- Bits UI's docs say it "strives to follow W3C ARIA Authoring Practices" (https://bits-ui.com/docs).
- No screen-reader test matrix was found for Bits UI or Reka UI.

**Accessibility linting.** Same seeded file in every syntax with six defects: a clickable `div`, an `img` without `alt`, an unlabelled `input`, an `a` without `href`, `tabindex="3"` and `role="buton"`. Files are in `_scripts/lint-samples/`.

| Tool | Setup | Defects caught (of 6) |
|---|---|---|
| Svelte 5.57.3 compiler | **none (built in)** | 5: missed the unlabelled input |
| eslint-plugin-vuejs-accessibility 2.6.3 (ESLint 10.14) | flat/recommended | 5: missed the missing href |
| eslint-plugin-jsx-a11y-x 0.2.0 (fork, ESLint 10) | recommended | 5 |
| Oxlint 1.93.0 (built-in jsx-a11y rules) | rules listed | 5 |
| eslint-plugin-jsx-a11y 6.10.2 (the classic) | n/a | not run: last release 2024-10-26, peer `eslint ^3 … ^9`, so no ESLint 10 |
| eslint-plugin-lit-a11y 5.1.3 | **its `recommended` config is broken**: it names kebab-case rules while the plugin exports camelCase ones | 5, after enabling the rules by hand |

### 5.2 CodeMirror 6 and the future schematic editor (criterion 2)

- **CodeMirror fits all options.** It is an imperative `EditorView` mounted into a DOM node:
  - React: `useRef` + `useEffect`; `@uiw/react-codemirror` has 7.04M weekly downloads.
  - Svelte: `{@attach}` attachments (`svelte/src/attachments/index.js`); `svelte-codemirror-editor` has 53k weekly.
  - Vue: `ref` + `onMounted`; `vue-codemirror` hasn't released since 2022.
  - Solid: `ref`; `solid-codemirror` has 21k weekly.
  - Lit: CodeMirror's `root` option for shadow roots.
  - Wrappers are optional; a 30-line component of our own is safer.
  - Measured: CodeMirror's `basicSetup` alone is 384 kB minified, 122 kB gzip, 105 kB brotli. Ready takes 60 ms at 1× and 251 ms at 6× (185 ms of script). That is about as much as React itself, and it is carried by every option.
- **Fine-grained updates, measured** (`_scripts/drag.cjs`, `_data/drag.json`). N parts in an SVG; one part is moved 200 times with a synchronous flush. The DOM change is identical in all three, so only the framework's JavaScript is compared:

| ms per move, 6× (1×) | 50 parts | 200 parts | 1000 parts |
|---|---|---|---|
| Vanilla (`setAttribute`) | 0.006 (0.001) | 0.002 (0.001) | 0.006 (0.001) |
| Svelte 5 (`$state`) | 0.053 (0.011) | 0.058 (0.014) | 0.078 (0.014) |
| React 19 with `memo` | 0.313 (0.058) | 0.53 (0.128) | 1.473 (0.263) |
| React 19 naive (whole list re-renders) | 0.619 (0.115) | 1.519 (0.287) | 7.531 (1.105) |

  Fine-grained Svelte stays flat while React grows with the part count. Beginner circuits have fewer than 50 parts, where even naive React uses about 4 % of a 16.7 ms frame. At 1000 parts naive React would need `memo` or selectors.
- **Independent data** (js-framework-benchmark, repo commit fa510a7, 2 Nov 2026; `_data/jsfb.json`). Means in ms; size in kB.

| | create 1k rows | update every 10th | swap rows | create 10k | memory after 1k (MB) | size (kB, compressed) |
|---|---|---|---|---|---|---|
| vanilla | 19.9 | 9.4 | 11.0 | 205.9 | 1.86 | 2.5 |
| Solid 1.9.3 | 21.4 | 10.6 | 12.6 | 225.9 | 2.68 | 4.5 |
| Svelte 5.42.1 | 21.9 | 11.2 | 13.1 | 228.8 | 2.86 | 9.7 |
| Vue 3.5.39 | 23.9 | 12.6 | 13.0 | 244.4 | 3.91 | 23.3 |
| Vue Vapor 3.6.0-rc.5 | 21.3 | 10.6 | 12.7 | 224.4 | 3.10 | 18.7 |
| Preact 11 + signals | 26.8 | 10.7 | 14.9 | 287.5 | 4.88 | 8.3 |
| Lit 3.2.0 | 23.2 | 11.9 | 15.8 | 240.5 | 2.80 | 7.3 |
| React 19.2 hooks | 24.3 | 14.7 | **86.9** | **344.7** | 4.42 | **51.4** |

- **Keyboard-driven editing and undo/redo.** Undo/redo belongs in the plain-TS core, whatever the framework. For keyboard editing only React Aria ships ready primitives (table in 5.1).
- **Scores.** Svelte 5: fine-grained, plain SVG templates, attachments. React, Vue, Solid and Preact 4: React for its editing primitives in spite of coarser updates, Solid marked down for Solid 2 churn. Lit and vanilla 3: shadow DOM complicates focus and pointer handling across components, and vanilla means everything by hand.

### 5.3 Bundle size and start-up (criterion 3)

**JavaScript per page** (`_data/sizes.json`): minified / gzip / brotli in kB. CSS shown separately.

| Candidate | base (framework only) | tabs | kit (full widget set) |
|---|---|---|---|
| Vanilla TS | 1.3 / 0.7 / 0.6 | 2.2 / 1.1 / 1.0 (hand-written); 33.3 / 11.9 / 10.8 (Zag) | n/a |
| SolidJS 1.9.18 + Kobalte | 12.5 / 5.1 / 4.6 | 54.9 / 18.5 / 16.8 | 173.0 / 53.1 / 45.9 |
| Lit 3.3.3 + Web Awesome | 15.7 / 6.1 / 5.5 | 151.7 / 37.2 / 31.8 (+ CSS 6.8 gz) | 299.4 / 74.0 / 60.6 (+ CSS 6.8 gz) |
| Preact 11.2.0 + signals + Zag | 21.7 / 8.6 / 7.9 | 50.2 / 18.8 / 17.1 | 229.8 / 69.7 / 60.2 |
| Preact compat + React Aria | (same base) | 131.2 / 42.2 / 37.7, **crashes** | n/a |
| Svelte 5.57.3 + Bits UI | 32.0 / 12.6 / 11.4 | 67.2 / 24.3 / 22.0 (Ark UI: 85.1 / 30.5 / 27.7) | 250.1 / 71.9 / 61.8 (+ CSS 3.0 gz) |
| Vue 3.5.45 + Reka UI | 64.0 / 24.9 / 22.7 | 84.2 / 31.5 / 28.7 | 230.1 / 71.4 / 62.5 |
| React 19.3.1 + React Aria | 219.8 / 67.9 / 58.4 | 319.1 / 97.1 / 83.8 (Radix: 76.6 gz; Base UI: 77.7 gz) | 477.0 / 142.6 / 119.0; **with en+tr strings only: 443.8 / 133.4 / 113.0** |

**Start-up** (`_data/runtime.json`): median of 15 cold loads; "ready" in ms, script time in parentheses.

| Candidate | base 1× | base 6× | tabs 6× | kit 1× | **kit 6×** | kit first paint 6× | kit 6×, repeat visits 2–4 (cached) |
|---|---|---|---|---|---|---|---|
| Vanilla TS | 21 | 65 (9) | 68 (11); Zag 96 | n/a | n/a | n/a | n/a |
| Preact + Zag | 18 | 94 (30) | 109 (59) | 45 | **219** (135) | 240 | 125 / 115 / 105 |
| Svelte + Bits UI | 19 | 100 (42) | 158 (99); Ark 196 | 64 | **307** (249) | 356 | 128 / 152 / 140 |
| SolidJS + Kobalte | 19 | 79 (19) | 242 (144) | 90 | **338** (250) | 352 | 139 / 117 / 129 |
| Lit + Web Awesome | 18 | 82 (11) | 159 (40) | 63 | **349** (111) | 376 | 222 / 233 / 229 |
| Vue + Reka UI | 27 | 104 (43) | 206 (123) | 68 | **355** (244) | 404 | 159 / 194 / 160 |
| React + React Aria | 45 | 229 (166) | 552 (379); Radix 289; Base UI 329 | 135 | **725** (568) | 644 | 302 / 257 / 250 |

Repeat visits are from `_scripts/repeat.cjs` (same browser context, HTTP cache and V8 code cache allowed; first visits in that run were 232–676 ms). The JS heap after the kit loads is 4.4 MB for React and 2.8–3.4 MB for the others.

**Where React Aria's start-up goes** (`_scripts/profile.cjs` on an unminified build at 1×, mean of 8 loads, `react-rac/prof-kit`):

- react-aria 30.1 ms, react-dom 29.5 ms, parse/compile ("program") 29.5 ms, react-aria-components 6.1 ms, react-stately 2.4 ms, `@internationalized/string` 2.0 ms.
- 12.7 ms of the react-aria share is one function: default-locale detection, which runs at module load (`react-aria/dist/private/i18n/useDefaultLocale.mjs:24,35`) and calls `Intl.DateTimeFormat.supportedLocalesOf`.
- That is the browser's one-time `Intl`/ICU start-up. In a blank page the first `Intl` call of any kind costs 10.8 ms at 1× and 70.9 ms at 6×; the next ones cost 1–9 ms (`_scripts/intl-cost.cjs`). Our app pays this as soon as it formats a number with `Intl`.

**Context for the whole app**

- The ngspice wasm (`research/engine-data/spice.wasm`) is 6.13 MB raw, 1.97 MB gzip and 1.27 MB brotli. It compiles in the worker, off the main thread.
- CodeMirror's basicSetup is about 122 kB gzip.
- So React + React Aria adds roughly 5 % to the first visit's bytes. Its real cost is main-thread start-up on slow phones.

**Score basis.** React + React Aria is twice the bytes and about twice the start-up of every other kit: 2. Preact + Zag is the fastest kit, and vanilla is smallest if we could hand-write the widgets safely: 5. The rest: 4.

### 5.4 TypeScript and testing (criterion 4)

- **TypeScript 7.0.2** (the native compiler) type-checks the React, Preact, Solid, Lit and vanilla apps with all strict flags (`npm run typecheck`, no errors).
- **Svelte and Vue can't use TS 7 yet:**
  - `svelte-check` 4.7.8 has peer `typescript: ^5.0.0 || ^6.0.0`, and `svelte2tsx` has `^4.9.4 || ^5 || ^6`.
  - `vue-tsc` 3.3.14 depends on `@volar/typescript` 2.4.31, whose peer is `typescript: <7` (`npm view`).
  - Both passed with TypeScript 6.0.3. This is the "pin the newest TypeScript it supports" case foreseen in decision 0001.
- **Friction under `exactOptionalPropertyTypes`:**
  - Reka's `ComboboxRoot` rejects an `undefined` model value (one error, fixed in our code).
  - Zag's Preact typings produced two errors inside library types (the Vite builds still pass).
  - React Aria, Bits UI, Kobalte and Web Awesome: none.
- **Lit pitfall.** A class-field initialiser shadows Lit's reactive accessor, so state must be `declare`d and set in the constructor (`lit-webawesome/src/main.ts`).
- **Testing libraries** (weekly downloads; latest release):

| Package | Weekly | Latest |
|---|---|---|
| `@testing-library/react` | 92.38M | 16.3.3, 2026-08-27 |
| `@testing-library/svelte` | 1.36M | 5.4.2, 2026-06-23 |
| `@testing-library/vue` | 1.14M | 8.1.0, 2024-05-18 |
| `@solidjs/testing-library` | 544k | 0.8.10, 2024-09-25 |
| `@testing-library/preact` | 533k | 3.2.6, 2026-10-22 |
| `shadow-dom-testing-library` (needed for Lit) | 181k | 1.14.2 |
| `vitest-browser-react` | 2.67M | 2.3.0 |
| `vitest-browser-svelte` | 364k | 3.1.0 |
| `vitest-browser-vue` | 317k | 3.1.0 |

  Playwright (1.65.0) and `@axe-core/playwright` (4.14.0) work the same everywhere, and Playwright pierces shadow DOM.

### 5.5 i18n for a Turkish UI (criterion 5)

**Framework-neutral facts** (Node 22.23.4, ICU 78.3, CLDR 48):

- `new Intl.NumberFormat('tr-TR').format(1234.5)` gives "1.234,5".
- Turkish plural categories are `["one","other"]`.
- `'i'.toUpperCase()` gives "I", but Turkish needs "İ", so use `toLocaleUpperCase('tr-TR')`, or CSS with `lang="tr"`.
- `Intl.NumberFormat` **rejects** the units volt, ampere, ohm and watt, and engineering notation gives "3,5E-3", not "3,5 m". The SI-prefix formatter ("3,5 mA") is our own code whatever the framework.

**Message libraries (ICU plurals and selects)**

| Package | Weekly | Notes |
|---|---|---|
| `intl-messageformat` 12.1.5 | 30.85M | framework-neutral |
| `@lingui/core` 6.12.0 | 2.57M | |
| `i18next` 27.0.1 | 34.67M | ICU through `i18next-icu` |
| `@inlang/paraglide-js` 3.2.1 | 1.43M | compile-time, framework-neutral |
| `react-intl` 12.1.7 | 4.49M | React |
| `@lingui/react` | 1.90M | React |
| `react-i18next` | 25.75M | React |
| `vue-i18n` 11.4.18 | 4.91M | own syntax, plurals with `\|` |
| `svelte-i18n` 4.0.1 | 177k | last release 2024-10-21 |
| `@solid-primitives/i18n` 2.2.1 | 269k | no ICU |
| `@lit/localize` 0.12.2 | 171k | last release 2024-08-05; no file in the package mentions plurals |

**React Aria's extra:** built-in Turkish strings and announcements, `I18nProvider`, and `useNumberFormatter`/`useCollator`. Bits UI and Reka UI ship no announcement strings to translate.

**Scores.** React 5. Vue 4 and Svelte 4 (mature or neutral options exist). Preact, Solid and vanilla 3: neutral libraries only. Lit 2: its own library has no plurals.

### 5.6 Contributor pool and longevity (criterion 6)

Weekly downloads come from `registry.npmjs.org/-/v1/search` because `api.npmjs.org` is blocked here. Downloads include CI, and Preact's figure is inflated by packages that depend on it. Versions, dates and release counts come from the registry packuments (`_data/npm-data.json`); GitHub figures from `gh api search/repositories` (`_data/gh-repos.json`).

| Framework | Latest | Weekly | Stable releases, last 12 months | GitHub stars / open issues | Backing |
|---|---|---|---|---|---|
| react / react-dom | 19.3.1 (2026-10-14) | 252.58M | 29 | 252,445 / 1,512 | React Foundation (Linux Foundation) since 24 Feb 2026; Platinum members incl. Amazon, Meta, Microsoft, Vercel; repo now `github.com/react/react` (npm `repository` field; `git ls-remote` of facebook/react returns the same HEAD) |
| vue | 3.5.45 (2026-11-05) | 25.01M | 21 | 54,879 / 966 | independent core team plus sponsors; 3.6 (Vapor) at rc.14 |
| svelte | 5.57.3 (2026-10-26) | 9.47M | 91 | 88,678 / 1,294 | Vercel employs core maintainers; Open Collective funds others |
| preact | 11.2.0 (2026-11-06) | 57.07M | 22 | 38,993 / 38 | small core team |
| solid-js | 1.9.18 (2026-10-29) | 11.14M | 8 | 36,354 / 34 | small team; 2.0.0-rc.21 is the `next` tag (21 RCs since 2026-08-12) |
| lit | 3.3.3 (2026-05-14) | 9.92M | 2 | 21,893 / 742 | Google; mature and slow-moving |

| Headless library | Latest | Weekly | npm maintainers | GitHub stars / open issues |
|---|---|---|---|---|
| react-aria-components | 1.22.1 (Apache-2.0) | 9.05M | Adobe | 16,020 / 678 (adobe/react-spectrum) |
| bits-ui | 2.20.6 | 1.71M | 1 | 3,655 / 35 |
| reka-ui | 2.11.0 | 3.06M | 1 | 6,942 / 257 |
| @kobalte/core | 0.13.14 | 5.55M | 2 | 1,887 / 114 |
| @awesome.me/webawesome | 3.14.0 | 210k | Font Awesome (company) | 1,389 / 85 |
| @zag-js/preact | 1.47.0 | 5.5k | Chakra team | 5,251 / 21 (zag) |

Other ecosystem facts:

- Kobalte 0.13.11 was released 2025-07-26 and 0.13.12 on 2026-06-30. Its 2.0 alphas began 2026-08-13.
- `@shoelace-style/shoelace` has had no release since 2025-03-11; Web Awesome replaces it.
- Sources: https://react.dev/blog/2026/02/24/the-react-foundation and https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-react-foundation (through search; react.dev was not reachable from here); https://svelte.dev/blog/accelerating-sveltes-development and https://opencollective.com/svelte; https://github.com/solidjs/solid/releases; https://newreleases.io/project/github/vuejs/core/release/v3.6.0-rc.1.

### 5.7 Simplicity for a solo maintainer and Claude-run sessions (criterion 7)

- **Non-blank lines for the same kit:**

| Framework | Lines |
|---|---|
| Lit | 74 |
| Svelte | 81 |
| Vue | 94 |
| React | 99 |
| Solid | 106 |
| Preact + Zag | 161 |

  The tabs page alone: vanilla 21 lines plus 41 for hand-written tabs. Svelte 25, Vue 25, Solid 29, React 35, Lit 41, Preact + Zag 49.
- **Svelte:** the least ceremony, and compiler errors catch mistakes early. There is an official Svelte MCP server and `llms.txt` docs for AI assistants (https://svelte.dev/docs/ai/mcp). `@sveltejs/mcp` 0.1.30 has 111k weekly downloads.
- **React:** the framework Claude knows best, and every problem has a known answer. The pitfalls are effects (cleanup, StrictMode double mounts) and memoisation; the React Compiler 1.0 (7 Oct 2025) removes most of the latter.
- **Vue:** two styles (Options and Composition API) can confuse contributors.
- **Solid:** JSX that looks like React but behaves differently (no destructuring of props; components run once), plus the Solid 2 renames.
- **Lit:** shadow DOM and the class-field trap.
- **Vanilla:** simple on day one, but by day 100 we have written our own framework.

### 5.8 EEcircuit

EEcircuit (MIT) uses Svelte 5.57 with Ark UI (`@ark-ui/svelte` ^5.24.1 for dialog, menu, popover, tabs and tooltip) and Monaco (`src/danchitnis_EEcircuit/package.json`; its sources import from `@ark-ui/svelte/*`). Its schematic editor is a local file dependency (`"eecircuit-schematic": "file:../EEcircuit-schematic"`). That package is not on npm (404), and `github.com/danchitnis/EEcircuit-schematic` and `github.com/eelab-dev/EEcircuit-schematic` are not publicly cloneable. Choosing Svelte would therefore not give us a reusable schematic editor. Ark UI for Svelte has about 22k weekly downloads, against 1.71M for Bits UI.

## 6. How to reproduce

All paths below are under `<scratch>/research/fw/`.

- **Apps:** `react-rac/`, `preact-zag/`, `preact-compat-rac/`, `svelte-bits/`, `solid-kobalte/`, `vue-reka/`, `lit-webawesome/`, `vanilla/`, `vanilla-zag/`. Each has `index.html` (tabs), `base.html` and `kit.html` where relevant. Extra pages: `react-rac/radix.html`, `react-rac/baseui.html`, `svelte-bits/ark.html`, `vanilla/cm.html` (CodeMirror), and `*/drag.html` (schematic stress test).
- **Build:** `npm install --ignore-scripts && PAGE=<page> npx vite build`. The output goes to `dist-<page>/`. For the kit with only en+tr strings: `LOCALES=en-US,tr-TR PAGE=kit npx vite build`. Type-check with `npm run typecheck`.
- **Measure:**
  - `node _scripts/sizes.mjs . _data/sizes.json`
  - `node _scripts/runtime.cjs $PWD $PWD/_data/runtime.json 15`
  - `node _scripts/a11y.cjs $PWD $PWD/_downloads/tools/node_modules/axe-core/axe.min.js $PWD/_data/a11y.json`
  - `node _scripts/drag.cjs $PWD $PWD/_data/drag.json`
  - `node _scripts/repeat.cjs $PWD $PWD/_data/repeat.json <app/page,...>`
  - `node _scripts/profile.cjs react-rac/prof-kit kit.html 8 1`
  - `node _scripts/intl-cost.cjs`
  - `node _scripts/shadow-ax.cjs $PWD/_shadowdemo/index.html`
  - `python3 -I _scripts/jsfb.py _downloads/jsfb/webdriver-ts-results/src/results.ts _data/jsfb.json`
  - Registry data: `node _scripts/npm-data.mjs _data/npm-data.json`, then `_scripts/fill-downloads.mjs`.
- **Lint demos:** samples and configs are in `_scripts/lint-samples/`, and the tools are installed in `_downloads/lint/`.

## 7. Limits

- No real screen readers were available. Screen-reader depth comes from the libraries' published testing and from what their packages ship, not from our own listening.
- CPU slowdown on a cloud VM only approximates a phone; GPU, memory and thermal limits are not modelled.
- Weekly downloads come from the registry's search endpoint, because api.npmjs.org and npmjs.com were blocked. react.dev and groups.google.com could not be fetched; those claims rest on search-result summaries, with links given.
- The scores in section 2 are judgements grounded in the measurements above. React and Svelte differ by less than the precision of this kind of scoring, which is why the tie-break and the flip condition are spelled out in section 1.

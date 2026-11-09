# Plotting library for .dc sweeps and .tran waveforms

Research note for the circuit-simulator decision records, 9 Nov 2026. Scope: the plots for
`.dc` sweeps and `.tran` waveforms now; designed so that AC Bode plots (log x axis),
cursors on plots, and parameter sweeps (families of curves) fit later.

Everything below was measured in this session unless a source is cited. Test pages, scripts
and raw results are listed in section 11.

## 1. Recommendation

**Use uPlot 1.6.32 (MIT) as the renderer, behind our own `plot` module that owns all of the
accessibility.** Load the module lazily, only when a result has vectors to plot.

Why uPlot:

- **Smallest.** The test page is 22.7 KiB of JavaScript after min+gzip, against 56 to 373 KiB for
  the other libraries (section 5).
- **Fastest on the phone estimate at 100 000 points per series.** First render takes 87 ms of
  script, and a pointer move costs 7.6 ms of main-thread time. The other libraries take 213 to
  45 700 ms and 15 to 8 800 ms (section 6); only our own D3 test page, which is not a library, is
  on par. Memory at 100 000 points is 2.7 MB, against 13 to 425 MB.
- **It has the axis features we need.** Log axes and an arcsinh axis (a symmetric log that also
  handles currents that cross zero), any number of y scales and axes, a cursor whose values show
  in an HTML legend, cursor sync between charts (for stacked panels and Bode plots), and a
  per-series x mode for families of curves. Tick labels go through a formatter hook, so we can
  use SI prefixes.
- **It never animates, and it stays sharp under browser zoom.** At 200 % zoom it redraws at the
  new device pixel ratio.
- **Its gaps are things we would build anyway.** It has no accessibility of its own, no touch
  pinch or pan, and no tooltips (which we don't want; see 9.3).
- **The layer is cheap.** A working prototype of the full layer on uPlot is 25.9 KiB gzip in
  total, 3.2 KiB more than bare uPlot. It has 0 axe violations. It passes keyboard, data-table,
  forced-colours, 200 % text, 320 px reflow and touch-scrub checks (section 9.11).

**Runner-up: Apache ECharts 6.1 (Apache-2.0), tree-shaken.** It has the most features built in:
touch pinch and pan, a zoom slider, tooltips, an automatic aria label, an SVG renderer, and
Apache-grade maintenance. Choose it only if we would rather configure than build. The costs
are:

- about 8 times the JavaScript (180 KiB gzip);
- about 6 times the first-render script time on the phone estimate (552 ms against 87 ms);
- a 66 ms pointer move at 100 000 points;
- a canvas that stays blurry at 200 % browser zoom (measured).

**Plan B if uPlot development stalls:** our own SVG renderer on D3 modules. It is 23.8 KiB gzip
and measured as fast as uPlot with a simple min/max decimation. Its axes adapt to forced colours
on their own. The cost is that we write and maintain the chart ourselves. Our `plot` module
keeps the renderer behind an interface, so a switch touches one file.

**Not recommended:**

- **Plotly 4.2.** 373 KiB gzip. No pinch zoom. No tick-label callback. Version 4 shows a
  "Share chart" cloud button by default.
- **Vega-Lite 6.5 / Vega 6.4.** 3.3 s first render and 1.5 s per pointer move at 100 000 points
  on desktop; 19 s and 8.8 s on the phone estimate. Its touch interactions did nothing in our
  probe.
- **Observable Plot 0.6.19.** No second y axis and no zoom. 2.4 s render at 100 000 points on
  the phone estimate, and every zoom re-renders the SVG.
- **Chart.js 4.6.** Legend, tooltip and axes are drawn on canvas only. Pointer moves cost 59 to
  63 ms at 10 000 points or more on the phone estimate. Animations are on by default. The zoom plugin
  depends on Hammer.js, last released in 2016.
- **dygraphs 2.2.2.** One active maintainer, one release in three years, legend text that fails
  contrast, and 1.1 s to paint 100 000 points on the phone estimate.

**Excluded because the licence is not OSI-approved:**

| Library | Licence (evidence) |
|---|---|
| Highcharts | npm `license` is `https://www.highcharts.com/license` |
| amCharts 5 | Linkware: the branding link must stay ([LICENSE](https://raw.githubusercontent.com/amcharts/amcharts5/master/LICENSE)) |
| ApexCharts ≥ 5.3.0 | MIT up to 5.0.0. "ApexCharts License" from 5.3.0 (2025-07-21): free only under US$2M revenue, and an OEM licence is needed for any product used by other people (`research/plot-data/licences/apexcharts/package/LICENSE.md`) |
| LightningChart JS | `SEE LICENSE IN LICENSE` (commercial EULA) |
| SciChart | `https://www.scichart.com/scichart-eula` |

Also not used:

- **maidr** is GPL-3.0.
- **React-only libraries** (Recharts, Nivo, visx, Victory) would tie the plots to a UI framework
  that has not been chosen yet.
- **TradingView Lightweight Charts** has a time-only x axis.
- **webgl-plot** has no axes, ticks or legend.

## 2. Scored table

Each criterion is scored from 1 to 5, and the total is Σ weight × score / 5 out of 100. The
weights follow the brief:

| Criterion | Weight | Why |
|---|---|---|
| Accessibility | 30 | The app's distinguishing promise |
| Phone performance at 100 000 points | 20 | A stated requirement |
| Bundle size | 15 | First visits come from YouTube links on phones |
| Features | 20 | |
| Licence and maintenance | 15 | |

All the candidates pass the OSI licence gate.

**What the accessibility score means.** No candidate gives keyboard access to the data, a data
table, or a usable spoken summary. So the score rates how much the library helps or hinders the
layer we must build: what assistive technology gets, behaviour under forced colours, zoom and
text size, animations, and the APIs for a programmatic cursor.

| Candidate (tested build) | A11y (30) | Perf (20) | Size (15) | Features (20) | Licence & maint. (15) | **Total** |
|---|---|---|---|---|---|---|
| **uPlot 1.6.32** | 3 | 5 | 5 | 4 | 3 | **78** |
| Own SVG on D3 modules (reference, not a library) | 4 | 5 | 5 | 1 | 4 | 75 |
| Apache ECharts 6.1.0, tree-shaken, canvas or SVG | 3 | 3 | 2 | 5 | 5 | 71 |
| Plotly.js 4.2.0 (`plotly.js-basic-dist-min`) | 3 | 3 | 1 | 4 | 5 | 64 |
| Chart.js 4.6.1 tree-shaken + chartjs-plugin-zoom 2.2.0 | 2 | 3 | 4 | 4 | 3 | 61 |
| dygraphs 2.2.2 | 2 | 3 | 4 | 4 | 2 | 58 |
| Vega-Lite 6.5.0 + Vega 6.4.0 (+ vega-embed 7.3.0) | 3 | 1 | 1 | 4 | 4 | 53 |
| Observable Plot 0.6.19 (with d3 7.9) | 2 | 1 | 3 | 2 | 4 | 45 |

The order holds when the weights change:

- **Equal weights:** uPlot 80, D3 76, ECharts 72, Plotly 64, Chart.js 64, dygraphs 60,
  Vega-Lite 52, Plot 48.
- **Features 35, accessibility 15:** uPlot 81, ECharts 77.
- **ECharts wins only** if we weight maintenance at 30 and ignore bundle size (ECharts 80,
  uPlot 72).

Short reasons for each score, with details in sections 4 to 8:

- **uPlot**
  - Accessibility 3: nothing built in (no ARIA, roles, tabindex or key handling in the source).
    Canvas text ignores forced colours, so the axes became invisible on a dark contrast theme
    (measured), and it ignores the root font size (measured). On the plus side: its legend is an
    HTML table that assistive technology can read, it has a full programmatic cursor and scale
    API, it never animates, and it stays sharp at 200 % zoom.
  - Performance 5: best or equal best in every measure.
  - Size 5: 22.7 KiB gzip.
  - Features 4: no built-in touch pinch, pan or wheel zoom; there are demo plugins of about
    80 lines.
  - Licence and maintenance 3: MIT, but one maintainer and no npm release since March 2025,
    although the repository is active.
- **Own SVG on D3 modules**
  - Accessibility 4: the best base to build on. Axes drawn with `currentColor` adapt to forced
    colours, and the elements can carry ARIA and CSS.
  - Features 1: d3 gives scales, axes and touch zoom; everything at chart level is ours.
- **ECharts**
  - Accessibility 3: it adds an automatic `role="img"` and aria label, but the label text is
    unusable. Decal patterns apply only to fills. Animations are on for small data. The canvas
    is blurry at 200 % zoom, and the chart does not follow its container's size by itself.
  - Performance 3: 552 ms render and a 66 ms pointer move at 100 000 points on the phone
    estimate.
  - Size 2: 180 KiB.
  - Features 5 and licence/maintenance 5: Apache Software Foundation project.
- **Plotly**
  - Accessibility 3: SVG output; the modebar buttons can be reached with Tab.
  - Performance 3: 633 ms render and a 303 ms zoom.
  - Size 1: 373 KiB.
  - Features 4: no pinch, no tick callback.
  - Licence and maintenance 5.
- **Chart.js**
  - Accessibility 2: legend, tooltip and axes are drawn on canvas only, and animations are on by
    default.
  - Performance 3: a 63 ms pointer move.
  - Size 4: 56 to 68 KiB.
  - Features 4.
  - Licence and maintenance 3: activity has slowed, and Hammer.js was last released in 2016.
- **dygraphs**
  - Accessibility 2: axe reports a contrast violation in its legend.
  - Performance 3: 1.1 s until painted.
  - Size 4.
  - Features 4: built-in pinch and pan.
  - Licence and maintenance 2: one maintainer.
- **Vega-Lite**
  - Accessibility 3: the SVG renderer has the richest ARIA, but it labels one element per data
    point.
  - Performance 1.
  - Size 1.
  - Features 4.
  - Licence and maintenance 4.
- **Plot**
  - Accessibility 2: an axe violation, and the SVG shrinks its text when the page is zoomed.
  - Performance 1.
  - Size 3.
  - Features 2: no second y axis, no zoom.
  - Licence and maintenance 4: still a 0.x version.

## 3. How it was measured

**Pages.** There is one tiny Vite 8.3.7 + TypeScript 7.0.2 page per candidate in
`research/plot/<name>/`, built with `tsc --noEmit && vite build`. All pages share the same
code from `research/plot/common/`:

- data: an RC charge with τ = 1 ms, plus a 400 kHz ripple so that line simplification cannot
  cheat;
- the SI formatter;
- the timing harness.

**Data.** Two series: `v(out)` in volts and `i(R1)` in amperes, as `Float64Array`s, which is
what an ngspice worker will hand over.

**Each page configures, as far as the library allows:**

- a y axis in volts on the left and a y axis in amperes on the right;
- a legend;
- a cursor or tooltip readout;
- zoom where it is built in or a plugin exists;
- SI tick labels;
- dashes on the second series;
- the library's documented large-data settings (Chart.js `parsing:false`, `normalized`,
  min-max decimation, `animation:false`; ECharts `sampling:'minmax'`, `showSymbol:false`).

Converting the arrays into each library's format is counted in the render time.

**Variants:**

| Variant | What it is |
|---|---|
| `chartjs` | Tree-shaken |
| `chartjs-zoom` | Adds zoom plugin + Hammer |
| `chartjs-auto` | Everything registered |
| `echarts-min` | Line + grid + dataset + canvas only: the size floor |
| `echarts-canvas`, `echarts-svg` | Full feature set on each renderer |
| `vegalite` | Compiled in the browser with vega-embed |
| `vega` | Vega-Lite compiled ahead of time; Vega runtime only |
| `plotly-basic` | The smallest prebuilt Plotly bundle with line plots |
| `d3custom` | Our own SVG chart on d3-scale, d3-axis, d3-selection, d3-zoom and d3-array, with min/max decimation per pixel column |
| `chart2music` | uPlot + chart2music (sonification and keyboard add-on) |
| `uplot-a11y` | The accessibility-layer prototype (section 9) |

**Bundle size.** `plot-scripts/measure-bundles.mjs` sums the built JS and CSS assets:
minified, gzip -9 and brotli q11.

**Performance.** `plot-scripts/perf.cjs` runs Playwright 1.63 with headless Chromium 153 on a
4-vCPU cloud VM. There are two profiles:

| Profile | Viewport | Device pixel ratio | CPU |
|---|---|---|---|
| Desktop | 1000×700 | 1 | not throttled |
| Phone estimate | 390×844, touch | 3 | 4× slower (`Emulation.setCPUThrottlingRate`, as in Lighthouse's mobile preset) |

The runs use 10³, 10⁴ and 10⁵ points per series; each figure is the median of 3 runs (1 run for
Vega and Vega-Lite at 10⁵ on the phone estimate). Measured:

- **First render:** script time from the start of conversion until the library reports it is
  done, and time until the first painted frame (two rAFs).
- **Programmatic zoom** to a 10 % x window.
- **Pointer move:** the renderer's main-thread busy time per move, averaged over 20 moves
  (CDP `Performance.getMetrics` TaskDuration).
- **JS heap.**
- **Load cost:** `loadcost.cjs` times navigation to first chart on the phone estimate.

**Accessibility probes** (`a11y.cjs`, `forced-dark.cjs`, `zoom200.cjs`, `touch.cjs`,
`proto-test.cjs`):

- axe-core 4.14.0, tags wcag2a/aa, wcag21a/aa, wcag22aa and best-practice;
- Playwright `ariaSnapshot()`, to see what assistive technology is given;
- a Tab walk;
- forced colours in the light palette and with a dark scheme (Playwright `forcedColors:'active'`);
- 200 % browser zoom emulated: CSS viewport halved and device pixel ratio set to 2;
- a 32 px root font size;
- touch sequences sent with CDP `Input.dispatchTouchEvent`: tap, one-finger drag, drag after
  zooming in, and two-finger pinch.

**Limits:**

- No real phone and no GPU: canvas and SVG raster in software.
- Chromium only: no Safari or Firefox.
- No real screen-reader session: we checked the accessibility tree, not NVDA, VoiceOver or
  TalkBack output.
- The throttled VM is an estimate of a mid-range phone, not a replacement for one.
- www.w3.org could not be reached from this session, so the WCAG wording is quoted from the
  w3c/wcag GitHub sources.

## 4. Criterion 1: accessibility (WCAG 2.2 AA)

### 4.1 What WCAG asks of a plot

These are the success criteria that apply to an interactive plot. The wording is from
[github.com/w3c/wcag/guidelines/sc](https://github.com/w3c/wcag/tree/main/guidelines/sc), saved
in `research/plot-data/wcag/`.

| Criterion | What it means for a plot |
|---|---|
| 1.1.1 Non-text content | A text alternative that serves the equivalent purpose: a summary, and a table for the details |
| 1.3.1 Info and relationships | The table and headings must be real structure |
| 1.4.1 Use of colour | Series cannot differ by colour alone: use dashes, markers and direct labels |
| 1.4.3 / 1.4.11 contrast | 4.5:1 for text; 3:1 for "parts of graphics required to understand the content", which includes the lines |
| 1.4.4 Resize text | Text must work at 200 % |
| 1.4.10 Reflow | Usable at 320 CSS px wide |
| 1.4.13 Content on hover or focus | Tooltips must be dismissible, hoverable and persistent |
| 2.1.1 Keyboard | All functionality operable from the keyboard |
| 2.4.7 Focus visible | |
| 2.4.11 Focus not obscured | |
| 2.5.1 Pointer gestures | Pinch needs a single-pointer alternative |
| 2.5.7 Dragging movements (new in 2.2) | Drag-to-zoom needs a no-drag alternative |
| 2.5.8 Target size (new in 2.2) | Targets at least 24×24 CSS px |
| 4.1.2 Name, role, value | |
| 4.1.3 Status messages | |
| 2.3.3 Animation from interactions | AAA only, but the brief asks for reduced motion |

On canvas text: WCAG's definition of "image of text" excludes text "that is part of a picture
that contains significant other visual content". So canvas axis labels are not a 1.4.5 failure.
Our large-text mode still has to reach them (section 9.8).

### 4.2 What each library provides (from source and docs)

| Library | Text alternative | Keyboard access to data | Data table | Non-colour encodings | Reduced motion |
|---|---|---|---|---|---|
| uPlot | None. 0 occurrences of `aria-`, `role`, `tabindex` or `keydown` in `uPlot.esm.js` | None; but there is an API: `setCursor`, `posToIdx`, `valToPos` (uPlot.d.ts:80, 111, 117) | Its legend is an HTML `<table>`; rows are clickable but not focusable (uPlot.esm.js:3196–3260) | `dash` per series (d.ts:941), point markers (circles), a `draw` hook for anything else | Never animates ("No transitions or animations", README:45) |
| Chart.js | The docs say: "the canvas content will not be accessible to screen readers"; add ARIA yourself (`docs/general/accessibility.md`) | None; `setActiveElements` can drive the tooltip | None | `borderDash`, `pointStyle`; direct labels need a plugin | Animations on by default, 1000 ms (types/index.d.ts:1744); no `prefers-reduced-motion` in the dist |
| ECharts | `aria.enabled` sets `role="img"` and an automatic aria-label on the container (lib/visual/aria.js:132–134), or your own description | None. The legend and dataZoom slider are not focusable | None (a toolbox "dataView" exists) | `lineStyle.type` dashes, `symbol` shapes, `endLabel` direct labels; decal patterns for fills only | `animation:'auto'`: animates below 2000 elements, 1000 ms (globalDefault.js:117–122); no media query |
| Plotly | None for the data; the modebar is `role=toolbar` with labelled, tabbable buttons (CHANGELOG #7492) | None | None | `line.dash`, `marker.symbol`, annotations | No transitions on `newPlot` |
| Vega / Vega-Lite | Sets `role=graphics-document`, `aria-roledescription="visualization"` and `aria-label` from `description` on the container (vega.js:36920–36925). The SVG renderer also describes axes and marks | None | None | `strokeDash` and `shape` encodings, text layers | No animation |
| Observable Plot | `ariaLabel` and `ariaDescription` options (plot.d.ts:172–179) | None. The pointer listens to pointer events only (dist/plot.js:4796–4799), and there is no API to set it | None | `strokeDasharray`, `symbol`, text marks | Static |
| dygraphs | None | None | None | `strokePattern` dashes | `animatedZooms` off by default |

### 4.3 Measured probes

Each page was probed with 1000 points per series. `ariaSnapshot()` shows what a screen reader
would receive.

**axe-core 4.14 (WCAG 2.2 AA + best practice):**

| Library | Violations | Contrast items left for review |
|---|---|---|
| uPlot | 0 | — |
| Chart.js | 0 | — |
| ECharts canvas | 0 | — |
| ECharts SVG | 0 | 25 |
| Plotly | 0 | 23 |
| Vega-Lite | 0 | — |
| Plot | **aria-prohibited-attr × 10**: `aria-label` on `<g>` without a role | 32 |
| dygraphs | **color-contrast × 1**: legend text drawn in the series colour | 25 |
| D3 own | 0 | 37 |
| uPlot + our layer | 0 | 0 |

**What assistive technology gets:**

- **uPlot:** the legend table: rows "time : –", "v(out) : –", "i(R1) : –". Values appear only
  after the mouse moves.
- **Chart.js:** nothing.
- **ECharts canvas:** `img` with the label "This is a chart. It consists of 2 series count. The 0
  series is a Line chart representing v(out). The first 10 items are: 0, 0, 0.005,
  0.000005005005005005005, …". Raw dataset rows, repeated for both series.
- **ECharts SVG:** the same `img`, plus every tick label as one string.
- **Plotly:** two `img`s holding the tick texts, and a toolbar with 8 buttons.
- **Vega-Lite, canvas renderer:** the container only.
- **Vega, SVG renderer:**
  - axes as `graphics-symbol` "X-axis titled 'time' for a linear scale with values from 0.000 to
    0.005";
  - one labelled element per data point on point layers: 1000 `line` elements for the rule
    layer at n = 1000, which would be 100 000 at 10⁵.
- **Plot:** two `img`s named from our `ariaLabel`, plus their tick texts.
- **dygraphs:** loose text.
- **D3 own:** one `img` with our label, plus its tick texts.
- **uPlot + our layer:**
  - a figure with a heading;
  - the generated summary;
  - a toolbar;
  - a `slider` "Cursor time" whose value is spoken, for example "16.7 microseconds: v(out) minus
    129 millivolts, i(R1) 4.83 milliamperes";
  - the readout;
  - a 50-row table with caption, column headers and row headers;
  - a CSV link.

**Keyboard tab stops inside the chart:**

| Library | Tab stops |
|---|---|
| Plotly | 8 modebar buttons, 24×22 px each |
| uPlot + our layer | 5: four 44 px buttons and the slider |
| All the others | None |

**Forced colours with a dark scheme** (Chromium's emulated contrast palette: Canvas = black,
CanvasText = white, GrayText = green):

- **uPlot:** axes, tick labels and axis titles are invisible: dark text on a transparent canvas
  over a forced black page (`a11y/forced-dark-uplot.png`). The lines keep their colours, and
  the legend markers lose theirs.
- **Chart.js:** grey `#666` labels, low contrast.
- **ECharts canvas:** legible by accident: light grid, grey labels.
- **Plotly:** keeps its white plot background.
- **Plot and D3 own:** axes and text use `currentColor`, so they turn white; the series lines
  keep their colours. Chromium did not change the computed `stroke` of SVG paths whose colour is
  set as an attribute (`a11y/a11y.json`).
- **uPlot + our layer:** everything is CanvasText, the grid is GrayText, and series stay
  distinguishable by dash, marker shape and direct label (`a11y/proto-forced-dark.png`).

**200 % browser zoom** (device pixel ratio 2, CSS viewport 500 px):

| Library | Sharp? | Follows the new width? |
|---|---|---|
| uPlot | Yes (redrawn at ratio 2; dppx media-query listener, uPlot.esm.js:71–81) | No: needs `setSize` from a ResizeObserver |
| uPlot + our layer | Yes | Yes |
| Chart.js | Yes | Yes |
| dygraphs | Yes | Yes |
| Vega-Lite | Yes | Yes |
| Plotly (`responsive:true`) | SVG | Yes |
| ECharts canvas | **No**: the backing store stays at ratio 1, because zrender reads `devicePixelRatio` once at module load and at init (zrender/lib/config.js:2–9, canvas/Painter.js:108) | No: needs `resize()` |
| Plot | SVG | Shrinks the whole SVG to 54 %, so the text gets smaller instead of larger |
| D3 own | SVG | No |

**Root font 32 px** (200 % text, or our large-text mode):

- No library's chart text followed it. Canvas pixels were identical. SVG text stayed at its fixed
  px size: ECharts 12 px, Plotly 12 and 14 px, Plot 10 px, D3 10 px. The HTML legends of uPlot
  and dygraphs stayed at a fixed 14 to 16 px.
- **uPlot + our layer:** the canvas text and the plot height scale, because sizes come from rem
  and the plot redraws when it changes.

**Touch, phone context.** "Tap" means a single tap, "Drag" a one-finger drag across the plot,
"Pan when zoomed" a one-finger drag after zooming in, and "Pinch" a two-finger pinch-out.

| Library | Tap | Drag | Pan when zoomed | Pinch |
|---|---|---|---|---|
| uPlot | No readout; uPlot listens to mouse events only (uPlot.esm.js:44–48). The tap's compatibility mouse events end in `mouseleave`, which hides the cursor | Nothing | No | No |
| Chart.js | Tooltip | Tooltip follows | No | No |
| Chart.js + zoom plugin | Tooltip | Tooltip follows | Yes | Yes, 4.2×; but it sets `touch-action:none` on the canvas, so the page cannot be scrolled over the chart |
| ECharts | Tooltip | Tooltip follows | Yes | Yes, 2.1× (zrender gesture manager, RoamController.js:76–124) |
| Plotly | Hover label | Box zoom | No (it box-zooms again) | Treated as a one-finger box zoom |
| Vega-Lite | No effect | No effect | No | No |
| Plot | Tip | Tip follows | No zoom | No zoom |
| dygraphs | No readout | Pans | Yes | Yes, 2.2× |
| D3 own | (my page used `pointermove` only) | Readout follows | Yes | Yes, 3.7× |
| uPlot + our layer | | Scrubs the cursor | | Vertical swipes over the plot scroll the page (0 → 303 px), and browser pinch-zoom is kept |

### 4.4 SVG or canvas?

**Canvas** (uPlot, Chart.js, dygraphs, ECharts and Vega by default):

- One bitmap that assistive technology cannot see.
- Text sizes and colours are pixels chosen in JavaScript, so neither forced colours nor the root
  font size reach them. Measured: invisible axes on a dark contrast theme, unchanged text at a
  32 px root size.
- It stays sharp only if the library redraws when `devicePixelRatio` changes. uPlot, Chart.js,
  dygraphs and Vega do; ECharts does not.
- In exchange, 10⁵ points are cheap.

**SVG:**

- Elements can carry ARIA and CSS.
- Axes drawn with `currentColor` adapt to forced colours for free.
- Text can be restyled with rem units from our CSS.
- But series strokes set as attributes keep their colours.
- Library SVGs that scale with `viewBox` shrink their text when the page is zoomed (Plot).
- One element per point, from markers, Voronoi cells or per-point ARIA, explodes the DOM at 10⁵
  points (Vega).

**Conclusion.** The accessible form of a plot has to be HTML that we own either way: summary,
table, keyboard cursor and readout. Once that exists, the renderer choice matters for three
things: speed, forced colours and text size. For a canvas renderer we handle the last two in
about 60 lines (prototype, section 9). So canvas is acceptable, and uPlot's speed and size win.

## 5. Criterion 2: bundle size

All figures are KiB, measured on the built test pages (`plot-data/bundle-sizes.json`). Every page
includes the same 1.1 KiB (gzip) of shared code: data generator, harness and SI formatter.

| Page | JS min | JS gzip | JS brotli | CSS gzip | Notes |
|---|---|---|---|---|---|
| baseline (no library) | 2.2 | 1.1 | 1.0 | 0.2 | |
| **uplot** | 52.4 | **22.7** | 20.5 | 0.8 | `uplot` + its CSS |
| **uplot-a11y** (prototype of section 9) | 60.2 | **25.9** | 23.2 | 1.2 | Our layer adds 3.2 KiB gzip |
| d3custom (own SVG) | 68.4 | 23.8 | 20.8 | 0.2 | d3-scale, d3-axis, d3-selection, d3-zoom, d3-array |
| dygraphs | 111.9 | 34.6 | 30.3 | 0.5 | |
| chartjs (tree-shaken) | 161.0 | 56.1 | 49.2 | 0.2 | Line, linear+log scales, legend, tooltip, decimation |
| chart2music (uPlot + chart2music) | 204.5 | 60.3 | 52.6 | 0.8 | chart2music alone adds 37.6 KiB gzip |
| chartjs-zoom | 195.6 | 67.9 | 59.5 | 0.2 | + chartjs-plugin-zoom + hammerjs |
| chartjs-auto (all registered) | 200.7 | 68.2 | 59.0 | 0.2 | Tree-shaking saves 12 KiB |
| plot (Observable Plot) | 272.6 | 90.8 | 77.1 | 0.2 | Pulls in d3 |
| echarts-min (line + grid + dataset + canvas) | 460.1 | 154.6 | 131.8 | 0.2 | The ECharts floor |
| echarts-canvas (full feature set) | 540.9 | 180.2 | 152.8 | 0.2 | + tooltip, legend, dataZoom, aria |
| echarts-svg | 548.3 | 183.8 | 155.8 | 0.2 | |
| vega (spec precompiled, runtime only) | 529.1 | 185.0 | 156.5 | 0.2 | |
| vegalite (+ vega-embed, compiled in the browser) | 835.0 | 284.4 | 240.6 | 0.2 | |
| plotly-basic (`plotly.js-basic-dist-min` 4.2.0) | 1136.1 | 372.8 | 302.5 | 0.2 | Plotly's own table: 1.2 MB min, 402 kB gzip |

Plotly's sizes come from its
[dist README](https://raw.githubusercontent.com/plotly/plotly.js/main/dist/README.md). Its WebGL
`gl2d` bundle, needed for `scattergl`, is 1.5 MB min and 504 kB gzip. A scatter-only custom
bundle needs a full clone and build (`CUSTOM_BUNDLE.md`) and would still be near the basic
bundle, which is only scatter, bar and pie.

For scale, the ngspice WebAssembly from EEcircuit-engine is 6.1 MB, or 1.9 MB gzip
(`research/engine-data/spice.wasm`). So the plotting library is a small share of the bytes, but
it runs on the main thread, and parse and compile are part of the cost below.

**Load cost on the phone estimate** (`plot-data/loadcost-phone.json`): main-thread time from
navigation to the first chart drawn, 1000 points, median of 3 runs, minus the baseline page's
174 ms.

| Library | Extra ms |
|---|---|
| d3custom | 31 |
| dygraphs | 81 |
| uPlot | 156 |
| Chart.js | 170 |
| uPlot + our layer | 189 |
| Plot | 227 |
| uPlot + chart2music | 232 |
| ECharts canvas | 338 |
| Vega | 684 |
| Vega-Lite | 842 |
| Plotly | 867 |

## 6. Criterion 3: performance up to 10⁵ points

Each cell is "script ms / painted ms" at 10³, 10⁴ and 10⁵ points per series (two series). "Zoom"
sets x to a 10 % window. "Pointer move" is main-thread ms per mouse move. Painted time includes
waiting for two frames: about 20 ms on desktop and about 58 ms on the phone estimate (baseline
row). Sources: `plot-data/perf-desktop.json`, `perf-phone-{a,b,c}.json` and
`perf-*-a11y.json`.

**Desktop** (1000×700, device pixel ratio 1, no throttle, median of 3):

| Candidate | 10³ | 10⁴ | 10⁵ | Zoom at 10⁵ | Pointer move 10³ / 10⁴ / 10⁵ | Heap at 10⁵ (MB) |
|---|---|---|---|---|---|---|
| **uplot** | 12 / 18 | 18 / 43 | **27 / 53** | 2.2 / 30 | **1.8 / 1.9 / 1.8** | **2.5** |
| uplot-a11y (prototype) | 16 / 21 | 29 / 54 | 42 / 68 | 1.8 / 27 | 3.6 / 3.4 / 3.6 | 2.6 |
| d3custom | 11 / 33 | 12 / 35 | 27 / 51 | 5.6 / 26 | 1.6 / 1.5 / 1.5 | 3.2 |
| dygraphs | 17 / 25 | 35 / 76 | 93 / 218 | 52 / 94 | 2.1 / 2.1 / 2.5 | 49 |
| chartjs | 30 / 33 | 38 / 59 | 56 / 79 | 10 / 40 | 3.8 / 25 / 28 | 14 |
| chartjs-zoom | 31 / 36 | 43 / 72 | 62 / 84 | 10 / 40 | 3.7 / 27 / 28 | 14 |
| echarts-canvas | 70 / 74 | 70 / 78 | 123 / 140 | 22 / 43 | 8.2 / 9.5 / 9.9 | 22 |
| echarts-svg | 66 / 70 | 70 / 74 | 134 / 137 | 20 / 38 | 6.2 / 6.6 / 7.4 | 19 |
| plotly-basic | 80 / 83 | 97 / 100 | 162 / 166 | 93 / 94 | 3.9 / 4.8 / 9.1 | 27 |
| plot | 33 / 42 | 96 / 108 | 556 / 595 | 537 / 549 | 2.4 / 5.6 / 54 | 83 |
| vega | 120 / 125 | 487 / 600 | 5,138 / 5,145 | 897 / 1,000 | 26 / 224 / 1,591 | 415 |
| vegalite | 124 / 130 | 366 / 476 | 3,250 / 3,256 | 1,049 / 1,186 | 28 / 232 / 1,521 | 293 |
| chart2music | 24 / 38 | 42 / 69 | crash | – | 1.7 / 1.6 / – | – |
| baseline | 0.3 / 24 | 0.2 / 18 | 0.2 / 21 | 0.0 / 20 | 0.8 / 0.6 / 0.7 | 2.2 |

**Phone estimate** (390×844, device pixel ratio 3, touch, CPU 4× slower, median of 3; Vega and
Vega-Lite at 10⁵ are a single run):

| Candidate | 10³ | 10⁴ | 10⁵ | Zoom at 10⁵ | Pointer move 10³ / 10⁴ / 10⁵ | Heap at 10⁵ (MB) |
|---|---|---|---|---|---|---|
| **uplot** | 58 / 132 | 71 / 193 | **87 / 214** | 5.7 / 64 | **8.7 / 7.5 / 7.6** | **2.7** |
| uplot-a11y (prototype) | 86 / 142 | 117 / 241 | 138 / 252 | 6.2 / 54 | 13.5 / 12.7 / 13.4 | 2.5 |
| d3custom | 40 / 126 | 52 / 151 | 95 / 184 | 18 / 33 | 5.5 / 5.6 / 6.4 | 2.3 |
| dygraphs | 94 / 164 | 139 / 458 | 372 / 1,085 | 107 / 247 | 13 / 15 / 15 | 49 |
| chartjs | 130 / 193 | 135 / 219 | 213 / 306 | 39 / 98 | 20 / 59 / 63 | 13 |
| chartjs-zoom | 136 / 199 | 150 / 241 | 222 / 312 | 38 / 97 | 21 / 63 / 64 | 13 |
| echarts-canvas | 305 / 376 | 316 / 409 | 552 / 666 | 74 / 109 | 49 / 62 / 66 | 18 |
| echarts-svg | 283 / 344 | 348 / 356 | 525 / 540 | 76 / 94 | 34 / 40 / 36 | 20 |
| plotly-basic | 316 / 328 | 374 / 401 | 633 / 650 | 297 / 303 | 15 / 23 / 39 | 15 |
| plot | 149 / 188 | 402 / 459 | 2,430 / 2,484 | 2,063 / 2,122 | 10 / 33 / 70 | 65 |
| vega | 575 / 679 | 2,013 / 2,715 | 45,700 / 45,794 | 5,104 / 5,543 | 136 / 1,019 / 8,487 | 425 |
| vegalite | 638 / 694 | 1,615 / 2,331 | 18,923 / 18,955 | 5,130 / 5,636 | 110 / 1,015 / 8,777 | 289 |
| chart2music | 118 / 189 | 167 / 311 | not run | – | 8.5 / 8.5 / – | – |
| baseline | 0.4 / 58 | 1.5 / 54 | 0.8 / 59 | 0.0 / 2.4 | 1.8 / 1.9 / 2.2 | 1.8 |

**Reading the tables:**

- **Frame budget.** The pointer move is the number to watch for "does the cursor feel live": one
  frame at 60 Hz is 16.7 ms.
  - Under budget on the phone estimate at 10⁵ points: uPlot (7.6), D3 own (6.4), the prototype
    (13.4) and dygraphs (15).
  - Over budget: Chart.js (63; its `index` tooltip mode scans the data), ECharts (36 to 66),
    Plotly (39), Plot (70), and Vega / Vega-Lite (8.5 to 8.8 s; the nearest-point selection is
    a Voronoi over all points).
- **chart2music 1.20.0 crashes at 10⁵ points** with `RangeError: Maximum call stack size
  exceeded`. The cause is `Math.min(...values)` and `Math.max(...values)` on the whole array
  (dist/index.mjs:407, 448, 557). It must only ever get decimated data.
- **Published benchmarks agree on the order.** uPlot's README table (its own author's, desktop,
  2023, 166 650 points; uPlot README:85–97) gives uPlot 34 ms, Chart.js 38 ms, ECharts 55 ms,
  dygraphs 90 ms, Plotly 310 ms. It claims "~100,000 pts/ms" scaling and "may begin to struggle
  beyond 100k in-view points" (README:8, 10).
- **Chart.js's own performance guide** asks for `parsing:false`, `normalized`, the decimation
  plugin and `animation:false`, and notes that draw-time decimation is disabled when `borderDash`
  is set (`docs/general/performance.md:118–120`). Dashes are exactly what we need for
  non-colour encoding.
- **Plotly** points large data at WebGL `scattergl` (`plotly.js-gl2d-dist-min`, 504 kB gzip).
  WebGL contexts are limited per page, which matters for many small plots (uPlot README:8).
- **Our data path.** uPlot takes `Float64Array`s directly, so the worker can transfer ngspice
  vectors with no per-point objects. That explains its 2.7 MB heap against 13 to 425 MB.

## 7. Criterion 4: features

✓ = built in. "Hook" = we supply a function. "Plugin" = separate package or demo code.

| Feature | uPlot | Chart.js | ECharts | Plotly | Vega-Lite | Plot | dygraphs |
|---|---|---|---|---|---|---|---|
| Log axes | ✓ `distr:3`, log base 10 or 2; **arcsinh `distr:4`** for currents that cross zero (d.ts:612–648) | ✓ `logarithmic` | ✓ `log` | ✓ `log` | ✓ `log`, `symlog` | ✓ `log`, `symlog` | ✓ `logscale` |
| Two y axes (V and A) | ✓ any number of scales and axes (`side:1` puts one on the right) | ✓ `yAxisID` + `position:'right'` | ✓ `yAxis[]` | ✓ `yaxis2.overlaying` (v4 defaults to `tickmode:'sync'`, giving ticks like 0.00496 A; set `'auto'`, CHANGELOG #7684) | ✓ layer + `resolve.scale.y:'independent'` | ✗ one y scale per plot; use stacked panels | ✓ `y2` |
| Cursor, crosshair, readout | ✓ crosshair + live HTML legend; `cursor.sync` across charts (d.ts:161, 508–518); `setCursor` API | Tooltip in index or nearest mode; crosshair line needs a plugin | ✓ `axisPointer:'cross'` tooltip; `dispatchAction('showTip')` | ✓ `hovermode:'x unified'` + spikes; `Fx.hover` | Nearest-point rule via params; Voronoi, slow | ✓ `crosshairX`, `tip`; no programmatic API | ✓ legend follows; crosshair plugin |
| Zoom and pan, mouse | ✓ drag-zoom x; wheel zoom as a demo plugin | Plugin: wheel, drag, pan | ✓ dataZoom inside + slider | ✓ box zoom, pan, modebar | ✓ wheel zoom, drag pan | ✗ | ✓ drag zoom, shift-drag pan |
| Zoom and pan, touch (measured) | ✗ (pinch/pan demo plugin, ~80 lines: `demos/zoom-touch.html`) | Plugin: pinch ✓, pan ✓ | ✓ pinch, pan | One-finger box zoom only | ✗ | ✗ | ✓ pinch, pan |
| Legend | ✓ HTML table, click toggles | ✓ drawn on canvas | ✓ drawn | ✓ SVG | ✓ | Colour legend | ✓ HTML |
| SI tick labels | Hook: `axes[].values(u, splits)` | Hook: `ticks.callback` | Hook: `axisLabel.formatter` | No callback: `tickformat:'~s'` (d3-format) or `exponentformat:'SI'` + `ticksuffix` | `format:'~s'` / `labelExpr` | Hook: `tickFormat` | Hook: `axisLabelFormatter` |
| Families of curves (parameter sweeps) | ✓ aligned data, `mode:2` per-series x (d.ts:333–340), `uPlot.join()` (d.ts:151) | ✓ | ✓ | ✓ | ✓ long-format data | ✓ | Aligned rows only |
| Two cursors with deltas (later) | `draw` hook + `valToPos`/`posToVal` | Plugin or custom | `markLine`, `graphic` | Editable `shapes` | params | Re-render | Custom |
| Direct labels | `draw` hook (prototype) | Plugin | ✓ `endLabel` | ✓ annotations | ✓ text layer | ✓ text mark | Custom |
| Render to file | Canvas `toBlob` | Canvas `toBlob` | ✓ PNG/SVG, server-side rendering | ✓ PNG/SVG | ✓ PNG/SVG | SVG | Canvas |

**Bode plots (later).** Two stacked uPlot charts, magnitude in dB over phase in degrees, with a
log frequency axis (`distr:3`) and `cursor.sync` sharing the cursor. **Cursors (later).** An
overlay drawn in the `draw` hook, plus a second slider (section 9.4). **Parameter sweeps
(later).** One series per step. When steps have different time grids, use `mode:2` or
`uPlot.join()`.

## 8. Criterion 5: licence and maintenance

Sources:

- npm registry: `npm view <pkg> license version time maintainers`, saved in `plot-data/npm/`;
- GitHub search API (`gh api search/repositories`): `plot-data/gh/search.json`;
- commit history from history-only clones in `plot-data/repos/`;
- "12 months" means since 2025-11-09; bots are excluded.

| Library | Licence | Latest release | Releases in 12 / 24 months | Commits / authors in 12 months | Stars, open issues | Notes |
|---|---|---|---|---|---|---|
| **uPlot** | MIT | 1.6.32, 2025-03-14 | **0 / 1** | 184 / 6, of which **179 by Leon Sorokin** | 10.6k, 133 | One npm maintainer. The repository is very active (Sep–Oct 2026: benchmarks, tests, new tooltip proof of concept), but nothing has been released for 20 months. The source is 145 KB of unminified ESM, small enough to vendor |
| Chart.js | MIT | 4.6.1, 2026-10-22 | 1 / 6 | 12 / 7 | 67.8k, 646 | Slowing. The zoom plugin's last release was 2.2.0 on 2024-11-26. hammerjs 2.0.8 dates from **2016-04-22** |
| ECharts | Apache-2.0 (zrender BSD-3-Clause) | 6.1.0, 2026-05-19 | 1 / 3 | **220 / 27** | 67.7k, 1476 | Apache Software Foundation project. Apache-2.0 means shipping its LICENSE and NOTICE; it is compatible with an MIT app |
| Plotly.js | MIT | 4.2.0, 2026-10-29 | **12 / 21** | **1580 / 46** | 18.4k, 810 | Company-backed. 4.0 (2026-08-24) had breaking changes and turned on the cloud "Share chart" button (CHANGELOG #7909) |
| Vega-Lite / Vega | BSD-3-Clause | 6.5.0, 2026-10-08 / 6.4.0, 2026-08-14 | 3 / 14 and 4 / 12 | 62 / 16 and 85 / 19 | 5.5k / 12.0k | University of Washington Interactive Data Lab and community |
| Observable Plot | ISC | 0.6.19, 2026-11-05 | 2 / 3 | 51 / 6 | 5.4k, 349 | Still 0.x. It went 20 months without a release (2025-02 to 2026-11) |
| dygraphs | MIT | 2.2.2, 2026-07-27 | 1 / 1 (the previous one was 2023-02) | 53 / **1** | 3.2k, 265 | |
| d3 modules | ISC | d3 7.9.2, 2026-11-03 | | | 113.9k | Very stable |
| chart2music | MIT | 1.20.0, 2025-12-03 | 1 / 4 | | 37 stars | One maintainer. Translations: de, en, es, fr, hmn, it; no Turkish |

## 9. The accessibility plan: what we build around uPlot

The plot is a component that we own: `src/plot/`. uPlot is used only inside one renderer file,
`render-uplot.ts`, behind an interface (`createPlot(container, spec)`). That interface carries:

- the analysis type;
- the x quantity, its unit and whether it is logarithmic;
- the series: name, unit, `Float64Array`, axis or panel;
- the theme and the text size.

Everything below lives outside the renderer, so it survives a later switch to Plan B (the D3 SVG
renderer). The prototype at `research/plot/uplot-a11y/src/main.ts` and `plot.css` implements
9.1 to 9.8 in about 300 lines (279 of TypeScript, 27 of CSS) and 3.2 KiB gzip.

### 9.1 Structure, text alternative and summary (1.1.1, 1.3.1)

**Markup.**

```html
<figure aria-labelledby="plot-title">
  <figcaption><h3 id="plot-title">…</h3><p id="plot-summary">…</p></figcaption>
  <div role="toolbar">…</div>
  <div role="slider">…canvas…</div>
  <p id="plot-help">…</p>
  <div class="readout">…</div>
  <div id="plot-table" hidden>…</div>
</figure>
```

The canvas has no role. The information is carried by the heading, the summary, the slider and
the table. The slider's children are presentational in ARIA.

**The title** names the analysis, the quantities and the range. For example: "Transient
analysis: v(out) and i(R1) against time, 0 to 5 ms".

**The summary is generated, visible to everyone, and helps sighted beginners too.** For each
series it gives start, end, minimum and maximum with their x positions; the prototype already
does this. Then, per analysis:

| Analysis | Summary adds |
|---|---|
| `.dc` | "Rises linearly from 0 V to 8 V as V1 goes from 0 V to 12 V (slope 0.667 V/V)", with a linearity test and the zero crossings |
| `.tran` | Final value. For monotonic step responses, the time to reach 63 % and 90 % of the change ("…1.00 ms, one time constant") |
| `.ac` (later) | DC gain, the −3 dB frequency, phase at crossover |
| Parameter sweep (later) | How the headline number changes with the parameter |

Numbers in the summary use the same SI formatter as the axes.

### 9.2 Units: one formatter, two outputs

- `eng(x, unit)` returns `{ text: '4.59 V', speech: '4.59 volts' }`.
- Visible text uses SI prefixes with a space and the unit attached ("500 µs", "−49.1 µA"), and
  U+2212 for minus.
- Speech uses words ("500 microseconds", "minus 49.1 microamperes"), so screen readers do not
  depend on symbol pronunciation tables.
- Axis labels never use SPICE suffixes. On a plot, "1 MΩ" means mega, while the netlist's `1M`
  means milli; that trap belongs to the netlist checker, not the axis.

### 9.3 Readout panel instead of tooltips (1.4.13, 2.4.11)

- An always-visible HTML readout under the plot shows the cursor's x, and each visible series'
  value next to a legend swatch: colour, dash and marker shape.
- It updates on mouse hover, touch scrub and keys. Nothing appears or disappears on hover, so
  1.4.13 is met by construction, and nothing covers the focused element.
- The readout is not a live region. Screen-reader users get the same values from the slider
  (9.4), which avoids chatter during mouse moves.
- If floating tooltips are ever added, they must close with Esc, stay while hovered, and never
  cover the cursor.

### 9.4 Keyboard cursor (2.1.1, 2.4.7, 4.1.2)

**The plot area is one Tab stop: the APG slider pattern.**

- Accessible name: "Cursor time" (or "Cursor V1" for a `.dc` sweep), with help text through
  `aria-describedby`.
- `aria-valuemin`, `aria-valuemax` and `aria-valuenow` are sample indices.
- `aria-valuetext` is the spoken readout of every visible series, for example "1 millisecond:
  v(out) 3.17 volts, i(R1) 1.84 milliamperes". Screen readers announce `aria-valuetext` changes
  on the focused slider. Measured in the prototype: the value text changes on each key.

**Keys:**

| Key | Action |
|---|---|
| ← / → (and ↓ / ↑) | One pixel column of samples |
| Shift + arrows | Ten pixel columns |
| Page Up / Page Down | 10 % of the view |
| Home / End | Ends of the view |
| + / − | Zoom 2× around the cursor |
| 0 | Show all |

These single-character keys work only while the plot has focus, which is the exception that
2.1.4 allows. The focus ring is 3 px with at least 3:1 contrast.

**Later:**

- **Second cursor:** a second slider, "Cursor B". The readout adds A, B, Δx, Δy and 1/Δt.
- **Choosing what is spoken:** checkbox buttons in the legend ("Read v(out)"). These are needed
  for families of curves.
- **Jump keys:** next peak, valley or zero crossing ("N", "P", "Z"). These matter for beginners
  finding a time constant or a crossover.

**Toolbar.** Zoom in, Zoom out, Show all and Show data table are real `<button>`s at least
44×44 CSS px (2.5.8 asks for 24×24). When the toolbar grows, switch it to a roving tabindex,
per the APG toolbar pattern.

### 9.5 Data table and CSV (1.3.1)

- A "Show data table" button with `aria-expanded` and `aria-controls` opens a real `<table>`:
  - a `<caption>` with range and count ("50 of 100 000 samples between 0 s and 5 ms");
  - `<th scope="col">` headers with units;
  - `<th scope="row">` for x.
- Rows are evenly spaced samples of the current view, at most 50 to 200. Later, add the key
  points: start, end, min, max and crossings.
- `.dc` sweeps with few points (13 in fixture D1) show every point.
- Below the table: a "Download all N samples (CSV)" link. The netlist exports (ngspice and
  LTspice) live elsewhere.
- Measured in the prototype: caption, headers and row headers are present in the accessibility
  tree, and axe reports 0 violations.

### 9.6 Pointer and touch (2.5.1, 2.5.7, 2.5.8)

- **Mouse:** uPlot's drag-to-zoom stays as a convenience. The zoom buttons and +/− keys are the
  no-drag alternative required by 2.5.7.
- **Touch:**
  - One-finger horizontal drag moves the cursor (pointer events on `u.over`).
  - `touch-action: pan-y pinch-zoom` on the plot, so vertical swipes still scroll the page and
    pinch still zooms the page. Low-vision users rely on browser pinch-zoom; chart plugins that
    set `touch-action:none` take it away.
  - Measured: scrubbing changed the cursor value, and a vertical swipe on the plot scrolled the
    page 303 px.
  - Plot zoom on phones uses the buttons. Optionally, a "Zoom with two fingers" toggle turns on a
    pinch handler (pattern from uPlot's `demos/zoom-touch.html`) and `touch-action:none` while it
    is on.
- **Legend toggles** are `<button aria-pressed>` at least 24×24 px. uPlot's own clickable legend
  rows are not focusable, so we hide its legend (`legend:{show:false}`).

### 9.7 Colour, dashes, markers, direct labels (1.4.1, 1.4.3, 1.4.11)

**Palette.** These were checked with the dataviz skill's validator (`validate_palette.js`;
outputs in `plot-data/palette/`):

| Mode | Colours | Result |
|---|---|---|
| Light | `#0072B2 #D55E00 #009E73 #CC79A7` (Okabe–Ito subset) | All ≥ 3:1 on white; normal-vision ΔE ≥ 16 |
| Dark | `#56B4E9 #E69F00 #CC79A7 #009E73` on `#161616` | All ≥ 3:1 |

- In both modes the worst colour-vision-deficiency pair is ΔE 7.6 (deuteranopia, purple vs
  green), in the warning band. So a secondary encoding is mandatory, which this plan always
  ships.
- The full Okabe–Ito set fails on white: `#E69F00` is 2.25:1 and `#56B4E9` is 2.31:1.
- **Families of curves:** a single-hue light-to-dark ramp in parameter order, plus direct labels
  with the parameter value ("R2 = 1 kΩ"). Never a rainbow.

**Secondary encodings, always on:**

- dash patterns: solid, `8 4`, `2 3`, `8 3 2 3`;
- marker shapes every 96 px, staggered by series: circle, square, triangle, diamond;
- a direct label at the right end of the visible part of each line, in text colour with a
  background halo, moved under the line when there is no room above it.

The legend swatches repeat the line style, dash and marker.

**Text never uses the series colour.** dygraphs' coloured legend text failed axe's 4.5:1 check.
Grid lines are allowed to be faint (they are not needed to understand the content). Axis lines
and tick labels meet text contrast.

### 9.8 Forced colours, dark mode, reduced motion, text size and zoom (1.4.4, 1.4.10)

**Colour roles.** Colours are CSS custom properties (`--plot-bg`, `--plot-text`, `--plot-grid`,
`--s1…`), with `prefers-color-scheme: dark` and `forced-colors: active` blocks. The forced
block maps them to `Canvas`, `CanvasText`, `GrayText` and `Highlight`.

The canvas cannot read CSS, so the plot resolves each role through a hidden probe element with
`forced-color-adjust: none`. It redraws on `matchMedia` `change` events. In forced colours every
series becomes `CanvasText`, and dashes, markers and labels keep them apart. Measured: without
this, uPlot's axes were invisible on a dark contrast theme; with it, everything is legible
(`a11y/proto-forced-dark.png`).

**Reduced motion.** No animation exists: uPlot has none, and zoom changes are instant. Any future
transition must sit behind `@media (prefers-reduced-motion: no-preference)`.

**Text size.** Plot font sizes, axis sizes, plot height and line width are derived from the root
font size at draw time. A hidden `1rem` element under a ResizeObserver triggers a rebuild, so
our large-text mode and the browser's font setting both reach the canvas. Measured: at a 32 px
root, the canvas text and plot height scaled (`a11y/proto-root32px.png`). In large-text mode
lines become 3 px.

**Width.** A ResizeObserver on the plot area calls `u.setSize`.

- At 320 CSS px there is no horizontal scrolling (measured `scrollWidth` 320); the toolbar and
  readout wrap.
- On narrow screens, mixed units (V and A) should switch to stacked panels with one y axis each,
  a shared x axis and a synced cursor. At 320 px two y axes leave about 120 px of plot
  (`a11y/proto-320.png`).

**Browser zoom.** uPlot redraws at the new device pixel ratio by itself (measured sharp at 2×).

**Default layout for mixed units: stacked panels.** We recommend stacked panels as the default
for mixed units, with "overlay on two y axes" as an option. A dual-axis chart's scale alignment
is arbitrary, so it suggests correlations that are not there. It also puts one axis far from a
magnifier user's viewport. LTspice users expect dual axes, so it stays available. Tarık should
decide this (section 10).

### 9.9 Loading and data path

- **Lazy load.** `import('./plot')` runs only when a result has vectors (`.dc`, `.tran`, later
  `.ac`). An `.op`-only circuit never loads the plotting code. The PWA precaches it for offline
  use.
- **Data from the worker.** The worker transfers `Float64Array` vectors (transferable, no copy),
  and uPlot uses them directly.
- **Very large results.** For more than about 10⁶ points, or many families, the worker
  decimates to min/max per pixel bucket for drawing. The full arrays stay for the table, the CSV
  and cursor values.
- **Readout updates.** Update the readout's text nodes instead of rebuilding its `innerHTML`. In
  the prototype, `innerHTML` doubled the pointer-move cost (7.6 → 13.4 ms on the phone estimate).

### 9.10 Optional later: sonification

An audio graph is a proven aid for blind students.

- **Our own:** a small Web Audio tone that follows the keyboard cursor (pitch = y), started with
  a key such as "S".
- **chart2music (MIT):** loaded lazily. It adds 37.6 KiB gzip. It crashes at 10⁵ points, so
  give it decimated data. It has no Turkish strings; it has a `translationCallback`.

### 9.11 Tests (CI)

**Automated** (Playwright + axe; these are the prototype's checks in `plot-scripts/proto-test.cjs`,
promoted to e2e tests):

- axe on WCAG 2.2 AA + best practice: zero violations;
- `ariaSnapshot` contains the figure, heading, summary, toolbar, slider and table;
- keyboard: Tab order is toolbar then slider; ArrowRight changes `aria-valuetext`; + and 0
  change the x range;
- the table: caption, headers and row count;
- forced colours, light and dark, and dark scheme: screenshot diffs;
- a 32 px root font; a 320 px viewport with `scrollWidth ≤ clientWidth`;
- 200 % zoom emulation;
- touch scrub and vertical scroll through CDP touch events.

**Manual, per release:**

- NVDA + Firefox; VoiceOver on macOS and iOS; TalkBack on Android;
- a Windows contrast theme;
- 400 % zoom;
- a real mid-range Android phone with 10⁵-point `.tran` results.

## 10. Risks and open questions

**Risks:**

- **uPlot maintenance.** There is one maintainer and no npm release since 2025-03-14, although
  the repository is active.
  - Mitigation: pin 1.6.32.
  - Our renderer interface keeps uPlot replaceable: D3 SVG as Plan B (measured equal speed), or
    ECharts.
  - The library is small enough to vendor and patch if it ever has to be.
- **Canvas accessibility depends entirely on our layer.** The CI tests in 9.11 make it a gate,
  not a hope.
- **Phone numbers are estimates.** Validate on one real mid-range Android phone before the
  milestone closes.

**Open questions for Tarık:**

- Stacked panels (recommended) or two y axes as the default view when units differ?
- Is sonification in scope after the first milestone?
- uPlot is independent of the UI framework (uplot-react 1.2.4 exists if React is chosen), so the
  framework decision does not block this one.

## 11. Reproduce

All paths are under
`<scratch>/research/`.

**Pages:** `plot/<name>/` (`index.html`, `src/main.ts`, `package.json`); shared code in
`plot/common/`. Install and build:

```
cd plot && npm install --ignore-scripts
npm run build -w <name>
```

The `vega` page compiles its spec with `vega/compile.mjs`.

**Scripts** (in `plot-scripts/`):

| Script | Purpose |
|---|---|
| `measure-bundles.mjs` | Bundle sizes |
| `serve.cjs` | Static server |
| `perf.cjs <url> <out> desktop\|phone <runs> <cands> <Ns>` | Performance runs |
| `loadcost.cjs` | Navigation to first chart |
| `a11y.cjs` | axe, ARIA tree, Tab walk, forced colours, root font |
| `forced-dark.cjs` | Forced colours with a dark scheme |
| `zoom200.cjs` | 200 % zoom emulation |
| `touch.cjs` | Touch probes |
| `proto-test.cjs` | Prototype checks |
| `tables.py` | Markdown tables from the results |
| `echarts-ssr-test*.mjs` | ECharts dataset debugging |

axe-core is in `plot-tools/`.

**Results** (in `plot-data/`):

- `bundle-sizes.json`
- `perf-desktop.json`, `perf-phone-{a,b,c}.json`, `perf-*-a11y.json`, `loadcost-phone.json`
- `a11y/` (a11y.json, touch.json, proto-test.json and screenshots)
- `shots/`
- `palette/`
- `npm/`, `gh/`, `licences/`, `wcag/`, `plotly-files/`, `chartjs-files/`, `uplot-files/`

**Example run:**

```
node plot-scripts/serve.cjs plot 5199 &
node plot-scripts/perf.cjs http://127.0.0.1:5199 out.json phone 3 uplot,echarts-canvas 1000,10000,100000
```

## Sources

- uPlot README, docs and demos: `plot-data/uplot-files/` (from github.com/leeoniya/uPlot @ master, 2026-10-30); `node_modules/uplot/dist/uPlot.d.ts`, `uPlot.esm.js`
- Chart.js docs (accessibility, performance, decimation, device pixel ratio): `plot-data/chartjs-files/` (github.com/chartjs/Chart.js); `chart.js/dist/types/index.d.ts`
- ECharts sources in `node_modules/echarts/lib/` and `node_modules/zrender/lib/`
- Plotly: [dist README](https://raw.githubusercontent.com/plotly/plotly.js/main/dist/README.md), [CUSTOM_BUNDLE.md](https://raw.githubusercontent.com/plotly/plotly.js/main/CUSTOM_BUNDLE.md), [CHANGELOG](https://raw.githubusercontent.com/plotly/plotly.js/main/CHANGELOG.md) (saved in `plot-data/plotly-files/`); community threads on missing pinch-zoom: [plotly.js #480 (touch panning)](https://github.com/plotly/plotly.js/issues/480), [community: pinch zoom](https://community.plotly.com/t/is-it-possible-to-add-pinch-zoom-event-in-plotly-js/59832)
- Vega: `node_modules/vega/build/vega.js` (`initializeAria`); compiled spec signals from `plot/vega/compile.mjs`
- WCAG 2.2 success criteria and the "image of text" definition: [github.com/w3c/wcag](https://github.com/w3c/wcag/tree/main/guidelines) (saved in `plot-data/wcag/`)
- Licences: npm registry fields (`plot-data/npm/`), ApexCharts `LICENSE.md` (`plot-data/licences/apexcharts/`), [amCharts 5 LICENSE](https://raw.githubusercontent.com/amcharts/amcharts5/master/LICENSE)
- Repository statistics: `gh api -X GET search/repositories` (`plot-data/gh/search.json`) and history-only clones (`plot-data/repos/`)
- Palette checks: the dataviz skill's `validate_palette.js` (Machado et al. 2009 colour-vision simulation, WCAG contrast), outputs in `plot-data/palette/`

# 0004. Plots: uPlot, behind our own accessible plot module

- Status: accepted
- Date: 2026-11-09

## Context

Plots for `.dc` sweeps and `.tran` waveforms now; later AC Bode plots (log axes), cursors,
and parameter sweeps (families of curves). Up to about 100 000 points per series, on phones.
WCAG 2.2 AA: a text alternative, keyboard access to the data, a data table, colour-blind-safe
colours plus non-colour encodings, forced colours, large text, reduced motion.

## Options measured

Each candidate drew the same two-series page (Vite 8, TypeScript), timed in headless Chromium
with phone emulation (390 × 844, DPR 3, CPU 4x slower) and checked with axe and the
accessibility tree.

| | JS min+gzip | 100k points: render / pointer move (phone estimate) | Accessibility found |
|---|---|---|---|
| **uPlot 1.6.32 (MIT)** | **22.7 KiB** | **87 ms / 7.6 ms** | none built in; complete cursor and scale API |
| Chart.js (MIT) | 56.1 KiB (67.9 with zoom) | 213 / 63 ms | nothing exposed; 1 s animations ignore reduced motion; decimation off with dashed lines |
| Apache ECharts (Apache-2.0) | 180.2 KiB | 552 / 66 ms | an automatic aria-label that reads raw numbers; blurry at 200 % zoom |
| Plotly basic (MIT) | 372.8 KiB | 633 / 39 ms | a "Share chart" cloud button by default; drag means box zoom, no pinch |
| Observable Plot (ISC) | 90.8 KiB | 2430 ms | SVG text shrinks when zoomed; axe violations |
| Vega-Lite (BSD-3) | 284.4 KiB | 18.9 s | one label per point |

No library gives keyboard access to the data or a data table, and none followed a 32 px root
font. So the accessibility layer is ours whatever we choose. Proprietary or non-OSI libraries
were excluded (Highcharts, amCharts 5, ApexCharts since 5.3.0, LightningChart, SciChart).

## Decision

**uPlot 1.6.32, pinned, inside our own framework-agnostic module** `src/plot/`
(`createPlot(container, spec)`), loaded with a dynamic import only when a result has vectors.
uPlot is used in one renderer file; the module owns accessibility:

- a `<figure>` with a heading and a generated text summary (range, final value, extremes);
- an always-visible readout panel instead of hover tooltips;
- a keyboard cursor that is an APG slider: arrow keys move point by point, Page Up/Down by 10 %,
  Home/End; its `aria-valuetext` speaks values with units in words ("16.7 microseconds: v(out)
  minus 129 millivolts");
- zoom buttons and +/−/0 keys as the alternative to dragging (WCAG 2.5.7);
- a data table (decimated to at most 200 rows, with a CSV download of everything);
- an Okabe–Ito palette subset (light: #0072B2 #D55E00 #009E73 #CC79A7; dark: #56B4E9 #E69F00
  #CC79A7 #009E73), always with dashes, markers and direct labels;
- CSS-variable colours resolved for the canvas, with a forced-colours mapping;
- font sizes from `rem`, redrawn when the text size changes; `ResizeObserver` resizing;
- touch scrubbing with `touch-action: pan-y pinch-zoom`, so the page still scrolls;
- different units (V and A) go in stacked panels with a synced cursor by default; two y-axes
  are an option.

A prototype of this layer on uPlot added 3.2 KiB gzip and passed axe with 0 violations, the
keyboard cursor, forced colours, 200 % text, 320 px reflow and touch scrubbing.

## Consequences

- One maintainer and no npm release since 2025-03-14 (the repository is active): we pin the
  version and keep uPlot behind `src/plot/` so it can be swapped for ECharts (runner-up) or our
  own D3-module SVG renderer (Plan B).
- The prototype's checks become CI gates (axe, keyboard, forced colours, 32 px root font, 320 px
  reflow, touch).
- Phone numbers are CPU-throttled estimates; confirm on one real mid-range Android phone.

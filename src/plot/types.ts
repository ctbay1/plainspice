/**
 * Public types of the plot module (src/plot/). No DOM and no uPlot here, so the app can import
 * them (and the pure helpers in summary.ts and table.ts) without loading the plotting code.
 */

/**
 * The units a plotted quantity can have. Same list as `Unit` in src/engine/results.ts
 * (tests/unit/plot-summary.test.ts fails to type-check if the two drift apart).
 */
export type PlotUnit = 'V' | 'A' | 'Ω' | 's' | '°C' | '';

/** One quantity: the x scale (time, or the swept source) or one plotted vector. */
export interface PlotSeries {
  /** What the student reads next to the line, e.g. `v(out)`, `i(v1)`, `time`, `V1`. */
  label: string;
  unit: PlotUnit;
  /** Usually a Float64Array straight from the engine (it is drawn without copying). */
  values: ArrayLike<number>;
  /**
   * The values as ngspice gave them, when PlainSpice shows some of them as 0 because they are rounding
   * noise of a 0 (decision 0015): the data table and the CSV file give them in a column of their own.
   */
  given?: ArrayLike<number>;
}

export interface PlotSpec {
  /** The visible heading, e.g. "Transient analysis: v(out) and i(v1) against time". */
  title: string;
  kind: 'dc' | 'tran';
  /** Time for `tran`; the swept source (or temperature, or resistance) for `dc`. */
  x: PlotSeries;
  series: PlotSeries[];
}

export interface PlotHandle {
  /** Show a new result in the same figure (keeps the cursor and zoom when they still fit). */
  update(spec: PlotSpec): void;
  /**
   * Read the CSS variables and the root font size again and redraw. The plot already does this
   * by itself when the text size, `data-contrast`, `data-theme`, forced colours or the colour
   * scheme change; call it after any other change to the theme variables.
   */
  refreshTheme(): void;
  /** Remove the figure and every listener. Safe to call twice. */
  destroy(): void;
}

export interface PlotOptions {
  /** Level of the visible heading (default 3: under the results section's h2). */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
}

/** A data table as text: every value already formatted with formatSI. */
export interface PlotTable {
  header: string[];
  rows: string[][];
}

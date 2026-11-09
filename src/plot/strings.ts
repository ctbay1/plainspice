/**
 * Every word the plot module shows or speaks, in one object so the Turkish UI can replace it
 * later. Sentences are functions, because Turkish puts the words in a different order.
 *
 * Vocabulary (one word for one idea): the "cursor" is the movable marker on the plot and its
 * keyboard control; a "point" is one row of the result (one time step or one sweep step); the
 * "view" is the part of the x range that is shown; "zoom" changes the view.
 */
import type { PlotUnit } from './types.ts';

export const PLOT_STRINGS = {
  /** Used for counts such as "100,000 points". */
  locale: 'en',

  /** What each unit measures: the y-axis title of each panel. */
  quantity: {
    V: 'voltage',
    A: 'current',
    'Ω': 'resistance',
    s: 'time',
    '°C': 'temperature',
    '': 'value',
  } satisfies Record<PlotUnit, string>,

  zoomGroup: 'Zoom',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  showAll: 'Show all',

  /** The accessible name of the keyboard cursor (an ARIA slider), e.g. "Cursor, time". */
  cursorName: (xLabel: string): string => `Cursor, ${xLabel}`,

  /** Visible help under the plot; also the cursor's description. */
  help:
    'To move the cursor, use the arrow keys (one point; hold Shift for bigger steps), Page Up and Page Down (10 % of the view), Home and End (first and last point). Press + or − to zoom in or out around the cursor, and 0 to show all. With a mouse you can also drag across the plot to zoom in; on a touch screen, slide a finger along the plot to move the cursor.',

  /** Starts the readout under the plot, which always shows the values at the cursor. */
  readoutLead: 'At the cursor:',

  /** One quantity in the readout and in the cursor's spoken value: "v(out) 4.59 V". */
  labelled: (label: string, value: string): string => `${label} ${value}`,

  /** The cursor's spoken value: "time 2.5 milliseconds: v(out) 4.59 volts, i(v1) minus 459 microamperes". */
  cursorValue: (x: string, values: readonly string[]): string => (values.length ? `${x}: ${values.join(', ')}` : x),

  /** Announced politely after a zoom (numbers in words). */
  viewAll: (xLabel: string, from: string, to: string): string => `Showing all of ${xLabel}, from ${from} to ${to}.`,
  viewPart: (xLabel: string, from: string, to: string): string => `Showing ${xLabel} from ${from} to ${to}.`,

  /** The data table, behind a disclosure. */
  tableToggle: 'Data table and CSV file',
  /** The name of the table's scrollable region: "Data table: Transient analysis …". */
  tableRegion: (title: string): string => `Data table: ${title}`,
  tableCaption: (shown: string, total: string, everyPoint: boolean): string =>
    everyPoint ? `All ${total} points.` : `${shown} of the ${total} points, evenly spaced. The CSV file has every point.`,
  downloadCsv: (total: string): string => `Download CSV (all ${total} points)`,
  /** Start of the CSV file name, e.g. "plot-transient-analysis.csv". */
  csvFilePrefix: 'plot',

  /** When there is nothing to draw. */
  noPoints: 'There are no points to plot.',
  /** When x goes back to its start: ngspice writes a .dc with two sources as one long result whose x repeats. */
  notMonotonic: (xLabel: string): string =>
    `This result cannot be drawn yet: ${xLabel} goes back to its start part of the way through, as it does when one sweep runs inside another (.dc with two sources). The data table below has every point.`,

  /** Sentences of the generated summary. `span` and `where` come from the phrases below. */
  summary: {
    nothing: 'There is nothing to plot.',
    noPoints: (label: string): string => `${label} has no points.`,
    onePoint: (label: string, value: string, where: string): string => `${label} is ${value} ${where}.`,
    /** "over 5 ms" (a transient that starts at 0) or "from 1 ms to 5 ms". */
    overTime: (duration: string): string => `over ${duration}`,
    fromTo: (from: string, to: string): string => `from ${from} to ${to}`,
    /** "as V1 goes from 0 V to 12 V" (a dc sweep). */
    asSweep: (xLabel: string, from: string, to: string): string => `as ${xLabel} goes from ${from} to ${to}`,
    /** "at 1 µs" (transient) or "at V1 = 6 V" (dc sweep). */
    atTime: (time: string): string => `at ${time}`,
    atSweep: (xLabel: string, x: string): string => `at ${xLabel} = ${x}`,
    stays: (label: string, value: string, span: string): string => `${label} stays at ${value} ${span}`,
    rises: (label: string, from: string, to: string, span: string): string => `${label} rises from ${from} to ${to} ${span}`,
    falls: (label: string, from: string, to: string, span: string): string => `${label} falls from ${from} to ${to} ${span}`,
    risesStraight: (label: string, from: string, to: string, span: string, slope: string): string =>
      `${label} rises in a straight line from ${from} to ${to} ${span} (slope ${slope})`,
    fallsStraight: (label: string, from: string, to: string, span: string, slope: string): string =>
      `${label} falls in a straight line from ${from} to ${to} ${span} (slope ${slope})`,
    goes: (label: string, from: string, to: string, span: string): string => `${label} goes from ${from} to ${to} ${span}`,
    extremes: (low: string, lowWhere: string, high: string, highWhere: string): string =>
      `lowest ${low} ${lowWhere}, highest ${high} ${highWhere}`,
    crossesOnce: (zero: string, where: string): string => `crossing ${zero} ${where}`,
    crossesTimes: (zero: string, times: number): string => `crossing ${zero} ${times} times`,
    finalValue: (value: string): string => `final value ${value}`,
    /** A slope of a quantity without a unit: "−0.01 per °C". */
    perUnit: (number: string, unit: string): string => `${number} per ${unit}`,
    /** Joins a main clause and its extra clauses into one sentence. */
    sentence: (main: string, extras: readonly string[]): string => `${[main, ...extras].join('; ')}.`,
  },
};

/** One formatter per locale: creating an Intl.NumberFormat is slow. */
let countFormat: { locale: string; format: Intl.NumberFormat } | undefined;

/** "100,000" in the strings' locale. */
export function formatCount(count: number): string {
  if (countFormat?.locale !== PLOT_STRINGS.locale) {
    countFormat = { locale: PLOT_STRINGS.locale, format: new Intl.NumberFormat(PLOT_STRINGS.locale) };
  }
  return countFormat.format.format(count);
}

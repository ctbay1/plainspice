/**
 * The Plot panel: .dc sweeps and .tran waveforms through the accessible plot module (src/plot,
 * decision 0004: a summary in words, a keyboard cursor, a data table and CSV), loaded with a dynamic
 * import only when a run has sweep results. The module decides how voltages and currents are drawn
 * (stacked panels for different units).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AnalysisResults, Sweep } from '../../engine/results.ts';
import { t } from '../../i18n/index.ts';
import type { PlotHandle, PlotSpec } from '../../plot/types.ts';
import { netlistVector } from '../../spice/describe.ts';
import type { Netlist } from '../../spice/types.ts';

/**
 * The swept source as written on the .dc line ("V1"), instead of ngspice's "v(v-sweep)"; a sweep of
 * TEMP is "temperature", the word the results use too (words review m11).
 */
export function dcSourceName(netlist: Netlist): string | undefined {
  for (const i of netlist.analyses) {
    const d = netlist.lines[i]?.directive;
    if (d?.name !== '.dc') continue;
    const source = d.args[0]?.text;
    return source?.toLowerCase() === 'temp' ? t('plotTemperature') : source;
  }
  return undefined;
}

/**
 * A sweep's lines, named with the netlist's names: v(giriş) where ngspice writes v(giri__), as the
 * Numbers panel and the results' words name them (W16, W18).
 */
function seriesOf(sweep: Sweep, netlist: Netlist): PlotSpec['series'] {
  return sweep.series.map((s) => ({ label: netlistVector(netlist, s.name), unit: s.unit, values: s.values }));
}

const seriesNames = (sweep: Sweep, netlist: Netlist): string => sweep.series.map((s) => netlistVector(netlist, s.name)).join(', ');

export function plotSpecs(results: AnalysisResults, netlist: Netlist): PlotSpec[] {
  const specs: PlotSpec[] = [];
  if (results.dc && results.dc.series.length) {
    const source = dcSourceName(netlist) ?? results.dc.scale.name;
    specs.push({
      title: t('plotTitleDc', { series: seriesNames(results.dc, netlist), source }),
      kind: 'dc',
      x: { label: source, unit: results.dc.scale.unit, values: results.dc.scale.values },
      series: seriesOf(results.dc, netlist),
    });
  }
  if (results.tran && results.tran.series.length) {
    specs.push({
      title: t('plotTitleTran', { series: seriesNames(results.tran, netlist) }),
      kind: 'tran',
      x: { label: t('plotTime'), unit: 's', values: results.tran.scale.values },
      series: seriesOf(results.tran, netlist),
    });
  }
  return specs;
}

/** Plots drawn in the panel: their boxes, their handles, and their kinds in order ("dc tran"). */
interface Drawn {
  kinds: string;
  boxes: HTMLElement[];
  handles: PlotHandle[];
}

const forget = (drawn: Drawn | undefined): void => {
  for (const h of drawn?.handles ?? []) h.destroy();
  for (const b of drawn?.boxes ?? []) b.remove();
};

/** The plot module once it has come (a dynamic import: decision 0004): every plot after the first is drawn at once. */
let plotModule: typeof import('../../plot/plot.ts') | undefined;

export function PlotPanel({ results, netlist }: { results: AnalysisResults; netlist: Netlist }): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const specs = useMemo(() => plotSpecs(results, netlist), [results, netlist]);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const drawn = useRef<Drawn | undefined>(undefined);

  useEffect(() => {
    const container = host.current;
    if (!container) return undefined;
    const kinds = specs.map((s) => s.kind).join(' ');
    const was = drawn.current;
    // A new result for the plots drawn (each run after a change): shown in the same figures, which keep
    // their cursor and their zoom where these still fit (the plot module's update). Drawn anew each time,
    // the figures went for a moment with "Loading the plot…" in their place, and on a phone the Plot
    // sheet and its rows (its zoom buttons, the cursor) went up and down with every run (AP-2).
    if (was && was.kinds === kinds) {
      specs.forEach((spec, i) => was.handles[i]?.update(spec));
      return undefined;
    }
    if (!specs.length) {
      forget(was);
      drawn.current = undefined;
      return undefined;
    }
    // Other plots (a sweep added or taken out): drawn, then the plots of before go, so the panel never
    // shows none between them.
    const draw = ({ createPlot }: NonNullable<typeof plotModule>): void => {
      const boxes = specs.map(() => {
        const box = document.createElement('div');
        box.className = 'plot-box';
        container.append(box);
        return box;
      });
      const handles = specs.map((spec, i) => createPlot(boxes[i]!, spec, { headingLevel: 3 }));
      forget(drawn.current);
      drawn.current = { kinds, boxes, handles };
    };
    if (plotModule) {
      draw(plotModule);
      return undefined;
    }
    // The first plot: "Loading the plot…" where the plots go until the module has come, and the plots in
    // its place at once (a phone's sheet then sees rows that are all new, and is laid out for them).
    let alive = true;
    const waiting = document.createElement('p');
    waiting.className = 'muted';
    waiting.textContent = t('plotLoading');
    container.append(waiting);
    import('../../plot/plot.ts')
      .then((module) => {
        plotModule = module;
        waiting.remove();
        if (alive) draw(module);
      })
      .catch((error: unknown) => {
        waiting.remove();
        if (alive) setFailed(error instanceof Error ? error.message : String(error));
      });
    return () => {
      alive = false;
      waiting.remove();
    };
  }, [specs]);
  // The panel closed: its plots go with it.
  useEffect(
    () => () => {
      forget(drawn.current);
      drawn.current = undefined;
    },
    [],
  );

  return (
    <div className="plot-panel">
      {!specs.length && <p className="muted">{t('plotNone')}</p>}
      {failed !== undefined && <p className="message message--problem">{t('plotFailed', { reason: failed })}</p>}
      <div ref={host} className="plots" />
    </div>
  );
}

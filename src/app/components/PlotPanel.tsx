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
import { netlistVector, shownSweep } from '../../spice/describe.ts';
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
function seriesOf(sweep: Sweep, netlist: Netlist, given?: Sweep): PlotSpec['series'] {
  return sweep.series.map((s, j) => {
    const raw = given?.series[j]?.values;
    // Rounding noise of a 0 is drawn and read as 0 (decision 0015); ngspice's own values keep their column.
    return raw && raw !== s.values ? { label: netlistVector(netlist, s.name), unit: s.unit, values: s.values, given: raw } : { label: netlistVector(netlist, s.name), unit: s.unit, values: s.values };
  });
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
      series: seriesOf(shownSweep(netlist, results) ?? results.dc, netlist, results.dc),
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

export function PlotPanel({ results, netlist }: { results: AnalysisResults; netlist: Netlist }): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const specs = useMemo(() => plotSpecs(results, netlist), [results, netlist]);
  const [status, setStatus] = useState<{ kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; reason: string }>({ kind: 'loading' });

  useEffect(() => {
    const container = host.current;
    if (!container || !specs.length) return;
    let alive = true;
    const handles: PlotHandle[] = [];
    setStatus({ kind: 'loading' });
    import('../../plot/plot.ts')
      .then(({ createPlot }) => {
        if (!alive) return;
        for (const spec of specs) {
          const box = document.createElement('div');
          box.className = 'plot-box';
          container.append(box);
          handles.push(createPlot(box, spec, { headingLevel: 3 }));
        }
        setStatus({ kind: 'ready' });
      })
      .catch((error: unknown) => alive && setStatus({ kind: 'failed', reason: error instanceof Error ? error.message : String(error) }));
    return () => {
      alive = false;
      for (const h of handles) h.destroy();
      container.replaceChildren();
    };
  }, [specs]);

  return (
    <div className="plot-panel">
      {!specs.length && <p className="muted">{t('plotNone')}</p>}
      {specs.length > 0 && status.kind === 'loading' && <p className="muted">{t('plotLoading')}</p>}
      {status.kind === 'failed' && <p className="message message--problem">{t('plotFailed', { reason: status.reason })}</p>}
      <div ref={host} className="plots" />
    </div>
  );
}

/**
 * The pieces of the Notebook frame around the drawing (Tarık's checkpoint, decisions 0014 and 0016):
 * the panels' divider tabs and paper-card head (a bottom sheet's head on a phone), the phone's one
 * bar along the bottom and its More sheet, the hint line and the status line, the sticky note on
 * the first screen, the card of results the drawing cannot show (.tf, sweeps) and the message card
 * (a link that could not be opened, the notes of an LTspice export).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { t, tn, type MessageKey } from '../../i18n/index.ts';
import type { Notice as NoticeData } from '../notices.ts';
import { CloseIcon, ErrorIcon, InfoIcon, LineIcon, ToolGlyph, type LineIconName } from './Icons.tsx';
import type { TfRow } from './NumbersPanel.tsx';
import type { StatusWords } from '../words.ts';

export type PanelId = 'netlist' | 'checks' | 'explain' | 'numbers' | 'plot' | 'output';

/** The panels, in the order of their tabs. */
export const PANELS: readonly PanelId[] = ['netlist', 'checks', 'explain', 'numbers', 'plot', 'output'];

const PANEL_WORDS: Readonly<Record<PanelId, { title: MessageKey; tab: MessageKey; sub: MessageKey; icon: LineIconName }>> = {
  netlist: { title: 'panelNetlist', tab: 'panelNetlist', sub: 'panelNetlistSub', icon: 'netlist' },
  checks: { title: 'panelChecks', tab: 'panelChecks', sub: 'panelChecksSub', icon: 'checks' },
  explain: { title: 'panelExplain', tab: 'panelExplain', sub: 'panelExplainSub', icon: 'explain' },
  numbers: { title: 'panelNumbers', tab: 'panelNumbers', sub: 'panelNumbersSub', icon: 'numbers' },
  plot: { title: 'panelPlot', tab: 'panelPlot', sub: 'panelPlotSub', icon: 'plot' },
  output: { title: 'panelOutput', tab: 'panelOutputTab', sub: 'panelOutputSub', icon: 'output' },
};

export const panelTitle = (id: PanelId): string => t(PANEL_WORDS[id].title);
export const panelTab = (id: PanelId): string => t(PANEL_WORDS[id].tab);

/** The panel's head: its title (focused when it opens), what it is, and Close. */
export function PanelHead({ id, sub, onClose, headingRef }: { id: PanelId; sub?: string; onClose: () => void; headingRef?: RefObject<HTMLHeadingElement | null> }): ReactNode {
  return (
    <header className="card-head">
      <div className="card-head__titles">
        <h2 className="card-head__title" id={`panel-${id}-title`} tabIndex={-1} ref={headingRef}>
          {panelTitle(id)}
        </h2>
        <p className="card-head__sub">{sub ?? t(PANEL_WORDS[id].sub)}</p>
      </div>
      <button className="icon-button" type="button" onClick={onClose} aria-label={t('panelClose', { panel: panelTitle(id) })}>
        <LineIcon name="close" />
      </button>
    </header>
  );
}

/**
 * The divider tabs down the right edge (a computer): each opens or closes its panel. When they do
 * not all fit (large text, a short window) the column scrolls, and a fade at its end says so.
 */
export function PanelTabs({ open, checks, onToggle, tabsRef }: { open: PanelId | undefined; checks: number; onToggle: (id: PanelId) => void; tabsRef?: (el: HTMLElement | null) => void }): ReactNode {
  const own = useRef<HTMLElement | null>(null);
  const [more, setMore] = useState({ above: false, below: false });
  const measure = useCallback(() => {
    const el = own.current;
    if (!el) return;
    const above = el.scrollTop > 2;
    const below = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    setMore((m) => (m.above === above && m.below === below ? m : { above, below }));
  }, []);
  useEffect(() => {
    const el = own.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [measure]);
  // One ref callback for the nav's life (a new one each render would be called again each time).
  const ref = useCallback(
    (el: HTMLElement | null) => {
      own.current = el;
      tabsRef?.(el);
    },
    [tabsRef],
  );
  return (
    <nav className={`tabs${more.above ? ' has-more-above' : ''}${more.below ? ' has-more-below' : ''}`} aria-label={t('panelsLabel')} onScroll={measure} ref={ref}>
      {PANELS.map((id) => (
        <button key={id} type="button" className={`tab tab--${id}`} aria-expanded={open === id} aria-controls={open === id ? 'panel' : undefined} onClick={() => onToggle(id)}>
          <LineIcon name={PANEL_WORDS[id].icon} className="tab__icon" />
          <span className="tab__label">{panelTab(id)}</span>
          {id === 'checks' && checks ? (
            <span className="badge">
              {checks}
              <span className="visually-hidden"> {t('badgeFound')}</span>
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}

/** The phone's one bar along the bottom: Select · Parts · Netlist · Checks · Explain · More. */
export function BottomBar({
  barRef,
  partsRef,
  moreRef,
  tool,
  partsOpen,
  panel,
  moreOpen,
  checks,
  onSelectTool,
  onParts,
  onPanel,
  onMore,
}: {
  /** The bar itself (the phone's stack measures it). */
  barRef?: (el: HTMLElement | null) => void;
  /** The Parts and More buttons (the focus comes back to them when their sheet closes). */
  partsRef?: RefObject<HTMLButtonElement | null>;
  moreRef?: RefObject<HTMLButtonElement | null>;
  tool: string;
  partsOpen: boolean;
  panel: PanelId | undefined;
  moreOpen: boolean;
  checks: number;
  onSelectTool: () => void;
  onParts: () => void;
  onPanel: (id: PanelId) => void;
  onMore: () => void;
}): ReactNode {
  const inMore = panel === 'numbers' || panel === 'plot' || panel === 'output';
  return (
    <nav className="bar" ref={barRef} aria-label={t('barLabel')}>
      <button type="button" className={`bar__button${tool === 'select' && !partsOpen ? ' is-on' : ''}`} aria-pressed={tool === 'select' && !partsOpen} onClick={onSelectTool}>
        <ToolGlyph kind="select" />
        <span className="bar__word">{t('toolSelect')}</span>
      </button>
      <button ref={partsRef} type="button" className={`bar__button tab--parts${partsOpen || tool !== 'select' ? ' is-on' : ''}`} aria-haspopup="dialog" aria-expanded={partsOpen} onClick={onParts}>
        <LineIcon name="parts" className="bar__icon" />
        <span className="bar__word">{t('barParts')}</span>
      </button>
      <span className="bar__sep" aria-hidden="true" />
      {(['netlist', 'checks', 'explain'] as const).map((id) => (
        <button
          key={id}
          type="button"
          className={`bar__button bar__button--panel tab--${id}${panel === id ? ' is-open' : ''}`}
          aria-expanded={panel === id}
          aria-controls={panel === id ? 'panel' : undefined}
          onClick={() => onPanel(id)}
        >
          <LineIcon name={PANEL_WORDS[id].icon} className="bar__icon" />
          <span className="bar__word">{panelTab(id)}</span>
          {id === 'checks' && checks ? (
            <span className="badge bar__badge">
              {checks}
              <span className="visually-hidden"> {t('badgeFound')}</span>
            </span>
          ) : null}
        </button>
      ))}
      <button ref={moreRef} type="button" className={`bar__button bar__button--panel tab--more${moreOpen || inMore ? ' is-open' : ''}`} aria-haspopup="dialog" aria-expanded={moreOpen} onClick={onMore}>
        <LineIcon name="more" className="bar__icon bar__icon--more" />
        <span className="bar__word">{t('barMore')}</span>
      </button>
    </nav>
  );
}

/** The phone's More sheet: the other panels, then undo and redo, Share, Export and Help, then the drawing's zoom. */
export function MoreSheet({
  onPanel,
  onShare,
  onExport,
  onHelp,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onZoom,
  onClose,
  sheetRef,
}: {
  onPanel: (id: PanelId) => void;
  onShare: () => void;
  onExport: (kind: 'ngspice' | 'ltspice') => void;
  onHelp: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** The drawing's size: bigger, smaller, or fitted to the screen again (besides pinching it). */
  onZoom: (how: 'in' | 'out' | 'fit') => void;
  onClose: () => void;
  sheetRef?: (el: HTMLElement | null) => void;
}): ReactNode {
  const row = (key: string, icon: LineIconName, words: string, onClick: () => void, disabled = false): ReactNode => (
    <li key={key}>
      <button type="button" className="more-row" onClick={onClick} disabled={disabled}>
        <LineIcon name={icon} />
        <span>{words}</span>
      </button>
    </li>
  );
  return (
    // A sheet over the page, not a modal <dialog>: the drawing stays usable beside it.
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
    <section className="sheet sheet--more" ref={sheetRef} role="dialog" aria-modal="false" aria-labelledby="more-title">
      <span className="grab" aria-hidden="true" />
      <div className="card-head">
        <div className="card-head__titles">
          <h2 className="card-head__title" id="more-title" tabIndex={-1}>
            {t('barMore')}
          </h2>
        </div>
        <button className="icon-button" type="button" aria-label={t('moreClose')} onClick={onClose}>
          <LineIcon name="close" />
        </button>
      </div>
      <div className="card-body">
        <h3 className="sheet-group">{t('panelsLabel')}</h3>
        <ul className="more-list">
          {row('numbers', 'numbers', panelTitle('numbers'), () => onPanel('numbers'))}
          {row('plot', 'plot', panelTitle('plot'), () => onPanel('plot'))}
          {row('output', 'output', panelTitle('output'), () => onPanel('output'))}
        </ul>
        <h3 className="sheet-group">{t('moreCircuit')}</h3>
        <ul className="more-list">
          {row('undo', 'undo', t('undo'), onUndo, !canUndo)}
          {row('redo', 'redo', t('redo'), onRedo, !canRedo)}
          {row('share', 'share', t('share'), onShare)}
          {row('ngspice', 'export', t('exportNgspice'), () => onExport('ngspice'))}
          {row('ltspice', 'export', t('exportLtspice'), () => onExport('ltspice'))}
          {row('help', 'help', t('help'), onHelp)}
        </ul>
        <h3 className="sheet-group">{t('paletteGroupDrawing')}</h3>
        <ul className="more-list">
          {row('zoom-in', 'zoom-in', t('zoomIn'), () => onZoom('in'))}
          {row('zoom-out', 'zoom-out', t('zoomOut'), () => onZoom('out'))}
          {row('fit', 'fit', t('zoomFit'), () => onZoom('fit'))}
        </ul>
      </div>
    </section>
  );
}

/** The hint line and the status line (with the zoom on a computer, and the phone's turn button). */
export function StatusLines({
  hint,
  status,
  analysis,
  phone,
  zoom,
  turn,
  invite,
  undo,
  whole,
  hintRef,
  hintScrolls = false,
}: {
  hint: string;
  status: StatusWords;
  analysis: string | undefined;
  phone: boolean;
  zoom?: { percent: number | undefined; onIn: () => void; onOut: () => void; onFit: () => void };
  /** A phone whose drawing can be turned: the button shows the other view ("As drawn" while turned, "As in the video" when the drawing is a video's). */
  turn?: { turned: boolean; video: boolean; onToggle: () => void };
  /** The first screen on a phone: the sticky note's button ("Change R1"), after the hint. */
  invite?: { label: string; onClick: () => void };
  /** A phone just after a change made on the drawing: Undo at hand (else it is under More). */
  undo?: () => void;
  /** A phone whose drawing the reader moved partly out of view: the way back to all of it ("Show the whole drawing", Fit), at hand (`byKeys`: pressed with the keys). */
  whole?: (byKeys: boolean) => void;
  /**
   * A phone: the hint in a box of its own (hintRef), which gives way first when the stack along the
   * bottom is short of room (large text on a small phone) and then scrolls, so the status and its
   * buttons stay whole below it. hintScrolls (its words are taller than it): a named region a finger
   * and the keys can scroll (WCAG 2.1.1).
   */
  hintRef?: (el: HTMLDivElement | null) => void;
  hintScrolls?: boolean;
}): ReactNode {
  const bad = status.tone === 'bad' || status.tone === 'paused';
  // A phone's pill with "Show the whole drawing" and another button (the turn, Undo): a calm status
  // keeps its words for screen readers only, and no dot, so the buttons share one row over the drawing
  // (175 and 115 px of buttons in a 360 px phone's 328 px). So does "Running…" (the numbers in pencil
  // show the run), so the pill, the hint and the buttons keep their place through each run an edit
  // starts, and a tap is not met by Undo where "Show the whole drawing" was. A status to read (paused,
  // an error, one with a reason) keeps its words.
  const crowded = phone && (status.tone === 'ok' || status.tone === 'busy') && !status.detail && !!whole && (!!turn || !!undo);
  const hintLine = invite ? (
    <div className="hint-row">
      <p className="hint" id="hint-line">
        {hint}
      </p>
      <button type="button" className="button button--note hint__invite" onClick={invite.onClick}>
        {invite.label}
      </button>
    </div>
  ) : (
    <p className="hint" id="hint-line">
      {hint}
    </p>
  );
  return (
    <div className={`lines${bad ? ' is-bad' : ''}`}>
      {hintRef ? (
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex, jsx-a11y/prefer-tag-over-role
        <div className={`hint-scroll${hintScrolls ? ' is-squeezed' : ''}`} ref={hintRef} {...(hintScrolls ? { tabIndex: 0, role: 'region', 'aria-label': t('hintScrollLabel') } : {})}>
          {hintLine}
        </div>
      ) : (
        hintLine
      )}
      <div className={`status${crowded ? ' is-crowded' : ''}`} data-tone={status.tone}>
        {crowded ? null : <span className={`status__dot status__dot--${status.tone}`} aria-hidden="true" />}
        <span className={crowded ? 'status__main visually-hidden' : 'status__main'}>{status.main}</span>
        {status.detail ? <span className="status__detail status__reason">{status.detail}</span> : null}
        {/* A reason to read comes first: the rest makes room for it. */}
        {analysis && !phone && status.tone === 'ok' ? <span className="status__detail status__analysis">{analysis}</span> : null}
        {!phone && status.tone === 'ok' ? <span className="status__detail status__engine">{t('statusEngine')}</span> : null}
        {undo ? (
          <button type="button" className="turn-button" onClick={undo}>
            {t('undo')}
          </button>
        ) : null}
        {whole ? (
          // A click from the keys has no pointer press (detail 0).
          <button type="button" className="turn-button" onClick={(e) => whole(e.detail === 0)}>
            {t('zoomFit')}
          </button>
        ) : null}
        {turn ? (
          // An action, named for what it does (not a toggle whose name changes too, which would say the wrong state).
          <button type="button" className="turn-button" onClick={turn.onToggle}>
            {turn.turned ? t(turn.video ? 'asInVideo' : 'asDrawn') : t('turnToFit')}
          </button>
        ) : null}
        {zoom ? (
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a set of buttons, not form fields
          <span className="zoom" role="group" aria-label={t('zoomLabel')}>
            <button className="icon-button icon-button--small" type="button" aria-label={t('zoomOut')} aria-keyshortcuts="-" onClick={zoom.onOut}>
              <LineIcon name="zoom-out" />
            </button>
            <button className="zoom__percent" type="button" onClick={zoom.onFit} aria-label={zoom.percent === undefined ? t('zoomFit') : t('zoomPercent', { percent: zoom.percent })} aria-keyshortcuts="Shift+1">
              {zoom.percent === undefined ? '…' : `${zoom.percent}%`}
            </button>
            <button className="icon-button icon-button--small" type="button" aria-label={t('zoomIn')} aria-keyshortcuts="+" onClick={zoom.onIn}>
              <LineIcon name="zoom-in" />
            </button>
            <button className="icon-button icon-button--small" type="button" aria-label={t('zoomFit')} onClick={zoom.onFit}>
              <LineIcon name="fit" />
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** The sticky note on the first screen (a computer): change a value and watch the numbers move. */
export function StickyNote({ partName, onChange, onHide, noteRef, style }: { partName: string | undefined; onChange: () => void; onHide: () => void; noteRef?: (el: HTMLElement | null) => void; style?: CSSProperties | undefined }): ReactNode {
  return (
    <aside className={`note${style ? ' is-placed' : ''}`} ref={noteRef} aria-labelledby="note-title" style={style}>
      <span className="note__tape" aria-hidden="true" />
      <p className="note__title" id="note-title">
        {partName ? t('noteTitle', { name: partName }) : t('noteTitleAny')}
      </p>
      <p className="note__text">{t('noteText')}</p>
      <div className="note__actions">
        {partName ? (
          <button className="button button--note" type="button" onClick={onChange}>
            {t('noteButton', { name: partName })}
          </button>
        ) : null}
        <button className="icon-button icon-button--note" type="button" aria-label={t('noteHide')} onClick={onHide}>
          <LineIcon name="close" />
        </button>
      </div>
    </aside>
  );
}

/** Results the drawing does not show (a .tf's ratios, a sweep's summary), on a card on the paper. */
export function ResultsCard({
  tf,
  sweeps,
  analysis,
  pending,
  onNumbers,
  onPlot,
}: {
  tf: readonly TfRow[];
  sweeps: readonly { text: string; speech: string }[];
  /** The sweep lines that ran, by name (".tran", ".dc and .tran"). */
  analysis: string;
  /** The numbers are for an older text. */
  pending: boolean;
  onNumbers: () => void;
  onPlot?: (() => void) | undefined;
}): ReactNode {
  return (
    <section className={`results-card${pending ? ' is-pending' : ''}`} aria-labelledby="results-card-title">
      <h2 className="results-card__title" id="results-card-title">
        {tf.length ? t('resultsCardTf') : t('resultsCardSweep', { analysis })}
      </h2>
      {tf.length ? (
        <dl className="results-card__rows">
          {tf.map((r) => (
            <div key={r.label} className="results-card__row">
              <dt>{r.label}</dt>
              <dd>
                <span className="hand" aria-hidden="true">
                  {r.text}
                </span>
                <span className="visually-hidden">{r.speech}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {sweeps.map((s, i) => (
        <p key={i} className="results-card__sweep">
          <span aria-hidden="true">{s.text}</span>
          <span className="visually-hidden">{s.speech}</span>
        </p>
      ))}
      <p className="results-card__actions">
        {onPlot ? (
          <button type="button" className="link-button" onClick={onPlot}>
            {t('showPlot')}
          </button>
        ) : null}
        <button type="button" className="link-button" onClick={onNumbers}>
          {t('showNumbers')}
        </button>
      </p>
    </section>
  );
}

/**
 * A message card (a link that could not be opened, the notes of an LTspice export, a netlist with
 * nothing to run): it stays until dismissed or replaced (messages that vanish on their own are hard
 * to read, WCAG 2.2.1); the live region announces it briefly.
 */
export function NoticeCard({ notice, onDismiss }: { notice: NoticeData; onDismiss: () => void }): ReactNode {
  const Icon = notice.tone === 'problem' ? ErrorIcon : InfoIcon;
  return (
    <section className={`notice notice--${notice.tone}`} aria-labelledby="notice-title">
      <div className="notice__head">
        <h2 id="notice-title" className="notice__title">
          <Icon />
          {notice.title}
        </h2>
        <button type="button" className="icon-button" onClick={onDismiss} aria-label={t('noticeClose')}>
          <CloseIcon />
        </button>
      </div>
      {notice.text && <p>{notice.text}</p>}
      {notice.items && notice.items.length > 0 && (
        <ul>
          {notice.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
      {notice.action ? (
        <p className="notice__actions">
          <button type="button" className="button" onClick={notice.action.run}>
            {notice.action.label}
          </button>
        </p>
      ) : null}
    </section>
  );
}

/** "A new version of PlainSpice is ready" with a Reload button (src/app/pwa.ts). */
export function UpdateCard({ onReload }: { onReload: () => void }): ReactNode {
  return (
    <section className="update-card" aria-label={t('updateReady')}>
      <p>{t('updateReady')}</p>
      <button type="button" className="button button--primary" onClick={onReload}>
        {t('updateReload')}
      </button>
    </section>
  );
}

/** The checks' count, in words for the panel's head ("2 found"). */
export const checksSub = (count: number): string | undefined => (count ? tn('panelChecksFound', count) : undefined);

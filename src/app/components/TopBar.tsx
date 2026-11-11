/**
 * The top bar (the Notebook frame, decision 0014): the circuit's title (the page's heading), the
 * Examples menu's button, undo and redo; Ctrl+K (from Studio); and the actions: Share, Export, Help,
 * Settings and Run. On a phone: the title is the Examples button, then Ctrl+K's search button,
 * Settings and Run; Share, Export and Help are in the bottom bar's More sheet.
 *
 * Run runs at once (live runs happen anyway after every change, decision 0016); while a run takes
 * long it becomes Stop. The actions are one Tab stop with arrow keys between them (useToolbarFocus).
 */
import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { t } from '../../i18n/index.ts';
import { useToolbarFocus } from '../toolbar-focus.ts';
import { ChevronDown, LineIcon, Mark } from './Icons.tsx';
import type { MenuFocus, OverlayKey } from './Overlays.tsx';

export interface TopBarProps {
  phone: boolean;
  /** The circuit's title (the netlist's title line). */
  title: string;
  open: OverlayKey | null;
  onOpen: (key: OverlayKey, focus?: MenuFocus) => void;
  examplesRef: RefObject<HTMLButtonElement | null>;
  exportRef: RefObject<HTMLButtonElement | null>;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onPalette: () => void;
  /** A run is going and has taken long: Run is Stop. */
  stoppable: boolean;
  /** Live runs wait for Run (paused, a link not run yet): Run stands out. */
  wanted?: boolean;
  onRun: () => void;
  onStop: () => void;
  headerRef?: (el: HTMLElement | null) => void;
  inert?: boolean;
}

export function TopBar({ phone, title, open, onOpen, examplesRef, exportRef, canUndo, canRedo, onUndo, onRedo, onPalette, stoppable, wanted = false, onRun, onStop, headerRef, inert }: TopBarProps): ReactNode {
  const actions = useRef<HTMLDivElement>(null);
  const toolbarFocus = useToolbarFocus(actions);
  // Menu buttons open with the arrow keys too, as a menu button should (ARIA APG).
  const menuKeys = (key: OverlayKey) => (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation();
    onOpen(key, e.key === 'ArrowUp' ? 'last' : 'first');
  };
  const run = stoppable ? (
    <button type="button" className="button button--stop run-button" onClick={onStop} aria-keyshortcuts="Control+Enter Meta+Enter" aria-label={phone ? t('stop') : undefined}>
      <LineIcon name="stop" />
      {phone ? null : <span>{t('stop')}</span>}
    </button>
  ) : (
    <button type="button" className={`button button--run run-button${wanted ? ' is-wanted' : ''}`} onClick={onRun} aria-keyshortcuts="Control+Enter Meta+Enter" aria-label={phone ? t('run') : undefined}>
      <LineIcon name="run" />
      {phone ? null : <span>{t('run')}</span>}
    </button>
  );

  if (phone) {
    return (
      <header className="top top--phone" ref={headerRef} inert={inert}>
        <span className="top__mark">
          <Mark />
        </span>
        <h1 className="top__title">
          <button
            ref={examplesRef}
            type="button"
            className="top__switch"
            aria-haspopup="menu"
            aria-expanded={open === 'examples'}
            onClick={() => onOpen('examples')}
            onKeyDown={menuKeys('examples')}
          >
            <span className="visually-hidden">{t('examples')}: </span>
            <span className="top__name">{title}</span>
            <ChevronDown />
          </button>
        </h1>
        <button type="button" className="icon-button" aria-label={t('paletteLabel')} aria-keyshortcuts="Control+K" onClick={onPalette}>
          <LineIcon name="search" />
        </button>
        <button type="button" className="icon-button" aria-label={t('settings')} aria-haspopup="dialog" aria-expanded={open === 'settings'} onClick={() => onOpen('settings')}>
          <LineIcon name="settings" />
        </button>
        {run}
      </header>
    );
  }

  return (
    <header className="top" ref={headerRef} inert={inert}>
      <div className="top__doc island">
        <span className="top__mark">
          <Mark />
        </span>
        <h1 className="top__title" title={title}>
          <span className="top__kicker">
            {t('appName')}
            <span className="visually-hidden">: </span>
          </span>
          <span className="top__name">{title}</span>
        </h1>
        <button
          ref={examplesRef}
          type="button"
          className="button button--quiet top__examples"
          aria-haspopup="menu"
          aria-expanded={open === 'examples'}
          onClick={() => onOpen('examples')}
          onKeyDown={menuKeys('examples')}
        >
          <LineIcon name="examples" />
          <span className="button__word">{t('examples')}</span>
          <ChevronDown />
        </button>
        <span className="top__sep" aria-hidden="true" />
        <button type="button" className="icon-button" onClick={onUndo} disabled={!canUndo} aria-label={t('undo')} aria-keyshortcuts="Control+Z Meta+Z">
          <LineIcon name="undo" />
        </button>
        <button type="button" className="icon-button" onClick={onRedo} disabled={!canRedo} aria-label={t('redo')} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z">
          <LineIcon name="redo" />
        </button>
      </div>
      <button type="button" className="top__cmd island" aria-label={t('paletteButton')} aria-keyshortcuts="Control+K Meta+K" onClick={onPalette}>
        <LineIcon name="search" />
        <span className="top__cmd-text" aria-hidden="true">
          {t('palettePlaceholder')}
        </span>{' '}
        <kbd className="top__kbd" aria-hidden="true">
          Ctrl K
        </kbd>
      </button>
      <div ref={actions} className="top__actions island" role="toolbar" aria-label={t('actionsLabel')} aria-orientation="horizontal" {...toolbarFocus}>
        <button type="button" className="button button--quiet" aria-haspopup="dialog" aria-expanded={open === 'share'} onClick={() => onOpen('share')}>
          <LineIcon name="share" />
          <span className="button__word">{t('share')}</span>
        </button>
        <button
          ref={exportRef}
          type="button"
          className="button button--quiet"
          aria-haspopup="menu"
          aria-expanded={open === 'export'}
          onClick={() => onOpen('export')}
          onKeyDown={menuKeys('export')}
        >
          <LineIcon name="export" />
          <span className="button__word">{t('export')}</span>
          <ChevronDown />
        </button>
        <button type="button" className="button button--quiet" aria-haspopup="dialog" aria-expanded={open === 'help'} onClick={() => onOpen('help')}>
          <LineIcon name="help" />
          <span className="button__word">{t('help')}</span>
        </button>
        <button type="button" className="icon-button" aria-label={t('settings')} aria-haspopup="dialog" aria-expanded={open === 'settings'} onClick={() => onOpen('settings')}>
          <LineIcon name="settings" />
        </button>
        {run}
      </div>
    </header>
  );
}

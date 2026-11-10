/**
 * The header's toolbar: Run (Stop while a slow run is going), Examples, Share, Export, Settings,
 * Help. One Tab stop with arrow keys between the buttons (useToolbarFocus: React Aria's Toolbar
 * behaviour, minus a focus jump that could swallow a click), placed before the editor so Run is
 * reachable first.
 *
 * Menus and dialogs are lazy-loaded (decision 0002): the first screen has only these buttons. Each
 * button owns its open state and says what it opens (aria-haspopup, aria-expanded); the menu or
 * dialog comes from its own chunk (a React Aria Popover anchored to the button, or a ModalOverlay),
 * fetched when the browser is idle after start-up or on first use. Focus goes into the menu or
 * dialog when it opens and back to the button when it closes (React Aria's FocusScope).
 */
import { lazy, Suspense, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from 'react-aria-components';
import { t } from '../../i18n/index.ts';
import type { Settings } from '../settings.ts';
import { useToolbarFocus } from '../toolbar-focus.ts';
import type { ExportKind } from '../overlays/ExportMenu.tsx';
import { ChevronDown, RunIcon, StopIcon } from './Icons.tsx';

const loadExamples = () => import('../overlays/ExamplesMenu.tsx');
const loadExport = () => import('../overlays/ExportMenu.tsx');
const loadShare = () => import('../overlays/ShareDialog.tsx');
const loadSettings = () => import('../overlays/SettingsDialog.tsx');
const loadHelp = () => import('../overlays/HelpDialog.tsx');

const ExamplesMenu = lazy(loadExamples);
const ExportMenu = lazy(loadExport);
const ShareDialog = lazy(loadShare);
const SettingsDialog = lazy(loadSettings);
const HelpDialog = lazy(loadHelp);

/** Fetch every overlay's code (called when the browser is idle after start-up). */
export function preloadOverlays(): Promise<unknown> {
  return Promise.all([loadExamples(), loadExport(), loadShare(), loadSettings(), loadHelp()]);
}

type OverlayKey = 'examples' | 'export' | 'share' | 'settings' | 'help';
/** Which item a menu focuses when it opens: the last one after ArrowUp, else the first. */
export type MenuFocus = 'first' | 'last';

export function AppToolbar({
  running,
  onRun,
  onStop,
  onExample,
  onExport,
  getNetlist,
  settings,
  onSettings,
}: {
  running: { slow: boolean } | null;
  onRun: () => void;
  onStop: () => void;
  onExample: (id: string) => void;
  onExport: (kind: ExportKind) => void;
  getNetlist: () => string;
  settings: Settings;
  onSettings: (s: Settings) => void;
}): ReactNode {
  const [open, setOpen] = useState<OverlayKey | null>(null);
  const [focus, setFocus] = useState<MenuFocus>('first');
  const examplesButton = useRef<HTMLButtonElement>(null);
  const exportButton = useRef<HTMLButtonElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const toolbarFocus = useToolbarFocus(toolbar);

  const toggle = (key: OverlayKey, how: MenuFocus = 'first'): void => {
    setFocus(how);
    setOpen((current) => (current === key ? null : key));
  };
  const close = (key: OverlayKey) => (isOpen: boolean) => {
    if (!isOpen) setOpen((current) => (current === key ? null : current));
  };
  // Menu buttons open with the arrow keys too, as a menu button should (ARIA APG).
  const menuKeys = (key: OverlayKey) => (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    setFocus(e.key === 'ArrowUp' ? 'last' : 'first');
    setOpen(key);
  };

  const runLabel = running ? (running.slow ? t('stop') : t('running')) : t('run');
  return (
    <>
      <div ref={toolbar} className="toolbar" role="toolbar" aria-label={t('toolbarLabel')} aria-orientation="horizontal" {...toolbarFocus}>
        <Button
          className={`button button--primary button--run${running?.slow ? ' button--stop' : ''}`}
          onPress={() => (running ? running.slow && onStop() : onRun())}
          aria-keyshortcuts="Control+Enter Meta+Enter"
        >
          {running?.slow ? <StopIcon /> : <RunIcon />}
          <span>{runLabel}</span>
        </Button>
        <Button
          ref={examplesButton}
          className="button button--tool"
          aria-haspopup="menu"
          aria-expanded={open === 'examples'}
          onPress={() => toggle('examples')}
          onKeyDown={menuKeys('examples')}
        >
          {t('examples')}
          <ChevronDown />
        </Button>
        <Button className="button button--tool" aria-haspopup="dialog" aria-expanded={open === 'share'} onPress={() => toggle('share')}>
          {t('share')}
        </Button>
        <Button
          ref={exportButton}
          className="button button--tool"
          aria-haspopup="menu"
          aria-expanded={open === 'export'}
          onPress={() => toggle('export')}
          onKeyDown={menuKeys('export')}
        >
          {t('export')}
          <ChevronDown />
        </Button>
        <Button className="button button--tool" aria-haspopup="dialog" aria-expanded={open === 'settings'} onPress={() => toggle('settings')}>
          {t('settings')}
        </Button>
        <Button className="button button--tool" aria-haspopup="dialog" aria-expanded={open === 'help'} onPress={() => toggle('help')}>
          {t('help')}
        </Button>
      </div>

      {/* Only the open overlay is mounted; its code may still be on its way (Suspense shows nothing). */}
      <Suspense fallback={null}>
        {open === 'examples' && <ExamplesMenu triggerRef={examplesButton} focus={focus} onOpenChange={close('examples')} onSelect={onExample} />}
        {open === 'export' && <ExportMenu triggerRef={exportButton} focus={focus} onOpenChange={close('export')} onExport={onExport} />}
        {open === 'share' && <ShareDialog onOpenChange={close('share')} getNetlist={getNetlist} />}
        {open === 'settings' && <SettingsDialog onOpenChange={close('settings')} settings={settings} onChange={onSettings} />}
        {open === 'help' && <HelpDialog onOpenChange={close('help')} />}
      </Suspense>
    </>
  );
}

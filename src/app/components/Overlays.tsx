/**
 * The menus and dialogs: the Examples and Export menus (React Aria Popovers anchored to their
 * buttons) and the Share, Settings and Help dialogs (modal). Their code is fetched when the browser
 * is idle after start-up (preloadOverlays) or on first use, so the first screen does not wait for it
 * (decision 0002). Only the open one is mounted; focus goes into it when it opens and back to what
 * opened it when it closes (React Aria's FocusScope).
 */
import { lazy, Suspense, type ReactNode, type RefObject } from 'react';
import type { ResultFont } from '../../notebook/index.ts';
import type { Settings } from '../settings.ts';

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

export type OverlayKey = 'examples' | 'export' | 'share' | 'settings' | 'help';
/** Which item a menu focuses when it opens: the last one after ArrowUp, else the first. */
export type MenuFocus = 'first' | 'last';
export type ExportKind = 'ngspice' | 'ltspice';

export interface OverlaysProps {
  open: OverlayKey | null;
  focus: MenuFocus;
  onClose: (key: OverlayKey) => void;
  examplesTrigger: RefObject<HTMLButtonElement | null>;
  exportTrigger: RefObject<HTMLButtonElement | null>;
  onExample: (id: string) => void;
  onExport: (kind: ExportKind) => void;
  /** The text a share link carries. */
  getShareText: () => string;
  settings: Settings;
  onSettings: (s: Settings) => void;
  font: ResultFont;
  onFont: (font: ResultFont) => void;
  /** The service worker has everything: the app works offline (Help says so). */
  offlineReady: boolean;
}

export function Overlays(p: OverlaysProps): ReactNode {
  const close = (key: OverlayKey) => (isOpen: boolean) => {
    if (!isOpen) p.onClose(key);
  };
  return (
    // Only the open overlay is mounted; its code may still be on its way (Suspense shows nothing).
    <Suspense fallback={null}>
      {p.open === 'examples' && <ExamplesMenu triggerRef={p.examplesTrigger} focus={p.focus} onOpenChange={close('examples')} onSelect={p.onExample} />}
      {p.open === 'export' && <ExportMenu triggerRef={p.exportTrigger} focus={p.focus} onOpenChange={close('export')} onExport={p.onExport} />}
      {p.open === 'share' && <ShareDialog onOpenChange={close('share')} getNetlist={p.getShareText} />}
      {p.open === 'settings' && <SettingsDialog onOpenChange={close('settings')} settings={p.settings} onChange={p.onSettings} font={p.font} onFont={p.onFont} />}
      {p.open === 'help' && <HelpDialog onOpenChange={close('help')} offlineReady={p.offlineReady} />}
    </Suspense>
  );
}

/**
 * The app's entry point (index.html loads it). Before the first paint it applies the remembered
 * display settings and the node colours' CSS, and decides which circuit to open (a share link,
 * the last netlist on this device, or the first example); then it renders the app.
 */
import '../styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { nodePaletteCss } from '../theme/nodes.ts';
import { App } from './App.tsx';
import { createEngine } from './engine.ts';
import { applySettings, loadSettings } from './settings.ts';
import { readStartup } from './startup.ts';

const settings = loadSettings();
applySettings(settings);

// --ps-node-1 ... 8 for the results tables and plots (the editor defines its own copy).
const palette = document.createElement('style');
palette.textContent = nodePaletteCss();
document.head.append(palette);

const startup = await readStartup();
const root = document.getElementById('app');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App startup={startup} engine={createEngine()} initialSettings={settings} />
    </StrictMode>,
  );
}

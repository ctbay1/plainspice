/**
 * Screenshots of Tarık's checkpoint (design/checkpoint/: the Notebook look on p02's circuits),
 * taken the way scripts/design-shots.ts takes the prototypes': a desktop window (1440 × 900 at 2×),
 * a laptop (1280 × 720 at 2×) and a phone (390 × 844 at 3×, touch; 390 × 500 with the keyboard up),
 * each state from the address, after ngspice has answered (the page sets
 * document.body.dataset.shotReady = '1').
 *
 *   node --experimental-strip-types scripts/checkpoint-shots.ts [--port 5320] [--only p02-4-open-solved]
 *
 * Writes docs/design/checkpoint/<state>-<device>.png, and p02-4-open-phone-views.png: the phone's two
 * views of the same circuit side by side (turned to fit, and as in the video), for Tarık to choose.
 * Starts its own Vite dev server. Fails when the page reports an error, when a word on the drawing is
 * wider than the room the schematic model kept for it (every [data-room] element), or when the page
 * scrolls sideways.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices } from '@playwright/test';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const port = Number(option('port', '5320'));
const only = option('only', '').split(',').filter(Boolean);

type Device = 'desktop' | 'laptop' | 'phone' | 'keyboard';

/** The states Tarık asked for (and those showing the design review's fixes), and which devices to take each on. */
const STATES: { name: string; hash: string; devices: Device[] }[] = [
  { name: 'p02-4-open-solved', hash: 'shot&circuit=p02-4-open', devices: ['desktop', 'phone'] },
  // A phone held upright turns a wide drawing to fit; this is the drawing as in the video, for comparison.
  { name: 'p02-4-open-as-drawn', hash: 'shot&circuit=p02-4-open&turn=0', devices: ['phone'] },
  { name: 'p02-5-short-solved', hash: 'shot&circuit=p02-5-short', devices: ['phone'] },
  { name: 'p02-3-F1-card', hash: 'shot&circuit=p02-3-dependent-only&select=F1&card=1', devices: ['desktop', 'phone'] },
  // The numbers moving: G1 changed from 0.25 to 0.3 A/V, the old values crossed out on the paper and on the card.
  { name: 'p02-4-open-G1-typing', hash: 'shot&circuit=p02-4-open&select=G1&card=1&value=0.3', devices: ['desktop'] },
  { name: 'p02-4-open-G1-typing', hash: 'shot&circuit=p02-4-open&select=G1&card=1&value=0.3&edit=1', devices: ['keyboard'] },
  { name: 'p02-4-open-R2-card', hash: 'shot&circuit=p02-4-open&select=R2&card=1&value=4', devices: ['laptop'] },
  // A trap and a run with no single answer, written on the paper in red pen.
  { name: 'p02-4-open-R1-trap', hash: 'shot&circuit=p02-4-open&select=R1&card=1&value=1M', devices: ['desktop'] },
  { name: 'p02-4-open-no-answer', hash: 'shot&circuit=p02-4-open&select=G1&card=1&value=0.5', devices: ['desktop'] },
  { name: 'p02-4-open-netlist', hash: 'shot&circuit=p02-4-open&panel=netlist', devices: ['desktop', 'phone'] },
  { name: 'p02-4-open-parts', hash: 'shot&circuit=p02-4-open&parts=1', devices: ['phone'] },
  { name: 'p02-4-open-plain-font', hash: 'shot&circuit=p02-4-open&font=plain', devices: ['desktop'] },
  { name: 'p02-4-open-palette', hash: 'shot&circuit=p02-4-open&palette=1', devices: ['desktop'] },
];

const PHONE = { ...devices['iPhone 13'], deviceScaleFactor: 3 };
const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  laptop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 },
  phone: { ...PHONE, viewport: { width: 390, height: 844 } },
  // A phone with its keyboard up: opened at full height, then the window cut to what is left above the keyboard.
  keyboard: { ...PHONE, viewport: { width: 390, height: 844 } },
} as const;
const KEYBOARD_UP = { width: 390, height: 508 };
const fileSuffix: Record<Device, string> = { desktop: 'desktop', laptop: 'laptop', phone: 'phone', keyboard: 'phone-keyboard' };

const outDir = resolve(root, 'docs/design/checkpoint');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ root, server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
let failures = 0;
try {
  for (const state of STATES) {
    if (only.length && !only.includes(state.name)) continue;
    for (const device of state.devices) {
      const context = await browser.newContext({ ...DEVICES[device], reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      const file = resolve(outDir, `${state.name}-${fileSuffix[device]}.png`);
      try {
        await page.goto(`http://localhost:${port}/design/checkpoint/#${state.hash}`, { waitUntil: 'load' });
        await page.waitForFunction(() => document.body.dataset.shotReady === '1', undefined, { timeout: 45_000 });
        await page.evaluate(() => document.fonts.ready);
        if (device === 'keyboard') {
          // The keyboard comes up (as on Android, where it shrinks the window; iOS keeps the window and
          // the page lifts the strip by visualViewport): the drawing fits again above the strip.
          await page.setViewportSize(KEYBOARD_UP);
          await page.waitForTimeout(700);
        }
        await page.waitForTimeout(250);
        await page.screenshot({ path: file });
        // Every word on the drawing fits the room the model kept for it; the page never scrolls sideways.
        const report = await page.evaluate(() => {
          const over: string[] = [];
          for (const el of document.querySelectorAll<SVGGraphicsElement>('.nb-ink [data-room]')) {
            const roomWidth = Number(el.getAttribute('data-room'));
            const width = el.getBBox().width;
            if (width > roomWidth + 0.5) over.push(`"${el.textContent}" ${width.toFixed(1)} > ${roomWidth}`);
          }
          return { over, sideways: document.documentElement.scrollWidth > window.innerWidth + 1, words: document.querySelectorAll('.nb-ink [data-room]').length };
        });
        if (report.over.length || report.sideways) {
          failures += 1;
          console.error(`NOT CLEAN ${state.name} ${device}: ${report.over.join('; ')}${report.sideways ? ' (the page scrolls sideways)' : ''}`);
        }
        if (errors.length) {
          failures += 1;
          console.error(`page errors in ${state.name} ${device}: ${errors.join(' | ')}`);
        }
        console.log(`wrote ${file} (${report.words} lines of words checked)`);
      } catch (error) {
        failures += 1;
        console.error(`FAILED ${state.name} ${device}: ${(error as Error).message.split('\n')[0]}${errors.length ? ` (page errors: ${errors.join(' | ')})` : ''}`);
      } finally {
        await context.close();
      }
    }
  }

  // The phone's two views of p02-4 side by side, captioned, for Tarık to choose between (decision 0015).
  if (!only.length || only.includes('p02-4-open-phone-views')) {
    const img = (name: string): string => `data:image/png;base64,${readFileSync(resolve(outDir, name)).toString('base64')}`;
    const context = await browser.newContext({ viewport: { width: 860, height: 960 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;padding:22px 24px;background:#efe9da;font:600 17px/1.35 system-ui,sans-serif;color:#1e2a45}
      .row{display:flex;gap:24px}
      figure{margin:0;flex:1}
      img{width:100%;border-radius:22px;box-shadow:0 8px 24px -10px rgb(30 42 69/.45);display:block}
      figcaption{margin:12px 4px 0}
      figcaption span{display:block;font-weight:500;font-size:14px;color:#3a4560}
    </style></head><body><div class="row">
      <figure><img src="${img('p02-4-open-solved-phone.png')}" alt=""><figcaption>Turned to fit<span>The whole circuit at a readable size; ground runs down the left.</span></figcaption></figure>
      <figure><img src="${img('p02-4-open-as-drawn-phone.png')}" alt=""><figcaption>As in the video<span>Opens at V1 and s; drag (or “more”) for the rest.</span></figcaption></figure>
    </div></body></html>`);
    await page.waitForTimeout(200);
    const file = resolve(outDir, 'p02-4-open-phone-views.png');
    await page.screenshot({ path: file, fullPage: true });
    console.log(`wrote ${file}`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures ? 1 : 0);

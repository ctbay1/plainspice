/**
 * Pictures to compare each example with its video: the video's drawing, drawn from the recording
 * (recorded.json, composed as plan.ts says: what the plan adds in magenta), next to the example in
 * the app at / on a computer (1280 × 800) and on a phone (Pixel 7: turned to fit, and as in the video).
 *
 *   node --experimental-strip-types scripts/video-drawings/pictures.ts [--only <id>] [--port 5361] [--out <dir>] [--dist <dir> [--reuse]] [--quick]
 *
 * Builds the app into a folder of its own (--dist, a temporary folder by default; --reuse serves a
 * build already there), serves it with vite preview on --port (5361 by default), opens each example
 * from the Examples menu, and writes docs/design/video/<id>.png (the pictures side by side). --quick
 * draws the model's scene itself instead of opening the app (no build, no server): for working on
 * the converter.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, devices, type Browser, type Page } from '@playwright/test';
import { build, preview } from 'vite';
import { t } from '../../src/i18n/index.ts';
import { notebookSchematic } from '../../src/notebook/schematic.ts';
import { SYMBOLS, type Scene } from '../../src/schematic/index.ts';
import { compose, convertAll, readRecording, type Conversion, type Video } from './convert.ts';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ------------------------------------------------------------------ the video's drawing (Manim units, y up)

type XY = readonly [number, number];
const ADDED = '#c0267a';
const INK = '#1e2a45';
const ABSENT = '#b9bec9';

/** The video's drawing as an SVG: wires, simple symbols the size the video draws them, part names on their label side, terminals and the node names it writes. */
export function videoSvg(v: Video, title: string): string {
  const S = 70;
  const pts: XY[] = [...v.parts.flatMap((p) => [p.p, p.q, ...(p.detached ? [p.detached.at] : [])]), ...v.absent.parts.flatMap((p) => [p.p, p.q]), ...v.wires.flatMap((w) => w.pts), ...v.grounds, ...v.labels.map((l) => l.at)];
  // Room for the words written beside points (about 0.14 units a letter at these sizes).
  const wordsOf = (l: Video['labels'][number]): string => (l.text === l.node || (l.text === 'b' && l.terminal) ? l.text : `${l.text} (${l.node} here)`);
  const reachLeft = Math.max(1.2, ...v.labels.filter((l) => l.dir === 'UL' || l.dir === 'LEFT' || l.dir === 'DL').map((l) => 0.4 + wordsOf(l).length * 0.14));
  const reachRight = Math.max(1.4, ...v.labels.filter((l) => l.dir === 'UR' || l.dir === 'RIGHT' || l.dir === 'DR').map((l) => 0.4 + wordsOf(l).length * 0.14));
  const x0 = Math.min(...pts.map((p) => p[0])) - reachLeft;
  const x1 = Math.max(...pts.map((p) => p[0])) + reachRight;
  const y0 = Math.min(...pts.map((p) => p[1])) - 0.9;
  const y1 = Math.max(...pts.map((p) => p[1])) + 1.0;
  const X = (x: number): number => (x - x0) * S;
  const Y = (y: number): number => (y1 - y) * S;
  const out: string[] = [];
  const line = (a: XY, b: XY, color = INK, w = 3): void => {
    out.push(`<line x1="${X(a[0]).toFixed(1)}" y1="${Y(a[1]).toFixed(1)}" x2="${X(b[0]).toFixed(1)}" y2="${Y(b[1]).toFixed(1)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`);
  };
  // Words on a halo of paper, so a line or a symbol drawn under them does not hide them.
  const text = (at: XY, s: string, anchor: 'start' | 'middle' | 'end', color = INK, size = 18): void => {
    out.push(
      `<text x="${X(at[0]).toFixed(1)}" y="${Y(at[1]).toFixed(1)}" font-size="${size}" text-anchor="${anchor}" dominant-baseline="central" fill="${color}" stroke="#fbf8f1" stroke-width="5" paint-order="stroke" font-family="sans-serif">${esc(s)}</text>`,
    );
  };
  const DIRS: Record<string, XY> = { UP: [0, 1], DOWN: [0, -1], LEFT: [-1, 0], RIGHT: [1, 0], UL: [-0.7, 0.7], UR: [0.7, 0.7], DL: [-0.7, -0.7], DR: [0.7, -0.7] };
  for (const w of v.wires) for (let i = 1; i < w.pts.length; i++) line(w.pts[i - 1]!, w.pts[i]!, w.source.startsWith('added') ? ADDED : INK);
  const all = [...v.parts.map((p) => ({ p, absent: false })), ...v.absent.parts.map((p) => ({ p, absent: true }))];
  for (const { p, absent } of all) {
    const color = absent ? ABSENT : p.source.startsWith('added') ? ADDED : INK;
    const dx = p.q[0] - p.p[0];
    const dy = p.q[1] - p.p[1];
    const len = Math.hypot(dx, dy);
    const u: XY = [dx / len, dy / len];
    const n: XY = [-u[1], u[0]];
    const mid: XY = p.centre ?? [(p.p[0] + p.q[0]) / 2, (p.p[1] + p.q[1]) / 2];
    const body = p.kind === 'R' ? 0.5 : p.kind === 'V' || p.kind === 'I' ? 0.36 : 0.44;
    const a: XY = [mid[0] - u[0] * body, mid[1] - u[1] * body];
    const b: XY = [mid[0] + u[0] * body, mid[1] + u[1] * body];
    line(p.detached ? p.detached.at : p.p, a, color);
    line(b, p.q, color);
    const at = (s: number, o: number): XY => [mid[0] + u[0] * s + n[0] * o, mid[1] + u[1] * s + n[1] * o];
    if (p.kind === 'R') {
      const zz: XY[] = [a];
      for (let i = 0; i < 6; i++) zz.push(at(-0.5 + (2 * i + 1) / 12, i % 2 ? -0.17 : 0.17));
      zz.push(b);
      out.push(`<polyline points="${zz.map((q) => `${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="miter"/>`);
    } else if (p.kind === 'V' || p.kind === 'I') {
      out.push(`<circle cx="${X(mid[0]).toFixed(1)}" cy="${Y(mid[1]).toFixed(1)}" r="${(0.36 * S).toFixed(1)}" fill="none" stroke="${color}" stroke-width="3"/>`);
    } else {
      const d = [at(-0.44, 0), at(0, 0.44), at(0.44, 0), at(0, -0.44)];
      out.push(`<polygon points="${d.map((q) => `${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="3"/>`);
    }
    if (p.kind === 'V' || p.kind === 'E') {
      const s = p.plus === 'p' ? -1 : 1;
      text(at(s * body * 0.5, 0), '+', 'middle', color, 17);
      text(at(-s * body * 0.5, 0), '−', 'middle', color, 17);
    } else if (p.kind === 'I' || p.kind === 'F') {
      const s = p.to === 'q' ? 1 : -1;
      const tail = at(-s * body * 0.6, 0);
      const head = at(s * body * 0.6, 0);
      line(tail, head, color, 2.5);
      const back = at(s * body * 0.15, 0.13);
      const back2 = at(s * body * 0.15, -0.13);
      out.push(`<polygon points="${[head, back, back2].map((q) => `${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join(' ')}" fill="${color}"/>`);
    }
    // The part's name on the side the video writes its value.
    const side = p.side;
    const off = body + 0.32;
    const lab: XY = [mid[0] + n[0] * side * off, mid[1] + n[1] * side * off];
    const anchor = Math.abs(n[0] * side) > 0.5 ? (n[0] * side > 0 ? 'start' : 'end') : 'middle';
    text(lab, p.name, anchor, color, 18);
  }
  for (const [gp, color] of [...v.grounds.map((q) => [q, INK] as const), ...v.absent.grounds.map((q) => [q, ABSENT] as const)]) {
    line(gp, [gp[0], gp[1] - 0.28], color);
    [0.27, 0.17, 0.07].forEach((w, k) => line([gp[0] - w, gp[1] - 0.28 - k * 0.1], [gp[0] + w, gp[1] - 0.28 - k * 0.1], color));
  }
  for (const l of v.labels) {
    const d = DIRS[l.dir]!;
    const color = l.source.startsWith('added') ? ADDED : l.terminal ? INK : '#5a6478';
    if (l.terminal) out.push(`<circle cx="${X(l.at[0]).toFixed(1)}" cy="${Y(l.at[1]).toFixed(1)}" r="${(0.085 * S).toFixed(1)}" fill="#fff" stroke="${INK}" stroke-width="2.5"/>`);
    const at: XY = [l.at[0] + d[0] * 0.32, l.at[1] + d[1] * 0.3];
    // A word that names another node in this netlist ("0" is n3 without ground, v_1 is n1) shows both.
    text(at, wordsOf(l), d[0] > 0.1 ? 'start' : d[0] < -0.1 ? 'end' : 'middle', color, l.terminal ? 20 : 17);
  }
  const w = (x1 - x0) * S;
  const h = (y1 - y0) * S;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(0)}" height="${(h + 34).toFixed(0)}" viewBox="0 -34 ${w.toFixed(1)} ${(h + 34).toFixed(1)}"><rect x="0" y="-34" width="100%" height="100%" fill="#fbf8f1"/><text x="8" y="-14" font-size="15" fill="#5a6478" font-family="sans-serif">${esc(title)}</text>${out.join('')}</svg>`;
}

// ------------------------------------------------------------------ the model's drawing, drawn simply (for --quick)

export function sceneSvg(scene: Scene, title: string): string {
  const S = 22;
  const b = scene.bounds;
  const x0 = b.x0 - 1;
  const y0 = b.y0 - 1;
  const w = (b.x1 - b.x0 + 2) * S;
  const h = (b.y1 - b.y0 + 2) * S;
  const X = (x: number): number => (x - x0) * S;
  const Y = (y: number): number => (y - y0) * S;
  const out: string[] = [];
  for (const wire of scene.wires) out.push(`<polyline points="${wire.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')}" fill="none" stroke="${INK}" stroke-width="2"/>`);
  const shape = (kind: keyof typeof SYMBOLS, at: { x: number; y: number }, rot: number, mirror: boolean): void => {
    for (const s of SYMBOLS[kind].shapes) {
      out.push(`<path d="${s.d}" transform="translate(${X(at.x)} ${Y(at.y)}) scale(${S}) rotate(${rot})${mirror ? ' scale(-1 1)' : ''}" fill="${s.fill ? INK : 'none'}" stroke="${s.fill ? 'none' : INK}" stroke-width="${2 / S}"/>`);
    }
  };
  for (const p of scene.parts) {
    shape(p.letter, p.at, p.rot, p.mirror);
    for (const m of p.marks) out.push(`<text x="${X(m.at.x)}" y="${Y(m.at.y)}" font-size="${0.7 * S}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif">${m.text}</text>`);
    for (const l of p.labels) {
      if (l.role === 'result') out.push(`<rect x="${X(l.box.x0)}" y="${Y(l.box.y0)}" width="${(l.box.x1 - l.box.x0) * S}" height="${(l.box.y1 - l.box.y0) * S}" fill="#e8f0e0"/>`);
      else out.push(`<text x="${X(l.x)}" y="${Y(l.y)}" font-size="${0.7 * S}" text-anchor="${l.align}" dominant-baseline="central" font-family="sans-serif" font-weight="${l.role === 'name' ? 600 : 400}">${esc(l.text)}</text>`);
    }
  }
  for (const g of scene.grounds) shape('ground', g.at, g.rot, false);
  for (const j of scene.junctions) out.push(`<circle cx="${X(j.x)}" cy="${Y(j.y)}" r="${0.18 * S}" fill="${INK}"/>`);
  for (const tm of scene.terminals) out.push(`<circle cx="${X(tm.at.x)}" cy="${Y(tm.at.y)}" r="${0.22 * S}" fill="#fff" stroke="${INK}" stroke-width="2"/>`);
  for (const l of scene.nodeLabels) {
    for (const line of l.lines) {
      if (line.role === 'result') out.push(`<rect x="${X(line.box.x0)}" y="${Y(line.box.y0)}" width="${(line.box.x1 - line.box.x0) * S}" height="${(line.box.y1 - line.box.y0) * S}" fill="#e0e8f4"/>`);
      else out.push(`<text x="${X(line.x)}" y="${Y(line.y)}" font-size="${0.7 * S}" text-anchor="${line.align}" dominant-baseline="central" font-family="sans-serif" fill="#2a56a8" font-weight="600">${esc(line.text)}</text>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(0)}" height="${(h + 34).toFixed(0)}" viewBox="0 -34 ${w.toFixed(1)} ${(h + 34).toFixed(1)}"><rect x="0" y="-34" width="100%" height="100%" fill="#ffffff"/><text x="8" y="-14" font-size="15" fill="#5a6478" font-family="sans-serif">${esc(title)}</text>${out.join('')}</svg>`;
}

// ------------------------------------------------------------------ the app

const RUN_TIMEOUT = 30_000;

async function openExample(page: Page, name: string): Promise<void> {
  await page.goto('./');
  await page.locator('.status').waitFor({ timeout: RUN_TIMEOUT });
  await page.getByRole('banner').getByRole('button', { name: new RegExp(`^${t('examples')}`) }).click();
  await page.getByRole('menu', { name: t('examplesMenu') }).getByRole('menuitem', { name, exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.status')?.getAttribute('data-tone')?.match(/^(ok|bad|paused)$/), undefined, { timeout: RUN_TIMEOUT });
  await page.waitForTimeout(600);
  // The pointer off the drawing (it rests where the menu item was, and a part under it shows hovered).
  await page.mouse.move(2, Math.round((page.viewportSize()?.height ?? 600) / 2));
  await page.evaluate(async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    await document.fonts.ready;
  });
}

async function shots(browser: Browser, base: string, c: Conversion, name: string, dir: string): Promise<{ desktop: string; turned?: string; drawn: string }> {
  const desktop = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await desktop.newPage();
  await openExample(page, name);
  const out: { desktop: string; turned?: string; drawn: string } = { desktop: join(dir, `${c.id}-desktop.png`), drawn: join(dir, `${c.id}-phone-drawn.png`) };
  await page.screenshot({ path: out.desktop, animations: 'disabled', caret: 'hide' });
  await desktop.close();
  const phone = await browser.newContext({ ...devices['Pixel 7'], baseURL: base, deviceScaleFactor: 1 });
  const small = await phone.newPage();
  await openExample(small, name);
  // The phone opens a wide drawing turned to fit when that reads better; the button shows the other view.
  const turn = small.locator('.turn-button');
  const label = (await turn.count()) ? await turn.textContent() : undefined;
  const turnedPath = join(dir, `${c.id}-phone-turned.png`);
  // Turned: the button offers the drawing as drawn ("As in the video" for a video's own drawing, which every example is).
  if (label === t('asInVideo') || label === t('asDrawn')) {
    out.turned = turnedPath;
    await small.screenshot({ path: turnedPath, animations: 'disabled', caret: 'hide' });
    await turn.click();
    await small.waitForTimeout(600);
    await small.screenshot({ path: out.drawn, animations: 'disabled', caret: 'hide' });
  } else {
    await small.screenshot({ path: out.drawn, animations: 'disabled', caret: 'hide' });
    if (label === t('turnToFit')) {
      out.turned = turnedPath;
      await turn.click();
      await small.waitForTimeout(600);
      await small.screenshot({ path: turnedPath, animations: 'disabled', caret: 'hide' });
    }
  }
  await phone.close();
  return out;
}

async function sideBySide(browser: Browser, file: string, panes: { title: string; svg?: string; png?: string }[]): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  const { readFileSync } = await import('node:fs');
  const cells = panes
    .map((p) => {
      const body = p.svg ?? `<img src="data:image/png;base64,${readFileSync(p.png!).toString('base64')}">`;
      return `<figure><figcaption>${esc(p.title)}</figcaption>${body}</figure>`;
    })
    .join('');
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:#e9e6df;font:14px sans-serif"><div id="row" style="display:flex;gap:14px;align-items:flex-start;padding:14px;width:max-content">${cells}</div><style>figure{margin:0}figcaption{color:#333;margin:0 0 6px;max-width:640px}img,svg{display:block;border:1px solid #bbb;background:#fff}</style></body></html>`,
  );
  await page.locator('#row').screenshot({ path: file });
  await page.close();
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename;
if (isMain) {
  const only = option('only', '');
  const quick = args.includes('--quick');
  const outDir = resolve(option('out', join(root, 'docs/design/video')));
  mkdirSync(outDir, { recursive: true });
  const rec = readRecording();
  const conversions = convertAll(rec, only || undefined);
  const manifest = JSON.parse((await import('node:fs')).readFileSync(join(root, 'examples/examples.json'), 'utf8')) as { examples: { id: string; name: string }[] };
  const browser = await chromium.launch();
  let server: Awaited<ReturnType<typeof preview>> | undefined;
  try {
    let base = '';
    const work = mkdtempSync(join(option('work', tmpdir()), 'video-pictures-'));
    if (!quick) {
      const dist = resolve(option('dist', join(work, 'dist')));
      if (!args.includes('--reuse')) await build({ root, logLevel: 'warn', build: { outDir: dist, emptyOutDir: true } });
      server = await preview({ root, logLevel: 'warn', build: { outDir: dist }, preview: { port: Number(option('port', '5361')), strictPort: true, open: false } });
      base = server.resolvedUrls?.local[0] ?? '';
      if (!base) throw new Error('vite preview gave no address');
    }
    for (const c of conversions) {
      const reference = videoSvg(compose(c.plan, rec), `In the video: ${c.plan.drawing}`);
      const file = join(outDir, `${c.id}.png`);
      if (quick) {
        const s = notebookSchematic(c.text);
        await sideBySide(browser, file, [
          { title: 'The video', svg: reference },
          { title: `PlainSpice’s drawing (k = ${c.k.toFixed(2)}): words and the room kept for results`, svg: sceneSvg(s.scene, c.id) },
        ]);
      } else {
        const name = manifest.examples.find((e) => e.id === c.id)!.name;
        const s = await shots(browser, base, c, name, work);
        await sideBySide(browser, file, [
          { title: 'The video (from the recording)', svg: reference },
          { title: 'PlainSpice on a computer (1280 × 800)', png: s.desktop },
          ...(s.turned ? [{ title: 'On a phone (Pixel 7), turned to fit', png: s.turned }] : []),
          { title: s.turned ? 'On a phone, “As in the video”' : 'On a phone (Pixel 7)', png: s.drawn },
        ]);
      }
      console.log(`wrote ${file}`);
    }
    writeFileSync(join(work, 'done'), '');
  } finally {
    await browser.close();
    await server?.close();
  }
}

/** src/notebook/fit.ts: the drawing fitted to the window, its words never too small to read. */
import { describe, expect, it } from 'vitest';
import { MIN_TEXT_PX, NO_INSETS, TYPE, fitView, minUnitFor, toGrid, toScreen, zoomAt } from '../../src/notebook/index.ts';

const box = { x0: -2, y0: -3, x1: 18, y1: 7 }; // 20 × 10 grid units
const size = { width: 1000, height: 600 };

describe('fitView', () => {
  it('fits the whole drawing, centred in the free part of the window', () => {
    const f = fitView(box, size, NO_INSETS, { padding: 20, minUnit: 5, maxUnit: 100 });
    expect(f.whole).toBe(true);
    expect(f.unit).toBeCloseTo((1000 - 40) / 20, 6);
    const tl = toScreen(f, { x: box.x0, y: box.y0 });
    const br = toScreen(f, { x: box.x1, y: box.y1 });
    expect(tl.x).toBeCloseTo(20, 6);
    expect(br.x).toBeCloseTo(980, 6);
    expect((tl.y + br.y) / 2).toBeCloseTo(300, 6);
  });

  it('keeps clear of what the page covers', () => {
    const insets = { top: 100, right: 300, bottom: 50, left: 120 };
    const f = fitView(box, size, insets, { padding: 0, minUnit: 1, maxUnit: 100 });
    const tl = toScreen(f, { x: box.x0, y: box.y0 });
    const br = toScreen(f, { x: box.x1, y: box.y1 });
    expect(tl.x).toBeGreaterThanOrEqual(120 - 1e-6);
    expect(br.x).toBeLessThanOrEqual(700 + 1e-6);
    expect(tl.y).toBeGreaterThanOrEqual(100 - 1e-6);
    expect(br.y).toBeLessThanOrEqual(550 + 1e-6);
  });

  it('never grows a small drawing past maxUnit', () => {
    expect(fitView({ x0: 0, y0: 0, x1: 2, y1: 1 }, size, NO_INSETS, { padding: 0, minUnit: 1, maxUnit: 40 }).unit).toBe(40);
  });

  it('keeps the words readable: too wide to fit, it keeps minUnit and shows the part that matters', () => {
    // A circuit 33 units wide (p02-4) on a phone: whole, its names would be about 7 px tall.
    const wide = { x0: -6, y0: -3.4, x1: 27.4, y1: 7 };
    const phone = { width: 390, height: 600 };
    const minUnit = minUnitFor();
    const focus = { x0: 19, y0: 0, x1: 27, y1: 6 };
    const f = fitView(wide, phone, NO_INSETS, { padding: 16, minUnit, maxUnit: 30, focus });
    expect(f.whole).toBe(false);
    expect(f.unit).toBe(minUnit);
    const a = toScreen(f, { x: focus.x0, y: focus.y0 });
    const b = toScreen(f, { x: focus.x1, y: focus.y1 });
    expect(a.x).toBeGreaterThanOrEqual(16 - 1e-6);
    expect(b.x).toBeLessThanOrEqual(390 - 16 + 1e-6);
    // No empty paper past the drawing's right end.
    expect(toScreen(f, { x: wide.x1, y: 0 }).x).toBeGreaterThanOrEqual(390 - 16 - 1e-6);
  });
});

describe('the smallest size', () => {
  it('keeps the smallest regular words at MIN_TEXT_PX pixels', () => {
    const unit = minUnitFor();
    const smallest = Math.min(TYPE.name.size, TYPE.node.size, TYPE.plain.size);
    expect(unit * smallest).toBeCloseTo(MIN_TEXT_PX, 6);
    expect(MIN_TEXT_PX).toBeGreaterThanOrEqual(10);
  });
});

describe('zoomAt', () => {
  it('keeps the point under the pointer still', () => {
    const v = { unit: 20, x: 100, y: 50 };
    const at = { x: 400, y: 300 };
    const before = toGrid(v, at);
    const z = zoomAt(v, 1.5, at, { minUnit: 5, maxUnit: 100 });
    expect(z.unit).toBe(30);
    const after = toGrid(z, at);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(zoomAt(v, 100, at, { minUnit: 5, maxUnit: 60 }).unit).toBe(60);
  });
});

describe('fitView, filling the height (a wide drawing on a phone, as in the video)', () => {
  const wide = { x0: -6, y0: -3.4, x1: 27.4, y1: 7 };
  const phone = { width: 390, height: 600 };

  it('is as tall as the window allows, within the limits, and starts at the drawing’s left end', () => {
    const f = fitView(wide, phone, NO_INSETS, { padding: 10, minUnit: minUnitFor(), maxUnit: 30, fill: 'height' });
    expect(f.unit).toBe(30);
    expect(f.whole).toBe(false);
    expect(toScreen(f, { x: wide.x0, y: 0 }).x).toBeCloseTo(10, 6);
    const free = fitView(wide, phone, NO_INSETS, { padding: 10, minUnit: minUnitFor(), maxUnit: 100, fill: 'height' });
    expect(free.unit).toBeCloseTo((600 - 20) / (wide.y1 - wide.y0), 6);
  });

  it('goes by the height alone (the page asks for it only for a drawing wider than the phone)', () => {
    const square = { x0: 0, y0: 0, x1: 10, y1: 10 };
    const f = fitView(square, phone, NO_INSETS, { padding: 10, minUnit: 5, maxUnit: 100, fill: 'height' });
    expect(f.unit).toBeCloseTo(58, 6);
    expect(f.whole).toBe(false);
    const whole = fitView(square, phone, NO_INSETS, { padding: 10, minUnit: 5, maxUnit: 100 });
    expect(whole.unit).toBeCloseTo(37, 6);
    expect(whole.whole).toBe(true);
  });
});

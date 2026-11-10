/**
 * End-to-end and accessibility tests (decision 0009): the built app (vite build), served by
 * `vite preview`, in Chromium, on a desktop and on a phone. Build first: `npm run build`, then
 * `npm run test:e2e`. CI builds in its own step; locally an already running preview on the same
 * port is reused. If there is no build at all, the server builds one first, so a first run works.
 *
 * Playwright is pinned to 1.63.0, whose Chromium is preinstalled in Claude's cloud sessions; CI
 * installs the same browser with `npx playwright install --with-deps chromium`.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env.CI);
/** Not 4173 (vite preview's default), which another server may already be using. */
const PORT = 4174;
const BASE_URL = `http://localhost:${PORT}/`;
const built = existsSync(resolve(import.meta.dirname, 'dist/index.html'));

export default defineConfig({
  testDir: 'tests/e2e',
  // Every test opens its own page and context, so they can all run side by side.
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // Each page runs its own ngspice (a Web Worker and 1.7 MB of WebAssembly): two at a time on a
  // shared CI runner, the default (half the cores) elsewhere.
  ...(CI ? { workers: 2 } : {}),
  timeout: 60_000,
  // A run, ngspice loading, a plot module arriving: allow for a slow, shared CI machine.
  expect: { timeout: 15_000 },
  reporter: CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      // Touch, a small screen and a phone's user agent; still Chromium (the only browser installed).
      name: 'phone',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: `${built ? '' : 'npx vite build && '}npx vite preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import optimizeLocales from '@react-aria/optimize-locales-plugin';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

/**
 * Ship the engine's licences and exact source next to ngspice.wasm on the site:
 *   engine/ngspice-<hash>.wasm         (emitted by Vite, see assetFileNames)
 *   engine/SOURCE.txt, build.sh, no-system.js, patches/, BUILDINFO.txt, COPYING.ngspice.txt, README.md
 *   engine/source/ngspice-47.tar.gz    (when scripts/fetch-ngspice-source.sh has fetched it; CI does)
 *   licenses/THIRD_PARTY_NOTICES.md, licenses/LGPL-2.1-or-later.txt, licenses/LICENSE.txt
 *   licenses/OFL-*.txt                 (the SIL Open Font License of each font in src/notebook/fonts/)
 * See THIRD_PARTY_NOTICES.md and docs/decisions/0005-license.md.
 */
function shipEngineSourceAndNotices(): Plugin {
  return {
    name: 'ship-engine-source-and-notices',
    apply: 'build',
    generateBundle() {
      const copy = (from: string, to: string): void => {
        const path = resolve(root, from);
        if (existsSync(path)) this.emitFile({ type: 'asset', fileName: to, source: readFileSync(path) });
      };
      copy('THIRD_PARTY_NOTICES.md', 'licenses/THIRD_PARTY_NOTICES.md');
      copy('LICENSES/LGPL-2.1-or-later.txt', 'licenses/LGPL-2.1-or-later.txt');
      copy('LICENSE', 'licenses/LICENSE.txt');
      // The fonts the Notebook look ships (src/notebook/fonts/), each under the SIL Open Font License 1.1.
      for (const f of readdirSync(resolve(root, 'src/notebook/fonts'))) if (/^OFL-.*\.txt$/.test(f)) copy(`src/notebook/fonts/${f}`, `licenses/${f}`);
      copy('engine/README.md', 'engine/README.md');
      copy('engine/build.sh', 'engine/build.sh');
      copy('engine/no-system.js', 'engine/no-system.js');
      copy('engine/BUILDINFO.txt', 'engine/BUILDINFO.txt');
      copy('engine/COPYING.ngspice', 'engine/COPYING.ngspice.txt');
      for (const p of readdirSync(resolve(root, 'engine/patches'))) copy(`engine/patches/${p}`, `engine/patches/${p}`);
      const build = readFileSync(resolve(root, 'engine/build.sh'), 'utf8');
      const pin = (key: string): string => new RegExp(`^${key}=(\\S+)`, 'm').exec(build)?.[1] ?? '?';
      const version = pin('NGSPICE_VERSION');
      const tarball = `.engine-work/download/ngspice-${version}.tar.gz`;
      const haveTarball = existsSync(resolve(root, tarball));
      if (haveTarball) copy(tarball, `engine/source/ngspice-${version}.tar.gz`);
      else this.warn(`${tarball} not found: run scripts/fetch-ngspice-source.sh to ship the engine source with the site`);
      this.emitFile({
        type: 'asset',
        fileName: 'engine/SOURCE.txt',
        source: [
          `Source of the simulation engine (ngspice-*.wasm in this folder)`,
          ``,
          `ngspice ${version}, compiled to WebAssembly with Emscripten by build.sh, with the patches in patches/.`,
          `ngspice is Modified BSD and contains numparam (GNU LGPL v2 or later): see COPYING.ngspice.txt`,
          `and ../licenses/THIRD_PARTY_NOTICES.md.`,
          ``,
          `Exact upstream source: ${haveTarball ? `source/ngspice-${version}.tar.gz (this site), also ` : ''}${pin('NGSPICE_URL')}`,
          `SHA-256: ${pin('NGSPICE_SHA256')}`,
          `Build files: build.sh, no-system.js, patches/, BUILDINFO.txt (here) and the engine/ folder of the project's repository.`,
          `How to rebuild it or use your own build: README.md.`,
          ``,
        ].join('\n'),
      });
    },
  };
}

/**
 * licenses/THIRD_PARTY_LICENSES.txt: the licence of every npm package that ends up in the
 * built JavaScript (minifying drops their comments, but MIT, ISC, BSD and Apache-2.0 all ask
 * that their notices travel with the code). Built from the chunks' module lists, so it names
 * exactly what ships, nothing that is only used to build or test.
 */
function shipDependencyLicences(): Plugin {
  const packages = new Map<string, string>(); // package dir -> name@version, across all builds
  return {
    name: 'ship-dependency-licences',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const id of output.moduleIds) {
          const m = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(id.replace(/^\0/, ''));
          if (!m?.[1] || packages.has(m[1])) continue;
          try {
            const pkg = JSON.parse(readFileSync(resolve(m[1], 'package.json'), 'utf8')) as { name?: string; version?: string };
            if (pkg.name) packages.set(m[1], `${pkg.name}@${pkg.version ?? '?'}`);
          } catch {
            // not a package root (e.g. a nested folder without package.json): skip
          }
        }
      }
      // The service worker (sw.js and workbox-*.js) is generated by Workbox outside this bundle, so
      // its modules are not in any chunk's list: name the Workbox packages it contains here.
      for (const name of ['workbox-core', 'workbox-precaching', 'workbox-routing', 'workbox-strategies']) {
        const dir = resolve(root, 'node_modules', name);
        if (packages.has(dir) || !existsSync(resolve(dir, 'package.json'))) continue;
        const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as { version?: string };
        packages.set(dir, `${name}@${pkg.version ?? '?'}`);
      }
      const sections = [...packages.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([dir, nameVersion]) => {
          const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as { license?: unknown; author?: unknown };
          const texts = readdirSync(dir)
            .filter((f) => /^(licen[cs]e|copying|notice)(\..*)?$/i.test(f))
            .sort()
            .map((f) => `--- ${f} ---\n${readFileSync(resolve(dir, f), 'utf8').trim()}`);
          const licence = typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? 'see the files below');
          return [`=== ${nameVersion} (${licence}) ===`, ...texts].join('\n\n');
        });
      this.emitFile({
        type: 'asset',
        fileName: 'licenses/THIRD_PARTY_LICENSES.txt',
        source: [
          'Licences of the open-source JavaScript packages bundled into PlainSpice.',
          'PlainSpice itself: MIT (LICENSE.txt). The simulation engine, ngspice: THIRD_PARTY_NOTICES.md.',
          '',
          ...sections,
          '',
        ].join('\n\n'),
      });
    },
  };
}

/**
 * The built pages' <head>, in production builds only (Vite's dev server needs inline scripts):
 *
 * - On the app page, a few lines that start downloading ngspice at once when the address is a
 *   "run=1" link (the channel's "Open this circuit" links): otherwise the 0.6 MB engine waits for
 *   the scripts, the first render and the Worker, and on a slow phone the results came about 2 s
 *   later (perf review 3). Only for run=1, so an ordinary visit's first screen is not slowed.
 * - A Content-Security-Policy (security review m1), as a <meta> because GitHub Pages sets no
 *   headers. Defence in depth: nothing from a link is ever put into the page as HTML. Styles need
 *   'unsafe-inline' (CodeMirror and React Aria add style elements and attributes), images data:
 *   (CodeMirror's underline), and WebAssembly 'wasm-unsafe-eval'; the inline script above is
 *   allowed by its hash. The other pages on the site (the engine check, the licences, and the design
 *   pages Tarık clicks, which write HTML with innerHTML) get the same policy without that hash: they
 *   share the app's origin, so its saved netlist and settings (security review F3).
 * - The spike and licences pages are not part of the installable app: vite-plugin-pwa's manifest
 *   link (relative, so a 404 there) is removed from them (security review m7), and from the design
 *   pages.
 */
function pageHead(): Plugin {
  /** The policy of every built page; `scriptHash` allows the app page's one inline script. */
  const policy = (scriptHash = ''): string =>
    [
      "default-src 'none'",
      `script-src 'self' 'wasm-unsafe-eval'${scriptHash}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self'",
      "manifest-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; ');
  /** The tags right after the charset (which must come first), before anything the policy covers. */
  const afterCharset = (html: string, tags: readonly string[]): string => html.replace(/(<meta charset="utf-8"\s*\/?>)/i, `$1\n    ${tags.join('\n    ')}`);
  return {
    name: 'plainspice-page-head',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const page = ctx.filename.replace(/\\/g, '/');
        if (/\/(spike|licenses)\/index\.html$/.test(page) || /\/design\//.test(page)) {
          const tags = [`<meta http-equiv="Content-Security-Policy" content="${policy()}" />`];
          return afterCharset(html, tags).replace(/\s*<link rel="manifest"[^>]*>/, '');
        }
        const files = Object.keys(ctx.bundle ?? {});
        const wasm = files.find((f) => /^engine\/ngspice-[\w-]+\.wasm$/.test(f));
        const worker = files.find((f) => /^assets\/worker-[\w-]+\.js$/.test(f));
        const lines: string[] = [];
        if (wasm && worker) {
          lines.push(
            `if(/(?:^#|&)run=1(?:&|$)/.test(location.hash)){` +
              `for(const[r,h,a]of[["preload","./${wasm}","fetch"],["prefetch","./${worker}",""]]){` +
              `const l=document.createElement("link");l.rel=r;l.href=h;if(a){l.as=a;l.type="application/wasm";l.crossOrigin="anonymous"}document.head.append(l)}}`,
          );
        } else {
          this.warn('the engine preload was left out: ngspice.wasm or the engine Worker is not in the bundle');
        }
        const script = lines.join(';');
        const hash = script ? ` 'sha256-${createHash('sha256').update(script).digest('base64')}'` : '';
        const tags = [`<meta http-equiv="Content-Security-Policy" content="${policy(hash)}" />`];
        if (script) tags.push(`<script>${script}</script>`);
        return afterCharset(html, tags);
      },
    },
  };
}

/**
 * Milestone 2's design prototypes (design/prototypes/<direction>/index.html, and design/index.html
 * comparing them), the schematic lab (design/lab/: every example drawn by the automatic layout) and
 * Tarık's checkpoint of the chosen look (design/checkpoint/: the Notebook canvas on p02's circuits):
 * built and deployed at /design/... so Tarık can click them, but not part of the app (no offline
 * cache, no manifest).
 */
function designPages(): Record<string, string> {
  const pages: Record<string, string> = {};
  const add = (key: string, file: string): void => {
    if (existsSync(resolve(root, file))) pages[key] = resolve(root, file);
  };
  add('design', 'design/index.html');
  add('design-lab', 'design/lab/index.html');
  add('design-checkpoint', 'design/checkpoint/index.html');
  const dir = resolve(root, 'design/prototypes');
  if (existsSync(dir)) for (const name of readdirSync(dir)) add(`design-${name}`, `design/prototypes/${name}/index.html`);
  return pages;
}

/** The installed app's theme and background colour (the same value as --paper in src/styles/app.css). */
const PAPER = '#F6F1E4';

/** Licence texts larger than this stay online-only: they are links, not part of the app. */
const OFFLINE_TEXT_LIMIT = 100_000;

/**
 * The installable, offline app (vite-plugin-pwa, Workbox generateSW). After the first visit the
 * service worker has the page, the scripts, the engine's Worker and ngspice.wasm, so a student can
 * simulate without a connection. Left out on purpose: the engine's source tarball (13 MB, a link on
 * the licences page) and big licence texts. 'prompt' (not 'autoUpdate'): a new version waits until
 * the student chooses to reload, so a reload never interrupts typing (src/app/pwa.ts shows the message).
 */
function offlineApp(): Plugin[] {
  return VitePWA({
    registerType: 'prompt',
    injectRegister: false, // registered by src/app/pwa.ts, only on the app page (not the spike or licences pages)
    // The icons and the manifest are found by globPatterns below (once each); the plugin adds the manifest.
    includeManifestIcons: false,
    manifest: {
      name: 'PlainSpice',
      short_name: 'PlainSpice',
      description: 'Real SPICE, explained in plain words: a beginner-first circuit simulator.',
      start_url: './',
      scope: './',
      display: 'standalone',
      lang: 'en',
      theme_color: PAPER,
      background_color: PAPER,
      icons: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
    },
    workbox: {
      // The Notebook's fonts (src/notebook/fonts/, about 400 kB) too, so the page looks the same
      // offline; not the design prototypes' own fonts.
      globPatterns: [
        '**/*.{html,js,css,wasm,svg,png}',
        'assets/{inter,caveat,notebook-serif,jetbrains-mono}-*.woff2',
        'engine/*.{txt,md,sh}',
        'engine/patches/*',
        'licenses/*.{md,txt}',
      ],
      // The spike page is a check for developers, not part of the app: not worth 40 kB offline. Nor are
      // the design pages, or the screenshots they show (assets/*.png, about 9 MB: the app's own
      // images are the icons, in icons/).
      globIgnores: ['engine/source/**', 'spike/**', 'assets/spike-*', 'design/**', 'assets/design-*', 'assets/*.png'],
      // Files with a content hash in their name never change, so the service worker may take them
      // from the HTTP cache: a first visit then downloads ngspice.wasm once, not twice (perf review 2;
      // without this Workbox fetches every revisioned file again with cache: 'reload').
      dontCacheBustURLsMatching: /-[\w-]{8}\.(?:js|css|wasm|woff2)$/,
      // ngspice.wasm is about 1.7 MB before compression; Workbox's default limit is 2 MiB.
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      manifestTransforms: [
        (entries) => {
          const seen = new Set<string>();
          return {
            // Each file once (the icons also come from the manifest), and no big licence texts.
            manifest: entries.filter((e) => {
              if (seen.has(e.url) || (/^licenses\/.*\.txt$/.test(e.url) && e.size > OFFLINE_TEXT_LIMIT)) return false;
              seen.add(e.url);
              return true;
            }),
            warnings: [],
          };
        },
      ],
      // Share links live in the fragment, so every link opens the same index.html.
      navigateFallback: 'index.html',
      navigateFallbackDenylist: [/\/spike\//, /\/licenses\//, /\/engine\//],
      cleanupOutdatedCaches: true,
    },
  });
}

export default defineConfig({
  // Relative asset URLs, so the build works at any path (GitHub Pages serves it under /<repo>/).
  base: './',
  plugins: [
    react(),
    // Only the en-US and tr-TR strings of React Aria ship (decision 0002).
    optimizeLocales.vite({ locales: ['en-US', 'tr-TR'] }),
    shipEngineSourceAndNotices(),
    shipDependencyLicences(),
    offlineApp(),
    pageHead(),
  ],
  build: {
    target: 'es2022',
    // A font is always its own file, never a data: URL in the CSS (Vite inlines files under 4 kB): the
    // pages' policy allows fonts only from the site itself ("font-src 'self'", pageHead above), and a
    // design prototype's small symbol fonts were blocked as data: URLs (security review F3).
    assetsInlineLimit: (file) => (/\.woff2?$/i.test(file) ? false : undefined),
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        spike: resolve(root, 'spike/index.html'),
        licenses: resolve(root, 'licenses/index.html'),
        ...designPages(),
      },
      output: {
        // Keep the engine in engine/, next to its source and notices.
        assetFileNames: (asset) =>
          asset.names.some((n) => n.endsWith('.wasm')) ? 'engine/[name]-[hash][extname]' : 'assets/[name]-[hash][extname]',
      },
    },
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        assetFileNames: (asset) =>
          asset.names.some((n) => n.endsWith('.wasm')) ? 'engine/[name]-[hash][extname]' : 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: {
    projects: [
      {
        extends: true,
        // .test.tsx: the app's React tests (each sets "// @vitest-environment jsdom" itself).
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'], environment: 'node' },
      },
      {
        extends: true,
        test: { name: 'golden', include: ['tests/golden/**/*.test.ts'], environment: 'node', testTimeout: 60_000, hookTimeout: 120_000 },
      },
    ],
  },
});

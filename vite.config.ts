import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

/**
 * Ship the engine's licences and exact source next to ngspice.wasm on the site:
 *   engine/ngspice-<hash>.wasm         (emitted by Vite, see assetFileNames)
 *   engine/SOURCE.txt, build.sh, patches/, BUILDINFO.txt, COPYING.ngspice.txt, README.md
 *   engine/source/ngspice-47.tar.gz    (when scripts/fetch-ngspice-source.sh has fetched it; CI does)
 *   licenses/THIRD_PARTY_NOTICES.md, licenses/LGPL-2.1-or-later.txt, licenses/LICENSE.txt
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
      copy('engine/README.md', 'engine/README.md');
      copy('engine/build.sh', 'engine/build.sh');
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
          `Build files: build.sh, patches/, BUILDINFO.txt (here) and the engine/ folder of the project's repository.`,
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

export default defineConfig({
  // Relative asset URLs, so the build works at any path (GitHub Pages serves it under /<repo>/).
  base: './',
  plugins: [shipEngineSourceAndNotices(), shipDependencyLicences()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        spike: resolve(root, 'spike/index.html'),
        licenses: resolve(root, 'licenses/index.html'),
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
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: { name: 'golden', include: ['tests/golden/**/*.test.ts'], environment: 'node', testTimeout: 60_000, hookTimeout: 120_000 },
      },
    ],
  },
});

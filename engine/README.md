# The simulation engine: ngspice 47 in WebAssembly

`dist/ngspice.wasm` and `dist/ngspice.mjs` are **ngspice 47**, compiled to WebAssembly with
Emscripten 7.0.0 by [`build.sh`](build.sh). Why we build our own, and the evidence:
[decision 0003](../docs/decisions/0003-ngspice-to-webassembly.md). Licences:
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) (ngspice is Modified BSD; it contains
numparam, LGPL v2 or later).

| File | What it is |
|---|---|
| `build.sh` | the whole build: pinned emsdk and ngspice tarball, patches, configure, link |
| `patches/*.patch` | our four source changes, each explained in the file |
| `no-system.js` | linked in with `--js-library`: `system()` refuses everywhere, so a netlist's `shell` or `gnuplot` command never starts a program (see below) |
| `BUILDINFO.txt` | versions, flags, features compiled in, SHA-256 of the outputs |
| `COPYING.ngspice` | ngspice's licence statement, verbatim |
| `dist/ngspice.mjs` | Emscripten's ES-module glue (default export: `createNgspice`) |
| `dist/ngspice.wasm` | ngspice itself |
| `dist/ngspice.d.mts` | TypeScript types for the glue (hand-written) |

## What is in it

The ngspice core with its classic device models: R, C, L and coupling (K), V, I, E, F, G, H,
B sources, diodes, BJTs (Gummel-Poon and VBIC), JFETs, MOSFETs levels 1, 2, 3, 6 and 9,
VDMOS, MESFETs, HFETs, switches, and lossless, RC and coupled lines. Left out (see the
`REMOVED_MODELS` list in `build.sh`): the chip-design transistor models (BSIM, HiSIM, SOI,
HICUM) and LTRA/JFET2, because their source carries terms other than ngspice's Modified BSD
or code without a licence grant, and first- and second-year circuits never need them. A
netlist that uses one gets ngspice's own error ("Device type ... not supported by this
binary", or "could not find a valid modelname" for a `level=` that maps to one).

## How the app uses it

ngspice runs exactly as on the command line in batch mode, one fresh instance per simulation
(`src/engine/ngspice.ts`):

1. compile `ngspice.wasm` once (`WebAssembly.compile`), then for each run call
   `createNgspice({ noInitialRun: true, print, printErr, instantiateWasm })`;
2. write files into Emscripten's in-memory file system: the netlist at `/circuit.cir`, a
   small `spinit` at `/usr/local/share/ngspice/scripts/spinit`, and `/proc/meminfo` and
   `/proc/self/statm` (read by ngspice's resource report);
3. `callMain(['-b', '-r', '/out.raw', '/circuit.cir'])`, i.e. `ngspice -b -r out.raw circuit.cir`;
4. read `/out.raw` (binary rawfile, float64) and the captured stdout/stderr.

The interface is therefore just the command line, a file in, a file out. Any `ngspice.wasm`
built from ngspice's sources with the same Emscripten settings works in its place.

A netlist is data, never a program to run on the machine: `.control` blocks run, but nothing
in them can start a program, because `system()` refuses. `shell echo hi` prints
`Unable to execute "echo hi".` and the block carries on; `gnuplot` starts nothing. In a browser
that is Emscripten's default; under Node (the tests and scripts) its default would hand the
command to a shell, so `no-system.js` replaces it (`tests/golden/engine-no-shell.test.ts`).
Native ngspice has no such guard: record only netlists you trust with `scripts/record-native.ts`.

## Rebuild it

On Linux with git, python3, curl, autoconf, automake, libtool, bison and make:

```bash
npm run engine:build
```

The script downloads Emscripten 7.0.0 and `ngspice-47.tar.gz` (checked against its SHA-256),
applies the patches, builds in `.engine-work/` (git-ignored), and writes `dist/` and
`BUILDINFO.txt`. Then check the result against native ngspice:

```bash
npm run test:golden
```

## Use your own build (for example with a modified numparam)

1. Change the ngspice sources: add a patch to `patches/` (or edit `build.sh` to point at your
   source tree) and run `npm run engine:build`.
2. Run the app locally with your engine: `npm ci && npm run build && npm run preview`.
3. The service worker (once the app is a PWA) caches the old engine: unregister it or
   hard-reload after swapping the file.

## Upgrading ngspice

Change `NGSPICE_VERSION`, `NGSPICE_URL` and `NGSPICE_SHA256` in `build.sh`, rebuild, re-record
native results with the same ngspice version (`npm run record:native -- --ngspice /path/to/ngspice`),
run the golden tests, and update `docs/spice-facts/` where ngspice's behaviour changed.

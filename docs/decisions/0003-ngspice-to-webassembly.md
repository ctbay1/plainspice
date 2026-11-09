# 0003. ngspice in WebAssembly: our own pinned build of ngspice 47

- Status: accepted
- Date: 2026-11-09
- Evidence: the research notes summarised below. Every number here was measured in this
  repository's environment, and the fixture results are reproducible with `npm run test:golden`.

## Context

The engine is ngspice, compiled to WebAssembly and run in a Web Worker. Tarık's brief: check
existing builds (EEcircuit's, wokwi/ngspice-wasm) and their licences before building our own
with Emscripten, and match the native ngspice command line to 6 significant figures.

What the engine must do for us:

- run `.op`, `.tf`, `.dc` and `.tran` and return every vector at full precision;
- run in a module Web Worker (the page never freezes) and in Node 22 (golden tests run the
  exact code the page runs);
- be small enough for a phone and a PWA cache, and be a separate, replaceable `.wasm` file
  (licence: see 0005);
- report ngspice's errors and warnings faithfully (beginners' circuits fail often, and
  ngspice sometimes prints numbers after its DC solution failed);
- be reproducible: a pinned ngspice version and toolchain, so a golden test means something.

## Options

| | eecircuit-engine 1.9.0 (npm, MIT wrapper) | wokwi/ngspice-wasm (MIT scripts) | other builds | **our own build** |
|---|---|---|---|---|
| ngspice | **45.2**, not 47: its tag regex `^ngspice-[0-9]+\.[0-9]+$` skips `ngspice-46`/`-47` | `minimal-ngspice` branch = ngspice 38, **no E/F/G/H sources** | DSchem 47.2 (4 days old, "temporary"), PhET (stripped 45-era), EasyEDA 46, TurboSpice 47 (GPL-3.0) | **47** (release tarball, sha256-pinned) |
| Toolchain | `emsdk install latest`, `ubuntu:latest` (unpinned) | breaks on emsdk ≥ 4.0.6 | mixed | **emsdk 7.0.0, pinned commit** |
| How it runs | interactive program fed through `window.prompt` + ASYNCIFY | interactive + ASYNCIFY | shared library or interactive | **batch mode, like the CLI**: `ngspice -b -r /out.raw /circuit.cir` |
| Download | **19.4 MiB** single `.mjs` (5.38 MiB gzip, 3.57 MiB brotli): wasm inlined as base64 *twice* + 3.8 MiB of chip-process model cards | no artifact published | 2.0–24 MB | **4.42 MB `.wasm` (1.51 MB gzip, 1.00 MB brotli) + 74 kB glue**, separate files |
| Failure modes found | `runSim()` never settles on a non-ASCII title (string index used as byte offset), on a fatal error, or on `quit`; one live instance per page; heap grows ~28 KiB per run | n/a | not run (session policy) | fresh instance per run; a crash or `exit()` ends only that run |
| Licence notices shipped | none (labelled MIT; contains LGPL numparam and KLU) | n/a | varies | BSD + LGPL notices, source and patches (0005) |
| Fixture results | bit-identical to native 42 (57/57 checks) | n/a | n/a | **bit-identical to native 47 on every vector of every fixture** |

EEcircuit-engine works and its numbers are right; it is a good reference. It is not a good
foundation for a beginner tool that must not hang on an ordinary mistake, must fit on a phone,
and must say exactly which ngspice it runs.

Downloads were not blocked here: emsdk 7.0.0 came from github.com and storage.googleapis.com,
ngspice-47.tar.gz from SourceForge. So Tarık's fallback rule ("if a toolchain download is
blocked, use a prebuilt build") did not apply.

## Decision

Build ngspice 47 ourselves with `engine/build.sh` and commit the outputs to `engine/dist/`:

- **Pinned inputs**: emsdk 7.0.0 (commit `1693ce73`), `ngspice-47.tar.gz`
  (sha256 `894e6496…f675f`), three small patches in `engine/patches/`:
  1. `cktsopt.c`: ngspice 47 does not compile with `--disable-xspice` (`OPT_ENH_RSHUNT`
     is used outside `#ifdef XSPICE`; fixed upstream after 47).
  2. `inpgmod.c`: musl's `strtod` sets `errno` when nothing is converted, which made an
     unknown model parameter a fatal exit in WebAssembly (native ngspice only warns).
  3. `get_avail_mem_size.c`: report 1 GiB available instead of 0 (no `/proc` at run time),
     so `.tran` does not warn about memory on every run.
  The C++ HICUM2 transistor model is removed (it needs libstdc++ and an MPL-2.0 header).
- **Configure**: `--disable-xspice --disable-osdi --disable-klu --disable-openmp
  --with-x=no --with-readline=no --with-editline=no --disable-debug`. Compiled in: the
  ngspice core (Modified BSD), numparam (LGPLv2+, always), Sparse 1.3 (MIT-like solver,
  ngspice's default anyway).
- **Run like the command line**: the glue is an ES module (`MODULARIZE`, `EXPORT_ES6`,
  `ENVIRONMENT=web,worker,node`, `INVOKE_RUN=0`, no ASYNCIFY). Each run writes the netlist
  to an in-memory file system and calls `callMain(['-b','-r','/out.raw','/circuit.cir'])`;
  the binary rawfile gives every vector as a float64. `src/engine/ngspice.ts` does this and
  is shared by the Worker (`src/engine/worker.ts`) and the golden tests.
- **Fresh instance per run**: the `.wasm` is compiled once; each run instantiates it again
  (1–8 ms in Node). Re-using an instance fails (`main: Internal Error: jump to zero`), because
  ngspice's `main()` keeps global state.
- **Messages**: stdout and stderr are classified (`src/engine/diagnostics.ts`). A run whose
  DC solution failed (`singular matrix`, gmin/source stepping failed, "transient op" fallback)
  is marked `unreliable`: ngspice still prints numbers, and they can be wrong (native runs
  gave 0.0887 V for a node that is 3 V at DC).
- **Timeouts**: the page's `EngineClient` terminates the Worker after 20 s (configurable)
  and starts a fresh one; the user gets a Stop button.

## Evidence

- Fixtures (`tests/fixtures/`): every `.op`, `.tf` and `.dc` vector is bit-identical to
  native ngspice 47 and to Ubuntu's ngspice 42; `.tran` (T1) is bit-identical to 47 (520
  points), while 42 uses a different time grid (519 points, ngspice 46 changed breakpoint
  handling), so `.tran` is compared with 47 and with the exact formula. `npm run
  test:golden`: 53 checks.
- Sizes: `-O2` 4,417,373 B (gzip 1,509,962 / brotli 1,004,608); `-Oz` 4,114,697 B (gzip
  1,472,712), only 2.5 % smaller compressed and slower, so we ship `-O2`.
- Speed (Node 22): compile 13 ms, instantiate 1–8 ms, run 2–23 ms per fixture. In headless
  Chromium the spike page ran all 10 fixtures through the Worker in about 0.1 s.

## Consequences

- We maintain a build script. Moving to a new ngspice: change the pins, `npm run
  engine:build`, `npm run record:native` with the matching native ngspice, `npm run
  test:golden`, and update `docs/spice-facts.md` where behaviour changed.
- Not available in this build: XSPICE (`A` devices, digital, `POLY()` sources), OSDI
  (Verilog-A), `.options klu`, HICUM2, CIDER. None is needed for first- and second-year
  circuits; each would change the licence mix (0005).
- Batch mode skips `.meas` when writing a rawfile (ngspice says so on stderr); if we need
  `.meas` later we add a `.control` block path or the shared-library API.
- The download can shrink further by removing chip-design device models (BSIM, HiSIM, SOI…)
  as PhET did (2.0 MB raw, 0.69 MB gzip); worth doing once the app's own size is known.
- `eecircuit-engine` stays a comparison baseline in the research notes, not a dependency.

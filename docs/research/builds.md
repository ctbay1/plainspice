# ngspice → WebAssembly: survey of builds other than eecircuit-engine

Date: 2026-11-09. Scope: every ngspice-to-wasm build I could find on npm and GitHub, other than `eecircuit-engine` (which is only used here as a baseline), plus upstream ngspice 47's own Emscripten support, the known working recipes, and what building our own would take.

Paths below are relative to the scratchpad `<scratch>/` unless they are absolute.

## 0. Method and limits

- **npm**: `npm search ngspice`, 20 queries against `https://registry.npmjs.org/-/v1/search` (ngspice, "spice wasm", "ngspice wasm", "spice webassembly", "ngspice emscripten", "spice emscripten", "circuit simulator wasm", "spice simulator", "ngspice-wasm", libngspice, sharedspice, eesim, spice.wasm, xspice, `keywords:ngspice`, ...), plus `npm view` on every hit and on 12 likely names (all E404 except the ones below). Raw results: `research/builds-data/npm-*.json`, `npmview-*.json`.
- **GitHub**: `gh api -X GET search/repositories` (ngspice wasm / webassembly / emscripten, "spice wasm simulator", eesim, eecircuit, forks) and `search/code` (`emconfigure ngspice`, `ngspice ASYNCIFY`, `with-ngshared emcc`, `ngSpice_Init EXPORTED_FUNCTIONS`, `ngspice emmake`, `sharedspice emscripten`, `ngspice-sf-mirror`, `eesim_sleep_hack`). Raw results: `research/builds-data/gh-*.json`. Repos were read through shallow or blobless clones in `src/<owner>_<repo>` and through raw.githubusercontent.com (`src/raw_<owner>_<repo>/`).
- **Static inspection only of third-party binaries.** Running `@o.z/ngspice-wasm` in Node was denied by this session's permission policy ("Code from External"), so I did not execute any third-party JS/wasm. Every prebuilt wasm was parsed as data with my own scripts (`research/builds-scripts/wasm_inspect.py`: sections, exports, memory limits, gzip size; `device_check.py`: which device models are linked in; `wasm_strings.py`).
- **Own verification runs** (my own code or the native CLI): gcc syntax check of ngspice 47's `cktsopt.c` with/without XSPICE; a 15-line C program compiled with emcc 7.0.0 and run in Node 22 to check musl `strtod`; native ngspice 42 runs on an unknown model parameter, output precision, and `.tf` vectors (§9).
- **Blocked here**: api.github.com and github.com web pages (403), so **GitHub release assets could not be listed** for any repo (tags were checked with `git ls-remote`); git.code.sf.net (CONNECT 403, so recipes that clone from SourceForge git cannot run in this environment); *.github.io and jsdelivr (so DSchem's, TurboSpice's and Pyodide's hosted copies could not be fetched; DSchem's files were read from the repo instead). The GitHub MCP tools are limited to ctbay1/circuit-sim and ctbay1/solved-circuits.

## 1. Bottom line

1. **There is no second mature, npm-published ngspice-wasm.** Apart from eecircuit-engine, npm has one ngspice wasm package, `@o.z/ngspice-wasm@0.0.0` (one version, 2026-05-27, BSD-3 claimed with a placeholder licence file). It exports only `main`, despite what its README says. `@tscircuit/ngspice-spice-engine` downloads a fork of eecircuit-engine from tscircuit's own CDN at runtime.
2. **The field has split into two architectures.**
   - (A) **The EEsim lineage** compiles the interactive `ngspice` program, uses ASYNCIFY so it can wait for commands, and reads results from files or stdout. Members: danchitnis/ngspice emcc 2020, EEsim, wokwi, aminemahd13, eecircuit-engine, PhET and the tscircuit fork.
   - (B) **The shared-library lineage** builds `--with-ngshared` (libngspice: `ngSpice_Init / ngSpice_Circ / ngSpice_Command / ngGet_Vec_Info`). It needs no ASYNCIFY, runs `run` synchronously inside a Web Worker, and returns `double` vectors directly. Members: Pyodide's libngspice, ejkreboot, EasyEDA, spice3d, TurboSpice, circuitoon and DSchem. physbox-io/volt moved from A to B and explains why: ASYNCIFY "instruments the whole binary" and `ngSpice_Command()` returns when the command is done (`src/raw_physbox-io_volt/...build-wasm.sh:18-20`).
   - **B is the right shape for us.** It works in a Worker and in Node 22, gives full-precision results without parsing text, and avoids ASYNCIFY's size and speed cost.
3. **wokwi/ngspice-wasm is not usable.** It builds the `minimal-ngspice` branch (ngspice 38 base, 2022). That branch contains only R, C, L/K, V, I, D, Q and MOS1: no E/F/G/H/B. I checked the branch's `src/spicelib/devices/` and the device strings in the aminemahd13 binary built from it. The recipe also fails on any emsdk ≥ 4.0.6 (it passes the removed `EXTRA_EXPORTED_RUNTIME_METHODS`). It targets web/worker only, publishes no artifact, and has had one commit (2022-11-01).
4. **Best prebuilt for a spike, if we do not build our own:** DSchem's **ngspice 47.2** build in `fiumad/dschem-sky130-models` (`ngspice/47.2/ngspice.{mjs,wasm}`, commit `df63d97f…`, wasm sha256 `11dea244…`, 4.89 MB raw / 1.64 MB gzip).
   - It is the only prebuilt of ngspice **47** with the shared-library API, `ENVIRONMENT=web,worker,node`, a sha256-pinned source tarball (identical to our local `ngspice-47.tar.gz`), a pinned Emscripten (6.0.13) and an Apache-2.0 repo.
   - Caveats: the repo is 4 days old and calls these builds "Temporary", it has one maintainer, it is not on npm, and the build includes LGPL KLU.
   - Vendor the two files by commit and sha256, and keep eecircuit-engine as the comparison baseline (§8).
5. **Building our own is small and well charted.** It is a pinned shared-library build of the ngspice 47 tarball with about 3 small patches and an explicit export list: roughly 100–150 lines of bash plus a CI job. Expect about 4.9 MB raw / 1.6 MB gzip with all devices, and about 2 MB raw / 0.7 MB gzip with PhET-style device stripping and `-Os` (PhET's measured result). Three ngspice-47 pitfalls are verified in §5.3 and §9:
   - `--disable-xspice` does not compile;
   - musl's `strtod` turns an unknown model parameter into a fatal exit;
   - `/proc/meminfo` is detected on the build host but missing at runtime.

## 2. Comparison table

### 2a. Facts

| # | Candidate | Licence of scripts / artifact | ngspice | Build method, toolchain pin | Mode | Prebuilt artifact (raw / gzip -9 of wasm) | Last activity | Maintainer(s) |
|---|---|---|---|---|---|---|---|---|
| 1 | **wokwi/ngspice-wasm** | MIT (© 2020 D. Chitnis, 2022 U. Shaked) | `minimal-ngspice` branch (v38 base) | Docker `ubuntu:22.04` + emsdk `latest` (unpinned); clones git.code.sf.net | Interactive exe + ASYNCIFY | none (`build/` gitignored; not on npm) | 1 commit, 2022-11-01 | Uri Shaked (Wokwi) |
| 2 | aminemahd13/ngspice-wasm | MIT (copied from wokwi) | `minimal-ngspice` | wokwi recipe + `bool.h` patch, modern `-s` flags; emsdk `latest` | Interactive exe + ASYNCIFY | committed `build/spice.wasm` 1,773,158 B / 590,100 B | 3 commits, 2025-08-18 | Amine Mahdane |
| 3 | **z-wasm/ngspice-wasm = npm `@o.z/ngspice-wasm`** | claims BSD-3-Clause, but `LICENSE` is a placeholder ("[Full BSD-3 text...]"); GitHub: NOASSERTION | 46 (tag `ngspice-46` per `builder.sh`) | local `builder.sh`, emsdk "latest"; CI publishes the committed file **without building** | Batch exe (only `_main` exported, no ASYNCIFY) | npm 0.0.0: `ngspice.js` 7,211,245 B (SINGLE_FILE, base64) = wasm 5,347,411 / 1,795,936 B; 256 MiB initial heap | 1 commit, 1 version, 2026-05-27 | "Zero Red" (npm: z-nerd, zero.red.dev) |
| 4 | ejkreboot/ngspice-xspice-wasm | MIT (stated in README only; no LICENSE file) | mirror `master` at build time (unpinned) | Docker `emscripten/emsdk:3.1.50` (pinned tag) | Shared lib, `MAIN_MODULE=1` + XSPICE `.cm` side modules; worker + client JS | committed `dist/ngspice-lib.wasm` 24,313,865 / 11,447,526 B (8,077 exports); fixed 256 MiB memory | 7 commits, 2026-01-30 → 2026-04-04 | Eric J. Kort |
| 5 | pyodide-recipes `libngspice` | recipe repo MPL-2.0; artifact labelled BSD-3 (includes LGPL KLU/numparam, XSPICE) | 46 (mirror zip, sha256 pinned) | Pyodide build system; Emscripten fixed by pyodide-build (Pyodide 314: `emscripten_5_0_3`) | Shared lib as Pyodide side module + XSPICE | `libngspice-46.zip` in Pyodide 314.0.7 (lock sha256 `642ba32a…`; size not measured, CDN blocked) | 2025-07-24 → 2026-07-22 | Pepijn de Vos |
| 6 | PhET (phetsims/sherpa `lib/ngspice-wasm-2025.js`) | ngspice BSD + Emscripten glue MIT; built from eecircuit-engine (MIT) + `phet-ngspice-build.patch` | `pre-master-46` | eecircuit-engine Docker (`ubuntu:latest`, emsdk latest) + `-g0 -Os` + device stripping | Interactive exe + ASYNCIFY | wasm 2,001,657 / 686,055 B (as 2,669,073 B base64 JS) + 78,272 B glue | 2025-12-29 → 2026-01-09 | Sam Reid (PhET, CU Boulder) |
| 7 | easyeda/eext-simulation-with-ngspice | BSD-3 (© chensiyu and contributors) | 46 (tarball vendored in repo) | Vendored emsdk **5.0.7**; MSYS2/Linux scripts | Shared lib via own C++ wrapper (JSON protocol v2), `MAIN_MODULE=1` + XSPICE | committed `wasm-lib/ngspice.wasm` 6,591,330 / 2,029,354 B; **512 MiB** initial memory | 2026-11-09 (very active) | chensiyu, longye-888 (EasyEDA org) |
| 8 | **fiumad/dschem-sky130-models `ngspice/47*`** | repo LICENSE Apache-2.0 (script copied from the private DSchem repo) | **47** (SF tarball, sha256 `894e6496…`) + 2 patches | `pins.toml`: tarball sha256 + **Emscripten 6.0.13**; static `libngspice.a` + `em++` link | Shared lib, explicit exports, no ASYNCIFY | committed `47.2/ngspice.wasm` 4,892,638 / 1,644,956 B + `ngspice.mjs` 76,016 B; `BUILD.json` with sha256 | created 2026-11-05, last 2026-11-08; README: "Temporary" | Dan Fiumara (commits by "Claude") |
| 9 | TC-II/TurboSpice `engine/` | **GPL-3.0** | **47** (SF tarball, sha256 pinned) | emsdk **4.0.10** pinned in CI | Shared lib `MAIN_MODULE=2` + XSPICE `.cm` + OSDI | deployed to their GitHub Pages (not reachable here); not on npm | 2026-10-17 → 2026-11-08 | AgusGullino, Javier Petrucci |
| 10 | sifferman/spice3d | **GPL-2.0** | fork `sifferman/ngspice` (pinned submodule) | emsdk unpinned | Shared lib, explicit exports | none published | 2026-05 → 2026-07 | Ethan Sifferman |
| 11 | MBarc/circuitoon `engine/ngspice` | MIT | 45.2 (SF tarball, sha256) | `emscripten/emsdk:6.0.11@sha256:…` (pinned by digest) | Shared lib (+XSPICE), fallback to exe | release tag `engine-ngspice-45.2-1` (assets not verifiable) | 2026-09 → 2026-10 | MBarc |
| 12 | tscircuit (`@tscircuit/ngspice-spice-engine`) | MIT | whatever eecircuit-engine 1.7.6 has | fork `tscircuit/EEcircuit-engine` | Interactive exe + ASYNCIFY | npm package is 42.6 kB; fetches `@tscircuit/eecircuit-engine/1.7.6` from `jscdn.tscircuit.com` **at runtime** (not on npm) | 0.0.22, 2026-10-12 | seveibar |
| H | concord-consortium/build-ngspice-js; danchitnis/ngspice `emcc/` | MIT | 2015 trimmed; 2020 master | asm.js PoC (archived); 2020 batch build (removed 2026-05-20) | — | — | historical | — |
| B | *eecircuit-engine 1.9.0 (baseline)* | MIT | see §6.2 (recipe selects 45.2 / pre-master-46) | `ubuntu:latest` + emsdk latest | Interactive exe + ASYNCIFY | wasm 6,131,813 / 1,952,656 B, inlined as base64 twice in each ~20 MB bundle (ESM and UMD) | 2026-10-25 | Danial Chitnis |

### 2b. Suitability for this project

Legend: ✅ yes · ⚠️ possible with work or caveats · ❌ no.

| # | Candidate | Web Worker | Node 22 golden tests | Full precision | Phone/PWA size and memory | Pinned, reproducible | E/F/G/H in binary | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | wokwi | ✅ (`ENVIRONMENT="web,worker"`) | ❌ (no node env) | ⚠️ (via FS raw file) | ✅ small | ❌ | ❌ | **Unsuitable** (no controlled sources; recipe broken on emsdk ≥ 4.0.6) |
| 2 | aminemahd13 | ✅ | ❌ (no Node loader compiled in) | ⚠️ | ✅ 0.59 MB gz | ❌ | ❌ (verified) | Unsuitable |
| 3 | @o.z/ngspice-wasm | ⚠️ (`web,node` only, untested) | ✅ env includes node (not executed here) | ⚠️ (batch `-b -r` raw file) | ❌ 2.47 MB gz JS + 256 MiB initial heap | ❌ (binary not built in CI) | ✅ | Not recommended |
| 4 | ejkreboot | ✅ (designed for it) | ⚠️ (client uses fetch/importScripts) | ✅ Float64Array | ❌ 11.4 MB gz, 256 MiB fixed | ⚠️ (emsdk pinned, ngspice not) | ✅ | API reference only |
| 5 | Pyodide libngspice | ⚠️ only inside Pyodide | ⚠️ only inside Pyodide | ✅ | ❌ needs Python runtime | ✅ | ✅ | Not for us; patches are useful |
| 6 | PhET | ✅ | ⚠️ (`wasmBinary` accepted; no Node loader) | ✅ binary raw read with `getFloat64` | ✅✅ best: 0.69 MB gz | ❌ | ✅ (BSIM etc. stripped) | Size reference; not a dependency |
| 7 | EasyEDA | ✅ | ✅ | ✅ (JSON at `setprecision(17)`) | ❌ 2.0 MB gz + 512 MiB initial | ✅ (vendored) | ✅ | Wrapper/protocol reference |
| 8 | **DSchem 47.2** | ✅ | ✅ (`web,worker,node`; `wasmBinary` allowed) | ✅ doubles via `ngGet_Vec_Info` | ⚠️ 1.64 MB gz, all devices, 16 MiB initial + growth | ✅ | ✅ | **Best prebuilt for a spike** |
| 9 | TurboSpice | ✅ | ✅ | ✅ | ? (not measured) | ✅ | ✅ | Best reference design, but GPL-3.0 |
| 10 | spice3d | ✅ | ✅ (has a Node test) | ✅ | ? | ⚠️ | ✅ | Reference (GPL-2.0) |
| 11 | circuitoon | ✅ | ✅ | ✅ | ? | ✅ (digest-pinned image) | ✅ | MIT recipe worth borrowing from |
| 12 | tscircuit | ⚠️ | ⚠️ | as eecircuit-engine | ❌ runtime CDN fetch, no offline | ❌ | ✅ | No |

The Node, worker and precision ratings come from the build flags and the generated glue code. I did not execute any third-party artifact (§0).

## 3. Lineage

```
2015  concord-consortium/build-ngspice-js (asm.js PoC, emscripten_set_main_loop; archived)
2020-10-08  danchitnis/ngspice  emcc/  — batch build of `ngspice` (removed 2026-05-20)
2020-11-20  danchitnis/EEsim  Docker/run.sh — interactive exe + ASYNCIFY, emscripten_sleep(100)
              │  (repo later renamed EEcircuit and moved: danchitnis/EEsim → eelab-dev/EEcircuit)
              ├── 2022-11-01 wokwi/ngspice-wasm (run.sh copy, minimal-ngspice branch)
              │       └── 2025-08-18 aminemahd13/ngspice-wasm (+bool.h patch, committed artifacts)
              └── 2024-12/2025-03-06 eelab-dev/EEcircuit-engine (run.sh moved here: "using lib"; npm)
                      ├── 2025-07 tscircuit/EEcircuit-engine fork → served from jscdn.tscircuit.com
                      ├── 2025-12-29 PhET sherpa (patch: device stripping, -Os → 2.0 MB wasm)
                      ├── 2026 physbox-io/volt (fork → shared lib, static code models)
                      └── 2026-09 MBarc/circuitoon ("adapted from eecircuit-engine's run.sh", shared lib)
Shared-library lineage (independent):
  2025-05 pyodide-recipes libngspice → ngspice 46 (2026-07)
  2026-01 ejkreboot/ngspice-xspice-wasm · 2026-05 sifferman/spice3d · 2025-12/2026 EasyEDA extension
  2026-10 TC-II/TurboSpice (ngspice 47) · 2026-11-05 fiumad/dschem-sky130-models (ngspice 47, 47.1, 47.2)
Batch, main() only: 2026-05-27 z-wasm → npm @o.z/ngspice-wasm (ngspice 46)
```

Evidence:
- `src/danchitnis_EEsim_full`: `git log -- Docker/run.sh` runs from 2020-11-20 to 2025-03-06 ("using lib", which removes `Docker/*`).
- `git ls-remote` returns identical refs for `danchitnis/EEsim`, `danchitnis/EEcircuit` and `eelab-dev/EEcircuit` (HEAD `0db7d458…`).
- danchitnis/ngspice: `git log --diff-filter=D` shows `emcc/run.sh`, `emcc/build/ngspice.wasm` and others deleted in `9c334d4 2026-05-20 cleanup`; `emcc initial` is 2020-10-08.
- wokwi `build.sh:3` says "Script based on EESIM's run.sh".

**The mirror the lineage depends on.** `danchitnis/ngspice-sf-mirror` is a faithful mirror refreshed daily by `danchitnis/ngspice/.github/workflows/mirror.js.yml` (cron `0 8 * * *`: `git clone --mirror https://git.code.sf.net/p/ngspice/ngspice.git` then `git push --mirror`). It holds 239 refs today, including tags up to `ngspice-47` (= `master`, `a80f6e3e`), branches `pre-master-48` and `minimal-ngspice` (`research/builds-data/mirror-ls-remote.txt`). It has a single maintainer. For pinned builds, use the SourceForge release tarball and its sha256 (ngspice 47 was released on SF on 2026-08-11 per the file listing), or pin a commit SHA. `imr/ngspice` (240 stars, pushed 2026-11-09) is a second mirror.

## 4. Candidate details

### 4.1 wokwi/ngspice-wasm (MIT, 2022)

Files: `src/wokwi_ngspice-wasm/`, with a single commit `a0c3b1ab 2022-11-01 Uri Shaked "feat: build ngspice-minimal"` (`git ls-remote` shows only `main` and no tags). GitHub: 10 stars, MIT.

- **Recipe.** `Dockerfile:1-7`: `FROM ubuntu:22.04`, `git clone --depth 1 emsdk`, `./emsdk install latest`. `Makefile:2-3`: `docker build` then `docker run -v $(realpath .):/mnt ngspice-wasm /mnt/build.sh`. `build.sh`:
  - `:6-7, :15` clone `https://git.code.sf.net/p/ngspice/ngspice`, branch `minimal-ngspice`;
  - `:21-22` sed-patch `configure.ac` (`-Wno-unused-but-set-variable`→`-Wno-unused-const-variable`; drop `getrusage`);
  - `:23-24` insert `#include <emscripten.h>` and `emscripten_sleep(100);` before `getcommand()` in `src/frontend/control.c`;
  - `:30` `emconfigure ../configure --disable-debug`;
  - `:34` rewrite the link line in `src/Makefile` to `-g1 -s ASYNCIFY=1 -s ASYNCIFY_ADVISE=0 -s ASYNCIFY_IGNORE_INDIRECT=0 -s ENVIRONMENT="web,worker" -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXTRA_EXPORTED_RUNTIME_METHODS=["FS","Asyncify"] -o spice.mjs`;
  - `:36-43` `emmake make`, then copy `spice.js` and `spice.wasm` to `/mnt/build`.
- **Branch content.** `minimal-ngspice` = commit `b028c77 2022-10-31 Holger Vogt` "Make a minimal version of ngspice. This build contains only: BJT, MOS1, Ind, Cap, Res, Current & voltage sources!". Last commit `ec50093 2023-12-05`. Its `configure.ac:19-20` is version **38.0**, and `src/spicelib/devices/` contains only `bjt cap dio ind isrc mos1 res vsrc` (`dev.c:88-96`). **No VCVS/VCCS/CCCS/CCVS/ASRC.**
- **Broken today.** `EXTRA_EXPORTED_RUNTIME_METHODS` was removed in Emscripten 4.0.6 (`toolchain/emsdk/upstream/emscripten/ChangeLog.md:829`, in the 4.0.6 section). emcc 7.0.0 rejects any non-empty value: `tools/settings.py:264` combined with `:404-406` (`exit_with_error('invalid command line setting ...')`). With `emsdk latest` the link step therefore fails. Cloning from git.code.sf.net is also blocked in this environment.
- **API.** Emscripten module factory, `FS` and `Asyncify` exported. ngspice runs its interactive loop and you feed commands through stdin/prompt. No Node environment.

### 4.2 aminemahd13/ngspice-wasm (MIT, 2025)

`src/aminemahd13_ngspice-wasm/` holds 3 commits on 2025-08-18. `build.sh` is the wokwi script plus a `bool.h` stdbool patch (`:26-69`) and modern flags (`:79`: `-sASYNCIFY=1 ... -sENVIRONMENT="web,worker" ... -sFORCE_FILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=["FS"]`). It commits `build/spice.wasm` (1,773,158 B) and `build/spice.js` (144,777 B). The README itself says running main "may require exporting callMain/ccall" (`README.md:46-48`). Exports include `asyncify_*` and `__main_argc_argv` (wasm_inspect). Device check: **E/G/F/H/B absent**, R/C/L/V/I/D/Q/M1 present. LICENSE is wokwi's text.

### 4.3 z-wasm/ngspice-wasm → npm `@o.z/ngspice-wasm` (2026)

- **npm.** `@o.z/ngspice-wasm@0.0.0 | BSD-3-Clause | deps: none | versions: 1`, unpacked 7.3 MB, tarball 2,490,677 B, published 2026-05-27, maintainers `z-nerd`, `zero.red.dev`. The repo (`src/z-wasm_ngspice-wasm`, one commit `7149f47 Init`) holds the identical `ngspice.js` (`cmp` equal).
- **Licence.** `LICENSE:1-4` reads "BSD-3-Clause License … Copyright (c) 2026 Zero Red … [Full BSD-3 text...]", a placeholder rather than a licence text. GitHub reports NOASSERTION. `COPYING` is ngspice's.
- **Recipe** (`builder.sh`):
  - `:8-9` uses SF git, `NGSPICE_TAG="ngspice-46"`;
  - `:65-82` applies seds (getrusage; dlopen and signals disabled);
  - `:104-120` configures `--host=wasm32-unknown-emscripten --enable-static --disable-shared --with-readline=no --without-x --disable-debug --disable-openmp --disable-xspice --enable-cider --with-klu=yes --with-fftw=yes --with-osdi=no ...`. `--with-klu` and `--with-fftw` are not real options (the real ones are `--enable-klu` and `--with-fftw3`; KLU is on by default anyway);
  - `:127-144` links with `SINGLE_FILE=1 MODULARIZE=1 ENVIRONMENT='web,node' INITIAL_MEMORY=256MB STACK_SIZE=10MB ERROR_ON_UNDEFINED_SYMBOLS=0 INVOKE_RUN=0 EXPORT_ES6=1 EXPORT_ALL=1 -O3`;
  - emsdk "latest" per the README.
  - `.github/workflows/publish.yml:31` has `# - run: yarn build` commented out, and `:35` runs `npm publish`. **The published binary is not built in CI**, so its provenance cannot be checked.
- **What the artifact really is.** The glue's `assignWasmExports` maps only `_main`, `_setThrew` and stack helpers. `_malloc` and `ngSpice_` appear 0 times in the JS, and `callMain` is not exported on `Module`. The wasm (5,347,411 B, gzip 1,795,936 B) has 8 exports and memory `min 4096 pages (256 MiB)`. It is a **batch main-only build without ASYNCIFY**, so the README's `_ngSpice_Command` and `_malloc` examples (`README.md:61-63, 82-84, 130, 147, 152`) cannot work. The device check finds all devices plus the CIDER and KLU strings. `noInitialRun` is forced (`var noInitialRun=Module["noInitialRun"]||true`).
- **Use.** Write a netlist into `FS`, call `_main(argc, argv)` with `ngspice -b -r out.raw file.cir` (argv built with the exported `stackAlloc` and `stringToUTF8OnStack`), then read `out.raw`. Re-running `main` in the same instance is generally unsafe for C programs with global state, so expect one instance per run (untested).
- **Dependent.** `@ohmi-circuits/simulate@0.1.0` (licence "Proprietary") depends on it (`npm view`).

### 4.4 ejkreboot/ngspice-xspice-wasm (MIT per README, 2026)

`src/ejkreboot_ngspice-xspice-wasm/`, 7 commits (2026-01-30 → 2026-04-04).

- **Recipe.**
  - `Dockerfile:1` `FROM emscripten/emsdk:3.1.50`;
  - `build-ngspice.sh:80` clones the mirror's default branch, so the ngspice revision is not pinned;
  - `:91` patches `outitf.c` with `if (memavail > 0 && memrequ > memavail)`;
  - `:93-95` removes cppduals code;
  - `:109-115` configures `--disable-debug --with-readline=no --disable-openmp --enable-xspice --with-ngshared --without-x`;
  - `:119` undefines `HAVE__PROC_MEMINFO`;
  - `:123` builds code models with `-sSIDE_MODULE=1`;
  - `:125-129` builds `cmpp` natively;
  - `:135-178` collects libtool objects and relinks with `emcc ... --no-entry -sMAIN_MODULE=1 -sALLOW_TABLE_GROWTH=1 -sINITIAL_MEMORY=256MB ... ALLOW_MEMORY_GROWTH=0` (`:164`).
- **API.** `dist/ngspice-client.js` / `ngspice-worker.js` give `NgspiceLibraryClient.run(netlist) → {analyses:[{type, sweep, vectors (Float64Array, transferred zero-copy), scalars for op/tf}]}` (README §API). The worker wraps `ngSpice_Init / Circ / Command / ngGet_Vec_Info / Reset` with `cwrap` and passes callbacks with `addFunction` (`src/ngspice-worker.js:480-500`).
- **Artifact.** `dist/ngspice-lib.wasm` is 24,313,865 B (gzip 11,447,526 B) with 8,077 exports, the cost of `MAIN_MODULE=1`, which keeps and exports every symbol. Memory is imported at 256 MiB, min = max. Seven `.cm` files ship as well, including `table.cm`, which is **GPLv2+** per ngspice `COPYING`.
- No LICENSE file. The README ends with an MIT text (`README.md:248-250`).

### 4.5 Pyodide `libngspice` (pyodide/pyodide-recipes)

- **Recipe.** `src/raw_pyodide-recipes/meta.yaml`: version "46" (`:3`); source `danchitnis/ngspice-sf-mirror/archive/refs/tags/ngspice-46.zip` with `sha256: 7a2ee6e9…` (`:8-9`); 4 patches (`:12-15`); build type `shared_library`. The script (`:20-57`) builds native `cmpp` first and then `emconfigure ../configure --enable-xspice --enable-cider --with-ngshared --host=wasm32-unknown-emscripten ...` with `SIDE_MODULE_CFLAGS`. `about.license: BSD-3-Clause`; maintainer `pepijndevos`.
- **Patches** worth reusing:
  - `0001` makes `IMPEXP` in `sharedspice.h` `EMSCRIPTEN_KEEPALIVE` under `__EMSCRIPTEN__`;
  - `0004` makes `getAvailableMemorySize()` / `getMemorySize()` report the Emscripten heap instead of `/proc/meminfo`. Its note says that in 46 the memory check "always tripped … 'ngspice.dll cannot recover' abort even for tiny circuits".
- **Artifact.** The Pyodide 314.0.7 npm package's `pyodide-lock.json` lists `libngspice 46 libngspice-46.zip sha256 642ba32a…`, `package_type: shared_library`, platform `emscripten_5_0_3`, used by `inspice` (a PySpice fork).
- **History** (blobless clone): `2db6503 2025-07-24` (rename), `fe855c4 2025-11-25` "Enable XSPICE support", `458d91a 2026-07-22` "Update libngspice to 46".
- The module only loads inside Pyodide's main module, so it is not a standalone engine.

### 4.6 PhET (Circuit Construction Kit) — `phetsims/sherpa`

- **Build notes.** `src/raw_phetsims_sherpa/README.md:3-75`: "Self-contained ngspice WASM build for Circuit Construction Kit", built from eecircuit-engine "with PhET-specific optimizations".
  - Configure: `--disable-debug --disable-openmp --disable-xspice --disable-osdi --disable-sp --disable-utf8 --with-readline=no`; emcc `-g0 -Os`.
  - Size table: "Raw WASM (stripped) 1.9 MB … Previous eecircuit-engine package 19 MB"; "Last built: 2025-12-29".
  - `phet-ngspice-build.patch` adds `phet_strip_devices.sh`, which deletes about 35 `get_*_info` registrations from `dev.c` (BSIM1-4, SOI, HiSIM, VBIC, HFET, MES, MOS2/3/6/9, JFET2, TXL/TRA/LTRA/CPL, URC, VDMOS) and **keeps res, cap, ind, mut, vsrc, isrc, dio, sw, csw, vcvs, vccs, ccvs, cccs, asrc, bjt, mos1, jfet**.
- **Artifact** (sherpa HEAD): `lib/ngspice-wasm-2025.js` is 2,669,073 B (base64; decoded wasm 2,001,657 B, gzip 686,055 B) and `lib/ngspice-emscripten-glue-2025.js` is 78,272 B. `lib/license.json` says "BSD … See …/ci/pre-master-46/tree/COPYING" (glue MIT). History: `c522999 2025-12-29` replaces `eecircuit-engine-1.5.6.js` (97,426 lines) with the PhET bundle; `d534e58 2026-01-07` splits it for licensing.
- **API.** `Simulation.start() / setNetList() / runSim()`, which mirrors EEcircuit. It drives `source /circuit.cir`, `run`, `write /out.raw` and parses the **binary** raw file with `DataView.getFloat64` (`src/phet-artifacts/phet-spice.js:25, 100, 239-251`).
- Device check: R/C/L/V/I/E/G/F/H/B/D/Q/M1 present, BSIM4 absent.

### 4.7 EasyEDA extension (easyeda/eext-simulation-with-ngspice, BSD-3)

- **Build notes.** `NGSPICE_WASM_BUILD.md:3` says the wasm is "based on **ngspice 46 + Emscripten 5.0.7**" with XSPICE. Configure flags (`:83-99`) include `--disable-cider --disable-osdi --disable-openmp --disable-klu --with-readline=no --with-editline=no`. Link flags (`:105-115`) include `-sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=536870912 -sSTACK_SIZE=8388608 -sMAIN_MODULE=1 ... -sEXPORTED_RUNTIME_METHODS=loadDynamicLibrary,ccall,cwrap,addFunction,...`.
- **Wrapper.** `wasm-build/sharedspice-wrapper/` exposes `loadNetlist → command/run → getRawResultJson → clearResultData → reset` (`:131-134`). It serialises with `std::setprecision(17)` (`ngspice_de_cpp.cpp:235`), so doubles round-trip.
- **Pins.** `third_party/ngspice-46.tar.gz` (10.5 MB) and `third_party/emsdk` (aliases `latest: 5.0.7`) are vendored; `build-ngspice-wasm.windows.ps1:2` sets `$EmsdkVersion = "5.0.7"`.
- Artifacts are committed in `wasm-lib/` and `iframe/wasm/`. Recent commit authors: longye-888, chensiyu, summving. Repo created 2025-12-24.

### 4.8 DSchem's ngspice 47 builds (fiumad/dschem-sky130-models)

- **Contents.** `git ls-tree` lists `ngspice/47/`, `47.1/` and `47.2/`, each with `BUILD.json`, `COPYING`, `build_ngspice_wasm.sh`, `patches/`, `ngspice.mjs` (76,016 B) and `ngspice.wasm` (4,879,070 / 4,879,082 / 4,892,638 B).
- **Pins** (`ngspice/47.2/BUILD.json`): source `…/ng-spice-rework/47/ngspice-47.tar.gz`, `source_sha256 894e6496…` (equal to our `logs/ngspice-47.sha256` and to TurboSpice's pin); patches `0001-xspice-options-enum`, `0002-strtod-errno`; `"emscripten": "6.0.13"`; file sha256s (the wasm I extracted matches `11dea244…`).
- **Recipe** (`build_ngspice_wasm.sh`):
  - `:21-31` reads pins;
  - `:39-51` downloads the tarball, verifies its sha256 and applies the patches;
  - `:57-60` uses features `--disable-debug --disable-openmp --without-x --with-readline=no --disable-xspice --disable-cider --enable-osdi=no --enable-pss`;
  - `:63-70` installs exactly the pinned emsdk if `emcc` does not match;
  - `:78-83` configures `--host=wasm32-unknown-emscripten --enable-static --disable-shared --with-ngshared` and makes with `STATIC= libngspice_la_CFLAGS= libngspice_la_LDFLAGS=-static`;
  - `:88-96` links `em++ -O2 -fexceptions libngspice.a -sMODULARIZE=1 -sEXPORT_ES6=1 -sALLOW_MEMORY_GROWTH=1 -sALLOW_TABLE_GROWTH=1 -sENVIRONMENT=web,worker,node -sEXIT_RUNTIME=0 -sEXPORTED_FUNCTIONS=_ngSpice_Init,_ngSpice_Command,_ngSpice_Circ,_ngGet_Vec_Info,_ngSpice_CurPlot,_ngSpice_AllVecs,_ngSpice_AllPlots,_ngSpice_running,_malloc,_free -sINCOMING_MODULE_JS_API=wasmBinary,locateFile,print,printErr -sEXPORTED_RUNTIME_METHODS=FS,addFunction,UTF8ToString,stringToNewUTF8,HEAPF64,HEAPU32,HEAP32`;
  - `:99-108` `--native` builds native ngspice **from the same patched sources with the same features**, which is exactly what golden tests need.
- **README.** "Temporary: ngspice for the browser … they will move when DSchem's web app gets its own hosting"; "Each rebuild gets a new folder, so … apps … keep finding the build they pin"; "the KLU solver and numparam, both in this build, are LGPL-2.1, so the exact sources and build steps are provided". The DSchem app repo itself is private (search API 422, `ls-remote` asks for credentials).
- Device check: all devices present.

### 4.9 TurboSpice (TC-II, GPL-3.0)

`engine/README.md` (Spanish):
- libngspice as `MAIN_MODULE` ES module plus XSPICE `.cm` side modules loaded by Emscripten `dlopen` (`MAIN_MODULE=2` + `SIDE_MODULE=1`);
- the release tarball `ngspice-47` with a pinned sha256, which already contains a generated `configure`;
- `cmpp=../cmpp/build/cmpp`;
- `STATIC=-static` to get `libngspice.a`;
- "**No threads**: without `-pthread`, so no COOP/COEP headers are needed (GitHub Pages does not allow them). A synchronous `run` is used inside a Web Worker; never `bg_run`. Abort = `worker.terminate()`";
- a fake 4 GB `/proc/meminfo`;
- OSDI works in wasm with OpenVAF patched for wasm32.

`engine/build.sh:6-8` pins version 47 and sha256 `894e6496…`; `:37-40` configures with `--with-ngshared --enable-xspice --enable-cider --enable-klu`; `:85-89` sets `ENVIRONMENT=web,worker,node`, `MAXIMUM_MEMORY=4GB`. `.github/workflows/deploy.yml:23` pins `EMSDK_VERSION: 4.0.10`. `engine/smoke/run.mjs:28-37` compares with native ngspice **only if the native version equals the wasm version**.

### 4.10 Others (brief)

- **sifferman/spice3d** (GPL-2.0), `scripts/build-ngspice-for-emscripten.sh`:
  - `:48-58` uses `--with-ngshared --enable-shared --disable-static --disable-xspice`;
  - `:61-70` flips libtool's `build_libtool_libs=no` to `yes`;
  - `:82-92` salvages the per-object files;
  - `:94-134` links with explicit `EXPORTED_FUNCTIONS`;
  - `test/node/test-ngspice-wasm.js` runs an RC transient in Node through the `SendData` callback after writing a fake `/proc/meminfo`.
- **MBarc/circuitoon** (MIT), `engine/ngspice/versions.env` and `build.sh`:
  - pins `NGSPICE_VERSION=45.2` with its sha256 and `EMSDK_IMAGE=emscripten/emsdk:6.0.11@sha256:cdefec94…`;
  - "--disable-klu: … KLU's SuiteSparse sources (colamd among them) are LGPL, and ngspice's own Sparse 1.3 solver solves the same operating point";
  - strips `-pthread` from every Makefile because it "would turn on shared memory (SharedArrayBuffer, COOP/COEP)";
  - relinks libngspice objects plus `libngspice_la_LIBADD` archives;
  - uses a fallback ladder: shared+XSPICE → shared → executable.
- **tscircuit.** `@tscircuit/ngspice-spice-engine/dist/index.js:2-16` fetches `https://jscdn.tscircuit.com/@tscircuit/eecircuit-engine/1.7.6/+esm` and imports it from a blob URL. `npm view @tscircuit/eecircuit-engine` returns E404, and the GitHub fork `tscircuit/EEcircuit-engine` was last pushed 2026-07-08.
- **Historical.**
  - concord-consortium/build-ngspice-js (README, 2015) "Quick & dirty demonstration … asm.js", trimmed to about 2.5 MB, with ngspice's `main` patched to use `emscripten_set_main_loop`; archived.
  - danchitnis/ngspice `emcc/run.sh` (2020–2024): `emconfigure ../configure --disable-debug --with-readline=no --disable-openmp --disable-xspice`, then `mv ngspice ngspice.js`, a batch exe (`git show 9c334d4^:emcc/run.sh`).
- **Out of scope, not ngspice.** `@strategicprojects/dune-sim@0.4.1` (BSD-3, 2.6 MB wasm, a Rust SPICE3f5 rewrite "oracle-tested against ngspice", first published 2026-11-06), plus pure-JS engines `@spice-ts/core`, `spicey` and `brownout`. The brief fixes the engine as ngspice.

## 5. Upstream ngspice 47 and Emscripten

### 5.1 Official support: none

`grep -rn "__EMSCRIPTEN__"` and a search for `emcc/emconfigure/emmake` over `src/ngspice47/ngspice-47` find nothing. The only hits for emscripten or wasm are autotools' `config.sub:1279, :1755` (which knows the `wasm32` and `emscripten` triplets) and `FAQ:316-317`: "Wasm, FreeBSD or Solaris will do, but are not officially supported." The release tarball ships a generated `configure` (836,048 B), so `autogen.sh` is not needed when building from the tarball. The git-based recipes run `./autogen.sh`.

### 5.2 Relevant configure options and defaults (`configure.ac` in ngspice 47)

| Option | Where | Default | Notes for a wasm build |
|---|---|---|---|
| `--with-ngshared` | `:179`, `:440-476` | off | Builds libngspice (`sharedspice.c`), defines `SHARED_MODULE`, sets `STATIC=-shared` (`:476`), forces `with_x=no` (`:473`), turns off readline/editline (`:1255-1257`), and adds `-fvisibility=hidden` in non-debug builds (`:456-470`). libtool cannot make a "shared library" for wasm32-emscripten, so recipes either override `STATIC= libngspice_la_LDFLAGS=-static` (DSchem, TurboSpice) or relink the objects (spice3d, ejkreboot, circuitoon). |
| `--enable-xspice` / `--disable-xspice` | `:142`, `:1111-1177` | **on** (`XSPICE_WANTED` when unset) | Code models (`.cm`) are dlopen'ed, which needs `MAIN_MODULE` + `SIDE_MODULE` (big) or static registration (physbox/volt). `POLY(n)` E/F/G/H translation exists only with XSPICE (`src/frontend/inp.c:962-965` `#ifdef XSPICE … ENHtranslate_poly`). **47 fails to compile with `--disable-xspice`** (§5.3a). `src/xspice/icm/table` is GPLv2+. |
| `--enable-osdi` | `:146`, `:1182-1212` | **on** (`OSDI_WANTED` unless `=no`) | Verilog-A models through dlopen; `src/osdi` is MPL-2.0. Disable. |
| `--enable-klu` | `:195`, `:300-306` | **on** (compiled in) | `src/maths/KLU` is LGPLv2. At runtime the default solver is still Sparse 1.3: `cktntask.c:143` sets `TSKkluMODE = CKTkluOFF`, KLU is selected with `.option klu`, and native 42 prints "Using SPARSE 1.3 as Direct Linear Solver". So `--disable-klu` does not change default results. |
| `--enable-openmp` | `:1321-1329` | **yes** | Must be off (no threads). `times/getrusage` are only checked when OpenMP is off (`:904-907`). |
| `--with-readline` | `:167`, `:1259-1283` | **yes**, and configure **errors** if the headers are missing | Pass `--with-readline=no` (implied by `--with-ngshared`). |
| `--with-editline` | `:171`, `:1299` | no | — |
| X11 | `AC_PATH_X`/`AC_PATH_XTRA` `:741-744` | auto-detect | Pass `--without-x` (implied by ngshared). |
| `--enable-cider` | `:150`, `:1215` | off | Numerical device models; size cost. |
| `--disable-sp` | `:158`, `:1221-1230` | S-param analysis on | PhET turns it off to save size. |
| `--disable-utf8` | `:183`, `:1094` | UTF-8 on | PhET turns it off. |
| `--with-fftw3` | `:191`, `:929-934` | yes, optional (silently off if not found) | — |
| `--enable-pss` | `:154`, `:1235` | off | DSchem 47.2 turns it on. |
| `--enable-debug` | `:138`, `:320-343` | off → `CFLAGS="-O2 -s"` unless the user passed `CFLAGS` (`ext_CFLAGS`, `:40`) | Pass explicit `CFLAGS`. |
| `/proc/meminfo` probe | `:734` `AC_CHECK_HEADERS([/proc/meminfo])` | detected **on the build host** | Docker hosts have it and wasm does not (§5.3c). |

### 5.3 wasm-specific pitfalls verified in the ngspice 47 source

- **(a) `--disable-xspice` does not compile.** `src/spicelib/analysis/cktsopt.c:253-255` has a non-XSPICE `#else` branch using `OPT_ENH_RSHUNT`. Its only definition is `src/include/ngspice/optdefs.h:152`, inside `#ifdef XSPICE` (`:141-156`). gcc check (§9): `cktsopt.c:254:10: error: 'OPT_ENH_RSHUNT' undeclared` without `-DXSPICE`, and no error with it. ngspice 46 had no `#else` branch (`src/raw_mirror_files/ngspice-46.cktsopt.c`). `pre-master-48` replaced it with a core `OPT_RSHUNT` (`pre-master-48.optdefs.h:128`, `cktsopt.c:181`), so the bug is fixed in upstream development. DSchem's `0001-xspice-options-enum.patch` fixes 47.
- **(b) musl `strtod` turns unknown model parameters into a fatal exit.**
  - `src/spicelib/parser/inpgmod.c:180-189` sets `errno = 0; dval = strtod(parm, &endptr); if ((errno == ERANGE && dval == HUGE_VAL) || errno != 0) { perror("strtod"); controlled_exit(EXIT_FAILURE); }`. Only after that comes the `unrecognized parameter (%s) - ignored` warning.
  - I verified that glibc leaves `errno=0` for `strtod("iss")`, while Emscripten 7.0.0 (musl) sets `errno=28` (EINVAL) (§9).
  - Native ngspice 42 on `.model DX D(IS=1e-14 iss=2)` prints "unrecognized parameter (iss) - ignored" and finishes (§9).
  - A wasm build would therefore exit instead, which matters for beginners' typos. The code is unchanged in 46 and in `pre-master-48`. DSchem's `0002-strtod-errno.patch` fixes it.
- **(c) Memory probe.**
  - `configure.ac:734` defines `HAVE__PROC_MEMINFO` from the build host.
  - At runtime `getAvailableMemorySize()` (`src/frontend/get_avail_mem_size.c:34-56`) fails to open `/proc/meminfo` (it calls `perror`) and returns 0.
  - In 47 the output-memory check (`src/frontend/outitf.c:131-160`, skippable with `set no_mem_check`) only **warns** on non-Windows. In 46 it aborted, per Pyodide's patch note.
  - Fixes in the wild: patch the getters (Pyodide `0004`), undefine `HAVE__PROC_MEMINFO` (ejkreboot), drop the probe from `configure.ac` (OpenCircuits), or write a fake `/proc/meminfo` into MEMFS (spice3d, TurboSpice, eecircuit-engine's "added /proc/meminfo fake size" commit `954c35d`).
- **(d) Threads.** With `--with-ngshared`, configure does `AC_CHECK_LIB([pthread], [pthread_create])` (`configure.ac:450, :453`), and `sharedspice.c:88-122` then defines `THREADS`. Without `-pthread` Emscripten only stubs threads, so use synchronous `run` / `ngSpice_Command`, never `bg_run` (TurboSpice). Do not add `-pthread`: it needs SharedArrayBuffer, which needs COOP/COEP headers that GitHub Pages cannot set (circuitoon, TurboSpice).
- **(e) Legacy sed patches no longer match.** `AC_CHECK_FUNCS([time getrusage])`, used by wokwi, EEsim, eecircuit-engine and @o.z, does not occur in 47. It is now `AC_CHECK_FUNCS([times getrusage])` at `:906`, so that sed is a no-op (spice3d and OpenCircuits use the new pattern). The `control.c` hook point `freewl = wlist = getcommand(string);` still exists at `src/frontend/control.c:655`.
- **(f) HICUM2 is C++.** It must be linked with `em++` (DSchem uses `-fexceptions`) or removed (eecircuit-engine's `Docker/hicum2_patch.sh`, ngspice bug 793), which drops libstdc++ from the binary.

## 6. The known working recipes

### 6.1 wokwi `build.sh` (summary in §4.1)

Ubuntu 22.04 + emsdk latest → clone the `minimal-ngspice` branch from SourceForge → 2 configure seds + 2 `control.c` seds (`emscripten_sleep(100)` before each `getcommand`, so that ASYNCIFY yields to the browser) → `autogen.sh` → `emconfigure ../configure --disable-debug` → inject the ASYNCIFY + MODULARIZE + ES6 link flags into `src/Makefile` → `emmake make` → `spice.js` + `spice.wasm`.

**Status today:** it does not link on emsdk ≥ 4.0.6 (`EXTRA_EXPORTED_RUNTIME_METHODS` was removed), its source branch lacks controlled sources, and nothing is pinned.

### 6.2 EEcircuit-engine `Docker/run.sh` (the maintained version of the same idea)

`src/eelab-dev_EEcircuit-engine/Docker/`:
- `Dockerfile:1` `FROM ubuntu:latest`.
- `run.sh:6` uses the mirror; `:12-16` runs `emsdk install latest`.
- `:35` `latest_tag=$(git tag | grep -E '^ngspice-[0-9]+\.[0-9]+$' | sort -V | tail -n 1)`.
- `:46-50` picks the first `pre-master-X` greater than that tag; `:64-70` checks out the tag (VERSION=main) or the branch (VERSION=next).
- `:77-78` applies `hicum2_patch.sh`, which removes HICUM2 and the libstdc++ check.
- `:89-92` applies the 2 configure seds, plus an `EM_ASYNC_JS(void, eesim_sleep_hack…)` calling `Module.handleThings()` before `getcommand`.
- `:107` `emconfigure ../configure --disable-debug --disable-openmp --disable-xspice --disable-osdi --without-x -with-readline=no`.
- `:111` link flags `-O2 -s ASYNCIFY=1 … -s ENVIRONMENT="web,worker" … -s EXPORTED_RUNTIME_METHODS=["FS","Asyncify","callMain"] --pre-js /mnt/pre.js -o spice.mjs`.
- `:118` `emmake make -j`; `:137` writes `build-meta.json`.
- `pre.js` replaces `window.prompt` with `Module.getInput` (stdin) and adds `setHandleThings` and `runThings`.
- CI: `.github/workflows/build-main.yml:45` and `build-next.yml:50` run `npx --yes npm-check-updates -u` before building; `build-next.yml:85` publishes `--tag next` weekly.

**Version-selection finding.** I applied `run.sh`'s two selection rules to today's mirror refs (§9):
- main → `ngspice-45.2`, because the regex needs a dotted tag and `ngspice-46` and `ngspice-47` have no dot;
- next → `pre-master-46`.

So, as written, the recipe does **not** build ngspice 47. This matches GreenShoeGarage/CircuitBench2's evaluation (`src/raw_GreenShoeGarage_CircuitBench2/docs_engine-evaluation.md:24`): "Its startup banner identifies ngspice-45.2, built September 5, 2026" for eecircuit-engine 1.8.0. It also explains why the recipe never hit the 47 `--disable-xspice` compile error (§5.3a). The teammate studying eecircuit-engine should confirm 1.9.0's banner.

**Reproducibility:** none. The base image, emsdk, ngspice revision and npm dev dependencies all float.

### 6.3 Shared-library recipes (the modern pattern)

DSchem (Apache-2.0), circuitoon (MIT) and Pyodide (MPL-2.0 repo; the patches are small) can be read and adapted. TurboSpice (GPL-3.0) and spice3d (GPL-2.0) should be read for ideas only unless we choose a GPL licence.

They share these steps:
1. Fetch a pinned source: the release tarball with its sha256, or the mirror archive with its sha256.
2. Apply small patches (§5.3).
3. `emconfigure ../configure --host=wasm32-unknown-emscripten --with-ngshared --enable-static --disable-shared …`.
4. `emmake make STATIC= libngspice_la_CFLAGS= libngspice_la_LDFLAGS=-static`, or relink the objects.
5. `emcc`/`em++` link `libngspice.a` with an explicit `EXPORTED_FUNCTIONS` list, `ALLOW_TABLE_GROWTH` (for `addFunction` callbacks), `ENVIRONMENT=web,worker,node` and `MODULARIZE`/`EXPORT_ES6`.
6. At runtime: `ngSpice_Init(printfcn, statfcn, exitfcn, datafcn, initdatafcn, bgtrunfcn, userData)` with callbacks from `addFunction`; send the netlist with `ngSpice_Circ(char**)`; run `ngSpice_Command("run")` synchronously; walk `ngSpice_AllPlots` / `ngSpice_AllVecs`; read data through `ngGet_Vec_Info` → `vector_info {char* v_name; int v_type; short v_flags; double* v_realdata; ngcomplex_t* v_compdata; int v_length}` (`sharedspice.h:176-183`), copying `HEAPF64` into a `Float64Array`.

## 7. What building our own would involve

Target: ngspice **47** (same as the teammate's build and as the native golden reference we should build), the shared-library API, one `.wasm` and one ES module, a Web Worker in the browser and Node 22 in tests, full `double` results, small download, pinned and reproducible, and a clean licence.

1. **Pins (one file).**
   - `NGSPICE_URL=https://sourceforge.net/projects/ngspice/files/ng-spice-rework/47/ngspice-47.tar.gz/download` with `NGSPICE_SHA256=894e649651f1838a14095e5a5439e7d3aa63e87ede14d283173fda4fcdef675f` (already in `src/ngspice47/` and `logs/ngspice-47.sha256`).
   - The Emscripten version: either `emsdk install X.Y.Z` (the teammate has 7.0.0) or `emscripten/emsdk:X.Y.Z@sha256:<digest>`, as circuitoon does.
   - Record a `BUILD.json` with the sha256 of each artifact, as DSchem does.
2. **Patches** (each a few lines):
   - (1) define the XSPICE option enum when XSPICE is off (47 only; drop it for 48);
   - (2) make `strtod` failure fatal only on ERANGE (musl);
   - (3) memory: either Pyodide-style `emscripten_get_heap_*` getters or `set no_mem_check` in our spinit / a fake `/proc/meminfo`;
   - (4, optional) PhET's `dev.c` device-strip list (keeps R, C, L, K, V, I, E, F, G, H, B, D, Q, M1, J, S, W);
   - (5, optional) eecircuit-engine's `hicum2_patch.sh` to drop C++ (link with `emcc`, no libc++).
3. **Configure:** `--host=wasm32-unknown-emscripten --build=$(gcc -dumpmachine) --with-ngshared --enable-static --disable-shared --disable-xspice --disable-osdi --disable-cider --disable-klu --disable-openmp --with-readline=no --without-x --disable-debug CFLAGS="-Os"` (or `-O2`; measure both). Optionally add `--disable-sp --disable-utf8` (PhET).
4. **Make:** `emmake make -j STATIC= libngspice_la_CFLAGS= libngspice_la_LDFLAGS=-static`.
5. **Link:** `emcc -Os src/.libs/libngspice.a -o ngspice.mjs -sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH -sALLOW_TABLE_GROWTH -sEXIT_RUNTIME=0 -sEXPORTED_FUNCTIONS=_ngSpice_Init,_ngSpice_Command,_ngSpice_Circ,_ngGet_Vec_Info,_ngSpice_CurPlot,_ngSpice_AllPlots,_ngSpice_AllVecs,_ngSpice_running,_ngSpice_Reset,_malloc,_free -sEXPORTED_RUNTIME_METHODS=FS,addFunction,UTF8ToString,stringToNewUTF8,HEAPF64,HEAPU32,HEAP32 -sINCOMING_MODULE_JS_API=wasmBinary,locateFile,print,printErr`.
   - No `-pthread`, so no COOP/COEP is needed and it runs on GitHub Pages.
   - No ASYNCIFY.
   - No `SINGLE_FILE`/base64: a separate `.wasm` allows streaming compile and HTTP/service-worker caching. Base64 adds about 35% even after gzip: @o.z JS 2,466,788 B gz vs its wasm 1,795,936 B gz, and PhET JS 928,413 B gz vs its wasm 686,055 B gz.
6. **Runtime wrapper (TypeScript, in our repo).**
   - A worker that owns the module, initialises once, and handles each request as `ngSpice_Circ` → `run` → collect plots → `remcirc` / `ngSpice_Reset`.
   - Abort by `worker.terminate()` and respawn.
   - `.op`: node voltages and `vsrc#branch` currents. `.tf`: `transfer_function`, `output_impedance_at_V(x)` and `v1#Input_impedance` are ordinary vectors of the `tf1` plot (verified natively, §9). `.dc` and `.tran`: vectors with a scale.
   - Node tests load the same module with `wasmBinary = readFileSync(...)`.
7. **Golden tests.** Build **native ngspice 47 from the same patched tarball with the same configure features** (DSchem `--native`; the teammate has `native/build-47`). Compare wasm against native 47 to 6 significant figures, and keep Ubuntu's 42 as a secondary check. TurboSpice only compares when the versions match.
   - Use doubles (shared API or binary raw), never `print` text.
   - Natively, `print` shows 7 significant digits (`6.666667e-01`) by default and 16 with `set numdgt=15`. The ASCII raw file has 16 significant digits, and the binary raw file is the exact double (`0.6666666666666666 == 2/3`) (§9).
8. **CI.** GitHub Actions job with the pinned emsdk (`mymindstorm/setup-emsdk@v14` with a version, as TurboSpice does, or the digest-pinned Docker image); cache keyed by the pins file plus the patches; Node 22 golden tests; Playwright worker smoke test; publish `ngspice.mjs`, `ngspice.wasm` and `BUILD.json` as Pages assets.
9. **Expected size.** All devices with no XSPICE, CIDER or OSDI and KLU on: about 4.9 MB raw / 1.6 MB gzip (DSchem 47.2). With PhET-style stripping and `-Os`: about 2.0 MB raw / 0.7 MB gzip (PhET, an ASYNCIFY build of pre-master-46; a non-ASYNCIFY build should not be larger, but measure). Initial memory 16 MiB plus growth (DSchem: `min 268 pages`), unlike the 256/512 MiB of @o.z, ejkreboot and EasyEDA.
10. **Licence of our artifact.**
    - ngspice core: Modified BSD. `src/maths/sparse`: MIT-like. **`src/frontend/numparam`: LGPLv2+**, always compiled because it implements `.param`. Emscripten runtime and glue: MIT (Emscripten is dual MIT / University of Illinois NCSA).
    - With `--disable-klu` we avoid the LGPL KLU. With XSPICE off we avoid the GPLv2+ `icm/table`. With OSDI off we avoid MPL.
    - numparam's LGPL means we publish the exact tarball, patches and build script (as DSchem does). That fits an open-source repo.
11. **Effort.** About 1–2 days to a pinned, CI-built engine plus a worker wrapper, given these recipes. Most of the time goes to the wrapper and golden harness, not the compile. TurboSpice's README times its build at "~1 min"; PhET quotes 15–20 min for the eecircuit-engine Docker build, which includes the emsdk install.
12. **Deferred trade-off.** No XSPICE means no `POLY(n)` sources (vendor op-amp macromodels) and no digital code models. If the channel's examples later need them, add XSPICE with **statically registered** code models (physbox/volt) rather than `MAIN_MODULE=1`, which costs 24 MB in ejkreboot's case.

## 8. Which prebuilt to use for a spike if we do not build our own

**Use DSchem's ngspice 47.2 build**, pinned to commit `df63d97f356627b975d3c1dd85dc9b0c8c82706e`:
- `https://raw.githubusercontent.com/fiumad/dschem-sky130-models/df63d97f356627b975d3c1dd85dc9b0c8c82706e/ngspice/47.2/ngspice.mjs` (sha256 `64cedaf7fbb1525843b32ea14b671f9a7ff1ab2c09a264c1d43b910f186040c7`, 76,016 B; the URL returned HTTP 200 here)
- `…/ngspice/47.2/ngspice.wasm` (sha256 `11dea24484d1f00d24bbbff41e78463b3a011492f4d503d866542595d547b22c`, 4,892,638 B)

Both hashes were verified locally with `sha256sum` and match `BUILD.json`.

Vendor both files into the repo with their `BUILD.json` and `COPYING`, and check the hashes in CI.

Why this one:
- It is the same ngspice version (47) and the same source tarball (same sha256) as our native and wasm plans.
- It uses the shared-library API that our final design will use, so the spike wrapper carries over unchanged to our own build.
- It already contains the `strtod` and XSPICE-enum fixes.
- It targets `web,worker,node`, so the same file serves the Worker spike and the Node 22 golden tests.
- It has all devices.
- The recipe is fully pinned.

Risks:
- The repo is 4 days old, has one author (with AI-authored commits) and labels the builds "Temporary". This is mitigated by vendoring.
- It includes LGPL KLU, which is fine for a spike.
- It has not been executed in this session (policy). The spike's first test is exactly that.

**Fallback:** `eecircuit-engine@1.9.0` from npm (MIT, maintained, Node-tested by its own CI). Expect an ASYNCIFY/stdin-driven API, a probable ngspice 45.2 (§6.2), and a 20 MB double-base64 bundle.

**Do not use:**
- `@o.z/ngspice-wasm`: main-only, placeholder licence, 256 MiB heap, unverifiable binary.
- wokwi and aminemahd13: no E/F/G/H.
- ejkreboot: 24 MB.
- EasyEDA: 512 MiB initial memory and an extension-specific API.
- PhET: not packaged, ASYNCIFY, but use it as the size target.
- Pyodide: needs Pyodide.
- tscircuit: runtime CDN.

The better path is the teammate's own ngspice 47 build following §7; then the prebuilt only serves as a cross-check.

## 9. Evidence log (commands I ran and key output)

- npm:
  - `npm view @o.z/ngspice-wasm` → `BSD-3-Clause | deps: none | versions: 1 … unpackedSize: 7.3 MB … maintainers: z-nerd, zero.red.dev … published 5 months ago`.
  - `npm view @tscircuit/eecircuit-engine` → `E404`.
  - `npm view pyodide version` → `314.0.7`; its `pyodide-lock.json` contains `libngspice {"version": "46", "file_name": "libngspice-46.zip", "sha256": "642ba32a…", "package_type": "shared_library"}` with `platform: emscripten_5_0_3`.
- @o.z artifact:
  - `python3 -I research/builds-scripts/wasm_inspect.py src/npm-o.z_ngspice-wasm/x/package/ngspice.js --exports` → `wasm bytes: 5,347,411 … gzip -9 bytes: 1,795,936 … exports: 8 … defined memory: min 4096 pages (256 MiB)`.
  - `grep -oE 'function assignWasmExports…'` → only `_main`, `_setThrew` and the stack functions.
- Device check (`python3 -I research/builds-scripts/device_check.py <wasm>`):

  | Artifact | Devices present |
  |---|---|
  | `src/dschem-artifacts/ngspice.wasm` | R C L V I E G F H B D Q M1 BSIM4 |
  | `src/phet-artifacts/phet.wasm` | all except BSIM4 |
  | `src/aminemahd13_ngspice-wasm/build/spice.wasm` | `E=- G=- F=- H=- B=-` (no controlled sources) |

- `wasm_inspect` on `src/dschem-artifacts/ngspice.wasm` → `4,892,638 … gzip 1,644,956 … exports: 22 … min 268 pages (16 MiB)`. `sha256sum` → `11dea244…` (matches `BUILD.json`).
- XSPICE compile check (`research/builds-data/xspice-check/`): `gcc -fsyntax-only -DHAVE_CONFIG_H -I inc -I $S/include -I $S/spicelib/analysis $S/spicelib/analysis/cktsopt.c` → `cktsopt.c:254:10: error: 'OPT_ENH_RSHUNT' undeclared`. Adding `-DXSPICE` gives no errors.
- musl `strtod` (`research/builds-scripts/strtod/strtod_errno.c`):
  - native glibc: `strtod("iss") = 0, consumed=0, errno=0`;
  - emcc 7.0.0, then `node strtod_errno.cjs`: `strtod("iss") = 0, consumed=0, errno=28 (set)`, and `strtod("1e999") … errno=68`.
- Native ngspice 42 (`research/builds-data/netlists/bad_model_param.cir`): `Warning: Model issue on line 5 … unrecognized parameter (iss) - ignored`, then `V(2) 6.294408e-01`, exit 0.
- Native output precision (`research/builds-data/native-precision/third.cir`): `print v(2)` → `6.666667e-01`; after `set numdgt=15` → `6.666666666666666e-01`; the ASCII raw has `6.666666666666666e-01`; the binary raw decodes to `0.6666666666666666` (== `2/3`).
- Native `.tf` (`tf.cir`): plot `tf1 (Transfer Function)` with vectors `Transfer_function`, `output_impedance_at_V(2)`, `v1#Input_impedance`. The binary raw holds `0.6666666666666666, 666.6666666666666, 2999.9999999999995` (variables named `v(transfer_function)` etc. in the raw header).
- EEcircuit-engine version selection on today's mirror refs (`research/builds-data/mirror-ls-remote.txt`, same `grep`/`sort -V`/`awk` as `run.sh:35-50`) → `latest_tag=ngspice-45.2`, `next branch=pre-master-46`.
- Mirror and lineage:
  - `git ls-remote https://github.com/danchitnis/ngspice-sf-mirror` → `refs/heads/minimal-ngspice ec500936…`, `refs/heads/pre-master-48 62f1fceb…`, `refs/tags/ngspice-47 a80f6e3e…` (= master).
  - `git ls-remote https://git.code.sf.net/p/ngspice/ngspice` → `CONNECT tunnel failed, response 403`.
  - SF listing `…/ng-spice-rework/47/` → `ngspice-47_64.7z: released on 2026-08-11`.
- Files on the 47 tag equal the tarball: `cmp` of `optdefs.h`, `cktsopt.c` and `inpgmod.c` from raw `ngspice-sf-mirror/ngspice-47/...` against `src/ngspice47/ngspice-47` → all equal.

## 10. Open questions and blockers

- **GitHub releases could not be listed** (api.github.com and github.com web are blocked; the MCP GitHub tools are restricted to two repos). Release assets for circuitoon (`engine-ngspice-45.2-1`) and any others are unverified.
- **No third-party artifact was executed** (the session policy denied running `@o.z/ngspice-wasm`). Worker and Node suitability is inferred from build flags and glue code. The spike must run DSchem 47.2 in Node 22 and in a Chromium worker as its first step.
- Which ngspice does **eecircuit-engine 1.9.0** actually contain? The recipe logic says 45.2 (main) / pre-master-46 (next). Check the banner, and check whether it aborts on an unknown model parameter (the musl `strtod` issue applies to every wasm build that lacks the patch).
- Golden reference: is the teammate's native build at `native/build-47` configured with the same features as the planned wasm build (no XSPICE, CIDER, OSDI or KLU)? It should be, to compare like with like.
- Decide whether `POLY(n)` sources (which need XSPICE) are needed for any planned channel example. If so, plan statically linked code models.
- Licence choice for our repo: if we want to reuse TurboSpice or spice3d code, they are GPL. DSchem (Apache-2.0), circuitoon (MIT), PhET and eecircuit-engine (MIT) and the Pyodide patches can be adapted with attribution.

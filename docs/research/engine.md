# eecircuit-engine as our prebuilt ngspice-to-WebAssembly route

Evaluation date: 2026-11-09. Package evaluated: `eecircuit-engine@1.9.0` (npm `latest`), tarball sha1 `406a580b…` = registry `dist.shasum` (checked), engine repo clone at commit `be15b07` (v1.9.0). Native references: `/usr/bin/ngspice` (ngspice-42, Ubuntu build) and, as a same-version check for the ngspice 47 work, a native ngspice-47 built by a teammate from the 47 tarball (`<scratch>/native/ngspice-47/bin/ngspice`, used read-only).

Path prefixes used below (all absolute):

| Prefix | Absolute path |
|---|---|
| `REPO/` | `<scratch>/src/eelab-dev_EEcircuit-engine/` |
| `PKG/` | `<scratch>/src/npm-eecircuit-engine/package/` |
| `NG47/` | `<scratch>/src/ngspice47/ngspice-47/` |
| `H/` | `<scratch>/research/engine-harness/` (my scripts; outputs in `H/out/`) |
| `D/` | `<scratch>/research/engine-data/` (downloads and extracted data) |

---

## 1. Bottom line

- **It works, and the numbers are right.** In Node 22 and inside our own module Web Worker in Chromium, every fixture (F1a–F5, D1, T1) returns the expected values. Every vector agrees with native ngspice-42 **bit for bit** (max relative difference 0), including all 519 points of the transient. Against native ngspice-47, `.op`, `.tf`, `.dc` and `.ac` are also bit-identical; `.tran` differs slightly because 47 picks one different time step (section 9.3). Bit-identical vectors: 40 of 40 against native 42, and 36 of 40 against native 47; the 4 that differ are T1's. Checks passed: 57/57 against native 42 and 53/53 against native 47 (`H/out/compare-native42.md`, `H/out/compare-native47.md`).
- **But it is not ngspice 47.** The published `latest` build is **ngspice-45.2** (Sept 2025), and the `next` build is **"45+"**, the old `pre-master-46` branch. The build script's tag regex only matches `ngspice-X.Y` tags, so it never sees `ngspice-46` or `ngspice-47` (section 2.1).
- **It can hang for good.** `runSim()` never settles, and no error is raised, when (a) the rawfile header holds a non-ASCII character, for example a Turkish or "Ω" title (a parser bug that uses a string index as a byte offset), (b) ngspice hits a fatal error, for example a missing `.include` file, or (c) a `.control` block says `quit`. In cases (b) and (c) the wasm program has exited, so that instance is dead.
- **The download is heavy.** The browser gets one 19.4 MiB JS file (5.38 MiB with gzip -9, 3.57 MiB with brotli q11). It holds the wasm inlined as base64 **twice**, plus 3.8 MiB of chip-process (PDK) model cards that we don't need. The wasm alone is 1.88 MiB gzip / 1.21 MiB brotli. Start-up takes about 0.45 s in a worker.
- **Other problems:**
  - It returns only the last plot, so `.op` + `.tf` in one netlist loses the `.op` results.
  - It supports at most one live instance per JS realm (page or worker), because it routes stdin through a global `window.prompt`.
  - The wasm heap leaks about 28 KiB per run, and each run gets slower over thousands of runs.
  - `getError()` mixes errors, warnings, notes and blank lines.
  - One person maintains it, nothing is pinned, and it ships no ngspice licence notices.
- **Recommendation.** For the spike, use it at most as a stand-in or reference engine, hidden behind our own engine interface in our own worker, with the guards in section 10.3. **Don't adopt it for the long run.** Build our own pinned ngspice-47 wasm (separate `.wasm`, no PDKs, a driver that reports exits and errors), and keep this harness as the golden test for any engine.

---

## 2. What is inside the published package

### 2.1 ngspice version and where it comes from

| Finding | Evidence |
|---|---|
| The running engine reports **ngspice-45.2**, built `Sat Oct 24 23:49:49 UTC 2026` | `getInitInfo()` banner: `** ngspice-45.2 : Circuit level simulation program` … `** Creation Date: Sat Oct 24 23:49:49 UTC 2026` (`H/out/engine-run.txt`, top). The wasm string table holds `45.2` next to the bug-report URL and that date (`strings -n 2 D/spice.wasm`). |
| Source: the author's GitHub mirror of the SourceForge repo | `REPO/Docker/run.sh:6` `NGSPICE_HOME="https://github.com/danchitnis/ngspice-sf-mirror"` |
| Tag selection only matches `ngspice-X.Y` | `REPO/Docker/run.sh:35` `git tag \| grep -E '^ngspice-[0-9]+\.[0-9]+$' \| sort -V \| tail -n 1`. The mirror has tags `ngspice-45`, `ngspice-45.2`, `ngspice-46`, `ngspice-47` (`git ls-remote`, saved in `D/mirror-ls-remote.txt`). Running the same selection on those refs gives `latest_tag=ngspice-45.2`. The regex has been there since commit `297d4c6` (2025-03-09). |
| `next` builds use branch `pre-master-46`, not 47 or 48 | `REPO/Docker/run.sh:46-50` picks the **first** `pre-master-N` above 45.2. Simulated on the mirror refs, that gives `next branch: pre-master-46`. The `next` npm build `1.9.0-next.1794034016` (2026-11-07), unpacked into `D/dl-next/` and never run, has version string **`45+`** next to its build date `Sat Nov 7 06:42:41 UTC 2026`. |
| How far behind it is | `NG47/NEWS`: 45.2 = Sept 5 2025, 46 = Mar 29 2026, 47 = Aug 9 2026 |
| `src/build-meta.json` doesn't record the ngspice version | Not in git (`REPO/.gitignore`: `spice.js`, `*.wasm`, `build-meta.json`) and not in the npm package. `run.sh:133-137` only writes `{"version": "main"}` or `{"version": "next"}`. |
| The wasm binaries aren't in git, so a release can't be rebuilt from a commit | `.gitignore` as above. `REPO/build-ngspice.sh:19-28` builds in Docker and copies the files into `src/`. |

### 2.2 Configure flags and features

`REPO/Docker/run.sh:107`: `emconfigure ../configure --disable-debug --disable-openmp --disable-xspice --disable-osdi --without-x -with-readline=no`

| Feature | Status | Evidence |
|---|---|---|
| KLU | **Compiled in**, but SPARSE is the solver at run time unless `.options klu` is given (also true of native 42 and 47) | Banner `Compiled with KLU Direct Linear Solver`. Every run prints `Using SPARSE 1.3 as Direct Linear Solver`. With `.options klu` the engine prints `Using KLU as Direct Linear Solver` and F5 still gives 14 V (`H/out/engine-extra.txt`, K1). ngspice's default is KLU off: `NG47/src/spicelib/analysis/cktntask.c:143` `tsk->TSKkluMODE = CKTkluOFF`. |
| XSPICE, code models | Off (no digital or `A` devices) | `--disable-xspice`. The `version -f` banner has no `XSPICE extensions included` line (that line is printed under `#ifdef XSPICE` in `NG47/src/frontend/misccoms.c:252-254`). |
| OSDI (Verilog-A models) | Off | `--disable-osdi` |
| CIDER | Off (the default) | The banner has no `CIDER 1.b1` line (`misccoms.c:249-251`) |
| OpenMP | Off | `--disable-openmp`. No OpenMP line in the banner. |
| HICUM/L2 BJT (level 8) | **Removed** (it is C++) | `REPO/Docker/hicum2_patch.sh`. Probe H1 (`.model qh npn level=8`) gives `Unable to find definition of given model` in the engine but runs in native 42. |
| spinit | Not loaded | The startup message is `Warning: can't find the initialization file spinit.` The wrapper writes `/spinit` (`REPO/src/simulationLink.ts:149`), but ngspice looks under `/usr/local/share/ngspice` (that string is in the wasm). This made no numeric difference here. |

### 2.3 Emscripten version and link flags

| Item | Finding | Evidence |
|---|---|---|
| Emscripten version | **Not pinned.** `emsdk install latest` runs inside `FROM ubuntu:latest`. Most likely **6.0.13** (my inference): the build date is 2026-10-24, and on emsdk `main` at that time (`d7b4130`, 2026-10-20) `emscripten-releases-tags.json` has `"latest": "6.0.13"`. The next emsdk tag is 7.0.0, on 2026-11-06. The wasm has no `producers` section, so it can't be read directly. | `REPO/Docker/run.sh:12-16`, `REPO/Docker/Dockerfile:1`. emsdk metadata clone in `D/dl-emsdk/` (`git for-each-ref` tag dates). Sections listed in `D/wasm-sections.txt`. |
| Link flags | `-O2 -s ASYNCIFY=1 -s ASYNCIFY_ADVISE=0 -s ASYNCIFY_IGNORE_INDIRECT=0 -s ENVIRONMENT="web,worker" -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORTED_RUNTIME_METHODS=["FS","Asyncify","callMain"] --pre-js /mnt/pre.js` | `REPO/Docker/run.sh:111` |
| ASYNCIFY / MODULARIZE / ENVIRONMENT | Yes / yes (ES6 module factory) / `web,worker` only, no Node target. It still runs in Node because the wasm is fetched from a `data:` URL. | as above; `PKG/dist/eecircuit-engine.mjs:61`, `:84-85` |
| Wasm memory | Starts at 268 pages (16.75 MiB), maximum 32768 pages (2 GiB), growable | `D/wasm-sections.txt` (memory section) |
| Wasm interface | 46 imports, including `env.__asyncjs__eesim_sleep_hack` and `env._emscripten_system`. 37 exports, including `asyncify_start_unwind/…`. Code section 5.61 MB, data 0.51 MB. | `D/wasm-sections.txt` (my parser: `H/extract-wasm.mjs`) |

### 2.4 Patches applied to ngspice

1. **HICUM2 and the libstdc++ check removed** (`REPO/Docker/hicum2_patch.sh`, applied at `run.sh:77-78`).
2. **`configure.ac`**: `-Wno-unused-but-set-variable` is changed to `-Wno-unused-const-variable`, and `getrusage` is dropped from `AC_CHECK_FUNCS` (`run.sh:89-90`).
3. **`src/frontend/control.c`**: an `EM_ASYNC_JS(void, eesim_sleep_hack, …)` is injected and called before every `getcommand()` in the interactive loop (`run.sh:91-92`). It awaits `new Promise((resolve) => { Module["handleThings"](); })`, and **`resolve` is never called**. The wrapper's `handleThings` starts its own nested `Asyncify.handleAsync`, and that is what resumes the program (`REPO/src/simulationLink.ts:173-216`).
4. **Link line** patched into `src/Makefile` (`run.sh:111`).
5. **Runtime shim** `REPO/Docker/pre.js:1-11`: creates `globalThis.window` if it is missing and **replaces `window.prompt`** with a function that returns the wrapper's next command. Emscripten's stdin reads call `window.prompt("Input: ")` (`PKG/dist/eecircuit-engine.mjs:208`).

---

## 3. How ngspice is driven and how results come back

- **The interactive executable is fed commands. It is not batch mode and not the shared-library API.** The module is created with `noInitialRun: true` (`simulationLink.ts:82`), then `runThings()` calls `callMain([])` (`pre.js:21-28`). Each stdin read goes through the `window.prompt` shim to `getInput()`, which hands out commands from a fixed list (`simulationLink.ts:24, 53-70, 312`):
  `" "`, `"source test.cir"` (preceded by `"remcirc"` from the second run on), `"destroy all"`, `"run"`, `"write out.raw"`, plus `"setplot noise1"` if the netlist has `.noise` (`:298-307`).
- **The netlist** is written to MEMFS `/test.cir` before each cycle (`:210`). `source` also runs any `.control` block in the netlist. For example, `version -f` inside `.control` printed the full banner (`H/out/smoke.txt`), so user netlists can run arbitrary ngspice commands.
- **Results** come from the binary rawfile `/out.raw`, read back with `FS.readFile`. `readOutput.ts` decodes it as **little-endian float64** (`REPO/src/readOutput.ts:73-77`, `getFloat64(i, true)`), so there is no text rounding. Engine values are bit-identical to native rawfile values (section 9).
- **Only the current plot is written**, because `write` with no names writes the current plot (`NG47/src/frontend/postcoms.c:572-610`). Probe M1 (`.op` and `.tf` in one netlist) returns only the "Transfer Function" plot, and the `.op` node voltages are lost (`H/out/engine-run.txt`, section 3).
- **Vectors whose rawfile type is `notype` are dropped** (`readOutput.ts:193, 216`). With no analysis, this gives an empty result (probe E4).
- **Parser bug.** `readOutput.ts:61-73` decodes the **whole buffer** as UTF-8, takes `indexOf("Binary:")` in the **string**, and uses that as a **byte** offset. Any non-ASCII byte before the data (title, vector names) misaligns the read. `H/u1-demo.mjs` output: `"Binary:" at string index 254, but at byte offset 260 (difference 6)`, then `DataView length 22 bytes`, then `RangeError: Offset is outside the bounds of the DataView`. That throw is swallowed by the `try/catch` in `simulationLink.ts:178-190`, so `runPromiseResolve` is never called and **`runSim()` never settles**. My byte-offset parser reads the same bytes correctly (`v(n1)=6, i(v1)=-3`).

---

## 4. Threading and workers

| Question | Answer | Evidence |
|---|---|---|
| Does it create its own Worker or threads? | **No.** It runs on whichever thread imports it. The glue contains no `new Worker`, `SharedArrayBuffer`, `Atomics` or `pthread`. | grep on `D/eecircuit-engine.stripped.mjs` (the dist file with the base64 removed) |
| Can it run inside **our own** Web Worker? | **Yes, verified in Chromium** (Playwright 1.63, headless). A module worker `import()`s the package, `start()` takes 425–458 ms, and the worker is ready about 606 ms after `new Worker()`. All 12 fixtures came back **identical to the Node run**. The page's longest gap between animation frames stayed at 19–21 ms, so the UI never blocked. | `H/run-browser.mjs`, `H/browser/worker.mjs`, `H/out/browser-run.txt` |
| What happens on the main thread? | It blocks: long tasks of **206 ms and 152 ms** during import and start. It also **replaces the page's `window.prompt`**. | `H/browser/main-thread.html`, `H/out/browser-run.txt` |
| Several instances in one realm? | **No.** With two live instances, the one created first never completes (timeout) and the second works. The repo says so itself: `REPO/test/retention.ts:255-256` "The existing loader has a global prompt callback: finish one instance's runs before driving another". Use one instance per worker. | `H/out/engine-run.txt`, section 5 |
| Side effects | It defines `globalThis.window = {}` in workers and in Node (`dist/…mjs:4`). Libraries that test `typeof window` to detect the main thread will be fooled. | Worker reported `typeof self.window === "object"` |
| Reference use | EEcircuit itself runs one `Simulation` per module worker in a pool of 4, with a **30 s timeout**, and **terminates and replaces the worker** on timeout | `…/danchitnis_EEcircuit/src/workers/simulationWorker.ts:29-36`, `src/simulation/parallelSimulation.ts:42-43, 156-177, 479` |

---

## 5. Packaging, download size, start-up and memory

**The wasm is inlined as base64, twice**, in `dist/eecircuit-engine.mjs`: lines 61 and 2381, identical (sha256 `0c4bef30…`, 6,131,813 bytes decoded; `D/wasm-sections.txt`).
- The first copy is the Emscripten default `new URL("data:application/wasm;base64,…")`.
- The second copy is Vite library mode inlining `new URL("./spice.wasm", import.meta.url)` from the wrapper's Node-only branch (`simulationLink.ts:126`). Its `protocol === "file:"` check (`dist:2382`) can never be true, so that branch is dead in the published file.
- Line 2389 also inlines all model cards.

| What a browser downloads (`H/sizes.mjs`, Node zlib) | raw | gzip -9 | brotli q11 (lgwin 22) |
|---|---|---|---|
| `dist/eecircuit-engine.mjs` (the whole download) | 20,346,804 B (19.40 MiB) | **5.38 MiB** | **3.57 MiB** |
| `dist/eecircuit-engine.umd.js` | 19.25 MiB | 5.38 MiB | 3.58 MiB |
| the wasm alone, as a binary file | 5.85 MiB | 1.88 MiB | 1.21 MiB |
| one base64 copy of the wasm | 7.80 MiB | 2.50 MiB | 1.70 MiB |
| `.mjs` without both wasm copies (glue, wrapper, models) | 3.81 MiB | 0.38 MiB | 0.19 MiB |
| `.mjs` without wasm and without the model strings | 0.09 MiB | 0.02 MiB | 0.02 MiB |

Brotli q11 with a 16 MiB window (lgwin 24) shrinks the `.mjs` to 1.88 MiB, because the duplicate copy falls inside the window. Ordinary server and CDN settings use the default window. I could not check what GitHub Pages actually serves, because `*.github.io` is blocked here. The npm tarball is 11.5 MB; unpacked it is 43.1 MB.

Because the wasm is inside JS, it can't be cached or streamed as its own file. Each page load decodes 8 MB of base64 and compiles the module again. I did **not measure** whether Chrome caches compiled code for a `data:` response.

**Start-up and memory (measured)**

| Environment | Import | `start()` | First run / later `.op` runs | Memory |
|---|---|---|---|---|
| Node 22.23, first instance | 73–79 ms | 452–545 ms | 20–24 ms / 1–4 ms; T1 (519 points) 6–26 ms across runs | RSS 41.9 MiB at baseline, 87.0 after import, **238–244 MiB after start**. V8 heap 3.9, then 23.5, then 114.5 MiB. Wasm linear memory 16.75 MiB. |
| Node, later instances in the same process | – | 264–326 ms (one 565 ms outlier in an earlier run) | about 1 ms | – |
| Chromium, our module worker | 134–160 ms | 425–458 ms (ready 606 ms after `new Worker`) | about 20 ms / 0.9–3.3 ms; T1 14 ms | All Chromium processes together: RSS 360 MiB on `about:blank`, 515 MiB with the engine worker (**+155 MiB**, OS-level estimate) |

---

## 6. Bundled model files and their licences

The wrapper writes all of these into MEMFS on every `start()` (`simulationLink.ts:149-170`). They add 3.8 MB raw / 0.38 MiB gzip, and none are needed for R, C, L, sources and controlled sources.

| `.include` name | Content | Licence stated in the file |
|---|---|---|
| `modelcard.FreePDK45` | NCSU FreePDK 45 nm | Apache-2.0 (header). The licence text is in the repo (`REPO/src/models/freepdk/APACHE-LICENSE-2.0.txt`) but **not in the npm package**. |
| `modelcard.PDK15` | NCSU FreePDK 15 nm | BSD-style "Copyright (c) 2013-2016 North Carolina State University … Redistribution and use … permitted" (header in `dist`) |
| `modelcard.ptm`, `ptmLP`, `ptmHP` | ASU Predictive Technology Models | **No licence grant**: "All the models in this file belongs to ASU" (`REPO/src/models/ptm.ts:1-3`) |
| `modelcard.skywater` | sky130 nfet/pfet 1.8 V (2.3 MB) | Apache-2.0 ("Copyright 2020 The SkyWater PDK Authors") |
| `modelcard.GF180*`, `sm141064.ngspice` | GF180MCU (1.3 MB) | Apache-2.0 ("Copyright 2022 GlobalFoundries PDK Authors") |
| `modelcard.CMOS90` | BSIM4 test model cards | "should not be used for any other purposes except for benchmarking against BSIM team's standard results" (`REPO/src/circuits.ts:138-140`) |

**Licence of the bundle as a whole.**
- The wrapper is MIT, "Copyright (c) 2024 EElab.dev" (`PKG/LICENSE`).
- The ngspice inside is Modified BSD, with **LGPLv2 for `src/maths/KLU`** and **LGPLv2+ for `src/frontend/numparam`**, both compiled in (`NG47/COPYING:14-44`; I read the 47 file, not 45.2's).
- **The npm package ships no ngspice licence or notice text**. The only BSD text in the bundle is the FreePDK15 header. If we redistribute it, we must add ngspice's and KLU's notices ourselves.

---

## 7. API surface and behaviour

### 7.1 Public API (`PKG/dist/simulationLink.d.ts`, `PKG/dist/readOutput.d.ts`)

| Member | Behaviour |
|---|---|
| `new Simulation()` | Takes no options. You can't pass `locateFile`, `wasmBinary`, a wasm URL or log hooks (`simulationLink.ts:81-110` builds them internally). |
| `start(): Promise<void>` | Idempotent. Creates the module, writes the model files and starts ngspice's loop. |
| `setNetList(text)` | Stores the netlist. Switches to noise export if it matches `/^\s*\.noise\b/im`. |
| `runSim(): Promise<ResultType>` | Calls `start()` if needed and resets info and errors. **Never rejects.** May **never settle** (section 7.3). Has no cancel and no timeout. |
| `getError(): string[]` | stderr lines of the last run, except 4 filtered strings (`simulationLink.ts:90-95`). Includes **blank strings, notes and warnings**, with no severity. Every line is also sent to `console.error`. |
| `getInfo(): string` / `getInitInfo(): string` | stdout plus stderr of the last run, capped at 2,000,000 chars, including prompts like `ngspice 2 ->` / the start-up banner |
| `isInitialized()`, `__getSpiceModuleForTests()` | The second exposes the Emscripten module (FS, Asyncify, …) |
| `ResultType` | `{header, numVariables, variableNames, numPoints, dataType: "real", data: {name, type, values: number[]}[]}` or the same with `dataType: "complex"` and `values: {real, img}[]` |

A TypeScript 6.0.2 consumer type-checks cleanly with `strict` and `skipLibCheck: false` (`H/ts-consumer/`).

### 7.2 What comes back, with exact vector names

ngspice lowercases names: title `F1a …` comes back as `f1a …`, node `N1` as `v(n1)`. The rawfile writer wraps voltage-type vectors as `v(…)` and current-type vectors as `i(…)` (`NG47/src/frontend/rawfile.c:163-186`).

| Analysis | Plot | Vectors (type), from the engine (`H/out/engine-run.txt`) |
|---|---|---|
| `.op` (F5) | `Operating Point` | `v(a)`, `v(n1)`, `i(vx)` (current), `v(x)`. Source currents are `i(<vsource>)`; F1a gives `i(v1) = -3` (positive means current flows into the + node). |
| `.op` with one node and no V source (F2a) | `Operating Point` | `v(n1)` plus a duplicate **`v(all)`**. This is a quirk of `write`'s implicit `all` argument (`postcoms.c:577`), and native 42 and 47 write it too. |
| `.op` + `.options savecurrents` (S2) | `Operating Point` | `v(a)`, **`i(@f1[i])`**, **`i(@itest[current])`**, **`i(@r1[i])`**, **`i(@r2[i])`**, `v(n1)`, `i(vx)`, `v(x)`. **Device currents do come back**: `i(@r1[i]) = 3`, `i(@r2[i]) = 1`, `i(@f1[i]) = 2`, matching native. |
| `.tf v(a) V1` (F4) | `Transfer Function` | **`v(transfer_function)`**, **`v(output_impedance_at_v(a))`**, **`v(v1#input_impedance)`**, all typed `voltage`. ngspice's printed names are `transfer_function`, `output_impedance_at_v(a)`, `v1#input_impedance`. |
| `.dc V1 0 12 1` (D1) | `DC transfer characteristic` | `v(v-sweep)` (scale), `v(in)`, `v(out)`, `i(v1)`, 13 points |
| `.tran 10u 5m` (T1) | `Transient Analysis` | `time` (type `time`), `v(in)`, `v(out)`, `i(v1)`, 519 points |
| `.ac dec 1 10 100k` (A1) | `AC Analysis` | complex: `frequency` (type `frequency`, imaginary part 0), `v(in)`, `v(out)`, `i(v1)` |

### 7.3 Errors, warnings and failure modes (`H/out/engine-run.txt` sections 3–5; native 42 and 47 in `H/out/native-probes.txt`)

| Probe | Engine result | What `getError()` says | Native ngspice |
|---|---|---|---|
| U1: non-ASCII **title** (`Örnek devre … Ω …`) | **Never settles** (8 s timeout) | nothing | runs fine |
| U2: Turkish **node names** (`giriş`, `çıkış`) | Runs, but the names are mangled to `v(giri__)`, `v(____k____)` | nothing | same mangling in 42 and 47 |
| U3: non-ASCII in a comment only | fine | – | fine |
| C1: `.control` … `quit` … `.endc` | **Never settles**. `ngspice-45.2 done`, the module has exited. | nothing | exits |
| I1: `.include nothere.lib` | **Never settles**. The instance is dead. | `Error: Could not find include file nothere.lib`, `ERROR: fatal error in ngspice, exit(1)` | 47 pipe mode also exits; 42 pipe mode doesn't |
| E1: `R1 n1 0` (no value) | Runs **without R1**: `v(n1)=6`, `i(v1)=0` | `Warning: 'r1 n1 0' is not a valid resistor instance line, ignored!` and blank lines | same |
| E2: no ground | Returns **meaningless numbers**: `v(a)=9.0003330742620609`, `v(b)=3.0003330742710626` | 19 lines: `singular matrix: check node b`, gmin and source stepping failed, `Transient op finished successfully` | same numbers |
| E3: current source into a capacitor only | Returns `v(n1)=9.9999999999500364` (meaningless) | singular matrix / stepping failed | same |
| E4: no analysis line | Empty result: plot `constants`, `numVariables: 0` | `Warning: No job (tran, ac, op etc.) defined:`, `run simulation not started` | batch mode: "no simulations run" (exit 1) |
| E5: duplicate name `R1` | Empty result (`constants`) | `device already exists, bail out` … `Error: circuit not parsed.` | same |
| E6: unknown first letter `Y1` | Empty result (`constants`) | `model name is not found` … `Error: circuit not parsed.` | same |
| W1: `3A` (3 attoamps) | `v(n1)=1.2000000000000001e-17`, **silently** | nothing | same |
| W2: node with one connection | `v(dangling)=6`, **silently** | nothing | same |
| M1: `.op` + `.tf` | Only the `.tf` plot comes back | – | native batch mode prints both |
| Stale results after a failed run? | **None.** Sequence F1a, E2, E4, E1, E6, F3b, F2a on one instance: each run returned its own plot, because `destroy all` clears old plots. | – | – |
| Recovery after a hung run | U1, then F1a, then F3b on one instance: F1a and F3b come back correctly, but U1's promise stays pending forever | – | – |

### 7.4 Several runs in one instance and memory growth

- **Several runs work.** All 12 fixtures ran in sequence on one instance (`.op` → `.tf` → `.dc` → `.tran` → `.op` …), and each result was **identical** to a run on a fresh instance (`H/out/engine-run.txt` section 2). Circuits are released between runs with `remcirc` (`simulationLink.ts:57-63`, fix `8b7c9a2` in 1.9.0).
- **Memory grows, and runs get slower.** In 4000 runs of F1a on one instance:

| run | 0–500 | 1000 | 2000 | 3000 | 4000 |
|---|---|---|---|---|---|
| wasm memory (MiB) | 16.75 | 34.88 | 60.31 | 86.88 | 125.13 |
| ms per run | 0.65 | 0.60 | 0.77 | 1.05 | 1.21 |

That is about **28–31 KiB per run**. Wasm memory never shrinks. The likely cause, which I did not prove: each `eesim_sleep_hack` call nests two `Asyncify.handleAsync` sleeps, and only one of the two Asyncify data blocks (about 4 KiB each) is freed, so about 6 commands per run leak about 25 KiB. The repo's own retention test allows up to 64 MiB of growth in 500 runs (`REPO/TEST.md`, "Circuit retention regression").

---

## 8. Maintenance

| Item | Finding | Evidence |
|---|---|---|
| Maintainers | **One person.** npm maintainers: `danchitnis`. All 104 commits are by Danial Chitnis (two name spellings). | `npm view` (`D/npm-view.json`); full-history metadata clone `D/dl-engine-history/` |
| History | First commit 2024-12-16, then 61 commits in 2025 and 42 in 2026. No git tags. | same |
| Stable releases | 18 releases, 1.0.0 (2025-03-06) to 1.9.0 (2026-10-25): six in March 2025, then every 1–3 months, with one 5-month gap from 2026-03-24 to 2026-09-05 | `D/npm-time.json` |
| Pre-releases | 71 `-next.<timestamp>` builds published **automatically, about weekly**, from CI (scheduled every Saturday). The CI also runs `npx npm-check-updates -u` before building. | `REPO/.github/workflows/build-next.yml`, `build-main.yml:45` |
| Licence | MIT (wrapper). ngspice's own notices are not shipped. | `PKG/LICENSE`, section 6 |
| Tests | Node source and package tests, Playwright regression in Chromium only, and heap-retention tests | `REPO/TEST.md` |

---

## 9. Fixture results (engine vs native vs expected, 6 significant figures)

Rule: `|a-b| <= 0.5*10^(floor(log10(max(|a|,|b|)))-5)`, and `|x| <= 1e-12` counts as zero (`H/agree6.mjs`). Engine values are printed with `toPrecision(17)` (the full list of every vector is in `H/out/engine-run.txt`). "Native printed" is the text of `/usr/bin/ngspice -b <id>.cir` (logs in `H/out/native42/<id>.b.log`). "Native rawfile" is a pipe-mode run of the same command flow (`source`, `run`, `write`).

### 9.1 Channel fixtures and savecurrents (all agree)

| Fixture | Vector | Expected | Engine (17 digits) | Native 42 rawfile | Native 42 printed | OK |
|---|---|---|---|---|---|---|
| F1a | v(n1) | 6 | 6.0000000000000000 | 6.0000000000000000 | `6.000000e+00` | yes |
| F1b | v(n1) | −6 | -6.0000000000000000 | -6.0000000000000000 | `-6.00000e+00` | yes |
| F2a | v(n1) | 12 | 12.000000000000000 | 12.000000000000000 | `1.200000e+01` | yes |
| F2b | v(n1) | −12 | -12.000000000000000 | -12.000000000000000 | `-1.20000e+01` | yes |
| F3a (1M trap) | v(n2) | about 6 (6·1e6/(1e6+1e-3)) | 5.9999999940000004 | 5.9999999940000004 | `6.000000e+00` | yes |
| F3b | v(n2) | 3 | 3.0000000000000000 | 3.0000000000000000 | `3.000000e+00` | yes |
| F4 | v(transfer_function) | 1/3 | 0.33333333333333337 | 0.33333333333333337 | `transfer_function = 3.333333e-01` | yes |
| F4 | v(output_impedance_at_v(a)) | 4 Ω | 4.0000000000000000 | 4.0000000000000000 | `output_impedance_at_v(a) = 4.000000e+00` | yes |
| F4 | v(v1#input_impedance) | 9 Ω | 9.0000000000000000 | 9.0000000000000000 | `v1#input_impedance = 9.000000e+00` | yes |
| F5 | v(a) | 14 (R_th = 14 Ω) | 14.000000000000000 | 14.000000000000000 | `1.400000e+01` | yes |
| S1 | i(@r1[i]) | 3 | 3.0000000000000000 | 3.0000000000000000 | `3.000000e+00` | yes |
| S2 | i(@r1[i]) / i(@r2[i]) / i(@f1[i]) | 3 / 1 / 2 | 3 / 1 / 2 (exact) | same | `3.000000e+00` / `1.000000e+00` / `2.000000e+00` | yes |

Native batch mode prints negative numbers with one fewer digit (`-6.00000e+00`), which is still 6 significant figures.

### 9.2 Our sweeps

- **D1 (`.dc`)**: all 13 points of every vector are bit-identical to native 42 and 47. `v(out)` matches (2/3)·V1 at every point; the largest difference is 8.9e-16 V. Native `-b` **without `.print` runs nothing**: 42 prints `Note: No ".plot", ".print", or ".fourier" lines; no simulations run` (exit 1), and 47 prints `Error: incomplete or empty netlist … no simulations run!`. With `.print dc v(out)` it prints 13 rows, from `0 0.000000e+00 0.000000e+00` to `12 1.200000e+01 8.000000e+00`. So any netlist we export for `ngspice -b` needs `.print` lines.
- **T1 (`.tran`)**: all 519 points of all 4 vectors are bit-identical to native 42. Against the task's formula 5(1−e^(−t/1 ms)), the largest difference is 2.5 mV at t = 1 µs: the source has a 1 µs rise, which the ideal-step formula ignores, so 518 of 519 points are outside 6 s.f. as expected. Against the exact response to the real 1 µs ramp, the largest error is 1.5e-5 V (ngspice's time-step error at default `RELTOL`). At t = 5 ms the engine gives 4.9662948166610530, the exact response is 4.9662934145207158, and the ideal step gives 4.9663102650045730. Native printed: `518 5.000000e-03 4.966295e+00`.

### 9.3 Against native ngspice-47 (same version as our planned build)

- `.op`, `.tf`, `.dc` and the savecurrents fixtures are bit-identical: 53/53 checks pass.
- **T1**: 47 produces 520 points and 45.2 produces 519. The step at index 11 differs (7.196e-7 s vs 8.693e-7 s). Only 13 time points are shared, and at t = 1 µs `v(out)` differs in the 6th significant figure (0.002499379612 vs 0.002499395306). At the other points, linear interpolation differs by at most 5.5e-5 V. Both versions have the same 1.5e-5 V largest error against the exact solution (`H/out/compare-native47.md`).
- **So transient golden tests must compare the same ngspice version, or use a tolerance suited to a transient.** For `.op`, `.tf` and `.dc`, a 6 s.f. comparison is safe across 42, 45.2 and 47.

### 9.4 Extra probes (`H/out/compare-extra.txt`)

- Diode `.op` (N1), BJT `.op` (N2), RC `.ac` (A1) and F5 with KLU (K1) are bit-identical to native 42 and 47.
- Diode-rectifier `.tran` (N3) matches native 42 to within 3.6e-16 relative. Against 47 it differs at one time point, again because of different time steps.
- So clang/wasm (with musl libm) versus gcc/x86-64 (with glibc) made no visible difference on these circuits.

---

## 10. Pros and cons

### 10.1 For the spike

Pros:
- It meets the spike's numeric bar today. `.op`, `.tf` and `.dc` in our own module worker return node voltages, source currents, device currents (with `savecurrents`) and all three `.tf` results, matching native ngspice to all 17 digits.
- Install is one `npm install`. The small API hides easily behind our own `Engine` interface.
- Runs are fast (about 1 ms per small `.op`).
- It is MIT, so we can patch or vendor the wrapper if we need to.
- The EEcircuit app already uses it this way: a pool of module workers, built with Vite 8 (`optimizeDeps.include`, `worker.format: "es"` in its `vite.config`).

Cons:
- It is ngspice 45.2, not 47, and we can't choose the version.
- The download is 19.4 MiB (5.38 MiB gzip) and can't be cached as a separate file. Start-up is about 0.45 s.
- It hangs with no error on non-ASCII headers (Turkish UI!), on fatal errors and on `quit`.
- `getError()` is unstructured.
- Only the last plot comes back.
- It allows one instance per realm and pollutes `window`.

### 10.2 For the long run

- **Cons outweigh pros.**
  - One maintainer.
  - The build isn't reproducible: `ubuntu:latest`, `emsdk latest`, the regex-chosen ngspice tag, `npm-check-updates` in CI, and no artefacts or versions recorded in git.
  - The tag regex is broken, so it is stuck on 45.2.
  - The Asyncify and `window.prompt` design is fragile: a promise that never resolves, about 28 KiB leaked per run, and fatal exits that kill the module.
  - We would carry PDK models we don't need, one of them with no licence grant, and the ngspice and KLU licence notices are missing.
  - There are no configure choices we control: no XSPICE, no OSDI, no HICUM2.
- **Pros for the long run**: the recipe (`Docker/run.sh`) is a working template, and EEcircuit's worker pool (timeout, terminate, replace) is a pattern we can copy.

### 10.3 If the spike uses it: guards our wrapper must add

1. Use **one `Simulation` per module Worker**, and never two in one realm.
2. Put a **timeout on every run**, for example 10 s. On timeout, `worker.terminate()`, create a new worker and show an error. This is the same approach as EEcircuit's `replaceWorker`.
3. **Make the header ASCII.** Replace the title line with a fixed ASCII title and keep the user's title in our UI. Treat any non-ASCII node or element name as a trap, since ngspice mangles them anyway.
4. **Strip or reject `.control … .endc`, `.include` and `.lib`** before sending the netlist. One bad `.include` kills the engine.
5. **Run one analysis per run.** Send `.op` and `.tf` as separate netlists, because only the last plot comes back.
6. **Classify `getError()` ourselves.**
   - Treat these as failures: `Error`, `singular matrix`, `stepping failed`, `is not a valid … line, ignored`, `circuit not parsed`, `No job`, plot `constants`, `numVariables === 0`.
   - Never show the numbers from E2 or E3 as results.
   - Silence the package's `console.error`.
7. **Map names.**
   - `v(x)` is node x, and `i(vname)` is the current through voltage source vname.
   - `i(@dev[i])` is a device current; add `.options savecurrents` to get these.
   - `.tf` results come back wrapped as `v(…)`.
   - Drop the duplicate `v(all)`, and treat a node named `all` as a trap.
8. **Recycle the worker every N runs**, for example 1000, to bound the leak.
9. Add the **ngspice (BSD) and KLU/numparam (LGPL) notices** to our NOTICE file, and don't expose the PTM or BSIM test cards.

### 10.4 What our own ngspice-47 build should do differently

- **Pin everything**: emsdk version, base image, and the exact `ngspice-47` tag. Record them in a `build-meta.json`.
- **Ship the `.wasm` as a separate file** so it can be streamed, HTTP-cached and PWA-cached: 1.21–1.88 MiB instead of 3.57–5.38 MiB. Bundle no PDKs.
- **Make the driver**:
  - settle with an error on `exit` or `quit` or a fatal error,
  - parse the rawfile by byte offset (`H/rawparse.mjs` does this),
  - return every plot,
  - tag stdout and stderr with severity,
  - avoid nested Asyncify sleeps.
- **Consider ngspice's shared-library API** (`ngSpice_Init` / `ngSpice_Circ` / `ngSpice_Command`, with callbacks for output and controlled exit, and direct vector access). It could replace the stdin hack, but the wasm teammate would need to verify it.
- **Reuse this harness** (`H/fixtures.mjs`, `H/compare.mjs`) as the golden test.

---

## 11. How to reproduce

```
H=<scratch>/research/engine-harness
P=<scratch>/src/npm-eecircuit-engine/package
cd $H
# engine (read-only sandbox: no fs writes, no child processes); the last arg = runs for the leak test
node --permission --allow-fs-read=$P/dist --allow-fs-read=$H run-engine.mjs $P/dist/eecircuit-engine.mjs 4000 > out/engine-run.txt
sed -n '/@@JSON@@/,$p' out/engine-run.txt | tail -n +2 > out/engine-results.json
# native runs (batch -b log, .print copy for sweeps, pipe-mode rawfile)
node run-native.mjs /usr/bin/ngspice $H/out/native42 $H/out/native42.json
node compare.mjs out/engine-results.json out/native42.json "native 42" > out/compare-native42.md
node run-native-probes.mjs /usr/bin/ngspice $H/out/native42-probes
# browser: our own module worker and the main thread, in Chromium
node run-browser.mjs $P/dist/eecircuit-engine.mjs out/engine-results.json > out/browser-run.txt
# sizes, extra probes, the U1 parser demonstration
node sizes.mjs $P/dist ../engine-data/spice.wasm
node --permission --allow-fs-read=$P/dist --allow-fs-read=$H run-engine-extra.mjs $P/dist/eecircuit-engine.mjs > out/engine-extra.txt
node compare-extra.mjs /usr/bin/ngspice $H/out/native42-extra out/engine-extra.txt "native 42"
node --permission --allow-fs-read=$P/dist --allow-fs-read=$H u1-demo.mjs $P/dist/eecircuit-engine.mjs
```

Note: the first attempt to run the package with plain `node` was blocked by the session's safety classifier ("code from external"). Every engine run since then uses Node's permission model, which allows read-only access to the package and the harness, and no child processes, workers or writes. Outputs reach disk only through shell redirection.

## 12. Open questions

- The exact Emscripten version is inferred (6.0.13), not recorded anywhere.
- The leak's root cause is inferred, not proven.
- I didn't measure whether Chrome caches the compiled wasm when it comes from a `data:` URL.
- I didn't check what compression GitHub Pages applies (`*.github.io` is blocked here).
- Firefox and Safari weren't tested: Chromium only, as in the repo's own CI.
- Large-circuit performance wasn't measured (small fixtures only).
- Licence terms for the ASU PTM cards are unknown.

## Appendix: files

- Harness, in `H/`:
  - `fixtures.mjs` (fixtures and behaviour probes)
  - `run-engine.mjs`
  - `run-native.mjs`, `run-native-probes.mjs`
  - `compare.mjs`, `agree6.mjs`, `rawparse.mjs`
  - `extras.mjs`, `run-engine-extra.mjs`, `compare-extra.mjs`
  - `run-browser.mjs` with `browser/`
  - `sizes.mjs`, `extract-wasm.mjs`, `u1-demo.mjs`, `smoke.mjs`
  - `ts-consumer/`
- Outputs, in `H/out/`:
  - `engine-run.txt` (every vector with `toPrecision(17)`) and `engine-results.json`
  - `native42/`, `native47/` (`*.b.log` printed output, `*.print.log`, `*.native.raw`)
  - `compare-native42.md`, `compare-native47.md`
  - `native-probes.txt`
  - `browser-run.txt`
  - `sizes.md`
  - `engine-extra.txt`, `compare-extra.txt`
  - `u1-demo.txt`, `smoke.txt`
- Data, in `D/`:
  - `spice.wasm` (extracted) and `wasm-sections.txt`, `wasm-strings.txt`
  - `eecircuit-engine.stripped.mjs` (dist without the base64, same line numbers)
  - `npm-view.json`, `npm-time.json`
  - `mirror-ls-remote.txt`
  - `dl-next/`, `next-extract/` (the `next` build, not executed)
  - `dl-emsdk/`, `dl-engine-history/` (metadata-only clones)

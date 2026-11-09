# Fact-check of `engine.md` (eecircuit-engine 1.9.0)

Date: 2026-11-09. Scope: the 10 decision-relevant claims named in the task, plus anything else I found while re-checking them. Each claim was re-checked against primary evidence with my own scripts. I did not reuse the teammate's harness code; I imported only the fixture netlists from `fixtures.mjs`, which is pure data. The engine always ran read-only: Node 22 with `--permission --allow-fs-read=<pkg>/dist --allow-fs-read=<my scripts>`, or headless Chromium via Playwright. Native references: `/usr/bin/ngspice` (42) and the scratchpad ngspice-47 build.

| Prefix | Absolute path |
|---|---|
| `FC/` | `<scratch>/research/factcheck/` (my scripts in `FC/scripts/`, outputs in `FC/out/`, native runs in `FC/native/`) |
| `REPO/` | `<scratch>/src/eelab-dev_EEcircuit-engine/` |
| `PKG/` | `<scratch>/src/npm-eecircuit-engine/package/` |
| `NG47/` | `<scratch>/src/ngspice47/ngspice-47/` |
| `DIST:n` | line n of `PKG/dist/eecircuit-engine.mjs` (same line numbers in my base64-stripped copy `FC/out/stripped.mjs`) |

---

## 1. Summary

| # | Claim in engine.md | Verdict |
|---|---|---|
| 1 | The engine is ngspice-45.2, because the tag regex in `Docker/run.sh` only matches `ngspice-X.Y` | **Confirmed** |
| 2 | KLU is compiled in; XSPICE and OSDI are off | **Confirmed** |
| 3 | Download is 19.40 MiB raw / 5.38 MiB gzip / 3.57 MiB brotli, and the wasm is inlined twice | **Confirmed.** One nuance: 3.57 MiB needs precompressed brotli q11 |
| 4 | Every fixture vector is bit-identical to native 42 | **Confirmed**, and extended to 87/87 vectors over 14 circuits |
| 5 | `.tf` and `savecurrents` vector names | **Confirmed.** Nuance: the names (and their case) depend on how the rawfile is written |
| 6 | A non-ASCII title makes `runSim()` hang (string index used as byte offset) | **Partly refuted.** The mechanism is right, but when the extra UTF-8 bytes are a multiple of 8, the engine returns **silently wrong numbers** instead of hanging |
| 7 | A fatal error or `quit` leaves `runSim()` unsettled | **Confirmed but incomplete.** More typos are fatal, numparam errors **freeze the thread**, and an aborted analysis returns stale results |
| 8 | Only one live instance per realm (`window.prompt`) | **Confirmed.** Correction: the first instance can also return **stale results silently**, not only time out |
| 9 | The wasm heap grows about 28 KiB per run | **Confirmed.** The cause is now proven: 7 Asyncify buffers of 4,108 B are leaked per run |
| 10 | No ngspice licence notices are shipped | **Confirmed.** Nuance: the binary's banner carries the two copyright lines, but not the licence terms |
| – | Report §7.3: "Stale results after a failed run? **None**" | **Refuted** (section 3) |

**Net effect on the recommendation.** The report says to use the engine only as a stand-in and to build our own pinned ngspice 47 long-term. The new findings make that recommendation stronger. The report presents the engine's failure modes as hangs that a timeout catches. In fact, three paths return plausible-looking **wrong numbers** that no timeout can catch:

- non-ASCII titles whose extra UTF-8 byte count is a multiple of 8;
- an analysis that aborts, which returns the previous circuit's results;
- a second instance in the same realm, which makes the first return its own old result.

For a beginner tool, that is the biggest risk.

---

## 2. Claim by claim

### Claim 1: ngspice-45.2, chosen by the tag regex — CONFIRMED

- **Banner from my own run:** `** ngspice-45.2 : Circuit level simulation program`, `** Compiled with KLU Direct Linear Solver`, `** Creation Date: Sat Oct 24 23:49:49 UTC 2026` (`FC/out/engine-fixtures.json`, key `__banner`; also `FC/out/features.txt`). The wasm string table has `45.2` right before the bug-report URL and that date (`strings -n 2 FC/out/wasm-copy1.wasm`).
- **Mirror refs:** my fresh `git ls-remote https://github.com/danchitnis/ngspice-sf-mirror` (239 refs) is **identical** to the teammate's capture (`FC/out/mirror-ls-remote-recheck.txt`).
  - Tags at 40 and above: `ngspice-40 … ngspice-44, 44.2, 45, 45.2, 46, 47`.
  - Applying `REPO/Docker/run.sh:35` (`grep -E '^ngspice-[0-9]+\.[0-9]+$' | sort -V | tail -n 1`) gives `ngspice-45.2`. The only tags that match are `31.3, 32.2, 39.2, 39.3, 44.2, 45.2`.
  - The regex has always skipped every `.0` release (40 to 47). Making the `.Y` optional would pick `ngspice-47`.
  - `run.sh:46-50` (the first `pre-master-N` above 45.2) gives `pre-master-46`.
- **History:** `git log -S` on the full-history clone shows the regex arrived in `297d4c6`, 2025-03-09.
- **The `next` build:** I re-extracted the wasm from `1.9.0-next.1794034016`. Its tarball sha1 `5c86e472…` equals the registry's. The version string `45+` sits next to `Sat Nov  7 06:42:41 UTC 2026`, as the report says.
- **NEWS dates** (`NG47/NEWS:1,31,65`): 47 Aug 9 2026, 46 Mar 29 2026, 45.2 Sept 5 2025.
- **Correction:** none.

### Claim 2: configure flags, KLU compiled in, XSPICE/OSDI off — CONFIRMED

- **Flags:** `REPO/Docker/run.sh:107` has `--disable-debug --disable-openmp --disable-xspice --disable-osdi --without-x -with-readline=no`. There is no `--disable-klu`. In 47's `configure.ac`, KLU (`:195-196`, "Default=yes"), XSPICE (`:142-143`) and OSDI (`:146-147`) are all **on by default**, so the engine turns XSPICE and OSDI off on purpose and keeps KLU.
- **Run-time solver:** SPARSE, unless `.options klu` is given.
  - Source: `NG47/src/spicelib/analysis/cktntask.c:142-143` (`TSKkluMODE = CKTkluOFF`).
  - Native 42 and 47 both print `Using SPARSE 1.3 as Direct Linear Solver` by default and `Using KLU as Direct Linear Solver` with `.options klu` (`FC/native/k.cir`, `k2.cir`).
- **Functional probe in the engine** (`FC/scripts/fc-features.mjs`, output `FC/out/features.txt`):
  - `version -f` prints no "XSPICE extensions included" and no CIDER line.
  - `codemodel …` gives `codemodel: no such command available in ngspice`, and `pre_osdi …` gives `osdi: no such command available in ngspice`.
  - An `A` device gives `unknown device type - error`.
  - `.model qh npn level=8` gives `Unable to find definition of given model` (HICUM L2 removed).
- **Correction:** none. (The strings `codemodel`, `pre_osdi` and `XSPICE` do occur in the wasm, but only as text; the commands don't exist.)

### Claim 3: sizes, and the wasm inlined twice — CONFIRMED (one nuance)

- **Extraction** (`FC/scripts/extract_wasm.py`):
  - `DIST:61` and `DIST:2381` each hold 8,175,752 base64 characters, decoding to 6,131,813 bytes with sha256 `0c4bef30…5004`. The two copies are identical, and identical to the teammate's `spice.wasm`.
  - The UMD file holds the same two copies (its lines 94590 and 142312).
- **The second copy is dead code:** it sits in the Node-only branch, and its `e.protocol === "file:"` test (`DIST:2382`) can never be true for a `data:` URL.
- **Sizes** (`FC/scripts/sizes.mjs`, Node zlib; `FC/out/sizes.txt`):

| File | raw | gzip -9 | gzip -6 | brotli q11 w22 | brotli q11 w24 | brotli q5 | brotli q4 |
|---|---|---|---|---|---|---|---|
| `dist/eecircuit-engine.mjs` | 20,346,804 B = 19.40 MiB | **5.38** | 5.41 | **3.57** | 1.88 | 4.33 | 4.63 |
| wasm alone | 6,131,813 B = 5.85 MiB | 1.88 | 1.88 | 1.21 | 1.21 | 1.46 | 1.63 |
| `.mjs` without the two wasm copies | 3.81 MiB | 0.38 | 0.39 | 0.19 | 0.19 | 0.25 | 0.27 |

- **Nuance:** 3.57 MiB needs a precompressed brotli-q11 asset. On-the-fly brotli (levels 4–5, typical for servers and CDNs) gives 4.3–4.6 MiB, and gzip gives 5.4 MiB. The realistic transfer size is therefore 4.3–5.4 MiB, unless we host precompressed files. ("Can't be cached as its own file" is right as worded: the 19.4 MiB `.mjs` as a whole is HTTP-cacheable, but the wasm can't be cached or updated on its own.)

### Claim 4: bit-identical to native 42 — CONFIRMED (extended)

- **Method:** `FC/scripts/fc-engine.mjs fixtures` ran all 12 fixtures plus two of mine on **one** instance and exported the engine's raw `out.raw` bytes. `FC/scripts/rawcmp.py`, my own byte-offset parser, compared them bit for bit with native rawfiles produced two ways:
  - **pipe mode** with the engine's exact command flow (`source; destroy all; run; write`);
  - **`-b -r`** batch rawfiles.
  - I also checked that the engine's *returned* values equal the bytes it read.
- **Native 42, pipe mode:** **87/87 vectors bit-identical** (`FC/out/cmp42.txt`). This covers all 14 circuits, including two the report didn't test:
  - **A1**, a complex `.ac` (4 vectors × 5 points);
  - **L1**, a 40-section RC ladder `.tran` (43 vectors × 237 points).
- **Native 47:** 40/87 (`FC/out/cmp47.txt`).
  - Every `.op`, `.tf`, `.dc`, `.ac` and savecurrents vector is identical.
  - T1 has 519 vs 520 points. L1 has the same point count but different time steps.
  - After linear interpolation, the largest difference is **1.1e-5 of full scale for T1 and 6.9e-4 for L1** (`FC/out/interp47.txt`). Transient golden tests across versions need a tolerance of about 1e-3 near edges, or the same version (this supports report §9.3).
- **Side findings** (not about the engine):
  - Native `-b -r` rawfiles write uninitialised memory (4.7e-310) as the imaginary part of the AC `frequency` scale.
  - Native `-b -r` rawfiles name and omit vectors differently (see claim 5).

### Claim 5: `.tf` and savecurrents vector names — CONFIRMED (nuance)

- **From my engine run** (`FC/out/engine-fixtures.json`):
  - F4: `v(transfer_function)`, `v(output_impedance_at_v(a))`, `v(v1#input_impedance)`, all of type `voltage`.
  - S2: `v(a)`, `i(@f1[i])`, `i(@itest[current])`, `i(@r1[i])`, `i(@r2[i])`, `v(n1)`, `i(vx)`, `v(x)`.
  - S1: `i(@r1[i])`.
  - F2a and F2b: the extra `v(all)`.
- **Source of the names:**
  - `NG47/src/spicelib/analysis/tfanal.c:91-100` creates `Transfer_function`, `<src>#Input_impedance` and `output_impedance_at_<out>`.
  - `NG47/src/frontend/rawfile.c:163-186` wraps voltage-type vectors as `v(…)` and current-type vectors as `i(…)`.
- **Nuance:** these lowercase names come from the `write` command. ngspice's own batch `-r` rawfile keeps the analysis case (`v(Transfer_function)`, `v(v1#Input_impedance)`, `v(output_impedance_at_V(a))`) and has **no `v(all)`** (`FC/out/cmp42.txt`, F2a/F4 rows). Name mapping and golden tests should compare names case-insensitively and must not assume `v(all)` exists. This matters if our own build uses a different output path (`-r`, or the shared-library vector API).

### Claim 6: a non-ASCII title hangs `runSim()` — PARTLY REFUTED

- **Mechanism (confirmed):** `REPO/src/readOutput.ts:61-77` decodes the whole buffer as UTF-8, takes `indexOf("Binary:")` in the **string**, and builds `new DataView(buf, offset + 8)` running to the **end of the buffer**. It then reads `getFloat64(i)` for `i = 0, 8, 16, … < byteLength`.
- **Why it isn't always a hang:** with k extra UTF-8 bytes before `Binary:`, the view starts k bytes early and is k bytes longer. A RangeError, and so the hang, happens **only when k is not a multiple of 8**. When k = 8, 16, 24 …, nothing throws, and `runSim()` **resolves with rotated, wrong values**.
- **Measured** (`FC/scripts/fc-engine.mjs titles`, `FC/out/titles.jsonl`; fresh instance each, circuit F1a, true answer `v(n1)=6, i(v1)=-3`):

| Title | Extra UTF-8 bytes | Result |
|---|---|---|
| `T ö…ö test` with k = 1–7, 9, 15 | k | never settles |
| `T öööööööö test` | 8 | **settles**: `v(n1)=[2.1523351497502338e-259, -3]`, `i(v1)=[6]` |
| k = 16, 24 | 16, 24 | settles, wrong (rotated further) |
| `Gerilim bölücü: çıkış gerilimi (Ω)` (natural Turkish) | 8 | **settles: `v(n1)=2.15e-259`, `i(v1)=6`** |
| `a→b→c→d→e` | 8 | settles, wrong |
| `Test 🔋 battery` | 2 | never settles |
| the report's U1 title | 6 | never settles (matches the report) |

- **Other analyses with k = 8:**
  - `.tran`: `time[0] = 2.15e-259`, the `v(in)` column holds the time values, `v(out)` holds `v(in)`, and so on.
  - `.ac`: the frequency's real part is garbage and its imaginary part holds the frequency.
  - Arrays get one extra element (2 values while `numPoints` is 1).
- **Correction:** "hangs" should read "hangs, or (about 1 time in 8) returns silently wrong numbers". The report's guard (an ASCII title) still fixes both cases, but a timeout alone does **not** catch this.

### Claim 7: a fatal error or `quit` leaves `runSim()` unsettled — CONFIRMED BUT INCOMPLETE

Each probe ran in its own process with an external 14 s kill, because some probes block the thread (`FC/out/fatal2.txt`, `FC/out/fatal-<n>.json`). "Dead" means a valid F1a run afterwards on the same instance also never settles.

| Netlist error | Engine result |
|---|---|
| `.include nothere.lib` (report's I1) | never settles; instance **dead**. Confirmed |
| `.control` / `quit` / `.endc` (report's C1) | never settles; instance **dead**. Confirmed |
| `.subckt div a b` with no `.ends` | never settles; **dead** (`Mismatch of .subckt ... .ends statements!`). **New** |
| stray `.ends` | never settles; **dead**. **New** |
| `.lib nothere.lib tt` | never settles; **dead** (`ERROR, library file nothere.lib not found`, `fatal error in ngspice, exit(1)`). **New** |
| `.param R 1k` (no `=`) | **thread frozen**: the in-process 4 s timer never fired; the process ran at 93 % CPU with 473 MB RSS and was killed at 14 s. **New** |
| `R1 n1 0 {R` (missing `}`) | **thread frozen**, killed at 14 s. **New** |
| `R1 n1 0 {Rx}` (undefined parameter) | **thread frozen**, killed at 14 s. **New** |
| `X1 n1 0 nosuch` (unknown subcircuit) | settles: plot `constants` plus an error (fine) |

- **Why numparam errors freeze the thread:** the error leads to `NG47/src/frontend/numparam/spicenum.c:363-391`. In interactive mode, ngspice loops `printf("Numparam expansion errors: Run Spice anyway? y/n ?")` with `yes_or_no()` (`numparam/mystring.c:33-52`) reading stdin.
  - The engine's stdin is `window.prompt` (`DIST:208`) → `getInput()`. That only ever returns the command list (`" "`, `"source test.cir"`, …), never `y`, `n` or EOF.
  - This read path calls no `eesim_sleep_hack`, so it is a **synchronous infinite loop**.
  - Native pipe mode shows the same prompt and exits when stdin ends (`FC/native/param.cir`).
- **Correction:** the hang list in §1 and §7.3 is longer than `.include` and `quit`.
  - Missing or extra `.ends` and a missing `.lib` file also kill the instance.
  - Numparam typos (`.param` without `=`, unbalanced braces, undefined `{param}`) **block the worker's thread**. A timeout must therefore run on the main thread, and the engine must never run on the main thread (the page would freeze).
- **Related, new:** a long run blocks its thread for its whole length. `.tran 0.1u 400m` produced 4,000,008 points in 25.6 s, and a 300 ms timer on the same thread could not fire (`FC/out/stale.txt`). Under a strict CSP, `start()` also never settles (section 4, item 5).

### Claim 8: one live instance per realm — CONFIRMED (failure mode corrected)

- **Mechanism:** every module factory call overwrites `globalThis.window.prompt` with a closure over **its own** Module (`DIST:4`; `REPO/Docker/pre.js:1-11`), and every stdin read calls `window.prompt("Input: ")` (`DIST:208`).
- **Both instances started first:** the first-created instance never settles, in all three orders tried (`FC/out/multi.jsonl` sequences 1, 2 and 4). This matches the report.
- **Instance A used before B exists** (`FC/scripts/fc-multi2.mjs`, `FC/out/multi2.txt`): A's later runs come back at once with **A's old result**.
  - A run 1, 6 V → title `a-first 6v`, `v(n1)=6`.
  - B created and run → `v(n1)=10`.
  - A run 2, **8 V sent** → title `a-first 6v`, `v(n1)=6`.
  - A run 3, **9 V sent** → the same stale result.
  - B keeps working.
- **Correction:** "the one created first never completes" should read "the first instance either never completes or **silently returns its previous result**". Use exactly one instance per worker.

### Claim 9: per-run heap growth — CONFIRMED, cause proven

- **Measurement:** 3000 runs of F1a on one instance (`FC/scripts/fc-engine.mjs leak 3000`, `FC/out/leak.json`). Wasm memory stays at 16.75 MiB up to run 500, then reaches 24.19 at 750, 34.88 at 1000, 60.31 at 2000 and 86.88 at 3000. These match the report's table exactly.
- **Instrumentation** of `Module.Asyncify.currData` (the getter and setter on the exposed `Asyncify` object), per run:
  - **7** stdin reads: `" "`, `remcirc`, `source test.cir`, `destroy all`, `run`, `write out.raw`, and the wrap-around `" "`;
  - **14** data blocks allocated, each `malloc(12 + StackSize 4096)` (`DIST:1718-1720`);
  - **7** freed, and **7** overwritten while still live, so never freed.
  - That gives 7 × 4,108 B = **28,756 B = 28.08 KiB per run**.
- **Cause:** `__asyncjs__eesim_sleep_hack` (`DIST:1785`) wraps `handleThings` in `handleAsync`, and `handleThings` starts a nested `handleAsync` (`REPO/src/simulationLink.ts:173-216`). The inner sleep stores its block in `J.currData`, then the outer sleep stores a second block in the same field (`DIST:1757`). Only the second block is freed on rewind (`DIST:1759`).
- **Correction to the report's hypothesis:** it is 7 commands per run, not about 6, and this leak accounts for **all** of the growth. It costs a fixed amount per command, whatever the circuit size.
- **In practice:** 1000 runs ≈ 28 MiB, and the 2 GiB cap is reached after about 74,000 runs, so recycling every 1000 runs is ample. Time per run in my measurement went from 0.77 ms to 1.12 ms over 3000 runs (noisy, mild).

### Claim 10: no ngspice licence notices shipped — CONFIRMED (nuance)

- **Package contents** (`find PKG -type f`): `LICENSE` (MIT, "Copyright (c) 2024 EElab.dev"), `README.md`, `package.json` (`"license": "MIT"`) and `dist/*`. There is no ngspice `COPYING`, no BSD conditions or disclaimer for ngspice, and no LGPL text.
- **Bundle text:** the only BSD licence text in the bundle is the FreePDK15 header (all 3 `Redistribution` matches in `FC/out/stripped.mjs`). Apache headers come with the SkyWater and GF180 cards.
- **Nuance:** the wasm contains, and prints in `getInitInfo()`, the lines `Copyright 1985-1994, Regents of the University of California.` and `Copyright 2001-2025, The ngspice team.`. So the copyright *lines* are present, but the licence *terms* are not.
- **45.2's licence:** `COPYING` at tag `ngspice-45.2` (fetched from the mirror, `FC/out/COPYING-45.2.txt`) is identical to 47's apart from the document year (2025 vs 2026). The report's reading therefore holds for 45.2 too: Modified BSD, with **LGPLv2 for `src/maths/KLU`** and **LGPLv2+ for `src/frontend/numparam`**. Both are statically linked into the one wasm.

---

## 3. Refuted table row: "Stale results after a failed run? None" (report §7.3)

**Test** (`FC/scripts/fc-stale2.mjs`, `FC/out/stale2.txt`): on one instance, run a good divider (`v(n2)=3`), then a netlist whose analysis **aborts**.

| Second netlist | What `runSim()` returned for it |
|---|---|
| `V1 n1 0 6` + `V2 n1 0 5` (two sources in parallel with different values, a classic beginner mistake) | plot "Operating Point", **title "good divider", `v(n1)=6, v(n2)=3, i(v1)=-0.003`**: the previous circuit's results |
| `E1 out 0 n1` (missing gain) | the same stale "good divider" results |

- **What happened:** `getError()` did contain `Error: Transient op failed, timestep too small`. The analysis aborts, so `write out.raw` writes nothing (`no writable vector found`). The wrapper then reads the previous run's `/out.raw`, still on MEMFS (`REPO/src/simulationLink.ts:179`, `DIST:2393`). On a fresh instance the same netlist never settles, because `readFile` throws and the error is swallowed (`FC/out/esrc.txt`).
- **Native check:** native 42 and 47 also abort and write no rawfile for the parallel-sources netlist (`FC/native/vloop.cir`), so the stale result comes from the wrapper.
- **Why the report missed it:** its sequence (E2, E4, E1, E6) contained no aborting analysis.

---

## 4. What the report missed for the eecircuit-engine vs own-ngspice-47 decision

1. **Silent wrong numbers** (claims 6 and 8, section 3). These are the most serious risk for a beginner tool, and the report frames the failures as hangs.
   - **Cheap guard:** make every run's title a unique ASCII nonce (for example `run-000123`), and reject any result whose `Title:` header (lowercased by ngspice) doesn't match.
   - **Optionally:** delete `/out.raw` before each run through `__getSpiceModuleForTests().FS` (a test hook, not a supported API).
2. **Thread freezes** (numparam errors, long runs).
   - The timeout must live outside the engine's thread, and `start()` needs one too.
   - Exits leave the event loop free, so a worker can fail fast by polling `getError()` / `getInfo()` for `fatal error in ngspice` or `ngspice-45.2 done`. The y/n loop can only be caught from the main thread.
3. **The list of fatal typos is longer** than `.control`, `.include` and `.lib`. Pre-validate:
   - `.subckt`/`.ends` balance;
   - `.param name=value` syntax;
   - balanced braces;
   - parameters that are defined.

   Otherwise each such typo costs a timeout plus about 0.6 s to restart the worker (the 20 MB JS module must be re-evaluated).
4. **The shared-library API doesn't remove the reset after a fatal error.** In a shared build, `controlled_exit()` calls `shared_exit()` (`NG47/src/frontend/error.c:36-38`). That reports through the ControlledExit callback and `longjmp`s back, but prints "ngspice.dll cannot recover and awaits to be reset or detached" (`NG47/src/sharedspice.c:2133-2196`). So our own build must still re-instantiate after a fatal error.
   - Keep the compiled `WebAssembly.Module` to make that cheap; eecircuit-engine's design doesn't allow it.
   - Upside: `sharedspice.c` never sets `interactive` (only `NG47/src/main.c:1188-1195` does), so a numparam error goes straight to `controlled_exit()` and the callback, instead of the endless y/n loop. It is still a fatal error that needs a reset, but it is reported at once. In an executable build, our driver can simply answer EOF on stdin.
   - Without pthreads (GitHub Pages can't send COOP/COEP headers), runs are synchronous in **both** designs, and cancelling a run means `worker.terminate()`.
5. **CSP.** In Chromium, a page and worker served with `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'` fail to load the engine: the `data:` fetch is blocked, then the XHR fallback, then `Aborted(...)`, and **`start()` never settles**. It works once `connect-src 'self' data:` is added (`FC/scripts/csp-test.mjs`, `FC/out/csp.txt`). A same-origin `.wasm` from our own build needs only `connect-src 'self'`.
6. **Supply chain.**
   - The `latest` 1.9.0 was published from the maintainer's personal npm account (`_npmUser: danchitnis`) with **no provenance attestation**.
   - No workflow publishes `latest`: `REPO/.github/workflows/build-main.yml` only builds and tests.
   - Only the `next` builds are published by GitHub Actions as a trusted publisher with SLSA provenance (`FC/out/npm-registry-check.txt`).
   - The 1.9.0 wasm was built on a Saturday at 23:49 UTC, which matches neither cron slot (00:30 and 01:00 Saturday).
   - So the binary we would ship can't be tied to a CI log or a commit. Pinning version plus integrity freezes it, but doesn't make it auditable. (The tarball's sha1 `406a580b…` and sha512 do match the live registry.)
7. **LGPL.** Both options statically link numparam (LGPLv2+).
   - eecircuit-engine also links KLU (LGPLv2), and we can't drop it.
   - Our own build can use `--disable-klu` (SPARSE is the default solver anyway). The team's 47 build already does: `<scratch>/wasm/dist/BUILDINFO-O2.txt`.
   - Shipping LGPL code means shipping its licence text and corresponding source. For eecircuit-engine, the exact build inputs (the emsdk version) are not recorded.
8. **Error behaviour depends on the version.** `E1 out 0 n1` (gain missing) is rejected by native 42 and 47 with `Error: not enough parameters in line` / `No circuit loaded!`. The 45.2 engine accepts it, simulates a singular circuit, and on a used instance returns stale results (`FC/out/esrc.txt`, `FC/out/stale2.txt`). Trap explanations and error-classification tests written against 45.2 won't carry over to 47.
9. **A comparison point now exists.** The team's own pinned ngspice-47 wasm (`<scratch>/wasm/dist/ngspice.wasm`) is 4,417,373 B raw, **1.44 MiB gzip / 0.96 MiB brotli**, with no Asyncify, emcc 7.0.0, the tarball sha256 pinned and `--disable-klu`. That compares with eecircuit-engine's 5.38 MiB gzip download (1.88 MiB for its wasm alone). I checked the size and exports only, not its numbers.
10. **Netlist size guard** (needed in either design). One beginner-sized typo, `.tran 0.1u 400m`, gave 4 million points and a 25.6 s blocking run. The engine has no progress reporting and no abort.

---

## 5. Guards in report §10.3: what should change if the spike uses the engine

| Guard in §10.3 | Change |
|---|---|
| 2. Timeout on every run | Run the timeout on the **main thread** (in-worker timers can't fire during a run or the numparam loop). Also time out `start()`. Never call `runSim()` again on an instance whose last run hasn't settled: terminate it. |
| 3. Make the header ASCII | Use a **unique ASCII nonce** as the title, and check the returned `Title:`. This also catches stale results. |
| 4. Strip `.control`, `.include`, `.lib` | Also validate `.subckt`/`.ends` balance, `.param name=value`, braces and undefined parameters. |
| 6. Classify `getError()` | Add `Transient op failed`, `run simulation(s) aborted`, `no writable vector found`, `Mismatch of .subckt` and `fatal error in ngspice` as failures. |
| New | Never put the engine on the main thread. If the page uses a CSP, add `connect-src data:`. |

---

## 6. Other claims checked in passing (all confirmed)

| Claim | Evidence |
|---|---|
| Tarball sha1 `406a580b…` = registry `dist.shasum` | My sha1 and sha512 of `…/src/npm-eecircuit-engine/eecircuit-engine-1.9.0.tgz` equal the live registry values; the unpacked dir equals the tarball (`FC/out/npm-registry-check.txt`) |
| 46 imports, 37 exports, memory 268–32,768 pages, code 5.61 MB, data 0.51 MB, no `producers` section | `FC/scripts/wasm-iface.mjs` (compiles the module, never instantiates it) |
| One maintainer; 104 commits; first commit 2024-12-16; 61 commits in 2025 and 42 in 2026; no tags; 18 stable and 71 `next` releases | `git log` on the full-history clone (3 author identities, all Danial Chitnis); `npm-time.json`; the last 6 `next` builds are 6 consecutive Saturdays |
| EEcircuit uses a 30 s timeout and terminate-and-replace | `…/danchitnis_EEcircuit/src/simulation/parallelSimulation.ts:43` (`DEFAULT_TIMEOUT = 30000`), `:156-165` (`replaceWorker` → `terminate`) |
| Only the last plot comes back (M1) | Confirmed. Nuance: with `.tf` before `.op` the Transfer Function plot still comes back, so it is the last analysis ngspice *runs*, not the last line in the netlist (`FC/out/m1.txt`) |
| U2 mangling (`v(giri__)`, `v(____k____)`) also in 42 and 47 | `FC/native/u2.cir` pipe-mode rawfiles |
| Start-up in our own module worker | Chromium: import + `start()` + first run ≈ 0.70 s (`FC/out/csp.txt`, no-CSP row), consistent with the report's "ready 606 ms" |
| Emscripten 6.0.13 | **Unverifiable**: the wasm has no `producers` section, as the report says (it marks this as an inference) |

---

## 7. Reproduce

```
FC=<scratch>/research/factcheck
P=<scratch>/src/npm-eecircuit-engine/package
H=<scratch>/research/engine-harness
N47=<scratch>/native/ngspice-47/bin/ngspice
RO="--permission --allow-fs-read=$P/dist --allow-fs-read=$FC/scripts"
cd $FC/scripts
python3 -I extract_wasm.py $P/dist/eecircuit-engine.mjs $FC/out            # claim 3: two identical copies
node sizes.mjs $P/dist/eecircuit-engine.mjs $FC/out/wasm-copy1.wasm         # claim 3: sizes
node $RO fc-engine.mjs $P/dist/eecircuit-engine.mjs titles > $FC/out/titles.jsonl        # claim 6
for i in 0 1 2 3 4 5 6 7 8 9 10; do timeout 14 node $RO fc-engine.mjs $P/dist/eecircuit-engine.mjs fatal x $i; echo "exit $?"; done   # claim 7 (exit 124 = frozen thread)
node $RO fc-stale2.mjs $P/dist/eecircuit-engine.mjs                         # stale results after an aborted analysis
node $RO fc-engine.mjs $P/dist/eecircuit-engine.mjs multi; node $RO fc-multi2.mjs $P/dist/eecircuit-engine.mjs   # claim 8
node $RO fc-engine.mjs $P/dist/eecircuit-engine.mjs leak 3000 > $FC/out/leak.json          # claim 9
node $RO --allow-fs-read=$H fc-engine.mjs $P/dist/eecircuit-engine.mjs fixtures $H/fixtures.mjs > $FC/out/engine-fixtures.json
node --permission --allow-fs-read=$H --allow-fs-read=$FC/scripts dump-fixtures.mjs $H/fixtures.mjs > $FC/out/fixtures.json
python3 -I rawcmp.py $FC/out/engine-fixtures.json /usr/bin/ngspice $FC/native/n42 native42 $FC/out/fixtures.json   # claim 4
python3 -I rawcmp.py $FC/out/engine-fixtures.json $N47 $FC/native/n47 native47 $FC/out/fixtures.json
python3 -I interp.py $FC
node $RO fc-features.mjs $P/dist/eecircuit-engine.mjs                       # claim 2 (functional)
NODE_PATH=/opt/node-tools/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node csp-test.mjs $P/dist/eecircuit-engine.mjs $FC/scripts/browser
```

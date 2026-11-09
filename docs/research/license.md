# Choosing the project's licence: what ngspice obliges us to do, and which licence for our code

Date: 2026-11-09. Research input for Tarık's decision.

**This is not legal advice.** The facts below come from files read and commands run in this session (path + line, or command + output). The reading of licence terms is a careful layperson's reading. Where a lawyer is needed, the text says **[lawyer]**; section 10 collects these points.

Path abbreviations used below:

| Short | Full path |
|---|---|
| `NG47` | `<scratch>/src/ngspice47/ngspice-47` (ngspice 47 tarball, SHA-256 `894e6496…675f`) |
| `DEB` | `/usr/share/doc/ngspice/copyright` (Ubuntu ngspice 42+ds-3build1) |
| `EEE` | `<scratch>/src/eelab-dev_EEcircuit-engine` (commit `be15b07`, v1.9.0) |
| `EEPKG` | `<scratch>/src/npm-eecircuit-engine/package` (npm eecircuit-engine@1.9.0) |
| `EEAPP` | `<scratch>/src/danchitnis_EEcircuit` |
| `DL` | `<scratch>/research/license-dl` (my downloads, each in its own folder: SuiteSparse 3.7.0 READMEs, SPDX licence texts, KiCad licence files, GitHub site-policy, ngspice 45.2 COPYING) |
| `WORK` | `<scratch>/research/license-work` (scan output `scan_src.tsv`, test netlists, `npm-licences.txt`) |
| `EMSDK` | `<scratch>/toolchain/emsdk/upstream/emscripten` (Emscripten 7.0.0) |

---

## 1. Short answer

1. **Licence for our code: MIT.** Runner-up: **Apache-2.0**. Pick GPL-3.0-or-later instead only if "nobody may ship a closed fork" becomes a goal (section 8).
2. **"ngspice is BSD-3-Clause" is true of ngspice's core, not of the binary we would ship.** Every ngspice build links numparam, which is LGPL version 2 or later, and no configure option removes it. Our minimal browser build would be: BSD-3-Clause + LGPL-2.0-or-later (numparam) + two old permissive University-of-California-style notices + a public-domain FFT + Emscripten's MIT runtime. A build with ngspice's default options adds LGPL-2.1-or-later KLU, MPL-2.0 OSDI, MPL-2.0 cppduals (not listed in COPYING at all), public-domain XSPICE, and a GPL-2.0-or-later code model (`table.cm`, built as a separate file).
3. **Minimal browser build:** `--disable-xspice --disable-osdi --disable-klu`, plus the HICUM2-removal patch (which eecircuit-engine also applies) and a small source fix that ngspice 47 needs to compile without XSPICE. Only numparam's LGPL remains. Default results do not change: SPARSE 1.3 is the default solver even when KLU is compiled in (native 42 and native 47 runs in section 5).
4. **What to ship** (section 6.9): `LICENSE` (MIT), `THIRD_PARTY_NOTICES.md`, `LICENSES/` (full texts, including LGPL-2.1), `engine/` (build script, patches, tarball SHA-256, `BUILD.json`, ngspice's `COPYING`), a GitHub Release with the exact `ngspice-47.tar.gz` and our build files. On the site: the `.wasm` as a separate file, a Licences page plus About dialog showing the copyright notices, and a `SOURCE.txt` next to the `.wasm` saying where the source is. Ideally the tarball is on the site too.
5. **Docs: CC BY 4.0** (sensible, with the caveats in section 9). **Example netlists:** CC0 1.0 for starter templates and test fixtures; CC BY 4.0 for the channel's episode circuits, with a one-line SPICE comment carrying the credit. **Name and logo:** not licensed at all; say so in a `TRADEMARKS.md`.

---

## 2. What ngspice's COPYING says, and whether "BSD-3-Clause" is accurate

`NG47/COPYING` (947 lines) and `DEB` (1373 lines) were read in full.

**The general statement.** `NG47/COPYING:10-15`:

> The ngspice source code has evolved over time by integrating contributions from various sources (e.g. Spice3f5, XSPICE, CIDER, numparam, tclspice and others). Thus a mixture of license statements prevails.
>
> The ngspice license is the `Modified BSD' license. This is adopted for all of its source code, test and example files except for the files listed below.

**The exceptions.** `NG47/COPYING:17-44`, verbatim:

```
************** files with licenses different to 'Modified BSD' ****************

* ngspice/m4
unnamed, compatible to DFSG

* ngspice/src/tclspice.c
LGPLv2

* all files in ngspice/src/maths/sparse
unnamed MIT license, compatible to New BSD

* all files in ngspice/src/maths/KLU
LGPLv2

* all files in ngspice/src/osdi
MPLv2.0

ngspice/src/spicelib/devices/ndev
public domain

ngspice/src/xspice
public domain
except for
ngspice/src/xspice/icm/table
GPLv2 or newer

ngspice/src/frontend/numparam
LGPLv2 or newer
```

The manual is CC BY-SA 4.0 (`COPYING:46-48`). COPYING itself is "license for this document: CC-BY-SA v4.0" (`COPYING:6`).

**The "Modified BSD" text is the 3-clause BSD.** `COPYING:53-67`:

> Copyright 1985 - 2018, Regents of the University of California and others
>
> Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
> 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
> 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
> 3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

**Verdict: accurate for the core, not for what we would ship.**

- The core is BSD-3-Clause.
- numparam (LGPL) is in every ngspice binary. It is linked with no condition into all three link targets: the `ngspice` program, the Tcl library and `libngspice` (`NG47/src/Makefile.am:172`, `:428`, `:554`). The core frontend calls it from 26 places in 6 files (`grep -rn "nupa_"` outside `numparam/`: `subckt.c`, `measure.c`, `runcoms.c`, `inp.c`, `runcoms2.c`, `xspice/evt/evtcheck_nodes.c`), and no configure option or `#ifdef` turns it off.
- So the honest one-line description is: **"ngspice (Modified BSD, with LGPL-licensed parts; see THIRD_PARTY_NOTICES)"**, not "BSD-3-Clause".
- ngspice 45.2, the version eecircuit-engine actually ships (section 4), has the same COPYING. `diff` against `DL/ngspice-45.2-mirror/COPYING` (tag `ngspice-45.2`, commit `724dc77`) differs only in line 3 (the year, 2025 vs 2026).

**The Debian file (`DEB`) disagrees with upstream in several places.** Use upstream COPYING and the file headers, not `DEB`:

| Topic | `DEB` says | Upstream says |
|---|---|---|
| `src/maths/KLU`, `src/osdi`, `src/include/cppduals` | Not listed, so they fall under `Files: *` BSD-3-clause (`DEB:16-18`) | KLU LGPL, OSDI MPL-2.0 (`COPYING:28-32`). cppduals is MPL-2.0 (`NG47/src/include/cppduals/duals/dual:11-13`). The Ubuntu binary does contain OSDI and cppduals code: `strings /usr/bin/ngspice` shows `OSDI_DESCRIPTORS` and the HICUM symbol `…N5duals4dualIdEE…` |
| `src/xspice/*` | BSD-3-clause (`DEB:807-809`) | public domain (`COPYING:37-38`, and headers such as `NG47/src/xspice/mif/mifload.c:5-9` "Public Domain / Georgia Tech Research Corporation") |
| numparam | `LGPL-2` with no "or later" (`DEB:148-150`, `:1336-1339`) | "version 2 of the License, or (at your option) any later version" (`NG47/src/frontend/numparam/readme.txt:8-11`) |
| `src/misc/getopt_long_bsd.c` | BSD-4-clause (`DEB:302-304`) | ISC plus 2-clause BSD in 47 ("license modified to be compatible to 3-clause BSD … 11/24/2018", `NG47/src/misc/getopt_long_bsd.c:1-55`) |

---

## 3. Every non-BSD component: licence, and whether it is compiled in

Sources: `NG47/configure.ac`, the `Makefile.am` files, file headers, and a header scan of all 2,308 source files in `NG47/src`. The scan script is `research/license-scripts/scan_licences.py`, run with `python3 -I`, and its output is `WORK/scan_src.tsv`. Native default build = `/usr/bin/ngspice` (Ubuntu 42) and the teammate's native 47 build. The minimal browser build is defined in section 5.

| Component (path) | Licence and evidence | How ngspice 47 builds it | Native default | eecircuit-engine 1.9.0 | Minimal browser build |
|---|---|---|---|---|---|
| ngspice core (Spice3f5 frontend, devices, analyses) | Modified BSD (`COPYING:14-15, 53-79`) | always | yes | yes | yes |
| **numparam** `src/frontend/numparam` | **LGPL v2 or later**, © 2002 Georg Post (`readme.txt:6-20`; file headers `spicenum.c:1-5`; `COPYING:43-44`) | **always**: no condition in `src/Makefile.am:172/428/554`, no configure switch | yes | yes (wasm strings `NUPA_SUBCKT` etc., defined in `numparam.h:30`) | **yes** |
| Sparse 1.3 `src/maths/sparse` | Permissive notice: "provided that the copyright notices appear in all copies and supporting documentation and that the authors and the University of California are properly credited" (`spalloc.c:34-48`). COPYING calls it "unnamed MIT license" (`:25-26`). Closest SPDX ID is `HPND-UC`, but the wording differs (`DL/spdx-license-list-data/text/HPND-UC.txt`) | always (`src/Makefile.am:201/455/581`) | yes | yes | yes |
| `src/spicelib/devices/dev.c`, `src/frontend/commands.c` | © 1990 UC, © 2000 Arno W. Peters, PostgreSQL-style notice "…provided that the above copyright notice, this paragraph and the following three paragraphs appear in all copies" (`dev.c:1-28`). **Not in COPYING.** `DEB:135-138, 501-504` labels it PostgreSQL | always (core files) | yes | yes | yes |
| Bison-generated parsers `parse-bison.c`, `inpptree-parser.c` | GPL-3.0-or-later **with the Bison special exception**: "you may create a larger work that contains part or all of the Bison parser skeleton and distribute that work under terms of your choice" (`parse-bison.c:1-32`). SPDX `Bison-exception-2.2` | always | yes | yes | yes (no obligations, because of the exception) |
| Built-in FFT `src/maths/fft` | Public domain, John Green (`Read-Me:1`, `NOTE:35` "This code is public domain, do anything you want to with it.") | always (`libmathfft.la`) | yes | yes | yes |
| FastNorm3 `src/frontend/trannoise/FastNorm3.c` | "Copyright Christopher Stewart Wallace." with no licence text (`:14-15`). It falls under COPYING's general Modified-BSD statement | always (`src/Makefile.am:173`) | yes | yes | yes (keep the copyright line in the notices) |
| getopt `src/misc/getopt_long_bsd.c`, `getopt_bsd.h` | `.c`: ISC + 2-clause BSD. `.h`: old 4-clause BSD with the advertising clause (`getopt_bsd.h:1-31`) | compiled, but the body is `#if`'d out when the platform has `getopt_long` and `getopt.h` (`configure.ac:989-992`; guard at `getopt_long_bsd.c:61-65`; `main.c:50-54`) | no (glibc has it) | probably not (musl has it; not verified) | probably not |
| **KLU + AMD + BTF + COLAMD** `src/maths/KLU` | COPYING says "LGPLv2" (`:28-29`). The source is SuiteSparse 3.7.0 (`src/maths/KLU/SuiteSparse.org`). Upstream 3.7.0 says **LGPL-2.1-or-later**: `DL/suitesparse-3.7.0/KLU/README.txt:21-24`, `BTF/README.txt:35-38`, `AMD/README.txt:32-64`, `colamd.c:47-76`. AMD and COLAMD add: "User documentation of any code that uses this code … must cite the Copyright, this License, the Availability note, and 'Used by permission.'" The in-tree KLU files only say "See the README" (`klu.c:36-37`), but the READMEs were not imported | `--enable-klu` "Default=yes" (`configure.ac:195-196, 299-306`); linked if `KLU_WANTED` (`src/Makefile.am:196-198`) | yes (banner "Compiled with KLU"), but SPARSE is the solver unless `.options klu` | **yes** (wasm strings `../../../../src/maths/KLU/klusmp.c`, "Set KLU as Direct Linear Solver") | **no** (`--disable-klu`) |
| **OSDI** `src/osdi` (+ `include/ngspice/osdiitf.h`) | **MPL-2.0**, © 2022 SemiMod GmbH, 2023 Pascal Kuthe (`osdiinit.c:1-10`). No "Incompatible With Secondary Licenses" (Exhibit B) notice anywhere (`grep -rn -i "Incompatible With Secondary" src` finds nothing) | `--enable-osdi` on unless `=no` (`configure.ac:1182-1212`); linked if `OSDI_WANTED` (`src/Makefile.am:184-186`). Its `.osdi` models are loaded only if `osdi_enabled` is set, and `spinit.in:16-17` unsets it | yes (OSDI strings in `/usr/bin/ngspice`) | no (`--disable-osdi`) | no. `osdiitf.h` is still included by `frontend/inp.c:21`, but it holds only type declarations, and its uses are under `#ifdef OSDI` |
| **cppduals** `src/include/cppduals/duals/dual` | **MPL-2.0**, ©2019 Michael Tesch (`dual:1-13`). **Not listed in COPYING** | Header-only C++ template, compiled into HICUM2 (`hicumL2.cpp:21` `#include "duals/dual"`). HICUM2 is always built (`src/Makefile.am:76`; `src/spicelib/devices/Makefile.am:30`) and needs libstdc++ | yes (symbol `duals::dual<double>` in `/usr/bin/ngspice`) | no (`EEE/Docker/hicum2_patch.sh` removes HICUM2) | no (HICUM2 patch) |
| **XSPICE** core `src/xspice/{mif,cm,evt,enh,idn}` | public domain (`COPYING:37-38, 83-98`) | `--enable-xspice` on by default (`configure.ac:1177`); linked if `XSPICE_WANTED` (`src/Makefile.am:160-167`) | yes | no (`--disable-xspice`) | no |
| XSPICE code models `src/xspice/icm/*` | analog/digital/spice2poly/xtradev/xtraevt: public domain or BSD. tlines: BSD-3 (`xspice/tlines/msline_common.c`). **`table`: GPL-2.0-or-later** (`icm/table/mada/alloc.c:3-17`, `eno*.c`, `table2D/cfunc.mod:6-26`, `table2D/ifspec.ifs:4-9`, the same for table3D). The makefile that builds them says "Under the GPLV2 or later license" (`icm/GNUmakefile.in:1-3`) | Built as **separate shared objects** `<cm>.cm`, one per directory in `CMDIRS = spice2poly digital analog xtradev xtraevt table tlines` (`GNUmakefile.in:10, 14-18`). They are loaded at run time by `codemodel` lines in `spinit` (`src/spinit.in:19-30`; `table.cm` at `:27`) | yes (`/usr/lib/x86_64-linux-gnu/ngspice/table.cm` exists) | no | no |
| Icarus Verilog / GHDL glue `src/xspice/verilog/vpi.c`, `src/xspice/vhdl/ghdl_vpi.c` | **GPL-2.0-or-later**, © 2002 Stephen Williams, 2023 Giles Atkinson (`vpi.c:1-19`). **Not listed in COPYING** | Built as a separate plugin `ivlng.vpi` when XSPICE is on (`xspice/Makefile.am:12`; `xspice/verilog/Makefile.am:25,30`). `ghdl_vpi.c` is installed as source | yes (plugin, not linked into ngspice) | no | no |
| NDEV `src/spicelib/devices/ndev` | "Permit to use it as your wish" (`ndev.c:1-5`) plus UC BSD headers | `--enable-ndev`, default off (`configure.ac:1239-1244`; `devices/Makefile.am:56-58`) | no | no | no |
| tclspice `src/tclspice.c` | "Under LGPLv2 licence since 2008, December 1st" (`tclspice.c:1-8`) | only with `--with-tcl` (`src/Makefile.am:359-374`) | no | no | no |
| `m4/` | `ax_*.m4`: "Copying and distribution of this file … permitted … provided the copyright notice and this notice are preserved" (`COPYING:561-570`). `libtool.m4`: GPL-2+ with an exception for configure scripts | build time only, never in a binary | no | no | no |
| Emscripten runtime (JS glue, libc in the wasm) | Emscripten: MIT **or** University of Illinois/NCSA (`EMSDK/LICENSE:1-12`). musl: MIT (`EMSDK/LICENSE:96-97`; `system/lib/libc/musl/COPYRIGHT`). dlmalloc: public domain / CC0 (`system/lib/dlmalloc.c:53-54`). compiler-rt/libc++: Apache-2.0 WITH LLVM-exception, which lifts the notice duties for embedded object code (`system/lib/libcxx/LICENSE.TXT:208-213`) | added by `emcc` | n/a | yes | yes |

**Two practical consequences.**

- With **default configure options**, a wasm or native ngspice 47 contains LGPL (numparam, KLU), MPL-2.0 (OSDI, cppduals) and public-domain XSPICE code, and `make install` also produces a GPL-2.0-or-later `table.cm` and `ivlng.vpi`.
- The GPL parts are always **separate files** (`.cm`, `.vpi`), never linked into `ngspice` or `libngspice`. In a browser build they would only come in if someone deliberately built XSPICE code models as side modules (one existing project does: ejkreboot/ngspice-xspice-wasm builds `.cm` files with `-sSIDE_MODULE=1`, `src/ejkreboot_ngspice-xspice-wasm/build-ngspice.sh:109-123`) or registered them statically.

**Upstream COPYING is incomplete.** It omits cppduals (MPL-2.0), the Verilog/VHDL VPI glue (GPL-2.0-or-later), the UC/Peters files and the public-domain FFT. If Tarık wants, the ngspice team could be told. That is optional and does not change anything for us.

---

## 4. What eecircuit-engine's build contains

**Configure line.** `EEE/Docker/run.sh:107`:

```
emconfigure ../configure --disable-debug --disable-openmp --disable-xspice --disable-osdi --without-x -with-readline=no
```

- KLU is not disabled, so it is on (the default, `configure.ac:299-306`).
- XSPICE and OSDI are off.
- HICUM2 is removed by `EEE/Docker/hicum2_patch.sh:1-25`. The script cites ngspice bug #793, a C++ problem, not licensing, but the effect is that there is no cppduals.
- CIDER and NDEV stay off (defaults). No Tcl.

**Version actually built: 45.2, not 47.** This is the teammate's finding (`research/engine.md:20, :39`): the tag regex in `run.sh:35` only matches `ngspice-X.Y`. COPYING and the linkage rules are the same in 45.2 (section 2; `DL/ngspice-45.2-mirror/src/Makefile.am:173, 198, 202` show numparam, KLU and sparse linked the same way).

**Components in its wasm** (`research/engine-data/spice.wasm`, 6,131,813 bytes, checked with `strings`):

- BSD core
- numparam (`NUPA_SUBCKT`, `NUPA_REAL` …)
- KLU (`../../../../src/maths/KLU/klusmp.c`, "KLU Memory Grow Factor …")
- Sparse 1.3 ("Using SPARSE 1.3 as Direct Linear Solver")
- the UC/Peters files, the Bison output, the PD FFT and the Emscripten runtime.

So its licence mix is **BSD-3-Clause + LGPL-2.0-or-later (numparam) + LGPL-2.1-or-later (KLU, AMD, BTF, COLAMD) + permissive notices**.

**How it is labelled:**

- `EEE/LICENSE:1-3` "MIT License, Copyright (c) 2024 EElab.dev"; `EEE/package.json:38` `"license": "MIT"`.
- The npm package has only `README.md`, `LICENSE`, `package.json` and `dist/` (`find EEPKG -type f`). It has no ngspice COPYING, no LGPL text and no source link.
- The wasm is inlined into the JS as base64: two occurrences of `data:application/wasm;base64,AGFzbQ` in `EEPKG/dist/eecircuit-engine.mjs` (20,346,804 bytes). That makes "replace the LGPL library" harder than with a separate `.wasm` file.
- The bundle writes PTM model cards into the virtual file system (`r.FS?.writeFile("/modelcard.ptmLP", …)` in the `.mjs`). Their source says "All the models in this file belongs to ASU" (`EEE/src/models/ptm.ts:1-3`): there is no licence grant.
- The EEcircuit app is MIT (`EEAPP/LICENSE`: "MIT License, Copyright (c) 2020 Danial Chitnis"). `EEAPP/README.md:46` credits ngspice, but I found no notice texts in the app.

**Takeaway.** EEcircuit and eecircuit-engine label everything "MIT". That is accurate for their wrapper code and not for the ngspice inside. Other ngspice-wasm projects do the same (wokwi/ngspice-wasm MIT, `src/wokwi_ngspice-wasm/LICENSE`; ejkreboot MIT in its README while shipping `table.cm`, `research/builds.md:154-155`). **We should not copy that practice.** If we ever ship eecircuit-engine, even as a stand-in, we must add the BSD + LGPL (numparam and KLU) notices and source links ourselves, and avoid exposing the PTM cards.

---

## 5. The minimal browser build and what it contains

**Configure flags.** These are the flags the teammate's script already plans (`<scratch>/wasm/build-ngspice-wasm.sh:89-98`):

```
--disable-debug --with-x=no --with-readline=no --with-editline=no --disable-openmp
--disable-xspice --disable-osdi --disable-klu --with-fftw3=no
```

**Patches** (all to BSD files):

- **HICUM2 removal.** The same edits as eecircuit-engine's; the script's default is on (`build-ngspice-wasm.sh:66-80`). It removes cppduals (MPL-2.0) and the C++ runtime.
- **XSPICE-off compile fix.** ngspice 47 does not compile with `--disable-xspice`. The `#else` branch at `NG47/src/spicelib/analysis/cktsopt.c:253-255` uses `OPT_ENH_RSHUNT`, which is defined only inside `#ifdef XSPICE` (`NG47/src/include/ngspice/optdefs.h:141-156`). This is the teammate's finding (`research/builds.md:260`), confirmed here by reading both files. A one-line patch is needed (DSchem's `0001-xspice-options-enum.patch` exists; upstream pre-master-48 fixes it). The script does not contain this fix yet.

**What remains in `ngspice.wasm`:**

- ngspice core: BSD-3-Clause
- numparam: LGPL-2.0-or-later (the only copyleft piece)
- Sparse 1.3: Kundert/UC permissive notice (credit required)
- `dev.c`, `commands.c`: UC/Arno W. Peters, PostgreSQL-style
- FFT: public domain. FastNorm3: © C. S. Wallace (under ngspice's BSD)
- Bison skeleton: GPL-3.0-or-later WITH Bison-exception-2.2, so no obligations
- Emscripten runtime and musl: MIT (or NCSA); dlmalloc CC0; compiler-rt Apache-2.0 WITH LLVM-exception

**Numbers do not change for default runs.** `NG47/src/spicelib/analysis/cktntask.c:142-143` sets `tsk->TSKkluMODE = CKTkluOFF`; KLU is used only after `.options klu` (`cktsetup.c:152-189`). Native runs of `WORK/divider.cir` (V1 12 V, R1 1 k, R2 2 k, `.op`):

```
$ /usr/bin/ngspice -b divider.cir           -> "Using SPARSE 1.3 as Direct Linear Solver", V(2) 8.000000e+00
$ /usr/bin/ngspice -b divider_klu.cir       -> "Using KLU as Direct Linear Solver",        V(2) 8.000000e+00
$ .../native/ngspice-47/bin/ngspice -b divider.cir -> "Using SPARSE 1.3 as Direct Linear Solver", V(2) 8.000000e+00
```

Both natives print "Compiled with KLU Direct Linear Solver" in `ngspice -v`, and both still use SPARSE by default.

**Features lost** (teammate's list, `research/own-build.md:257-275`):

- `.options klu`
- XSPICE code models and SPICE2 `POLY(n)` E/F/G/H sources
- OSDI (Verilog-A models)
- the HICUM L2 transistor model

None is needed for first- and second-year circuits. R, C, L, V, I, E, F, G, H, B, D, Q and M remain.

**If XSPICE is needed later** (for example, `POLY(n)` in vendor op-amp models): turning on the XSPICE core is licence-neutral (public domain). `spice2poly` is GTRC/BSD and `tlines` is BSD-3. Remove `table` from `CMDIRS` (`GNUmakefile.in:10`) or never ship `table.cm`, and the build stays GPL-free.

---

## 6. Obligations when we distribute the ngspice wasm from GitHub Pages

### 6.1 Which terms apply to which served file

| Served file | What is in it | Terms that apply |
|---|---|---|
| `engine/ngspice.wasm` | ngspice 47 compiled (section 5) | BSD-3-Clause + LGPL-2.0-or-later (numparam) + Sparse and UC/Peters notices. Add LGPL-2.1+ / MPL-2.0 if KLU, OSDI or HICUM2 are kept |
| `engine/ngspice.mjs` | Emscripten JS glue | MIT or NCSA (Emscripten) |
| `assets/*.js` | our TypeScript, compiled, plus npm dependencies | our licence + each dependency's licence |

Our app does not link ngspice. It loads a separately fetched `.wasm` in a Web Worker and talks to it through Emscripten's API (write the netlist to the virtual file system, run, read the results). For the LGPL, the "Library" is numparam and the "work that uses the Library" is the rest of ngspice. They are linked into one executable, `ngspice.wasm`, which LGPL-2.1 §5 treats as a derivative of the Library and §6 governs (`COPYING:342-371, 373-433`). Our TypeScript sits outside that executable.

### 6.2 BSD (ngspice core)

- Reproduce the copyright notice, the conditions and the disclaimer "in the documentation and/or other materials provided with the distribution" (`COPYING:61-63`). That means the text of `COPYING:53-79` in `THIRD_PARTY_NOTICES.md` and on the site's Licences page.
- Do not use "the name of the copyright holder nor the names of its contributors … to endorse or promote" our product (`COPYING:65-67`). Saying "Uses ngspice" or "Simulation engine: ngspice 47" states a fact and is fine. "Endorsed by the ngspice team" or "UC Berkeley's simulator" is not.

### 6.3 Sparse and the UC/Peters notices

- Sparse: its copyright and permission notice must appear "in all copies and supporting documentation", and Kundert and the University of California must be "properly credited" (`spalloc.c:40-44`). Put the notice in `THIRD_PARTY_NOTICES.md`.
- `dev.c` and `commands.c`: "the above copyright notice, this paragraph and the following three paragraphs appear in all copies" (`dev.c:6-9`). Put them in `THIRD_PARTY_NOTICES.md` too.

### 6.4 LGPL (numparam), and the separately loaded `.wasm`

numparam is "version 2 of the License, or (at your option) any later version" (`readme.txt:8-11`), so we may follow LGPL-2.1 (whose text is in `COPYING:103-558`) or LGPL-3.0. Under LGPL-2.1 §6 that means:

1. **Prominent notice and a copy of the licence.** "You must give prominent notice with each copy of the work that the Library is used in it and that the Library and its use are covered by this License. You must supply a copy of this License." (`COPYING:380-382`). In practice: the LGPL-2.1 text as `LICENSES/LGPL-2.1-or-later.txt`, served on the site, and a line in the About dialog.
2. **Copyright notices where the program shows notices.** "If the work during execution displays copyright notices, you must include the copyright notice for the Library among them, as well as a reference directing the user to the copy of this License." (`COPYING:382-385`). Our About dialog must list numparam's "Copyright (C) 2002 Georg Post" next to ngspice's notices, and link to the LGPL text.
3. **Source code that allows rebuilding.** One of §6(a)-(e) (`COPYING:386-418`). The simplest is 6(d): "If distribution of the work is made by offering access to copy from a designated place, offer equivalent access to copy the above specified materials from the same place." Those "materials" are the complete source of the Library, plus the "work that uses the Library" as source or object code "so that the user can modify the Library and then relink" (6(a), `COPYING:388-398`). For us: **the exact `ngspice-47.tar.gz`, our patches and our build script**, offered from the same place as the `.wasm`. The general rule says the same: "offering equivalent access to copy the source code from the same place satisfies the requirement" (`COPYING:336-340`).
   - *Same place.* Under LGPL-2.1 the safe reading is "host it ourselves". A link to SourceForge alone is weaker: it is a third party's server, and download URLs move. LGPL-3.0, which "or later" allows, takes GPL-3.0 §6(d) on board: "the Corresponding Source may be on a different server (operated by you or a third party) … provided you maintain clear directions next to the object code" (`DL/spdx-license-list-data/text/GPL-3.0-or-later.txt:102`; LGPL-3.0 §4(d)0 at `LGPL-3.0-or-later.txt:52`). **Recommendation:** put the tarball on our own Release and on the Pages site, and keep a `SOURCE.txt` with clear directions next to the `.wasm`. That satisfies either version. The tarball is 13,105,136 bytes.
4. **Terms for the combined work must permit "modification of the work for the customer's own use and reverse engineering for debugging such modifications"** (`COPYING:373-378`). BSD (ngspice) and MIT (our code) both do. Do not add terms that forbid reverse engineering, such as site terms of use.
5. **If we modify numparam files**, they must "carry prominent notices stating that you changed the files and the date of any change" (`COPYING:271-272`), and the result stays LGPL. Today's planned patches touch only BSD files.
6. **Being able to replace the library.** This is where a separately loaded `.wasm` helps:
   - Keep `ngspice.wasm` a separate file. No `-sSINGLE_FILE`, no base64 inlining as eecircuit-engine does (section 4).
   - Document the JS↔wasm interface (exports, file-system paths, arguments) in `engine/README.md`.
   - Publish the build script, so that a modified numparam can be rebuilt into a new `ngspice.wasm` and dropped into a local copy of the site (`npm ci && npm run build && npx vite preview`).
   - Optional: a developer setting such as `?engine=<url>` to load a custom `.wasm`.
   - The LGPL does not require our hosted site to accept a user's wasm. It requires that the user gets everything needed to rebuild and run a modified version, and an open-source app plus the build script provides that.
   - Mention the service worker: it caches the old `.wasm`, so after replacing it in a local copy, unregister the worker or hard-reload.

### 6.5 KLU (only if it is ever turned back on)

- The same LGPL duties apply (LGPL-2.1-or-later).
- AMD and COLAMD add a citation duty for "User documentation": their copyright, the licence, the Availability note, and "Used by permission." (`DL/suitesparse-3.7.0/AMD/README.txt:52-60`; `NG47/src/maths/KLU/colamd.c:68-76`).
- KLU is not the default solver, so for our users this is cost without benefit. **Keep `--disable-klu`.**

### 6.6 MPL-2.0 (only if OSDI is on, or HICUM2/cppduals is kept)

- Make the MPL source files available and "inform recipients of the Executable Form how they can obtain a copy of such Source Code Form" (MPL §3.2(a), `COPYING:746-752`). The tarball we already host contains them.
- Keep their notices (§3.4, `COPYING:772-778`).
- Our app can be a "Larger Work" under our own terms (§3.3, `COPYING:759-770`). Because there is no Exhibit B, MPL code may also be combined with (L)GPL code (`COPYING:641-645, 763-770`).
- Add the MPL-2.0 text under `LICENSES/` and a line in the notices.

### 6.7 GPL (only if a GPL piece were ever shipped)

- `table.cm` (GPL-2.0-or-later) or the VPI glue would carry full GPL duties: complete corresponding source, the GPL text, and no extra restrictions.
- If the table code model were **linked into `ngspice.wasm`** (static registration), the whole `ngspice.wasm` would have to be distributed under GPL-2.0-or-later terms. The BSD and LGPL parts allow that.
- Whether our TypeScript app, which runs in the same worker and calls the module, would then form one "combined work" with it is a grey area **[lawyer]**.
- **Avoid it:** never ship `table.cm`. Under the minimal build there is no GPL code at all, apart from Bison output, which the exception covers.

### 6.8 Emscripten runtime and JavaScript dependencies

- Put the Emscripten MIT notice ("Copyright (c) 2010-2014 Emscripten authors", `EMSDK/LICENSE:16-34`) and musl's MIT notice in the notices file. This is cheap and conservative.
- The LLVM exception means libc++ and compiler-rt need no notice in object form (`libcxx/LICENSE.TXT:210-213`).
- npm dependencies that end up in the bundle: generate `THIRD_PARTY_LICENSES.txt` at build time, for example with `rollup-plugin-license` (MIT, 3.7.1, `npm view`). Serve it next to the app.

### 6.9 Concrete files to ship, and where

| File | Where | Content | Why |
|---|---|---|---|
| `LICENSE` | repo root | MIT text, "Copyright (c) 2026 Tarık <surname> and contributors" | our code |
| `THIRD_PARTY_NOTICES.md` | repo root; copied into the site as `/THIRD_PARTY_NOTICES.txt` and rendered at `/licenses/` | one section per component in `ngspice.wasm` and `ngspice.mjs`, with the notice texts (draft in Appendix A), plus a pointer to `THIRD_PARTY_LICENSES.txt` | BSD cl. 2, Sparse, UC/Peters, LGPL §6 notice |
| `LICENSES/` | repo root; copied to `/LICENSES/` on the site | `MIT.txt`, `LGPL-2.1-or-later.txt` (verbatim LGPL-2.1), `BSD-3-Clause.txt` (ngspice's text), `CC-BY-4.0.txt`, `CC0-1.0.txt`; plus `MPL-2.0.txt` only if MPL parts are in | full licence texts (LGPL "supply a copy") |
| `engine/README.md` | repo | what is in the wasm, configure flags, the JS↔wasm interface, how to rebuild, how to swap in your own `.wasm` | LGPL relinking and replacement |
| `engine/build-ngspice-wasm.sh`, `engine/patches/*.patch`, `engine/ngspice-47.tar.gz.sha256`, `engine/BUILD.json` | repo | exact build: emsdk version, flags, input and output SHA-256s; every source change as a patch with a header saying what, why and when | "complete corresponding source", reproducibility |
| `engine/COPYING.ngspice` | repo | verbatim copy of `NG47/COPYING` | upstream's own statement |
| GitHub Release `engine-ngspice47-rN` | same repository | assets: `ngspice-47.tar.gz` (verbatim upstream, SHA-256 `894e649651f1838a14095e5a5439e7d3aa63e87ede14d283173fda4fcdef675f`), `ngspice-wasm-build-rN.tar.gz` (the `engine/` folder), `ngspice.wasm`, `ngspice.mjs`, `SHA256SUMS` | source "from the same place", pinned to the binary |
| `/engine/ngspice.wasm`, `/engine/ngspice.mjs` | Pages site | separate files, not inlined | replaceability |
| `/engine/SOURCE.txt` | Pages site, next to the wasm | upstream URL `https://sourceforge.net/projects/ngspice/files/ng-spice-rework/47/ngspice-47.tar.gz/download`, SHA-256, the Release URL, the repo tag of the build files, a one-paragraph "how to rebuild" | "clear directions next to the object code" (GPL-3 §6(d) via LGPL-3) |
| `/engine/source/ngspice-47.tar.gz` (+ build tarball) | Pages site (recommended) | same files as the Release | literal "same place" under LGPL-2.1 §6(d). Exclude from the PWA precache |
| About → "Licences and source" dialog | in the app, reachable by keyboard and screen reader | "Simulation engine: ngspice 47 compiled to WebAssembly. Copyright 1985-1994 (and others to 2018) Regents of the University of California; Copyright 2001-2026 the ngspice team; Modified BSD. Includes numparam, Copyright (C) 2002 Georg Post, GNU LGPL v2 or later. Source and build files: [link]. Licence texts: [link]." | LGPL §6 notice display; BSD cl. 2 |
| `THIRD_PARTY_LICENSES.txt` | built into `dist/` | generated list of npm dependency licences | MIT, ISC, BSD and Apache notice duties of the dependencies |
| `TRADEMARKS.md` | repo root | name and logo policy (Appendix B) | brand protection, which no licence gives |

Also add the Licences page to the PWA precache, so the notices are available offline like the rest of the app.

The banner wording for the About text comes from native 47's `ngspice -v`: "Copyright 1985-1994, Regents of the University of California. / Copyright 2001-2026, The ngspice team." COPYING's BSD line is "Copyright 1985 - 2018, Regents of the University of California and others" (`COPYING:53`). Quote both.

### 6.10 What not to do

- Don't label the deployed app or the engine as "MIT" or "BSD-3-Clause" without the LGPL note.
- Don't inline the wasm as base64.
- Don't ship `table.cm`, OSDI or KLU "because they're on by default".
- Don't copy text from the ngspice manual (CC BY-SA 4.0, `COPYING:46-48`) into our CC BY docs; write our own.
- Don't bundle vendor or PDK model cards that have no licence grant (the PTM case in section 4).
- Don't imply endorsement by UC Berkeley, the ngspice team, Analog Devices (LTspice) or KiCad. "Export for LTspice" is a plain description and is fine.

---

## 7. Licence for our code: comparison

Candidates: MIT, BSD-3-Clause, Apache-2.0, MPL-2.0, GPL-3.0-or-later, AGPL-3.0-or-later. Licence texts were checked in `DL/spdx-license-list-data/text/` (commit `3184648`, 2026-10-29).

| Criterion | MIT | BSD-3-Clause | Apache-2.0 | MPL-2.0 | GPL-3.0+ | AGPL-3.0+ |
|---|---|---|---|---|---|---|
| Fits with the ngspice wasm we ship (separate file; LGPL §6 terms must allow modification and reverse engineering) | yes | yes | yes | yes | yes | yes |
| If a GPL-2.0-or-later piece were ever linked in | yes (the combination becomes GPL; our files stay MIT) | yes (same) | yes, via GPL-3.0 (Apache-2.0 is GPL-3-compatible; table is "or later") | yes (secondary-licence clause) | yes | yes |
| Fits likely dependencies (CodeMirror, Vite, Preact/React/Svelte/Solid/Vue MIT; d3, Observable Plot ISC; lit, vega BSD-3; react-aria-components, ECharts Apache-2.0; pako MIT+Zlib) | yes | yes | yes | yes | yes | yes |
| Our code can flow into KiCad (GPL-3.0+) | yes | yes | yes | yes (KiCad already ships MPL-2.0 Eigen) | yes | partly (GPL-3 §13 permits combination, but AGPL terms stay on that part) |
| KiCad (or TurboSpice, GPL-3.0) code can flow into ours | no | no | no | no | yes | yes |
| Friendly to students, teachers, contributors | best (short, most familiar, used by our closest projects and dependencies) | very good | good (longer; changed files must be marked; NOTICE handling) | fair (file-level copyleft; less familiar) | fair (anyone hosting a modified copy must publish its source; some institutions avoid GPL) | poor (many organisations ban it; adds little for a static site) |
| Explicit patent grant | no | no | yes (§3, with termination on patent suits) | yes (§2.1(b), §5.2) | yes (§11) | yes (§11) |
| Says anything about the "Solved Circuits" name | nothing | clause 3: no endorsement using the holder's or contributors' names | §6: no trademark or product-name rights granted | §2.3: no trademark rights | §7(e): a trademark term may be added | same as GPL |
| What EEcircuit / eecircuit-engine use | same (MIT) | compatible | compatible | compatible | can take their code; they can't take ours | same as GPL |
| Can we change our mind later? | easy (MIT code can later go into a GPL release) | easy | easy | moderate | hard (going permissive needs every contributor's consent or a CLA) | hard |
| Work for Tarık | least | least | low | low | moderate | moderate+ |

Notes and evidence per criterion:

1. **ngspice components.**
   - LGPL-2.1 §6 lets the combined executable go out "under terms of your choice, provided that the terms permit modification of the work for the customer's own use and reverse engineering" (`COPYING:373-378`). All six licences permit that.
   - Our TypeScript is not linked into the wasm at all, so none of the six is blocked.
   - The only real compatibility trap would be Apache-2.0 code inside a GPL-2.0-*only* work. ngspice has no GPL-2.0-only code: table and the VPI glue are "or later".
2. **Dependencies.** `npm view` licences (`WORK/npm-licences.txt`):
   - codemirror 6.0.2, @codemirror/view 6.43.15, @lezer/lr 1.4.12, vite 8.3.7, preact 11.2.0, react 19.3.1, svelte 5.57.3, solid-js 1.9.18, vue 3.5.45, uplot 1.6.32, chart.js 4.6.1, dygraphs 2.2.2, plotly.js-basic-dist-min 4.2.0, chart2music 1.20.0, vite-plugin-pwa 2.0.0, lz-string 1.5.0, fflate 0.8.3: all **MIT**
   - d3 7.9.2, @observablehq/plot 0.6.19: **ISC**
   - lit 3.3.3, vega 6.4.0, vega-lite 6.5.0: **BSD-3-Clause**
   - react-aria-components 1.22.1, echarts 6.1.0, typescript 7.0.2, playwright 1.65.0: **Apache-2.0**
   - pako 3.0.3: **MIT AND Zlib**
   - axe-core and @axe-core/playwright 4.14.0: **MPL-2.0**, but used only in tests, not shipped
   - All of these are compatible with all six candidates.
3. **KiCad.** "The majority of KiCad's source code is developed and distributed under the terms of the GPLv3 or later" (`DL/kicad-mirror/LICENSE.README:1-3`). KiCad already includes MIT, BSD, Apache-2.0, LGPL and MPL-2.0 code (`:11-56`). Its ngspice integration `eeschema/sim/ngspice.cpp` is GPL-3.0-or-later (`:11-13`). With MIT we can read it for ideas, but we cannot paste its code. Since we are TypeScript/web and KiCad is C++/wxWidgets, copying code either way is unlikely. Ideas, file formats and example circuits are not blocked by MIT. TurboSpice's ngspice-wasm engine is GPL-3.0 and spice3d is GPL-2.0 (`research/builds.md:46-47`): reusable only under a GPL licence.
4. **Contributors.** On GitHub, "Whenever you add Content to a repository containing notice of a license, you license that Content under the same terms" (`DL/github-site-policy/Policies/github-terms/github-terms-of-service.md:143-147`, section D.6, "inbound=outbound"). So no CLA is needed for any of the six. Copyleft licences are a one-way door, though: switching later to permissive needs every contributor's consent.
5. **Patents.**
   - Apache-2.0 §3 grants a patent licence and ends it for anyone who sues over patents (`Apache-2.0.txt:31`). GPL-3.0 §11 and MPL-2.0 §2.1(b) also grant patent licences.
   - MIT and BSD-3-Clause grant no explicit patent licence.
   - For an education tool written by individuals, the practical patent risk is low.
6. **The "Solved Circuits" name.**
   - BSD-3 clause 3: "Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission" (`BSD-3-Clause.txt:9`).
     - It is a condition of the copyright licence, so breaching it could be pursued as copyright infringement.
     - But it is narrow. It covers only the copyright holder's and contributors' names, only for endorsement or promotion, and only against people who copy the code. It does not stop a fork from naming itself after the project or using the logo.
   - Apache-2.0 §6 (`Apache-2.0.txt:47`) and MPL-2.0 §2.3 (`COPYING:703-705`) only state that no trademark rights are granted.
   - Real protection comes from **trademark law** plus a written brand policy. This is the same whichever licence is chosen.
     - Registering the name, and in which countries, is a **[lawyer]** question, and so is unregistered-name or false-endorsement protection under Turkish law.
     - What needs no lawyer: `TRADEMARKS.md` (Appendix B); the ™ sign, not ®, unless registered; the official URL in every video description; an "Official version: <url>" footer.
7. **AGPL for a static site.** AGPL §13 adds duties toward "users interacting with it remotely through a computer network" (`AGPL-3.0-or-later.txt:186-188`). Our app is downloaded and run in the user's browser, so ordinary GPL distribution duties would already apply. AGPL adds little here and puts off adopters.
8. **AI-assisted code.** Copyleft is only as strong as the copyright behind it. The copyright status of code written mostly by an AI is unsettled and differs by country **[lawyer]**. This weighs slightly against relying on GPL or AGPL for protection, and not against MIT.

---

## 8. Recommendation

**Recommended: MIT** for all code: the app, the build scripts, the tests and the UI strings, including future Turkish translations.

- **It fits everything we ship and use.** The ngspice wasm (with the notices and source from section 6), every likely dependency, and KiCad, which can take our code.
- **It is the friendliest for the audience.** Students, teachers and contributors know it. A teacher can host or adapt the tool on a course site without a legal review; the only extra duty is to keep the notices, which our repo already carries.
- **It matches our neighbours.** EEcircuit and eecircuit-engine use MIT, and so do most of our dependencies (CodeMirror, Vite and the candidate UI frameworks). Code can be exchanged with the closest projects both ways, with attribution.
- **It keeps options open.** A GPL release later remains possible. The reverse is not true.
- **It is the least work for Tarık.**
- What MIT lacks (a patent grant, wording about names) is low-risk here, or is handled better by `TRADEMARKS.md` than by any licence clause.

**Runner-up: Apache-2.0.** Same compatibility, permissive, accepted by universities and companies, and it adds an explicit patent licence (§3) and an explicit "no trademark rights" clause (§6). It loses on simplicity: changed files must be marked (§4(b), `Apache-2.0.txt:37`), NOTICE files must be passed on (§4(d), `:41`), the text is longer, and it is less familiar to beginners. Choose it if Tarık values the patent clause over brevity.

**Alternatives:**

- **BSD-3-Clause** is a reasonable substitute for MIT if Tarık specifically wants a no-endorsement clause in the licence text. It also gives the "same licence as the ngspice core" story. Its clause covers the copyright holder's name, so a holder line like "Tarık <surname> (Solved Circuits) and contributors" would bring the channel name under it. The practical gain over MIT + `TRADEMARKS.md` is small.
- **GPL-3.0-or-later** is right only if the goal becomes "every distributed modified version must stay open", or if we want to copy code from TurboSpice or KiCad. The price: EEcircuit-style MIT projects can't take our code, some schools and companies hesitate, and it is a one-way door.
- **MPL-2.0 and AGPL-3.0** don't fit the goals well.

Either way, describe the deployed site honestly: "The app's code is MIT. The simulation engine is ngspice (Modified BSD, with LGPL parts); see Licences." Build scripts are MIT. **License our ngspice patches under ngspice's Modified BSD**, so they can go upstream; a patch to a numparam file would have to be LGPL.

---

## 9. Documentation and example netlists

**Documentation (user guide, tutorials, explanations, screenshots): CC BY 4.0. Sensible, with four caveats.**

- **Why it fits.** It is the common licence for open educational material. Teachers can reuse it in slides and handouts, translate it, and use it commercially, with attribution. The attribution can be "a URI or hyperlink" (`CC-BY-4.0.txt:97`). It also says "No endorsement" (`:63`) and "Patent and trademark rights are not licensed" (`:69`), which helps the name policy.
- **Caveat 1:** don't paste text from the ngspice manual (CC BY-SA 4.0) into it, or those parts become ShareAlike.
- **Caveat 2:** code snippets in the docs should also be under MIT or CC0. Creative Commons itself advises against using CC licences for software; that FAQ could not be fetched here (blocked).
- **Caveat 3:** UI strings and in-app explanations (field tables, trap messages, the future Turkish UI) belong to the program and stay MIT. Otherwise every translation PR mixes licences.
- **Caveat 4:** state per-directory licences clearly, so that GitHub's inbound=outbound rule (ToS D.6) works per file. A `REUSE.toml` (REUSE spec) or a `LICENSE` file in `docs/` and `examples/` does this.

**Example netlists, two classes:**

1. **Starter templates, snippets, trap demos and test fixtures: CC0 1.0** (or MIT-0).
   - Users start from them, and their circuits live in share links. A CC BY template would put an attribution duty on every student circuit made from it, which is unworkable.
   - CC0 includes a "Public License Fallback" for countries where a waiver is not fully valid (`CC0-1.0.txt:80`). That matters where moral rights cannot be waived, which may include Turkey **[lawyer]**.
2. **Episode circuits, the channel's original problems behind "Open this circuit": CC BY 4.0**, with the credit as the netlist's first comment line, for example `* Solved Circuits, episode 4, circuit 2: https://<site>/e04-2 (CC BY 4.0)`.
   - The credit travels with the file, so complying is automatic and the channel gets credit wherever the circuit goes.
   - The app should keep that comment when a user edits the circuit and add "(modified)". CC BY asks re-users to "indicate if You modified the Licensed Material" (CC BY 4.0 §3(a)(1)(B)).
   - Whether a short netlist is protected by copyright at all is doubtful (component values and connections are close to facts) **[lawyer]**. The licence then mainly works as a clear request for credit.
   - If Tarık prefers no conditions at all, CC0 for everything is simpler and also fine.

**Not covered by any of these:** the YouTube videos, voice-overs, thumbnails, the channel name and the logo. Keep them "all rights reserved" and say so.

---

## 10. Where a lawyer is needed

1. **Trademark.** Whether and where to register "Solved Circuits" and the app's name (Turkey, and abroad through international filing); what protection an unregistered name has; whether BSD-3 clause 3 would add anything under Turkish law.
2. **GPL boundary.** If GPL code is ever combined (XSPICE `table.cm`, KiCad or TurboSpice code): whether calling the wasm module from our JavaScript in the same worker makes one "combined work".
3. **AI-written code.** Copyright in AI-generated or AI-assisted code and netlists, and so how enforceable any licence is. Also employer IP clauses for contributors who work for universities or companies.
4. **Other channels of distribution.** If the app is ever shipped outside the web (desktop wrapper, mobile app store, offline USB copies for classrooms): how to meet the LGPL there (written offer vs. bundled source). App-store terms and copyleft can conflict.
5. **Netlist licensing.** Whether netlists are protected by copyright, and how well the CC0 waiver works under Turkish moral-rights law.
6. **Third-party model files.** Any model cards without a licence grant (PTM) need permission from the rights holder before we redistribute them.

---

## 11. Open questions for Tarık

1. Goal check: maximum reuse by teachers and others (choose **MIT**), or no closed forks (choose **GPL-3.0-or-later**)?
2. The copyright holder line: "Tarık <surname> and contributors" or "Solved Circuits contributors"? This matters for BSD-3 clause 3 if chosen, and for the notices.
3. Episode circuits: credit required (CC BY 4.0, recommended) or no conditions (CC0)?
4. The app's public name. `TRADEMARKS.md` needs it, and so does any decision to register it.
5. Does any planned episode need `POLY(n)` sources (XSPICE), HICUM, Verilog-A (OSDI) or `.options klu`? Each changes the licence mix (section 5).
6. Is a 13 MB source tarball per engine version, as a Release asset and on the site, acceptable? It is the cleanest way to meet the LGPL.

---

## 12. Evidence index

**Commands run, with key output:**

- `wc -l NG47/COPYING DEB`: 947, 1373 (both read in full).
- `grep -n AC_ARG_ENABLE… configure.ac`, `sed -n 130,320p`, `sed -n 1110,1260p configure.ac`: defaults as quoted.
- `grep -n "numparam|libsparse|libKLU|libosdi|libndev|tclspice" src/Makefile.am`: lines 38, 144, 172, 185, 197, 201, 374, 402, 428, 441, 445, 455, 528, 554, 567, 571, 581.
- `python3 -I research/license-scripts/scan_licences.py NG47/src WORK/scan_src.tsv`: 2,308 files. 14 MPL (12 under `src/osdi` + `osdiitf.h` + cppduals `dual`), 10 GPL-2+ (table ×8, `vpi.c`, `ghdl_vpi.c`), 8 Bison-exception, 6 LGPL (numparam ×3, colamd ×2, tclspice), 10 Kundert sparse, 2 UC/Peters, 4 ndev, 168 public domain (all in XSPICE).
- `/usr/bin/ngspice -b WORK/divider.cir` and `divider_klu.cir`; native 47 `-v` and `-b`: solver lines as quoted.
- `ldd /usr/bin/ngspice`: no system libklu, so the bundled KLU is used. `strings /usr/bin/ngspice`: OSDI and `duals::dual` symbols. `ls /usr/lib/x86_64-linux-gnu/ngspice/`: `analog.cm digital.cm spice2poly.cm table.cm xtradev.cm xtraevt.cm`.
- `strings research/engine-data/spice.wasm`: numparam and KLU strings, no XSPICE/OSDI library code.
- `grep -c "AGFzbQ" EEPKG/dist/eecircuit-engine.mjs`: 2. `find EEPKG -type f`: no COPYING.
- `npm view <pkg> license version --json` for 43 packages: `WORK/npm-licences.txt`.
- `sha256sum NG47/../ngspice-47.tar.gz`: `894e649651f1838a14095e5a5439e7d3aa63e87ede14d283173fda4fcdef675f` (13,105,136 bytes).

**Downloads** (git, sparse clones, each in its own folder under `DL/`):

- SuiteSparse tag `v3.7.0` (`10d9216`): KLU, BTF, AMD, COLAMD READMEs.
- SPDX `license-list-data` (`3184648`): licence texts.
- KiCad GitHub mirror (`f876154`, 2026-11-09): `LICENSE.README`, `eeschema/sim/ngspice.cpp`.
- `github/site-policy` (`b9578b5`): Terms of Service D.6.
- ngspice-sf-mirror tag `ngspice-45.2` (`724dc77`): COPYING, `src/Makefile.am`.

**Teammates' reports used (read-only):** `research/engine.md` (eecircuit-engine is 45.2; no notices; PTM), `research/builds.md` (other wasm builds and their licences; the XSPICE-off compile bug), `research/own-build.md` (planned flags, features lost), `wasm/build-ngspice-wasm.sh` (planned flags, HICUM2 patch, separate `.mjs` + `.wasm`).

**Not reachable in this session:** `docs.github.com`, `www.gnu.org` and `creativecommons.org` (WebFetch: ENOTFOUND). The FSF licence-compatibility list and GPL FAQ, CC's "don't use CC for software" FAQ and GitHub's Pages and Release size limits were therefore not cited directly. Licence texts were read from SPDX instead, and the GitHub ToS from the `github/site-policy` repository. Allow those hosts if direct citations are wanted.

---

## Appendix A: draft `THIRD_PARTY_NOTICES.md` (minimal build)

```
Third-party notices for <app name>

The app's own code is MIT (see LICENSE). The simulation engine (engine/ngspice.wasm and
engine/ngspice.mjs) is ngspice 47 compiled to WebAssembly with Emscripten <x.y.z>; it is
NOT covered by our MIT licence. Exact source: ngspice-47.tar.gz, SHA-256
894e649651f1838a14095e5a5439e7d3aa63e87ede14d283173fda4fcdef675f, copy at <release URL> and
<site>/engine/source/; upstream https://sourceforge.net/projects/ngspice/files/ng-spice-rework/47/
Build script and patches: <repo>/engine/ at tag <tag>. How to rebuild or replace the engine: engine/README.md.

1. ngspice: Modified BSD (BSD-3-Clause)
   Copyright 1985 - 2018, Regents of the University of California and others
   Copyright 2001-2026, The ngspice team
   [verbatim text of NG47/COPYING lines 55-79]

2. numparam (src/frontend/numparam): GNU LGPL version 2 or (at your option) any later version
   Copyright (C) 2002 Georg Post
   [notice from src/frontend/numparam/readme.txt lines 6-20]
   Full text: LICENSES/LGPL-2.1-or-later.txt

3. Sparse 1.3 (src/maths/sparse)
   Copyright (c) 1985,86,87,88,89,90 by Kenneth S. Kundert and the University of California.
   [verbatim permission notice, src/maths/sparse/spalloc.c lines 40-47]

4. src/spicelib/devices/dev.c and src/frontend/commands.c
   Copyright (c) 1990 University of California; Copyright (c) 2000 Arno W. Peters
   [verbatim notice, dev.c lines 6-28]

5. FFT library (src/maths/fft): public domain (John Green).
6. FastNorm3 (src/frontend/trannoise): Copyright Christopher Stewart Wallace.
7. Bison-generated parsers: GPL-3.0-or-later WITH Bison-exception-2.2 (the exception applies).
8. Emscripten runtime: MIT (or University of Illinois/NCSA), Copyright (c) 2010-2014 Emscripten
   authors. musl libc: MIT, Copyright (c) 2005-2020 Rich Felker, et al. dlmalloc: public domain (CC0).
   compiler-rt: Apache-2.0 WITH LLVM-exception.
9. JavaScript dependencies: see THIRD_PARTY_LICENSES.txt (generated at build time).

[Only if enabled]
- KLU, BTF, AMD, COLAMD (src/maths/KLU, from SuiteSparse 3.7.0): GNU LGPL 2.1 or later.
  KLU Copyright (C) 2004-2011 University of Florida (T. A. Davis, E. Palamadai); BTF (C) 2004-2011
  University of Florida; AMD Version 2.2 Copyright (c) 2007 T. A. Davis, P. R. Amestoy, I. S. Duff,
  Availability: http://www.cise.ufl.edu/research/sparse/amd, Used by permission.
  COLAMD Copyright (c) 1998-2007 T. A. Davis, Availability: http://www.cise.ufl.edu/research/sparse/colamd/,
  Used by permission.
- cppduals (src/include/cppduals/duals/dual, with HICUM2): MPL-2.0, (c)2019 Michael Tesch.
- OSDI (src/osdi): MPL-2.0, Copyright 2022 SemiMod GmbH, 2023 Pascal Kuthe.
  Source of the MPL files: in the ngspice-47.tar.gz above. Full text: LICENSES/MPL-2.0.txt
```

## Appendix B: draft `TRADEMARKS.md`

```
The code in this repository is MIT-licensed and the docs are CC BY 4.0, but the names
"Solved Circuits" and "<app name>" and their logos are not licensed under either. You may
say that your project is "based on <app name>" or "uses circuits from Solved Circuits".
Please don't call a modified version "Solved Circuits" or "<app name>", use the logos, or
suggest that Solved Circuits made, checked or endorses it. The official version is at <url>;
the channel's "Open this circuit" links always point there.
```

## Appendix C: suggested in-app About text (also read by screen readers)

> **Licences and source.** This app is free software under the MIT licence. It runs **ngspice 47**, compiled to WebAssembly: Copyright 1985-1994 (with later contributions to 2018) Regents of the University of California, Copyright 2001-2026 the ngspice team, Modified BSD licence. ngspice includes **numparam**, Copyright (C) 2002 Georg Post, under the GNU Lesser General Public License version 2 or later. [Read the licence texts] [Get the exact source and build files] [Third-party notices]

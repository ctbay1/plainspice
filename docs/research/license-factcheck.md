# Fact-check of `research/license.md` (licence research)

Date: 2026-11-09. Adversarial re-check of the licence report against primary evidence: source files, `configure.ac`/`Makefile.am`, package files, two wasm binaries, and native ngspice builds and runs done for this check. Not legal advice.

Path abbreviations:

| Short | Full path |
|---|---|
| `NG47` | `<scratch>/src/ngspice47/ngspice-47` |
| `MINWASM` | `<scratch>/wasm/dist/ngspice.wasm`: the teammate's **minimal** build (19:54; 4,417,373 bytes; SHA-256 `628310ba…1eb77c`; flags in `…/wasm/dist/BUILDINFO-O2.txt:3`). Read only, not modified |
| `EEWASM` | `<scratch>/research/engine-data/spice.wasm` (the wasm inside eecircuit-engine 1.9.0) |
| `LFC` | `<scratch>/research/lfc-work`: my work. Holds a private copy of the 47 tarball, a native minimal build (`build-min/`), a default-configure probe (`build-default-probe/`), test netlists, run outputs and logs |
| `LFCS` | `<scratch>/research/lfc-scripts` (my scan script `licence_lines.py`; its output is `LFC/licence_lines_src.tsv`) |

---

## 1. Bottom line

- **The headline recommendation survives.** MIT for our code still works. Nothing found here is a copyleft that reaches our JavaScript.
- **The engine's licence picture is wrong.** The claims "only numparam's LGPL remains", "the core is BSD-3-Clause" and "describe the engine as Modified BSD with LGPL parts" are **refuted**. The minimal wasm the teammate has already built (`MINWASM`) contains five more sets of non-BSD terms. The report and upstream COPYING both miss them:
  - ECL-2.0 (BSIM4 4.8.3)
  - the UC Berkeley "BSIM terms of use" (BSIM3, BSIM4 v5/v6/v7, BSIM-SOI, BSIM3-SOI)
  - Hiroshima University/STARC terms (HiSIM2, HiSIM_HV 1 and 2)
  - the UK MoD/DERA STAG licence (SOI3)
  - CC BY 3.0 (two memory-probe files the core always calls)

  Several of these carry conditions that the notices and About text omit: acknowledgement "in the product documentation", a copy of the licence, "not to charge for the code itself", export clauses, and "same licence terms". All of these device directories are built unconditionally.
- **Fix, either way:**
  - **(a)** ship their texts and acknowledgements, or
  - **(b)** prune those model directories and stub the CC BY memory functions under `__EMSCRIPTEN__`, in a patch of the same kind as the HICUM2 one. None of these models is needed for first- or second-year circuits.

  Only after (b) is "BSD + LGPL numparam + permissive notices" true.
- **The verified technical claims hold.**
  - numparam is linked with no condition.
  - KLU, OSDI, XSPICE and cppduals defaults are as stated; `table.cm` is GPL-2.0+ and built separately.
  - The XSPICE-off compile bug is real, and it is the *only* error in a native minimal build.
  - KLU-off results are identical (5 netlists, every number).
  - eecircuit-engine's flags, version 45.2, MIT label and base64 wasm are as stated.
  - The LGPL, GPL-3, BSD-3 and Apache quotes and line numbers are accurate.

---

## 2. Claim-by-claim verdicts

| # | Claim (from the summary or report) | Verdict |
|---|---|---|
| 1 | Minimal build: only numparam's LGPL remains; ngspice core is BSD-3; engine = "Modified BSD with LGPL parts" | **Refuted** (true only as "numparam is the only GPL-family copyleft") |
| 2 | "BSD-3 is true only of the core": COPYING:14-15 with exceptions at :17-44; COPYING omits only cppduals, VPI, UC/Peters, FFT | Text **confirmed**; "core is BSD" and the completeness of the omission list **refuted** |
| 3 | numparam (LGPL-2.0-or-later) is linked with no condition (src/Makefile.am:172/428/554); no configure option removes it | **Confirmed** |
| 4 | A default 47 build adds KLU, OSDI, cppduals and XSPICE; `table.cm` (GPL-2+) is a separate file loaded at start; "the GPL parts are always separate files" | Listed parts **confirmed**; "GPL parts always separate" **refuted** for default native builds (GNU readline, GPL-3+, is linked) |
| 5 | eecircuit-engine: `--disable-xspice --disable-osdi`, KLU kept, HICUM2 patched out, really 45.2; wasm = BSD + LGPL numparam + LGPL KLU; labelled MIT; no notices; base64 | **Confirmed**, but the licence mix is **incomplete** (same omissions as #1) |
| 6 | ngspice 47 needs a one-line patch to compile with `--disable-xspice`; "the script does not contain this fix yet" | Bug **confirmed** (it is the only error natively); the script remark is **outdated** (the script now applies 3 patches) |
| 7 | Dropping KLU changes no default results; SPARSE 1.3 is the default even when KLU is compiled in | **Confirmed** (5 netlists, numbers identical) |
| 8 | Duties for the shipped wasm: BSD, Sparse, UC/Peters notices; LGPL text; numparam notice and About copyright; source + patches + build script "from the same place"; `.wasm` kept separate | **Partly refuted**: incomplete; "same place" and "separate `.wasm`" are options or good practice, not strict duties |
| 9 | Files to ship (LICENSE, THIRD_PARTY_NOTICES, LICENSES/, engine/, Release, `/licenses/`, `SOURCE.txt`) | **Incomplete** (missing ECL-2.0, CC-BY-3.0, BSIM, HiSIM, STAG texts and acknowledgements) |
| 10 | LGPL-2.1 §6 duties and the line numbers cited (COPYING:373-418, :336-340) | **Confirmed** |
| 11 | "Or later" lets us use LGPL-3.0, whose GPL-3 §6(d) allows source on another server with clear directions | **Confirmed** |
| 12 | Comparison table: GPL-3.0+ "fits" the wasm; if a GPL piece were linked into the wasm, "the BSD and LGPL parts allow that" | **Unverifiable / likely wrong**: the BSIM, HiSIM and STAG restrictions (and ECL vs GPLv2) are ignored **[lawyer]** |
| 13 | KLU is from SuiteSparse 3.7.0 (LGPL-2.1+); AMD and COLAMD add a citation duty | **Confirmed** |
| 14 | cppduals (MPL-2.0) is in the always-built HICUM2 and is not in COPYING | **Confirmed** |
| 15 | BSD-3 clause 3 only covers holder and contributor names, for endorsement | **Confirmed** |
| 16 | GitHub ToS D.6 inbound=outbound; KiCad is GPL-3+ and already contains MIT/BSD/Apache/MPL code | **Confirmed** |
| 17 | Likely npm dependencies are permissive (MIT/ISC/BSD-3/Apache); axe-core MPL-2.0 is test-only | **Confirmed** (spot check of 8 packages) |
| 18 | Tarball SHA-256 `894e6496…675f`, 13,105,136 bytes | **Confirmed** |
| 19 | Open question: does BSD getopt compile out in the wasm? | **Answered: yes** |
| 20 | Blocker: "no wasm of the minimal configuration exists yet" | **Outdated**: it exists and was inspected (`MINWASM`) |

---

## 3. Details and evidence

### Claim 1: "Minimal build: only numparam's LGPL remains" (refuted)

**Evidence that the extra licences exist in source** (all under `NG47/src/spicelib/devices/`):

- **BSIM4 4.8.3: ECL-2.0.** `bsim4/b4.c:1-19`:
  > "BSIM4 4.8.3 released on 05/19/2025 … Copyright (c) 2025 University of California … Licensed under Educational Community License, Version 2.0"

  The ECL header is in 20 of the 24 `.c`/`.h` files.
- **UC "BSIM terms of use".** In `bsim3/`, `bsim3v32/`, `bsim4v5/`, `bsim4v6/`, `bsim4v7/`, `bsimsoi/` and `bsim3soi_{pd,fd,dd}/` (files `B3TERMS_OF_USE`, `B4TERMS_OF_USE`, `BsimTerms_use`; a stale 2000 copy also sits in `bsim4/`). `bsim4/B4TERMS_OF_USE:14-30`:
  > "1. The users agree not to charge for the University of California code itself … 2. In any product based on the software, the users agree to acknowledge the UC Berkeley BSIM Research Group … This acknowledgment shall appear in the product documentation. 3. The users agree to obey all U.S. Government restrictions governing redistribution or export of the software. 4. … reproduce any copyright notice"

  The source headers say "Copyright 20xx Regents of the University of California. All rights reserved." (for example `bsim4v7/b4v7.c:3`, `bsimsoi/b4soi.c:3`).
- **HiSIM2 and HiSIM_HV2.** `hisim2/hsm2.c:19-50` (in 15 files) and `hisimhv2/hsmhv2.c:17-55` (in 27 files) carry the "HiSIM2/HISIM_HV Distribution Statement":
  > "1. The users agree not to charge for Hiroshima University and STARC code itself … 2. … acknowledge Hiroshima University and STARC … This acknowledgment shall appear in the product documentation. 3. … reproduce any copyright notice"
- **HiSIM_HV 1.** `hisimhv1/hsmhveval.c:18-79` has a CMC-style licence:
  > "3. A Licensee may not charge an end user a fee for the HiSIM_HV source code … by itself" (`:51`); "export obligations" (`:69`); a patent non-assert (`:73`)
- **STAG (SOI3).** `soi3/README:1-39` (UK Secretary of State for Defence/DERA):
  > "LICENSEE is permitted to copy, distribute, and transfer the STAG Model to customers for their royalty free use on the same licence terms" (`:9-11`)

  It also requires the copyright notice on copies (`:33-36`) and is governed by the laws of England (`:38`).
- **CC BY 3.0.** `NG47/src/frontend/get_phys_mem_size.c:1-6` and `get_resident_set_size.c:1-6`:
  > "Author: David Robert Nadeau … License: Creative Commons Attribution 3.0 Unported License … Modified: Holger Vogt, 2019"

**Evidence that they are built and shipped:**

- **Always compiled.**
  - `NG47/src/spicelib/devices/Makefile.am:3-54`: unconditional `SUBDIRS` with bsim3 (`:8`), bsimsoi (`:9`), bsim4 (`:10`), bsim4v5-7 (`:11-13`), bsim3v32 (`:16`), bsim3soi_* (`:17-19`), hisim2/hisimhv1/hisimhv2 (`:31-33`) and soi3 (`:45`). They are registered in `dev.c:153-187` with no `#ifdef`.
  - `NG47/src/frontend/Makefile.am:130-131` builds both CC BY files unconditionally. Their functions are called from `frontend/resource.c:121, 229-241` and declared in `outitf.c:43-45`.
  - Every native batch run prints "Total DRAM available" and "Maximum ngspice program size", which come from those functions (`LFC/runs/t1_op_tf.min47.out`).
- **In the minimal wasm.**
  - `…/wasm/dist/BUILDINFO-O2.txt` lists `libbsim3.a`, `libbsim4*.a`, `libbsim4soi.a`, `libbsim3soi*.a`, `libhisim2.a`, `libhisimhv1.a`, `libhisimhv2.a` and `libsoi3.a` among the libraries built.
  - `strings MINWASM`: "HiSIM" 100, "HiSIM_HV" 56, "BSIM4" 39, "BSIM3" 33, "B4SOI" 10, "Warning: This model supports BSIM4 version 4.8", "Basic Thick Film SOI3 model v2.7", "Total DRAM available =". Also "duals" 0 and "KLU" 0, consistent with the HICUM2 patch and `--disable-klu`; "NUPA_SUBCKT" 1.
  - For CC BY in the wasm: `llvm-ar t …/wasm/build-O2/src/frontend/.libs/libfte.a` contains `get_phys_mem_size.o` and `get_resident_set_size.o`, and `llvm-nm` shows `getMemorySize`, `getPeakRSS` and `getCurrentRSS` defined there and referenced (U) by other members. The final wasm has no name section, so the presence of each function cannot be shown directly; it follows from those references.
- **In eecircuit-engine's wasm too.** `strings EEWASM` shows the same HiSIM, BSIM and SOI3 strings ("Basic Thick Film SOI3 model v2.7"; BSIM4 38, HiSIM 100) and "Total DRAM available =".
- **Missing from COPYING.** `grep -n -i "bsim|hisim|ECL|STAG|DERA|Nadeau|Creative Commons|cppduals" NG47/COPYING` finds only line 48 (the manual's CC BY-SA).
- **Why the report missed them.** `research/license-scripts/scan_licences.py:9-22` has no pattern for ECL, "Distribution Statement", "not to charge" or Creative Commons. `:29` skips extensionless files, so `B4TERMS_OF_USE` and `README` were never read. Its output classes `bsim4/b4.c` and `hisim2/hsm2.c` as "NO NOTICE IN FIRST 80 LINES" and `bsim4v7/b4v7.c` as "UC copyright only" (`research/license-work/scan_src.tsv`).
- **My scan.** `python3 -I LFCS/licence_lines.py NG47/src LFC/licence_lines_src.tsv` lists all 113 distinct licence-related lines. Beyond what the report covers, it finds ECL-2.0, the BSIM, HiSIM and STAG terms, and CC BY 3.0 as the only unexplained ones.

**Correction.**
- numparam is the only *GPL-family* copyleft piece in the minimal build. But the minimal build is **not** "BSD + LGPL + permissive notices".
- Either add notices for ECL-2.0 (give recipients the licence text, ECL §4(a), SPDX `ECL-2.0.txt:42-44`), the BSIM terms, the HiSIM statements, STAG and CC BY 3.0 (licence URI plus credit "David Robert Nadeau, NadeauSoftware.com, modified by Holger Vogt", CC BY 3.0 §4(a)-(b), SPDX `CC-BY-3.0.txt:153-190`)...
- ...or patch them out of the minimal build. The same kind of edit as the HICUM2 patch would drop the bsim3/bsim4*/bsimsoi/bsim3soi*/hisim*/soi3 directories, with a `__EMSCRIPTEN__` stub for the three memory functions. MOS levels 1-3/6/9, VDMOS, BJT, VBIC, diode and JFET would remain.
- Describe the engine as: "ngspice: mostly Modified BSD; includes numparam (LGPL-2.0-or-later) and device models under their own terms (ECL-2.0, UC BSIM terms, HiSIM, STAG, CC BY 3.0); see Licences."

### Claim 2: COPYING:14-15 and :17-44; "COPYING is incomplete: cppduals, VPI, UC/Peters, FFT" (text confirmed; completeness refuted)

- `NG47/COPYING:14-15` ("…adopted for all of its source code … except for the files listed below") and `:17-44` (the exception list) are verbatim as quoted. The manual is CC BY-SA 4.0 (`:46-48`) and the BSD text is at `:53-79`.
- COPYING also omits everything listed under claim 1.
- Two third-party copyrights have no grant in the file at all, and rely only on COPYING's blanket statement (low risk):
  - FastNorm3 (`frontend/trannoise/FastNorm3.c:13-15`: "Copyright Christopher Stewart Wallace.")
  - jfet2 (`spicelib/devices/jfet2/jfet2.c:1-8`: "Copyright 1994 Macquarie University").
- Context (secondary source; I could not fetch it directly):
  - Debian's packaging notes say upstream relicensed most parts to New BSD around ngspice 27/28, and that 28+ is DFSG-compatible ([Debian README.source](https://sources.debian.org/src/ngspice/30.2-1/debian/README.source)).
  - For UC-owned BSIM code, ngspice's "Copyright 1985 - 2018, Regents of the University of California and others / Modified BSD" (`COPYING:53`) *may* be a later grant that supersedes the old terms-of-use files. That is unverified **[lawyer / ask upstream]**.
  - It cannot cover Hiroshima/STARC, DERA or Nadeau code, or the ECL header that UC put on BSIM4 4.8.3 in 2025.
  - Debian's own copyright file labels the BSIM and HiSIM directories BSD-3-clause (`/usr/share/doc/ngspice/copyright:310-312, 537-575`), which also contradicts the HiSIM headers.

### Claim 3: numparam is linked with no condition and cannot be configured out (confirmed)

- `NG47/src/Makefile.am:172, 428, 554`: `frontend/numparam/libnumparam.la` appears in the ngspice, Tcl and libngspice link lists. The surrounding conditionals (`:160-167`, `:176-207`; `:418-446`; `:544-558`) do not cover those lines.
- `grep -rn nupa_ --include=*.c` outside `numparam/` finds 26 calls in 6 files (subckt.c 9, xspice/evt/evtcheck_nodes.c 8, measure.c 3, runcoms2.c 3, inp.c 2, runcoms.c 1). The only `#ifdef`s are `TRACE_NUMPARAMS` debug blocks inside `numparam/spicenum.c:679, 708`.
- Licence: `numparam/readme.txt:5-11` ("Copyright (C) 2002 Georg Post … GNU Lesser General Public License … either version 2 … or (at your option) any later version").
- It is in `MINWASM` (`NUPA_SUBCKT`).

### Claim 4: default 47 build composition (listed parts confirmed; "GPL parts always separate" refuted)

- **Confirmed.**
  - KLU defaults on (`configure.ac:195-196, 299-306`).
  - XSPICE and OSDI are on unless disabled (`:141-147`).
  - A probe `configure --with-x=no` in `LFC/build-default-probe` gives `config.h:463 #define KLU`, `:502 #define OSDI 1`, `:579 #define XSPICE 1`.
  - `xspice/icm/GNUmakefile.in:10, 14-18` builds each code model as a separate `.cm`; `spinit.in:20-30` loads them, with `table.cm` at `:27`; `table/mada/alloc.c:3-9` is GPL-2+.
  - OSDI models are not loaded by default (`spinit.in:17` `unset osdi_enabled`).
- **Refuted part.**
  - A default non-shared native build **links GNU readline (GPL-3.0-or-later)**. `configure.ac:166-168` says "Default=yes". `:1259-1273` checks for readline when the option is unset and stops with "Couldn't find GNU readline headers" if it is missing.
  - The probe shows `config.h:153 #define HAVE_GNUREADLINE` and `src/Makefile:595 LIBS = -ltinfo -lm -lstdc++ -lreadline`. The readline licence is GPL-3+ (`/usr/share/doc/libreadline8t64/copyright:18`).
  - FFTW3 (GPL-2+) is linked whenever it is found (`configure.ac:929-934`, default yes), and libsndfile (LGPL) likewise (`:936-939`).
  - ngspice's own NEWS once called readline linking a "GPL license violation" (`NG47/NEWS:953`).
- **What this does not affect.** The comparison binaries: the teammate's native 47 used `--with-readline=no` (`…/native/build-47/config.log` header), and Ubuntu's links libedit (`ldd /usr/bin/ngspice`).
- **What it does affect.** It matters for any future desktop, offline or native distribution (report §10 item 4). It does not affect the wasm, whose flags turn readline and FFTW3 off.

### Claim 5: eecircuit-engine (confirmed, licence mix incomplete)

- **Confirmed.**
  - `EEcircuit-engine/Docker/run.sh:107`: `emconfigure ../configure --disable-debug --disable-openmp --disable-xspice --disable-osdi --without-x -with-readline=no`.
  - The HICUM2 patch is `Docker/hicum2_patch.sh:1-25`; the tag regex is at `run.sh:35`.
  - `strings EEWASM`: "45.2", "** Compiled with KLU Direct Linear Solver", `../../../../src/maths/KLU/klusmp.c`, "NUPA_SUBCKT".
  - The npm package contains only `README.md`, `LICENSE` (MIT, "Copyright (c) 2024 EElab.dev"), `package.json` (`:38` `"license": "MIT"`) and `dist/`; `grep -c "data:application/wasm;base64,AGFzbQ" dist/eecircuit-engine.mjs` gives 2.
  - ngspice 45.2's COPYING differs from 47's only in line 3 (`diff`).
- **Incomplete.**
  - Its wasm also contains the ECL-2.0, BSIM, HiSIM, STAG and CC BY 3.0 code (claim 1).
  - The `.mjs` writes 17 files into the virtual file system, not only the PTM cards. They include `/modelcard.GF180*` and `/modelcard.skywater`, whose sources say "Licensed under the Apache License, Version 2.0" (`src/models/gf180/gf180.ts`, `src/models/skywater/nfet18.ts`), and `/modelcard.FreePDK45` (NCSU, with `src/models/freepdk/APACHE-LICENSE-2.0.txt` in the repo). The npm package ships no Apache text.
  - This makes the "don't copy their practice" conclusion stronger.

### Claim 6: XSPICE-off compile fix (bug confirmed; script remark outdated)

- `NG47/src/spicelib/analysis/cktsopt.c:253-256`: the `#else` branch uses `OPT_ENH_RSHUNT`, which is defined only inside `#ifdef XSPICE` (`include/ngspice/optdefs.h:141-156`). The option-table entry at `:275` is guarded (`:265-277`), so the case cannot be reached without XSPICE.
- **Native build test.** I configured my private copy with the report's minimal flags (`--with-x=no --disable-debug --with-readline=no --with-editline=no --disable-openmp --disable-xspice --disable-osdi --disable-klu --with-fftw3=no`) and ran `make -k`.
  - Result: exactly one error in the whole tree, `cktsopt.c:254:10: error: 'OPT_ENH_RSHUNT' undeclared` (`LFC/make-min.log:563`; `grep -c "error:"` gives 1).
  - After applying the teammate's `…/wasm/patches/0001-cktsopt-compile-without-xspice.patch` (which deletes 4 lines), the build completes: `LFC/make-min2.log` ends "make exit 0", and `LFC/build-min/src/ngspice -v` prints "Compiled with Sparse Direct Linear Solver".
  - Upstream `pre-master-48` replaces the option with a core `OPT_RSHUNT` (`src/raw_mirror_files/pre-master-48.cktsopt.c:181`, `pre-master-48.optdefs.h:128`).
- **Outdated.** `…/wasm/build-ngspice-wasm.sh:60-65` now applies three patches: compile without XSPICE, `strtod` errno under musl, and available memory in wasm. HICUM2 removal and `autoreconf` follow at `:66-84`. So the minimal build is three patches plus the HICUM2 edits, not "one line plus HICUM2". All three touch BSD files (`cktsopt.c`, `inpgmod.c`, `get_avail_mem_size.c`, whose header says "3-clause BSD License").

### Claim 7: KLU off gives the same numbers (confirmed)

- Source: `NG47/src/spicelib/analysis/cktntask.c:142-145` sets `TSKkluMODE = CKTkluOFF` under `#ifdef KLU`. The only places that switch it are `.options klu`; `CKTkluON` is defined (`smpdefs.h:33`) but never assigned by default. The SuiteSparse headers are included only under `#ifdef KLU` (`smpdefs.h:21-24`, `niinit.c:19-20`, `cktacct.c:21-22`, `onemesh.h`, `twomesh.h`).
- **Test.** I ran 5 netlists (`LFC/netlists/t1…t5`) on native 47 with KLU compiled in (`…/native/ngspice-47/bin/ngspice`, which prints "Using SPARSE 1.3 as Direct Linear Solver") and on my `--disable-klu` build:
  - `.op` + `.tf` on a resistor bridge
  - `.dc` sweep with a diode and a BJT
  - RLC `.tran` with `meas`
  - `.op` + `.ac` with E/F/G/H sources
  - nonlinear `.tran`: bridge rectifier + BJT CE amplifier + level-1 MOSFET, 4000 points, `meas PP`/`MAX`
- **Result.** Every printed value and every `meas` result is identical. The only differences are the solver banner, the spinit warning and the memory/timing lines (`diff`, outputs in `LFC/runs/`). Example from t5: `vripple = 6.66952e-01` and `vcmax = 7.63545e+00` on both.

### Claim 8: duties for the shipped wasm (partly refuted)

- **Incomplete.** The list misses the duties from claim 1:
  - ECL-2.0 text to recipients (ECL §4(a))
  - BSIM and HiSIM acknowledgement "in the product documentation", and keeping their copyright notices
  - the STAG copyright and terms
  - the CC BY 3.0 licence URI and credit
- **Overstated.** LGPL-2.1 §6 lets you choose:
  - (a) accompany the work with the source
  - (c) a written offer valid for 3 years
  - (d) equivalent access "from the same place" (`COPYING:388-418`)

  So "same place" is one option, not the duty. A separate `.wasm` is good practice for replaceability, but §6(a) is met by complete source plus build scripts even if the wasm were inlined. Keep both recommendations, but label them as such.
- **Nuance the report missed.** ngspice itself shows copyright notices at run time: `version` prints "Copyright 1985-1994, Regents of the University of California. / Copyright 2001-2026, The ngspice team." (`LFC/build-min/src/ngspice -b LFC/netlists/t6_version.cir`). LGPL-2.1 §6 says that if the work displays copyright notices, the Library's notice and a pointer to the licence must be among them (`COPYING:382-385`). So if the app ever shows ngspice's banner or a raw console (eecircuit-engine exposes the banner through `getInitInfo`, `research/engine.md:39`), the numparam line must sit next to it.

### Claim 9: files to ship (incomplete)

Add the following, or prune the models (claim 1):

- `LICENSES/ECL-2.0.txt`
- `LICENSES/CC-BY-3.0.txt` (or its URI)
- `LICENSES/LicenseRef-UCB-BSIM-terms.txt`
- `LICENSES/LicenseRef-HiSIM2.txt`
- `LICENSES/LicenseRef-HiSIM_HV.txt` (two variants: HV1 CMC-style, HV2 BSIM-style)
- `LICENSES/LicenseRef-STAG-DERA.txt`
- matching `THIRD_PARTY_NOTICES` sections
- one About-dialog line acknowledging "UC Berkeley BSIM Research Group" and "Hiroshima University and STARC"

Appendix A's draft notices and Appendix C's About text need the same additions.

### Claims 10-11: LGPL-2.1 §6, and LGPL-3.0 via GPL-3 §6(d) (confirmed)

- `NG47/COPYING:373-378` (terms of your choice that permit modification and reverse engineering), `:380-385` (notice, copy of the licence, displayed copyright), `:388-418` (options a-e), and `:336-340` (same place, §4) all match the quotes.
- SPDX `LGPL-3.0-or-later.txt:52` is §4(d)(0) ("in the manner specified by section 6 of the GNU GPL"). `GPL-3.0-or-later.txt:102` is §6(d): "the Corresponding Source may be on a different server … provided you maintain clear directions next to the object code".

### Claim 12: GPL rows of the comparison table (unverifiable or likely wrong)

- The report says the GPL-3.0+ option "fits" the wasm. It also says that if `table.cm` were linked into `ngspice.wasm`, the wasm would have to be GPL and "the BSD and LGPL parts allow that".
- That ignores the BSIM, HiSIM and STAG terms in the same wasm. Their "not to charge for the code itself", export clauses and "same licence terms" are further restrictions, which GPL forbids. A wasm containing both would have conflicting terms.
- ECL-2.0 is reported as GPLv3-compatible but GPLv2-incompatible because of its patent clause ([Wikipedia: Educational Community License](https://en.wikipedia.org/wiki/Educational_Community_License); [Gentoo GPL-COMPATIBLE group](https://wiki.gentoo.org/wiki/License_groups/GPL-COMPATIBLE)). The FSF list at gnu.org could not be reached (ENOTFOUND). SPDX metadata says ECL-2.0 is OSI-approved and FSF-libre (`<scratch>/research/lfc-dl/spdx-json/ECL-2.0.json`, fetched from raw.githubusercontent.com/spdx/license-list-data).
- **Effect.** The "never ship `table.cm`" advice gets stronger. A GPL-3.0 licence for our app gets weaker if the app and the wasm were held to be one work **[lawyer]**. MIT is unaffected.

### Claims 13-18 (confirmed)

- **KLU.** `src/maths/KLU/SuiteSparse.org:4-5` (SuiteSparse 3.7.0); `DL/suitesparse-3.7.0/KLU/README.txt:20-23` (LGPL 2.1 or later); `AMD/README.txt:32-60` ("Used by permission" citation duty); in-tree `colamd.c:47-76`.
- **cppduals.** `src/include/cppduals/duals/dual:6-13` (MPL-2.0); `hicum2/hicumL2.cpp:21`; `hicum2/Makefile.am` builds `hicumL2.cpp` unconditionally (`src/Makefile.am:76`, `devices/Makefile.am:30`); no "Incompatible With Secondary Licenses" anywhere in the source.
- **BSD-3 clause 3.** SPDX `BSD-3-Clause.txt:9`; Apache §3 at `Apache-2.0.txt:31` and §6 at `:47`.
- **GitHub ToS.** `…/github-site-policy/Policies/github-terms/github-terms-of-service.md:143-147` (D.6).
- **KiCad.** `…/kicad-mirror/LICENSE.README:1-3`, `:53-54` (MPL-2.0 Eigen); `eeschema/sim/ngspice.cpp:10-13` (GPL v3 or later).
- **npm.** `npm view` matches `research/license-work/npm-licences.txt` for uplot, lit, react-aria-components, echarts, @observablehq/plot, axe-core, lz-string and chart2music.
- **Tarball.** `sha256sum` gives `894e649651f1838a14095e5a5439e7d3aa63e87ede14d283173fda4fcdef675f`; `stat` gives 13,105,136 bytes.

### Claim 19: open question on getopt (answered)

- In the wasm build, `…/wasm/build-O2/src/include/ngspice/config.h:135` has `#define HAVE_GETOPT_H 1` and `:138` has `#define HAVE_GETOPT_LONG 1`. The guard is at `NG47/src/misc/getopt_long_bsd.c:65`.
- `llvm-nm` on `libmisc.a` shows `getopt_long_bsd.o` with no symbols.
- So the 4-clause-header getopt code is not in the wasm, and that notice is not needed.

### Claim 20: blocker "no wasm yet" (outdated)

`MINWASM` (and `ngspice-Oz.wasm`) exist and are inspected above. They confirm the report's KLU, cppduals, XSPICE and OSDI expectations, and show the omissions in claim 1.

---

## 4. Important things the report missed

1. **Five sets of device-model and utility licences** in every build, including the minimal wasm (claim 1). This is the main correction. It changes the notices, the About text, the engine description and the GPL rows, but not the MIT choice.
2. **A default native ngspice 47 links GNU readline (GPL-3+), and FFTW3 or libsndfile when present** (claim 4). It matters if Tarık ever ships a desktop or offline build. CI golden tests that only run native ngspice distribute nothing.
3. **Numerical Recipes code.** `spicelib/devices/ltra/ltramisc.c:198-200`: "These are from the book Numerical Recipes in C" (`bessI0`, `bessI1`, `bessI1xOverX`). The lossy-line model is always built. Numerical Recipes' code licence does not allow redistribution. The functions are short Abramowitz & Stegun polynomial fits, so the risk is low, but it is worth knowing (or prune ltra too) **[lawyer, low]**.
4. **Patch-out option.** Pruning the model directories plus stubbing the three CC BY memory functions for wasm would make the engine truly "BSD + LGPL numparam + Sparse/UC-Peters/PD notices". It would also shrink the wasm. The cost is a patch similar to HICUM2: `devices/Makefile.am`, `src/Makefile.am`, `dev.c:153-187`, `configure.ac`. Tarık decides between "full ngspice models, longer notices" and "beginner model set, short notices".
5. **If XSPICE is ever turned back on,** also exclude the Icarus/GHDL VPI plugin (`xspice/verilog/Makefile.am:25-32`, GPL-2+), not only `table`.
6. **Scan blind spots to fix before relying on any automated licence list:** `scan_licences.py` patterns (`:9-22`) and the extensionless-file skip (`:29`). See claim 1.
7. **Extra lawyer questions:**
   - whether ngspice's 2018 BSD statement supersedes the UC BSIM terms-of-use files
   - how far the "no charge for the code itself" and US-export clauses and the English-law STAG terms bind a free web app
   - whether those restrictions block a GPL-3.0 app if the app and the engine are one work

---

## 5. Commands and artefacts (for re-running)

- **Native minimal build.** Extracted the tarball into `LFC/srccopy/` and configured out of tree in `LFC/build-min/`; logs are `LFC/configure-min.log`, `LFC/make-min.log` (the error) and `LFC/make-min2.log` (after patch 0001).
- **Default-configure probe.** `LFC/build-default-probe/` (`configure --with-x=no`), log `LFC/configure-default.log`. The first try without `--with-x=no` stopped at "Couldn't find Xaw library".
- **KLU comparison.** Netlists in `LFC/netlists/`, outputs in `LFC/runs/*.klu47.out` and `*.min47.out`.
- **Licence-line scan.** `python3 -I LFCS/licence_lines.py NG47/src LFC/licence_lines_src.tsv`.
- **Wasm inspection.** `strings`, `llvm-ar t` and `llvm-nm` (emsdk `upstream/bin`) on `MINWASM`, `…/wasm/build-O2` archives and `EEWASM`. Nothing in `…/wasm/` was modified.
- **Not reachable.** `www.gnu.org` and `webarchive.library.unt.edu` (ENOTFOUND). Those hosts must be allowed in the session's network settings for a primary FSF citation on ECL-2.0 and GPL compatibility.

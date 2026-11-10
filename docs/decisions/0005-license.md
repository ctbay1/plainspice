# 0005. Licence: MIT for our code; ngspice's terms for the engine

- Status: accepted (Tarık, 9 Nov 2026)
- Date: 2026-11-09
- Not legal advice. Where a lawyer would be needed is listed at the end.

## What ngspice's COPYING says

ngspice's licence is "Modified BSD" (BSD-3-Clause) *except for listed files*
(`engine/COPYING.ngspice`, lines 14–48): `numparam` is LGPL v2 or later, KLU is LGPLv2, OSDI
is MPL-2.0, XSPICE is public domain except its `table` code model (GPLv2+), `tclspice.c` is
LGPLv2, Sparse has an MIT-like notice. So "ngspice is BSD-3-Clause" is true of the core only.

Reading the sources found more than COPYING lists. A default build also compiles in:
- `numparam` (LGPL v2+), unconditionally: no configure option removes it;
- KLU (LGPL), OSDI and HICUM2's cppduals header (MPL-2.0), on by default;
- device models under other terms: BSIM4 4.8 (Educational Community License 2.0), BSIM3/BSIM4
  v5–v7/BSIM-SOI/BSIM3-SOI (UC Berkeley "BSIM terms of use": documentation credit, no charge
  for the code, US export rules), HiSIM2 and HiSIM_HV (Hiroshima University/STARC), SOI3 (UK
  DERA), LTRA (Numerical Recipes code, no grant), JFET2 (third-party copyright, no grant);
- two memory-probe files under CC BY 3.0.

## What our engine contains (decision 0003)

`engine/build.sh` leaves all of those out except numparam: `--disable-xspice --disable-osdi
--disable-klu`, the model list `REMOVED_MODELS`, and patch 0004 (the CC BY functions become a
stub in WebAssembly). What remains: the ngspice core and its classic device models (Modified
BSD, plus the Sparse and UC/Peters notices), numparam (LGPL v2+), public-domain FFT, FastNorm3,
and the Emscripten runtime (MIT/NCSA, musl MIT). We describe the engine as **"ngspice 47:
Modified BSD, with numparam under the LGPL"**, never as MIT.

What we do for those terms, from the first deploy:
- the BSD, Sparse and UC/Peters notices, and the LGPL-2.1 text: `THIRD_PARTY_NOTICES.md`,
  `LICENSES/`, served on the site at `licenses/`;
- the engine stays a separate `ngspice.wasm` file (never inlined), so it can be replaced;
- the exact source (`ngspice-47.tar.gz`, SHA-256-checked), our patches, build script and build
  record are served next to the `.wasm` at `engine/` and kept in the repository;
- `engine/README.md` explains how to rebuild it, with or without changes, and use your own;
- nothing in our terms restricts modifying or reverse-engineering the engine;
- the app's About/Licences page credits ngspice and numparam (Georg Post) and links all of this;
  it never implies endorsement by the ngspice team or UC Berkeley.

## Decision for our code

**MIT** (`LICENSE`, "Copyright (c) 2026 Tarık Bayraktar and PlainSpice contributors"; the name added at Tarık's request on 10 November 2026).

- It fits the engine: the LGPL asks only that our terms allow modification and reverse
  engineering, and that the library stays replaceable; MIT and a separate `.wasm` do both.
- It fits every likely dependency (MIT, ISC, BSD-3, Apache-2.0: CodeMirror, React, React Aria,
  uPlot, Vite) and lets GPL projects such as KiCad reuse our code.
- It is the licence students, teachers and contributors know best, and EEcircuit uses it too.
- Contributions come in under the same licence (GitHub's terms, inbound = outbound): no CLA.

Runner-up: Apache-2.0 (explicit patent grant, longer). GPL-3.0-or-later only if stopping closed
forks becomes a goal.

Also:
- **Docs** (`docs/`): CC BY 4.0. We write our own text; nothing is copied from the ngspice
  manual, which is CC BY-SA.
- **Fixtures and starter netlists**: CC0 1.0. Episode circuits from the channel, when the
  example library arrives: CC BY 4.0 with a credit line in the netlist's title or a comment.
- **Names**: "PlainSpice" and "Solved Circuits" and their logos are not licensed
  (`TRADEMARKS.md`).

## Where a lawyer would be needed

Registering the names as trademarks; any future combination with GPL code (for example
XSPICE's `table` model, or KiCad code); app-store or offline packaging; whether netlists are
protected works and whether CC0 holds in Turkey; copyright questions about AI-written code.

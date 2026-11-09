# Third-party notices

The app's own code is covered by the licence in [`LICENSE`](LICENSE). The **simulation engine**
(`engine/dist/ngspice.wasm` and `engine/dist/ngspice.mjs`, served on the site under `engine/`)
is **ngspice 47 compiled to WebAssembly with Emscripten 7.0.0**. It is *not* covered by the app's
licence: it is ngspice's Modified BSD licence with LGPL parts, as listed below.

**Exact source of the engine**

- Upstream release: `ngspice-47.tar.gz`,
  <https://sourceforge.net/projects/ngspice/files/ng-spice-rework/47/ngspice-47.tar.gz/download>,
  SHA-256 `894e649651f1838a14095e5a5439e7d3aa63e87ede14d283173fda4fcdef675f`.
  The deployed site also serves this exact file at `engine/source/ngspice-47.tar.gz`, next to
  the `.wasm`.
- Our changes and build: [`engine/build.sh`](engine/build.sh) and
  [`engine/patches/`](engine/patches/) (three small patches, and the HICUM2 model removed);
  build record: [`engine/BUILDINFO.txt`](engine/BUILDINFO.txt).
- How to rebuild the engine or replace it with your own build: [`engine/README.md`](engine/README.md).
- ngspice's own licence statement, verbatim: [`engine/COPYING.ngspice`](engine/COPYING.ngspice).

What is compiled in (configure `--disable-xspice --disable-osdi --disable-klu`, plus the model
list in `engine/build.sh`; see `engine/BUILDINFO.txt`): the ngspice core and its classic device
models (Modified BSD), numparam (LGPL v2 or later, always part of ngspice), the Sparse 1.3
solver, the FFT and transient-noise helpers, and the Emscripten runtime.

Left out, so none of their code is in the engine: XSPICE and its code models (including the GPL
`table` model), OSDI (MPL-2.0), KLU (LGPL), CIDER, and every device model whose source carries
other terms: BSIM3/BSIM4/BSIM-SOI (UC Berkeley BSIM terms; BSIM4 4.8 is ECL-2.0), HiSIM2 and
HiSIM_HV (Hiroshima University/STARC), SOI3 (UK DERA), HICUM2 (C++, MPL-2.0 header), LTRA
(Numerical Recipes code) and JFET2. The CC BY 3.0 memory-probe functions are replaced by a
one-line stub in WebAssembly (`engine/patches/0004-memory-probes-in-wasm.patch`).

---

## 1. ngspice: Modified BSD (BSD-3-Clause)

Copyright 1985 - 2018, Regents of the University of California and others.
Copyright 2001-2026, The ngspice team.

```
Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
this list of conditions and the following disclaimer in the documentation
and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
contributors may be used to endorse or promote products derived from this
software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

This app uses ngspice; it is not made or endorsed by the ngspice team or the University of
California.

## 2. numparam (src/frontend/numparam): GNU LGPL version 2 or later

The engine contains numparam, the parameter and expression library of ngspice, under the
GNU Lesser General Public License. The full text is in
[`LICENSES/LGPL-2.1-or-later.txt`](LICENSES/LGPL-2.1-or-later.txt).

```
Numparam: an add-on library for electronic circuit analysis front-ends
Copyright (C)  2002    Georg Post

    This library is free software; you can redistribute it and/or
    modify it under the terms of the GNU Lesser General Public
    License as published by the Free Software Foundation; either
    version 2 of the License, or (at your option) any later version.

    This library is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
    Lesser General Public License for more details.
```

The engine is a separate file (`ngspice.wasm`) that the app loads at run time. You may rebuild it
from the source above, with or without changes to numparam, and use your build in place of ours:
see [`engine/README.md`](engine/README.md). Nothing in this project's terms restricts modifying
the engine or reverse engineering it to debug such modifications.

## 3. Sparse 1.3 (src/maths/sparse)

```
Copyright (c) 1985,86,87,88,89,90
by Kenneth S. Kundert and the University of California.

Permission to use, copy, modify, and distribute this software and
its documentation for any purpose and without fee is hereby granted,
provided that the copyright notices appear in all copies and
supporting documentation and that the authors and the University of
California are properly credited.  The authors and the University of
California make no representations as to the suitability of this
software for any purpose.  It is provided `as is', without express
or implied warranty.
```

## 4. src/spicelib/devices/dev.c and src/frontend/commands.c

```
Copyright (c) 1990 University of California
Copyright (c) 2000 Arno W. Peters

Permission to use, copy, modify, and distribute this software and
its documentation without fee, and without a written agreement is
hereby granted, provided that the above copyright notice, this
paragraph and the following three paragraphs appear in all copies.

This software program and documentation are copyrighted by their
authors. The software program and documentation are supplied "as
is", without any accompanying services from the authors. The
authors do not warrant that the operation of the program will be
uninterrupted or error-free. The end-user understands that the
program was developed for research purposes and is advised not to
rely exclusively on the program for any reason.

IN NO EVENT SHALL THE AUTHORS BE LIABLE TO ANY PARTY FOR DIRECT,
INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, INCLUDING
LOST PROFITS, ARISING OUT OF THE USE OF THIS SOFTWARE AND ITS
DOCUMENTATION, EVEN IF THE AUTHORS HAVE BEEN ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE. THE AUTHORS SPECIFICALLY DISCLAIMS ANY
WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. THE
SOFTWARE PROVIDED HEREUNDER IS ON AN "AS IS" BASIS, AND THE AUTHORS
HAVE NO OBLIGATIONS TO PROVIDE MAINTENANCE, SUPPORT, UPDATES,
ENHANCEMENTS, OR MODIFICATIONS.
```

## 5. Other parts of the engine

- FFT library (src/maths/fft): public domain (John Green).
- FastNorm3 (src/frontend/trannoise, Gaussian random numbers for transient noise sources):
  Copyright Christopher Stewart Wallace.
- Bison-generated parsers: GPL-3.0-or-later WITH Bison-exception-2.2 (the exception applies to
  the generated parsers in ngspice).
- Emscripten runtime (in `ngspice.mjs` and `ngspice.wasm`): MIT or University of Illinois/NCSA,
  Copyright (c) 2010-2014 Emscripten authors. musl libc: MIT, Copyright (c) 2005-2020 Rich
  Felker, et al. dlmalloc: public domain (CC0). compiler-rt: Apache-2.0 WITH LLVM-exception.

## 6. JavaScript packages in the app

The page's JavaScript bundles open-source npm packages under their own licences: React and
React DOM (MIT), React Aria Components and its @react-aria, @react-stately and
@internationalized packages (Apache-2.0), CodeMirror 6 and Lezer (MIT), uPlot (MIT, © Leon
Sorokin), and their dependencies. Every build writes the full list, with each package's
licence and notice files, to `licenses/THIRD_PARTY_LICENSES.txt` on the site (generated from
exactly what is bundled; see `vite.config.ts`). axe-core (MPL-2.0), Playwright (Apache-2.0)
and the other development tools are used to build and test only and are not shipped.

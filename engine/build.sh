#!/usr/bin/env bash
# engine/build.sh: build ngspice to WebAssembly from the official release tarball.
#
# Output: engine/dist/ngspice.mjs (Emscripten ES-module glue) and engine/dist/ngspice.wasm,
# plus engine/BUILDINFO.txt (versions, flags, sha256 of the outputs).
#
# The engine runs like the ngspice command line in batch mode:
#   callMain(['-b', '-r', '/out.raw', '/circuit.cir'])   (one fresh instance per run)
# so results come from the same code path as `ngspice -b -r out.raw circuit.cir` on a PC.
#
# Usage:   bash engine/build.sh            (OPT=-O2 by default; OPT=-Oz for a smaller, slower build)
# Needs:   git, python3, curl, autoconf/automake/libtool, bison, make (Ubuntu: build-essential
#          autoconf automake libtool bison). Emscripten is fetched and pinned below.
# Work dir: $ENGINE_WORK (default: .engine-work/ in the repo root, git-ignored).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE="$REPO/engine"
WORK="${ENGINE_WORK:-$REPO/.engine-work}"
OPT="${OPT:--O2}"
JOBS="${JOBS:-$(nproc)}"

# ---- pins ---------------------------------------------------------------------------------
EMSDK_REPO=https://github.com/emscripten-core/emsdk.git
EMSDK_COMMIT=1693ce7359fc9694f198694f902a2cc061239b86   # emsdk "Release 7.0.0"
EMSDK_VERSION=7.0.0                                      # emcc 7.0.0 (777e6e5db7b4990bcaeb1b9998ed642cc84e6629)
NGSPICE_VERSION=47
NGSPICE_URL=https://sourceforge.net/projects/ngspice/files/ng-spice-rework/47/ngspice-47.tar.gz/download
NGSPICE_SHA256=894e649651f1838a14095e5a5439e7d3aa63e87ede14d283173fda4fcdef675f

EMSDK="$WORK/emsdk"
TARBALL="$WORK/download/ngspice-$NGSPICE_VERSION.tar.gz"
SRC="$WORK/ngspice-$NGSPICE_VERSION-src"
BUILD="$WORK/build$OPT"
LOGS="$WORK/logs"
mkdir -p "$WORK/download" "$LOGS" "$ENGINE/dist"
# configure runs its test programs (CommonJS JavaScript from emcc) with Node; the repo's
# package.json says "type": "module", which would make Node load them as ES modules and fail.
printf '{ "type": "commonjs" }\n' > "$WORK/package.json"
log() { printf '\n### %s\n' "$*"; }

# ---- 1. Emscripten (pinned) ---------------------------------------------------------------
log "1. emsdk $EMSDK_VERSION"
[ -d "$EMSDK/.git" ] || git clone -q "$EMSDK_REPO" "$EMSDK"
git -C "$EMSDK" -c advice.detachedHead=false checkout -q "$EMSDK_COMMIT"
( cd "$LOGS" && python3 -I "$EMSDK/emsdk.py" install "$EMSDK_VERSION" \
             && python3 -I "$EMSDK/emsdk.py" activate "$EMSDK_VERSION" ) > "$LOGS/emsdk.log" 2>&1
export PATH="$EMSDK/upstream/emscripten:$PATH"
emcc --version | head -1

# ---- 2. ngspice source (release tarball, checked) -----------------------------------------
log "2. ngspice $NGSPICE_VERSION source"
[ -f "$TARBALL" ] || curl -fL --retry 3 -o "$TARBALL" "$NGSPICE_URL"
echo "$NGSPICE_SHA256  $TARBALL" | sha256sum -c -
rm -rf "$SRC" && mkdir -p "$SRC"
tar xzf "$TARBALL" -C "$SRC" --strip-components=1 --no-same-owner

# ---- 3. patches ----------------------------------------------------------------------------
log "3. patches"
# Four small source patches (each file explains itself): compile without XSPICE, musl's
# strtod errno, the available-memory probe, and the CC BY memory probes left out of wasm.
for p in "$ENGINE"/patches/*.patch; do
  echo "applying $(basename "$p")"
  patch -p1 -d "$SRC" --forward --no-backup-if-mismatch < "$p" > /dev/null
done
# Leave out device models whose source carries terms other than ngspice's Modified BSD, or
# third-party code without a licence grant. All are chip-design transistor models (BSIM, HiSIM,
# SOI, HICUM) or models no first- or second-year circuit needs:
#   BSIM4: Educational Community License 2.0; BSIM3/BSIM4v5-7/BSIM-SOI/BSIM3-SOI: UC Berkeley
#   "BSIM terms of use"; HiSIM2/HiSIM_HV: Hiroshima University and STARC terms; SOI3: UK DERA
#   licence; HICUM2: C++ with an MPL-2.0 header; LTRA: contains Numerical Recipes code;
#   JFET2: third-party copyright without a licence grant; BSIM1/BSIM2: obsolete, same family.
# Kept: R C L K V I E F G H B, diode, BJT (+VBIC), JFET, MOS levels 1-3/6/9, VDMOS, MESFETs,
# HFETs, switches, lossless and RC lines, coupled lines. Format: <source dir>:<get_*_info name>.
REMOVED_MODELS=(
  bsim1:bsim1 bsim2:bsim2 bsim3:bsim3 bsim3v0:bsim3v0 bsim3v1:bsim3v1 bsim3v32:bsim3v32
  bsim4:bsim4 bsim4v5:bsim4v5 bsim4v6:bsim4v6 bsim4v7:bsim4v7
  bsim3soi_pd:b3soipd bsim3soi_fd:b3soifd bsim3soi_dd:b3soidd bsimsoi:b4soi
  hisim2:hsm2 hisimhv1:hsmhv hisimhv2:hsmhv2 soi3:soi3 hicum2:hicum ltra:ltra jfet2:jfet2
)
for entry in "${REMOVED_MODELS[@]}"; do
  dir="${entry%%:*}"; info="${entry##*:}"
  sed -i "\|src/spicelib/devices/$dir/Makefile|d" "$SRC/configure.ac"
  sed -i "\|spicelib/devices/$dir/lib[^/]*\.la|d" "$SRC/src/Makefile.am"
  sed -i "/^[[:space:]]*$dir[[:space:]]*\\\\\?[[:space:]]*\$/d" "$SRC/src/spicelib/devices/Makefile.am"
  sed -i "/get_${info}_info,/d" "$SRC/src/spicelib/devices/dev.c"
  if grep -q "get_${info}_info," "$SRC/src/spicelib/devices/dev.c" || grep -q "devices/$dir/lib" "$SRC/src/Makefile.am" \
     || grep -Eq "^[[:space:]]*$dir[[:space:]]*\\\\?[[:space:]]*\$" "$SRC/src/spicelib/devices/Makefile.am"; then
    echo "could not remove the $dir model" >&2; exit 1
  fi
done
# HICUM2 also needs libstdc++; drop that check, and HICUM2's test directory.
sed -i '/AC_CHECK_LIB(stdc++/d; /AC_SUBST(XTRALIBS/d; /tests\/hicum2\/Makefile/d' "$SRC/configure.ac"
sed -i '/^[[:space:]]*hicum2[[:space:]]*\\\?[[:space:]]*$/d' "$SRC/tests/Makefile.am"
( cd "$SRC" && autoreconf --force --install -I m4 ) > "$LOGS/autoreconf.log" 2>&1

# ---- 4. configure --------------------------------------------------------------------------
log "4. configure ($OPT)"
CONFIGURE_FLAGS=(
  --disable-debug
  --with-x=no                  # no X11 plotting
  --with-readline=no --with-editline=no
  --disable-openmp
  --disable-xspice             # code models need dlopen; also keeps out the GPLv2+ table model
  --disable-osdi               # Verilog-A models need dlopen; also keeps out MPL-2.0 code
  --disable-klu                # LGPLv2 KLU solver; the classic Sparse 1.3 solver remains (and is the default anyway)
  --with-fftw3=no
  --disable-dependency-tracking
)
rm -rf "$BUILD" && mkdir -p "$BUILD"
# Reproducible output: the build date ngspice embeds comes from the release itself (the mtime
# of NEWS in the tarball), and source paths in assert messages are mapped to fixed names.
export SOURCE_DATE_EPOCH="$(stat -c %Y "$SRC/NEWS")"
REPRO_FLAGS="-ffile-prefix-map=$SRC=/ngspice-$NGSPICE_VERSION -ffile-prefix-map=$BUILD=/build"
# CFLAGS must be explicit: configure.ac only adds its own "-O2 -s -Wall ..." when CFLAGS is unset.
( cd "$BUILD" && emconfigure "$SRC/configure" "${CONFIGURE_FLAGS[@]}" CFLAGS="$OPT $REPRO_FLAGS" CXXFLAGS="$OPT $REPRO_FLAGS" ) > "$LOGS/configure$OPT.log" 2>&1

# ---- 5. make (our link flags on the ngspice program) ---------------------------------------
log "5. make"
LINK_FLAGS="$OPT -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=createNgspice \
 -s ENVIRONMENT=web,worker,node -s INVOKE_RUN=0 -s ALLOW_MEMORY_GROWTH=1 -s FORCE_FILESYSTEM=1 \
 -s EXPORTED_RUNTIME_METHODS=callMain,FS,ENV -s STACK_SIZE=4MB \
 --js-library $ENGINE/no-system.js"
# Append the flags and a second -o to the libtool link line of the ngspice program (last -o wins).
sed -i "s|\$(ngspice_LDADD) \$(LIBS)|\$(ngspice_LDADD) \$(LIBS) $LINK_FLAGS -o ngspice.mjs|" "$BUILD/src/Makefile"
grep -q 'MODULARIZE=1' "$BUILD/src/Makefile"
( cd "$BUILD" && emmake make -j"$JOBS" ) > "$LOGS/make$OPT.log" 2>&1
test -f "$BUILD/src/ngspice.mjs" && test -f "$BUILD/src/ngspice.wasm"

# ---- 6. outputs + build record -------------------------------------------------------------
log "6. engine/dist"
cp "$BUILD/src/ngspice.mjs" "$BUILD/src/ngspice.wasm" "$ENGINE/dist/"
{
  echo "ngspice $NGSPICE_VERSION built to WebAssembly by engine/build.sh"
  echo "source:    $NGSPICE_URL"
  echo "sha256:    $NGSPICE_SHA256"
  echo "patches:   $(cd "$ENGINE/patches" && ls *.patch | tr '\n' ' ')"
  echo "models left out: ${REMOVED_MODELS[*]%%:*}"
  echo "emcc:      $(emcc --version | head -1)"
  echo "configure: ${CONFIGURE_FLAGS[*]} CFLAGS=$OPT (+ -ffile-prefix-map, SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH)"
  echo "link:      $(echo $LINK_FLAGS | sed "s|$ENGINE/|engine/|g")"
  echo "features (config.h):"
  grep -E '^#define (KLU|XSPICE|OSDI|CIDER|HAVE_LIBFFTW3|HAVE_GNUREADLINE|HAVE_BSDEDITLINE|USE_OMP|NGDEBUG|SHARED_MODULE|RFSPICE)\b' \
    "$BUILD/src/include/ngspice/config.h" | sed 's/^/  /' || true
  echo "outputs:"
  ( cd "$ENGINE/dist" && sha256sum ngspice.mjs ngspice.wasm | sed 's/^/  /' )
} > "$ENGINE/BUILDINFO.txt"
cat "$ENGINE/BUILDINFO.txt"
log "done"

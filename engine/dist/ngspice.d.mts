// Type declarations for the Emscripten glue built by engine/build.sh (hand-written; the build
// only replaces ngspice.mjs and ngspice.wasm).
import type { NgspiceFactory } from '../../src/engine/ngspice.ts';

declare const createNgspice: NgspiceFactory;
export default createNgspice;

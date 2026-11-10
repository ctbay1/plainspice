# Plan

*Updated 10 November 2026, at the end of the first session.*

## Done: the first milestone

1. **Decisions** ([docs/decisions/](decisions/)): TypeScript + Vite (0001); React 19 with React Aria
   Components (0002, Tarık); our own pinned, reproducible ngspice 47 WebAssembly build (0003);
   uPlot behind our own accessible plot module (0004); MIT for our code, the engine under
   ngspice's terms (0005, Tarık); the name PlainSpice (0006, Tarık); CodeMirror 6 (0007); share
   links in the URL fragment (0008); tests and CI (0009); WCAG 2.2 AA (0010); for an operating
   point, the copy that runs saves every current (0011). Research behind them:
   [docs/research/](research/). EEcircuit studied first: [what we do differently](eecircuit-comparison.md).
2. **The engine and the spike**: ngspice 47 compiled to WebAssembly (0.62 MB gzip, the chip-design
   models with other licence terms left out), running in a Web Worker exactly like
   `ngspice -b -r`. **Fixture results** ([fixture-results.md](fixture-results.md)): every vector
   of every fixture agrees with native ngspice 47 to 6 significant figures, and all are bit-for-bit
   identical; `.op`, `.tf` and `.dc` also match Ubuntu's ngspice 42 exactly. **Nothing disagrees
   with the expected values in the brief.** Native ngspice 47 built with the engine's options
   gives the engine's results bit for bit even where an ordinary (XSPICE) build takes different
   time steps. Live: <https://ctbay1.github.io/plainspice/spike/>.
3. **The netlist-first app**, live at <https://ctbay1.github.io/plainspice/>:
   - an editor (CodeMirror 6) that highlights each line the way ngspice reads it, with node
     colours that are colour-blind-safe and never the only signal, and results at the end of each
     part's line ("3 A, n1 → 0");
   - every line explained as a field table in plain words, and the whole circuit described in words;
   - 33 beginner-trap checks with the why and one-click fixes (`1M`, `3A`, no ground, a node with one
     connection, a current source with no path, duplicate names, unknown first letters …);
   - the results in words: node voltages, every current with its direction and each source's power,
     `.tf` results, sweep summaries and ngspice's messages explained; when ngspice's DC solution
     fails, the numbers are never shown as answers;
   - plots for `.dc` and `.tran` with a summary, a keyboard cursor, a data table and CSV;
   - share links (the whole circuit in the link), export for ngspice and LTspice, the brief's
     fixtures as examples, text size, high contrast and reduced motion settings, a help dialog, and
     an installable app that works offline.

   Every sentence the app says about how SPICE behaves was run in native ngspice 47 and 42 and in
   our engine first: [docs/spice-facts/](spice-facts/) (numbers and syntax, traps, explanations),
   re-run by the golden tests.
4. **Tests and CI**: _(filled in at the end of the session)_

## Next

- **Real people and devices** (needs Tarık or testers): a screen-reader pass (NVDA + Firefox,
  VoiceOver on macOS and iOS, TalkBack on Android), one real mid-range Android phone, Windows
  High Contrast; Firefox and Safari (only Chromium was available here).
- **LTspice**: open the exported `.net` files in LTspice on Tarık's PC; until then the export says
  "not checked in LTspice yet".
- **YouTube**: paste one "Open this circuit" link (`npm run make-link -- file.cir`) into an
  unlisted video's description and click it on a computer and a phone.
- **"Open this circuit" in the channel's pipeline**: add the links to the upload sheets in the
  solved-circuits repository (`deliver/`), starting with SPICE for Beginners (sp01).
- **Example library** from the channel's episodes (sp01, p01, p02, e04 …), with a credit line in
  each netlist (CC BY 4.0, decision 0005).
- **Turkish UI**: the strings are in a catalog (`src/i18n/en.ts`); translate them, and have a
  Turkish speaker review React Aria's tr-TR strings (one plural is already known to be wrong).
- **Later, designed for but not built**: the schematic editor (R, C, L, V, I, E, F, G, H, ground,
  wires, node names), kept in sync with the netlist both ways through `src/spice/`; AC analysis
  with Bode plots (log axes); cursors on plots for measurements; parameter sweeps (families of
  curves; the plot module already recognises nested sweeps).

## Open questions for Tarık

- The copyright line in `LICENSE` says "PlainSpice contributors". Do you want your name there?
- Register "PlainSpice" (and "Solved Circuits") as trademarks? `TRADEMARKS.md` asks people not to
  reuse the names, but only registration protects them.
- Which episodes go into the example library first?
- Should "Open this circuit" links run the simulation as soon as they open (`run=1`, the default
  in `make-link`)?
- Share links have no checksum (decision 0008): fine while links are clicked; worth adding only
  if links will ever be typed by hand.

# EEcircuit: what it is, and what we do differently

*9 November 2026. Studied: EEcircuit's default branch `gen2-next` at commit `0db7d45` (6 Oct 2026), plus the older `gen1` branch for history.*

Source paths such as `src/svelte/App.svelte:356` are relative to the clone at
`<scratch>/src/danchitnis_EEcircuit`.
Evidence files I produced are listed with absolute paths in section 8.

## In short

- **Audience.** EEcircuit is a polished, schematic-first, ngspice-in-the-browser simulator for chip designers. Its README says so, the demo circuit is a 90 nm MOSFET amplifier, and its engine ships chip-process model files. It is not aimed at first-year students.
- **The netlist comes second.** The netlist tab stays locked until you press Simulate on the schematic. Hand-written netlists count only in a "None" analysis mode; in the other modes, editor edits are dropped when you press Run.
- **Results are plots and a CSV file only.** There is no operating-point (`.op`) or transfer-function (`.tf`) view, no values on the circuit, no units on the plot axes and no legend.
- **No teaching help.** It does not explain netlist lines, and its own code does not check netlists for beginner traps before running. The private schematic package's wiring checks could not be inspected. It shows ngspice's raw messages in pop-ups that disappear after 10 s. It also silently turns `1M` into `1Meg` in one input path but not the other.
- **Accessibility.** The basics are good: native controls, labels, a live region, and zero accessibility warnings from the Svelte compiler. The two places that matter most fail, though:
  - The netlist editor traps the Tab key as EEcircuit sets it up. I reproduced this in a test page.
  - Plots are unlabelled canvases, and reading them needs a mouse.
- **Missing features.** No share links, no offline/PWA mode, no translations, no example library, and no export of netlists or LTspice files.
- **I could not build or run it.** It depends on a private, obfuscated package (`EEcircuit-schematic`, LGPL-3.0-or-later per the lockfile). The session's permission policy also blocked running the repository's build script. So there are **no screenshots and no axe numbers**. The findings come from the source, the Svelte compiler, a small Monaco test page, and native ngspice 42 runs.

---

## 1. Facts

| Topic | EEcircuit (gen2-next, 0db7d45) | Evidence |
|---|---|---|
| Home, activity | `eelab-dev/EEcircuit` (the `danchitnis/EEcircuit` URL leads there). 190 stars. Default branch `gen2-next`, last push 2026-10-06. Branches: gen1, gen2, gen2-next, next, pdk-selection, spring-2025, suspense, svelte-ui-migration, test. One main author (Danial Chitnis). | `gh api -X GET search/repositories -f q=EEcircuit` → `eelab-dev/EEcircuit 190 2026-10-06T22:51:02Z MIT gen2-next`; `git ls-remote origin`; `git log --format=%an` over the clone's 51 commits: 46 "Danial Chitnis" + 5 "danchitnis" |
| Licence | **App: MIT** (`Copyright (c) 2020 Danial Chitnis`). **Engine** `eecircuit-engine`: MIT. **Schematic editor** `EEcircuit-schematic` 2.0.0: **LGPL-3.0-or-later**. Its repo is private and its release bundle is obfuscated. | `LICENSE:1-3`; `npm view eecircuit-engine`; `package-lock.json` entry `../EEcircuit-schematic` (license LGPL-3.0-or-later; devDependency `javascript-obfuscator`); `vite.config.mts:11-17` ("The local v2 package's obfuscated release bundle…"); `git ls-remote https://github.com/eelab-dev/EEcircuit-schematic` asks for credentials, while a public control repo (`eelab-dev/EEcircuit-engine`) answers |
| Intended audience | "rapid analysis and sharing circuit ideas and results within the **VLSI and chip-design communities**". The demo is "a common-source NMOS amplifier" on a PTM 90 nm model. The engine bundles PTM, FreePDK, GF180 and SkyWater model files. The "Next" line adds PDK/process corners, Monte Carlo and layout. | `README.md:3`, `index.html:13`, `src/schematic/demoSchematic.ts:3-15`, `npm-eecircuit-engine/package/dist/models/`, `README.md:32` |
| UI framework | **Svelte 5.57** (runes) + **Ark UI 5.24** (Zag.js state machines for tabs, dialog, menu, popover, tooltip) + Lucide icons. Migrated from React 19 + Chakra UI 3 + Zustand on 1 Sep 2026; the README still credits React. | `package.json:46-54`; commits `f7f8570`…`930a681` (2026-09-01); `git show 82f060e:package.json`; `README.md:46` |
| Build tooling | Vite 8 (Rolldown), TypeScript 6, svelte-check, ESLint 10, a custom chunk-graph check | `package.json:8-44`, `scripts/check-chunk-graph.mjs` |
| Editor | **Monaco 0.56.0** with a Monarch "spice" grammar and snippet completions: 6 directives (`.include .tran .dc .ac .save .param`; no `.op`, `.tf` or `.end`) and 11 element templates (R, C, L, M, three V, two I, G, E). **No diagnostics**: zero calls to `setModelMarkers`. Screen-reader name "Editor content". | `src/editor/spiceLanguage.ts:5-34, 67-156, 192-233`; `src/svelte/simulation/MonacoEditor.svelte:28-55` |
| Plotting | **webgl-plot 1.1.2** (the author's own WebGL line library) for traces, 2D canvases for axes. Own zoom/pan/cursor/snap code; one or two plot areas; log X/Y; AC magnitude and phase plotted separately; a slider for parameter sweeps. | `package.json:54`; `src/svelte/plot/WebglPlotCanvas.svelte:511-546`; `src/svelte/plot/PlotView.svelte:89-97` |
| Engine | `eecircuit-engine` (ngspice compiled with Emscripten). API: `Simulation.start / setNetList / runSim / getError / getInfo`. It returns ngspice's raw vectors (`variableNames`, `data`, real or complex). | `npm-eecircuit-engine/package/dist/simulationLink.d.ts`, `readOutput.d.ts` |
| Where the engine runs | **Module Web Workers**, never the main thread:<br>• a pool of up to `navigator.hardwareConcurrency` workers<br>• one worker started early, in idle time after the schematic is ready<br>• 30 s timeout per run<br>• a new run silently aborts the previous one<br>• **no Stop button** | `src/simulation/parallelSimulation.ts:43, 73, 261, 313-325, 465`; `src/workers/simulationWorker.ts:31-48`; `src/svelte/App.svelte:53-66, 108-112` |
| Engine size, version | `eecircuit-engine.mjs` is 20,346,804 bytes (5,665,775 bytes with gzip -9) and is loaded by each worker. ngspice is built from the newest tag of a GitHub mirror with "emsdk latest", so the version is not pinned. | `stat`/`gzip -9` on the npm dist file; `src/eelab-dev_EEcircuit-engine/Docker/run.sh:6-16, 35-41` |
| Input model | **Schematic first.**<br>• The Simulation tab is disabled until "Simulate" is pressed on the schematic.<br>• The editor then shows the *generated* netlist.<br>• Hand-written netlists work only in the "None" analysis mode.<br>• In DC/AC/Transient/Noise modes, Run regenerates the netlist from the schematic and **drops editor edits**. | `src/svelte/App.svelte:355-361`; `src/svelte/simulation/SimulationView.svelte:90-93, 272-273`; `src/controllers/simulationController.ts:14-19`; test title `tests/playwright/none-config-netlist.spec.ts:4` |
| Schematic editor | A canvas, from the private package. Up to 19 part families: R, C, L; DC/sine/pulse V and I sources; E, G, H, F; VDD, GND, port, a 90 nm op-amp, nFET, pFET. Modes: select, wire, move, text, delete, pan. Single-key shortcuts. Image export as SVG, PNG or PDF. | `src/types/componentTypes.ts:170-535, 560-562`; `src/schematic/schematicShortcuts.ts:28-94`; `src/svelte/schematic/ExportImageModal.svelte:68, 87, 120` |
| Analyses offered | Forms for **DC sweep, AC, Transient, Noise**, plus "None" (netlist run as written). **No operating-point (`.op`) or transfer-function (`.tf`) form or view.** Parameter sweeps use EEcircuit-only `[start:step:stop]` syntax inside values and run as parallel workers. | `SimulationView.svelte:18, 272-296`; `user.md:96-106`; `simulationController.ts:25-28` |
| How results are shown | **Plots only, plus "Download CSV".**<br>• The first vector is always the x-axis; the rest are checkboxes.<br>• No tables, no values on the schematic (the schematic API used has no method for it).<br>• Axis ticks use SI prefixes with **no unit symbol**; the cursor readout is `X: 1.000m, Y: 450.000m`, also without units.<br>• Vector names are shown raw (`v(output)`, `i(vsup)`). | `PlotView.svelte:22, 172-178`; `WebglPlotCanvas.svelte:301`; `src/components/ScientificPlot/plotcanvas/axis/axisRenderer.ts:314, 406`; `…/axis/unitConverter.ts:5-71`; editor methods used in `SchematicView.svelte` |
| Bad netlists | Engine error strings are shown **verbatim** as pop-up messages ("toasts") titled "Simulation Error":<br>• at most 4 groups, **auto-dismissed after 10 s**<br>• announced through an `aria-live="polite"` region<br>• a Status Center dialog keeps the history (copy/clear).<br>Schematic problems give one generic message: "Netlist Generation Failed — fix errors before simulating, or hold Shift to proceed." Nothing is highlighted in the editor. | `src/utils/simulationErrorNotifier.ts:27-44`; `src/svelte/components/Notifications.svelte:52, 59`; `StatusCenter.svelte:16-20`; `SchematicView.svelte:193` |
| Unit traps | Silently rewrites `<number>M` to `<number>Meg` in schematic-generated netlists and analysis commands, but not in hand-written ones. The code comment calls ngspice's reading of M "a bug". No warning is shown. Component values are not validated, and the DC-current placeholder suggests **"1A"**. | `src/utils/unitCorrection.ts:4-10, 19-29`; `src/store/simulationStore.ts:528`; `src/types/componentTypes.ts:231` |
| Share links / URL state | **None.** The only URL parameters are `?clean=true` and `?theme=dark/light`. Sharing means downloading an EEcircuitV2 JSON file. | `src/svelte/state/browserSession.ts:6`; `src/store/uiStore.ts:103-106`; `App.svelte:223-249` |
| Files in and out | **In:** open or drag in `.json`/`.txt` (EEcircuitV2, with a converter for V1).<br>**Out:** JSON, results CSV, schematic SVG/PNG/PDF.<br>**No netlist file export and no LTspice export.** Generated netlists start with `.include modelcard.ptm`, a file that exists only inside the engine. | `App.svelte:172-249`; `HeaderActions.svelte:59-61`; `simulationStore.ts:578-579` |
| Autosave | A versioned snapshot in the browser's localStorage under the key `eecircuit-browser-project` (schematic, setups, hand-written netlist, plot choices). Results are not saved. | `src/persistence/browserProject.ts:5`; `README.md:26-30` |
| PWA / offline | **None.** No web manifest, no service worker. `public/` holds only `EEcircuit.svg`, `EEcircuit_og.png`, `font.bmp`, `robots.txt`. | `ls public`; grep for `serviceWorker` and `manifest` → 0 hits |
| Mobile / iPad | **Strong.**<br>• Input profiles (mouse/trackpad/touch, auto-detected); pinch and drag; tap-to-pick parts.<br>• Layout breakpoints at 1050/767/600 px.<br>• A Playwright iPad-WebKit test project and a physical-iPad Safari suite (SafariDriver + Appium). | `user.md:5-12, 27-35`; `src/svelte/styles/global.css:233-269`; `playwright.config.ts:41-44`; `IPAD_TESTING.md` |
| Examples | One demo (the NMOS amplifier), via New → Load Demo. The test circuits are not exposed in the UI. | `App.svelte:416-431` |
| Help | An external guide at help.eecircuit.com (not reachable from this session), `user.md`, a Shortcuts dialog (Shift+H), a launch video | `README.md:10-12`; `schematicShortcuts.ts:50` |
| Translations (i18n) | None. English strings are written inline; the page is `<html lang="en">`. | `index.html:2`; grep for `i18n` and `locale` → only `toLocaleTimeString` |
| Themes and display modes | Light/dark (follows the system, toggle, or `?theme=`). **No high-contrast, large-text or reduced-motion handling**: `prefers-reduced-motion`, `prefers-contrast` and `forced-colors` appear nowhere. | `global.css:1-37`; `uiStore.ts:98-107`; grep → 0 hits |
| Tests | • Vitest: 58 unit tests<br>• Playwright: 70 tests (headed Chrome, one worker), 4 preview tests, 10 video-recording specs, 4 physical-iPad tests<br>• 333 `getByRole` locators<br>• **No axe-core**<br>• **No check of numbers against native ngspice**: the TIA test only checks that canvases and the `v(out)` label appear | grep counts in `tests/`; `tests/playwright/tia-transient.spec.ts:44-53` |
| CI and deployment | **CI:** GitHub Actions on push: npm ci, npm audit, type/lint check, unit tests, headed-Chrome end-to-end tests under xvfb, build. It first checks out the **private** schematic repo.<br>**Deploys:** the weekly "next" build goes to Vercel; production goes to Cloudflare (Wrangler static assets). | `.github/workflows/build.yml:16-19`; `build-push-next.yml:30-50`; `wrangler.jsonc`; `README.md:18`; commit `9ba008d` |
| Privacy | Runs locally; nothing is uploaded. gen1 shipped Vercel Analytics and Speed Insights; gen2-next has no analytics dependency. | `README.md:3`; `gen1:package.json`; current `package.json` |
| History | gen1 (React + Chakra) was **netlist-only**: Monaco editor, Run, plot, an "info" tab with ngspice's raw text, a CSV tab, workers via comlink, netlist autosave. It still runs at gen1.eecircuit.com. gen2 moved to schematic-first. | `gen1:src/EEcircuit.tsx:66-130, 540-571`; `gen1:src/sim/simulationArray.ts:46-52`; `README.md:5` |

## 2. How a simulation flows in EEcircuit (read from the source)

1. The app opens on the **Schematic** tab with the demo amplifier (or an empty canvas with `?clean=true`).
2. **Simulate (Netlist)** (bottom right) asks the private editor for a netlist. If that fails, the user gets the generic "Netlist Generation Failed" message; Shift+click forces it through (`SchematicView.svelte:173-202`).
3. The app assembles the netlist (`simulationStore.ts:518-640`), in this order:
   - `* Netlist generated by EEcircuit` and `.include modelcard.ptm`
   - the schematic netlist, with `M`→`Meg` rewritten
   - ` AC 1` appended to the chosen source line for AC/Noise runs (`src/utils/sourceDetection.ts:100-136`)
   - the built-in `chang90` op-amp subcircuit (PTM 90 nm MOSFETs, `src/Simulate/subcircuits/chang90.ts`) when the circuit uses it
   - the analysis line from the form
   - `.save`/`.probe` lines from the parts picked with "To Be Plotted"
   - `.end`
4. The app switches to **Simulation** (`simulationStore.ts:647-649`). Monaco shows the netlist; the sidebar has the analysis form and **Run Simulation**.
5. **Run** posts the netlist to a worker, which runs `runSim()` and returns the raw vectors. On success the app switches to **Plotting** (`plotStore.ts:389`); errors become toasts.

## 3. Strengths worth learning from

1. **Engine off the main thread, started early.** Web Workers; one worker started in idle time once the first screen is ready (`App.svelte:108-112`, `parallelSimulation.ts:261`); "latest run wins" cancellation (`parallelSimulation.ts:313-325`); a 30 s timeout. *We keep this, and add a visible Stop button.*
2. **Lazy loading of everything that isn't the first screen.** The simulation and plot UI load in idle time (`App.svelte:53-91`), and a script checks the production chunk graph (`scripts/check-chunk-graph.mjs`).
3. **Solid accessibility basics in the app shell:**
   - native buttons, inputs, selects and fieldsets with legends
   - `aria-pressed` on toggles, `aria-expanded` on the drawer, `aria-busy` on Run
   - `role="progressbar"` with values, `role="alert"` for form errors, an `aria-live` region for messages
   - a visible focus outline (`global.css:44`)
   - dialogs from Ark UI with focus trapping and Escape. The repo's own test notes that Ark hides the page from the accessibility tree while a dialog is open (`tests/playwright/chakra-parity-recovery.spec.ts:222-223`).
   - the Svelte compiler reports **0 accessibility warnings across all 17 components**, with one deliberate suppression (`SchematicView.svelte:378`).
4. **"Why is this disabled?" is answered.** Unavailable tabs stay focusable (`aria-disabled`) and show a tooltip on hover *or focus*: "Click Simulate on the schematic to generate a netlist first." (`App.svelte:355-361`, `global.css:57`). *We copy this pattern.*
5. **Units next to value fields**, e.g. "Resistance (Ω)" (`PropertiesPanel.svelte:104`).
6. **"To Be Plotted".** Clicking a wire or a part's pin chooses what to save, and the app writes the `.save`/`.probe` lines (`src/utils/toBePlotted.ts:52-57`). This is a good bridge from circuit to output.
7. **Status Center.** A persistent message history with copy-to-clipboard and category filters (`StatusCenter.svelte`). Toasts alone would not be enough.
8. **Touch and iPad treated seriously.** Input profiles, gestures and real-device tests (`IPAD_TESTING.md`).
9. **Autosave done carefully.** A versioned snapshot, written in transactions; a failed import never overwrites the saved project (`README.md:26-30`).
10. **Versioned file format with a converter that refuses to guess** (`README.md:20-24`).
11. **Tests that use role-based locators** (333 `getByRole`). They double as a check that controls have accessible names.
12. **Plot colours are checked against the background** (≥ 4.5:1, `colorUtils.ts:88`). It is the right idea, but see the accessibility findings: the colours are not checked against *each other*.

## 4. Gaps for first-year students

The SPICE behaviour below was checked with native **ngspice 42** (`/usr/bin/ngspice`). The netlists and logs are in `…/research/eecircuit-work/netlists/`.

1. **Wrong starting point.**
   - The first screen is a MOSFET amplifier on a 90 nm model (`demoSchematic.ts:3-15`); the only completions offered for transistors are MOSFETs.
   - First-year circuits (dividers, sources, Thevenin, nodal analysis) have no examples.
2. **The netlist is not the thing you learn.**
   - You cannot open the netlist editor without first pressing Simulate on a schematic (`App.svelte:355-357`).
   - Hand edits count only in "None" mode, and in the other modes they are silently discarded on Run (`simulationController.ts:14-19`).
   - Nothing explains what a line means. Completions insert `R${1:number} ${2:node1} ${3:node2} ${4:value}` (`spiceLanguage.ts:104`). There is no word on which node is +, which way a current source pushes, or what the value's suffix means.
3. **No operating point and no transfer function.**
   - There is no `.op` or `.tf` form, and completions offer neither (`SimulationView.svelte:18`, `spiceLanguage.ts:67-98`).
   - If a student writes `.op` by hand, ngspice returns one point per vector with **a node voltage as vector 0**. In my divider run, `Plotname: Operating Point`, `No. Points: 1`, vector 0 = `v(in)` (`divider_op.raw`).
   - EEcircuit always uses vector 0 as the x-axis and offers the rest as plot traces (`PlotView.svelte:22, 172`). The answer to the most common first-year question, "what is the voltage at this node?", would therefore appear only as a one-point "plot" or in the CSV file. *(This is inferred from the code: I could not run the app.)*
   - `.tf` is worse: ngspice labels all three results `voltage`, including the two impedances: `v(Transfer_function)` = 0.3333, `v(v1#Input_impedance)` = 3000, `v(output_impedance_at_V(out))` = 666.67 (`divider_tf.raw`).
4. **Signs and names are left raw.**
   - Source currents come out negative when the source delivers power: `i(v1)` = `-4.000e-03` for the 12 V divider (`divider_op.raw`). EEcircuit shows this as a raw `i(v1)` trace with no direction.
   - Names like `v(output)`, `i(vsup)` and `v1#branch` are never explained.
5. **Unit traps are hidden or invented rather than explained.**
   - ngspice reads `1M` as **1 mΩ**: `R1 1 0 1M` across 1 V gives `v1#branch = -1.00000e+03` A (`mega_trap.log`).
   - It reads `3A` as **3 attoamps**: `I1 0 1 DC 3A` into 1 kΩ gives `V(1) = 3.000000e-15` (`atto_trap.log`).
   - EEcircuit silently rewrites `M`→`Meg` for schematic netlists but not hand-written ones, so the same text means mega in one place and milli in another. Its DC-current placeholder suggests `1A`, which ngspice reads as 1e-18 A (`placeholders.log`: `v(2) = 1.000000e-18`; `1mA` → 1e-3, `10uA` → 1e-5 and `10ohm` → 10 Ω all behave).
   - Whether the private schematic package rewrites a trailing `A` cannot be checked.
6. **No checks before running.** ngspice itself does not stop on a missing ground or a current source with no DC path. It warns "singular matrix", falls back, and **prints numbers anyway**:
   - No ground (`V1 1 2 DC 5`, `R1 1 2 1k`, `R2 2 3 1k`): six "Warning: singular matrix: check node 1" lines, then gmin and source stepping fail, then "Transient op finished successfully", then **V(1) = 2.5025 V, V(2) = V(3) = −2.4975 V** (`trap_noground.log`).
   - A current source feeding only a capacitor: the same warnings, then **V(1) = 10 mV** (`trap_isrc_nopath.log`).
   - A node reached only through a capacitor: **V(3) = 2.5 V** (`trap_dangling.log`).
   - A duplicate name gives "device already exists, bail out"; an unknown first letter (`Y1`) gives "model name is not found" (`trap_duplicate.log`, `trap_letter.log`).

   EEcircuit's own code does not check the netlist for these traps before running. The private schematic package does its own wiring checks, which could not be inspected; a hand-written netlist gets no checks at all; the only app-level check is a "Missing subcircuit model" notice (`simulationStore.ts:562-575`). After the run it passes whatever the engine reports to toasts and shows the results too (`simulationController.ts:36-45`). A beginner sees a red toast reading "singular matrix: check node 1" next to a plot of meaningless numbers.
7. **Error messages don't stay or point anywhere.** Toasts vanish after 10 s, are not linked to a netlist line, and are not in plain words.
8. **Results have no units.** Axes show `1.50m` (no V, A or s). The cursor shows `X: 1.000m, Y: 450.000m`. The axes write micro as `u` while the cursor writes `μ`. On the axes `M` means mega, while in a netlist `M` means milli.
9. **Sharing is a file, not a link.** There is no "Open this circuit" link. A netlist copied out of EEcircuit's schematic path starts with `.include modelcard.ptm`, and native ngspice then stops: "Error: Could not find include file modelcard.ptm", exit code 1 (`include_ptm.log`). Sweep values written as `[1:1:10]k` also run nowhere else.
10. **No netlist or LTspice export**, so a student cannot carry the circuit to the tools their course uses.
11. **Heavy and online-only.** About 20 MB of engine JavaScript (5.7 MB compressed), which each worker loads and compiles. It is kept only in the browser's ordinary cache, and there is no offline mode. Phones on student data plans pay for that download, and the app does not work without a connection.
12. **English only.** Turkish students get no UI in their own language.

## 5. Accessibility findings

**Method.** I could not run EEcircuit (section 7), so there are no axe-core counts and no screenshots. Instead:

- **Source review** of all 17 Svelte components and the CSS.
- **The Svelte 5.57 compiler's accessibility lint**, run on the `.svelte` files read as plain text. A deliberately bad test file proved the setup works: 4 warnings found.
- **A test page in Chromium (Playwright)** built with *exactly* EEcircuit's Monaco feature imports and editor options (`MonacoEditor.svelte:28-55`), to test the Tab key.
- **Contrast ratios** computed from the CSS colour tokens.

### Findings

| # | Finding | WCAG 2.2 | Evidence |
|---|---|---|---|
| A1 | **Keyboard trap in the netlist editor.** With EEcircuit's Monaco feature set, keyboard focus never leaves the editor from within the page:<br>• Tab inserts 4 spaces; Shift+Tab removes them<br>• Escape then Tab still indents<br>• **Ctrl+M (Monaco's standard "Tab moves focus" toggle) does nothing**, because EEcircuit doesn't load the `toggleTabFocusMode` feature, which is a separate entry point in Monaco 0.56<br>Adding that single import makes Ctrl+M then Tab move focus on (tested). The page also gives no hint about how to leave. | 2.1.2 No Keyboard Trap (A) | `…/eecircuit-work/logs/monaco-tab-test.json`: subset variant, all five steps `inEditor=true`, line 1 indented to `"        * divider"`; toggle variant, "Ctrl+M then Tab" → `inEditor=false active=after`. `monaco-editor/esm/vs/features/toggleTabFocusMode/register.js` exists but is not in EEcircuit's import list (`MonacoEditor.svelte:29-36`). Key binding: `toggleTabFocusMode.js:18-19` (Ctrl+M; Ctrl+Shift+M on Mac). |
| A2 | **Run Simulation sits after the editor in the tab order.** The DOM order is "To Be Plotted" → editor → sidebar (form, Run). A keyboard user arriving on the Simulation tab hits the editor before Run, and A1 stops them there. Pressing Run is likely possible only by leaving through the browser (e.g. F6 or Ctrl+L to the address bar, then Shift+Tab back into the page). *Inferred, not observed.* | 2.1.1 Keyboard (A) | `SimulationView.svelte:183-208, 301` |
| A3 | **Results are canvas-only.**<br>• The WebGL and axis canvases have no role, name or text alternative.<br>• Zoom, pan and the value cursor work only with a pointer (wheel and pointer events; no key handlers).<br>• The only route to numbers without a mouse or without sight is "Download CSV". | 1.1.1 (A), 2.1.1 (A), 1.3.1 (A) | `WebglPlotCanvas.svelte:511-546` (no `aria-*` on canvases; handlers `onwheel`, `onpointer*`); `PlotView.svelte:178` |
| A4 | **No legend; colour is the only link between a line and its signal name.**<br>• The signal list uses checkboxes in the accent colour, with no colour swatches.<br>• A line can be highlighted only by mouse hover on its name (no focus equivalent).<br>• Line colours come from a hash of the name (`hue = hash % 360`) with **random** saturation and lightness. Two signals can get near-identical hues, there is no colour-blind-safe palette, and no dashes or markers. | 1.4.1 Use of Color (A); 1.3.1 | `colorUtils.ts:88-119, 143`; `PlotView.svelte:174` (`onmouseenter`/`onmouseleave` only); `WebglPlotCanvas.svelte:94-99` |
| A5 | **The schematic is a canvas** inside `role="application"`, with no text description of the circuit. Placing and wiring parts need pointer clicks; shortcuts only change modes. Hover information appears only for the mouse. | 1.1.1, 1.3.1, 2.1.1 (A) | `SchematicView.svelte:378-379, 408-421`; `user.md:20-46` |
| A6 | **Text contrast below 4.5:1** (computed from tokens):<br>• light `--fg-subtle` #7b8494 on white: **3.77:1** (small text in the Settings menu)<br>• light `--warning` #d97706 on white: **3.19:1** (`.settings-reload-note`, `.config-modified-status`)<br>• dark `--danger` #dc2626 on #08090b: **4.12:1** (`.config-name-error`, `.export-error`, `.danger-outline-button`) | 1.4.3 Contrast (AA) | `global.css:1-37, 134, 148, 156, 170, 187, 188`; `…/eecircuit-work/scripts/contrast.py` |
| A7 | **Faint control borders.** Input and button borders are #d9dee7 on white (**1.35:1**) and #303541 on #08090b (**1.62:1**). This fails wherever the border is the only cue for a control's boundary. | 1.4.11 Non-text Contrast (AA) | same token table |
| A8 | **The name a screen reader hears differs from the visible text.** The tab labelled "Plotting" is announced as "plot display". Speech-input users saying "click Plotting" will miss it. Run keeps the name "Run Simulation" while its visible text reads "Running simulation". | 2.5.3 Label in Name (A) | `App.svelte:360`; `SimulationView.svelte:301` |
| A9 | `aria-label` on a `div` with no role ("Schematic tools") is not exposed to assistive technology. axe would report this as `aria-prohibited-attr`. | 4.1.2 (A) | `SchematicToolbar.svelte:168` |
| A10 | **No page headings above h3.** There is no h1 or h2; headings begin at h3 inside panels and dialogs. | 1.3.1 / 2.4.6 (advisory; axe best practice) | grep `<h[1-6]`: only h3/h4 |
| A11 | **Error toasts vanish after 10 s** and cannot be held open. The Status Center keeps the history, which softens this. | 2.2.1 Timing Adjustable (A) | `Notifications.svelte:52` |
| A12 | **Focus order differs from the visual order on narrow screens.** Below 767 px the sidebar is drawn *above* the editor but comes *after* it in the tab order. | 2.4.3 Focus Order (A) | `global.css:250`; `SimulationView.svelte:183-208` |
| A13 | **Focus is not moved when the tab changes.** Pressing "Simulate" switches tabs and hides the focused button; no code moves focus to the new panel. *Inferred.* | 2.4.3 (A) | `simulationStore.ts:647-649`; no `.focus()` in `App.svelte` or `SchematicView.svelte` |
| A14 | **No user modes for reduced motion, high contrast or large text.** These are not AA failures by themselves (2.3.3 is AAA), but they are our requirements. | — | grep → 0 hits |

**What EEcircuit does well:**

- all icon buttons are named ("Open add component popover", "Rotate selection", …)
- `<html lang="en">`
- a visible focus outline
- focus-trapped, Escape-closable dialogs (Ark UI)
- disabled tabs that are still focusable and explained
- `aria-live` messages and `role="alert"` form errors
- 32 px header buttons on phones, above the 24 px minimum of 2.5.8 Target Size (Minimum, AA) (`global.css:255`)
- 0 accessibility warnings from the Svelte compiler (`…/eecircuit-work/logs/svelte-a11y-warnings.log`).

### Keyboard-only walk-through (inferred from source and the test page; not observed)

1. **Tab through the header.** You pass the tabs (one tab stop; the arrow keys move between tabs, via Ark UI), then New, Open, Save, Theme, Input profile, Fullscreen, Settings, Status and About.
2. **Reach Simulate.** Next comes the schematic area (`tabindex="0"`), then the tool buttons, then **Simulate Circuit**. Enter generates the netlist and switches to Simulation.
3. **Get stuck in the editor.** Tab moves to "To Be Plotted", then into Monaco, and stays there (A1). Run Simulation is unreachable by Tab (A2).
4. **If Run is reached**, through the browser's own controls, the app jumps to Plotting. There you can tab through the toolbar buttons and the signal checkboxes, but **cannot read a single value** without a mouse (A3). The only option is Download CSV.

**Verdict:** a keyboard-only user cannot reliably run a simulation and cannot read its results in EEcircuit. A screen-reader user gets no description of the circuit or of the plots.

## 6. What we do differently

1. **Netlist first; the schematic comes later and stays in sync both ways.** EEcircuit treats the netlist as a by-product and drops edits outside "None" mode. Our students learn by reading and writing the netlist.
2. **Every line explained in plain words**, as a field table: name, + node, − node, value; for current sources "from node, to node, current". EEcircuit offers only snippet templates with `node1 node2`.
3. **Trap checks before running, with a reason and a one-click fix; never silent rewriting.** ngspice reads `1M` as 1 mΩ and `3A` as 3 aA, and gives confident numbers for a circuit with no ground or a current source with no path (all verified above). EEcircuit silently rewrites `M` in one path, not the other, and its own placeholder suggests `1A`.
4. **`.op` and `.tf` as first-class results.** Node voltages and branch currents appear *on the circuit* and in a table, each current with a stated direction. `.tf` is spelled out as "gain 1/3, input resistance 3 kΩ, output resistance 666.7 Ω". EEcircuit has no `.op`/`.tf` view, would misread `.op` vectors as a plot, and passes `.tf` impedances through labelled as voltages.
5. **Plain units everywhere** (12 V, 4 mA, 3 kΩ), with SPICE notation shown alongside and explained (`1meg` vs `1M`). EEcircuit's axes and cursor show prefixes without units, and `M` means two different things on screen.
6. **Errors in plain words, attached to the line, and they stay until fixed.** EEcircuit shows raw ngspice text in toasts that vanish after 10 s.
7. **Keyboard and screen reader from day one:**
   - an editor where Tab can leave (CodeMirror 6, or Monaco with tab-focus mode and a visible hint)
   - Run reachable before the editor, plus a shortcut
   - every plot with a data-table twin and a keyboard cursor
   - results announced, and the circuit described in words.

   Our test page shows EEcircuit's Monaco setup traps Tab, and its plots are canvas-only.
8. **Colour-blind-safe node colours from a fixed palette, plus dashes/markers and direct labels or a legend.** EEcircuit's colours are hash-based and random, with no legend.
9. **High-contrast, large-text and reduced-motion modes, with colour tokens checked for 4.5:1 and 3:1 and axe run in CI.** EEcircuit has four colour pairs below AA and no axe tests.
10. **The whole circuit and analysis in the URL (no server)**, so every Solved Circuits video can link "Open this circuit". EEcircuit shares only by JSON file.
11. **Exports that run as-is in ngspice and LTspice**: no hidden includes, no home-made syntax. EEcircuit's generated netlist makes native ngspice stop on `.include modelcard.ptm` (verified), and its `[a:b:c]` sweep syntax is EEcircuit-only.
12. **Golden tests against native ngspice to 6 significant figures, and a pinned ngspice version.** EEcircuit's tests check that plots appear, not that numbers are right, and its engine build tracks the latest ngspice tag and "emsdk latest".
13. **Offline PWA with a small engine** carrying only the device models students need. EEcircuit has no service worker and ships about 20 MB of engine JS with chip-process (PDK) model files.
14. **An example library from the channel's episodes, and a Turkish UI later** (strings kept in catalogs from day one). EEcircuit has one MOSFET demo and English strings written inline.
15. **Fully open and buildable from the public repo.** EEcircuit cannot be built from public sources: its schematic editor is a private, obfuscated LGPL package.
16. **What we keep from EEcircuit:**
    - the engine in a Web Worker, started early, with "latest run wins" (plus a visible **Stop**)
    - "why is this disabled" tooltips
    - units next to value fields
    - role-based Playwright locators
    - a versioned autosave
    - a message history next to any toast.

## 7. Build attempt, method and limits

- **Copy and install.** I copied the repo to `<scratch>/research/eecircuit-build/`. `npm ci --ignore-scripts` succeeded: 921 packages in 17 s (`…/eecircuit-work/logs/npm-ci-gen2-next.log`). It left `node_modules/eecircuit-schematic -> ../../EEcircuit-schematic` **dangling**.
- **Why the build cannot work.** The required sibling `../EEcircuit-schematic` is a private repo. npm returns 404 for `eecircuit-schematic`, and GitHub asks for credentials for `eelab-dev/EEcircuit-schematic`. The build cannot resolve it in three places:
  - `vite.config.mts:14-17` aliases the package to `../EEcircuit-schematic/src/main.ts` (missing)
  - `copy_workers.sh:8` needs `node_modules/eecircuit-schematic/dist/`
  - CI checks the private repo out (`build.yml:16-19`).

  Every commit in the clone's history (back to `82f060e`, March 2026) depends on it.
- **The build was not run.** `npm run build` (`vite build && ./copy_workers.sh`) was **blocked by this session's permission policy** as code from an external source. I did not try to get around that. It would have failed anyway for the reason above.
- **The live sites are unreachable.** eecircuit.com, gen1.eecircuit.com, help.eecircuit.com and next.eecircuit.com get proxy CONNECT 403. WebFetch could not resolve help.eecircuit.com or open.ed.ac.uk.
- **Therefore: no screenshots** (`…/research/eecircuit-shots/` is empty), **no axe-core counts** and no observed keyboard walk-through. Section 5 marks what was observed (the Monaco test page, the Svelte compiler lint, the contrast maths) and what was inferred from the code.
- **What would unlock the missing parts:**
  - access to the live site, to screenshot it and run axe against it; or
  - the private `EEcircuit-schematic` source, plus permission to run the repo's build.

  The `gen1` branch (netlist-only) needs no private package, but building it also runs the repository's own build code.

## 8. Evidence files

Under `<scratch>/research/eecircuit-work/`:

- `logs/npm-ci-gen2-next.log`: the install log
- `logs/svelte-a11y-warnings.log`: the compiler lint (`TOTALS {}`, 17 files)
- `logs/monaco-tab-test.json`: the Tab-key test, both variants
- `scripts/svelte_a11y.mjs`, `scripts/build_harness.mjs`, `scripts/monaco_tab_test.cjs`, `scripts/contrast.py`: my scripts
- `harness/` (`subset.js`, `toggle.js`, `common.js`, `*.html`): the test-page source. `subset.js` copies EEcircuit's import list; `toggle.js` adds `features/toggleTabFocusMode/register`.
- `harness-out/`: the bundled test page (monaco-editor 0.56.0 + esbuild 0.28.2, installed in `tools/monaco-harness/`)
- `canary/Bad.svelte`: proves the lint setup reports warnings
- `netlists/*.cir`, `*.log`, `*.raw`: the native ngspice 42 runs:
  - `mega_trap`, `atto_trap`, `placeholders`: unit traps
  - `divider_op.raw`, `divider_tf.raw`: raw-file layout for `.op` and `.tf`
  - `include_ptm`: the missing include
  - `trap_noground`, `trap_isrc_nopath`, `trap_dangling`, `trap_duplicate`, `trap_letter`: beginner traps
- `gen1.git/`: a bare clone of the `gen1` branch (history evidence only)

## Sources (web)

- GitHub search API, run 2026-11-09: `gh api -X GET search/repositories -f q=EEcircuit`, `q=user:eelab-dev`, `q=user:danchitnis`, `q=eecircuit-schematic` (0 results).
- npm registry: `npm view eecircuit-engine` (1.9.0, MIT); `npm view eecircuit-schematic` and `npm view eecircuit` both return 404.
- Web search results (titles and URLs only; the pages could not be fetched from this session):
  - [eelab-dev/EEcircuit on GitHub](https://github.com/eelab-dev/EEcircuit)
  - ["EEsim: a circuit simulator", University of Edinburgh](https://open.ed.ac.uk/?p=7391)
  - [EEcircuit project page](https://danial-website.pages.dev/projects/eecircuit)
  - [WebSpice, which uses EEcircuit's engine](https://github.blesdmm.dns-dynamic.net/jwt625/WebSpice)

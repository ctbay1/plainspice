# 0012. Netlists and links are data, never code

- Status: accepted
- Date: 2026-11-10
- Evidence: the security and robustness review of 10 November 2026 (findings M1 to M5, m1 to m8)

## Context

Every Solved Circuits video will carry "Open this circuit" links, and anyone can make a link that
holds any text (decision 0008). A link is opened with one click, often on a phone, sometimes with
`run=1`. The same netlists also run outside the browser: in the golden tests, the scripts and any
future check of episode netlists in CI.

## Decision

A netlist, whether typed, pasted or opened from a link, is treated as untrusted data:

- **Never HTML.** The netlist goes only into the editor (as text) and the engine (as a file);
  nothing from it or from a link is put into the page as HTML. A Content-Security-Policy on the
  app page (a `<meta>`, since GitHub Pages sets no headers) allows only the site's own scripts,
  WebAssembly compilation and one hashed inline script, as a second line of defence.
- **Never a program.** ngspice's `.control` blocks run, but `system()` refuses in every
  environment (`engine/no-system.js`), so `shell` and `gnuplot` cannot start anything, in the
  browser or under Node.
- **Bounded work.** Links are limited before and after unpacking (32,000 characters, 256 kB of
  text). The app draws at most 50 checks of each severity and underlines at most 200 in the
  editor; no step of parsing, checking or explaining grows with the square of the netlist's
  length any more (a 25,000-line link opens in about a second);
  ngspice's output is kept up to 1 MB per stream; a run stops after 20 s.
- **Never the student's work.** Opening a link or an example shows that circuit without
  replacing the netlist the student saved: the opened circuit is saved, and the link leaves the
  address bar, only when the student edits it.

## Consequences

- A `.control` loop that prints forever runs until the 20 s time-out (with flat memory): an
  earlier stop would need a change inside the engine.
- Styles need `'unsafe-inline'` in the policy (CodeMirror and React Aria set styles), and the
  inline preload script must keep its hash in step: `vite.config.ts` computes it at build time.
- Native ngspice has no such guard: record only netlists you trust with `scripts/record-native.ts`.
- Resolved on 10 November 2026: the site has its own origin, `https://plainspice.com/`, so its
  local storage and the service worker's caches are no longer shared with the account's other
  GitHub Pages sites (the old `ctbay1.github.io` address only forwards).

## After the final reviews (12 November 2026)

- **Characters that are not what they look like** (security review F2). Text copied from a web page
  or a PDF can carry invisible characters, and a phone or another keyboard can type a letter from
  another alphabet that looks like a scale letter. ngspice reads bytes and writes each byte outside
  printable ASCII as `_` (W16), so `1<zero-width space>k` is 1 Ω and `1к` (Cyrillic) is 1 Ω while the
  netlist reads 1k; a node name with an invisible character is another node. The checks
  invisible-character and look-alike-letter (`src/spice/traps.ts`, `src/spice/characters.ts`) flag a
  value only when its reading changes once the invisible characters are removed and the look-alikes
  written as the letters they look like, so `1kΩ`, a Turkish node name or a zero-width space after
  the scale letter is no trap; they say what ngspice reads and offer the plain value ("Write 1k").
  Invisible means U+00AD, U+200B–U+200F, U+202A–U+202E, U+2060–U+2064, U+2066–U+2069 and U+FEFF; the
  look-alikes are the Cyrillic and Greek letters that look like Latin ones, the fullwidth letters and
  digits, a minus sign, dashes and the Kelvin sign (the Greek mu keeps its own check). A node name with
  an invisible character gets a fix that takes it out, which joins it to the node of that name when
  there is one, as was meant, so no fix reads "Rename out to out". The words never show such a
  character: they name it ("a zero-width space (U+200B)"), in the checks and in Explain, and the
  netlist editor shows it as a dot with that name (CodeMirror's highlightSpecialChars, with the set
  above added). ngspice's own messages are quoted with its spelling ("unknown parameter (y__k)").
  What the checks say of each kind was run: letters from other alphabets (look-alike-letter-1), and
  the Kelvin sign, fullwidth digits and full stop, minus signs and dashes (look-alike-letter-3), each
  said in a whole sentence ("The value has a minus sign (U+2212), which looks like -.").
- **Characters that look like a space but are none for SPICE** (critic of the fixes above). Documents
  write a thin or narrow no-break space between a number and its unit (`4.7 kΩ`) and between groups
  of digits (`10 000`); Chinese and Japanese input gives the ideographic space. ngspice splits words
  only at spaces and tabs, so it reads these as part of the word: `4.7<thin space>kΩ` is 4.7 Ω and
  `10<thin space>000` is 10, without a message (space-character-1 to -3; the no-break space does the
  same, nbsp-2). The check space-character covers U+1680, U+2000–U+200A, U+202F, U+205F and U+3000;
  the no-break space U+00A0 keeps its own check, nbsp, which now reads a value the same way. A value
  word is read the way documents write values (`spacedValue` in `src/spice/characters.ts`): a number,
  the space, then a scale letter and a unit, or groups of three digits; a lone a or f after the space
  is a unit (amps, farads), as space-before-suffix reads it. It is flagged only when that differs from
  what ngspice reads (`4.7k<thin space>Ω` is still 4.7 kΩ, space-character-6), with a fix that writes
  the value for SPICE, `4.7k` or `10000`, never just the space taken out, which would turn `2 A` into
  `2A`, 2 attoamps. After a capital M, mega in a document and milli in SPICE, the fixes are
  "Make it 1meg" and "Keep milli: write 1m", as mega-as-milli offers them. Elsewhere on a line such a
  character glues two words into one (space-character-4, nbsp-1): a warning that names it, with the
  fix "Replace it with a normal space". A value that starts with one is an error (space-character-5).
  The words name the character ("a thin space (U+2009)"), in the checks and in Explain, and the
  netlist editor shows it, the no-break space too, as a dot with that name.

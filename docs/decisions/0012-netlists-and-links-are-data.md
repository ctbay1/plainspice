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
  only at ASCII white space (a space, a tab ...), so it reads these as part of the word: `4.7<thin space>kΩ` is 4.7 Ω and
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
- **A capital M that is no M** (critic of the fixes above). A Greek capital Μ (the M key of a Greek
  keyboard), a Cyrillic М or a fullwidth Ｍ looks like M, which is milli in SPICE; a student who types
  one means mega. So for those look-alikes the check offers "Make it 10meg" first for a resistor or a
  gain, and "Keep milli: write 10m", as mega-as-milli does, never "Write 10M", which that check would
  then flag. A small м stays m, milli.
- **A look-alike letter in a node name** (critic of the fixes above). `оut` with a Cyrillic о is the
  node __ut for ngspice, not out (look-alike-letter-5). When a node name is a Latin word with such
  letters in it, the look-alike-letter check names the letter ("The node оut has the Cyrillic letter
  о") and its fix writes the plain letters: "Connect to out" when a node out exists, as the
  invisible-character check does, else "Rename оut to out". A name with no Latin letter (α, Ом) is
  meant as written and stays the non-ascii-node check's, whose fix still gives a plain name (n1); a
  name with a Turkish letter too (çоk) stays that check's, and its fix writes the look-alike plain
  (cok, not ck). An invisible character right after a sign is said where it is, the place first:
  "Right after the -, it has a zero-width space (U+200B)" (invisible-character-6); after the critic of
  round 2, a look-alike there too: "Right after the -, it has the fullwidth digit ５, which looks like 5"
  (look-alike-letter-6), where "which looks like 5 right after the -" read as if the 5 were.
- **Groups of digits with a unit, and no split inside a value** (critic of round 2). Documents write
  `10 000 Ω`, `4 700 Ω` and `1 000 µF` with a thin space before the unit too; ngspice still stops
  reading at the first one, so they are 10 Ω, 4 Ω and 1 F (space-character-7, -8). `spacedValue` now
  reads groups of three digits with a unit after them, or a scale letter on the last group (`1 000k`),
  so the check says "R1's value is read as 10 Ω, not 10 kΩ" and offers "Write 10000 (10 kΩ)". Before,
  such a word fell to the glue check, whose "Replace it with a normal space" made `10 000 Ω` three
  words that stop ngspice (space-character-9), and whose next fix left a 0 Ω resistor. So a part's
  value never gets that fix: a number written some other way (`1<thin space>2`, `0.000<thin space>001`)
  is said as ngspice reads it ("R1's value is read as 1 Ω") when taking the characters out changes
  that, with the fix "Take it out: write 12" (space-character-11). Other words keep the glue check, where
  two words were meant: `PULSE(0<thin space>1 …`, and a part line a word short. On a capacitor or an
  inductor the words now say that ngspice also warns that it can't find a model with the word's name
  (space-character-8), as for the Greek mu. In a node name the character makes another node
  (`o<thin space>ut` is `o___ut`, space-character-10): the check names it ("The node o ut has a thin
  space (U+2009) in it") and, as for an invisible character, its fix takes it out, "Take it out:
  connect to out" when a node out exists, else "Take it out: name the node out"; the dangling-node
  check says nothing about the pair, so no button reads "Rename out to o ut".

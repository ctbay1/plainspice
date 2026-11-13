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

- **The same policy on every page of the site** (security review F3). The engine check, the
  licences page and the design pages (Tarık's three prototypes, the lab, the checkpoint) had no
  policy, though they run on the app's origin, next to the student's saved netlist and settings, and
  the prototypes write HTML with innerHTML (no injection was found: they escape or only test what a
  link gives them). Each now carries the app's policy without the hash of the app page's inline
  script, which only the app page has; their manifest link is still removed. Under it, two small
  symbol fonts of a prototype, which Vite had put into its CSS as data: URLs (it inlines files under
  4 kB), were refused, so fonts are never inlined (`build.assetsInlineLimit` in `vite.config.ts`):
  they are files like every other font, and the policy stays one for the whole site. Checked: every
  page works under it with no policy violation, clicking every button of the prototypes and the
  checkpoint on a computer and a phone (`tests/e2e/words-review.spec.ts` loads each page). Serving
  the design pages from another origin, the review's other option, was not needed.
- **Bounded work now covers the drawing lines too** (security:F1). A 187-character link that
  repeated one short piece of wire 100 times froze the page for 6 s (25 s on a phone slowed four
  times), and a 575-character one with 1999 repeats for minutes: the wire handling of the schematic
  model joined every piece at a point with every other piece there, and cut dead ends one piece per
  pass over the whole drawing. Now its work grows with the drawing lines and the wire they draw,
  both bounded by the format (2000 lines, 20,000 grid units, 20,000 points), never with their
  square; decision 0013 says how. The same links now draw in about 0.4 s on a computer (as fast as
  the circuit without the extra lines) and about 1 s on the slowed phone; the reviewer's patterns at
  the format's limits take 20 to 400 ms to build on a developer's machine (they took seconds to
  minutes). The tests build each pattern at the limits (`tests/unit/schematic-format.test.ts`,
  "limits: wire over wire ..."; `tests/unit/schematic-route.test.ts`, "wire over wire ...") with
  limits about ten times what they take on a developer's machine (1 s at 100 lines, 5 s at the
  limits, 2 s for the long chain), so a busy CI machine passes and the old code still fails.
- **Corrected after the critic of the fix round.** "The worst drawings at the format's limits take
  20 to 400 ms" did not hold. A 31 kB link inside the limits, with no ground symbol, a wire through
  every place one could go, and a 9,900-piece square wave of another node, took about 4 s to build
  and kept a phone slowed four times busy for 27 to 31 s: the search for the ground symbol's place
  checked every point of ground's wire against every wire, and the phone then rebuilt the drawing up
  to four times to find no clean turn. Now that search looks only at the wires near each place and
  tries at most 100 places; the phone does not try to turn a drawing of more than 100 parts or 1000
  pieces of wire (decision 0013); and the wire handling indexes and merges each version of the
  copper once, in flat arrays. That link now draws in 0.9 s on a computer (9.8 s on the release
  reviewed, fix-base) and 3.3 s on the slowed phone. A drawing at the limits like it, with tens of
  thousands of grid points of wire, takes about half a second to build on a developer's machine
  (0.8 s the first time), not milliseconds; turning it takes none. Its test allows 5 s for the build
  and 1 s for the turn (`tests/unit/schematic-format.test.ts`, "builds a drawing with a wire through
  every point of ground's wire ..."). An edit on such a drawing rebuilds it about three times: 0.6 to
  1 s here (0.9 to 1.5 s before this round). Separately, a netlist with thousands of parts still lays
  out slowly.
- **The search is guarded by counting its work, not by timing it** (second critic of the fix round).
  A time limit that allows for a busy machine cannot tell the two searches apart: the first fix's,
  which checked every wire for each point of ground's wire, built that link in about 3.4 s, inside
  5 s. `tests/unit/schematic-ground-search.test.ts` counts the checks of a piece of wire through a
  box while building the link and a control (the same link with the ground symbol and its lead
  given, so nothing is searched): the search may add fewer checks than the drawing has pieces of
  wire (9,951). It adds about 370; the first fix's added 48 million.
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
- **Never a netlist that ngspice would write past the end of a fixed space** (second re-check, P1). A
  title of more than 504 bytes stops `ngspice -b -r` ("buffer overflow detected": it writes
  `Title: ` and the title into 513 bytes), and in a few other places ngspice copies a name into 100
  or 512 bytes without checking (limit-1 to limit-17 in [`../spice-facts/limits.md`](../spice-facts/limits.md)).
  Our engine has no such check: a title of 505 to 523 bytes ran on overwritten memory, a longer one
  crashed it, which Playwright's browser shows as a crashed page; a real Chromium said "the simulation
  engine crashed", and saved work with such a title did that on every visit. The copy ngspice runs
  (`src/spice/run-netlist.ts`) now:
  - cuts line 1, whole (native ngspice reads ` .title …` there as written), and every `.title` line's
    title (a `.title` line counts anywhere, even after `.end`) to its first 504 bytes, between two
    characters; the student's text keeps it, and the ngspice
    output panel says what was cut and why. The numbers are those of a short title (limit-2). A title
    is the one thing a student pastes long: a problem statement.
  - is not run at all when ngspice would write past a space: a word of more than 250 bytes (anything
    between blanks, brackets, commas, `=`, `{ }`, quotes and operators; a part line's first words and
    a `.save` line's words as ngspice takes them whole), a name ngspice makes inside subcircuits of
    more than 250 bytes (a part's `r.x1.x2.r1`, a node's `x1.x2.n1`: it saves currents under them and
    a `.control` block prints them), a formula's `v(…)` or `i(…)` of more than 500 bytes, an analysis
    command of a `.control` block of more than 500 bytes as ngspice writes it (`.op` and its words with
    one blank each; every line of an `*ng_script` file is a command), or a `.model` line's version of
    more than 90 bytes (ngspice copies it into 100, limit-9). The words are measured as ngspice makes
    them: without the blanks inside brackets where it takes them out (`.save i( a b c )` is one name,
    limit-13), with the text a string parameter stands for where `{…}` puts it (limit-14), the names a
    `.probe` line makes and the formula it writes for `p(…)` (limit-15), and the name `print` and `write`
    give a formula, its text (limit-17); a `meas` command's words keep to 50 bytes, as ngspice writes a
    wrong one with its message into 100 (limit-17). A line's comment is cut exactly where ngspice cuts
    it, before these checks, and its words are never read: a `$` glued to a word starts none, so
    `B1 c 0 V=1$+v(b` is a formula with a `v(` and no `)`. The lines of `circbyline` commands, which
    ngspice reads as a netlist, are checked as one, a circuit at each `.end`, once: its title (its first
    line) keeps to 504 bytes, and a `circbyline` command inside it is refused, as ngspice crashes on it
    (limit-12, limit-16). The run fails with the reason, the line and
    what to do: the status line says "ngspice could not run" and why, the Numbers panel and the live
    region too (the path a failed run already had), and nothing reaches ngspice, from the app, the
    checkpoint, the prototypes or the spike page. The alert says a reason once: while the student
    types on in a refused line, each pause fails again with the same reason, which is not said again
    until it changes. 250, not 511: ngspice joins two names in one space when it turns a resistor's
    formula into a B source (`v(n1, n2)`), and a `.control` block's `display` writes about 40 more
    bytes around a name (limit-10); one number for every name, written or made inside subcircuits, is
    simpler to say than one per place. Where ngspice joins more than two (a `.probe` line's formula: a
    part's, a terminal's and a node's name; words in brackets), the word it makes is measured, not the
    names in it. With every name that short, `.options savecurrents` is added
    for every `.op` that runs (decision 0011). No netlist we have comes near: all 147 in the repository
    give the same copy as before.
  - Checked with ngspice 47 built with AddressSanitizer, configured like the engine: every kind of
    word at 600, 5,000 and 20,000 bytes, at the limits and one byte over, each place found by reading
    every fixed-size array of the source that a netlist reaches, and, after a review of the first fix,
    what ngspice does to a line before it copies it (1,154 netlists). Of the 301 copies PlainSpice runs,
    291 give no report and no stop; three are limit-11 (below), five are lines starting with a vertical
    tab, or a byte order mark and a blank, before `.title`, which ngspice refuses and which the
    sanitized build reports as an overlapping `memcpy` at any length (no write past a space), and two
    include a file that crashes native ngspice for no length (`/proc/meminfo`, the netlist itself). Our
    engine crashes on one, again no length: a netlist that includes itself. The limits are below
    ngspice's own (100 and 504 to 511 bytes), so a little room is left for what the search did not try.
  - **Only analysis commands keep to 500 bytes** in a `.control` block, as only they are copied into 512
    (limit-6). The first version of this fix refused every `.control` line over 500 bytes, though
    ngspice runs a long `print`, `echo` or `let` line, and said a reason that was not true; such
    netlists, which ran on b060bc8, run again. The checks of a circuit built with `circbyline` went
    one level deeper for each circuit built inside it, so a 2 kB link took a second of processor time
    at every pause; such a circuit is now checked once, and one inside it refused.
  - **A typo found on the way**: a B source, an E or G source with a formula, or a `.model` line with
    `temper`, whose `v(` or `i(` has no `)` (`B1 c 0 V=v(b`) makes ngspice look for the `)` past the
    end of the line. Native ngspice 47
    and 42 stop ("stack smashing detected") or print bytes they read past it; our engine crashed, so
    typing such a formula with live runs crashed it at every pause. It is not run either: "the v( in this
    formula has no ) after it … Add the )". Only where ngspice reads on (limit-5): in an R, C or L
    formula, an F with `temper`, a `.tf` or `.save` line, ngspice stops with its own message, which the
    student sees as before.
  - **Checks say nothing** about these. A title cut is no mistake: the run gives every number, and the
    output panel says what the copy changed. A refused netlist already says which line and why in the
    status line, the Numbers panel and the live region, and the run copy, not the trap checks, decides
    what ngspice gets: the checks may fail softly (a bug there shows fewer checks), while this must
    hold. If preparing the copy fails (a bug), nothing runs.
  - Not taken: making the engine itself check (a patch to ngspice's C code). It would need the engine
    rebuilt, and native ngspice, which PlainSpice runs like, stops the same way; it is the better fix
    for later, sent upstream.
  - **Still open: what a `.control` block computes while it runs** (limit-11). A `.control` block is a
    small program: `set t = $s$s$s$s$s$s` joins short words into a 600-byte name, and `display` then
    writes it past 512 bytes; `alias xx op` makes `xx` and long words an analysis command of more than
    512 bytes. Native ngspice stops; our engine runs on with its memory overwritten. PlainSpice does
    not run the block's program before ngspice does, so it gives ngspice the block as written. The block
    writes nothing to the results file (A36): PlainSpice shows its words in the ngspice output panel
    only. Not running `.control` blocks at all would close this, but it would change what this record
    allows above ("Never a program": the blocks run, `system()` refuses), so it is Tarık's choice.


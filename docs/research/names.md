# Naming the simulator: candidates and availability

Checked on 9 Nov 2026 from the cloud session. Nothing was registered, created, published or changed. Raw outputs for every check are saved under
`<scratch>/research/names-data/` and the scripts under
`<scratch>/research/names-scripts/` (paths in the last section).

---

## 1. Recommendation (top 3)

### 1. PlainSpice (recommended): repo `ctbay1/plainspice`, URL `ctbay1.github.io/plainspice/`

- **Says what it is and what makes it different:** real SPICE, explained in plain words and plain units ("12 V", not `1.200000e+01`). "Plain words" is already the project's language and Tarık's: the repo's own description says "every netlist line explained in plain words" (`/home/user/circuit-sim/package.json` line 5), and the channel rules say "every symbol is named in plain words when it appears" (`/home/user/solved-circuits/CLAUDE.md` line 43).
- **Cleanest availability of every name checked:** npm `plainspice` E404 and all 5 variants E404, npm scope `@plainspice` "Scope not found", PyPI 404. GitHub: 0 repos named `plainspice`, 0 with both words "plain spice" in the name, 0 users or orgs with that login.
- **No conflicting product found.** Web search for "PlainSpice" turned up only general spice pages and "High Plains Spice Company", a spice shop ([source](https://business.logancountychamber.com/list/member/high-plains-spice-company-4182)).
- **Easy to say in English and Turkish.** It is two common English words, so the channel's English AI voice (ElevenLabs "Chris", `/home/user/solved-circuits/CLAUDE.md` line 3) and screen readers will say it correctly. Turkish EE students already say "spice" from LTspice.
- **Risk:** said on its own, "open it in plain SPICE" can sound like "in ordinary SPICE". To avoid that, always use it as a name next to the link ("Open this circuit in PlainSpice" with the link on screen), and write it in camel case (PlainSpice) so text-to-speech splits it into two words.

### 2. WhySpice: `ctbay1/whyspice`, `ctbay1.github.io/whyspice/`

- **The most memorable, and it is Tarık's own rule:** "a 'why' for every step" (`/home/user/solved-circuits/CLAUDE.md` line 20; README line 46). The trap checks "say why". A Short title already ends in "Why?" (`/home/user/solved-circuits/README.md` line 89: "6, 3 and 2 Ohms Make 4 Ohms Here. Why?").
- **Availability:** npm name, all 5 variants and scope `@whyspice` free; PyPI 404; GitHub has 0 repos named `whyspice`.
- **Caveat:** the GitHub login `whyspice` is taken by an account with no public repos (exact match in `search/users`; it also shows up under `repos:0`). That doesn't matter for `ctbay1/whyspice`, but it rules out a `github.com/whyspice` org.
- **Says "explains" but not "simulator".** It also reads like a question ("Why SPICE?"), which could be a hook or could confuse.

### 3. SpiceTutor: `ctbay1/spicetutor`, `ctbay1.github.io/spicetutor/`

- **The most literal:** a tutor for SPICE, which explains each line and catches your mistakes. That covers both things that make this tool different (explanations and trap checks).
- **Availability:** npm name, variants and scope free; PyPI 404. GitHub has 0 repos named `spicetutor`; 21 have both words in the name, none an exact match, all unrelated (e.g. `data-spice/streamlit_tutorials`). No user or org with that login.
- **Caveats:** it is close to the very common phrase "SPICE tutorial" (e.g. the UPenn "SPICE Tutorials" page, [source](https://www.seas.upenn.edu/~jan/spice/SpiceTutorials.html)), so search engines may bury it. "Tutor" can also suggest an AI or paid tutoring service, and it sounds aimed only at beginners.

**Runner-up: FirstSpice.** Everything is free (npm, scope, PyPI, GitHub), and it fits first-year students, but it says less about what the tool does.

**Best Turkish-rooted option: Devre ("circuit"). Not recommended as the brand:**
- The npm name `devre` is free, but the scope `@devre` is an existing npm account.
- The GitHub login `devre` is a user with repos.
- `devre in:name` matches 4,242 repos, mostly "DevRel".
- It means nothing in English and the English narrator may mispronounce it.
- In Turkish it also means "a set period" and "upside down / the wrong way" ([kureansiklopedi, citing TDK](https://kureansiklopedi.com/tr/detay/devre-a30d8)).
- "Devre simülatörü" products already exist.

A Turkish voice fits better in the Turkish UI and tagline (Tarık to word it) than in the brand name.

### Decide before the first "Open this circuit" link

- GitHub redirects everything after a repo rename **except project-site (Pages) URLs** ([GitHub Docs: Renaming a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository); also the 2013 [announcement](https://github.blog/news-insights/product-news/repository-redirects-are-here)). So `ctbay1.github.io/circuit-sim/` links would break after a rename. Rename `ctbay1/circuit-sim` before any video description links to it. Moving the repo to an org later would change the URL in the same way.
- **The placeholder name has to go anyway.** `circuitsim in:name` matches 384 repos. 18 of the first 30 results are named exactly that, including `ra4king/CircuitSim` (80★) and `hlorenzi/circuitsim` (27★, "Analog circuit simulator"). An org `circuitsim` exists (`circuitsim/circuit-simulator`, 293★).
- **What a rename touches in the repo today** (read-only check):
  - `package.json` line 2 `"name": "circuit-sim"`. The package is `"private": true`, so the npm name is not needed to ship.
  - `package-lock.json` lines 2 and 8.
  - `README.md` line 1.
  - `vite.config.ts` line 63 is `base: './'` (relative), so the build config doesn't need to change.

---

## 2. Full checked table (shortlist: 13 names, plus the placeholder baseline, an org option and one extra)

Legend:
- **E404**: `npm view <name>` answered `npm error code E404 … Not Found`, i.e. unclaimed (confirmed by a raw registry GET returning 404; controls `react`, `spice`, `circuit` return 200).
- **Scope**: `GET https://registry.npmjs.org/-/org/<name>/package`. 404 `{"error":"Scope not found"}` means no npm user or org has that name; 200 means one does (`{}` = an account with no packages).
- **GitHub "user:"**: 422 means no account *or* an account with zero public repos (see method).

### 2a. Availability evidence

| Name | npm `npm view <name>` | npm variants (all checked with `npm view`) | npm scope `@name` | PyPI | GitHub repos `q='<name> in:name'` (total; exact-name; top by ★) | GitHub repos, two words `q='<a> <b> in:name'` | GitHub login `q='<name> in:login'` (exact?) / `q='user:<name>'` |
|---|---|---|---|---|---|---|---|
| **plainspice** | E404 | all E404: plainspice-js, plainspicejs, plain-spice, plain_spice, plain.spice | free (404 Scope not found) | 404 | **0** | **0** | **0 hits** / 422 |
| **whyspice** | E404 | all E404: whyspice-js, whyspicejs, why-spice, why_spice, why.spice | free (404) | 404 | **0** | 1 (unrelated: `hotchaa01/Spice-Up-Every-Bite-Why-…` 0★) | 1 hit, **exact: `whyspice` (User), no public repos** / 422 |
| **spicetutor** | E404 | all E404: spicetutor-js, spicetutorjs, spice-tutor, spice_tutor, spice.tutor | free (404) | 404 | **0** | 21, no exact name (top `data-spice/streamlit_tutorials` 15★) | 0 hits / 422 |
| **firstspice** | E404 | all E404: firstspice-js, firstspicejs, first-spice, first_spice, first.spice | free (404) | 404 | **0** | 10, no exact name (top `derBlume/spiced-first-steps` 1★) | 0 hits / 422 |
| **clearspice** | E404 | all E404: clearspice-js, clearspicejs, clear-spice, clear_spice, clear.spice | free (404) | 404 | **0** | 2, unrelated (`Rzoxs/spicetify-clear-glass`, `Apiwat-Spice/Clearmind-…`) | 0 hits / 422 |
| solvedsim | E404 | all E404 (solvedsim-js, solvedsimjs, solved-sim, solved_sim, solved.sim) | free (404) | – | 1, unrelated (`Uzbek19/solvedsimply.com`) | 342, no exact name; 23 of the first 30 are "solved-…" assignment-answer repos | 0 hits / 422 |
| spicesense | E404 | all E404 (spicesense-js, spicesensejs, spice-sense, spice_sense, spice.sense) | free (404) | – | 5; exact: `matheeshaW/spicesense` (2★, "a spice store and management site"), `Maghathishree/SpiceSense` (recipe assistant), `vimal14092006-a11y/spicesense` (IoT spice rack) | 4; exact: `KryptoniaN10/spice-sense` | 0 hits / 422 |
| mildspice | E404 | all E404 (mildspice-js, mildspicejs, mild-spice, mild_spice, mild.spice) | free (404) | – | 6 (all `mildspice/…`, a student's account) | 1; exact: `unaschneck/mild-spice` | 1 hit, **exact: `mildspice` (User)** / 200 (exists, 6 repos) |
| spicebook | E404 | all E404 (spicebook-js, spicebookjs, spice-book, spice_book, spice.book) | free (404) | – | 4; `spicebook/spicebook-app` ("spicy romantasy scene finder") | 33; exact: `ponyatov/SPICE_book`, `bellahmed987/SPice-book` | 1 hit, **exact: `spicebook` (User)** / 200 (exists) |
| ohmwork | E404 | all E404 (ohmwork-js, ohmworkjs, ohm-work, ohm_work, ohm.work) | free (404) | – | 9; exact: `ShaanGS/ohmwork` (1★, "Turns an electronics-lab open ended question into a circuit file…"), `IamTemmy/ohmwork`, `mooalot/ohmwork` ("Remembering EE"); also `fodedoucara/Ohmworks` ("web-based electronics simulation platform…") | 26; exact: `memoriaXII/ohm-work` | 11 hits, **exact: `OHMWORK` (User)**; also orgs `Ohmwork-org`, `Ohmwork-embedded`, `Ohmwork-Team` / 422 (zero repos) |
| devre | E404 | E404 (devre-js, devrejs) | **TAKEN** (200 `{}`: an npm account with no packages) | 404 | **4,242**; exact: `OmerFarukTutkun/Devre` (23★); top: `devrelcollective/awesome-devrel` 762★, `databricks/devrel` 737★ | n/a | 1,889 hits, **exact: `devre` (User)** / 200 (exists: `devre/workspace`, `devre/Shree365`) |
| devresim | E404 | all E404 (devresim-js, devresimjs, devre-sim, devre_sim, devre.sim) | free (404) | – | 0 | 15; exact: `woahboi19/devre-sim`; also `yigitkasap/devre-simulatoru` ("Tarayıcıda çalışan, Türkçe, eğitsel devre simülatörü", pushed 2026-11-09, Pages site), `feyyaz12koc/devre-simulatoru-updates` (desktop app, homepage devresimulatoru.com) | 0 hits / 422 |
| baharat | E404 | E404 (baharat-js, baharatjs) | free (404) | – | 90; 8 exact-name in the first 30 (e.g. `baharkara/baharat`, `spice-labs-inc/baharat`) | n/a | 40 hits, **exact: `Baharat` (Organization)**, zero repos / 422 |
| *circuitsim (placeholder)* | E404 | all E404, incl. circuit-sim | free (404) | – | **384**; 18 exact-name in the first 30, incl. `ra4king/CircuitSim` 80★, `drifter1/circuitsim` 59★, `hlorenzi/circuitsim` 27★; top `circuitsim/circuit-simulator` 293★ | 3,353 | 6 hits, **exact: `circuitsim` (Organization)** / 200 (exists) |
| *solvedcircuits (org option)* | E404 | all E404 (incl. solved-circuits) | free (404) | – | 0 | 23; only exact is Tarık's own `ctbay1/solved-circuits` | **0 hits** / 422, so it looks free as a GitHub org name |
| *openspice (extra: an obvious suggestion)* | E404 (also open-spice) | – | free (404) | – | 10: `ColsonZhang/CZ_OpenSpice` 33★ ("web版本的SPICE电路仿真平台", a web SPICE platform), `dairong-wu/openspice-playground` ("Web-based SPICE circuit simulator"), `sohampatwardhan/openspice-mcp` | – | **exact: `OpenSPICE` (Organization)**; also `OpenSpiceLab` (Org) |

### 2b. Fit with the criteria (judgement; availability above is evidence)

Marks: ✓ good, ~ mixed, ✗ problem. The list is ranked by number of ✗, then ~.

| Name | Meaning | Says what it does | Say it (EN) | Say it (TR) | Short | Memorable | No confusing overlap | npm | GitHub | URL path | ✗ / ~ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **PlainSpice** | ✓ plain words + SPICE | ✓ | ✓ | ✓ | ~ 10 | ~ | ✓ | ✓ | ✓ | ✓ `/plainspice/` | 0 / 2 |
| **WhySpice** | ✓ a why for every step | ~ (no "simulator") | ✓ | ~ (no /w/ in Turkish) | ✓ 8 | ✓ | ✓ | ✓ | ~ login taken (inactive) | ✓ | 0 / 3 |
| **SpiceTutor** | ~ | ✓ | ✓ | ✓ | ~ 10 | ~ | ~ ("SPICE tutorial") | ✓ | ✓ | ✓ | 0 / 4 |
| FirstSpice | ~ | ~ | ✓ | ✓ | ~ 10 | ~ | ✓ | ✓ | ✓ | ✓ | 0 / 4 |
| ClearSpice | ~ | ~ | ✓ | ✓ | ~ 10 | ✗ bland | ~ ("Clear" is also an editor button) | ✓ | ✓ | ✓ | 1 / 4 |
| SpiceSense | ~ | ~ | ~ (s-s-s) | ~ | ~ | ~ | ✗ food apps | ✓ | ~ 5 repos | ✓ | 1 / 7 |
| SolvedSim | ~ | ✗ (no SPICE, no explaining; "solved" suggests answers) | ✓ | ~ | ~ | ✗ | ~ | ✓ | ✓ | ✓ | 2 / 4 |
| OpenSpice | ~ | ✓ | ✓ | ✓ | ~ | ~ | ✗ web SPICE tools of that name | ✓ | ✗ org taken | ✓ | 2 / 4 |
| MildSpice | ~ | ✗ | ✓ | ~ | ~ | ~ | ~ | ✓ | ✗ login taken (active) | ✓ | 2 / 5 |
| Devre | ~ Turkish only | ~ Turkish only | ✗ English narrator | ✓ | ✓ 5 | ~ | ✗ DevRel noise; "devre simülatörü" products | ~ scope taken | ✗ login taken | ✓ | 3 / 3 |
| Devresim | ~ | ~ | ✗ | ✓ | ~ | ✗ | ✗ reads as "devre sim(ülatörü)"; devresimulatoru.com exists | ✓ | ✓ | ✓ | 3 / 3 |
| OhmWork | ~ | ✗ | ~ (heard as "homework") | ~ | ✓ | ✓ | ✗ EE tools named ohmwork / Ohmworks | ✓ | ✗ login + 3 orgs taken | ✓ | 3 / 3 |
| Spicebook | ~ | ✗ | ✓ | ✓ | ✓ | ~ | ✗ "spicy books" (romance); `spicebook-app` | ✓ | ✗ login taken | ✓ | 3 / 2 |
| Baharat | ~ (Turkish for "spices") | ✗ | ~ | ✓ | ✓ | ~ | ✗ food word | ✓ | ✗ org taken | ✓ | 3 / 3 |
| *CircuitSim* | ~ | ✓ | ✓ | ✓ | ~ | ✗ | ✗ CircuitSim (ra4king), circuitsim org | ✓ | ✗ org taken | ✓ | 3 / 2 |

Every candidate works as a URL path: lowercase ASCII, no spaces or Turkish letters. `ctbay1.github.io` (the user site, repo `ctbay1/ctbay1.github.io`, no custom domain) only uses `/assets`, `/cv` and `/legacy` at the top level, so none of these paths clash (shallow clone, `ls` of the repo root; `sitemap.xml` lists only `https://ctbay1.github.io/`).

---

## 3. Exact evidence for the top three (verbatim excerpts)

**PlainSpice**
```
$ npm view plainspice name version description time.created time.modified maintainers --json
npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/plainspice - Not found
$ curl -sS -o /dev/null -w '%{http_code}' https://registry.npmjs.org/plainspice        -> http=404
(plain-spice, plain_spice, plain.spice, plainspice-js, plainspicejs: same E404 / 404)
$ curl -sS -w ' [%{http_code}]' https://registry.npmjs.org/-/org/plainspice/package
{"error":"Scope not found"} [404]
$ curl -sS -o /dev/null -w '%{http_code}' https://pypi.org/pypi/plainspice/json        -> 404   (control lcapy -> 200)
$ gh api -X GET search/repositories -f q='plainspice in:name' -f per_page=30   -> total_count = 0
$ gh api -X GET search/repositories -f q='plain spice in:name' -f per_page=30  -> total_count = 0
$ gh api -X GET search/users -f q='plainspice in:login' -f per_page=30         -> total_count = 0
$ gh api -X GET search/repositories -f q='user:plainspice' -f per_page=30      -> HTTP 422 "The listed users and repositories cannot be searched either because the resources do not exist or you do not have permission to view them."
$ curl -sS 'https://registry.npmjs.org/-/v1/search?text=plainspice&size=8'      -> total: 0
WebSearch "PlainSpice": no product; only general spice pages and "High Plains Spice Company" (a spice shop).
```

**WhySpice**
```
$ npm view whyspice ... --json
npm error 404 Not Found - GET https://registry.npmjs.org/whyspice - Not found
(why-spice, why_spice, why.spice, whyspice-js, whyspicejs: E404)
$ curl ... https://registry.npmjs.org/-/org/whyspice/package  -> {"error":"Scope not found"} [404]
PyPI whyspice -> 404
$ gh api -X GET search/repositories -f q='whyspice in:name'   -> total_count = 0
$ gh api -X GET search/repositories -f q='why spice in:name'  -> total_count = 1 (hotchaa01/Spice-Up-Every-Bite-Why-Bold-Indian-Inspired-Sauces-…, 0★)
$ gh api -X GET search/users -f q='whyspice in:login'         -> {"items":[{"login":"whyspice","type":"User"}],"total":1}
$ gh api -X GET search/users -f q='whyspice in:login repos:0' -> {"items":[{"html_url":"https://github.com/whyspice","login":"whyspice","type":"User"}],"total":1}
$ gh api -X GET search/repositories -f q='user:whyspice'      -> HTTP 422 (account has no public repos)
npm search text=whyspice -> total: 0.  WebSearch "WhySpice": no product.
```

**SpiceTutor**
```
$ npm view spicetutor ... --json
npm error 404 Not Found - GET https://registry.npmjs.org/spicetutor - Not found
(spice-tutor, spice_tutor, spice.tutor, spicetutor-js, spicetutorjs: E404)
$ curl ... https://registry.npmjs.org/-/org/spicetutor/package -> {"error":"Scope not found"} [404]
PyPI spicetutor -> 404
$ gh api -X GET search/repositories -f q='spicetutor in:name'  -> total_count = 0
$ gh api -X GET search/repositories -f q='spice tutor in:name' -> total_count = 21 (no exact name; top data-spice/streamlit_tutorials 15★)
$ gh api -X GET search/users -f q='spicetutor in:login'        -> total_count = 0
$ gh api -X GET search/repositories -f q='user:spicetutor'     -> HTTP 422
npm search text=spicetutor -> total: 0.  WebSearch "SpiceTutor" OR "Spice Tutor" circuit simulator: no product of that name.
```

Evidence for names that were rejected:
- **splain**: npm `splain` 0.0.1 by sehrgut, created 2013-08-07.
- **milli**: npm `milli` 4.0.0 "Tiny millisecond conversion utility"; scope `@milli` exists.
- **nodewise**: npm `nodewise` 1.0.3 "Node.js error explainer with AI-powered clarity", modified 2026-11-07.
- **voltaj**: scope `@voltaj` exists, with `@voltaj/core`, `@voltaj/worker`, `@voltaj/server` (homepage voltaj.io).
- **akim**: scope `@akim` exists (package `toyyibpay-js-sdk`).
- **devre, spicerack, opencircuit**: scopes exist, each an account with no packages (`{}`).
- **spicerack** on GitHub: 71 repos, incl. `jackrusher/spicerack` (84★, Clojure) and `wikimedia/operations-software-spicerack` (30★).
- **opencircuit**: `OpenCircuits/OpenCircuits` (405★, "A free, open source, online digital circuit/logic designer") and `OpenCircuits/EE` ("An open source circuit designer for analog circuits").

---

## 4. Conflicts with existing circuit and EDA products

- **The top three share only the generic word "SPICE"** with LTspice, ngspice, PSpice, HSPICE and SPICE OPUS. That is normal practice: independent tools all use it. Examples: SpiceSharp ([search result](https://gitee.com/akljh/SpiceSharp)), PySpice (named in `PyLCARS/Python-and-SPICE-Book`'s description), SpiceCircuit (Haka Software, ngspice-based, [source](https://sites.google.com/site/hakasoftapps/spicecircuit)), [SpiceGUI](https://github.com/alimogh/spicegui) and the ngspice-based "SPICE Circuit Simulator" Google Workspace add-on ([source](https://workspace.google.com/marketplace/app/spice_circuit_simulator/988828540824)).
- **None of them reuses a distinctive part of another product's name.** That means no LT / ng / P / H / OPUS / EE- prefix, and no "Circuit", "Every", "Lab", "Sim", "Qucs", "Xyce", "Wokwi", "Tinker", "Part" or "DcLab" element. EEcircuit, CircuitJS/Falstad, EveryCircuit, CircuitLab, Multisim, iCircuit, Qucs, Xyce, KiCad, EasyEDA, Tinkercad, Wokwi, PartSim and DcLab therefore have no overlap with PlainSpice, WhySpice or SpiceTutor.
- **"Spicy" (from the brief):** web search found no product called that, only the ngspice GUIs above, so I could not compare against it. "Plain", "Why" and "Tutor" are not shared with it in any case.
- **"Circuit…" names are crowded:** CircuitSim, `circuitsim/circuit-simulator` and OpenCircuits (section 2), CircuitVerse ([source](https://developers.google.com/season-of-docs/docs/2020/participants/project-circuitverse-pragati?hl=tr)), and the brief's EEcircuit, EveryCircuit, CircuitLab and iCircuit. Avoiding "circuit" in the name avoids the crowd. The Turkish "devre simülatörü" is crowded the same way: a desktop app at devresimulatoru.com, a browser-based Turkish educational simulator (`yigitkasap/devre-simulatoru`) and many student projects.
- **"Spice" has other software meanings:** the SPICE remote-desktop protocol (npm `@spice-project/spice-html5`), Spice AI (`@spiceai/...`) and Spiceworks. These are other fields, so they are background noise in web search, not confusion for EE students.
- **Trademarks:** PSpice (Cadence), HSPICE (Synopsys) and LTspice (Analog Devices) are company product names. Our names don't imitate them. Whether "SPICE" alone is a registered mark was not settled: the web search was inconclusive and the trademark registers were not reachable (section 5). Berkeley's SPICE was distributed as public-domain, then BSD-style, software, and "to SPICE a circuit" is used generically ([Wikipedia: SPICE](https://en.wikipedia.com/wiki/SPICE), [Zuken](https://www.zuken.com/en/blog/get-to-know-your-spices/)).

---

## 5. Method and limits

**npm**
- `npm view <name> name version description time.created time.modified maintainers --json` for each name and each variant: `-js`, `js`, and the two-word forms with `-`, `_` and `.`.
- Plus a raw `GET https://registry.npmjs.org/<name>`, which also catches unpublished names that are still held.
- Variants matter because npm strips punctuation when it compares a new name with existing ones, so `plain-spice` existing would block `plainspice` ([npm blog: New package moniker rules](https://blog.npmjs.org/post/168978377570/new-package-moniker-rules)). Community reports found by web search (not verified one by one; e.g. [npm/cli issues](https://github.com/npm/cli/issues/9134) and [a write-up](https://devactivity.com/insights/unpacking-npm-s-hidden-rules-the-cost-of-undocumented-package-naming-policies-on-developer-productivity/)) say some similarity blocks only show up at publish time. So "E404" means "free today", not a guarantee that a publish will pass. A scoped name (`@scope/name`) avoids that.
- **Scope check:** `GET /-/org/<name>/package`. I validated it first: `vitejs` and the user `sindresorhus` return package lists, the user `tarik` returns `{"edebug":"write"}`, and random names return 404 "Scope not found". Npm users and orgs share this namespace. `ctbay1` is not an npm account (404).
- **Fuzzy search:** `GET /-/v1/search?text=<name>` for near-misses. It returned 0 for plainspice, whyspice, spicetutor, firstspice and clearspice.

**GitHub** (only `gh api -X GET search/...` was used, paced under the 30/min search limit)
- `search/repositories q='<name> in:name'` and, for two-word names, `q='<a> <b> in:name'` (catches `plain-spice`, `Plain_Spice`).
- `search/users q='<name> in:login'`: an exact login match is the evidence that a user or org name is taken.
- `search/repositories q='user:<name>'`: 200 means the account exists. **A 422 is ambiguous:** `whyspice`, `OHMWORK` and `Baharat` returned 422 but appear in `search/users … repos:0` (`names-data/gh/users_repos0.txt`). So 422 means "no account, or an account with no public repos".
- **Limit:** user search may hide suspended or flagged accounts. The definitive check is opening `https://github.com/<name>` (a 404 means free). That page was blocked here (HTTP 403 from the proxy), so it is a 10-second check for Tarık.

**Also checked**
- PyPI JSON API, for the leading names.
- WebSearch, for products and conflicts.
- A shallow clone of `ctbay1/ctbay1.github.io`, for URL path clashes.
- The Solved Circuits docs (read-only), for how the name will be used.

**Not checkable from this session (hosts blocked; single attempts, not retried; `names-data/web/blocked.txt`):**
- github.com profile pages (403).
- Domain RDAP lookups (`rdap.verisign.com`: CONNECT 403; WebFetch: host not allowed).
- Trademark registers (`trademarks.justia.com`: host not allowed).

If Tarık wants trademark-level certainty or a custom domain, these are the 5-minute manual checks:
- USPTO trademark search (tmsearch.uspto.gov), EUIPO TMview (tmdn.org/tmview) and TÜRKPATENT, each for the chosen name in class 9 / 42.
- Whether `<name>.com` / `.app` / `.dev` is free. A custom domain is also GitHub's suggested way to keep URLs stable across renames.

**Turkish word meanings** come from secondary sources that cite TDK:
- "devre": circuit; a set period; upside down / the wrong way ([kureansiklopedi](https://kureansiklopedi.com/tr/detay/devre-a30d8)).
- "gerilim": voltage; also tension or stress ([kureansiklopedi](https://kureansiklopedi.com/tr/detay/gerilim-2)).

The TDK site itself was not opened.

---

## 6. Brainstorm (25 candidates, plus one extra) and why each was kept or dropped

npm first pass: every name was checked with `npm view` plus variants and the scope endpoint (`names-data/npm/summary.tsv`, `scope_unsorted.tsv`).

| # | Name | Style | Meaning | npm name / scope | Shortlisted? |
|---|---|---|---|---|---|
| 1 | plainspice | explain / SPICE | SPICE in plain words | free / free | yes: **#1** |
| 2 | whyspice | explain / SPICE | a "why" for every step | free / free | yes: **#2** |
| 3 | clearspice | explain / SPICE | SPICE made clear | free / free | yes (bland; "Clear" is also an editor button) |
| 4 | spicesense | explain / SPICE | makes sense of SPICE | free / free | yes (food-app overlap on GitHub) |
| 5 | splain | explain / playful | SPICE + "explain" | **taken** (`splain` 0.0.1, 2013) / free | no: taken, and "-splain" now suggests "mansplain" |
| 6 | spicetutor | descriptive | a tutor for SPICE | free / free | yes: **#3** |
| 7 | firstspice | descriptive / beginner | your first SPICE | free / free | yes: runner-up |
| 8 | circuitsim | descriptive | current placeholder | free / free | baseline: crowded (section 2) |
| 9 | solvedsim | channel tie | the Solved Circuits simulator | free / free | yes (says little; "solved" suggests answer dumps) |
| 10 | solvedcircuits | channel brand | possible GitHub org | free / free | org option: login looks free |
| 11 | mildspice | SPICE / playful | SPICE, but mild | free / free | yes (GitHub login taken; undersells) |
| 12 | spicerack | SPICE / playful | a rack of example circuits | free / **@spicerack taken** | no: Spicerack exists (`jackrusher/spicerack` Clojure lib 84★; `wikimedia/operations-software-spicerack` 30★) |
| 13 | spicebook | SPICE / channel look | the notebook page | free / free | yes (rejected: "spicy books" connotation; login taken) |
| 14 | ohmwork | playful | pun on homework | free / free | yes (rejected: EE tools of that name; logins taken) |
| 15 | ohmly | playful | ohm + -ly | free / free | no: says nothing |
| 16 | milli | playful / trap | the "1M is a milliohm" trap | **taken** / **@milli taken** | no |
| 17 | nodewise | playful | wise about nodes | **taken** (Node.js error explainer, updated 2026-11-07) / free | no: taken, and reads as Node.js |
| 18 | devre | Turkish | circuit | free / **@devre taken** | yes: best Turkish-rooted, not recommended |
| 19 | devrem | Turkish | my circuit | free / free | no: possessive is awkward as a brand; same English issues as devre |
| 20 | devresim | Turkish + English | devre + sim | free / free | yes (rejected: reads as generic "devre simülatörü"; devresimulatoru.com exists) |
| 21 | akim | Turkish | akım = current | free / **@akim taken** | no: ASCII drops the dotless ı, so "akim" is a different sound; scope taken |
| 22 | gerilim | Turkish | voltage | free / free | no: also means "tension, stress"; nothing in English |
| 23 | voltaj | Turkish | voltage (everyday) | free / **@voltaj taken** (voltaj.io project) | no |
| 24 | baharat | Turkish / SPICE pun | spices | free / free | yes (rejected: food word; GitHub org taken) |
| 25 | opencircuit | channel tie | "Open this circuit" | free / **@opencircuit taken** | no: an "open circuit" is a broken circuit in every textbook; OpenCircuits 405★ |
| + | openspice | open + SPICE | (obvious suggestion, checked) | free / free | no: CZ_OpenSpice (web SPICE, 33★), openspice-playground, `OpenSPICE` org |

---

## 7. Notes for after the choice

- **Display name and handles:** camel case for the display name (PlainSpice / WhySpice / SpiceTutor) so screen readers and TTS split it. Lowercase single word for the repo and URL (`plainspice`), which is easy to say aloud ("ctbay1 dot github dot io slash plainspice").
- **Video line:** "Open this circuit in PlainSpice" with the link on screen and in the description. Test it once with the channel's voice before the first episode uses it.
- **Turkish UI:** keep the name. Add a Turkish tagline that Tarık words himself.
- **npm:** not needed to ship (`"private": true`). Publish a name only when there is a real package, e.g. the trap checker. `plainspice` and `@plainspice/…` are both free today.
- **If an org is wanted later:** `solvedcircuits` looks free on GitHub and npm. Moving the repo changes the Pages URL, so do it before videos link to it, or put a custom domain in front.

---

## 8. Files

- Report: `<scratch>/research/names.md`
- npm raw outputs, one file per name: `<scratch>/research/names-data/npm/view_<name>.txt`, `raw_<name>.json` and `scope_<name>.txt`.
- npm summaries: `<scratch>/research/names-data/npm/summary.tsv` and `scope_unsorted.tsv`.
- npm fuzzy search: `<scratch>/research/names-data/npm/search_<name>.json`.
- GitHub raw responses: `<scratch>/research/names-data/gh/gh_<name>.json`.
- GitHub summary: `<scratch>/research/names-data/gh/gh_summary_1794254726.json`.
- GitHub extra checks: `<scratch>/research/names-data/gh/users_repos0.txt`, `gh_openspice_repos.json`, `gh_openspice_users.json`, `gh_spicerack.json` and `gh_opencircuits.json`.
- PyPI checks and blocked hosts: `<scratch>/research/names-data/web/pypi.txt` and `blocked.txt`.
- Scripts: `<scratch>/research/names-scripts/` (`candidates.tsv`, `npm_check.sh`, `scope_check.sh`, `gh_check.py`, `make_rows.py`).

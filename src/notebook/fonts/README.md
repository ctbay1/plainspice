# The Notebook's fonts

The fonts the Notebook look ships with the site (decision 0014), copied from the Notebook prototype
(`design/prototypes/notebook/fonts/`). All four families are under the SIL Open Font License 1.1 (the
licence texts are next to this file; the build also copies them into the site's `licenses/`, see
`vite.config.ts`). Each file is a subset (Latin, Latin-1 and the few symbols PlainSpice shows: Ω µ −
→ × …), converted to WOFF2 with fontTools `pyftsubset`. Nothing is loaded from a font service.

| File | Family | Source | Job |
|---|---|---|---|
| `inter-{regular,medium,semibold}.woff2` | Inter 4.0 | Debian `fonts-inter` | everything the app says; results in the plain-font setting |
| `caveat-{500,700}.woff2` | Caveat | the Solved Circuits channel's copy (Google Fonts, via fontsource) | results written by hand on the drawing |
| `jetbrains-mono-{regular,medium,semibold}.woff2` | JetBrains Mono 2.304 | Debian `fonts-jetbrains-mono` | the netlist |
| `notebook-serif-{regular,italic}.woff2` | **Notebook Serif** = CMU Serif (Computer Modern Unicode) | the `computer-modern` npm package 0.1.3 | values on the drawing, like the episodes' LaTeX |

Notebook Serif is a modified (subset) version of CMU Serif by Andrey V. Panov, after Donald Knuth's
Computer Modern. "Computer Modern Unicode fonts" is a Reserved Font Family Name under its licence, so
the subset is renamed, as the OFL asks of modified versions (`OFL-NotebookSerif-CMU.txt`).

The drawing keeps exactly the room its words need from these files' character widths
(`../metrics.ts`, measured by `scripts/notebook-metrics.ts`): after changing a font file, run that
script again.

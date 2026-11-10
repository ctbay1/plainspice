# Fonts of the notebook prototype

All four families are under the SIL Open Font License 1.1 (the licence texts are next to this
file). Each file here is a subset (Latin, Latin-1 and the few symbols PlainSpice shows: Ω µ − → ×
…), converted to WOFF2 with fontTools `pyftsubset`, so the page loads about 400 kB of fonts instead
of several megabytes. Nothing is loaded from a CDN.

| File | Family | Source | Role in the design |
|---|---|---|---|
| `inter-{regular,medium,semibold}.woff2` | Inter 4.0 | Debian `fonts-inter` (/usr/share/fonts/opentype/inter) | everything the app says: toolbar, buttons, panels |
| `caveat-{500,700}.woff2` | Caveat | the Solved Circuits channel's copy (`solved-circuits/fonts/`, from Google Fonts via fontsource) | handwritten notes on the drawing: results, currents, part names, the sticky note |
| `jetbrains-mono-{regular,medium,semibold}.woff2` | JetBrains Mono 2.304 | Debian `fonts-jetbrains-mono` | the netlist (the dark "simulator screen") |
| `notebook-serif-{regular,italic}.woff2` | **Notebook Serif** = CMU Serif (Computer Modern Unicode) | the `computer-modern` npm package 0.1.3 | part values on the drawing ("1 kΩ"), like the LaTeX maths in the episodes |

Notebook Serif is a modified (subset) version of CMU Serif by Andrey V. Panov, after Donald Knuth's
Computer Modern. "Computer Modern Unicode fonts" is a Reserved Font Family Name under its licence,
so the subset is renamed, as the OFL asks of modified versions (`OFL-NotebookSerif-CMU.txt`).

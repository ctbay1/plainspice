# Fonts of the Studio prototype

- **Inter** 4.0 (Regular, Medium, SemiBold) and **Inter Display** 4.0 (SemiBold), by The Inter Project
  Authors: SIL Open Font License 1.1, see `OFL-Inter.txt`.
- **JetBrains Mono** 2.304 (Regular, Medium, SemiBold), by The JetBrains Mono Project Authors:
  SIL Open Font License 1.1, see `OFL-JetBrainsMono.txt`.

Taken from Ubuntu's `fonts-inter` and `fonts-jetbrains-mono` packages and subset to Latin
(with Latin Extended-A for Turkish), punctuation, arrows and the symbols the UI shows (Ω, µ, −, ⌘ ...)
as WOFF2 with fontTools' `pyftsubset`. Nothing is loaded from a CDN.

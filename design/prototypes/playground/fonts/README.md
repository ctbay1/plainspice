# Fonts of the Playground prototype

All four are under the SIL Open Font License 1.1 (the `OFL-*.txt` files here). None of them has a
Reserved Font Name, so the trimmed files below may keep their names. They are served from this
folder; the page loads nothing from a font CDN.

| File | Font | Used for | Source and changes |
| --- | --- | --- | --- |
| `nunito-latin-wght.woff2` | Nunito (variable weight 200–1000) | the interface: buttons, panels, cards | `@fontsource-variable/nunito` 5.3.0, Latin subset, unchanged |
| `shantell-sans-playground.woff2` | Shantell Sans (variable weight 400–800) | the whiteboard: part names, values, the numbers on the circuit, notes | `@fontsource-variable/shantell-sans` 5.3.0, Latin subset (`full` axes); instanced with fontTools 4.68 at Informality 70, Bounce 0, Spacing 0 |
| `recursive-mono-casual.woff2` | Recursive (variable weight 400–700) | the netlist | `@fontsource-variable/recursive` 5.3.0, Latin subset (`full` axes); instanced with fontTools 4.68 at Mono 1, Casual 1, Slant 0, Cursive 0.5 |
| `symbols-inter-medium.woff2`, `symbols-inter-bold.woff2` | Inter Medium and Bold | only Ω, µ, arrows, −, ×, ≈, ≤, ≥, ✓, ✗, which the three fonts above leave out | Ubuntu's `fonts-inter` (Inter 4), subset with fontTools 4.68 |

Copyright lines: Nunito © 2014 The Nunito Project Authors; Shantell Sans © 2022 The Shantell Sans
Project Authors; Recursive © 2019 The Recursive Project Authors; Inter © 2016 The Inter Project
Authors.

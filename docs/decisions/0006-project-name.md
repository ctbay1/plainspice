# 0006. Name: PlainSpice

- Status: accepted (Tarık, 9 Nov 2026)
- Date: 2026-11-09

## Context

The repository started as `ctbay1/circuit-sim`, a placeholder that collides with 384 GitHub
repositories, an existing `circuitsim` organisation (circuit-simulator, 293 stars) and
ra4king/CircuitSim. Every Solved Circuits video will link "Open this circuit" to the tool, and
GitHub does **not** redirect GitHub Pages project URLs after a rename, so the name had to be
settled before the first link.

## Options checked (nothing registered)

Twenty-six candidates were brainstormed (descriptive, "explain", SPICE, playful,
Turkish-rooted) and thirteen checked on npm (the name, punctuation variants and the scope),
PyPI, GitHub (repository names and logins) and a web search for products:

| | npm name, variants, scope | GitHub | Notes |
|---|---|---|---|
| **PlainSpice** | all free | no repo, no account | says what it does: real SPICE in plain words and plain units |
| WhySpice | all free | 0 repos; the login is an empty account | fits "a why for every step" |
| SpiceTutor | all free | free | literal; competes with "SPICE tutorial" in search |
| devre / devresim | `@devre` taken | 4,242 repos (mostly DevRel); "devre simülatörü" products exist | Turkish fits better in the Turkish UI |
| openspice, ohmwork, splain, nodewise | taken or clashing | | |

Trademark registers and domains could not be reached from the research session; they are left
as a five-minute manual check (USPTO, EUIPO, TÜRKPATENT).

## Decision

**PlainSpice**: display name "PlainSpice", repository `ctbay1/plainspice`, site
<https://ctbay1.github.io/plainspice/> (since 10 November 2026: <https://plainspice.com/>, Tarık's domain), npm package name `plainspice` (private for now, nothing
published). Tagline: "Real SPICE, explained in plain words."

## Consequences

- Tarık renamed the repository and turned on GitHub Pages on 9 Nov 2026; links from now on use
  the new URL. If the site ever moves (an organisation, a custom domain), the old links break, so
  any move should happen before the first video links to it, or keep a redirect page.
- The names are protected by `TRADEMARKS.md` and trademark law, not by the MIT licence.

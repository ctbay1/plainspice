# 0008. Share links: the whole circuit in the URL

- Status: accepted
- Date: 2026-11-09
- Format details and examples: [`../share-links.md`](../share-links.md)

## Context

"The whole circuit and its analysis live in the URL (no server)", and every Solved Circuits
video will link "Open this circuit" to the exact netlist from the video. Those links sit in
video descriptions for years, so the format must never break.

## Decision

- The netlist (which includes its analysis lines) goes in the URL's **fragment**:
  `https://plainspice.com/#c=<payload>[&run=1]`. A fragment never reaches the
  server, so nothing is logged, and GitHub Pages serves the same page for every link.
- `payload` starts with a **format letter**: `z` = base64url of the deflate-raw-compressed UTF-8
  netlist (`CompressionStream`), `t` = base64url of the plain UTF-8 netlist (for very short
  netlists or browsers without compression). New formats get new letters; **every released
  format is decoded forever**.
- `run=1` asks the app to simulate as soon as the circuit opens (the channel's links use it).
- Decoding is defensive: size limits before and after inflating (no "zip bombs"), invalid
  input gives a plain-words message instead of an error, and the netlist is only ever put in
  the editor and the engine, never into the page as HTML.
- `scripts/make-link.ts` turns `.cir` files into "Open this circuit" links for video
  descriptions (YouTube allows 5000 characters; typical links are a few hundred).

- **No checksum in format v1.** Copying and clicking a link never changes its characters, so v1
  carries no checksum. A link changed by hand (typed from a screenshot, say) can therefore open
  a slightly different circuit: in a test, about half of all one-character changes to compressed
  fixture links still decoded. If links ever need to be typed, a checksummed format gets new
  format letters (about 6 more characters); v1 links keep opening.

## As built (10 November 2026)

- Opening a link shows its circuit but does not replace the netlist the student saved: the
  opened circuit is saved, and the fragment leaves the address bar, at the student's first edit
  (so a reload before that opens the link again). Examples follow the same rule.
- A `run=1` link opened while a simulation is running waits for that run to end. While the page
  is still loading, a `run=1` link starts downloading the engine at once.
- How hostile links are handled: [decision 0012](0012-netlists-and-links-are-data.md).
- Since 10 November 2026 the site is at `https://plainspice.com/` (Tarık's domain). The first
  links, made for `https://ctbay1.github.io/plainspice/`, keep working: GitHub forwards that
  address to the new one, and a browser keeps the fragment across the forward
  (`tests/unit/share.test.ts` keeps decoding them).

## Consequences

- Links are long but self-contained: they work offline (PWA) and without any server.
- If the site ever moves, the links break (GitHub does not redirect Pages URLs after a rename):
  any move should keep a redirect page that forwards the fragment.

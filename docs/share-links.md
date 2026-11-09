# Share links

A share link holds a whole circuit, so the "Open this circuit" links in Solved Circuits video
descriptions need no server and no account. This page specifies the link format (version 1,
9 November 2026) and the promise that comes with it. The code is `src/share/link.ts`, the tests
are `tests/unit/share.test.ts`, and links for the channel come from `scripts/make-link.ts`.

```text
https://ctbay1.github.io/plainspice/#c=z01JwM0y0UkhUMFMIUyjOLy1KTlVITC7KLy5WSFQwUsjPyFUoSi3OLC7JL-IKM1TIM1QwUDDjCoKyjLj08gu49FLzUrgA&run=1
```

This link opens fixture F1a (a 6 V source across a 2 Ω resistor) and runs it at once.

## The promise: old links keep working

Links go into YouTube descriptions, and those stay up for years. So:

1. **Every link PlainSpice has ever made keeps opening.** The decoder for each format letter
   (`t`, `z`) is never removed and never changed.
2. **A new format gets a new letter.** Old letters keep their meaning. An old copy of PlainSpice
   (for example a cached offline app) that meets a letter it does not know says the link was
   made by a newer PlainSpice and asks the person to reload.
3. **Limits may grow, never shrink**, so a link that opened once opens again.
4. **New parameters may be added.** Decoders ignore parameters they do not know; `c` and `run`
   keep their meaning.
5. **Published links are tests.** `tests/unit/share.test.ts` decodes literal links ("published
   links open forever") and every link on this page. Never edit or remove one; add new ones.
6. **The address must not move** (decision 0006). If it ever does, keep a page at the old
   address that forwards the fragment, for example
   `location.replace('https://new.example/plainspice/' + location.hash)`. The fragment holds the
   whole circuit, so nothing else is needed.

## Format, version 1

```text
<base>#c=<payload>[&run=1]
```

- **`<base>`** is the PlainSpice page. The channel's links use
  `https://ctbay1.github.io/plainspice/`; the app makes links with its own address, so forks,
  local copies and previews work too.
- **The fragment** (everything after `#`) never reaches the server: GitHub Pages does not see or
  log the circuit. It is a list of `key=value` parameters separated by `&`:
  - **`c`** (required): the payload.
  - **`run`** (optional): `run=1` asks the app to simulate as soon as the circuit opens. Any
    other value, or no `run`, only opens the circuit. The channel's links have `run=1`.
  - Any other key is ignored, which keeps it free for later versions.
- **The payload** is one letter that names the format, then base64url data (RFC 4648,
  section 5: `A`–`Z`, `a`–`z`, `0`–`9`, `-` and `_`, with no `=` padding).

| Letter | Data after the letter | The encoder uses it |
|---|---|---|
| `t` | base64url(*text*) | when the browser has no `CompressionStream("deflate-raw")`, or when deflate would make the link longer (tiny netlists) |
| `z` | base64url(deflate-raw(*text*)) | otherwise; every fixture uses `z` |
| any other | reserved for later versions | never |

- ***text*** is the netlist in UTF-8 with `\n` line ends and a final line break: `\r\n` and a
  lone `\r` become `\n`, and a line break is added at the end if there is none. Nothing else
  changes: tabs, a byte order mark and any Unicode (Ω, µ, ç ğ ı İ ö ş ü, emoji) are kept. The
  final line break is how a decoder notices a `t` link that was cut short.
- **deflate-raw** is RFC 1951 data with no zlib or gzip header and no checksum: what
  `CompressionStream("deflate-raw")` makes in browsers and in Node 18 and later. Its end marker is
  how a decoder notices a `z` link that was cut short.
- When both formats give the same length, the encoder picks `z`.

## Limits

| What | Limit | How it is enforced |
|---|---|---|
| The payload (everything after `c=`, letter included) | 32,000 characters | refused before any decoding |
| The text inside (UTF-8) | 256,000 bytes | decoders stop unpacking as soon as the text passes the limit, so a small link cannot unpack to megabytes (a "zip bomb") |

`encodeShare` refuses a circuit over either limit with a `ShareError`, whose message tells the
person in plain words to save the circuit as a file instead. Real links are far smaller: the
fixtures make links of 138 to 193 characters, and a YouTube description holds 5,000.

## Opening a link

`decodeShare(fragment)` never throws. It accepts what links often pick up on the way:

- the fragment with or without its `#`, or a whole link;
- spaces, tabs and line breaks anywhere in the payload (an email program wrapped the link),
  which are removed;
- `%`-escapes (a redirect or a chat app escaped the fragment), which are undone once;
- `=` or `==` padding at the end of the payload;
- parameters in any order; when `c` appears twice, the first one counts.

Anything else gives `{ ok: false, code, reason }`. The `reason` is in plain words; the sentences
are in `SHARE_TEXT`, ready for translation.

| `code` | When | `reason` |
|---|---|---|
| `no-circuit` | the fragment has no `c=` at all, e.g. `#main` from a skip link. This is not a share link, so the app should say nothing. | This link has no circuit in it. |
| `cut-short` | an empty payload; a payload of 4n+1 characters, a length base64 cannot have; text without its final line break | This link looks cut short: the end of the circuit is missing. Copy the whole link and open it again. |
| `bad-characters` | a character outside base64url in the payload | This link is damaged: it has characters that PlainSpice links never use. Copy the whole link and open it again. |
| `damaged` | data that is not valid deflate, deflate data cut short, or (in browsers) bytes after its end | This link is damaged or cut short, so PlainSpice cannot unpack the circuit in it. Copy the whole link and open it again. |
| `not-text` | data that is not valid UTF-8 | This link is damaged: the circuit in it is not readable text. Copy the whole link and open it again. |
| `too-long` | a payload over 32,000 characters | This link is too long to open: the part after "c=" has more than 32,000 characters. |
| `too-big` | text over 256,000 bytes (unpacking stopped there) | The circuit in this link is too big to open: it unpacks to more than 256 kB of text. |
| `newer-version` | a format letter other than `t` or `z` | This link was made by a newer version of PlainSpice, or it is damaged. Reload the page to get the newest PlainSpice, then open the link again. |
| `unsupported` | a `z` link in a browser without `DecompressionStream("deflate-raw")` | This browser cannot unpack PlainSpice links. Open the link in an up-to-date browser. |

Examples, as fragments: `#c=tKiB0Ci5lbmQK` opens the two-line netlist `* t` and `.end` (a tiny
netlist, so plain text is shorter); `#c=xKiB4Cg` gives `newer-version`; `#c=tKiB0Ci5lbm` (the
same link cut short) gives `cut-short`; `#main` gives `no-circuit`.

## Sizes

What deflate saves on the fixtures (`tests/fixtures/`), as measured by `scripts/make-link.ts`:

| Fixture | Netlist | "t" payload | "z" payload | Shorter by | Link with `&run=1` |
|---|---:|---:|---:|---:|---:|
| `d1-dc-divider-sweep.cir` | 107 bytes | 144 | 125 | 13 % | 170 |
| `f1a-voltage-source.cir` | 73 bytes | 99 | 93 | 6 % | 138 |
| `f1b-voltage-source-swapped.cir` | 83 bytes | 112 | 107 | 4 % | 152 |
| `f2a-current-source.cir` | 79 bytes | 107 | 103 | 4 % | 148 |
| `f2b-current-source-swapped.cir` | 91 bytes | 123 | 112 | 9 % | 157 |
| `f3a-1M-trap.cir` | 97 bytes | 131 | 116 | 11 % | 161 |
| `f3b-1meg.cir` | 86 bytes | 116 | 101 | 13 % | 146 |
| `f4-tf-output-impedance.cir` | 97 bytes | 131 | 119 | 9 % | 164 |
| `f5-thevenin-cccs.cir` | 134 bytes | 180 | 148 | 18 % | 193 |
| `t1-tran-rc-charge.cir` | 122 bytes | 164 | 141 | 14 % | 186 |

All ten links together: 1,615 characters; a YouTube description holds 5,000.

## The fixtures as links

Made by `node --experimental-strip-types scripts/make-link.ts tests/fixtures/*.cir`. Each one
opens its fixture and runs it.

- `d1-dc-divider-sweep.cir`:
  <https://ctbay1.github.io/plainspice/#c=zHcsxDoMwDEDR3af4Y-kQ2Rk79wQM2SucigiVVCGU66OyveXdeRq3urdtePDCy694bmxH_nberX5QesUiiaP0meCTJKOsKCrjpbp3bJExXlLiIsEnkqH_aRLy6nIC&run=1>
- `f1a-voltage-source.cir`:
  <https://ctbay1.github.io/plainspice/#c=z01JwM0y0UkhUMFMIUyjOLy1KTlVITC7KLy5WSFQwUsjPyFUoSi3OLC7JL-IKM1TIM1QwUDDjCoKyjLj08gu49FLzUrgA&run=1>
- `f1b-voltage-source-swapped.cir`:
  <https://ctbay1.github.io/plainspice/#c=zFcUhDoAwDAVQ31N8jVhWBIIDcAAEHliTTdAta8muT3jmTdj4WuFZYOcjsPr2WzB6cRfFKJ5R3KA1icHG2ZokOhgRylho5_-ImUJtFEQTfQ&run=1>
- `f2a-current-source.cir`:
  <https://ctbay1.github.io/plainspice/#c=zFcUxDoAgDAXQvaf4swMBYXJzMXH1BgSayGBrCtzf-Ja34FjzhoyIHWWasQx0nVYYTYYiI0HvB8a99aFGZ4CHBES6wr9HIqcvOZZKHw&run=1>
- `f2b-current-source-swapped.cir`:
  <https://ctbay1.github.io/plainspice/#c=zLcYxDoAgDAXQvaf4swMRdfIAJq7eQKEJDBZCS7i-i296E47l2WGJoffLCL01FoOW3gJjtGzGgpEtIZtCSmSFjrtWjnR6iMeMla5_G7lSybFE-gA&run=1>
- `f3a-1M-trap.cir`:
  <https://ctbay1.github.io/plainspice/#c=zJci9CoAgFIbh_VzFN1aEeAwauoA2F4d2IUnBn0jvn7C2530n7Ivd0LwDa7TH3hg0QkUKMYYZtcBwb_5P8Wmkg5EZEiuZT1mBNRnVIcHJXSTKTcLlk14&run=1>
- `f3b-1meg.cir`:
  <https://ctbay1.github.io/plainspice/#c=z01JwM06yUggyVCgvyiwpSc1TSCxWMMxNTVfQyM9LVchNTU_Mz8jV5AozVMgzVDBQMOMKArPyjMCquIKMQEwDCEcvv4BLLzUvhQsA&run=1>
- `f4-tf-output-impedance.cir`:
  <https://ctbay1.github.io/plainspice/#c=z01JwM7FSyC8tKSgtUcjMLUhNScxLTlVILFEo00jUVCjPLMlQ0CtJ4wozVChWMFAwMuEKArHyDBXMuIKMQLSBgjFXkDGIlahgxKVXkgbRGWbIpZeal8IFAA&run=1>
- `f5-thevenin-cccs.cir`:
  <https://ctbay1.github.io/plainspice/#c=zPcixCsIwFIXh_T7FGdWhJEEXH6DgWqR7aA4kgzeludY8vtTB6eP_Lxhvdzwzd2pRbGylWdSF-BTLiEhcqYlqaPW9LcTJ2P7xouWazvL4TYcIL3NHRIeTKaBDPYJM_tDhKuOBeswdQYa6ykBN8gU&run=1>
- `t1-tran-rc-charge.cir`:
  <https://ctbay1.github.io/plainspice/#c=zHYu7CoRAEATz-YoO9RDZOTAxFTMD8R75sic6iCPs7eDviwsdFFT1A29GcVj8ly28YuoQJAaThLD6uIguFU5JK-oUvdKXIQqH8TO8-sKhgQNbHp4lTVkflsAbdZzpDii_wc7Q7FTP-qML&run=1>

## Making links for a video

```sh
node --experimental-strip-types scripts/make-link.ts circuit1.cir circuit2.cir circuit3.cir
```

- It prints one link per file on stdout, in the order given, and nothing else, so the output can
  be pasted straight into a description. On stderr it prints each link's length and the total
  against YouTube's 5,000-character description limit.
- `--no-run` makes links that only open the circuit. `--base URL` makes links for another
  PlainSpice page, for example `--base http://localhost:5173/` to try a link on the dev server.
- Every link is decoded again before it is printed, so a printed link is known to open its file.
  A file that is not UTF-8 (for example one saved as Windows-1254) is refused, not linked with
  broken letters. Exit code 0 means every link was made, 1 that a file failed, 2 wrong arguments.
- Not checked yet: what YouTube does with these links. Before the first real video, put one link
  in an unlisted video's description and click it, on a computer and on a phone.

## In the app

```ts
import { decodeShare, encodeShare, ShareError, shareUrl } from './share/link.ts';

// Opening: at start-up and on every 'hashchange' (pasting a new link changes only the hash).
const shared = await decodeShare(location.hash);
if (shared.ok) {
  loadIntoEditor(shared.netlist); // untrusted text: show it as text, never as HTML
  if (shared.run) simulate(); // runs in the engine Worker, with its time limit
} else if (shared.code !== 'no-circuit') {
  showProblem(shared.reason); // e.g. in a live region; keep the circuit that was open
}

// "Copy link"
try {
  await navigator.clipboard.writeText(shareUrl(location.href, await encodeShare(editorText())));
} catch (e) {
  if (e instanceof ShareError) showProblem(e.message);
  else throw e;
}
```

## Known limits of version 1

- **No checksum.** A link that was cut short is caught: every cut-short version of every
  fixture's `z` link is refused (1,155 cuts, checked in Node and in Chromium), and a `t` link is
  refused unless the cut falls exactly after a line break (then it opens the whole lines before
  the cut). A changed character is not always caught: of 72,765 one-character changes to the
  fixtures' `z` payloads, 49.6 % still decoded to a different netlist that passes every check
  (measured with Node's zlib set to refuse what browsers refuse). For a `t` link almost every
  change gets through. Copying a link never changes its characters, so this matters only for
  links that are typed by hand or read from a picture. A later format could add a CRC-32, about
  6 more characters per link; it would get a new letter, and `t` and `z` links would still open.
- **Bytes after the end of the deflate data** make Chromium refuse the link (`damaged`), while
  Node ignores them. Either way, the circuit that opens is never a different one.
- **A link without `&run=1` can end in `_`**, and some sites leave a final `_` out of the link
  they make (GitHub's Markdown autolinks drop it). Such a link then fails with a plain reason; it
  never opens a different circuit. Links with `&run=1` end in `1`.
- **Browsers**: checked in Chromium 153 and Node 22.23 (round trips, every cut-short link, the
  zip bomb, and links made in one opening in the other; the two make byte-identical links). Not
  checked in Firefox or Safari yet. A browser needs `DecompressionStream("deflate-raw")` to open
  `z` links; without it, the person sees the `unsupported` reason.

## Version history

| Version | Date | What |
|---|---|---|
| 1 | 9 November 2026 | format letters `t` and `z`; parameters `c` and `run`; limits of 32,000 characters and 256,000 bytes |

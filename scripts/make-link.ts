/**
 * Make "Open this circuit" links for the channel: one link per netlist file.
 *
 *   node --experimental-strip-types scripts/make-link.ts file.cir [more.cir ...] [--base URL] [--no-run]
 *
 * stdout: one link per file, in the order given, and nothing else, so it can be pasted or piped.
 * stderr: each link's length, and the total against YouTube's 5,000-character description limit.
 *
 * A link simulates as soon as it opens (run=1) unless --no-run is given. Every link is opened
 * again with decodeShare before it is printed, so a printed link is known to give back its file
 * (with "\n" line ends and a final line break). The link format is docs/share-links.md.
 *
 * Exit codes: 0 every link was made, 1 a file could not be read or linked, 2 wrong arguments.
 */
import { readFileSync } from 'node:fs';
import { decodeShare, encodeShare, normaliseNetlist, shareUrl } from '../src/share/link.ts';

const DEFAULT_BASE = 'https://ctbay1.github.io/plainspice/';
const YOUTUBE_DESCRIPTION_LIMIT = 5000;

const USAGE = `Usage: node --experimental-strip-types scripts/make-link.ts file.cir [more.cir ...] [--base URL] [--no-run]

Prints one "Open this circuit" link per file, on stdout.
  --base URL   the PlainSpice page the links open (default: ${DEFAULT_BASE})
  --no-run     the link only opens the circuit; by default it also runs it at once
`;

function usageError(message: string): never {
  process.stderr.write(`make-link: ${message}\n\n${USAGE}`);
  process.exit(2);
}

const files: string[] = [];
let base = DEFAULT_BASE;
let run = true;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]!;
  if (arg === '--help' || arg === '-h') {
    process.stdout.write(USAGE);
    process.exit(0);
  } else if (arg === '--no-run') {
    run = false;
  } else if (arg === '--base') {
    const value = args[i + 1];
    if (value === undefined) usageError('--base needs a URL');
    base = value;
    i += 1;
  } else if (arg.startsWith('--base=')) {
    base = arg.slice('--base='.length);
  } else if (arg === '--') {
    files.push(...args.slice(i + 1));
    break;
  } else if (arg.startsWith('-')) {
    usageError(`unknown option ${arg}`);
  } else {
    files.push(arg);
  }
}
if (files.length === 0) usageError('give at least one netlist file');

let protocol: string;
try {
  protocol = new URL(base).protocol;
} catch {
  usageError(`--base must be a whole URL, like ${DEFAULT_BASE} (got "${base}")`);
}
if (protocol !== 'https:' && protocol !== 'http:') usageError(`--base must start with https:// or http:// (got "${base}")`);

let failures = 0;
let total = 0;
let made = 0;
for (const file of files) {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(file);
  } catch (e) {
    failures += 1;
    process.stderr.write(`${file}: cannot read it (${(e as NodeJS.ErrnoException).code ?? String(e)})\n`);
    continue;
  }
  let netlist: string;
  try {
    // fatal: a netlist saved in another encoding (Windows-1254, Latin-1) is reported, not
    // turned into U+FFFD characters in a published link. A UTF-8 byte order mark is dropped.
    netlist = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    failures += 1;
    process.stderr.write(`${file}: not UTF-8 text; save it as UTF-8 and try again\n`);
    continue;
  }
  let url: string;
  try {
    url = shareUrl(base, await encodeShare(netlist, { run }));
  } catch (e) {
    failures += 1;
    process.stderr.write(`${file}: ${e instanceof Error ? e.message : String(e)}\n`);
    continue;
  }
  const back = await decodeShare(url);
  if (!back.ok || back.netlist !== normaliseNetlist(netlist) || back.run !== run) {
    failures += 1;
    process.stderr.write(`${file}: the link did not open again as the same circuit; not printed (${back.ok ? 'text differs' : back.reason})\n`);
    continue;
  }
  const payload = /[#&]c=([^&]*)/.exec(url)?.[1] ?? '';
  const kind = payload.startsWith('z') ? 'compressed' : 'plain text';
  process.stdout.write(`${url}\n`);
  process.stderr.write(`${file}: ${url.length} characters (${kind}, ${bytes.length} bytes of netlist)\n`);
  total += url.length;
  made += 1;
}

if (made > 0) {
  process.stderr.write(
    `${made} ${made === 1 ? 'link' : 'links'}, ${total.toLocaleString('en-US')} characters in all; ` +
      `a YouTube description holds up to ${YOUTUBE_DESCRIPTION_LIMIT.toLocaleString('en-US')}.\n`,
  );
  if (total > YOUTUBE_DESCRIPTION_LIMIT) {
    process.stderr.write('Warning: these links alone are longer than a YouTube description.\n');
  }
}
process.exit(failures > 0 ? 1 : 0);

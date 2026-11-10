/**
 * Share links: the whole circuit lives in the link, after the "#".
 *
 *   https://plainspice.com/#c=<payload>&run=1
 *
 * docs/share-links.md is the full specification. The reasons for its shape:
 *
 * - The part after "#" (the fragment) never reaches the server, so a link needs no server and
 *   the circuit stays out of server logs.
 * - Links go into YouTube descriptions and must open for years. The payload's first letter
 *   names its format, and every format ever shipped is decoded forever. A letter this file
 *   does not know means the link was made by a newer PlainSpice (or is damaged).
 *     t  base64url(UTF-8 netlist)
 *     z  base64url(deflate-raw(UTF-8 netlist))   RFC 1951 with no header: usually shorter
 * - The netlist in a link has "\n" line ends and ends with a line break. Deflate notices a
 *   "z" link that was cut short; for a "t" link, the missing final line break is the sign.
 * - Decoding never throws and never trusts the link: the payload and the unpacked text have
 *   size limits, and inflating stops as soon as the text passes its limit (no zip bombs).
 *
 * Plain TypeScript, no DOM: CompressionStream, TextEncoder and ReadableStream exist in every
 * current browser, in Web Workers and in Node 18+, so scripts/make-link.ts uses this file too.
 */

/** The longest payload (everything after "c=", format letter included) we make or open. */
export const MAX_PAYLOAD_LENGTH = 32_000;

/** The most netlist text (UTF-8 bytes) a link may carry. Inflating stops past this. */
export const MAX_NETLIST_BYTES = 256_000;

/**
 * Every sentence this module shows to people, in one object so it can be translated (the
 * Turkish UI comes later). Plain words a first-year student can follow.
 */
export const SHARE_TEXT = {
  noCircuit: 'This link has no circuit in it.',
  cutShort:
    'This link looks cut short: the end of the circuit is missing. Copy the whole link and open it again.',
  badCharacters:
    'This link is damaged: it has characters that PlainSpice links never use. Copy the whole link and open it again.',
  damaged:
    'This link is damaged or cut short, so PlainSpice cannot unpack the circuit in it. Copy the whole link and open it again.',
  notText:
    'This link is damaged: the circuit in it is not readable text. Copy the whole link and open it again.',
  tooLong: (maxCharacters: number): string =>
    `This link is too long to open: the part after "c=" has more than ${maxCharacters.toLocaleString('en-US')} characters.`,
  tooBig: (maxKilobytes: number): string =>
    `The circuit in this link is too big to open: it unpacks to more than ${maxKilobytes} kB of text.`,
  // A plain reload keeps the version the service worker has (security review m3): the app asks the
  // service worker to look for a newer one instead, and its "new version" banner has the reload.
  newerVersion:
    'This link was made by a newer version of PlainSpice, or it is damaged. PlainSpice looks for its newest version now: if it then says a new version is ready, choose Reload and open the link again.',
  unsupported: 'This browser cannot unpack PlainSpice links. Open the link in an up-to-date browser.',
  netlistTooBig: (maxKilobytes: number): string =>
    `This circuit is too big for a link: a link holds up to ${maxKilobytes} kB of text. Save it as a file instead.`,
  linkTooLong: (maxCharacters: number): string =>
    `This circuit makes a link longer than ${maxCharacters.toLocaleString('en-US')} characters, which is too long to open. Save it as a file instead.`,
};

/**
 * Why a link could not be opened (the same thing as `reason`, for code).
 * 'no-circuit' means the fragment has no "c=" at all, e.g. "#main" from a skip link: not a
 * share link, so the app can stay quiet. Every other code is a share link that failed.
 */
export type ShareProblem =
  | 'no-circuit'
  | 'cut-short'
  | 'bad-characters'
  | 'damaged'
  | 'not-text'
  | 'too-long'
  | 'too-big'
  | 'newer-version'
  | 'unsupported';

export type DecodedShare =
  | { ok: true; netlist: string; run: boolean }
  | { ok: false; code: ShareProblem; reason: string };

/** Thrown (as a rejected promise) by encodeShare when a circuit cannot fit in a link. `message` is plain words. */
export class ShareError extends Error {
  override name = 'ShareError';
  readonly code: 'too-big' | 'too-long';

  constructor(code: 'too-big' | 'too-long', message: string) {
    super(message);
    this.code = code;
  }
}

/** What a link carries: "\n" line ends (from "\r\n" or a lone "\r") and a final line break. */
export function normaliseNetlist(netlist: string): string {
  const text = netlist.replace(/\r\n?/g, '\n');
  return text.endsWith('\n') ? text : `${text}\n`;
}

/**
 * The fragment for a netlist, without the "#": "c=z...", or "c=z...&run=1" when `run` is set
 * (the app then simulates as soon as the circuit opens; the channel's links do this).
 * Rejects with a ShareError when the circuit is too big for a link.
 */
export async function encodeShare(netlist: string, opts: { run?: boolean } = {}): Promise<string> {
  const bytes = new TextEncoder().encode(normaliseNetlist(netlist));
  if (bytes.length > MAX_NETLIST_BYTES) {
    throw new ShareError('too-big', SHARE_TEXT.netlistTooBig(MAX_NETLIST_BYTES / 1000));
  }
  const packed = await deflateRaw(bytes);
  // Deflate wins on every real netlist we have measured; a tiny netlist can come out longer,
  // and then plain text is the shorter link. Ties go to "z", whose ending deflate checks itself.
  const payload =
    packed !== undefined && base64urlLength(packed.length) <= base64urlLength(bytes.length)
      ? `z${toBase64url(packed)}`
      : `t${toBase64url(bytes)}`;
  if (payload.length > MAX_PAYLOAD_LENGTH) {
    throw new ShareError('too-long', SHARE_TEXT.linkTooLong(MAX_PAYLOAD_LENGTH));
  }
  return `c=${payload}${opts.run ? '&run=1' : ''}`;
}

/** The full link: `base` without any "#..." of its own, then "#" and the fragment. */
export function shareUrl(base: string, fragment: string): string {
  const hash = base.indexOf('#');
  return `${hash < 0 ? base : base.slice(0, hash)}#${fragment.replace(/^#/, '')}`;
}

/**
 * Open a share link. Takes the fragment with or without its "#" (location.hash works), or a
 * whole link. Never throws: a link that cannot be opened gives { ok: false, code, reason }.
 * The netlist comes back with "\n" line ends and a final line break.
 */
export async function decodeShare(fragment: string): Promise<DecodedShare> {
  try {
    return await decode(fragment);
  } catch {
    // Nothing in decode() should throw. This is the last guard: a link must never break the
    // page that opens it.
    return fail('damaged');
  }
}

// ------------------------------------------------------------------ decoding

async function decode(fragment: string): Promise<DecodedShare> {
  const params = readParams(String(fragment));
  const raw = params.get('c');
  if (raw === undefined) return fail('no-circuit');
  // A link that an email or chat app wrapped onto two lines can come back with spaces or line
  // breaks in it. The payload alphabet has none, so they are dropped. (The length is checked
  // first, so a huge fragment is never scanned.)
  if (raw.length > 2 * MAX_PAYLOAD_LENGTH) return fail('too-long');
  const payload = raw.replace(/[\t\n\f\r ]+/g, '');
  if (payload.length === 0) return fail('cut-short');
  if (payload.length > MAX_PAYLOAD_LENGTH) return fail('too-long');

  const format = payload[0];
  // Padding is optional in base64url (RFC 4648, section 5); our links never have it.
  const body = payload.slice(1).replace(/={1,2}$/, '');
  if (format !== 't' && format !== 'z') {
    return /^[A-Za-z0-9_-]$/.test(format ?? '') ? fail('newer-version') : fail('bad-characters');
  }
  if (!/^[A-Za-z0-9_-]*$/.test(body)) return fail('bad-characters');
  // 4n+1 characters cannot be base64: a character is missing, most likely at the end.
  if (body.length % 4 === 1) return fail('cut-short');
  const bytes = fromBase64url(body);

  let textBytes: Uint8Array;
  if (format === 't') {
    if (bytes.length > MAX_NETLIST_BYTES) return fail('too-big');
    textBytes = bytes;
  } else {
    const inflated = await inflateRaw(bytes, MAX_NETLIST_BYTES);
    if (typeof inflated === 'string') return fail(inflated);
    textBytes = inflated;
  }

  let text: string;
  try {
    // fatal: invalid UTF-8 is an error, not a silent U+FFFD. ignoreBOM: keep a leading
    // U+FEFF if the netlist had one, so the link gives back exactly what went in.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(textBytes);
  } catch {
    return fail('not-text');
  }
  text = text.replace(/\r\n?/g, '\n');
  if (!text.endsWith('\n')) return fail('cut-short');
  return { ok: true, netlist: text, run: params.get('run') === '1' };
}

function fail(code: ShareProblem): DecodedShare {
  const reasons: Record<ShareProblem, string> = {
    'no-circuit': SHARE_TEXT.noCircuit,
    'cut-short': SHARE_TEXT.cutShort,
    'bad-characters': SHARE_TEXT.badCharacters,
    damaged: SHARE_TEXT.damaged,
    'not-text': SHARE_TEXT.notText,
    'too-long': SHARE_TEXT.tooLong(MAX_PAYLOAD_LENGTH),
    'too-big': SHARE_TEXT.tooBig(MAX_NETLIST_BYTES / 1000),
    'newer-version': SHARE_TEXT.newerVersion,
    unsupported: SHARE_TEXT.unsupported,
  };
  return { ok: false, code, reason: reasons[code] };
}

/** "c=z..&run=1" -> Map { c, run }. The first value of a key wins; keys we don't know are kept and ignored. */
function readParams(input: string): Map<string, string> {
  let s = input;
  const hash = s.indexOf('#');
  if (hash >= 0) s = s.slice(hash + 1);
  // Our keys, values and payload alphabet never need %-escapes, so a "%" means something
  // escaped the link on its way (a redirect, a chat app). Undo that once.
  if (s.includes('%')) {
    try {
      s = decodeURIComponent(s);
    } catch {
      // A broken escape: keep the text as it is; the payload check reports bad characters.
    }
  }
  const params = new Map<string, string>();
  for (const part of s.split('&')) {
    const eq = part.indexOf('=');
    const key = (eq < 0 ? part : part.slice(0, eq)).trim();
    if (key !== '' && !params.has(key)) params.set(key, eq < 0 ? '' : part.slice(eq + 1));
  }
  return params;
}

// ------------------------------------------------------------------ deflate-raw (RFC 1951)

/**
 * Compressed input is fed to the DecompressionStream in slices this big, so one step can
 * unpack at most about 0.5 MB (deflate expands at most 1032 times) before our reader sees it
 * and can stop.
 */
const INFLATE_SLICE_BYTES = 512;

/** deflate-raw with the platform's CompressionStream; undefined when it is missing or fails (the link then uses "t"). */
async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | undefined> {
  try {
    const stream = new CompressionStream('deflate-raw');
    const result = await readAll(slices(bytes, Math.max(bytes.length, 1)).pipeThrough(stream), Number.POSITIVE_INFINITY);
    return typeof result === 'string' ? undefined : result;
  } catch {
    return undefined;
  }
}

/** Inflate at most `limit` bytes. Stops early (no zip bombs) and never throws. */
async function inflateRaw(
  bytes: Uint8Array<ArrayBuffer>,
  limit: number,
): Promise<Uint8Array<ArrayBuffer> | 'too-big' | 'damaged' | 'unsupported'> {
  let stream: DecompressionStream;
  try {
    stream = new DecompressionStream('deflate-raw');
  } catch {
    // No DecompressionStream at all (ReferenceError), or no "deflate-raw" (TypeError).
    return 'unsupported';
  }
  try {
    return await readAll(slices(bytes, INFLATE_SLICE_BYTES).pipeThrough(stream), limit);
  } catch {
    // Not valid deflate data, cut short, or (in browsers) extra bytes after its end.
    return 'damaged';
  }
}

/** A stream that hands out `bytes` one slice at a time, only when the reader asks for more. */
function slices(bytes: Uint8Array<ArrayBuffer>, size: number): ReadableStream<Uint8Array<ArrayBuffer>> {
  let at = 0;
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
}

/** Read a byte stream to the end, or stop and cancel it once it passes `limit` bytes. */
async function readAll(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array<ArrayBuffer> | 'too-big'> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      // Cancelling tears the pipe down, so the decompressor stops too. Not awaited: a
      // misbehaving stream must not be able to hang the page.
      reader.cancel().catch(() => undefined);
      return 'too-big';
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

// ------------------------------------------------------------------ base64url (RFC 4648, section 5), no padding

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const VALUE_OF = new Map<string, number>([...ALPHABET].map((c, i) => [c, i]));

/** Characters needed for n bytes (no padding). */
function base64urlLength(n: number): number {
  return Math.ceil((n * 4) / 3);
}

function toBase64url(bytes: Uint8Array): string {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    const left = bytes.length - i; // 1, 2 or 3+ bytes in this group -> 2, 3 or 4 characters
    out.push(ALPHABET[n >> 18]!, ALPHABET[(n >> 12) & 63]!);
    if (left > 1) out.push(ALPHABET[(n >> 6) & 63]!);
    if (left > 2) out.push(ALPHABET[n & 63]!);
  }
  return out.join('');
}

/** Only call with text already checked against the alphabet and with length % 4 !== 1. */
function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const c of text) {
    value = (value << 6) | (VALUE_OF.get(c) ?? 0);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (value >> bits) & 0xff;
      value &= (1 << bits) - 1;
    }
  }
  return out;
}

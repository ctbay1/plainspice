/**
 * Share links (src/share/link.ts; the format is docs/share-links.md).
 *
 * The most important tests are at the end: links that were published must open forever, so
 * literal links (and every link in the docs) are decoded and compared with their netlists.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeShare,
  encodeShare,
  MAX_NETLIST_BYTES,
  MAX_PAYLOAD_LENGTH,
  normaliseNetlist,
  SHARE_TEXT,
  ShareError,
  shareUrl,
  type DecodedShare,
  type ShareProblem,
} from '../../src/share/link.ts';

const root = resolve(import.meta.dirname, '../..');
const fixturesDir = join(root, 'tests/fixtures');
const fixtures = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.cir'))
  .sort()
  .map((name) => ({ name, text: readFileSync(join(fixturesDir, name), 'utf8') }));
const fixture = (name: string): string => fixtures.find((f) => f.name === name)!.text;

const b64url = (bytes: Uint8Array | string): string => Buffer.from(bytes).toString('base64url');
const zPayload = (content: string | Uint8Array): string => `z${b64url(deflateRawSync(Buffer.from(content)))}`;
const tPayload = (content: string | Uint8Array): string => `t${b64url(content)}`;
const payloadOf = (fragment: string): string => /(?:^|[#&])c=([^&]*)/.exec(fragment)?.[1] ?? '';

const PROBLEMS: ShareProblem[] = [
  'no-circuit',
  'cut-short',
  'bad-characters',
  'damaged',
  'not-text',
  'too-long',
  'too-big',
  'newer-version',
  'unsupported',
];

async function expectProblem(fragment: string, code: ShareProblem): Promise<void> {
  const result = await decodeShare(fragment);
  expect(result).toMatchObject({ ok: false, code });
  if (!result.ok) expect(result.reason.length).toBeGreaterThan(20);
}

/** A well-formed answer: ok with a netlist ending in a line break, or a known problem with a reason. */
function expectWellFormed(result: DecodedShare): void {
  if (result.ok) {
    expect(result.netlist.endsWith('\n')).toBe(true);
    expect(typeof result.run).toBe('boolean');
  } else {
    expect(PROBLEMS).toContain(result.code);
    expect(result.reason.length).toBeGreaterThan(20);
  }
}

/** Deterministic pseudo-random letters (mulberry32), for text that deflate cannot shrink much. */
function randomLetters(length: number, seed: number): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < length; i += 1) {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    out += letters[(((t ^ (t >>> 14)) >>> 0) % letters.length) >>> 0];
  }
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('round trips: what goes into a link comes back out', () => {
  it.each(fixtures)('$name', async ({ text }) => {
    expect(await decodeShare(await encodeShare(text))).toEqual({ ok: true, netlist: text, run: false });
  });

  it('carries run=1 when asked, and only then', async () => {
    const text = fixture('f1a-voltage-source.cir');
    const withRun = await encodeShare(text, { run: true });
    expect(withRun).toMatch(/^c=z[A-Za-z0-9_-]+&run=1$/);
    expect(await decodeShare(withRun)).toEqual({ ok: true, netlist: text, run: true });
    expect(await encodeShare(text, { run: false })).toMatch(/^c=z[A-Za-z0-9_-]+$/);
  });

  it.each([
    ['Turkish letters, Ω and µ', '* Gerilim bölücü: ç ğ ı İ ö ş ü Ç Ğ I Ö Ş Ü, 1 kΩ, 10 µF\nV1 giriş 0 12\nR1 giriş çıkış 1k\n.op\n.end\n'],
    ['emoji, joined emoji, flags and a combining accent', '* 😀 👩‍🔬 🇹🇷 é\nR1 a 0 1\n.end\n'],
    ['other scripts', '* 日本語 العربية עברית Ελληνικά\nR1 a 0 1\n.end\n'],
    ['a byte order mark at the start (kept)', '﻿* starts with a BOM\nR1 a 0 1\n.end\n'],
    ['tabs and a NUL character', '* tab\there and \u0000 there\n'],
  ])('%s', async (_label, text) => {
    const result = await decodeShare(await encodeShare(text));
    expect(result).toEqual({ ok: true, netlist: text, run: false });
  });

  it.each([
    ['CRLF line ends', 'a\r\nb\r\n', 'a\nb\n'],
    ['lone CR line ends', 'a\rb\r', 'a\nb\n'],
    ['mixed line ends', 'a\r\nb\rc\n', 'a\nb\nc\n'],
    ['no final line break (one is added)', 'a\nb', 'a\nb\n'],
    ['an empty netlist', '', '\n'],
  ])('normalises %s', async (_label, text, expected) => {
    expect(normaliseNetlist(text)).toBe(expected);
    expect(await decodeShare(await encodeShare(text))).toEqual({ ok: true, netlist: expected, run: false });
  });

  it('turns an unpaired surrogate into U+FFFD, as UTF-8 must', async () => {
    expect(await decodeShare(await encodeShare('\uD800x\n'))).toEqual({ ok: true, netlist: '�x\n', run: false });
  });

  it('accepts the fragment with or without "#", and a whole link', async () => {
    const fragment = await encodeShare(fixture('f2a-current-source.cir'), { run: true });
    const url = shareUrl('https://plainspice.com/', fragment);
    for (const input of [fragment, `#${fragment}`, url]) {
      expect(await decodeShare(input)).toEqual({ ok: true, netlist: fixture('f2a-current-source.cir'), run: true });
    }
  });
});

describe('shareUrl', () => {
  it('puts the fragment after the base, replacing any fragment the base had', () => {
    expect(shareUrl('https://plainspice.com/', 'c=tAA&run=1')).toBe('https://plainspice.com/#c=tAA&run=1');
    expect(shareUrl('https://plainspice.com/#c=old', '#c=tAA')).toBe('https://plainspice.com/#c=tAA');
    expect(shareUrl('http://localhost:5173/?x=1', 'c=tAA')).toBe('http://localhost:5173/?x=1#c=tAA');
  });
});

// Sizes for the test names, so the report shows how much deflate saves on each fixture.
const sizes = await Promise.all(
  fixtures.map(async ({ name, text }) => {
    const bytes = Buffer.byteLength(text, 'utf8');
    const payload = payloadOf(await encodeShare(text));
    return { name, bytes, t: 1 + Math.ceil((bytes * 4) / 3), z: payload.length, format: payload[0] };
  }),
);

describe('compression', () => {
  it.each(sizes)('$name: $bytes bytes of netlist, "t" payload $t characters, "z" payload $z characters', ({ format, t, z }) => {
    expect(format).toBe('z');
    expect(z).toBeLessThan(t);
  });

  it('uses plain text when deflate would make the link longer', async () => {
    const fragment = await encodeShare('* t\n.end\n');
    expect(fragment).toBe('c=tKiB0Ci5lbmQK');
  });

  it('uses plain text when CompressionStream is missing, and that link opens', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const text = fixture('f5-thevenin-cccs.cir');
    const fragment = await encodeShare(text);
    expect(fragment.startsWith('c=t')).toBe(true);
    expect(await decodeShare(fragment)).toEqual({ ok: true, netlist: text, run: false });
  });

  it('uses plain text when CompressionStream has no "deflate-raw" (as in older browsers)', async () => {
    vi.stubGlobal(
      'CompressionStream',
      class {
        constructor() {
          throw new TypeError('Unsupported compression format');
        }
      },
    );
    expect((await encodeShare(fixture('f1a-voltage-source.cir'))).startsWith('c=t')).toBe(true);
  });

  it('says so in plain words when a "z" link meets a browser without DecompressionStream', async () => {
    const fragment = await encodeShare(fixture('f1a-voltage-source.cir'));
    vi.stubGlobal('DecompressionStream', undefined);
    await expectProblem(fragment, 'unsupported');
    // "t" links need no decompression.
    expect(await decodeShare(`c=${tPayload('* x\n')}`)).toEqual({ ok: true, netlist: '* x\n', run: false });
  });
});

describe('limits', () => {
  it(`makes and opens a link for a netlist of exactly ${MAX_NETLIST_BYTES} bytes`, async () => {
    const text = 'R1 a 0 1k\n'.repeat(MAX_NETLIST_BYTES / 10);
    expect(Buffer.byteLength(text)).toBe(MAX_NETLIST_BYTES);
    const result = await decodeShare(await encodeShare(text));
    expect(result.ok && result.netlist === text).toBe(true);
  });

  it('refuses to make a link for a netlist one byte bigger, in plain words', async () => {
    const text = `${'R1 a 0 1k\n'.repeat(MAX_NETLIST_BYTES / 10 - 1)}R1 a 0 10k\n`;
    expect(Buffer.byteLength(text)).toBe(MAX_NETLIST_BYTES + 1);
    const error = await encodeShare(text).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShareError);
    expect(error).toMatchObject({ code: 'too-big', message: SHARE_TEXT.netlistTooBig(256) });
  });

  it(`refuses to make a link longer than ${MAX_PAYLOAD_LENGTH} characters`, async () => {
    const lines = randomLetters(40_000, 7).match(/.{1,78}/g)!.map((l) => `* ${l}`);
    const text = `* random comments\n${lines.join('\n')}\n.end\n`;
    const error = await encodeShare(text).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'ShareError', code: 'too-long', message: SHARE_TEXT.linkTooLong(MAX_PAYLOAD_LENGTH) });
  });

  it('refuses to open a payload longer than the limit, without decoding it', async () => {
    await expectProblem(`c=t${'A'.repeat(MAX_PAYLOAD_LENGTH)}`, 'too-long');
    await expectProblem(`c=${'A'.repeat(10 * MAX_PAYLOAD_LENGTH)}`, 'too-long');
  });

  it('refuses a link that unpacks to more text than the limit', async () => {
    await expectProblem(`c=${zPayload(`${'R'.repeat(MAX_NETLIST_BYTES)}\n`)}`, 'too-big');
  });

  it('stops unpacking a zip bomb early: 20 MB from a 26,000-character link', async () => {
    const bomb = zPayload(new Uint8Array(20_000_000));
    expect(bomb.length).toBeLessThan(MAX_PAYLOAD_LENGTH);
    const Real = globalThis.DecompressionStream;
    let produced = 0;
    vi.stubGlobal(
      'DecompressionStream',
      class {
        readonly readable: ReadableStream<Uint8Array>;
        readonly writable: WritableStream<BufferSource>;
        constructor(format: CompressionFormat) {
          const inner = new Real(format);
          this.writable = inner.writable;
          this.readable = inner.readable.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                produced += chunk.byteLength;
                controller.enqueue(chunk);
              },
            }),
          );
        }
      },
    );
    await expectProblem(`c=${bomb}`, 'too-big');
    // Allow a few chunks in flight past the limit; the whole bomb is 20,000,000 bytes.
    expect(produced).toBeGreaterThan(MAX_NETLIST_BYTES);
    expect(produced).toBeLessThan(1_000_000);
  });
});

describe('damaged links give ok: false with a plain reason, never a different circuit', () => {
  it.each(fixtures)('every cut-short "z" link of $name is refused', async ({ text }) => {
    const payload = payloadOf(await encodeShare(text));
    for (let length = 1; length < payload.length; length += 1) {
      const result = await decodeShare(`c=${payload.slice(0, length)}`);
      expect(result.ok, `cut to ${length} characters`).toBe(false);
    }
  });

  it.each(fixtures)('a cut-short "t" link of $name is refused, or opens only whole lines', async ({ text }) => {
    const payload = tPayload(text);
    let refused = 0;
    for (let length = 1; length < payload.length; length += 1) {
      const result = await decodeShare(`c=${payload.slice(0, length)}`);
      if (result.ok) {
        // Cut exactly after a line break: the lines before it, all of them whole.
        expect(text.startsWith(result.netlist) && result.netlist.length < text.length).toBe(true);
      } else {
        refused += 1;
      }
    }
    expect(refused / (payload.length - 1)).toBeGreaterThan(0.85);
    // Losing the last character always loses the final line break.
    await expectProblem(`c=${payload.slice(0, -1)}`, 'cut-short');
  });

  it('refuses or ignores bytes after the end of the deflate data, never giving a different circuit', async () => {
    // Browsers refuse them ("Junk found after end of compressed data"); Node ignores them.
    const text = fixture('f5-thevenin-cccs.cir');
    const junk = `z${b64url(Buffer.concat([deflateRawSync(Buffer.from(text)), Buffer.from('junk')]))}`;
    const result = await decodeShare(`c=${junk}`);
    if (result.ok) expect(result.netlist).toBe(text);
    else expect(result.code).toBe('damaged');
  });

  it('refuses data that is not deflate', async () => {
    await expectProblem('c=z__8', 'damaged'); // 0xFF 0xFF: a block type deflate does not have
    await expectProblem('c=z', 'damaged');
  });

  it.each([
    ['an "@"', 'c=z@@@@'],
    ['a "."', 'c=tAB.C'],
    ['a letter outside ASCII', 'c=zÄÄÄÄ'],
    ['a "+" from ordinary base64', 'c=tAB+C'],
    ['a first character that is not base64url', 'c=!AAAA'],
  ])('refuses %s', async (_label, fragment) => {
    await expectProblem(fragment, 'bad-characters');
  });

  it('refuses a payload whose length cannot be base64 (4n+1 characters) as cut short', async () => {
    await expectProblem('c=tQUJDR', 'cut-short');
    await expectProblem('c=tA', 'cut-short');
  });

  it.each([
    ['a broken two-byte sequence', [0xc3, 0x28, 0x0a]],
    ['an overlong encoding', [0xc0, 0xaf, 0x0a]],
    ['a UTF-16 surrogate written as UTF-8', [0xed, 0xa0, 0x80, 0x0a]],
    ['a byte that never starts a character', [0xff, 0x0a]],
  ])('refuses text that is not UTF-8: %s', async (_label, bytes) => {
    await expectProblem(`c=${tPayload(new Uint8Array(bytes))}`, 'not-text');
    await expectProblem(`c=${zPayload(new Uint8Array(bytes))}`, 'not-text');
  });

  it('refuses a netlist without its final line break as cut short', async () => {
    await expectProblem(`c=${tPayload('R1 a 0 1')}`, 'cut-short');
    await expectProblem(`c=${zPayload('* title\nR1 a 0 1')}`, 'cut-short');
    await expectProblem('c=t', 'cut-short');
  });

  it.each(['x', 'Z', 'T', 'a', '0', '-'])('refuses an unknown format letter "%s": made by a newer PlainSpice?', async (letter) => {
    const result = await decodeShare(`c=${letter}${b64url('* x\n')}`);
    expect(result).toEqual({ ok: false, code: 'newer-version', reason: SHARE_TEXT.newerVersion });
    expect(SHARE_TEXT.newerVersion).toContain('newer version of PlainSpice');
  });

  it.each(['', '#', '#main', 'run=1', 'foo=bar&baz', 'C=z01JwM0y0Ukh'])('"%s" is not a share link', async (fragment) => {
    await expectProblem(fragment, 'no-circuit');
  });

  it('treats an empty c= as cut short (a share link that lost its circuit)', async () => {
    await expectProblem('c=', 'cut-short');
    await expectProblem('#c=&run=1', 'cut-short');
  });
});

describe('reading links that were changed on the way', () => {
  const text = fixture('f4-tf-output-impedance.cir');

  it('ignores spaces and line breaks inside the payload (a link wrapped by an email)', async () => {
    const payload = payloadOf(await encodeShare(text));
    const wrapped = `c=${payload.slice(0, 20)}\n ${payload.slice(20, 50)}\t${payload.slice(50)}&run=1`;
    expect(await decodeShare(wrapped)).toEqual({ ok: true, netlist: text, run: true });
  });

  it('accepts base64url padding', async () => {
    const plain = '* padded\n'; // 9 bytes: 12 characters, then one with 10 bytes needing "=="
    expect(await decodeShare(`c=t${Buffer.from(plain).toString('base64')}`)).toEqual({ ok: true, netlist: plain, run: false });
    const ten = '* padded.\n';
    const padded = `t${Buffer.from(ten).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')}`;
    expect(padded.endsWith('==')).toBe(true);
    expect(await decodeShare(`c=${padded}`)).toEqual({ ok: true, netlist: ten, run: false });
  });

  it('undoes %-escaping of the whole fragment', async () => {
    const fragment = await encodeShare(text, { run: true });
    expect(await decodeShare(`#${encodeURIComponent(fragment)}`)).toEqual({ ok: true, netlist: text, run: true });
    await expectProblem('#c=%E0%A4%A', 'bad-characters');
  });

  it('takes the parameters in any order, ignores ones it does not know, and keeps the first c', async () => {
    const payload = payloadOf(await encodeShare(text));
    expect(await decodeShare(`view=plot&run=1&c=${payload}&c=zBROKEN`)).toEqual({ ok: true, netlist: text, run: true });
  });

  it.each(['run=0', 'run', 'run=true', 'run=yes', 'run=11'])('runs only for run=1, not for "%s"', async (run) => {
    const payload = payloadOf(await encodeShare(text));
    expect(await decodeShare(`c=${payload}&${run}`)).toEqual({ ok: true, netlist: text, run: false });
  });
});

describe('decodeShare never throws', () => {
  it('answers values that are not strings', async () => {
    for (const value of [undefined, null, 42, {}, { toString: (): string => { throw new Error('boom'); } }]) {
      const result = await decodeShare(value as unknown as string);
      expect(result.ok).toBe(false);
      expectWellFormed(result);
    }
  });

  it('answers 400 random fragments', async () => {
    const chars = 'AZaz09-_=&#%+/ .~\n\tÄ😀ctzrun';
    let seed = 1;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed;
    };
    for (let i = 0; i < 400; i += 1) {
      const length = next() % 80;
      let s = i % 2 === 0 ? 'c=' : '';
      for (let j = 0; j < length; j += 1) s += [...chars][next() % [...chars].length];
      expectWellFormed(await decodeShare(s));
    }
  });

  it('answers every one-character change of a link (a wrong circuit can open: v1 links have no checksum)', async () => {
    const text = fixture('f3a-1M-trap.cir');
    const payload = payloadOf(await encodeShare(text));
    for (let i = 0; i < payload.length; i += 1) {
      for (const c of ['A', '_', '0', payload[i] === payload[i]!.toUpperCase() ? payload[i]!.toLowerCase() : payload[i]!.toUpperCase()]) {
        if (c === payload[i]) continue;
        expectWellFormed(await decodeShare(`c=${payload.slice(0, i)}${c}${payload.slice(i + 1)}`));
      }
    }
  });
});

describe('published links open forever', () => {
  // Literal links, copied once from scripts/make-link.ts. Never change these strings: if one
  // fails, the decoder broke links that are out in the world. Add new ones; never remove any.
  const UNICODE = '* Gerilim bölücü: 12 V, 1 kΩ ve 2 kΩ (çıkış İ ğ ş ö ü) µ 😀\nV1 giriş 0 12\nR1 giriş çıkış 1k\nR2 çıkış 0 2k\n.op\n.end\n';
  const GOLDEN: { label: string; link: string; netlist: () => string; run: boolean }[] = [
    {
      label: 'F1a, made by make-link (z, run=1)',
      link: 'https://ctbay1.github.io/plainspice/#c=z01JwM0y0UkhUMFMIUyjOLy1KTlVITC7KLy5WSFQwUsjPyFUoSi3OLC7JL-IKM1TIM1QwUDDjCoKyjLj08gu49FLzUrgA&run=1',
      netlist: () => fixture('f1a-voltage-source.cir'),
      run: true,
    },
    {
      label: 'F5, made by make-link (z, run=1)',
      link: 'https://ctbay1.github.io/plainspice/#c=zPcixCsIwFIXh_T7FGdWhJEEXH6DgWqR7aA4kgzeludY8vtTB6eP_Lxhvdzwzd2pRbGylWdSF-BTLiEhcqYlqaPW9LcTJ2P7xouWazvL4TYcIL3NHRIeTKaBDPYJM_tDhKuOBeswdQYa6ykBN8gU&run=1',
      netlist: () => fixture('f5-thevenin-cccs.cir'),
      run: true,
    },
    {
      label: 'Turkish letters, Ω, µ and an emoji (z, run=1)',
      link: 'https://ctbay1.github.io/plainspice/#c=z01JwTy3KzMnMVUg6vC3n8J7kw3usFAyNFMJ0FAwVss-tVChLVTACMzQOLz-yMfvIxqPzFY5sUDgyX-HofIXD2xQO79FUOLRV4cP8GQ1cYYYK6ZlFmUfnKxgoGBpxBcG5CK2G2VxBRkh8AwWjbC69_AIuvdS8FC4A&run=1',
      netlist: () => UNICODE,
      run: true,
    },
    {
      label: 'plain text (t)',
      link: 'https://ctbay1.github.io/plainspice/#c=tKiBPaG0ncyBsYXcKVjEgYSAwIDEKUjEgYSAwIDEKLm9wCi5lbmQK',
      netlist: () => "* Ohm's law\nV1 a 0 1\nR1 a 0 1\n.op\n.end\n",
      run: false,
    },
    { label: 'a tiny netlist (t), fragment only', link: '#c=tKiB0Ci5lbmQK', netlist: () => '* t\n.end\n', run: false },
    // From 10 November 2026 the links start with https://plainspice.com/ (the address above
    // forwards there and the browser keeps the fragment, so both kinds must open).
    {
      label: 'F1a at plainspice.com (z, run=1)',
      link: 'https://plainspice.com/#c=z01JwM0y0UkhUMFMIUyjOLy1KTlVITC7KLy5WSFQwUsjPyFUoSi3OLC7JL-IKM1TIM1QwUDDjCoKyjLj08gu49FLzUrgA&run=1',
      netlist: () => fixture('f1a-voltage-source.cir'),
      run: true,
    },
    {
      label: 'plain text at plainspice.com (t)',
      link: 'https://plainspice.com/#c=tKiBPaG0ncyBsYXcKVjEgYSAwIDEKUjEgYSAwIDEKLm9wCi5lbmQK',
      netlist: () => "* Ohm's law\nV1 a 0 1\nR1 a 0 1\n.op\n.end\n",
      run: false,
    },
  ];

  it.each(GOLDEN)('$label', async ({ link, netlist, run }) => {
    expect(await decodeShare(link)).toEqual({ ok: true, netlist: netlist(), run });
  });

  it('every link in docs/share-links.md opens to one of the fixtures', async () => {
    const docs = readFileSync(join(root, 'docs/share-links.md'), 'utf8');
    const links = docs.match(/https:\/\/(?:plainspice\.com|ctbay1\.github\.io\/plainspice)\/#c=[A-Za-z0-9_-]+(?:&run=1)?/g) ?? [];
    expect(links.length).toBeGreaterThanOrEqual(fixtures.length);
    const texts = new Set(fixtures.map((f) => f.text));
    for (const link of links) {
      const result = await decodeShare(link);
      expect(result.ok && texts.has(result.netlist), link).toBe(true);
    }
  });
});

describe('scripts/make-link.ts', () => {
  const makeLink = (...args: string[]) =>
    spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'scripts/make-link.ts', ...args], {
      cwd: root,
      encoding: 'utf8',
    });

  it('prints one link per fixture that runs at once and opens to that fixture', async () => {
    const paths = fixtures.map((f) => join('tests/fixtures', f.name));
    const result = makeLink(...paths);
    expect(result.status, result.stderr).toBe(0);
    const links = result.stdout.trim().split('\n');
    expect(links).toHaveLength(fixtures.length);
    for (const [i, link] of links.entries()) {
      expect(link.startsWith('https://plainspice.com/#c=z')).toBe(true);
      expect(await decodeShare(link)).toEqual({ ok: true, netlist: fixtures[i]!.text, run: true });
      expect(link.length).toBeLessThan(250);
    }
    expect(result.stderr).toContain(`${fixtures.length} links`);
    expect(result.stderr).toContain('YouTube description holds up to 5,000');
  });

  it('takes --base and --no-run', async () => {
    const result = makeLink('--no-run', '--base', 'http://localhost:5173/', 'tests/fixtures/f1a-voltage-source.cir');
    expect(result.status, result.stderr).toBe(0);
    const link = result.stdout.trim();
    expect(link).toMatch(/^http:\/\/localhost:5173\/#c=z[A-Za-z0-9_-]+$/);
    expect(await decodeShare(link)).toEqual({ ok: true, netlist: fixture('f1a-voltage-source.cir'), run: false });
  });

  it('reports files it cannot read or that are not UTF-8, and exits 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'make-link-'));
    try {
      const latin1 = join(dir, 'latin1.cir');
      writeFileSync(latin1, Buffer.from('* Gerilim b\xf6l\xfcc\xfc\nR1 a 0 1\n.end\n', 'latin1'));
      const result = makeLink(latin1, join(dir, 'missing.cir'), 'tests/fixtures/f1a-voltage-source.cir');
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('latin1.cir: not UTF-8 text');
      expect(result.stderr).toContain('missing.cir: cannot read it (ENOENT)');
      expect(result.stdout.trim().split('\n')).toHaveLength(1); // the good file still gets its link
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Node started six times: about 0.5 s alone, 4.1 s at load 16 on 4 cores (each start waits for a
  // processor), most of vitest's 5 s: 30 s, as the app's slow tests have.
  it('explains its usage and exits 2 for wrong arguments', () => {
    for (const args of [[], ['--frobnicate', 'a.cir'], ['--base'], ['--base', 'ctbay1.github.io', 'a.cir'], ['--base', 'ftp://x/', 'a.cir']]) {
      const result = makeLink(...args);
      expect(result.status, args.join(' ')).toBe(2);
      expect(result.stderr).toContain('Usage:');
    }
    expect(makeLink('--help').status).toBe(0);
  }, 30_000);
});

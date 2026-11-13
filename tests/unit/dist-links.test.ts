/**
 * The build's link check (scripts/dist-links.ts, run on dist/ by vite.config.ts): every relative
 * href, src and srcset of a built page names a file of the site. The second re-check's P4: the
 * design index linked "both views side by side" to ../docs/design/checkpoint/…png, which was never
 * deployed (404 on plainspice.com), while vite preview answered it with the app page (200).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkLinks } from '../../scripts/dist-links.ts';

let dist: string | undefined;

/** A small built site in a temporary folder: path → content. */
function site(files: Record<string, string>): string {
  dist = mkdtempSync(join(tmpdir(), 'plainspice-links-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dist, path)), { recursive: true });
    writeFileSync(join(dist, path), content);
  }
  return dist;
}

afterEach(() => {
  if (dist) rmSync(dist, { recursive: true, force: true });
  dist = undefined;
});

const page = (body: string, head = ''): string => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe('checkLinks', () => {
  it('finds the design index link of P4: a picture under docs/, which is not part of the site', () => {
    const d = site({
      'index.html': page('<a href="./design/">Design</a>'),
      'design/index.html': page(
        '<a href="../docs/design/checkpoint/p02-4-open-phone-views.png">both views side by side</a>' +
          '<img src="../assets/p02-4-open-solved-desktop-abc.png" alt="">',
      ),
      'assets/p02-4-open-solved-desktop-abc.png': 'png',
    });
    const r = checkLinks(d);
    expect(r.broken).toEqual([{ page: 'design/index.html', url: '../docs/design/checkpoint/p02-4-open-phone-views.png', reason: 'no such file' }]);
    expect(r.links).toBe(3);
  });

  it('accepts the fix: the picture on the page (Vite emits it under assets/) and an in-page link to it', () => {
    const d = site({
      'design/index.html': page(
        '<a href="#phone-views">both views side by side</a>' +
          '<figure id="phone-views"><img src="../assets/p02-4-open-phone-views-abc.png" alt=""></figure>',
      ),
      'assets/p02-4-open-phone-views-abc.png': 'png',
    });
    expect(checkLinks(d).broken).toEqual([]);
  });

  it('resolves folders, the site root, queries, fragments, srcset and entities as GitHub Pages serves them', () => {
    const d = site({
      'index.html': page(
        '<a href="./spike/">spike</a><a href="licenses">licences (a folder, no slash)</a><a href="/">root</a>' +
          '<a href="./">here</a><a href="./a.png?v=2#x">query</a><img srcset="a.png 1x, ./b.png 2x" alt="">' +
          '<a href="./a&amp;b.txt">entity</a><a href="./with%20space.txt">space</a><a href="#top">top</a><p id="top"></p>',
        '<link rel="icon" href="./a.png"><script type="module" src="./assets/main.js"></script>',
      ),
      'spike/index.html': page('<a href="../">back</a><a href="../index.html#top">to the top of the app</a>'),
      'licenses/index.html': page('<a href="../">back</a>'),
      'a.png': '',
      'b.png': '',
      'a&b.txt': '',
      'with space.txt': '',
      'assets/main.js': '',
    });
    const r = checkLinks(d);
    expect(r.broken).toEqual([]);
    expect(r.links).toBe(15);
  });

  it('says why each broken link is broken', () => {
    const d = site({
      'index.html': page(
        '<a href="./nothing.png">a missing file</a><a href="./empty/">a folder without index.html</a>' +
          '<a href="../outside.html">outside the site</a><a href="#nowhere">a missing id</a>' +
          '<a href="./other.html#gone">an id missing from another page</a><img srcset="./a.png 1x, ./c.png 2x" alt="">',
      ),
      'empty/readme.txt': '',
      'other.html': page('<p id="here"></p>'),
      'a.png': '',
    });
    expect(checkLinks(d).broken.map((b) => `${b.url}: ${b.reason}`)).toEqual([
      './nothing.png: no such file',
      './empty/: the folder has no index.html',
      '../outside.html: it points outside the site',
      '#nowhere: index.html has no id "nowhere"',
      './other.html#gone: other.html has no id "gone"',
      './c.png: no such file',
    ]);
  });

  it('leaves other sites, data: and mailto: alone, and reads no script, style or comment as a link', () => {
    const d = site({
      'index.html': page(
        '<a href="https://github.com/ctbay1/plainspice">repo</a><a href="//example.com/x.png">x</a><img src="data:image/png;base64,AAAA" alt="">' +
          '<a href="mailto:someone@example.com">mail</a><!-- <a href="./old.png">old</a> -->' +
          '<script>const l = document.createElement("link"); l.href = "./not-a-tag.wasm"; if (1 < 2) l.src = "<img src=x>";</script>' +
          '<style>.a { background: url(./not-checked.png) } /* <a href="./in-style.png"> */</style>',
      ),
    });
    const r = checkLinks(d);
    expect(r.broken).toEqual([]);
    expect(r.links).toBe(0);
  });

  it('reports a file left out on purpose (the engine source tarball, which only CI fetches) apart, and checks it when it is there', () => {
    const tarball = 'engine/source/ngspice-47.tar.gz';
    const files = { 'licenses/index.html': page('<a href="../engine/source/ngspice-47.tar.gz">source</a><a href="../engine/SOURCE.txt">about</a>'), 'engine/SOURCE.txt': '' };
    const without = checkLinks(site(files), { mayBeMissing: [tarball] });
    expect(without.broken).toEqual([]);
    expect(without.missingOnPurpose.map((m) => m.url)).toEqual(['../engine/source/ngspice-47.tar.gz']);
    rmSync(dist!, { recursive: true, force: true });
    expect(checkLinks(site(files)).broken.map((b) => b.url)).toEqual(['../engine/source/ngspice-47.tar.gz']);
    rmSync(dist!, { recursive: true, force: true });
    const shipped = checkLinks(site({ ...files, [tarball]: 'gz' }), { mayBeMissing: [tarball] });
    expect(shipped.broken).toEqual([]);
    expect(shipped.missingOnPurpose).toEqual([]);
  });
});

/**
 * Every relative link and source in the built site's pages must point at a file of the site
 * (decision 0009). GitHub Pages answers a missing file with "404 Page not found", but `vite preview`
 * answers any missing path with the app's index.html (200), so only the files in dist/ can tell:
 * the design index linked to a picture that was never deployed, and no test noticed (the second
 * re-check's P4). The build runs this on dist/ and fails on a broken link (vite.config.ts).
 *
 * What it reads: the href, src and srcset attributes of every tag in every .html file under dist/
 * (not the text of scripts and styles). What it checks: a relative or site-absolute path names a
 * file in dist/, or a folder with an index.html (as GitHub Pages serves it), and a link to #id finds
 * that id in its page. Links to other sites, data: and the like are left alone.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

export interface BrokenLink {
  /** The page, relative to dist/ ("design/index.html"). */
  page: string;
  /** The attribute's value as written. */
  url: string;
  /** What is wrong, in words. */
  reason: string;
}

export interface LinkCheckOptions {
  /**
   * Files (relative to dist/) that a build may leave out on purpose: a link to one is reported in
   * `missingOnPurpose`, not as broken, when the file is not there (the engine's source tarball,
   * which only CI fetches before the build that is deployed).
   */
  mayBeMissing?: readonly string[];
}

export interface LinkCheck {
  pages: number;
  links: number;
  broken: BrokenLink[];
  missingOnPurpose: BrokenLink[];
}

/** The .html files under a folder, relative to it, with '/' between folders. */
function htmlPages(dist: string, dir = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(dist, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...htmlPages(dist, rel));
    else if (entry.name.endsWith('.html')) out.push(rel);
  }
  return out.sort();
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** The page's markup without comments and without the text of its scripts and styles (their tags stay). */
function markupOnly(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi, '$1$2')
    .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style\s*>)/gi, '$1$2');
}

const ATTRIBUTE = /\s([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

/** Every attribute of every tag, in order. */
function attributes(markup: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const tag of markup.match(/<[a-zA-Z][^>]*>/g) ?? []) {
    for (const m of tag.matchAll(ATTRIBUTE)) out.push({ name: m[1]!.toLowerCase(), value: decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') });
  }
  return out;
}

/** The ids (and a-tag names) a page has, for #fragment links. */
function anchorsOf(markup: string): Set<string> {
  const ids = new Set<string>();
  for (const { name, value } of attributes(markup)) if (name === 'id' || name === 'name') ids.add(value);
  return ids;
}

/** The URLs one attribute holds (srcset holds several, each before its width or density). */
function urlsOf(name: string, value: string): string[] {
  if (name === 'srcset') return value.split(',').map((part) => part.trim().split(/\s+/)[0] ?? '').filter(Boolean);
  return [value.trim()];
}

/** Not a path on this site: another site, a protocol-relative URL, or a scheme such as data: or mailto:. */
function external(url: string): boolean {
  return url.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(url);
}

export function checkLinks(dist: string, options: LinkCheckOptions = {}): LinkCheck {
  const mayBeMissing = new Set(options.mayBeMissing ?? []);
  const pages = htmlPages(dist);
  const markupCache = new Map<string, string>();
  const markupOf = (page: string): string => {
    let m = markupCache.get(page);
    if (m === undefined) {
      m = markupOnly(readFileSync(join(dist, page), 'utf8'));
      markupCache.set(page, m);
    }
    return m;
  };
  const anchorCache = new Map<string, Set<string>>();
  const anchors = (page: string): Set<string> => {
    let a = anchorCache.get(page);
    if (!a) {
      a = anchorsOf(markupOf(page));
      anchorCache.set(page, a);
    }
    return a;
  };
  const result: LinkCheck = { pages: pages.length, links: 0, broken: [], missingOnPurpose: [] };
  for (const page of pages) {
    for (const { name, value } of attributes(markupOf(page))) {
      if (name !== 'href' && name !== 'src' && name !== 'srcset') continue;
      for (const url of urlsOf(name, value)) {
        if (!url || external(url)) continue;
        result.links += 1;
        const broken = (reason: string): void => void result.broken.push({ page, url, reason });
        const hashAt = url.indexOf('#');
        const fragment = hashAt < 0 ? '' : url.slice(hashAt + 1);
        let path = (hashAt < 0 ? url : url.slice(0, hashAt)).replace(/\?.*$/, '');
        try {
          path = decodeURI(path);
        } catch {
          broken('the path is not a valid URL');
          continue;
        }
        let target: string;
        if (path === '') target = page;
        else {
          const joined = path.startsWith('/') ? posix.normalize(path.slice(1)) : posix.normalize(posix.join(posix.dirname(page), path));
          if (joined === '..' || joined.startsWith('../')) {
            broken('it points outside the site');
            continue;
          }
          const full = join(dist, joined === '.' ? '' : joined);
          const folder = path.endsWith('/') || joined === '.' || (existsSync(full) && statSync(full).isDirectory());
          target = folder ? posix.join(joined === '.' ? '' : joined, 'index.html') : joined;
          if (!existsSync(join(dist, target))) {
            if (mayBeMissing.has(target)) result.missingOnPurpose.push({ page, url, reason: 'not in this build (left out on purpose)' });
            else broken(folder ? 'the folder has no index.html' : 'no such file');
            continue;
          }
        }
        if (!fragment || !target.endsWith('.html')) continue;
        let id: string;
        try {
          id = decodeURIComponent(fragment);
        } catch {
          broken('the #fragment is not a valid URL');
          continue;
        }
        if (!anchors(target).has(id)) broken(`${target} has no id "${id}"`);
      }
    }
  }
  return result;
}

/** The broken links in words, one per line, for the build's error message. */
export function describeBroken(broken: readonly BrokenLink[]): string {
  return broken.map((b) => `  ${b.page}: ${b.url} (${b.reason})`).join('\n');
}

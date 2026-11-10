/**
 * Studio prototype: the ⌘K / Ctrl+K command palette. A modal dialog with a combobox and a grouped
 * listbox (aria-activedescendant), fuzzy matching, shortcuts shown on the right, and focus given
 * back to where it was when it closes.
 */
import { icon } from './icons.ts';

export interface Command {
  id: string;
  title: string;
  group: string;
  /** Keys shown on the right, e.g. ['⌘', '↵'] or ['R']. */
  keys?: string[];
  /** Icon markup (from icons.ts). */
  icon?: string;
  /** Extra words that should find it. */
  keywords?: string;
  /** Shown dimmed after the title ("on", "R1 = 3k"). */
  hint?: string;
  run: () => void;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A forgiving match: every query word must appear (in order of letters) in the title or keywords. */
function score(command: Command, query: string): number {
  if (!query) return 1;
  const hay = `${command.title} ${command.keywords ?? ''} ${command.group}`.toLowerCase();
  const title = command.title.toLowerCase();
  let total = 0;
  for (const word of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = title.indexOf(word);
    if (at === 0) total += 6;
    else if (at > 0) total += title[at - 1] === ' ' ? 4 : 2.5;
    else if (hay.includes(word)) total += 1.5;
    else {
      // letters in order (e.g. "nl" finds "Netlist")
      let i = 0;
      for (const ch of hay) if (ch === word[i]) i++;
      if (i < word.length) return 0;
      total += 0.4;
    }
  }
  return total;
}

export interface Palette {
  open: (initialQuery?: string) => void;
  close: () => void;
  isOpen: () => boolean;
}

export function createPalette(root: HTMLElement, getCommands: (query: string) => Command[]): Palette {
  root.innerHTML = `
    <div class="palette__scrim" data-close></div>
    <div class="palette" role="dialog" aria-modal="true" aria-labelledby="palette-label">
      <h2 id="palette-label" class="sr-only">Command palette</h2>
      <div class="palette__field">
        ${icon('search', 18, 'palette__search')}
        <input class="palette__input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list"
          aria-autocomplete="list" autocomplete="off" spellcheck="false"
          placeholder="Type a command, a part, or “R1 3k”" aria-label="Search commands" />
        <kbd class="kbd kbd--quiet">Esc</kbd>
      </div>
      <ul class="palette__list" id="palette-list" role="listbox" aria-label="Commands"></ul>
      <div class="palette__foot" aria-hidden="true">
        <span><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> move</span>
        <span><kbd class="kbd">↵</kbd> run</span>
        <span class="palette__tip">Try “r1 4.7k” or “trap”</span>
      </div>
    </div>`;
  const input = root.querySelector<HTMLInputElement>('.palette__input')!;
  const list = root.querySelector<HTMLUListElement>('.palette__list')!;
  let shown: Command[] = [];
  let active = 0;
  let returnFocus: HTMLElement | null = null;

  const render = (): void => {
    const query = input.value.trim();
    const scored = getCommands(query)
      .map((c, i) => ({ c, s: score(c, query), i }))
      .filter((x) => x.s > 0);
    if (query) scored.sort((a, b) => b.s - a.s || a.i - b.i);
    shown = scored.map((x) => x.c);
    active = Math.min(active, Math.max(0, shown.length - 1));
    if (!shown.length) {
      list.innerHTML = `<li class="palette__empty" role="presentation">No command matches “${esc(query)}”.</li>`;
      input.removeAttribute('aria-activedescendant');
      return;
    }
    let html = '';
    let group = '';
    shown.forEach((c, i) => {
      if (!query && c.group !== group) {
        group = c.group;
        html += `<li class="palette__group" role="presentation">${esc(group)}</li>`;
      }
      const keys = (c.keys ?? []).map((k) => `<kbd class="kbd">${esc(k)}</kbd>`).join('');
      html += `<li class="palette__item${i === active ? ' is-active' : ''}" role="option" id="pal-${i}" aria-selected="${i === active}" data-i="${i}">
        <span class="palette__icon">${c.icon ?? icon('chevronRight', 16)}</span>
        <span class="palette__title">${esc(c.title)}${c.hint ? ` <span class="palette__hint">${esc(c.hint)}</span>` : ''}</span>
        ${query ? `<span class="palette__grouptag">${esc(c.group)}</span>` : ''}
        <span class="palette__keys">${keys}</span>
      </li>`;
    });
    list.innerHTML = html;
    input.setAttribute('aria-activedescendant', `pal-${active}`);
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  };

  const setActive = (i: number): void => {
    if (!shown.length) return;
    active = (i + shown.length) % shown.length;
    list.querySelectorAll('.palette__item').forEach((el) => {
      const on = Number((el as HTMLElement).dataset.i) === active;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-selected', String(on));
    });
    input.setAttribute('aria-activedescendant', `pal-${active}`);
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  };

  const runActive = (): void => {
    const command = shown[active];
    if (!command) return;
    close(false);
    command.run();
  };

  function close(restore = true): void {
    if (root.hidden) return;
    root.hidden = true;
    document.body.classList.remove('has-palette');
    if (restore && returnFocus?.isConnected) returnFocus.focus();
  }

  input.addEventListener('input', () => {
    active = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runActive();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      e.preventDefault(); // focus stays in the dialog: the input is its only stop
    } else if (e.key === 'Home' && e.ctrlKey) {
      setActive(0);
    }
  });
  list.addEventListener('pointermove', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.palette__item');
    if (item && Number(item.dataset.i) !== active) setActive(Number(item.dataset.i));
  });
  list.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.palette__item');
    if (!item) return;
    active = Number(item.dataset.i);
    runActive();
  });
  root.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).hasAttribute('data-close')) close();
  });

  return {
    open(initialQuery = '') {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      root.hidden = false;
      document.body.classList.add('has-palette');
      input.value = initialQuery;
      active = 0;
      render();
      input.focus();
      input.select();
    },
    close: () => close(),
    isOpen: () => !root.hidden,
  };
}

/**
 * Ctrl+K (from the Studio direction, decision 0014): every command in one searchable list, every
 * panel, overlay, example and part reached from the keyboard. A modal dialog with a combobox and its
 * list (ARIA 1.2 combobox pattern): type to filter, arrow keys to choose, Enter to run, Escape to
 * close; focus goes back where it was (the page does that).
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { t, tn } from '../../i18n/index.ts';
import { LineIcon } from './Icons.tsx';

export interface Command {
  /** What the page does when it is chosen (CommandPalette's onRun gets it). */
  id: string;
  /** What it does, as a short instruction: "Open the netlist panel". */
  label: string;
  /** A group heading: "Examples", "Panels", "Drawing" ... */
  group: string;
  /** Extra words that should find it. */
  keywords?: string;
  /** A shortcut to show. */
  shortcut?: string;
}

/**
 * Commands whose label, group or keywords have a word starting with each typed word (any order, any
 * case): "plain" finds "the plain font", not "explain"; "net" finds "netlist".
 */
/**
 * The commands whose words start with every typed word, best first: a command whose name starts with
 * what was typed, then one whose name has every typed word, then one found by its group or keywords
 * ("open the help" finds Open the help first, not Open the settings in "Settings and help"). Within
 * each rank the list keeps its order, and each group stays in one piece.
 */
export function filterCommands(commands: readonly Command[], query: string): Command[] {
  const typed = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!typed.length) return commands.slice();
  const split = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}_.]+/u).filter(Boolean);
  const phrase = typed.join(' ');
  const ranked: { c: Command; rank: number; i: number }[] = [];
  commands.forEach((c, i) => {
    const name = split(c.label);
    const all = [...name, ...split(c.group), ...split(c.keywords ?? '')];
    if (!typed.every((w) => all.some((x) => x.startsWith(w)))) return;
    const rank = name.join(' ').startsWith(phrase) ? 0 : typed.every((w) => name.some((x) => x.startsWith(w))) ? 1 : 2;
    ranked.push({ c, rank, i });
  });
  // Groups stay whole (the list shows each group once, under its heading): a group goes where its best
  // command ranks, and its commands keep their rank and order inside it.
  const best = new Map<string, { rank: number; i: number }>();
  for (const r of ranked) {
    const g = best.get(r.c.group);
    if (!g || r.rank < g.rank || (r.rank === g.rank && r.i < g.i)) best.set(r.c.group, { rank: r.rank, i: r.i });
  }
  const groupOf = (r: (typeof ranked)[number]): { rank: number; i: number } => best.get(r.c.group)!;
  return ranked.sort((a, b) => groupOf(a).rank - groupOf(b).rank || groupOf(a).i - groupOf(b).i || a.rank - b.rank || a.i - b.i).map((r) => r.c);
}

export function CommandPalette({ commands, onRun, onClose }: { commands: readonly Command[]; onRun: (id: string) => void; onClose: () => void }): ReactNode {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const shown = useMemo(() => filterCommands(commands, query), [commands, query]);
  const current = shown[Math.min(active, shown.length - 1)];
  // The shown commands in their groups, in order (each keeps its place in the whole list for the arrow keys).
  const groups = useMemo(() => {
    const out: { group: string; items: { c: Command; i: number }[] }[] = [];
    shown.forEach((c, i) => {
      const last = out[out.length - 1];
      if (last && last.group === c.group) last.items.push({ c, i });
      else out.push({ group: c.group, items: [{ c, i }] });
    });
    return out;
  }, [shown]);

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    // (scrollIntoView is missing where there is no layout, as in tests.)
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const runIt = (c: Command | undefined): void => {
    if (!c) return;
    onClose();
    onRun(c.id);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') setActive((a) => Math.min(shown.length - 1, a + 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Home' && e.ctrlKey) setActive(0);
    else if (e.key === 'End' && e.ctrlKey) setActive(shown.length - 1);
    else if (e.key === 'Enter') runIt(current);
    else if (e.key === 'Escape') onClose();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the rest of the page is made inert while it is open */}
      <div className="palette" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <h2 className="visually-hidden" id={`${id}-title`}>
          {t('paletteTitle')}
        </h2>
        <div className="palette__field">
          <LineIcon name="search" />
          <input
            ref={input}
            className="palette__input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={current ? `${id}-${current.id}` : undefined}
            aria-label={t('paletteLabel')}
            placeholder={t('palettePlaceholder')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="palette__esc" aria-hidden="true">
            Esc
          </kbd>
        </div>
        {/* How many commands match, said as the search is typed. */}
        <output className="visually-hidden">{query ? tn('paletteCount', shown.length) : ''}</output>
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- a filtered list a <select> cannot be */}
        <ul className="palette__list" id={`${id}-list`} role="listbox" aria-label={t('paletteTitle')} ref={list}>
          {groups.map(({ group, items }, g) => (
            // A group of options with its name, as a listbox allows (the name is read with the options).
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
            <li key={group} role="group" aria-labelledby={`${id}-g${g}`} className="palette__groupbox">
              <span className="palette__group" id={`${id}-g${g}`}>
                {group}
              </span>
              {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
              <ul role="none" className="palette__options">
                {items.map(({ c, i }) => (
                  // The ARIA combobox pattern: the field keeps the focus and moves the active option (aria-activedescendant).
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/click-events-have-key-events
                  <li role="option" aria-selected={c === current}
                    key={c.id}
                    id={`${id}-${c.id}`}
                    className={`palette__item${c === current ? ' is-active' : ''}`}
                    onPointerMove={() => setActive(i)}
                    onClick={() => runIt(c)}
                  >
                    <span className="palette__row">
                      <span className="palette__label">{c.label}</span>
                      {c.shortcut ? (
                        <kbd className="palette__key" aria-hidden="true">
                          {c.shortcut}
                        </kbd>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {shown.length === 0 ? (
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role
            <li className="palette__empty" role="option" aria-selected="false" aria-disabled="true">
              {t('paletteEmpty', { query })}
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

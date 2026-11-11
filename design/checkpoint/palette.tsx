/**
 * Ctrl+K (from the Studio direction, decision 0014): every command in one searchable list. A modal
 * dialog with a combobox and its list (ARIA 1.2 combobox pattern): type to filter, arrow keys to
 * choose, Enter to run, Escape to close; focus goes back where it was.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './icons.tsx';

export interface Command {
  /** What the page does when it is chosen (CommandPalette's onRun gets it). */
  id: string;
  /** What it does, as a short instruction: "Open the netlist". */
  label: string;
  /** A group heading: "Circuits", "Panels", "Drawing", "Parts", "Settings". */
  group: string;
  /** Extra words that should find it. */
  keywords?: string;
  /** A shortcut to show. */
  shortcut?: string;
}

/**
 * Commands whose label or keywords have a word starting with each typed word (any order, any case):
 * "plain" finds "the plain font", not "explain"; "net" finds "netlist".
 */
export function filterCommands(commands: readonly Command[], query: string): Command[] {
  const typed = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!typed.length) return commands.slice();
  return commands.filter((c) => {
    const words = `${c.label} ${c.group} ${c.keywords ?? ''}`.toLowerCase().split(/[^\p{L}\p{N}_.]+/u);
    return typed.every((t) => words.some((w) => w.startsWith(t)));
  });
}

export function CommandPalette({ commands, onRun, onClose, initialQuery = '' }: { commands: readonly Command[]; onRun: (id: string) => void; onClose: () => void; initialQuery?: string }): ReactNode {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const shown = useMemo(() => filterCommands(commands, query), [commands, query]);
  const current = shown[Math.min(active, shown.length - 1)];

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
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
  };

  return (
    <div className="ck-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the rest of the page is made inert while it is open */}
      <div className="ck-palette" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <h2 className="ck-sr" id={`${id}-title`}>
          Commands
        </h2>
        <div className="ck-palette__field">
          <Icon name="search" />
          <input
            ref={input}
            className="ck-palette__input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={current ? `${id}-${current.id}` : undefined}
            aria-label="Search or run a command"
            placeholder="Search or run a command…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="ck-palette__esc" aria-hidden="true">
            Esc
          </kbd>
        </div>
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- a filtered list a <select> cannot be */}
        <ul className="ck-palette__list" id={`${id}-list`} role="listbox" aria-label="Commands" ref={list}>
          {shown.map((c, i) => {
            const head = i === 0 || shown[i - 1]!.group !== c.group ? c.group : undefined;
            return (
              // The ARIA combobox pattern: the field keeps the focus and moves the active option (aria-activedescendant).
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/click-events-have-key-events
              <li role="option" aria-selected={c === current}
                key={c.id}
                id={`${id}-${c.id}`}
                className={`ck-palette__item${c === current ? ' is-active' : ''}`}
                data-group={head}
                onPointerMove={() => setActive(i)}
                onClick={() => runIt(c)}
              >
                {head ? (
                  <span className="ck-palette__group" aria-hidden="true">
                    {head}
                  </span>
                ) : null}
                <span className="ck-palette__row">
                  <span className="ck-palette__label">{c.label}</span>
                  {c.shortcut ? (
                    <kbd className="ck-palette__key" aria-hidden="true">
                      {c.shortcut}
                    </kbd>
                  ) : null}
                </span>
              </li>
            );
          })}
          {shown.length === 0 ? (
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role
            <li className="ck-palette__empty" role="option" aria-selected="false" aria-disabled="true">
              No command matches “{query}”.
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

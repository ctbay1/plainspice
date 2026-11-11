/**
 * The parts toolbar, with names (Tarık, decision 0014: "E, F, G and H mean nothing to a
 * beginner"): in the page's margin on a computer; on a phone, a sheet of named parts that opens
 * from the bottom bar's Parts button and starts with the controlled sources (Playground's phone
 * design). The four controlled sources are one group, each named in plain words with what it makes
 * and what sets it (the element catalog's names and value labels, src/spice/elements.ts).
 * Shortcuts are shown and work while the toolbar or the drawing has the focus (WCAG 2.1.4). One
 * tab stop; arrow keys move along it.
 *
 * Placing parts is the next step of the build: a part tool shows its ghost on the paper and the
 * hint line says so; nothing is placed.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { PartLetter } from '../../src/schematic/index.ts';
import { elementInfo } from '../../src/spice/elements.ts';
import type { ToolKind } from '../../src/notebook/index.ts';
import { Icon, ToolGlyph } from './icons.tsx';

export type Tool = 'select' | 'wire' | PartLetter | 'ground';
export type Controlled = 'E' | 'F' | 'G' | 'H';
export const CONTROLLED: readonly Controlled[] = ['E', 'F', 'G', 'H'];
export const isControlled = (t: Tool): t is Controlled => t === 'E' || t === 'F' || t === 'G' || t === 'H';

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A part's name in the catalog's words: "Resistor", "Current-controlled current source". */
export const kindName = (letter: PartLetter): string => cap(elementInfo(letter)?.name ?? letter);

/**
 * What a controlled source does, in plain words, from the catalog: "makes a current: gain × a
 * current elsewhere in the circuit". ("Reads" is kept for what SPICE does with the netlist's text.)
 */
export function controlledLine(letter: Controlled): string {
  const makes = letter === 'E' || letter === 'H' ? 'voltage' : 'current';
  const follows = letter === 'E' || letter === 'G' ? 'voltage' : 'current';
  return `makes a ${makes}: ${elementInfo(letter)?.valueLabel ?? 'gain'} × a ${follows} elsewhere in the circuit`;
}

export interface ToolDef {
  id: Tool | 'controlled';
  /** The name under the icon. */
  word: string;
  /** The shortcut shown (and its keys). */
  key: string;
  icon: ToolKind;
  group: number;
}

export const TOOLS: readonly ToolDef[] = [
  { id: 'select', word: 'Select', key: 'Esc', icon: 'select', group: 0 },
  { id: 'wire', word: 'Wire', key: 'W', icon: 'wire', group: 0 },
  { id: 'R', word: kindName('R'), key: 'R', icon: 'R', group: 1 },
  { id: 'C', word: kindName('C'), key: 'C', icon: 'C', group: 1 },
  { id: 'L', word: kindName('L'), key: 'L', icon: 'L', group: 1 },
  { id: 'V', word: kindName('V'), key: 'V', icon: 'V', group: 2 },
  { id: 'I', word: kindName('I'), key: 'I', icon: 'I', group: 2 },
  { id: 'controlled', word: 'Controlled source', key: 'E–H', icon: 'controlled', group: 2 },
  { id: 'ground', word: 'Ground', key: '0', icon: 'ground', group: 3 },
];

/** The tool a key chooses (plain letters, no modifier), or undefined. */
export function toolForKey(key: string): Tool | undefined {
  const k = key.toUpperCase();
  if (k === 'W') return 'wire';
  if (k === '0') return 'ground';
  if ('RCLVIEFGH'.includes(k) && k.length === 1) return k as PartLetter;
  return undefined;
}

/** What a tool is called in sentences ("a resistor", "a ground symbol"). */
export function toolPhrase(t: Tool): string {
  if (t === 'select') return 'Select';
  if (t === 'wire') return 'a wire';
  if (t === 'ground') return 'a ground symbol';
  const name = elementInfo(t)?.name ?? t;
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
}

interface ToolbarProps {
  tool: Tool;
  onTool: (t: Tool) => void;
}

/** The toolbar in the page's margin (a computer). */
export function PartsToolbar({ tool, onTool }: ToolbarProps): ReactNode {
  const orientation = 'vertical';
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const controlledIndex = TOOLS.findIndex((t) => t.id === 'controlled');

  const isOn = (t: ToolDef): boolean => (t.id === 'controlled' ? isControlled(tool) : t.id === tool);

  const move = (i: number): void => {
    const n = TOOLS.length;
    const j = ((i % n) + n) % n;
    setFocusIndex(j);
    refs.current[j]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    if (e.key === 'ArrowDown') move(i + 1);
    else if (e.key === 'ArrowUp') move(i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(TOOLS.length - 1);
    else if (e.key === 'ArrowRight' && TOOLS[i]?.id === 'controlled') openControlled(true);
    else return;
    e.preventDefault();
  };

  const openControlled = (focusFirst: boolean): void => {
    setMenu(true);
    if (focusFirst) requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"], button')?.focus());
  };
  const closeMenu = (focusButton: boolean): void => {
    setMenu(false);
    if (focusButton) refs.current[controlledIndex]?.focus();
  };

  // A click outside the menu closes it.
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Element;
      if (!t.closest('.ck-menu') && !t.closest('[data-tool="controlled"]')) setMenu(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menu]);

  return (
    <div className={`ck-tools ck-tools--${orientation}`}>
      <div className="ck-tools__bar" role="toolbar" aria-orientation={orientation} aria-label="Parts and tools">
        {TOOLS.map((t, i) => {
          const sep = i > 0 && TOOLS[i - 1]!.group !== t.group;
          const ctrl = t.id === 'controlled';
          const on = isOn(t);
          return (
            <div key={t.id} className="ck-tools__slot">
              {sep ? <span className="ck-tools__sep" aria-hidden="true" /> : null}
              <button
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                className={`ck-tool${on ? ' is-on' : ''}`}
                data-tool={t.id}
                tabIndex={i === focusIndex ? 0 : -1}
                aria-keyshortcuts={t.key === 'Esc' ? 'Escape' : ctrl ? 'E F G H' : t.key}
                {...(ctrl ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': menu } : { 'aria-pressed': on })}
                onFocus={() => setFocusIndex(i)}
                onKeyDown={(e) => onKeyDown(e, i)}
                onClick={() => {
                  if (ctrl) {
                    if (menu) closeMenu(false);
                    else openControlled(false);
                    return;
                  }
                  onTool(t.id === tool && t.id !== 'select' ? 'select' : (t.id as Tool));
                }}
              >
                <span className="ck-tool__icon">
                  <ToolGlyph kind={ctrl && isControlled(tool) ? tool : t.icon} />
                  <kbd className="ck-tool__key" aria-hidden="true">
                    {t.key}
                  </kbd>
                </span>
                <span className="ck-tool__word">
                  {ctrl && isControlled(tool) ? `Controlled source (${tool})` : t.word}
                  {ctrl ? <Icon name="chevron-right" className="ck-tool__caret" /> : null}
                </span>
              </button>
            </div>
          );
        })}
      </div>
      {menu ? (
        <div className="ck-menu" ref={menuRef} role="menu" aria-label="Controlled sources">
          <p className="ck-menu__title" aria-hidden="true">
            Controlled sources
          </p>
          <ControlledList
            tool={tool}
            itemRole="menuitemradio"
            onPick={(k) => {
              onTool(k);
              closeMenu(true);
            }}
            onEscape={() => closeMenu(true)}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The four controlled sources, each with its catalog name, what it does in plain words, and its key. */
export function ControlledList({ tool, itemRole, onPick, onEscape }: { tool: Tool; itemRole: 'menuitemradio' | 'radio'; onPick: (k: Controlled) => void; onEscape: () => void }): ReactNode {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    let j = i;
    if (e.key === 'ArrowDown') j = (i + 1) % CONTROLLED.length;
    else if (e.key === 'ArrowUp') j = (i + CONTROLLED.length - 1) % CONTROLLED.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = CONTROLLED.length - 1;
    else if (e.key === 'Escape' || (e.key === 'Tab' && itemRole === 'menuitemradio')) {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
      return;
    } else return;
    e.preventDefault();
    refs.current[j]?.focus();
  };
  return (
    <>
      {CONTROLLED.map((k, i) => (
        <button
          key={k}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          className="ck-ctrl"
          role={itemRole}
          aria-checked={tool === k}
          aria-keyshortcuts={k}
          tabIndex={itemRole === 'menuitemradio' ? -1 : 0}
          onClick={() => onPick(k)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          <span className="ck-ctrl__icon">
            <ToolGlyph kind={k} />
          </span>
          <span className="ck-ctrl__text">
            <span className="ck-ctrl__name">{kindName(k)}</span>
            <span className="ck-ctrl__line">{controlledLine(k)}</span>
          </span>
          <kbd className="ck-ctrl__key" aria-hidden="true">
            {k}
          </kbd>
        </button>
      ))}
    </>
  );
}

/** The phone's Parts sheet: every part tool with its name, the controlled sources first (the checkpoint is about them). */
export function PartsSheetList({ tool, onPick }: { tool: Tool; onPick: (t: Tool) => void }): ReactNode {
  const basic: ToolDef[] = TOOLS.filter((t) => t.id !== 'select' && t.id !== 'controlled');
  const row = (id: Tool, icon: ToolKind, name: string, line?: string): ReactNode => (
    <li key={id}>
      <button type="button" className="ck-ctrl" aria-pressed={tool === id} onClick={() => onPick(id)}>
        <span className="ck-ctrl__icon">
          <ToolGlyph kind={icon} />
        </span>
        <span className="ck-ctrl__text">
          <span className="ck-ctrl__name">{name}</span>
          {line ? <span className="ck-ctrl__line">{line}</span> : null}
        </span>
      </button>
    </li>
  );
  return (
    <>
      <h3 className="ck-sheet-group" id="ck-parts-controlled">
        Controlled sources
      </h3>
      <ul className="ck-ctrl-list" aria-labelledby="ck-parts-controlled">
        {CONTROLLED.map((k) => row(k, k, kindName(k), controlledLine(k)))}
      </ul>
      <h3 className="ck-sheet-group" id="ck-parts-basic">
        Parts and wires
      </h3>
      <ul className="ck-ctrl-list ck-ctrl-list--grid" aria-labelledby="ck-parts-basic">
        {basic.map((t) => row(t.id as Tool, t.icon, t.word))}
      </ul>
    </>
  );
}

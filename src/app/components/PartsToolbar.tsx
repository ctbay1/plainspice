/**
 * The parts toolbar, with names (Tarık, decision 0014: "E, F, G and H mean nothing to a
 * beginner"): in the page's margin on a computer; on a phone, a sheet of named parts that opens
 * from the bottom bar's Parts button, the parts a first course starts with first and the controlled
 * sources after them. The four controlled sources are one group, each named in plain words with
 * what it makes and what it reads (the element catalog's names and value labels,
 * src/spice/elements.ts; F and H read the current through a voltage source, as explain.ts says).
 * Shortcuts are shown and work while the toolbar or the drawing has the focus (WCAG 2.1.4). One
 * tab stop; arrow keys move along it.
 *
 * A part tool puts that part in hand: a click on the paper places it (decision 0017). The last
 * button, Add a part (A), is not a tool: it opens the form that adds a part between two nodes
 * chosen from a list, the way to build a circuit without a pointer.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { t } from '../../i18n/index.ts';
import type { ToolKind } from '../../notebook/index.ts';
import { CONTROLLED, controlledLine, isControlled, kindName, type Controlled, type Tool } from '../tools.ts';
import { LineIcon, ToolGlyph } from './Icons.tsx';

export { CONTROLLED, controlledLine, isControlled, kindName, toolForKey, toolPhrase } from '../tools.ts';
export type { Controlled, Tool } from '../tools.ts';

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
  { id: 'select', word: t('toolSelect'), key: 'Esc', icon: 'select', group: 0 },
  { id: 'wire', word: t('toolWire'), key: 'W', icon: 'wire', group: 0 },
  { id: 'R', word: kindName('R'), key: 'R', icon: 'R', group: 1 },
  { id: 'C', word: kindName('C'), key: 'C', icon: 'C', group: 1 },
  { id: 'L', word: kindName('L'), key: 'L', icon: 'L', group: 1 },
  { id: 'V', word: kindName('V'), key: 'V', icon: 'V', group: 2 },
  { id: 'I', word: kindName('I'), key: 'I', icon: 'I', group: 2 },
  { id: 'controlled', word: t('toolControlled'), key: 'E–H', icon: 'controlled', group: 2 },
  { id: 'ground', word: t('toolGround'), key: '0', icon: 'ground', group: 3 },
];

interface ToolbarProps {
  tool: Tool;
  onTool: (tool: Tool) => void;
  /** Add a part between two nodes (the form). */
  onAdd?: () => void;
}

/** The toolbar in the page's margin (a computer). */
export function PartsToolbar({ tool, onTool, onAdd }: ToolbarProps): ReactNode {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const controlledIndex = TOOLS.findIndex((x) => x.id === 'controlled');

  const isOn = (d: ToolDef): boolean => (d.id === 'controlled' ? isControlled(tool) : d.id === tool);

  /** The tools, then Add a part. */
  const count = TOOLS.length + (onAdd ? 1 : 0);
  const move = (i: number): void => {
    const n = count;
    const j = ((i % n) + n) % n;
    setFocusIndex(j);
    refs.current[j]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    if (e.key === 'ArrowDown') move(i + 1);
    else if (e.key === 'ArrowUp') move(i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(count - 1);
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

  // A tool chosen by its key while the toolbar has the focus: the toolbar's one tab stop goes to it,
  // so Enter or Space next presses that tool, not the one the focus was on.
  const toolIndex = TOOLS.findIndex((d) => (d.id === 'controlled' ? isControlled(tool) : d.id === tool));
  const [seenTool, setSeenTool] = useState(tool);
  if (seenTool !== tool) {
    setSeenTool(tool);
    if (toolIndex >= 0) setFocusIndex(toolIndex);
  }
  useEffect(() => {
    const bar = refs.current[0]?.closest('.tools__bar');
    const button = toolIndex >= 0 ? refs.current[toolIndex] : undefined;
    if (button && bar && document.activeElement instanceof HTMLElement && bar.contains(document.activeElement) && document.activeElement !== button) button.focus();
  }, [toolIndex]);

  // A click outside the menu closes it.
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Element;
      if (!target.closest('.tools-menu') && !target.closest('[data-tool="controlled"]')) setMenu(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menu]);

  return (
    <div className="tools">
      <div className="tools__bar" role="toolbar" aria-orientation="vertical" aria-label={t('partsLabel')}>
        {TOOLS.map((d, i) => {
          const sep = i > 0 && TOOLS[i - 1]!.group !== d.group;
          const ctrl = d.id === 'controlled';
          const on = isOn(d);
          return (
            <div key={d.id} className="tools__slot">
              {sep ? <span className="tools__sep" aria-hidden="true" /> : null}
              <button
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                className={`tool${on ? ' is-on' : ''}`}
                data-tool={d.id}
                tabIndex={i === focusIndex ? 0 : -1}
                aria-keyshortcuts={d.key === 'Esc' ? 'Escape' : ctrl ? 'E F G H' : d.key}
                {...(ctrl ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': menu } : { 'aria-pressed': on })}
                onFocus={() => setFocusIndex(i)}
                onKeyDown={(e) => onKeyDown(e, i)}
                onClick={() => {
                  if (ctrl) {
                    if (menu) closeMenu(false);
                    else openControlled(false);
                    return;
                  }
                  onTool(d.id === tool && d.id !== 'select' ? 'select' : (d.id as Tool));
                }}
              >
                <span className="tool__icon">
                  <ToolGlyph kind={ctrl && isControlled(tool) ? tool : d.icon} />
                  <kbd className="tool__key" aria-hidden="true">
                    {d.key}
                  </kbd>
                </span>
                <span className="tool__word">
                  {ctrl && isControlled(tool) ? t('toolControlledWith', { letter: tool }) : d.word}
                  {ctrl ? <LineIcon name="chevron-right" className="tool__caret" /> : null}
                </span>
              </button>
            </div>
          );
        })}
        {onAdd ? (
          <div className="tools__slot">
            <span className="tools__sep" aria-hidden="true" />
            <button
              ref={(el) => {
                refs.current[TOOLS.length] = el;
              }}
              type="button"
              className="tool tool--add"
              tabIndex={focusIndex === TOOLS.length ? 0 : -1}
              aria-keyshortcuts="A"
              aria-haspopup="dialog"
              onFocus={() => setFocusIndex(TOOLS.length)}
              onKeyDown={(e) => onKeyDown(e, TOOLS.length)}
              onClick={onAdd}
            >
              <span className="tool__icon">
                <LineIcon name="add" className="glyph" />
                <kbd className="tool__key" aria-hidden="true">
                  A
                </kbd>
              </span>
              <span className="tool__word">{t('toolAddPart')}</span>
            </button>
          </div>
        ) : null}
      </div>
      {menu ? (
        <div className="tools-menu" ref={menuRef} role="menu" aria-label={t('controlledMenu')}>
          <p className="tools-menu__title" aria-hidden="true">
            {t('controlledMenu')}
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
          className="part-row"
          role={itemRole}
          aria-checked={tool === k}
          aria-keyshortcuts={k}
          tabIndex={itemRole === 'menuitemradio' ? -1 : 0}
          onClick={() => onPick(k)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          <span className="part-row__icon">
            <ToolGlyph kind={k} />
          </span>
          <span className="part-row__text">
            <span className="part-row__name">{kindName(k)}</span>
            <span className="part-row__line">{controlledLine(k)}</span>
          </span>
          <kbd className="part-row__key" aria-hidden="true">
            {k}
          </kbd>
        </button>
      ))}
    </>
  );
}

/** The phone's Parts sheet: every part tool with its name, the ones a first course starts with first, then Add a part. */
export function PartsSheetList({ tool, onPick, onAdd }: { tool: Tool; onPick: (tool: Tool) => void; onAdd?: () => void }): ReactNode {
  const basic: ToolDef[] = TOOLS.filter((d) => d.id !== 'select' && d.id !== 'controlled');
  const row = (id: Tool, icon: ToolKind, name: string, line?: string): ReactNode => (
    <li key={id}>
      <button type="button" className="part-row" aria-pressed={tool === id} onClick={() => onPick(id)}>
        <span className="part-row__icon">
          <ToolGlyph kind={icon} />
        </span>
        <span className="part-row__text">
          <span className="part-row__name">{name}</span>
          {line ? <span className="part-row__line">{line}</span> : null}
        </span>
      </button>
    </li>
  );
  return (
    <>
      <h3 className="sheet-group" id="parts-basic">
        {t('partsGroupBasic')}
      </h3>
      <ul className="part-list part-list--grid" aria-labelledby="parts-basic">
        {basic.map((d) => row(d.id as Tool, d.icon, d.word))}
      </ul>
      <h3 className="sheet-group" id="parts-controlled">
        {t('partsGroupControlled')}
      </h3>
      <ul className="part-list" aria-labelledby="parts-controlled">
        {CONTROLLED.map((k) => row(k, k, kindName(k), controlledLine(k)))}
      </ul>
      {onAdd ? (
        <button type="button" className="part-row part-row--add" aria-haspopup="dialog" onClick={onAdd}>
          <span className="part-row__icon">
            <LineIcon name="add" className="glyph" />
          </span>
          <span className="part-row__text">
            <span className="part-row__name">{t('partsSheetAdd')}</span>
            <span className="part-row__line">{t('partsSheetAddLine')}</span>
          </span>
        </button>
      ) : null}
    </>
  );
}

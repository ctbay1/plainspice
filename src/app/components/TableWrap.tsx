/**
 * The box around a table. A table can be wider than a phone screen (the Currents table has five
 * columns; text can be 150 %): it then scrolls sideways inside this box, so the page itself never
 * does (WCAG 1.4.10 allows sideways scrolling for data tables, not for the page). While the box
 * scrolls it is a named region that takes keyboard focus, so it can be scrolled with the arrow keys
 * too (WCAG 2.1.1); when the table fits, it is a plain box and adds no Tab stop.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export function TableWrap({ label, children }: { label: string; children: ReactNode }): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = (): void => setScrolls(element.scrollWidth > element.clientWidth + 1);
    if (typeof ResizeObserver === 'undefined') {
      measure(); // no layout to follow (tests without a browser)
      return;
    }
    // The box changes with the window and the text size; the table, with its contents. The observer
    // also reports each box once at the start, after layout: measuring here instead forced a layout
    // of every table at once when a tab with hundreds of them opened (perf review 1).
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return scrolls ? (
    // A scrolling region must be reachable by keyboard and named (axe: scrollable-region-focusable).
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex, jsx-a11y/prefer-tag-over-role
    <div ref={box} className="table-wrap table-wrap--scrolls" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  ) : (
    <div ref={box} className="table-wrap">
      {children}
    </div>
  );
}

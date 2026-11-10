/**
 * The Examples menu (lazy-loaded with React Aria's Popover and Menu, which the first screen does
 * not need). Anchored to the toolbar's Examples button; choosing an example closes it.
 */
import type { ReactNode, RefObject } from 'react';
import { Header, Menu, MenuItem, MenuSection, Popover } from 'react-aria-components';
import { t } from '../../i18n/index.ts';
import type { MenuFocus } from '../components/AppToolbar.tsx';
import { EXAMPLE_GROUPS, EXAMPLES } from '../examples.ts';

export default function ExamplesMenu({
  triggerRef,
  focus,
  onOpenChange,
  onSelect,
}: {
  triggerRef: RefObject<HTMLButtonElement | null>;
  focus: MenuFocus;
  onOpenChange: (isOpen: boolean) => void;
  onSelect: (id: string) => void;
}): ReactNode {
  return (
    // A modal Popover is a dialog in React Aria (it keeps focus inside); it needs a name of its own.
    <Popover className="popover" triggerRef={triggerRef} isOpen onOpenChange={onOpenChange} placement="bottom start" offset={4} aria-label={t('examplesMenu')}>
      <Menu
        className="menu"
        aria-label={t('examplesMenu')}
        // React Aria's focus strategy, not the HTML autofocus attribute: a menu that has just
        // been opened takes focus on its first (or last) item (ARIA APG menu button).
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={focus}
        onAction={(key) => {
          onOpenChange(false);
          onSelect(String(key));
        }}
      >
        {EXAMPLE_GROUPS.map(({ group, labelKey }) => (
          <MenuSection key={group} className="menu__section">
            <Header className="menu__header">{t(labelKey)}</Header>
            {EXAMPLES.filter((e) => e.group === group).map((e) => (
              <MenuItem key={e.id} id={e.id} className="menu__item" textValue={t(e.nameKey)}>
                {t(e.nameKey)}
              </MenuItem>
            ))}
          </MenuSection>
        ))}
      </Menu>
    </Popover>
  );
}

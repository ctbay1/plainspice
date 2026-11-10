/** The Export menu (lazy-loaded): a netlist file for ngspice or for LTspice. */
import type { ReactNode, RefObject } from 'react';
import { Menu, MenuItem, Popover } from 'react-aria-components';
import { t } from '../../i18n/index.ts';
import type { MenuFocus } from '../components/AppToolbar.tsx';

export type ExportKind = 'ngspice' | 'ltspice';

export default function ExportMenu({
  triggerRef,
  focus,
  onOpenChange,
  onExport,
}: {
  triggerRef: RefObject<HTMLButtonElement | null>;
  focus: MenuFocus;
  onOpenChange: (isOpen: boolean) => void;
  onExport: (kind: ExportKind) => void;
}): ReactNode {
  return (
    // A modal Popover is a dialog in React Aria (it keeps focus inside); it needs a name of its own.
    <Popover className="popover" triggerRef={triggerRef} isOpen onOpenChange={onOpenChange} placement="bottom start" offset={4} aria-label={t('exportMenu')}>
      <Menu
        className="menu"
        aria-label={t('exportMenu')}
        // React Aria's focus strategy, not the HTML autofocus attribute: a menu that has just
        // been opened takes focus on its first (or last) item (ARIA APG menu button).
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={focus}
        onAction={(key) => {
          onOpenChange(false);
          onExport(key === 'ltspice' ? 'ltspice' : 'ngspice');
        }}
      >
        <MenuItem id="ngspice" className="menu__item">
          {t('exportNgspice')}
        </MenuItem>
        <MenuItem id="ltspice" className="menu__item">
          {t('exportLtspice')}
        </MenuItem>
      </Menu>
    </Popover>
  );
}

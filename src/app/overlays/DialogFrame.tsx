/** The frame every dialog shares: a modal overlay, a titled dialog and a Close button. */
import type { ReactNode } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { t } from '../../i18n/index.ts';
import { CloseIcon } from '../components/Icons.tsx';

export function DialogFrame({
  title,
  children,
  onOpenChange,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onOpenChange: (isOpen: boolean) => void;
  wide?: boolean;
}): ReactNode {
  // Open while mounted: the toolbar mounts the dialog to open it and unmounts it to close it.
  return (
    <ModalOverlay className="modal-overlay" isDismissable isOpen onOpenChange={onOpenChange}>
      <Modal className={`modal${wide ? ' modal--wide' : ''}`}>
        <Dialog className="dialog">
          {({ close }) => (
            <>
              <div className="dialog__head">
                <Heading slot="title" className="dialog__title">
                  {title}
                </Heading>
                <Button className="icon-button" onPress={close} aria-label={t('close')}>
                  <CloseIcon />
                </Button>
              </div>
              <div className="dialog__body">{children}</div>
              <div className="dialog__foot">
                <Button className="button" onPress={close}>
                  {t('close')}
                </Button>
              </div>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

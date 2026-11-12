/** The message card's contents (src/app/components/Frame.tsx, NoticeCard). */
export interface Notice {
  /** 'problem': something went wrong (shown with an error icon); 'info': for the record. */
  tone: 'info' | 'problem';
  title: string;
  text?: string;
  items?: string[];
  /** A button that does what the message suggests ("Show line 6 in the Netlist panel"). */
  action?: { label: string; run: () => void };
}

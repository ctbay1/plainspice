/** The message card's contents (src/app/components/Frame.tsx, NoticeCard). */
export interface Notice {
  /** 'problem': something went wrong (shown with an error icon); 'info': for the record. */
  tone: 'info' | 'problem';
  title: string;
  text?: string;
  items?: string[];
}

/**
 * Export: the netlist as a file for ngspice (.cir) or for LTspice (.net), and downloadFile(),
 * which saves a file from the browser.
 *
 * ngspice: the netlist exactly as written. PlainSpice runs ngspice, so the file is what ran;
 * only the line ends are tidied ("\n", and a final line break).
 *
 * LTspice: a few small changes, each one listed in `notes` with its line numbers. Every change
 * leaves the circuit the same for ngspice (tests/unit/export.test.ts runs both files through the
 * WebAssembly ngspice). We cannot run LTspice here, so nothing below claims how LTspice behaves,
 * and the notes always end with "Not checked in LTspice yet".
 *   - .control ... .endc blocks are removed: they hold ngspice commands, not parts.
 *   - "savecurrents" is removed from .options lines: it is an ngspice option.
 *   - The node gnd is written 0 wherever ngspice reads it as ground (an LTspice netlist names
 *     ground 0). ngspice 47 (and 42) reads gnd as ground only when something follows it on its
 *     line: a space, "," or ")". A gnd that ends its line is a separate node called gnd for
 *     ngspice, so it is left as written, with a note.
 * Everything else is kept as written. The rules mirror ngspice's own input code
 * (src/frontend/inpcom.c: inp_stripcomments_line, inp_stitch_continuation_lines,
 * inp_fix_gnd_name), and each was checked by running ngspice 47 and 42.
 */

/** A file ready to save. */
export interface ExportFile {
  filename: string;
  text: string;
  mime: string;
}

/** The LTspice file, and what was changed (plain words, with line numbers of the netlist as written). */
export interface LtspiceExport extends ExportFile {
  notes: string[];
}

/**
 * Every sentence and word this module shows to people, in one object so it can be translated
 * (the Turkish UI comes later). `where` is a phrase made by lineList() or lineRange().
 */
export const EXPORT_TEXT = {
  /** Used when a title gives no usable file name, and to avoid names Windows reserves. */
  defaultName: 'circuit',
  lineList: (numbers: readonly number[]): string =>
    numbers.length === 1
      ? `Line ${numbers[0]}`
      : `Lines ${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`,
  lineRange: (from: number, to: number): string => (from === to ? `Line ${from}` : `Lines ${from}–${to}`),
  controlRemoved: (where: string): string =>
    `${where}: removed the .control block. It holds commands for ngspice, not parts of the circuit.`,
  controlRemovedNoEndc: (where: string): string =>
    `${where}: removed the .control block. It has no .endc, so ngspice reads every line after .control as a command, not as part of the circuit.`,
  optionsLineRemoved: (where: string): string =>
    `${where}: removed ".options savecurrents". This option makes ngspice save the current through every part; the circuit is the same without it.`,
  optionsWordRemoved: (where: string): string =>
    `${where}: removed "savecurrents" from .options and kept the other options. It makes ngspice save the current through every part.`,
  gndWrittenAs0: (where: string): string =>
    `${where}: wrote the node gnd as 0. ngspice reads gnd as ground, and in an LTspice netlist ground is node 0.`,
  gndKept: (where: string): string =>
    `${where}: left gnd as it is. It is the last word on its line, and there ngspice does not read it as ground: it is a separate node called gnd.`,
  notChecked: 'Not checked in LTspice yet: please try it and tell us.',
};

const MIME = 'text/plain;charset=utf-8';

/** The netlist for ngspice, as written. `title` names the file; without one, the netlist's title line does. */
export function exportNgspice(netlist: string, title?: string): ExportFile {
  const text = tidy(netlist);
  return { filename: fileName(nameSource(title, text), 'cir'), text, mime: MIME };
}

/** The netlist for LTspice's File > Open, with the changes listed in `notes`. */
export function exportLtspice(netlist: string, title?: string): LtspiceExport {
  const text = tidy(netlist);
  const lines: Line[] = text
    .slice(0, -1)
    .split('\n')
    .map((t, i) => ({ number: i + 1, text: t, removed: false }));
  const notes: Note[] = [];
  const end = removeControlBlocks(lines, notes);
  const groups = logicalLines(lines, end);
  removeSavecurrents(lines, groups, notes);
  writeGroundAs0(lines, groups, notes);

  const kept = lines.filter((l) => !l.removed).map((l) => l.text);
  return {
    filename: fileName(nameSource(title, text), 'net'),
    text: `${kept.join('\n')}\n`,
    mime: MIME,
    notes: [...notes.sort((a, b) => a.line - b.line).map((n) => n.text), EXPORT_TEXT.notChecked],
  };
}

/** How long a downloaded blob stays readable. FileSaver.js uses 40 s: some browsers read the blob after click() returns, and an early revoke cancels the download. */
const REVOKE_AFTER_MS = 40_000;

/**
 * Save a file in the browser: a Blob and a temporary <a download>, removed at once. The link is
 * hidden and never focused, so focus stays on the button the person pressed (announce the
 * download in the app's live region if needed).
 */
export function downloadFile(file: ExportFile): void {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.hidden = true;
  // In the document while clicked: older Firefox ignored click() on a detached link.
  (document.body ?? document.documentElement).append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  }
}

// ------------------------------------------------------------------ text and file names

/**
 * "\n" line ends and a final line break. Share links (src/share/link.ts, normaliseNetlist) use
 * the same rule, written again here on purpose: the link format is frozen forever and export is
 * not, so a change to one must never change the other.
 */
function tidy(netlist: string): string {
  const text = netlist.replace(/\r\n?/g, '\n');
  return text.endsWith('\n') ? text : `${text}\n`;
}

/** The given title, or else the netlist's title line (SPICE's line 1). */
function nameSource(title: string | undefined, text: string): string {
  return title !== undefined && title.trim() !== '' ? title : text.slice(0, text.indexOf('\n'));
}

const MAX_NAME_LENGTH = 60;

/** Letters that NFKD does not turn into ASCII, and the two electrical symbols people put in titles. */
const SPELLED_OUT: Readonly<Record<string, string>> = {
  ı: 'i', // Turkish dotless i (İ, ç, ğ, ö, ş, ü lose their marks under NFKD)
  ß: 'ss',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  ø: 'o',
  Ø: 'O',
  ł: 'l',
  Ł: 'L',
  đ: 'd',
  Đ: 'D',
  ð: 'd',
  Ð: 'D',
  þ: 'th',
  Þ: 'Th',
  // Ω and µ each have a look-alike, so they are written as escapes:
  '\u03A9': 'ohm', // Greek capital omega
  '\u2126': 'ohm', // ohm sign
  '\u00B5': 'u', // micro sign: written u, as in SPICE values
  '\u03BC': 'u', // Greek small mu
};

/** Names Windows reserves for devices, with or without an extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * A file name that is safe everywhere: ASCII letters, digits, "-" and "_" only (so no folders,
 * no hidden files, nothing a phone or Windows refuses), at most 60 characters before the extension.
 * "* F1a: a 6 V source" -> "F1a-a-6-V-source.cir"; "Thévenin eşdeğeri, 1kΩ" -> "Thevenin-esdegeri-1kohm.cir".
 */
function fileName(title: string, extension: 'cir' | 'net'): string {
  let stem = [
    ...title
      .replace(/^[\s*#;$]+/, '') // the comment mark of a SPICE title line
      .replace(/\.(cir|net|sp|spi|spice|ckt|txt)\s*$/i, ''), // "divider.cir" -> "divider"
  ]
    .map((c) => SPELLED_OUT[c] ?? c)
    .join('')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  if (stem.length > MAX_NAME_LENGTH) {
    const cut = stem.lastIndexOf('-', MAX_NAME_LENGTH);
    stem = stem.slice(0, cut > MAX_NAME_LENGTH / 2 ? cut : MAX_NAME_LENGTH).replace(/[-_]+$/, '');
  }
  if (stem === '') stem = EXPORT_TEXT.defaultName;
  if (WINDOWS_RESERVED.test(stem)) stem = `${stem}-${EXPORT_TEXT.defaultName}`;
  return `${stem}.${extension}`;
}

// ------------------------------------------------------------------ reading lines as ngspice does

interface Line {
  /** 1-based, as written (what the editor and the notes show). */
  readonly number: number;
  text: string;
  removed: boolean;
}

interface Note {
  line: number;
  text: string;
}

/** Where a line's content starts: ngspice skips every character up to and including the space (code <= 32). */
function skipLead(text: string): number {
  let i = 0;
  while (i < text.length && text.charCodeAt(i) <= 0x20) i += 1;
  return i;
}

/** ngspice's words end at ASCII white space (C's isspace), not at Unicode spaces. */
const WORD = /^[^ \t\n\v\f\r]*/;
const firstWord = (text: string): string => WORD.exec(text.slice(skipLead(text)))?.[0] ?? '';
/** Index just after the first word (and the characters before it). */
const firstWordEnd = (text: string): number => skipLead(text) + firstWord(text).length;
/** ngspice's ciprefix(): the line starts with `prefix`, in any case (".control", ".endc"). */
const startsWithWord = (text: string, prefix: string): boolean => {
  const start = skipLead(text);
  return text.slice(start, start + prefix.length).toLowerCase() === prefix;
};
const isContinuation = (text: string): boolean => text[skipLead(text)] === '+';
const isEnd = (text: string): boolean => firstWord(text).toLowerCase() === '.end';
const isSpace = (c: string | undefined): boolean => c !== undefined && /^[ \t\n\v\f\r]$/.test(c);

/**
 * Where an end-of-line comment starts (or the line's length), as ngspice 47 finds it outside a
 * .control block: ";" anywhere after the first character, "$" after a space, tab or ",", or
 * "//"; quoted strings are skipped.
 */
function commentStart(text: string): number {
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && (text[j] !== c || text[j - 1] === '\\')) j += 1;
      i = j; // on the closing quote; the loop steps past it
      continue;
    }
    if (text[i + 1] === ';') return i + 1;
    if (c === '$' && i >= 1 && (text[i - 1] === ' ' || text[i - 1] === ',' || text[i - 1] === '\t')) return i;
    if (c === '/' && text[i + 1] === '/') return i;
  }
  return text.length;
}

/** The part of a line ngspice reads: no end-of-line comment, no spaces or tabs at the end. */
function codeOf(text: string): string {
  return text.slice(0, commentStart(text)).replace(/[ \t]+$/, '');
}

/** A line that ngspice skips: empty, only a comment, or starting with *, #, $ (or ;). */
function isComment(text: string): boolean {
  const first = text[skipLead(text)] ?? '';
  return first === '' || '*#$;'.includes(first) || codeOf(text).trim() === '';
}

/**
 * Remove .control ... .endc blocks (line 1, the title, is never one). A block with no .endc runs
 * to the end for ngspice, which then reads even .end as a command; here it stops before a
 * later .end, so the file still ends with .end. Returns the index of the .end line (the circuit
 * stops there), or the number of lines.
 */
function removeControlBlocks(lines: Line[], notes: Note[]): number {
  for (let i = 1; i < lines.length; i += 1) {
    const text = lines[i]!.text;
    if (isEnd(text)) return i;
    if (!startsWithWord(text, '.control')) continue;
    let last = lines.findIndex((l, j) => j > i && startsWithWord(l.text, '.endc'));
    const closed = last >= 0;
    if (!closed) {
      const nextEnd = lines.findIndex((l, j) => j > i && isEnd(l.text));
      last = nextEnd >= 0 ? nextEnd - 1 : lines.length - 1;
    }
    for (let j = i; j <= last; j += 1) lines[j]!.removed = true;
    const where = EXPORT_TEXT.lineRange(i + 1, last + 1);
    notes.push({ line: i + 1, text: closed ? EXPORT_TEXT.controlRemoved(where) : EXPORT_TEXT.controlRemovedNoEndc(where) });
    i = last;
  }
  return lines.length;
}

/**
 * ngspice's logical lines: a line and the "+" lines that continue it (comment and blank lines in
 * between are skipped), as indexes into `lines`. Only lines after the title and before .end.
 */
function logicalLines(lines: Line[], end: number): number[][] {
  const groups: number[][] = [];
  let open = false;
  for (let i = 1; i < end; i += 1) {
    const line = lines[i]!;
    if (line.removed) {
      open = false;
      continue;
    }
    if (isComment(line.text)) continue;
    if (open && isContinuation(line.text)) groups[groups.length - 1]!.push(i);
    else groups.push([i]);
    open = true;
  }
  return groups;
}

/** Remove the word savecurrents from .options/.option/.opt lines; drop the line if no option is left. */
function removeSavecurrents(lines: Line[], groups: number[][], notes: Note[]): void {
  for (const group of groups) {
    const head = lines[group[0]!]!;
    if (!/^\.opt(ions?)?$/i.test(firstWord(head.text))) continue;
    let changed = false;
    let optionsLeft = false;
    group.forEach((index, k) => {
      const line = lines[index]!;
      const cut = commentStart(line.text);
      // A continuation line keeps its "+"; the options are what follows it.
      const start = k === 0 ? 0 : Math.min(skipLead(line.text) + 1, cut);
      let removedHere = false;
      // The word on its own: at the start (right after a "+"), or after spaces.
      const code = line.text.slice(start, cut).replace(/(^|[ \t]+)savecurrents(?=[ \t]|$)/gi, () => {
        removedHere = true;
        return '';
      });
      // The options on this line after the change: the words after ".options", or after "+".
      const rest = (k === 0 ? code.slice(firstWordEnd(code)) : code).trim();
      if (rest !== '') optionsLeft = true;
      if (!removedHere) return;
      changed = true;
      line.text = line.text.slice(0, start) + code + line.text.slice(cut);
      // A "+" line that held only savecurrents would be left as a bare "+": drop it.
      if (k > 0 && rest === '') line.removed = true;
    });
    if (!changed) continue;
    const first = group[0]! + 1;
    const last = group[group.length - 1]! + 1;
    if (optionsLeft) {
      notes.push({ line: first, text: EXPORT_TEXT.optionsWordRemoved(EXPORT_TEXT.lineRange(first, last)) });
    } else {
      for (const index of group) lines[index]!.removed = true;
      notes.push({ line: first, text: EXPORT_TEXT.optionsLineRemoved(EXPORT_TEXT.lineRange(first, last)) });
    }
  }
}

/**
 * Write gnd as 0 exactly where ngspice reads it as ground (inp_fix_gnd_name): in a logical line,
 * after its first word, case-insensitive, with a space, "(" or "," before it and a space, ")"
 * or "," after it once comments are gone and "+" lines are joined (a "+" becomes a space).
 */
function writeGroundAs0(lines: Line[], groups: number[][], notes: Note[]): void {
  const written = new Set<number>();
  const kept = new Set<number>();
  for (const group of groups) {
    group.forEach((index, k) => {
      const line = lines[index]!;
      if (line.removed) return;
      const code = codeOf(line.text);
      const continued = k < group.length - 1;
      // ngspice starts after the first word: a part's name or a dot command is never a node.
      // On a "+" line, the "+" itself becomes the space before the first word.
      const plus = k === 0 ? -1 : code.indexOf('+');
      const from = k === 0 ? firstWordEnd(code) : plus + 1;
      const hits: number[] = [];
      // A regex, not toLowerCase(): lower-casing can change the length (Turkish İ becomes two
      // code units), which would move every position after it. Matches never overlap and the
      // search goes on 3 characters later, as ngspice's does.
      const search = /gnd/gi;
      search.lastIndex = from;
      for (let match = search.exec(code); match !== null; match = search.exec(code)) {
        const at = match.index;
        const before = at - 1 === plus ? ' ' : code[at - 1];
        const after = at + 3 < code.length ? code[at + 3] : continued ? ' ' : undefined;
        if (!(isSpace(before) || before === '(' || before === ',')) continue;
        if (isSpace(after) || after === ')' || after === ',') hits.push(at);
        else if (after === undefined) kept.add(line.number);
      }
      for (const at of hits.reverse()) line.text = `${line.text.slice(0, at)}0${line.text.slice(at + 3)}`;
      if (hits.length > 0) written.add(line.number);
    });
  }
  if (written.size > 0) {
    const numbers = [...written].sort((a, b) => a - b);
    notes.push({ line: numbers[0]!, text: EXPORT_TEXT.gndWrittenAs0(EXPORT_TEXT.lineList(numbers)) });
  }
  if (kept.size > 0) {
    const numbers = [...kept].sort((a, b) => a - b);
    notes.push({ line: numbers[0]!, text: EXPORT_TEXT.gndKept(EXPORT_TEXT.lineList(numbers)) });
  }
}

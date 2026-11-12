/**
 * Characters that are not what they look like, for the checks (src/spice/traps.ts), the explanations
 * (src/spice/explain.ts) and the netlist editor (src/editor/editor.ts). Plain TypeScript.
 *
 * ngspice reads a netlist byte by byte: it turns the micro sign µ into u, then writes every byte that
 * is not a printable ASCII character as '_' (W16 in docs/spice-facts/numbers-and-syntax.md). So:
 * - an invisible character (a zero-width space, a word joiner, a byte order mark, a soft hyphen, a
 *   direction mark ...) ends a number, and the rest of the word is ignored: 1<zero-width space>k is
 *   1 Ω (invisible-character-1 in docs/spice-facts/traps.md), and in a node name it makes another
 *   node (invisible-character-3);
 * - a letter from another alphabet that looks like a scale letter is no scale letter: 1к (Cyrillic),
 *   1κ (Greek), 1ｋ (fullwidth) are 1, and 2м is 2 (look-alike-letter-1);
 * - a node name with a letter outside a to z is written with underscores (giriş is giri__), so two
 *   names can become one node (non-ascii-node-1, -2);
 * - a character that looks like a space (a no-break, thin or ideographic space ...) is no space for
 *   ngspice, which splits words only at ASCII white space (a space, a tab ...): inside a value it ends the number, so
 *   4.7<thin space>kΩ is 4.7 Ω (space-character-1, -2, nbsp-2), and between two words it glues them
 *   into one (space-character-4, nbsp-1).
 */

import { readNumber } from './numbers.ts';

/**
 * Characters with no width that text copied from web pages and PDFs can carry: the soft hyphen,
 * the zero-width space, non-joiner and joiner, the direction marks, embeddings, overrides and
 * isolates, the word joiner and the invisible operators, and the byte order mark.
 */
export const INVISIBLE = /[­​-‏‪-‮⁠-⁤⁦-⁩﻿]/;
const INVISIBLE_ALL = new RegExp(INVISIBLE.source, 'g');

const INVISIBLE_NAMES: Readonly<Record<string, string>> = {
  '­': 'a soft hyphen',
  '​': 'a zero-width space',
  '‌': 'a zero-width non-joiner',
  '‍': 'a zero-width joiner',
  '‎': 'a left-to-right mark',
  '‏': 'a right-to-left mark',
  '‪': 'a left-to-right embedding',
  '‫': 'a right-to-left embedding',
  '‬': 'a pop directional formatting',
  '‭': 'a left-to-right override',
  '‮': 'a right-to-left override',
  '⁠': 'a word joiner',
  '⁡': 'an invisible function application',
  '⁢': 'an invisible times',
  '⁣': 'an invisible separator',
  '⁤': 'an invisible plus',
  '⁦': 'a left-to-right isolate',
  '⁧': 'a right-to-left isolate',
  '⁨': 'a first strong isolate',
  '⁩': 'a pop directional isolate',
  '﻿': 'a byte order mark',
};

/**
 * Characters that look like a space but are none for SPICE: ngspice splits words only at ASCII white
 * space (a space, a tab ...), so it reads these as part of the word (W16). Documents put a no-break, narrow no-break or thin
 * space between a number and its unit (4.7 kΩ) and between groups of digits (10 000); Chinese and
 * Japanese input gives the ideographic space; the rest are Unicode's other spaces (space-character-1
 * to -5, nbsp-1, nbsp-2 in docs/spice-facts/traps.md).
 */
export const SPACE_LIKE = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/;
const SPACE_LIKE_ALL = new RegExp(SPACE_LIKE.source, 'g');

const SPACE_NAMES: Readonly<Record<string, string>> = {
  '\u00a0': 'a no-break space',
  '\u1680': 'an ogham space mark',
  '\u2000': 'an en quad',
  '\u2001': 'an em quad',
  '\u2002': 'an en space',
  '\u2003': 'an em space',
  '\u2004': 'a three-per-em space',
  '\u2005': 'a four-per-em space',
  '\u2006': 'a six-per-em space',
  '\u2007': 'a figure space',
  '\u2008': 'a punctuation space',
  '\u2009': 'a thin space',
  '\u200a': 'a hair space',
  '\u202f': 'a narrow no-break space',
  '\u205f': 'a medium mathematical space',
  '\u3000': 'an ideographic space',
};

/** True when the text has a character that looks like a space but is none for SPICE. */
export const hasSpaceLike = (s: string): boolean => SPACE_LIKE.test(s);

/** The text with each character that looks like a space written as a space. */
export const withSpaces = (s: string): string => s.replace(SPACE_LIKE_ALL, ' ');

/** The text without its characters that look like a space. */
export const withoutSpaces = (s: string): string => s.replace(SPACE_LIKE_ALL, '');

/**
 * A scale letter, a unit, or both, as a document writes them after a number and a space: "kΩ", "MΩ",
 * "µF", "μF", "mA", "V". The scale letters and units of space-before-suffix (traps.ts), with the ohm
 * sign Ω (U+2126) and the Greek mu μ, which documents use too.
 */
const SI_SUFFIX = /^(meg|mil|[tgkmunpfa\u00b5\u03bc])?(ohms?|\u03a9|\u2126|volts?|v|amps?|a|f|h|hz|s)?$/i;
const DIGIT_GROUPS = new RegExp(`^\\d{3}(?:${SPACE_LIKE.source}\\d{3})*$`);

/** A value word read the way the document it came from meant it (spacedValue). */
export interface SpacedValue {
  /** The number before the character that looks like a space, as written ("4.7"). */
  before: string;
  /** What follows it ("kΩ", "000"; empty when it ends the word). */
  after: string;
  /** How documents use the space here: between a number and its unit, or between groups of digits. */
  kind: 'unit' | 'digits';
  /** The value written for SPICE: "4.7k", "10000"; for a capital M, mega: "1meg". */
  spice: string;
  /** What SPICE reads `spice` as. */
  value: number;
  /** After a capital M, which is mega in a document and milli in SPICE: the milli spelling ("1m") and value. */
  milli?: { spice: string; value: number };
}

/**
 * A value word with a character that looks like a space in it, read the way documents write values:
 * "4.7<thin space>kΩ" is 4.7k (a number, the space, a scale letter and a unit), "10<thin space>000" is
 * 10000 (groups of three digits), "1<thin space>MΩ" is 1meg, mega, as a document means it (SPICE would
 * read 1M as milli). A lone a or f after the space is a unit, amps or farads, not atto or femto.
 * Undefined for a word not written that way: ngspice reads such a word as one word all the same
 * (space-character-1 to -4), but what was meant is not clear.
 */
export function spacedValue(word: string): SpacedValue | undefined {
  const chars = [...word];
  const at = chars.findIndex((ch) => SPACE_LIKE.test(ch));
  if (at <= 0) return undefined;
  const before = chars.slice(0, at).join('');
  const after = chars.slice(at + 1).join('');
  const first = readNumber(before);
  if (!first || first.ignored || first.rest) return undefined;
  if (!after) return { before, after, kind: 'unit', spice: before, value: first.value };
  if (/^[+-]?\d{1,3}$/.test(before) && DIGIT_GROUPS.test(after)) {
    const spice = `${before}${withoutSpaces(after)}`;
    const r = readNumber(spice);
    return r && !r.rest ? { before, after, kind: 'digits', spice, value: r.value } : undefined;
  }
  const m = SI_SUFFIX.exec(after);
  if (!m || (!m[1] && !m[2])) return undefined;
  let scale = m[1] ?? '';
  if (!m[2] && /^[af]$/i.test(scale)) scale = '';
  if (scale && first.scale) return undefined;
  if (scale === 'M') {
    const milli = `${before}m`;
    return { before, after, kind: 'unit', spice: `${before}meg`, value: readNumber(`${before}meg`)!.value, milli: { spice: milli, value: readNumber(milli)!.value } };
  }
  const spice = `${before}${/^[\u00b5\u03bc]$/.test(scale) ? 'u' : scale.toLowerCase()}`;
  const r = readNumber(spice);
  return r && !r.rest ? { before, after, kind: 'unit', spice, value: r.value } : undefined;
}

/**
 * The name in plain words of an invisible character or of one that looks like a space, with its code
 * unless `code` is false: "a zero-width space (U+200B)", "a thin space (U+2009)"; undefined for others.
 */
export function nameOfCharacter(ch: string, code = true): string | undefined {
  const name = INVISIBLE_NAMES[ch] ?? SPACE_NAMES[ch];
  if (!name) return undefined;
  return code ? `${name} (U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})` : name;
}

/** True when the text has an invisible character. */
export const hasInvisible = (s: string): boolean => INVISIBLE.test(s);

/** The text without its invisible characters. */
export const withoutInvisible = (s: string): string => s.replace(INVISIBLE_ALL, '');

/**
 * A letter from another alphabet (or the fullwidth form) that looks like an ASCII letter or digit a
 * value can use, mapped to that character. Cyrillic а е к м о р с у х and Greek α κ ν ο ρ υ χ (and
 * the capitals that look like Latin ones) look like Latin letters; the fullwidth forms ０-９ Ａ-Ｚ ａ-ｚ come from Asian keyboards; and a minus
 * sign, dashes and the Kelvin sign come from documents. The Greek mu μ is not here: it has a check of
 * its own (greek-mu), as the micro sign is a scale letter.
 */
const LOOK_ALIKES: Readonly<Record<string, string>> = (() => {
  const map: Record<string, string> = {
    // Cyrillic
    а: 'a', е: 'e', к: 'k', м: 'm', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x',
    А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X',
    // Greek
    α: 'a', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', υ: 'u', χ: 'x',
    Α: 'A', Β: 'B', Ε: 'E', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Χ: 'X', Ζ: 'Z',
    // Signs from documents
    '−': '-', '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-',
    'K': 'K',
  };
  for (let k = 0; k < 10; k++) map[String.fromCharCode(0xff10 + k)] = String(k);
  for (let k = 0; k < 26; k++) {
    map[String.fromCharCode(0xff21 + k)] = String.fromCharCode(65 + k);
    map[String.fromCharCode(0xff41 + k)] = String.fromCharCode(97 + k);
  }
  map['．'] = '.';
  map['＋'] = '+';
  map['－'] = '-';
  return map;
})();

/** The ASCII character a look-alike stands for, or undefined. */
export const lookAlikeOf = (ch: string): string | undefined => LOOK_ALIKES[ch];

const SCRIPT_NAMES: readonly [RegExp, string][] = [
  [/[Ѐ-ӿ]/, 'Cyrillic'],
  [/[Ͱ-Ͽ]/, 'Greek'],
  [/[＀-￯]/, 'fullwidth'],
];

/**
 * A character in plain words, never the character itself where it would be invisible:
 * "a zero-width space (U+200B)", "the Cyrillic letter к, which looks like k", "a minus sign (U+2212),
 * which looks like -", "the fullwidth sign ．, which looks like a decimal point".
 */
export function describeCharacter(ch: string): string {
  const code = `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
  const invisible = INVISIBLE_NAMES[ch] ?? SPACE_NAMES[ch];
  if (invisible) return `${invisible} (${code})`;
  const like = LOOK_ALIKES[ch];
  if (!like) return `the character ${ch} (${code})`;
  const script = SCRIPT_NAMES.find(([re]) => re.test(ch))?.[1];
  if (script === 'fullwidth') return `the fullwidth ${/\d/.test(like) ? 'digit' : /[A-Za-z]/.test(like) ? 'letter' : 'sign'} ${ch}, which looks like ${like === '.' ? 'a decimal point' : like}`;
  if (script) return `the ${script} letter ${ch}, which looks like ${like}`;
  if (ch === 'K') return `the Kelvin sign ${ch} (${code}), which looks like K`;
  return `${ch === '−' ? 'a minus sign' : 'a dash'} (${code}), which looks like ${like}`;
}

/**
 * A word with its invisible characters removed and its look-alikes written as the ASCII characters
 * they look like ("1<zero-width space>k" and "1к" are both "1k"), and the characters changed, in order.
 */
export function cleanWord(word: string): { clean: string; odd: string[] } {
  let clean = '';
  const odd: string[] = [];
  for (const ch of word) {
    if (INVISIBLE.test(ch)) odd.push(ch);
    else if (LOOK_ALIKES[ch] !== undefined) {
      odd.push(ch);
      clean += LOOK_ALIKES[ch];
    } else clean += ch;
  }
  return { clean, odd };
}

/** Letters with no plain form by taking off their marks. */
const PLAIN: Readonly<Record<string, string>> = {
  ı: 'i', ß: 'ss', ø: 'o', Ø: 'O', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', đ: 'd', Đ: 'D', ł: 'l', Ł: 'L',
  þ: 'th', Þ: 'Th', ð: 'd', Ð: 'D', ħ: 'h', Ħ: 'H', ŋ: 'ng', Ŋ: 'Ng', ŀ: 'l', Ŀ: 'L',
};

/**
 * A name in plain ASCII letters, for a name ngspice would write with underscores (W16): the marks
 * taken off (ş is s, ö is o, İ is I), a few letters spelled out (ı is i, ß is ss), µ as u and
 * invisible characters dropped. A letter with no plain form (Greek, Cyrillic, an emoji ...) makes it
 * undefined, or with `drop` is left out. Among Latin letters, a letter that looks like a Latin one (the
 * Cyrillic о in оut) is that letter.
 */
export function plainLetters(name: string, drop = false): string | undefined {
  let out = '';
  // Among Latin letters, a look-alike is a slip of the keyboard (оut); a name all in Greek is meant so.
  const latin = /[A-Za-z]/.test(name);
  for (const ch of name.normalize('NFD')) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out += ch;
    else if (c === 0xb5) out += 'u';
    else if (/\p{M}/u.test(ch) || INVISIBLE.test(ch)) continue;
    else if (PLAIN[ch] !== undefined) out += PLAIN[ch];
    // A letter from another alphabet that looks like a Latin one is written as that letter (оut is out).
    else if (latin && LOOK_ALIKES[ch] !== undefined && /[A-Za-z0-9]/.test(LOOK_ALIKES[ch]!)) out += LOOK_ALIKES[ch];
    else if (!drop) return undefined;
  }
  return out;
}

/**
 * The name a node name was meant to have when it is a Latin word with letters from another alphabet
 * that look like Latin ones in it: "out" for оut (Cyrillic о); undefined otherwise. A name with no
 * Latin letter (α, Ом) is meant as written, and one with another letter outside ASCII (çоk) is not
 * only a slip of the keyboard.
 */
export function lookAlikeName(name: string): string | undefined {
  if (!/[A-Za-z]/.test(name)) return undefined;
  const { clean, odd } = cleanWord(name);
  return odd.length && !odd.some((ch) => INVISIBLE.test(ch)) && isPlainName(clean) ? clean : undefined;
}

/** True when ngspice writes the name as it is (lower case aside): every character printable ASCII, or µ. */
export function isPlainName(name: string): boolean {
  for (const ch of name) {
    const c = ch.codePointAt(0)!;
    if ((c < 0x20 || c >= 0x7f) && c !== 0xb5) return false;
  }
  return true;
}

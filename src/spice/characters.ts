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
 *   names can become one node (non-ascii-node-1, -2).
 */

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
 * which looks like -".
 */
export function describeCharacter(ch: string): string {
  const code = `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
  const invisible = INVISIBLE_NAMES[ch];
  if (invisible) return `${invisible} (${code})`;
  const like = LOOK_ALIKES[ch];
  if (!like) return `the character ${ch} (${code})`;
  const script = SCRIPT_NAMES.find(([re]) => re.test(ch))?.[1];
  if (script === 'fullwidth') return `the fullwidth ${/\d/.test(like) ? 'digit' : /[A-Za-z]/.test(like) ? 'letter' : 'sign'} ${ch}, which looks like ${like}`;
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
 * undefined, or with `drop` is left out.
 */
export function plainLetters(name: string, drop = false): string | undefined {
  let out = '';
  for (const ch of name.normalize('NFD')) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out += ch;
    else if (c === 0xb5) out += 'u';
    else if (/\p{M}/u.test(ch) || INVISIBLE.test(ch)) continue;
    else if (PLAIN[ch] !== undefined) out += PLAIN[ch];
    else if (!drop) return undefined;
  }
  return out;
}

/** True when ngspice writes the name as it is (lower case aside): every character printable ASCII, or µ. */
export function isPlainName(name: string): boolean {
  for (const ch of name) {
    const c = ch.codePointAt(0)!;
    if ((c < 0x20 || c >= 0x7f) && c !== 0xb5) return false;
  }
  return true;
}

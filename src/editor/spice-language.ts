/**
 * The SPICE language for CodeMirror: a stream parser around the tokenizer in spice-tokens.ts,
 * and the highlight tags each token type gets.
 */

import { StreamLanguage } from '@codemirror/language';
import { Tag, tags } from '@lezer/highlight';
import { START_STATE, blankLineState, tokenizeLine, type LineState, type SpiceToken, type SpiceTokenType } from './spice-tokens.ts';

/** Tags for SPICE ideas that @lezer/highlight has no tag for. Each derives from the nearest standard tag. */
export const spiceTags = {
  title: Tag.define('spiceTitle', tags.heading),
  element: Tag.define('spiceElement', tags.variableName),
  elementRef: Tag.define('spiceElementRef', tags.variableName),
  continuation: Tag.define('spiceContinuation', tags.operator),
  node: Tag.define('spiceNode', tags.labelName),
  ground: Tag.define('spiceGround', tags.labelName),
  scale: Tag.define('spiceScale', tags.unit),
  scaleCapitalM: Tag.define('spiceScaleCapitalM', tags.unit),
  ignored: Tag.define('spiceIgnored', tags.comment),
  directive: Tag.define('spiceDirective', tags.keyword),
  sourceFunction: Tag.define('spiceFunction', tags.keyword),
} as const;

export type StyledTokenType = Exclude<SpiceTokenType, 'word'>;

/** The highlight tag of each token type ('word' has no style). */
export const TOKEN_TAGS: Readonly<Record<StyledTokenType, Tag>> = {
  title: spiceTags.title,
  comment: tags.lineComment,
  control: tags.meta,
  element: spiceTags.element,
  elementRef: spiceTags.elementRef,
  continuation: spiceTags.continuation,
  node: spiceTags.node,
  ground: spiceTags.ground,
  number: tags.number,
  scale: spiceTags.scale,
  scaleCapitalM: spiceTags.scaleCapitalM,
  ignored: spiceTags.ignored,
  directive: spiceTags.directive,
  function: spiceTags.sourceFunction,
  keyword: tags.keyword,
  parameter: tags.attributeName,
  model: tags.typeName,
  expression: tags.special(tags.string),
  string: tags.string,
  operator: tags.operator,
  punctuation: tags.punctuation,
  invalid: tags.invalid,
};

/** Token names used inside the stream parser ("spice" + type), so they never clash with standard tag names. */
const tokenName = (type: StyledTokenType): string => `spice${type[0]!.toUpperCase()}${type.slice(1)}`;
const TOKEN_TABLE: { [name: string]: Tag } = Object.fromEntries(
  (Object.keys(TOKEN_TAGS) as StyledTokenType[]).map((t) => [tokenName(t), TOKEN_TAGS[t]]),
);
const NAMES = Object.fromEntries((Object.keys(TOKEN_TAGS) as StyledTokenType[]).map((t) => [t, tokenName(t)])) as Record<StyledTokenType, string>;

interface StreamState {
  line: LineState;
  /** Tokens of the current line (computed at its start, never mutated). */
  tokens: readonly SpiceToken[];
  index: number;
}

export const spiceLanguage = StreamLanguage.define<StreamState>({
  name: 'spice',
  startState: () => ({ line: START_STATE, tokens: [], index: 0 }),
  token(stream, state) {
    if (stream.sol()) {
      // Tokenize the whole line at once: a word's meaning depends on the words after it.
      const r = tokenizeLine(stream.string, state.line);
      state.line = r.state;
      state.tokens = r.tokens;
      state.index = 0;
    }
    while (state.index < state.tokens.length && state.tokens[state.index]!.to <= stream.pos) state.index++;
    const tok = state.tokens[state.index];
    if (!tok) {
      stream.skipToEnd();
      return null;
    }
    if (stream.pos < tok.from) {
      stream.pos = tok.from; // the gap before the token (spaces) gets no style
      return null;
    }
    stream.pos = tok.to;
    state.index++;
    return tok.type === 'word' ? null : NAMES[tok.type];
  },
  blankLine(state) {
    state.line = blankLineState(state.line);
    state.tokens = [];
    state.index = 0;
  },
  copyState: (s) => ({ line: s.line, tokens: s.tokens, index: s.index }),
  // Ctrl+/ comments lines out with '*', the one comment every SPICE reads.
  languageData: { commentTokens: { line: '*' } },
  tokenTable: TOKEN_TABLE,
});

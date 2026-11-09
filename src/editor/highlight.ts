/**
 * Colours and styles of the netlist editor's text.
 *
 * All colours that text sits on or is drawn in are defined here, in TypeScript, so
 * tests/unit/editor-palette.test.ts can check every pair: each text colour needs 4.5:1 on every
 * background of its mode (WCAG 1.4.3), and 7:1 on white in high-contrast mode. The CSS custom
 * properties the editor uses (--ps-syn-*, --ps-active-line, ...) are generated from these
 * objects by `editorColourTheme`, so the CSS cannot drift from what the test checked.
 *
 * Colour is never the only signal: every kind of token also differs from its neighbours in weight,
 * slant or underline (see spiceHighlightStyle), and node names are underlined by node-colours.ts.
 */

import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { NODE_PALETTE_LIGHT, NODE_PALETTE_MORE } from '../theme/nodes.ts';
import { spiceTags } from './spice-language.ts';

export type SyntaxRole =
  | 'comment' // title, comments, letters ngspice ignores, .control lines
  | 'element' // part names, nodes, punctuation
  | 'number'
  | 'scale' // scale suffixes (k, meg, m, u ...)
  | 'warn' // the dotted line under a capital M
  | 'directive' // dot commands
  | 'function' // PULSE, SIN ..., DC, AC and other keywords
  | 'parameter' // name= and model names
  | 'string' // {expressions}, 'expressions', "strings"
  | 'invalid';

export type ContrastMode = 'normal' | 'more';

/** Text colours. Normal mode echoes the Solved Circuits notebook: navy ink, pencil grey, little colour. */
export const SYNTAX_COLOURS: Readonly<Record<ContrastMode, Readonly<Record<SyntaxRole, string>>>> = {
  normal: {
    comment: '#545863', // the app's --pencil
    element: '#1E2A45', // the app's --ink
    number: '#5B3A9B',
    scale: '#A0177A',
    warn: '#8A4B00', // the app's --warn
    directive: '#0B6E75',
    function: '#1D5C8C',
    parameter: '#6B4A16',
    string: '#4E5D10',
    invalid: '#B42318', // the app's --bad
  },
  more: {
    comment: '#3A3A3A',
    element: '#000000',
    number: '#3B1F7A',
    scale: '#7A0A5C',
    warn: '#5C3200',
    directive: '#004A50',
    function: '#0B3D66',
    parameter: '#4A3000',
    string: '#3A4500',
    invalid: '#8B0000',
  },
};

/**
 * Backgrounds that editor text and node bars can sit on. `surface` is the app's --surface (the
 * editor's background). In high contrast the current line has no tint (any grey light enough for
 * the node bars to keep 4.5:1 is too faint to see); its line number is highlighted instead.
 */
export const EDITOR_BACKGROUNDS: Readonly<
  Record<ContrastMode, Readonly<{ surface: string; activeLine: string; selection: string; gutter: string; activeGutter: string }>>
> = {
  normal: { surface: '#FFFDF6', activeLine: '#F7F0DC', selection: '#D6E4F5', gutter: '#F6F1E4', activeGutter: '#EFE6CC' },
  more: { surface: '#FFFFFF', activeLine: '#FFFFFF', selection: '#C2DAF7', gutter: '#FFFFFF', activeGutter: '#E0E0E0' },
};

/** Line numbers. */
export const GUTTER_TEXT: Readonly<Record<ContrastMode, string>> = { normal: '#545863', more: '#000000' };

/** Inline results use the app's --accent-current; this is the fallback when the app does not define it. */
export const INLINE_NOTE_FALLBACK = '#8A4B00';

const syn = (role: SyntaxRole): string => `var(--ps-syn-${role}, ${SYNTAX_COLOURS.normal[role]})`;

/**
 * Token styles. Non-colour signals: the title is bold italic; comments and ignored letters italic;
 * part names bold; scale suffixes bold (a capital M also gets a dotted underline); dot commands
 * bold; PULSE/SIN bold italic; keywords bold; parameter names italic. Nodes are underlined by the
 * node marks (node-colours.ts), which also draw their colour bar.
 */
export const spiceHighlightStyle = HighlightStyle.define([
  { tag: spiceTags.title, color: syn('comment'), fontWeight: '700', fontStyle: 'italic' },
  { tag: tags.lineComment, color: syn('comment'), fontStyle: 'italic' },
  { tag: spiceTags.ignored, color: syn('comment'), fontStyle: 'italic' },
  { tag: tags.meta, color: syn('comment') },
  { tag: [spiceTags.element, spiceTags.elementRef, spiceTags.continuation], color: syn('element'), fontWeight: '700' },
  { tag: spiceTags.node, color: syn('element') },
  { tag: spiceTags.ground, color: syn('element'), fontWeight: '700' },
  { tag: tags.number, color: syn('number') },
  { tag: spiceTags.scale, color: syn('scale'), fontWeight: '700' },
  {
    tag: spiceTags.scaleCapitalM,
    color: syn('scale'),
    fontWeight: '700',
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
    textDecorationColor: syn('warn'),
    textDecorationThickness: '0.12em',
    textUnderlineOffset: '0.18em',
  },
  { tag: spiceTags.directive, color: syn('directive'), fontWeight: '700' },
  { tag: spiceTags.sourceFunction, color: syn('function'), fontWeight: '700', fontStyle: 'italic' },
  { tag: tags.keyword, color: syn('function'), fontWeight: '700' },
  { tag: tags.attributeName, color: syn('parameter'), fontStyle: 'italic' },
  { tag: tags.typeName, color: syn('parameter') },
  { tag: [tags.special(tags.string), tags.string], color: syn('string') },
  { tag: [tags.operator, tags.punctuation], color: syn('element') },
  {
    tag: tags.invalid,
    color: syn('invalid'),
    textDecorationLine: 'underline',
    textDecorationStyle: 'wavy',
    textUnderlineOffset: '0.2em',
  },
]);

function colourVars(mode: ContrastMode): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [role, colour] of Object.entries(SYNTAX_COLOURS[mode])) vars[`--ps-syn-${role}`] = colour;
  const bg = EDITOR_BACKGROUNDS[mode];
  vars['--ps-active-line'] = bg.activeLine;
  vars['--ps-selection'] = bg.selection;
  vars['--ps-gutter'] = bg.gutter;
  vars['--ps-gutter-active'] = bg.activeGutter;
  vars['--ps-gutter-text'] = GUTTER_TEXT[mode];
  (mode === 'more' ? NODE_PALETTE_MORE : NODE_PALETTE_LIGHT).forEach((c, i) => {
    vars[`--ps-node-${i + 1}`] = c;
  });
  return vars;
}

/**
 * The editor's colour variables and the rules that use them. High contrast applies with
 * html[data-contrast="more"] or the system's prefers-contrast: more. (Inside @media, CodeMirror
 * themes cannot select the editor itself, so the overrides sit on .cm-scroller, which holds the
 * text and the gutters.)
 */
export const editorColourTheme = EditorView.theme({
  '&': colourVars('normal'),
  'html[data-contrast="more"] & .cm-scroller': colourVars('more'),
  '@media (prefers-contrast: more)': { '.cm-scroller': colourVars('more') },
  '.cm-content ::selection': { backgroundColor: 'var(--ps-selection)' },
  '.cm-activeLine': { backgroundColor: 'var(--ps-active-line)' },
  '.cm-gutters': { backgroundColor: 'var(--ps-gutter)', color: 'var(--ps-gutter-text)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--ps-gutter-active)', color: 'var(--ps-syn-element)' },
});

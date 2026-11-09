/**
 * The netlist editor module. The app needs only createEditor and EDITOR_HINT; the rest is
 * exported for tests and for other modules that show netlist text (e.g. highlighted examples).
 */

export { createEditor, type EditorOptions, type InlineNote, type PlainSpiceEditor } from './editor.ts';
export { EDITOR_HINT, EDITOR_STRINGS } from './strings.ts';
export { spiceLanguage, spiceTags, TOKEN_TAGS } from './spice-language.ts';
export { spiceHighlightStyle, editorColourTheme, SYNTAX_COLOURS, EDITOR_BACKGROUNDS, GUTTER_TEXT, INLINE_NOTE_FALLBACK } from './highlight.ts';
export { tokenizeLine, tokenizeNetlist, commentStart, splitNumber, valueParts, START_STATE, type SpiceToken, type SpiceTokenType, type LineState } from './spice-tokens.ts';
export { trapsToDiagnostics, trapMessage, mapFix } from './diagnostics.ts';
export { findNodeMarks, isSafeCssColour, type NodeMark } from './node-colours.ts';

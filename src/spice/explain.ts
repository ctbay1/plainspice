/**
 * Every netlist line explained in plain words: a heading, a sentence or two, and a field table in
 * the channel's words ("name / + node / − node / value" for a voltage source, "name / from node /
 * to node / current" for a current source). Plain TypeScript: no UI framework, no DOM.
 *
 * Every statement about how SPICE behaves was checked by running native ngspice 47, native
 * ngspice 42 and our WebAssembly engine. The IDs in brackets name the claims:
 * - P, A, C, M: docs/spice-facts/explanations.md (asserted by tests/golden/facts-explain.test.ts);
 * - N, S, W, V, L: docs/spice-facts/numbers-and-syntax.md (tests/golden/facts-numbers.test.ts);
 * - trap claims such as missing-value-4 or unknown-word-1: docs/spice-facts/traps.md
 *   (tests/golden/facts-traps.test.ts).
 *
 * Words follow the project's vocabulary: a "part" is an element line, a "dot command" a directive,
 * "ground" is node 0, and every number goes through src/format/si.ts. Display text uses the true
 * minus sign (−, U+2212); netlist text is always quoted as written.
 */
import { formatNumber, formatSI } from '../format/si.ts';
import { cleanWord, describeCharacter, hasInvisible, hasSpaceLike, INVISIBLE, lookAlikeName, lookAlikeOf, nameOfCharacter, SPACE_LIKE, spacedValue, withoutInvisible, withoutSpaces, withSpaces, zeroForLetterO } from './characters.ts';
import { elementInfo, fieldLabel, type ElementInfo } from './elements.ts';
import { behaviouralKind, hasReadableCurrent } from './graph.ts';
import { nameSaysNode } from './node-words.ts';
import { readNumber } from './numbers.ts';
import { isReportOnlyParameter, lowerAscii, ngspiceName, parseNetlist } from './parse.ts';
import type {
  Element,
  ElementLetter,
  Field,
  FieldExplanation,
  FieldRole,
  LineExplanation,
  Netlist,
  NetlistLine,
  NodeInfo,
  NodeRef,
  NumberReading,
  Span,
  Token,
} from './types.ts';

const MINUS = '−';
/** ngspice's .dc loop stops when the swept value passes stop by more than this (dctrcurv.c: DBL_EPSILON * 1e3). */
const DC_TOLERANCE = 2.220446049250313e-16 * 1e3;
/** 0 °C in kelvin (ngspice's CONSTCtoK), for .dc TEMP. */
const CELSIUS_TO_KELVIN = 273.15;
/** Beyond this many points the exact loop is replaced by the formula (the count no longer matters). */
const EXACT_LOOP_LIMIT = 100_000;

// ------------------------------------------------------------------ strings

/**
 * Every sentence this module writes, in one object so a Turkish UI can replace it later.
 * Sentences are functions because other languages order the words differently.
 */
export const EXPLAIN_STRINGS = {
  ground: 'ground (node 0)',
  groundShort: 'ground',
  /**
   * A node in a sentence: "node in", as the editor, the overview and the cards say it (words review W8);
   * a name that already says node goes alone: "node1", never "node node1" (node-words.ts).
   */
  nodeWord: (name: string): string => (nameSaysNode(name) ? name : `node ${name}`),

  // ---- lines that are not parts
  titleHeading: 'Title line',
  title:
    'Line 1 is the title. SPICE always skips it, whatever it says, so a part written here would silently disappear.',
  titleBlank: 'Line 1 is the title, even when it is blank. SPICE always skips it.',
  titleLooksLikePart:
    'This line looks like a part. If you meant it as one, add a title line above it: SPICE skips line 1 whatever it says.',
  titleBackslashes: 'It ends with two backslashes, which join the next line to it, so ngspice skips line 2 as well.',
  firstLineAt: 'Line 1 starts with @: ngspice reads nothing at all, not even the title.',
  atHeading: 'A line starting with @',
  atLine: 'A line starting with @ ends the netlist here: ngspice silently reads nothing after it.',
  blankHeading: 'Blank line',
  // "Skips" for whole lines ngspice does not read, "ignores" for characters inside a line (words review W11).
  blank: 'SPICE skips blank lines.',
  commentHeading: 'Comment',
  commentStar: 'The star marks a comment, a line SPICE skips.',
  // drawing-1, S6: the drawing lines are comments; "skips" for whole lines, as the Checks and Netlist panels say.
  drawingHeading: 'Drawing lines',
  drawingHeadingOne: 'Drawing line',
  drawingLines:
    'These lines say where each part, wire and node name is drawn; PlainSpice reads them to draw the circuit. ngspice skips them: a line that starts with * is a comment.',
  drawingLine: 'This line is part of the drawing: PlainSpice keeps where the circuit is drawn in lines like it. ngspice skips it: a line that starts with * is a comment.',
  commentHash: 'A line starting with # is a comment in ngspice 47, the version PlainSpice runs, so SPICE skips it.',
  commentSemicolon: 'A line starting with ; is a comment, a line SPICE skips.',
  commentSlashes: 'A line starting with // is a comment, a line SPICE skips.',
  commentOdd: (c: string): string =>
    `ngspice turns a line starting with ${c} into a comment and skips it, with a warning ("Unusual leading characters").`,
  commentSwallows: (line: number): string =>
    `A + line below continues this comment, not the part before it, so its words are lost too (line ${line}).`,
  controlHeading: 'Command for ngspice',
  controlLine: 'A command for ngspice inside .control … .endc, not a part of the circuit.',
  starHashLine: 'A line starting with *# is a command for ngspice, not a comment: ngspice runs it.',
  hashHashLine: 'A line starting with ## is a command for ngspice, not a comment: ngspice 47 runs it like a *# line.',
  continuationHeading: 'Continuation line',
  continuation: (line: number, what: string): string =>
    `A line starting with + continues the line before it: SPICE reads it as part of line ${line}${what ? ` (${what})` : ''}.`,
  continuationShell: (line: number, what: string): string =>
    `The line before ends with two backslashes, so SPICE reads this line as part of line ${line}${what ? ` (${what})` : ''}.`,
  continuationNothing: 'There is no line before it to continue (only the title), so ngspice skips it silently.',
  continuationIntoComment: (line: number): string =>
    `The line it continues, line ${line}, is a comment, so ngspice adds these words to that comment and ignores them.`,
  continuationLost: (line: number, name: string): string =>
    `So ${name} on line ${line} does not get these words.`,
  afterEndHeading: 'After .end',
  afterEndIgnoredHeading: 'After .end: not read',
  afterAtHeading: 'After the @ line: not read',
  afterEndRead: (end: number): string =>
    `This line comes after .end (line ${end}). ngspice does not stop reading at .end, so it still reads this line. Put it above .end, where it belongs.`,
  afterEndNotRead: (end: number): string =>
    `ngspice stopped reading at line ${end}, so it skips this line.`,
  afterEndGlued: 'A comment glued to .end (.end;…) makes ngspice stop reading there.',
  afterAt: (line: number): string => `Line ${line} starts with @, so ngspice stopped reading there and skips this line.`,
  invalidHeading: 'Not a part',
  invalidDigit: (c: string): string =>
    `This line starts with ${c}, so it is not a part: a part's name starts with the letter that says what it is (R, C, L, V, I, E, F, G, H …). ngspice stops: "unknown device type".`,
  invalidBrace: (c: string): string =>
    `ngspice reads ${c} at the start of a line as the start of an expression; without its closing ${c === '{' ? '}' : c} it stops with a fatal error.`,
  invalidOther: (c: string): string =>
    `This line starts with ${c}, which is not a letter A–Z, so it is not a part. ngspice stops: "unknown device type".`,

  // ---- field labels and meanings
  labelCommand: 'command',
  nameMeaning: (letter: string, what: string): string => `the first letter, ${letter}, makes it ${withArticle(what)}`,
  oneEnd: (n: string): string => `one end is at ${n}`,
  otherEnd: (n: string): string => `the other end is at ${n}`,
  plusSide: (n: string): string => `the + side is at ${n}`,
  minusSide: (n: string): string => `the ${MINUS} side is at ${n}`,
  fromNode: (n: string): string => `the current comes from ${n}`,
  toNode: (n: string): string => `and flows to ${n}`,
  controlPlus: (n: string): string => `the + side of the voltage it reads is at ${n}`,
  controlMinus: (n: string): string => `the ${MINUS} side of the voltage it reads is at ${n}`,
  anode: (n: string): string => `the anode (+ side) is at ${n}`,
  cathode: (n: string): string => `the cathode (${MINUS} side) is at ${n}`,
  connected: (n: string): string => `connected to ${n}`,
  gndAsNode: 'the node "gnd", which is not ground here: as the last word of a line, ngspice keeps gnd as an ordinary node',
  groundWordNode: (n: string): string => `the node "${n}", which is not ground: only 0 and gnd are ground (node 0)`,
  quotedNode: (n: string): string => `the node "${n}"`,
  gndIsGround: 'ground: gnd is another name for node 0',
  /** A name like ground on its own, after a label that already says node: '+ node "ground"'. */
  quotedName: (n: string): string => `"${n}"`,
  gndLastWordNote: (name: string): string =>
    `ngspice reads gnd as ground except as the last word of a line, so here ${name} goes to an ordinary node called gnd, not to ground. Write 0 instead.`,
  groundWordNote: (n: string): string =>
    `"${n}" is an ordinary node name in ngspice: only 0 and gnd are ground (node 0). If you meant ground, write 0.`,
  controlSourceFound: (name: string, line: number, what: string): string => `it reads the current in ${name}, the ${what} on line ${line}`,
  controlSourceMissing: (name: string): string => `it reads the current in ${name}, but there is no voltage source called ${name}`,
  controlSourceWrong: (name: string, what: string): string => `it reads the current in ${name}, but ${name} is ${withArticle(what)}, not a voltage source`,
  modelFound: (name: string, line: number): string => `the model ${name}, defined on line ${line}`,
  modelMissing: (name: string): string => `the model ${name}: there is no .model line for it`,
  subcircuitFound: (name: string, line: number): string => `the subcircuit ${name}, defined on line ${line}`,
  subcircuitMissing: (name: string): string => `the subcircuit ${name}: there is no .subckt ${name}`,
  inductorFound: (name: string, line: number): string => `${name}, the inductor on line ${line}`,
  inductorMissing: (name: string): string => `${name}: there is no inductor called ${name}`,
  parameterName: (name: string): string => `${name}: a parameter`,
  parameterValue: (value: string): string => `its value, ${value}`,
  icName: 'ic: its starting value for .tran with uic',
  unknownWord: 'ngspice cannot use this word here and stops: "unknown parameter"',
  unknownWordEngine:
    'PlainSpice\'s engine cannot use this word here and stops: "unknown parameter" (native ngspice 47, with XSPICE, reads extra words on E, F, G and H lines as a polynomial)',
  reportOnlyWord: 'a value ngspice can report for this part, not one a line can set: ngspice stops ("no such parameter on this device")',
  extraWord: 'a word PlainSpice cannot place on this line',
  keywordDc: 'DC: the steady (DC) value comes next (DC is optional)',
  keywordByName: (key: string, what: string): string => `${key}=: the ${what} is given by name`,
  keywordAc: 'AC: the next number is its size in an .ac analysis',
  acMagnitude: (v: string): string => `${v}: its size in an .ac analysis (not a DC value)`,
  replacedValue: (used: string): string => `not used: ngspice reads the next number, ${used}, and uses that`,
  notUsedLeadWins: (used: string): string => `not used: the number right after the nodes wins (${used})`,
  sourceFunction: (fn: string): string => `${fn}: a source that changes over time, for .tran`,

  // ---- values
  milli: 'milli!',
  atto: 'atto!',
  femto: 'femto!',
  ignored: (letters: string): string => `'${letters}' is ignored`,
  megaNote: (text: string, shown: string, mega: string): string =>
    `SPICE ignores capital letters, so M is the same as m: milli. ${text} is ${shown}. For mega, write ${mega}.`,
  attoNote: (text: string, fix: string): string =>
    `A is atto (10⁻¹⁸), so ${text} is practically zero. Don't type units after numbers: write ${fix}.`,
  femtoNote: (text: string, fix: string): string =>
    `F is femto (10⁻¹⁵), so ${text} is tiny. Don't type units after numbers: write ${fix}.`,
  digitsAfterScaleNote: (text: string, ignored: string, scale: string, fix: string): string =>
    `ngspice ignores the '${ignored}' after the ${scale} in ${text}. For ${fix}, write a decimal point.`,
  rkmNote: (text: string, ignored: string, fix: string): string =>
    `ngspice ignores the '${ignored}' in ${text}: on resistor codes R marks the decimal point, but SPICE stops reading at it. For ${fix}, write a decimal point.`,
  greekMuNote: (text: string): string =>
    `The Greek letter μ is not a scale letter, so ngspice ignores it and everything after it in ${text}. For micro, write u.`,
  unitsIgnoredNote: (letters: string): string => `ngspice ignores '${letters}' after the number. Don't type units after numbers.`,
  // Security review F2: a character that is not what it looks like is named, never shown in quotes
  // (invisible-character-1, -4, look-alike-letter-1, -3).
  oddIgnored: (what: string, after: string): string => (after ? `${what}${what.includes(', which') ? ',' : ''} and the '${after}' after it are ignored` : `${what}${what.includes(', which') ? ',' : ''} is ignored`),
  invisibleNote: (what: string, clean: string): string =>
    `${what}, a character you cannot see, ends the number here, so ngspice ignores it and everything after it. Delete it: write ${clean}.`,
  lookAlikeNote: (what: string, clean: string): string => `${what}, is a different character for SPICE, so ngspice ignores it and everything after it. Write ${clean}.`,
  invisibleHarmless: (what: string): string => `There is ${what} in this value, a character you cannot see. ngspice ignores it, and here it changes nothing.`,
  // Its ending by part, as Checks says it (re-check critic CR1-10): a model warning on C and L, nothing on
  // a resistor read as 0 (zeroR says what ngspice 47 does then), no message elsewhere (look-alike-letter-12, -7).
  strayNote: (what: string, after: string, ending: string): string =>
    `${what} is no part of a number for SPICE, so ngspice stops reading the number at it and ignores the ${after} after it${ending}.`,
  strayModel: ", and only warns that it can't find a model with the word's name",
  strayQuiet: ', without a message',
  // re-check critic CR1-9 (look-alike-letter-10, -15): the letter O typed for the digit 0, said as Checks says it.
  letterONote: (the: string, before: string, read: string, meant: string): string =>
    `${the} after the ${before} is not the digit 0: SPICE stops reading the number at a letter, so it reads ${read}. Write ${meant}.`,
  nodeWithInvisible: (clean: string, what: string): string => `${clean} (written with ${what} in it)`,
  // Critic of the final-review fixes: a character that looks like a space is named, never shown in
  // quotes as if it were a space (space-character-1 to -4, nbsp-1, nbsp-2).
  spaceNote: (what: string, write: string): string =>
    `${what} looks like a space but is none for SPICE, so ngspice stops reading the number at it and ignores everything after it.${write ? ` ${write}` : ''}`,
  spaceWrite: (spice: string): string => `SPICE needs no space and no units: write ${spice}.`,
  spaceWriteMega: (spice: string): string => `SPICE needs no space and no units, and a capital M is milli in SPICE: for mega, write ${spice}.`,
  spaceWriteDigits: (spice: string, several: boolean): string => `Write the number without ${several ? 'them' : 'it'}: ${spice}.`,
  spaceHarmless: (what: string): string => `There is ${what} in this value, which looks like a space but is none for SPICE. ngspice ignores it and what follows it, and here that changes nothing.`,
  nodeWithSpace: (shown: string, what: string): string => `${shown} (one word for SPICE: written with ${what}, not a space)`,
  // S11: a letter from another alphabet that looks like a Latin one is named in a node's name too, as in a value (look-alike-letter-5).
  nodeWithLookAlike: (shown: string, what: string): string => `${shown} (written with ${what})`,
  /** Characters of more than one kind, or more than one character, each named (critic of the S11 fix, round 2). */
  nodeWithSeveral: (shown: string, whats: string[], space: boolean): string => {
    const last = whats[whats.length - 1]!;
    const rest = whats.slice(0, -1);
    const list = rest.length === 1 ? `${rest[0]!}${rest[0]!.includes(',') ? ',' : ''} and ${last}` : `${rest.join(', ')}, and ${last}`;
    return `${shown} (${space ? 'one word for SPICE: ' : ''}written with ${list})`;
  },
  twoNumbersNote: (first: string, second: string, used: string, why: string): string =>
    `ngspice read two numbers for the value, ${first} and ${second}, and uses the last one: ${used}.${why ? ` ${why}` : ''}`,
  twoNumbersComma: 'A comma separates words in SPICE: use a decimal point.',
  twoNumbersSign: 'A + or − after a digit or a letter starts a new word; for an exponent, write e (1e-3).',
  expression: 'an expression: ngspice works out its value before running',
  expressionParam: (name: string, value: string, line: number): string => `${value} (${name}, from .param on line ${line})`,
  paramByName: (name: string): string => `${name}: a name from a .param line, whose value ngspice uses here`,
  negativeR: 'ngspice accepts a negative resistance without a message.',
  zeroR:
    'ngspice 47 cannot use 0 Ω: it warns ("Value of resistor … is too small") and uses 10⁻¹² Ω instead, and the currents next to it come out inaccurate. To make two nodes one, give them the same name; to measure the current, use a 0 V source (the ammeter trick).',
  tinyR: 'ngspice 47 raises a resistance below 10⁻¹² Ω to 10⁻¹² Ω, with a warning ("Value of resistor … is too small").',
  missingValueRCL: (what: string): string =>
    `This ${what} has no value, so ngspice leaves it out of the circuit, with a warning ("… is not a valid ${what} instance line, ignored!").`,
  missingValueKeptR: 'This resistor has settings but no value, so ngspice keeps it at 1 mΩ, almost a wire, with a warning ("resistance too low or not given, set to 1 mOhm").',
  missingValueKept: (what: string, quantity: string): string => `This ${what} has settings but no value, so ngspice keeps it without any ${quantity}, and says nothing.`,
  missingValueSource: (unit: string): string =>
    `This source has no DC value, so in .op ngspice uses 0 ${unit} and says so in a note ("has no value, DC 0 assumed"). An AC value alone is not a DC value.`,
  // P16b: "dc" with no number after it is a DC value of 0 as far as ngspice is concerned: no note.
  dcNoNumber: (unit: string): string => `This source has dc but no number after it, so in .op ngspice uses 0 ${unit}, without a message.`,
  timeZeroValue: (fn: string, value: string): string =>
    `It has no DC value, so in .op ngspice uses the ${fn} source's value at time 0: ${value}.`,
  timeZeroValueUnknown: (fn: string): string => `It has no DC value, so in .op ngspice uses the ${fn} source's value at time 0.`,

  // ---- parts
  partHeading: (name: string, what: string, code?: string): string => `${name}: ${withArticle(what)}${code ? ` (${code})` : ''}`,
  twoTerminal: (name: string, value: string, what: string, a: string, b: string): string =>
    value ? `${name} is ${articleBefore(value)} ${value} ${what} between ${a} and ${b}.` : `${name} is ${withArticle(what)} between ${a} and ${b}.`,
  valueIsExpression: 'Its value is an expression, which ngspice works out before running.',
  // P1, P2 (the part lines in any order), S1 (line 1 is the title). "Before .end" is advice: ngspice
  // still reads a part after a plain .end (S25), which the after-end check explains.
  resistorNote: "Resistors work either way round, and the part lines can come in any order. Line 1 is always the title, and the parts go before .end.",
  capacitorNote: 'In .op and .dc a capacitor is an open circuit: no DC current flows through it.',
  inductorNote: 'In .op and .dc an inductor is a short circuit: both ends sit at the same voltage.',
  vSides: (name: string, plus: string, minusNode: string): string =>
    `${name} has its + side at ${plus} and its ${MINUS} side at ${minusNode}.`,
  vReads: (plus: string, minusNode: string, value: string): string => `SPICE reads that as V(${plus}) ${MINUS} V(${minusNode}) = ${value}.`,
  vGround: (node: string, value: string): string => `Ground is 0 V, so ${node} sits at ${value}.`,
  vAbove: (plus: string, minusNode: string, value: string): string => `So ${plus} sits ${value} above ${minusNode}.`,
  /** A negative value between two nodes: its size and the word that fits (P3), never "−3 V above" (words re-check 12). */
  vBelow: (plus: string, minusNode: string, value: string): string => `So ${plus} sits ${value} below ${minusNode}.`,
  vZero: (plus: string, minusNode: string, name: string): string =>
    `So ${plus} and ${minusNode} are at the same voltage: ${name} works like a wire. A 0 V source is how SPICE measures a current: the ammeter trick.`,
  /** A7, P4b: a source a .dc line sweeps, V or I: its own value is not the one that analysis uses. */
  vSwept: (line: number): string => `The .dc on line ${line} sweeps this source, so in that analysis its value changes.`,
  /** P3b, P4c: a source with a transient function as well as a value: .op uses the value, .tran the function (critic of words re-check 12's fix). */
  dcValueInOp: (fn: string): string => `In .op the source has that value; in .tran it follows its ${fn} from time 0 instead.`,
  vZeroCurrent: (name: string, plus: string, minusNode: string): string =>
    `Its current is the current in this branch, positive when it flows from ${plus}, through ${name}, to ${minusNode}.`,
  sourceSign: "SPICE counts a source's current as positive when it enters at the first node, here the + side, and flows through the source to the second.",
  // C1, C1b, C2: the sign follows the + side, so it depends on which side is the higher one.
  sourceSignPositive: 'So while this source delivers power, with its + side the higher one, its current is negative.',
  sourceSignNegative: 'Its value is negative, so its + side is the lower one: while it delivers power, its current is positive.',
  sourceSignGeneral: 'So a source whose + side is the higher one shows a negative current while it delivers power.',
  iPattern:
    "A current source has its own pattern: name, from node, to node, current. The current flows from the first node, through the source, into the second, the way the arrow points.",
  iPushes: (name: string, value: string, from: string, to: string): string =>
    `So ${name} pushes ${value} from ${from}, through the source, into ${to}.`,
  /** A negative value (P4): the size, and the current the way it flows, from the second node into the first (words re-check 12). */
  iPushesBack: (name: string, value: string, from: string, to: string): string =>
    `Its value is negative, so the current flows the other way: ${name} pushes ${value} from ${from}, through the source, into ${to}.`,
  iPushesNoValue: (name: string, from: string, to: string): string =>
    `So ${name} pushes its current from ${from}, through the source, into ${to}.`,
  voltageAt: (node: string, ref: string): string => `the voltage at ${node}, measured from ${ref}`,
  voltageOfNode: (node: string): string => `the voltage at ${node}`,
  voltageBetweenNodes: (a: string, b: string): string => `the voltage between ${a} and ${b}`,
  eSentence: (out: string, gain: string, control: string): string => `${capitalise(out)}, is ${gain} × ${control}.`,
  eReads: (p: string, n: string, gain: string, cp: string, cn: string): string =>
    `SPICE reads it as V(${p}) ${MINUS} V(${n}) = ${gain} × (V(${cp}) ${MINUS} V(${cn})).`,
  gSentence: (gm: string, control: string, from: string, to: string): string =>
    `${gm} for every volt ${control}, pushed from ${from} into ${to}.`,
  gAt: (node: string): string => `at ${node}`,
  gBetween: (p: string, n: string): string => `between ${p} and ${n}`,
  gReads: (gm: string, cp: string, cn: string, from: string, name: string, to: string): string =>
    `SPICE reads it as a current of ${gm} × (V(${cp}) ${MINUS} V(${cn})) flowing from ${from}, through ${name}, into ${to}.`,
  fSentence: (gain: string, control: string, from: string, to: string): string =>
    `${gain} × the current in ${control}, pushed from ${from} into ${to}.`,
  hSentence: (out: string, r: string, control: string): string => `${capitalise(out)}, is ${r} for every amp in ${control}.`,
  controlCurrentSign: (control: string, plus: string, minusNode: string): string =>
    `The current in ${control} counts as positive when it flows from its + side (${plus}), through ${control}, to its ${MINUS} side (${minusNode}).`,
  ammeterTrick:
    'F and H read a current. But SPICE can only read the current through a voltage source. So first, put a 0 V source in the branch you want to measure: the ammeter trick.',
  controlMissingNote: (name: string): string =>
    `There is no voltage source called ${name} in this netlist, so ngspice stops: "unknown controlling source".`,
  controlWrongNote: (name: string, what: string): string =>
    `${name} is ${withArticle(what)}, and ngspice can only read the current of a voltage source (V, a controlled one, E or H, or a B line with V=), so it stops: "unknown controlling source".`,
  controlBCurrentNote: (name: string): string =>
    `${name} has I=, so it is a current source with no current of its own to read: ngspice accepts the name, warns "singular matrix" and stops.`,
  bCurrentSource: 'behavioural source with I= (a current source)',
  eFieldsNote: 'An E or G line needs four nodes and a number. With fewer, PlainSpice\'s engine finds no single answer (a singular matrix) and gives no results.',
  noGainNote: (word: string): string =>
    `This line has no ${word}. PlainSpice's engine (built without XSPICE) reads it as 0 and says nothing, so the output is 0; native ngspice 47 stops: "not enough parameters in line".`,
  // missing-value-11, -12: settings ("gain" with no number, "m=2") but no value: 0 in native 47, 42 and our engine.
  settingsNoGainNote: (word: string): string => `This line has settings but no ${word}, so ngspice uses 0 and says nothing: the output is 0.`,
  gainRatio: (gain: string, what: string): string => `${gain}: the output ${what} is ${gain} × the ${what} it reads`,
  gmMeaning: (gm: string): string => `${gm} for every volt it reads (amps per volt)`,
  rmMeaning: (r: string): string => `${r} for every amp it reads (volts per amp, which is ohms)`,
  kSentence: (name: string, l1: string, l2: string, k: string): string =>
    `${name} couples ${l1} and ${l2} magnetically, like the two windings of a transformer, with coupling coefficient ${k}.`,
  kMeaning: (k: string): string => `${k}: the coupling coefficient k`,
  kMissingNote: (name: string): string =>
    `There is no inductor called ${name}, so ngspice stops: "coupling to non-existent inductor".`,
  otherPart: (name: string, what: string, nodes: string): string =>
    nodes ? `${name} is ${withArticle(what)}: ${nodes}.` : `${name} is ${withArticle(what)}.`,
  notExplained: 'PlainSpice explains R, C, L, V, I, E, F, G, H and K lines field by field; for this part it shows the fields and what ngspice needs.',
  needs: (what: string): string => `ngspice needs ${what}.`,
  notInEngine: "PlainSpice's engine cannot run this line.",
  modelMissingNote: (name: string): string =>
    `There is no .model line called ${name}, so ngspice stops: it cannot find the model.`,
  modelLeftOutNote: (name: string, level: string, model: string, kind: string, message: string): string =>
    `The .model line for ${name} uses level=${level}, which selects ${model}, ${kind} that PlainSpice's engine leaves out. ngspice stops: "${message}".`,
  subcircuitMissingNote: (name: string): string => `There is no .subckt ${name}, so ngspice stops: "unknown subckt".`,
  bMalformedNote: 'A B line needs an expression, V=… or I=…; without one ngspice stops with a fatal error.',
  bVoltage: 'V=: the voltage between the + node and the − node is the expression that follows',
  bCurrent: 'I=: the current from the + node, through the source, to the − node is the expression that follows',
  bExpression: 'part of the expression ngspice works out',
  bNoExpression: 'a word with no V= or I= before it: ngspice stops with a fatal error',
  /** A label that already says node: "+ node c"; before a name that says node itself, the label without it: "+ node1". */
  labelledNode: (label: string, n: string): string => (nameSaysNode(n) ? `${label.replace(/\s*node$/, '')} ${n}`.trim() : `${label} ${n}`),
  /** Any other label: "collector at node c". */
  labelledAt: (label: string, n: string): string => `${label} at ${n}`,
  listJoin: (items: readonly string[]): string =>
    items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`,
  insideSubcircuit: (name: string, line: number): string =>
    `This part belongs to the subcircuit ${name} (from line ${line}): its nodes are the subcircuit's own.`,
  /**
   * A3f: an analysis line in a subcircuit no X line uses does not run (critic of the words re-check's fix,
   * round 2). ngspice "skips" it, the word for a whole line (W11, last pass F2).
   */
  analysisInUnusedSubcircuit: (name: string, line: number): string =>
    `ngspice skips this line: it is inside the subcircuit ${name} (from line ${line}), and no X line uses that subcircuit. Put analysis lines in the main circuit, outside .subckt … .ends.`,
  /**
   * A3h: ngspice's name for a node inside a subcircuit an X line uses (x1.m), read back: the node, its
   * subcircuit, and the X lines that lead to it, from the inside out ("X2, inside X1").
   */
  innerNodeNote: (name: string, node: string, subcircuit: string, line: number, inside: string, many: boolean): string =>
    `${name} is ngspice's name for ${node} of the subcircuit ${subcircuit} (from line ${line}), inside ${inside}: ngspice names a node inside a subcircuit by ${many ? 'its X lines, each followed by a dot' : 'its X line, then a dot'}.`,
  /** A3h: the same for a part (v.x1.vs): its first letter, the X lines and its own name. */
  innerPartNote: (name: string, part: string, subcircuit: string, line: number, inside: string, many: boolean): string =>
    `${name} is ngspice's name for ${part} of the subcircuit ${subcircuit} (from line ${line}), inside ${inside}: ngspice names a part inside a subcircuit by its first letter, ${many ? 'its X lines' : 'its X line'} and its own name, joined by dots.`,

  // ---- dot commands
  dotHeading: (name: string, what: string): string => `${name}: ${what}`,
  opWhat: 'operating point',
  op: 'Find the DC operating point: every node voltage and the current in every voltage source. Capacitors act as open circuits and inductors as short circuits.',
  opSaveCurrents: 'ngspice saves the current through every part only with .options savecurrents; PlainSpice adds that line to the copy it runs.',
  tfWhat: 'transfer function',
  tf: (out: string, input: string, at: string): string =>
    `Find three DC quantities: the transfer function ${out}/${input} (output ÷ input), the input resistance seen by ${input}, and the output resistance ${at}, which is the Thévenin resistance seen ${at}. ngspice calls the two resistances "impedance"; at DC they are resistances, in ohms.`,
  tfAt: (node: string): string => `at ${node}`,
  tfBetween: (a: string, b: string): string => `between ${a} and ${b}`,
  tfCurrent: (out: string, input: string): string =>
    `Find the transfer function ${out}/${input} (output ÷ input) and the input resistance seen by ${input}. ngspice calls the input resistance "input impedance"; at DC it is a resistance, in ohms.`,
  tfCurrentNote:
    'For a current output, ngspice reports an "output impedance" of 1e20 Ω, a stand-in number rather than a resistance of your circuit.',
  tfRatio: (ratio: string): string => `The transfer function is in ${ratio}.`,
  tfOutputV: (node: string, ref: string): string => `the output: ${ref === '' ? `the voltage at ${node}, measured from ground` : `the voltage at ${node}, measured from ${ref}`}`,
  tfOutputI: (source: string): string => `the output: the current in ${source}`,
  tfInput: (name: string, line: number, what: string): string => `the input: ${name}, the ${what} on line ${line}`,
  tfInputMissing: (name: string): string => `the input: ${name}, but there is no source called ${name}`,
  tfInputWrong: (name: string, what: string): string => `the input: ${name}, but ${name} is ${withArticle(what)}`,
  tfNodeMissingNote: (node: string): string =>
    `${node} is not a node of the circuit: ngspice says nothing and reports a transfer function of 0.`,
  tfInputMissingNote: (name: string): string => `There is no source called ${name}, so ngspice runs no analysis.`,
  tfInputWrongNote: (name: string): string =>
    `The input of .tf must be a voltage source (V) or a current source (I); ${name} is neither, so ngspice runs no analysis.`,
  dcWhat: 'DC sweep',
  dc: (sweep: string, points: string): string => `Sweep ${sweep}${points}. At each point ngspice finds the DC operating point (capacitors open, inductors short).`,
  dcSweep: (source: string, start: string, stop: string, step: string): string => `${source} from ${start} to ${stop} in steps of ${step}`,
  dcPoints: (n: number): string => `: ${n} ${n === 1 ? 'point' : 'points'}`,
  dcNested: (inner: string, outer: string, total: number): string =>
    `For each value of ${outer}, ${inner} runs through all its values: ${total} points in all.`,
  dcNoPoints: 'With these numbers the sweep has no points (start is past stop for this step), so ngspice runs nothing and says nothing.',
  // In two sweeps a sweep the wrong way never moves (traps.md, dc-sweep-problems-20, -21; re-check critic CR2-4).
  dcStuckSecond: (name: string, start: string, first: string): string =>
    `With these numbers this sweep goes the wrong way and never moves: ngspice computes the sweep of ${first} once, with ${name} at its start, ${start}, and says nothing.`,
  dcStuckFirst: (name: string, start: string, second: string): string =>
    `With these numbers this sweep goes the wrong way and never moves: ngspice keeps ${name} at its start, ${start}, takes ${second} from its second value on, and says nothing.`,
  dcStepZero: 'A step of 0 (or no step at all) stops ngspice 47: "Bad syntax!".',
  dcNotNumber: 'not a number for SPICE (see Checks)',
  dcNotNumberNote: 'A word that is no number where a number goes stops ngspice 47: "Bad syntax!".',
  // re-check critic CR1-11: a .dc line ngspice 47 cannot read is never told as a sweep that runs.
  dcStops: 'ngspice 47 stops at this line ("Bad syntax!") and sweeps nothing: see Checks.',
  dcSourceMissing: (name: string): string => `There is no ${name} in the circuit, so ngspice stops: the source to sweep "is not in the circuit".`,
  dcSourceWrong: (name: string, what: string): string =>
    `${name} is ${withArticle(what)}, and .dc sweeps only a voltage source, a current source, a resistor or the temperature, so ngspice stops: the source to sweep "is not in the circuit".`,
  dcSourceWrongField: (name: string, what: string): string => `${name}: ${withArticle(what)}, which .dc cannot sweep`,
  dcSourceField: (name: string, line: number, what: string): string => `the ${what} ${name} (line ${line}), the one to sweep`,
  dcSourceTemp: 'the temperature, in °C',
  dcSourceMissingField: (name: string): string => `${name}: there is no voltage source, current source or resistor called ${name}`,
  dcStart: (v: string): string => `start: ${v}`,
  dcStop: (v: string): string => `stop: ${v}`,
  dcStep: (v: string): string => `step: ${v}`,
  tranWhat: 'transient analysis (over time)',
  tran: (stop: string, start: string, maxStep: string): string =>
    `Simulate over time from 0 to ${stop}${start ? `, saving the results from ${start} on` : ''}. ngspice picks its own time points, at most ${maxStep} apart.`,
  tranMaxStepRule: 'Without tmax, the largest step is the smaller of tstep and (tstop − tstart)/50.',
  tranStep: (v: string): string => `tstep: ${v}, which limits how far apart ngspice's time points can be`,
  tranIncomplete: 'Simulate over time, but this line has no stop time.',
  tranStop: (v: string): string => `tstop: ${v}, when the simulation ends`,
  tranStart: (v: string): string => `tstart: ${v}, where the saved results begin`,
  tranMax: (v: string): string => `tmax: ${v}, the largest time step`,
  tranUic: 'uic: start from the ic= values and the .ic voltages, not from the operating point',
  tranOneNumber: 'ngspice needs a step and a stop time: with one number it stops ("TSTOP is invalid").',
  tranStepZero: 'The step must be more than 0: ngspice stops ("TSTEP is invalid").',
  tranStartLate: 'tstart must come before tstop: ngspice stops ("TSTART is invalid").',
  acWhat: 'AC analysis (frequency response)',
  ac: (from: string, to: string, per: string, points: string): string =>
    `Find the small-signal frequency response from ${from} to ${to}, ${per}${points}. The sources' AC values (AC …) drive it.`,
  acPerDecade: (n: string): string => `${n} points per decade`,
  acPerOctave: (n: string): string => `${n} points per octave`,
  acLinear: (n: string): string => `${n} points in all, evenly spaced`,
  acType: (t: string): string => `${t}: how the points are spaced`,
  acStart: (v: string): string => `start frequency: ${v}`,
  acStop: (v: string): string => `stop frequency: ${v}`,
  acNotShown: 'PlainSpice does not show .ac results yet: ngspice runs the analysis, and the ngspice output tab shows what it printed.',
  endWhat: 'end of the netlist',
  end: 'The end of the netlist.',
  endKeepsReading: 'ngspice does not stop reading at .end: it still reads the lines after it. Keep .end as the last line.',
  endGlued: 'A comment glued to .end (.end;…) makes ngspice stop reading here.',
  optionsWhat: 'settings for ngspice',
  options: 'Settings for ngspice.',
  optionSaveCurrents: 'savecurrents: save the current through every part (R, C, L, F, G, I, B, diodes, transistors), not only the voltage sources',
  optionGeneric: (name: string): string => `${name}: an ngspice setting`,
  optionValue: (v: string): string => `its value, ${v}`,
  paramWhat: 'named numbers',
  param: 'Gives a name to a number: write the name in braces, {name}, where you need the number.',
  paramName: (name: string): string => `${name}: the name`,
  paramValue: (v: string): string => `its value, ${v}`,
  modelWhat: 'a model for parts',
  model: (name: string, kind: string): string => `Defines the model ${name}${kind ? ` for ${kind}` : ''}: parts that name ${name} use its parameters.`,
  modelName: (name: string): string => `${name}: the model's name, which parts refer to`,
  modelType: (t: string, kind: string): string => (kind ? `${t}: a model for ${kind}` : `${t}: the type of model`),
  includeWhat: 'read another file',
  include:
    'Reads another file into the netlist. PlainSpice runs in your browser and has no other files to give ngspice, so ngspice stops: "Could not find include file".',
  libWhat: 'read a library file',
  lib: 'Reads part of a library file into the netlist. PlainSpice runs in your browser and has no other files to give ngspice, so ngspice stops.',
  fileName: (f: string): string => `${f}: the file to read`,
  libOneWord: 'ngspice\'s .lib takes two words, the file and the section; with one word it does not recognise the line and stops: "unimplemented dot command".',
  printWhat: (name: string): string => (name === '.plot' ? 'plot in text' : 'print a table'),
  print: (name: string): string =>
    `Asks ngspice to ${name === '.plot' ? 'plot results as text' : 'print a table of results'}. PlainSpice's engine writes a results file instead, and then ngspice leaves the ${name} line out ("${name} line ignored since rawfile was produced"). PlainSpice shows the results itself, so you don't need it.`,
  saveWhat: 'choose what to save',
  save: (what: string): string =>
    `Tells ngspice which results to keep. With .save, the results file holds only what .save names${what ? ` (${what})` : ''}, so PlainSpice can show only those.`,
  vectorField: (v: string): string => `${v}: a result to keep`,
  analysisField: (a: string): string => `${a}: which analysis it is about`,
  libSection: (sct: string): string => `${sct}: the section of the library to read`,
  controlWhat: 'start of ngspice commands',
  control:
    'Lines from here to .endc are commands for ngspice, not parts of the circuit. ngspice runs them first, before the analyses of the dot commands; PlainSpice shows the results of the dot commands.',
  endcWhat: 'end of ngspice commands',
  endc: 'Ends the block of ngspice commands that .control started.',
  icWhat: 'starting voltages for .tran',
  ic: 'Sets starting node voltages for .tran: with uic on the .tran line, the simulation starts from them.',
  icField: (v: string, value: string): string => `${v} starts at ${value}`,
  measWhat: 'a measurement',
  meas:
    'Asks ngspice to measure something after the analysis. PlainSpice\'s engine writes a results file, and then ngspice skips .meas ("No .measure possible in batch mode (-b) with -r rawfile set!").',
  subcktWhat: 'start of a subcircuit',
  subckt: (name: string, nodes: string): string =>
    `Starts the subcircuit ${name}${nodes ? `, with the nodes ${nodes}` : ''}. The parts up to .ends belong to it; an X line uses it.`,
  subcktName: (name: string): string => `${name}: the subcircuit's name, which X lines refer to`,
  subcktNode: (n: string): string => `${n}: a node X lines connect to`,
  endsWhat: 'end of a subcircuit',
  ends: 'Ends the subcircuit that .subckt started.',
  knownWhat: 'an ngspice dot command',
  known: (name: string): string => `${name} is a dot command ngspice knows. PlainSpice does not explain it yet.`,
  otherAnalysisWhat: 'another ngspice analysis',
  otherAnalysis: (name: string): string => `${name} is another ngspice analysis. PlainSpice does not explain it or its results yet.`,
  unknownWhat: 'unknown dot command',
  unknown: (name: string): string => `ngspice does not know the dot command ${name}, so it stops: "unimplemented dot command".`,
  argument: (k: number): string => `argument ${k}`,
} as const;

/** "a resistor", "an inductor" (and "a uniform RC line"). */
function withArticle(what: string): string {
  return /^[aeiou]/i.test(what) && !/^(uni|one)/i.test(what) ? `an ${what}` : `a ${what}`;
}

/**
 * The article before a number written in digits, chosen by how it is said: "an 8 Ω resistor"
 * (eight), "an 11 kΩ resistor" (eleven), "an 18 V source" (eighteen), but "a 1.5 kΩ resistor".
 */
export function articleBefore(value: string): string {
  return value.startsWith('8') || /^1[18](?![\d])/.test(value) ? 'an' : 'a';
}

function capitalise(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

const S = EXPLAIN_STRINGS;

// ------------------------------------------------------------------ the netlist's context

interface ParamValue {
  line: number;
  reading: NumberReading;
}

interface Context {
  /** Element line index by lower-case part name (the first one, as ngspice keeps it). */
  elements: Map<string, number>;
  /** .model line index by lower-case model name. */
  models: Map<string, number>;
  /** .subckt line index by lower-case subcircuit name. */
  subckts: Map<string, number>;
  /** For each line inside a .subckt … .ends: the .subckt line. */
  insideSubckt: Map<number, number>;
  /** .param values that are plain numbers. */
  params: Map<string, ParamValue>;
  /** Every name a top-level .param line defines (after .end too), with any value (an expression too), lower-case. */
  paramNames: Set<string>;
  /** Line where ngspice stops reading: the .end line or a line starting with '@'. */
  stop?: number;
  /** ngspice stops at the .end line itself (".end;comment") rather than reading on. */
  endStops: boolean;
  /** Lines continued by each line (the reverse of NetlistLine.continues). */
  continuedBy: Map<number, number[]>;
  hasSaveCurrents: boolean;
  reltol: number;
  /** Lower-case names of the parts a .dc line sweeps, with the first .dc line that sweeps each. */
  swept: Map<string, number>;
  /** For each drawing line, the first and last line (0-based) of its run of drawing lines. */
  drawing: Map<number, readonly [first: number, last: number]>;
}

/**
 * A drawing line: "* plainspice-drawing v1" or a comment starting with "*@", read the way
 * src/schematic/format.ts reads them (isDrawingLine; the model does not import the drawing code).
 * ngspice skips them, since a line starting with * is a comment (drawing-1 in
 * docs/spice-facts/drawing.md, S6).
 */
const DRAWING_HEADER = /^\s*\*\s*plainspice-drawing\b/i;
const DRAWING_LINE = /^\s*\*@/;
export const isDrawingComment = (line: NetlistLine): boolean => line.kind === 'comment' && (DRAWING_LINE.test(line.text) || DRAWING_HEADER.test(line.text));

const contexts = new WeakMap<Netlist, Context>();

function contextOf(netlist: Netlist): Context {
  const cached = contexts.get(netlist);
  if (cached) return cached;
  const ctx: Context = {
    elements: new Map(),
    models: new Map(),
    subckts: new Map(),
    insideSubckt: new Map(),
    params: new Map(),
    paramNames: new Set(),
    endStops: false,
    continuedBy: new Map(),
    hasSaveCurrents: false,
    reltol: 1e-3,
    swept: new Map(),
    drawing: new Map(),
  };
  const open: number[] = [];
  let run: number | undefined;
  const closeRun = (last: number): void => {
    if (run === undefined) return;
    const span = [run, last] as const;
    for (let k = run; k <= last; k++) ctx.drawing.set(k, span);
    run = undefined;
  };
  for (const line of netlist.lines) {
    if (isDrawingComment(line)) run ??= line.index;
    else closeRun(line.index - 1);
    if (line.continues !== undefined) {
      const list = ctx.continuedBy.get(line.continues);
      if (list) list.push(line.index);
      else ctx.continuedBy.set(line.continues, [line.index]);
    }
    const inside = open[open.length - 1];
    if (inside !== undefined && line.kind !== 'title') ctx.insideSubckt.set(line.index, inside);
    if (line.element && !ctx.elements.has(line.element.key)) ctx.elements.set(line.element.key, line.index);
    const d = line.directive;
    if (d) {
      const first = d.args[0];
      if (d.name === '.model' && first) ctx.models.set(lowerAscii(first.text), line.index);
      if ((d.name === '.subckt' || d.name === '.macro') && first) {
        ctx.subckts.set(lowerAscii(first.text), line.index);
        open.push(line.index);
        ctx.insideSubckt.delete(line.index);
      }
      if (d.name === '.ends' || d.name === '.eom') {
        open.pop();
      }
      // A .param line inside a subcircuit is that subcircuit's: no value for a part at the top level
      // (unknown-word-34; re-check critic CR1-7).
      if (d.name === '.param' && open.length === 0) addParams(ctx, netlist, line.index, d.args);
      if (d.name === '.dc') {
        for (let k = 0; k < d.args.length; k += 4) {
          const key = lowerAscii(d.args[k]!.text);
          if (!ctx.swept.has(key)) ctx.swept.set(key, line.index);
        }
      }
      if (d.name === '.options' || d.name === '.option' || d.name === '.opt') {
        for (const [name, value] of pairs(netlist, d.args)) {
          const key = lowerAscii(name.text);
          if (key === 'savecurrents') ctx.hasSaveCurrents = true;
          if (key === 'reltol' && value) {
            const r = readNumber(value.text);
            if (r && r.value > 0) ctx.reltol = r.value;
          }
        }
      }
    }
    // ngspice reads a .param line after .end too, even after .end;comment (unknown-word-36, -37).
    if (line.kind === 'after-end' && lowerAscii(line.tokens[0]?.text ?? '') === '.param') addParams(ctx, netlist, line.index, line.tokens.slice(1));
    if (ctx.stop === undefined && line.index > 0 && line.kind === 'invalid' && line.text.trimStart().startsWith('@')) {
      ctx.stop = line.index;
    }
  }
  closeRun(netlist.lines.length - 1);
  if (netlist.end !== undefined && (ctx.stop === undefined || netlist.end < ctx.stop)) {
    ctx.stop = netlist.end;
    ctx.endStops = endIsGlued(netlist.lines[netlist.end]!);
  }
  contexts.set(netlist, ctx);
  return ctx;
}

/** ".end;comment": the comment glued to .end makes ngspice stop reading there (S27). */
function endIsGlued(line: NetlistLine): boolean {
  const t = line.text.trimStart();
  return t.length > 4 && !/\s/.test(t[4]!);
}

/** name=value pairs of a dot command (and lone names, with no value). */
/** The names a top-level .param line defines, with their values when they are plain numbers. */
function addParams(ctx: Context, netlist: Netlist, line: number, args: readonly Token[]): void {
  for (const [name, value] of pairs(netlist, args)) {
    if (!value) continue;
    const reading = readNumber(value.text);
    if (reading && !reading.ignored && !reading.rest) ctx.params.set(lowerAscii(name.text), { line, reading });
    ctx.paramNames.add(lowerAscii(name.text));
  }
}

function pairs(netlist: Netlist, args: readonly Token[]): [Token, Token | undefined][] {
  const out: [Token, Token | undefined][] = [];
  for (let k = 0; k < args.length; k++) {
    const name = args[k]!;
    const next = args[k + 1];
    if (next && netlist.text.slice(name.to, next.from).includes('=')) {
      out.push([name, next]);
      k += 1;
    } else out.push([name, undefined]);
  }
  return out;
}

// ------------------------------------------------------------------ numbers and units

/** The unit symbol of a part's main value, for formatSI ('' for a ratio). */
function unitOf(letter: ElementLetter | undefined): string {
  switch (letter) {
    case 'R':
      return 'Ω';
    case 'C':
      return 'F';
    case 'L':
      return 'H';
    case 'V':
      return 'V';
    case 'I':
      return 'A';
    default:
      return '';
  }
}

/** A number in plain units: "1 mΩ", or a plain number when there is no unit. */
function plain(value: number, unit: string): string {
  return unit ? formatSI(value, unit) : formatNumber(value);
}

export interface ValueWords {
  /** For the field table: "1 mΩ (milli!)", "10 kΩ ('Ohm' is ignored)". */
  text: string;
  /** The value ngspice uses, when PlainSpice knows it. */
  value?: number;
  /** Sentences for the line's notes (traps in the spelling). */
  notes: string[];
  /** True when the spelling is a beginner trap (M as mega, A or F as a unit, …). */
  trap: boolean;
}

/**
 * How ngspice reads a value word of a part, in plain units, with what a beginner needs to know
 * about its spelling (N1–N6, N13, N17). `unit` is a formatSI symbol ('' for a ratio).
 */
export function valueWords(netlist: Netlist, token: Token, unit: string, reading: NumberReading | undefined = readNumber(token.text)): ValueWords {
  const notes: string[] = [];
  const first = token.text.charCodeAt(0);
  if (!reading && (first === 123 /* { */ || first === 39 /* ' */)) {
    // N17: ngspice evaluates expressions; PlainSpice resolves only a bare {name} from .param (A23).
    const m = /^\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}$/.exec(token.text);
    const p = m ? contextOf(netlist).params.get(lowerAscii(m[1]!)) : undefined;
    if (m && p) return { text: S.expressionParam(m[1]!, plain(p.reading.value, unit), p.line + 1), value: p.reading.value, notes, trap: false };
    return { text: S.expression, notes, trap: false };
  }
  if (!reading) return { text: token.text, notes, trap: false };
  const shown = plain(reading.value, unit);
  const marks: string[] = [];
  let trap = false;
  const scale = reading.scale;
  if (scale?.name === 'milli' && scale.letters === 'M') {
    // N1, N2: M is milli; mega is meg.
    marks.push(S.milli);
    notes.push(S.megaNote(token.text, shown, `${numberPart(token.text)}meg`));
    trap = true;
  } else if (scale?.name === 'atto') {
    marks.push(S.atto);
    notes.push(S.attoNote(token.text, numberPart(token.text)));
    trap = true;
  } else if (scale?.name === 'femto') {
    marks.push(S.femto);
    notes.push(S.femtoNote(token.text, numberPart(token.text)));
    trap = true;
  }
  const odd = reading.ignored ? [...reading.ignored][0]! : '';
  // The letter O where a zero belongs (1Ok, 1OOk, 1оk): said as Checks says it, never as a unit (CR1-9).
  const letter = ({ '\u03a9': 'R', F: 'C', H: 'L', V: 'V', A: 'I' } as const)[unit as '\u03a9'];
  const zero = odd && /^[Oo]$/.test(cleanWord(odd, true).clean) ? zeroForLetterO(token.text, letter) : undefined;
  const meantO = zero === undefined ? undefined : readNumber(zero);
  if (reading.ignored && meantO && meantO.value !== reading.value) {
    marks.push(S.ignored(withoutInvisible(reading.ignored)));
    const the = /[Oo]/.test(odd) ? `The letter ${odd}` : capitalized(describeCharacter(odd).replace(/, which .*$/, ''));
    notes.push(S.letterONote(the, withoutInvisible(reading.text.slice(0, reading.text.length - reading.ignored.length)), shown, zero!));
    trap = true;
  } else if (reading.ignored && SPACE_LIKE.test(odd)) {
    // The number stops at a character that looks like a space: name it, and say what a document meant
    // by it (spacedValue: a number and its unit, or groups of digits).
    const what = describeCharacter(odd);
    marks.push(S.oddIgnored(what, withSpaces([...reading.ignored].slice(1).join(''))));
    const meant = spacedValue(token.text);
    if (meant && meant.value === reading.value) notes.push(S.spaceHarmless(what));
    else {
      const write = !meant ? '' : !meant.unit ? S.spaceWriteDigits(meant.spice, meant.spaces > 1) : meant.milli ? S.spaceWriteMega(meant.spice) : S.spaceWrite(meant.spice);
      notes.push(S.spaceNote(capitalized(what), write));
      trap = true;
    }
  } else if (reading.ignored && (INVISIBLE.test(odd) || lookAlikeOf(odd) !== undefined)) {
    // The number stops at a character that is not what it looks like: name it, and say what was meant.
    const after = cleanWord([...reading.ignored].slice(1).join(''), true).clean;
    const clean = cleanWord(token.text, true).clean;
    const meant = readNumber(clean);
    marks.push(S.oddIgnored(describeCharacter(odd), after));
    if (meant && meant.value !== reading.value) {
      notes.push((INVISIBLE.test(odd) ? S.invisibleNote : S.lookAlikeNote)(capitalized(describeCharacter(odd)), clean));
      trap = true;
    } else if (INVISIBLE.test(odd)) notes.push(S.invisibleHarmless(nameOfCharacter(odd)!));
  } else if (reading.ignored) {
    const hidden = [...reading.ignored].find((ch) => INVISIBLE.test(ch));
    const letters = withoutInvisible(reading.ignored);
    marks.push(S.ignored(letters));
    if (hidden) notes.push(S.invisibleHarmless(nameOfCharacter(hidden)!));
    if (/^\d/.test(reading.ignored) && scale) {
      // N6: 2k2 is 2 k, not 2.2 k.
      const digits = /^\d+/.exec(reading.ignored)![0];
      const intended = Number(`${reading.value / scale.factor}.${digits}`) * scale.factor;
      notes.push(S.digitsAfterScaleNote(token.text, digits, scale.letters, plain(intended, unit)));
      trap = true;
    } else if (/^[rR]\d/.test(reading.ignored) && !scale) {
      // rkm-notation-1: 4R7 is 4, not 4.7.
      const digits = /^[rR](\d+)/.exec(reading.ignored)![1]!;
      notes.push(S.rkmNote(token.text, reading.ignored, plain(Number(`${reading.value}.${digits}`), unit)));
      trap = true;
    } else if (reading.ignored.includes('μ')) {
      // N5: the Greek letter mu is not the micro sign.
      notes.push(S.greekMuNote(token.text));
      trap = true;
    } else if (odd.codePointAt(0)! >= 0x80 && odd !== '\u00b5' && /^\d/.test([...reading.ignored][1] ?? '')) {
      // A character outside plain ASCII inside the number (4。7k): no unit, and not ignored on purpose (re-check C5, look-alike-letter-12).
      const ending = unit === 'F' || unit === 'H' ? S.strayModel : unit === '\u03a9' && reading.value === 0 ? '' : S.strayQuiet;
      notes.push(S.strayNote(capitalized(describeCharacter(odd)), [...reading.ignored].slice(1).join(''), ending));
      trap = true;
    } else if (!trap && letters) {
      notes.push(S.unitsIgnoredNote(letters));
    }
  }
  return { text: marks.length ? `${shown} (${marks.join('; ')})` : shown, value: reading.value, notes, trap };
}

/** "A zero-width space (U+200B)" from "a zero-width space (U+200B)". */
const capitalized = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The digits of a value word, without its scale letter and units: "4.7" in "4.7MOhm". */
function numberPart(text: string): string {
  return /^[+-]?(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?/.exec(text)?.[0] ?? text;
}

// ------------------------------------------------------------------ nodes

/** Names that look like ground but are ordinary nodes (W9, W13, W14). */
const groundLike = (ref: NodeRef): boolean => ref.name === 'gnd' || ref.name === 'ground' || ref.name === '00';

/**
 * A node's name alone, where a label already says "node" ("+ node c"): "in", "ground (node 0)", and a
 * name like ground quoted on its own ('+ node "ground"', never '+ node the node "ground"': words
 * re-check 5).
 */
function nodeName(ref: NodeRef): string {
  if (ref.ground) return S.ground;
  // W9, W13, W14: names that look like ground but are ordinary nodes are quoted, so "ground" never reads as ground.
  if (groundLike(ref)) return S.quotedName(ref.token.text);
  return nodeNameInWords(ref.token.text);
}

/**
 * A node's name as written, with a character in it that is not what it looks like named, never shown
 * (security review F2; S11: on every line that names a node, and in the results' words too): "out
 * (written with a zero-width space in it)" (invisible-character-3), "o ut (one word for SPICE: written
 * with a thin space, not a space)" (space-character-4, nbsp-1), "оut (written with the Cyrillic letter
 * о, which looks like o)" (look-alike-letter-5). Any other name as written.
 */
export function nodeNameInWords(text: string): string {
  // A name has no space in it (SPICE splits words at spaces): words with one were said already.
  if (text.includes(' ')) return text;
  const odd = oddCharacters(text);
  if (odd.length > 1) {
    // Each one named, in the order they come: "out (written with a zero-width space and the Cyrillic
    // letter о, which looks like o)", never only the first kind (critic of the S11 fix, round 2).
    const whats = odd.map((ch) => (INVISIBLE.test(ch) ? nameOfCharacter(ch, false)! : SPACE_LIKE.test(ch) ? `${nameOfCharacter(ch, false)!}, not a space` : describeCharacter(ch)));
    return S.nodeWithSeveral(withSpaces(withoutInvisible(text)), whats, odd.some((ch) => SPACE_LIKE.test(ch)));
  }
  if (hasInvisible(text)) return S.nodeWithInvisible(withoutInvisible(text), nameOfCharacter([...text].find((ch) => INVISIBLE.test(ch))!, false)!);
  if (hasSpaceLike(text)) return S.nodeWithSpace(withSpaces(text), nameOfCharacter([...text].find((ch) => SPACE_LIKE.test(ch))!, false)!);
  if (lookAlikeName(text) !== undefined) return S.nodeWithLookAlike(text, describeCharacter(cleanWord(text).odd[0]!));
  return text;
}

/**
 * The characters of a name that are not what they look like, each once, in the order they come: the
 * invisible ones, those that look like a space, and letters from another alphabet that look like Latin
 * ones in a Latin word (look-alike-letter-5; a name all in another alphabet is meant as written).
 */
export function oddCharacters(text: string): string[] {
  const base = withoutSpaces(withoutInvisible(text));
  const looks = new Set(lookAlikeName(base) !== undefined ? cleanWord(base).odd : []);
  return [...new Set([...text].filter((ch) => INVISIBLE.test(ch) || SPACE_LIKE.test(ch) || looks.has(ch)))];
}

/**
 * The names a name written with such characters may have meant, in turn: without its invisible
 * characters, then without those that look like a space too, then with its look-alike letters written
 * as the Latin ones (the last is the plain name: "out" for о<zero-width space>ut). Each differs from the
 * name and from the one before; none for a name without such characters.
 */
export function plainForms(text: string): string[] {
  const a = withoutInvisible(text);
  const b = withoutSpaces(a);
  const c = lookAlikeName(b) ?? b;
  return [...new Set([a, b, c])].filter((x) => x !== text);
}

/**
 * A node in a sentence: "node in" (a name may be an ordinary word: "So in sits 6 V above out" read
 * badly), as the editor, the overview and the cards say it (words review W8); ground is "ground (node
 * 0)", and a name like ground is quoted: the node "ground".
 */
function nodeText(ref: NodeRef): string {
  if (ref.ground) return nodeName(ref);
  if (groundLike(ref)) return S.quotedNode(ref.token.text);
  return S.nodeWord(nodeName(ref));
}

/** How a node of a part reads in a sentence: "node n1", "ground (node 0)". */
function nodePhrase(ref: NodeRef | undefined): string {
  return ref ? nodeText(ref) : '?';
}

/** A node in the sentences that follow a formula: "node in"; ground is just "ground" there. */
function nodeProse(ref: NodeRef | undefined): string {
  return !ref ? '?' : ref.ground ? S.groundShort : nodeText(ref);
}

/** The node's name in a formula: as written; ground as written too ("0", "gnd"). */
function nodeFormula(ref: NodeRef | undefined): string {
  return ref ? ref.token.text : '?';
}

/** Special meanings of a node name (W8–W14). */
function nodeSpecial(ref: NodeRef): { meaning?: string; note?: string } {
  const lower = lowerAscii(ref.token.text);
  if (ref.ground && lower === 'gnd') return { meaning: S.gndIsGround };
  if (!ref.ground && ref.name === 'gnd') return { meaning: S.gndAsNode, note: 'gnd' };
  if (!ref.ground && (ref.name === 'ground' || ref.name === '00')) return { meaning: S.groundWordNode(ref.token.text), note: 'ground' };
  return {};
}

// ------------------------------------------------------------------ labels

/**
 * The field-table label in the channel's words (elements.ts, with the true minus sign). G's and H's
 * values are "amps per volt" and "volts per amp", the plain words for transconductance and
 * transresistance.
 */
function labelFor(letter: ElementLetter | undefined, role: FieldRole, nodeIndex: number): string {
  return fieldLabel(letter, role, nodeIndex);
}

const NODE_ROLES: ReadonlySet<FieldRole> = new Set(['node', 'plus', 'minus', 'from', 'to', 'control-plus', 'control-minus']);
/** One pattern per emphasised word, made once. */
const EMPHASIS_PATTERNS = new Map<string, RegExp>();

const EMPHASIS: Partial<Record<FieldRole, string>> = {
  plus: '+',
  minus: MINUS,
  from: 'from',
  to: 'to',
  'control-plus': '+',
  'control-minus': MINUS,
};

function fieldOf(label: string, token: Token | undefined, meaning: string, emphasis?: string): FieldExplanation {
  const f: FieldExplanation = { label, text: token?.text ?? '', meaning };
  if (token) f.span = { from: token.from, to: token.to };
  if (emphasis) {
    let re = EMPHASIS_PATTERNS.get(emphasis);
    if (!re) {
      re = new RegExp(`(^|\\s|\\()${emphasis.replace(/[+]/g, '\\+')}(\\s|$|\\))`);
      EMPHASIS_PATTERNS.set(emphasis, re);
    }
    if (re.test(meaning)) f.emphasis = [emphasis];
  }
  return f;
}

// ------------------------------------------------------------------ source functions

type ArgKind = 'value' | 'time' | 'frequency' | 'damping' | 'phase';
type ArgTable = readonly (readonly [label: string, kind: ArgKind])[];

// P19, P19b, P19c: SIN(VO VA FREQ TD THETA PHASE).
const SIN_ARGS: ArgTable = [
  ['offset', 'value'],
  ['amplitude', 'value'],
  ['frequency', 'frequency'],
  ['delay', 'time'],
  ['damping', 'damping'],
  ['phase', 'phase'],
];

const FUNCTION_ARGS: Readonly<Record<string, ArgTable>> = {
  // P18: PULSE(V1 V2 TD TR TF PW PER).
  pulse: [
    ['start value', 'value'],
    ['pulse value', 'value'],
    ['delay', 'time'],
    ['rise time', 'time'],
    ['fall time', 'time'],
    ['pulse width', 'time'],
    ['period', 'time'],
  ],
  sin: SIN_ARGS,
  sine: SIN_ARGS,
  // P20b: EXP(V1 V2 TD1 TAU1 TD2 TAU2).
  exp: [
    ['start value', 'value'],
    ['end value', 'value'],
    ['rise delay', 'time'],
    ['rise time constant', 'time'],
    ['fall delay', 'time'],
    ['fall time constant', 'time'],
  ],
};

const ARG_MEANING: Readonly<Record<string, string>> = {
  'start value': 'the value before it starts',
  'pulse value': 'the value at the top of the pulse',
  delay: 'when it starts',
  'rise time': 'how long it takes to rise',
  'fall time': 'how long it takes to fall back',
  'pulse width': 'how long it stays at the pulse value',
  period: 'how often the pulse repeats',
  offset: 'the middle of the wave',
  amplitude: 'how far it swings above and below the offset',
  frequency: 'cycles per second',
  damping: 'the swing shrinks by exp(−damping × time)',
  phase: 'how far into its cycle the wave starts, in degrees',
  'end value': 'the value it heads for',
  'rise delay': 'when it starts to rise',
  'rise time constant': 'how fast it rises (the time constant)',
  'fall delay': 'when it heads back to the start value',
  'fall time constant': 'how fast it falls back (the time constant)',
  time: 'a time',
  value: 'the value at that time',
};

function argumentWords(kind: string, token: Token, unit: string): string {
  const r = readNumber(token.text);
  if (!r) return token.text;
  switch (kind) {
    case 'value':
      return plain(r.value, unit);
    case 'time':
      return formatSI(r.value, 's');
    case 'frequency':
      return formatSI(r.value, 'Hz');
    case 'damping':
      return `${formatNumber(r.value)} per second`;
    case 'phase':
      return `${formatNumber(r.value)}°`;
    default:
      return formatNumber(r.value);
  }
}

/** The value of a PULSE, SIN, PWL or EXP source at time 0, when its words are plain numbers (P17). */
function valueAtTimeZero(fn: { name: string; args: Token[] }): number | undefined {
  const nums = fn.args.map((t) => readNumber(t.text)?.value);
  const at = (k: number): number | undefined => nums[k];
  switch (fn.name) {
    case 'pulse':
    case 'exp':
      return at(0);
    case 'pwl':
      return at(1);
    case 'sin':
    case 'sine': {
      const phase = at(5);
      return phase === undefined || phase === 0 ? at(0) : undefined;
    }
    default:
      return undefined;
  }
}

// ------------------------------------------------------------------ analyses (shared with describe.ts)

export interface SweepReading {
  /** The swept source as written ("V1", "TEMP"). */
  source: Token;
  kind: 'voltage' | 'current' | 'resistance' | 'temperature' | 'unknown';
  /** formatSI unit: 'V', 'A', 'Ω', '°C'. */
  unit: string;
  /** Line index of the swept part. */
  line?: number;
  start?: Token;
  stop?: Token;
  step?: Token;
  startValue?: number;
  stopValue?: number;
  stepValue?: number;
  /** Points of this sweep alone, as ngspice counts them (A7–A11); undefined when unknown. */
  points?: number;
}

export type AnalysisReading =
  | { kind: 'op'; line: number }
  | { kind: 'dc'; line: number; sweeps: SweepReading[]; points?: number }
  | {
      kind: 'tran';
      line: number;
      tstep?: number;
      tstop?: number;
      tstart?: number;
      tmax?: number;
      uic: boolean;
      /** The largest time step ngspice allows (A16–A18). */
      maxStep?: number;
    }
  | {
      kind: 'tf';
      line: number;
      /** The output as written, e.g. "v(a)", "v(a,b)", "i(Vm)". */
      output: string;
      outputKind: 'voltage' | 'current';
      /** Output nodes (voltage output) or the source (current output), as written. */
      outputNames: string[];
      /**
       * A voltage output's nodes as the parser reads them (empty for a current output): ground ('0')
       * for 0, and for gnd where ngspice makes it 0, before ')' or ',' (inp_fix_gnd_name: `.tf v(out,gnd)`
       * is v(out,0), A3b), so the words never call that gnd a node (code review 1).
       */
      outputNodes: NodeRef[];
      input?: Token;
      inputKind?: 'voltage' | 'current' | 'other' | 'missing';
    }
  | { kind: 'ac'; line: number; type: 'dec' | 'oct' | 'lin' | 'unknown'; perStep?: number; fstart?: number; fstop?: number; points?: number }
  | { kind: 'other'; line: number; name: string };

/**
 * How many points ngspice computes for one .dc sweep: it starts at `start`, adds `step` until the
 * value passes `stop` by more than 1e3 × DBL_EPSILON (dctrcurv.c; A7–A11). Floating-point steps
 * add up exactly as in ngspice, so 0 to 1 in steps of 0.1 gives 11 points (A8). The temperature is
 * stepped in kelvin, as ngspice does. Returns NaN for a step of 0, which ngspice 47 rejects (M13).
 */
export function dcSweepPoints(start: number, stop: number, step: number, temperature = false): number {
  if (!Number.isFinite(start) || !Number.isFinite(stop) || !Number.isFinite(step) || step === 0) return Number.NaN;
  const sign = step > 0 ? 1 : -1;
  const estimate = Math.floor((stop - start) / step + 1e-9) + 1;
  if (estimate > EXACT_LOOP_LIMIT) return estimate;
  const offset = temperature ? CELSIUS_TO_KELVIN : 0;
  let value = start + offset;
  let n = 0;
  while (sign * (value - offset - stop) <= DC_TOLERANCE) {
    n += 1;
    value += step;
    if (n > EXACT_LOOP_LIMIT) break;
  }
  return n;
}

/**
 * How many frequencies ngspice computes for .ac (acan.c; A20–A22): `dec` and `oct` multiply the
 * frequency by a fixed factor, `lin` adds a fixed step; ngspice stops past fstop plus a small
 * tolerance (reltol, 1e-3 unless .options changes it). NaN when ngspice would refuse the numbers.
 */
export function acSweepPoints(type: 'dec' | 'oct' | 'lin', perStep: number, fstart: number, fstop: number, reltol = 1e-3): number {
  if (![perStep, fstart, fstop].every(Number.isFinite)) return Number.NaN;
  const n = Math.max(1, Math.trunc(perStep));
  let delta: number;
  if (type === 'lin') {
    delta = n - 1 > 1 ? (fstop - fstart) / (n - 1) : 0;
  } else {
    if (fstart <= 0) return Number.NaN;
    if (type === 'oct') delta = Math.exp(Math.log(2) / n);
    else if (fstop / 10 < fstart) delta = fstop === fstart ? 1 : Math.exp(Math.log(10) / n);
    else delta = Math.exp(Math.log(fstop / fstart) / Math.floor(Math.abs(Math.log10(fstop / fstart)) * n));
  }
  const tol = type === 'lin' ? delta * reltol : delta * fstop * reltol;
  let f = fstart;
  let count = 0;
  while (f <= fstop + tol) {
    count += 1;
    if (count > EXACT_LOOP_LIMIT) return count;
    if (type === 'lin') {
      if (delta === 0) break;
      f += delta;
    } else {
      if (delta === 1) break;
      f *= delta;
    }
  }
  return count;
}

const isVectorWord = (w: string): boolean => /^(v|i|vm|vp|vr|vi|vdb)$/.test(lowerAscii(w));

interface VectorGroup {
  kind: 'voltage' | 'current';
  names: Token[];
  span: Span;
  text: string;
  /** Number of argument tokens it used. */
  used: number;
}

/** A v(a), v(a,b) or i(Vm) group among a dot command's words, starting at args[k]. */
function vectorAt(netlist: Netlist, args: readonly Token[], k: number): VectorGroup | undefined {
  const head = args[k];
  const next = args[k + 1];
  if (!head || !next || !isVectorWord(head.text)) return undefined;
  if (!netlist.text.slice(head.to, next.from).includes('(')) return undefined;
  const names: Token[] = [];
  let j = k + 1;
  let end = -1;
  for (; j < args.length; j++) {
    const t = args[j]!;
    names.push(t);
    const after = args[j + 1];
    const gap = netlist.text.slice(t.to, after ? after.from : Math.min(netlist.text.length, t.to + 4));
    const close = gap.indexOf(')');
    if (close >= 0) {
      end = t.to + close + 1;
      break;
    }
  }
  if (end < 0) end = names.length ? names[names.length - 1]!.to : head.to;
  const kind = lowerAscii(head.text).startsWith('i') ? 'current' : 'voltage';
  return { kind, names, span: { from: head.from, to: end }, text: netlist.text.slice(head.from, end), used: names.length + 1 };
}

/** A word in braces or quotes: a number numparam works out before ngspice reads the line (dc-sweep-problems-17). */
export const isExpression = (t: Token): boolean => /^[{']/.test(t.text);

/**
 * Whether ngspice 47 stops at a .dc line ("Bad syntax!"), read by place as it reads it (inp2dot.c): a
 * sweep without its start, its stop or its step, a word that is no number where a number goes, or a
 * step of 0 (dc-sweep-problems-1, -2, -9 to -13, -18; re-check critic CR1-11). A word in braces or quotes
 * is a number (dc-sweep-problems-17).
 */
export function dcStopsNgspice(r: Extract<AnalysisReading, { kind: 'dc' }>): boolean {
  return r.sweeps.some((s) => {
    const words: [Token | undefined, number | undefined][] = [[s.start, s.startValue], [s.stop, s.stopValue], [s.step, s.stepValue]];
    return words.some(([t, x]) => !t || (x === undefined && !isExpression(t))) || s.stepValue === 0;
  });
}

/** For each word the parser read as a node on a dot command's line (the words in v(...)), the node it filed it under, by where the word starts. */
const wordNodes = new WeakMap<Netlist, Map<number, NodeInfo>>();

/**
 * A word inside v(...) on a dot command's line as the node the parser read it as: ground for 0, and
 * for a gnd that ngspice turns into 0 there (gndIsGround in parse.ts); otherwise the node of that name.
 */
function nodeOfWord(netlist: Netlist, token: Token): NodeRef {
  let byStart = wordNodes.get(netlist);
  if (!byStart) {
    byStart = new Map();
    for (const info of netlist.nodes.values()) for (const t of info.refs) byStart.set(t.from, info);
    wordNodes.set(netlist, byStart);
  }
  const info = byStart.get(token.from) ?? subcircuitWords(netlist).get(token.from);
  if (info) return { token, name: info.name, ground: info.ground };
  const name = ngspiceName(token.text);
  return { token, name, ground: name === '0' };
}

const subcircuitWordCache = new WeakMap<Netlist, Map<number, NodeInfo>>();

/**
 * The words in v( ) on the dot commands between .subckt and .ends, which the parser files under no node
 * (a subcircuit's nodes are its own), read as the parser reads the same line in the main circuit, by
 * where each word starts. ngspice turns gnd into 0 on every line, inside a subcircuit too, before it runs
 * an analysis line there as the main circuit's (an X line uses the subcircuit: A3f), so `.tf v(a,gnd) V1`
 * there is v(a,0): its gnd is ground, as at the top level (A3b, A3g; last pass regress-2).
 */
function subcircuitWords(netlist: Netlist): Map<number, NodeInfo> {
  let byStart = subcircuitWordCache.get(netlist);
  if (byStart) return byStart;
  byStart = new Map();
  const ctx = contextOf(netlist);
  for (const i of ctx.insideSubckt.keys()) {
    const line = netlist.lines[i]!;
    if (!line.directive) continue;
    // The line and its continuation lines, which the parser reads as one (comment lines between them too).
    const last = netlist.lines[Math.max(i, ...(ctx.continuedBy.get(i) ?? []))]!;
    const alone = parseNetlist(`*\n${netlist.text.slice(line.span.from, last.span.to)}`);
    for (const node of alone.nodes.values()) for (const t of node.refs) byStart.set(line.span.from + t.from - 2, node);
  }
  subcircuitWordCache.set(netlist, byStart);
  return byStart;
}

/** The first .dc line (0-based) that sweeps the part with lower-case name `key`, if any. */
export function sweptBy(netlist: Netlist, key: string): number | undefined {
  return contextOf(netlist).swept.get(key);
}

/** The analyses A3f ran inside a subcircuit no X line uses: ngspice skips each of them there. */
const RUN_ANALYSES: ReadonlySet<string> = new Set(['.op', '.tf', '.dc', '.tran', '.ac', '.noise']);

const usedCache = new WeakMap<Netlist, Set<string>>();

/** The subcircuits an X line uses, by lower-case name: X lines anywhere, those after a plain .end too (S25). */
function usedSubcircuits(netlist: Netlist): Set<string> {
  const cached = usedCache.get(netlist);
  if (cached) return cached;
  const used = new Set<string>();
  const add = (el: Element | undefined): void => {
    const model = el?.letter === 'X' ? el.fields.find((f) => f.role === 'model') : undefined;
    if (model) used.add(lowerAscii(model.token.text));
  };
  for (const l of netlist.lines) add(l.element);
  for (const l of readAfterEnd(netlist)) add(parseNetlist(`*\n${l.text}`).lines[1]?.element);
  usedCache.set(netlist, used);
  return used;
}

/**
 * The subcircuit a line is in (its name as written and its .subckt line, 0-based) when no X line uses
 * that subcircuit; undefined for any other line. ngspice skips such a subcircuit, an analysis line in
 * it too (A3f: .op, .tf, .dc, .tran, .ac and .noise run nothing there); in a subcircuit an X line uses, it runs
 * an analysis line as if the main circuit had it, once for each such X line.
 */
export function unusedSubcircuit(netlist: Netlist, index: number): { name: string; line: number } | undefined {
  const at = contextOf(netlist).insideSubckt.get(index);
  const name = at === undefined ? undefined : netlist.lines[at]?.directive?.args[0];
  if (at === undefined || !name || usedSubcircuits(netlist).has(lowerAscii(name.text))) return undefined;
  return { name: name.text, line: at };
}

/** An analysis line A3f found ngspice skips: one of those it ran, in a subcircuit no X line uses. */
export function ignoredAnalysis(netlist: Netlist, index: number): boolean {
  const name = netlist.lines[index]?.directive?.name;
  return name !== undefined && RUN_ANALYSES.has(name) && unusedSubcircuit(netlist, index) !== undefined;
}

/** Where a name ngspice builds inside a subcircuit leads (A3h): the X lines that lead there, from the main circuit's down, as written, and the subcircuit the last one uses, as its .subckt line writes it, with that line (0-based). */
export interface InnerPlace {
  path: string[];
  subcircuit: string;
  line: number;
}

/** A node of a subcircuit an X line uses, by ngspice's name for it (A3h): the node as the subcircuit's own lines write it. */
export interface InnerNode extends InnerPlace {
  node: NodeRef;
}

/** A part of a subcircuit an X line uses, by ngspice's name for it (A3h), and its own line (0-based). */
export interface InnerPart extends InnerPlace {
  part: Element;
  partLine: number;
}

/**
 * The X lines `steps` name, from the main circuit's down (A3h): each an X line of the circuit the step
 * before leads to, the main circuit's first (outside .subckt … .ends, or after a plain .end, which ngspice
 * reads: S25), then the lines of the subcircuit the last one uses. undefined when a step is no such X
 * line or its subcircuit has no .subckt line.
 */
function walkSubcircuits(netlist: Netlist, steps: readonly string[]): (InnerPlace & { lines: NetlistLine[] }) | undefined {
  const ctx = contextOf(netlist);
  const linesOf = (at: number | undefined): NetlistLine[] => netlist.lines.filter((l) => l.element && ctx.insideSubckt.get(l.index) === at);
  let lines = linesOf(undefined);
  let parts = [...lines.map((l) => l.element!), ...readAfterEnd(netlist).flatMap((l) => parseNetlist(`*\n${l.text}`).lines[1]?.element ?? [])];
  const path: string[] = [];
  let at: number | undefined;
  for (const step of steps) {
    const x = parts.find((e) => e.letter === 'X' && lowerAscii(e.name.text) === step);
    const model = x?.fields.find((f) => f.role === 'model');
    at = model ? ctx.subckts.get(lowerAscii(model.token.text)) : undefined;
    if (!x || at === undefined) return undefined;
    path.push(x.name.text);
    lines = linesOf(at);
    parts = lines.map((l) => l.element!);
  }
  return at === undefined ? undefined : { path, subcircuit: netlist.lines[at]!.directive!.args[0]!.text, line: at, lines };
}

/**
 * ngspice's name for a node inside a subcircuit, read back (A3h): the X lines that lead to it, from the
 * main circuit's down, and the node, joined by dots. x1.m is the node m of the subcircuit X1 uses, x1.x2.m
 * the node m of the subcircuit that X2, a line of X1's subcircuit, uses; capitals do not matter. ngspice
 * makes such a node once for each X line, so `.tf v(x1.m) V1` measures it (0.5 and 500 Ω in A3h).
 * undefined for any other name: one without a dot, an X line the circuit does not have there, a
 * subcircuit with no .subckt line, or a name that is no node of the subcircuit's own: a node of its
 * .subckt line takes the X line's node, so x1.a for it is a new node with nothing on it (0 and 1 Ω, as
 * tf-problems-1), and ground and a node a .global line names are the main circuit's.
 */
export function innerNode(netlist: Netlist, name: string): InnerNode | undefined {
  const steps = lowerAscii(name).split('.');
  if (steps.length < 2 || steps.some((s) => s === '')) return undefined;
  const walk = walkSubcircuits(netlist, steps.slice(0, -1));
  if (!walk) return undefined;
  // The nodes of the .subckt line: the words after the name, up to params: or a name=value; and those .global names.
  const shared = new Set<string>();
  for (const t of netlist.lines[walk.line]!.directive!.args.slice(1)) {
    if (/^params:$/i.test(t.text) || /^[ \t]*=/.test(netlist.text.slice(t.to, t.to + 80))) break;
    shared.add(ngspiceName(t.text));
  }
  for (const l of netlist.lines) if (l.directive?.name === '.global') for (const t of l.directive.args) shared.add(ngspiceName(t.text));
  const last = steps[steps.length - 1]!;
  const node = shared.has(last) ? undefined : walk.lines.flatMap((l) => l.element!.nodes).find((r) => !r.ground && r.name === last);
  return node ? { path: walk.path, subcircuit: walk.subcircuit, line: walk.line, node } : undefined;
}

/**
 * ngspice's name for a part inside a subcircuit, read back (A3h): its first letter, the X lines that lead
 * to it and its own name, joined by dots, in lower case: v.x1.vs is Vs of the subcircuit X1 uses, which a
 * .tf can take as its input or its i( ) (0.3333 and 3.333e-4 in A3h). undefined for any other name, x1.vs
 * among them (no part: 0 and 1e20 Ω, as tf-problems-5).
 */
export function innerPart(netlist: Netlist, name: string): InnerPart | undefined {
  const steps = lowerAscii(name).split('.');
  const own = steps[steps.length - 1]!;
  if (steps.length < 3 || steps.some((s) => s === '') || steps[0]!.length !== 1 || own[0] !== steps[0]) return undefined;
  const walk = walkSubcircuits(netlist, steps.slice(1, -1));
  const line = walk?.lines.find((l) => lowerAscii(l.element!.name.text) === own);
  return walk && line ? { path: walk.path, subcircuit: walk.subcircuit, line: walk.line, part: line.element!, partLine: line.index } : undefined;
}

function partKind(netlist: Netlist, name: string): { line?: number; letter?: ElementLetter } {
  const line = contextOf(netlist).elements.get(lowerAscii(name));
  if (line === undefined) return {};
  const letter = netlist.lines[line]?.element?.letter;
  return letter ? { line, letter } : { line };
}

/** Reads an analysis dot command (.op, .dc, .tran, .tf, .ac, …) into numbers; undefined for other lines. */
export function readAnalysis(netlist: Netlist, lineIndex: number): AnalysisReading | undefined {
  const line = netlist.lines[lineIndex];
  const d = line?.directive;
  if (!d) return undefined;
  const num = (t: Token | undefined): number | undefined => (t ? readNumber(t.text)?.value : undefined);
  switch (d.name) {
    case '.op':
      return { kind: 'op', line: lineIndex };
    case '.dc': {
      const sweeps: SweepReading[] = [];
      // Two sweeps at most: ngspice 47 ignores the words after the second (dc-sweep-problems-19).
      for (let k = 0; k < d.args.length && k < 8; k += 4) {
        const source = d.args[k]!;
        const sweep: SweepReading = { source, kind: 'unknown', unit: '' };
        if (lowerAscii(source.text) === 'temp') {
          sweep.kind = 'temperature';
          sweep.unit = '°C';
        } else {
          const part = partKind(netlist, source.text);
          if (part.line !== undefined) sweep.line = part.line;
          if (part.letter === 'V') [sweep.kind, sweep.unit] = ['voltage', 'V'];
          else if (part.letter === 'I') [sweep.kind, sweep.unit] = ['current', 'A'];
          else if (part.letter === 'R') [sweep.kind, sweep.unit] = ['resistance', 'Ω'];
        }
        const [start, stop, step] = [d.args[k + 1], d.args[k + 2], d.args[k + 3]];
        if (start) sweep.start = start;
        if (stop) sweep.stop = stop;
        if (step) sweep.step = step;
        const [a, b, c] = [num(start), num(stop), num(step)];
        if (a !== undefined) sweep.startValue = a;
        if (b !== undefined) sweep.stopValue = b;
        if (c !== undefined) sweep.stepValue = c;
        // M12: a sweep of something that is not in the circuit runs no points at all.
        if (a !== undefined && b !== undefined && c !== undefined && sweep.kind !== 'unknown') {
          const n = dcSweepPoints(a, b, c, sweep.kind === 'temperature');
          if (!Number.isNaN(n)) sweep.points = n;
        }
        sweeps.push(sweep);
      }
      const reading: AnalysisReading = { kind: 'dc', line: lineIndex, sweeps };
      if (sweeps.length && sweeps.every((s) => s.points !== undefined)) reading.points = sweeps.reduce((p, s) => p * s.points!, 1);
      return reading;
    }
    case '.tran': {
      const values: number[] = [];
      let uic = false;
      for (const t of d.args) {
        if (lowerAscii(t.text) === 'uic') uic = true;
        else {
          const v = num(t);
          if (v !== undefined) values.push(v);
        }
      }
      const [tstep, tstop, tstart, tmax] = values;
      const reading: AnalysisReading = { kind: 'tran', line: lineIndex, uic };
      if (tstep !== undefined) reading.tstep = tstep;
      if (tstop !== undefined) reading.tstop = tstop;
      if (tstart !== undefined) reading.tstart = tstart;
      if (tmax !== undefined) reading.tmax = tmax;
      if (tstep !== undefined && tstop !== undefined) {
        // traninit.c (A16–A18): tmax, else tstep when it is below (tstop − tstart)/50, else that fiftieth.
        const span = (tstop - (tstart ?? 0)) / 50;
        reading.maxStep = tmax !== undefined && tmax > 0 ? tmax : tstep < span ? tstep : span;
      }
      return reading;
    }
    case '.tf': {
      const out = vectorAt(netlist, d.args, 0);
      const input = d.args[out ? out.used : 1];
      const reading: AnalysisReading = {
        kind: 'tf',
        line: lineIndex,
        output: out?.text ?? d.args[0]?.text ?? '',
        outputKind: out?.kind ?? 'voltage',
        outputNames: (out?.names ?? []).map((t) => t.text),
        outputNodes: out?.kind === 'voltage' ? out.names.map((t) => nodeOfWord(netlist, t)) : [],
      };
      if (input) {
        reading.input = input;
        const part = partKind(netlist, input.text);
        // A part inside a subcircuit, by ngspice's name for it (v.x1.vs), is a part of the circuit (A3h).
        const inner = part.line === undefined ? innerPart(netlist, input.text) : undefined;
        const letter = part.letter ?? inner?.part.letter;
        reading.inputKind = letter === 'V' ? 'voltage' : letter === 'I' ? 'current' : part.line === undefined && !inner ? 'missing' : 'other';
      }
      return reading;
    }
    case '.ac': {
      const t = d.args[0] ? lowerAscii(d.args[0].text) : '';
      const type = t === 'dec' || t === 'oct' || t === 'lin' ? t : 'unknown';
      const reading: AnalysisReading = { kind: 'ac', line: lineIndex, type };
      const [n, f1, f2] = [num(d.args[1]), num(d.args[2]), num(d.args[3])];
      if (n !== undefined) reading.perStep = n;
      if (f1 !== undefined) reading.fstart = f1;
      if (f2 !== undefined) reading.fstop = f2;
      if (type !== 'unknown' && n !== undefined && f1 !== undefined && f2 !== undefined) {
        const points = acSweepPoints(type, n, f1, f2, contextOf(netlist).reltol);
        if (!Number.isNaN(points)) reading.points = points;
      }
      return reading;
    }
    default:
      return netlist.analyses.includes(lineIndex) ? { kind: 'other', line: lineIndex, name: d.name } : undefined;
  }
}

// ------------------------------------------------------------------ parts

/** The plain name of a part letter, as in the field table's name row. */
function partWhat(info: ElementInfo | undefined): string {
  return info?.name ?? 'part';
}

function controlSourceInfo(netlist: Netlist, token: Token): { meaning: string; note?: string } {
  const part = partKind(netlist, token.text);
  if (part.line === undefined) return { meaning: S.controlSourceMissing(token.text), note: S.controlMissingNote(token.text) };
  const info = part.letter ? elementInfo(part.letter) : undefined;
  const target = netlist.lines[part.line]?.element;
  // P7, P10b, P10d: V, E, H and a B line with V= can be read; P10, P10c: a resistor or an inductor cannot.
  if (target && hasReadableCurrent(target)) {
    return { meaning: S.controlSourceFound(token.text, part.line + 1, partWhat(info)) };
  }
  if (target && part.letter === 'B' && behaviouralKind(target) === 'i') {
    return { meaning: S.controlSourceWrong(token.text, S.bCurrentSource), note: S.controlBCurrentNote(token.text) }; // P10d
  }
  return { meaning: S.controlSourceWrong(token.text, partWhat(info)), note: S.controlWrongNote(token.text, partWhat(info)) };
}

/**
 * For a .model line (0-based index) whose level selects a chip-design model that PlainSpice's
 * engine leaves out (engine/build.sh, REMOVED_MODELS), the level as written and the model's name;
 * ngspice then says only "could not find a valid modelname" (M8). Levels from ngspice's inpdomod.c.
 */
export function leftOutModel(netlist: Netlist, modelLine: number): { level: string; model: string; kind: string; message: string; mosfet: boolean } | undefined {
  const d = netlist.lines[modelLine]?.directive;
  if (!d) return undefined;
  const type = lowerAscii(d.args[1]?.text ?? '');
  let level: string | undefined;
  for (const [name, value] of pairs(netlist, d.args.slice(2))) if (lowerAscii(name.text) === 'level' && value) level = value.text;
  const n = level === undefined ? undefined : readNumber(level)?.value;
  if (n === undefined || level === undefined) return undefined;
  const mos: Record<number, string> = {
    4: 'BSIM1', 5: 'BSIM2', 8: 'BSIM3', 49: 'BSIM3', 14: 'BSIM4', 54: 'BSIM4', 10: 'BSIM-SOI', 58: 'BSIM-SOI',
    55: 'BSIM3-SOI', 56: 'BSIM3-SOI', 57: 'BSIM3-SOI', 60: 'SOI3', 68: 'HiSIM2', 73: 'HiSIM_HV',
  };
  // The message differs by type (M8; model-not-in-engine-3 and -4 in traps.md).
  if ((type === 'nmos' || type === 'pmos') && mos[n]) return { level, model: mos[n]!, kind: 'a chip-design model', message: 'could not find a valid modelname', mosfet: true };
  if ((type === 'npn' || type === 'pnp') && n === 8) return { level, model: 'HICUM2', kind: 'a chip-design model', message: 'Unable to find definition of given model', mosfet: false };
  if ((type === 'njf' || type === 'pjf') && n === 2) {
    return { level, model: 'JFET2', kind: 'a detailed JFET model', message: `Unknown device type for model ${lowerAscii(d.args[0]?.text ?? '')}`, mosfet: false };
  }
  return undefined;
}

const MODEL_KINDS: Readonly<Record<string, string>> = {
  // A30: each of these was used by a matching part in one run.
  d: 'diodes',
  npn: 'NPN bipolar transistors',
  pnp: 'PNP bipolar transistors',
  njf: 'n-channel JFETs',
  pjf: 'p-channel JFETs',
  nmos: 'n-channel MOSFETs',
  pmos: 'p-channel MOSFETs',
  sw: 'voltage-controlled switches',
  csw: 'current-controlled switches',
};

interface PartContext {
  netlist: Netlist;
  line: NetlistLine;
  el: Element;
  info: ElementInfo | undefined;
  notes: string[];
}

function addNote(notes: string[], note: string | undefined): void {
  if (note && !notes.includes(note)) notes.push(note);
}

/** The field table of a part line: one row per word, in order. */
function partFields(p: PartContext): FieldExplanation[] {
  const { el, netlist } = p;
  const rows: FieldExplanation[] = [];
  const unit = unitOf(el.letter);
  let nodeIndex = 0;
  const fnArgs = new Map<number, number>();
  el.sourceFunction?.args.forEach((t, k) => fnArgs.set(t.from, k));
  const valueTokenFrom = el.value?.token.from;
  let acNext = false;
  const valueRoles: readonly FieldRole[] = ['value', 'gain', 'transconductance', 'transresistance'];
  el.fields.forEach((f, k) => {
    const isNode = NODE_ROLES.has(f.role);
    const label = labelFor(el.letter, f.role, isNode ? nodeIndex : 0);
    if (isNode) {
      const ref = el.nodes[nodeIndex]!;
      rows.push(nodeRow(p, f, ref, nodeIndex, label));
      nodeIndex += 1;
      return;
    }
    switch (f.role) {
      case 'name':
        rows.push(fieldOf(label, f.token, S.nameMeaning(f.token.text[0] ?? '', partWhat(p.info))));
        return;
      case 'control-source': {
        const c = controlSourceInfo(netlist, f.token);
        addNote(p.notes, c.note);
        rows.push(fieldOf(label, f.token, c.meaning));
        return;
      }
      case 'model': {
        const key = lowerAscii(f.token.text);
        if (el.letter === 'X') {
          const at = contextOf(netlist).subckts.get(key);
          rows.push(fieldOf(label, f.token, at === undefined ? S.subcircuitMissing(f.token.text) : S.subcircuitFound(f.token.text, at + 1)));
          if (at === undefined) addNote(p.notes, S.subcircuitMissingNote(f.token.text));
        } else {
          const at = contextOf(netlist).models.get(key);
          rows.push(fieldOf(label, f.token, at === undefined ? S.modelMissing(f.token.text) : S.modelFound(f.token.text, at + 1)));
          if (at === undefined) addNote(p.notes, S.modelMissingNote(f.token.text));
          else {
            const left = leftOutModel(netlist, at);
            if (left) addNote(p.notes, S.modelLeftOutNote(f.token.text, left.level, left.model, left.kind, left.message));
          }
        }
        return;
      }
      case 'source-function': {
        const lower = lowerAscii(f.token.text);
        const fn = el.sourceFunction;
        const argIndex = fnArgs.get(f.token.from);
        if (fn && f.token.from === fn.token.from) {
          rows.push(fieldOf('source function', f.token, S.sourceFunction(f.token.text)));
          return;
        }
        if (fn && argIndex !== undefined) {
          const table = FUNCTION_ARGS[fn.name];
          let argLabel: string;
          let kind: string;
          if (fn.name === 'pwl') {
            argLabel = argIndex % 2 === 0 ? 'time' : 'value';
            kind = argIndex % 2 === 0 ? 'time' : 'value';
          } else if (table?.[argIndex]) {
            [argLabel, kind] = table[argIndex]!;
          } else {
            argLabel = S.argument(argIndex + 1);
            kind = 'number';
          }
          const words = argumentWords(kind, f.token, unit);
          const why = ARG_MEANING[argLabel];
          rows.push(fieldOf(argLabel, f.token, why ? `${words}: ${why}` : words));
          return;
        }
        if (lower === 'ac') {
          acNext = true;
          rows.push(fieldOf('AC value', f.token, S.keywordAc));
          return;
        }
        if (acNext && readNumber(f.token.text)) {
          acNext = false;
          rows.push(fieldOf('AC value', f.token, S.acMagnitude(plain(readNumber(f.token.text)!.value, unit))));
          return;
        }
        rows.push(fieldOf('source function', f.token, f.token.text));
        return;
      }
      case 'parameter': {
        const key = lowerAscii(f.token.text);
        if (el.letter === 'B') {
          rows.push(bRow(p, f, k));
          return;
        }
        const prev = el.fields[k - 1];
        const isValue = prev?.role === 'parameter' && netlist.text.slice(prev.token.to, f.token.from).includes('=');
        if (isValue && prev) {
          const r = readNumber(f.token.text);
          const pkey = lowerAscii(prev.token.text);
          const u = pkey === 'ic' && el.letter === 'C' ? 'V' : '';
          rows.push(fieldOf('parameter value', f.token, S.parameterValue(r ? plain(r.value, u) : f.token.text)));
        } else {
          // P23 checked ic= on a capacitor; on other parts it is only named.
          rows.push(fieldOf('parameter', f.token, key === 'ic' && el.letter === 'C' ? S.icName : S.parameterName(f.token.text)));
        }
        return;
      }
      case 'other':
        if (el.letter === 'K') {
          const part = partKind(netlist, f.token.text);
          const found = part.letter === 'L' && part.line !== undefined;
          rows.push(fieldOf(label, f.token, found ? S.inductorFound(f.token.text, part.line! + 1) : S.inductorMissing(f.token.text)));
          if (!found) addNote(p.notes, S.kMissingNote(f.token.text));
          return;
        }
        if (valuePlaceWord(el) === f) {
          // Where the value goes: a name from .param is that value (unknown-word-22, -24); any other word stops
          // ngspice, on E, F, G and H lines too (unknown-word-13 to -21; re-check S6).
          const named = contextOf(netlist).paramNames.has(lowerAscii(f.token.text));
          // With more words after it on an E, F, G or H line (- 2), native ngspice 47 and 42 read a polynomial
          // instead (unknown-word-25 to -28; re-check critic CR1-3).
          const polynomial = !!el.letter && 'EFGH'.includes(el.letter) && el.fields.indexOf(f) < el.fields.length - 1;
          rows.push(fieldOf(labelFor(el.letter, 'value', 0), f.token, paramValue(netlist, el)?.text ?? (named ? S.paramByName(f.token.text) : polynomial ? S.unknownWordEngine : S.unknownWord)));
          return;
        }
        rows.push(fieldOf(label, f.token, otherWordMeaning(el.letter, f.token.text)));
        return;
      default:
        break;
    }
    if (valueRoles.includes(f.role)) {
      const r = readNumber(f.token.text);
      const isUsed = f.token.from === valueTokenFrom;
      const lower = lowerAscii(f.token.text);
      if (!r && !isUsed) {
        // Keywords that introduce the value (V1, V3, W2).
        if (lower === 'dc') rows.push(fieldOf(label, f.token, S.keywordDc));
        else {
          const what = lower === 'gain' ? 'gain' : lower === 'c' && el.letter === 'I' ? 'current' : el.letter === 'K' ? 'coupling' : el.letter === 'R' ? 'resistance' : el.letter === 'C' ? 'capacitance' : el.letter === 'L' ? 'inductance' : 'value';
          rows.push(fieldOf(label, f.token, S.keywordByName(lower, what)));
        }
        return;
      }
      if (!isUsed) {
        const used = el.value ? valueWords(netlist, el.value.token, unitForValue(el.letter), el.value.number).text : '';
        // V1: on a source line the number right after the nodes beats a later DC value.
        const lead = (el.letter === 'V' || el.letter === 'I') && valueTokenFrom !== undefined && valueTokenFrom < f.token.from;
        rows.push(fieldOf(label, f.token, lead ? S.notUsedLeadWins(used) : S.replacedValue(used)));
        return;
      }
      rows.push(fieldOf(label, f.token, mainValueMeaning(p, f)));
      return;
    }
    rows.push(fieldOf(label, f.token, f.token.text));
  });
  return rows;
}

/**
 * The word where a part's value goes when it is no number (Av, −5, -<zero-width space>5 ...): the first
 * word the parser could not place, with no value and no setting before it (re-check S6, C3).
 */
function valuePlaceWord(el: Element): Field | undefined {
  if (el.value) return undefined;
  const k = el.fields.findIndex((f) => f.role === 'other');
  if (k < 0 || el.fields.slice(0, k).some((x) => x.role === 'parameter' || x.role === 'source-function' || x.role === 'model')) return undefined;
  return el.fields[k];
}

/**
 * A part's value written as a bare name from a .param line where the value goes (E1 b 0 a 0 Av with
 * .param Av=10): ngspice uses the parameter's value (unknown-word-22). Undefined for anything else.
 */
function paramValue(netlist: Netlist, el: Element): ValueWords | undefined {
  const f = valuePlaceWord(el);
  const p = f ? contextOf(netlist).params.get(lowerAscii(f.token.text)) : undefined;
  if (!f || !p) return undefined;
  return { text: S.expressionParam(f.token.text, plain(p.reading.value, unitForValue(el.letter)), p.line + 1), value: p.reading.value, notes: [], trap: false };
}

/**
 * The note for an E, F, G or H line with no gain, by what follows its nodes (re-check S6): nothing at
 * all (missing-value-4 to -7), or settings but no number (missing-value-11, -12). A word ngspice cannot
 * read where the gain goes gets no note: its row says that ngspice stops there.
 */
function noGainNoteOf(el: Element, word: string): string | undefined {
  if (el.fields.some((f) => f.role === 'other')) return undefined;
  return el.fields.length === (el.letter === 'E' || el.letter === 'G' ? 5 : 4) ? S.noGainNote(word) : S.settingsNoGainNote(word);
}

/**
 * A word the parser could not give a role (unknown-word-1 ... -6 in traps.md): on R, C, L, V and I
 * lines ngspice stops at it, and so does PlainSpice's engine on E, F, G and H lines.
 */
function otherWordMeaning(letter: ElementLetter | undefined, word: string): string {
  if (isReportOnlyParameter(letter, word)) return S.reportOnlyWord;
  if (letter === 'V' || letter === 'I' || letter === 'R' || letter === 'C' || letter === 'L') return S.unknownWord;
  if (letter === 'E' || letter === 'F' || letter === 'G' || letter === 'H') return S.unknownWordEngine;
  return S.extraWord;
}

/** A B line's words: V= or I= and the expression after it (M19). */
function bRow(p: PartContext, f: Field, k: number): FieldExplanation {
  const key = lowerAscii(f.token.text);
  const next = p.el.fields[k + 1];
  const text = p.netlist.text;
  if ((key === 'v' || key === 'i') && next && text.slice(f.token.to, next.token.from).includes('=')) {
    return fieldOf('expression', f.token, key === 'v' ? S.bVoltage : S.bCurrent);
  }
  const opened = p.el.fields.slice(0, k).some((g, j) => {
    const after = p.el.fields[j + 1];
    return /^[vi]$/i.test(g.token.text) && after !== undefined && text.slice(g.token.to, after.token.from).includes('=');
  });
  if (opened) return fieldOf('expression', f.token, S.bExpression);
  return fieldOf('extra word', f.token, S.bNoExpression);
}

function unitForValue(letter: ElementLetter | undefined): string {
  if (letter === 'G') return 'A';
  if (letter === 'H') return 'V';
  return unitOf(letter);
}

/**
 * On an R, C or L line a second number replaces the first, silently (V2, N9, N10, N13): say which
 * two numbers ngspice read, and why there were two.
 */
function twoNumbersNote(p: PartContext): string | undefined {
  const { el, netlist } = p;
  const used = el.value;
  if (!used) return undefined;
  const numbers = el.fields.filter((f) => f.role === 'value' && readNumber(f.token.text));
  const before = numbers.filter((f) => f.token.from < used.token.from);
  const first = before[before.length - 1];
  if (!first) return undefined;
  const gap = netlist.text.slice(first.token.to, used.token.from);
  const why = gap.includes(',') ? S.twoNumbersComma : gap === '' && /^[+-]/.test(used.token.text) ? S.twoNumbersSign : '';
  const shown = valueWords(netlist, used.token, unitOf(el.letter), used.number).text;
  return S.twoNumbersNote(first.token.text, used.token.text, shown, why);
}

/** The meaning of the value ngspice uses, in the words of its part. */
function mainValueMeaning(p: PartContext, f: Field): string {
  const { el, netlist } = p;
  const words = valueWords(netlist, f.token, unitForValue(el.letter), el.value?.number);
  for (const n of words.notes) addNote(p.notes, n);
  switch (el.letter) {
    case 'E':
      return S.gainRatio(words.text, 'voltage');
    case 'F':
      return S.gainRatio(words.text, 'current');
    case 'G':
      return S.gmMeaning(words.text);
    case 'H':
      return S.rmMeaning(words.text);
    case 'K':
      return S.kMeaning(words.text);
    default:
      return words.text;
  }
}

function nodeRow(p: PartContext, f: Field, ref: NodeRef, index: number, label: string): FieldExplanation {
  const special = nodeSpecial(ref);
  if (special.note === 'gnd') addNote(p.notes, S.gndLastWordNote(p.el.name.text));
  if (special.note === 'ground') addNote(p.notes, S.groundWordNote(ref.token.text));
  const n = special.meaning && !ref.ground ? special.meaning : nodeText(ref);
  const letter = p.el.letter;
  let meaning: string;
  switch (f.role) {
    case 'plus':
      meaning = letter === 'D' ? S.anode(n) : S.plusSide(n);
      break;
    case 'minus':
      meaning = letter === 'D' ? S.cathode(n) : S.minusSide(n);
      break;
    case 'from':
      meaning = S.fromNode(n);
      break;
    case 'to':
      meaning = S.toNode(n);
      break;
    case 'control-plus':
      meaning = S.controlPlus(n);
      break;
    case 'control-minus':
      meaning = S.controlMinus(n);
      break;
    default:
      meaning = letter === 'R' || letter === 'C' || letter === 'L' ? (index === 0 ? S.oneEnd(n) : S.otherEnd(n)) : S.connected(n);
  }
  if (ref.ground && special.meaning) meaning = `${meaning}; ${special.meaning}`;
  return fieldOf(label, f.token, meaning, EMPHASIS[f.role]);
}

/** "the voltage at node a, measured from node b" (ground for node 0). */
function voltagePhrase(p: NodeRef | undefined, n: NodeRef | undefined): string {
  return S.voltageAt(nodeProse(p), nodeProse(n));
}

function explainPart(netlist: Netlist, line: NetlistLine): LineExplanation {
  const el = line.element!;
  const info = el.letter ? elementInfo(el.letter) : undefined;
  const p: PartContext = { netlist, line, el, info, notes: [] };
  const fields = partFields(p);
  const heading = S.partHeading(el.name.text, partWhat(info), info?.code);
  const [a, b, c, d] = el.nodes;
  const value = el.value ? valueWords(netlist, el.value.token, unitForValue(el.letter), el.value.number) : paramValue(netlist, el);
  const sentences: string[] = [];
  const ctx = contextOf(netlist);
  switch (el.letter) {
    case 'R':
    case 'C':
    case 'L': {
      sentences.push(S.twoTerminal(el.name.text, value?.value !== undefined ? plain(value.value, unitOf(el.letter)) : '', partWhat(info), nodePhrase(a), nodePhrase(b)));
      if (el.value && value?.value === undefined && /^[{']/.test(el.value.token.text)) sentences.push(S.valueIsExpression);
      addNote(p.notes, twoNumbersNote(p));
      if (!el.value && el.nodes.length >= 2 && !el.fields.some((f) => f.role === 'model' || f.role === 'other')) {
        // P15, P15b: nothing after the nodes; missing-value-8 ... -10 in traps.md: settings but no value.
        if (el.fields.length === 3) addNote(p.notes, S.missingValueRCL(partWhat(info)));
        else addNote(p.notes, el.letter === 'R' ? S.missingValueKeptR : S.missingValueKept(partWhat(info), el.letter === 'C' ? 'capacitance' : 'inductance'));
      }
      if (el.letter === 'R') {
        const v = value?.value;
        if (v !== undefined && v < 0) addNote(p.notes, S.negativeR); // P14
        if (v === 0) addNote(p.notes, S.zeroR); // P13
        else if (v !== undefined && Math.abs(v) > 0 && Math.abs(v) < 1e-12) addNote(p.notes, S.tinyR); // P24
        addNote(p.notes, S.resistorNote); // P1, P2
      }
      if (el.letter === 'C') addNote(p.notes, S.capacitorNote); // P11, A31
      if (el.letter === 'L') addNote(p.notes, S.inductorNote); // P12, A31
      break;
    }
    case 'V': {
      const v = value?.value;
      if (a && b) {
        sentences.push(S.vSides(el.name.text, nodePhrase(a), nodePhrase(b)));
        const fn = el.sourceFunction;
        if (v !== undefined) {
          const shown = formatSI(v, 'V');
          sentences.push(S.vReads(nodeFormula(a), nodeFormula(b), shown)); // P3
          const swept = sweptBy(netlist, el.key);
          if (swept !== undefined) {
            sentences.push(S.vSwept(swept + 1)); // A7
          } else if (v === 0 && !fn) {
            sentences.push(S.vZero(nodePhrase(a), nodePhrase(b), el.name.text)); // P9
            addNote(p.notes, S.vZeroCurrent(el.name.text, nodeProse(a), nodeProse(b)));
          } else if (b.ground && !a.ground) sentences.push(S.vGround(nodeProse(a), shown));
          else if (a.ground && !b.ground) sentences.push(S.vGround(nodeProse(b), formatSI(-v, 'V')));
          else if (!a.ground && !b.ground) sentences.push(v < 0 ? S.vBelow(nodeProse(a), nodeProse(b), formatSI(-v, 'V')) : S.vAbove(nodeProse(a), nodeProse(b), shown));
          // P3b: the "so" above is .op's; .tran follows the function from time 0, never this value.
          if (swept === undefined && fn) sentences.push(S.dcValueInOp(fn.token.text));
        } else if (fn) {
          const t0 = valueAtTimeZero(fn);
          sentences.push(t0 === undefined ? S.timeZeroValueUnknown(fn.token.text) : S.timeZeroValue(fn.token.text, formatSI(t0, 'V'))); // P17
        } else if (!el.value && !el.fields.some((f) => f.role === 'other')) {
          // P16, P16b. A word ngspice cannot read stops it instead (its row says so; re-check C3).
          addNote(p.notes, el.fields.some((f) => f.role === 'value') ? S.dcNoNumber('V') : S.missingValueSource('V'));
        }
      }
      // C1, C1b, C2: which sign means "delivers power" depends on which side is the higher one.
      const sign = v === undefined ? S.sourceSignGeneral : v > 0 ? S.sourceSignPositive : v < 0 ? S.sourceSignNegative : '';
      addNote(p.notes, sign ? `${S.sourceSign} ${sign}` : S.sourceSign);
      break;
    }
    case 'I': {
      sentences.push(S.iPattern); // P4
      const v = value?.value;
      // P4b: a source a .dc line sweeps pushes no one value there, so only its direction is said, and
      // that the .dc sweeps it, as for V (critic of words re-check 12's fix: "its value is negative, so
      // it pushes 2 mA" while the sweep's 5 mA flowed the other way).
      const swept = sweptBy(netlist, el.key);
      if (a && b) {
        if (v !== undefined && swept === undefined && v < 0) sentences.push(S.iPushesBack(el.name.text, formatSI(-v, 'A'), nodePhrase(b), nodePhrase(a)));
        else if (v !== undefined && swept === undefined) sentences.push(S.iPushes(el.name.text, formatSI(v, 'A'), nodePhrase(a), nodePhrase(b)));
        else sentences.push(S.iPushesNoValue(el.name.text, nodePhrase(a), nodePhrase(b)));
        if (swept !== undefined) sentences.push(S.vSwept(swept + 1));
        // P4c: with a transient function too, the value is .op's; .tran follows the function from time 0.
        else if (v !== undefined && el.sourceFunction) sentences.push(S.dcValueInOp(el.sourceFunction.token.text));
      }
      if (v === undefined && el.sourceFunction) {
        const t0 = valueAtTimeZero(el.sourceFunction);
        sentences.push(t0 === undefined ? S.timeZeroValueUnknown(el.sourceFunction.token.text) : S.timeZeroValue(el.sourceFunction.token.text, formatSI(t0, 'A')));
      } else if (!el.value && !el.sourceFunction && !el.fields.some((f) => f.role === 'other')) {
        // P16, P16b. A word ngspice cannot read stops it instead (its row says so; re-check C3).
        addNote(p.notes, el.fields.some((f) => f.role === 'value') ? S.dcNoNumber('A') : S.missingValueSource('A'));
      }
      break;
    }
    case 'E': {
      if (a && b && c && d && value) {
        // P5: V(+) − V(−) = gain × (V(c+) − V(c−)).
        const gain = value.value !== undefined ? formatNumber(value.value) : value.text;
        sentences.push(S.eSentence(voltagePhrase(a, b), gain, voltagePhrase(c, d)));
        sentences.push(S.eReads(nodeFormula(a), nodeFormula(b), gain, nodeFormula(c), nodeFormula(d)));
      } else if (d && !value) addNote(p.notes, noGainNoteOf(el, 'gain')); // missing-value-4, -11 in traps.md
      else addNote(p.notes, S.eFieldsNote); // M9
      break;
    }
    case 'G': {
      if (a && b && c && d && value) {
        // P6: gm × (V(c+) − V(c−)) amps from the first node, through G, into the second.
        const gm = value.value !== undefined ? formatSI(value.value, 'A') : value.text;
        const control = d.ground ? S.gAt(nodeProse(c)) : S.gBetween(nodeProse(c), nodeProse(d));
        sentences.push(capitalise(S.gSentence(gm, control, nodePhrase(a), nodePhrase(b))));
        const g = value.value !== undefined ? formatNumber(value.value) : value.text;
        sentences.push(S.gReads(g, nodeFormula(c), nodeFormula(d), nodeProse(a), el.name.text, nodeProse(b)));
      } else if (d && !value) addNote(p.notes, noGainNoteOf(el, 'value in amps per volt')); // missing-value-5, -12
      else addNote(p.notes, S.eFieldsNote); // M9
      break;
    }
    case 'F':
    case 'H': {
      const control = el.controlSource;
      if (a && b && control && value) {
        if (el.letter === 'F') {
          // P7
          const gain = value.value !== undefined ? formatNumber(value.value) : value.text;
          sentences.push(capitalise(S.fSentence(gain, control.text, nodePhrase(a), nodePhrase(b))));
        } else {
          // P8
          const r = value.value !== undefined ? formatSI(value.value, 'V') : value.text;
          sentences.push(S.hSentence(voltagePhrase(a, b), r, control.text));
        }
        const target = partKind(netlist, control.text);
        const tl = target.line !== undefined ? netlist.lines[target.line]?.element : undefined;
        if (tl && (target.letter === 'V' || target.letter === 'E' || target.letter === 'H') && tl.nodes[0] && tl.nodes[1]) {
          sentences.push(S.controlCurrentSign(control.text, nodeProse(tl.nodes[0]), nodeProse(tl.nodes[1])));
        }
      } else if (a && b && control && !value && !readNumber(control.text)) {
        addNote(p.notes, noGainNoteOf(el, el.letter === 'F' ? 'gain' : 'value in volts per amp')); // missing-value-6, -7, -11, -12
      }
      addNote(p.notes, S.ammeterTrick); // P9, P10
      break;
    }
    case 'K': {
      const [l1, l2] = el.fields.filter((f) => f.role === 'other').map((f) => f.token.text);
      if (l1 && l2) sentences.push(S.kSentence(el.name.text, l1, l2, value?.value !== undefined ? formatNumber(value.value) : (value?.text ?? '?'))); // P21
      break;
    }
    default: {
      // A label that says node keeps the name alone ("+ node c"); others say where ("collector at node c").
      const labels = el.nodes.map((ref, k) => {
        const label = labelFor(el.letter, 'node', k).replace(/ \(.*\)$/, '');
        return /(^|\s)node$/.test(label) ? S.labelledNode(label, nodeName(ref)) : S.labelledAt(label, nodeText(ref));
      });
      sentences.push(S.otherPart(el.name.text, partWhat(info), S.listJoin(labels)));
      sentences.push(S.notExplained);
      // What ngspice needs, unless the field table already says whether the model or subcircuit is there.
      const checked = el.fields.some((f) => f.role === 'model') || el.letter === 'B';
      if (info?.needs && (!checked || !info.inEngine)) addNote(p.notes, S.needs(info.needs));
      if (info && !info.inEngine) addNote(p.notes, S.notInEngine);
      if (el.letter === 'B' && !el.fields.some((f) => /^[vi]$/i.test(f.token.text))) addNote(p.notes, S.bMalformedNote); // M19
      break;
    }
  }
  const inside = ctx.insideSubckt.get(line.index);
  if (inside !== undefined) {
    const name = netlist.lines[inside]?.directive?.args[0]?.text ?? '';
    addNote(p.notes, S.insideSubcircuit(name, inside + 1));
  }
  return { line: line.number, heading, summary: sentences.join(' '), fields, notes: p.notes };
}

// ------------------------------------------------------------------ dot commands

// .pss, .hb and .sens2 are left out: ngspice 47 as built for PlainSpice stops at them (A29b).
const OTHER_ANALYSES = new Set(['.noise', '.disto', '.pz', '.sens', '.sp', '.fourier', '.four']);
const KNOWN_DOT = new Set([
  // No .endl: a library section is only read from another file; in the netlist it stops ngspice (unknown-dot-command-3).
  '.width', '.temp', '.nodeset', '.global', '.func', '.csparam', '.if', '.elseif', '.else', '.endif', '.title',
  '.probe', '.prot', '.unprot', '.macro', '.eom', '.para', '.parameter', '.parameters',
]);
const EXPLAINED_DOT = new Set([
  '.op', '.tf', '.dc', '.tran', '.ac', '.end', '.options', '.option', '.opt', '.param', '.model', '.include', '.inc', '.lib',
  '.print', '.plot', '.save', '.control', '.endc', '.ic', '.meas', '.measure', '.subckt', '.ends',
]);

/**
 * True for the dot commands ngspice 47 knows (its parser's list in inp2dot.c and the ones its
 * front end handles); any other dot command stops ngspice with "unimplemented dot command" (A29).
 */
export function isKnownDotCommand(name: string): boolean {
  const n = lowerAscii(name);
  return EXPLAINED_DOT.has(n) || OTHER_ANALYSES.has(n) || KNOWN_DOT.has(n) || n.startsWith('.para');
}

function commandRow(token: Token, what: string): FieldExplanation {
  return fieldOf(S.labelCommand, token, what);
}

function explainDirective(netlist: Netlist, line: NetlistLine): LineExplanation {
  const d = line.directive!;
  const name = d.name;
  // A3f: ngspice ignores an analysis line in a subcircuit no X line uses, so what the line would make
  // ngspice do (a missing node's 0, a stop) is not said: only that it is ignored.
  const unused = RUN_ANALYSES.has(name) ? unusedSubcircuit(netlist, line.index) : undefined;
  const out = (what: string, summary: string, fields: FieldExplanation[] = [], notes: string[] = []): LineExplanation => ({
    line: line.number,
    heading: S.dotHeading(d.token.text, what),
    summary,
    fields: [commandRow(d.token, what), ...fields],
    notes: unused ? [S.analysisInUnusedSubcircuit(unused.name, unused.line + 1)] : notes,
  });
  const ctx = contextOf(netlist);
  switch (name) {
    case '.op': {
      const notes = ctx.hasSaveCurrents ? [] : [S.opSaveCurrents]; // A2, A2b, C7
      return out(S.opWhat, S.op, [], notes); // A1, P11, P12
    }
    case '.tf':
      return explainTf(netlist, line, out);
    case '.dc':
      return explainDc(netlist, line, out);
    case '.tran':
      return explainTran(netlist, line, out);
    case '.ac':
      return explainAc(netlist, line, out);
    case '.end': {
      const notes = endIsGlued(line) ? [S.endGlued] : [S.endKeepsReading]; // S25–S27
      return out(S.endWhat, S.end, [], notes);
    }
    case '.options':
    case '.option':
    case '.opt': {
      const fields: FieldExplanation[] = [];
      for (const [n, v] of pairs(netlist, d.args)) {
        const key = lowerAscii(n.text);
        // Only savecurrents has a meaning PlainSpice checked by running ngspice (A2); the rest are named only.
        const meaning = key === 'savecurrents' ? S.optionSaveCurrents : S.optionGeneric(n.text); // A2, A2b, C7
        fields.push(fieldOf('setting', n, meaning));
        if (v) {
          const r = readNumber(v.text);
          fields.push(fieldOf('setting value', v, S.optionValue(r ? formatNumber(r.value) : v.text)));
        }
      }
      return out(S.optionsWhat, S.options, fields);
    }
    case '.param': {
      const fields: FieldExplanation[] = [];
      for (const [n, v] of pairs(netlist, d.args)) {
        fields.push(fieldOf('name', n, S.paramName(n.text)));
        if (v) {
          const r = readNumber(v.text);
          fields.push(fieldOf('value', v, S.paramValue(r ? formatNumber(r.value) : v.text)));
        }
      }
      return out(S.paramWhat, S.param, fields); // A23
    }
    case '.model': {
      const [m, t, ...rest] = d.args;
      const kind = t ? (MODEL_KINDS[lowerAscii(t.text)] ?? '') : '';
      const fields: FieldExplanation[] = [];
      if (m) fields.push(fieldOf('model name', m, S.modelName(m.text)));
      if (t) fields.push(fieldOf('model type', t, S.modelType(t.text, kind)));
      for (const [n, v] of pairs(netlist, rest)) {
        fields.push(fieldOf('parameter', n, S.parameterName(n.text)));
        if (v) {
          const r = readNumber(v.text);
          fields.push(fieldOf('parameter value', v, S.parameterValue(r ? formatNumber(r.value) : v.text)));
        }
      }
      const notes: string[] = [];
      const left = leftOutModel(netlist, line.index);
      if (left && m) notes.push(S.modelLeftOutNote(m.text, left.level, left.model, left.kind, left.message)); // M8
      return out(S.modelWhat, S.model(m?.text ?? '', kind), fields, notes); // A30
    }
    case '.include':
    case '.inc':
      return out(S.includeWhat, S.include, d.args.map((a) => fieldOf('file', a, S.fileName(a.text)))); // A26
    case '.lib':
      return out(S.libWhat, S.lib, d.args.map((a, k) => fieldOf(k === 0 ? 'file' : 'section', a, k === 0 ? S.fileName(a.text) : S.libSection(a.text))), d.args.length < 2 ? [S.libOneWord] : []); // A33, include-not-available-3
    case '.print':
    case '.plot':
      return out(S.printWhat(name), S.print(name), vectorFields(netlist, d.args).map((f) => f.field)); // A25, A25b
    case '.save': {
      const fields = vectorFields(netlist, d.args);
      return out(S.saveWhat, S.save(fields.map((f) => f.said).join(', ')), fields.map((f) => f.field)); // A24
    }
    case '.control':
      return out(S.controlWhat, S.control); // S31, A27
    case '.endc':
      return out(S.endcWhat, S.endc);
    case '.ic': {
      const fields: FieldExplanation[] = [];
      for (let k = 0; k < d.args.length; ) {
        const g = vectorAt(netlist, d.args, k);
        if (g) {
          const v = d.args[k + g.used];
          const r = v ? readNumber(v.text) : undefined;
          fields.push({ label: 'node voltage', text: g.text, span: g.span, meaning: S.icField(vectorWords(netlist, g), r ? formatSI(r.value, 'V') : (v?.text ?? '?')) });
          if (v) fields.push(fieldOf('value', v, r ? formatSI(r.value, 'V') : v.text));
          k += g.used + (v ? 1 : 0);
        } else {
          fields.push(fieldOf(S.argument(k + 1), d.args[k], d.args[k]!.text));
          k += 1;
        }
      }
      return out(S.icWhat, S.ic, fields); // A32
    }
    case '.meas':
    case '.measure':
      return out(S.measWhat, S.meas); // A28
    case '.subckt':
    case '.macro': {
      const [n, ...rest] = d.args;
      const nodes = rest.filter((t) => !/^params:$/i.test(t.text));
      const fields: FieldExplanation[] = [];
      if (n) fields.push(fieldOf('name', n, S.subcktName(n.text)));
      for (const t of nodes) fields.push(fieldOf('node', t, S.subcktNode(t.text)));
      return out(S.subcktWhat, S.subckt(n?.text ?? '', nodes.map((t) => t.text).join(', ')), fields); // A35, M6
    }
    case '.ends':
    case '.eom':
      return out(S.endsWhat, S.ends);
    default:
      if (OTHER_ANALYSES.has(name)) return out(S.otherAnalysisWhat, S.otherAnalysis(d.token.text)); // A34
      if (KNOWN_DOT.has(name)) return out(S.knownWhat, S.known(d.token.text)); // A34
      return out(S.unknownWhat, S.unknown(d.token.text)); // A29
  }
}

/** The rows of a .save or .print line, each with the result as the line's sentence names it (vectorWords). */
function vectorFields(netlist: Netlist, args: readonly Token[]): { field: FieldExplanation; said: string }[] {
  const fields: { field: FieldExplanation; said: string }[] = [];
  for (let k = 0; k < args.length; ) {
    const g = vectorAt(netlist, args, k);
    if (g) {
      const said = vectorWords(netlist, g);
      fields.push({ field: { label: 'result', text: g.text, span: g.span, meaning: S.vectorField(said) }, said });
      k += g.used;
    } else {
      const t = args[k]!;
      const isType = k === 0 && /^(dc|ac|tran|op|tf|noise|disto)$/i.test(t.text);
      fields.push({ field: fieldOf(isType ? 'analysis' : 'result', t, isType ? S.analysisField(t.text) : S.vectorField(t.text)), said: t.text });
      k += 1;
    }
  }
  return fields;
}

/**
 * A v(...) group as a sentence names it: as written ("v(out)"), unless a node's name in it has a
 * character that is not what it looks like, which is never shown hidden in it (S11): then in words,
 * with the character named ("the voltage at node out (written with a zero-width space in it)").
 */
function vectorWords(netlist: Netlist, g: VectorGroup): string {
  if (g.kind !== 'voltage' || g.names.every((t) => nodeNameInWords(t.text) === t.text)) return g.text;
  const [a, b] = g.names.map((t) => nodeProse(nodeOfWord(netlist, t)));
  return b ? S.voltageBetweenNodes(a!, b) : S.voltageOfNode(a ?? '?');
}

type Out = (what: string, summary: string, fields?: FieldExplanation[], notes?: string[]) => LineExplanation;

function partWord(netlist: Netlist, line: number): string {
  return partWhat(elementInfo(netlist.lines[line]?.element?.letter ?? ''));
}

function explainTf(netlist: Netlist, line: NetlistLine, out: Out): LineExplanation {
  const r = readAnalysis(netlist, line.index) as Extract<AnalysisReading, { kind: 'tf' }>;
  const d = line.directive!;
  const fields: FieldExplanation[] = [];
  const notes: string[] = [];
  const g = vectorAt(netlist, d.args, 0);
  // The output's nodes as the parser reads them, each said one way here and in the results: a gnd that
  // ngspice makes 0 is ground (A3b), a name like ground is quoted (W13), a hidden character named.
  const [n1, n2] = r.outputNodes;
  if (g) {
    const meaning = g.kind === 'current' ? S.tfOutputI(g.names[0]?.text ?? '') : S.tfOutputV(nodeProse(n1), n2 ? nodeProse(n2) : '');
    fields.push({ label: 'output', text: g.text, span: g.span, meaning });
    for (const n of r.outputNodes) {
      // Ground is always a node (every voltage is measured from it); a circuit with nothing on it has its own check.
      const info = netlist.nodes.get(n.name);
      if (n.ground || (info && info.connections.length > 0)) continue;
      // ngspice's name for a node inside a subcircuit an X line uses: said which node it is (A3h).
      const inner = innerNode(netlist, n.name);
      if (!inner) addNote(notes, S.tfNodeMissingNote(nodeName(n))); // A6
      else {
        const inside = [...inner.path].reverse().join(', inside ');
        addNote(notes, S.innerNodeNote(nodeName(n), nodeText(inner.node), inner.subcircuit, inner.line + 1, inside, inner.path.length > 1));
      }
    }
  }
  // A part inside a subcircuit, by ngspice's name for it (v.x1.vs): said which part it is (A3h).
  const partNote = (name: string, inner: InnerPart): void =>
    addNote(notes, S.innerPartNote(name, inner.part.name.text, inner.subcircuit, inner.line + 1, [...inner.path].reverse().join(', inside '), inner.path.length > 1));
  const current = r.outputKind === 'current' && g?.names[0] && partKind(netlist, g.names[0].text).line === undefined ? innerPart(netlist, g.names[0].text) : undefined;
  if (current) partNote(g!.names[0]!.text, current);
  const input = r.input;
  if (input) {
    const part = partKind(netlist, input.text);
    const inner = part.line === undefined ? innerPart(netlist, input.text) : undefined;
    const at = part.line ?? inner?.partLine;
    let meaning: string;
    if (r.inputKind === 'missing') {
      meaning = S.tfInputMissing(input.text);
      addNote(notes, S.tfInputMissingNote(input.text)); // M10
    } else if (r.inputKind === 'other') {
      meaning = S.tfInputWrong(input.text, partWord(netlist, at!));
      addNote(notes, S.tfInputWrongNote(input.text)); // M11
    } else meaning = S.tfInput(input.text, at! + 1, partWord(netlist, at!));
    if (inner) partNote(input.text, inner);
    fields.push(fieldOf('input source', input, meaning));
  }
  // The formula keeps the line's words, but never a character hidden in them (S11): the words after it name it.
  const outText = withoutInvisible(r.output);
  const inText = input?.text ?? '?';
  const at = n2 ? S.tfBetween(nodeProse(n1), nodeProse(n2)) : S.tfAt(nodeProse(n1));
  const ratio = `${r.outputKind === 'current' ? 'A' : 'V'}/${r.inputKind === 'current' ? 'A' : 'V'}`;
  const ratioWords = ratio === 'V/A' ? 'V/A, which is ohms' : ratio;
  let summary = r.outputKind === 'current' ? S.tfCurrent(outText, inText) : S.tf(outText, inText, at); // A3, A4
  summary += ` ${S.tfRatio(ratioWords)}`;
  if (r.outputKind === 'current') addNote(notes, S.tfCurrentNote); // A5
  return out(S.tfWhat, summary, fields, notes);
}

function explainDc(netlist: Netlist, line: NetlistLine, out: Out): LineExplanation {
  const r = readAnalysis(netlist, line.index) as Extract<AnalysisReading, { kind: 'dc' }>;
  const fields: FieldExplanation[] = [];
  const notes: string[] = [];
  const phrases: string[] = [];
  r.sweeps.forEach((s, k) => {
    const second = k > 0 ? 'second ' : '';
    if (s.kind === 'temperature') fields.push(fieldOf(`${second}source`, s.source, S.dcSourceTemp));
    else if (s.line !== undefined && s.kind !== 'unknown') fields.push(fieldOf(`${second}source`, s.source, S.dcSourceField(s.source.text, s.line + 1, partWord(netlist, s.line))));
    else if (s.line !== undefined) {
      // dc-sweep-problems-7: a part .dc cannot sweep, such as a capacitor.
      fields.push(fieldOf(`${second}source`, s.source, S.dcSourceWrongField(s.source.text, partWord(netlist, s.line))));
      addNote(notes, S.dcSourceWrong(s.source.text, partWord(netlist, s.line)));
    } else {
      fields.push(fieldOf(`${second}source`, s.source, S.dcSourceMissingField(s.source.text)));
      addNote(notes, S.dcSourceMissing(s.source.text)); // M12
    }
    // An invisible character is never shown: the word without it (its row and Checks name it).
    const v = (t: Token | undefined, x: number | undefined): string => (x !== undefined ? plain(x, s.unit) : t ? withSpaces(withoutInvisible(t.text)) : '?');
    // A word that is no number where one goes stops ngspice 47 ("Bad syntax!"; dc-sweep-problems-9, -10,
    // invisible-character-12 to -15, look-alike-letter-8): said so, never as a sweep that runs (re-check S5).
    // A word in braces or quotes is a number numparam works out first (dc-sweep-problems-17; its critic, CR1-4).
    const notNumber = (t: Token | undefined, x: number | undefined): boolean => t !== undefined && x === undefined && !isExpression(t);
    const read = (t: Token | undefined, x: number | undefined, what: (v: string) => string): string =>
      notNumber(t, x) ? S.dcNotNumber : t && isExpression(t) ? what(valueWords(netlist, t, s.unit).text) : what(v(t, x));
    if (s.start) fields.push(fieldOf('start', s.start, read(s.start, s.startValue, S.dcStart)));
    if (s.stop) fields.push(fieldOf('stop', s.stop, read(s.stop, s.stopValue, S.dcStop)));
    if (s.step) fields.push(fieldOf('step', s.step, read(s.step, s.stepValue, S.dcStep)));
    if (notNumber(s.start, s.startValue) || notNumber(s.stop, s.stopValue) || notNumber(s.step, s.stepValue)) addNote(notes, S.dcNotNumberNote);
    else if (!s.step || s.stepValue === 0) addNote(notes, S.dcStepZero); // M13, M13b
    else if (s.points === 0) {
      // A11 on a line of one sweep, or when both sweeps have none; in two sweeps one the wrong way never moves.
      const other = r.sweeps[1 - k];
      addNote(notes, !other || other.points === 0 ? S.dcNoPoints : k === 1 ? S.dcStuckSecond(s.source.text, v(s.start, s.startValue), other.source.text) : S.dcStuckFirst(s.source.text, v(s.start, s.startValue), other.source.text));
    }
    const name = s.kind === 'temperature' ? 'the temperature' : s.source.text;
    phrases.push(S.dcSweep(name, v(s.start, s.startValue), v(s.stop, s.stopValue), v(s.step, s.stepValue)));
  });
  const first = r.sweeps[0];
  const points = r.sweeps.length === 1 && first?.points !== undefined && first.points > 0 ? S.dcPoints(first.points) : '';
  let summary = S.dc(phrases.join(' and '), points); // A7–A10, A31
  if (r.sweeps.length > 1 && r.points !== undefined && r.points > 0) {
    summary += ` ${S.dcNested(r.sweeps[0]!.source.text, r.sweeps[1]!.source.text, r.points)}`; // A12
  }
  // A line ngspice 47 cannot read is never told as a sweep that runs (re-check critic CR1-11).
  if (dcStopsNgspice(r)) summary = S.dcStops;
  return out(S.dcWhat, summary, fields, notes);
}

function explainTran(netlist: Netlist, line: NetlistLine, out: Out): LineExplanation {
  const r = readAnalysis(netlist, line.index) as Extract<AnalysisReading, { kind: 'tran' }>;
  const d = line.directive!;
  const fields: FieldExplanation[] = [];
  const notes: string[] = [];
  let k = 0;
  for (const t of d.args) {
    if (lowerAscii(t.text) === 'uic') {
      fields.push(fieldOf('uic', t, S.tranUic)); // P23, A32
      continue;
    }
    const x = readNumber(t.text)?.value;
    const s = x !== undefined ? formatSI(x, 's') : t.text;
    const rows: [string, (v: string) => string][] = [
      ['tstep', S.tranStep],
      ['tstop', S.tranStop],
      ['tstart', S.tranStart],
      ['tmax', S.tranMax],
    ];
    const row = rows[k];
    fields.push(row ? fieldOf(row[0], t, row[1](s)) : fieldOf(S.argument(k + 1), t, t.text));
    k += 1;
  }
  if (r.tstop === undefined) addNote(notes, S.tranOneNumber); // M14
  else if (r.tstep !== undefined && r.tstep <= 0) addNote(notes, S.tranStepZero); // M15
  else if (r.tstart !== undefined && r.tstart >= r.tstop) addNote(notes, S.tranStartLate); // M15b
  let summary: string;
  if (r.tstop !== undefined && r.maxStep !== undefined && r.maxStep > 0) {
    summary = S.tran(formatSI(r.tstop, 's'), r.tstart ? formatSI(r.tstart, 's') : '', formatSI(r.maxStep, 's')); // A16–A19
    if (r.tmax === undefined) addNote(notes, S.tranMaxStepRule);
  } else {
    summary = S.tranIncomplete;
  }
  return out(S.tranWhat, summary, fields, notes);
}

function explainAc(netlist: Netlist, line: NetlistLine, out: Out): LineExplanation {
  const r = readAnalysis(netlist, line.index) as Extract<AnalysisReading, { kind: 'ac' }>;
  const d = line.directive!;
  const [t, n, f1, f2] = d.args;
  const per =
    r.perStep === undefined ? '' : r.type === 'dec' ? S.acPerDecade(formatNumber(r.perStep)) : r.type === 'oct' ? S.acPerOctave(formatNumber(r.perStep)) : S.acLinear(formatNumber(r.perStep));
  const fields: FieldExplanation[] = [];
  if (t) fields.push(fieldOf('spacing', t, S.acType(t.text)));
  if (n) fields.push(fieldOf('points', n, per || n.text));
  if (f1) fields.push(fieldOf('start', f1, S.acStart(r.fstart !== undefined ? formatSI(r.fstart, 'Hz') : f1.text)));
  if (f2) fields.push(fieldOf('stop', f2, S.acStop(r.fstop !== undefined ? formatSI(r.fstop, 'Hz') : f2.text)));
  const points = r.points !== undefined && r.type !== 'lin' ? S.dcPoints(r.points) : r.points !== undefined && r.points !== r.perStep ? S.dcPoints(r.points) : '';
  const summary = S.ac(
    r.fstart !== undefined ? formatSI(r.fstart, 'Hz') : '?',
    r.fstop !== undefined ? formatSI(r.fstop, 'Hz') : '?',
    per,
    points,
  ); // A20–A22, P21
  return out(S.acWhat, summary, fields, [S.acNotShown]);
}

// ------------------------------------------------------------------ other lines

/** A line without the leading blanks ngspice skips (spaces, tabs, carriage returns, a byte-order mark), so a form feed stays. */
function leadTrim(s: string): string {
  return s.replace(/^[ \t\r\ufeff]+/, '');
}

function firstChar(line: NetlistLine): string {
  return leadTrim(line.text)[0] ?? '';
}

/**
 * The drawing lines as one entry, in the Netlist and Checks panels' words (kept F2, words W11): what
 * they are for, and that ngspice skips them (drawing-1, S6). Every line of a run gets the same entry.
 */
function explainDrawing([first, last]: readonly [number, number]): LineExplanation {
  if (first === last) return { line: first + 1, heading: S.drawingHeadingOne, summary: S.drawingLine, fields: [], notes: [] };
  return { line: first + 1, lastLine: last + 1, heading: S.drawingHeading, summary: S.drawingLines, fields: [], notes: [] };
}

function explainComment(netlist: Netlist, line: NetlistLine): LineExplanation {
  const drawing = contextOf(netlist).drawing.get(line.index);
  if (drawing) return explainDrawing(drawing);
  const t = leadTrim(line.text);
  const c = t[0] ?? '';
  let summary: string;
  if (c === '*') summary = S.commentStar; // S6
  else if (c === '#') summary = S.commentHash; // S8
  else if (c === ';') summary = S.commentSemicolon; // S11
  else if (t.startsWith('//')) summary = S.commentSlashes; // S19
  else summary = S.commentOdd(c === '\f' ? 'a form feed' : c); // S10, S36
  const notes: string[] = [];
  const swallowed = contextOf(netlist).continuedBy.get(line.index);
  if (swallowed?.length) notes.push(S.commentSwallows(swallowed[0]! + 1)); // S20, S21
  return { line: line.number, heading: S.commentHeading, summary, fields: [], notes };
}

function explainContinuation(netlist: Netlist, line: NetlistLine): LineExplanation {
  const notes: string[] = [];
  if (line.continues === undefined) {
    return { line: line.number, heading: S.continuationHeading, summary: S.continuationNothing, fields: [], notes }; // S22, S5
  }
  const target = netlist.lines[line.continues]!;
  if (target.kind === 'comment') {
    // S20, S21: the continuation goes into the comment; the part before it loses these words.
    const summary = S.continuationIntoComment(target.number);
    for (let i = target.index - 1; i > 0; i--) {
      const prev = netlist.lines[i]!;
      if (prev.kind === 'element' && prev.element) {
        notes.push(S.continuationLost(prev.number, prev.element.name.text));
        break;
      }
      if (prev.kind !== 'comment' && prev.kind !== 'blank') break;
    }
    return { line: line.number, heading: S.continuationHeading, summary, fields: [], notes };
  }
  const what = target.element ? target.element.name.text : target.directive ? target.directive.token.text : '';
  const shell = !firstChar(line).startsWith('+');
  const summary = shell ? S.continuationShell(target.number, what) : S.continuation(target.number, what); // S18, S23, S24
  // The rows of the continued line that sit on this physical line.
  const fields = rowsByLine(netlist, target.index).get(line.index) ?? [];
  return { line: line.number, heading: S.continuationHeading, summary, fields, notes };
}

/**
 * A continued statement's field rows, grouped by the physical line each one sits on. Worked out
 * once per statement: explaining the whole statement again for each of its '+' lines made a
 * netlist with thousands of them take minutes (the cost grew with the square of their number).
 */
const continuedRows = new WeakMap<Netlist, Map<number, Map<number, FieldExplanation[]>>>();

function rowsByLine(netlist: Netlist, target: number): Map<number, FieldExplanation[]> {
  let byTarget = continuedRows.get(netlist);
  if (!byTarget) continuedRows.set(netlist, (byTarget = new Map()));
  const cached = byTarget.get(target);
  if (cached) return cached;
  const rows = new Map<number, FieldExplanation[]>();
  const lines = netlist.lines;
  let k = target;
  for (const f of explainLine(netlist, target)?.fields ?? []) {
    if (!f.span) continue;
    // Fields come in text order, so the line they sit on only moves forward.
    while (k < lines.length - 1 && lines[k]!.span.to < f.span.from) k++;
    const line = lines[k]!;
    if (f.span.from < line.span.from || f.span.to > line.span.to) continue;
    const list = rows.get(k);
    if (list) list.push(f);
    else rows.set(k, [f]);
  }
  byTarget.set(target, rows);
  return rows;
}

function explainControl(line: NetlistLine): LineExplanation {
  const t = line.text.trimStart();
  const word = lowerAscii(t.split(/[\s;]/)[0] ?? '');
  const token = line.tokens[0];
  // .control and .endc lines open and close the block; the parser gives them no directive.
  if (word === '.control' || word === '.endc') {
    const what = word === '.control' ? S.controlWhat : S.endcWhat;
    const fields = token ? [commandRow(token, what)] : [];
    return { line: line.number, heading: S.dotHeading(token?.text ?? word, what), summary: word === '.control' ? S.control : S.endc, fields, notes: [] }; // S31, A27
  }
  const summary = t.startsWith('*#') ? S.starHashLine : t.startsWith('##') ? S.hashHashLine : S.controlLine; // S16, S17, S31
  return { line: line.number, heading: S.controlHeading, summary, fields: [], notes: [] };
}

function explainAfterEnd(netlist: Netlist, line: NetlistLine): LineExplanation {
  const ctx = contextOf(netlist);
  const stop = ctx.stop;
  // An @ line after a plain .end stops ngspice reading too (S29).
  const at = netlist.lines.find((l) => stop !== undefined && l.index > stop && l.index <= line.index && l.text.trimStart().startsWith('@'));
  let summary: string;
  let heading: string = S.afterEndIgnoredHeading;
  if (stop === undefined) summary = S.afterEndNotRead(0);
  else if (netlist.lines[stop]?.kind === 'invalid') {
    summary = S.afterAt(stop + 1); // S29
    heading = S.afterAtHeading;
  } else if (at) {
    summary = S.afterAt(at.number); // S29
    heading = S.afterAtHeading;
  } else if (ctx.endStops) summary = `${S.afterEndNotRead(stop + 1)} ${S.afterEndGlued}`; // S27
  else {
    summary = S.afterEndRead(stop + 1); // S25, S26, S28
    heading = S.afterEndHeading;
  }
  return { line: line.number, heading, summary, fields: [], notes: [] };
}

/**
 * The lines after a plain .end that ngspice still reads (S25, S26), up to a line starting with @
 * (S29); none after ".end;…" (S27) or when an @ line came before .end.
 */
export function readAfterEnd(netlist: Netlist): NetlistLine[] {
  const ctx = contextOf(netlist);
  const stop = ctx.stop;
  if (stop === undefined || stop !== netlist.end || ctx.endStops) return [];
  const out: NetlistLine[] = [];
  for (let i = stop + 1; i < netlist.lines.length; i++) {
    const l = netlist.lines[i]!;
    if (l.kind !== 'after-end') continue;
    if (l.text.trimStart().startsWith('@')) break;
    out.push(l);
  }
  return out;
}

function explainInvalid(line: NetlistLine): LineExplanation {
  const c = firstChar(line);
  let summary: string;
  let heading: string = S.invalidHeading;
  if (c === '@') {
    heading = S.atHeading;
    summary = line.index === 0 ? S.firstLineAt : S.atLine; // S4, S29
  } else if (/[0-9]/.test(c)) summary = S.invalidDigit(c); // M5
  else if (c === '{' || c === "'") summary = S.invalidBrace(c); // M21
  else summary = S.invalidOther(c); // M5b
  return { line: line.number, heading, summary, fields: [], notes: [] };
}

function looksLikePart(text: string): boolean {
  const words = text.trim().split(/\s+/);
  if (words.length < 4) return false;
  const info = elementInfo(words[0]![0] ?? '');
  return !!info && info.explained && /^[A-Za-z]\w*$/.test(words[0]!) && readNumber(words[words.length - 1]!) !== undefined;
}

function explainTitle(line: NetlistLine): LineExplanation {
  const blank = line.text.trim() === '';
  const notes: string[] = [];
  if (!blank && looksLikePart(line.text)) notes.push(S.titleLooksLikePart); // S1
  if (/\\\\\s*$/.test(line.text) && !/^\s*[*$]/.test(line.text)) notes.push(S.titleBackslashes); // S5
  return { line: line.number, heading: S.titleHeading, summary: blank ? S.titleBlank : S.title, fields: [], notes }; // S1, S2, S3
}

// ------------------------------------------------------------------ public

/**
 * The explanation of one line of a parsed netlist (0-based `lineIndex`), or undefined when the
 * index is out of range. Never throws.
 */
export function explainLine(netlist: Netlist, lineIndex: number): LineExplanation | undefined {
  const line = netlist.lines[lineIndex];
  if (!line) return undefined;
  switch (line.kind) {
    case 'title':
      return explainTitle(line);
    case 'blank':
      return { line: line.number, heading: S.blankHeading, summary: S.blank, fields: [], notes: [] }; // P22
    case 'comment':
      return explainComment(netlist, line);
    case 'continuation':
      return explainContinuation(netlist, line);
    case 'control':
      return line.directive ? explainDirective(netlist, line) : explainControl(line);
    case 'after-end':
      return explainAfterEnd(netlist, line);
    case 'invalid':
      return explainInvalid(line);
    case 'directive':
      return line.directive ? explainDirective(netlist, line) : { line: line.number, heading: S.unknownWhat, summary: S.unknown(line.text.trim()), fields: [], notes: [] };
    case 'element':
      return line.element ? explainPart(netlist, line) : explainInvalid(line);
  }
}

/**
 * Every line explained, in order: one explanation per physical line, blank lines included, except
 * that a run of drawing lines is one entry (its `lastLine` says where it ends).
 */
export function explainNetlist(netlist: Netlist): LineExplanation[] {
  const out: LineExplanation[] = [];
  for (let i = 0; i < netlist.lines.length; i++) {
    const e = explainLine(netlist, i);
    if (!e) continue;
    out.push(e);
    if (e.lastLine !== undefined && e.line === i + 1) i = e.lastLine - 1;
  }
  return out;
}

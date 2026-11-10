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
import { elementInfo, fieldLabel, type ElementInfo } from './elements.ts';
import { behaviouralKind, hasReadableCurrent } from './graph.ts';
import { readNumber } from './numbers.ts';
import { isReportOnlyParameter, lowerAscii } from './parse.ts';
import type {
  Element,
  ElementLetter,
  Field,
  FieldExplanation,
  FieldRole,
  LineExplanation,
  Netlist,
  NetlistLine,
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
  nodeWord: (name: string): string => name,

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
  blank: 'SPICE ignores blank lines.',
  commentHeading: 'Comment',
  commentStar: 'The star marks a comment, a line SPICE ignores.',
  commentHash: 'A line starting with # is a comment in ngspice 47, the version PlainSpice runs, so SPICE ignores it.',
  commentSemicolon: 'A line starting with ; is a comment, a line SPICE ignores.',
  commentSlashes: 'A line starting with // is a comment, a line SPICE ignores.',
  commentOdd: (c: string): string =>
    `ngspice turns a line starting with ${c} into a comment and ignores it, with a warning ("Unusual leading characters").`,
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
  continuationNothing: 'There is no line before it to continue (only the title), so ngspice ignores it silently.',
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
    `ngspice stopped reading at line ${end}, so it ignores this line.`,
  afterEndGlued: 'A comment glued to .end (.end;…) makes ngspice stop reading there.',
  afterAt: (line: number): string => `Line ${line} starts with @, so ngspice stopped reading there and ignores this line.`,
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
  twoNumbersNote: (first: string, second: string, used: string, why: string): string =>
    `ngspice read two numbers for the value, ${first} and ${second}, and uses the last one: ${used}.${why ? ` ${why}` : ''}`,
  twoNumbersComma: 'A comma separates words in SPICE: use a decimal point.',
  twoNumbersSign: 'A + or − after a digit or a letter starts a new word; for an exponent, write e (1e-3).',
  expression: 'an expression: ngspice works out its value before running',
  expressionParam: (name: string, value: string, line: number): string => `${value} (${name}, from .param on line ${line})`,
  negativeR: 'ngspice accepts a negative resistance without a message.',
  zeroR:
    'ngspice 47 cannot use 0 Ω: it warns ("Value of resistor … is too small") and uses 10⁻¹² Ω instead, and the currents next to it come out inaccurate. To join two nodes, give them the same name; to measure the current, use a 0 V source (the ammeter trick).',
  tinyR: 'ngspice 47 raises a resistance below 10⁻¹² Ω to 10⁻¹² Ω, with a warning ("Value of resistor … is too small").',
  missingValueRCL: (what: string): string =>
    `This ${what} has no value, so ngspice leaves it out of the circuit, with a warning ("… is not a valid ${what} instance line, ignored!").`,
  missingValueKeptR: 'This resistor has settings but no value, so ngspice keeps it at 1 mΩ, almost a wire, with a warning ("resistance too low or not given, set to 1 mOhm").',
  missingValueKept: (what: string, quantity: string): string => `This ${what} has settings but no value, so ngspice keeps it without any ${quantity}, and says nothing.`,
  missingValueSource: (unit: string): string =>
    `This source has no DC value, so in .op ngspice uses 0 ${unit} and says so in a note ("has no value, DC 0 assumed"). An AC value alone is not a DC value.`,
  timeZeroValue: (fn: string, value: string): string =>
    `It has no DC value, so in .op ngspice uses the ${fn} source's value at time 0: ${value}.`,
  timeZeroValueUnknown: (fn: string): string => `It has no DC value, so in .op ngspice uses the ${fn} source's value at time 0.`,

  // ---- parts
  partHeading: (name: string, what: string, code?: string): string => `${name}: ${withArticle(what)}${code ? ` (${code})` : ''}`,
  twoTerminal: (name: string, value: string, what: string, a: string, b: string): string =>
    value ? `${name} is ${articleBefore(value)} ${value} ${what} between ${a} and ${b}.` : `${name} is ${withArticle(what)} between ${a} and ${b}.`,
  valueIsExpression: 'Its value is an expression, which ngspice works out before running.',
  resistorNote: "Resistors work either way round, and the order of the lines doesn't matter either.",
  capacitorNote: 'In .op and .dc a capacitor is an open circuit: no DC current flows through it.',
  inductorNote: 'In .op and .dc an inductor is a short circuit: both ends sit at the same voltage.',
  vSides: (name: string, plus: string, minusNode: string): string =>
    `${name} has its + side at ${plus} and its ${MINUS} side at ${minusNode}.`,
  vReads: (plus: string, minusNode: string, value: string): string => `SPICE reads that as V(${plus}) ${MINUS} V(${minusNode}) = ${value}.`,
  vGround: (node: string, value: string): string => `Ground is 0 V, so ${node} sits at ${value}.`,
  vAbove: (plus: string, minusNode: string, value: string): string => `So ${plus} sits ${value} above ${minusNode}.`,
  vZero: (plus: string, minusNode: string, name: string): string =>
    `So ${plus} and ${minusNode} are at the same voltage: ${name} works like a wire. A 0 V source is how SPICE measures a current: the ammeter trick.`,
  vSwept: (line: number): string => `The .dc on line ${line} sweeps this source, so in that analysis its value changes.`,
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
  iPushesNoValue: (name: string, from: string, to: string): string =>
    `So ${name} pushes its current from ${from}, through the source, into ${to}.`,
  voltageAt: (node: string, ref: string): string => `the voltage at ${node}, measured from ${ref}`,
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
  labelledNode: (label: string, n: string): string => `${label} ${n}`,
  listJoin: (items: readonly string[]): string =>
    items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`,
  insideSubcircuit: (name: string, line: number): string =>
    `This part belongs to the subcircuit ${name} (from line ${line}): its nodes are the subcircuit's own.`,

  // ---- dot commands
  dotHeading: (name: string, what: string): string => `${name}: ${what}`,
  opWhat: 'operating point',
  op: 'Find the DC operating point: every node voltage and the current in every voltage source. Capacitors act as open circuits and inductors as short circuits.',
  opSaveCurrents: 'ngspice saves the current through every part only with .options savecurrents; PlainSpice adds that line to the copy it runs.',
  tfWhat: 'transfer function',
  tf: (out: string, input: string, at: string): string =>
    `Find three DC quantities: the transfer function ${out}/${input} (output ÷ input), the input resistance seen by ${input}, and the output resistance ${at}, which is the Thevenin resistance seen ${at}. ngspice calls the two resistances "impedance"; at DC they are resistances, in ohms.`,
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
  dcStepZero: 'A step of 0 (or no step at all) stops ngspice 47: "Bad syntax!".',
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
    `Asks ngspice to ${name === '.plot' ? 'plot results as text' : 'print a table of results'}. PlainSpice's engine writes a results file instead, and then ngspice ignores ${name} ("${name} line ignored since rawfile was produced"). PlainSpice shows the results itself, so you don't need it.`,
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
}

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
    endStops: false,
    continuedBy: new Map(),
    hasSaveCurrents: false,
    reltol: 1e-3,
    swept: new Map(),
  };
  const open: number[] = [];
  for (const line of netlist.lines) {
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
      if (d.name === '.param') {
        for (const [name, value] of pairs(netlist, d.args)) {
          const reading = value ? readNumber(value.text) : undefined;
          if (reading && !reading.ignored && !reading.rest) ctx.params.set(lowerAscii(name.text), { line: line.index, reading });
        }
      }
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
    if (ctx.stop === undefined && line.index > 0 && line.kind === 'invalid' && line.text.trimStart().startsWith('@')) {
      ctx.stop = line.index;
    }
  }
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
  if (reading.ignored) {
    marks.push(S.ignored(reading.ignored));
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
    } else if (!trap) {
      notes.push(S.unitsIgnoredNote(reading.ignored));
    }
  }
  return { text: marks.length ? `${shown} (${marks.join('; ')})` : shown, value: reading.value, notes, trap };
}

/** The digits of a value word, without its scale letter and units: "4.7" in "4.7MOhm". */
function numberPart(text: string): string {
  return /^[+-]?(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?/.exec(text)?.[0] ?? text;
}

// ------------------------------------------------------------------ nodes

function nodeText(ref: NodeRef): string {
  if (ref.ground) return S.ground;
  // W9, W13, W14: names that look like ground but are ordinary nodes are quoted, so "ground" never reads as ground.
  if (ref.name === 'gnd' || ref.name === 'ground' || ref.name === '00') return S.quotedNode(ref.token.text);
  return S.nodeWord(ref.token.text);
}

/** How a node of a part reads in a sentence: "n1", "ground (node 0)". */
function nodePhrase(ref: NodeRef | undefined): string {
  return ref ? nodeText(ref) : '?';
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

/** The first .dc line (0-based) that sweeps the part with lower-case name `key`, if any. */
export function sweptBy(netlist: Netlist, key: string): number | undefined {
  return contextOf(netlist).swept.get(key);
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
      for (let k = 0; k < d.args.length; k += 4) {
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
      };
      if (input) {
        reading.input = input;
        const part = partKind(netlist, input.text);
        reading.inputKind = part.letter === 'V' ? 'voltage' : part.letter === 'I' ? 'current' : part.line === undefined ? 'missing' : 'other';
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

/** "the voltage at a, measured from b" (ground for node 0). */
function voltagePhrase(p: NodeRef | undefined, n: NodeRef | undefined): string {
  return S.voltageAt(p?.ground ? S.groundShort : nodeFormula(p), n?.ground ? S.groundShort : nodeFormula(n));
}

function explainPart(netlist: Netlist, line: NetlistLine): LineExplanation {
  const el = line.element!;
  const info = el.letter ? elementInfo(el.letter) : undefined;
  const p: PartContext = { netlist, line, el, info, notes: [] };
  const fields = partFields(p);
  const heading = S.partHeading(el.name.text, partWhat(info), info?.code);
  const [a, b, c, d] = el.nodes;
  const value = el.value ? valueWords(netlist, el.value.token, unitForValue(el.letter), el.value.number) : undefined;
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
          } else if (v === 0) {
            sentences.push(S.vZero(nodePhrase(a), nodePhrase(b), el.name.text)); // P9
            addNote(p.notes, S.vZeroCurrent(el.name.text, nodeFormula(a), nodeFormula(b)));
          } else if (b.ground && !a.ground) sentences.push(S.vGround(nodeFormula(a), shown));
          else if (a.ground && !b.ground) sentences.push(S.vGround(nodeFormula(b), formatSI(-v, 'V')));
          else if (!a.ground && !b.ground) sentences.push(S.vAbove(nodeFormula(a), nodeFormula(b), shown));
        } else if (fn) {
          const t0 = valueAtTimeZero(fn);
          sentences.push(t0 === undefined ? S.timeZeroValueUnknown(fn.token.text) : S.timeZeroValue(fn.token.text, formatSI(t0, 'V'))); // P17
        } else if (!el.value) {
          addNote(p.notes, S.missingValueSource('V')); // P16
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
      if (a && b) {
        if (v !== undefined) sentences.push(S.iPushes(el.name.text, formatSI(v, 'A'), nodePhrase(a), nodePhrase(b)));
        else sentences.push(S.iPushesNoValue(el.name.text, nodePhrase(a), nodePhrase(b)));
      }
      if (v === undefined && el.sourceFunction) {
        const t0 = valueAtTimeZero(el.sourceFunction);
        sentences.push(t0 === undefined ? S.timeZeroValueUnknown(el.sourceFunction.token.text) : S.timeZeroValue(el.sourceFunction.token.text, formatSI(t0, 'A')));
      } else if (!el.value && !el.sourceFunction) addNote(p.notes, S.missingValueSource('A')); // P16
      break;
    }
    case 'E': {
      if (a && b && c && d && value) {
        // P5: V(+) − V(−) = gain × (V(c+) − V(c−)).
        const gain = value.value !== undefined ? formatNumber(value.value) : value.text;
        sentences.push(S.eSentence(voltagePhrase(a, b), gain, voltagePhrase(c, d)));
        sentences.push(S.eReads(nodeFormula(a), nodeFormula(b), gain, nodeFormula(c), nodeFormula(d)));
      } else if (d && !value) addNote(p.notes, S.noGainNote('gain')); // missing-value-4 in traps.md
      else addNote(p.notes, S.eFieldsNote); // M9
      break;
    }
    case 'G': {
      if (a && b && c && d && value) {
        // P6: gm × (V(c+) − V(c−)) amps from the first node, through G, into the second.
        const gm = value.value !== undefined ? formatSI(value.value, 'A') : value.text;
        const control = d.ground ? S.gAt(nodeFormula(c)) : S.gBetween(nodeFormula(c), nodeFormula(d));
        sentences.push(capitalise(S.gSentence(gm, control, nodePhrase(a), nodePhrase(b))));
        const g = value.value !== undefined ? formatNumber(value.value) : value.text;
        sentences.push(S.gReads(g, nodeFormula(c), nodeFormula(d), nodeFormula(a), el.name.text, nodeFormula(b)));
      } else if (d && !value) addNote(p.notes, S.noGainNote('value in amps per volt')); // missing-value-5
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
          sentences.push(S.controlCurrentSign(control.text, nodeFormula(tl.nodes[0]), nodeFormula(tl.nodes[1])));
        }
      } else if (a && b && control && !value && !readNumber(control.text)) {
        addNote(p.notes, S.noGainNote(el.letter === 'F' ? 'gain' : 'value in volts per amp')); // missing-value-6, -7
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
      const labels = el.nodes.map((ref, k) => S.labelledNode(labelFor(el.letter, 'node', k).replace(/ \(.*\)$/, ''), nodePhrase(ref)));
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
  const out = (what: string, summary: string, fields: FieldExplanation[] = [], notes: string[] = []): LineExplanation => ({
    line: line.number,
    heading: S.dotHeading(d.token.text, what),
    summary,
    fields: [commandRow(d.token, what), ...fields],
    notes,
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
      return out(S.printWhat(name), S.print(name), vectorFields(netlist, d.args)); // A25, A25b
    case '.save': {
      const fields = vectorFields(netlist, d.args);
      return out(S.saveWhat, S.save(fields.map((f) => f.text).join(', ')), fields); // A24
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
          fields.push({ label: 'node voltage', text: g.text, span: g.span, meaning: S.icField(g.text, r ? formatSI(r.value, 'V') : (v?.text ?? '?')) });
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

function vectorFields(netlist: Netlist, args: readonly Token[]): FieldExplanation[] {
  const fields: FieldExplanation[] = [];
  for (let k = 0; k < args.length; ) {
    const g = vectorAt(netlist, args, k);
    if (g) {
      fields.push({ label: 'result', text: g.text, span: g.span, meaning: S.vectorField(g.text) });
      k += g.used;
    } else {
      const t = args[k]!;
      const isType = k === 0 && /^(dc|ac|tran|op|tf|noise|disto)$/i.test(t.text);
      fields.push(fieldOf(isType ? 'analysis' : 'result', t, isType ? S.analysisField(t.text) : S.vectorField(t.text)));
      k += 1;
    }
  }
  return fields;
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
  if (g) {
    const meaning =
      g.kind === 'current' ? S.tfOutputI(g.names[0]?.text ?? '') : S.tfOutputV(g.names[0]?.text ?? '', g.names[1]?.text ?? '');
    fields.push({ label: 'output', text: g.text, span: g.span, meaning });
    if (g.kind === 'voltage') {
      for (const n of g.names) {
        const info = netlist.nodes.get(lowerAscii(n.text) === 'gnd' ? '0' : lowerAscii(n.text));
        if (!info || info.connections.length === 0) addNote(notes, S.tfNodeMissingNote(n.text)); // A6
      }
    }
  }
  const input = r.input;
  if (input) {
    const part = partKind(netlist, input.text);
    let meaning: string;
    if (r.inputKind === 'missing') {
      meaning = S.tfInputMissing(input.text);
      addNote(notes, S.tfInputMissingNote(input.text)); // M10
    } else if (r.inputKind === 'other') {
      meaning = S.tfInputWrong(input.text, partWord(netlist, part.line!));
      addNote(notes, S.tfInputWrongNote(input.text)); // M11
    } else meaning = S.tfInput(input.text, part.line! + 1, partWord(netlist, part.line!));
    fields.push(fieldOf('input source', input, meaning));
  }
  const outText = r.output;
  const inText = input?.text ?? '?';
  const [o1, o2] = r.outputNames;
  const at = o2 ? S.tfBetween(o1 ?? '?', o2) : S.tfAt(o1 ?? '?');
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
    const v = (t: Token | undefined, x: number | undefined): string => (x !== undefined ? plain(x, s.unit) : (t?.text ?? '?'));
    if (s.start) fields.push(fieldOf('start', s.start, S.dcStart(v(s.start, s.startValue))));
    if (s.stop) fields.push(fieldOf('stop', s.stop, S.dcStop(v(s.stop, s.stopValue))));
    if (s.step) fields.push(fieldOf('step', s.step, S.dcStep(v(s.step, s.stepValue))));
    if (!s.step || s.stepValue === 0) addNote(notes, S.dcStepZero); // M13, M13b
    else if (s.points === 0) addNote(notes, S.dcNoPoints); // A11
    const name = s.kind === 'temperature' ? 'the temperature' : s.source.text;
    phrases.push(S.dcSweep(name, v(s.start, s.startValue), v(s.stop, s.stopValue), v(s.step, s.stepValue)));
  });
  const first = r.sweeps[0];
  const points = r.sweeps.length === 1 && first?.points !== undefined && first.points > 0 ? S.dcPoints(first.points) : '';
  let summary = S.dc(phrases.join(' and '), points); // A7–A10, A31
  if (r.sweeps.length > 1 && r.points !== undefined && r.points > 0) {
    summary += ` ${S.dcNested(r.sweeps[0]!.source.text, r.sweeps[1]!.source.text, r.points)}`; // A12
  }
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

function explainComment(netlist: Netlist, line: NetlistLine): LineExplanation {
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

/** Every line explained, in order: one explanation per physical line, blank lines included. */
export function explainNetlist(netlist: Netlist): LineExplanation[] {
  const out: LineExplanation[] = [];
  for (let i = 0; i < netlist.lines.length; i++) {
    const e = explainLine(netlist, i);
    if (e) out.push(e);
  }
  return out;
}

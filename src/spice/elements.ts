/**
 * The element catalog: what each first letter of a netlist line means to ngspice, in plain words,
 * with the field labels the channel uses ("name / + node / - node / value" for V,
 * "name / from node / to node / current" for I).
 *
 * The letter meanings come from ngspice 47's parser (src/spicelib/parser/inppas2.c and inp2*.c)
 * and were checked by running a line for every first character through native ngspice 47 and 42
 * (the letter table in the research notes) and through our WebAssembly engine
 * (docs/spice-facts/numbers-and-syntax.md, "First letters"). A line starting with anything other
 * than a letter is not a part: digits and most punctuation are errors, and some characters make
 * the line a comment (parse.ts), so `elementInfo` returns undefined for them.
 */
import type { ElementLetter, FieldRole } from './types.ts';

/** The unit of a part's main value. */
export interface ValueUnit {
  /** The symbol for src/format/si.ts (formatSI, speakSI): 'Ω', 'F', 'H', 'V', 'A', 'S'; '' for a ratio. */
  symbol: string;
  /** In words, singular: "ohm", "farad", "henry", "volt", "ampere", "siemens", "volt per volt". */
  name: string;
  /** For a controlled source, the ratio it stands for: 'V/V', 'A/A', 'A/V', 'V/A'. */
  ratio?: string;
}

export interface ElementInfo {
  letter: ElementLetter;
  /** Plain name: "resistor", "voltage source", "current-controlled current source". */
  name: string;
  /** Short code word, where one exists: "VCVS", "CCCS", "VCCS", "CCVS", "BJT", "MOSFET". */
  code?: string;
  /** PlainSpice explains the line fully: field table, meaning and results (R C L V I E F G H). */
  explained: boolean;
  /** The part type is in PlainSpice's engine (our ngspice 47 build leaves out XSPICE, OSDI and LTRA). */
  inEngine: boolean;
  /** Unit of the main value; absent when the part has no main number. */
  unit?: ValueUnit;
  /** The field table's labels, in order, in the channel's words. "nodes ..." marks a variable list. */
  fields: readonly string[];
  /** The label of each node, in the order of Element.nodes (the last one repeats for longer lists). */
  nodeLabels: readonly string[];
  /** The label of the main value field, when the part has one: "value", "current", "gain"... */
  valueLabel?: string;
  /** What ngspice needs besides this line, in plain words ("a .model line"); absent when nothing. */
  needs?: string;
}

const ohm: ValueUnit = { symbol: 'Ω', name: 'ohm' };

const CATALOG: Readonly<Record<ElementLetter, ElementInfo>> = {
  A: {
    letter: 'A',
    name: 'XSPICE code model',
    code: 'XSPICE',
    explained: false,
    inEngine: false,
    fields: ['name', 'connections ...', 'model'],
    nodeLabels: ['connection'],
    needs: "a code model from XSPICE, which PlainSpice's engine leaves out",
  },
  B: {
    letter: 'B',
    name: 'behavioural source',
    explained: false,
    inEngine: true,
    fields: ['name', '+ node', '- node', 'expression'],
    nodeLabels: ['+ node', '- node'],
    needs: 'a V= or I= expression',
  },
  C: {
    letter: 'C',
    name: 'capacitor',
    explained: true,
    inEngine: true,
    unit: { symbol: 'F', name: 'farad' },
    fields: ['name', 'node', 'node', 'value'],
    nodeLabels: ['node', 'node'],
    valueLabel: 'value',
  },
  D: {
    letter: 'D',
    name: 'diode',
    explained: false,
    inEngine: true,
    fields: ['name', '+ node (anode)', '- node (cathode)', 'model'],
    nodeLabels: ['+ node (anode)', '- node (cathode)', 'thermal node'],
    needs: 'a .model line',
  },
  E: {
    letter: 'E',
    name: 'voltage-controlled voltage source',
    code: 'VCVS',
    explained: true,
    inEngine: true,
    unit: { symbol: '', name: 'volt per volt', ratio: 'V/V' },
    fields: ['name', '+ node', '- node', 'control + node', 'control - node', 'gain'],
    nodeLabels: ['+ node', '- node', 'control + node', 'control - node'],
    valueLabel: 'gain',
  },
  F: {
    letter: 'F',
    name: 'current-controlled current source',
    code: 'CCCS',
    explained: true,
    inEngine: true,
    unit: { symbol: '', name: 'ampere per ampere', ratio: 'A/A' },
    fields: ['name', 'from node', 'to node', 'control source', 'gain'],
    nodeLabels: ['from node', 'to node'],
    valueLabel: 'gain',
    needs: 'a voltage source to read the current from (a 0 V source works: the ammeter trick)',
  },
  G: {
    letter: 'G',
    name: 'voltage-controlled current source',
    code: 'VCCS',
    explained: true,
    inEngine: true,
    unit: { symbol: 'S', name: 'siemens', ratio: 'A/V' },
    fields: ['name', 'from node', 'to node', 'control + node', 'control - node', 'amps per volt'],
    nodeLabels: ['from node', 'to node', 'control + node', 'control - node'],
    valueLabel: 'amps per volt',
  },
  H: {
    letter: 'H',
    name: 'current-controlled voltage source',
    code: 'CCVS',
    explained: true,
    inEngine: true,
    unit: { symbol: 'Ω', name: 'ohm', ratio: 'V/A' },
    fields: ['name', '+ node', '- node', 'control source', 'volts per amp'],
    nodeLabels: ['+ node', '- node'],
    valueLabel: 'volts per amp',
    needs: 'a voltage source to read the current from (a 0 V source works: the ammeter trick)',
  },
  I: {
    letter: 'I',
    name: 'current source',
    explained: true,
    inEngine: true,
    unit: { symbol: 'A', name: 'ampere' },
    fields: ['name', 'from node', 'to node', 'current'],
    nodeLabels: ['from node', 'to node'],
    valueLabel: 'current',
  },
  J: {
    letter: 'J',
    name: 'junction field-effect transistor',
    code: 'JFET',
    explained: false,
    inEngine: true,
    fields: ['name', 'drain', 'gate', 'source', 'model'],
    nodeLabels: ['drain', 'gate', 'source'],
    needs: 'a .model line',
  },
  K: {
    letter: 'K',
    name: 'coupling between two inductors',
    explained: false,
    inEngine: true,
    unit: { symbol: '', name: 'coupling coefficient' },
    fields: ['name', 'inductor', 'inductor', 'coupling'],
    nodeLabels: [],
    valueLabel: 'coupling',
    needs: 'the two inductors it couples (L lines)',
  },
  L: {
    letter: 'L',
    name: 'inductor',
    explained: true,
    inEngine: true,
    unit: { symbol: 'H', name: 'henry' },
    fields: ['name', 'node', 'node', 'value'],
    nodeLabels: ['node', 'node'],
    valueLabel: 'value',
  },
  M: {
    letter: 'M',
    name: 'MOS field-effect transistor',
    code: 'MOSFET',
    explained: false,
    inEngine: true,
    fields: ['name', 'drain', 'gate', 'source', 'bulk', 'model'],
    nodeLabels: ['drain', 'gate', 'source', 'bulk', 'node'],
    needs: 'a .model line',
  },
  N: {
    letter: 'N',
    name: 'Verilog-A device',
    code: 'OSDI',
    explained: false,
    inEngine: false,
    fields: ['name', 'nodes ...', 'model'],
    nodeLabels: ['node'],
    needs: "a compiled Verilog-A model (OSDI), which PlainSpice's engine leaves out",
  },
  O: {
    letter: 'O',
    name: 'lossy transmission line',
    code: 'LTRA',
    explained: false,
    inEngine: false,
    fields: ['name', 'port 1 + node', 'port 1 - node', 'port 2 + node', 'port 2 - node', 'model'],
    nodeLabels: ['port 1 + node', 'port 1 - node', 'port 2 + node', 'port 2 - node'],
    needs: "a .model line, and the LTRA model, which PlainSpice's engine leaves out",
  },
  P: {
    letter: 'P',
    name: 'coupled transmission lines',
    code: 'CPL',
    explained: false,
    inEngine: true,
    fields: ['name', 'nodes ...', 'model'],
    nodeLabels: ['node'],
    needs: 'a .model line',
  },
  Q: {
    letter: 'Q',
    name: 'bipolar junction transistor',
    code: 'BJT',
    explained: false,
    inEngine: true,
    fields: ['name', 'collector', 'base', 'emitter', 'model'],
    nodeLabels: ['collector', 'base', 'emitter', 'substrate', 'thermal node'],
    needs: 'a .model line',
  },
  R: {
    letter: 'R',
    name: 'resistor',
    explained: true,
    inEngine: true,
    unit: ohm,
    fields: ['name', 'node', 'node', 'value'],
    nodeLabels: ['node', 'node'],
    valueLabel: 'value',
  },
  S: {
    letter: 'S',
    name: 'voltage-controlled switch',
    explained: false,
    inEngine: true,
    fields: ['name', '+ node', '- node', 'control + node', 'control - node', 'model'],
    nodeLabels: ['+ node', '- node', 'control + node', 'control - node'],
    needs: 'a .model line',
  },
  T: {
    letter: 'T',
    name: 'lossless transmission line',
    explained: false,
    inEngine: true,
    fields: ['name', 'port 1 + node', 'port 1 - node', 'port 2 + node', 'port 2 - node'],
    nodeLabels: ['port 1 + node', 'port 1 - node', 'port 2 + node', 'port 2 - node'],
    needs: 'its impedance z0= and delay td= (or frequency f=)',
  },
  U: {
    letter: 'U',
    name: 'uniform RC line',
    code: 'URC',
    explained: false,
    inEngine: true,
    fields: ['name', 'node', 'node', 'capacitance node', 'model'],
    nodeLabels: ['node', 'node', 'capacitance node'],
    needs: 'a .model line',
  },
  V: {
    letter: 'V',
    name: 'voltage source',
    explained: true,
    inEngine: true,
    unit: { symbol: 'V', name: 'volt' },
    fields: ['name', '+ node', '- node', 'value'],
    nodeLabels: ['+ node', '- node'],
    valueLabel: 'value',
  },
  W: {
    letter: 'W',
    name: 'current-controlled switch',
    explained: false,
    inEngine: true,
    fields: ['name', '+ node', '- node', 'control source', 'model'],
    nodeLabels: ['+ node', '- node'],
    needs: 'a .model line, and a voltage source to read the current from',
  },
  X: {
    letter: 'X',
    name: 'subcircuit',
    explained: false,
    inEngine: true,
    fields: ['name', 'nodes ...', 'subcircuit'],
    nodeLabels: ['node'],
    needs: 'a .subckt definition',
  },
  Y: {
    letter: 'Y',
    name: 'simple lossy transmission line',
    code: 'TXL',
    explained: false,
    inEngine: true,
    fields: ['name', 'port 1 node', 'port 1 ground', 'port 2 node', 'port 2 ground', 'model'],
    nodeLabels: ['port 1 node', 'port 1 ground', 'port 2 node', 'port 2 ground'],
    needs: 'a .model line',
  },
  Z: {
    letter: 'Z',
    name: 'MESFET',
    code: 'MESFET',
    explained: false,
    inEngine: true,
    fields: ['name', 'drain', 'gate', 'source', 'model'],
    nodeLabels: ['drain', 'gate', 'source'],
    needs: 'a .model line',
  },
};

/** Every letter's entry, A to Z. */
export const ELEMENTS: ReadonlyArray<ElementInfo> = Object.values(CATALOG);

/** The letters PlainSpice explains fully. */
export const EXPLAINED_LETTERS: ReadonlyArray<ElementLetter> = ELEMENTS.filter((e) => e.explained).map((e) => e.letter);

/**
 * The catalog entry for a line's first character (any case), or undefined when the character
 * is not a part letter: ngspice reads digits and most punctuation as errors or comments.
 */
export function elementInfo(first: string): ElementInfo | undefined {
  if (first.length === 0) return undefined;
  const c = first.charCodeAt(0);
  const upper = c >= 97 && c <= 122 ? c - 32 : c;
  if (upper < 65 || upper > 90) return undefined;
  return CATALOG[String.fromCharCode(upper) as ElementLetter];
}

/**
 * The label of one field of a part's line, in the channel's words, for the field table.
 * `nodeIndex` is the field's position among the part's nodes (Element.nodes) for node roles.
 */
export function fieldLabel(letter: ElementLetter | undefined, role: FieldRole, nodeIndex = 0): string {
  const info = letter ? CATALOG[letter] : undefined;
  switch (role) {
    case 'name':
      return 'name';
    case 'node':
    case 'plus':
    case 'minus':
    case 'from':
    case 'to':
    case 'control-plus':
    case 'control-minus': {
      const labels = info?.nodeLabels ?? [];
      return labels[Math.min(nodeIndex, labels.length - 1)] ?? 'node';
    }
    case 'value':
    case 'gain':
    case 'transconductance':
    case 'transresistance':
      return info?.valueLabel ?? 'value';
    case 'control-source':
      return 'control source';
    case 'source-function':
      return 'source function';
    case 'model':
      return letter === 'X' ? 'subcircuit' : 'model';
    case 'parameter':
      return 'parameter';
    case 'other':
      return letter === 'K' ? 'inductor' : 'extra word';
  }
}

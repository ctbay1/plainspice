/**
 * Which drawing of the videos each example opens with, and every change made to it, with the reason.
 * The drawings themselves are in recorded.json (record.py); convert.ts turns a plan into the *@ block
 * of the example's netlist. Coordinates here are the videos' (Manim units, y up).
 *
 * The rule (milestone 2, step C): an example shows the drawing the video shows for that netlist.
 * When the video draws the version the netlist is (a SPICE check with its 0 V ammeter, say), that
 * drawing is used; otherwise the hand-solved drawing with the netlist's extra parts added where the
 * video puts such parts (a 0 V source in the wire it sits in, a test source at the terminals). The
 * "mistake" examples show what their netlist says, never the intended circuit.
 */

/** A recorded drawing and one of its items (recorded.json: drawings[drawing].items[item]). */
export interface Item {
  drawing: string;
  item: string;
}

/** A recorded Sch drawing used in an example. */
export interface Use extends Item {
  /** Moved by this much (Manim units): a copy drawn beside the others. */
  shift?: readonly [number, number];
  /** Parts the video itself takes away from this drawing (it redraws them, or replaces them), by the video's name. */
  drop?: readonly string[];
  /** Parts of the video's drawing that this netlist does not have, by the video's name (with the wires that only lead to them). */
  absent?: readonly string[];
  /** The video's node names replaced (the video calls every output of out_net "out"). */
  nodes?: Readonly<Record<string, string>>;
}

/** Node names the video writes next to a point (mk(...).next_to(point, direction)), drawn as the node's label there. */
export interface Names extends Item {
  shift?: readonly [number, number];
  /** Words the video writes that name another node here ("0" on example 1's bottom wire is n3 in the no-ground netlist). */
  texts?: Readonly<Record<string, string>>;
  /** Only these words. */
  only?: readonly string[];
}

/** A wire added to the drawing (Manim points), with the reason. */
export interface AddWire {
  node: string;
  pts: readonly (readonly [number, number])[];
  why: string;
}

/**
 * A part the hand-solved drawing does not have, put in series on another part's lead (a 0 V ammeter
 * reading that part's current): the lead from `end` is split at `split` (the new node, `node`), the
 * new part takes the piece from `end` to `split`, and the other part keeps the rest (its body stays
 * centred where the video drew it, as far as there is room).
 */
export interface Insert {
  part: string;
  letter: 'V';
  into: string;
  end: 'p' | 'q';
  /** Where the new part's body is drawn (a recorded point), else next to `end`. */
  centre?: Item;
  /** Where the new node is (a recorded point), else just after the new part. */
  split?: Item;
  node: string;
  /** The + side: at `end` ('outer', the node the current comes in at) or at the new node. */
  plus: 'outer' | 'inner';
  /** Where its words go. */
  side: Side;
  why: string;
}

/** Where an added part's words go, in the drawing's own words (src/schematic/drawing.ts, LabelSide). */
export type Side = 'above' | 'below' | 'left' | 'right';

/** A 0 V source drawn in a wire of the video (the short from a to b that the video draws as a plain wire). */
export interface InWire {
  part: string;
  letter: 'V';
  line: Item;
  /** Nodes at the line's two ends, and where the + side is. */
  na: string;
  nb: string;
  plus: 'p' | 'q';
  side: Side;
  /**
   * Drawn this far (Manim units) beside the video's wire instead of in it, joined to the terminals at
   * its ends by wires: when the wire is too near the parts beside it for the source and their words.
   */
  shift?: readonly [number, number];
  why: string;
}

/** sp01's typo: a lead the video moved off its node (recorded.json: kind "moved-lead"). */
export interface MovedLead extends Item {
  /** The node the moved lead is on in the netlist. */
  node: string;
  why: string;
}

export interface ExamplePlan {
  id: string;
  /** The video drawing, in a sentence (README, report). */
  drawing: string;
  uses: readonly Use[];
  names?: readonly Names[];
  wires?: readonly AddWire[];
  inserts?: readonly Insert[];
  inWires?: readonly InWire[];
  movedLead?: MovedLead;
  /** The video's node "gnd" is another node in this netlist (no node 0). */
  groundIs?: { node: string; why: string };
  /** Why the drawing differs from the video's in other ways (format gaps are found by convert.ts). */
  notes?: readonly string[];
  /**
   * Examples that show the same drawing of a video (a netlist and its version with a 0 V source or a
   * test source added) share a scale: the smallest at which all of them are clean, so the circuit
   * keeps its size and place from one to the next (convert.ts, groupScale).
   */
  scaleGroup?: string;
}

const S6 = 'sp01/S6';
const S7 = 'sp01/S7';
const S9 = 'sp01/S9';

/**
 * sp01-3: the four output circuits stand side by side, each as far right of the one before as the
 * video's own loaded circuit is wide plus the gap it leaves before its load; the first OUT_ROOM to the
 * right of where the video draws them, so Vs's words and its reading ("measures ↓ 3 A") fit between
 * Vs and E1 without drawing the whole circuit larger (k 4.1 instead of 5.2: 66 grid units wide
 * instead of 76, whole on a computer with the Netlist panel closed).
 */
const OUT_STEP = 1.75;
const OUT_ROOM = 0.6;
const OUT_SHIFTS: readonly (readonly [number, number])[] = [
  [OUT_ROOM, 0],
  [OUT_ROOM + OUT_STEP, 0],
  [OUT_ROOM + OUT_STEP * 3, 0],
  [OUT_ROOM + OUT_STEP * 5, 0],
];

const VSHORT_WHY = 'Vshort is the 0 V source the SPICE check puts from a to b; the video draws it as the wire from a to b (short_wire), so it stands in that wire, + at a, its words on the right where the video writes the current in it';

export const PLANS: readonly ExamplePlan[] = [
  {
    id: 'sp01-1-example-1',
    drawing: 'SPICE for Beginners, example 1 (circuit_ex1, scenes S4 to S6), with the node names the video writes (node_tags)',
    uses: [{ drawing: S6, item: 's' }],
    names: [{ drawing: S6, item: 'ntags' }],
    scaleGroup: 'sp01 example 1',
  },
  {
    id: 'sp01-2-ammeter',
    drawing: 'SPICE for Beginners, S6 "Measuring a current": example 1 with the 4 Ω branch redrawn as the 0 V ammeter Vm above R2 (n2 → n2b → ground), with the node names',
    // The video cuts R2's wire, fades R2 out and draws Vm and R2 again (named R2b in the scene) in its place.
    uses: [{ drawing: S6, item: 's', drop: ['R2'] }, { drawing: S6, item: 's2' }],
    names: [
      { drawing: S6, item: 'ntags' },
      { drawing: S6, item: 'n2b' },
    ],
  },
  {
    id: 'sp01-3-dependent-sources',
    drawing:
      'SPICE for Beginners, S7 "Dependent sources": Vc and the ground rail (base7), the 0 V source Vs above Rs (the branch whose current F and H read), and the output circuits of E1, G1, F1 and H1 (out_net) side by side, with the node names',
    uses: [
      { drawing: S7, item: 's' },
      // r1's 1 Ω resistor is replaced by Vs and Rs (vsn) in the next beat; its wire from c stays.
      { drawing: S7, item: 'r1', drop: ['R1o'] },
      { drawing: S7, item: 'vsn' },
      { drawing: S7, item: 'e', nodes: { out: 'out1' }, shift: OUT_SHIFTS[0]! },
      { drawing: S7, item: 'g', nodes: { out: 'out2' }, shift: OUT_SHIFTS[1]! },
      { drawing: S7, item: 'f', nodes: { out: 'out3' }, shift: OUT_SHIFTS[2]! },
      { drawing: S7, item: 'h', nodes: { out: 'out4' }, shift: OUT_SHIFTS[3]! },
    ],
    names: [
      { drawing: S7, item: 'gc' },
      { drawing: S7, item: 'gcs' },
      { drawing: S7, item: 'go', shift: OUT_SHIFTS[0]! },
      { drawing: S7, item: 'go2', shift: OUT_SHIFTS[1]! },
      { drawing: S7, item: 'go3', shift: OUT_SHIFTS[2]! },
      { drawing: S7, item: 'go4', shift: OUT_SHIFTS[3]! },
    ],
    wires: [
      {
        node: 'gnd',
        pts: [
          [-2.35, -1.85],
          [-2.35 + OUT_SHIFTS[3]![0], -1.85],
        ],
        why: 'the ground rail runs on under every output circuit, as it runs under the one the video shows',
      },
    ],
    notes: [
      'The video draws the four output circuits one at a time, in the same place, while the netlist has all four: they stand side by side here, in the order of the netlist, on one ground rail, the first 0.6 further right than the video draws it (room for Vs’s words and its reading).',
      'out1 and out4 (the outputs of E1 and H1, which the netlist leaves unloaded) end in open terminal rings: PlainSpice draws a ring at every node with one pin, where the video ends the lead plainly.',
    ],
  },
  {
    id: 'sp01-4-no-ground',
    drawing: 'Example 1 (circuit_ex1) with its bottom wire named n3, as this netlist calls it, and no ground symbol (the video shows this mistake as a netlist only, S9)',
    uses: [{ drawing: S6, item: 's' }],
    names: [{ drawing: S6, item: 'ntags', texts: { '0': 'n3' } }],
    groundIs: { node: 'n3', why: 'the netlist has no node 0: what example 1 grounds is node n3 here, so the drawing has no ground symbol' },
    scaleGroup: 'sp01 example 1',
  },
  {
    id: 'sp01-5-typo',
    drawing: 'The typo as the video draws it (S9): example 1 with R2’s top lead moved off n2 and named n12, a node of its own',
    uses: [{ drawing: S9, item: 's' }],
    // S9 writes only n12; n1 and n2 go where S6 writes them on the same drawing (the model would
    // write them anyway, where it finds room). Its 0 is left out: the ground symbol names that wire.
    names: [{ drawing: S6, item: 'ntags', only: ['n1', 'n2'] }],
    movedLead: { drawing: S9, item: 'typo', node: 'n12', why: 'R2 n12 0 4: R2’s top is on node n12, which nothing else is on' },
    notes: [
      'The moved lead ends in an open terminal ring at n12: PlainSpice draws a ring at every node with one pin, where the video ends the lead plainly.',
      'n12 is written on the right of its open end, as the video writes it; on the left it would sit by n2’s wire, so the drawing is drawn at the scale where it fits there (5.65, larger than example 1’s 3.70).',
    ],
  },
  {
    id: 'sp01-6-mega',
    drawing: 'Example 1 (circuit_ex1) without I1, as this netlist has no I1 (the video shows this mistake as a netlist only, S9)',
    uses: [{ drawing: S6, item: 's', absent: ['I1'] }],
    names: [{ drawing: S6, item: 'ntags' }],
    notes: [
      'The channel’s spare Short “In SPICE, 1M Is 1 Milliohm” (episodes/sp01/extra, circuit_divider; not published) draws this netlist as a narrower divider with the ground symbol in the middle of the bottom wire. The example follows the published video instead: example 1’s drawing, which the video’s netlist changes only by leaving out I1.',
    ],
    scaleGroup: 'sp01 example 1',
  },
  {
    id: 'p01-1-source-to-ground',
    drawing: 'Nodal analysis, example 1 (circuit_e1), with the node names S2 writes on it (v_1 and v_2, the netlist’s n1 and n2)',
    uses: [{ drawing: 'p01/e1', item: 's' }],
    names: [
      { drawing: 'p01/S2', item: 't1', texts: { v_1: 'n1' } },
      { drawing: 'p01/S2', item: 't2', texts: { v_2: 'n2' } },
    ],
  },
  {
    id: 'p01-2-supernode',
    drawing: 'Nodal analysis, example 2 (circuit_e2), with the node names S4 writes on it (v_1, v_2 and v_3, the netlist’s n1, n2 and n3)',
    uses: [{ drawing: 'p01/e2', item: 's' }],
    names: [{ drawing: 'p01/S4', item: 'tags', texts: { v_1: 'n1', v_2: 'n2', v_3: 'n3' } }],
  },
  {
    id: 'p01-3-ccvs-supernode',
    drawing: 'Nodal analysis, SK "Check it in a simulator": example 3 (circuit_e3) with the 0 V source Vsense on the 4 Ω resistor’s lead at n1, its new node nx, and the node names',
    uses: [{ drawing: 'p01/SK', item: 's' }],
    names: [
      { drawing: 'p01/SK', item: 'gn1' },
      { drawing: 'p01/SK', item: 'gn2' },
      { drawing: 'p01/SK', item: 'gn3' },
      { drawing: 'p01/SK', item: 'gnx' },
      { drawing: 'p01/SK', item: 'g0' },
    ],
    inserts: [
      {
        part: 'Vsense',
        letter: 'V',
        into: 'R1',
        end: 'p',
        centre: { drawing: 'p01/SK', item: 'vc' },
        split: { drawing: 'p01/SK', item: 'nx_pt' },
        node: 'nx',
        plus: 'outer',
        side: 'above',
        why: 'the video draws Vsense as a small circle on R1’s lead next to n1 (+ on the n1 side, its name above), and nx between it and R1',
      },
    ],
  },
  {
    id: 'p02-1-open',
    drawing: 'Thévenin, example 1 (circuit_e1) with a and b open',
    uses: [{ drawing: 'p02/e1', item: 's' }],
  },
  {
    id: 'p02-2-test-current',
    drawing: 'Thévenin, example 1 (circuit_e1) with the 1 A test source It at a and b, drawn by the video’s own test_source as far right of the terminals as in example 2',
    uses: [
      { drawing: 'p02/e1', item: 's' },
      { drawing: 'p02/e1', item: 'ts' },
    ],
    notes: [
      'The video finds example 1’s R_Th with an ohmmeter (S3) and draws a test source only on example 2 (S4); the netlist pushes 1 A in, so the test source is drawn the way S4 draws it. V1 stays: the netlist keeps it, at 0 V.',
    ],
  },
  {
    id: 'p02-3-dependent-only',
    drawing: 'Thévenin, S4: example 2 (circuit_e2) with the 1 A test source It at a and b, and the 0 V source Vsense on the 2 Ω resistor’s lead at a',
    uses: [
      { drawing: 'p02/S4', item: 's' },
      { drawing: 'p02/S4', item: 'ts' },
    ],
    inserts: [
      {
        part: 'Vsense',
        letter: 'V',
        into: 'R1',
        end: 'q',
        node: 'a1',
        plus: 'outer',
        side: 'below',
        why: 'Vsense reads i_x, the current from a into R1 (the video’s i_x arrow on that wire); the video draws no SPICE check of example 2, so it goes where its other checks put a 0 V ammeter: on the resistor’s lead next to the node the current comes in at, + on that side (p01, SK); its words go below, as R1’s are above',
      },
    ],
  },
  {
    id: 'p02-4-open',
    drawing: 'Thévenin, SK "Check it in a simulator": example 3 (circuit_e3) with a and b open, and the node names',
    uses: [{ drawing: 'p02/SK', item: 's' }],
    names: [
      { drawing: 'p02/SK', item: 'gs' },
      { drawing: 'p02/SK', item: 'gn' },
      { drawing: 'p02/SK', item: 'g0' },
    ],
    scaleGroup: 'p02 example 3',
  },
  {
    id: 'p02-5-short',
    drawing: 'Thévenin, SK: example 3 (circuit_e3) with Vshort from a to b, and the node names',
    uses: [{ drawing: 'p02/SK', item: 's' }],
    names: [
      { drawing: 'p02/SK', item: 'gs' },
      { drawing: 'p02/SK', item: 'gn' },
      { drawing: 'p02/SK', item: 'g0' },
    ],
    inWires: [{ part: 'Vshort', letter: 'V', line: { drawing: 'p02/SK', item: 'sw' }, na: 'a', nb: 'gnd', plus: 'p', side: 'right', why: VSHORT_WHY }],
    scaleGroup: 'p02 example 3',
  },
  {
    id: 'e04-1-two-sources',
    drawing: 'Norton, example 1 (circuit_e1)',
    uses: [{ drawing: 'e04/e1', item: 's' }],
  },
  {
    id: 'e04-2-open',
    drawing: 'Norton, example 2 (circuit_e2) with a and b open',
    uses: [{ drawing: 'e04/S5', item: 's2' }],
    scaleGroup: 'e04 example 2',
  },
  {
    id: 'e04-3-short',
    drawing: 'Norton, S5: example 2 (circuit_e2) with the wire from a to b for I_N, Vshort in the netlist',
    uses: [{ drawing: 'e04/S5', item: 's2' }],
    inWires: [
      {
        part: 'Vshort',
        letter: 'V',
        line: { drawing: 'e04/S5', item: 'sh' },
        na: 'a',
        nb: 'gnd',
        plus: 'p',
        side: 'right',
        shift: [0.6, 0],
        why: `${VSHORT_WHY}; it stands 0.6 to the right of a and b, as the video’s wire is only 0.85 to the right of R4, too near for a source and R4’s words between them unless the whole drawing is drawn half as large again (k = 7.8)`,
      },
    ],
    scaleGroup: 'e04 example 2',
  },
  {
    id: 'e04-4-open',
    drawing: 'Norton, SK "Check it in a simulator": example 3 as SPICE sees it (circuit_e3_spice: Vin and the 0 V source Vx), a and b open, with the node names',
    uses: [{ drawing: 'e04/SK', item: 's' }],
    names: [{ drawing: 'e04/SK', item: 'names' }],
    scaleGroup: 'e04 example 3',
  },
  {
    id: 'e04-5-short',
    drawing: 'Norton, SK: example 3 as SPICE sees it (circuit_e3_spice) with Vshort from a to b, and the node names',
    uses: [{ drawing: 'e04/SK', item: 's' }],
    names: [{ drawing: 'e04/SK', item: 'names' }],
    inWires: [{ part: 'Vshort', letter: 'V', line: { drawing: 'e04/SK', item: 'sh' }, na: 'a', nb: 'gnd', plus: 'p', side: 'right', why: VSHORT_WHY }],
    scaleGroup: 'e04 example 3',
  },
  {
    id: 'e04-6-tf',
    drawing: 'Norton, SK: example 3 as SPICE sees it (circuit_e3_spice) for the .tf, Vshort taken out again, with the node names',
    uses: [{ drawing: 'e04/SK', item: 's' }],
    names: [{ drawing: 'e04/SK', item: 'names' }],
    scaleGroup: 'e04 example 3',
  },
];

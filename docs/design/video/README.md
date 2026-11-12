# The examples next to their videos

Each picture puts an example's video drawing (drawn from `scripts/video-drawings/recorded.json`, in
the video's units; what the plan adds is in magenta) next to the example as PlainSpice opens it: on a
computer (1280 × 800) and on a phone held upright (a Pixel 7), turned to fit and as in the video.
How the drawings are made and why: [decision 0018](../../decisions/0018-the-examples-drawn-as-in-the-videos.md)
and [`scripts/video-drawings/`](../../../scripts/video-drawings/README.md).

Made again with:

```sh
node --experimental-strip-types scripts/video-drawings/pictures.ts
```

```sh
node --experimental-strip-types scripts/video-drawings/convert.ts --report
```

The second prints the report below: for each example, which of the video's drawings it is, its scale k
(grid squares per video unit), the parts the video names otherwise, whether the drawing is clean, and
what a phone held upright shows; then, example by example, every change from the video and why, and
what the drawing format cannot say yet ("format gap").

| Example | Video drawing | k | Parts named otherwise in the video | Checks | A phone held upright (Pixel 7) shows it |
|---|---|---|---|---|---|
| sp01-1-example-1 | SPICE for Beginners, example 1 (circuit_ex1, scenes S4 to S6), with the node names the video writes (node_tags) | 3.70 (sp01 example 1) | — | clean | turned, whole |
| sp01-2-ammeter | SPICE for Beginners, S6 "Measuring a current": example 1 with the 4 Ω branch redrawn as the 0 V ammeter Vm above R2 (n2 → n2b → ground), with the node names | 4.80 | R2b → R2 | clean | as drawn, drag |
| sp01-3-dependent-sources | SPICE for Beginners, S7 "Dependent sources": Vc and the ground rail (base7), the 0 V source Vs above Rs (the branch whose current F and H read), and the output circuits of E1, G1, F1 and H1 (out_net) side by side, with the node names | 4.10 | RL → R2, RL → R3 | clean | turned, drag |
| sp01-4-no-ground | Example 1 (circuit_ex1) with its bottom wire named n3, as this netlist calls it, and no ground symbol (the video shows this mistake as a netlist only, S9) | 3.70 (sp01 example 1) | — | clean | turned, whole |
| sp01-5-typo | The typo as the video draws it (S9): example 1 with R2’s top lead moved off n2 and named n12, a node of its own | 5.65 | — | clean | turned, whole |
| sp01-6-mega | Example 1 (circuit_ex1) without I1, as this netlist has no I1 (the video shows this mistake as a netlist only, S9) | 3.70 (sp01 example 1) | — | clean | fits as drawn |
| p01-1-source-to-ground | Nodal analysis, example 1 (circuit_e1), with the node names S2 writes on it (v_1 and v_2, the netlist’s n1 and n2) | 3.10 | Is → I1 | clean | turned, whole |
| p01-2-supernode | Nodal analysis, example 2 (circuit_e2), with the node names S4 writes on it (v_1, v_2 and v_3, the netlist’s n1, n2 and n3) | 3.85 | Is → I1 | clean | turned, whole |
| p01-3-ccvs-supernode | Nodal analysis, SK "Check it in a simulator": example 3 (circuit_e3) with the 0 V source Vsense on the 4 Ω resistor’s lead at n1, its new node nx, and the node names | 6.15 | H → H1 | clean | as drawn, drag |
| p02-1-open | Thévenin, example 1 (circuit_e1) with a and b open | 2.50 | — | clean | turned, whole |
| p02-2-test-current | Thévenin, example 1 (circuit_e1) with the 1 A test source It at a and b, drawn by the video’s own test_source as far right of the terminals as in example 2 | 3.40 | — | clean | turned, whole |
| p02-3-dependent-only | Thévenin, S4: example 2 (circuit_e2) with the 1 A test source It at a and b, and the 0 V source Vsense on the 2 Ω resistor’s lead at a | 5.25 | F → F1 | clean | turned, whole |
| p02-4-open | Thévenin, SK "Check it in a simulator": example 3 (circuit_e3) with a and b open, and the node names | 4.45 (p02 example 3) | G → G1 | clean | turned, drag |
| p02-5-short | Thévenin, SK: example 3 (circuit_e3) with Vshort from a to b, and the node names | 4.45 (p02 example 3) | G → G1 | clean | turned, drag |
| e04-1-two-sources | Norton, example 1 (circuit_e1) | 2.80 | — | clean | turned, whole |
| e04-2-open | Norton, example 2 (circuit_e2) with a and b open | 4.90 (e04 example 2) | — | clean | turned, whole |
| e04-3-short | Norton, S5: example 2 (circuit_e2) with the wire from a to b for I_N, Vshort in the netlist | 4.90 (e04 example 2) | — | clean | turned, whole |
| e04-4-open | Norton, SK "Check it in a simulator": example 3 as SPICE sees it (circuit_e3_spice: Vin and the 0 V source Vx), a and b open, with the node names | 5.55 (e04 example 3) | — | clean | as drawn, drag |
| e04-5-short | Norton, SK: example 3 as SPICE sees it (circuit_e3_spice) with Vshort from a to b, and the node names | 5.55 (e04 example 3) | — | clean | turned, drag |
| e04-6-tf | Norton, SK: example 3 as SPICE sees it (circuit_e3_spice) for the .tf, Vshort taken out again, with the node names | 5.55 (e04 example 3) | — | clean | as drawn, drag |

### sp01-1-example-1 (k = 3.70)

SPICE for Beginners, example 1 (circuit_ex1, scenes S4 to S6), with the node names the video writes (node_tags).

- The video also writes “0” beside the ground wire, at (-2.3, -1.9); here the ground symbol names that wire, as PlainSpice names ground only by its symbol.
- n2: the video writes it above and to the left of its point; here it goes above and to the right (the video’s spot here is on R1).

### sp01-2-ammeter (k = 4.80)

SPICE for Beginners, S6 "Measuring a current": example 1 with the 4 Ω branch redrawn as the 0 V ammeter Vm above R2 (n2 → n2b → ground), with the node names.

- The video also writes “0” beside the ground wire, at (-2.3, -1.9); here the ground symbol names that wire, as PlainSpice names ground only by its symbol.
- n2: the video writes it above and to the left of its point; here it goes above and to the left, at a point 1 grid unit along its wire (the video’s spot here is on R1).

### sp01-3-dependent-sources (k = 4.10)

SPICE for Beginners, S7 "Dependent sources": Vc and the ground rail (base7), the 0 V source Vs above Rs (the branch whose current F and H read), and the output circuits of E1, G1, F1 and H1 (out_net) side by side, with the node names.

- The video draws the four output circuits one at a time, in the same place, while the netlist has all four: they stand side by side here, in the order of the netlist, on one ground rail, the first 0.6 further right than the video draws it (room for Vs’s words and its reading).
- out1 and out4 (the outputs of E1 and H1, which the netlist leaves unloaded) end in open terminal rings: PlainSpice draws a ring at every node with one pin, where the video ends the lead plainly.
- A wire added: the ground rail runs on under every output circuit, as it runs under the one the video shows.
- Format gap: “out1” is written centred above its point in the video; the format has no such spot, so it goes above and to one side.
- Format gap: “out2” is written centred above its point in the video; the format has no such spot, so it goes above and to one side.
- Format gap: “out3” is written centred above its point in the video; the format has no such spot, so it goes above and to one side.
- Format gap: “out4” is written centred above its point in the video; the format has no such spot, so it goes above and to one side.

### sp01-4-no-ground (k = 3.70)

Example 1 (circuit_ex1) with its bottom wire named n3, as this netlist calls it, and no ground symbol (the video shows this mistake as a netlist only, S9).

- No ground symbol: the netlist has no node 0: what example 1 grounds is node n3 here, so the drawing has no ground symbol.
- The video writes 0 beside n3’s wire, at (-2.3, -1.9); the label is at the nearest point of the wire, on that side.
- n2: the video writes it above and to the left of its point; here it goes above and to the right (the video’s spot here is on R1).

### sp01-5-typo (k = 5.65)

The typo as the video draws it (S9): example 1 with R2’s top lead moved off n2 and named n12, a node of its own.

- The moved lead ends in an open terminal ring at n12: PlainSpice draws a ring at every node with one pin, where the video ends the lead plainly.
- n12 is written on the right of its open end, as the video writes it; on the left it would sit by n2’s wire, so the drawing is drawn at the scale where it fits there (5.65, larger than example 1’s 3.70).
- R2’s lead moved off its first point by (0.565, -0.403) and named n12, as the video draws the typo: R2 n12 0 4: R2’s top is on node n12, which nothing else is on.
- n2: the video writes it above and to the left of its point; here it goes above and to the left, at a point 1 grid unit along its wire (the video’s spot here is on R1).

### sp01-6-mega (k = 3.70)

Example 1 (circuit_ex1) without I1, as this netlist has no I1 (the video shows this mistake as a netlist only, S9).

- The channel’s spare Short “In SPICE, 1M Is 1 Milliohm” (episodes/sp01/extra, circuit_divider; not published) draws this netlist as a narrower divider with the ground symbol in the middle of the bottom wire. The example follows the published video instead: example 1’s drawing, which the video’s netlist changes only by leaving out I1.
- I1 is not in this netlist: it is left out, with the wires that only lead to it.
- The video also writes “0” beside the ground wire, at (-2.3, -1.9); here the ground symbol names that wire, as PlainSpice names ground only by its symbol.
- Wire ends that lead nowhere once the drawing is on the grid are cut back, as the model does.
- n2: the video writes it above and to the left of its point; here it goes above and to the right (the video’s spot here is on R1).

### p01-1-source-to-ground (k = 3.10)

Nodal analysis, example 1 (circuit_e1), with the node names S2 writes on it (v_1 and v_2, the netlist’s n1 and n2).

- The video writes v_2 beside n2’s wire, at (-3, 1.35); the label is at the nearest point of the wire, on that side.
- v_2 (n2 here): the video writes it above and to the left of its point; here it goes above and to the right (the video’s spot here is on R1).

### p01-2-supernode (k = 3.85)

Nodal analysis, example 2 (circuit_e2), with the node names S4 writes on it (v_1, v_2 and v_3, the netlist’s n1, n2 and n3).

- The video writes v_2 beside n2’s wire, at (-3.75, 0.5); the label is at the nearest point of the wire, on that side.
- v_2 (n2 here): the video writes it above and to the left of its point; here it goes above and to the left, at a point 3 grid units along its wire (the video’s spot here is on Ra).

### p01-3-ccvs-supernode (k = 6.15)

Nodal analysis, SK "Check it in a simulator": example 3 (circuit_e3) with the 0 V source Vsense on the 4 Ω resistor’s lead at n1, its new node nx, and the node names.

- The video also writes “0” beside the ground wire, at (-3.15, -2.2); here the ground symbol names that wire, as PlainSpice names ground only by its symbol.
- Vsense added on R1’s lead: the video draws Vsense as a small circle on R1’s lead next to n1 (+ on the n1 side, its name above), and nx between it and R1.
- Room left between the two parts in series on nx for its name: 7 grid units (the parts slide apart along their wire, each as near as it can be to where the video draws it).
- n2: the video writes it above and to the left of its point; here it goes above and to the right, at a point 2 grid units along its wire (the video’s spot here is on R1).
- Format gap: “nx” is written centred below its point in the video; the format has no such spot, so it goes below and to one side.

### p02-1-open (k = 2.50)

Thévenin, example 1 (circuit_e1) with a and b open.

- Wire ends that lead nowhere once the drawing is on the grid are cut back, as the model does.
- Names the video does not write, each beside its own wire on a free spot near where the model would write it (on the right when there is room): s above and to the left of 0,0; n1 well to the right of 7,1.
- Format gap: “a” is written centred above its point in the video; the format has no such spot, so it goes above and to one side.
- Format gap: terminal b (on ground, p02/e1 s, line 75): a label must name its node, and ground is named by its symbol, so the format cannot write “b” there; the wire to it ends at the last part on it.

### p02-2-test-current (k = 3.40)

Thévenin, example 1 (circuit_e1) with the 1 A test source It at a and b, drawn by the video’s own test_source as far right of the terminals as in example 2.

- The video finds example 1’s R_Th with an ohmmeter (S3) and draws a test source only on example 2 (S4); the netlist pushes 1 A in, so the test source is drawn the way S4 draws it. V1 stays: the netlist keeps it, at 0 V.
- Wire ends the video starts at a terminal’s ring are joined to the terminal’s point: (-0.465, 1) → (-0.55, 1), (-0.465, -1.6) → (-0.55, -1.6).
- Names the video does not write, each beside its own wire on a free spot near where the model would write it (on the right when there is room): s on the right of 0,1; n1 on the right of 10,1.
- Format gap: “a” is written centred above its point in the video; the format has no such spot, so it goes above and to one side.
- Format gap: terminal b (on ground, p02/e1 s, line 75): a label must name its node, and ground is named by its symbol, so the format cannot write “b” there; the wire to it ends at the last part on it.
- Format gap: terminal a: the video draws its ring with the test source attached; the model draws a ring only at an open end, so a is written as a name on the wire there.

### p02-3-dependent-only (k = 5.25)

Thévenin, S4: example 2 (circuit_e2) with the 1 A test source It at a and b, and the 0 V source Vsense on the 2 Ω resistor’s lead at a.

- Vsense added on R1’s lead: Vsense reads i_x, the current from a into R1 (the video’s i_x arrow on that wire); the video draws no SPICE check of example 2, so it goes where its other checks put a 0 V ammeter: on the resistor’s lead next to the node the current comes in at, + on that side (p01, SK); its words go below, as R1’s are above.
- Wire ends the video starts at a terminal’s ring are joined to the terminal’s point: (-1.415, 1) → (-1.5, 1), (-1.415, -1.6) → (-1.5, -1.6).
- Room left between the two parts in series on a1 for its name: 7 grid units (the parts slide apart along their wire, each as near as it can be to where the video draws it).
- Names the video does not write, each beside its own wire on a free spot near where the model would write it (on the right when there is room): a1 above and to the right of 13,0; n1 above and to the right of 0,0.
- Format gap: “a” is written centred above its point in the video; the format has no such spot, so it goes above and to one side.
- Format gap: terminal b (on ground, p02/S4 s, line 92): a label must name its node, and ground is named by its symbol, so the format cannot write “b” there; the wire to it ends at the last part on it.
- Format gap: terminal a: the video draws its ring with the test source attached; the model draws a ring only at an open end, so a is written as a name on the wire there.

### p02-4-open (k = 4.45)

Thévenin, SK "Check it in a simulator": example 3 (circuit_e3) with a and b open, and the node names.

- The video also writes “0” beside the ground wire, at (-3.4, -1.9); here the ground symbol names that wire, as PlainSpice names ground only by its symbol.
- Wire ends that lead nowhere once the drawing is on the grid are cut back, as the model does.
- n1: the video writes it above and to the right of its point; here it goes on the right, at a point 1 grid unit along its wire (the video’s spot here is on R2).
- Format gap: “a” is written centred above its point in the video; the format has no such spot, so it goes above and to one side.
- Format gap: terminal b (on ground, p02/SK s, line 111): a label must name its node, and ground is named by its symbol, so the format cannot write “b” there; the wire to it ends at the last part on it.

### p02-5-short (k = 4.45)

Thévenin, SK: example 3 (circuit_e3) with Vshort from a to b, and the node names.

- The video also writes “0” beside the ground wire, at (-3.4, -1.9); here the ground symbol names that wire, as PlainSpice names ground only by its symbol.
- Vshort drawn in the video’s wire from a to b: Vshort is the 0 V source the SPICE check puts from a to b; the video draws it as the wire from a to b (short_wire), so it stands in that wire, + at a, its words on the right where the video writes the current in it.
- n1: the video writes it above and to the right of its point; here it goes on the right, at a point 1 grid unit along its wire (the video’s spot here is on R2).
- Format gap: “a” is written centred above its point in the video; the format has no such spot, so it goes above and to one side.
- Format gap: terminal b (on ground, p02/SK s, line 111): a label must name its node, and ground is named by its symbol, so the format cannot write “b” there; the wire to it ends at the last part on it.
- Format gap: terminal a: the video draws its ring with the short attached; the model draws a ring only at an open end, so a is written as a name on the wire there.

### e04-1-two-sources (k = 2.80)

Norton, example 1 (circuit_e1).

- Names the video does not write, each beside its own wire on a free spot near where the model would write it (on the right when there is room): s1 on the right of 0,1; v on the right of 7,1; s2 above and to the right of 14,0.

### e04-2-open (k = 4.90)

Norton, example 2 (circuit_e2) with a and b open.

- Wire ends that lead nowhere once the drawing is on the grid are cut back, as the model does.
- Names the video does not write, each beside its own wire on a free spot near where the model would write it (on the right when there is room): s on the right of 0,1; n1 above and to the right of 9,2.
- Format gap: “a” is written centred above its point in the video; the format has no such spot, so it goes above and to one side.
- Format gap: terminal b (on ground, e04/S5 s2, line 79): a label must name its node, and ground is named by its symbol, so the format cannot write “b” there; the wire to it ends at the last part on it.

### e04-3-short (k = 4.90)

Norton, S5: example 2 (circuit_e2) with the wire from a to b for I_N, Vshort in the netlist.

- Vshort drawn in the video’s wire from a to b, moved 0.6 to the right of it: Vshort is the 0 V source the SPICE check puts from a to b; the video draws it as the wire from a to b (short_wire), so it stands in that wire, + at a, its words on the right where the video writes the current in it; it stands 0.6 to the right of a and b, as the video’s wire is only 0.85 to the right of R4, too near for a source and R4’s words between them unless the whole drawing is drawn half as large again (k = 7.8).
- Names the video does not write, each beside its own wire on a free spot near where the model would write it (on the right when there is room): s on the right of 0,1; n1 above and to the right of 9,2.
- Format gap: “a” is written centred above its point in the video; the format has no such spot, so it goes above and to one side.
- Format gap: terminal b (on ground, e04/S5 s2, line 79): a label must name its node, and ground is named by its symbol, so the format cannot write “b” there; the wire to it ends at the last part on it.
- Format gap: terminal a: the video draws its ring with the short attached; the model draws a ring only at an open end, so a is written as a name on the wire there.

### e04-4-open (k = 5.55)

Norton, SK "Check it in a simulator": example 3 as SPICE sees it (circuit_e3_spice: Vin and the 0 V source Vx), a and b open, with the node names.

- The video also writes “0” beside the ground wire, at (-3, -1.9); here the ground symbol names that wire, as PlainSpice names ground only by its symbol.
- Wire ends that lead nowhere once the drawing is on the grid are cut back, as the model does.
- Room left between the two parts in series on s2 for its name: 7 grid units (the parts slide apart along their wire, each as near as it can be to where the video draws it).
- n1: the video writes it above and to the right of its point; here it goes on the right, at a point 1 grid unit along its wire (the video’s spot here is on R3).
- Format gap: “a” is written centred above its point in the video; the format has no such spot, so it goes above and to one side.
- Format gap: terminal b (on ground, e04/SK s, line 1244): a label must name its node, and ground is named by its symbol, so the format cannot write “b” there; the wire to it ends at the last part on it.
- Format gap: “s2” is written centred above its point in the video; the format has no such spot, so it goes above and to one side.

### e04-5-short (k = 5.55)

Norton, SK: example 3 as SPICE sees it (circuit_e3_spice) with Vshort from a to b, and the node names.

- The video also writes “0” beside the ground wire, at (-3, -1.9); here the ground symbol names that wire, as PlainSpice names ground only by its symbol.
- Vshort drawn in the video’s wire from a to b: Vshort is the 0 V source the SPICE check puts from a to b; the video draws it as the wire from a to b (short_wire), so it stands in that wire, + at a, its words on the right where the video writes the current in it.
- Room left between the two parts in series on s2 for its name: 7 grid units (the parts slide apart along their wire, each as near as it can be to where the video draws it).
- n1: the video writes it above and to the right of its point; here it goes on the right, at a point 1 grid unit along its wire (the video’s spot here is on R3).
- Format gap: “a” is written centred above its point in the video; the format has no such spot, so it goes above and to one side.
- Format gap: terminal b (on ground, e04/SK s, line 1244): a label must name its node, and ground is named by its symbol, so the format cannot write “b” there; the wire to it ends at the last part on it.
- Format gap: “s2” is written centred above its point in the video; the format has no such spot, so it goes above and to one side.
- Format gap: terminal a: the video draws its ring with the short attached; the model draws a ring only at an open end, so a is written as a name on the wire there.

### e04-6-tf (k = 5.55)

Norton, SK: example 3 as SPICE sees it (circuit_e3_spice) for the .tf, Vshort taken out again, with the node names.

- The video also writes “0” beside the ground wire, at (-3, -1.9); here the ground symbol names that wire, as PlainSpice names ground only by its symbol.
- Wire ends that lead nowhere once the drawing is on the grid are cut back, as the model does.
- Room left between the two parts in series on s2 for its name: 7 grid units (the parts slide apart along their wire, each as near as it can be to where the video draws it).
- n1: the video writes it above and to the right of its point; here it goes on the right, at a point 1 grid unit along its wire (the video’s spot here is on R3).
- Format gap: “a” is written centred above its point in the video; the format has no such spot, so it goes above and to one side.
- Format gap: terminal b (on ground, e04/SK s, line 1244): a label must name its node, and ground is named by its symbol, so the format cannot write “b” there; the wire to it ends at the last part on it.
- Format gap: “s2” is written centred above its point in the video; the format has no such spot, so it goes above and to one side.


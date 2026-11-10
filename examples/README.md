# Examples from the Solved Circuits videos

The circuits solved in the public videos of [Solved Circuits](https://www.youtube.com/@SolvedCircuits),
in channel order, as they appear in PlainSpice's Examples menu:

| Folder | Video |
|---|---|
| `sp01/` | [SPICE for Beginners: Check Any Circuit Answer with a Free Simulator (LTspice & ngspice)](https://youtu.be/eYtco4K4pm8) |
| `p01/` | [Nodal Analysis with a Supernode: 3 Solved Examples (Easy to Exam Level)](https://youtu.be/7w-oSkPatcw) |
| `p02/` | [Thévenin Equivalent with Dependent Sources: 3 Solved Examples](https://youtu.be/Ttx-AeMLwVc) |
| `e04/` | [Norton Equivalent and Source Transformation: 3 Solved Examples](https://youtu.be/ONxhzqlOw6M) |

Each netlist starts with its title and a line crediting its video. The netlists come from the
channel's design files (`solved-circuits/design/`, named in `examples.json` as `source`), with only
the first line changed into a title and the credit line added.

**Checked.** `tests/golden/examples.test.ts` runs every example through PlainSpice's engine and
compares it with the values the channel recorded with native ngspice when it made the videos
(`expect` in `examples.json`), to 6 significant figures. The three "mistake" examples of SPICE for
Beginners (no ground, a typo in a node name, 1M) must show the check they teach; no other example
may show an error-level check.

**Licence.** These netlists are © Tarık Bayraktar (Solved Circuits), under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): keep the credit line when you share one.

**Adding a video.** Add its folder and netlists (title on line 1, the credit on line 2), add the
video and the examples to `examples.json` with the values ngspice gave, in channel order.

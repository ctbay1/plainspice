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

**Drawn as in the video.** Each netlist ends with its drawing block (the `* plainspice-drawing v1`
and `*@` lines just before `.end`, decision 0013), so the example opens drawn the way its video draws
it, and a share link or an export of it keeps that drawing; ngspice ignores those lines (drawing-1),
so the values do not change. The blocks are made from the videos' own drawing code (the channel's
`episodes/*/scenes.py` and `circuits.py`) by [`scripts/video-drawings/`](../scripts/video-drawings/README.md):
the video's drawing of the version the netlist is, when the video has one (the SPICE checks with
their 0 V ammeters and shorts), else the hand-solved drawing with the netlist's extra parts where the
video puts such parts (a 0 V source in the wire it sits in, a test source at the terminals). The three
"mistake" examples show what their netlist says: the typo as the video draws it (R2's lead moved off
n2, named n12), and the two the video shows only as netlists drawn as example 1 changed where their
netlist differs (no ground symbol on node n3; no I1). The node names are the ones the video writes,
where it writes them when they fit, and always beside their own wire. Two things the drawing format
cannot say yet: the terminal **b** of the Thévenin and Norton examples (p02, e04), which the videos
write at the end of the ground wire (here the ground wire is b), and the **0** some videos write
beside the ground wire (the ground symbol names it). Pictures next to the videos, with every change
from the video and why: [`docs/design/video/`](../docs/design/video/README.md); how and why the
drawings are made: [decision 0018](../docs/decisions/0018-the-examples-drawn-as-in-the-videos.md). On
a phone that turns a drawing to fit, "As in the video" shows it as its video draws it, until a part
is moved. Don't edit a block by hand: change
`scripts/video-drawings/plan.ts` (or record the videos' drawings again) and run
`node --experimental-strip-types scripts/video-drawings/convert.ts --write`; the unit tests check
that every block is what the converter makes.

**Checked.** `tests/golden/examples.test.ts` runs every example through PlainSpice's engine and
compares it with the values the channel recorded with native ngspice when it made the videos
(`expect` in `examples.json`), to 6 significant figures. The three "mistake" examples of SPICE for
Beginners (no ground, a typo in a node name, 1M) must show the check they teach; no other example
may show an error-level check.

**Licence.** These netlists are © Tarık Bayraktar (Solved Circuits), under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): keep the credit line when you share one.

**Adding a video.** Add its folder and netlists (title on line 1, the credit on line 2), add the
video and the examples to `examples.json` with the values ngspice gave, in channel order. Then record
its drawings and add a plan for each example (see [`scripts/video-drawings/`](../scripts/video-drawings/README.md)).

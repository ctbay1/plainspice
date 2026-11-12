"""Record the circuit drawings of the Solved Circuits videos, without Manim and without running the
episode files.

The videos draw every circuit in code (solved-circuits: pipeline/schematic.py's Sch, called from
episodes/<id>/scenes.py and circuits.py): parts between two points in Manim units (y up), wires,
ground symbols, terminals, and node names written next to points. This script reads those files
with `ast` and evaluates, with a small interpreter of its own (`Interp`), only the statements that
draw what we need:

- a circuit function's own body (circuit_ex1, circuit_e1 ...), and the module-level constants and
  helper functions it uses;
- for what a scene draws itself (the 0 V ammeter of SPICE for Beginners, a test source, a short
  wire, the node names written in a SPICE check), only the statements of that scene that build the
  named objects (a backward slice of its `construct`), never the rest of the scene.

Nothing is imported or exec'd. The interpreter knows numbers, strings, tuples, lists and dicts,
arithmetic, `if`, `for`, function calls to the episode's own functions and to a fixed set of
stand-ins (P, Sch, np.array, mk, VGroup, Line ...); any other name or construct stops the recording
with the file and line. So whatever the episode files say, nothing else can run.

Usage: python3 -I record.py <solved-circuits root> <out.json>
Writes the recording (scripts/video-drawings/recorded.json in this repository) and prints a summary.
python3 -I record.py --self-test checks that the interpreter runs a circuit function and refuses
anything else (imports, open, eval, dunder attributes, lambdas, loops it does not know ...).
"""
import ast
import hashlib
import json
import math
import sys
from pathlib import Path

# ---------------------------------------------------------------------------------- stand-ins


class Vec(tuple):
    """A point or a direction in Manim units (x, y); arithmetic as numpy arrays do it."""

    def __new__(cls, x, y=0.0):
        return super().__new__(cls, (float(x), float(y)))

    def __add__(self, o):
        return Vec(self[0] + o[0], self[1] + o[1])

    __radd__ = __add__

    def __sub__(self, o):
        return Vec(self[0] - o[0], self[1] - o[1])

    def __rsub__(self, o):
        return Vec(o[0] - self[0], o[1] - self[1])

    def __mul__(self, k):
        return Vec(self[0] * k, self[1] * k)

    __rmul__ = __mul__

    def __truediv__(self, k):
        return Vec(self[0] / k, self[1] / k)

    def __neg__(self):
        return Vec(-self[0], -self[1])

    def __pos__(self):
        return self


def P(x, y=0.0, z=0.0):
    return Vec(x, y)


def xy(v):
    """A point as written in the recording: two numbers, rounded off past the float noise (0.1 + 0.2)."""
    return [round(float(v[0]), 6) + 0.0, round(float(v[1]), 6) + 0.0]


UP, DOWN, LEFT, RIGHT = Vec(0, 1), Vec(0, -1), Vec(-1, 0), Vec(1, 0)
UL, UR, DL, DR, ORIGIN = Vec(-1, 1), Vec(1, 1), Vec(-1, -1), Vec(1, -1), Vec(0, 0)
DIRECTIONS = {"UP": UP, "DOWN": DOWN, "LEFT": LEFT, "RIGHT": RIGHT, "UL": UL, "UR": UR, "DL": DL, "DR": DR, "ORIGIN": ORIGIN}


def direction_name(v):
    for k, d in DIRECTIONS.items():
        if k != "ORIGIN" and abs(v[0] - d[0]) < 1e-9 and abs(v[1] - d[1]) < 1e-9:
            return k
    raise Recording(f"a label placed in an unusual direction {tuple(v)}")


class Recording(Exception):
    pass


class Dummy:
    """Whatever a drawing does besides drawing the circuit (colours, labels, arrows): accepts anything."""

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return Dummy()

    def __call__(self, *a, **k):
        return self

    def __getitem__(self, k):
        return Dummy()

    def __iter__(self):
        return iter(())

    def __bool__(self):
        return True


class StyleCall:
    """A styling call (set_color, set_stroke ...) on one of our objects: does nothing, returns the object."""

    def __init__(self, obj):
        self.obj = obj

    def __call__(self, *a, **k):
        return self.obj


class Styled:
    """Our own recording objects ignore styling calls (set_color, scale ...) and return themselves."""

    STYLE = {"set_color", "set_stroke", "set_fill", "set_opacity", "set_z_index", "copy", "fade", "set_joint_type"}

    def __getattr__(self, name):
        if name in Styled.STYLE:
            return StyleCall(self)
        if name.startswith("_"):
            raise AttributeError(name)
        return Dummy()


class LineRec(Styled):
    """A Line(a, b), such as the short-circuit wire a scene draws from a to b."""

    def __init__(self, a, b):
        self.a, self.b = Vec(*a[:2]), Vec(*b[:2])

    def get_start(self):
        return self.a

    def get_end(self):
        return self.b

    def record(self):
        return dict(kind="line", a=xy(self.a), b=xy(self.b))


class Tag(Styled):
    """A word written on the page (mk, T, X, M): its text, and the point and side next_to put it at."""

    def __init__(self, text):
        self.text = str(text)
        self.at = None
        self.dir = None

    def next_to(self, target, direction=RIGHT, buff=0.0, **k):
        if isinstance(target, Vec):
            self.at, self.dir = target, direction_name(direction)
        return self

    def scale(self, *a, **k):
        return self

    def shift(self, v, *a):
        """Moved by v after next_to (vtag(...).shift(LEFT * 0.3)): the point it is written next to moves too."""
        if self.at is not None:
            self.at = Vec(self.at[0] + v[0], self.at[1] + v[1])
        return self

    def record(self):
        if self.at is None:
            raise Recording(f'the word "{self.text}" is not placed next to a point')
        return dict(kind="tag", text=self.text, at=xy(self.at), dir=self.dir)


class Group(Styled):
    def __init__(self, items):
        self.items = list(items)

    def __getitem__(self, i):
        return self.items[i]

    def __iter__(self):
        return iter(self.items)

    def __len__(self):
        return len(self.items)

    def record(self):
        tags = [i.record() for i in self.items if isinstance(i, Tag)]
        return dict(kind="tags", tags=tags)


class PartRec(Styled):
    def __init__(self, rec):
        self.p, self.q = Vec(*rec["p"]), Vec(*rec["q"])
        self.mid = (self.p + self.q) / 2
        self.lead_a = LineRec(self.p, self.p)
        self.lead_b = LineRec(self.q, self.q)
        self.label = Dummy()
        self.body = Dummy()


class TermRec(Styled):
    def __init__(self):
        self.ring = Dummy()
        self.lab = Dummy()


class Rec(Styled):
    """Stands in for pipeline/schematic.py's Sch: records parts, wires, ground symbols and terminals."""

    def __init__(self):
        self.parts, self.wires, self.grounds, self.terms = [], [], [], []
        self.cpts = {}
        self.line = None

    def _part(self, kind, name, p, q, tex, na, nb, side=1, plus=None, to=None, **kw):
        rec = dict(kind=kind, name=name, p=xy(p), q=xy(q), na=na, nb=nb, side=side, line=Interp.line)
        if plus is not None:
            rec["plus"] = plus
        if to is not None:
            rec["to"] = to
        self.parts.append(rec)
        part = PartRec(rec)
        self.cpts[name] = part
        return part

    def R(self, name, p, q, tex, na, nb, side=1, **kw):
        return self._part("R", name, p, q, tex, na, nb, side=side)

    def V(self, name, p, q, tex, na, nb, plus="p", side=1, **kw):
        return self._part("V", name, p, q, tex, na, nb, side=side, plus=plus)

    def I(self, name, p, q, tex, na, nb, to="q", side=1, **kw):
        return self._part("I", name, p, q, tex, na, nb, side=side, to=to)

    def E(self, name, p, q, tex, na, nb, plus="p", side=1, **kw):
        return self._part("E", name, p, q, tex, na, nb, side=side, plus=plus)

    def F(self, name, p, q, tex, na, nb, to="q", side=1, **kw):
        return self._part("F", name, p, q, tex, na, nb, side=side, to=to)

    def wire(self, node, *pts):
        self.wires.append(dict(node=node, pts=[xy(p) for p in pts], line=Interp.line))
        return self

    def dot(self, node, p):
        return Dummy()

    def gnd(self, p, node="gnd", drop=0.28):
        self.grounds.append(dict(node=node, at=xy(p), line=Interp.line))
        return Dummy()

    def term(self, node, p, tex, side=RIGHT, size=34):
        self.terms.append(dict(node=node, at=xy(p), text=tex, dir=direction_name(side), line=Interp.line))
        return TermRec()

    def record(self):
        return dict(kind="sch", parts=self.parts, wires=self.wires, grounds=self.grounds, terms=self.terms)


class NP:
    """The few numpy functions the circuit functions use."""

    pi = math.pi

    def array(self, x, *a, **k):
        return Vec(*x[:2]) if len(x) >= 2 else x

    def linspace(self, a, b, n):
        return [a + (b - a) * i / (n - 1) for i in range(n)]

    def sqrt(self, x):
        return math.sqrt(x)


def tint(t, *a, **k):
    return t


def tag_maker(text, *a, **k):
    return Tag(text)


def vtag(tex, p, direction=UP, *a, **k):
    return Tag(tex).next_to(p, direction)


def group(*items, **k):
    return Group(items)


def line(a, b, *rest, **k):
    return LineRec(a, b)


SAFE_BUILTINS = dict(len=len, range=range, zip=zip, enumerate=enumerate, abs=abs, min=min, max=max, float=float, int=int,
                     str=str, round=round, dict=dict, list=list, tuple=tuple, sum=sum)

STAND_INS = dict(
    P=P, Sch=Rec, np=NP(), PI=math.pi, TAU=2 * math.pi, DEGREES=math.pi / 180,
    mk=tag_maker, T=tag_maker, X=tag_maker, M=tag_maker, TM=tag_maker, vtag=vtag, VGroup=group, Line=line, tint=tint,
    **DIRECTIONS,
)
# Names the episodes use for things that are not geometry (arrows, panels, effects): anything goes.
DUMMIES = {"iarrow", "known", "Circle", "Dot", "Arrow", "DashedLine", "Square", "RoundedRectangle", "cross", "tick", "span",
           "harrow", "enter_arrow", "leaving_arrow", "callout", "value_tag", "bubble", "flash", "body_flash", "Cross",
           "SurroundingRectangle", "DashedVMobject", "MathTex", "Text", "VMobject", "Rectangle", "CurvedArrow", "pill"}

# ---------------------------------------------------------------------------------- the interpreter


class Return(Exception):
    def __init__(self, value):
        self.value = value


class Function:
    """A function of an episode file, run by the interpreter in its module's scope."""

    def __init__(self, module, node):
        self.module, self.node = module, node

    def __call__(self, *args, **kwargs):
        a = self.node.args
        if a.vararg or a.kwarg or a.kwonlyargs or a.posonlyargs:
            raise Recording(f"{self.module.path}:{self.node.lineno}: {self.node.name} takes arguments this recorder does not read")
        scope = {}
        names = [x.arg for x in a.args]
        defaults = a.defaults
        for i, n in enumerate(names):
            if i < len(args):
                scope[n] = args[i]
            elif n in kwargs:
                scope[n] = kwargs.pop(n)
            else:
                d = i - (len(names) - len(defaults))
                if d < 0:
                    raise Recording(f"{self.node.name}: missing argument {n}")
                scope[n] = self.module.interp.eval(defaults[d], {})
        if kwargs:
            raise Recording(f"{self.node.name}: unknown arguments {sorted(kwargs)}")
        try:
            self.module.interp.run(self.node.body, scope)
        except Return as r:
            return r.value
        return None


class Module:
    """An episode file: parsed once; its top-level functions and constants are found by name when used."""

    def __init__(self, root, path, interp, imports=()):
        self.root, self.path, self.interp = root, path, interp
        self.source = (root / path).read_text()
        self.sha256 = hashlib.sha256(self.source.encode()).hexdigest()
        self.tree = ast.parse(self.source)
        self.imports = list(imports)  # modules whose names `from X import *` brings in
        self.cache = {}

    def function(self, name):
        for node in self.tree.body:
            if isinstance(node, ast.FunctionDef) and node.name == name:
                return node
        return None

    def cls(self, name):
        for node in self.tree.body:
            if isinstance(node, ast.ClassDef) and node.name == name:
                return node
        raise Recording(f"{self.path}: no class {name}")

    def lookup(self, name):
        if name in self.cache:
            return self.cache[name]
        found = self.define(name)
        if found is not None:
            self.cache[name] = found[0]
            return found[0]
        for m in self.imports:
            v = m.lookup(name)
            if v is not None:
                return v
        return None

    def define(self, name):
        """The last top-level definition of a name: a function, or a constant from a simple assignment."""
        last = None
        for node in self.tree.body:
            if isinstance(node, ast.FunctionDef) and node.name == name:
                last = node
            elif isinstance(node, ast.Assign) and any(name in targets_of(t) for t in node.targets):
                last = node
        if last is None:
            return None
        if isinstance(last, ast.FunctionDef):
            return (Function(self, last),)
        scope = {}
        self.interp.assign_all(last, scope, module=self)
        return (scope[name],)


def targets_of(t):
    if isinstance(t, ast.Name):
        return {t.id}
    if isinstance(t, (ast.Tuple, ast.List)):
        out = set()
        for e in t.elts:
            out |= targets_of(e)
        return out
    return set()


BINOPS = {ast.Add: lambda a, b: a + b, ast.Sub: lambda a, b: a - b, ast.Mult: lambda a, b: a * b, ast.Div: lambda a, b: a / b,
          ast.FloorDiv: lambda a, b: a // b, ast.Mod: lambda a, b: a % b, ast.Pow: lambda a, b: a ** b}
COMPARE = {ast.Eq: lambda a, b: a == b, ast.NotEq: lambda a, b: a != b, ast.Lt: lambda a, b: a < b, ast.LtE: lambda a, b: a <= b,
           ast.Gt: lambda a, b: a > b, ast.GtE: lambda a, b: a >= b, ast.In: lambda a, b: a in b, ast.NotIn: lambda a, b: a not in b,
           ast.Is: lambda a, b: a is b, ast.IsNot: lambda a, b: a is not b}
# Objects whose attributes may be read: our own stand-ins only (never a Python object's insides).
READABLE = (Vec, Rec, PartRec, LineRec, TermRec, Tag, Group, Dummy, NP)
CALLABLE = [v for v in list(STAND_INS.values()) + list(SAFE_BUILTINS.values()) if callable(v)]


def allowed(f):
    """What a call may call: the episode's own functions (run by the interpreter), the stand-ins, a few
    harmless builtins, and the methods of our own recording objects."""
    if isinstance(f, (Function, Dummy, StyleCall)):
        return True
    if any(f is c for c in CALLABLE):
        return True
    owner = getattr(f, "__self__", None)
    return owner is not None and isinstance(owner, READABLE) and not f.__name__.startswith("_")


class Interp:
    line = None  # the line being run (recorded with each part, for the README's references)

    def __init__(self):
        self.module = None

    def run(self, body, scope):
        for st in body:
            self.exec(st, scope)

    def exec(self, st, scope):
        Interp.line = getattr(st, "lineno", Interp.line)
        if isinstance(st, ast.Expr):
            self.eval(st.value, scope)
        elif isinstance(st, ast.Assign):
            self.assign_all(st, scope)
        elif isinstance(st, ast.AugAssign):
            if not isinstance(st.target, ast.Name):
                raise self.error(st, "augmented assignment to something other than a name")
            scope[st.target.id] = BINOPS[type(st.op)](self.eval(st.target, scope), self.eval(st.value, scope))
        elif isinstance(st, ast.Return):
            raise Return(self.eval(st.value, scope) if st.value is not None else None)
        elif isinstance(st, ast.If):
            self.run(st.body if self.eval(st.test, scope) else st.orelse, scope)
        elif isinstance(st, ast.For):
            if st.orelse:
                raise self.error(st, "for ... else")
            for v in self.eval(st.iter, scope):
                self.bind(st.target, v, scope)
                self.run(st.body, scope)
        elif isinstance(st, ast.Pass):
            pass
        else:
            raise self.error(st, f"a {type(st).__name__} statement")

    def assign_all(self, st, scope, module=None):
        saved = self.module
        if module is not None:
            self.module = module
        try:
            value = self.eval(st.value, scope)
            for t in st.targets:
                self.bind(t, value, scope)
        finally:
            self.module = saved

    def bind(self, target, value, scope):
        if isinstance(target, ast.Name):
            scope[target.id] = value
        elif isinstance(target, (ast.Tuple, ast.List)):
            values = list(value)
            if len(values) != len(target.elts):
                raise self.error(target, "unpacking the wrong number of values")
            for t, v in zip(target.elts, values):
                self.bind(t, v, scope)
        elif isinstance(target, ast.Attribute) and isinstance(self.eval(target.value, scope), READABLE) and not target.attr.startswith("_"):
            setattr(self.eval(target.value, scope), target.attr, value)
        elif isinstance(target, ast.Subscript) and not isinstance(target.slice, ast.Slice):
            # tags[nd] = t: only into a dict or list the episode's code built itself.
            box = self.eval(target.value, scope)
            key = self.eval(target.slice, scope)
            if not (type(box) is dict or (type(box) is list and type(key) is int)):
                raise self.error(target, "assigning into something that is not a dict or a list")
            box[key] = value
        else:
            raise self.error(target, "assigning to something other than names")

    def error(self, node, what):
        where = f"{self.module.path}:{getattr(node, 'lineno', '?')}" if self.module else f"line {getattr(node, 'lineno', '?')}"
        return Recording(f"{where}: the recorder does not run {what}")

    def name(self, node, scope):
        n = node.id
        if n in scope:
            return scope[n]
        if n in STAND_INS:
            return STAND_INS[n]
        if n in SAFE_BUILTINS:
            return SAFE_BUILTINS[n]
        if n in ("True", "False", "None"):
            return {"True": True, "False": False, "None": None}[n]
        if self.module is not None:
            v = self.module.lookup(n)
            if v is not None:
                return v
        if n in DUMMIES or n.isupper() or (n[:1].isupper() and n.rstrip("0123456789").isupper()):
            return Dummy()  # colours, sizes and other style constants of the pipeline
        raise self.error(node, f"code that uses the name {n}")

    def eval(self, node, scope):
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name):
            return self.name(node, scope)
        if isinstance(node, ast.Tuple):
            return tuple(self.items(node.elts, scope))
        if isinstance(node, ast.List):
            return list(self.items(node.elts, scope))
        if isinstance(node, ast.Dict):
            if any(k is None for k in node.keys):
                raise self.error(node, "a dict with **")
            return {self.eval(k, scope): self.eval(v, scope) for k, v in zip(node.keys, node.values)}
        if isinstance(node, ast.BinOp):
            op = BINOPS.get(type(node.op))
            if op is None:
                raise self.error(node, f"the operator {type(node.op).__name__}")
            return op(self.eval(node.left, scope), self.eval(node.right, scope))
        if isinstance(node, ast.UnaryOp):
            v = self.eval(node.operand, scope)
            if isinstance(node.op, ast.USub):
                return -v
            if isinstance(node.op, ast.UAdd):
                return +v
            if isinstance(node.op, ast.Not):
                return not v
            raise self.error(node, "a bit operation")
        if isinstance(node, ast.BoolOp):
            if isinstance(node.op, ast.And):
                v = True
                for e in node.values:
                    v = self.eval(e, scope)
                    if not v:
                        return v
                return v
            v = False
            for e in node.values:
                v = self.eval(e, scope)
                if v:
                    return v
            return v
        if isinstance(node, ast.Compare):
            left = self.eval(node.left, scope)
            for op, right in zip(node.ops, node.comparators):
                r = self.eval(right, scope)
                if not COMPARE[type(op)](left, r):
                    return False
                left = r
            return True
        if isinstance(node, ast.IfExp):
            return self.eval(node.body if self.eval(node.test, scope) else node.orelse, scope)
        if isinstance(node, ast.Subscript):
            v = self.eval(node.value, scope)
            if isinstance(node.slice, ast.Slice):
                s = node.slice
                return v[slice(*(self.eval(x, scope) if x is not None else None for x in (s.lower, s.upper, s.step)))]
            return v[self.eval(node.slice, scope)]
        if isinstance(node, ast.Attribute):
            v = self.eval(node.value, scope)
            if not isinstance(v, READABLE) or node.attr.startswith("_"):
                raise self.error(node, f"reading .{node.attr} of something that is not a drawing")
            return getattr(v, node.attr)
        if isinstance(node, ast.Call):
            f = self.eval(node.func, scope)
            args = []
            for a in node.args:
                if isinstance(a, ast.Starred):
                    args.extend(self.eval(a.value, scope))
                else:
                    args.append(self.eval(a, scope))
            kwargs = {}
            for k in node.keywords:
                if k.arg is None:
                    raise self.error(node, "a call with **")
                kwargs[k.arg] = self.eval(k.value, scope)
            if not allowed(f):
                raise self.error(node, "a call to something that is not a drawing function")
            if isinstance(f, Function):
                saved, self.module = self.module, f.module
                try:
                    return f(*args, **kwargs)
                finally:
                    self.module = saved
            return f(*args, **kwargs)
        if isinstance(node, ast.JoinedStr):
            out = ""
            for v in node.values:
                out += v.value if isinstance(v, ast.Constant) else str(self.eval(v.value, scope))
            return out
        if isinstance(node, ast.ListComp) and len(node.generators) == 1 and not node.generators[0].is_async:
            g = node.generators[0]
            out = []
            for v in self.eval(g.iter, scope):
                inner = dict(scope)
                self.bind(g.target, v, inner)
                if all(self.eval(c, inner) for c in g.ifs):
                    out.append(self.eval(node.elt, inner))
            return out
        raise self.error(node, f"a {type(node).__name__} expression")

    def items(self, elts, scope):
        for e in elts:
            if isinstance(e, ast.Starred):
                yield from self.eval(e.value, scope)
            else:
                yield self.eval(e, scope)


# ---------------------------------------------------------------------------------- scenes: a backward slice


def flat(body):
    """A scene method's statements in order, inside its `with self.beat(...)` blocks too (not inside loops or ifs)."""
    for st in body:
        if isinstance(st, ast.With):
            yield from flat(st.body)
        else:
            yield st


def loads(node):
    return {n.id for n in ast.walk(node) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}


def receiver(expr):
    """The name a call chain starts from: s2 in s2.dot(...).set_color(...)."""
    while True:
        if isinstance(expr, ast.Call):
            expr = expr.func
        elif isinstance(expr, ast.Attribute):
            expr = expr.value
        elif isinstance(expr, ast.Subscript):
            expr = expr.value
        else:
            return expr.id if isinstance(expr, ast.Name) else None


def used(node):
    return {n for n in loads(node) if n not in STAND_INS and n != "self"}


def slice_body(stmts, needed):
    """A backward slice of statements: those that build the needed objects (assignments to them and
    to what those use, calls made on them, items set in them), in order; a `for` or an `if` whose
    body does so is kept with only those statements. Returns the statements and what they need."""
    keep = []
    for st in reversed(stmts):
        if isinstance(st, (ast.For, ast.If)):
            body, inner = slice_body(list(flat(st.body)), set(needed))
            if isinstance(st, ast.For) and body:
                # Once more, for what one pass of the loop leaves to the next.
                body, inner = slice_body(list(flat(st.body)), needed | inner)
            orelse, other = slice_body(list(flat(st.orelse)), set(needed)) if isinstance(st, ast.If) else ([], set())
            if not (body or orelse):
                continue
            kept = ast.For(target=st.target, iter=st.iter, body=body, orelse=[], type_comment=None) if isinstance(st, ast.For) \
                else ast.If(test=st.test, body=body or [ast.Pass()], orelse=orelse)
            kept = ast.copy_location(kept, st)
            keep.append(kept)
            if isinstance(st, ast.For):
                needed |= (inner - targets_of(st.target)) | used(st.iter)
            else:
                needed |= inner | other | used(st.test)
            continue
        defines = set()
        mutates = isinstance(st, ast.Expr) and receiver(st.value) in needed
        if isinstance(st, ast.Assign):
            for t in st.targets:
                defines |= targets_of(t)
                # tags[nd] = t, or p.x = ...: the object it changes.
                if isinstance(t, (ast.Subscript, ast.Attribute)) and receiver(t) in needed:
                    mutates = True
        if defines & needed or mutates:
            keep.append(st)
            needed |= used(st)
    keep.reverse()
    return keep, needed


def scene_slice(module, cls, method, outputs):
    """The statements of cls.method that build the named objects (slice_body), in order. Names the
    stand-ins provide are not followed."""
    fdef = next((n for n in module.cls(cls).body if isinstance(n, ast.FunctionDef) and n.name == method), None)
    if fdef is None:
        raise Recording(f"{module.path}: no {cls}.{method}")
    return slice_body(list(flat(fdef.body)), set(outputs))[0]


# ---------------------------------------------------------------------------------- what to record

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else None


class Spec:
    def __init__(self, key, path, note, *, call=None, scene=None, outputs=None, statements=None, uses=()):
        self.key, self.path, self.note = key, path, note
        self.call, self.scene, self.outputs, self.statements, self.uses = call, scene, outputs or [], statements, uses


# The drawings the examples use (scripts/video-drawings/plan.ts says which example uses which, and why).
SPECS = [
    Spec("sp01/S6", "episodes/sp01/scenes.py",
         "S6 (Measuring a current): example 1 with its node names (node_tags), then the 4 ohm branch redrawn with the 0 V ammeter Vm (s2)",
         scene=("S6", "construct"), outputs=["s", "ntags", "s2", "n2b"]),
    Spec("sp01/S7", "episodes/sp01/scenes.py",
         "S7 (Dependent sources): Vc and the ground rail (base7), the wire from c to the measured branch (r1), Vs and Rs (vsn), "
         "and the four output circuits E1, G1, F1, H1 (out_net), each drawn in the same place in turn, with their node names",
         scene=("S7", "construct"), outputs=["s", "r1", "vsn", "e", "g", "f", "h", "gc", "gcs", "go", "go2", "go3", "go4"]),
    Spec("sp01/S9", "episodes/sp01/scenes.py",
         "S9 (Three mistakes, a typo in a node name): example 1 drawn again, R2's top lead moved off node n2 and named n12",
         call="circuit_ex1()"),
    Spec("p01/e1", "episodes/p01/scenes.py", "circuit_e1: example 1", call="circuit_e1()"),
    Spec("p01/S2", "episodes/p01/scenes.py",
         "S2 (Method): the node names written on example 1, v_1 and v_2 (the netlist's n1 and n2)",
         scene=("S2", "construct"), outputs=["t1", "t2"]),
    Spec("p01/e2", "episodes/p01/scenes.py", "circuit_e2: example 2", call="circuit_e2()"),
    Spec("p01/S4", "episodes/p01/scenes.py",
         "S4 (Example 2): the node names written on example 2, v_1, v_2 and v_3 (the netlist's n1, n2 and n3)",
         scene=("S4", "construct"), outputs=["tags"]),
    Spec("p01/SK", "episodes/p01/scenes.py",
         "SK (Check it in a simulator): example 3 (circuit_e3) with Vsense drawn on the 4 ohm resistor's lead at vc, its new node nx at nx_pt, and the node names "
         "(and the 0 it writes beside the ground wire)",
         scene=("SK", "construct"), outputs=["s", "vc", "nx_pt", "gn1", "gn2", "gn3", "gnx", "g0"]),
    Spec("p02/e1", "episodes/p02/scenes.py",
         "circuit_e1: example 1; test_source: the video's own test source (S4) attached to example 1's terminals as far to their right as in S4 (1.15)",
         statements=["s, p = circuit_e1()", "ts = test_source(p['TA'], p['TB'], x=p['TA'][0] + 1.15)"], outputs=["s", "ts"]),
    Spec("p02/S4", "episodes/p02/scenes.py",
         "S4 (Example 2): circuit_e2 with the 1 A test source pushed into a (test_source at x = -0.35)",
         scene=("S4", "construct"), outputs=["s", "ts"]),
    Spec("p02/SK", "episodes/p02/scenes.py",
         "SK (Check it in a simulator): example 3 (circuit_e3) with its node names (and the 0 it writes beside the ground wire), "
         "and the wire from a to b that Vshort is (short_wire)",
         scene=("SK", "construct"), outputs=["s", "gs", "gn", "g0", "sw"]),
    Spec("e04/e1", "episodes/e04/circuits.py", "circuit_e1: example 1", call="circuit_e1()"),
    Spec("e04/S5", "episodes/e04/scenes.py",
         "S5 (Example 2): circuit_e2 with the wire from a to b for I_N (short_wire)",
         scene=("S5", "construct"), outputs=["s2", "sh"], uses=["episodes/e04/circuits.py"]),
    Spec("e04/SK", "episodes/e04/scenes.py",
         "SK (Check it in a simulator): example 3 as SPICE sees it (circuit_e3_spice: Vin, the 0 V source Vx), its node names, and Vshort's wire from a to b",
         scene=("SK", "construct"), outputs=["s", "names", "sh"], uses=["episodes/e04/circuits.py"]),
]


def moved_lead(module):
    """sp01 S9, the typo: `r2 = s.cpts["R2"]`, the drawing scaled (s.scale(f)), then R2's lead_a start moved by
    an offset (put_start_and_end_on(get_start() + offset, get_end())) and "n12" written next to it. Returns
    the part, the offset in the drawing's own units, the direction of the word, and the lines."""
    fdef = next(n for n in module.cls("S9").body if isinstance(n, ast.FunctionDef) and n.name == "construct")
    part = scale = offset = word = None
    lines = []
    interp = module.interp
    for node in ast.walk(fdef):
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id == "r2":
            v = node.value  # s.cpts["R2"]
            if isinstance(v, ast.Subscript) and isinstance(v.slice, ast.Constant):
                part = v.slice.value
                lines.append(node.lineno)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr == "scale" and receiver(node.func.value) == "s" and isinstance(node.args[0], ast.Constant):
                scale = node.args[0].value
                lines.append(node.lineno)
            if node.func.attr == "put_start_and_end_on":
                start = node.args[0]
                # (r2.lead_a.get_start() + DOWN * a) + RIGHT * b: the offset is everything but the start.
                terms = []
                while isinstance(start, ast.BinOp) and isinstance(start.op, ast.Add):
                    terms.append(start.right)
                    start = start.left
                offset = Vec(0, 0)
                for t in terms:
                    offset = offset + interp.eval(t, {})
                lines.append(node.lineno)
            if node.func.attr == "next_to" and isinstance(node.func.value, ast.Call) and node.args and "get_start" in ast.dump(node.args[0]):
                text = node.func.value.args[0]
                if isinstance(text, ast.Constant):
                    word = dict(text=text.value, dir=direction_name(interp.eval(node.args[1], {})))
                    lines.append(node.lineno)
    if None in (part, scale, offset, word):
        raise Recording("sp01 S9: the moved lead of the typo was not found")
    return dict(kind="moved-lead", part=part, end="p", by=xy(offset / scale), scale=scale, word=word, lines=sorted(set(lines)))


def to_record(v):
    if isinstance(v, (Rec, Tag, Group, LineRec)):
        return v.record()
    if isinstance(v, Vec):
        return dict(kind="point", at=xy(v))
    if type(v) is dict and v and all(isinstance(t, Tag) for t in v.values()):
        # Words kept by node in a dict (p01 S4: tags[nd] = vtag(...)), in the order they were written.
        return dict(kind="tags", tags=[t.record() for t in v.values()])
    raise Recording(f"cannot record a {type(v).__name__}")


def record(root):
    interp = Interp()
    modules = {}

    def module(path, uses=()):
        if path not in modules:
            modules[path] = Module(root, path, interp, [module(u) for u in uses])
        return modules[path]

    drawings = {}
    for spec in SPECS:
        m = module(spec.path, spec.uses)
        interp.module = m
        items = {}
        if spec.call:
            value = interp.eval(ast.parse(spec.call, mode="eval").body, {})
            s = value[0] if isinstance(value, tuple) else value
            items["s"] = to_record(s)
            what = spec.call
        elif spec.statements:
            scope = {}
            for text in spec.statements:
                interp.run(ast.parse(text).body, scope)
            items = {k: to_record(scope[k]) for k in spec.outputs}
            what = "; ".join(spec.statements)
        else:
            cls, method = spec.scene
            scope = {}
            stmts = scene_slice(m, cls, method, spec.outputs)
            interp.run(stmts, scope)
            items = {k: to_record(scope[k]) for k in spec.outputs}
            what = f"{cls}.{method}, lines {', '.join(str(n) for n in sorted({s.lineno for s in stmts}))}"
        if spec.key == "sp01/S9":
            items["typo"] = moved_lead(m)
        drawings[spec.key] = dict(file=spec.path, what=what, note=spec.note, items=items)
    files = {p: m.sha256 for p, m in sorted(modules.items())}
    return dict(about="The Solved Circuits videos' circuit drawings, recorded by scripts/video-drawings/record.py "
                      "from the channel's repository (solved-circuits). Manim units, y up.", files=files, drawings=drawings)


def pretty(v, indent=0, width=150):
    """JSON with each part, wire and word on one line when it fits, so a diff shows what moved."""
    one = json.dumps(v, ensure_ascii=False, separators=(", ", ": "))
    if len(one) + indent <= width or not isinstance(v, (dict, list)) or not v:
        return one
    pad = " " * (indent + 1)
    if isinstance(v, dict):
        rows = [f"{pad}{json.dumps(k, ensure_ascii=False)}: {pretty(x, indent + 1, width)}" for k, x in v.items()]
        return "{\n" + ",\n".join(rows) + "\n" + " " * indent + "}"
    rows = [f"{pad}{pretty(x, indent + 1, width)}" for x in v]
    return "[\n" + ",\n".join(rows) + "\n" + " " * indent + "]"


SELF_TEST = '''
RING = 0.085


def good():
    """A circuit function as the episodes write them: points, parts, wires, a loop, a helper, a test."""
    s = Sch()
    A, B = P(-1, 1), P(1, 1)
    s.R("R1", A, B, r"2\\,\\Omega", "n1", "n2", side=1)
    for nd, pt in (("n1", A), ("n2", B)):
        s.dot(nd, pt)
    if RING > 0:
        s.wire("n2", B, B + RIGHT * RING + DOWN * 1)
    s.paint("n1", N1C)
    return s, dict(A=A, B=B)


def bad_import():
    import os
    return os


def bad_dunder_import():
    return __import__("os")


def bad_open():
    return open("/etc/passwd")


def bad_class():
    return ().__class__


def bad_eval():
    return eval("1 + 1")


def bad_getattr():
    return getattr(P(0, 0), "__class__")


def bad_lambda():
    return (lambda: 1)()


def bad_while():
    while True:
        pass


def bad_with():
    with open("x") as f:
        return f


def bad_string_method():
    return "abc".upper()


def bad_globals():
    return globals()


def bad_print():
    print("hello")


def bad_try():
    try:
        return 1
    except Exception:
        return 2


def bad_inner_def():
    def f():
        return 1
    return f


def bad_dict_method():
    d = dict(a=1)
    return d.keys()


def bad_setitem():
    v = P(0, 0)
    v[0] = 1
    return v


class Scene1:
    """A scene as the episodes write them: only what builds `tags` may run (not self.play, not open)."""

    def construct(self):
        s, p = good()
        tags = {}
        with self.beat("b1"):
            for w, nd, pt in (("one", "n1", p["A"]), ("two", "n2", p["B"])):
                self.at_word(w)
                t = vtag("v", pt, UP)
                if nd == "n2":
                    t.shift(LEFT * 0.3)
                tags[nd] = t
                self.play(open("/etc/passwd"))
        self.play(open("/etc/passwd"))
'''


def self_test():
    """The interpreter runs a circuit function and refuses everything else (record.py --self-test)."""
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "episodes" / "t").mkdir(parents=True)
        (root / "episodes" / "t" / "scenes.py").write_text(SELF_TEST)
        interp = Interp()
        m = Module(root, "episodes/t/scenes.py", interp)
        interp.module = m
        s, pts = interp.eval(ast.parse("good()", mode="eval").body, {})
        rec = s.record()
        assert [p["name"] for p in rec["parts"]] == ["R1"], rec
        assert rec["wires"][0]["pts"] == [[1.0, 1.0], [1.085, 0.0]], rec["wires"]
        # A scene's slice runs the loop that writes the names, and nothing that does not build them.
        scope = {}
        interp.run(scene_slice(m, "Scene1", "construct", ["tags"]), scope)
        tags = to_record(scope["tags"])["tags"]
        assert [(t["at"], t["dir"]) for t in tags] == [([-1.0, 1.0], "UP"), ([0.7, 1.0], "UP")], tags
        refused = []
        for node in m.tree.body:
            if isinstance(node, ast.FunctionDef) and node.name.startswith("bad_"):
                try:
                    interp.eval(ast.parse(f"{node.name}()", mode="eval").body, {})
                except Recording:
                    refused.append(node.name)
                    continue
                raise SystemExit(f"self-test FAILED: {node.name} ran")
        print(f"self-test passed: the circuit function and a scene's names were recorded; refused {len(refused)}: {', '.join(refused)}")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        sys.exit(0)
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    try:
        out = record(ROOT)
    except Recording as e:
        print(f"record.py: {e}", file=sys.stderr)
        sys.exit(1)
    text = pretty(out)
    Path(sys.argv[2]).write_text(text + "\n")
    for k, d in out["drawings"].items():
        print(f"{k}: {', '.join(d['items'])}")

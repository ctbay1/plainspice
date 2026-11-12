/**
 * The netlist store: the one source of truth for the netlist text (decision 0016). Typing in the
 * Netlist panel, a value changed on the drawing, a check's fix, an example or a link opened, and
 * undo and redo all change this text, and everything else (the drawing, the checks, the runs, the
 * editor) follows it. Plain TypeScript (decision 0002): React reads it with useSyncExternalStore.
 *
 * Undo and redo are snapshots of the whole text (a netlist is small), one history for the whole
 * app, so Ctrl+Z undoes the last change wherever it was made. Changes that belong together are one
 * step: keystrokes typed without a pause (`group` 'typing', joined while less than TYPING_PAUSE_MS
 * apart), and every value typed into one part's card while it is open (`group` naming that card,
 * joined however long it stays open; a card that ends where it started leaves no step), and the
 * moves of one item made in a row with the keyboard (`group` 'move:…', decision 0017). A fix, an
 * opened circuit, an edit made on the drawing, an undo or a redo is a step of its own. A change may
 * say what it did in a few words (`label`, an edit's summary): Undo and Redo can then say what they
 * undid or redid.
 *
 * Each text in the history remembers whose it is: the student's (typed, changed on the drawing,
 * fixed, or the netlist saved on this device) or a circuit just opened (an example, a link) that
 * nobody has changed. The student's first change to an opened circuit makes it theirs, the text it
 * opened with included. The app saves only the student's: an undo or a redo that lands on a circuit
 * opened and never changed is like opening it again, so an example never replaces the student's
 * saved netlist.
 */

/** Who changed the text: the app uses it to know whether to save, to clear a link from the address, or to move the editor. */
export type ChangeSource = 'start' | 'editor' | 'drawing' | 'fix' | 'load' | 'undo' | 'redo';

export interface Change {
  source: ChangeSource;
  /** Changes with the same group, close enough together, are one undo step. */
  group?: string;
  /** What the change did, in a short sentence ("R3 added between n1 and n4."): said when it is undone or redone. */
  label?: string;
}

export interface StoreSnapshot {
  text: string;
  canUndo: boolean;
  canRedo: boolean;
  /** Counts every change, so React sees a new snapshot each time. */
  version: number;
  /** What made the last change. */
  last: Change;
  /** The text is the student's (see the module's note); false for a circuit just opened and not changed. */
  mine: boolean;
  /** What Undo would undo, and what Redo would redo, when those changes said (their label). */
  undoLabel?: string;
  redoLabel?: string;
}

export interface NetlistStore {
  get(): string;
  snapshot(): StoreSnapshot;
  /** Set the text. Nothing happens when it is the same text. */
  set(text: string, change: Change): void;
  undo(): boolean;
  redo(): boolean;
  /** Called after every change, with the new text and what made it. */
  subscribe(listener: (text: string, change: Change) => void): () => void;
}

/** Keystrokes closer together than this are one undo step (CodeMirror's own default is 500 ms). */
export const TYPING_PAUSE_MS = 750;
/** The oldest steps are forgotten after this many. */
export const MAX_UNDO_STEPS = 200;
/** A group that stays one step however far apart its changes are (a part's card while it is open, moves of one item in a row). */
export const HELD_GROUP = /^(card|move):/;

/** Changes that make the text the student's. */
const STUDENT: ReadonlySet<ChangeSource> = new Set(['editor', 'drawing', 'fix']);

interface Entry {
  text: string;
  mine: boolean;
  /** What the change that made this text did (its label). */
  label?: string;
}

/**
 * A store holding `initial`. `mine` says whether the first text is the student's (the netlist saved
 * on this device) or a circuit opened for them (the first screen's example, a link).
 */
export function createNetlistStore(initial: string, options: { mine?: boolean; now?: () => number } = {}): NetlistStore {
  const now = options.now ?? (() => Date.now());
  let current: Entry = { text: initial, mine: options.mine ?? true };
  let past: Entry[] = [];
  let future: Entry[] = [];
  let version = 0;
  let last: Change = { source: 'start' };
  /** The group of the undo step being written; undefined once it ended (a pause, an undo, a card back where it started). */
  let openGroup: { group: string; source: ChangeSource } | undefined;
  let lastAt = -Infinity;
  const snapOf = (): StoreSnapshot => {
    const out: StoreSnapshot = { text: current.text, canUndo: past.length > 0, canRedo: future.length > 0, version, last, mine: current.mine };
    if (past.length && current.label !== undefined) out.undoLabel = current.label;
    if (future[0]?.label !== undefined) out.redoLabel = future[0].label;
    return out;
  };
  let snap: StoreSnapshot = snapOf();
  const listeners = new Set<(text: string, change: Change) => void>();

  const publish = (change: Change): void => {
    version += 1;
    last = change;
    snap = snapOf();
    for (const l of Array.from(listeners)) l(current.text, change);
  };

  /** True when this change continues the open undo step. */
  const joins = (change: Change, at: number): boolean => {
    if (change.group === undefined || !openGroup || change.group !== openGroup.group || change.source !== openGroup.source) return false;
    return HELD_GROUP.test(change.group) || at - lastAt < TYPING_PAUSE_MS;
  };

  return {
    get: () => current.text,
    snapshot: () => snap,
    set(next, change) {
      if (next === current.text) return;
      const at = now();
      const student = STUDENT.has(change.source);
      // The first change to a circuit opened for the student makes it theirs, as it was opened too.
      if (student && !current.mine) current = { text: current.text, mine: true };
      const mine = change.source === 'load' ? false : student ? true : current.mine;
      if (!joins(change, at)) {
        past.push(current);
        if (past.length > MAX_UNDO_STEPS) past = past.slice(-MAX_UNDO_STEPS);
        openGroup = change.group === undefined ? undefined : { group: change.group, source: change.source };
      } else if (past[past.length - 1]?.text === next) {
        // The step ends where it started (a card's value put back): it leaves nothing to undo.
        current = past.pop()!;
        future = [];
        openGroup = undefined;
        lastAt = at;
        publish(change);
        return;
      }
      future = [];
      lastAt = at;
      current = change.label === undefined ? { text: next, mine } : { text: next, mine, label: change.label };
      publish(change);
    },
    undo() {
      const previous = past.pop();
      if (previous === undefined) return false;
      future.unshift(current);
      current = previous;
      openGroup = undefined;
      lastAt = -Infinity;
      publish({ source: 'undo' });
      return true;
    },
    redo() {
      const next = future.shift();
      if (next === undefined) return false;
      past.push(current);
      current = next;
      openGroup = undefined;
      lastAt = -Infinity;
      publish({ source: 'redo' });
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

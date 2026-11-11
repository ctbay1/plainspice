/**
 * The Netlist panel: the netlist on the dark "simulator screen" of the episodes (decision 0014), in
 * the CodeMirror editor (src/editor, decision 0007): highlighting that reads lines like ngspice,
 * node colours, trap underlines with one-click fixes, the results at the ends of the lines, and the
 * drawing's *@ lines folded away (decision 0013) with a button to show them.
 *
 * The text lives in the app's store (src/app/store.ts, decision 0016), not here: typing changes the
 * store, and any other change (a value set on the drawing, a fix, an undo) comes back into the
 * editor with only the changed part replaced, so the cursor stays put. The editor keeps no undo
 * history of its own: Ctrl+Z and Ctrl+Shift+Z undo and redo in the store, wherever the change was
 * made. The editor's code (about a third of the app) is fetched the first time the panel opens;
 * until then the panel shows the text as it is.
 *
 * Under the editor, "This line": the line the cursor is on (or the part selected on the drawing),
 * field by field, so a line can be read while it is typed (the Explain panel has every line).
 */
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { InlineNote, PlainSpiceEditor } from '../../editor/index.ts';
import { EDITOR_HINT } from '../../editor/strings.ts';
import { t, tn } from '../../i18n/index.ts';
import type { Fix, LineExplanation, Trap } from '../../spice/types.ts';
import { FieldTable } from './FieldTable.tsx';
import type { NetlistStore } from '../store.ts';
import { LineIcon } from './Icons.tsx';

export type CreateEditor = typeof import('../../editor/index.ts').createEditor;

const loadEditor = (): Promise<typeof import('../../editor/index.ts')> => import('../../editor/index.ts');

/** Fetch the editor's code now (called when the browser is idle after start-up). */
export function preloadEditor(): Promise<unknown> {
  return loadEditor();
}

export interface NetlistPanelProps {
  store: NetlistStore;
  /** The file name shown on the screen's bar ("start-here.cir"). */
  fileName: string;
  /** The checks of `checkedText` (traps are shown only on the text they were found in). */
  traps: readonly Trap[];
  checkedText: string;
  colours: ReadonlyMap<string, string>;
  /** Results for the ends of the lines, and the text they belong to. */
  notes: readonly InlineNote[];
  notesText: string | undefined;
  /** How many drawing lines the netlist has (0: no drawing block). */
  drawingLines: number;
  folded: boolean;
  onFolded: (folded: boolean) => void;
  /** The line to put the cursor on (the part selected on the drawing), 1-based. */
  showLine: number | undefined;
  onCursorLine: (line: number) => void;
  onFix: (fix: Fix) => void;
  onRun: () => void;
  /** Ctrl+Z and Ctrl+Shift+Z in the editor: the app's undo and redo (one history, src/app/store.ts). */
  onUndo: () => void;
  onRedo: () => void;
  /** The editor got or lost the focus (the drawing keeps its size while the netlist is typed). */
  onFocusChange?: (focused: boolean) => void;
  /** The editor, for the page (go to a line from the Checks panel, focus it). */
  editorRef: RefObject<PlainSpiceEditor | null>;
  /** Tests may pass their own editor factory. */
  create?: CreateEditor;
  /** The cursor's line, explained field by field (none for a line with nothing to explain). */
  thisLine?: LineExplanation | undefined;
  /** A phone: the hint says what typing does, not which keys to press. */
  phone?: boolean;
}

export function NetlistPanel(p: NetlistPanelProps): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const editorId = useId();
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  // The newest props for the editor's callbacks (it is made once).
  const latest = useRef(p);
  useEffect(() => {
    latest.current = p;
  });

  // Make the editor once its code is in.
  const { store, editorRef, create } = p;
  useEffect(() => {
    let alive = true;
    let editor: PlainSpiceEditor | undefined;
    const make = (factory: CreateEditor): void => {
      const parent = host.current;
      if (!alive || !parent) return;
      editor = factory({
        parent,
        doc: store.get(),
        label: t('editorLabel'),
        describedBy: hintId,
        history: false,
        onUndo: () => latest.current.onUndo(),
        onRedo: () => latest.current.onRedo(),
        look: 'screen',
        foldDrawing: latest.current.folded,
        onDrawingFold: (folded) => latest.current.onFolded(folded),
        onChange: (doc) => {
          if (doc !== store.get()) store.set(doc, { source: 'editor', group: 'typing' });
        },
        onRun: () => latest.current.onRun(),
        onCursorLine: (line) => latest.current.onCursorLine(line),
      });
      editor.view.contentDOM.id = editorId;
      editor.view.contentDOM.addEventListener('focus', () => latest.current.onFocusChange?.(true));
      editor.view.contentDOM.addEventListener('blur', () => latest.current.onFocusChange?.(false));
      editorRef.current = editor;
      setReady(true);
    };
    if (create) make(create);
    else loadEditor().then((m) => make(m.createEditor), (error: unknown) => console.error('PlainSpice: the editor could not be loaded', error));
    return () => {
      alive = false;
      if (editor && editorRef.current === editor) editorRef.current = null;
      if (editor?.view.hasFocus) latest.current.onFocusChange?.(false);
      editor?.destroy();
    };
  }, [store, editorRef, create, hintId, editorId]);

  // Follow the store: a change made anywhere else comes into the editor (only the part that differs).
  useEffect(
    () =>
      store.subscribe((text, change) => {
        if (change.source !== 'editor') editorRef.current?.syncDoc(text);
      }),
    [store, editorRef],
  );

  // Traps and results belong to one text: shown only while the editor holds exactly that text. Set
  // again only when they change: setting them closes a trap's pop-up (F8) that is open.
  const { traps, checkedText, colours, notes, notesText, folded, showLine } = p;
  useEffect(() => {
    const editor = editorRef.current;
    if (!ready || !editor) return;
    if (editor.getDoc() === checkedText) editor.setTraps([...traps], (fix) => latest.current.onFix(fix));
  }, [ready, traps, checkedText, editorRef]);
  useEffect(() => {
    if (ready) editorRef.current?.setNodeColours(new Map(colours));
  }, [ready, colours, editorRef]);
  useEffect(() => {
    const editor = editorRef.current;
    if (!ready || !editor) return;
    if (notesText !== undefined && editor.getDoc() === notesText) editor.setInlineNotes([...notes]);
    else editor.clearInlineNotes();
  }, [ready, notes, notesText, editorRef]);
  useEffect(() => {
    if (ready) editorRef.current?.setDrawingFolded(folded);
  }, [ready, folded, editorRef]);
  useEffect(() => {
    const editor = editorRef.current;
    if (!ready || !editor || showLine === undefined || editor.view.hasFocus) return;
    editor.showLine(showLine);
  }, [ready, showLine, editorRef]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(store.get());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="netlist">
      <div className="screen">
        <div className="screen__bar">
          <span className="screen__dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="screen__file">{p.fileName}</span>
          {p.drawingLines > 0 ? (
            <button type="button" className="screen__button" aria-expanded={!folded} aria-controls={editorId} onClick={() => p.onFolded(!folded)}>
              <LineIcon name={folded ? 'chevron-right' : 'chevron-down'} />
              {folded ? tn('drawingShow', p.drawingLines) : t('drawingHide')}
            </button>
          ) : null}
          <button className="screen__button" type="button" onClick={() => void copy()} aria-label={t('netlistCopyLabel')}>
            <LineIcon name="copy" />
            <span aria-live="polite">{copied ? t('netlistCopied') : t('netlistCopy')}</span>
          </button>
        </div>
        <div className="screen__editor" ref={host} hidden={!ready} />
        {/* The text until the editor's code is in. */}
        {ready ? null : <pre className="screen__waiting">{store.get()}</pre>}
      </div>
      {p.thisLine && p.thisLine.fields.length ? (
        <section className="this-line" aria-labelledby={`${hintId}-this`}>
          <h3 className="this-line__title" id={`${hintId}-this`}>
            {t('explainedLine', { line: p.thisLine.line, heading: p.thisLine.heading })}
          </h3>
          <FieldTable explanation={p.thisLine} />
        </section>
      ) : null}
      <p id={hintId} className="panel-foot">
        {p.phone ? t('netlistHintPhone') : EDITOR_HINT}
      </p>
      <p className="panel-foot">{t('netlistFoot')}</p>
    </div>
  );
}

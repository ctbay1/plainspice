/**
 * Mounts the netlist editor (src/editor, CodeMirror 6) once, imperatively, as decision 0002 asks:
 * the text never lives in React state. The app talks to it through `editorRef`; the callbacks go
 * through a ref so the editor always calls the newest handlers without being re-created.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createEditor as createDefaultEditor, EDITOR_HINT, type EditorOptions, type PlainSpiceEditor } from '../../editor/index.ts';
import { t } from '../../i18n/index.ts';

export type CreateEditor = (opts: EditorOptions) => PlainSpiceEditor;

export interface EditorHandlers {
  onChange: (doc: string) => void;
  onRun: () => void;
  onCursorLine: (line: number) => void;
  /** A new editor instance exists (on mount, and again if React mounts it twice in development). */
  onReady: (editor: PlainSpiceEditor) => void;
}

export function NetlistEditor({
  initialDoc,
  editorRef,
  handlers,
  create = createDefaultEditor,
}: {
  initialDoc: string;
  editorRef: RefObject<PlainSpiceEditor | null>;
  handlers: EditorHandlers;
  create?: CreateEditor;
}): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(handlers);
  // Updated before any effect runs, so the editor (created in an effect) always calls the newest handlers.
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  const firstDoc = useRef(initialDoc);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const editor = create({
      parent,
      doc: firstDoc.current,
      label: t('editorLabel'),
      describedBy: 'netlist-hint',
      onChange: (doc) => latest.current.onChange(doc),
      onRun: () => latest.current.onRun(),
      onCursorLine: (line) => latest.current.onCursorLine(line),
    });
    editorRef.current = editor;
    latest.current.onReady(editor);
    return () => {
      // Keep the text if React mounts the editor again (StrictMode in development).
      firstDoc.current = editor.getDoc();
      editor.destroy();
      if (editorRef.current === editor) editorRef.current = null;
    };
  }, [create, editorRef]);

  return (
    <>
      <div ref={host} className="editor-host" id="netlist-editor" />
      <p id="netlist-hint" className="hint">
        {EDITOR_HINT}
      </p>
    </>
  );
}

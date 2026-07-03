import { useEffect, useRef, useState, useCallback } from 'react';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  keymap,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldKeymap,
} from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { oneDark } from '@codemirror/theme-one-dark';
import type { FileWriteResult, ElementCandidate } from '../../shared/types';

// Pick a CodeMirror language extension from the file extension. Unknown types
// get no language extension (still editable as plain text).
function languageForFile(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ typescript: true, jsx: true });
    case 'js':
    case 'mjs':
    case 'cjs':
      return javascript();
    case 'jsx':
      return javascript({ jsx: true });
    case 'html':
    case 'htm':
    case 'vue':
    case 'svelte':
      return html();
    case 'css':
    case 'scss':
    case 'less':
      return css();
    default:
      return null;
  }
}

interface CodeEditorPanelProps {
  filePath: string;
  fileName: string;
  initialContent: string;
  gotoLine?: number;
  // How the file/line was resolved (e.g. "React source", "project search").
  method?: string;
  // Project root, used to show candidate paths relative to it.
  projectPath: string;
  // Other likely source locations (fuzzy resolution) for the "wrong file?" picker.
  candidates?: ElementCandidate[];
  // Resolution was a thin-margin guess — open the candidate picker up-front.
  uncertain?: boolean;
  onPickCandidate?: (candidate: ElementCandidate) => void;
  // Project file tree toggle (built-in editor browse mode).
  treeOpen?: boolean;
  onToggleTree?: () => void;
  // Full-window toggle (hide the browser preview, editor takes the whole window).
  full?: boolean;
  onToggleFull?: () => void;
  // Bumped by the parent each time the same file is re-opened, so we re-scroll.
  nonce: number;
  onSave: (content: string) => Promise<FileWriteResult>;
  onClose: () => void;
}

export default function CodeEditorPanel({
  filePath,
  fileName,
  initialContent,
  gotoLine,
  method,
  projectPath,
  candidates,
  uncertain,
  onPickCandidate,
  treeOpen,
  onToggleTree,
  full,
  onToggleFull,
  nonce,
  onSave,
  onClose,
}: CodeEditorPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasCandidates = !!(candidates && candidates.length > 1);
  // Open the "wrong file?" picker automatically when the source was a low-
  // confidence guess, so alternatives are visible without hunting for them.
  const [pickerOpen, setPickerOpen] = useState(!!uncertain && hasCandidates);
  // Show a candidate path relative to the project root (e.g. src/app/page.tsx).
  const relPath = (p: string) => {
    const root = projectPath.replace(/[\\/]+$/, '');
    return p.startsWith(root) ? p.slice(root.length + 1) : p;
  };
  // Keep the latest onSave without re-creating the editor when it changes.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // Scroll the editor so the given 1-based line sits in the middle of the view,
  // and place the cursor there.
  const revealLine = useCallback((view: EditorView, line?: number) => {
    if (!line || line < 1) return;
    const lineCount = view.state.doc.lines;
    const clamped = Math.min(line, lineCount);
    const pos = view.state.doc.line(clamped).from;
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
  }, []);

  const doSave = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    setSaving(true);
    setError(null);
    const result = await onSaveRef.current(view.state.doc.toString());
    setSaving(false);
    if (result.ok) {
      setDirty(false);
    } else {
      setError(result.error);
    }
  }, []);

  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  // Create the editor once per file (keyed by filePath in the parent).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const language = languageForFile(fileName);
    const editable = new Compartment();

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialContent,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          ...(language ? [language] : []),
          oneDark,
          // Cmd/Ctrl+S saves — registered at highest precedence so it wins.
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-s',
                preventDefault: true,
                run: () => {
                  void doSaveRef.current();
                  return true;
                },
              },
            ]),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setDirty(true);
          }),
          // Darken oneDark to match the app's surfaces (oneDark ships #282c34).
          EditorView.theme(
            {
              '&': { height: '100%', fontSize: '13px', backgroundColor: '#0d0d0d' },
              '.cm-scroller': {
                fontFamily:
                  "'SF Mono', 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace",
              },
              '.cm-gutters': { backgroundColor: '#0d0d0d', border: 'none' },
              '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.035)' },
              '.cm-activeLineGutter': { backgroundColor: 'rgba(255, 255, 255, 0.035)' },
              '.cm-foldGutter': { backgroundColor: '#0d0d0d' },
            },
            { dark: true },
          ),
        ],
      }),
    });
    viewRef.current = view;
    revealLine(view, gotoLine);
    view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // initialContent/gotoLine are intentionally only read on mount; the parent
    // remounts this component (via key={filePath}) when a different file opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // Re-scroll when the same file is re-opened targeting a different line.
  useEffect(() => {
    const view = viewRef.current;
    if (view) revealLine(view, gotoLine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  return (
    <div className="code-editor-panel">
      <div className="code-editor-header">
        <span className="code-editor-filename" title={filePath}>
          {hasCandidates ? (
            <button
              type="button"
              className="code-editor-filepicker"
              onClick={() => setPickerOpen((o) => !o)}
              title="Wrong file? Pick another match"
            >
              {fileName}
              {gotoLine ? <span className="code-editor-line">:{gotoLine}</span> : null}
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : (
            <>
              {fileName}
              {gotoLine ? <span className="code-editor-line">:{gotoLine}</span> : null}
            </>
          )}
          {dirty && <span className="code-editor-dot" aria-label="Unsaved changes" />}
        </span>
        {hasCandidates && pickerOpen && (
          <div className="code-editor-candidates">
            <div className="code-editor-candidates-label">Likely source files</div>
            {candidates!.map((c, i) => (
              <button
                type="button"
                key={`${c.file}:${c.line}:${i}`}
                className={`code-editor-candidate ${c.file === filePath ? 'is-active' : ''}`}
                onClick={() => { setPickerOpen(false); if (c.file !== filePath || c.line !== gotoLine) onPickCandidate?.(c); }}
              >
                <span className="code-editor-candidate-path">{relPath(c.file)}<span className="code-editor-line">:{c.line}</span></span>
                <span className="code-editor-candidate-strategy">{c.strategy}</span>
              </button>
            ))}
          </div>
        )}
        <div className="code-editor-header-actions">
          {onToggleFull && (
            <button
              type="button"
              className={`code-editor-tree-toggle ${full ? 'is-active' : ''}`}
              onClick={onToggleFull}
              title={full ? 'Exit full width' : 'Expand to full width'}
              aria-label="Toggle full width"
            >
              {full ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 4v4a1 1 0 0 1-1 1H4M20 9h-4a1 1 0 0 1-1-1V4M15 20v-4a1 1 0 0 1 1-1h4M4 15h4a1 1 0 0 1 1 1v4" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                </svg>
              )}
            </button>
          )}
          {onToggleTree && (
            <button
              type="button"
              className={`code-editor-tree-toggle ${treeOpen ? 'is-active' : ''}`}
              onClick={onToggleTree}
              title={treeOpen ? 'Hide file tree' : 'Show file tree'}
              aria-label="Toggle file tree"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h5l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
              </svg>
            </button>
          )}
          <button
            type="button"
            className="code-editor-save"
            onClick={() => void doSave()}
            disabled={!dirty || saving}
            title="Save (⌘S)"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="code-editor-close"
            onClick={onClose}
            title="Close editor"
            aria-label="Close editor"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4L12 12M4 12L12 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
      {error && <div className="code-editor-error">{error}</div>}
      <div className="code-editor-host" ref={hostRef} />
    </div>
  );
}

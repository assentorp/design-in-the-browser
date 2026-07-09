import { useState, useRef, useEffect, useCallback, type MutableRefObject } from 'react';
import Toolbar from './Toolbar';
import CodeEditorPanel from './CodeEditorPanel';
import CodeFileTree from './CodeFileTree';
import type { AnnotationData, MultiEditData, SessionPendingEdit, ElementCandidate, CodeEditor } from '../../shared/types';
import { annotationScript } from '../../annotation/injected-script';

// Check if running in Electron (must be called at runtime)
const getMainAPI = () => typeof window !== 'undefined' ? window.mainAPI : undefined;

// Windows drive path, e.g. "C:\foo" or "C:/foo"
const WINDOWS_PATH_RE = /^[a-zA-Z]:[\\/]/;

// Convert an absolute local filesystem path into a file:// URL the webview can load.
// Handles Windows backslashes/drive letters and encodes spaces & other unsafe chars,
// while preserving path separators and the drive colon.
const pathToFileUrl = (p: string): string => {
  let normalized = p.replace(/\\/g, '/'); // backslashes → forward slashes
  if (!normalized.startsWith('/')) normalized = '/' + normalized; // file:///C:/...
  // encodeURI keeps "/" and ":" intact; additionally escape chars that would
  // otherwise be parsed as query/fragment in a real filename.
  const encoded = encodeURI(normalized).replace(/\?/g, '%3F').replace(/#/g, '%23');
  return 'file://' + encoded;
};

// Turn whatever the user typed (or a project default) into a loadable URL.
const normalizeUrl = (raw: string): string => {
  const targetUrl = raw.trim();

  // Already a fully-qualified scheme we pass through untouched.
  if (/^(https?|file|about|data|blob):/i.test(targetUrl)) {
    return targetUrl;
  }

  // Local filesystem paths → file:// URLs.
  //  - Windows absolute:  C:\path\index.html  /  C:/path/index.html
  //  - Unix absolute:     /path/to/index.html
  if (WINDOWS_PATH_RE.test(targetUrl) || targetUrl.startsWith('/')) {
    return pathToFileUrl(targetUrl);
  }

  // Bare host/URL: http for localhost, https for everything else.
  const isLocal = targetUrl.startsWith('localhost') || targetUrl.startsWith('127.0.0.1');
  return (isLocal ? 'http://' : 'https://') + targetUrl;
};

export interface PendingEdit {
  note: string;
  selector: string;
  tagName?: string;
  text?: string;
  attributes?: string;
}

export interface EditActions {
  sendAll: () => void;
  removeItem: (index: number) => void;
  clearAll: () => void;
}

interface BrowserProps {
  sessionId: string;
  url: string;
  onUrlChange: (url: string) => void;
  annotateMode: boolean;
  onAnnotateModeChange: (enabled: boolean) => void;
  onPendingEditsChange: (edits: PendingEdit[], actions: EditActions) => void;
  activeTerminalTabId: string;
  projectPath: string;
  onAnnotation?: (data: AnnotationData) => void;
  cliRunning?: boolean;
  initialEdits?: SessionPendingEdit[];
  onZoom?: MutableRefObject<((direction: string) => void) | null>;
  onToggleTerminal?: () => void;
}

export type ViewportType = 'desktop' | 'tablet' | 'mobile';

export interface ViewportSizes {
  desktop: number;
  tablet: number;
  mobile: number;
}

const DEFAULT_VIEWPORT_SIZES: ViewportSizes = {
  desktop: 1280,
  tablet: 768,
  mobile: 375,
};

export default function Browser({ sessionId, url, onUrlChange, annotateMode, onAnnotateModeChange, onPendingEditsChange, activeTerminalTabId, projectPath, onAnnotation, cliRunning, initialEdits, onZoom, onToggleTerminal }: BrowserProps) {
  const [inputUrl, setInputUrl] = useState(url);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [hasMainAPI, setHasMainAPI] = useState(() => !!getMainAPI());
  const [viewport, setViewport] = useState<ViewportType | null>(null);
  const [viewportSizes, setViewportSizes] = useState<ViewportSizes>(DEFAULT_VIEWPORT_SIZES);
  const [zoomFactor, setZoomFactor] = useState(1.0);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const [devToolsHeight, setDevToolsHeight] = useState(300);
  // In-app code editor: opened from an element's "Edit code" popover button.
  const [codePanel, setCodePanel] = useState<{ path: string; fileName: string; content: string; gotoLine?: number; method: string; candidates?: ElementCandidate[]; uncertain?: boolean; nonce: number } | null>(null);
  const [codePanelWidth, setCodePanelWidth] = useState(480);
  const [codePanelLoading, setCodePanelLoading] = useState(false);
  const [codePanelError, setCodePanelError] = useState<string | null>(null);
  // When the built-in editor is opened from the toolbar "Code" button it shows a
  // project file tree alongside the editor.
  const [codeTreeOpen, setCodeTreeOpen] = useState(false);
  // Full-window editor: hides the browser preview so the editor takes the whole
  // window. Always on in project/tree mode; toggleable for the element side panel.
  const [codeFull, setCodeFull] = useState(false);
  const [editorPref, setEditorPref] = useState<CodeEditor>('builtin');
  const blockedUrlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const devToolsPlaceholderRef = useRef<HTMLDivElement | null>(null);
  const browserRef = useRef<HTMLDivElement | null>(null);
  const injectedRef = useRef(false);
  const hasEverLoadedRef = useRef(false);
  const [hasFirstPaint, setHasFirstPaint] = useState(false);
  const [hasEditor, setHasEditor] = useState(true);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Debounce reload-storm injection triggers: dev-server restarts (e.g. after a
  // git branch switch) can fire did-stop-loading + dom-ready in rapid succession,
  // each of which would otherwise schedule a full project file walk in main.
  const injectDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAnnotationRef = useRef(onAnnotation);
  onAnnotationRef.current = onAnnotation;
  const cliRunningRef = useRef(cliRunning);
  cliRunningRef.current = cliRunning;

  // Check for mainAPI (might not be available immediately)
  useEffect(() => {
    const api = getMainAPI();
    console.log('[Browser] Checking mainAPI:', !!api);
    if (api && !hasMainAPI) {
      setHasMainAPI(true);
    } else if (!api) {
      // Retry after a short delay in case preload hasn't run yet
      const timer = setTimeout(() => {
        const retryApi = getMainAPI();
        console.log('[Browser] Retry mainAPI check:', !!retryApi);
        if (retryApi) setHasMainAPI(true);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [hasMainAPI]);

  // Detect installed editors so we can disable the Code button when none are
  // present (otherwise the spawn ENOENTs and macOS surfaces a system dialog).
  // Re-check on window focus so users who install an editor mid-session don't
  // need to restart the app.
  useEffect(() => {
    const api = getMainAPI();
    if (!api) return;
    let cancelled = false;
    const check = () => {
      api.detectEditors().then((editors) => {
        if (!cancelled) setHasEditor(editors.length > 0);
      }).catch(() => { /* leave previous value */ });
      // Keep the selected-editor preference fresh (it can change in Settings).
      api.getSettings().then((s) => {
        if (!cancelled) setEditorPref((s.editor as CodeEditor) || 'builtin');
      }).catch(() => { /* leave previous value */ });
    };
    check();
    window.addEventListener('focus', check);
    return () => { cancelled = true; window.removeEventListener('focus', check); };
  }, [hasMainAPI]);

  // Inject annotation script and setup handlers
  const injectAndSetup = useCallback(async () => {
    const webview = webviewRef.current;
    console.log('[Browser] injectAndSetup called, webview:', !!webview, 'injected:', injectedRef.current);
    if (!webview || injectedRef.current) return;

    // Set flag immediately to prevent race conditions
    injectedRef.current = true;

    try {
      console.log('[Browser] Injecting callback functions...');
      // First inject the callback functions
      await webview.executeJavaScript(`
        window.__claudeDesignSendAnnotation = function(data) {
          window.postMessage({ type: 'claude-design-annotation', data: data }, '*');
        };
        window.__claudeDesignNotifyModeChange = function(enabled) {
          window.postMessage({ type: 'claude-design-mode-change', enabled: enabled }, '*');
        };
        true;
      `);

      console.log('[Browser] Injecting main script...');
      // Then inject the main script
      await webview.executeJavaScript(annotationScript + '\ntrue;');

      // Inject configured grid overlay sizes (Shift+G grid)
      const mainAPI = getMainAPI();
      try {
        const settings = await mainAPI?.getSettings();
        if (settings) {
          await webview.executeJavaScript(
            `window.__claudeDesignSetGridSizes && window.__claudeDesignSetGridSizes(${Number(settings.gridSpatialSize) || 8}, ${Number(settings.gridBaselineSize) || 4}); true;`
          );
        }
      } catch (err) {
        console.error('[Browser] Failed to inject grid sizes:', err);
      }

      // Inject project files for @-mention autocomplete
      if (mainAPI && projectPath) {
        try {
          const files = await mainAPI.listProjectFiles(projectPath);
          await webview.executeJavaScript(
            `window.__claudeDesignProjectFiles = ${JSON.stringify(files)}; true;`
          );
          console.log('[Browser] Injected project files:', files.length);
        } catch (err) {
          console.error('[Browser] Failed to inject project files:', err);
        }

        // Inject design tokens for >mention autocomplete
        try {
          const tokens = await mainAPI.listDesignTokens(projectPath);
          await webview.executeJavaScript(
            `window.__claudeDesignTokens = ${JSON.stringify(tokens)}; true;`
          );
          console.log('[Browser] Injected design tokens:', tokens.length);
        } catch (err) {
          console.error('[Browser] Failed to inject design tokens:', err);
        }
      }

      needsEditReinjection.current = true;
      setIsReady(true);
      hasEverLoadedRef.current = true;
      console.log('[Browser] Injection complete, isReady = true');
    } catch (err) {
      console.error('[Browser] Injection error:', err);
      // Reset flag so injection can be retried
      injectedRef.current = false;
    }
  }, []);

  const sendAllEdits = useCallback(async () => {
    const webview = webviewRef.current;
    if (!webview) return;
    try {
      await webview.executeJavaScript('window.__claudeDesignSendAll && window.__claudeDesignSendAll(); true;');
    } catch (err) {
      console.error('Send all edits error:', err);
    }
  }, []);

  const removeEditItem = useCallback(async (index: number) => {
    const webview = webviewRef.current;
    if (!webview) return;
    try {
      await webview.executeJavaScript(`window.__claudeDesignRemoveItem && window.__claudeDesignRemoveItem(${index}); true;`);
    } catch (err) {
      console.error('Remove edit item error:', err);
    }
  }, []);

  const clearAllEdits = useCallback(async () => {
    const webview = webviewRef.current;
    if (!webview) return;
    try {
      await webview.executeJavaScript('window.__claudeDesignClearAll && window.__claudeDesignClearAll(); true;');
    } catch (err) {
      console.error('Clear all edits error:', err);
    }
  }, []);

  const addToTodoList = useCallback(async (data: AnnotationData) => {
    const webview = webviewRef.current;
    if (!webview) return;
    try {
      const note = data.request || '';
      const selector = data.element?.selector || '';
      const tagName = data.element?.tagName || 'div';
      const text = data.element?.text || '';
      const attributes = data.element?.attributes || '';
      await webview.executeJavaScript(
        `window.__claudeDesignAddToTodo && window.__claudeDesignAddToTodo(${JSON.stringify(note)}, ${JSON.stringify(selector)}, ${JSON.stringify(tagName)}, ${JSON.stringify(text)}, ${JSON.stringify(attributes)}); true;`
      );
    } catch (err) {
      console.error('Add to todo list error:', err);
    }
  }, []);

  // Re-inject saved pending edits after the annotation script is freshly injected.
  // injectAndSetup sets this flag; the effect below consumes it once.
  const needsEditReinjection = useRef(false);
  // Keep snapshot in sync with latest prop value
  const initialEditsSnapshot = useRef(initialEdits);
  useEffect(() => {
    initialEditsSnapshot.current = initialEdits;
  }, [initialEdits]);

  useEffect(() => {
    if (!isReady || !needsEditReinjection.current) return;
    needsEditReinjection.current = false;

    const edits = initialEditsSnapshot.current;
    if (!edits?.length) return;

    const webview = webviewRef.current;
    if (!webview) return;

    (async () => {
      for (const edit of edits) {
        try {
          await webview.executeJavaScript(
            `window.__claudeDesignAddToTodo && window.__claudeDesignAddToTodo(${JSON.stringify(edit.note)}, ${JSON.stringify(edit.selector)}, ${JSON.stringify(edit.tagName || 'div')}, ${JSON.stringify(edit.text || '')}, ${JSON.stringify(edit.attributes || '')}); true;`
          );
        } catch {
          // Webview may not be ready
        }
      }
    })();
  }, [isReady]);

  // Load initial URL after webview is mounted in DOM
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !hasMainAPI) return;

    // Wait for next frame to ensure webview is fully in DOM
    const frameId = requestAnimationFrame(() => {
      console.log('[Browser] Loading initial URL after mount');
      webview.src = normalizeUrl(url);
    });

    return () => cancelAnimationFrame(frameId);
  // Only run on mount, not when url changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMainAPI]);

  // Handle webview events
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const handleDidNavigate = () => {
      onUrlChange(webview.getURL());
      setInputUrl(webview.getURL());
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
      // Reset injection state on navigation
      injectedRef.current = false;
      setIsReady(false);
    };

    const handleDidStartLoading = () => {
      setIsLoading(true);
      injectedRef.current = false;
      setIsReady(false);
      // Clear retry timer if navigation starts successfully
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    const handleDidStopLoading = () => {
      setIsLoading(false);
      scheduleInject();
      // Wait for the page to actually paint content before hiding spinner.
      // SPA/React apps load HTML first, then render via JS — did-stop-loading
      // fires too early. Poll until <body> has visible content, with a fallback.
      const wv = webviewRef.current;
      if (wv) {
        wv.executeJavaScript(`
          new Promise(function(resolve) {
            function check() {
              if (document.body && document.body.offsetHeight > 0 && document.body.innerHTML.length > 200) {
                requestAnimationFrame(function() { requestAnimationFrame(resolve); });
              } else {
                setTimeout(check, 50);
              }
            }
            check();
            setTimeout(resolve, 5000);
          })
        `).then(() => setHasFirstPaint(true)).catch(() => setHasFirstPaint(true));
      } else {
        setHasFirstPaint(true);
      }
    };

    const handleDomReady = () => {
      scheduleInject();
    };

    const scheduleInject = () => {
      if (injectDebounceRef.current) clearTimeout(injectDebounceRef.current);
      injectDebounceRef.current = setTimeout(() => {
        injectDebounceRef.current = null;
        injectAndSetup();
      }, 80);
    };

    // Suppress expected navigation errors (ERR_ABORTED is normal during navigation)
    const handleDidFailLoad = (e: Electron.DidFailLoadEvent) => {
      // ERR_ABORTED (-3) is expected when navigating away from a page
      // ERR_BLOCKED_BY_CLIENT (-20) happens with ad blockers
      const ignoredErrors = [-3, -20, -2];
      if (!ignoredErrors.includes(e.errorCode)) {
        console.warn('Page load failed:', e.errorDescription);

        // Auto-retry on connection errors (dev server not ready yet)
        const retryErrors = [-102, -324, -7]; // CONNECTION_REFUSED, EMPTY_RESPONSE, TIMED_OUT
        if (retryErrors.includes(e.errorCode) && webview) {
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          const retryUrl = e.validatedURL || url;
          const mainAPI = getMainAPI();

          // Poll via main process (Node http) until server is reachable, then reload
          const poll = () => {
            retryTimerRef.current = setTimeout(async () => {
              const up = mainAPI ? await mainAPI.checkUrl(retryUrl) : false;
              if (up) {
                console.log('[Browser] Server is up, reloading webview');
                webview.src = retryUrl;
              } else {
                poll();
              }
            }, 1500);
          };
          poll();
        }
      }
    };

    webview.addEventListener('did-navigate', handleDidNavigate);
    webview.addEventListener('did-navigate-in-page', handleDidNavigate);
    webview.addEventListener('did-start-loading', handleDidStartLoading);
    webview.addEventListener('did-stop-loading', handleDidStopLoading);
    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('did-fail-load', handleDidFailLoad);

    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (injectDebounceRef.current) clearTimeout(injectDebounceRef.current);
      webview.removeEventListener('did-navigate', handleDidNavigate);
      webview.removeEventListener('did-navigate-in-page', handleDidNavigate);
      webview.removeEventListener('did-start-loading', handleDidStartLoading);
      webview.removeEventListener('did-stop-loading', handleDidStopLoading);
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('did-fail-load', handleDidFailLoad);
    };
  }, [injectAndSetup, onUrlChange]);

  // Open a file in the embedded VS Code web view
  // Open a file in desktop VS Code — reliable unlike embedded VS Code web Quick Open
  const clearSelection = useCallback(async () => {
    const webview = webviewRef.current;
    if (!webview) return;
    try {
      await webview.executeJavaScript('window.__claudeDesignCancelAnnotation && window.__claudeDesignCancelAnnotation(); true;');
    } catch { /* ignore */ }
  }, []);

  // Unsaved-changes tracking for the in-app editor. A ref (not state): it's only
  // read at decision points, and updating it must not re-render the browser.
  const codeDirtyRef = useRef(false);

  // Latest codePanel for use inside async callbacks without re-creating them.
  const codePanelRef = useRef(codePanel);
  codePanelRef.current = codePanel;

  // Returns true when it's safe to discard the current editor buffer — either
  // there are no unsaved edits, or the user explicitly confirmed losing them.
  const confirmDiscardCodeEdits = useCallback(() => {
    if (!codeDirtyRef.current) return true;
    if (!confirm('Discard unsaved changes?')) return false;
    codeDirtyRef.current = false;
    return true;
  }, []);

  // Open a project file in the in-app code editor panel, scrolled to `line`.
  // `candidates` (when resolution was fuzzy) populates the "wrong file?" picker.
  // `uncertain` (fuzzy resolution with a thin margin) makes the panel open its
  // "wrong file?" picker up-front so alternatives are one glance away.
  const openInlineEditor = useCallback(async (filePath: string, line?: number, method = '', candidates?: ElementCandidate[], uncertain = false) => {
    const mainAPI = getMainAPI();
    if (!mainAPI) return;
    clearSelection();
    const gotoLine = line && line > 1 ? line : undefined;
    console.log('[Browser] openInlineEditor:', { filePath, line, method, uncertain });
    setCodePanelError(null);
    setCodePanelLoading(true);
    const result = await mainAPI.readProjectFile(filePath, projectPath);
    setCodePanelLoading(false);
    if (!result.ok) {
      setCodePanelError(result.error);
      return;
    }
    // Opening a DIFFERENT file remounts the editor (key={path}) and discards its
    // buffer — confirm first when there are unsaved edits. Compared after the
    // read because result.path is the resolved on-disk path, so a same-file
    // reopen (which keeps the buffer) never prompts. The read has no side
    // effects, so bailing here is safe.
    const replacingDirtyFile = codeDirtyRef.current && result.path !== (codePanelRef.current?.path ?? result.path);
    if (replacingDirtyFile && !confirmDiscardCodeEdits()) return;
    const fileName = result.path.split(/[\\/]/).pop() || result.path;
    setCodePanel((prev) => ({
      path: result.path,
      fileName,
      content: result.content,
      gotoLine,
      method,
      candidates,
      uncertain,
      // Bump the nonce so the panel re-scrolls even if the same file reopens.
      nonce: (prev && prev.path === result.path ? prev.nonce : 0) + 1,
    }));
  }, [clearSelection, projectPath, confirmDiscardCodeEdits]);

  const saveInlineEdit = useCallback((content: string) => {
    const mainAPI = getMainAPI();
    if (!mainAPI || !codePanel) return Promise.resolve({ ok: false as const, error: 'Editor not ready.' });
    return mainAPI.writeProjectFile(codePanel.path, content, projectPath);
  }, [codePanel, projectPath]);

  // Close the code side panel — confirming first if edits would be lost.
  const closeCodePanel = useCallback(() => {
    if (!confirmDiscardCodeEdits()) return;
    setCodePanel(null);
    setCodePanelError(null);
    setCodeTreeOpen(false);
    setCodeFull(false);
  }, [confirmDiscardCodeEdits]);

  // Close the editor when switching projects so we never edit a stale file.
  // The switch has already happened by the time this runs, so there's nothing
  // to confirm — just drop the dirty flag along with the panel.
  useEffect(() => {
    codeDirtyRef.current = false;
    setCodePanel(null);
    setCodePanelError(null);
    setCodePanelLoading(false);
  }, [projectPath]);

  // Event-driven message bridge: webview signals via console.log, we fetch on demand
  useEffect(() => {
    if (!isReady) return;

    const webview = webviewRef.current;
    if (!webview) return;

    // Set up message bridge in webview — posts messages to a queue,
    // then signals the renderer via console.log instead of requiring polling
    const setupMessageBridge = async () => {
      try {
        await webview.executeJavaScript(`
          if (!window.__claudeDesignMessageBridge) {
            window.__claudeDesignMessageBridge = true;
            window.__claudeDesignMessages = [];
            // Capture native console.log before page code can override it
            var __claudeSignal = console.log.bind(console);

            window.addEventListener('message', function(e) {
              if (e.data && (e.data.type === 'claude-design-annotation' || e.data.type === 'claude-design-mode-change' || e.data.type === 'claude-design-pending-update' || e.data.type === 'claude-design-edit-code' || e.data.type === 'claude-design-toggle-terminal')) {
                window.__claudeDesignMessages.push(e.data);
                __claudeSignal('__claude_msg__');
              }
            });
          }
          // Sync pending state with React (clears stale items after page reload)
          if (window.__claudeDesignNotifyPending) window.__claudeDesignNotifyPending();
          true;
        `);
      } catch {
        // Ignore errors during setup
      }
    };

    setupMessageBridge();

    // Fetch and process queued messages from the webview
    // Use a pending flag so messages that arrive during a fetch are not lost
    let fetching = false;
    let fetchAgain = false;
    const fetchMessages = async () => {
      if (fetching) {
        fetchAgain = true;  // Will re-fetch after current one completes
        return;
      }
      fetching = true;
      try {
        const result = await webview.executeJavaScript(`
          (function() {
            var msgs = window.__claudeDesignMessages || [];
            window.__claudeDesignMessages = [];
            return JSON.stringify(msgs);
          })();
        `);

        if (result) {
          const messages = JSON.parse(result);
          if (messages && messages.length > 0) {
            for (const msg of messages) {
              if (msg.type === 'claude-design-annotation') {
                const mainAPI = getMainAPI();
                const data = msg.data as AnnotationData | MultiEditData;

                // Handle multi-edit annotations
                if ('annotations' in data && Array.isArray(data.annotations)) {
                  const multiData = data as MultiEditData;
                  console.log('[Browser] Multi-edit received, count:', multiData.annotations.length);
                  multiData.sessionId = sessionId;
                  multiData.terminalTabId = activeTerminalTabId;

                  // Capture screenshot for each annotation
                  for (const annotation of multiData.annotations) {
                    if (annotation.bounds && webview) {
                      try {
                        const image = await webview.capturePage(annotation.bounds);
                        annotation.screenshot = image.toDataURL();
                      } catch (err) {
                        console.error('Screenshot capture failed for annotation:', err);
                      }
                    }
                  }

                  if (onAnnotationRef.current) {
                    onAnnotationRef.current(multiData as unknown as AnnotationData);
                  } else if (mainAPI) {
                    mainAPI.sendAnnotation(multiData as unknown as AnnotationData);
                  } else {
                    console.log('Multi-edit data:', multiData);
                  }
                } else {
                  // Handle single annotation
                  const singleData = data as AnnotationData;
                  console.log('[Browser] Annotation received, has referenceImage:', !!singleData.referenceImage, 'cliRunning:', cliRunningRef.current);
                  singleData.sessionId = sessionId;
                  singleData.terminalTabId = activeTerminalTabId;

                  // If CLI is busy, add to todo list instead of sending
                  // (fallback — the webview normally handles this directly via __claudeDesignCliRunning)
                  if (cliRunningRef.current) {
                    console.log('[Browser] CLI is busy, adding to todo list');
                    await addToTodoList(singleData);
                  } else {
                    // Capture screenshot of the element (skip for text-only selections - faster)
                    if (singleData.bounds && webview && !singleData.selectedText) {
                      try {
                        const image = await webview.capturePage(singleData.bounds);
                        singleData.screenshot = image.toDataURL();
                      } catch (err) {
                        console.error('Screenshot capture failed:', err);
                      }
                    }

                    if (onAnnotationRef.current) {
                      onAnnotationRef.current(singleData);
                    } else if (mainAPI) {
                      mainAPI.sendAnnotation(singleData);
                    } else {
                      console.log('Annotation data:', singleData);
                    }
                  }
                }
              } else if (msg.type === 'claude-design-edit-code') {
                const mainAPI = getMainAPI();
                if (mainAPI) {
                  // Element clicks open the side panel beside the page (not full).
                  setCodeTreeOpen(false);
                  setCodeFull(false);
                  // Show the panel with a spinner immediately — resolving the
                  // source (project search below) can take a moment, and without
                  // instant feedback users think the click did nothing and keep
                  // clicking.
                  setCodePanelError(null);
                  setCodePanelLoading(true);
                  if (msg.fileName) {
                    // Exact source (data-source attribute or React 18 _debugSource)
                    let filePath = msg.fileName as string;
                    if (filePath && !filePath.startsWith('/')) {
                      filePath = projectPath + '/' + filePath;
                    }
                    openInlineEditor(filePath, msg.lineNumber, msg.sourceMethod || 'React source');
                  } else {
                    // No exact source — search the project for the best match first
                    console.log('[Browser] No React source; searching project for element', {
                      componentNames: msg.componentNames,
                      searchId: msg.searchId,
                      searchText: msg.searchText,
                    });
                    const result = await mainAPI.searchAndOpenInEditor(projectPath, {
                      componentNames: msg.componentNames || [],
                      id: msg.searchId || null,
                      textContent: msg.searchText || '',
                      ownText: msg.ownText || '',
                      headingText: msg.headingText || '',
                      tagName: msg.tagName || '',
                      dataAttrs: msg.searchDataAttrs || {},
                      pageUrl: msg.pageUrl || '',
                    });
                    if (result && result.candidates.length > 0) {
                      const best = result.candidates[0];
                      // Low confidence = signals didn't strongly converge on one
                      // file and there are other plausible files. Surface the
                      // picker so a wrong guess is trivially correctable.
                      const conf = result.confidence;
                      const otherFiles = new Set(result.candidates.map(c => c.file)).size > 1;
                      const uncertain = otherFiles && (!conf || (conf.agreeingSignals < 2 && conf.gap < 30));
                      openInlineEditor(best.file, best.line, best.strategy, result.candidates, uncertain);
                    } else {
                      setCodePanelLoading(false);
                      setCodePanelError('Could not locate the source file for this element.');
                    }
                  }
                }
              } else if (msg.type === 'claude-design-mode-change') {
                onAnnotateModeChange(msg.enabled);
              } else if (msg.type === 'claude-design-toggle-terminal') {
                onToggleTerminal?.();
              } else if (msg.type === 'claude-design-pending-update') {
                onPendingEditsChange(msg.items || [], { sendAll: sendAllEdits, removeItem: removeEditItem, clearAll: clearAllEdits });
              }
            }
          }
        }
      } catch {
        // Webview might not be ready or navigating
      } finally {
        fetching = false;
        // If a message arrived while we were fetching, fetch again to pick it up
        if (fetchAgain) {
          fetchAgain = false;
          fetchMessages();
        }
      }
    };

    // Listen for signal from webview instead of polling
    const handleConsoleMessage = (e: Electron.ConsoleMessageEvent) => {
      if (e.message === '__claude_msg__') {
        fetchMessages();
      }
    };

    webview.addEventListener('console-message', handleConsoleMessage);

    return () => {
      webview.removeEventListener('console-message', handleConsoleMessage);
    };
  }, [isReady, onAnnotateModeChange, onPendingEditsChange, sessionId, activeTerminalTabId, sendAllEdits, removeEditItem, clearAllEdits, addToTodoList, projectPath, openInlineEditor]);

  // Sync CLI running state to webview so it can auto-queue annotations
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !isReady) return;
    webview.executeJavaScript(`window.__claudeDesignCliRunning = ${!!cliRunning}; true;`).catch(() => {});
  }, [cliRunning, isReady]);

  // Apply grid size changes from Settings to the webview live (no reload needed)
  useEffect(() => {
    const handler = (e: Event) => {
      const webview = webviewRef.current;
      if (!webview || !isReady) return;
      const detail = (e as CustomEvent<{ spatial: number; baseline: number }>).detail;
      if (!detail) return;
      webview
        .executeJavaScript(
          `window.__claudeDesignSetGridSizes && window.__claudeDesignSetGridSizes(${Number(detail.spatial) || 8}, ${Number(detail.baseline) || 4}); true;`
        )
        .catch(() => {});
    };
    window.addEventListener('claude-design-grid-sizes', handler);
    return () => window.removeEventListener('claude-design-grid-sizes', handler);
  }, [isReady]);

  // Toggle annotate mode in webview
  const prevAnnotateModeRef = useRef<boolean | null>(null);
  useEffect(() => {
    console.log('[Browser] Toggle effect - isReady:', isReady, 'annotateMode:', annotateMode);
    if (!isReady) return;

    const webview = webviewRef.current;
    if (!webview) return;

    // Only focus the webview when annotate mode actually transitions
    // (user explicitly toggled it), not when isReady flips after a
    // webview re-injection. Otherwise HMR full-reloads (e.g. triggered
    // by a `git checkout` in the terminal) would steal focus away
    // from the terminal every time.
    const annotateModeChanged = prevAnnotateModeRef.current !== annotateMode;
    prevAnnotateModeRef.current = annotateMode;

    const toggle = async () => {
      try {
        console.log('[Browser] Toggling annotate mode:', annotateMode);
        if (annotateMode) {
          const result = await webview.executeJavaScript('window.__claudeDesignEnable && window.__claudeDesignEnable(); true;');
          console.log('[Browser] Enable result:', result);
          // Focus the webview so ALT+hover works immediately
          if (annotateModeChanged) {
            webview.focus();
          }
        } else {
          await webview.executeJavaScript('window.__claudeDesignDisable && window.__claudeDesignDisable(); true;');
        }
      } catch (err) {
        console.error('[Browser] Toggle error:', err);
      }
    };

    toggle();
  }, [annotateMode, isReady]);

  // Forward ALT and F keys to webview when in annotate mode
  useEffect(() => {
    if (!annotateMode || !isReady) return;

    const webview = webviewRef.current;
    if (!webview) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        webview.executeJavaScript('window.__claudeDesignSetAltKey && window.__claudeDesignSetAltKey(true); true;').catch(() => {});
        // Focus the webview so mousemove events fire inside it,
        // but only if the terminal doesn't have focus (Alt+Arrow for word jump)
        const active = document.activeElement;
        const inTerminal = active?.closest('.terminal-pane') || active?.classList.contains('xterm-helper-textarea');
        if (!inTerminal) {
          webview.focus();
        }
      }
      // Forward F key to webview for freeze animations
      if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag !== 'TEXTAREA' && tag !== 'INPUT') {
          webview.executeJavaScript('window.__claudeDesignToggleFreeze && window.__claudeDesignToggleFreeze(); true;').catch(() => {});
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        webview.executeJavaScript('window.__claudeDesignSetAltKey && window.__claudeDesignSetAltKey(false); true;').catch(() => {});
      }
    };

    // Clear ALT state when window loses focus (e.g. user switches apps while holding ALT)
    const handleBlur = () => {
      webview.executeJavaScript('window.__claudeDesignSetAltKey && window.__claudeDesignSetAltKey(false); true;').catch(() => {});
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', handleBlur);
    };
  }, [annotateMode, isReady]);

  // Cmd+E toggles edit mode when renderer has focus (webview case handled in injected script)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'e' || e.key === 'E') && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (devToolsOpen) return;
        onAnnotateModeChange(!annotateMode);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [annotateMode, onAnnotateModeChange, devToolsOpen]);



  const toggleDevTools = useCallback(() => {
    setDevToolsOpen((open) => {
      const next = !open;
      // Edit mode and DevTools are mutually exclusive — annotation captures clicks
      // that would otherwise reach DevTools' element picker.
      if (next && annotateMode) onAnnotateModeChange(false);
      return next;
    });
  }, [annotateMode, onAnnotateModeChange]);

  // Keep a ref to the latest toggle so the IPC listener (subscribed once below)
  // always calls the current version without needing to re-subscribe.
  const toggleDevToolsRef = useRef(toggleDevTools);
  toggleDevToolsRef.current = toggleDevTools;

  // Listen for the Toggle Inspector menu shortcut (Cmd+Alt+I / Ctrl+Shift+I / F12)
  useEffect(() => {
    const onToggleInspector = (window as unknown as { onToggleInspector?: (cb: () => void) => void }).onToggleInspector;
    if (onToggleInspector) {
      onToggleInspector(() => toggleDevToolsRef.current());
    }
  }, []);

  // Attach DevTools as a top-level WebContentsView in the main process,
  // overlaid on top of the empty placeholder div (placeholder reserves layout space).
  useEffect(() => {
    const mainAPI = getMainAPI();
    const page = webviewRef.current;
    const placeholder = devToolsPlaceholderRef.current;
    if (!devToolsOpen || !isReady || !mainAPI || !page || !placeholder) return;

    let cancelled = false;
    let attachedTargetId: number | null = null;
    let rafId: number | null = null;

    const computeBounds = () => {
      const rect = placeholder.getBoundingClientRect();
      // Skip the top 28px so the resize handle and close button (in the renderer
      // DOM) remain clickable above the WebContentsView overlay.
      const HEADER = 28;
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y) + HEADER,
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height) - HEADER),
      };
    };

    const sendBounds = () => {
      if (rafId !== null || attachedTargetId === null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (cancelled || attachedTargetId === null) return;
        mainAPI.setDevToolsBounds(attachedTargetId, computeBounds()).catch(() => {});
      });
    };

    (async () => {
      // Capture targetId before the await so that if the effect is cancelled
      // mid-attach (user rapidly toggles open→close), we can still undo the
      // attach that raced past our cleanup.
      const targetId = page.getWebContentsId();
      try {
        const ok = await mainAPI.attachDevTools(targetId, computeBounds());
        if (cancelled) {
          if (ok) mainAPI.detachDevTools(targetId).catch(() => {});
          return;
        }
        if (ok) {
          attachedTargetId = targetId;
          // Resync once after attach in case layout shifted between compute and attach
          sendBounds();
        }
      } catch (err) {
        console.error('[Browser] attachDevTools error:', err);
      }
    })();

    // Recompute bounds whenever the browser pane or placeholder changes size.
    // ResizeObserver on .browser catches window/sidebar/terminal resizes;
    // observing the placeholder catches splitter drag (height state change).
    const observer = new ResizeObserver(() => sendBounds());
    if (browserRef.current) observer.observe(browserRef.current);
    observer.observe(placeholder);
    window.addEventListener('resize', sendBounds);

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener('resize', sendBounds);
      if (attachedTargetId !== null) {
        mainAPI.detachDevTools(attachedTargetId).catch(() => {});
      }
    };
  }, [devToolsOpen, isReady]);

  // Drag handle: resize the docked DevTools panel from the top edge
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = devToolsHeight;
    const browser = browserRef.current;
    const browserRect = browser?.getBoundingClientRect();
    const maxHeight = browserRect ? browserRect.height - 150 : 800;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      let next = startHeight + delta;
      if (next < 120) next = 120;
      if (next > maxHeight) next = maxHeight;
      setDevToolsHeight(next);
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [devToolsHeight]);

  // Drag handle: resize the in-app code editor panel from its left edge.
  const handleCodePanelResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = codePanelWidth;
    const browser = browserRef.current;
    const browserRect = browser?.getBoundingClientRect();
    const maxWidth = browserRect ? browserRect.width - 320 : 1200;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      let next = startWidth + delta;
      if (next < 320) next = 320;
      if (next > maxWidth) next = maxWidth;
      setCodePanelWidth(next);
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [codePanelWidth]);

  const navigate = useCallback((targetUrl: string) => {
    const webview = webviewRef.current;
    if (!webview) return;

    const finalUrl = normalizeUrl(targetUrl);

    webview.src = finalUrl;
    onUrlChange(finalUrl);
  }, [onUrlChange]);

  const handleUrlSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      navigate(inputUrl);
    },
    [inputUrl, navigate]
  );

  const goBack = useCallback(() => {
    webviewRef.current?.goBack();
  }, []);

  const goForward = useCallback(() => {
    webviewRef.current?.goForward();
  }, []);

  const reload = useCallback(() => {
    webviewRef.current?.reloadIgnoringCache();
  }, []);

  const clearCacheAndReload = useCallback(async () => {
    const mainAPI = getMainAPI();
    if (mainAPI) {
      try { await mainAPI.clearWebviewCache(); } catch (err) { console.error('[Browser] Clear cache error:', err); }
    }
    webviewRef.current?.reloadIgnoringCache();
  }, []);

  // Listen for clear cache and reload from menu
  useEffect(() => {
    const onClearCacheReload = (window as unknown as { onClearCacheReload?: (cb: () => void) => void }).onClearCacheReload;
    if (onClearCacheReload) {
      onClearCacheReload(async () => {
        const mainAPI = getMainAPI();
        if (mainAPI) {
          try { await mainAPI.clearWebviewCache(); } catch (err) { console.error('[Browser] Clear cache error:', err); }
        }
        webviewRef.current?.reloadIgnoringCache();
      });
    }
  }, []);

  // Listen for Cmd+R reload webview
  useEffect(() => {
    const onReloadWebview = (window as unknown as { onReloadWebview?: (cb: () => void) => void }).onReloadWebview;
    if (onReloadWebview) {
      onReloadWebview(() => {
        webviewRef.current?.reloadIgnoringCache();
      });
    }
  }, []);

  // Listen for blocked new-window (target="_blank" links)
  useEffect(() => {
    const onBlockedNewWindow = (window as unknown as { onBlockedNewWindow?: (cb: (url: string) => void) => void }).onBlockedNewWindow;
    if (onBlockedNewWindow) {
      onBlockedNewWindow((url: string) => {
        if (blockedUrlTimerRef.current) clearTimeout(blockedUrlTimerRef.current);
        setBlockedUrl(url);
        blockedUrlTimerRef.current = setTimeout(() => setBlockedUrl(null), 8000);
      });
    }
  }, []);

  // Webview zoom — apply CSS zoom inside the webview page
  const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
  const zoomFactorRef = useRef(1.0);

  const applyZoomToWebview = useCallback((factor: number) => {
    zoomFactorRef.current = factor;
    setZoomFactor(factor);
    const webview = webviewRef.current;
    if (webview) {
      webview.executeJavaScript(`document.documentElement.style.zoom = '${factor}'; true;`).catch(() => {});
    }
  }, []);

  const stepZoom = useCallback((direction: string) => {
    const current = zoomFactorRef.current;
    let next: number;
    if (direction === 'reset') {
      next = 1.0;
    } else if (direction === 'in') {
      next = ZOOM_LEVELS.find((z) => z > current + 0.001) ?? current;
    } else {
      next = [...ZOOM_LEVELS].reverse().find((z) => z < current - 0.001) ?? current;
    }
    applyZoomToWebview(next);
  }, [applyZoomToWebview]);

  // Expose zoom handler to parent via ref
  useEffect(() => {
    if (onZoom) onZoom.current = stepZoom;
    return () => { if (onZoom) onZoom.current = null; };
  }, [onZoom, stepZoom]);

  const toggleAnnotate = useCallback(() => {
    // Entering Edit mode closes the in-app project code view so the two
    // toolbar toggles never appear active at the same time.
    if (!annotateMode) {
      setCodeTreeOpen(false);
      setCodeFull(false);
      setCodePanelError(null);
    }
    onAnnotateModeChange(!annotateMode);
  }, [annotateMode, onAnnotateModeChange]);

  const toggleCodeView = useCallback(() => {
    const mainAPI = getMainAPI();
    if (!mainAPI) return;
    clearSelection();
    if (editorPref === 'builtin') {
      // Open the in-app editor with the project file tree (toggle it off if the
      // tree is already showing and nothing is being edited). Project mode is
      // full-window.
      setCodeTreeOpen((open) => {
        if (open && !codePanel) { setCodePanelError(null); setCodeFull(false); return false; }
        // Opening the code view turns off Edit mode so the "Editing" button
        // reverts to "Edit" while "Code" is highlighted.
        if (annotateMode) onAnnotateModeChange(false);
        setCodeFull(true);
        return true;
      });
    } else {
      mainAPI.openInEditor(projectPath, undefined, undefined, projectPath);
    }
  }, [projectPath, clearSelection, editorPref, codePanel, annotateMode, onAnnotateModeChange]);

  const currentWidth = viewport ? viewportSizes[viewport] : null;

  return (
    <div className="browser" ref={browserRef}>
      <Toolbar
        url={inputUrl}
        onUrlChange={setInputUrl}
        onUrlSubmit={handleUrlSubmit}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        isLoading={isLoading}
        annotateMode={annotateMode}
        onBack={goBack}
        onForward={goForward}
        onReload={reload}
        onClearCacheReload={clearCacheAndReload}
        onToggleAnnotate={toggleAnnotate}
        onToggleCodeView={toggleCodeView}
        codeViewActive={codeTreeOpen}
        hasEditor={hasEditor}
        viewport={viewport}
        viewportSizes={viewportSizes}
        onViewportChange={setViewport}
        onViewportSizeChange={setViewportSizes}
        zoomFactor={zoomFactor}
        onZoomReset={() => applyZoomToWebview(1.0)}
        devToolsOpen={devToolsOpen}
        onToggleDevTools={hasMainAPI ? toggleDevTools : undefined}
      />
      <div className="browser-body">
      <div className={`browser-content ${currentWidth ? 'has-viewport' : ''} ${codeFull ? 'is-hidden' : ''}`}>
        {isLoading && <div className="browser-loading-bar" />}
        {!hasFirstPaint && (
          <div className="browser-loading-placeholder">
            <div className="app-loading-spinner browser-loading-spinner" />
          </div>
        )}
        {hasMainAPI ? (
          <div
            className="webview-container"
            style={{
              ...(currentWidth ? { width: currentWidth, maxWidth: '100%' } : {}),
              visibility: hasFirstPaint ? 'visible' : 'hidden',
            }}
          >
            <webview
              ref={webviewRef}
              className="webview"
              // Must be the STRING "true": React drops unknown attributes whose
              // value is boolean true, so allowpopups={true} never reaches the
              // DOM. The cast satisfies @types/react's boolean-typed declaration.
              allowpopups={'true' as unknown as boolean}
            />
          </div>
        ) : (
          <div className="browser-placeholder">
            <div className="browser-placeholder-content">
              <div className="browser-placeholder-icon">🌐</div>
              <h2>Browser Preview</h2>
              <p>Run with Electron to browse websites.</p>
              <code>npm run dev</code>
            </div>
          </div>
        )}
        {blockedUrl && (
          <div className="blocked-url-toast">
            <div className="blocked-url-toast-text">
              This link opens in a new tab
            </div>
            <div className="blocked-url-toast-url">{blockedUrl}</div>
            <div className="blocked-url-toast-actions">
              <button onClick={() => {
                navigator.clipboard.writeText(blockedUrl);
                setBlockedUrl(null);
                if (blockedUrlTimerRef.current) clearTimeout(blockedUrlTimerRef.current);
              }}>Copy URL</button>
              <button onClick={() => {
                const mainAPI = getMainAPI();
                if (mainAPI) mainAPI.openExternal(blockedUrl);
                setBlockedUrl(null);
                if (blockedUrlTimerRef.current) clearTimeout(blockedUrlTimerRef.current);
              }}>Open in Browser</button>
              <button className="blocked-url-toast-close" onClick={() => {
                setBlockedUrl(null);
                if (blockedUrlTimerRef.current) clearTimeout(blockedUrlTimerRef.current);
              }}>&times;</button>
            </div>
          </div>
        )}
      </div>
      {(codePanel || codePanelLoading || codePanelError || codeTreeOpen) && (
        <div
          className={`browser-code-side ${codeFull ? 'is-full' : ''}`}
          style={codeFull ? undefined : { width: codePanelWidth }}
        >
          {!codeFull && (
            <div
              className="browser-code-resize"
              onMouseDown={handleCodePanelResizeMouseDown}
            />
          )}
          <div className="browser-code-inner">
            {codeTreeOpen && (
              <CodeFileTree
                projectPath={projectPath}
                activeRel={codePanel ? codePanel.path.replace(projectPath.replace(/[\\/]+$/, '') + '/', '') : undefined}
                onSelect={(rel) => openInlineEditor(projectPath.replace(/[\\/]+$/, '') + '/' + rel, 1, 'file tree')}
              />
            )}
            <div className="browser-code-main">
              {codePanel ? (
                <CodeEditorPanel
                  key={codePanel.path}
                  filePath={codePanel.path}
                  fileName={codePanel.fileName}
                  initialContent={codePanel.content}
                  gotoLine={codePanel.gotoLine}
                  method={codePanel.method}
                  projectPath={projectPath}
                  candidates={codePanel.candidates}
                  uncertain={codePanel.uncertain}
                  onPickCandidate={(c) => openInlineEditor(c.file, c.line, c.strategy, codePanel.candidates)}
                  treeOpen={codeTreeOpen}
                  onToggleTree={() => setCodeTreeOpen((o) => !o)}
                  full={codeFull}
                  onToggleFull={() => setCodeFull((f) => !f)}
                  nonce={codePanel.nonce}
                  onSave={saveInlineEdit}
                  onClose={closeCodePanel}
                  onDirtyChange={(d) => { codeDirtyRef.current = d; }}
                />
              ) : (
                <div className="code-editor-panel">
                  <div className="code-editor-header">
                    <span className="code-editor-filename">
                      {codePanelLoading ? 'Opening…' : codePanelError ? 'Code' : 'Select a file'}
                    </span>
                    <button
                      type="button"
                      className="code-editor-close"
                      onClick={closeCodePanel}
                      title="Close editor"
                      aria-label="Close editor"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M4 4L12 12M4 12L12 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                  {codePanelLoading ? (
                    <div className="code-editor-status">
                      <div className="app-loading-spinner" />
                    </div>
                  ) : codePanelError ? (
                    <div className="code-editor-status code-editor-empty">
                      <p className="code-editor-empty-text">{codePanelError}</p>
                      <button
                        type="button"
                        className="code-editor-openall"
                        onClick={() => { setCodePanelError(null); toggleCodeView(); }}
                      >
                        Open the entire project
                      </button>
                    </div>
                  ) : (
                    <div className="code-editor-status">Pick a file from the tree to edit it.</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
      {devToolsOpen && hasMainAPI && (
        <div
          className="browser-devtools"
          ref={devToolsPlaceholderRef}
          style={{ height: devToolsHeight }}
        >
          <div
            className="browser-devtools-resize"
            onMouseDown={handleResizeMouseDown}
          />
          <div className="browser-devtools-header">
            <span className="browser-devtools-title">Inspector</span>
            <button
              type="button"
              className="browser-devtools-close"
              onClick={() => setDevToolsOpen(false)}
              title="Close inspector"
              aria-label="Close inspector"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M4 4L12 12M4 12L12 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

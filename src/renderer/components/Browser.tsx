import { useState, useRef, useEffect, useCallback } from 'react';
import Toolbar from './Toolbar';
import type { AnnotationData, MultiEditData } from '../../shared/types';
import { annotationScript } from '../../annotation/injected-script';

// Check if running in Electron (must be called at runtime)
const getMainAPI = () => typeof window !== 'undefined' ? window.mainAPI : undefined;

export interface PendingEdit {
  note: string;
  selector: string;
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

export default function Browser({ sessionId, url, onUrlChange, annotateMode, onAnnotateModeChange, onPendingEditsChange, activeTerminalTabId, projectPath, onAnnotation, cliRunning }: BrowserProps) {
  const [inputUrl, setInputUrl] = useState(url);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [hasMainAPI, setHasMainAPI] = useState(() => !!getMainAPI());
  const [viewport, setViewport] = useState<ViewportType | null>(null);
  const [viewportSizes, setViewportSizes] = useState<ViewportSizes>(DEFAULT_VIEWPORT_SIZES);
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const injectedRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

      // Inject project files for @-mention autocomplete
      const mainAPI = getMainAPI();
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

      setIsReady(true);
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

  // Load initial URL after webview is mounted in DOM
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !hasMainAPI) return;

    // Wait for next frame to ensure webview is fully in DOM
    const frameId = requestAnimationFrame(() => {
      console.log('[Browser] Loading initial URL after mount');
      webview.src = url;
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
      injectAndSetup();
    };

    const handleDomReady = () => {
      injectAndSetup();
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

  const openFileInCodeView = useCallback((filePath: string, line?: number) => {
    const mainAPI = getMainAPI();
    if (!mainAPI) return;
    clearSelection();
    const gotoLine = line && line > 1 ? line : undefined;
    mainAPI.openInEditor(filePath, gotoLine, undefined, projectPath);
  }, [clearSelection, projectPath]);

  // Poll for messages from the injected script
  useEffect(() => {
    if (!isReady) return;

    const webview = webviewRef.current;
    if (!webview) return;

    // Set up message polling via a bridge script
    const setupMessageBridge = async () => {
      try {
        await webview.executeJavaScript(`
          if (!window.__claudeDesignMessageBridge) {
            window.__claudeDesignMessageBridge = true;
            window.__claudeDesignMessages = [];

            window.addEventListener('message', function(e) {
              if (e.data && (e.data.type === 'claude-design-annotation' || e.data.type === 'claude-design-mode-change' || e.data.type === 'claude-design-pending-update' || e.data.type === 'claude-design-open-source')) {
                window.__claudeDesignMessages.push(e.data);
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

    // Poll for messages - use JSON to ensure serializable return value
    const pollInterval = setInterval(async () => {
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
              } else if (msg.type === 'claude-design-open-source') {
                const mainAPI = getMainAPI();
                if (mainAPI) {
                  if (msg.fileName) {
                    // Exact React source — open in embedded VS Code
                    let filePath = msg.fileName as string;
                    if (filePath && !filePath.startsWith('/')) {
                      filePath = projectPath + '/' + filePath;
                    }
                    openFileInCodeView(filePath, msg.lineNumber);
                  } else {
                    // No exact source — search project, then open result in embedded VS Code
                    const result = await mainAPI.searchAndOpenInEditor(projectPath, {
                      componentNames: msg.componentNames || [],
                      id: msg.searchId || null,
                      textContent: msg.searchText || '',
                      dataAttrs: msg.searchDataAttrs || {},
                      pageUrl: msg.pageUrl || '',
                    });
                    if (result) {
                      openFileInCodeView(result.file, result.line);
                    }
                  }
                }
              } else if (msg.type === 'claude-design-mode-change') {
                onAnnotateModeChange(msg.enabled);
              } else if (msg.type === 'claude-design-pending-update') {
                onPendingEditsChange(msg.items || [], { sendAll: sendAllEdits, removeItem: removeEditItem, clearAll: clearAllEdits });
              }
            }
          }
        }
      } catch {
        // Webview might not be ready or navigating
      }
    }, 100);

    return () => clearInterval(pollInterval);
  }, [isReady, onAnnotateModeChange, onPendingEditsChange, sessionId, activeTerminalTabId, sendAllEdits, removeEditItem, clearAllEdits, addToTodoList, projectPath, openFileInCodeView]);

  // Sync CLI running state to webview so it can auto-queue annotations
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !isReady) return;
    webview.executeJavaScript(`window.__claudeDesignCliRunning = ${!!cliRunning}; true;`).catch(() => {});
  }, [cliRunning, isReady]);

  // Toggle annotate mode in webview
  useEffect(() => {
    console.log('[Browser] Toggle effect - isReady:', isReady, 'annotateMode:', annotateMode);
    if (!isReady) return;

    const webview = webviewRef.current;
    if (!webview) return;

    const toggle = async () => {
      try {
        console.log('[Browser] Toggling annotate mode:', annotateMode);
        if (annotateMode) {
          const result = await webview.executeJavaScript('window.__claudeDesignEnable && window.__claudeDesignEnable(); true;');
          console.log('[Browser] Enable result:', result);
          // Focus the webview so ALT+hover works immediately
          webview.focus();
        } else {
          await webview.executeJavaScript('window.__claudeDesignDisable && window.__claudeDesignDisable(); true;');
        }
      } catch (err) {
        console.error('[Browser] Toggle error:', err);
      }
    };

    toggle();
  }, [annotateMode, isReady]);

  // Forward ALT key state to webview when in annotate mode
  // This ensures ALT+hover works even when the webview doesn't have focus
  useEffect(() => {
    if (!annotateMode || !isReady) return;

    const webview = webviewRef.current;
    if (!webview) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        webview.executeJavaScript('window.__claudeDesignSetAltKey && window.__claudeDesignSetAltKey(true); true;').catch(() => {});
        // Also focus the webview so mousemove events fire inside it
        webview.focus();
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


  const navigate = useCallback((targetUrl: string) => {
    const webview = webviewRef.current;
    if (!webview) return;

    let finalUrl = targetUrl;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      // Use http:// for localhost/127.0.0.1, https:// for everything else
      const isLocal = targetUrl.startsWith('localhost') || targetUrl.startsWith('127.0.0.1');
      finalUrl = (isLocal ? 'http://' : 'https://') + targetUrl;
    }

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

  const toggleAnnotate = useCallback(() => {
    onAnnotateModeChange(!annotateMode);
  }, [annotateMode, onAnnotateModeChange]);

  const toggleCodeView = useCallback(() => {
    const mainAPI = getMainAPI();
    if (!mainAPI) return;
    clearSelection();
    mainAPI.openInEditor(projectPath, undefined, undefined, projectPath);
  }, [projectPath, clearSelection]);

  const currentWidth = viewport ? viewportSizes[viewport] : null;

  return (
    <div className="browser">
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
        onToggleAnnotate={toggleAnnotate}
        onToggleCodeView={toggleCodeView}
        viewport={viewport}
        viewportSizes={viewportSizes}
        onViewportChange={setViewport}
        onViewportSizeChange={setViewportSizes}
      />
      <div className={`browser-content ${currentWidth ? 'has-viewport' : ''}`}>
        {isLoading && <div className="browser-loading-bar" />}
        {!isReady && (
          <div className="browser-loading-placeholder">
            <div className="toolbar-spinner browser-loading-spinner" />
            <span className="browser-loading-text">Loading browser...</span>
          </div>
        )}
        {hasMainAPI ? (
          <div
            className="webview-container"
            style={{
              ...(currentWidth ? { width: currentWidth, maxWidth: '100%' } : {}),
              visibility: isReady ? 'visible' : 'hidden',
            }}
          >
            <webview
              ref={webviewRef}
              className="webview"
              allowpopups="true"
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
      </div>
    </div>
  );
}

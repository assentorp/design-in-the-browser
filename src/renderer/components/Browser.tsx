import { useState, useRef, useEffect, useCallback } from 'react';
import Toolbar from './Toolbar';
import type { AnnotationData } from '../../shared/types';
import { annotationScript } from '../../annotation/injected-script';

// Check if running in Electron (must be called at runtime)
const getMainAPI = () => typeof window !== 'undefined' ? window.mainAPI : undefined;

interface BrowserProps {
  annotateMode: boolean;
  onAnnotateModeChange: (enabled: boolean) => void;
}

export default function Browser({ annotateMode, onAnnotateModeChange }: BrowserProps) {
  const [url, setUrl] = useState('http://transloadit.dev:3001');
  const [inputUrl, setInputUrl] = useState('http://transloadit.dev:3001');
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [hasMainAPI, setHasMainAPI] = useState(() => !!getMainAPI());
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const injectedRef = useRef(false);

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
      setIsReady(true);
      console.log('[Browser] Injection complete, isReady = true');
    } catch (err) {
      console.error('[Browser] Injection error:', err);
      // Reset flag so injection can be retried
      injectedRef.current = false;
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
      setUrl(webview.getURL());
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
      }
    };

    webview.addEventListener('did-navigate', handleDidNavigate);
    webview.addEventListener('did-navigate-in-page', handleDidNavigate);
    webview.addEventListener('did-start-loading', handleDidStartLoading);
    webview.addEventListener('did-stop-loading', handleDidStopLoading);
    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('did-fail-load', handleDidFailLoad);

    return () => {
      webview.removeEventListener('did-navigate', handleDidNavigate);
      webview.removeEventListener('did-navigate-in-page', handleDidNavigate);
      webview.removeEventListener('did-start-loading', handleDidStartLoading);
      webview.removeEventListener('did-stop-loading', handleDidStopLoading);
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('did-fail-load', handleDidFailLoad);
    };
  }, [injectAndSetup]);

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
              if (e.data && (e.data.type === 'claude-design-annotation' || e.data.type === 'claude-design-mode-change')) {
                window.__claudeDesignMessages.push(e.data);
              }
            });
          }
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
                const data = msg.data as AnnotationData;

                // Capture screenshot of the element
                if (data.bounds && webview) {
                  try {
                    const image = await webview.capturePage(data.bounds);
                    data.screenshot = image.toDataURL();
                  } catch (err) {
                    console.error('Screenshot capture failed:', err);
                  }
                }

                if (mainAPI) {
                  mainAPI.sendAnnotation(data);
                } else {
                  console.log('Annotation data:', data);
                }
              } else if (msg.type === 'claude-design-mode-change') {
                onAnnotateModeChange(msg.enabled);
              }
            }
          }
        }
      } catch {
        // Webview might not be ready or navigating
      }
    }, 100);

    return () => clearInterval(pollInterval);
  }, [isReady, onAnnotateModeChange]);

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
        } else {
          await webview.executeJavaScript('window.__claudeDesignDisable && window.__claudeDesignDisable(); true;');
        }
      } catch (err) {
        console.error('[Browser] Toggle error:', err);
      }
    };

    toggle();
  }, [annotateMode, isReady]);

  const navigate = useCallback((targetUrl: string) => {
    const webview = webviewRef.current;
    if (!webview) return;

    let finalUrl = targetUrl;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      finalUrl = 'https://' + targetUrl;
    }

    webview.src = finalUrl;
    setUrl(finalUrl);
  }, []);

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
    webviewRef.current?.reload();
  }, []);

  const toggleAnnotate = useCallback(() => {
    onAnnotateModeChange(!annotateMode);
  }, [annotateMode, onAnnotateModeChange]);

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
      />
      <div className="browser-content">
        {hasMainAPI ? (
          <webview
            ref={webviewRef}
            className="webview"
            allowpopups="true"
          />
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

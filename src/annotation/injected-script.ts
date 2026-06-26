// This script is injected into the webview via executeJavaScript
// It handles element selection and annotation UI

export const annotationScript = `
(function() {
  // Prevent multiple injections
  if (window.__claudeDesignAnnotation) return;
  window.__claudeDesignAnnotation = true;

  // State
  let annotateMode = false;
  let todoMode = false; // When true, we're building a list of edits
  let highlightedElement = null;
  let selectedElement = null;
  let popoverElement = null;
  let popoverAnchor = null; // Element or text selection the popover is anchored to
  let popoverScrollHandler = null; // Scroll handler for repositioning
  let codeButtonElement = null;
  let codeButtonAnchor = null; // Element the code button is anchored to
  let toolbarElement = null;

  // Class inspector state (shown on code button hover or ALT+hover)
  let classInspectorElement = null;
  let classInspectorAnchor = null;
  let classInspectorHideTimeout = null;
  let altKeyDown = false;
  let altHoverElement = null;
  let altInspectorSwitchTimeout = null;
  let lastMouseX = 0;
  let lastMouseY = 0;

  // Ruler guide state (G key)
  let gKeyDown = false;
  let rulerLineH = null;
  let rulerLineV = null;

  // Animation freeze state
  let animationsPaused = false;

  // Pixel grid overlay state: 'off' | 'grid' | 'baseline'
  let gridMode = 'off';
  let gridOverlayElement = null;
  // Grid sizes (px), configurable via Settings; defaults match the classic 8/4 toggle
  let gridSpatialSize = 8;
  let gridBaselineSize = 4;

  // Shortcut hints state
  let shortcutHintsElement = null;
  let shortcutHintsTimeout = null;

  // Multi-edit state - stores pending annotations with individual notes
  let pendingAnnotations = []; // Array of {element, note, bounds, selector, tagName, text, attributes}

  // Text selection state
  let selectedText = null;
  let selectedTextRange = null;

  // Area selection state (click-and-drag)
  let areaSelecting = false;
  let areaStartX = 0;
  let areaStartY = 0;
  let areaOverlayElement = null;
  let areaSelectedRect = null;
  let mouseDownTarget = null;

  // Inject styles
  const styleId = 'claude-design-annotation-styles';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = \`
      .claude-design-highlight {
        outline: 3px solid #c6613f !important;
        outline-offset: 2px !important;
        cursor: crosshair !important;
      }
      .claude-design-alt-highlight {
        outline: 3px solid #3b82f6 !important;
        outline-offset: 2px !important;
      }
      .claude-design-selected {
        outline: 3px solid #c6613f !important;
        outline-offset: 2px !important;
      }
      .claude-design-popover {
        position: fixed !important;
        z-index: 2147483647 !important;
        background: transparent !important;
        border: none !important;
        border-radius: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        width: 320px !important;
        color: #e5e5e5 !important;
        cursor: default !important;
        box-sizing: border-box !important;
        float: none !important;
        text-transform: none !important;
        letter-spacing: normal !important;
        line-height: normal !important;
        text-align: left !important;
      }
      .claude-design-popover *,
      .claude-design-popover *::before,
      .claude-design-popover *::after {
        box-sizing: border-box !important;
        cursor: default !important;
        float: none !important;
        text-transform: none !important;
        letter-spacing: normal !important;
        line-height: normal !important;
        text-indent: 0 !important;
        text-decoration: none !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      }
      .claude-design-popover button {
        all: unset !important;
        cursor: pointer !important;
        box-sizing: border-box !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      }
      .claude-design-popover textarea {
        cursor: text !important;
      }
      .claude-design-popover-textarea {
        width: 100% !important;
        min-height: 120px !important;
        max-height: 400px !important;
        background: #303030 !important;
        border: 1px solid #4a4a4a !important;
        border-radius: 24px !important;
        padding: 18px 22px !important;
        color: #e5e5e5 !important;
        font-size: 14px !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        resize: none !important;
        outline: none !important;
        box-sizing: border-box !important;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3) !important;
        overflow-y: auto !important;
        margin: 0 !important;
        text-transform: none !important;
        letter-spacing: normal !important;
        line-height: normal !important;
        -webkit-appearance: none !important;
        appearance: none !important;
      }
      .claude-design-popover-textarea:focus {
        border-color: #5a5a5a !important;
      }
      .claude-design-popover-textarea::placeholder {
        color: #666 !important;
      }
      .claude-design-popover-input-row {
        position: relative !important;
        display: block !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .claude-design-popover-input-row .claude-design-popover-textarea {
        padding-right: 22px !important;
        padding-bottom: 60px !important;
      }
      .claude-design-popover .claude-design-popover-send {
        width: 32px !important;
        height: 32px !important;
        border-radius: 8px !important;
        background: #c6613f !important;
        border: none !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        transition: background 0.15s ease !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      .claude-design-popover .claude-design-popover-send:hover {
        background: #a8522f !important;
      }
      .claude-design-popover .claude-design-popover-send svg {
        width: 16px !important;
        height: 16px !important;
        color: white !important;
        display: block !important;
      }
      .claude-design-popover .claude-design-popover-add {
        width: 32px !important;
        height: 32px !important;
        border-radius: 8px !important;
        background: #c6613f !important;
        border: none !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        transition: background 0.15s ease !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      .claude-design-popover .claude-design-popover-add:hover {
        background: #a8522f !important;
      }
      .claude-design-popover .claude-design-popover-add svg {
        width: 14px !important;
        height: 14px !important;
        color: white !important;
        display: block !important;
      }
      .claude-design-popover .claude-design-popover-add-another {
        height: 32px !important;
        padding: 0 10px !important;
        background: transparent !important;
        border: none !important;
        border-radius: 8px !important;
        color: #888 !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        transition: all 0.15s !important;
        font-size: 13px !important;
        font-weight: 500 !important;
        margin: 0 !important;
      }
      .claude-design-popover .claude-design-popover-add-another:hover {
        color: #fff !important;
        background: rgba(255, 255, 255, 0.1) !important;
      }
      .claude-design-popover .claude-design-popover-add-another svg {
        flex-shrink: 0 !important;
      }
      .claude-design-crosshair *:not(.claude-design-popover):not(.claude-design-popover *):not(.claude-design-code-btn):not(.claude-design-code-btn *):not(.claude-design-class-inspector):not(.claude-design-class-inspector *) {
        cursor: crosshair !important;
      }
      .claude-design-popover-textarea.dragover {
        border-color: #c6613f !important;
        background: rgba(198, 97, 63, 0.1) !important;
      }
      .claude-design-popover .claude-design-popover-image-pill {
        display: none !important;
        align-items: center !important;
        gap: 6px !important;
        height: 32px !important;
        padding: 0 10px !important;
        background: rgba(255, 255, 255, 0.1) !important;
        border: none !important;
        border-radius: 8px !important;
        color: #ccc !important;
        font-size: 12px !important;
        cursor: pointer !important;
        transition: all 0.15s !important;
        margin: 0 !important;
      }
      .claude-design-popover .claude-design-popover-image-pill.active {
        display: flex !important;
      }
      .claude-design-popover .claude-design-popover-image-pill:hover {
        background: rgba(239, 68, 68, 0.2) !important;
        color: #ef4444 !important;
      }
      .claude-design-popover .claude-design-popover-image-pill svg {
        width: 12px !important;
        height: 12px !important;
        display: block !important;
      }
      .claude-design-popover-actions {
        position: absolute !important;
        left: 16px !important;
        right: 16px !important;
        bottom: 18px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
        background: transparent !important;
      }
      .claude-design-popover-actions-left {
        display: flex !important;
        align-items: center !important;
        gap: 4px !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .claude-design-popover-actions-right {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .claude-design-popover .claude-design-popover-image-btn {
        width: 32px !important;
        height: 32px !important;
        border-radius: 8px !important;
        background: transparent !important;
        border: none !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        transition: background 0.15s ease !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      .claude-design-popover .claude-design-popover-image-btn:hover {
        background: rgba(255, 255, 255, 0.1) !important;
      }
      .claude-design-code-btn {
        position: fixed !important;
        z-index: 2147483647 !important;
        width: 28px !important;
        height: 28px !important;
        border-radius: 6px !important;
        background: #c6613f !important;
        border: 1px solid #c6613f !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        transition: all 0.15s ease !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
        padding: 0 !important;
        margin: 0 !important;
        box-sizing: border-box !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      }
      .claude-design-code-btn *  {
        cursor: default !important;
      }
      .claude-design-code-btn:hover {
        background: #a8522f !important;
        border-color: #a8522f !important;
      }
      .claude-design-code-btn svg {
        width: 14px !important;
        height: 14px !important;
        color: #fff !important;
        transition: color 0.15s ease !important;
        display: block !important;
      }
      .claude-design-code-btn:hover svg {
        color: #fff !important;
      }
      .claude-design-code-btn .claude-design-code-spinner {
        width: 14px !important;
        height: 14px !important;
        border: 2px solid rgba(255,255,255,0.3) !important;
        border-top-color: #fff !important;
        border-radius: 50% !important;
        animation: claude-design-spin 0.6s linear infinite !important;
      }
      @keyframes claude-design-spin {
        to { transform: rotate(360deg); }
      }
      .claude-design-popover .claude-design-popover-image-btn svg {
        width: 18px !important;
        height: 18px !important;
        color: #888 !important;
        display: block !important;
      }
      .claude-design-popover-badge {
        position: absolute !important;
        top: -8px !important;
        left: -8px !important;
        background: #c6613f !important;
        color: white !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        width: 24px !important;
        height: 24px !important;
        border-radius: 50% !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        z-index: 1 !important;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
      }
      .claude-design-text-highlight {
        background: rgba(198, 97, 63, 0.3) !important;
        outline: 2px solid #c6613f !important;
        outline-offset: 1px !important;
      }
      .claude-design-selected-text {
        font-size: 13px !important;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace !important;
        color: #e5e5e5 !important;
        background: #252525 !important;
        padding: 8px 10px !important;
        border-radius: 6px !important;
        margin-bottom: 12px !important;
        white-space: pre-wrap !important;
        word-break: break-word !important;
        max-height: 80px !important;
        overflow-y: auto !important;
        border: none !important;
      }
      .claude-design-selected-text::before {
        content: '"' !important;
        color: #666 !important;
      }
      .claude-design-selected-text::after {
        content: '"' !important;
        color: #666 !important;
      }
      .claude-design-multi-selected {
        outline: 3px solid #c6613f !important;
        outline-offset: 2px !important;
        position: relative;
      }
      .claude-design-multi-badge {
        position: absolute;
        top: -10px;
        left: -10px;
        width: 20px;
        height: 20px;
        background: #c6613f;
        color: white;
        font-size: 11px;
        font-weight: 600;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483646;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .claude-design-toolbar {
        position: fixed !important;
        bottom: 24px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        z-index: 2147483647 !important;
        background: #1f1f1f !important;
        border: 1px solid #333 !important;
        border-radius: 12px !important;
        padding: 12px 16px !important;
        display: flex !important;
        align-items: center !important;
        gap: 12px !important;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5) !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        cursor: default !important;
        margin: 0 !important;
        box-sizing: border-box !important;
        text-transform: none !important;
        letter-spacing: normal !important;
        line-height: normal !important;
      }
      .claude-design-toolbar *,
      .claude-design-toolbar *::before,
      .claude-design-toolbar *::after {
        cursor: default !important;
        box-sizing: border-box !important;
        text-transform: none !important;
        letter-spacing: normal !important;
        line-height: normal !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      }
      .claude-design-toolbar button {
        all: unset !important;
        cursor: pointer !important;
        box-sizing: border-box !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      }
      .claude-design-toolbar-count {
        font-size: 13px !important;
        color: #888 !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .claude-design-toolbar-count strong {
        color: #e5e5e5 !important;
        font-weight: bold !important;
      }
      .claude-design-toolbar-hint {
        font-size: 12px !important;
        color: #666 !important;
        padding-left: 12px !important;
        border-left: 1px solid #333 !important;
        margin: 0 !important;
      }
      .claude-design-toolbar .claude-design-toolbar-btn {
        padding: 8px 16px !important;
        border-radius: 8px !important;
        font-size: 13px !important;
        font-weight: 500 !important;
        cursor: pointer !important;
        border: none !important;
        transition: background 0.15s ease !important;
        margin: 0 !important;
      }
      .claude-design-toolbar .claude-design-toolbar-btn-primary {
        background: #c6613f !important;
        color: white !important;
      }
      .claude-design-toolbar .claude-design-toolbar-btn-primary:hover {
        background: #a8522f !important;
      }
      .claude-design-toolbar .claude-design-toolbar-btn-secondary {
        background: transparent !important;
        color: #888 !important;
      }
      .claude-design-toolbar .claude-design-toolbar-btn-secondary:hover {
        background: #333 !important;
        color: #e5e5e5 !important;
      }
      .claude-design-toolbar .claude-design-toolbar-btn-send {
        background: #c6613f !important;
        color: white !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
      }
      .claude-design-toolbar .claude-design-toolbar-btn-send:hover {
        background: #a8522f !important;
      }
      .claude-design-toolbar .claude-design-toolbar-btn-send svg {
        width: 14px !important;
        height: 14px !important;
        display: block !important;
      }
      .claude-design-mention-dropdown {
        position: fixed !important;
        z-index: 2147483647 !important;
        background: #252525 !important;
        border: 1px solid #4a4a4a !important;
        border-radius: 12px !important;
        max-height: 300px !important;
        overflow-y: auto !important;
        width: 320px !important;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4) !important;
        padding: 4px !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        margin: 0 !important;
        box-sizing: border-box !important;
        text-transform: none !important;
        letter-spacing: normal !important;
        line-height: normal !important;
      }
      .claude-design-mention-dropdown::-webkit-scrollbar {
        width: 6px;
      }
      .claude-design-mention-dropdown::-webkit-scrollbar-track {
        background: transparent;
      }
      .claude-design-mention-dropdown::-webkit-scrollbar-thumb {
        background: #444;
        border-radius: 3px;
      }
      .claude-design-mention-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 7px 10px;
        border-radius: 8px;
        cursor: pointer;
        transition: background 0.1s;
      }
      .claude-design-mention-item:hover,
      .claude-design-mention-item.active {
        background: #333;
      }
      .claude-design-mention-icon {
        flex-shrink: 0;
        font-size: 9px;
        font-weight: 700;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        background: rgba(255,255,255,0.06);
      }
      .claude-design-mention-icon.ts { color: #3b82f6; }
      .claude-design-mention-icon.tsx { color: #3b82f6; }
      .claude-design-mention-icon.js { color: #eab308; }
      .claude-design-mention-icon.jsx { color: #eab308; }
      .claude-design-mention-icon.json { color: #eab308; }
      .claude-design-mention-icon.css { color: #ec4899; }
      .claude-design-mention-icon.html { color: #f97316; }
      .claude-design-mention-icon.vue { color: #22c55e; }
      .claude-design-mention-icon.svelte { color: #f97316; }
      .claude-design-mention-icon.md { color: #888; }
      .claude-design-mention-icon.other { color: #888; }
      .claude-design-mention-name {
        font-size: 13px;
        color: #e5e5e5;
        white-space: nowrap;
        font-weight: 500;
        flex-shrink: 0;
      }
      .claude-design-mention-dir {
        font-size: 12px;
        color: #666;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        direction: rtl;
        text-align: right;
        min-width: 0;
        flex: 1;
      }
      .claude-design-mention-empty {
        padding: 12px 10px;
        color: #666;
        font-size: 13px;
        text-align: center;
      }
      .claude-design-mention-breadcrumb {
        position: fixed !important;
        z-index: 2147483647 !important;
        background: #252525 !important;
        border: 1px solid #4a4a4a !important;
        border-radius: 12px !important;
        padding: 8px 12px !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4) !important;
        white-space: nowrap !important;
        pointer-events: none !important;
      }
      .claude-design-mention-breadcrumb-row {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: #777;
        line-height: 22px;
      }
      .claude-design-mention-breadcrumb-row.is-file {
        color: #e5e5e5;
      }
      .claude-design-mention-breadcrumb-indent {
        display: inline-block;
        width: 16px;
        flex-shrink: 0;
      }
      .claude-design-mention-breadcrumb-folder {
        opacity: 0.5;
        font-size: 13px;
      }
      .claude-design-mention-breadcrumb-file {
        font-size: 13px;
      }
      .claude-design-token-swatch {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        border-radius: 4px;
        border: 1px solid rgba(255,255,255,0.15);
      }
      .claude-design-token-value {
        display: none;
      }
      .claude-design-token-applied {
        font-size: 9px;
        font-weight: 600;
        color: #22c55e;
        background: rgba(34,197,94,0.15);
        padding: 1px 5px;
        border-radius: 4px;
        flex-shrink: 0;
        margin-left: 4px;
      }
      .claude-design-token-applied:first-of-type {
        margin-left: auto;
      }
      .claude-design-token-applied.variant-theme {
        color: #c084fc;
        background: rgba(192,132,252,0.15);
      }
      .claude-design-token-applied.variant-breakpoint {
        color: #38bdf8;
        background: rgba(56,189,248,0.15);
      }
      .claude-design-mention-item .claude-design-mention-icon.token-color { color: #c084fc; }
      .claude-design-mention-item .claude-design-mention-icon.token-spacing { color: #38bdf8; }
      .claude-design-mention-item .claude-design-mention-icon.token-typography { color: #fb923c; }
      .claude-design-mention-item .claude-design-mention-icon.token-border { color: #a3e635; }
      .claude-design-mention-item .claude-design-mention-icon.token-effect { color: #e879f9; }
      .claude-design-mention-item .claude-design-mention-icon.token-other { color: #888; }
      .claude-design-class-inspector {
        position: fixed;
        z-index: 2147483647;
        background: #1f1f1f;
        border: 1px solid #333;
        border-radius: 12px;
        padding: 12px 14px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
        max-width: 320px;
        max-height: calc(100vh - 16px);
        overflow-y: auto;
        min-width: 140px;
        cursor: default;
      }
      .claude-design-class-inspector-tag {
        font-size: 13px;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
        color: #c6613f;
        margin-bottom: 6px;
      }
      .claude-design-class-inspector-id {
        font-size: 12px;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
        color: #3b82f6;
        margin-bottom: 8px;
      }
      .claude-design-class-inspector-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .claude-design-class-chip {
        display: inline-flex;
        align-items: center;
        padding: 4px 10px;
        background: #303030;
        border: 1px solid #444;
        border-radius: 6px;
        font-size: 12px;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
        color: #e5e5e5;
        cursor: pointer !important;
        transition: all 0.15s;
      }
      .claude-design-class-chip:hover {
        background: #c6613f;
        border-color: #c6613f;
        color: white;
      }
      .claude-design-class-chip.copied {
        background: #22c55e;
        border-color: #22c55e;
        color: white;
      }
      .claude-design-class-inspector-empty {
        font-size: 12px;
        color: #666;
        font-style: italic;
      }
      .claude-design-class-inspector-hint {
        font-size: 10px;
        color: #555;
        text-align: center;
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid #333;
      }
      .claude-design-copy-all-classes {
        display: block;
        width: 100%;
        margin-top: 8px;
        padding: 6px 10px;
        font-size: 11px;
        font-family: inherit;
        background: #333;
        border: 1px solid #444;
        border-radius: 6px;
        color: #888;
        cursor: pointer !important;
        transition: all 0.15s;
      }
      .claude-design-copy-all-classes:hover {
        background: #444;
        color: #fff;
        border-color: #555;
      }
      .claude-design-copy-all-classes.copied {
        background: #22c55e;
        border-color: #22c55e;
        color: white;
      }
      .claude-design-class-inspector-styles {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid #333;
      }
      .claude-design-class-inspector-style {
        font-size: 11px;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
        color: #999;
        padding: 3px 6px;
        margin: 2px -6px;
        border-radius: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer !important;
        transition: background 0.15s;
      }
      .claude-design-class-inspector-style:hover {
        background: #333;
      }
      .claude-design-class-inspector-style.copied {
        background: #22c55e;
        color: white;
      }
      .claude-design-style-prop {
        color: #9d7cd8;
      }
      .claude-design-style-val {
        color: #7dcfff;
        cursor: pointer !important;
        padding: 2px 4px;
        margin: -2px;
        border-radius: 3px;
        transition: background 0.15s;
      }
      .claude-design-style-val:hover {
        background: rgba(125, 207, 255, 0.2);
      }
      .claude-design-style-val.copied {
        background: #22c55e;
        color: white;
      }
      .claude-design-color-swatch {
        display: inline-block;
        width: 12px;
        height: 12px;
        border-radius: 2px;
        margin-right: 6px;
        vertical-align: middle;
        border: 1px solid rgba(255,255,255,0.2);
        cursor: pointer !important;
      }
      .claude-design-color-swatch:hover {
        border-color: rgba(255,255,255,0.5);
      }
      .claude-design-color-val {
        flex: 1;
      }
      .claude-design-color-row {
        display: flex;
        align-items: center;
      }
      .claude-design-color-toggle {
        margin-left: auto;
        padding: 2px 6px;
        font-size: 9px;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
        text-transform: uppercase;
        background: #333;
        border: 1px solid #444;
        border-radius: 3px;
        color: #888;
        cursor: pointer !important;
        transition: all 0.15s;
      }
      .claude-design-color-toggle:hover {
        background: #444;
        color: #fff;
        border-color: #555;
      }
      .claude-design-shortcut-hints {
        position: fixed;
        bottom: 16px;
        left: 16px;
        z-index: 2147483647;
        background: rgba(31, 31, 31, 0.92);
        border: 1px solid #333;
        border-radius: 10px;
        padding: 10px 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        color: #999;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        white-space: nowrap;
      }
      .claude-design-shortcut-hints.visible {
        opacity: 1;
      }
      .claude-design-shortcut-hints kbd {
        display: inline-block;
        background: #333;
        border: 1px solid #444;
        border-radius: 4px;
        padding: 1px 6px;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
        font-size: 11px;
        color: #e5e5e5;
        margin-right: 4px;
      }
      .claude-design-grid-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: 2147483639;
      }
      .claude-design-grid-overlay.grid-spatial {
        background-image:
          linear-gradient(to right, rgba(128, 128, 128, 0.3) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(128, 128, 128, 0.3) 1px, transparent 1px);
        background-size: 8px 8px;
      }
      .claude-design-grid-overlay.grid-baseline {
        background-image:
          linear-gradient(to bottom, rgba(198, 97, 63, 0.25) 1px, transparent 1px);
        background-size: 100% 4px;
      }
      .claude-design-grid-toast {
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.8);
        color: #fff;
        padding: 8px 16px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px;
        line-height: 1.4;
        z-index: 2147483647;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s ease;
        text-align: center;
      }
      .claude-design-grid-toast.visible {
        opacity: 1;
      }
      .claude-design-grid-toast .grid-toast-title {
        font-weight: 600;
      }
      .claude-design-grid-toast .grid-toast-desc {
        color: rgba(255, 255, 255, 0.6);
        font-size: 12px;
      }

      .claude-design-ruler-h,
      .claude-design-ruler-v {
        position: fixed;
        pointer-events: none;
        z-index: 2147483640;
      }
      .claude-design-ruler-h {
        left: 0;
        width: 100vw;
        height: 0;
        border-top: 1px dashed rgba(198, 97, 63, 0.5);
      }
      .claude-design-ruler-v {
        top: 0;
        height: 100vh;
        width: 0;
        border-left: 1px dashed rgba(198, 97, 63, 0.5);
      }
      .claude-design-area-select {
        position: fixed;
        pointer-events: none;
        z-index: 2147483640;
        border: 2px dashed #c6613f;
        background: rgba(198, 97, 63, 0.08);
        border-radius: 3px;
      }
    \`;
    document.head.appendChild(style);
  }

  // Generate CSS selector
  function generateSelector(el) {
    if (el.id) return '#' + el.id;

    const parts = [];
    let current = el;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        parts.unshift('#' + current.id);
        break;
      }

      if (current.className && typeof current.className === 'string') {
        const classes = current.className
          .split(' ')
          .filter(c => c && !c.startsWith('claude-design-'))
          .slice(0, 3)
          .join('.');
        if (classes) selector += '.' + classes;
      }

      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          child => child.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += ':nth-child(' + index + ')';
        }
      }

      parts.unshift(selector);
      current = current.parentElement;
    }

    return parts.slice(-5).join(' > ');
  }

  // Get parent context
  function getParentContext(el) {
    const parent = el.parentElement;
    if (!parent || parent === document.body) return 'Inside <body>';

    let context = parent.tagName.toLowerCase();
    if (parent.className && typeof parent.className === 'string') {
      const firstClass = parent.className.split(' ')[0];
      if (firstClass) context += '.' + firstClass;
    }
    return 'Inside <' + context + '>';
  }

  // Get computed styles
  function getElementStyles(el) {
    const computed = window.getComputedStyle(el);
    const props = ['background', 'background-color', 'color', 'padding', 'margin',
                   'border-radius', 'font-size', 'font-weight', 'width', 'height',
                   'display', 'flex-direction', 'gap'];
    const styles = {};
    props.forEach(prop => {
      const value = computed.getPropertyValue(prop);
      if (value && value !== 'none' && value !== 'normal' && value !== 'auto') {
        styles[prop] = value;
      }
    });
    return styles;
  }

  // Generate display selector like <button.upgrade-btn>
  function generateDisplaySelector(el) {
    let display = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      const mainClass = el.className
        .split(' ')
        .filter(c => c && !c.startsWith('claude-design-'))
        .slice(0, 1)
        .join('');
      if (mainClass) display += '.' + mainClass;
    }
    return '<' + display + '>';
  }

  // Escape HTML for safe display
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Color format conversion utilities
  function parseColor(val) {
    // Parse rgb/rgba
    var rgbMatch = val.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
    if (rgbMatch) {
      return {
        r: parseInt(rgbMatch[1], 10),
        g: parseInt(rgbMatch[2], 10),
        b: parseInt(rgbMatch[3], 10),
        a: rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1
      };
    }
    // Parse hex
    var hexMatch = val.match(/^#([a-fA-F0-9]{3,8})$/);
    if (hexMatch) {
      var hex = hexMatch[1];
      if (hex.length === 3) {
        return {
          r: parseInt(hex[0] + hex[0], 16),
          g: parseInt(hex[1] + hex[1], 16),
          b: parseInt(hex[2] + hex[2], 16),
          a: 1
        };
      } else if (hex.length === 6) {
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: 1
        };
      } else if (hex.length === 8) {
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: parseInt(hex.slice(6, 8), 16) / 255
        };
      }
    }
    return null;
  }

  function rgbToHex(r, g, b, a) {
    var hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    if (a !== undefined && a < 1) {
      hex += Math.round(a * 255).toString(16).padStart(2, '0');
    }
    return hex;
  }

  function rgbToHsl(r, g, b, a) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;

    if (max === min) {
      h = s = 0;
    } else {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }

    h = Math.round(h * 360);
    s = Math.round(s * 100);
    l = Math.round(l * 100);

    if (a !== undefined && a < 1) {
      return 'hsla(' + h + ', ' + s + '%, ' + l + '%, ' + a.toFixed(2) + ')';
    }
    return 'hsl(' + h + ', ' + s + '%, ' + l + '%)';
  }

  function formatColorAs(color, format) {
    if (!color) return null;
    switch (format) {
      case 'hex':
        return rgbToHex(color.r, color.g, color.b, color.a);
      case 'rgb':
        if (color.a < 1) {
          return 'rgba(' + color.r + ', ' + color.g + ', ' + color.b + ', ' + color.a.toFixed(2) + ')';
        }
        return 'rgb(' + color.r + ', ' + color.g + ', ' + color.b + ')';
      case 'hsl':
        return rgbToHsl(color.r, color.g, color.b, color.a);
      default:
        return null;
    }
  }

  function isColorValue(val) {
    return val && (val.match(/^rgba?\\(/) || val.match(/^#[a-fA-F0-9]{3,8}$/) || val.match(/^hsla?\\(/) || val.match(/^lab\\(/) || val.match(/^lch\\(/) || val.match(/^oklch\\(/) || val.match(/^oklab\\(/));
  }

  // Convert any CSS color to RGB using canvas
  function colorToRgb(colorStr) {
    var canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = colorStr;
    ctx.fillRect(0, 0, 1, 1);
    var data = ctx.getImageData(0, 0, 1, 1).data;
    return {
      r: data[0],
      g: data[1],
      b: data[2],
      a: data[3] / 255
    };
  }

  function getNextColorFormat(current) {
    var formats = ['hex', 'rgb', 'hsl'];
    var idx = formats.indexOf(current);
    return formats[(idx + 1) % formats.length];
  }

  // Expand @filename and >token mentions using the textarea's mention maps
  function expandMentions(text, textarea) {
    var result = text;

    // First expand >token mentions (must be before @ to avoid partial match)
    var tokenMap = textarea && textarea.__tokenMentionMap;
    if (tokenMap) {
      var tokenNames = Object.keys(tokenMap);
      tokenNames.sort(function(a, b) { return b.length - a.length; });
      for (var i = 0; i < tokenNames.length; i++) {
        var tName = tokenNames[i];
        result = result.split('>' + tName).join(tokenMap[tName]);
      }
    }

    // Then expand @file mentions
    var map = textarea && textarea.__mentionMap;
    if (map) {
      var names = Object.keys(map);
      names.sort(function(a, b) { return b.length - a.length; });
      for (var j = 0; j < names.length; j++) {
        var name = names[j];
        result = result.split('@' + name).join(map[name]);
      }
    }
    return result;
  }

  function removeToolbar() {
    if (toolbarElement) {
      toolbarElement.remove();
      toolbarElement = null;
    }
  }

  // Class inspector functions - shown when hovering the code button
  function showClassInspector(el, anchorRect, mouseX, mouseY) {
    // Clear any pending hide
    if (classInspectorHideTimeout) {
      clearTimeout(classInspectorHideTimeout);
      classInspectorHideTimeout = null;
    }

    // If already showing for same element, just reposition
    if (classInspectorElement && classInspectorAnchor === el) {
      return;
    }

    removeClassInspectorImmediate();
    if (!el) return;

    classInspectorAnchor = el;
    classInspectorElement = document.createElement('div');
    classInspectorElement.className = 'claude-design-class-inspector';

    const tagName = el.tagName.toLowerCase();
    const id = el.id;
    const classes = el.className && typeof el.className === 'string'
      ? el.className.split(' ').filter(function(c) { return c && !c.startsWith('claude-design-'); })
      : [];

    // Get computed styles
    const computed = window.getComputedStyle(el);
    const styleProps = [
      'background-color', 'color', 'font-size', 'font-weight', 'line-height',
      'padding', 'margin', 'border-radius', 'width', 'height',
      'display', 'gap', 'border', 'opacity', 'letter-spacing'
    ];
    const styles = [];
    styleProps.forEach(function(prop) {
      const val = computed.getPropertyValue(prop);
      if (val && val !== 'none' && val !== 'normal' && val !== 'auto' &&
          val !== '0px' && val !== 'rgba(0, 0, 0, 0)' && val !== 'rgb(0, 0, 0)' &&
          val !== 'transparent' &&
          // Filter out common defaults
          val !== 'block' && val !== 'inline' &&
          !val.match(/^0px\\s+solid/) && // border: 0px solid ...
          val !== 'rgb(255, 255, 255)' && // white text (often default)
          val !== '400' // normal font-weight
      ) {
        // Shorten property names for display
        var shortProp = prop.replace('background-color', 'bg').replace('border-radius', 'radius');
        styles.push({ prop: shortProp, val: val });
      }
    });

    let html = '<div class="claude-design-class-inspector-tag">&lt;' + tagName + '&gt;</div>';

    if (id) {
      html += '<div class="claude-design-class-inspector-id">#' + escapeHtml(id) + '</div>';
    }

    if (classes.length > 0) {
      html += '<div class="claude-design-class-inspector-chips">';
      classes.forEach(function(cls) {
        html += '<span class="claude-design-class-chip" data-class="' + escapeHtml(cls) + '">' + escapeHtml(cls) + '</span>';
      });
      html += '</div>';
      html += '<button class="claude-design-copy-all-classes" data-all-classes="' + escapeHtml(classes.join(' ')) + '">Copy all classes</button>';
    }

    // Show computed styles
    if (styles.length > 0) {
      html += '<div class="claude-design-class-inspector-styles">';
      styles.forEach(function(s) {
        var isColor = isColorValue(s.val);
        var parsedColor = isColor ? (parseColor(s.val) || colorToRgb(s.val)) : null;
        var hexVal = parsedColor ? rgbToHex(parsedColor.r, parsedColor.g, parsedColor.b, parsedColor.a) : null;

        if (isColor && parsedColor) {
          html += '<div class="claude-design-class-inspector-style claude-design-color-row" data-copy="' + escapeHtml(s.prop) + ': ' + escapeHtml(hexVal) + '">' +
            '<span class="claude-design-style-prop">' + escapeHtml(s.prop) + ':</span> ' +
            '<span class="claude-design-color-swatch" style="background:' + escapeHtml(s.val) + '"></span>' +
            '<span class="claude-design-style-val claude-design-color-val" data-copy="' + escapeHtml(hexVal) + '" data-color-r="' + parsedColor.r + '" data-color-g="' + parsedColor.g + '" data-color-b="' + parsedColor.b + '" data-color-a="' + parsedColor.a + '" data-format="hex">' + escapeHtml(hexVal) + '</span>' +
            '<button class="claude-design-color-toggle" data-color-r="' + parsedColor.r + '" data-color-g="' + parsedColor.g + '" data-color-b="' + parsedColor.b + '" data-color-a="' + parsedColor.a + '" title="Switch format">hex</button>' +
          '</div>';
        } else {
          html += '<div class="claude-design-class-inspector-style" data-copy="' + escapeHtml(s.prop) + ': ' + escapeHtml(s.val) + '">' +
            '<span class="claude-design-style-prop">' + escapeHtml(s.prop) + ':</span> ' +
            '<span class="claude-design-style-val" data-copy="' + escapeHtml(s.val) + '">' + escapeHtml(s.val) + '</span>' +
          '</div>';
        }
      });
      html += '</div>';
    }

    if (classes.length === 0 && styles.length === 0) {
      html += '<div class="claude-design-class-inspector-empty">No classes or styles</div>';
    }

    html += '<div class="claude-design-class-inspector-hint">Click to copy values</div>';

    classInspectorElement.innerHTML = html;

    // Add to DOM first so we can measure actual dimensions
    classInspectorElement.style.top = '0px';
    classInspectorElement.style.left = '0px';
    classInspectorElement.style.visibility = 'hidden';
    document.body.appendChild(classInspectorElement);

    const inspectorRect = classInspectorElement.getBoundingClientRect();
    const inspectorW = inspectorRect.width;
    const inspectorH = inspectorRect.height;
    const pad = 8;

    // Position near cursor if mouse coords provided, otherwise below anchor element
    let top, left;
    if (mouseX != null && mouseY != null) {
      top = mouseY + 16;
      left = mouseX + 12;
    } else {
      top = anchorRect.bottom + 6;
      left = anchorRect.right - Math.min(inspectorW, 200);
    }

    // Adjust if off-screen vertically
    if (top + inspectorH + pad > window.innerHeight) {
      top = (anchorRect ? anchorRect.top : mouseY) - inspectorH - 6;
    }
    // Clamp vertically
    if (top + inspectorH + pad > window.innerHeight) {
      top = window.innerHeight - inspectorH - pad;
    }
    if (top < pad) top = pad;

    // Clamp horizontally
    if (left + inspectorW + pad > window.innerWidth) {
      left = window.innerWidth - inspectorW - pad;
    }
    if (left < pad) left = pad;

    classInspectorElement.style.top = top + 'px';
    classInspectorElement.style.left = left + 'px';
    classInspectorElement.style.visibility = '';

    // Prevent any clicks on the inspector from bubbling up
    classInspectorElement.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();

      // Check for copy all classes button
      const copyAllBtn = e.target.closest ? e.target.closest('.claude-design-copy-all-classes') : null;
      if (copyAllBtn) {
        const allClasses = copyAllBtn.dataset.allClasses;
        if (!allClasses) return;
        copyAndShowFeedback(allClasses, copyAllBtn);
        return;
      }

      // Check for class chip click
      const chip = e.target.closest ? e.target.closest('.claude-design-class-chip') : null;
      if (chip) {
        const cls = chip.dataset.class;
        if (!cls) return;
        copyAndShowFeedback(cls, chip);
        return;
      }

      // Check for color toggle button click - cycle format
      const colorToggle = e.target.closest ? e.target.closest('.claude-design-color-toggle') : null;
      if (colorToggle) {
        var row = colorToggle.closest('.claude-design-color-row');
        var colorValEl = row ? row.querySelector('.claude-design-color-val') : null;
        if (colorValEl) {
          var r = parseInt(colorToggle.dataset.colorR, 10);
          var g = parseInt(colorToggle.dataset.colorG, 10);
          var b = parseInt(colorToggle.dataset.colorB, 10);
          var a = parseFloat(colorToggle.dataset.colorA);
          var currentFormat = colorValEl.dataset.format || 'hex';
          var nextFormat = getNextColorFormat(currentFormat);
          var newVal = formatColorAs({ r: r, g: g, b: b, a: a }, nextFormat);

          colorValEl.dataset.format = nextFormat;
          colorValEl.dataset.copy = newVal;
          colorValEl.textContent = newVal;
          colorToggle.textContent = nextFormat;
          // Update the row's data-copy too
          var propSpan = row.querySelector('.claude-design-style-prop');
          var propName = propSpan ? propSpan.textContent.replace(':', '') : '';
          row.dataset.copy = propName + ': ' + newVal;
        }
        return;
      }

      // Check for color swatch click - copy current color value
      const swatch = e.target.closest ? e.target.closest('.claude-design-color-swatch') : null;
      if (swatch) {
        var siblingVal = swatch.nextElementSibling;
        if (siblingVal && siblingVal.dataset.copy) {
          copyAndShowFeedback(siblingVal.dataset.copy, siblingVal);
        }
        return;
      }

      // Check for color value click - copy the value
      const colorVal = e.target.closest ? e.target.closest('.claude-design-color-val') : null;
      if (colorVal && colorVal.dataset.copy) {
        copyAndShowFeedback(colorVal.dataset.copy, colorVal);
        return;
      }

      // Check for style value click (just the value, non-color)
      const styleVal = e.target.closest ? e.target.closest('.claude-design-style-val') : null;
      if (styleVal && styleVal.dataset.copy) {
        copyAndShowFeedback(styleVal.dataset.copy, styleVal);
        return;
      }

      // Check for full style line click
      const styleLine = e.target.closest ? e.target.closest('.claude-design-class-inspector-style') : null;
      if (styleLine && styleLine.dataset.copy) {
        copyAndShowFeedback(styleLine.dataset.copy, styleLine);
        return;
      }
    }, true);

    function copyAndShowFeedback(text, element) {
      var originalText = element.textContent;
      var textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        element.classList.add('copied');
        element.textContent = 'Copied!';
        setTimeout(function() {
          element.classList.remove('copied');
          element.textContent = originalText;
        }, 1000);
      } catch (err) {
        console.error('[ClaudeDesign] Failed to copy:', err);
      }
      document.body.removeChild(textArea);
    }

    // Also prevent mousedown from bubbling
    classInspectorElement.addEventListener('mousedown', function(e) {
      e.stopPropagation();
    }, true);

    // Cancel hide and element-switch when mouse enters inspector
    classInspectorElement.addEventListener('mouseenter', function() {
      if (classInspectorHideTimeout) {
        clearTimeout(classInspectorHideTimeout);
        classInspectorHideTimeout = null;
      }
      if (altInspectorSwitchTimeout) {
        clearTimeout(altInspectorSwitchTimeout);
        altInspectorSwitchTimeout = null;
      }
    });

    // Hide inspector when mouse leaves it (with delay)
    classInspectorElement.addEventListener('mouseleave', function(e) {
      if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.claude-design-code-btn')) {
        return;
      }
      scheduleHideInspector();
    });
  }

  function scheduleHideInspector() {
    if (classInspectorHideTimeout) {
      clearTimeout(classInspectorHideTimeout);
    }
    classInspectorHideTimeout = setTimeout(function() {
      removeClassInspectorImmediate();
    }, 150);
  }

  function removeClassInspectorImmediate() {
    if (classInspectorHideTimeout) {
      clearTimeout(classInspectorHideTimeout);
      classInspectorHideTimeout = null;
    }
    if (altInspectorSwitchTimeout) {
      clearTimeout(altInspectorSwitchTimeout);
      altInspectorSwitchTimeout = null;
    }
    classInspectorAnchor = null;
    if (classInspectorElement) {
      classInspectorElement.remove();
      classInspectorElement = null;
    }
  }

  function removeClassInspector() {
    scheduleHideInspector();
  }

  // ALT+hover inspection handlers
  function handleAltKeyDown(e) {
    if (e.key === 'Alt' && !altKeyDown) {
      altKeyDown = true;
      if (!annotateMode || popoverElement) return;
      // Immediately inspect the element under the cursor
      var target = document.elementFromPoint(lastMouseX, lastMouseY);
      if (target && target !== document.body && target !== document.documentElement &&
          !(target.closest && target.closest('.claude-design-popover')) &&
          !(target.closest && target.closest('.claude-design-class-inspector')) &&
          !(target.closest && target.closest('.claude-design-code-btn'))) {
        altHoverElement = target;
        altHoverElement.classList.add('claude-design-alt-highlight');
        showClassInspector(target, null, lastMouseX, lastMouseY);
      }
    }
  }

  function handleAltKeyUp(e) {
    if (e.key === 'Alt' && altKeyDown) {
      altKeyDown = false;
      if (altHoverElement) {
        altHoverElement.classList.remove('claude-design-alt-highlight');
      }
      altHoverElement = null;
      removeClassInspectorImmediate();
    }
  }

  function handleMouseMoveForAlt(e) {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    if (!annotateMode || !altKeyDown || popoverElement) return;

    var target = e.target;
    if (target === document.body || target === document.documentElement ||
        (target.closest && target.closest('.claude-design-popover')) ||
        (target.closest && target.closest('.claude-design-class-inspector')) ||
        (target.closest && target.closest('.claude-design-code-btn'))) {
      return;
    }

    if (altHoverElement !== target) {
      // Remove highlight from previous element
      if (altHoverElement) {
        altHoverElement.classList.remove('claude-design-alt-highlight');
      }
      // Add highlight to new element
      altHoverElement = target;
      altHoverElement.classList.add('claude-design-alt-highlight');

      // If inspector is already visible, delay switching so the user
      // has time to move their mouse into it without it jumping away
      if (classInspectorElement) {
        if (altInspectorSwitchTimeout) clearTimeout(altInspectorSwitchTimeout);
        var switchTarget = target;
        var sx = e.clientX, sy = e.clientY;
        altInspectorSwitchTimeout = setTimeout(function() {
          altInspectorSwitchTimeout = null;
          showClassInspector(switchTarget, null, sx, sy);
        }, 300);
      } else {
        showClassInspector(target, null, e.clientX, e.clientY);
      }
    }
  }

  // Find pending annotation for an element
  function findPendingAnnotation(el) {
    return pendingAnnotations.find(function(a) { return a.element === el; });
  }

  // Add or update pending annotation
  function savePendingAnnotation(el, note) {
    const existing = findPendingAnnotation(el);
    const rect = el.getBoundingClientRect();
    const padding = 10;
    const bounds = {
      x: Math.max(0, Math.floor(rect.left - padding)),
      y: Math.max(0, Math.floor(rect.top - padding)),
      width: Math.ceil(rect.width + padding * 2),
      height: Math.ceil(rect.height + padding * 2),
    };

    const textContent = (el.textContent || '').trim().substring(0, 50);
    const attrs = [];
    if (el.id) attrs.push('id="' + el.id + '"');
    if (el.className && typeof el.className === 'string') {
      attrs.push('class="' + el.className.split(' ').slice(0, 3).join(' ') + '"');
    }
    ['data-testid', 'data-component', 'aria-label', 'name', 'href'].forEach(function(attr) {
      const val = el.getAttribute(attr);
      if (val) attrs.push(attr + '="' + val.substring(0, 30) + '"');
    });

    if (existing) {
      existing.note = note;
      existing.bounds = bounds;
    } else {
      pendingAnnotations.push({
        element: el,
        note: note,
        bounds: bounds,
        selector: generateSelector(el),
        tagName: el.tagName.toLowerCase(),
        text: textContent,
        attributes: attrs.join(' '),
      });
      el.classList.add('claude-design-multi-selected');
      updatePendingBadges();
    }
    notifyPendingUpdate();
  }

  function updatePendingBadges() {
    pendingAnnotations.forEach(function(ann, index) {
      const el = ann.element;
      // Remove any existing badge first
      const existingBadge = el.querySelector('.claude-design-multi-badge');
      if (existingBadge) existingBadge.remove();

      const badge = document.createElement('div');
      badge.className = 'claude-design-multi-badge';
      badge.textContent = index + 1;

      // Position badge relative to element
      const computed = window.getComputedStyle(el);
      if (computed.position === 'static') {
        el.style.position = 'relative';
      }
      el.appendChild(badge);
    });
  }

  function clearPendingAnnotations() {
    pendingAnnotations.forEach(function(ann) {
      ann.element.classList.remove('claude-design-multi-selected');
      ann.element.classList.remove('claude-design-selected');
      const badge = ann.element.querySelector('.claude-design-multi-badge');
      if (badge) badge.remove();
    });
    pendingAnnotations = [];
    todoMode = false;
    removeToolbar();
    notifyPendingUpdate();
  }

  // Notify React about pending annotations changes
  function notifyPendingUpdate() {
    const items = pendingAnnotations.map(function(ann) {
      return { note: ann.note, selector: ann.selector, tagName: ann.tagName, text: ann.text, attributes: ann.attributes };
    });
    window.postMessage({
      type: 'claude-design-pending-update',
      items: items
    }, '*');
  }

  function removePendingAnnotation(index) {
    if (index < 0 || index >= pendingAnnotations.length) return;

    const ann = pendingAnnotations[index];
    ann.element.classList.remove('claude-design-multi-selected');
    ann.element.classList.remove('claude-design-selected');
    const badge = ann.element.querySelector('.claude-design-multi-badge');
    if (badge) badge.remove();

    pendingAnnotations.splice(index, 1);
    updatePendingBadges();
    notifyPendingUpdate();

    // Reset todoMode if list is empty
    if (pendingAnnotations.length === 0) {
      todoMode = false;
    }

    // Close the popover
    cancelAnnotation();
  }

  function sendAllAnnotations() {
    if (pendingAnnotations.length === 0) return;

    const data = {
      type: 'multi-edit',
      url: window.location.href,
      annotations: pendingAnnotations.map(function(ann) {
        return {
          selector: ann.selector,
          tagName: ann.tagName,
          text: ann.text,
          attributes: ann.attributes,
          bounds: ann.bounds,
          note: ann.note,
        };
      }),
    };

    console.log('[ClaudeDesign] Sending multi-edit annotations, count:', pendingAnnotations.length);
    if (!window.__claudeDesignSendAnnotation) {
      console.warn('[ClaudeDesign] Send callback not ready, keeping annotations');
      return;
    }
    try {
      window.__claudeDesignSendAnnotation(data);
    } catch (err) {
      console.error('[ClaudeDesign] Failed to send annotations:', err);
      return;
    }
    clearPendingAnnotations();
    todoMode = false;
    cancelAnnotation();
  }

  // Find an exact source location stamped onto the DOM by a build-time plugin.
  // Supports our own convention (data-dib-source="relative/path.tsx:line:col")
  // and the react-dev-inspector convention (data-inspector-* attributes).
  // Walks up a few ancestors since the clicked node may be an untagged child.
  function findDataSource(el) {
    var node = el;
    var depth = 0;
    while (node && node.getAttribute && depth++ < 12) {
      var dib = node.getAttribute('data-dib-source');
      if (dib) {
        var parts = dib.split(':');
        var col = parseInt(parts.pop(), 10);
        var ln = parseInt(parts.pop(), 10);
        var fp = parts.join(':');
        if (fp && !isNaN(ln)) {
          return { fileName: fp, lineNumber: ln, columnNumber: isNaN(col) ? 0 : col };
        }
      }
      var relPath = node.getAttribute('data-inspector-relative-path');
      var relLine = node.getAttribute('data-inspector-line');
      if (relPath && relLine) {
        return {
          fileName: relPath,
          lineNumber: parseInt(relLine, 10),
          columnNumber: parseInt(node.getAttribute('data-inspector-column') || '0', 10),
        };
      }
      node = node.parentElement;
    }
    return null;
  }

  // The element's own (direct) text, ignoring nested children — more specific
  // for grep than the whole subtree's text.
  function getOwnText(el) {
    if (!el || !el.childNodes) return '';
    var t = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) t += n.textContent;
    }
    return t.trim().substring(0, 80);
  }

  // The nearest heading text in or under the element — a distinctive anchor.
  function getHeadingText(el) {
    if (!el) return '';
    if (/^H[1-6]$/.test(el.tagName || '')) return (el.textContent || '').trim().substring(0, 80);
    var h = el.querySelector && el.querySelector('h1,h2,h3,h4,h5,h6');
    return h ? (h.textContent || '').trim().substring(0, 80) : '';
  }

  // Find React source file for an element (via _debugSource)
  function findReactSource(el) {
    if (!el) return null;

    var fiberKey = Object.keys(el).find(function(key) {
      return key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$');
    });
    if (!fiberKey) return null;

    var fiber = el[fiberKey];
    var current = fiber;
    var maxDepth = 20;
    while (current && maxDepth-- > 0) {
      if (current._debugSource) {
        return {
          fileName: current._debugSource.fileName,
          lineNumber: current._debugSource.lineNumber,
          columnNumber: current._debugSource.columnNumber || 0,
        };
      }
      current = current.return;
    }
    return null;
  }

  // Find React component name from fiber tree
  function findReactComponentName(el) {
    if (!el) return null;

    var fiberKey = Object.keys(el).find(function(key) {
      return key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$');
    });
    if (!fiberKey) return null;

    // Skip framework internals and structural wrapper components
    var skipExact = /^(Fragment|Suspense|Consumer|Context|Memo|ForwardRef|Lazy|SegmentViewNode|InnerLayoutRouter|OuterLayoutRouter|RedirectErrorBoundary|RedirectBoundary|HTTPAccessFallbackErrorBoundary|HTTPAccessFallbackBoundary|RenderFromTemplateContext|ScrollAndFocusHandler|InnerScrollAndFocusHandler|ErrorBoundary|ClientPageRoot|ClientSegmentRoot|HotReload|Router|AppRouter|ServerRoot|RSCComponent|Head|NotFoundBoundary|LoadingBoundary|LayoutRouter|RootLayout|MetadataOutlet|PathnameContextProviderAdapter|SegmentStateProvider|ThemeProvider)$/;
    // Skip names ending with Provider, Boundary, Layout, Wrapper, Container, and exact "Providers"
    var skipPattern = /(Provider|Providers|Boundary|Layout|Wrapper|Container|ErrorBound|Guard|Gate)$/;

    var fiber = el[fiberKey];
    var current = fiber;
    var maxDepth = 50;
    var names = [];
    while (current && maxDepth-- > 0) {
      if (current.type && typeof current.type === 'function') {
        var name = current.type.displayName || current.type.name;
        if (name && name.length > 1 && !skipExact.test(name) && !skipPattern.test(name)) {
          names.push(name);
        }
      }
      current = current.return;
    }
    return names; // closest component first, then ancestors
  }

  // @-mention autocomplete
  function getFileIcon(name) {
    var ext = name.split('.').pop().toLowerCase();
    var map = {
      ts: 'TS', tsx: 'TSX', js: 'JS', jsx: 'JSX',
      json: '{}', css: '#', scss: '#',
      html: '<>', vue: '<>', svelte: '<>',
      md: 'MD', yaml: '~', yml: '~',
      py: 'PY', go: 'GO', rs: 'RS',
      env: '.E', toml: '~',
    };
    return { label: map[ext] || '..', cls: map[ext] ? ext : 'other' };
  }

  function getIconClass(name) {
    var ext = name.split('.').pop().toLowerCase();
    if (ext === 'tsx' || ext === 'ts') return 'ts';
    if (ext === 'jsx' || ext === 'js') return 'js';
    if (ext === 'json') return 'json';
    if (ext === 'css' || ext === 'scss') return 'css';
    if (ext === 'html') return 'html';
    if (ext === 'vue') return 'vue';
    if (ext === 'svelte') return 'svelte';
    if (ext === 'md') return 'md';
    return 'other';
  }

  function setupMentionAutocomplete(textarea) {
    // mode: 'file' for @files, 'token' for >tokens
    var mention = { active: false, startIndex: -1, mode: 'file' };
    var dropdown = null;
    var breadcrumb = null;
    var activeIndex = 0;
    var filteredItems = [];

    function getFiles() {
      return window.__claudeDesignProjectFiles || [];
    }

    function getTokens() {
      return window.__claudeDesignTokens || [];
    }

    // Get classes applied to the currently selected element
    // Returns a map: baseClassName -> array of variant prefixes (empty string = direct, 'dark' = dark:, 'md' = md:, etc.)
    function getAppliedClassMap() {
      var el = selectedElement || altHoverElement;
      if (!el || !el.className || typeof el.className !== 'string') return {};
      var classes = el.className.split(' ').filter(function(c) { return c && !c.startsWith('claude-design-'); });
      var map = {};
      for (var i = 0; i < classes.length; i++) {
        var cls = classes[i];
        var lastColon = cls.lastIndexOf(':');
        if (lastColon !== -1) {
          var variant = cls.substring(0, lastColon);
          var base = cls.substring(lastColon + 1);
          if (!map[base]) map[base] = [];
          map[base].push(variant);
        } else {
          if (!map[cls]) map[cls] = [];
          map[cls].push('');
        }
      }
      return map;
    }

    function filterFiles(query) {
      var q = query.toLowerCase();
      var files = getFiles();
      if (!q) return files.slice(0, 50);
      var results = files.filter(function(f) {
        var fullPath = (f.dir === '.' ? f.name : f.dir + '/' + f.name).toLowerCase();
        return fullPath.indexOf(q) !== -1;
      });
      results.sort(function(a, b) {
        var aName = a.name.toLowerCase().indexOf(q) !== -1 ? 0 : 1;
        var bName = b.name.toLowerCase().indexOf(q) !== -1 ? 0 : 1;
        return aName - bName;
      });
      return results.slice(0, 50);
    }

    function filterTokens(query) {
      var q = query.toLowerCase();
      var tokens = getTokens();
      var appliedMap = getAppliedClassMap();

      var results;
      if (!q) {
        // Show applied tokens first, then popular ones
        var appliedTokens = tokens.filter(function(t) { return appliedMap[t.name]; });
        var otherTokens = tokens.filter(function(t) { return !appliedMap[t.name]; });
        results = appliedTokens.concat(otherTokens).slice(0, 50);
      } else {
        results = tokens.filter(function(t) {
          return t.name.toLowerCase().indexOf(q) !== -1 || t.value.toLowerCase().indexOf(q) !== -1;
        });
        // Sort: applied first, then name match quality
        results.sort(function(a, b) {
          var aApplied = appliedMap[a.name] ? 0 : 1;
          var bApplied = appliedMap[b.name] ? 0 : 1;
          if (aApplied !== bApplied) return aApplied - bApplied;
          var aStart = a.name.toLowerCase().indexOf(q) === 0 ? 0 : 1;
          var bStart = b.name.toLowerCase().indexOf(q) === 0 ? 0 : 1;
          return aStart - bStart;
        });
        results = results.slice(0, 50);
      }

      // Tag each result with applied variants
      for (var j = 0; j < results.length; j++) {
        results[j] = Object.assign({}, results[j], { _applied: appliedMap[results[j].name] || false });
      }
      return results;
    }

    function showBreadcrumb(idx) {
      var item = filteredItems[idx];
      if (!item || !item.dir || item.dir === '.' || mention.mode === 'token') {
        hideBreadcrumb();
        return;
      }
      if (!breadcrumb) {
        breadcrumb = document.createElement('div');
        breadcrumb.className = 'claude-design-mention-breadcrumb';
        document.body.appendChild(breadcrumb);
      }
      var parts = item.dir.split('/');
      var icon = getFileIcon(item.name);
      var cls = getIconClass(item.name);
      var html = '';
      for (var i = 0; i < parts.length; i++) {
        html += '<div class="claude-design-mention-breadcrumb-row">';
        for (var j = 0; j < i; j++) html += '<span class="claude-design-mention-breadcrumb-indent"></span>';
        html += '<span class="claude-design-mention-breadcrumb-folder">\uD83D\uDCC1</span> ';
        html += escapeHtml(parts[i]);
        html += '</div>';
      }
      html += '<div class="claude-design-mention-breadcrumb-row is-file">';
      for (var j = 0; j < parts.length; j++) html += '<span class="claude-design-mention-breadcrumb-indent"></span>';
      html += '<span class="claude-design-mention-icon ' + cls + '" style="width:16px;height:16px;font-size:7px;border-radius:3px;">' + icon.label + '</span> ';
      html += escapeHtml(item.name);
      html += '</div>';
      breadcrumb.innerHTML = html;

      // Position to the right of the dropdown
      if (dropdown) {
        var dr = dropdown.getBoundingClientRect();
        var bw = breadcrumb.offsetWidth || 200;
        var bh = breadcrumb.offsetHeight || 100;
        var left = dr.right + 6;
        if (left + bw > window.innerWidth - 6) left = dr.left - bw - 6;
        breadcrumb.style.left = left + 'px';

        // Align vertically with the active item
        var activeEl = dropdown.querySelectorAll('.claude-design-mention-item')[idx];
        if (activeEl) {
          var ar = activeEl.getBoundingClientRect();
          var top = ar.top;
          if (top + bh > window.innerHeight - 6) top = window.innerHeight - 6 - bh;
          if (top < 6) top = 6;
          breadcrumb.style.top = top + 'px';
        } else {
          breadcrumb.style.top = dr.top + 'px';
        }
        breadcrumb.style.bottom = 'auto';
      }
    }

    function hideBreadcrumb() {
      if (breadcrumb) {
        breadcrumb.remove();
        breadcrumb = null;
      }
    }

    function removeDropdown() {
      if (dropdown) {
        dropdown.remove();
        dropdown = null;
      }
      hideBreadcrumb();
      mention.active = false;
      mention.mode = 'file';
      activeIndex = 0;
      filteredItems = [];
    }

    function positionDropdown() {
      if (!dropdown || !textarea) return;
      var rect = textarea.getBoundingClientRect();
      var dropHeight = dropdown.offsetHeight || 200;
      var spaceAbove = rect.top - 6;
      var spaceBelow = window.innerHeight - rect.bottom - 6;
      var width = Math.min(rect.width, window.innerWidth - 12);
      var left = rect.left;

      if (left + width > window.innerWidth - 6) left = window.innerWidth - 6 - width;
      if (left < 6) left = 6;

      dropdown.style.width = width + 'px';
      dropdown.style.left = left + 'px';
      dropdown.style.maxHeight = Math.max(120, Math.min(300, spaceAbove > spaceBelow ? spaceAbove : spaceBelow)) + 'px';

      if (spaceAbove >= dropHeight || spaceAbove >= spaceBelow) {
        dropdown.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
        dropdown.style.top = 'auto';
      } else {
        dropdown.style.top = (rect.bottom + 6) + 'px';
        dropdown.style.bottom = 'auto';
      }
    }

    function getTokenCategoryIcon(category) {
      if (category === 'color') return { label: 'CLR', cls: 'token-color' };
      if (category === 'spacing') return { label: 'SPC', cls: 'token-spacing' };
      if (category === 'typography') return { label: 'TYP', cls: 'token-typography' };
      if (category === 'border') return { label: 'BDR', cls: 'token-border' };
      if (category === 'effect') return { label: 'FX', cls: 'token-effect' };
      return { label: 'TOK', cls: 'token-other' };
    }

    function isColorValue(value) {
      return /^#|^rgb|^hsl|^oklch/.test(value) && value !== 'transparent';
    }

    function renderFileDropdown(query) {
      filteredItems = filterFiles(query);
      activeIndex = 0;

      var isNew = !dropdown;
      if (isNew) {
        dropdown = document.createElement('div');
        dropdown.className = 'claude-design-mention-dropdown';
        document.body.appendChild(dropdown);
      }

      if (filteredItems.length === 0) {
        dropdown.innerHTML = '<div class="claude-design-mention-empty">No files found</div>';
        positionDropdown();
        return;
      }

      var html = '';
      for (var i = 0; i < filteredItems.length; i++) {
        var f = filteredItems[i];
        var icon = getFileIcon(f.name);
        var cls = getIconClass(f.name);
        var dir = f.dir === '.' ? '' : f.dir;
        var fullPath = dir ? dir + '/' + f.name : f.name;
        html += '<div class="claude-design-mention-item' + (i === 0 ? ' active' : '') + '" data-mention-index="' + i + '" title="' + escapeHtml(fullPath) + '">' +
          '<span class="claude-design-mention-icon ' + cls + '">' + icon.label + '</span>' +
          '<span class="claude-design-mention-name">' + escapeHtml(f.name) + '</span>' +
          (dir ? '<span class="claude-design-mention-dir">' + escapeHtml(dir) + '</span>' : '') +
        '</div>';
      }
      dropdown.innerHTML = html;
      positionDropdown();

      if (isNew) {
        attachDropdownHandlers();
      }
    }

    function renderTokenDropdown(query) {
      filteredItems = filterTokens(query);
      activeIndex = 0;

      var isNew = !dropdown;
      if (isNew) {
        dropdown = document.createElement('div');
        dropdown.className = 'claude-design-mention-dropdown';
        document.body.appendChild(dropdown);
      }

      if (filteredItems.length === 0) {
        dropdown.innerHTML = '<div class="claude-design-mention-empty">No tokens found</div>';
        positionDropdown();
        return;
      }

      var html = '';
      for (var i = 0; i < filteredItems.length; i++) {
        var t = filteredItems[i];
        var catIcon = getTokenCategoryIcon(t.category);
        var showSwatch = t.category === 'color' && isColorValue(t.value);
        html += '<div class="claude-design-mention-item' + (i === 0 ? ' active' : '') + '" data-mention-index="' + i + '" title="' + escapeHtml(t.name + ': ' + t.value) + '">';
        if (showSwatch) {
          html += '<span class="claude-design-token-swatch" style="background:' + escapeHtml(t.value) + '"></span>';
        } else {
          html += '<span class="claude-design-mention-icon ' + catIcon.cls + '">' + catIcon.label + '</span>';
        }
        html += '<span class="claude-design-mention-name">' + escapeHtml(t.name) + '</span>';
        if (t._applied && Array.isArray(t._applied)) {
          for (var vi = 0; vi < t._applied.length; vi++) {
            var v = t._applied[vi];
            if (v === '') continue;
            if (v === 'dark') {
              html += '<span class="claude-design-token-applied variant-theme">dark mode</span>';
            } else if (v === 'light') {
              html += '<span class="claude-design-token-applied variant-theme">light mode</span>';
            } else {
              html += '<span class="claude-design-token-applied variant-breakpoint">' + escapeHtml(v) + '</span>';
            }
          }
          html += '<span class="claude-design-token-applied">applied</span>';
        }
        html += '<span class="claude-design-token-value">' + escapeHtml(t.value) + '</span>';
        html += '</div>';
      }
      dropdown.innerHTML = html;
      positionDropdown();

      if (isNew) {
        attachDropdownHandlers();
      }
    }

    function attachDropdownHandlers() {
      dropdown.addEventListener('mouseover', function(e) {
        var item = e.target.closest ? e.target.closest('.claude-design-mention-item') : null;
        if (!item) return;
        var idx = parseInt(item.dataset.mentionIndex, 10);
        if (isNaN(idx)) return;
        setActive(idx);
      });

      dropdown.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var item = e.target.closest ? e.target.closest('.claude-design-mention-item') : null;
        if (!item) return;
        var idx = parseInt(item.dataset.mentionIndex, 10);
        if (!isNaN(idx)) selectItem(idx);
      });
    }

    function renderDropdown(query) {
      if (mention.mode === 'token') {
        renderTokenDropdown(query);
      } else {
        renderFileDropdown(query);
      }
    }

    function setActive(idx) {
      if (idx < 0 || idx >= filteredItems.length) return;
      activeIndex = idx;
      if (!dropdown) return;
      var items = dropdown.querySelectorAll('.claude-design-mention-item');
      for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle('active', i === idx);
      }
      if (items[idx]) {
        items[idx].scrollIntoView({ block: 'nearest' });
      }
      showBreadcrumb(idx);
    }

    function selectItem(idx) {
      if (idx < 0 || idx >= filteredItems.length) return;
      var item = filteredItems[idx];

      if (mention.mode === 'token') {
        // Token: store in tokenMentionMap, replace >query with tokenName
        if (!textarea.__tokenMentionMap) textarea.__tokenMentionMap = {};
        var displayName = item.name;
        var resolvedValue = item.name + ' (' + item.value + ', ' + item.source + ')';
        textarea.__tokenMentionMap[displayName] = resolvedValue;

        var value = textarea.value;
        var triggerStart = mention.startIndex - 1; // include the > character
        var after = value.substring(textarea.selectionStart);
        textarea.value = value.substring(0, triggerStart) + displayName + after;

        var newPos = triggerStart + displayName.length;
        textarea.selectionStart = newPos;
        textarea.selectionEnd = newPos;
      } else {
        // File: store in mentionMap, display as @filename
        if (!textarea.__mentionMap) textarea.__mentionMap = {};
        var f = item;
        var fullPath = f.dir === '.' ? f.name : f.dir + '/' + f.name;
        textarea.__mentionMap[f.name] = fullPath;

        var value = textarea.value;
        var after = value.substring(textarea.selectionStart);
        textarea.value = value.substring(0, mention.startIndex) + f.name + after;

        var newPos = mention.startIndex + f.name.length;
        textarea.selectionStart = newPos;
        textarea.selectionEnd = newPos;
      }

      removeDropdown();
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    textarea.addEventListener('input', function() {
      var value = textarea.value;
      var cursorPos = textarea.selectionStart;

      if (mention.active) {
        if (cursorPos < mention.startIndex) {
          removeDropdown();
          return;
        }

        // Verify the trigger is still there
        if (mention.mode === 'token') {
          // For >, check that > precedes startIndex
          if (mention.startIndex < 1 || value[mention.startIndex - 1] !== '>') {
            removeDropdown();
            return;
          }
        } else {
          if (value[mention.startIndex - 1] !== '@') {
            removeDropdown();
            return;
          }
        }

        var query = value.substring(mention.startIndex, cursorPos);
        if (query.indexOf(' ') !== -1 || query.indexOf('\\n') !== -1) {
          removeDropdown();
          return;
        }
        renderDropdown(query);
        return;
      }

      // Check if cursor is right after a > (token mode) or @ (file mode)
      if (cursorPos > 0 && value[cursorPos - 1] === '>') {
        // > (token mode) — only trigger if > is at start or preceded by whitespace
        if (cursorPos === 1 || /\\s/.test(value[cursorPos - 2])) {
          mention.active = true;
          mention.mode = 'token';
          mention.startIndex = cursorPos; // after the >
          renderDropdown('');
          return;
        }
      }

      if (cursorPos > 0 && value[cursorPos - 1] === '@') {
        // Single @ (file mode)
        if (cursorPos === 1 || /\\s/.test(value[cursorPos - 2])) {
          mention.active = true;
          mention.mode = 'file';
          mention.startIndex = cursorPos; // after the @
          renderDropdown('');
        }
      }
    });

    textarea.addEventListener('keydown', function(e) {
      if (!mention.active || !dropdown) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopImmediatePropagation();
        var next = activeIndex + 1;
        if (next >= filteredItems.length) next = 0;
        setActive(next);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopImmediatePropagation();
        var prev = activeIndex - 1;
        if (prev < 0) prev = filteredItems.length - 1;
        setActive(prev);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredItems.length > 0) {
          e.preventDefault();
          e.stopImmediatePropagation();
          selectItem(activeIndex);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        removeDropdown();
        return;
      }
    });

    // Clean up when textarea is removed
    var observer = new MutationObserver(function() {
      if (!document.contains(textarea)) {
        removeDropdown();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return { removeDropdown: removeDropdown };
  }

  // Reference image state
  let referenceImageData = null;

  // Position popover relative to anchor element or text selection
  function positionPopover() {
    if (!popoverElement || !popoverAnchor) return;

    const rect = popoverAnchor.rect
      ? popoverAnchor.rect  // Text selection with stored rect
      : (popoverAnchor.element ? popoverAnchor.element.getBoundingClientRect() : null);

    if (!rect) return;

    const popHeight = popoverElement.offsetHeight || 150;
    let top = rect.bottom + 10;
    let left = rect.left;

    if (top + popHeight > window.innerHeight) {
      // Try above the element
      top = rect.top - popHeight - 10;
    }
    if (top < 10) {
      // No room above either — anchor to bottom of viewport, overlapping element
      top = window.innerHeight - popHeight - 10;
    }

    if (left + 320 > window.innerWidth) left = window.innerWidth - 330;
    if (left < 10) left = 10;

    popoverElement.style.top = top + 'px';
    popoverElement.style.left = left + 'px';
  }

  // Position code button inside the element's top-right corner
  function positionCodeButton() {
    if (!codeButtonElement || !codeButtonAnchor) return;

    const rect = codeButtonAnchor.getBoundingClientRect();

    // Hide if element is out of viewport
    const isVisible = rect.top < window.innerHeight && rect.bottom > 0 &&
                      rect.left < window.innerWidth && rect.right > 0;

    if (!isVisible) {
      codeButtonElement.style.display = 'none';
      return;
    }

    codeButtonElement.style.display = 'flex';

    // Position at top-right inside the element
    let top = rect.top + 6;
    let left = rect.right - 28 - 6;

    // Clamp to viewport
    if (left > window.innerWidth - 38) {
      left = window.innerWidth - 38;
    }
    if (left < 6) {
      left = 6;
    }
    if (top < 6) {
      top = 6;
    }
    if (top > window.innerHeight - 34) {
      top = window.innerHeight - 34;
    }

    codeButtonElement.style.top = top + 'px';
    codeButtonElement.style.left = left + 'px';
  }

  // Create popover for element selection
  function createPopover(el, textSelection) {
    removePopover();
    removeToolbar();
    referenceImageData = null;

    const rect = textSelection ? textSelection.rect : el.getBoundingClientRect();
    const displaySelector = el ? generateDisplaySelector(el) : null;

    // Store anchor for scroll repositioning
    popoverAnchor = textSelection ? { rect: textSelection.rect } : { element: el };

    popoverElement = document.createElement('div');
    popoverElement.className = 'claude-design-popover';

    // Initial rough position — will be corrected by positionPopover() after DOM insert
    let left = rect.left;
    if (left + 320 > window.innerWidth) left = window.innerWidth - 330;
    if (left < 10) left = 10;
    popoverElement.style.top = (rect.bottom + 10) + 'px';
    popoverElement.style.left = left + 'px';

    // Add scroll listener to reposition popover and code button
    popoverScrollHandler = function() {
      positionPopover();
      positionCodeButton();
    };
    window.addEventListener('scroll', popoverScrollHandler, true);

    // Build header based on selection type
    let headerHTML = '';
    const isAreaSelection = textSelection && textSelection.isAreaSelection;
    if (isAreaSelection) {
      // No header — the dashed outline shows the selection
    } else if (textSelection) {
      const truncatedText = textSelection.text.length > 60
        ? textSelection.text.substring(0, 60) + '...'
        : textSelection.text;
      headerHTML = '<div class="claude-design-selected-text">' + escapeHtml(truncatedText) + '</div>';
    } else if (el && pendingAnnotations.length > 0) {
      // Show badge number when there are pending annotations
      const existingIndex = pendingAnnotations.findIndex(function(a) { return a.element === el; });
      const badgeNum = existingIndex !== -1 ? existingIndex + 1 : pendingAnnotations.length + 1;
      headerHTML = '<span class="claude-design-popover-badge">' + badgeNum + '</span>';
    }

    const placeholder = isAreaSelection ? 'Describe this area...' : (textSelection ? 'Fix typo...' : 'What do you want to change?');

    // Check for React source (used by floating code button)
    const reactSource = el ? findReactSource(el) : null;

    // Check if element already has a pending note
    const existingAnnotation = el ? findPendingAnnotation(el) : null;
    const existingNote = existingAnnotation ? existingAnnotation.note : '';

    // In todo mode or with pending items: show plus button. Otherwise show send button.
    const inListMode = todoMode || pendingAnnotations.length > 0;

    const actionButton = inListMode
      ? '<button class="claude-design-popover-add" data-action="save" title="Add to list (↵)">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M5 12h14"/><path d="M12 5v14"/>' +
          '</svg>' +
        '</button>'
      : '<button class="claude-design-popover-send" data-action="send" title="Send (⌘↵)">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>' +
          '</svg>' +
        '</button>';

    // Add another edit button - small circle with dotted border, only show when not in list mode yet
    const addAnotherButton = !inListMode
      ? '<button class="claude-design-popover-add-another" data-action="enter-list-mode" title="Add to list (⌘⇧↵)">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M16 5H3"/><path d="M16 12H3"/><path d="M9 19H3"/>' +
            '<path d="m16 16-3 3 3 3"/><path d="M21 5v12a2 2 0 0 1-2 2h-6"/>' +
          '</svg>' +
          'Add' +
        '</button>'
      : '';

    // List is now shown in React panel, not in popover
    let listHTML = '';

    let inputAreaHTML =
        '<input type="file" class="claude-design-popover-file" accept="image/*" style="display: none;" />' +
        '<div class="claude-design-popover-input-row">' +
          headerHTML +
          '<textarea class="claude-design-popover-textarea" placeholder="' + placeholder + '"></textarea>' +
          '<div class="claude-design-popover-actions">' +
            '<div class="claude-design-popover-actions-left">' +
              '<button class="claude-design-popover-image-btn" data-action="browse" title="Add image (⌘I)">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                  '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>' +
                  '<circle cx="9" cy="9" r="2"/>' +
                  '<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>' +
                '</svg>' +
              '</button>' +
              '<button class="claude-design-popover-image-pill" data-action="remove-image" title="Remove image">' +
                'Image' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                  '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>' +
                '</svg>' +
              '</button>' +
            '</div>' +
            '<div class="claude-design-popover-actions-right">' +
              addAnotherButton +
              actionButton +
            '</div>' +
          '</div>' +
        '</div>';

    popoverElement.innerHTML = inputAreaHTML + listHTML;

    document.body.appendChild(popoverElement);

    // Reposition now that we know the actual height
    positionPopover();

    // Floating code button at the top-right of the selected element. Clicking it
    // resolves the element's source and asks the renderer to open the in-app
    // code editor (NOT an external editor).
    if (el && !textSelection) {
      removeCodeButton();
      codeButtonAnchor = el;
      codeButtonElement = document.createElement('button');
      codeButtonElement.className = 'claude-design-code-btn';
      codeButtonElement.title = reactSource
        ? 'Edit code (' + (reactSource.fileName || '').split('/').pop() + ':' + (reactSource.lineNumber || '') + ')'
        : 'Edit code';
      codeButtonElement.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>' +
        '</svg>';
      // Position using the helper function (handles scroll and viewport clamping)
      positionCodeButton();
      codeButtonElement.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        // Hide inspector on click
        removeClassInspector();
        // Show spinner while the renderer resolves + loads the file
        codeButtonElement.innerHTML = '<div class="claude-design-code-spinner"></div>';
        var dataSource = findDataSource(el);
        if (dataSource) {
          // Exact: a build-time plugin stamped the source location onto the DOM.
          window.postMessage({
            type: 'claude-design-edit-code',
            fileName: dataSource.fileName,
            lineNumber: dataSource.lineNumber,
            columnNumber: dataSource.columnNumber,
            sourceMethod: 'data-source',
          }, '*');
        } else if (reactSource) {
          // Exact: React 18 _debugSource (absent on React 19 / server components).
          window.postMessage({
            type: 'claude-design-edit-code',
            fileName: reactSource.fileName,
            lineNumber: reactSource.lineNumber,
            columnNumber: reactSource.columnNumber,
            sourceMethod: 'React source',
          }, '*');
        } else {
          // Heuristic: send every signal we can scrape so the main process can
          // rank candidate files (component name, own text, heading, attrs, URL).
          var componentNames = findReactComponentName(el) || [];
          var elTextContent = (el.textContent || '').trim().substring(0, 80);
          var dataAttrs = {};
          if (el.attributes) {
            for (var dai = 0; dai < el.attributes.length; dai++) {
              var dattr = el.attributes[dai];
              if (dattr.name.startsWith('data-') || dattr.name === 'aria-label' || dattr.name === 'role') {
                dataAttrs[dattr.name] = dattr.value;
              }
            }
          }
          window.postMessage({
            type: 'claude-design-edit-code',
            componentNames: componentNames,
            searchText: elTextContent,
            ownText: getOwnText(el),
            headingText: getHeadingText(el),
            tagName: (el.tagName || '').toLowerCase(),
            searchDataAttrs: dataAttrs,
            searchId: el.id || null,
            pageUrl: window.location.pathname,
          }, '*');
        }
        // The editor opens in the app's side panel — dismiss the in-page popover
        // and this button (the panel shows its own loading state).
        cancelAnnotation();
      });

      document.body.appendChild(codeButtonElement);
    }

    const textarea = popoverElement.querySelector('textarea');
    const fileInput = popoverElement.querySelector('.claude-design-popover-file');
    const imageBtn = popoverElement.querySelector('.claude-design-popover-image-btn');
    const imagePill = popoverElement.querySelector('.claude-design-popover-image-pill');

    if (textarea && existingNote) {
      textarea.value = existingNote;
    }
    setTimeout(() => textarea && textarea.focus(), 50);

    // Auto-expand textarea as user types
    function autoResize() {
      if (!textarea) return;
      textarea.style.height = 'auto';
      var scrollH = textarea.scrollHeight;
      var minH = 120;
      var maxH = 400;
      textarea.style.height = Math.min(maxH, Math.max(minH, scrollH)) + 'px';
    }
    if (textarea) {
      textarea.addEventListener('input', autoResize);
      setupMentionAutocomplete(textarea);

      // Cycle placeholder hints when textarea is empty
      if (!existingNote && !textSelection) {
        var hints = ['What do you want to change?', 'Type @ to mention a file', 'Type > to insert a design token'];
        var hintIndex = 0;
        var hintInterval = setInterval(function() {
          if (!document.contains(textarea)) { clearInterval(hintInterval); return; }
          if (textarea.value.length > 0) return;
          hintIndex = (hintIndex + 1) % hints.length;
          textarea.placeholder = hints[hintIndex];
        }, 3000);
      }
    }

    function handleFile(file) {
      if (!file || !file.type.startsWith('image/')) return;

      const reader = new FileReader();
      reader.onload = function(e) {
        referenceImageData = e.target.result;
        imageBtn.style.display = 'none';
        imagePill.classList.add('active');
      };
      reader.readAsDataURL(file);
    }

    function removeImage() {
      referenceImageData = null;
      fileInput.value = '';
      imageBtn.style.display = 'flex';
      imagePill.classList.remove('active');
    }

    fileInput.addEventListener('change', function(e) {
      if (e.target.files && e.target.files[0]) {
        handleFile(e.target.files[0]);
      }
    });

    // Drag and drop on textarea
    textarea.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.stopPropagation();
      textarea.classList.add('dragover');
    });

    textarea.addEventListener('dragleave', function(e) {
      e.preventDefault();
      e.stopPropagation();
      textarea.classList.remove('dragover');
    });

    textarea.addEventListener('drop', function(e) {
      e.preventDefault();
      e.stopPropagation();
      textarea.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFile(e.dataTransfer.files[0]);
      }
    });

    popoverElement.addEventListener('click', function(e) {
      const target = e.target.closest ? e.target.closest('[data-action]') : null;
      const action = e.target.dataset && e.target.dataset.action ? e.target.dataset.action : (target && target.dataset.action);
      if (action === 'save') saveCurrentAnnotation();
      if (action === 'send') sendAnnotation();
      if (action === 'send-all') sendAllAnnotations();
      if (action === 'enter-list-mode') {
        todoMode = true;
        // Save current note if there's text, then close popover to select another element
        var ta = popoverElement && popoverElement.querySelector('textarea');
        var currentNote = ta && expandMentions(ta.value.trim(), ta);
        if (currentNote && selectedElement) {
          savePendingAnnotation(selectedElement, currentNote);
        }
        // Close popover so user can select another element
        cancelAnnotation();
      }
      if (action === 'browse') fileInput.click();
      if (action === 'remove-image') {
        removeImage();
      }
      if (action === 'remove-item') {
        var idx = target && target.dataset.index ? parseInt(target.dataset.index, 10) : -1;
        if (idx >= 0) removePendingAnnotation(idx);
      }
    });

    textarea && textarea.addEventListener('keydown', function(e) {
      // Cmd/Ctrl+Enter: Always send immediately (sends all if in list mode)
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (todoMode || pendingAnnotations.length > 0) {
          // Save current note first if there's text, then send all
          var currentNote = expandMentions(textarea.value.trim(), textarea);
          if (currentNote && selectedElement) {
            savePendingAnnotation(selectedElement, currentNote);
          }
          sendAllAnnotations();
        } else {
          sendAnnotation();
        }
        return;
      }
      // Shift+Enter: Insert newline
      if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        // Allow default textarea behavior (inserts newline)
        return;
      }
      // Cmd/Ctrl+Shift+Enter: Add to list (enter list mode and save)
      if (e.key === 'Enter' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        var note = expandMentions(textarea.value.trim(), textarea);
        if (!note) {
          textarea.focus();
          return;
        }
        if (!todoMode && pendingAnnotations.length === 0) {
          todoMode = true;
        }
        if (selectedElement) {
          savePendingAnnotation(selectedElement, note);
        }
        cancelAnnotation();
        return;
      }
      // Enter: Send if not in list mode, add to list if in list mode
      if (e.key === 'Enter') {
        e.preventDefault();
        // Reset stale todoMode if there are no pending annotations
        if (todoMode && pendingAnnotations.length === 0) {
          todoMode = false;
        }
        if (todoMode || pendingAnnotations.length > 0) {
          saveCurrentAnnotation();
        } else {
          sendAnnotation();
        }
      }
      // Cmd/Ctrl+I: Open image picker
      if (e.key === 'i' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        var fileInput = popoverElement && popoverElement.querySelector('.claude-design-popover-file');
        if (fileInput) fileInput.click();
        return;
      }
      if (e.key === 'Escape') cancelAnnotation();
    });
  }

  function removeCodeButton() {
    codeButtonAnchor = null;
    removeClassInspectorImmediate();
    if (codeButtonElement) {
      codeButtonElement.remove();
      codeButtonElement = null;
    }
  }

  function removePopover() {
    if (popoverScrollHandler) {
      window.removeEventListener('scroll', popoverScrollHandler, true);
      popoverScrollHandler = null;
    }
    popoverAnchor = null;
    if (popoverElement) {
      popoverElement.remove();
      popoverElement = null;
    }
    removeCodeButton();
  }

  function cancelAnnotation() {
    removePopover();
    referenceImageData = null;

    // Clear area selection
    removeAreaSelection();

    // Clear element selection highlight (but keep pending annotations)
    if (selectedElement) {
      // Only remove selected class if not in pending annotations
      if (!findPendingAnnotation(selectedElement)) {
        selectedElement.classList.remove('claude-design-selected');
      }
      selectedElement = null;
    }

    // Clear text selection
    selectedText = null;
    selectedTextRange = null;
    const selection = window.getSelection();
    if (selection) selection.removeAllRanges();
  }

  // Save annotation locally (for multi-edit mode)
  function saveCurrentAnnotation() {
    if (!popoverElement) return;

    const textarea = popoverElement.querySelector('textarea');
    const note = textarea && expandMentions(textarea.value.trim(), textarea);

    if (!note) {
      textarea && textarea.focus();
      return;
    }

    // Handle area selection - sends immediately
    if (areaSelectedRect) {
      sendAnnotation();
      return;
    }

    // Handle text selection - still sends immediately
    if (selectedText && selectedTextRange) {
      sendAnnotation();
      return;
    }

    // For element selection - save locally and close popover to select another element
    if (selectedElement) {
      savePendingAnnotation(selectedElement, note);
      cancelAnnotation();
    }
  }

  function sendAnnotation() {
    if (!popoverElement) return;

    const textarea = popoverElement.querySelector('textarea');
    const request = textarea && expandMentions(textarea.value.trim(), textarea);

    if (!request) {
      textarea && textarea.focus();
      return;
    }

    // Handle area selection annotation
    if (areaSelectedRect) {
      const r = areaSelectedRect;
      const padding = 10;
      const bounds = {
        x: Math.max(0, Math.floor(r.x - padding)),
        y: Math.max(0, Math.floor(r.y - padding)),
        width: Math.ceil(r.width + padding * 2),
        height: Math.ceil(r.height + padding * 2),
      };

      // Find the nearest matching element for context
      const areaEl = findAreaElement(r);
      let tagName = 'area-selection';
      let text = '';
      let selector = '';
      let attributes = '';

      if (areaEl) {
        tagName = areaEl.tagName.toLowerCase();
        text = (areaEl.textContent || '').trim().substring(0, 50);
        selector = generateSelector(areaEl);
        const attrs = [];
        if (areaEl.id) attrs.push('id="' + areaEl.id + '"');
        if (areaEl.className && typeof areaEl.className === 'string') attrs.push('class="' + areaEl.className.split(' ').slice(0, 3).join(' ') + '"');
        ['data-testid', 'data-component', 'aria-label', 'name', 'href'].forEach(function(attr) {
          const val = areaEl.getAttribute(attr);
          if (val) attrs.push(attr + '="' + val.substring(0, 30) + '"');
        });
        attributes = attrs.join(' ');
      }

      const data = {
        url: window.location.href,
        element: {
          tagName: tagName,
          text: text,
          attributes: attributes,
          selector: selector,
        },
        bounds: bounds,
        referenceImage: referenceImageData,
        request: request,
      };

      window.__claudeDesignSendAnnotation(data);
      cancelAnnotation();
      return;
    }

    // Handle text selection annotation
    if (selectedText && selectedTextRange) {
      const range = selectedTextRange;
      const rect = range.getBoundingClientRect();
      const padding = 10;
      const bounds = {
        x: Math.max(0, Math.floor(rect.left - padding)),
        y: Math.max(0, Math.floor(rect.top - padding)),
        width: Math.ceil(rect.width + padding * 2),
        height: Math.ceil(rect.height + padding * 2),
      };

      // Find the containing element for context
      const container = range.commonAncestorContainer;
      const contextEl = container.nodeType === 3 ? container.parentElement : container;

      const data = {
        url: window.location.href,
        element: {
          tagName: 'text-selection',
          text: selectedText,
          attributes: '',
          selector: contextEl ? generateSelector(contextEl) : '',
        },
        selectedText: selectedText,
        bounds: bounds,
        referenceImage: referenceImageData,
        request: request,
      };

      console.log('[ClaudeDesign] Sending text annotation:', selectedText.substring(0, 30));
      window.__claudeDesignSendAnnotation(data);
      cancelAnnotation();
      return;
    }

    // Handle single element annotation (only used for text selection fallback now)
    if (!selectedElement) return;

    // Get searchable text content
    const textContent = (selectedElement.textContent || '').trim().substring(0, 50);

    // Get useful attributes for grepping
    const attrs = [];
    if (selectedElement.id) attrs.push('id="' + selectedElement.id + '"');
    if (selectedElement.className && typeof selectedElement.className === 'string') attrs.push('class="' + selectedElement.className.split(' ').slice(0, 3).join(' ') + '"');
    ['data-testid', 'data-component', 'aria-label', 'name', 'href'].forEach(function(attr) {
      const val = selectedElement.getAttribute(attr);
      if (val) attrs.push(attr + '="' + val.substring(0, 30) + '"');
    });

    // Get bounding rect for screenshot
    const rect = selectedElement.getBoundingClientRect();
    const padding = 10;
    const bounds = {
      x: Math.max(0, Math.floor(rect.left - padding)),
      y: Math.max(0, Math.floor(rect.top - padding)),
      width: Math.ceil(rect.width + padding * 2),
      height: Math.ceil(rect.height + padding * 2),
    };

    const data = {
      url: window.location.href,
      element: {
        tagName: selectedElement.tagName.toLowerCase(),
        text: textContent,
        attributes: attrs.join(' '),
        selector: generateSelector(selectedElement),
      },
      bounds: bounds,
      referenceImage: referenceImageData,
      request: request,
    };

    console.log('[ClaudeDesign] Sending annotation, has referenceImage:', !!referenceImageData);

    // Post message to parent
    window.__claudeDesignSendAnnotation(data);

    cancelAnnotation();
  }

  function handleMouseOver(e) {
    if (!annotateMode || selectedElement || gKeyDown || areaSelecting) return;

    const target = e.target;
    if (target === document.body || target === document.documentElement ||
        (target.closest && target.closest('.claude-design-popover')) ||
        (target.closest && target.closest('.claude-design-toolbar')) ||
        (target.closest && target.closest('.claude-design-code-btn')) ||
        (target.closest && target.closest('.claude-design-class-inspector'))) return;

    if (highlightedElement && highlightedElement !== target) {
      highlightedElement.classList.remove('claude-design-highlight');
      removeClassInspector();
    }

    target.classList.add('claude-design-highlight');
    highlightedElement = target;
  }

  function handleMouseOut(e) {
    if (!annotateMode || selectedElement) return;

    if (e.target === highlightedElement) {
      e.target.classList.remove('claude-design-highlight');
      highlightedElement = null;
    }
  }

  // Handle text selection (mouseup)

  function handleClick(e) {
    if (areaSelecting) return;
    if (!annotateMode) return;
    if (e.target.closest && e.target.closest('.claude-design-popover')) return;
    if (e.target.closest && e.target.closest('.claude-design-toolbar')) return;
    if (e.target.closest && e.target.closest('.claude-design-code-btn')) return;
    if (e.target.closest && e.target.closest('.claude-design-class-inspector')) return;

    e.preventDefault();
    e.stopPropagation();

    // If popover is open, clicking outside cancels it
    if (selectedElement && popoverElement) {
      cancelAnnotation();
      return;
    }

    // Clear highlight
    if (highlightedElement) {
      highlightedElement.classList.remove('claude-design-highlight');
      highlightedElement = null;
    }

    // Clear previous selected element highlight (if not in pending)
    if (selectedElement && !findPendingAnnotation(selectedElement)) {
      selectedElement.classList.remove('claude-design-selected');
    }

    // Set new selected element and show popover
    selectedElement = e.target;
    selectedElement.classList.add('claude-design-selected');

    createPopover(e.target, null);
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      if (selectedElement) {
        cancelAnnotation();
      }
    }
    // Cmd+E / Ctrl+E handled by persistent listener (see below)
  }

  // Ruler crosshair guides (G key)
  function showRulerGuides() {
    if (!rulerLineH) {
      rulerLineH = document.createElement('div');
      rulerLineH.className = 'claude-design-ruler-h';
      document.body.appendChild(rulerLineH);
    }
    if (!rulerLineV) {
      rulerLineV = document.createElement('div');
      rulerLineV.className = 'claude-design-ruler-v';
      document.body.appendChild(rulerLineV);
    }
    rulerLineH.style.top = lastMouseY + 'px';
    rulerLineV.style.left = lastMouseX + 'px';
  }

  function removeRulerGuides() {
    if (rulerLineH) { rulerLineH.remove(); rulerLineH = null; }
    if (rulerLineV) { rulerLineV.remove(); rulerLineV = null; }
  }

  function handleGKeyDown(e) {
    var tag = document.activeElement && document.activeElement.tagName;
    if ((e.key === 'g' || e.key === 'G') && !gKeyDown && !e.metaKey && !e.ctrlKey && !e.altKey && tag !== 'TEXTAREA' && tag !== 'INPUT') {
      gKeyDown = true;
      if (highlightedElement) {
        highlightedElement.classList.remove('claude-design-highlight');
        highlightedElement = null;
      }
      showRulerGuides();
    }
  }

  function handleGKeyUp(e) {
    if ((e.key === 'g' || e.key === 'G') && gKeyDown) {
      gKeyDown = false;
      removeRulerGuides();
    }
  }

  function handleMouseMoveForRuler(e) {
    if (!gKeyDown) return;
    if (rulerLineH) rulerLineH.style.top = e.clientY + 'px';
    if (rulerLineV) rulerLineV.style.left = e.clientX + 'px';
  }

  function toggleAnimationFreeze() {
    animationsPaused = !animationsPaused;
    var els = document.querySelectorAll('*');
    if (animationsPaused) {
      els.forEach(function(el) {
        el.style.animationPlayState = 'paused';
        el.style.transitionDuration = '0s';
      });
    } else {
      els.forEach(function(el) {
        el.style.animationPlayState = '';
        el.style.transitionDuration = '';
      });
    }
  }

  function handleFKey(e) {
    var tag = document.activeElement && document.activeElement.tagName;
    if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey && tag !== 'TEXTAREA' && tag !== 'INPUT') {
      e.preventDefault();
      toggleAnimationFreeze();
    }
  }

  var gridToastTimer = null;
  function showGridToast(title, desc) {
    var toast = document.querySelector('.claude-design-grid-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'claude-design-grid-toast';
      document.body.appendChild(toast);
    }
    toast.innerHTML = '<span class="grid-toast-title">' + title + '</span>' + (desc ? '<br><span class="grid-toast-desc">' + desc + '</span>' : '');
    toast.classList.add('visible');
    if (gridToastTimer) clearTimeout(gridToastTimer);
    gridToastTimer = setTimeout(function() {
      toast.classList.remove('visible');
    }, 1500);
  }

  function cycleGridOverlay() {
    // Cycle: off → grid → baseline → off
    if (gridMode === 'off') {
      gridMode = 'grid';
      showGridToast(gridSpatialSize + 'px Spatial Grid', 'Check spacing and alignment consistency');
    } else if (gridMode === 'grid') {
      gridMode = 'baseline';
      showGridToast(gridBaselineSize + 'px Baseline Grid', 'Check vertical rhythm and typography alignment');
    } else {
      gridMode = 'off';
      showGridToast('Grid Off', '');
    }
    applyGridOverlay();
  }

  function applyGridOverlay() {
    if (gridMode === 'off') {
      if (gridOverlayElement) {
        gridOverlayElement.remove();
        gridOverlayElement = null;
      }
      return;
    }
    if (!gridOverlayElement) {
      gridOverlayElement = document.createElement('div');
      gridOverlayElement.className = 'claude-design-grid-overlay';
      document.body.appendChild(gridOverlayElement);
    }
    gridOverlayElement.classList.remove('grid-spatial', 'grid-baseline');
    gridOverlayElement.classList.add(gridMode === 'grid' ? 'grid-spatial' : 'grid-baseline');
    // Override the class default with the configured size
    if (gridMode === 'grid') {
      gridOverlayElement.style.backgroundSize = gridSpatialSize + 'px ' + gridSpatialSize + 'px';
    } else {
      gridOverlayElement.style.backgroundSize = '100% ' + gridBaselineSize + 'px';
    }
  }

  function setGridSizes(spatial, baseline) {
    if (typeof spatial === 'number' && spatial > 0) gridSpatialSize = spatial;
    if (typeof baseline === 'number' && baseline > 0) gridBaselineSize = baseline;
    // Re-apply live so an open grid updates immediately
    if (gridMode !== 'off') applyGridOverlay();
  }

  function removeGridOverlay() {
    gridMode = 'off';
    if (gridOverlayElement) {
      gridOverlayElement.remove();
      gridOverlayElement = null;
    }
  }

  function handleShiftGKey(e) {
    var tag = document.activeElement && document.activeElement.tagName;
    if ((e.key === 'G') && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && tag !== 'TEXTAREA' && tag !== 'INPUT') {
      e.preventDefault();
      cycleGridOverlay();
    }
  }

  function showShortcutHints() {
    removeShortcutHints();
    shortcutHintsElement = document.createElement('div');
    shortcutHintsElement.className = 'claude-design-shortcut-hints';
    shortcutHintsElement.innerHTML = '<span><kbd>Drag</kbd> Select area</span><span><kbd>Alt</kbd> Inspect element</span><span><kbd>G</kbd> Ruler guides</span><span><kbd>Shift+G</kbd> Grid overlay</span><span><kbd>F</kbd> Freeze animations</span>';
    document.body.appendChild(shortcutHintsElement);
    // Trigger fade-in on next frame
    requestAnimationFrame(function() {
      if (shortcutHintsElement) shortcutHintsElement.classList.add('visible');
    });
    // Auto-dismiss after 5s
    shortcutHintsTimeout = setTimeout(function() {
      if (shortcutHintsElement) shortcutHintsElement.classList.remove('visible');
      setTimeout(removeShortcutHints, 300);
    }, 5000);
  }

  function removeShortcutHints() {
    if (shortcutHintsTimeout) {
      clearTimeout(shortcutHintsTimeout);
      shortcutHintsTimeout = null;
    }
    if (shortcutHintsElement) {
      shortcutHintsElement.remove();
      shortcutHintsElement = null;
    }
  }

  // Area selection handlers (click-and-drag)
  function handleAreaMouseDown(e) {
    if (!annotateMode || altKeyDown || gKeyDown) return;
    if (e.button !== 0) return;
    if (e.target.closest && (
      e.target.closest('.claude-design-popover') ||
      e.target.closest('.claude-design-toolbar') ||
      e.target.closest('.claude-design-code-btn') ||
      e.target.closest('.claude-design-class-inspector') ||
      e.target.closest('.claude-design-shortcut-hints')
    )) return;

    mouseDownTarget = e.target;
    areaStartX = e.clientX;
    areaStartY = e.clientY;
    areaSelecting = false;
    e.preventDefault();
  }

  function handleAreaMouseMove(e) {
    if (!annotateMode || mouseDownTarget === null) return;

    var dx = e.clientX - areaStartX;
    var dy = e.clientY - areaStartY;
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 8 && !areaSelecting) return;

    if (!areaSelecting) {
      areaSelecting = true;
      // Remove element highlight while dragging
      if (highlightedElement) {
        highlightedElement.classList.remove('claude-design-highlight');
        highlightedElement = null;
      }
    }

    var x = Math.min(areaStartX, e.clientX);
    var y = Math.min(areaStartY, e.clientY);
    var w = Math.abs(e.clientX - areaStartX);
    var h = Math.abs(e.clientY - areaStartY);

    if (!areaOverlayElement) {
      areaOverlayElement = document.createElement('div');
      areaOverlayElement.className = 'claude-design-area-select';
      document.body.appendChild(areaOverlayElement);
    }

    areaOverlayElement.style.left = x + 'px';
    areaOverlayElement.style.top = y + 'px';
    areaOverlayElement.style.width = w + 'px';
    areaOverlayElement.style.height = h + 'px';
  }

  function handleAreaMouseUp(e) {
    if (!annotateMode || mouseDownTarget === null) return;
    mouseDownTarget = null;

    if (!areaSelecting) return;

    var x = Math.min(areaStartX, e.clientX);
    var y = Math.min(areaStartY, e.clientY);
    var w = Math.abs(e.clientX - areaStartX);
    var h = Math.abs(e.clientY - areaStartY);

    // Minimum size check
    if (w < 20 || h < 20) {
      areaSelecting = false;
      return;
    }

    areaSelectedRect = { x: x, y: y, width: w, height: h };

    e.preventDefault();
    e.stopPropagation();

    createPopover(null, { rect: { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h }, isAreaSelection: true });

    // Reset areaSelecting after a tick so the click handler can check it
    setTimeout(function() { areaSelecting = false; }, 0);
  }

  // Find the best DOM element matching a selected area
  function findAreaElement(rect) {
    var cx = rect.x + rect.width / 2;
    var cy = rect.y + rect.height / 2;
    var el = document.elementFromPoint(cx, cy);
    if (!el || el === document.body || el === document.documentElement) return null;

    // Walk up to find the element whose bounds best contain the selection
    var best = el;
    var bestScore = Infinity;
    var cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      var r = cur.getBoundingClientRect();
      // Score: how much bigger is the element than the selection (prefer smallest containing element)
      var overlapX = Math.max(0, Math.min(r.right, rect.x + rect.width) - Math.max(r.left, rect.x));
      var overlapY = Math.max(0, Math.min(r.bottom, rect.y + rect.height) - Math.max(r.top, rect.y));
      var overlap = overlapX * overlapY;
      var selArea = rect.width * rect.height;
      // Element must contain at least 50% of the selection
      if (overlap >= selArea * 0.5) {
        var elArea = r.width * r.height;
        var score = elArea - selArea;
        if (score >= 0 && score < bestScore) {
          bestScore = score;
          best = cur;
        }
      }
      cur = cur.parentElement;
    }
    return best;
  }

  function removeAreaSelection() {
    areaSelecting = false;
    areaSelectedRect = null;
    mouseDownTarget = null;
    if (areaOverlayElement) {
      areaOverlayElement.remove();
      areaOverlayElement = null;
    }
  }

  function enableAnnotateMode() {
    if (annotateMode) return;
    annotateMode = true;
    document.body.classList.add('claude-design-crosshair');

    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keydown', handleAltKeyDown, true);
    document.addEventListener('keyup', handleAltKeyUp, true);
    document.addEventListener('mousemove', handleMouseMoveForAlt, true);
    document.addEventListener('keydown', handleGKeyDown, true);
    document.addEventListener('keyup', handleGKeyUp, true);
    document.addEventListener('mousemove', handleMouseMoveForRuler, true);
    document.addEventListener('keydown', handleFKey, true);
    document.addEventListener('keydown', handleShiftGKey, true);
    document.addEventListener('mousedown', handleAreaMouseDown, true);
    document.addEventListener('mousemove', handleAreaMouseMove, true);
    document.addEventListener('mouseup', handleAreaMouseUp, true);

    // Restore visual highlights for any surviving pending annotations
    if (pendingAnnotations.length > 0) {
      todoMode = true;
      pendingAnnotations.forEach(function(ann) {
        if (ann.element && ann.element.isConnected) {
          ann.element.classList.add('claude-design-multi-selected');
        }
      });
      updatePendingBadges();
    }

    showShortcutHints();
  }

  function disableAnnotateMode() {
    if (!annotateMode) return;
    annotateMode = false;
    todoMode = false;
    document.body.classList.remove('claude-design-crosshair');

    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('mouseout', handleMouseOut, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('keydown', handleAltKeyDown, true);
    document.removeEventListener('keyup', handleAltKeyUp, true);
    document.removeEventListener('mousemove', handleMouseMoveForAlt, true);
    document.removeEventListener('keydown', handleGKeyDown, true);
    document.removeEventListener('keyup', handleGKeyUp, true);
    document.removeEventListener('mousemove', handleMouseMoveForRuler, true);
    document.removeEventListener('keydown', handleFKey, true);
    document.removeEventListener('keydown', handleShiftGKey, true);
    document.removeEventListener('mousedown', handleAreaMouseDown, true);
    document.removeEventListener('mousemove', handleAreaMouseMove, true);
    document.removeEventListener('mouseup', handleAreaMouseUp, true);
    removeAreaSelection();
    removeRulerGuides();
    removeGridOverlay();
    removeShortcutHints();
    // Unfreeze animations when leaving annotate mode
    if (animationsPaused) {
      toggleAnimationFreeze();
    }
    gKeyDown = false;
    if (altHoverElement) {
      altHoverElement.classList.remove('claude-design-alt-highlight');
    }
    altKeyDown = false;
    altHoverElement = null;

    if (highlightedElement) {
      highlightedElement.classList.remove('claude-design-highlight');
      highlightedElement = null;
    }

    // Clear class inspector
    removeClassInspectorImmediate();

    // Keep pending annotations in the queue — only clear visual highlights
    pendingAnnotations.forEach(function(ann) {
      ann.element.classList.remove('claude-design-multi-selected');
      ann.element.classList.remove('claude-design-selected');
      var badge = ann.element.querySelector('.claude-design-multi-badge');
      if (badge) badge.remove();
    });
    removeToolbar();

    cancelAnnotation();
  }

  // Add annotation to todo list programmatically (used when CLI is busy)
  function addToTodoList(note, selector, tagName, text, attributes) {
    // Skip if an identical item already exists (prevents duplicates during re-injection)
    var isDupe = pendingAnnotations.some(function(a) {
      return a.note === note && a.selector === selector;
    });
    if (isDupe) return;

    // Find element by selector if possible, or create a placeholder
    var el = null;
    try {
      el = document.querySelector(selector);
    } catch (e) {}

    if (!el) {
      // Create a placeholder for the annotation
      el = document.createElement('div');
      el.style.display = 'none';
      document.body.appendChild(el);
    }

    var rect = el.getBoundingClientRect();
    var bounds = {
      x: Math.max(0, Math.floor(rect.left - 10)),
      y: Math.max(0, Math.floor(rect.top - 10)),
      width: Math.ceil(rect.width + 20),
      height: Math.ceil(rect.height + 20),
    };

    pendingAnnotations.push({
      element: el,
      note: note,
      bounds: bounds,
      selector: selector,
      tagName: tagName || 'div',
      text: text || '',
      attributes: attributes || '',
    });

    if (el.style.display !== 'none') {
      el.classList.add('claude-design-multi-selected');
    }
    updatePendingBadges();
    notifyPendingUpdate();

    // Enter todo mode
    todoMode = true;
  }

  // Set ALT key state from parent window (for when webview doesn't have focus)
  function setAltKeyState(down) {
    if (down && !altKeyDown) {
      altKeyDown = true;
    } else if (!down && altKeyDown) {
      altKeyDown = false;
      if (altHoverElement) {
        altHoverElement.classList.remove('claude-design-alt-highlight');
      }
      altHoverElement = null;
      removeClassInspectorImmediate();
    }
  }

  // Persistent Cmd+E / Ctrl+E listener (not removed when annotate mode is disabled)
  document.addEventListener('keydown', function(e) {
    if ((e.key === 'e' || e.key === 'E') && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (annotateMode) {
        disableAnnotateMode();
        window.__claudeDesignNotifyModeChange(false);
      } else {
        enableAnnotateMode();
        window.__claudeDesignNotifyModeChange(true);
      }
    }
    // Cmd+L / Ctrl+L: toggle terminal
    if ((e.key === 'l' || e.key === 'L') && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      window.postMessage({ type: 'claude-design-toggle-terminal' }, '*');
    }
  }, true);

  // Release DOM references on page unload to prevent memory leaks
  window.addEventListener('beforeunload', function() {
    pendingAnnotations.forEach(function(ann) { ann.element = null; });
    pendingAnnotations = [];
  });

  // Expose functions for external control
  window.__claudeDesignEnable = enableAnnotateMode;
  window.__claudeDesignDisable = disableAnnotateMode;
  window.__claudeDesignIsEnabled = function() { return annotateMode; };
  window.__claudeDesignSendAll = sendAllAnnotations;
  window.__claudeDesignRemoveItem = removePendingAnnotation;
  window.__claudeDesignClearAll = clearPendingAnnotations;
  window.__claudeDesignCancelAnnotation = cancelAnnotation;
  window.__claudeDesignAddToTodo = addToTodoList;
  window.__claudeDesignNotifyPending = notifyPendingUpdate;
  window.__claudeDesignSetAltKey = setAltKeyState;
  window.__claudeDesignToggleFreeze = toggleAnimationFreeze;
  window.__claudeDesignSetGridSizes = setGridSizes;
})();
`;

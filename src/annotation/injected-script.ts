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

  // Direct manipulation state (attached to the Edit-mode element selection)
  let manipSelected = null;          // element the popover + size readout follow
  let manipOverlay = null;           // {label} — the size readout under the element
  let manipPanel = null;             // design section embedded in the popover
  let manipDrag = null;              // active drag: {kind: 'move'|'scrub', ...}
  let manipSuppressClick = false;    // swallow the click that ends a drag
  let manipChanges = new Map();      // element -> {baseline: {}, inline: {}, current: {}}
  let manipRepositionQueued = false;
  let manipFlyoutOpen = false;       // design flyout open state within one selection
  let manipPanelPersistent = false;  // Settings: keep the panel open across selections
  let manipHoverField = null;        // field under the cursor: arrow keys nudge it
  let manipUndoStack = [];           // each entry is a batch: [{el, prop, value, token}]
  let manipRedoStack = [];
  let manipUndoBatch = null;         // open batch, so one gesture undoes as one step
  let manipUndoLastEl = null;        // coalescing state for single changes
  let manipUndoLastKey = null;
  let manipUndoLastTime = 0;
  let manipPresetsMenu = null;       // open "project scale" dropdown
  let manipPresetsAnchor = null;     // caret button the dropdown hangs off
  let manipPreview = null;           // restores the element after a hover preview
  let manipQueuedRestores = new Map(); // element -> how to undo a queued edit's preview
  let manipPagePresetCache = {};     // prop -> values sampled from the page (per flyout)

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
        /* block, or the inline baseline gap shows the page through the seam
           where the design panel joins on */
        display: block !important;
        min-height: 120px !important;
        max-height: 400px !important;
        background: #303030 !important;
        border: 1px solid #4a4a4a !important;
        border-radius: 24px !important;
        transition: border-bottom-left-radius 0.24s cubic-bezier(0.23, 1, 0.32, 1),
                    border-bottom-right-radius 0.24s cubic-bezier(0.23, 1, 0.32, 1) !important;
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
      /* Mention highlighting: the textarea's text is transparent (caret kept)
         and an aligned overlay repaints it, tinting picked @file / >token
         mentions so they read as tokens rather than plain text. */
      .claude-design-popover-textarea.claude-design-has-mention-overlay {
        color: transparent !important;
        caret-color: #e5e5e5 !important;
      }
      .claude-design-mention-overlay {
        position: absolute !important;
        overflow: hidden !important;
        pointer-events: none !important;
        margin: 0 !important;
        background: transparent !important;
        border-style: solid !important;
        border-color: transparent !important;
        box-sizing: border-box !important;
        color: #e5e5e5 !important;
        white-space: pre-wrap !important;
        overflow-wrap: break-word !important;
        text-align: left !important;
        text-transform: none !important;
      }
      .claude-design-mention-overlay .claude-design-mention-chip {
        color: #eb9b78 !important;
        background: rgba(198, 97, 63, 0.16) !important;
        border-radius: 4px !important;
        box-shadow: 0 0 0 2px rgba(198, 97, 63, 0.16) !important;
      }
      .claude-design-popover-note {
        position: relative !important;
        display: block !important;
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
      .claude-design-crosshair *:not(.claude-design-popover):not(.claude-design-popover *):not(.claude-design-code-btn):not(.claude-design-code-btn *):not(.claude-design-class-inspector):not(.claude-design-class-inspector *):not(.claude-design-selected):not(.claude-design-selected *) {
        cursor: crosshair !important;
      }
      /* The selected element can be dragged to nudge it via margins */
      .claude-design-crosshair .claude-design-selected,
      .claude-design-crosshair .claude-design-selected * {
        cursor: move !important;
      }
      .claude-design-popover-textarea.dragover {
        border-color: #c6613f !important;
        background: rgba(198, 97, 63, 0.1) !important;
      }
      .claude-design-popover .claude-design-popover-images {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .claude-design-popover .claude-design-popover-thumb {
        position: relative !important;
        width: 32px !important;
        height: 32px !important;
        flex-shrink: 0 !important;
        border-radius: 8px !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .claude-design-popover .claude-design-popover-thumb img {
        width: 32px !important;
        height: 32px !important;
        object-fit: cover !important;
        border-radius: 8px !important;
        border: 1px solid #4a4a4a !important;
        display: block !important;
        margin: 0 !important;
      }
      .claude-design-popover .claude-design-popover-thumb-index {
        position: absolute !important;
        right: -3px !important;
        bottom: -3px !important;
        min-width: 13px !important;
        height: 13px !important;
        padding: 0 3px !important;
        background: #c6613f !important;
        border-radius: 7px !important;
        color: #fff !important;
        font-size: 9px !important;
        font-weight: 600 !important;
        line-height: 13px !important;
        text-align: center !important;
        box-sizing: border-box !important;
      }
      .claude-design-popover .claude-design-popover-thumb-remove {
        position: absolute !important;
        top: -5px !important;
        right: -5px !important;
        width: 15px !important;
        height: 15px !important;
        background: #333 !important;
        border: 1px solid #555 !important;
        border-radius: 50% !important;
        color: #ccc !important;
        cursor: pointer !important;
        display: none !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      .claude-design-popover .claude-design-popover-thumb:hover .claude-design-popover-thumb-remove {
        display: flex !important;
      }
      .claude-design-popover .claude-design-popover-thumb:hover .claude-design-popover-thumb-index {
        display: none !important;
      }
      .claude-design-popover .claude-design-popover-thumb-remove:hover {
        background: rgba(239, 68, 68, 0.9) !important;
        border-color: #ef4444 !important;
        color: #fff !important;
      }
      .claude-design-popover .claude-design-popover-thumb-remove svg {
        width: 9px !important;
        height: 9px !important;
        display: block !important;
        pointer-events: none !important;
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
      .claude-design-freeze-badge {
        position: fixed;
        bottom: 16px;
        left: 16px;
        display: flex;
        align-items: center;
        gap: 7px;
        background: rgba(31, 31, 31, 0.92);
        border: 1px solid rgba(198, 97, 63, 0.5);
        color: #fff;
        padding: 6px 12px;
        border-radius: 999px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 12px;
        line-height: 1;
        z-index: 2147483647;
        pointer-events: none;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }
      .claude-design-freeze-badge svg {
        width: 12px;
        height: 12px;
        display: block;
        color: #eb9b78;
      }
      .claude-design-freeze-badge kbd {
        background: rgba(255, 255, 255, 0.12);
        border-radius: 4px;
        padding: 2px 5px;
        font-family: inherit;
        font-size: 11px;
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

      /* ---- Direct manipulation (part of Edit mode) ---- */
      .claude-design-manip-sizelabel {
        position: fixed !important;
        pointer-events: none !important;
        z-index: 2147483646 !important;
        background: #c6613f !important;
        color: #fff !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        line-height: 1 !important;
        padding: 4px 7px !important;
        border-radius: 5px !important;
        white-space: nowrap !important;
      }
      /* Design panel: the prompt box grows to reveal it, one shade darker than
         the note field so it reads as the same surface. The outer element is a
         grid whose single row animates 0fr -> 1fr, which is what actually opens
         the box; the clip layer hides the overflow while it does. */
      .claude-design-manip-flyout {
        display: grid !important;
        grid-template-rows: 0fr !important;
        position: relative !important;
        z-index: 1 !important;
        width: 100% !important;
        margin: -1px 0 0 0 !important;
        padding: 0 !important;
        border: none !important;
        background: none !important;
        box-sizing: border-box !important;
        text-align: left !important;
        user-select: none !important;
        -webkit-user-select: none !important;
        /* Exit: collapse a touch quicker than it opened */
        transition: grid-template-rows 0.2s cubic-bezier(0.23, 1, 0.32, 1) !important;
      }
      .claude-design-manip-flyout.visible {
        grid-template-rows: 1fr !important;
        transition: grid-template-rows 0.24s cubic-bezier(0.23, 1, 0.32, 1) !important;
      }
      .claude-design-manip-clip {
        overflow: hidden !important;
        min-height: 0 !important;
      }
      .claude-design-manip-scroll {
        background: #262626 !important;
        border: 1px solid #4a4a4a !important;
        border-top: none !important;
        border-radius: 0 0 24px 24px !important;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3) !important;
        color: #e5e5e5 !important;
        font-size: 12px !important;
        box-sizing: border-box !important;
        max-height: calc(100vh - 190px) !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        opacity: 0 !important;
        pointer-events: none !important;
        transition: opacity 0.12s ease-out !important;
      }
      .claude-design-manip-flyout.visible .claude-design-manip-scroll {
        opacity: 1 !important;
        pointer-events: auto !important;
        /* Let the box start opening before the controls arrive */
        transition: opacity 0.2s ease-out 0.04s !important;
      }
      /* The note field and the panel form one box while it is open: the corners
         square off over the same beat as the opening, not before it */
      .claude-design-popover-input-row.has-design-panel .claude-design-popover-textarea {
        border-bottom-left-radius: 0 !important;
        border-bottom-right-radius: 0 !important;
        border-bottom-color: transparent !important;
      }
      @media (prefers-reduced-motion: reduce) {
        /* Keep the cross-fade, drop the movement */
        .claude-design-manip-flyout,
        .claude-design-manip-flyout.visible {
          grid-template-rows: 1fr !important;
          transition: none !important;
        }
        .claude-design-manip-scroll,
        .claude-design-manip-flyout.visible .claude-design-manip-scroll {
          transition: opacity 0.12s ease !important;
        }
        .claude-design-popover-textarea { transition: none !important; }
      }
      .claude-design-manip-flyout *, .claude-design-manip-flyout *::before, .claude-design-manip-flyout *::after {
        box-sizing: border-box !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        line-height: normal !important;
        text-transform: none !important;
        letter-spacing: normal !important;
      }
      /* Sliders button in the prompt box that toggles the panel */
      .claude-design-popover .claude-design-popover-design-btn {
        position: relative !important;
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
        flex-shrink: 0 !important;
      }
      .claude-design-popover .claude-design-popover-design-btn:hover {
        background: rgba(255, 255, 255, 0.1) !important;
      }
      .claude-design-popover .claude-design-popover-design-btn.active {
        background: rgba(198, 97, 63, 0.2) !important;
      }
      .claude-design-popover .claude-design-popover-design-btn svg {
        width: 18px !important;
        height: 18px !important;
        color: #888 !important;
        display: block !important;
      }
      .claude-design-popover .claude-design-popover-design-btn.active svg,
      .claude-design-popover .claude-design-popover-design-btn.has-changes svg {
        color: #eb9b78 !important;
      }
      .claude-design-popover .claude-design-popover-design-count {
        position: absolute !important;
        top: -5px !important;
        right: -5px !important;
        min-width: 16px !important;
        height: 16px !important;
        padding: 0 4px !important;
        border-radius: 8px !important;
        background: #c6613f !important;
        color: #fff !important;
        font-size: 10px !important;
        font-weight: 700 !important;
        line-height: 1 !important;
        display: none !important;
        align-items: center !important;
        justify-content: center !important;
      }
      .claude-design-popover .claude-design-popover-design-btn.has-changes .claude-design-popover-design-count {
        display: flex !important;
      }
      /* ---- Panel chrome: title bar, sections, labels, fields ---- */
      .claude-design-manip-flyout-header {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        padding: 11px 16px 9px !important;
      }
      .claude-design-manip-flyout-title {
        font-size: 11px !important;
        font-weight: 500 !important;
        color: #8f8f8f !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        flex: 1 !important;
      }
      .claude-design-manip-flyout .claude-design-manip-flyout-reset {
        all: unset !important;
        cursor: pointer !important;
        color: #8f8f8f !important;
        width: 24px !important;
        height: 24px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        border-radius: 6px !important;
        flex-shrink: 0 !important;
      }
      .claude-design-manip-flyout .claude-design-manip-flyout-reset svg {
        width: 14px !important;
        height: 14px !important;
        display: block !important;
      }
      .claude-design-manip-flyout .claude-design-manip-flyout-reset:hover { color: #fff !important; background: rgba(255, 255, 255, 0.08) !important; }
      /* The rule above resets every property, which would beat an inline display:none */
      .claude-design-manip-flyout .claude-design-manip-flyout-reset.hidden { display: none !important; }
      /* Which pseudo-state the fields below are editing */
      .claude-design-manip-flyout .claude-design-manip-statebtn {
        all: unset !important;
        cursor: pointer !important;
        position: relative !important;
        display: flex !important;
        align-items: center !important;
        gap: 3px !important;
        height: 20px !important;
        padding: 0 5px !important;
        border-radius: 5px !important;
        background: rgba(255, 255, 255, 0.06) !important;
        color: #8f8f8f !important;
        font-size: 10px !important;
        font-weight: 500 !important;
        white-space: nowrap !important;
        flex-shrink: 0 !important;
      }
      .claude-design-manip-flyout .claude-design-manip-statebtn:hover {
        background: rgba(255, 255, 255, 0.12) !important;
        color: #ddd !important;
      }
      /* Editing a state is worth noticing — it changes what every field means */
      .claude-design-manip-flyout .claude-design-manip-statebtn.on-state {
        background: rgba(198, 97, 63, 0.22) !important;
        color: #eb9b78 !important;
      }
      .claude-design-manip-flyout .claude-design-manip-statebtn svg { width: 8px !important; height: 8px !important; display: block !important; }
      /* One group at a time: the whole panel stays a fixed, small height */
      .claude-design-manip-tabs {
        display: flex !important;
        gap: 2px !important;
        padding: 0 12px 10px !important;
      }
      .claude-design-manip-flyout .claude-design-manip-tab {
        all: unset !important;
        cursor: pointer !important;
        position: relative !important;
        flex: 1 !important;
        min-width: 0 !important;
        height: 28px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        border-radius: 7px !important;
        color: #8f8f8f !important;
        font-size: 11px !important;
        font-weight: 500 !important;
        text-align: center !important;
        white-space: nowrap !important;
        overflow: hidden !important;
      }
      .claude-design-manip-flyout .claude-design-manip-tab:hover {
        background: rgba(255, 255, 255, 0.06) !important;
        color: #ddd !important;
      }
      .claude-design-manip-flyout .claude-design-manip-tab.active {
        background: #333 !important;
        color: #fff !important;
      }
      .claude-design-manip-tab-dot {
        position: absolute !important;
        top: 5px !important;
        right: 6px !important;
        width: 5px !important;
        height: 5px !important;
        border-radius: 50% !important;
        background: #c6613f !important;
        display: none !important;
      }
      .claude-design-manip-flyout .claude-design-manip-tab.changed .claude-design-manip-tab-dot { display: block !important; }
      .claude-design-manip-pane { display: none !important; }
      .claude-design-manip-pane.active { display: block !important; }
      .claude-design-manip-pane .claude-design-manip-section { border-top: none !important; padding-top: 0 !important; }
      .claude-design-manip-section {
        padding: 12px 16px !important;
        border-top: 1px solid rgba(255, 255, 255, 0.07) !important;
      }
      .claude-design-manip-section-label {
        font-size: 13px !important;
        font-weight: 600 !important;
        color: #fff !important;
        margin: 0 0 9px 0 !important;
      }
      .claude-design-manip-sublabel {
        font-size: 11px !important;
        font-weight: 400 !important;
        color: #8f8f8f !important;
        margin: 0 0 5px 0 !important;
      }
      .claude-design-manip-sublabel.spaced { margin-top: 10px !important; }
      /* Two even columns, the rhythm the whole panel is built on */
      .claude-design-manip-grid {
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        gap: 8px !important;
      }
      .claude-design-manip-grid + .claude-design-manip-grid { margin-top: 10px !important; }
      .claude-design-manip-cell { min-width: 0 !important; }
      /* The wrapper is the field the user sees; the scrub target sits inside it */
      .claude-design-manip-fieldwrap {
        display: flex !important;
        align-items: center !important;
        gap: 7px !important;
        height: 32px !important;
        padding: 0 6px 0 10px !important;
        background: #333 !important;
        border: 1px solid transparent !important;
        border-radius: 8px !important;
        box-sizing: border-box !important;
        min-width: 0 !important;
      }
      .claude-design-manip-fieldwrap:hover { background: #383838 !important; }
      .claude-design-manip-fieldwrap:has(.claude-design-manip-field.changed) {
        background: rgba(198, 97, 63, 0.14) !important;
        border-color: rgba(198, 97, 63, 0.5) !important;
      }
      .claude-design-manip-fieldwrap:has(.claude-design-manip-field.scrubbing) {
        border-color: #c6613f !important;
      }
      .claude-design-manip-glyph {
        color: #8f8f8f !important;
        font-size: 11px !important;
        line-height: 1 !important;
        flex-shrink: 0 !important;
        min-width: 9px !important;
      }
      .claude-design-manip-field {
        display: block !important;
        flex: 1 !important;
        min-width: 0 !important;
        background: none !important;
        border: none !important;
        padding: 0 !important;
        color: #eaeaea !important;
        font-size: 12px !important;
        font-variant-numeric: tabular-nums !important;
        cursor: ew-resize !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      .claude-design-manip-field.changed { color: #eb9b78 !important; }
      .claude-design-manip-field-input {
        all: unset !important;
        width: 100% !important;
        color: #fff !important;
        font-size: 12px !important;
        cursor: text !important;
      }
      /* Margin/padding box: each side sits where it lives on the element */
      .claude-design-manip-cross {
        display: grid !important;
        grid-template-columns: 1fr 1fr 1fr !important;
        gap: 5px !important;
        align-items: center !important;
        /* A faint well groups the four sides into one box-model diagram */
        background: rgba(255, 255, 255, 0.03) !important;
        border-radius: 10px !important;
        padding: 6px !important;
      }
      .claude-design-manip-cross .claude-design-manip-fieldwrap {
        height: 28px !important;
        padding: 0 4px 0 8px !important;
        gap: 2px !important;
      }
      .claude-design-manip-cross-t { grid-column: 2 !important; grid-row: 1 !important; }
      .claude-design-manip-cross-l { grid-column: 1 !important; grid-row: 2 !important; }
      .claude-design-manip-cross-c {
        grid-column: 2 !important;
        grid-row: 2 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        min-width: 0 !important;
      }
      .claude-design-manip-cross-r { grid-column: 3 !important; grid-row: 2 !important; }
      .claude-design-manip-cross-b { grid-column: 2 !important; grid-row: 3 !important; }
      /* Carets */
      .claude-design-manip-flyout .claude-design-manip-preset-btn {
        all: unset !important;
        cursor: pointer !important;
        flex-shrink: 0 !important;
        width: 20px !important;
        height: 22px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        border-radius: 5px !important;
        color: #7a7a7a !important;
      }
      .claude-design-manip-flyout .claude-design-manip-preset-btn:hover { background: rgba(255, 255, 255, 0.09) !important; color: #fff !important; }
      .claude-design-manip-flyout .claude-design-manip-preset-btn.open { background: rgba(198, 97, 63, 0.22) !important; color: #eb9b78 !important; }
      .claude-design-manip-flyout .claude-design-manip-preset-btn svg { width: 9px !important; height: 9px !important; display: block !important; }
      .claude-design-manip-preset-btn.claude-design-manip-cross-all {
        width: auto !important;
        max-width: 100% !important;
        height: 28px !important;
        padding: 0 6px !important;
        gap: 3px !important;
        font-size: 9px !important;
        font-weight: 600 !important;
        color: #8f8f8f !important;
        overflow: hidden !important;
      }
      .claude-design-manip-preset-btn.claude-design-manip-cross-all span {
        text-transform: uppercase !important;
        letter-spacing: 0.4px !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      /* Component size/variant picker: a field-shaped button */
      .claude-design-manip-preset-btn.claude-design-manip-fieldbtn {
        width: 100% !important;
        height: 32px !important;
        justify-content: space-between !important;
        gap: 6px !important;
        background: #333 !important;
        border: 1px solid transparent !important;
        border-radius: 8px !important;
        padding: 0 8px 0 10px !important;
        color: #eaeaea !important;
        font-size: 12px !important;
        box-sizing: border-box !important;
      }
      .claude-design-manip-preset-btn.claude-design-manip-fieldbtn:hover { background: #383838 !important; color: #fff !important; }
      .claude-design-manip-preset-btn.claude-design-manip-fieldbtn.changed {
        color: #eb9b78 !important;
        border-color: rgba(198, 97, 63, 0.5) !important;
        background: rgba(198, 97, 63, 0.14) !important;
      }
      .claude-design-manip-preset-btn.claude-design-manip-fieldbtn.unset { color: #7a7a7a !important; }
      .claude-design-manip-classbtn-value {
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
      }
      /* Colour row: swatch, value, caret — same box as every other field */
      .claude-design-manip-color-row {
        display: flex !important;
        align-items: center !important;
        gap: 9px !important;
        height: 32px !important;
        padding: 0 6px 0 8px !important;
        background: #333 !important;
        border: 1px solid transparent !important;
        border-radius: 8px !important;
        box-sizing: border-box !important;
      }
      .claude-design-manip-color-row:hover { background: #383838 !important; }
      .claude-design-manip-color-row.changed {
        background: rgba(198, 97, 63, 0.14) !important;
        border-color: rgba(198, 97, 63, 0.5) !important;
      }
      .claude-design-manip-color-row input[type="color"] {
        -webkit-appearance: none !important;
        appearance: none !important;
        width: 20px !important;
        height: 20px !important;
        padding: 0 !important;
        margin: 0 !important;
        border: 1px solid rgba(255, 255, 255, 0.14) !important;
        border-radius: 5px !important;
        background: transparent !important;
        cursor: pointer !important;
        flex-shrink: 0 !important;
      }
      .claude-design-manip-color-row input[type="color"]::-webkit-color-swatch-wrapper { padding: 0 !important; }
      .claude-design-manip-color-row input[type="color"]::-webkit-color-swatch { border: none !important; border-radius: 4px !important; }
      .claude-design-manip-presets {
        position: fixed !important;
        z-index: 2147483647 !important;
        min-width: 152px !important;
        max-height: 250px !important;
        overflow-y: auto !important;
        background: #262626 !important;
        border: 1px solid #4a4a4a !important;
        border-radius: 10px !important;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5) !important;
        padding: 4px !important;
        margin: 0 !important;
        box-sizing: border-box !important;
        user-select: none !important;
        -webkit-user-select: none !important;
      }
      .claude-design-manip-presets *, .claude-design-manip-presets *::before, .claude-design-manip-presets *::after {
        box-sizing: border-box !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        line-height: normal !important;
        text-transform: none !important;
        letter-spacing: normal !important;
      }
      .claude-design-manip-presets::-webkit-scrollbar { width: 8px !important; }
      .claude-design-manip-presets::-webkit-scrollbar-track { background: transparent !important; }
      .claude-design-manip-presets::-webkit-scrollbar-thumb { background: #444 !important; border-radius: 4px !important; }
      .claude-design-manip-presets-head {
        padding: 4px 8px 6px !important;
        color: #777 !important;
        font-size: 10px !important;
        font-weight: 600 !important;
        text-transform: uppercase !important;
        letter-spacing: 0.5px !important;
        white-space: nowrap !important;
      }
      .claude-design-manip-preset-item {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        padding: 5px 8px !important;
        border-radius: 6px !important;
        cursor: pointer !important;
        color: #ddd !important;
        font-size: 11px !important;
        white-space: nowrap !important;
      }
      .claude-design-manip-preset-item:hover { background: rgba(255, 255, 255, 0.08) !important; }
      .claude-design-manip-preset-item.current {
        color: #eb9b78 !important;
        background: rgba(198, 97, 63, 0.14) !important;
      }
      .claude-design-manip-preset-name {
        flex: 1 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      .claude-design-manip-preset-value {
        color: #888 !important;
        font-variant-numeric: tabular-nums !important;
      }
      .claude-design-manip-preset-item.current .claude-design-manip-preset-value { color: #c08b73 !important; }
      .claude-design-manip-presets-empty {
        padding: 8px !important;
        color: #888 !important;
        font-size: 11px !important;
        white-space: nowrap !important;
      }
      /* Color variant: swatch grid rather than a list of values */
      .claude-design-manip-presets.colors { width: 200px !important; min-width: 200px !important; }
      .claude-design-manip-preset-grid {
        display: grid !important;
        grid-template-columns: repeat(8, 1fr) !important;
        gap: 4px !important;
        padding: 0 4px 6px !important;
      }
      .claude-design-manip-preset-swatch {
        width: 100% !important;
        aspect-ratio: 1 / 1 !important;
        border-radius: 5px !important;
        border: 1px solid rgba(255, 255, 255, 0.14) !important;
        cursor: pointer !important;
        box-sizing: border-box !important;
      }
      .claude-design-manip-preset-swatch:hover { border-color: #fff !important; }
      .claude-design-manip-preset-swatch.current {
        border-color: #eb9b78 !important;
        box-shadow: 0 0 0 2px rgba(198, 97, 63, 0.5) !important;
      }
      .claude-design-manip-color-row input[type="color"] {
        -webkit-appearance: none !important;
        appearance: none !important;
        width: 24px !important;
        height: 24px !important;
        padding: 0 !important;
        margin: 0 !important;
        border: 1px solid #4a4a4a !important;
        border-radius: 6px !important;
        background: transparent !important;
        cursor: pointer !important;
        flex-shrink: 0 !important;
      }
      .claude-design-manip-color-row input[type="color"]::-webkit-color-swatch-wrapper { padding: 2px !important; }
      .claude-design-manip-color-row input[type="color"]::-webkit-color-swatch { border: none !important; border-radius: 4px !important; }
      .claude-design-manip-color-row.changed input[type="color"] { border-color: rgba(198, 97, 63, 0.8) !important; }
      .claude-design-manip-alpha {
        flex: 0 0 auto !important;
        min-width: 18px !important;
        text-align: right !important;
      }
      .claude-design-manip-color-row .claude-design-manip-glyph { min-width: 0 !important; }
      .claude-design-manip-color-hex {
        color: #eaeaea !important;
        font-size: 12px !important;
        font-variant-numeric: tabular-nums !important;
        flex: 1 !important;
        min-width: 0 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      .claude-design-manip-color-row.changed .claude-design-manip-color-hex { color: #eb9b78 !important; }
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
          selector += ':nth-of-type(' + index + ')';
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
    // Before the deltas are consumed: how to put the page back if this edit
    // is cancelled rather than sent
    manipCaptureRestore(el);
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

  function clearPendingAnnotations(revertDesign) {
    pendingAnnotations.forEach(function(ann) {
      // Sent edits keep their preview, and their capture is spent
      if (revertDesign) manipRestoreQueued(ann.element);
      else manipQueuedRestores.delete(ann.element);
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
    // Other queued edits may still rely on this element's preview
    var stillQueued = pendingAnnotations.some(function(other) { return other.element === ann.element; });
    if (!stillQueued) manipRestoreQueued(ann.element);
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

        // Keep the leading > in the textarea (like @ for files) so
        // expandMentions can find '>' + name at send time.
        var value = textarea.value;
        var after = value.substring(textarea.selectionStart);
        textarea.value = value.substring(0, mention.startIndex) + displayName + after;

        var newPos = mention.startIndex + displayName.length;
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

    // --- Mention highlight overlay ---
    // The textarea's own text is made transparent (see CSS); this overlay
    // repaints it in place, wrapping picked mentions in a tinted chip. Metrics
    // are copied from the textarea so the glyphs line up exactly.
    var overlay = document.createElement('div');
    overlay.className = 'claude-design-mention-overlay';
    var tcs = getComputedStyle(textarea);
    var mirrorProps = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
      'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-radius'];
    for (var mp = 0; mp < mirrorProps.length; mp++) {
      overlay.style.setProperty(mirrorProps[mp], tcs.getPropertyValue(mirrorProps[mp]), 'important');
    }
    textarea.parentNode.insertBefore(overlay, textarea.nextSibling);
    textarea.classList.add('claude-design-has-mention-overlay');

    // Ranges of picked mentions in the current value (prefix + known map key).
    // Partially edited mentions stop matching and degrade to plain text, which
    // mirrors how expandMentions treats them at send time.
    function mentionRanges(value) {
      var ranges = [];
      function collect(prefix, map) {
        if (!map) return;
        var keys = Object.keys(map);
        for (var i = 0; i < keys.length; i++) {
          var needle = prefix + keys[i];
          var idx = value.indexOf(needle);
          while (idx !== -1) {
            ranges.push({ start: idx, end: idx + needle.length });
            idx = value.indexOf(needle, idx + needle.length);
          }
        }
      }
      collect('@', textarea.__mentionMap);
      collect('>', textarea.__tokenMentionMap);
      ranges.sort(function(a, b) { return a.start - b.start || b.end - a.end; });
      var merged = [];
      for (var r = 0; r < ranges.length; r++) {
        if (!merged.length || ranges[r].start >= merged[merged.length - 1].end) merged.push(ranges[r]);
      }
      return merged;
    }

    function renderOverlay() {
      var value = textarea.value;
      var ranges = mentionRanges(value);
      var html = '';
      var pos = 0;
      for (var i = 0; i < ranges.length; i++) {
        html += escapeHtml(value.substring(pos, ranges[i].start));
        html += '<span class="claude-design-mention-chip">' +
          escapeHtml(value.substring(ranges[i].start, ranges[i].end)) + '</span>';
        pos = ranges[i].end;
      }
      html += escapeHtml(value.substring(pos));
      // A trailing newline needs a visible line for scroll heights to match
      if (value.charAt(value.length - 1) === '\\n') html += '\\u200b';
      overlay.innerHTML = html;
      overlay.style.top = textarea.offsetTop + 'px';
      overlay.style.left = textarea.offsetLeft + 'px';
      overlay.style.width = textarea.offsetWidth + 'px';
      overlay.style.height = textarea.offsetHeight + 'px';
      overlay.scrollTop = textarea.scrollTop;
    }

    textarea.addEventListener('input', renderOverlay);
    textarea.addEventListener('scroll', function() { overlay.scrollTop = textarea.scrollTop; });
    renderOverlay();

    return { removeDropdown: removeDropdown };
  }

  // Reference images (data URLs) attached to the current popover, in the
  // order they were added — prompt-side they become [Image #1], [Image #2]…
  let referenceImagesData = [];

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
      // No room above or below — try beside the element (right, then left)
      // so it stays visible under the taller popover
      var sideTop = Math.max(10, Math.min(rect.top, window.innerHeight - popHeight - 10));
      if (rect.right + 330 <= window.innerWidth) {
        popoverElement.style.top = sideTop + 'px';
        popoverElement.style.left = (rect.right + 14) + 'px';
        return;
      }
      if (rect.left - 334 >= 0) {
        popoverElement.style.top = sideTop + 'px';
        popoverElement.style.left = (rect.left - 334) + 'px';
        return;
      }
      // Nowhere else — anchor to bottom of viewport, overlapping element
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
    referenceImagesData = [];

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

    // Add scroll listener to reposition popover, code button, and readout
    popoverScrollHandler = function() {
      positionPopover();
      positionCodeButton();
      positionManipOverlay();
      positionManipPresets();
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

    // Sliders button that opens the design flyout — element selections only
    const designButtonHTML = (el && !textSelection)
      ? '<button class="claude-design-popover-design-btn" data-action="toggle-design" title="Design controls — resize, spacing, type, color">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>' +
            '<line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>' +
            '<line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>' +
            '<line x1="2" y1="14" x2="6" y2="14"/><line x1="10" y1="8" x2="14" y2="8"/><line x1="18" y1="16" x2="22" y2="16"/>' +
          '</svg>' +
          '<span class="claude-design-popover-design-count">0</span>' +
        '</button>'
      : '';

    let inputAreaHTML =
        '<input type="file" class="claude-design-popover-file" accept="image/*" multiple style="display: none;" />' +
        '<div class="claude-design-popover-input-row">' +
          headerHTML +
          // The buttons anchor to the note field, not to the row, so the design
          // panel can sit underneath without displacing them
          '<div class="claude-design-popover-note">' +
          '<textarea class="claude-design-popover-textarea" placeholder="' + placeholder + '"></textarea>' +
          '<div class="claude-design-popover-actions">' +
            '<div class="claude-design-popover-actions-left">' +
              designButtonHTML +
              '<button class="claude-design-popover-image-btn" data-action="browse" title="Add image (⌘I)">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                  '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>' +
                  '<circle cx="9" cy="9" r="2"/>' +
                  '<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>' +
                '</svg>' +
              '</button>' +
              '<div class="claude-design-popover-images"></div>' +
            '</div>' +
            '<div class="claude-design-popover-actions-right">' +
              addAnotherButton +
              actionButton +
            '</div>' +
          '</div>' +
          '</div>' +
        '</div>';

    popoverElement.innerHTML = inputAreaHTML + listHTML;

    document.body.appendChild(popoverElement);

    // Reposition now that we know the actual height
    positionPopover();

    // Attach direct manipulation: the size readout, and the design
    // flyout if it was left open. Runs after positionPopover so the flyout
    // anchors to the popover's final position. Text/area selections skip it.
    if (el && !textSelection) {
      manipAttach(el);
    } else {
      manipDetach();
    }

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
    const imagesRow = popoverElement.querySelector('.claude-design-popover-images');

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

    // One 32px thumbnail per attached image, numbered to match the
    // [Image #N] labels used in the prompt. Hovering swaps the number
    // badge for a remove button.
    function renderImageThumbs() {
      if (!imagesRow) return;
      var html = '';
      for (var ti = 0; ti < referenceImagesData.length; ti++) {
        html +=
          '<div class="claude-design-popover-thumb" title="Image #' + (ti + 1) + '">' +
            '<img src="' + referenceImagesData[ti] + '" alt="" />' +
            '<span class="claude-design-popover-thumb-index">' + (ti + 1) + '</span>' +
            '<button class="claude-design-popover-thumb-remove" data-action="remove-image" data-image-index="' + ti + '" title="Remove Image #' + (ti + 1) + '">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>' +
              '</svg>' +
            '</button>' +
          '</div>';
      }
      imagesRow.innerHTML = html;
    }

    function addImageFile(file) {
      if (!file || !file.type || !file.type.startsWith('image/')) return;
      var reader = new FileReader();
      reader.onload = function(e) {
        referenceImagesData.push(e.target.result);
        renderImageThumbs();
      };
      reader.readAsDataURL(file);
    }

    function handleFiles(files) {
      if (!files) return;
      for (var fi = 0; fi < files.length; fi++) addImageFile(files[fi]);
    }

    function removeImage(index) {
      referenceImagesData.splice(index, 1);
      fileInput.value = '';
      renderImageThumbs();
    }

    fileInput.addEventListener('change', function(e) {
      handleFiles(e.target.files);
      fileInput.value = '';
    });

    // Paste images straight into the note (like Claude Code)
    textarea.addEventListener('paste', function(e) {
      if (!e.clipboardData || !e.clipboardData.files || e.clipboardData.files.length === 0) return;
      var imgs = [];
      for (var pi = 0; pi < e.clipboardData.files.length; pi++) {
        if (e.clipboardData.files[pi].type.startsWith('image/')) imgs.push(e.clipboardData.files[pi]);
      }
      if (imgs.length > 0) {
        e.preventDefault();
        handleFiles(imgs);
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
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
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
        // Save current note and/or design tweaks, then close popover to select another element
        var ta = popoverElement && popoverElement.querySelector('textarea');
        var currentTyped = (ta && expandMentions(ta.value.trim(), ta)) || '';
        if (selectedElement) {
          var currentNote = composeNoteWithDeltas(selectedElement, currentTyped);
          if (currentNote) {
            savePendingAnnotation(selectedElement, currentNote);
            manipConsumeDeltas(selectedElement);
          }
        }
        // Close popover so user can select another element
        cancelAnnotation();
      }
      if (action === 'toggle-design') toggleManipFlyout();
      if (action === 'browse') fileInput.click();
      if (action === 'remove-image') {
        var imgIdx = target && target.dataset.imageIndex ? parseInt(target.dataset.imageIndex, 10) : 0;
        removeImage(isNaN(imgIdx) ? 0 : imgIdx);
      }
      if (action === 'remove-item') {
        var idx = target && target.dataset.index ? parseInt(target.dataset.index, 10) : -1;
        if (idx >= 0) removePendingAnnotation(idx);
      }
    });

    textarea && textarea.addEventListener('keydown', function(e) {
      // Cmd/Ctrl+Enter: Always send immediately (sends all if in list mode)
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        if (todoMode || pendingAnnotations.length > 0) {
          // Save current note/tweaks first, then send all
          var currentTyped = expandMentions(textarea.value.trim(), textarea);
          if (selectedElement) {
            var currentNote = composeNoteWithDeltas(selectedElement, currentTyped);
            if (currentNote) {
              savePendingAnnotation(selectedElement, currentNote);
              manipConsumeDeltas(selectedElement);
            }
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
        var typedNote = expandMentions(textarea.value.trim(), textarea);
        var note = selectedElement ? composeNoteWithDeltas(selectedElement, typedNote) : typedNote;
        if (!note) {
          textarea.focus();
          return;
        }
        if (!todoMode && pendingAnnotations.length === 0) {
          todoMode = true;
        }
        if (selectedElement) {
          savePendingAnnotation(selectedElement, note);
          manipConsumeDeltas(selectedElement);
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
    manipDetach();
    removePopover();
    referenceImagesData = [];

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
    const typed = (textarea && expandMentions(textarea.value.trim(), textarea)) || '';

    // Handle area selection - sends immediately
    if (areaSelectedRect) {
      if (!typed) { textarea && textarea.focus(); return; }
      sendAnnotation();
      return;
    }

    // Handle text selection - still sends immediately
    if (selectedText && selectedTextRange) {
      if (!typed) { textarea && textarea.focus(); return; }
      sendAnnotation();
      return;
    }

    // For element selection - save locally (typed note + design tweaks
    // folded into one instruction) and close popover to select another element
    if (selectedElement) {
      const note = composeNoteWithDeltas(selectedElement, typed);
      if (!note) {
        textarea && textarea.focus();
        return;
      }
      savePendingAnnotation(selectedElement, note);
      manipConsumeDeltas(selectedElement);
      cancelAnnotation();
    }
  }

  function sendAnnotation() {
    if (!popoverElement) return;

    const textarea = popoverElement.querySelector('textarea');
    const typed = (textarea && expandMentions(textarea.value.trim(), textarea)) || '';

    // Element selections may send with an empty note when there are design
    // tweaks — the deltas ARE the instruction. Text/area selections need text.
    const request = (selectedElement && !selectedText && !areaSelectedRect)
      ? composeNoteWithDeltas(selectedElement, typed)
      : typed;

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
        referenceImages: referenceImagesData.slice(),
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
        referenceImages: referenceImagesData.slice(),
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
      referenceImages: referenceImagesData.slice(),
      request: request,
    };

    console.log('[ClaudeDesign] Sending annotation, reference images:', referenceImagesData.length);

    // Post message to parent
    window.__claudeDesignSendAnnotation(data);

    // Deltas went out with this note; keep the preview, stop tracking them
    manipConsumeDeltas(selectedElement);

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
    // Consume the drag-suppress flag on ANY click, even ones we ignore — a
    // drag ending over the popover must not leave a stale flag that would
    // swallow the user's next real click.
    var suppressManip = manipSuppressClick;
    manipSuppressClick = false;
    // Any click outside the scale dropdown dismisses it (clicks on its own
    // caret fall through to the button's toggle)
    if (manipPresetsMenu && e.target.closest &&
        !e.target.closest('.claude-design-manip-presets') &&
        !(manipPresetsAnchor && manipPresetsAnchor.contains(e.target))) {
      closeManipPresets();
    }
    if (e.target.closest && e.target.closest('.claude-design-manip-presets')) return;
    if (e.target.closest && e.target.closest('.claude-design-popover')) return;
    if (e.target.closest && e.target.closest('.claude-design-toolbar')) return;
    if (e.target.closest && e.target.closest('.claude-design-code-btn')) return;
    if (e.target.closest && e.target.closest('.claude-design-class-inspector')) return;
    if (e.target.closest && e.target.closest('.claude-design-manip-flyout')) return;

    e.preventDefault();
    e.stopPropagation();

    // The click that ends a resize/nudge/scrub drag is part of that gesture,
    // not a click-outside — the popover stays open
    if (suppressManip) return;

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
      // The scale dropdown swallows the first Escape so it can't take the
      // whole annotation down with it
      if (manipPresetsMenu) {
        e.stopPropagation();
        closeManipPresets();
        return;
      }
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
    if ((e.key === 'g' || e.key === 'G') && !gKeyDown && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && tag !== 'TEXTAREA' && tag !== 'INPUT') {
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

  var freezeBadgeElement = null;
  function showFreezeBadge() {
    if (freezeBadgeElement) return;
    // The badge takes the hints bar's corner — dismiss the hints if still up
    // (the user has evidently found the shortcut).
    removeShortcutHints();
    freezeBadgeElement = document.createElement('div');
    freezeBadgeElement.className = 'claude-design-freeze-badge';
    freezeBadgeElement.innerHTML =
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
        '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>' +
      '</svg>' +
      'Animations frozen <kbd>F</kbd>';
    document.body.appendChild(freezeBadgeElement);
  }
  function removeFreezeBadge() {
    if (freezeBadgeElement) {
      freezeBadgeElement.remove();
      freezeBadgeElement = null;
    }
  }

  // quiet: skip the toast (used when unfreezing as a side effect of leaving
  // annotate mode, where a "resumed" toast would be noise)
  function toggleAnimationFreeze(quiet) {
    animationsPaused = !animationsPaused;
    var els = document.querySelectorAll('*');
    if (animationsPaused) {
      els.forEach(function(el) {
        el.style.animationPlayState = 'paused';
        el.style.transitionDuration = '0s';
      });
      showFreezeBadge();
      if (!quiet) showGridToast('Animations Frozen', 'Press F to resume');
    } else {
      els.forEach(function(el) {
        el.style.animationPlayState = '';
        el.style.transitionDuration = '';
      });
      removeFreezeBadge();
      if (!quiet) showGridToast('Animations Resumed', '');
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
    shortcutHintsElement.innerHTML = '<span><kbd>Drag</kbd> Select area</span><span><kbd>Alt</kbd> Inspect element</span><span><kbd>Shift+G</kbd> Grid</span><span><kbd>F</kbd> Freeze animations</span>';
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
    // A drag starting on the selected element is a nudge gesture, not an
    // area-select marquee
    if (manipDrag) return;
    if (manipSelected && (e.target === manipSelected || manipSelected.contains(e.target))) return;
    if (e.target.closest && (
      e.target.closest('.claude-design-popover') ||
      e.target.closest('.claude-design-toolbar') ||
      e.target.closest('.claude-design-code-btn') ||
      e.target.closest('.claude-design-class-inspector') ||
      e.target.closest('.claude-design-shortcut-hints') ||
      e.target.closest('.claude-design-manip-flyout') ||
      e.target.closest('.claude-design-manip-presets')
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
    // Direct manipulation (resize/nudge/scrub) — must register before the
    // area-select handlers so a drag on the selected element wins over marquee
    document.addEventListener('mousedown', handleManipMouseDown, true);
    document.addEventListener('mousemove', handleManipMouseMove, true);
    document.addEventListener('mouseup', handleManipMouseUp, true);
    document.addEventListener('keydown', handleManipKeyDown, true);
    window.addEventListener('scroll', queueManipReposition, true);
    window.addEventListener('resize', queueManipReposition);
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
    document.removeEventListener('mousedown', handleManipMouseDown, true);
    document.removeEventListener('mousemove', handleManipMouseMove, true);
    document.removeEventListener('mouseup', handleManipMouseUp, true);
    document.removeEventListener('keydown', handleManipKeyDown, true);
    window.removeEventListener('scroll', queueManipReposition, true);
    window.removeEventListener('resize', queueManipReposition);
    manipSuppressClick = false;
    document.removeEventListener('mousedown', handleAreaMouseDown, true);
    document.removeEventListener('mousemove', handleAreaMouseMove, true);
    document.removeEventListener('mouseup', handleAreaMouseUp, true);
    removeAreaSelection();
    removeRulerGuides();
    removeGridOverlay();
    removeShortcutHints();
    // Design panel chrome lives on <body>, so leaving the mode must take it all
    closeManipPresets();
    closeManipFlyout(true);
    manipHoverField = null;
    // Unfreeze animations when leaving annotate mode
    if (animationsPaused) {
      toggleAnimationFreeze(true);
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

  // ============================================================
  // Direct manipulation: drag-resize, nudge, scrub (part of Edit mode)
  // ============================================================
  // Selecting an element attaches the size readout and embeds a design section
  // in the annotation popover. Tweaks preview live as inline styles and are
  // tracked per element as baseline -> current deltas; sending the annotation
  // (or adding it to the edit list) folds the deltas into the instruction.

  var MANIP_PROPS = {
    'width':            { min: 0, step: 1, unit: 'px' },
    'height':           { min: 0, step: 1, unit: 'px' },
    'margin-top':       { step: 1, unit: 'px' },
    'margin-right':     { step: 1, unit: 'px' },
    'margin-bottom':    { step: 1, unit: 'px' },
    'margin-left':      { step: 1, unit: 'px' },
    'padding-top':      { min: 0, step: 1, unit: 'px' },
    'padding-right':    { min: 0, step: 1, unit: 'px' },
    'padding-bottom':   { min: 0, step: 1, unit: 'px' },
    'padding-left':     { min: 0, step: 1, unit: 'px' },
    'font-size':        { min: 1, step: 1, unit: 'px' },
    'font-weight':      { min: 100, max: 900, step: 100, unit: '' },
    'line-height':      { min: 0, step: 1, unit: 'px' },
    'letter-spacing':   { step: 0.1, unit: 'px', decimals: 1 },
    'border-radius':    { min: 0, step: 1, unit: 'px' },
    'border-width':     { min: 0, step: 1, unit: 'px', readProp: 'border-top-width' },
    'border-style':     { choices: ['none', 'solid', 'dashed', 'dotted', 'double'], readProp: 'border-top-style' },
    'border-color':     { color: true, readProp: 'border-top-color' },
    'gap':              { min: 0, step: 1, unit: 'px' },
    'color':            { color: true },
    'background-color': { color: true }
  };

  // Tailwind utility prefix that owns each property's scale, used to pull the
  // project's own values out of window.__claudeDesignTokens
  // Every piece of UI this script puts on the page. One list: it decides both
  // what a pointer/keyboard event should ignore and what page sampling skips.
  var MANIP_CHROME = '.claude-design-popover, .claude-design-toolbar, .claude-design-manip-flyout, .claude-design-manip-presets, .claude-design-manip-sizelabel, .claude-design-class-inspector, .claude-design-code-btn, .claude-design-shortcut-hints, .claude-design-grid-toast';

  var MANIP_TOKEN_PREFIX = {
    'width': 'w', 'height': 'h',
    'margin-top': 'mt', 'margin-right': 'mr', 'margin-bottom': 'mb', 'margin-left': 'ml',
    'padding-top': 'pt', 'padding-right': 'pr', 'padding-bottom': 'pb', 'padding-left': 'pl',
    'gap': 'gap', 'border-width': 'border', 'font-size': 'text', 'font-weight': 'font',
    'line-height': 'leading', 'letter-spacing': 'tracking', 'border-radius': 'rounded'
  };

  // CSS custom properties that belong to each property's scale (projects
  // without Tailwind — plain :root variables, shadcn-style themes, etc.)
  var MANIP_VAR_HINT = {
    'font-size': /^--(font-size|fontsize|text|type|fs)[-_]/i,
    'font-weight': /^--(font-weight|fontweight|weight|fw)[-_]/i,
    'line-height': /^--(line-height|lineheight|leading|lh)[-_]/i,
    'letter-spacing': /^--(letter-spacing|letterspacing|tracking|ls)[-_]/i,
    'border-radius': /^--(radius|border-radius|rounded|corner)/i,
    'spacing': /^--(spacing|space|size|sizes|gap|sp)[-_]/i
  };

  function manipVarHintFor(prop) {
    return MANIP_VAR_HINT[prop] || MANIP_VAR_HINT.spacing;
  }

  function manipRootFontSize() {
    return parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('font-size')) || 16;
  }

  // Resolve a token value ('1.5rem', '14px', '0.025em', '600') to px for the
  // given property/element. Returns null for anything not a plain length.
  function manipTokenToPx(raw, prop, el) {
    var s = manipResolveVar(raw);
    // tailwind fontSize entries can be tuples: ['1rem', { lineHeight: ... }]
    s = s.replace(/^\\[\\s*/, '').replace(/^['"\`]/, '').replace(/['"\`].*$/, '').trim();
    var m = s.match(/^(-?[0-9]*\\.?[0-9]+)(px|rem|em|)$/);
    if (!m) return null;
    var n = parseFloat(m[1]);
    var unit = m[2];
    if (!isFinite(n)) return null;
    var fontSize = el ? (parseFloat(window.getComputedStyle(el).getPropertyValue('font-size')) || 16) : 16;
    if (unit === 'px') return n;
    if (unit === 'rem') return n * manipRootFontSize();
    if (unit === 'em') return n * fontSize;
    // Unitless: only meaningful for weights, line-height multipliers and zero
    if (prop === 'font-weight') return n;
    if (prop === 'line-height') return n * fontSize;
    return n === 0 ? 0 : null;
  }

  // The project's scale for a property: Tailwind utilities first, then CSS
  // custom properties, deduped by resolved value and sorted small to large.
  function manipTokenPresets(prop, prefix) {
    var el = manipSelected;
    var tokens = window.__claudeDesignTokens || [];
    var out = [];
    var seen = {};
    function add(name, raw) {
      var px = manipTokenToPx(raw, prop, el);
      if (px === null) return;
      var key = String(Math.round(px * 100) / 100);
      if (seen[key]) return;
      seen[key] = true;
      out.push({ name: name, px: px, token: name });
    }
    if (prefix) {
      tokens.forEach(function(t) {
        if (t.source !== 'tailwind') return;
        if (t.name !== prefix && t.name.indexOf(prefix + '-') !== 0) return;
        add(t.name, t.value);
      });
    }
    var hint = manipVarHintFor(prop);
    tokens.forEach(function(t) {
      if (t.source !== 'css-var' || t.name.charAt(0) !== '-') return;
      if (!hint.test(t.name)) return;
      add(t.name, t.value);
    });
    out.sort(function(a, b) { return a.px - b.px; });
    return out;
  }

  // Walk the page's own elements, skipping this script's UI, and hand each
  // computed value of that property to the collector. Callers cache the
  // result: the sweep reads computed styles and is too costly to repeat.
  function manipSamplePage(prop, collect) {
    var els = document.body ? document.body.querySelectorAll('*') : [];
    var limit = Math.min(els.length, 2500);
    for (var i = 0; i < limit; i++) {
      var el = els[i];
      if (el.closest && el.closest(MANIP_CHROME)) continue;
      collect(window.getComputedStyle(el).getPropertyValue(prop));
    }
  }

  // Fallback for projects with no token source: the values the page itself
  // actually uses, most common first (then sorted by size).
  function manipPagePresets(prop) {
    if (manipPagePresetCache[prop]) return manipPagePresetCache[prop];
    var counts = {};
    manipSamplePage(prop, function(raw) {
      var v = parseFloat(raw);
      if (!isFinite(v) || v < 0) return;
      if (prop === 'font-size' && (v < 6 || v > 200)) return;
      var key = String(Math.round(v * 10) / 10);
      counts[key] = (counts[key] || 0) + 1;
    });
    var entries = Object.keys(counts).map(function(k) {
      return { px: parseFloat(k), count: counts[k] };
    }).filter(function(entry) { return entry.count > 1; });
    entries.sort(function(a, b) { return b.count - a.count; });
    entries = entries.slice(0, 10);
    entries.sort(function(a, b) { return a.px - b.px; });
    var result = entries.map(function(entry) {
      return { name: (Math.round(entry.px * 10) / 10) + 'px', px: entry.px, token: null, hint: entry.count + '\\u00d7' };
    });
    manipPagePresetCache[prop] = result;
    return result;
  }

  // Color families Tailwind ships with — used only to sort the project's own
  // colors above the stock palette in the swatch grid
  var TAILWIND_DEFAULT_FAMILIES = ('slate gray zinc neutral stone red orange amber yellow lime green ' +
    'emerald teal cyan sky blue indigo violet purple fuchsia pink rose black white transparent current inherit').split(' ');

  // Theme tokens often point at another variable (--color-accent: var(--accent)).
  // The page is live, so resolve the chain against the document root.
  function manipResolveVar(value) {
    var out = String(value == null ? '' : value).trim();
    for (var hop = 0; hop < 4 && out.indexOf('var(') === 0; hop++) {
      var match = out.match(/^var\\(\\s*(--[\\w-]+)\\s*(?:,([\\s\\S]*))?\\)$/);
      if (!match) break;
      var resolved = window.getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
      if (!resolved && match[2]) resolved = match[2].trim(); // declared fallback
      if (!resolved || resolved === out) break;
      out = resolved;
    }
    return out;
  }

  var manipColorCtxCache = null;
  function manipColorCtx() {
    if (!manipColorCtxCache) {
      var canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      manipColorCtxCache = canvas.getContext('2d');
    }
    return manipColorCtxCache;
  }

  // Normalise any CSS colour to a hex string, or null when it isn't a usable
  // opaque-ish colour (invalid, transparent, var() reference, keyword)
  function manipNormalizeColor(raw) {
    var s = manipResolveVar(raw);
    if (!s || s.indexOf('var(') !== -1) return null;
    var low = s.toLowerCase();
    if (low === 'transparent' || low === 'none' || low === 'inherit' || low === 'currentcolor' ||
        low === 'unset' || low === 'initial' || low === 'auto') return null;
    var ctx = manipColorCtx();
    // An invalid value leaves fillStyle untouched, so it reads back as whatever
    // was there before — seed two different values to tell those apart
    ctx.fillStyle = '#000000';
    ctx.fillStyle = s;
    var first = ctx.fillStyle;
    ctx.fillStyle = '#ffffff';
    ctx.fillStyle = s;
    if (first !== ctx.fillStyle) return null;
    if (first.charAt(0) === '#') return first;
    var m = first.match(/^rgba?\\(\\s*([0-9.]+)[,\\s]+([0-9.]+)[,\\s]+([0-9.]+)(?:[,\\s/]+([0-9.]+))?\\s*\\)$/);
    if (!m) return null;
    var alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (!(alpha > 0.02)) return null;
    return rgbToHex(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), alpha);
  }

  // A colour field can be shown two ways: the colour itself, or its alpha as a
  // percentage. Tailwind writes that alpha as a /NN modifier on the utility.
  function manipColorParts(el, prop) {
    var meta = MANIP_PROPS[prop] || {};
    var rec = manipChanges.get(el);
    if (rec && manipActiveState !== 'default' && rec.states && rec.states[manipActiveState]) {
      rec = rec.states[manipActiveState];
    }
    var raw = (rec && rec.current[prop] !== undefined)
      ? rec.current[prop]
      : window.getComputedStyle(el).getPropertyValue(meta.readProp || prop);
    var ctx = manipColorCtx();
    ctx.fillStyle = '#000000';
    ctx.fillStyle = String(raw).trim();
    var normalized = ctx.fillStyle;
    if (normalized.charAt(0) === '#') return { hex: normalized, alpha: 1 };
    var m = normalized.match(/^rgba?\\(\\s*([0-9.]+)[,\\s]+([0-9.]+)[,\\s]+([0-9.]+)(?:[,\\s/]+([0-9.]+))?\\s*\\)$/);
    if (!m) return { hex: '#000000', alpha: 1 };
    return {
      hex: rgbToHex(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)),
      alpha: m[4] === undefined ? 1 : parseFloat(m[4])
    };
  }

  // Choosing a colour on a fully transparent one means you want to see it, so
  // alpha 0 is not worth preserving
  function manipKeepAlpha(el, prop) {
    var alpha = manipColorParts(el, prop).alpha;
    return alpha > 0 ? alpha : 1;
  }

  function manipColorWithAlpha(hex, alpha) {
    var c = colorToRgb(hex);
    if (alpha >= 0.999) return rgbToHex(c.r, c.g, c.b);
    return 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + (Math.round(alpha * 1000) / 1000) + ')';
  }

  // bg-primary + 10% -> bg-primary/10, the way Tailwind writes it
  function manipTokenWithAlpha(token, alpha) {
    if (!token) return token;
    var base = String(token).replace(/\\/\\d+$/, '');
    if (alpha >= 0.999) return base;
    return base + '/' + Math.round(alpha * 100);
  }

  // The project's colors for a property: text-* for color, bg-* for fill,
  // plus every CSS colour variable. Project-specific entries come first.
  function manipColorPresets(prop) {
    var tokens = window.__claudeDesignTokens || [];
    var prefix = prop === 'color' ? 'text-' : (prop === 'border-color' ? 'border-' : 'bg-');
    var own = [];
    var stock = [];
    var seen = {};
    function add(name, raw, isStock) {
      var hex = manipNormalizeColor(raw);
      if (!hex) return;
      if (seen[hex]) return;
      seen[hex] = true;
      (isStock ? stock : own).push({ name: name, color: hex, token: name });
    }
    tokens.forEach(function(t) {
      if (t.category !== 'color' || t.source !== 'tailwind') return;
      if (t.name.indexOf(prefix) !== 0) return;
      var family = t.name.slice(prefix.length).split('-')[0];
      add(t.name, t.value, TAILWIND_DEFAULT_FAMILIES.indexOf(family) !== -1);
    });
    tokens.forEach(function(t) {
      if (t.category !== 'color' || t.source !== 'css-var') return;
      add(t.name, t.value, false);
    });
    return { own: own, stock: stock };
  }

  // Colors the page itself paints, most used first — the fallback for
  // projects with no token source
  function manipPageColorPresets(prop) {
    var cacheKey = 'color:' + prop;
    if (manipPagePresetCache[cacheKey]) return manipPagePresetCache[cacheKey];
    var counts = {};
    manipSamplePage(prop, function(raw) {
      var hex = manipNormalizeColor(raw);
      if (hex) counts[hex] = (counts[hex] || 0) + 1;
    });
    var entries = Object.keys(counts).map(function(hex) {
      return { color: hex, count: counts[hex], name: hex, token: null };
    });
    entries.sort(function(a, b) { return b.count - a.count; });
    entries = entries.slice(0, 24);
    manipPagePresetCache[cacheKey] = entries;
    return entries;
  }

  // Always {kind, groups:[{head, items}]} so the menu renders with one loop
  // ---- Component variants (btn-sm \\u2192 btn-lg, btn-primary \\u2192 btn-secondary) ----
  // Detected from the page's own stylesheets, so it works for DaisyUI,
  // Bootstrap, BEM modifiers or any hand-rolled component CSS. Utility-only
  // markup (plain Tailwind, shadcn/cva) has no such classes and gets no section.

  // Bare Tailwind utilities that also head a family of "modifiers" — never a
  // component variant, so they must not spawn a picker
  var MANIP_UTILITY_BASES = {};
  ('flex grid border rounded shadow ring outline transition transform filter backdrop container block inline table hidden ' +
   'static fixed absolute relative sticky visible invisible italic underline overline truncate uppercase lowercase capitalize ' +
   'antialiased isolate group peer snap blur grayscale invert sepia appearance resize columns aspect object overflow order ' +
   'float clear list decoration cursor select align whitespace break content animate delay duration ease origin scale rotate ' +
   'translate skew opacity bg text font leading tracking gap space divide place items justify self col row').split(' ')
    .forEach(function(name) { MANIP_UTILITY_BASES[name] = true; });

  // Modifiers that read as a size; everything else is treated as a variant
  var MANIP_SIZE_MODS = {
    'tiny': -2, 'mini': -2, 'xxs': -1, '2xs': -1, 'xs': 0, 'sm': 1, 'small': 1, 'md': 2, 'base': 2,
    'default': 2, 'normal': 2, 'medium': 2, 'lg': 3, 'large': 3, 'xl': 4, 'huge': 4,
    '2xl': 5, 'xxl': 5, '3xl': 6, '4xl': 7, '5xl': 8
  };

  var manipClassIndex = null;      // {set, keys, sheets} of every class the page's CSS defines
  var manipSiblingCache = {};      // "base|sep" -> modifiers found for it
  var manipPanelFamilies = [];     // families rendered in the open flyout
  var manipActiveTab = 'layout';   // which group the panel shows, remembered across selections
  var manipActiveState = 'default';// which pseudo-state the panel is editing
  var manipStateApplied = {};      // props the state preview put on the element
  var manipStateRules = null;      // class -> {state -> declarations}, from the page's CSS
  var manipTabHoverTimer = null;   // hover-to-switch intent delay
  var manipTabHovering = false;    // pointer is over the tab row

  // ---- Pseudo-states, Tailwind-style ----
  // Tailwind puts states on the element itself (hover:bg-x), and compiles them
  // to .hover\\:bg-x:hover { ... }. So the element's own classes say what its
  // states are, and the compiled rule says exactly what they look like.
  var MANIP_STATES = [
    { key: 'hover', label: 'Hover', prefixes: ['hover'] },
    { key: 'focus', label: 'Focus', prefixes: ['focus', 'focus-visible'] },
    { key: 'active', label: 'Active', prefixes: ['active'] }
  ];

  function manipStateOfPrefix(prefix) {
    for (var i = 0; i < MANIP_STATES.length; i++) {
      if (MANIP_STATES[i].prefixes.indexOf(prefix) !== -1) return MANIP_STATES[i].key;
    }
    return null;
  }

  // Only offered where Tailwind is in play — this reads variant classes, not
  // arbitrary stylesheet rules
  function manipIsTailwindProject() {
    var tokens = window.__claudeDesignTokens || [];
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i].source === 'tailwind') return true;
    }
    return false;
  }

  // Declarations from every compiled state rule, keyed by the class that owns it
  function manipEnsureStateRules() {
    if (manipStateRules && manipStateRules.sheets === document.styleSheets.length) return manipStateRules;
    var byClass = {};
    var budget = 60000;
    function walk(rules) {
      for (var i = 0; i < rules.length && budget > 0; i++) {
        var rule = rules[i];
        budget--;
        if (rule.cssRules && !rule.selectorText) { walk(rule.cssRules); continue; }
        if (!rule.selectorText || !rule.style) continue;
        var match = rule.selectorText.match(/^\\.((?:\\\\.|[^\\s:.,>+~])+):(hover|focus|focus-visible|active)$/);
        if (!match) continue;
        var className = match[1].replace(/\\\\/g, '');
        var decls = byClass[className] || (byClass[className] = {});
        for (var j = 0; j < rule.style.length; j++) {
          var prop = rule.style[j];
          decls[prop] = rule.style.getPropertyValue(prop);
        }
      }
    }
    var sheets = document.styleSheets;
    for (var s2 = 0; s2 < sheets.length; s2++) {
      try {
        if (sheets[s2].cssRules) walk(sheets[s2].cssRules);
      } catch (err) { /* cross-origin */ }
    }
    manipStateRules = { byClass: byClass, sheets: document.styleSheets.length };
    return manipStateRules;
  }

  // The variant classes this element carries, grouped by state
  function manipStateClasses(el, stateKey) {
    var out = [];
    if (!el || !el.classList) return out;
    for (var i = 0; i < el.classList.length; i++) {
      var cls = el.classList[i];
      var colon = cls.indexOf(':');
      if (colon <= 0) continue;
      var prefix = cls.slice(0, colon);
      if (manipStateOfPrefix(prefix) !== stateKey) continue;
      out.push({ cls: cls, prefix: prefix, utility: cls.slice(colon + 1) });
    }
    return out;
  }

  // What the element looks like in that state: every declaration its variant
  // classes contribute, in class order
  function manipStateDeclarations(el, stateKey) {
    var index = manipEnsureStateRules();
    var decls = {};
    manipStateClasses(el, stateKey).forEach(function(entry) {
      var found = index.byClass[entry.cls];
      if (!found) return;
      Object.keys(found).forEach(function(prop) { decls[prop] = found[prop]; });
    });
    return decls;
  }

  // Show the element as it looks in a state, so it can be edited on sight
  function manipEnterState(el, stateKey) {
    manipLeaveState(el);
    manipActiveState = stateKey;
    if (stateKey === 'default' || !el) return;
    var rec = manipEnsureRecord(el);
    var stateRec = manipStateRecord(rec, stateKey, el);
    Object.keys(stateRec.decls).forEach(function(prop) {
      el.style.setProperty(prop, stateRec.decls[prop], 'important');
      manipStateApplied[prop] = true;
    });
    Object.keys(stateRec.current).forEach(function(prop) {
      el.style.setProperty(prop, stateRec.current[prop], 'important');
      manipStateApplied[prop] = true;
    });
    queueManipReposition();
  }

  // Put the element back to its default look, keeping any default-state edits
  function manipLeaveState(el) {
    var props = Object.keys(manipStateApplied);
    manipStateApplied = {};
    manipActiveState = 'default';
    if (!el || !el.isConnected || !props.length) return;
    var rec = manipChanges.get(el);
    props.forEach(function(prop) {
      if (rec && rec.current[prop] !== undefined) el.style.setProperty(prop, rec.current[prop], 'important');
      else if (rec) manipRestoreInline(el, rec, prop);
      else el.style.removeProperty(prop);
    });
    queueManipReposition();
  }

  function manipEnsureClassIndex() {
    // Dev servers inject stylesheets as you edit, so rebuild when the sheet
    // count changes rather than trusting a one-time scan
    if (manipClassIndex && manipClassIndex.sheets === document.styleSheets.length) return manipClassIndex;
    manipSiblingCache = {};
    var set = {};
    var budget = 60000; // guard against enormous dev-mode stylesheets
    function walk(rules) {
      for (var i = 0; i < rules.length && budget > 0; i++) {
        var rule = rules[i];
        budget--;
        if (rule.selectorText) {
          var found = rule.selectorText.match(/\\.-?[_a-zA-Z][\\w-]*/g);
          if (found) {
            for (var j = 0; j < found.length; j++) set[found[j].slice(1)] = true;
          }
        } else if (rule.cssRules) {
          walk(rule.cssRules);
        }
      }
    }
    var sheets = document.styleSheets;
    for (var s = 0; s < sheets.length; s++) {
      // Cross-origin sheets throw on access; skip them
      try {
        if (sheets[s].cssRules) walk(sheets[s].cssRules);
      } catch (err) { /* ignore */ }
    }
    manipClassIndex = { set: set, keys: Object.keys(set), sheets: document.styleSheets.length };
    return manipClassIndex;
  }

  function manipSiblingMods(base, sep) {
    var key = base + '|' + sep;
    if (manipSiblingCache[key]) return manipSiblingCache[key];
    var idx = manipEnsureClassIndex();
    var prefix = base + sep;
    var mods = [];
    for (var i = 0; i < idx.keys.length; i++) {
      var name = idx.keys[i];
      if (name.length <= prefix.length || name.indexOf(prefix) !== 0) continue;
      var mod = name.slice(prefix.length);
      if (!mod || mod.charAt(0) === '-') continue;
      mods.push(mod);
    }
    manipSiblingCache[key] = mods;
    return mods;
  }

  function manipModGroup(mod) {
    return MANIP_SIZE_MODS[mod] !== undefined ? 'size' : 'variant';
  }

  // The class of this family currently on the element, for one group
  function manipCurrentClassFor(el, fam, groupKey) {
    for (var i = 0; i < el.classList.length; i++) {
      var c = el.classList[i];
      if (c.length <= fam.base.length + fam.sep.length) continue;
      if (c.indexOf(fam.base + fam.sep) !== 0) continue;
      var mod = c.slice(fam.base.length + fam.sep.length);
      if (fam.mods.indexOf(mod) !== -1 && manipModGroup(mod) === groupKey) return c;
    }
    return null;
  }

  // Component families on this element: a base class the CSS defines, with at
  // least two modifiers to choose between
  function manipClassFamilies(el) {
    if (!el || !el.classList || !el.classList.length) return [];
    var idx = manipEnsureClassIndex();
    if (!idx.keys.length) return [];
    var seen = {};
    var families = [];

    function consider(base, sep) {
      if (!base || base.length < 2 || MANIP_UTILITY_BASES[base]) return;
      if (seen[base + '|' + sep]) return;
      // The base has to be a real class, not just a shared prefix
      if (!idx.set[base] && !el.classList.contains(base)) return;
      var mods = manipSiblingMods(base, sep);
      if (mods.length < 2) return;
      seen[base + '|' + sep] = true;
      families.push({ base: base, sep: sep, mods: mods });
    }

    for (var i = 0; i < el.classList.length; i++) {
      var c = el.classList[i];
      if (c.indexOf('claude-design-') === 0) continue;
      consider(c, '-');            // bare base, e.g. class="btn"
      var dd = c.indexOf('--');    // BEM modifier, e.g. card__title--large
      if (dd > 0) consider(c.slice(0, dd), '--');
      // Left-most split keeps every modifier under one base (btn-outline-primary)
      var pos = c.indexOf('-');
      while (pos > 0) {
        consider(c.slice(0, pos), '-');
        pos = c.indexOf('-', pos + 1);
      }
    }

    // Keep only families that offer a real choice in a group
    var out = [];
    families.forEach(function(fam) {
      var groups = [];
      ['size', 'variant'].forEach(function(key) {
        var mods = fam.mods.filter(function(mod) { return manipModGroup(mod) === key; });
        if (key === 'size') {
          mods.sort(function(a, b) { return MANIP_SIZE_MODS[a] - MANIP_SIZE_MODS[b]; });
        } else {
          mods.sort();
        }
        var current = manipCurrentClassFor(el, fam, key);
        if (mods.length < 2 && !current) return;
        groups.push({ key: key, label: key === 'size' ? 'Size' : 'Variant', mods: mods });
      });
      if (groups.length) out.push({ kind: 'class', base: fam.base, sep: fam.sep, mods: fam.mods, groups: groups });
    });
    // Utility-class components (cva/tailwind-variants) have no marker class of
    // their own, so they are matched from the parsed declarations instead
    return out.concat(manipVariantFamilies(el));
  }

  // ---- Tailwind components (cva / tailwind-variants) ----
  // Utility markup carries no variant class, so the options come from the
  // declarations parsed out of the project source. An element is matched by its
  // data-slot, or by how much of the declaration's base class list it carries.

  function manipElementClassSet(el) {
    var set = {};
    for (var i = 0; i < el.classList.length; i++) {
      var c = el.classList[i];
      if (c.indexOf('claude-design-') !== 0) set[c] = true;
    }
    return set;
  }

  function manipCoverage(classes, present) {
    if (!classes || !classes.length) return 0;
    var hit = 0;
    for (var i = 0; i < classes.length; i++) {
      if (present[classes[i]]) hit++;
    }
    return hit / classes.length;
  }

  // The declaration this element is an instance of, or null
  function manipMatchVariantSet(el) {
    var sets = window.__claudeDesignComponentVariants || [];
    if (!sets.length) return null;
    var present = manipElementClassSet(el);
    var slot = el.getAttribute ? el.getAttribute('data-slot') : null;
    var best = null;
    var bestScore = 0;
    sets.forEach(function(set) {
      var score;
      if (slot && set.slot && set.slot === slot) {
        score = 2; // an explicit data-slot beats any class overlap
      } else {
        // Needs a distinctive base, most of which the element still carries
        if (!set.base || set.base.length < 3) return;
        var coverage = manipCoverage(set.base, present);
        if (coverage < 0.6) return;
        score = coverage;
      }
      if (score > bestScore) {
        bestScore = score;
        best = set;
      }
    });
    return best;
  }

  // Which option of a group the element currently shows
  function manipCurrentVariantOption(el, set, group) {
    var present = manipElementClassSet(el);
    var best = null;
    var bestScore = 0;
    group.options.forEach(function(option) {
      if (!option.classes || !option.classes.length) return;
      var coverage = manipCoverage(option.classes, present);
      // Prefer the most specific match when two options overlap
      if (coverage >= 0.5 && (coverage > bestScore || (coverage === bestScore && best && option.classes.length > best.classes.length))) {
        bestScore = coverage;
        best = option;
      }
    });
    if (best) return best.name;
    return group.defaultOption || null;
  }

  function manipVariantFamilies(el) {
    var set = manipMatchVariantSet(el);
    if (!set) return [];
    var groups = set.groups.filter(function(group) { return group.options && group.options.length > 1; });
    if (!groups.length) return [];
    return [{ kind: 'variant', set: set, base: set.name, groups: groups.map(function(group) {
      return { key: group.name, label: group.name.charAt(0).toUpperCase() + group.name.slice(1), group: group };
    }) }];
  }

  // Swapping keeps the base and the other groups' classes intact — only the
  // classes unique to the outgoing option are removed
  // Variant families carry {key, label, group}; callers want one or the other
  function manipFindGroup(fam, groupKey) {
    for (var i = 0; i < fam.groups.length; i++) {
      if (fam.groups[i].key === groupKey) return fam.groups[i];
    }
    return null;
  }

  // The DOM half of a variant swap: keep the base and the other groups' classes,
  // drop only what is unique to the outgoing option. Shared with hover preview.
  function manipApplyVariantClasses(el, fam, groupKey, optionName) {
    var entry = manipFindGroup(fam, groupKey);
    if (!entry) return;
    var group = entry.group;
    var byName = {};
    group.options.forEach(function(option) { byName[option.name] = option; });

    var keep = {};
    (fam.set.base || []).forEach(function(c) { keep[c] = true; });
    fam.groups.forEach(function(other) {
      if (other.key === groupKey) return;
      var otherName = manipCurrentVariantOption(el, fam.set, other.group);
      other.group.options.forEach(function(option) {
        if (option.name === otherName) option.classes.forEach(function(c) { keep[c] = true; });
      });
    });
    var next = byName[optionName];
    if (next) next.classes.forEach(function(c) { keep[c] = true; });

    var current = byName[manipCurrentVariantOption(el, fam.set, group)];
    if (current) {
      current.classes.forEach(function(c) {
        if (!keep[c]) el.classList.remove(c);
      });
    }
    if (next) next.classes.forEach(function(c) { el.classList.add(c); });
  }

  function manipSetVariantOption(el, fam, groupKey, optionName) {
    var entry = manipFindGroup(fam, groupKey);
    if (!entry) return;
    var currentName = manipCurrentVariantOption(el, fam.set, entry.group);
    if (currentName === optionName) return;

    manipUndoPush(manipVariantSnapshotRaw(el, fam.set.name + '|' + groupKey), false);
    manipApplyVariantClasses(el, fam, groupKey, optionName);

    var rec = manipEnsureRecord(el);
    if (!rec.classSwaps) rec.classSwaps = {};
    var key = fam.set.name + '|' + groupKey;
    var swap = rec.classSwaps[key];
    var origin = swap ? swap.from : currentName;
    if (origin === optionName) delete rec.classSwaps[key];
    else rec.classSwaps[key] = {
      from: origin, to: optionName, component: fam.set.name,
      group: groupKey, file: fam.set.file, isVariant: true
    };
    queueManipReposition();
  }

  // Class edits are restored wholesale: exact, and immune to overlapping
  // utilities between options
  function manipVariantSnapshotRaw(el, key) {
    var rec = manipEnsureRecord(el);
    var classes = [];
    for (var i = 0; i < el.classList.length; i++) {
      if (el.classList[i].indexOf('claude-design-') !== 0) classes.push(el.classList[i]);
    }
    var swap = rec.classSwaps ? rec.classSwaps[key] : undefined;
    return {
      el: el, isVariant: true, key: 'variant:' + key, classes: classes, swapKey: key,
      swap: swap ? { from: swap.from, to: swap.to, component: swap.component, group: swap.group, file: swap.file, isVariant: true } : undefined
    };
  }

  function manipApplyVariantSnapshot(snap) {
    var el = snap.el;
    var ours = [];
    for (var i = 0; i < el.classList.length; i++) {
      if (el.classList[i].indexOf('claude-design-') === 0) ours.push(el.classList[i]);
    }
    // setAttribute, not el.className — the latter is read-only on SVG elements
    el.setAttribute('class', snap.classes.concat(ours).join(' '));
    var rec = manipEnsureRecord(el);
    if (!rec.classSwaps) rec.classSwaps = {};
    if (snap.swap) rec.classSwaps[snap.swapKey] = snap.swap;
    else delete rec.classSwaps[snap.swapKey];
    queueManipReposition();
  }

  // The DOM half of a class-family swap, shared with hover preview
  function manipApplyClassPreview(el, fam, groupKey, mod) {
    var fromCls = manipCurrentClassFor(el, fam, groupKey);
    var toCls = mod ? fam.base + fam.sep + mod : null;
    if (fromCls) el.classList.remove(fromCls);
    if (toCls) el.classList.add(toCls);
  }

  function manipSetClassMod(el, fam, groupKey, mod) {
    var fromCls = manipCurrentClassFor(el, fam, groupKey);
    var toCls = mod ? fam.base + fam.sep + mod : null;
    if (fromCls === toCls) return;
    manipUndoRecordClass(el, fam, groupKey, fromCls);
    manipApplyClassState(el, fam, groupKey, toCls);
  }

  // Swap the family's class for this group, tracking it against the baseline
  function manipApplyClassState(el, fam, groupKey, toCls) {
    var rec = manipEnsureRecord(el);
    if (!rec.classSwaps) rec.classSwaps = {};
    var key = fam.base + fam.sep + '|' + groupKey;
    var fromCls = manipCurrentClassFor(el, fam, groupKey);
    if (fromCls) el.classList.remove(fromCls);
    if (toCls) el.classList.add(toCls);
    var entry = rec.classSwaps[key];
    var origin = entry ? entry.from : fromCls;
    if (origin === toCls) delete rec.classSwaps[key];
    else rec.classSwaps[key] = { from: origin, to: toCls, base: fam.base, sep: fam.sep, group: groupKey, fam: fam };
    queueManipReposition();
  }

  function manipPresetsFor(prop, prefix) {
    if ((MANIP_PROPS[prop] || {}).color) {
      var palette = manipColorPresets(prop);
      if (palette.own.length || palette.stock.length) {
        return { kind: 'color', groups: [
          { head: 'Project colors', items: palette.own },
          { head: 'Tailwind palette', items: palette.stock }
        ].filter(function(g) { return g.items.length; }) };
      }
      return { kind: 'color', groups: [{ head: 'Used on this page', items: manipPageColorPresets(prop) }] };
    }
    var tokenPresets = manipTokenPresets(prop, prefix);
    if (tokenPresets.length) return { kind: 'value', groups: [{ head: 'Project scale', items: tokenPresets }] };
    return { kind: 'value', groups: [{ head: 'Used on this page', items: manipPagePresets(prop) }] };
  }

  function isManipUiTarget(t) {
    if (!t || !t.closest) return false;
    return !!t.closest(MANIP_CHROME);
  }

  function manipEnsureRecord(el) {
    var rec = manipChanges.get(el);
    if (!rec) {
      var computed = window.getComputedStyle(el);
      var baseline = {};
      var inline = {};
      Object.keys(MANIP_PROPS).forEach(function(p) {
        baseline[p] = computed.getPropertyValue(MANIP_PROPS[p].readProp || p);
        inline[p] = { value: el.style.getPropertyValue(p), priority: el.style.getPropertyPriority(p) };
      });
      rec = {
        baseline: baseline, inline: inline, current: {}, tokens: {}, classSwaps: {},
        classAttr: el.getAttribute('class') || ''
      };
      manipChanges.set(el, rec);
    }
    return rec;
  }

  function manipColorsEqual(a, b) {
    try {
      var ca = colorToRgb(a);
      var cb = colorToRgb(b);
      return ca.r === cb.r && ca.g === cb.g && ca.b === cb.b && Math.abs(ca.a - cb.a) < 0.02;
    } catch (err) {
      return a === b;
    }
  }

  function manipRestoreInline(el, rec, prop) {
    var orig = rec.inline[prop];
    if (orig && orig.value) {
      el.style.setProperty(prop, orig.value, orig.priority);
    } else {
      el.style.removeProperty(prop);
    }
  }

  // tokenName: the project token the value came from (e.g. "text-2xl"), so the
  // instruction can name it instead of only the resolved px. Any other way of
  // setting the prop passes nothing, which clears a previously picked token.
  function manipSetProp(el, prop, cssValue, tokenName) {
    var rec = manipActiveRecord(el);
    if (!rec.tokens) rec.tokens = {};
    var meta = MANIP_PROPS[prop] || {};
    var baseVal = rec.baseline[prop];
    var same;
    if (meta.color) {
      same = manipColorsEqual(cssValue, baseVal);
    } else {
      var a = parseFloat(cssValue);
      var b = parseFloat(baseVal);
      same = (isFinite(a) && isFinite(b)) ? Math.abs(a - b) < 0.05 : cssValue === baseVal;
    }
    // Back at the baseline means "no change", not "change to the same value"
    var nextValue = same ? undefined : cssValue;
    var nextToken = same ? undefined : (tokenName || undefined);
    // Only a real change earns an undo step; the write itself always runs so the
    // preview survives the page re-rendering the element underneath us
    if (nextValue !== rec.current[prop] || nextToken !== rec.tokens[prop]) {
      manipUndoRecord(el, prop);
    }
    manipApplyPropState(el, prop, nextValue, nextToken);
  }

  // The single place that writes a property's state, shared by edits and undo
  function manipApplyPropState(el, prop, value, token) {
    var rec = manipActiveRecord(el);
    if (!rec.tokens) rec.tokens = {};
    if (manipActiveState !== 'default') manipStateApplied[prop] = true;
    if (value === undefined) {
      // Back to what the state itself shows, or to the element's own value
      if (manipActiveState !== 'default') {
        var read = (MANIP_PROPS[prop] || {}).readProp || prop;
        if (rec.decls[read] !== undefined) el.style.setProperty(prop, rec.decls[read], 'important');
        else manipRestoreInline(el, manipChanges.get(el), prop);
      } else {
        manipRestoreInline(el, rec, prop);
      }
      delete rec.current[prop];
      delete rec.tokens[prop];
    } else {
      el.style.setProperty(prop, value, 'important');
      rec.current[prop] = value;
      if (token) rec.tokens[prop] = token;
      else delete rec.tokens[prop];
    }
    queueManipReposition();
  }

  // ---- Undo/redo for design tweaks (Cmd/Ctrl+Z, Shift to redo) ----

  // Remember what a property looked like before it changes. Consecutive edits
  // to the same property collapse into one step, and a gesture (drag, scrub,
  // multi-side preset) collapses into one via the open batch.
  // One history for every kind of edit. Each snapshot carries the key that
  // identifies what it covers, so a batch keeps only the first snapshot per
  // (element, key) and consecutive tweaks to the same field collapse into one
  // step. Only value edits coalesce by time — a click is always its own step.
  function manipUndoPush(snap, coalesce) {
    if (manipUndoBatch) {
      for (var i = 0; i < manipUndoBatch.length; i++) {
        if (manipUndoBatch[i].el === snap.el && manipUndoBatch[i].key === snap.key) return;
      }
      manipUndoBatch.push(snap);
      return;
    }
    var now = Date.now();
    if (coalesce && manipUndoLastEl === snap.el && manipUndoLastKey === snap.key && now - manipUndoLastTime < 700) {
      manipUndoLastTime = now;
      return;
    }
    manipUndoLastEl = coalesce ? snap.el : null;
    manipUndoLastKey = snap.key;
    manipUndoLastTime = now;
    manipUndoStack.push([snap]);
    if (manipUndoStack.length > 200) manipUndoStack.shift();
    manipRedoStack = [];
  }

  function manipUndoRecord(el, prop) {
    var rec = manipActiveRecord(el);
    manipUndoPush({
      el: el, key: 'prop:' + prop, prop: prop,
      value: rec.current[prop], token: rec.tokens ? rec.tokens[prop] : undefined
    }, true);
  }

  // Class swaps ride the same history as property edits
  function manipUndoRecordClass(el, fam, groupKey, currentCls) {
    manipUndoPush({
      el: el, key: 'class:' + fam.base + fam.sep + '|' + groupKey,
      fam: fam, group: groupKey, cls: currentCls, isClass: true
    }, false);
  }

  function manipUndoBeginBatch() {
    if (!manipUndoBatch) manipUndoBatch = [];
  }

  function manipUndoEndBatch() {
    var batch = manipUndoBatch;
    manipUndoBatch = null;
    manipUndoLastEl = null;
    if (!batch || !batch.length) return;
    manipUndoStack.push(batch);
    if (manipUndoStack.length > 200) manipUndoStack.shift();
    manipRedoStack = [];
  }

  // Swap a batch for the state it replaces, so the opposite stack can put it back
  function manipApplyUndoBatch(batch) {
    var inverse = [];
    var applied = false;
    batch.forEach(function(snap) {
      var el = snap.el;
      if (!el || !el.isConnected) return;
      if (snap.isVariant) {
        inverse.push(manipVariantSnapshotRaw(el, snap.swapKey));
        manipApplyVariantSnapshot(snap);
        applied = true;
        return;
      }
      if (snap.isClass) {
        inverse.push({ el: el, fam: snap.fam, group: snap.group, cls: manipCurrentClassFor(el, snap.fam, snap.group), isClass: true });
        manipApplyClassState(el, snap.fam, snap.group, snap.cls);
        applied = true;
        return;
      }
      var rec = manipActiveRecord(el);
      inverse.push({ el: el, prop: snap.prop, value: rec.current[snap.prop], token: rec.tokens ? rec.tokens[snap.prop] : undefined });
      manipApplyPropState(el, snap.prop, snap.value, snap.token);
      applied = true;
    });
    if (!applied) return null;
    refreshManipPanelValues();
    return inverse;
  }

  function manipUndo() {
    while (manipUndoStack.length) {
      var inverse = manipApplyUndoBatch(manipUndoStack.pop());
      if (inverse) {
        manipRedoStack.push(inverse);
        manipUndoLastEl = null;
        return true;
      }
    }
    return false;
  }

  function manipRedo() {
    while (manipRedoStack.length) {
      var inverse = manipApplyUndoBatch(manipRedoStack.pop());
      if (inverse) {
        manipUndoStack.push(inverse);
        manipUndoLastEl = null;
        return true;
      }
    }
    return false;
  }

  // Drop history for an element whose tweaks have been sent — undoing them
  // locally would no longer match what the CLI was told
  function manipForgetUndo(el) {
    function keep(batch) {
      var rest = batch.filter(function(snap) { return snap.el !== el; });
      return rest.length ? rest : null;
    }
    manipUndoStack = manipUndoStack.map(keep).filter(Boolean);
    manipRedoStack = manipRedoStack.map(keep).filter(Boolean);
    manipUndoLastEl = null;
  }

  // Reading and writing a field, whichever of the two it shows
  function manipFieldMeta(prop, view) {
    if (view === 'alpha') return { min: 0, max: 100, step: 1, unit: '' };
    return MANIP_PROPS[prop] || {};
  }

  function manipReadField(el, prop, view) {
    if (view === 'alpha') return Math.round(manipColorParts(el, prop).alpha * 100);
    return manipCurrentNumeric(el, prop);
  }

  function manipWriteField(el, prop, view, value) {
    if (view === 'alpha') {
      var parts = manipColorParts(el, prop);
      var alpha = Math.max(0, Math.min(100, value)) / 100;
      var rec = manipChanges.get(el);
      var token = rec && rec.tokens ? rec.tokens[prop] : undefined;
      manipSetProp(el, prop, manipColorWithAlpha(parts.hex, alpha), manipTokenWithAlpha(token, alpha));
      return;
    }
    var meta = MANIP_PROPS[prop] || {};
    manipSetProp(el, prop, value + (meta.unit || ''));
  }

  function manipCurrentNumeric(el, prop) {
    var computed = window.getComputedStyle(el);
    var v = parseFloat(computed.getPropertyValue((MANIP_PROPS[prop] || {}).readProp || prop));
    if (!isFinite(v)) {
      if (prop === 'line-height') {
        v = (parseFloat(computed.getPropertyValue('font-size')) || 16) * 1.2;
      } else {
        v = 0;
      }
    }
    return v;
  }

  // Queued edits keep their preview on the page until they are sent. If one is
  // cancelled instead, the page has to go back to the code — so the state to
  // undo is captured when the edit is queued, keyed by element so several edits
  // on one element still revert to the original.
  function manipCaptureRestore(el) {
    var rec = manipChanges.get(el);
    if (!rec || manipRecordChangeCount(rec) === 0) return;
    if (manipQueuedRestores.has(el)) return; // keep the earliest
    manipQueuedRestores.set(el, {
      props: Object.keys(rec.current).map(function(prop) {
        return { prop: prop, inline: rec.inline[prop] };
      }),
      classAttr: rec.classAttr,
      hadClassSwaps: Object.keys(rec.classSwaps || {}).length > 0
    });
  }

  function manipRestoreQueued(el) {
    var cap = manipQueuedRestores.get(el);
    if (!cap) return;
    manipQueuedRestores.delete(el);
    if (!el || !el.isConnected) return;
    cap.props.forEach(function(entry) {
      if (entry.inline && entry.inline.value) el.style.setProperty(entry.prop, entry.inline.value, entry.inline.priority);
      else el.style.removeProperty(entry.prop);
    });
    if (cap.hadClassSwaps) {
      // Put back the element's own classes, keeping ours (selection, badges)
      var ours = [];
      for (var i = 0; i < el.classList.length; i++) {
        if (el.classList[i].indexOf('claude-design-') === 0) ours.push(el.classList[i]);
      }
      el.setAttribute('class', (cap.classAttr + ' ' + ours.join(' ')).trim());
    }
    // The element is no longer mid-edit: start fresh if it is selected again
    manipChanges.delete(el);
    manipForgetUndo(el);
    if (el === manipSelected) {
      manipEnsureRecord(el);
      refreshManipPanelValues();
    }
    queueManipReposition();
  }

  // Which tab a property is edited on, so a tab can show it holds a change
  var MANIP_TAB_OF_PROP = {
    'width': 'layout', 'height': 'layout', 'border-radius': 'layout', 'gap': 'layout',
    'margin-top': 'spacing', 'margin-right': 'spacing', 'margin-bottom': 'spacing', 'margin-left': 'spacing',
    'padding-top': 'spacing', 'padding-right': 'spacing', 'padding-bottom': 'spacing', 'padding-left': 'spacing',
    'border-width': 'border', 'border-style': 'border', 'border-color': 'border',
    'font-size': 'text', 'font-weight': 'text', 'line-height': 'text', 'letter-spacing': 'text',
    'color': 'color', 'background-color': 'color'
  };

  // Editing a state writes to that state's sub-record, not the element's own
  function manipStateRecord(rec, stateKey, el) {
    if (!rec.states) rec.states = {};
    if (!rec.states[stateKey]) {
      var decls = manipStateDeclarations(el, stateKey);
      var computed = window.getComputedStyle(el);
      var baseline = {};
      Object.keys(MANIP_PROPS).forEach(function(prop) {
        var read = MANIP_PROPS[prop].readProp || prop;
        // What the state shows today: its own declaration, or the base value
        baseline[prop] = decls[read] !== undefined ? decls[read] : computed.getPropertyValue(read);
      });
      rec.states[stateKey] = { baseline: baseline, decls: decls, current: {}, tokens: {} };
    }
    return rec.states[stateKey];
  }

  function manipActiveRecord(el) {
    var rec = manipEnsureRecord(el);
    if (manipActiveState === 'default') return rec;
    return manipStateRecord(rec, manipActiveState, el);
  }

  // Property tweaks and component-class swaps both count as changes
  function manipRecordChangeCount(rec) {
    if (!rec) return 0;
    var total = Object.keys(rec.current).length + Object.keys(rec.classSwaps || {}).length;
    Object.keys(rec.states || {}).forEach(function(key) {
      total += Object.keys(rec.states[key].current).length;
    });
    return total;
  }

  // ---- Selection overlay (size readout) ----
  // No box outline or resize handles here: the claude-design-selected class
  // already outlines the element, and W/H are edited in the design panel.

  function buildManipOverlay() {
    removeManipOverlay();
    var label = document.createElement('div');
    label.className = 'claude-design-manip-sizelabel';
    document.body.appendChild(label);
    manipOverlay = { label: label };
  }

  function removeManipOverlay() {
    if (!manipOverlay) return;
    manipOverlay.label.remove();
    manipOverlay = null;
  }

  function positionManipOverlay() {
    if (!manipOverlay || !manipSelected || !manipSelected.isConnected) return;
    var r = manipSelected.getBoundingClientRect();
    var label = manipOverlay.label;
    label.textContent = Math.round(r.width) + ' \\u00d7 ' + Math.round(r.height);
    var labelTop = r.bottom + 8;
    if (labelTop > window.innerHeight - 30) labelTop = r.top - 26;
    label.style.top = labelTop + 'px';
    label.style.left = Math.max(4, r.left + r.width / 2 - label.offsetWidth / 2) + 'px';
  }

  function queueManipReposition() {
    if (manipRepositionQueued) return;
    manipRepositionQueued = true;
    requestAnimationFrame(function() {
      manipRepositionQueued = false;
      positionManipOverlay();
      // Resizing moves the element's rect, so keep the popover glued to it
      if (popoverElement) positionPopover();
      if (codeButtonElement) positionCodeButton();
      // Frozen during a hover preview: the row under the cursor must not move
      if (!manipPreview) positionManipPresets();
    });
  }

  // ---- Design flyout: opened from the sliders button in the prompt box ----

  var MANIP_CARET_SVG = '<svg viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1.5L5 4.5L9 1.5"/></svg>';

  // A caret that opens the project scale for one or more props. The prefix
  // overrides the Tailwind prefix the scale is read from (a padding row applies
  // to all four sides, so it lists p-* rather than pt-*).
  function manipPresetBtnHtml(props, prefix, label, text) {
    return '<button class="claude-design-manip-preset-btn' + (text ? ' claude-design-manip-cross-all' : '') + '"' +
      ' data-props="' + props.join(',') + '"' +
      (prefix ? ' data-prefix="' + prefix + '"' : '') +
      ' title="' + (label || 'Project scale') + '" tabindex="-1">' +
      (text ? '<span>' + text + '</span>' : '') + MANIP_CARET_SVG + '</button>';
  }

  // Box-model cross: one field per side, laid out where that side sits on the
  // element, each with its own scale. The centre opens the scale for all four.
  function manipCrossHtml(kind) {
    function cell(pos, prop) {
      return '<span class="claude-design-manip-cross-' + pos + ' claude-design-manip-fieldwrap">' +
        '<span class="claude-design-manip-field" data-prop="' + prop + '" title="' + prop + '"></span>' +
        manipPresetBtnHtml([prop], null, prop + ' scale') +
      '</span>';
    }
    var sides = [kind + '-top', kind + '-right', kind + '-bottom', kind + '-left'];
    return '<div class="claude-design-manip-cross">' +
      cell('t', sides[0]) +
      cell('l', sides[3]) +
      '<span class="claude-design-manip-cross-c">' +
        manipPresetBtnHtml(sides, kind === 'margin' ? 'm' : 'p', kind + ' scale (all sides)', kind) +
      '</span>' +
      cell('r', sides[1]) +
      cell('b', sides[2]) +
    '</div>';
  }

  // Component section: only rendered when the element actually belongs to a
  // class family with alternatives (see manipClassFamilies)
  function manipComponentSectionHtml(families) {
    if (!families.length) return '';
    var html = '';
    families.forEach(function(fam, fi) {
      html += '<div class="claude-design-manip-section">' +
        '<div class="claude-design-manip-section-label">' +
          (fam.kind === 'variant' ? escapeHtml(fam.base)
            : families.length > 1 ? 'Component \\u00b7 ' + escapeHtml(fam.base) : 'Component') +
        '</div>';
      fam.groups.forEach(function(group) {
        html += manipLabelHtml(group.label, group !== fam.groups[0]) +
          '<button class="claude-design-manip-preset-btn claude-design-manip-fieldbtn claude-design-manip-classbtn"' +
            ' data-fam="' + fi + '" data-group="' + group.key + '"' +
            ' title="' + escapeHtml(fam.base) + ' ' + group.label.toLowerCase() + '" tabindex="-1">' +
            '<span class="claude-design-manip-classbtn-value"></span>' + MANIP_CARET_SVG +
          '</button>';
      });
      html += '</div>';
    });
    return html;
  }

  function manipColorRowHtml(prop) {
    return '<div class="claude-design-manip-color-row" data-prop="' + prop + '">' +
      '<input type="color" data-prop="' + prop + '">' +
      '<span class="claude-design-manip-color-hex"></span>' +
      '<span class="claude-design-manip-field claude-design-manip-alpha" data-prop="' + prop + '"' +
        ' data-view="alpha" title="opacity %"></span>' +
      '<span class="claude-design-manip-glyph">%</span>' +
      manipPresetBtnHtml([prop], null, 'Project colors') +
    '</div>';
  }

  function manipLabelHtml(text, spaced) {
    return '<div class="claude-design-manip-sublabel' + (spaced ? ' spaced' : '') + '">' + text + '</div>';
  }

  // A field plus its scale caret. The field element itself stays a bare box —
  // scrub and type-to-edit rewrite its contents.
  // The wrapper is the box you see: an optional glyph, the scrub/type target,
  // and the caret onto the project's scale.
  function manipFieldHtml(prop, glyph) {
    return '<span class="claude-design-manip-fieldwrap">' +
      (glyph ? '<span class="claude-design-manip-glyph">' + glyph + '</span>' : '') +
      '<span class="claude-design-manip-field" data-prop="' + prop + '" title="' + prop + '"></span>' +
      manipPresetBtnHtml([prop]) +
    '</span>';
  }

  // Keyword properties (border-style) get a button that opens their choices
  function manipChoiceHtml(prop) {
    return '<button class="claude-design-manip-preset-btn claude-design-manip-fieldbtn claude-design-manip-choice"' +
      ' data-choice="' + prop + '" title="' + prop + '" tabindex="-1">' +
      '<span class="claude-design-manip-classbtn-value"></span>' + MANIP_CARET_SVG +
    '</button>';
  }

  // A labelled half-width cell in the two-column grid
  function manipCellHtml(label, inner) {
    return '<div class="claude-design-manip-cell">' + manipLabelHtml(label) + inner + '</div>';
  }

  function openManipFlyout() {
    var el = manipSelected;
    if (!el || !popoverElement) return;
    if (manipPanel) manipPanel.remove();
    manipPagePresetCache = {};
    // Computed once per open: the sibling scan is too costly to redo on every refresh
    manipPanelFamilies = manipClassFamilies(el);

    var flyout = document.createElement('div');
    flyout.className = 'claude-design-manip-flyout';
    manipPanel = flyout;

    var computed = window.getComputedStyle(el);
    var display = computed.getPropertyValue('display');
    var showGap = display.indexOf('flex') !== -1 || display.indexOf('grid') !== -1;

    // Groups the element actually has something to say about
    var tabs = [];
    if (manipPanelFamilies.length) {
      tabs.push({
        key: 'component',
        label: manipPanelFamilies.length === 1 ? manipPanelFamilies[0].base : 'Component',
        body: manipComponentSectionHtml(manipPanelFamilies)
      });
    }
    tabs.push({ key: 'layout', label: 'Layout', body:
      '<div class="claude-design-manip-section">' +
        manipLabelHtml('Dimensions') +
        '<div class="claude-design-manip-grid">' +
          manipFieldHtml('width', 'W') +
          manipFieldHtml('height', 'H') +
        '</div>' +
        '<div class="claude-design-manip-grid">' +
          manipCellHtml('Corner radius', manipFieldHtml('border-radius')) +
          (showGap ? manipCellHtml('Gap', manipFieldHtml('gap')) : '<div class="claude-design-manip-cell"></div>') +
        '</div>' +
      '</div>' });
    tabs.push({ key: 'spacing', label: 'Spacing', body:
      '<div class="claude-design-manip-section">' +
        manipLabelHtml('Margin') +
        manipCrossHtml('margin') +
        manipLabelHtml('Padding', true) +
        manipCrossHtml('padding') +
      '</div>' });
    // Type controls only earn their tab when there is text to style
    if ((el.textContent || '').trim()) {
      tabs.push({ key: 'text', label: 'Text', body:
        '<div class="claude-design-manip-section">' +
          '<div class="claude-design-manip-grid">' +
            manipCellHtml('Size', manipFieldHtml('font-size')) +
            manipCellHtml('Weight', manipFieldHtml('font-weight')) +
          '</div>' +
          '<div class="claude-design-manip-grid">' +
            manipCellHtml('Line height', manipFieldHtml('line-height')) +
            manipCellHtml('Letter spacing', manipFieldHtml('letter-spacing')) +
          '</div>' +
        '</div>' });
    }
    tabs.push({ key: 'border', label: 'Border', body:
      '<div class="claude-design-manip-section">' +
        '<div class="claude-design-manip-grid">' +
          manipCellHtml('Width', manipFieldHtml('border-width')) +
          manipCellHtml('Style', manipChoiceHtml('border-style')) +
        '</div>' +
        manipLabelHtml('Color', true) +
        manipColorRowHtml('border-color') +
      '</div>' });
    tabs.push({ key: 'color', label: 'Color', body:
      '<div class="claude-design-manip-section">' +
        // Full width: a swatch, hex and opacity do not fit in half a row
        manipLabelHtml('Text') +
        manipColorRowHtml('color') +
        manipLabelHtml('Fill', true) +
        manipColorRowHtml('background-color') +
      '</div>' });

    var hasActive = tabs.some(function(tab) { return tab.key === manipActiveTab; });
    if (!hasActive) manipActiveTab = tabs[0].key;

    var html = '' +
      '<div class="claude-design-manip-flyout-header">' +
        '<span class="claude-design-manip-flyout-title">' + escapeHtml(generateDisplaySelector(el)) + '</span>' +
        (manipIsTailwindProject()
          ? '<button class="claude-design-manip-statebtn" title="Which state these controls edit">' +
              '<span class="claude-design-manip-statebtn-value"></span>' + MANIP_CARET_SVG +
            '</button>'
          : '') +
        '<button class="claude-design-manip-flyout-reset hidden" title="Reset changes to this element">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>' +
          '</svg>' +
        '</button>' +
      '</div>' +
      '<div class="claude-design-manip-tabs">' +
        tabs.map(function(tab) {
          return '<button class="claude-design-manip-tab' + (tab.key === manipActiveTab ? ' active' : '') + '"' +
            ' data-tab="' + tab.key + '">' + escapeHtml(tab.label) +
            '<span class="claude-design-manip-tab-dot"></span></button>';
        }).join('') +
      '</div>' +
      tabs.map(function(tab) {
        return '<div class="claude-design-manip-pane' + (tab.key === manipActiveTab ? ' active' : '') + '"' +
          ' data-tab="' + tab.key + '">' + tab.body + '</div>';
      }).join('');

    flyout.innerHTML = '<div class="claude-design-manip-clip"><div class="claude-design-manip-scroll">' + html + '</div></div>';
    var inputRow = popoverElement.querySelector('.claude-design-popover-input-row');
    if (!inputRow) return;
    inputRow.appendChild(flyout);
    inputRow.classList.add('has-design-panel');
    // The panel scrolls, and the dropdown is fixed to its caret — keep them together
    flyout.querySelector('.claude-design-manip-scroll').addEventListener('scroll', function() {
      manipEndPreview();
      positionManipPresets();
    });

    function showTab(key) {
      if (!manipPanel || key === manipActiveTab) return;
      manipActiveTab = key;
      manipEndPreview();
      closeManipPresets();
      flyout.querySelectorAll('.claude-design-manip-tab').forEach(function(other) {
        other.classList.toggle('active', other.getAttribute('data-tab') === key);
      });
      flyout.querySelectorAll('.claude-design-manip-pane').forEach(function(pane) {
        pane.classList.toggle('active', pane.getAttribute('data-tab') === key);
      });
      // Panes differ in height. Re-anchoring while the pointer is on the tab row
      // could slide the tabs out from under it, so that waits until it leaves.
      if (popoverElement && !manipTabHovering) positionPopover();
      refreshManipPanelValues();
    }

    var stateBtn = flyout.querySelector('.claude-design-manip-statebtn');
    if (stateBtn) {
      stateBtn.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); }, true);
      stateBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (manipPresetsAnchor === stateBtn) return closeManipPresets();
        openManipStateMenu(stateBtn);
      });
    }

    var tabsRow = flyout.querySelector('.claude-design-manip-tabs');
    if (tabsRow) {
      tabsRow.addEventListener('mouseenter', function() { manipTabHovering = true; });
      tabsRow.addEventListener('mouseleave', function() {
        manipTabHovering = false;
        clearTimeout(manipTabHoverTimer);
        if (popoverElement) positionPopover();
      });
    }

    flyout.querySelectorAll('.claude-design-manip-tab').forEach(function(tabEl) {
      var key = tabEl.getAttribute('data-tab');
      // Hover navigates, after a beat — a pointer sweeping across the row
      // shouldn't flick through every group on the way past
      tabEl.addEventListener('mouseenter', function() {
        if (manipDrag || manipPresetsMenu) return;
        clearTimeout(manipTabHoverTimer);
        manipTabHoverTimer = setTimeout(function() { showTab(key); }, 70);
      });
      tabEl.addEventListener('mouseleave', function() { clearTimeout(manipTabHoverTimer); });
      tabEl.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        clearTimeout(manipTabHoverTimer);
        showTab(key);
      });
      tabEl.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); }, true);
    });

    flyout.querySelector('.claude-design-manip-flyout-reset').addEventListener('click', function(e) {
      e.stopPropagation();
      if (manipSelected) manipResetElement(manipSelected);
    });
    flyout.querySelectorAll('.claude-design-manip-field').forEach(function(fieldEl) {
      fieldEl.addEventListener('mousedown', function(e) { startManipScrub(e, fieldEl); }, true);
      // Arrow keys nudge whichever field the cursor is over
      fieldEl.addEventListener('mouseenter', function() { manipHoverField = fieldEl; });
      fieldEl.addEventListener('mouseleave', function() { if (manipHoverField === fieldEl) manipHoverField = null; });
    });
    flyout.querySelectorAll('.claude-design-manip-preset-btn').forEach(function(btn) {
      btn.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); }, true);
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (manipPresetsAnchor === btn) closeManipPresets();
        else openManipPresets(btn);
      });
    });
    flyout.querySelectorAll('input[type="color"]').forEach(function(input) {
      input.addEventListener('input', function() {
        if (!manipSelected) return;
        var prop = input.getAttribute('data-prop');
        manipSetProp(manipSelected, prop, manipColorWithAlpha(input.value, manipKeepAlpha(manipSelected, prop)));
        refreshManipPanelValues();
      });
      input.addEventListener('mousedown', function(e) { e.stopPropagation(); });
      input.addEventListener('click', function(e) { e.stopPropagation(); });
    });

    refreshManipPanelValues();
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        if (manipPanel === flyout) flyout.classList.add('visible');
        manipTrackPopoverWhileAnimating();
      });
    });
    updateManipDesignButton();
  }

  function closeManipFlyout(immediate) {
    var panel = manipPanel;
    if (!panel) return;
    clearTimeout(manipTabHoverTimer);
    manipTabHovering = false;
    closeManipPresets();
    manipHoverField = null;
    manipPanel = null;
    var inputRow = panel.parentNode;
    function detach() {
      panel.remove();
      if (popoverElement) positionPopover();
    }
    // Rounding the corners back is part of the collapse, so it starts now
    if (inputRow && inputRow.classList) inputRow.classList.remove('has-design-panel');
    if (immediate) {
      detach();
    } else {
      panel.classList.remove('visible');
      manipTrackPopoverWhileAnimating();
      setTimeout(detach, 220);
    }
    updateManipDesignButton();
  }

  // The box changes height for the length of the open/close, and the popover is
  // anchored to the element — follow it every frame or it drifts as it grows.
  function manipTrackPopoverWhileAnimating() {
    var frames = 0;
    (function step() {
      if (!popoverElement || frames++ > 20) return;
      positionPopover();
      requestAnimationFrame(step);
    })();
  }

  function toggleManipFlyout() {
    if (manipPanel) {
      manipFlyoutOpen = false;
      closeManipFlyout(false);
    } else {
      manipFlyoutOpen = true;
      openManipFlyout();
    }
  }

  // ---- Project scale dropdown ----

  function closeManipPresets() {
    manipEndPreview();
    if (manipPresetsAnchor) manipPresetsAnchor.classList.remove('open');
    if (manipPresetsMenu) manipPresetsMenu.remove();
    manipPresetsMenu = null;
    manipPresetsAnchor = null;
  }

  // The class menu lists the family's other modifiers, plus a way back to the
  // component's default (no modifier)
  function openManipClassMenu(btn) {
    var fam = manipPanelFamilies[parseInt(btn.getAttribute('data-fam'), 10)];
    var groupKey = btn.getAttribute('data-group');
    if (!fam) return;
    if (fam.kind === 'variant') return openManipVariantMenu(btn, fam, groupKey);
    var group = manipFindGroup(fam, groupKey);
    if (!group) return;

    var currentCls = manipCurrentClassFor(manipSelected, fam, groupKey);
    var items = group.mods.map(function(mod) {
      return { name: fam.base + fam.sep + mod, mod: mod };
    });
    items.push({ name: 'None', mod: null });

    var html = '<div class="claude-design-manip-presets-head">' + escapeHtml(fam.base) + ' \\u00b7 ' + group.label + '</div>';
    items.forEach(function(item, i) {
      var isCurrent = item.mod ? (fam.base + fam.sep + item.mod) === currentCls : !currentCls;
      html += '<div class="claude-design-manip-preset-item' + (isCurrent ? ' current' : '') + '" data-i="' + i + '">' +
        '<span class="claude-design-manip-preset-name">' + escapeHtml(item.name) + '</span>' +
      '</div>';
    });

    showManipMenu(btn, html, {
      onPreview: function(i) {
        manipPreviewClasses(manipSelected, function() {
          manipApplyClassPreview(manipSelected, fam, groupKey, items[i].mod);
        });
      },
      onPick: function(i) { manipSetClassMod(manipSelected, fam, groupKey, items[i].mod); }
    });
  }

  // cva/tailwind-variants options, named as they are in the source
  function openManipVariantMenu(btn, fam, groupKey) {
    var entry = manipFindGroup(fam, groupKey);
    if (!entry) return;
    var group = entry.group;
    var current = manipCurrentVariantOption(manipSelected, fam.set, group);

    var html = '<div class="claude-design-manip-presets-head">' +
      escapeHtml(fam.set.name) + ' \\u00b7 ' + escapeHtml(group.name) + '</div>';
    group.options.forEach(function(option, i) {
      html += '<div class="claude-design-manip-preset-item' + (option.name === current ? ' current' : '') + '" data-i="' + i + '">' +
        '<span class="claude-design-manip-preset-name">' + escapeHtml(option.name) + '</span>' +
        // Redundant when the option is literally called "default"
        (option.name === group.defaultOption && option.name !== 'default'
          ? '<span class="claude-design-manip-preset-value">default</span>' : '') +
      '</div>';
    });

    showManipMenu(btn, html, {
      onPreview: function(i) {
        manipPreviewClasses(manipSelected, function() {
          manipApplyVariantClasses(manipSelected, fam, groupKey, group.options[i].name);
        });
      },
      onPick: function(i) { manipSetVariantOption(manipSelected, fam, groupKey, group.options[i].name); }
    });
  }

  // ---- Hover preview ----
  // Hovering a dropdown row shows the value on the element without committing
  // it: the change record and the undo history are untouched, so scrubbing down
  // a long list costs nothing and leaves nothing behind. Clicking commits it
  // through the normal path; leaving the menu puts the element back.

  function manipEndPreview() {
    if (!manipPreview) return;
    var restore = manipPreview;
    manipPreview = null;
    restore();
    refreshManipPanelValues();
    queueManipReposition();
  }

  function manipPreviewProps(el, values) {
    manipEndPreview();
    var saved = Object.keys(values).map(function(prop) {
      return { prop: prop, value: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop) };
    });
    manipPreview = function() {
      saved.forEach(function(entry) {
        if (entry.value) el.style.setProperty(entry.prop, entry.value, entry.priority);
        else el.style.removeProperty(entry.prop);
      });
    };
    Object.keys(values).forEach(function(prop) { el.style.setProperty(prop, values[prop], 'important'); });
    refreshManipPanelValues();
  }

  // Class swaps restore wholesale — exact, whatever the swap touched
  function manipPreviewClasses(el, apply) {
    manipEndPreview();
    var before = el.getAttribute('class') || '';
    manipPreview = function() { el.setAttribute('class', before); };
    apply();
    refreshManipPanelValues();
  }

  // Build, show and wire a dropdown for one caret button. Callers only supply
  // the markup and what to do with the chosen index.
  function showManipMenu(btn, html, opts) {
    var menu = document.createElement('div');
    menu.className = 'claude-design-manip-presets' + (opts.className ? ' ' + opts.className : '');
    menu.innerHTML = html;
    document.body.appendChild(menu);

    menu.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); }, true);
    // One handler on the menu: moving between rows swaps the preview, leaving
    // the menu entirely puts the element back
    menu.addEventListener('mouseleave', manipEndPreview);
    menu.querySelectorAll('[data-i]').forEach(function(itemEl) {
      var index = parseInt(itemEl.getAttribute('data-i'), 10);
      itemEl.addEventListener('mouseenter', function() {
        if (manipSelected && opts.onPreview) opts.onPreview(index);
      });
      itemEl.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        // Commit from the real state, not from the preview
        manipEndPreview();
        if (manipSelected) {
          opts.onPick(index);
          refreshManipPanelValues();
        }
        closeManipPresets();
      });
    });

    manipPresetsMenu = menu;
    manipPresetsAnchor = btn;
    btn.classList.add('open');
    positionManipPresets();
    // Keep the value in effect in view in a long list
    var currentEl = menu.querySelector('.current');
    if (currentEl) menu.scrollTop = Math.max(0, currentEl.offsetTop - menu.clientHeight / 2);
  }

  function openManipStateMenu(btn) {
    closeManipPresets();
    if (!manipSelected) return;
    var rec = manipChanges.get(manipSelected);
    var options = [{ key: 'default', label: 'Default' }].concat(MANIP_STATES);
    var html = '<div class="claude-design-manip-presets-head">State</div>';
    options.forEach(function(option, i) {
      var count = option.key === 'default'
        ? (rec ? Object.keys(rec.current).length + Object.keys(rec.classSwaps || {}).length : 0)
        : (rec && rec.states && rec.states[option.key] ? Object.keys(rec.states[option.key].current).length : 0);
      html += '<div class="claude-design-manip-preset-item' + (option.key === manipActiveState ? ' current' : '') + '" data-i="' + i + '">' +
        '<span class="claude-design-manip-preset-name">' + option.label + '</span>' +
        (count ? '<span class="claude-design-manip-preset-value">' + count + '</span>' : '') +
      '</div>';
    });
    showManipMenu(btn, html, {
      onPick: function(i) {
        var key = options[i].key;
        if (key === 'default') manipLeaveState(manipSelected);
        else manipEnterState(manipSelected, key);
      }
    });
  }

  function openManipChoiceMenu(btn) {
    var prop = btn.getAttribute('data-choice');
    var meta = MANIP_PROPS[prop] || {};
    var choices = meta.choices || [];
    var current = window.getComputedStyle(manipSelected).getPropertyValue(meta.readProp || prop).trim();
    var html = '<div class="claude-design-manip-presets-head">' + escapeHtml(prop) + '</div>';
    choices.forEach(function(choice, i) {
      html += '<div class="claude-design-manip-preset-item' + (choice === current ? ' current' : '') + '" data-i="' + i + '">' +
        '<span class="claude-design-manip-preset-name">' + choice + '</span>' +
      '</div>';
    });
    showManipMenu(btn, html, {
      onPreview: function(i) {
        manipPreviewProps(manipSelected, manipChoiceValues(prop, choices[i]));
      },
      onPick: function(i) {
        manipUndoBeginBatch();
        var values = manipChoiceValues(prop, choices[i]);
        Object.keys(values).forEach(function(key) { manipSetProp(manipSelected, key, values[key]); });
        manipUndoEndBatch();
      }
    });
  }

  // Width alone shows nothing while the style is none, so a visible style
  // brings a width with it
  function manipChoiceValues(prop, choice) {
    var values = {};
    values[prop] = choice;
    if (prop === 'border-style' && choice !== 'none' &&
        manipCurrentNumeric(manipSelected, 'border-width') === 0) {
      values['border-width'] = '1px';
    }
    return values;
  }

  function openManipPresets(btn) {
    closeManipPresets();
    if (!manipSelected) return;
    if (btn.hasAttribute('data-choice')) return openManipChoiceMenu(btn);
    if (btn.hasAttribute('data-fam')) return openManipClassMenu(btn);
    var props = (btn.getAttribute('data-props') || '').split(',').filter(Boolean);
    if (!props.length) return;
    var prop = props[0];
    var prefix = btn.getAttribute('data-prefix') || MANIP_TOKEN_PREFIX[prop];
    var res = manipPresetsFor(prop, prefix);
    var meta = MANIP_PROPS[prop] || {};

    var isColor = res.kind === 'color';
    // What counts as "the current one": a matching color, or a matching number
    var currentColor = isColor ? manipNormalizeColor(window.getComputedStyle(manipSelected).getPropertyValue(prop)) : null;
    var currentValue = isColor ? 0 : manipCurrentNumeric(manipSelected, prop);
    var flat = [];
    var html = '';

    res.groups.forEach(function(group) {
      if (!group.items.length) return;
      html += '<div class="claude-design-manip-presets-head">' + escapeHtml(group.head) + '</div>';
      // Colors read better as a swatch grid than as a list of hex values
      if (isColor) html += '<div class="claude-design-manip-preset-grid">';
      group.items.forEach(function(item) {
        var i = flat.push(item) - 1;
        if (isColor) {
          html += '<span class="claude-design-manip-preset-swatch' + (item.color === currentColor ? ' current' : '') + '"' +
            ' data-i="' + i + '" style="background:' + escapeHtml(item.color) + '"' +
            ' title="' + escapeHtml(item.name + '  ' + item.color) + '"></span>';
          return;
        }
        var px = meta.decimals ? Math.round(item.px * 10) / 10 : Math.round(item.px);
        html += '<div class="claude-design-manip-preset-item' + (Math.abs(item.px - currentValue) < 0.5 ? ' current' : '') + '" data-i="' + i + '">' +
          '<span class="claude-design-manip-preset-name">' + escapeHtml(item.name) + '</span>' +
          '<span class="claude-design-manip-preset-value">' + (item.hint ? escapeHtml(item.hint) : px + (meta.unit || '')) + '</span>' +
        '</div>';
      });
      if (isColor) html += '</div>';
    });
    if (!flat.length) {
      html += '<div class="claude-design-manip-presets-empty">' + (isColor ? 'No colors found' : 'No scale found') + '</div>';
    }

    showManipMenu(btn, html, {
      className: isColor ? 'colors' : '',
      onPreview: function(i) { manipPreviewProps(manipSelected, manipPresetValues(props, flat[i])); },
      onPick: function(i) { applyManipPreset(props, flat[i]); }
    });
  }

  function positionManipPresets() {
    if (!manipPresetsMenu || !manipPresetsAnchor || !manipPresetsAnchor.isConnected) return;
    var br = manipPresetsAnchor.getBoundingClientRect();
    var w = manipPresetsMenu.offsetWidth || 152;
    var h = manipPresetsMenu.offsetHeight || 200;
    // Hangs down-right from the caret like a select; flips to right-aligned
    // (and/or upward) only when it would leave the viewport
    var left = br.left;
    if (left + w > window.innerWidth - 8) left = br.right - w;
    left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - w - 8));
    var top = br.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, br.top - h - 4);
    manipPresetsMenu.style.left = left + 'px';
    manipPresetsMenu.style.top = top + 'px';
  }

  // The css each prop takes for this option — shared by commit and preview
  function manipPresetValues(props, item) {
    var values = {};
    if (!item) return values;
    props.forEach(function(prop) {
      var meta = MANIP_PROPS[prop] || {};
      if (meta.color) {
        values[prop] = manipColorWithAlpha(item.color, manipKeepAlpha(manipSelected, prop));
        return;
      }
      var v = item.px;
      if (meta.min !== undefined) v = Math.max(meta.min, v);
      if (meta.max !== undefined) v = Math.min(meta.max, v);
      v = meta.decimals ? Math.round(v * 10) / 10 : Math.round(v);
      values[prop] = v + (meta.unit || '');
    });
    return values;
  }

  function applyManipPreset(props, item) {
    if (!item || !manipSelected) return;
    var values = manipPresetValues(props, item);
    manipUndoBeginBatch();
    props.forEach(function(prop) {
      var token = item.token;
      // A translucent colour is written bg-brand/10, so the token carries it
      if ((MANIP_PROPS[prop] || {}).color) {
        token = manipTokenWithAlpha(token, manipKeepAlpha(manipSelected, prop));
      }
      manipSetProp(manipSelected, prop, values[prop], token);
    });
    manipUndoEndBatch();
    refreshManipPanelValues();
  }

  // Sliders button in the prompt box: active while the flyout is open,
  // badge shows the selected element's pending change count
  function updateManipDesignButton() {
    if (!popoverElement) return;
    var btn = popoverElement.querySelector('.claude-design-popover-design-btn');
    if (!btn) return;
    btn.classList.toggle('active', !!manipPanel);
    var rec = manipSelected ? manipChanges.get(manipSelected) : null;
    var count = rec ? manipRecordChangeCount(rec) : 0;
    btn.classList.toggle('has-changes', count > 0);
    var badge = btn.querySelector('.claude-design-popover-design-count');
    if (badge) badge.textContent = String(count);
  }

  function refreshManipPanelValues() {
    // The button badge tracks changes even while the flyout is closed
    updateManipDesignButton();
    if (!manipPanel || !manipSelected || !manipSelected.isConnected) return;
    var el = manipSelected;
    var computed = window.getComputedStyle(el);
    var rec = manipChanges.get(el);

    manipPanel.querySelectorAll('.claude-design-manip-field').forEach(function(fieldEl) {
      if (fieldEl.querySelector('input')) return; // being edited by typing
      var prop = fieldEl.getAttribute('data-prop');
      if (fieldEl.getAttribute('data-view') === 'alpha') {
        fieldEl.textContent = String(manipReadField(el, prop, 'alpha'));
        fieldEl.classList.toggle('changed', !!(rec && rec.current[prop] !== undefined));
        return;
      }
      var meta = MANIP_PROPS[prop] || {};
      var raw = computed.getPropertyValue(meta.readProp || prop);
      var v = parseFloat(raw);
      var text;
      if (!isFinite(v)) {
        // "normal"/unset reads better as Auto than as a dash
        text = 'Auto';
      } else if (meta.decimals) {
        text = (Math.round(v * 10) / 10).toString();
      } else {
        text = Math.round(v).toString();
      }
      fieldEl.textContent = text;
      fieldEl.classList.toggle('changed', !!(rec && rec.current[prop] !== undefined));
    });

    var changedTabs = {};
    if (rec) {
      Object.keys(rec.current).forEach(function(prop) {
        var tab = MANIP_TAB_OF_PROP[prop];
        if (tab) changedTabs[tab] = true;
      });
      if (Object.keys(rec.classSwaps || {}).length) changedTabs.component = true;
    }
    manipPanel.querySelectorAll('.claude-design-manip-tab').forEach(function(tabEl) {
      tabEl.classList.toggle('changed', !!changedTabs[tabEl.getAttribute('data-tab')]);
    });
    var stateBtn = manipPanel.querySelector('.claude-design-manip-statebtn');
    if (stateBtn) {
      var label = 'Default';
      MANIP_STATES.forEach(function(state) { if (state.key === manipActiveState) label = state.label; });
      var valueEl = stateBtn.querySelector('.claude-design-manip-statebtn-value');
      if (valueEl) valueEl.textContent = label;
      stateBtn.classList.toggle('on-state', manipActiveState !== 'default');
    }

    manipPanel.querySelectorAll('.claude-design-manip-choice').forEach(function(btn) {
      var prop = btn.getAttribute('data-choice');
      var meta = MANIP_PROPS[prop] || {};
      var valueEl = btn.querySelector('.claude-design-manip-classbtn-value');
      if (valueEl) valueEl.textContent = computed.getPropertyValue(meta.readProp || prop).trim() || 'none';
      btn.classList.toggle('changed', !!(rec && rec.current[prop] !== undefined));
    });

    manipPanel.querySelectorAll('.claude-design-manip-classbtn').forEach(function(btn) {
      var fam = manipPanelFamilies[parseInt(btn.getAttribute('data-fam'), 10)];
      if (!fam) return;
      var groupKey = btn.getAttribute('data-group');
      var valueEl = btn.querySelector('.claude-design-manip-classbtn-value');
      var swapKey, cls;
      if (fam.kind === 'variant') {
        var vEntry = manipFindGroup(fam, groupKey);
        cls = vEntry ? manipCurrentVariantOption(el, fam.set, vEntry.group) : null;
        swapKey = fam.set.name + '|' + groupKey;
      } else {
        cls = manipCurrentClassFor(el, fam, groupKey);
        swapKey = fam.base + fam.sep + '|' + groupKey;
      }
      if (valueEl) valueEl.textContent = cls || 'Default';
      var swap = rec && rec.classSwaps ? rec.classSwaps[swapKey] : null;
      btn.classList.toggle('changed', !!swap);
      btn.classList.toggle('unset', !cls);
    });

    manipPanel.querySelectorAll('.claude-design-manip-color-row').forEach(function(row) {
      var prop = row.getAttribute('data-prop');
      var input = row.querySelector('input');
      var hexLabel = row.querySelector('.claude-design-manip-color-hex');
      var parts = manipColorParts(el, prop);
      if (document.activeElement !== input) input.value = parts.hex;
      hexLabel.textContent = parts.hex;
      row.classList.toggle('changed', !!(rec && rec.current[prop] !== undefined));
    });

    // Header shows how many tweaks this element carries; Reset appears with them
    var count = rec ? manipRecordChangeCount(rec) : 0;
    var resetBtn = manipPanel.querySelector('.claude-design-manip-flyout-reset');
    if (resetBtn) resetBtn.classList.toggle('hidden', count === 0);
  }

  // ---- Interactions: attach, resize, move, scrub, type ----

  // Called when the annotation popover opens on an element: puts resize
  // the size readout on it, and reopens the design flyout if it was open before.
  function manipAttach(el) {
    manipDetach();
    manipSelected = el;
    manipEnsureRecord(el);
    buildManipOverlay();
    positionManipOverlay();
    // A new prompt box starts with the panel closed, so the box stays out of
    // the way. "Persistent design panel" in Settings keeps it open instead.
    if (!manipPanelPersistent) manipFlyoutOpen = false;
    if (manipFlyoutOpen) openManipFlyout();
    updateManipDesignButton();
  }

  // Called when the popover closes. Untouched records are pruned; real
  // tweaks stay tracked (and previewed) so reselecting the element resumes.
  // Dropping the selection without sending discards the tweaks: the preview
  // reverts and the page matches the code again. Sending (or Add) consumes the
  // deltas first, so by the time this runs there is nothing left to undo.
  function manipDetach() {
    // Close the dropdown directly: closeManipFlyout bails early when the panel
    // is already gone, which would strand the menu on the page
    closeManipPresets();
    if (manipSelected) manipLeaveState(manipSelected);
    closeManipFlyout(true);
    if (manipSelected) {
      var rec = manipChanges.get(manipSelected);
      // Reverting is itself an undo step, so Cmd+Z brings the tweaks back
      // (with their tracking) after an accidental Escape or click-away
      if (rec && manipRecordChangeCount(rec) > 0) manipResetElement(manipSelected);
      manipChanges.delete(manipSelected);
    }
    manipSelected = null;
    manipDrag = null;
    removeManipOverlay();
  }

  function manipResetElement(el) {
    var rec = manipChanges.get(el);
    if (!rec) return;
    manipUndoBeginBatch();
    Object.keys(rec.current).forEach(function(p) {
      manipUndoRecord(el, p);
      manipRestoreInline(el, rec, p);
    });
    var families = null;
    Object.keys(rec.classSwaps || {}).forEach(function(key) {
      var swap = rec.classSwaps[key];
      if (swap.isVariant) {
        if (!families) families = manipClassFamilies(el);
        var fam = null;
        families.forEach(function(f) { if (f.kind === 'variant' && f.set.name === swap.component) fam = f; });
        if (fam) manipSetVariantOption(el, fam, swap.group, swap.from);
        return;
      }
      manipUndoRecordClass(el, swap.fam, swap.group, swap.to);
      if (swap.to) el.classList.remove(swap.to);
      if (swap.from) el.classList.add(swap.from);
    });
    manipUndoEndBatch();
    rec.current = {};
    rec.tokens = {};
    rec.classSwaps = {};
    queueManipReposition();
    refreshManipPanelValues();
  }

  function startManipScrub(e, fieldEl) {
    if (!manipSelected) return;
    e.preventDefault();
    e.stopPropagation();
    manipUndoBeginBatch();
    var prop = fieldEl.getAttribute('data-prop');
    var view = fieldEl.getAttribute('data-view');
    manipDrag = {
      kind: 'scrub', prop: prop, view: view, fieldEl: fieldEl,
      startX: e.clientX,
      startVal: manipReadField(manipSelected, prop, view),
      moved: false
    };
    fieldEl.classList.add('scrubbing');
  }

  // One arrow-key step for a property: Shift = 10x, Alt = fine (0.1x),
  // clamped and rounded the same way scrubbing is.
  function manipStepValue(prop, from, dir, ev, metaOverride) {
    var meta = metaOverride || MANIP_PROPS[prop] || {};
    var mult = ev && ev.shiftKey ? 10 : (ev && ev.altKey ? 0.1 : 1);
    var v = from + dir * (meta.step || 1) * mult;
    if (meta.min !== undefined) v = Math.max(meta.min, v);
    if (meta.max !== undefined) v = Math.min(meta.max, v);
    if (meta.step === 100) v = Math.round(v / 100) * 100;
    else if (meta.decimals) v = Math.round(v * 10) / 10;
    else v = Math.round(v);
    return v;
  }

  // Nudge the field the cursor is over (no typing needed)
  function nudgeManipField(fieldEl, dir, ev) {
    var el = manipSelected;
    if (!el || !fieldEl) return;
    var prop = fieldEl.getAttribute('data-prop');
    var view = fieldEl.getAttribute('data-view');
    var meta = manipFieldMeta(prop, view);
    if (meta.color) return;
    var v = manipStepValue(prop, manipReadField(el, prop, view), dir, ev, meta);
    manipWriteField(el, prop, view, v);
    refreshManipPanelValues();
  }

  function beginManipFieldEdit(fieldEl, prop) {
    var el = manipSelected;
    if (!el) return;
    var view = fieldEl.getAttribute('data-view');
    var meta = manipFieldMeta(prop, view);
    var cur = manipReadField(el, prop, view);
    var display = meta.decimals ? (Math.round(cur * 10) / 10) : Math.round(cur);
    fieldEl.innerHTML = '<input class="claude-design-manip-field-input" type="text">';
    var input = fieldEl.querySelector('input');
    input.value = String(display);
    input.focus();
    input.select();

    var done = false;
    function commit() {
      if (done) return;
      done = true;
      var v = parseFloat(input.value);
      if (isFinite(v)) {
        if (meta.min !== undefined) v = Math.max(meta.min, v);
        if (meta.max !== undefined) v = Math.min(meta.max, v);
        if (meta.step === 100) v = Math.round(v / 100) * 100;
        manipWriteField(el, prop, view, v);
      }
      // Drop the input so the field goes back to displaying its value
      fieldEl.textContent = '';
      refreshManipPanelValues();
    }
    input.addEventListener('keydown', function(ev) {
      ev.stopPropagation();
      if (ev.key === 'Enter') commit();
      if (ev.key === 'Escape') { done = true; fieldEl.textContent = ''; refreshManipPanelValues(); }
      // Up/down nudge the value and preview it live, leaving the field open
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        var from = parseFloat(input.value);
        if (!isFinite(from)) from = manipReadField(el, prop, view);
        var next = manipStepValue(prop, from, ev.key === 'ArrowUp' ? 1 : -1, ev, meta);
        input.value = String(next);
        input.select();
        manipWriteField(el, prop, view, next);
        refreshManipPanelValues();
      }
    });
    input.addEventListener('blur', commit);
    input.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
  }

  function handleManipMouseDown(e) {
    if (!annotateMode || e.button !== 0) return;
    // A fresh press starts a new gesture; a suppress flag from a drag whose
    // click never fired (mousedown/mouseup on different targets) is stale now
    if (!manipDrag) manipSuppressClick = false;
    if (isManipUiTarget(e.target)) return;
    // Dragging anywhere inside the selection nudges it via margins. A press
    // that never crosses the threshold falls through as a normal click.
    if (manipSelected && (e.target === manipSelected || manipSelected.contains(e.target))) {
      e.preventDefault();
      e.stopPropagation();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      manipUndoBeginBatch();
      var computed = window.getComputedStyle(manipSelected);
      manipDrag = {
        kind: 'move', started: false,
        startX: e.clientX, startY: e.clientY,
        startML: parseFloat(computed.getPropertyValue('margin-left')) || 0,
        startMT: parseFloat(computed.getPropertyValue('margin-top')) || 0
      };
    }
  }

  function handleManipMouseMove(e) {
    if (!manipDrag) return;
    e.preventDefault();
    e.stopPropagation();
    var el = manipSelected;
    if (!el) return;

    if (manipDrag.kind === 'move') {
      var mdx = e.clientX - manipDrag.startX;
      var mdy = e.clientY - manipDrag.startY;
      if (!manipDrag.started && Math.abs(mdx) < 4 && Math.abs(mdy) < 4) return;
      manipDrag.started = true;
      manipSetProp(el, 'margin-left', Math.round(manipDrag.startML + mdx) + 'px');
      manipSetProp(el, 'margin-top', Math.round(manipDrag.startMT + mdy) + 'px');
    } else if (manipDrag.kind === 'scrub') {
      var sdx = e.clientX - manipDrag.startX;
      if (Math.abs(sdx) > 2) manipDrag.moved = true;
      var meta = manipFieldMeta(manipDrag.prop, manipDrag.view);
      var mult = e.shiftKey ? 10 : (e.altKey ? 0.1 : 1);
      var v = manipDrag.startVal + sdx * (meta.step || 1) * mult;
      if (meta.min !== undefined) v = Math.max(meta.min, v);
      if (meta.max !== undefined) v = Math.min(meta.max, v);
      if (meta.step === 100) v = Math.round(v / 100) * 100;
      else if (meta.decimals) v = Math.round(v * 10) / 10;
      else v = Math.round(v);
      manipWriteField(el, manipDrag.prop, manipDrag.view, v);
    }
    refreshManipPanelValues();
  }

  function handleManipMouseUp(e) {
    if (!manipDrag) return;
    var drag = manipDrag;
    manipDrag = null;
    manipUndoEndBatch();
    if (drag.kind === 'scrub') {
      drag.fieldEl.classList.remove('scrubbing');
      if (!drag.moved) {
        beginManipFieldEdit(drag.fieldEl, drag.prop);
        return;
      }
    }
    // A completed drag must not fall through as a click (Edit mode's click
    // handler would treat it as click-outside and cancel the popover)
    if (drag.kind === 'scrub' || (drag.kind === 'move' && drag.started)) {
      manipSuppressClick = true;
    }
    queueManipReposition();
    refreshManipPanelValues();
  }

  function handleManipKeyDown(e) {
    if (!annotateMode) return;
    var a = document.activeElement;

    // Cmd/Ctrl+Z steps back through design tweaks (Shift to redo). A field
    // being typed in keeps its own undo, and once the design history is empty
    // the key falls through to the browser (prompt-box text undo).
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
      var typingInPanel = a && manipPanel && manipPanel.contains(a) && a.tagName === 'INPUT';
      if (!typingInPanel) {
        var stack = e.shiftKey ? manipRedoStack : manipUndoStack;
        if (stack.length) {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) manipRedo();
          else manipUndo();
          return;
        }
      }
    }

    if (!manipSelected) return;
    // Up/down over a design field nudge that value instead of moving the
    // element — the cursor says which control the arrows belong to, so this
    // wins even while the prompt box has focus. A field being typed in is
    // handled by its own input, so leave that one alone.
    var editingInPanel = a && manipPanel && manipPanel.contains(a);
    if (!editingInPanel && manipHoverField && manipHoverField.isConnected &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopPropagation();
      nudgeManipField(manipHoverField, e.key === 'ArrowUp' ? 1 : -1, e);
      return;
    }

    // Typing anywhere (popover textarea, panel inputs) keeps normal key
    // behavior; nudging only takes the arrows when nothing has focus.
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      var amt = e.shiftKey ? 8 : 1;
      var computed = window.getComputedStyle(manipSelected);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        var ml = parseFloat(computed.getPropertyValue('margin-left')) || 0;
        manipSetProp(manipSelected, 'margin-left', Math.round(ml + (e.key === 'ArrowRight' ? amt : -amt)) + 'px');
      } else {
        var mt = parseFloat(computed.getPropertyValue('margin-top')) || 0;
        manipSetProp(manipSelected, 'margin-top', Math.round(mt + (e.key === 'ArrowDown' ? amt : -amt)) + 'px');
      }
      refreshManipPanelValues();
    }
  }

  // ---- Apply: turn tracked deltas into an edit instruction ----

  function manipElementInfo(el) {
    var attrs = [];
    if (el.id) attrs.push('id="' + el.id + '"');
    if (el.className && typeof el.className === 'string') {
      var classes = el.className.split(' ').filter(function(c) { return c && c.indexOf('claude-design-') !== 0; }).slice(0, 3).join(' ');
      if (classes) attrs.push('class="' + classes + '"');
    }
    ['data-testid', 'data-component', 'aria-label', 'name', 'href'].forEach(function(attr) {
      var val = el.getAttribute(attr);
      if (val) attrs.push(attr + '="' + val.substring(0, 30) + '"');
    });
    var rect = el.getBoundingClientRect();
    var padding = 10;
    return {
      tagName: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().substring(0, 50),
      attributes: attrs.join(' '),
      selector: generateSelector(el),
      bounds: {
        x: Math.max(0, Math.floor(rect.left - padding)),
        y: Math.max(0, Math.floor(rect.top - padding)),
        width: Math.ceil(rect.width + padding * 2),
        height: Math.ceil(rect.height + padding * 2)
      }
    };
  }

  // Written in short, plain sentences (one instruction each, active voice, no
  // asides or symbols) so the CLI reads the request the same way every time.
  function manipNoteFor(rec) {
    var sentences = [];
    var usesToken = false;

    var props = Object.keys(rec.current);
    if (props.length) {
      var values = props.map(function(p) {
        var token = rec.tokens && rec.tokens[p];
        if (token) usesToken = true;
        return p + ' ' + rec.baseline[p] + ' to ' + rec.current[p] + (token ? ' (token ' + token + ')' : '');
      });
      sentences.push('Change these CSS values: ' + values.join('; ') + '.');
    }

    var classSwaps = [];
    var variantSwaps = [];
    Object.keys(rec.classSwaps || {}).forEach(function(key) {
      var swap = rec.classSwaps[key];
      if (swap.isVariant) variantSwaps.push(swap);
      else classSwaps.push(swap);
    });

    classSwaps.forEach(function(swap) {
      if (!swap.from) sentences.push('Add the class ' + swap.to + '.');
      else if (!swap.to) sentences.push('Remove the class ' + swap.from + '.');
      else sentences.push('Change the class ' + swap.from + ' to ' + swap.to + '.');
    });

    variantSwaps.forEach(function(swap) {
      sentences.push('Change the ' + swap.component + ' ' + swap.group + ' from ' +
        (swap.from || 'none') + ' to ' + swap.to + '.');
    });

    var stateSentences = [];
    Object.keys(rec.states || {}).forEach(function(stateKey) {
      var stateRec = rec.states[stateKey];
      var props = Object.keys(stateRec.current);
      if (!props.length) return;
      var values = props.map(function(prop) {
        var token = stateRec.tokens[prop];
        return prop + ' ' + stateRec.baseline[prop] + ' to ' + stateRec.current[prop] +
          (token ? ' (class ' + stateKey + ':' + token + ')' : '');
      });
      stateSentences.push('On ' + stateKey + ', change these CSS values: ' + values.join('; ') + '.');
    });
    sentences = sentences.concat(stateSentences);

    if (!sentences.length) return '';
    sentences.push('The preview shows the result.');

    if (stateSentences.length) {
      sentences.push('Write each state change as a Tailwind variant class on the element, for example hover:bg-brand.');
    }
    if (props.length) {
      sentences.push('The preview uses inline styles.');
      sentences.push('Write these values in the source code.');
      sentences.push('Use the same method as the other styles in this project.');
      if (usesToken) sentences.push('Use the token, not the pixel value, where this note gives a token.');
    }
    if (classSwaps.length) {
      sentences.push('Change the class in the source code.');
    }
    if (variantSwaps.length) {
      var files = [];
      variantSwaps.forEach(function(swap) {
        if (swap.file && files.indexOf(swap.file) === -1) files.push(swap.file);
      });
      if (files.length) sentences.push('The file ' + files.join(' and ') + ' declares these variants.');
      sentences.push('Set the variant where the code uses the component.');
      sentences.push('Do not edit the variant file.');
    }
    if (classSwaps.length || variantSwaps.length) {
      sentences.push('Do not add CSS for this change.');
    }
    sentences.push('Do not change anything else.');

    return sentences.join(' ');
  }

  // The delta instruction for one element, or '' if it has no tweaks
  function manipDeltaFor(el) {
    if (!el) return '';
    var rec = manipChanges.get(el);
    if (!rec || manipRecordChangeCount(rec) === 0) return '';
    return manipNoteFor(rec);
  }

  // Merge a typed note with the element's tracked deltas into one instruction.
  // They stay separate sentences rather than one long clause.
  function composeNoteWithDeltas(el, typed) {
    var delta = manipDeltaFor(el);
    if (!typed) return delta;
    if (!delta) return typed;
    var text = typed.trim();
    if (!/[.!?]$/.test(text)) text += '.';
    return text + ' ' + delta;
  }

  // After a note (with deltas folded in) is sent or queued: the preview stays
  // applied, but the deltas are consumed so they aren't sent twice.
  function manipConsumeDeltas(el) {
    if (!el) return;
    manipForgetUndo(el);
    manipChanges.delete(el);
    if (el === manipSelected) {
      manipEnsureRecord(el); // fresh baseline: further tweaks diff from here
      refreshManipPanelValues();
    }
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
    manipChanges = new Map();
    manipSelected = null;
    manipUndoStack = [];
    manipRedoStack = [];
    manipUndoBatch = null;
    manipUndoLastEl = null;
    manipQueuedRestores = new Map();
  });

  // Expose functions for external control
  window.__claudeDesignEnable = enableAnnotateMode;
  window.__claudeDesignDisable = disableAnnotateMode;
  window.__claudeDesignIsEnabled = function() { return annotateMode; };
  window.__claudeDesignSendAll = sendAllAnnotations;
  window.__claudeDesignRemoveItem = removePendingAnnotation;
  window.__claudeDesignClearAll = function() { clearPendingAnnotations(true); };
  window.__claudeDesignCancelAnnotation = cancelAnnotation;
  window.__claudeDesignAddToTodo = addToTodoList;
  window.__claudeDesignNotifyPending = notifyPendingUpdate;
  window.__claudeDesignSetAltKey = setAltKeyState;
  window.__claudeDesignToggleFreeze = toggleAnimationFreeze;
  window.__claudeDesignSetGridSizes = setGridSizes;
  window.__claudeDesignSetPanelPersistent = function(persistent) {
    manipPanelPersistent = !!persistent;
  };
})();
`;

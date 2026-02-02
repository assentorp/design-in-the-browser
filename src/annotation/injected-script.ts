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

  // Multi-edit state - stores pending annotations with individual notes
  let pendingAnnotations = []; // Array of {element, note, bounds, selector, tagName, text, attributes}

  // Text selection state
  let selectedText = null;
  let selectedTextRange = null;

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
      .claude-design-selected {
        outline: 3px solid #c6613f !important;
        outline-offset: 2px !important;
      }
      .claude-design-popover {
        position: fixed;
        z-index: 2147483647;
        background: transparent;
        border: none;
        border-radius: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        width: 320px;
        color: #e5e5e5;
        cursor: default !important;
      }
      .claude-design-popover * {
        cursor: default !important;
      }
      .claude-design-popover button {
        cursor: pointer !important;
      }
      .claude-design-popover textarea {
        cursor: text !important;
      }
      .claude-design-popover-textarea {
        width: 100%;
        min-height: 120px;
        max-height: 400px;
        background: #303030;
        border: 1px solid #4a4a4a;
        border-radius: 24px;
        padding: 18px 22px;
        color: #e5e5e5;
        font-size: 14px;
        font-family: inherit;
        resize: none;
        outline: none;
        box-sizing: border-box;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        overflow-y: hidden;
      }
      .claude-design-popover-textarea:focus {
        border-color: #5a5a5a;
      }
      .claude-design-popover-textarea::placeholder {
        color: #666;
      }
      .claude-design-popover-input-row {
        position: relative;
      }
      .claude-design-popover-input-row .claude-design-popover-textarea {
        padding-right: 22px;
        padding-bottom: 60px;
      }
      .claude-design-popover-send {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        background: #c6613f;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s ease;
      }
      .claude-design-popover-send:hover {
        background: #a8522f;
      }
      .claude-design-popover-send svg {
        width: 16px;
        height: 16px;
        color: white;
      }
      .claude-design-popover-add {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        background: #c6613f;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s ease;
      }
      .claude-design-popover-add:hover {
        background: #a8522f;
      }
      .claude-design-popover-add svg {
        width: 14px;
        height: 14px;
        color: white;
      }
      .claude-design-popover-add-another {
        height: 32px;
        padding: 0 10px;
        background: transparent;
        border: none;
        border-radius: 8px;
        color: #888;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: all 0.15s;
        font-size: 13px;
        font-weight: 500;
      }
      .claude-design-popover-add-another:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.1);
      }
      .claude-design-popover-add-another svg {
        flex-shrink: 0;
      }
      .claude-design-crosshair *:not(.claude-design-popover):not(.claude-design-popover *):not(.claude-design-code-btn):not(.claude-design-code-btn *) {
        cursor: crosshair !important;
      }
      .claude-design-popover-textarea.dragover {
        border-color: #c6613f;
        background: rgba(198, 97, 63, 0.1);
      }
      .claude-design-popover-image-pill {
        display: none;
        align-items: center;
        gap: 6px;
        height: 32px;
        padding: 0 10px;
        background: rgba(255, 255, 255, 0.1);
        border: none;
        border-radius: 8px;
        color: #ccc;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.15s;
      }
      .claude-design-popover-image-pill.active {
        display: flex;
      }
      .claude-design-popover-image-pill:hover {
        background: rgba(239, 68, 68, 0.2);
        color: #ef4444;
      }
      .claude-design-popover-image-pill svg {
        width: 12px;
        height: 12px;
      }
      .claude-design-popover-actions {
        position: absolute;
        left: 16px;
        right: 16px;
        bottom: 18px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .claude-design-popover-actions-left {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .claude-design-popover-actions-right {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .claude-design-popover-image-btn {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        background: transparent;
        border: none;
        cursor: default !important;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s ease;
      }
      .claude-design-popover-image-btn:hover {
        background: rgba(255, 255, 255, 0.1);
      }
      .claude-design-code-btn {
        position: fixed;
        z-index: 2147483647;
        width: 28px;
        height: 28px;
        border-radius: 6px;
        background: #c6613f;
        border: 1px solid #c6613f;
        cursor: pointer !important;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        padding: 0;
      }
      .claude-design-code-btn,
      .claude-design-code-btn * {
        cursor: default !important;
      }
      .claude-design-code-btn:hover {
        background: #a8522f;
        border-color: #a8522f;
      }
      .claude-design-code-btn svg {
        width: 14px;
        height: 14px;
        color: #fff;
        transition: color 0.15s ease;
      }
      .claude-design-code-btn:hover svg {
        color: #fff;
      }
      .claude-design-code-btn .claude-design-code-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: claude-design-spin 0.6s linear infinite;
      }
      @keyframes claude-design-spin {
        to { transform: rotate(360deg); }
      }
      .claude-design-popover-image-btn svg {
        width: 18px;
        height: 18px;
        color: #888;
      }
      .claude-design-popover-badge {
        position: absolute;
        top: -8px;
        left: -8px;
        background: #c6613f;
        color: white;
        font-size: 11px;
        font-weight: 600;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1;
      }
      .claude-design-text-highlight {
        background: rgba(198, 97, 63, 0.3) !important;
        outline: 2px solid #c6613f !important;
        outline-offset: 1px !important;
      }
      .claude-design-selected-text {
        font-size: 13px;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
        color: #e5e5e5;
        background: #252525;
        padding: 8px 10px;
        border-radius: 6px;
        margin-bottom: 12px;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 80px;
        overflow-y: auto;
      }
      .claude-design-selected-text::before {
        content: '"';
        color: #666;
      }
      .claude-design-selected-text::after {
        content: '"';
        color: #666;
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
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        background: #1f1f1f;
        border: 1px solid #333;
        border-radius: 12px;
        padding: 12px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: default !important;
      }
      .claude-design-toolbar * {
        cursor: default !important;
      }
      .claude-design-toolbar button {
        cursor: pointer !important;
      }
      .claude-design-toolbar-count {
        font-size: 13px;
        color: #888;
      }
      .claude-design-toolbar-count strong {
        color: #e5e5e5;
      }
      .claude-design-toolbar-hint {
        font-size: 12px;
        color: #666;
        padding-left: 12px;
        border-left: 1px solid #333;
      }
      .claude-design-toolbar-btn {
        padding: 8px 16px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        border: none;
        transition: background 0.15s ease;
      }
      .claude-design-toolbar-btn-primary {
        background: #c6613f;
        color: white;
      }
      .claude-design-toolbar-btn-primary:hover {
        background: #a8522f;
      }
      .claude-design-toolbar-btn-secondary {
        background: transparent;
        color: #888;
      }
      .claude-design-toolbar-btn-secondary:hover {
        background: #333;
        color: #e5e5e5;
      }
      .claude-design-toolbar-btn-send {
        background: #c6613f;
        color: white;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .claude-design-toolbar-btn-send:hover {
        background: #a8522f;
      }
      .claude-design-toolbar-btn-send svg {
        width: 14px;
        height: 14px;
      }
      .claude-design-mention-dropdown {
        position: fixed;
        z-index: 2147483647;
        background: #252525;
        border: 1px solid #4a4a4a;
        border-radius: 12px;
        max-height: 300px;
        overflow-y: auto;
        width: 320px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
        padding: 4px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
        font-size: 11px;
        font-weight: 700;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
        width: 28px;
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
        flex-shrink: 0;
        font-weight: 500;
      }
      .claude-design-mention-dir {
        font-size: 12px;
        color: #666;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-left: auto;
        min-width: 0;
      }
      .claude-design-mention-empty {
        padding: 12px 10px;
        color: #666;
        font-size: 13px;
        text-align: center;
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

  // Expand @filename mentions to full paths using the textarea's mention map
  function expandMentions(text, textarea) {
    var map = textarea && textarea.__mentionMap;
    if (!map) return text;
    var result = text;
    var names = Object.keys(map);
    // Sort longest names first to avoid partial replacements
    names.sort(function(a, b) { return b.length - a.length; });
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      result = result.split('@' + name).join(map[name]);
    }
    return result;
  }

  function removeToolbar() {
    if (toolbarElement) {
      toolbarElement.remove();
      toolbarElement = null;
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
    removeToolbar();
    notifyPendingUpdate();
  }

  // Notify React about pending annotations changes
  function notifyPendingUpdate() {
    const items = pendingAnnotations.map(function(ann) {
      return { note: ann.note, selector: ann.selector };
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
    window.__claudeDesignSendAnnotation(data);
    clearPendingAnnotations();
    todoMode = false;
    cancelAnnotation();
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
    var mention = { active: false, startIndex: -1 };
    var dropdown = null;
    var activeIndex = 0;
    var filteredFiles = [];

    function getFiles() {
      return window.__claudeDesignProjectFiles || [];
    }

    function filterFiles(query) {
      var q = query.toLowerCase();
      var files = getFiles();
      if (!q) return files.slice(0, 50);
      var results = files.filter(function(f) {
        var fullPath = (f.dir === '.' ? f.name : f.dir + '/' + f.name).toLowerCase();
        return fullPath.indexOf(q) !== -1;
      });
      // Sort: filename matches first, then directory-only matches
      results.sort(function(a, b) {
        var aName = a.name.toLowerCase().indexOf(q) !== -1 ? 0 : 1;
        var bName = b.name.toLowerCase().indexOf(q) !== -1 ? 0 : 1;
        return aName - bName;
      });
      return results.slice(0, 50);
    }

    function removeDropdown() {
      if (dropdown) {
        dropdown.remove();
        dropdown = null;
      }
      mention.active = false;
      activeIndex = 0;
      filteredFiles = [];
    }

    function positionDropdown() {
      if (!dropdown || !textarea) return;
      var rect = textarea.getBoundingClientRect();
      var dropHeight = dropdown.offsetHeight || 200;
      var spaceAbove = rect.top - 6;
      var spaceBelow = window.innerHeight - rect.bottom - 6;
      var width = Math.min(rect.width, window.innerWidth - 12);
      var left = rect.left;

      // Clamp left so dropdown stays in viewport
      if (left + width > window.innerWidth - 6) left = window.innerWidth - 6 - width;
      if (left < 6) left = 6;

      dropdown.style.width = width + 'px';
      dropdown.style.left = left + 'px';
      dropdown.style.maxHeight = Math.max(120, Math.min(300, spaceAbove > spaceBelow ? spaceAbove : spaceBelow)) + 'px';

      if (spaceAbove >= dropHeight || spaceAbove >= spaceBelow) {
        // Position above
        dropdown.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
        dropdown.style.top = 'auto';
      } else {
        // Position below
        dropdown.style.top = (rect.bottom + 6) + 'px';
        dropdown.style.bottom = 'auto';
      }
    }

    function renderDropdown(query) {
      filteredFiles = filterFiles(query);
      activeIndex = 0;

      var isNew = !dropdown;
      if (isNew) {
        dropdown = document.createElement('div');
        dropdown.className = 'claude-design-mention-dropdown';
        document.body.appendChild(dropdown);
      }

      if (filteredFiles.length === 0) {
        dropdown.innerHTML = '<div class="claude-design-mention-empty">No files found</div>';
        positionDropdown();
        return;
      }

      var html = '';
      for (var i = 0; i < filteredFiles.length; i++) {
        var f = filteredFiles[i];
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
        // Hover handler
        dropdown.addEventListener('mouseover', function(e) {
          var item = e.target.closest ? e.target.closest('.claude-design-mention-item') : null;
          if (!item) return;
          var idx = parseInt(item.dataset.mentionIndex, 10);
          if (isNaN(idx)) return;
          setActive(idx);
        });

        // Click handler
        dropdown.addEventListener('mousedown', function(e) {
          e.preventDefault();
          e.stopPropagation();
          var item = e.target.closest ? e.target.closest('.claude-design-mention-item') : null;
          if (!item) return;
          var idx = parseInt(item.dataset.mentionIndex, 10);
          if (!isNaN(idx)) selectItem(idx);
        });
      }
    }

    function setActive(idx) {
      if (idx < 0 || idx >= filteredFiles.length) return;
      activeIndex = idx;
      if (!dropdown) return;
      var items = dropdown.querySelectorAll('.claude-design-mention-item');
      for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle('active', i === idx);
      }
      // Scroll into view
      if (items[idx]) {
        items[idx].scrollIntoView({ block: 'nearest' });
      }
    }

    function selectItem(idx) {
      if (idx < 0 || idx >= filteredFiles.length) return;
      var f = filteredFiles[idx];
      var fullPath = f.dir === '.' ? f.name : f.dir + '/' + f.name;

      // Store mention mapping on the textarea for later expansion
      if (!textarea.__mentionMap) textarea.__mentionMap = {};
      textarea.__mentionMap[f.name] = fullPath;

      // Keep the @ and insert just the filename: @page.tsx
      var value = textarea.value;
      var after = value.substring(textarea.selectionStart);
      textarea.value = value.substring(0, mention.startIndex) + f.name + after;

      // Set cursor after inserted name (startIndex is already after the @)
      var newPos = mention.startIndex + f.name.length;
      textarea.selectionStart = newPos;
      textarea.selectionEnd = newPos;

      removeDropdown();

      // Trigger input event to auto-resize
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    textarea.addEventListener('input', function() {
      var value = textarea.value;
      var cursorPos = textarea.selectionStart;

      if (mention.active) {
        // Check if cursor moved before the @
        if (cursorPos < mention.startIndex) {
          removeDropdown();
          return;
        }
        // Also verify the @ is still there
        if (value[mention.startIndex - 1] !== '@') {
          removeDropdown();
          return;
        }
        var query = value.substring(mention.startIndex, cursorPos);
        // Close if user typed space or newline in query
        if (query.indexOf(' ') !== -1 || query.indexOf('\\n') !== -1) {
          removeDropdown();
          return;
        }
        renderDropdown(query);
        return;
      }

      // Check if cursor is right after an @ (handles both typing @ and backspacing to @)
      if (cursorPos > 0 && value[cursorPos - 1] === '@') {
        // Only trigger if @ is at start or preceded by whitespace
        if (cursorPos === 1 || /\\s/.test(value[cursorPos - 2])) {
          mention.active = true;
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
        if (next >= filteredFiles.length) next = 0;
        setActive(next);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopImmediatePropagation();
        var prev = activeIndex - 1;
        if (prev < 0) prev = filteredFiles.length - 1;
        setActive(prev);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredFiles.length > 0) {
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

    let top = rect.bottom + 10;
    let left = rect.left;

    if (top + 300 > window.innerHeight) top = rect.top - 300;
    if (left + 320 > window.innerWidth) left = window.innerWidth - 330;
    if (left < 10) left = 10;
    if (top < 10) top = 10;

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

    let top = rect.bottom + 10;
    let left = rect.left;

    if (top + 300 > window.innerHeight) top = rect.top - 300;
    if (left + 320 > window.innerWidth) left = window.innerWidth - 330;
    if (left < 10) left = 10;
    if (top < 10) top = 10;

    popoverElement.style.top = top + 'px';
    popoverElement.style.left = left + 'px';

    // Add scroll listener to reposition popover and code button
    popoverScrollHandler = function() {
      positionPopover();
      positionCodeButton();
    };
    window.addEventListener('scroll', popoverScrollHandler, true);

    // Build header based on selection type
    let headerHTML = '';
    if (textSelection) {
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

    const placeholder = textSelection ? 'Fix typo...' : 'What do you want to change?';

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
      ? '<button class="claude-design-popover-add-another" data-action="enter-list-mode" title="Add to list (⇧↵)">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M16 5H3"/><path d="M16 12H3"/><path d="M9 19H3"/>' +
            '<path d="m16 16-3 3 3 3"/><path d="M21 5v12a2 2 0 0 1-2 2h-6"/>' +
          '</svg>' +
          'Add' +
        '</button>'
      : '';

    // List is now shown in React panel, not in popover
    let listHTML = '';

    // If element already has annotation, just show the list (no input needed)
    let inputAreaHTML = '';
    if (existingAnnotation && !textSelection) {
      // No input area - just show the list below
      inputAreaHTML = '';
    } else {
      inputAreaHTML =
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
    }

    popoverElement.innerHTML = inputAreaHTML + listHTML;

    document.body.appendChild(popoverElement);

    // Create floating code button at top-right of the selected element
    if (el && !textSelection) {
      removeCodeButton();
      codeButtonAnchor = el;
      codeButtonElement = document.createElement('button');
      codeButtonElement.className = 'claude-design-code-btn';
      codeButtonElement.title = reactSource
        ? 'Open in editor (' + (reactSource.fileName || '').split('/').pop() + ':' + (reactSource.lineNumber || '') + ')'
        : 'Open in editor';
      codeButtonElement.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>' +
        '</svg>';
      // Position using the helper function (handles scroll and viewport clamping)
      positionCodeButton();
      codeButtonElement.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        // Show spinner
        codeButtonElement.innerHTML = '<div class="claude-design-code-spinner"></div>';
        if (reactSource) {
          window.postMessage({
            type: 'claude-design-open-source',
            fileName: reactSource.fileName,
            lineNumber: reactSource.lineNumber,
            columnNumber: reactSource.columnNumber,
          }, '*');
        } else {
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
            type: 'claude-design-open-source',
            componentNames: componentNames,
            searchText: elTextContent,
            searchDataAttrs: dataAttrs,
            searchId: el.id || null,
            pageUrl: window.location.pathname,
          }, '*');
        }
      });
      document.body.appendChild(codeButtonElement);
    }

    const textarea = popoverElement.querySelector('textarea');
    const fileInput = popoverElement.querySelector('.claude-design-popover-file');
    const imageBtn = popoverElement.querySelector('.claude-design-popover-image-btn');
    const imagePill = popoverElement.querySelector('.claude-design-popover-image-pill');

    setTimeout(() => textarea && textarea.focus(), 50);

    // Auto-expand textarea as user types
    function autoResize() {
      if (!textarea) return;
      textarea.style.height = 'auto';
      var scrollH = textarea.scrollHeight;
      var minH = 120;
      var padBottom = 60; // account for padding-bottom in input-row mode
      textarea.style.height = Math.max(minH, scrollH) + 'px';
      if (scrollH > 400) {
        textarea.style.overflowY = 'auto';
      } else {
        textarea.style.overflowY = 'hidden';
      }
    }
    if (textarea) {
      textarea.addEventListener('input', autoResize);
      setupMentionAutocomplete(textarea);
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
      // Shift+Enter: Add to list (enter list mode and save)
      if (e.key === 'Enter' && e.shiftKey) {
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
    if (selectedElement.className) attrs.push('class="' + selectedElement.className.split(' ').slice(0, 3).join(' ') + '"');
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
    if (!annotateMode || selectedElement) return;

    const target = e.target;
    if (target === document.body || target === document.documentElement ||
        (target.closest && target.closest('.claude-design-popover')) ||
        (target.closest && target.closest('.claude-design-toolbar')) ||
        (target.closest && target.closest('.claude-design-code-btn'))) return;

    if (highlightedElement && highlightedElement !== target) {
      highlightedElement.classList.remove('claude-design-highlight');
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
  function handleMouseUp(e) {
    if (!annotateMode) return;
    if (e.target.closest && e.target.closest('.claude-design-popover')) return;
    if (e.target.closest && e.target.closest('.claude-design-toolbar')) return;
    if (e.target.closest && e.target.closest('.claude-design-code-btn')) return;

    const selection = window.getSelection();
    const text = selection && selection.toString().trim();

    if (text && text.length > 0) {
      // Text was selected - create text annotation
      e.preventDefault();
      e.stopPropagation();

      // Clear any element selections
      if (selectedElement) {
        selectedElement.classList.remove('claude-design-selected');
        selectedElement = null;
      }
      if (highlightedElement) {
        highlightedElement.classList.remove('claude-design-highlight');
        highlightedElement = null;
      }

      selectedText = text;
      selectedTextRange = selection.getRangeAt(0).cloneRange();
      const rect = selectedTextRange.getBoundingClientRect();

      createPopover(null, { text: text, rect: rect, range: selectedTextRange });
    }
  }

  function handleClick(e) {
    if (!annotateMode) return;
    if (e.target.closest && e.target.closest('.claude-design-popover')) return;
    if (e.target.closest && e.target.closest('.claude-design-toolbar')) return;
    if (e.target.closest && e.target.closest('.claude-design-code-btn')) return;

    // Check for text selection first - don't intercept if selecting text
    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) {
      return; // Let mouseup handle text selection
    }

    e.preventDefault();
    e.stopPropagation();

    // If popover is open, clicking outside cancels it
    if ((selectedElement || selectedText) && popoverElement) {
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
      } else {
        disableAnnotateMode();
        window.__claudeDesignNotifyModeChange(false);
      }
    }
  }

  function enableAnnotateMode() {
    if (annotateMode) return;
    annotateMode = true;
    document.body.classList.add('claude-design-crosshair');

    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('mouseup', handleMouseUp, true);
    document.addEventListener('keydown', handleKeyDown, true);
  }

  function disableAnnotateMode() {
    if (!annotateMode) return;
    annotateMode = false;
    todoMode = false;
    document.body.classList.remove('claude-design-crosshair');

    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('mouseout', handleMouseOut, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('mouseup', handleMouseUp, true);
    document.removeEventListener('keydown', handleKeyDown, true);

    if (highlightedElement) {
      highlightedElement.classList.remove('claude-design-highlight');
      highlightedElement = null;
    }

    // Clear pending annotations
    clearPendingAnnotations();

    cancelAnnotation();
  }

  // Expose functions for external control
  window.__claudeDesignEnable = enableAnnotateMode;
  window.__claudeDesignDisable = disableAnnotateMode;
  window.__claudeDesignIsEnabled = function() { return annotateMode; };
  window.__claudeDesignSendAll = sendAllAnnotations;
  window.__claudeDesignRemoveItem = removePendingAnnotation;
  window.__claudeDesignCancelAnnotation = cancelAnnotation;
})();
`;

// This script is injected into the webview via executeJavaScript
// It handles element selection and annotation UI

export const annotationScript = `
(function() {
  // Prevent multiple injections
  if (window.__claudeDesignAnnotation) return;
  window.__claudeDesignAnnotation = true;

  // State
  let annotateMode = false;
  let highlightedElement = null;
  let selectedElement = null;
  let popoverElement = null;

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
        background: #1f1f1f;
        border: 1px solid #333;
        border-radius: 12px;
        padding: 16px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        width: 320px;
        color: #e5e5e5;
      }
      .claude-design-popover-textarea {
        width: 100%;
        min-height: 100px;
        background: #2a2a2a;
        border: 1px solid #444;
        border-radius: 8px;
        padding: 12px;
        color: #e5e5e5;
        font-size: 14px;
        font-family: inherit;
        resize: vertical;
        outline: none;
        box-sizing: border-box;
      }
      .claude-design-popover-textarea:focus {
        border-color: #c6613f;
      }
      .claude-design-popover-textarea::placeholder {
        color: #666;
      }
      .claude-design-popover-input-row {
        position: relative;
      }
      .claude-design-popover-input-row .claude-design-popover-textarea {
        padding-right: 52px;
        padding-bottom: 16px;
      }
      .claude-design-popover-send {
        position: absolute;
        right: 10px;
        bottom: 10px;
        width: 32px;
        height: 32px;
        border-radius: 50%;
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
        width: 14px;
        height: 14px;
        color: white;
      }
      .claude-design-crosshair * {
        cursor: crosshair !important;
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

  // Create popover
  function createPopover(el) {
    removePopover();

    const rect = el.getBoundingClientRect();
    const selector = generateSelector(el);

    popoverElement = document.createElement('div');
    popoverElement.className = 'claude-design-popover';

    let top = rect.bottom + 10;
    let left = rect.left;

    if (top + 250 > window.innerHeight) top = rect.top - 250;
    if (left + 320 > window.innerWidth) left = window.innerWidth - 330;
    if (left < 10) left = 10;
    if (top < 10) top = 10;

    popoverElement.style.top = top + 'px';
    popoverElement.style.left = left + 'px';

    popoverElement.innerHTML =
      '<div class="claude-design-popover-input-row">' +
        '<textarea class="claude-design-popover-textarea" placeholder="What do you want to change?"></textarea>' +
        '<button class="claude-design-popover-send" data-action="send">' +
          '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M8 12V4M8 4L4 8M8 4L12 8"/>' +
          '</svg>' +
        '</button>' +
      '</div>';

    document.body.appendChild(popoverElement);

    const textarea = popoverElement.querySelector('textarea');
    setTimeout(() => textarea && textarea.focus(), 50);

    popoverElement.addEventListener('click', function(e) {
      const action = e.target.dataset.action || (e.target.closest && e.target.closest('[data-action]') && e.target.closest('[data-action]').dataset.action);
      if (action === 'send') sendAnnotation();
    });

    textarea && textarea.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAnnotation();
      }
      if (e.key === 'Escape') cancelAnnotation();
    });
  }

  function removePopover() {
    if (popoverElement) {
      popoverElement.remove();
      popoverElement = null;
    }
  }

  function cancelAnnotation() {
    removePopover();
    if (selectedElement) {
      selectedElement.classList.remove('claude-design-selected');
      selectedElement = null;
    }
  }

  function sendAnnotation() {
    if (!selectedElement || !popoverElement) return;

    const textarea = popoverElement.querySelector('textarea');
    const request = textarea && textarea.value.trim();

    if (!request) {
      textarea && textarea.focus();
      return;
    }

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
      request: request,
    };

    // Post message to parent
    window.__claudeDesignSendAnnotation(data);

    cancelAnnotation();
  }

  function handleMouseOver(e) {
    if (!annotateMode || selectedElement) return;

    const target = e.target;
    if (target === document.body || target === document.documentElement ||
        target.closest && target.closest('.claude-design-popover')) return;

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

  function handleClick(e) {
    if (!annotateMode) return;
    if (e.target.closest && e.target.closest('.claude-design-popover')) return;

    e.preventDefault();
    e.stopPropagation();

    // If popover is open, clicking outside cancels it
    if (selectedElement && popoverElement) {
      cancelAnnotation();
      return;
    }

    if (selectedElement) selectedElement.classList.remove('claude-design-selected');
    if (highlightedElement) highlightedElement.classList.remove('claude-design-highlight');

    selectedElement = e.target;
    selectedElement.classList.add('claude-design-selected');
    highlightedElement = null;

    createPopover(e.target);
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
    document.addEventListener('keydown', handleKeyDown, true);
  }

  function disableAnnotateMode() {
    if (!annotateMode) return;
    annotateMode = false;
    document.body.classList.remove('claude-design-crosshair');

    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('mouseout', handleMouseOut, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);

    if (highlightedElement) {
      highlightedElement.classList.remove('claude-design-highlight');
      highlightedElement = null;
    }

    cancelAnnotation();
  }

  // Expose functions for external control
  window.__claudeDesignEnable = enableAnnotateMode;
  window.__claudeDesignDisable = disableAnnotateMode;
  window.__claudeDesignIsEnabled = function() { return annotateMode; };
})();
`;

/**
 * selectionScripts.ts — WebView-injected JavaScript for text selection detection,
 * highlight/underline application, and annotation reapply.
 *
 * Message protocol:
 *   WebView → RN: selection, selection_clear, annotation_applied
 *   RN → WebView: apply_annotation, clear_selection, reapply_annotations
 *
 * Offsets are computed as character indices in the full plain-text of the
 * reflowed HTML body (document.body.innerText). This is stable across
 * font-size / theme / line-height changes as long as the underlying text
 * content remains the same.
 */

export const SELECTION_BRIDGE_JS = `
(function () {
  /* ── helpers ──────────────────────────────────────────────────── */
  var _debounceTimer = null;
  var _lastSentText = '';

  /** Debounce wrapper. */
  function debounce(fn, ms) {
    return function () {
      var args = arguments;
      clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(function () { fn.apply(null, args); }, ms || 250);
    };
  }

  /** Post JSON to React Native. */
  function post(obj) {
    try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(obj)); }
    catch (_) {}
  }

  /* ── plain-text offset computation ───────────────────────────── */
  /**
   * Flatten body.innerText into a string and walk the DOM text nodes
   * to map a Range's start/end containers + offsets into plain-text
   * character offsets.
   */
  function getTextNodesBefore(root, target, targetOffset) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var total = 0;
    var node;
    while ((node = walker.nextNode())) {
      if (node === target) return total + targetOffset;
      total += (node.textContent || '').length;
    }
    return total + targetOffset;
  }

  function rangeToOffsets(range) {
    var root = document.body;
    var startOffset = getTextNodesBefore(root, range.startContainer, range.startOffset);
    var endOffset = getTextNodesBefore(root, range.endContainer, range.endOffset);
    return { startOffset: startOffset, endOffset: endOffset };
  }

  /* ── Shared selection reporter ───────────────────────────────── */
  function reportSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      if (_lastSentText) {
        _lastSentText = '';
        post({ type: 'selection_clear' });
      }
      return;
    }
    var text = sel.toString().trim();
    if (text === _lastSentText) return;
    _lastSentText = text;

    try {
      var range = sel.getRangeAt(0);
      var offsets = rangeToOffsets(range);
      var rect = range.getBoundingClientRect();
      post({
        type: 'selection',
        text: text,
        startOffset: offsets.startOffset,
        endOffset: offsets.endOffset,
        rect: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height
        },
        scrollX: window.scrollX,
        scrollY: window.scrollY
      });
    } catch (_) {}
  }

  /* ── Selection change listener (debounced 250ms) ─────────────── */
  var handleSelectionChange = debounce(reportSelection, 250);
  document.addEventListener('selectionchange', handleSelectionChange);

  /* touchend — fire after the user lifts their finger.
   * 250ms gives Android time to commit the selection. */
  document.addEventListener('touchend', function() {
    setTimeout(reportSelection, 250);
  }, { passive: true });

  document.addEventListener('mouseup', function() {
    setTimeout(reportSelection, 50);
  });

  /* contextmenu fires on Android long-press — prevent the native popup
   * and read the selection after a delay that covers both fast and slow
   * Android WebView implementations (300ms is reliably after selection). */
  document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    setTimeout(reportSelection, 300);
  });

  /* ── Long-press detection via touchstart + timer ─────────────── *
   * Fallback for devices where contextmenu doesn't fire. After 600ms
   * of sustained touch (i.e. a long-press), poll for a selection. */
  var _lpTimer = null;
  var _lpActive = false;
  document.addEventListener('touchstart', function() {
    _lpActive = true;
    clearTimeout(_lpTimer);
    _lpTimer = setTimeout(function() {
      if (_lpActive) { reportSelection(); }
    }, 600);
  }, { passive: true });
  document.addEventListener('touchend', function() {
    _lpActive = false;
    clearTimeout(_lpTimer);
  }, { passive: true });
  document.addEventListener('touchcancel', function() {
    _lpActive = false;
    clearTimeout(_lpTimer);
  }, { passive: true });

  /* On scroll, re-emit position with updated viewport-relative rect */
  var _scrollTimer = null;
  document.addEventListener('scroll', function () {
    clearTimeout(_scrollTimer);
    _scrollTimer = setTimeout(function () {
      // Force resend by clearing lastSentText so updated position is emitted
      _lastSentText = '';
      reportSelection();
    }, 200);
  }, { passive: true });

  /* ── Offset → Range reconstruction ───────────────────────────── */
  function offsetsToRange(startOff, endOff) {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    var charCount = 0;
    var startNode = null, startLocal = 0;
    var endNode = null, endLocal = 0;
    var node;
    while ((node = walker.nextNode())) {
      var len = (node.textContent || '').length;
      if (!startNode && charCount + len > startOff) {
        startNode = node;
        startLocal = startOff - charCount;
      }
      if (!endNode && charCount + len >= endOff) {
        endNode = node;
        endLocal = endOff - charCount;
        break;
      }
      charCount += len;
    }
    if (!startNode || !endNode) return null;
    try {
      var range = document.createRange();
      range.setStart(startNode, Math.min(startLocal, startNode.textContent.length));
      range.setEnd(endNode, Math.min(endLocal, endNode.textContent.length));
      return range;
    } catch (_) { return null; }
  }

  /* ── Wrap a range with a span ────────────────────────────────── */
  function wrapRange(range, tag) {
    // Use extractContents + insertNode for multi-node ranges.
    try {
      var fragment = range.extractContents();
      var wrapper = document.createElement('span');
      wrapper.appendChild(fragment);
      for (var k in tag.attrs) wrapper.setAttribute(k, tag.attrs[k]);
      if (tag.style) wrapper.setAttribute('style', tag.style);
      if (tag.className) wrapper.className = tag.className;
      range.insertNode(wrapper);
      return true;
    } catch (_) { return false; }
  }

  /* ── Public API (called from RN via injectJavaScript) ────────── */

  /** Apply highlight by offsets. */
  window.__selBridge_highlight = function (id, startOff, endOff, color) {
    var range = offsetsToRange(startOff, endOff);
    if (!range) { post({ type: 'annotation_applied', success: false, id: id, kind: 'highlight' }); return; }
    var ok = wrapRange(range, {
      className: 'pdflab-hl',
      attrs: { 'data-hl-id': id },
      style: 'background-color:' + color + ';border-radius:2px;padding:0 1px;'
    });
    window.getSelection() && window.getSelection().removeAllRanges();
    post({ type: 'annotation_applied', success: ok, id: id, kind: 'highlight' });
  };

  /** Apply underline by offsets. */
  window.__selBridge_underline = function (id, startOff, endOff) {
    var range = offsetsToRange(startOff, endOff);
    if (!range) { post({ type: 'annotation_applied', success: false, id: id, kind: 'underline' }); return; }
    var ok = wrapRange(range, {
      className: 'pdflab-ul',
      attrs: { 'data-ul-id': id },
      style: 'text-decoration:underline;text-decoration-color:#1976D2;text-decoration-thickness:2px;text-underline-offset:3px;'
    });
    window.getSelection() && window.getSelection().removeAllRanges();
    post({ type: 'annotation_applied', success: ok, id: id, kind: 'underline' });
  };

  /** Clear browser selection. */
  window.__selBridge_clearSelection = function () {
    window.getSelection() && window.getSelection().removeAllRanges();
    _lastSentText = '';
  };

  /** Re-apply a batch of highlights + underlines. Called on reload. */
  window.__selBridge_reapplyAnnotations = function (annotations) {
    // annotations: [{ id, startOffset, endOffset, kind, color? }]
    if (!annotations || !annotations.length) return;
    // Sort by startOffset descending so earlier insertions don't shift later offsets.
    var sorted = annotations.slice().sort(function (a, b) { return b.startOffset - a.startOffset; });
    for (var i = 0; i < sorted.length; i++) {
      var a = sorted[i];
      if (a.kind === 'highlight') {
        window.__selBridge_highlight(a.id, a.startOffset, a.endOffset, a.color || 'rgba(255,235,59,0.4)');
      } else if (a.kind === 'underline') {
        window.__selBridge_underline(a.id, a.startOffset, a.endOffset);
      }
    }
  };

  /** Remove a single annotation by id. */
  window.__selBridge_removeAnnotation = function (id) {
    var el = document.querySelector('[data-hl-id="' + id + '"]') ||
             document.querySelector('[data-ul-id="' + id + '"]');
    if (el && el.parentNode) {
      var parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      parent.normalize();
    }
  };

  /** Apply bold to selected range by offsets. */
  window.__selBridge_bold = function (startOff, endOff) {
    var range = offsetsToRange(startOff, endOff);
    if (!range) return;
    wrapRange(range, { style: 'font-weight:bold;' });
    window.getSelection() && window.getSelection().removeAllRanges();
  };

  /** Apply italic to selected range by offsets. */
  window.__selBridge_italic = function (startOff, endOff) {
    var range = offsetsToRange(startOff, endOff);
    if (!range) return;
    wrapRange(range, { style: 'font-style:italic;' });
    window.getSelection() && window.getSelection().removeAllRanges();
  };

  /** Apply text color to selected range by offsets. */
  window.__selBridge_textColor = function (startOff, endOff, color) {
    var range = offsetsToRange(startOff, endOff);
    if (!range) return;
    wrapRange(range, { style: 'color:' + color + ';' });
    window.getSelection() && window.getSelection().removeAllRanges();
  };

  /** Apply strikethrough to selected range by offsets. */
  window.__selBridge_strikethrough = function (id, startOff, endOff) {
    var range = offsetsToRange(startOff, endOff);
    if (!range) { post({ type: 'annotation_applied', success: false, id: id, kind: 'strikethrough' }); return; }
    var ok = wrapRange(range, {
      className: 'pdflab-st',
      attrs: { 'data-st-id': id },
      style: 'text-decoration:line-through;text-decoration-color:#E53935;text-decoration-thickness:2px;'
    });
    window.getSelection() && window.getSelection().removeAllRanges();
    post({ type: 'annotation_applied', success: ok, id: id, kind: 'strikethrough' });
  };

  /* ── Search highlighting ─────────────────────────────────────────
   * Called by MobileRenderer via injectJavaScript:
   *   window.searchText(query)  — highlight all matches, scroll to first
   *   window.searchNext()       — advance to next match
   *   window.searchPrev()       — go to previous match
   *   window.clearSearch()      — remove all search highlights
   * Posts { type:'search-count', count, current } back to React Native.
   * ─────────────────────────────────────────────────────────────── */
  var __srSpans = [];
  var __srIdx = 0;
  var SR_ACTIVE = 'background-color:#FF6F00;color:#fff;border-radius:2px;padding:0 1px;display:inline;';
  var SR_NORMAL = 'background-color:#FFEB3B;color:#000;border-radius:2px;padding:0 1px;display:inline;';

  function __srClear() {
    for (var i = 0; i < __srSpans.length; i++) {
      var sp = __srSpans[i];
      var p = sp.parentNode;
      if (p) { p.replaceChild(document.createTextNode(sp.textContent || ''), sp); p.normalize(); }
    }
    __srSpans = []; __srIdx = 0;
  }

  window.searchText = function (query) {
    __srClear();
    if (!query || !query.trim()) { post({ type: 'search-count', count: 0, current: 0 }); return; }
    var q = query.toLowerCase();
    /* Collect all text nodes up-front before any DOM mutation */
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    var nodes = []; var node;
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach(function (n) {
      var text = n.nodeValue || ''; var lower = text.toLowerCase(); var idx = lower.indexOf(q);
      if (idx === -1 || !n.parentNode) return;
      var frag = document.createDocumentFragment(); var last = 0;
      while (idx !== -1) {
        if (idx > last) frag.appendChild(document.createTextNode(text.substring(last, idx)));
        var sp = document.createElement('span');
        sp.setAttribute('data-pdflab-sr', '1');
        sp.setAttribute('style', SR_NORMAL);
        sp.textContent = text.substring(idx, idx + q.length);
        frag.appendChild(sp); __srSpans.push(sp);
        last = idx + q.length; idx = lower.indexOf(q, last);
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.substring(last)));
      n.parentNode.replaceChild(frag, n);
    });
    if (__srSpans.length > 0) {
      __srSpans[0].setAttribute('style', SR_ACTIVE);
      __srSpans[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    post({ type: 'search-count', count: __srSpans.length, current: __srSpans.length > 0 ? 1 : 0 });
  };

  window.searchNext = function () {
    if (!__srSpans.length) return;
    __srSpans[__srIdx].setAttribute('style', SR_NORMAL);
    __srIdx = (__srIdx + 1) % __srSpans.length;
    __srSpans[__srIdx].setAttribute('style', SR_ACTIVE);
    __srSpans[__srIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    post({ type: 'search-count', count: __srSpans.length, current: __srIdx + 1 });
  };

  window.searchPrev = function () {
    if (!__srSpans.length) return;
    __srSpans[__srIdx].setAttribute('style', SR_NORMAL);
    __srIdx = (__srIdx - 1 + __srSpans.length) % __srSpans.length;
    __srSpans[__srIdx].setAttribute('style', SR_ACTIVE);
    __srSpans[__srIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    post({ type: 'search-count', count: __srSpans.length, current: __srIdx + 1 });
  };

  window.clearSearch = function () {
    __srClear();
    post({ type: 'search-count', count: 0, current: 0 });
  };
})();
`;

/**
 * Injects the selection bridge script into reflow HTML.
 * Call this BEFORE setting the HTML on the WebView.
 */
export function injectSelectionBridge(html: string): string {
  const tag = `<script>${SELECTION_BRIDGE_JS}<\/script>`;
  // Insert before closing </body> or append to end
  if (html.includes("</body>")) {
    return html.replace("</body>", tag + "</body>");
  }
  return html + tag;
}

/**
 * readAloudHighlightScript.ts
 * The passage-and-word highlighter for Read Aloud, as JavaScript that runs in
 * a WebView.
 *
 * Shared by the DOCX viewers, PDF Mobile View and the EPUB reader, which render
 * completely different DOMs but need identical behaviour.
 *
 * ── Two levels of highlight ────────────────────────────────────────────────
 *  - showChunk() bands the whole passage being read. It is called on every
 *    chunk change, so every speech engine gets a highlight — including the
 *    ones (Samsung's among them) that never report word positions.
 *  - show() marks the spoken word and its sentence. It is called per word
 *    boundary on engines that report them, and replaces the passage band.
 *
 * ── Why it searches instead of using offsets ──────────────────────────────
 * TextChunk carries charStart/charEnd, but those index the *cleaned* text Read
 * Aloud speaks, which is not what a renderer displays: cleanPdfText folds
 * ligatures and joins hyphenated line breaks, and the EPUB extractor turns
 * every tag into a space — "<em>very</em>, important" is spoken from
 * "very , important" while the page shows "very, important". So matching
 * ignores whitespace entirely, which is also what lets it see across list
 * items and line breaks that have no whitespace in the DOM at all. The search
 * runs forward from the last passage, so repeated sentences resolve to the
 * occurrence the reader has reached; and when a passage still will not match
 * as a whole, a short window around the word is tried instead.
 *
 * ── Why it is a factory over a document ───────────────────────────────────
 * epub.js puts each section in an iframe sandboxed with "allow-same-origin"
 * and no "allow-scripts", so no script can run inside a book's pages. The
 * highlighter therefore runs in the host page and reaches into a section's
 * document through the same-origin DOM: window.__raCreateHighlighter(doc).
 *
 * Written in ES5 style (var, function) to match utils/selectionScripts.ts and
 * to stay safe on the older Android System WebViews this app still meets.
 */

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/**
 * Highlight styling.
 *
 * Translucent accent backgrounds only — no text colour is set, because
 * recolouring text is what makes reading highlighters look broken when the
 * reader switches to a dark or sepia theme.
 */
export const READ_ALOUD_HIGHLIGHT_CSS = `
.ra-sentence {
  background-color: rgba(79, 70, 229, 0.12);
  border-radius: 3px;
}
.ra-word {
  background-color: rgba(79, 70, 229, 0.34);
  border-radius: 3px;
  box-shadow: 0 0 0 1px rgba(79, 70, 229, 0.18);
}
@media (prefers-color-scheme: dark) {
  .ra-sentence { background-color: rgba(129, 140, 248, 0.16); }
  .ra-word { background-color: rgba(129, 140, 248, 0.42); }
}
`.trim();

// ---------------------------------------------------------------------------
// The highlighter factory
// ---------------------------------------------------------------------------

/**
 * Defines `window.__raCreateHighlighter(doc)` in whatever page it runs in.
 *
 * Kept as String.raw so the regexes and \u escapes below reach the WebView
 * exactly as written. It must contain no backticks and no dollar-brace
 * sequences.
 */
const SOURCE_TEMPLATE = String.raw`
(function () {
  if (typeof window === 'undefined') return;

  var WORD_CLASS = 'ra-word';
  var SENT_CLASS = 'ra-sentence';
  var STYLE_ID = 'ra-highlight-style';
  var XHTML_NS = 'http://www.w3.org/1999/xhtml';
  var SHOW_TEXT = 4; /* NodeFilter.SHOW_TEXT, without relying on the global */

  /* The fallback anchor reaches this far either side of a word, and is only
     trusted at this length or more — both in whitespace-free characters. */
  var ANCHOR_PAD = 16;
  var MIN_ANCHOR = 12;
  var HEAD_LEN = 48;

  var LIGATURES = {
    'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff',
    'ﬃ': 'ffi', 'ﬄ': 'ffl'
  };

  /* Text inside these is never page text, and wrapping it would break it. */
  var SKIP_PARENTS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TITLE: 1, TEMPLATE: 1 };

  var WS = /\s/;
  var SENTENCE_END = /[.!?]/;

  /* ── Normalisation ─────────────────────────────────────────────
   * Whitespace-free and lower-cased, with ligatures and curly quotes folded
   * and soft or line-break hyphens dropped. Returns maps both ways:
   *   map        normalised index -> raw index
   *   rawToNorm  raw index        -> normalised index
   */
  function normalise(raw) {
    var out = '';
    var map = [];
    var i;

    for (i = 0; i < raw.length; i++) {
      var ch = raw.charAt(i);

      if (ch === '­') continue;
      if (WS.test(ch)) continue;
      if (ch === '-' && i + 1 < raw.length && WS.test(raw.charAt(i + 1))) continue;

      var lig = LIGATURES[ch];
      if (lig) {
        for (var k = 0; k < lig.length; k++) {
          out += lig.charAt(k);
          map.push(i);
        }
        continue;
      }

      if (ch === '‘' || ch === '’') ch = "'";
      else if (ch === '“' || ch === '”') ch = '"';

      out += ch.toLowerCase();
      map.push(i);
    }

    /* Dropped characters resolve forward to the next kept one, so a word
       offset that lands on a space still lands on a real boundary. */
    var rawToNorm = new Array(raw.length + 1);
    for (i = 0; i <= raw.length; i++) rawToNorm[i] = -1;
    for (var j = 0; j < map.length; j++) {
      if (rawToNorm[map[j]] === -1) rawToNorm[map[j]] = j;
    }
    rawToNorm[raw.length] = out.length;
    for (i = raw.length - 1; i >= 0; i--) {
      if (rawToNorm[i] === -1) rawToNorm[i] = rawToNorm[i + 1];
    }

    return { text: out, map: map, rawToNorm: rawToNorm };
  }

  function clampInt(v, lo, hi) {
    v = Math.round(Number(v) || 0);
    return v < lo ? lo : v > hi ? hi : v;
  }

  window.__raCreateHighlighter = function (doc) {
    /* Normalised document text, kept while its content signature holds. The
       node table is rebuilt per call instead, because wrapping splits nodes;
       normalising the whole document on every word kept long chapters busy. */
    var cache = null;
    /* Where the last passage was found, so the search moves forward. */
    var cursor = 0;

    function make(tag) {
      try { return doc.createElementNS(XHTML_NS, tag); }
      catch (e) { return doc.createElement(tag); }
    }

    function ensureStyle() {
      try {
        if (doc.getElementById(STYLE_ID)) return;
        var el = make('style');
        el.setAttribute('id', STYLE_ID);
        el.textContent = __RA_CSS__;
        (doc.head || doc.documentElement).appendChild(el);
      } catch (e) {}
    }

    function rootElement() {
      return doc.getElementById('reader-content') || doc.body || doc.documentElement;
    }

    function walkNodes(root) {
      var walker = doc.createTreeWalker(root, SHOW_TEXT, null, false);
      var nodes = [];
      var starts = [];
      var total = 0;
      var node;

      while ((node = walker.nextNode())) {
        var len = (node.nodeValue || '').length;
        if (!len) continue;
        var parent = node.parentNode;
        /* XHTML documents keep tag case, so compare upper-cased. */
        if (parent && SKIP_PARENTS[String(parent.nodeName).toUpperCase()]) continue;
        nodes.push(node);
        starts.push(total);
        total += len;
      }

      return { nodes: nodes, starts: starts, rawLength: total };
    }

    /* Cheap stand-in for "has the text changed": length plus both ends. */
    function signature(walk) {
      var n = walk.nodes.length;
      if (!n) return '0';
      var head = (walk.nodes[0].nodeValue || '').slice(0, 32);
      var tail = (walk.nodes[n - 1].nodeValue || '').slice(-32);
      return walk.rawLength + '|' + head + '|' + tail;
    }

    function getIndex() {
      var root = rootElement();
      if (!root) return null;

      var walk = walkNodes(root);
      var sig = signature(walk);

      if (!cache || cache.root !== root || cache.sig !== sig) {
        var raw = '';
        for (var i = 0; i < walk.nodes.length; i++) raw += walk.nodes[i].nodeValue || '';
        var norm = normalise(raw);
        cache = { root: root, sig: sig, norm: norm.text, map: norm.map };
      }

      return {
        nodes: walk.nodes,
        starts: walk.starts,
        rawLength: walk.rawLength,
        norm: cache.norm,
        map: cache.map
      };
    }

    function find(norm, needle, move, allowWrap) {
      var at = norm.indexOf(needle, cursor);
      if (at === -1 && allowWrap) at = norm.indexOf(needle);
      if (at !== -1 && move) cursor = at;
      return at;
    }

    /* Where the passage sits in the document, in normalised coordinates.
       base is the passage offset the region starts at. */
    function locateRegion(index, chunkNorm, cFrom, cTo) {
      var at = find(index.norm, chunkNorm, true, true);
      if (at !== -1) return { at: at, base: 0, len: chunkNorm.length };

      /* One odd character — an entity the extractor left undecoded, markup
         the page renders differently — breaks a 200-character match. A
         window around the word only has to agree locally. Forward-only, so
         a short anchor cannot latch onto an earlier repeat. */
      if (cTo > cFrom) {
        var from = Math.max(0, cFrom - ANCHOR_PAD);
        var to = Math.min(chunkNorm.length, cTo + ANCHOR_PAD);
        if (to - from >= MIN_ANCHOR) {
          var a = find(index.norm, chunkNorm.slice(from, to), false, false);
          if (a !== -1) return { at: a, base: from, len: to - from };
        }
      }

      var headLen = Math.min(chunkNorm.length, HEAD_LEN);
      if (headLen >= MIN_ANCHOR) {
        var h = find(index.norm, chunkNorm.slice(0, headLen), true, true);
        if (h !== -1) return { at: h, base: 0, len: headLen };
      }

      return null;
    }

    /* Which text node holds a raw character offset. */
    function locate(index, rawOffset) {
      var lo = 0;
      var hi = index.starts.length - 1;
      var best = 0;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (index.starts[mid] <= rawOffset) { best = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      return best;
    }

    /* Splits a text node so the span wraps exactly [from, to), never calling
       surroundContents on a partially selected node, which throws. */
    function wrapSpan(node, from, to, className) {
      if (to <= from) return null;
      var value = node.nodeValue || '';
      /* Whitespace between block elements: wrapping it would put a span
         where only list items or table rows belong, for no visible gain. */
      if (!/\S/.test(value.slice(from, to))) return null;
      var target = node;
      if (from > 0) target = target.splitText(from);
      if (to - from < (target.nodeValue || '').length) target.splitText(to - from);
      var parent = target.parentNode;
      if (!parent) return null;
      var span = make('span');
      span.setAttribute('class', className);
      parent.insertBefore(span, target);
      span.appendChild(target);
      return span;
    }

    function clearHighlights() {
      var spans = doc.querySelectorAll('.' + WORD_CLASS + ', .' + SENT_CLASS);
      for (var i = spans.length - 1; i >= 0; i--) {
        var sp = spans[i];
        var parent = sp.parentNode;
        if (!parent) continue;
        while (sp.firstChild) parent.insertBefore(sp.firstChild, sp);
        parent.removeChild(sp);
        /* Rejoin the split text nodes so the document returns to its original
           shape rather than fragmenting a little more with every word. */
        if (parent.normalize) parent.normalize();
      }
    }

    /* Sentence around a word, kept inside [lo, hi). */
    function sentenceBounds(norm, from, to, lo, hi) {
      var start = from;
      while (start > lo && !SENTENCE_END.test(norm.charAt(start - 1))) start--;
      var end = to;
      while (end < hi && !SENTENCE_END.test(norm.charAt(end))) end++;
      if (end < hi) end++;
      return { start: start, end: end };
    }

    function rawStart(index, n) {
      return index.map[n];
    }

    /* Exclusive raw end just after the last kept character, so a span never
       swallows the whitespace that follows a word. */
    function rawEnd(index, n) {
      return n <= 0 ? index.map[0] : index.map[n - 1] + 1;
    }

    /* Paint a band, optionally with a word inside it. Returns the element to
       keep in view: the word when there is one, otherwise the band's start. */
    function paint(index, bandFrom, bandTo, wordFrom, wordTo) {
      if (bandTo <= bandFrom) return null;

      var sFrom = rawStart(index, bandFrom);
      var sTo = rawEnd(index, bandTo);
      if (sFrom == null || sTo == null || isNaN(sTo)) return null;

      var hasWord = wordTo > wordFrom;
      var wFrom = hasWord ? rawStart(index, wordFrom) : -1;
      var wTo = hasWord ? rawEnd(index, wordTo) : -1;

      var first = locate(index, sFrom);
      var last = locate(index, Math.max(sFrom, sTo - 1));
      var wordSpan = null;
      var bandSpan = null;

      /* Back to front: wrapping splits nodes, and walking backwards keeps the
         offsets still needed for earlier nodes valid. */
      for (var n = last; n >= first; n--) {
        var node = index.nodes[n];
        if (!node || !node.parentNode) continue;
        var nodeStart = index.starts[n];
        var nodeEnd = nodeStart + (node.nodeValue || '').length;

        var a = Math.max(sFrom, nodeStart) - nodeStart;
        var b = Math.min(sTo, nodeEnd) - nodeStart;
        if (b <= a) continue;

        var wa = hasWord ? Math.max(wFrom, nodeStart) - nodeStart : 0;
        var wb = hasWord ? Math.min(wTo, nodeEnd) - nodeStart : 0;

        if (hasWord && wb > wa) {
          if (wa < a) wa = a;
          if (wb > b) wb = b;
          var tail = b > wb ? wrapSpan(node, wb, b, SENT_CLASS) : null;
          var word = wrapSpan(node, wa, wb, WORD_CLASS);
          var head = wa > a ? wrapSpan(node, a, wa, SENT_CLASS) : null;
          if (word) wordSpan = word;
          bandSpan = head || word || tail || bandSpan;
        } else {
          var only = wrapSpan(node, a, b, SENT_CLASS);
          if (only) bandSpan = only;
        }
      }

      return wordSpan || bandSpan;
    }

    /* Keep the element on screen, measured against the top-level viewport so
       it also works for a section inside an epub.js iframe. Re-centring on
       every word is nauseating, so nothing moves while it sits comfortably in
       the middle of the screen. */
    function followInView(el) {
      if (!el || !el.getBoundingClientRect) return;
      var rect = el.getBoundingClientRect();
      /* Not laid out — hidden, or a test DOM with no layout. */
      if (!rect.width && !rect.height) return;

      var win = doc.defaultView;
      if (!win) return;
      var frame = null;
      try { frame = win.frameElement; } catch (e) { frame = null; }
      var host = frame && frame.ownerDocument ? frame.ownerDocument.defaultView : win;
      if (!host) return;

      var top = rect.top;
      var bottom = rect.bottom;
      if (frame) {
        var fr = frame.getBoundingClientRect();
        top += fr.top;
        bottom += fr.top;
      }

      var height = host.innerHeight || 0;
      if (!height) return;
      if (top >= height * 0.15 && bottom <= height * 0.8) return;

      var delta = top - height * 0.35;
      try { host.scrollBy({ top: delta, behavior: 'smooth' }); }
      catch (e) { try { host.scrollBy(0, delta); } catch (e2) {} }
    }

    ensureStyle();

    return {
      /** Forget the cached index and search position (new document or chapter). */
      reset: function () {
        try { clearHighlights(); } catch (e) {}
        cache = null;
        cursor = 0;
      },

      clear: function () {
        try { clearHighlights(); } catch (e) {}
      },

      /**
       * Band the whole passage. The highlight every engine gets.
       * @returns true when the passage was found and marked.
       */
      showChunk: function (chunkText) {
        try {
          ensureStyle();
          clearHighlights();
          var index = getIndex();
          if (!index || !index.norm.length) return false;

          var chunk = normalise(String(chunkText || ''));
          if (!chunk.text.length) return false;

          var region = locateRegion(index, chunk.text, 0, 0);
          if (!region) return false;

          var el = paint(index, region.at, region.at + region.len, -1, -1);
          followInView(el);
          return !!el;
        } catch (e) {
          return false;
        }
      },

      /**
       * Mark one word and its sentence.
       * @returns true when anything was found and marked.
       */
      show: function (chunkText, wordStart, wordEnd) {
        try {
          ensureStyle();
          clearHighlights();
          var index = getIndex();
          if (!index || !index.norm.length) return false;

          var text = String(chunkText || '');
          var chunk = normalise(text);
          if (!chunk.text.length) return false;

          var cFrom = chunk.rawToNorm[clampInt(wordStart, 0, text.length)];
          var cTo = chunk.rawToNorm[clampInt(wordEnd, 0, text.length)];

          var region = locateRegion(index, chunk.text, cFrom, cTo);
          if (!region) return false;

          var regionEnd = region.at + region.len;
          var wFrom = region.at + (cFrom - region.base);
          var wTo = region.at + (cTo - region.base);
          if (wFrom < region.at) wFrom = region.at;
          if (wTo > regionEnd) wTo = regionEnd;

          var el;
          if (wTo > wFrom) {
            var sent = sentenceBounds(index.norm, wFrom, wTo, region.at, regionEnd);
            el = paint(index, sent.start, sent.end, wFrom, wTo);
          } else {
            /* The word falls outside what matched — band what did. */
            el = paint(index, region.at, regionEnd, -1, -1);
          }

          followInView(el);
          return !!el;
        } catch (e) {
          return false;
        }
      }
    };
  };
})();
`.trim();

/**
 * Defines `window.__raCreateHighlighter(doc)`. Inline it into a page that
 * needs to highlight documents other than its own — the EPUB reader.
 */
export const READ_ALOUD_HIGHLIGHTER_SOURCE = SOURCE_TEMPLATE.replace(
  "__RA_CSS__",
  () => JSON.stringify(READ_ALOUD_HIGHLIGHT_CSS),
);

/**
 * The factory plus a ready instance for the page's own document at
 * `window.__raHighlight` — what Mobile View and the DOCX viewer use.
 */
export const READ_ALOUD_HIGHLIGHT_BOOTSTRAP =
  READ_ALOUD_HIGHLIGHTER_SOURCE +
  "\nwindow.__raHighlight = window.__raCreateHighlighter(document);";

// ---------------------------------------------------------------------------
// Call builders
// ---------------------------------------------------------------------------

/** Inject the highlighter, then highlight one word. Safe to call repeatedly. */
export function buildHighlightCall(
  chunkText: string,
  wordStart: number,
  wordEnd: number,
): string {
  return (
    `(function(){try{` +
    `if(!window.__raHighlight){${READ_ALOUD_HIGHLIGHT_BOOTSTRAP}}` +
    `window.__raHighlight.show(${JSON.stringify(chunkText)},${wordStart},${wordEnd});` +
    `}catch(e){}})(); true;`
  );
}

/**
 * Install the highlighter in a document without highlighting anything.
 * Idempotent. Pair with the per-call builders so the script crosses the bridge
 * once per document rather than with every spoken word.
 */
export function buildHighlightInstall(): string {
  return (
    `(function(){try{` +
    `if(!window.__raHighlight){${READ_ALOUD_HIGHLIGHT_BOOTSTRAP}}` +
    `}catch(e){}})(); true;`
  );
}

/**
 * Highlight one word, assuming buildHighlightInstall() already ran — a few
 * hundred bytes per word instead of the whole script each time. A no-op if
 * the highlighter is not installed.
 */
export function buildHighlightShow(
  chunkText: string,
  wordStart: number,
  wordEnd: number,
): string {
  return (
    `(function(){try{if(window.__raHighlight)` +
    `window.__raHighlight.show(${JSON.stringify(chunkText)},${wordStart},${wordEnd});` +
    `}catch(e){}})(); true;`
  );
}

/**
 * Band the passage being read, assuming buildHighlightInstall() already ran.
 * A no-op if the highlighter is not installed.
 */
export function buildHighlightChunk(chunkText: string): string {
  return (
    `(function(){try{if(window.__raHighlight)` +
    `window.__raHighlight.showChunk(${JSON.stringify(chunkText)});` +
    `}catch(e){}})(); true;`
  );
}

/** Remove any current highlight without disturbing the search position. */
export function buildHighlightClear(): string {
  return `(function(){try{if(window.__raHighlight)window.__raHighlight.clear();}catch(e){}})(); true;`;
}

/** Drop the cached index and search position — a new document or chapter. */
export function buildHighlightReset(): string {
  return `(function(){try{if(window.__raHighlight)window.__raHighlight.reset();}catch(e){}})(); true;`;
}

/** A `<style>` block for documents that are assembled as HTML strings. */
export function buildHighlightStyleTag(): string {
  return `<style>${READ_ALOUD_HIGHLIGHT_CSS}</style>`;
}

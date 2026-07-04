/**
 * Document Reflow Service — FULLY OFFLINE
 * Generates self-contained reflow HTML that runs entirely inside the WebView.
 * PDF text extraction uses pdf.js, bundled from assets/vendor (no CDN).
 * DOCX conversion uses Mammoth.js, bundled from assets/vendor (no CDN).
 */
import type {
    ReaderSettings,
    ReflowResponse,
} from "@/src/types/document-viewer.types";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { loadMobileViewVendorScripts } from "./mobileViewVendorLoader";

// Reading the file as base64 inflates it ~4/3 and the result is embedded in a
// single HTML string, so very large documents risk an OOM before the WebView
// ever finishes loading. 25 MB mirrors the ceiling used elsewhere for
// in-WebView PDF work (text-layer renderer, pre-extraction). Android 9 and
// below commonly run the WebView renderer in-process with tighter memory, so
// they get a lower ceiling instead of being locked out of Mobile View.
const MAX_REFLOW_BYTES =
  Platform.OS === "android" && (Platform.Version as number) < 29
    ? 15 * 1024 * 1024
    : 25 * 1024 * 1024;

const FILE_TOO_LARGE = "FILE_TOO_LARGE";

const TOO_LARGE_RESPONSE: ReflowResponse = {
  success: false,
  error: "File too large",
  message:
    "This document is too large for Mobile View. Please use Original view.",
};

// ============================================================================
// DOCUMENT BYTE DELIVERY
// Android: the WebView XHRs the document from a file:// URI. Inlining the
// bytes as base64 forced the RN JS heap to hold 3–4 transient copies of a
// 30+ MB string and push it through the bridge — long stalls, then an
// app-process OOM that no JS fallback can catch. With the XHR the document
// bytes never leave the WebView.
// iOS: WKWebView blocks file:// XHR but handles large inline HTML fine, so
// it keeps the original inline-base64 path.
// ============================================================================

const DOC_BYTES_LOADER_JS = `
  function loadDocumentBytes(SOURCE, onBytes, onFail) {
    if (SOURCE && SOURCE.base64) {
      try {
        var raw = atob(SOURCE.base64);
        var u8 = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
        onBytes(u8);
      } catch (e) { onFail(e); }
      return;
    }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', SOURCE.url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = function() {
      // file:// XHR reports status 0 on success.
      if (xhr.response && (xhr.status === 200 || xhr.status === 0)) {
        onBytes(new Uint8Array(xhr.response));
      } else {
        onFail(new Error('Could not read the document (status ' + xhr.status + ')'));
      }
    };
    xhr.onerror = function() { onFail(new Error('Could not read the document file')); };
    xhr.send();
  }
`;

/** Tracks the previous content:// staging copy per format so repeated opens
 *  don't accumulate files in the cache directory. */
const _lastStagedCopy: Record<string, string | null> = {};

/** Returns a file:// URI the WebView can XHR. content:// (SAF) documents are
 *  copied into the app cache first — a WebView cannot read them directly. */
async function ensureWebViewReadableUri(
  fileUri: string,
  kind: "pdf" | "docx",
): Promise<string> {
  if (fileUri.startsWith("file://")) return fileUri;
  if (fileUri.startsWith("/")) return `file://${fileUri}`;
  const dir = FileSystem.cacheDirectory + "mobileview/";
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch {
    // Directory already exists — fine.
  }
  const dest = `${dir}src-${kind}-${Date.now()}`;
  await FileSystem.copyAsync({ from: fileUri, to: dest });
  const prev = _lastStagedCopy[kind];
  if (prev && prev !== dest) {
    FileSystem.deleteAsync(prev, { idempotent: true }).catch(() => {});
  }
  _lastStagedCopy[kind] = dest;

  // content:// sources often report no size up front, which bypasses the
  // pre-flight ceiling — enforce it on the staged copy instead so an
  // oversized document can never reach the parser.
  try {
    const copied = await FileSystem.getInfoAsync(dest);
    if (
      copied.exists &&
      typeof copied.size === "number" &&
      copied.size > MAX_REFLOW_BYTES
    ) {
      FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
      _lastStagedCopy[kind] = null;
      throw new Error(FILE_TOO_LARGE);
    }
  } catch (e: any) {
    if (e?.message === FILE_TOO_LARGE) throw e;
    // Stat failure alone shouldn't block the feature.
  }
  return dest;
}

/** Builds the JS object literal the reflow HTML reads its bytes from. */
async function buildDocumentSourceLiteral(
  fileUri: string,
  kind: "pdf" | "docx",
): Promise<string> {
  if (Platform.OS === "android") {
    const localUri = await ensureWebViewReadableUri(fileUri, kind);
    return `{ url: ${JSON.stringify(localUri)} }`;
  }
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return `{ base64: ${JSON.stringify(base64)} }`;
}

// Escaping the ~1.3 MB pdf.js worker on every HTML build is measurable work.
// The vendor scripts are immutable singletons (loaded once), so cache the
// escaped result keyed on the source string reference.
const _escapeCache = new Map<string, string>();
function escapeForScriptTag(js: string): string {
  const hit = _escapeCache.get(js);
  if (hit !== undefined) return hit;
  const escaped = js.replace(/<\/script/gi, "<\\/script");
  // Only retain large vendor blobs (the things worth caching); skip tiny
  // one-off strings so the map can't grow unbounded.
  if (js.length > 4096) _escapeCache.set(js, escaped);
  return escaped;
}

// ============================================================================
// THEME PALETTE (mirrors backend reflowService)
// ============================================================================
const THEMES: Record<
  string,
  { bg: string; text: string; link: string; border: string }
> = {
  light: { bg: "#ffffff", text: "#1a1a1a", link: "#0066cc", border: "#e0e0e0" },
  sepia: { bg: "#f4ecd8", text: "#5c4a3a", link: "#8b4513", border: "#d4c4a8" },
  dark: { bg: "#1a1a1a", text: "#e0e0e0", link: "#66b3ff", border: "#333333" },
};

// ============================================================================
// SHARED REFLOW CSS + JS (scroll tracking, style updates, ready signal)
// Exposes: updateStyles, scrollToPosition — called by MobileRenderer.
// Search, text selection, and annotations are provided by SELECTION_BRIDGE_JS
// (utils/selectionScripts.ts), which MobileRenderer always injects into this
// HTML before loading it — do not duplicate those functions here.
// ============================================================================

function readerCSS(settings: ReaderSettings): string {
  const t = THEMES[settings.theme] || THEMES.light;
  return `
:root{--fs:${settings.fontSize}px;--lh:${settings.lineHeight};--ff:${settings.fontFamily},-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;--bg:${t.bg};--fg:${t.text};--link:${t.link};--border:${t.border}}
*{margin:0;padding:0;box-sizing:border-box;-webkit-user-select:text;user-select:text}
html{font-size:var(--fs);-webkit-text-size-adjust:100%}
body{font-family:var(--ff);line-height:var(--lh);color:var(--fg);background:var(--bg);padding:0;margin:0;overflow-x:hidden;-webkit-font-smoothing:antialiased;cursor:text}
.reader-content{max-width:100%;padding:20px 16px;margin:0 auto}
p{margin-bottom:1em;text-align:left;word-wrap:break-word;overflow-wrap:break-word}
h1,h2,h3,h4,h5,h6{margin-top:1.5em;margin-bottom:.5em;font-weight:600;line-height:1.3;color:var(--fg)}
h1{font-size:1.8em}h2{font-size:1.5em}h3{font-size:1.3em}h4{font-size:1.1em}
h1:first-child,h2:first-child,h3:first-child{margin-top:0}
a{color:var(--link);text-decoration:underline;word-break:break-word}
ul,ol{margin-bottom:1em;padding-left:1.5em}
li{margin-bottom:.5em}
strong,b{font-weight:600}em,i{font-style:italic}
code{font-family:'Courier New',Courier,monospace;background:rgba(0,0,0,.05);padding:2px 4px;border-radius:3px;font-size:.9em}
pre{background:rgba(0,0,0,.05);padding:12px;border-radius:4px;overflow-x:auto;margin-bottom:1em}
pre code{background:none;padding:0}
img{max-width:100%;height:auto;display:block;margin:1em auto;border-radius:4px}
table{width:100%;border-collapse:collapse;margin-bottom:1em;display:block;overflow-x:auto}
th,td{border:1px solid var(--border);padding:8px 12px;text-align:left}
th{background:rgba(0,0,0,.05);font-weight:600}
blockquote{border-left:4px solid var(--border);padding-left:1em;margin:1em 0;font-style:italic;opacity:.9}
hr{border:none;border-top:2px solid var(--border);margin:2em 0}
::selection{background:rgba(100,150,255,.3)}
#loading-indicator{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;color:var(--fg)}
#loading-indicator .spinner{width:40px;height:40px;border:4px solid var(--border);border-top-color:var(--link);border-radius:50%;animation:spin 0.8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
#error-container{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;padding:32px;text-align:center;color:var(--fg)}
#error-container .icon{font-size:48px;margin-bottom:12px}
#error-container .title{font-size:18px;font-weight:700;margin-bottom:8px}
#error-container .message{font-size:14px;opacity:.7}
`;
}

function readerJS(): string {
  // This JS string is injected into the HTML <script>. It MUST expose the
  // window functions that MobileRenderer calls via injectJavaScript.
  return `
(function(){
  var THEMES = ${JSON.stringify(THEMES)};

  // ── Scroll tracking ──
  var scrollTimer;
  window.addEventListener('scroll', function(){
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function(){
      var pct = (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100;
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'scroll',
        scrollY: window.scrollY,
        scrollPercent: Math.round(pct)
      }));
    }, 150);
  });

  // ── Style update ──
  window.updateStyles = function(fs, lh, th) {
    var r = document.documentElement;
    r.style.setProperty('--fs', fs + 'px');
    r.style.setProperty('--lh', lh);
    var t = THEMES[th] || THEMES.light;
    r.style.setProperty('--bg', t.bg);
    r.style.setProperty('--fg', t.text);
    r.style.setProperty('--link', t.link);
    r.style.setProperty('--border', t.border);
    document.body.className = 'theme-' + th;
  };

  window.scrollToPosition = function(pos) {
    window.scrollTo({ top: pos, behavior: 'smooth' });
  };

  // ── Signal ready ──
  window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
})();
`;
}

// ============================================================================
// PDF REFLOW — fully local, uses pdf.js in the WebView
// ============================================================================

/**
 * Generate a self-contained HTML page that:
 * 1. Inlines pdf.js (bundled as a local asset — no network)
 * 2. Loads the PDF bytes (Android: file:// XHR inside the WebView;
 *    iOS: inline base64)
 * 3. Extracts text from every page
 * 4. Renders reflowed paragraphs inside .reader-content
 * 5. Includes scroll/style JS (search & selection come from the bridge)
 */
export async function reflowPDF(
  fileUri: string,
  settings: ReaderSettings,
): Promise<ReflowResponse> {
  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    if (!info.exists) throw new Error("File not found");
    if (typeof info.size === "number" && info.size > MAX_REFLOW_BYTES) {
      return TOO_LARGE_RESPONSE;
    }

    const vendor = await loadMobileViewVendorScripts();

    // Android: file:// URL the WebView XHRs. iOS: inline base64.
    const sourceLiteral = await buildDocumentSourceLiteral(fileUri, "pdf");

    const css = readerCSS(settings);
    const js = readerJS();
    const theme = settings.theme || "light";

    const pdfMinJs = escapeForScriptTag(vendor.pdfMinJs);
    const pdfWorkerMinJs = escapeForScriptTag(vendor.pdfWorkerMinJs);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
<title>Mobile View</title>
<style>${css}</style>
<script>${pdfMinJs}<\/script>
</head>
<body class="theme-${theme}">
<!-- Loading indicator -->
<div id="loading-indicator">
  <div class="spinner"></div>
  <p style="margin-top:16px;font-size:15px;">Processing…</p>
</div>

<!-- Error container (hidden initially) -->
<div id="error-container" style="display:none">
  <div class="icon">⚠️</div>
  <div class="title" id="error-title">Processing failed</div>
  <div class="message" id="error-message"></div>
</div>

<!-- Reader content populated by JS -->
<article class="reader-content" id="reader-content" style="display:none"></article>

<!-- Worker UMD loaded as a real main-thread script (not a Blob worker).
     This defines globalThis.pdfjsWorker so pdf.js can parse in-thread, which
     is the only reliable mode inside older / low-end Android WebViews. -->
<script>${pdfWorkerMinJs}<\/script>
<script>
(function(){
  var PDF_SOURCE = ${sourceLiteral};
${DOC_BYTES_LOADER_JS}
  var rc = document.getElementById('reader-content');
  var loading = document.getElementById('loading-indicator');
  var renderedAny = false;
  var fullTextParts = [];

  function showError(title, msg) {
    if (loading) loading.style.display = 'none';
    var ec = document.getElementById('error-container');
    ec.style.display = 'flex';
    document.getElementById('error-title').textContent = title;
    document.getElementById('error-message').textContent = msg;
    // Still signal ready so RN doesn't hang, then report the failure so the
    // viewer can fall back to Original view with an explanation.
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'reflow-error', title: title, message: msg }));
  }

  // Heading heuristics (same as backend)
  function detectBlockType(text) {
    var trimmed = text.trim();
    if (!trimmed) return 'p';
    var isShort = trimmed.length < 120;
    var isCapitalized = trimmed === trimmed.toUpperCase() && trimmed.length > 2;
    var noEndPunct = !/[.!?,;:]$/.test(trimmed);
    if (isShort && isCapitalized && noEndPunct) return 'h2';
    if (isShort && noEndPunct && /^(chapter|section|part)\\s/i.test(trimmed)) return 'h1';
    if (isShort && noEndPunct && trimmed.length < 60) return 'h3';
    return 'p';
  }

  function escapeHtml(t) {
    return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Rebuild real lines + paragraphs from pdf.js text items using end-of-line
  // markers and glyph positions. Without this, items get joined with a single
  // space and every page collapses into one run-on block — the cause of the
  // "scattered / disarranged" layout. Returns an array of paragraph strings.
  function reconstructPage(content) {
    var items = (content && content.items) || [];
    var lines = [];
    var cur = null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var s = (it && typeof it.str === 'string') ? it.str : '';
      var tr = (it && it.transform) ? it.transform : [1,0,0,1,0,0];
      var x = tr[4], y = tr[5];
      var h = (it && it.height) ? it.height : (Math.abs(tr[3]) || 12);
      if (cur === null) {
        cur = { y: y, x: x, h: h, text: s };
      } else if (Math.abs(y - cur.y) <= Math.max(2, cur.h * 0.5)) {
        // Same visual line — append, inserting a space only when needed.
        if (s) {
          var needSpace = cur.text.length > 0 && !/\\s$/.test(cur.text) && !/^\\s/.test(s);
          cur.text += (needSpace ? ' ' : '') + s;
        }
        if (x < cur.x) cur.x = x;
      } else {
        lines.push(cur);
        cur = { y: y, x: x, h: h, text: s };
      }
      if (it && it.hasEOL && cur) {
        lines.push(cur);
        cur = null;
      }
    }
    if (cur) lines.push(cur);

    for (var j = 0; j < lines.length; j++) {
      lines[j].text = lines[j].text.replace(/\\s+/g, ' ').trim();
    }

    // Median line spacing → baseline for detecting paragraph gaps.
    var gaps = [];
    for (var k = 1; k < lines.length; k++) {
      var g = Math.abs(lines[k-1].y - lines[k].y);
      if (g > 0.1) gaps.push(g);
    }
    gaps.sort(function(a,b){ return a - b; });
    var medGap = gaps.length ? gaps[Math.floor(gaps.length/2)] : 0;

    var paras = [];
    var buf = [];
    for (var m = 0; m < lines.length; m++) {
      var ln = lines[m];
      if (ln.text === '') {
        if (buf.length) { paras.push(buf); buf = []; }
        continue;
      }
      if (buf.length) {
        var prev = buf[buf.length - 1];
        var gap = Math.abs(prev.y - ln.y);
        var bigGap = medGap > 0 && gap > medGap * 1.6;
        var prevEnds = /[.!?]["'\\)\\]]?$/.test(prev.text);
        var startsCap = /^[A-Z0-9"\\u201c(\\[]/.test(ln.text);
        if (bigGap || (prevEnds && startsCap && medGap > 0 && gap > medGap * 1.25)) {
          paras.push(buf); buf = [];
        }
      }
      buf.push(ln);
    }
    if (buf.length) paras.push(buf);

    var out = [];
    for (var p2 = 0; p2 < paras.length; p2++) {
      var pl = paras[p2];
      var txt = '';
      for (var q = 0; q < pl.length; q++) {
        var t = pl[q].text;
        if (!t) continue;
        if (txt === '') { txt = t; continue; }
        if (/[A-Za-z]-$/.test(txt)) {
          txt = txt.replace(/-$/, '') + t;  // de-hyphenate wrapped word
        } else {
          txt += ' ' + t;
        }
      }
      txt = txt.replace(/\\s+/g, ' ').trim();
      if (txt) out.push(txt);
    }
    return out;
  }

  // Append a page's paragraphs as they arrive (progressive render).
  function appendParagraphs(paras) {
    if (!paras || !paras.length) return;
    var html = '';
    for (var i = 0; i < paras.length; i++) {
      var clean = paras[i];
      if (!clean) continue;
      var tag = detectBlockType(clean);
      html += '<' + tag + '>' + escapeHtml(clean) + '</' + tag + '>';
      fullTextParts.push(clean);
    }
    if (!html) return;
    if (!renderedAny) {
      renderedAny = true;
      if (loading) loading.style.display = 'none';
      rc.style.display = 'block';
    }
    rc.insertAdjacentHTML('beforeend', html);
  }

  if (typeof pdfjsLib === 'undefined') {
    showError('Library not loaded', 'Mobile View library failed to initialize. Please reopen the document.');
    return;
  }

  // Force in-thread parsing. A Blob-URL worker often initialises but never
  // responds inside an Android WebView, so getDocument() would hang forever.
  try { pdfjsLib.GlobalWorkerOptions.workerSrc = ''; } catch (_) {}
  try { pdfjsLib.disableWorker = true; } catch (_) {}

  loadDocumentBytes(PDF_SOURCE, function(uint8) {
    // disableFontFace: we only extract text, never draw glyphs — skip
    // materialising embedded fonts as browser FontFace objects. Every byte
    // saved matters on devices whose WebView renderer runs in-process.
    pdfjsLib.getDocument({ data: uint8, disableWorker: true, disableFontFace: true }).promise.then(function(pdf) {
      uint8 = null; // pdf.js owns the bytes now — let the copy be collected
      var total = pdf.numPages;

      // Extract page-by-page IN ORDER and render each page the moment it is
      // ready. The first page appears almost immediately instead of waiting
      // for the whole document to parse — and large PDFs no longer block.
      // page.cleanup() releases each page's fonts/objects as soon as its
      // text is out, keeping peak memory ~one page instead of the whole doc.
      function processPage(pageNum) {
        return pdf.getPage(pageNum)
          .then(function(page) {
            return page.getTextContent().then(function(content) {
              try { page.cleanup(); } catch (_) {}
              return content;
            });
          })
          .then(function(content) { appendParagraphs(reconstructPage(content)); })
          .catch(function() { /* skip an unreadable page */ });
      }

      var chain = Promise.resolve();
      for (var p = 1; p <= total; p++) {
        (function(n) { chain = chain.then(function() { return processPage(n); }); })(p);
      }
      chain.then(function() {
        if (!renderedAny) {
          try { pdf.destroy(); } catch (_) {}
          showError('Scanned Document', 'This PDF appears to be scanned or image-based. Please use Original view.');
          return;
        }
        // Post the full extracted text for Read Aloud.
        var allText = fullTextParts.join('\\n\\n');
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'read-aloud-text', text: allText }));
        // The DOM now holds everything the reader needs — free the parsed
        // document and its byte buffer entirely.
        try { pdf.destroy(); } catch (_) {}
      });
    }).catch(function(err) {
      showError('PDF Error', (err && err.message) || 'Failed to parse PDF');
    });
  }, function(e) {
    showError('PDF Error', (e && e.message) || 'Failed to load PDF data');
  });
})();
<\/script>

<!-- Reflow JS: search, highlight, selection, scroll -->
<script>
${js}
<\/script>
</body>
</html>`;

    return { success: true, html };
  } catch (error: any) {
    if (error?.message === FILE_TOO_LARGE) return TOO_LARGE_RESPONSE;
    console.error("[ReflowService] reflowPDF error:", error);
    return {
      success: false,
      error: error.message || "Failed to process PDF",
      message: "Could not generate Mobile View for this PDF.",
    };
  }
}

// ============================================================================
// DOCX REFLOW — fully local, uses Mammoth.js in the WebView
// ============================================================================

/**
 * Generate a self-contained HTML page that:
 * 1. Inlines Mammoth.js (bundled as a local asset — no network)
 * 2. Loads the DOCX bytes (Android: file:// XHR inside the WebView;
 *    iOS: inline base64)
 * 3. Converts DOCX → HTML with Mammoth
 * 4. Renders inside .reader-content with mobile-optimised styles
 * 5. Includes scroll/style JS (search & selection come from the bridge)
 */
export async function reflowDOCX(
  fileUri: string,
  settings: ReaderSettings,
): Promise<ReflowResponse> {
  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    if (!info.exists) throw new Error("File not found");
    if (typeof info.size === "number" && info.size > MAX_REFLOW_BYTES) {
      return TOO_LARGE_RESPONSE;
    }

    const vendor = await loadMobileViewVendorScripts();

    // Android: file:// URL the WebView XHRs. iOS: inline base64.
    const sourceLiteral = await buildDocumentSourceLiteral(fileUri, "docx");

    const css = readerCSS(settings);
    const js = readerJS();
    const theme = settings.theme || "light";

    const mammothJs = escapeForScriptTag(vendor.mammothBrowserMinJs);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
<title>Mobile View</title>
<style>${css}</style>
<script>${mammothJs}<\/script>
</head>
<body class="theme-${theme}">
<!-- Loading indicator -->
<div id="loading-indicator">
  <div class="spinner"></div>
  <p style="margin-top:16px;font-size:15px;">Processing…</p>
</div>

<!-- Error container -->
<div id="error-container" style="display:none">
  <div class="icon">⚠️</div>
  <div class="title" id="error-title">Conversion failed</div>
  <div class="message" id="error-message"></div>
</div>

<!-- Reader content populated by JS -->
<article class="reader-content" id="reader-content" style="display:none"></article>

<script>
(function(){
  var DOCX_SOURCE = ${sourceLiteral};
${DOC_BYTES_LOADER_JS}
  function showError(title, msg) {
    document.getElementById('loading-indicator').style.display = 'none';
    var ec = document.getElementById('error-container');
    ec.style.display = 'flex';
    document.getElementById('error-title').textContent = title;
    document.getElementById('error-message').textContent = msg;
    // Signal ready so RN doesn't hang, then report the failure so the viewer
    // can fall back to Original view with an explanation.
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'reflow-error', title: title, message: msg }));
  }

  if (typeof mammoth === 'undefined') {
    showError('Library not loaded', 'Mobile View library failed to initialize. Please reopen the document.');
    return;
  }

  loadDocumentBytes(DOCX_SOURCE, function(uint8) {
    mammoth.convertToHtml(
      { arrayBuffer: uint8.buffer },
      {
        styleMap: [
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Title'] => h1.title:fresh",
          "table[style-name='Table Grid'] => table.docx-table",
          "table[style-name='TableGrid']  => table.docx-table",
          "table[style-name='Normal Table'] => table.docx-table",
          "table => table.docx-table",
          "tr => tr",
          "td => td",
          "th => th",
          "b => strong",
          "i => em"
        ],
        includeDefaultStyleMap: true,
        ignoreEmptyParagraphs: false,
        convertImage: mammoth.images.imgElement(function(image) {
          return image.read('base64').then(function(imageData) {
            return {
              src: 'data:' + image.contentType + ';base64,' + imageData
            };
          });
        })
      }
    ).then(function(result) {
      document.getElementById('loading-indicator').style.display = 'none';
      var rc = document.getElementById('reader-content');
      rc.innerHTML = result.value;
      rc.style.display = 'block';

      // Post extracted text for Read Aloud (fixes race with 'ready' signal)
      var raText = rc.innerText || rc.textContent || '';
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'read-aloud-text', text: raText }));
    }).catch(function(err) {
      showError('Conversion Error', err.message || 'Failed to convert DOCX');
    });
  }, function(e) {
    showError('DOCX Error', (e && e.message) || 'Failed to load DOCX data');
  });
})();
<\/script>

<!-- Reflow JS: search, highlight, selection, scroll -->
<script>
${js}
<\/script>
</body>
</html>`;

    return { success: true, html };
  } catch (error: any) {
    if (error?.message === FILE_TOO_LARGE) return TOO_LARGE_RESPONSE;
    console.error("[ReflowService] reflowDOCX error:", error);
    return {
      success: false,
      error: error.message || "Failed to process DOCX",
      message: "Could not generate Mobile View for this document.",
    };
  }
}

// ============================================================================
// PDF TEXT EXTRACTION — lightweight, no rendering, used by Read Aloud
// ============================================================================

/**
 * Generate a minimal self-contained HTML page that:
 * 1. Inlines pdf.js (bundled, no CDN)
 * 2. Decodes the base64 PDF
 * 3. Extracts text from every page WITHOUT rendering anything
 * 4. Posts { type: 'pdf-page-texts', pageTexts: string[] } back to RN
 * 5. Posts { type: 'pdf-text-error', message: string } on failure
 *
 * This HTML is intended for a hidden 0-height WebView. It is completely
 * independent of the Mobile View rendering pipeline.
 */
export async function generatePdfTextExtractionHtml(
  fileUri: string,
): Promise<{ html: string } | { error: string }> {
  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    if (!info.exists) return { error: "File not found" };

    const vendor = await loadMobileViewVendorScripts();
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const pdfMinJs = escapeForScriptTag(vendor.pdfMinJs);
    // Loaded as a REAL (executable) script — not a Blob worker. Running the
    // worker UMD on the main thread defines globalThis.pdfjsWorker, which
    // pdf.js then uses for in-thread parsing (disableWorker). This avoids the
    // Blob-worker-that-never-responds hang inside a hidden Android WebView.
    const pdfWorkerMinJs = escapeForScriptTag(vendor.pdfWorkerMinJs);

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
<script>${pdfMinJs}<\/script>
<script>${pdfWorkerMinJs}<\/script>
<script>
(function(){
  function post(obj){
    try{ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(obj)); }catch(_){}
  }

  if(typeof pdfjsLib==='undefined'){
    post({type:'pdf-text-error',message:'pdf.js not loaded'});
    return;
  }

  // IMPORTANT: run pdf.js entirely in-thread (no Web Worker).
  // In a hidden WebView, a Blob-URL worker often *appears* to initialise but
  // never actually responds on Android, so getDocument() hangs forever and
  // Read Aloud sees nothing (then times out). In-thread parsing is a little
  // slower per page but always works — and because we stream page-by-page,
  // page 1 still arrives within a second or two.
  try{ pdfjsLib.GlobalWorkerOptions.workerSrc=''; }catch(_){}
  try{ pdfjsLib.disableWorker=true; }catch(_){}

  function buildPageText(content){
    var out='';
    var items=content.items||[];
    for(var i=0;i<items.length;i++){
      var it=items[i];
      var s=(it && typeof it.str==='string')?it.str:'';
      out+=s;
      // Preserve line breaks where pdf.js reports them.
      if(it && it.hasEOL) out+='\\n';
      else out+=' ';
    }
    return out;
  }

  try{
    var raw=atob(${JSON.stringify(base64)});
    var uint8=new Uint8Array(raw.length);
    for(var i=0;i<raw.length;i++) uint8[i]=raw.charCodeAt(i);

    pdfjsLib.getDocument({data:uint8, disableWorker:true}).promise.then(function(pdf){
      var total=pdf.numPages;
      var pageTexts=new Array(total);

      if(total===0){
        post({type:'pdf-page-texts',pageTexts:[]});
        return;
      }

      // Extract SEQUENTIALLY (page 1, 2, 3 …) and post each page as soon as
      // it is ready. This lets Read Aloud start speaking page 1 while the rest
      // of the document is still being parsed — instead of blocking on the
      // whole file. It also means large PDFs no longer hit the extraction
      // timeout, because content arrives progressively.
      function extractPage(p){
        return pdf.getPage(p)
          .then(function(page){ return page.getTextContent(); })
          .then(function(content){ return buildPageText(content); })
          .catch(function(){ return ''; })
          .then(function(text){
            pageTexts[p-1]=text;
            // Incremental, in-order progress for streaming consumers.
            post({type:'pdf-page-progress',index:p-1,total:total,text:text});
          });
      }

      // Chain pages so they resolve strictly in order (stable global offsets).
      var chain=Promise.resolve();
      for(var p=1;p<=total;p++){
        (function(pageNum){
          chain=chain.then(function(){ return extractPage(pageNum); });
        })(p);
      }
      chain.then(function(){
        // Final aggregate message — preserves the original contract used by
        // search and any non-streaming consumer.
        post({type:'pdf-page-texts',pageTexts:pageTexts});
      });
    }).catch(function(err){
      post({type:'pdf-text-error',message:(err && err.message)||'PDF load failed'});
    });
  }catch(e){
    post({type:'pdf-text-error',message:(e && e.message)||'Decode failed'});
  }
})();
<\/script>
</body>
</html>`;

    return { html };
  } catch (err: any) {
    return { error: err.message || "Failed to generate extraction HTML" };
  }
}

/**
 * Visible-region HTML capture, for Bookmarks.
 *
 * DOCX and EPUB pages have no rasteriser in this app — there is no native view
 * capture — so "a picture of the page" is not available for them. What IS
 * available is better in some ways: the page's own markup, re-rendered later by
 * the same engine that drew it. Fonts, spacing, tables, lists, emphasis and
 * inline images all come back; it reflows to the saved-page screen's width
 * instead of being a fixed bitmap.
 *
 * WHY THE SANITISER IS DOM-BASED
 * The captured markup is stored and re-rendered in a WebView later, so it has
 * to be inert. Sanitising HTML with regexes is a well-known way to be wrong;
 * here we are already inside a DOM, so we clone the nodes and walk them.
 *
 * This is the inner of two layers. app/saved-page.tsx renders the result with
 * every navigation refused and no network reachable, so even markup that got
 * past the walk has nowhere to go. JavaScript is ON in that WebView — not to
 * run the captured page, which has had its scripts removed here, but because
 * the shell's own height reporter is what sizes the view to its content.
 *
 * Worth being plain about the trust model: this markup came from a document
 * the user opened in a JS-enabled reader WebView moments earlier, so storing
 * and replaying it is not a new trust boundary. It is treated as untrusted
 * anyway, because a bookmark can be reopened years later.
 *
 * WHAT SURVIVES: structural and text markup, inline styles, and images that are
 * already self-contained (data: URIs).
 * WHAT DOES NOT: script/style/link/iframe/object/embed/form elements, every
 * on* handler, and any src/href that is not a data: URI — a blob: or remote URL
 * would be dead by the time the bookmark is reopened anyway.
 */

/** Longest HTML snapshot kept, in characters. */
export const HTML_SNAPSHOT_MAX = 60_000;

/**
 * JS source defining `__inscribedCaptureVisibleHtml(rootDoc, viewportHeight)`.
 *
 * Returns `{ html, css }` where `css` is a small computed-style summary of the
 * reading surface — enough to reproduce the look without dragging the reader's
 * whole stylesheet along with every bookmark.
 *
 * Injected verbatim into both reflow readers so the two capture paths cannot
 * drift apart. Written in ES5 for the oldest Android System WebView we support.
 */
export const PAGE_HTML_CAPTURE_JS = `
var __INSCRIBED_HTML_MAX = ${HTML_SNAPSHOT_MAX};

function __inscribedSanitizeInto(node) {
  var drop = node.querySelectorAll(
    'script,style,link,iframe,object,embed,form,input,button,select,textarea,noscript'
  );
  for (var i = 0; i < drop.length; i++) {
    if (drop[i].parentNode) drop[i].parentNode.removeChild(drop[i]);
  }
  var all = node.querySelectorAll('*');
  for (var j = 0; j < all.length; j++) {
    var el = all[j];
    var attrs = el.attributes;
    // Iterate backwards: removeAttribute mutates the live collection.
    for (var k = attrs.length - 1; k >= 0; k--) {
      var name = (attrs[k].name || '').toLowerCase();
      var value = attrs[k].value || '';
      if (name.indexOf('on') === 0) { el.removeAttribute(attrs[k].name); continue; }
      if (name === 'src' || name === 'href' || name === 'xlink:href') {
        if (value.slice(0, 5).toLowerCase() !== 'data:') {
          el.removeAttribute(attrs[k].name);
        }
        continue;
      }
      if (name === 'srcset' || name === 'poster' || name === 'background') {
        el.removeAttribute(attrs[k].name);
      }
    }
    // An image whose source was just stripped is an empty box; drop it.
    var tag = (el.tagName || '').toLowerCase();
    if ((tag === 'img' || tag === 'image') && !el.getAttribute('src') && !el.getAttribute('xlink:href')) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  }
  return node;
}

function __inscribedSurfaceCss(doc, root) {
  try {
    var view = doc.defaultView;
    if (!view || !view.getComputedStyle) return '';
    var s = view.getComputedStyle(root);
    var parts = [
      'font-family:' + (s.fontFamily || 'serif'),
      'font-size:' + (s.fontSize || '16px'),
      'line-height:' + (s.lineHeight || '1.6'),
      'text-align:' + (s.textAlign || 'left'),
      'color:' + (s.color || '#000')
    ];
    return parts.join(';');
  } catch (e) {
    return '';
  }
}

/**
 * Collect the markup of every block intersecting the viewport.
 * viewportHeight of 0 means "everything laid out here is on screen"
 * (epub.js paginated mode).
 */
function __inscribedCaptureVisibleHtml(doc, root, viewportHeight) {
  try {
    if (!doc || !root) return { html: '', css: '' };
    var nodes = root.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,table,figure,ul,ol,img');
    var picked = [];
    var size = 0;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      // A block already inside a picked ancestor would be captured twice.
      var nested = false;
      for (var p = 0; p < picked.length; p++) {
        if (picked[p].contains(el)) { nested = true; break; }
      }
      if (nested) continue;
      var r = el.getBoundingClientRect();
      var visible = viewportHeight === 0
        ? true
        : (r.bottom > 0 && r.top < viewportHeight && r.height > 0);
      if (!visible) continue;
      picked.push(el);
      size += (el.outerHTML || '').length;
      if (size > __INSCRIBED_HTML_MAX) break;
    }
    if (!picked.length) return { html: '', css: '' };

    var holder = doc.createElement('div');
    for (var q = 0; q < picked.length; q++) {
      holder.appendChild(picked[q].cloneNode(true));
    }
    __inscribedSanitizeInto(holder);
    return {
      html: (holder.innerHTML || '').slice(0, __INSCRIBED_HTML_MAX),
      css: __inscribedSurfaceCss(doc, root)
    };
  } catch (e) {
    return { html: '', css: '' };
  }
}
`;

/**
 * Wrap a stored snapshot into a standalone document for re-rendering.
 *
 * Built on the RN side rather than stored per bookmark, so the shell — theme
 * colours, margins, responsive images — can change later and every saved page
 * picks the change up. Only the body markup and the surface CSS are stored.
 *
 * The one script in the result is the height reporter below; the stored markup
 * had every script removed at capture time. app/saved-page.tsx renders this
 * with all navigation and network blocked, so the height report is the only
 * thing that can run.
 */
export function buildSnapshotDocument(options: {
  html: string;
  css: string;
  textColor: string;
  backgroundColor: string;
}): string {
  const { html, css, textColor, backgroundColor } = options;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  html,body{margin:0;padding:0;background:${backgroundColor};}
  body{
    padding:2px 0 8px;
    color:${textColor};
    -webkit-text-size-adjust:100%;
    word-wrap:break-word;
    overflow-wrap:break-word;
    ${css}
  }
  img{max-width:100%;height:auto;}
  table{max-width:100%;border-collapse:collapse;}
  td,th{border:1px solid rgba(128,128,128,0.35);padding:4px 6px;}
  pre{white-space:pre-wrap;}
  a{color:inherit;text-decoration:underline;}
  p,li,blockquote,h1,h2,h3,h4,h5,h6{margin:0 0 0.75em;}
</style>
</head>
<body>${html}
<script>
(function(){
  // Report the rendered height so the host can size the view to the page
  // instead of guessing and leaving a gap or a scrollbar-in-a-scrollbar.
  function report(){
    try{
      var h = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      );
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'height',height:h}));
    }catch(e){}
  }
  report();
  window.addEventListener('load', report);
  setTimeout(report, 150);
  setTimeout(report, 600);
})();
<\/script>
</body>
</html>`;
}

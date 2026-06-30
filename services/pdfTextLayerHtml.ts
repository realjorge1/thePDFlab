/**
 * pdfTextLayerHtml.ts — WPS-style in-place selectable PDF renderer.
 *
 * Generates a self-contained HTML page that renders a PDF inside a WebView the
 * same way pdf.js does in the browser:
 *
 *   1. Each page is painted to a <canvas> → pixel-identical to the original PDF.
 *   2. An invisible pdf.js "text layer" of absolutely-positioned <span>s is laid
 *      directly on top of the canvas, aligned to the real glyph positions.
 *
 * The result: long-press selects the real text *on the page itself* (native
 * handles, copy, highlight, search) with no visual change — it does not look or
 * feel like a reflow.
 *
 * Pages render lazily (only those near the viewport) via IntersectionObserver,
 * so even large documents open quickly and stay light on memory. The page
 * itself is the scroll container (the most reliable model inside a WebView).
 *
 * Everything is inlined (pdf.js + worker + the PDF bytes as base64): no network.
 *
 * Message protocol (WebView → RN):
 *   { type:'ready' }
 *   { type:'loaded', total }
 *   { type:'page-changed', page, total }
 *   { type:'selection', text, pageIndex, startOffset, endOffset, rect }
 *   { type:'selection_clear' }
 *   { type:'render-error', message }          // fatal — caller should fall back
 *   { type:'annotation_applied', success, id, kind }
 *
 * RN → WebView (via injectJavaScript), exposed on window:
 *   __pv_goToPage(n)                          // 1-based
 *   __pv_highlight(id, pageIndex, s, e, color)
 *   __pv_underline(id, pageIndex, s, e)
 *   __pv_strikethrough(id, pageIndex, s, e)
 *   __pv_removeAnnotation(id)
 *   __pv_reapply(annotations[])               // [{id,pageIndex,startOffset,endOffset,kind,color?}]
 *   __pv_clearSelection()
 *   __pv_setTheme(theme)
 */
import * as FileSystem from "expo-file-system/legacy";
import { loadMobileViewVendorScripts } from "./mobileViewVendorLoader";

function escapeForScriptTag(js: string): string {
  return js.replace(/<\/script/gi, "<\\/script");
}

export interface PdfTextLayerOptions {
  /** "dark" tints the page surround; pages stay white (like a real PDF). */
  theme?: "light" | "dark";
}

export async function generatePdfTextLayerHtml(
  fileUri: string,
  options: PdfTextLayerOptions = {},
): Promise<{ html: string } | { error: string }> {
  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    if (!info.exists) return { error: "File not found" };

    const vendor = await loadMobileViewVendorScripts();
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const pdfMinJs = escapeForScriptTag(vendor.pdfMinJs);
    const pdfWorkerMinJs = escapeForScriptTag(vendor.pdfWorkerMinJs);

    const theme = options.theme === "dark" ? "dark" : "light";
    const surround = theme === "dark" ? "#1a1a1a" : "#525659";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=6.0, user-scalable=yes">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html { background:${surround}; }
  body {
    background:${surround}; padding:8px 0; -webkit-overflow-scrolling:touch;
    overscroll-behavior:none; -webkit-text-size-adjust:none;
  }
  #viewer { width:100%; }
  .page {
    position:relative; background:#fff;
    margin:0 auto 10px auto; box-shadow:0 1px 5px rgba(0,0,0,0.4);
    overflow:hidden;
  }
  .page > canvas { display:block; width:100%; height:100%; }
  /* ── pdf.js text layer (invisible, selectable, glyph-aligned) ── */
  .textLayer {
    position:absolute; left:0; top:0; right:0; bottom:0;
    overflow:hidden; line-height:1; opacity:1;
    -webkit-text-size-adjust:none; text-size-adjust:none; forced-color-adjust:none;
    z-index:2;
  }
  .textLayer span, .textLayer br {
    color:transparent; position:absolute; white-space:pre; cursor:text;
    transform-origin:0% 0%;
  }
  .textLayer ::selection { background:rgba(0,102,255,0.40); }
  .textLayer .pv-hl { border-radius:2px; }
  .textLayer .pv-ul { text-decoration:underline; text-decoration-color:#1976D2; text-decoration-thickness:2px; text-underline-offset:3px; }
  .textLayer .pv-st { text-decoration:line-through; text-decoration-color:#E53935; text-decoration-thickness:2px; }
  #pv-error {
    position:fixed; inset:0; display:none; flex-direction:column;
    align-items:center; justify-content:center; color:#fff; font-family:sans-serif; padding:24px; text-align:center;
  }
  .pv-placeholder { display:flex; align-items:center; justify-content:center; color:rgba(255,255,255,0.20); font-family:sans-serif; font-size:12px; }
  /* ── search highlights — translucent so the canvas glyphs underneath stay
        crisp (the text layer itself is transparent); the active match is a
        stronger orange. ── */
  .textLayer .pv-sr { background:rgba(255,235,59,0.55); border-radius:2px; }
  .textLayer .pv-sr-active { background:rgba(255,143,0,0.70); border-radius:2px; }
</style>
<script>${pdfMinJs}<\/script>
<!-- Worker UMD loaded as a REAL executable script (not a Blob worker): it
     defines globalThis.pdfjsWorker, which pdf.js uses for in-thread parsing
     (disableWorker). A Blob-URL worker often initialises but never responds
     inside an Android WebView, hanging getDocument() forever. -->
<script>${pdfWorkerMinJs}<\/script>
</head>
<body>
<div id="viewer"></div>
<div id="pv-error"><div style="font-size:40px">⚠️</div><div id="pv-error-msg" style="margin-top:10px;font-size:14px;opacity:.8"></div></div>
<script>
(function(){
  "use strict";
  function post(o){ try{ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(o)); }catch(_){} }
  function fail(m){
    var e=document.getElementById('pv-error');
    if(e){ e.style.display='flex'; var mm=document.getElementById('pv-error-msg'); if(mm) mm.textContent=m||''; }
    post({type:'render-error',message:m||'render failed'});
    post({type:'ready'});
  }

  if(typeof pdfjsLib==='undefined'){ fail('PDF engine failed to load'); return; }

  // Run pdf.js entirely in-thread (no Web Worker). The worker UMD loaded above
  // defines globalThis.pdfjsWorker; pdf.js picks it up for in-thread parsing.
  // A Blob-URL worker hangs forever inside an Android WebView.
  try{ pdfjsLib.GlobalWorkerOptions.workerSrc=''; }catch(_){}
  try{ pdfjsLib.disableWorker=true; }catch(_){}

  var DPR = Math.min(window.devicePixelRatio||1, 3);
  var viewer = document.getElementById('viewer');

  var pdfDoc=null, numPages=0, scale=1, baseW=0, baseH=0;
  var pageEls=[];                 // .page wrappers
  var renderState=[];             // 0=none,1=rendering,2=done per page
  var annById={};                 // id -> annotation
  var annByPage={};               // pageIndex -> [annotation]
  var currentPage=1;

  function viewportWidth(){ return document.documentElement.clientWidth || window.innerWidth || 360; }

  /* ─────────────────────────── boot ─────────────────────────── */
  try{
    var raw=atob(${JSON.stringify(base64)});
    var u8=new Uint8Array(raw.length);
    for(var i=0;i<raw.length;i++) u8[i]=raw.charCodeAt(i);
    pdfjsLib.getDocument({data:u8, disableWorker:true})
      .promise.then(onDoc).catch(function(err){ fail((err&&err.message)||'Could not open PDF'); });
  }catch(e){ fail((e&&e.message)||'Could not decode PDF'); }

  function onDoc(pdf){
    pdfDoc=pdf; numPages=pdf.numPages;
    if(!numPages){ fail('Empty document'); return; }
    pdf.getPage(1).then(function(p1){
      var vp1=p1.getViewport({scale:1});
      var availW=viewportWidth();           // fit-width, like the native viewer
      scale=availW/vp1.width;
      if(!isFinite(scale)||scale<=0) scale=1;
      baseW=availW; baseH=vp1.height*scale;
      buildPlaceholders();
      post({type:'loaded',total:numPages});
      post({type:'ready'});
      setupObserver();
      renderPage(0);
      if(numPages>1) renderPage(1);
    }).catch(function(err){ fail((err&&err.message)||'Could not read first page'); });
  }

  function buildPlaceholders(){
    var frag=document.createDocumentFragment();
    for(var i=0;i<numPages;i++){
      var d=document.createElement('div');
      d.className='page pv-placeholder';
      d.setAttribute('data-page-index', String(i));
      d.style.width=Math.round(baseW)+'px';
      d.style.height=Math.round(baseH)+'px';
      frag.appendChild(d);
      pageEls.push(d);
      renderState.push(0);
    }
    viewer.appendChild(frag);
  }

  /* ──────────────────── lazy rendering ──────────────────── */
  var io=null;
  function setupObserver(){
    // root:null → observe against the viewport (the page is the scroller).
    io=new IntersectionObserver(function(entries){
      var any=false;
      entries.forEach(function(en){
        var idx=parseInt(en.target.getAttribute('data-page-index'),10);
        if(en.isIntersecting){ renderPage(idx); any=true; }
        else { teardownPage(idx); }   // far from viewport → free memory
      });
      if(any) updateCurrentPage();
    },{ root:null, rootMargin:'250% 0px 250% 0px', threshold:0.01 });
    for(var i=0;i<pageEls.length;i++) io.observe(pageEls[i]);
  }

  // Release a page's canvas + text layer once it's well outside the viewport.
  // The placeholder keeps its size so scroll position is preserved; any
  // annotations re-apply automatically when the page is rendered again.
  function teardownPage(idx){
    if(renderState[idx]!==2) return;
    var el=pageEls[idx]; if(!el) return;
    while(el.firstChild) el.removeChild(el.firstChild);
    el.classList.add('pv-placeholder');
    renderState[idx]=0;
  }

  function renderPage(idx){
    if(idx<0||idx>=numPages||renderState[idx]!==0) return;
    renderState[idx]=1;
    pdfDoc.getPage(idx+1).then(function(page){
      var vp=page.getViewport({scale:scale});
      var el=pageEls[idx];
      el.classList.remove('pv-placeholder');
      el.style.width=Math.round(vp.width)+'px';
      el.style.height=Math.round(vp.height)+'px';

      var canvas=document.createElement('canvas');
      canvas.width=Math.floor(vp.width*DPR);
      canvas.height=Math.floor(vp.height*DPR);
      canvas.style.width=Math.round(vp.width)+'px';
      canvas.style.height=Math.round(vp.height)+'px';
      var ctx=canvas.getContext('2d',{alpha:false});
      el.appendChild(canvas);

      var renderTask=page.render({
        canvasContext:ctx,
        viewport:vp,
        transform: DPR!==1 ? [DPR,0,0,DPR,0,0] : null
      });
      renderTask.promise.then(function(){
        return page.getTextContent();
      }).then(function(tc){
        var tl=document.createElement('div');
        tl.className='textLayer';
        tl.style.width=Math.round(vp.width)+'px';
        tl.style.height=Math.round(vp.height)+'px';
        tl.style.setProperty('--scale-factor', String(scale));
        el.appendChild(tl);
        var task=pdfjsLib.renderTextLayer({
          textContentSource:tc,
          container:tl,
          viewport:vp,
          textDivs:[]
        });
        var done=task && task.promise ? task.promise : Promise.resolve();
        return done.then(function(){
          renderState[idx]=2;
          reapplyForPage(idx);
          srApplyForPage(idx);   // re-paint search highlights on (re)render
        });
      }).catch(function(){
        // Canvas painted but text layer failed — page still viewable.
        renderState[idx]=2;
      });
    }).catch(function(){
      renderState[idx]=0; // allow a later retry
    });
  }

  /* ──────────────────── page tracking ──────────────────── */
  var ticking=false;
  function updateCurrentPage(){
    if(ticking) return; ticking=true;
    requestAnimationFrame(function(){
      ticking=false;
      var mid=window.innerHeight/2;     // viewport centre
      var best=1, bestDist=Infinity;
      for(var i=0;i<pageEls.length;i++){
        var r=pageEls[i].getBoundingClientRect();
        var center=r.top+r.height/2;
        var dist=Math.abs(center-mid);
        if(dist<bestDist){ bestDist=dist; best=i+1; }
      }
      if(best!==currentPage){
        currentPage=best;
        post({type:'page-changed',page:best,total:numPages});
      }
    });
  }
  window.addEventListener('scroll', function(){ updateCurrentPage(); scheduleReport(180); }, {passive:true});

  /* ──────────────────── navigation ──────────────────── */
  window.__pv_goToPage=function(n){
    var idx=Math.max(0,Math.min(numPages-1,(n|0)-1));
    var el=pageEls[idx]; if(!el) return;
    renderPage(idx);
    var y=el.getBoundingClientRect().top + window.scrollY - 8;
    window.scrollTo({top:Math.max(0,y), behavior:'smooth'});
  };

  window.__pv_setTheme=function(t){
    var c = t==='dark' ? '#1a1a1a' : '#525659';
    document.documentElement.style.background=c;
    document.body.style.background=c;
  };

  /* ──────────────────── selection bridge ──────────────────── */
  function closestPage(node){
    var n = node && node.nodeType===3 ? node.parentNode : node;
    while(n && n!==document.body){
      if(n.classList && n.classList.contains('page')) return n;
      n=n.parentNode;
    }
    return null;
  }
  function textLayerOf(pageEl){ return pageEl ? pageEl.querySelector('.textLayer') : null; }

  // Offset of (node, offset) within the plain text of root, walking text nodes.
  function offsetWithin(root, targetNode, targetOffset){
    var w=document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var total=0, node;
    while((node=w.nextNode())){
      if(node===targetNode) return total+targetOffset;
      total+=(node.textContent||'').length;
    }
    return total+targetOffset;
  }

  var _lastSel='';
  function reportSelection(){
    var sel=window.getSelection();
    if(!sel || sel.isCollapsed || !sel.toString().trim()){
      if(_lastSel){ _lastSel=''; post({type:'selection_clear'}); }
      return;
    }
    var text=sel.toString();
    try{
      var range=sel.getRangeAt(0);
      var pageEl=closestPage(range.startContainer) || closestPage(range.endContainer);
      var tl=textLayerOf(pageEl);
      if(!pageEl || !tl){ return; }
      var idx=parseInt(pageEl.getAttribute('data-page-index'),10);
      var startOffset=offsetWithin(tl, range.startContainer, range.startOffset);
      var endOffset=offsetWithin(tl, range.endContainer, range.endOffset);
      if(endOffset<startOffset){ var t=startOffset; startOffset=endOffset; endOffset=t; }
      var rect=range.getBoundingClientRect();
      _lastSel=text;
      post({
        type:'selection', text:text, pageIndex:idx,
        startOffset:startOffset, endOffset:endOffset,
        rect:{ x:rect.left, y:rect.top, width:rect.width, height:rect.height }
      });
    }catch(_){}
  }

  var _selTimer=null;
  function scheduleReport(ms){ clearTimeout(_selTimer); _selTimer=setTimeout(reportSelection, ms||120); }
  document.addEventListener('selectionchange', function(){ scheduleReport(140); });
  document.addEventListener('touchend', function(){ setTimeout(reportSelection,140); }, {passive:true});
  document.addEventListener('contextmenu', function(e){
    var sel=window.getSelection();
    if(sel && !sel.isCollapsed && sel.toString().trim()) e.preventDefault();
    setTimeout(reportSelection,100);
  });
  // Long-press fallback for devices where the events above don't fire reliably.
  var _lpT=null,_lpP=null,_lpA=false;
  document.addEventListener('touchstart', function(){
    _lpA=true; clearTimeout(_lpT); clearInterval(_lpP);
    _lpT=setTimeout(function(){
      if(!_lpA) return;
      reportSelection();
      _lpP=setInterval(function(){ if(!_lpA){clearInterval(_lpP);return;} reportSelection(); }, 90);
    }, 350);
  }, {passive:true});
  function endLp(){ _lpA=false; clearTimeout(_lpT); clearInterval(_lpP); }
  document.addEventListener('touchend', endLp, {passive:true});
  document.addEventListener('touchcancel', endLp, {passive:true});

  window.__pv_clearSelection=function(){
    var s=window.getSelection(); if(s) s.removeAllRanges(); _lastSel='';
  };

  /* ──────────────────── annotations ──────────────────── */
  function offsetsToRange(tl, s, e){
    var w=document.createTreeWalker(tl, NodeFilter.SHOW_TEXT, null, false);
    var cc=0, sn=null,sl=0, en=null,el=0, node;
    while((node=w.nextNode())){
      var len=(node.textContent||'').length;
      if(sn===null && cc+len>s){ sn=node; sl=s-cc; }
      if(en===null && cc+len>=e){ en=node; el=e-cc; break; }
      cc+=len;
    }
    if(!sn||!en) return null;
    try{
      var r=document.createRange();
      r.setStart(sn, Math.min(sl, sn.textContent.length));
      r.setEnd(en, Math.min(el, en.textContent.length));
      return r;
    }catch(_){ return null; }
  }
  function wrap(range, cls, style, id){
    try{
      var frag=range.extractContents();
      var sp=document.createElement('span');
      sp.appendChild(frag);
      sp.className=cls;
      if(style) sp.setAttribute('style',style);
      sp.setAttribute('data-ann-id', id);
      range.insertNode(sp);
      return true;
    }catch(_){ return false; }
  }
  function applyOne(a){
    var pageEl=pageEls[a.pageIndex]; if(!pageEl) return false;
    var tl=textLayerOf(pageEl); if(!tl) return false; // page not rendered yet
    if(tl.querySelector('[data-ann-id="'+a.id+'"]')) return true; // already applied
    var r=offsetsToRange(tl, a.startOffset, a.endOffset); if(!r) return false;
    if(a.kind==='highlight') return wrap(r,'pv-hl','background-color:'+(a.color||'rgba(255,235,59,0.45)')+';',a.id);
    if(a.kind==='underline') return wrap(r,'pv-ul','',a.id);
    if(a.kind==='strikethrough') return wrap(r,'pv-st','',a.id);
    return false;
  }
  function register(a){
    annById[a.id]=a;
    (annByPage[a.pageIndex]=annByPage[a.pageIndex]||[]).push(a);
  }
  function reapplyForPage(idx){
    var list=annByPage[idx]; if(!list) return;
    // Apply from the end of the page backwards so earlier offsets stay valid.
    var sorted=list.slice().sort(function(x,y){ return y.startOffset-x.startOffset; });
    for(var i=0;i<sorted.length;i++) applyOne(sorted[i]);
  }

  window.__pv_highlight=function(id,pageIndex,s,e,color){
    var a={id:id,pageIndex:pageIndex,startOffset:s,endOffset:e,kind:'highlight',color:color};
    register(a);
    var ok=applyOne(a);
    window.__pv_clearSelection();
    post({type:'annotation_applied',success:ok,id:id,kind:'highlight'});
  };
  window.__pv_underline=function(id,pageIndex,s,e){
    var a={id:id,pageIndex:pageIndex,startOffset:s,endOffset:e,kind:'underline'};
    register(a);
    var ok=applyOne(a);
    window.__pv_clearSelection();
    post({type:'annotation_applied',success:ok,id:id,kind:'underline'});
  };
  window.__pv_strikethrough=function(id,pageIndex,s,e){
    var a={id:id,pageIndex:pageIndex,startOffset:s,endOffset:e,kind:'strikethrough'};
    register(a);
    var ok=applyOne(a);
    window.__pv_clearSelection();
    post({type:'annotation_applied',success:ok,id:id,kind:'strikethrough'});
  };
  window.__pv_removeAnnotation=function(id){
    var a=annById[id];
    var elx=document.querySelector('[data-ann-id="'+id+'"]');
    if(elx && elx.parentNode){
      var p=elx.parentNode;
      while(elx.firstChild) p.insertBefore(elx.firstChild, elx);
      p.removeChild(elx); p.normalize();
    }
    if(a){
      delete annById[id];
      var list=annByPage[a.pageIndex];
      if(list){ var k=list.indexOf(a); if(k>=0) list.splice(k,1); }
    }
  };
  window.__pv_reapply=function(arr){
    if(!arr||!arr.length) return;
    for(var i=0;i<arr.length;i++){
      var a=arr[i];
      if(annById[a.id]) continue;
      register(a);
      applyOne(a); // applies now if its page is rendered; otherwise on render
    }
  };

  /* ──────────────────── search ────────────────────
   * Highlights every match on the rendered pages (translucent yellow) with the
   * current match in orange, mirroring the reflow search in selectionScripts.ts.
   * Pages render lazily, so the active query is stored and re-applied whenever a
   * page's text layer (re)renders (see srApplyForPage in renderPage). A one-time
   * pre-scan of every page's text (text only, no canvas paint) builds the
   * ordered match list used for the N/M counter and next/prev navigation. */
  var __srQuery='';      // lowercased active query ('' = inactive)
  var __srMatches=[];    // [{page, occ}] in document order
  var __srActive=-1;     // index into __srMatches

  function srUnwrapIn(tl){
    var sps=tl.querySelectorAll('[data-sr]');
    for(var i=0;i<sps.length;i++){
      var sp=sps[i], p=sp.parentNode;
      if(p){ p.replaceChild(document.createTextNode(sp.textContent||''), sp); p.normalize(); }
    }
  }
  function srClearAll(){
    for(var i=0;i<pageEls.length;i++){ var tl=textLayerOf(pageEls[i]); if(tl) srUnwrapIn(tl); }
  }
  function srClearActive(){
    var a=document.getElementsByClassName('pv-sr-active');
    // Live collection — convert to static list before mutating classNames.
    var list=[]; for(var i=0;i<a.length;i++) list.push(a[i]);
    for(var j=0;j<list.length;j++) list[j].className='pv-sr';
  }
  // Wrap every occurrence of the active query within a rendered page's text
  // layer. Occurrences are counted PER text node (one per pdf.js text item), so
  // the data-sr-occ index matches the pre-scan's per-item count.
  function srApplyForPage(idx){
    if(!__srQuery) return;
    var pageEl=pageEls[idx]; if(!pageEl) return;
    var tl=textLayerOf(pageEl); if(!tl) return;          // not rendered yet
    if(tl.querySelector('[data-sr]')) return;            // already applied
    var q=__srQuery;
    var walker=document.createTreeWalker(tl, NodeFilter.SHOW_TEXT, null, false);
    var nodes=[], n; while((n=walker.nextNode())) nodes.push(n);
    var occ=0;
    nodes.forEach(function(node){
      var text=node.nodeValue||'', lower=text.toLowerCase(), i=lower.indexOf(q);
      if(i===-1||!node.parentNode) return;
      var frag=document.createDocumentFragment(), last=0;
      while(i!==-1){
        if(i>last) frag.appendChild(document.createTextNode(text.substring(last,i)));
        var sp=document.createElement('span');
        sp.setAttribute('data-sr','1');
        sp.setAttribute('data-sr-occ', String(occ));
        sp.className='pv-sr';
        sp.textContent=text.substring(i,i+q.length);
        frag.appendChild(sp); occ++;
        last=i+q.length; i=lower.indexOf(q,last);
      }
      if(last<text.length) frag.appendChild(document.createTextNode(text.substring(last)));
      node.parentNode.replaceChild(frag,node);
    });
    if(__srActive>=0 && __srMatches[__srActive] && __srMatches[__srActive].page===idx) focusActive(false);
  }
  function focusActive(doScroll){
    if(__srActive<0 || !__srMatches[__srActive]) return;
    var m=__srMatches[__srActive];
    var tl=textLayerOf(pageEls[m.page]); if(!tl) return;
    srClearActive();
    var sel=tl.querySelectorAll('[data-sr]'); if(!sel.length) return;
    var k=Math.min(m.occ, sel.length-1);
    var el=sel[k]; if(!el) return;
    el.className='pv-sr pv-sr-active';
    if(doScroll){
      var y=el.getBoundingClientRect().top + window.scrollY - (window.innerHeight*0.3);
      window.scrollTo({top:Math.max(0,y), behavior:'smooth'});
    }
  }
  function goToMatch(k){
    if(!__srMatches.length) return;
    __srActive=((k%__srMatches.length)+__srMatches.length)%__srMatches.length;
    var m=__srMatches[__srActive];
    renderPage(m.page);
    // The page + its search spans may take a moment to render; poll briefly.
    var tries=0;
    (function tick(){
      var tl=textLayerOf(pageEls[m.page]);
      if(tl){ srApplyForPage(m.page); focusActive(true); }
      else if(tries++<30){ setTimeout(tick,60); }
    })();
    post({type:'search-count',count:__srMatches.length,current:__srActive+1});
  }

  window.__pv_search=function(query){
    srClearActive(); srClearAll();
    __srMatches=[]; __srActive=-1;
    __srQuery=(query||'').toLowerCase();
    if(!__srQuery.trim()){ __srQuery=''; post({type:'search-count',count:0,current:0}); return; }
    if(!pdfDoc){ post({type:'search-count',count:0,current:0}); return; }
    var q=__srQuery;
    // Pre-scan each page's text (text only) sequentially to build the ordered
    // match list. Count per text item to align with srApplyForPage's per-node
    // counting. Bail out if a newer query supersedes this run.
    var chain=Promise.resolve();
    for(var p=0;p<numPages;p++){
      (function(idx){
        chain=chain.then(function(){
          if(__srQuery!==q) return;
          return pdfDoc.getPage(idx+1)
            .then(function(page){ return page.getTextContent(); })
            .then(function(tc){
              if(__srQuery!==q) return;
              var items=tc.items||[], occ=0;
              for(var i=0;i<items.length;i++){
                var s=(items[i] && typeof items[i].str==='string') ? items[i].str.toLowerCase() : '';
                var j=s.indexOf(q);
                while(j!==-1){ __srMatches.push({page:idx,occ:occ}); occ++; j=s.indexOf(q, j+q.length); }
              }
            }).catch(function(){});
        });
      })(p);
    }
    chain.then(function(){
      if(__srQuery!==q) return;
      // Paint highlights on any already-rendered pages right away.
      for(var i=0;i<pageEls.length;i++){ if(renderState[i]===2) srApplyForPage(i); }
      if(__srMatches.length) goToMatch(0);
      else post({type:'search-count',count:0,current:0});
    });
  };
  window.__pv_searchNext=function(){ if(__srMatches.length) goToMatch(__srActive+1); };
  window.__pv_searchPrev=function(){ if(__srMatches.length) goToMatch(__srActive-1); };
  window.__pv_clearSearch=function(){
    __srQuery=''; __srMatches=[]; __srActive=-1;
    srClearActive(); srClearAll();
    post({type:'search-count',count:0,current:0});
  };
})();
<\/script>
</body>
</html>`;

    return { html };
  } catch (err: any) {
    return { error: err?.message || "Failed to generate selectable PDF view" };
  }
}

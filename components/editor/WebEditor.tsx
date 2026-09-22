/**
 * WebEditor.tsx
 *
 * WebView-based rich text editor (contenteditable).
 * Handles formatting via document.execCommand, undo/redo history,
 * insert helpers, and messages back to React Native.
 */

import { getWebViewFontInjectionScript } from "@/services/editorFontService";
import type { EditorWebViewMessage } from "@/src/types/editor.types";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  InteractionManager,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { AI_PROOFREAD } from "@/constants/featureFlags";
import {
  ProofreadController,
  type ProofreadControllerHandle,
} from "./ProofreadController";
import { useDocument } from "./DocumentContext";

// ── Editor HTML ────────────────────────────────────────────────────────────
/* ─────────────────────────────────────────────────────────────────────────────
   THE CORE FIX (ported from /lower/WebEditor.js):
   When a user taps a toolbar button in React Native, the WebView loses focus
   and the browser drops the text selection. That's why NOTHING was working —
   execCommand() requires an active selection/focus.

   Fix: We save the selection range on every cursor move, then RESTORE it
   inside the WebView before applying any format command.
   ───────────────────────────────────────────────────────────────────────── */

const EDITOR_HTML = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">

<!-- Bundled fonts are injected dynamically via injectJavaScript after load -->
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}

html{height:100%;direction:ltr;}
body{background:#fff;padding:0;min-height:100%;margin:0;direction:ltr;}

#page{
  background:#fff;width:100%;min-height:100vh;
  margin:0;padding:10px 12px 120px;
  border:none;box-shadow:none;border-radius:0;
  direction:ltr;text-align:left;
}

#editor{
  outline:none;min-height:80vh;
  font-size:11pt;font-family:'Inter',sans-serif;
  color:#000;line-height:1.15;word-wrap:break-word;
  caret-color:#1976D2;
  direction:ltr;text-align:left;unicode-bidi:normal;
}
#editor:empty::before{
  content:attr(data-placeholder);color:#BDBDBD;
  pointer-events:none;font-style:italic;
}
div[contenteditable]{outline:none;}

/* Lists — restore bullets/numbers stripped by the global reset above */
#editor ul,#editor ol{padding-left:1.6em;margin:4px 0;}
#editor ul{list-style:disc outside;}
#editor ol{list-style:decimal outside;}
#editor ul ul{list-style:circle outside;}
#editor ul ul ul{list-style:square outside;}
#editor li{margin:2px 0;}

.doc-image,.inserted-image{max-width:100%;height:auto;display:block;margin:8px auto;cursor:pointer;position:relative;}
.doc-image.selected,.inserted-image.selected{outline:2px solid #1976D2;}
.img-resize-wrap{position:relative;display:inline-block;max-width:100%;margin:8px auto;}
.img-resize-wrap.selected{outline:2px solid #1976D2;}
.img-resize-handle{
  position:absolute;width:12px;height:12px;background:#1976D2;border:2px solid #fff;
  border-radius:2px;z-index:10;cursor:nwse-resize;touch-action:none;
}
.img-resize-handle.br{bottom:-6px;right:-6px;}
.img-resize-handle.bl{bottom:-6px;left:-6px;cursor:nesw-resize;}
.img-resize-handle.tr{top:-6px;right:-6px;cursor:nesw-resize;}
.img-resize-handle.tl{top:-6px;left:-6px;cursor:nwse-resize;}
.doc-shape,.shape-container{display:block;margin:8px 0;cursor:pointer;user-select:none;}
.doc-shape.selected svg *,.shape-container.selected svg *{stroke:#1976D2 !important;}
.doc-textbox,.text-box{
  display:inline-block;border:1px solid #9E9E9E;
  min-width:140px;min-height:44px;padding:8px 10px;margin:6px 2px;
  font-size:11pt;font-family:'Inter',sans-serif;
}
.doc-signature,.signature-img{display:block;margin:8px 0;max-width:260px;}
.doc-comment,.comment-mark{background:rgba(255,235,59,0.35);border-bottom:2px solid #FBC02D;cursor:help;}
.doc-bookmark,.bookmark-mark{color:#1976D2;font-size:13px;cursor:pointer;user-select:none;margin-right:2px;}
.doc-hyperlink,.hyperlink{color:#1565C0;text-decoration:underline;cursor:pointer;}
.doc-attachment{
  display:inline-flex;align-items:center;gap:8px;
  padding:6px 14px;background:#F5F5F5;border:1px solid #E0E0E0;
  border-radius:6px;margin:4px 0;cursor:default;user-select:none;
  font-family:'Inter',sans-serif;font-size:11pt;
}

/* ── Table styles ───────────────────────────────────── */
.editor-table{
  width:100%;border-collapse:collapse;margin:12px 0;
  table-layout:auto;font-size:11pt;font-family:'Inter',sans-serif;
}
.editor-table td{
  border:1px solid #BDBDBD;padding:6px 8px;min-width:40px;
  min-height:28px;vertical-align:top;word-wrap:break-word;
  outline:none;
}
.editor-table td:focus{
  outline:2px solid #1976D2;outline-offset:-2px;
  background:rgba(25,118,210,0.04);
}
.editor-table tr:first-child td{
  background:#F5F5F5;font-weight:600;
}
.table-wrapper{position:relative;margin:12px 0;overflow-x:auto;}
.table-toolbar{
  display:none;position:absolute;top:-32px;left:0;z-index:50;
  background:#fff;border:1px solid #E0E0E0;border-radius:6px;
  padding:2px 4px;gap:2px;flex-direction:row;box-shadow:0 2px 8px rgba(0,0,0,0.12);
}
.table-wrapper:focus-within .table-toolbar{display:flex;}
.table-toolbar button{
  border:none;background:transparent;padding:4px 8px;
  font-size:12px;color:#424242;cursor:pointer;border-radius:4px;
  font-family:system-ui;white-space:nowrap;
}
.table-toolbar button:active{background:#E3F2FD;}

/* ── Table add-row floating button ───────────────── */
.table-add-row-btn{
  width:28px;height:28px;border-radius:50%;
  background:#1976D2;color:#fff;border:2px solid #fff;
  font-size:18px;line-height:1;text-align:center;
  cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.2);
  display:flex;align-items:center;justify-content:center;
  margin:-8px 8px 0 auto;
  position:relative;z-index:51;
  user-select:none;-webkit-user-select:none;
  font-family:system-ui;
}
.table-add-row-btn:active{background:#1565C0;transform:scale(0.92);}

/* ── Image action buttons ────────────────────────── */
.img-action-bar{
  position:absolute;bottom:-14px;right:18px;z-index:11;
  display:flex;flex-direction:row;gap:4px;
}
.img-action-btn{
  width:26px;height:26px;border-radius:50%;
  background:#fff;border:1.5px solid #E0E0E0;
  font-size:13px;line-height:1;text-align:center;
  cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.15);
  display:flex;align-items:center;justify-content:center;
  user-select:none;-webkit-user-select:none;
}
.img-action-btn:active{background:#E3F2FD;border-color:#1976D2;}

/* ── Crop overlay ────────────────────────────────── */
.crop-overlay{position:absolute;top:0;left:0;z-index:20;pointer-events:auto;}
.crop-mask{position:absolute;background:rgba(0,0,0,0.45);}
.crop-border{position:absolute;border:2px dashed #1976D2;z-index:21;pointer-events:none;}
.crop-handle{
  position:absolute;width:18px;height:18px;background:#1976D2;border:2px solid #fff;
  border-radius:3px;z-index:22;touch-action:none;cursor:pointer;
}
.crop-btn-bar{
  position:absolute;bottom:-34px;left:0;right:0;
  display:flex;justify-content:center;gap:8px;z-index:22;
}
.crop-btn{
  padding:4px 14px;border:none;border-radius:4px;
  font-size:13px;cursor:pointer;font-family:system-ui;
}
.crop-btn.apply{background:#1976D2;color:#fff;}
.crop-btn.cancel{background:#fff;color:#424242;border:1px solid #BDBDBD;}

/* ── Proofread marks (R3) ────────────────────────────────────────────────
   Decoration only: no layout impact, no text of their own, and stripped
   before every save/export/print (see __pf_stripHtml).

   These sit ALONGSIDE the OS spellchecker, which stays on via
   spellcheck="true" on #editor. Two underline styles coexisting is fine;
   silently losing the native one is not, so nothing here disables it.
   text-decoration-color is used rather than border-bottom so the mark does
   not change line height or shift a single pixel of the document. */
.pf{
  text-decoration:underline;
  text-decoration-style:wavy;
  text-decoration-skip-ink:none;
  text-underline-offset:2px;
  cursor:pointer;
}
.pf-spelling{text-decoration-color:#E53935;}
.pf-grammar{text-decoration-color:#1E88E5;}
.pf-punctuation{text-decoration-color:#8E24AA;}
.pf-clarity{text-decoration-color:#00897B;}
.pf-tone{text-decoration-color:#F4511E;}
.pf-style{text-decoration-color:#6D4C41;}
</style>
</head>
<body>
<div id="page">
  <div id="editor" contenteditable="true" spellcheck="true"
       data-placeholder="Start typing your document..."></div>
</div>
<script>
'use strict';
var editor=document.getElementById('editor');

// ── SELECTION SAVE/RESTORE (THE CORE FIX) ──────────────────────────────────
var _savedRange=null;

function saveSelection(){
  var sel=window.getSelection();
  if(sel&&sel.rangeCount>0){
    var r=sel.getRangeAt(0);
    if(editor.contains(r.commonAncestorContainer)||r.commonAncestorContainer===editor){
      _savedRange=r.cloneRange();
    }
  }
}

function restoreSelection(){
  editor.focus();
  if(_savedRange){
    try{
      var sel=window.getSelection();
      sel.removeAllRanges();
      sel.addRange(_savedRange);
    }catch(e){}
  }
}

document.addEventListener('selectionchange',saveSelection);
editor.addEventListener('keyup',saveSelection);
editor.addEventListener('mouseup',saveSelection);
editor.addEventListener('touchend',saveSelection);

// ── PROOFREAD MARKS ARE DECORATION ONLY ───────────────────────────────────
// Proofread marks are <span class="pf ..."> wrappers drawn over located
// ranges. They must NEVER reach the document's text, its undo history, or a
// save/export/print — otherwise a user who saves while marks are on screen
// gets spans baked into their .docx.
//
// The single choke point is this function. Every place that serializes the
// editor passes through it: _snap() (the undo history) and getContent()
// (SAVE_CONTENT). Together with __pf_clearMarks() below, and the clone-strip
// in create-blank-docx/pdf's getEditorHtml, that is every path out.
//
// When no marks exist — which is always, with AI_PROOFREAD off — the
// indexOf() guard returns the string untouched, so this costs one substring
// scan and changes nothing.
function __pf_stripHtml(h){
  if(!h)return h;
  // Two kinds of residue, and BOTH have to go or the save is not identical:
  //   • span.pf wrappers — the visible marks;
  //   • data-pfid attributes — the stable per-paragraph ids. Those must
  //     persist in the LIVE dom (they are what lets a paragraph's results
  //     survive edits elsewhere), but they are still editor bookkeeping and
  //     must never be written into the user's document.
  if(h.indexOf('class="pf')===-1&&h.indexOf("class='pf")===-1&&h.indexOf('data-pfid')===-1)return h;
  try{
    var d=document.createElement('div');
    d.innerHTML=h;
    var ns=d.querySelectorAll('span.pf');
    for(var i=0;i<ns.length;i++){
      var n=ns[i],p=n.parentNode;
      if(!p)continue;
      while(n.firstChild)p.insertBefore(n.firstChild,n);
      p.removeChild(n);
    }
    var ids=d.querySelectorAll('[data-pfid]');
    for(var j=0;j<ids.length;j++)ids[j].removeAttribute('data-pfid');
    d.normalize();
    return d.innerHTML;
  }catch(e){return h;}
}

// ── WORD-LEVEL HISTORY (undo/redo with cursor preservation) ───────────────
var _hist=[{h:'',c:0}],_hidx=0,_htimer=null;

// Get cursor offset as character count from start of editor text
function _curOff(){
  try{
    var sel=window.getSelection();
    if(!sel||!sel.rangeCount)return 0;
    var r=sel.getRangeAt(0);
    var pr=document.createRange();
    pr.selectNodeContents(editor);
    pr.setEnd(r.endContainer,r.endOffset);
    return pr.toString().length;
  }catch(e){return 0;}
}

// Set cursor at character offset from start of editor text
function _setCur(off){
  try{
    editor.focus();
    if(off<0)off=0;
    var text=editor.innerText||'';
    if(off>text.length)off=text.length;
    var tw=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT,null,false);
    var cnt=0,nd;
    while(nd=tw.nextNode()){
      var len=nd.textContent.length;
      if(cnt+len>=off){
        var r=document.createRange();
        r.setStart(nd,off-cnt);r.collapse(true);
        var sel=window.getSelection();
        sel.removeAllRanges();sel.addRange(r);
        _savedRange=r.cloneRange();
        return;
      }
      cnt+=len;
    }
    // Fallback: place cursor at end of content
    var r=document.createRange();
    r.selectNodeContents(editor);r.collapse(false);
    var sel=window.getSelection();
    sel.removeAllRanges();sel.addRange(r);
    _savedRange=r.cloneRange();
  }catch(e){}
}

function _snap(){
  // Mark-free, so undo/redo can never restore decoration into the document.
  var h=__pf_stripHtml(editor.innerHTML);
  var c=_curOff();
  if(h===_hist[_hidx].h)return;
  _hist=_hist.slice(0,_hidx+1);
  _hist.push({h:h,c:c});_hidx++;
  if(_hist.length>200){_hist.shift();_hidx--;}
  _notifyUR();
}

function _notifyUR(){
  rn({type:'UNDO_REDO',canUndo:_hidx>0,canRedo:_hidx<_hist.length-1});
}

// pushHistory() — immediate snapshot (used by format commands, inserts)
function pushHistory(){
  clearTimeout(_htimer);
  _snap();
}

// _inputChanged() — called by input handler; immediate on word boundary,
// debounced otherwise so each word gets its own undo step.
function _inputChanged(isWordBoundary){
  clearTimeout(_htimer);
  if(isWordBoundary){_snap();}
  else{_htimer=setTimeout(_snap,800);}
}

window.doUndo=function(){
  // Flush any pending debounced snapshot before undoing
  clearTimeout(_htimer);
  var cur=editor.innerHTML;
  if(cur!==_hist[_hidx].h){_snap();}
  if(_hidx>0){
    _hidx--;
    editor.innerHTML=_hist[_hidx].h;
    _setCur(_hist[_hidx].c);
    _notifyUR();
    notifyContent();
  }
};

window.doRedo=function(){
  if(_hidx<_hist.length-1){
    _hidx++;
    editor.innerHTML=_hist[_hidx].h;
    _setCur(_hist[_hidx].c);
    _notifyUR();
    notifyContent();
  }
};

// ── CORE execCommand WRAPPER ──────────────────────────────────────────────
function cmd(command,value){
  restoreSelection();
  document.execCommand(command,false,value||null);
  pushHistory();
  notifySelectionState();
}

// ── INLINE FORMATS ────────────────────────────────────────────────────────
window.applyBold=function(){cmd('bold');};
window.applyItalic=function(){cmd('italic');};
window.applyUnderline=function(){cmd('underline');};
window.applyStrikethrough=function(){cmd('strikeThrough');};
window.applySubscript=function(){cmd('subscript');};
window.applySuperscript=function(){cmd('superscript');};

// ── TEXT COLOR ────────────────────────────────────────────────────────────
window.applyForeColor=function(color){
  restoreSelection();
  document.execCommand('styleWithCSS',false,true);
  cmd('foreColor',color);
  document.execCommand('styleWithCSS',false,false);
};

// ── CLEAR FORMATTING ──────────────────────────────────────────────────────
window.clearFormatting=function(){
  restoreSelection();
  document.execCommand('removeFormat',false,null);
  pushHistory();
  notifySelectionState();
};

// ── INDENT / OUTDENT ──────────────────────────────────────────────────────
window.applyIndent=function(){cmd('indent');};
window.applyOutdent=function(){cmd('outdent');};

// ── BULLET / NUMBERED LISTS ────────────────────────────────────────────────
window.applyBulletList=function(){cmd('insertUnorderedList');};
window.applyNumberList=function(){cmd('insertOrderedList');};

// ── CHANGE CASE ─────────────────────────────────────────────────────────────
window.changeCase=function(mode){
  restoreSelection();
  var sel=window.getSelection();
  if(!sel||!sel.rangeCount)return;
  var text=sel.toString();
  if(!text)return;
  var out=text;
  if(mode==='upper')out=text.toUpperCase();
  else if(mode==='lower')out=text.toLowerCase();
  else if(mode==='title')out=text.replace(/\\w\\S*/g,function(w){return w.charAt(0).toUpperCase()+w.substr(1).toLowerCase();});
  document.execCommand('insertText',false,out);
  pushHistory();
};

// ── FONT FAMILY (span-based for real rendering) ────────────────────────────
window.applyFontFamily=function(fontName){
  restoreSelection();
  wrapStyle('fontFamily',fontName+', sans-serif');
  pushHistory();
};

// ── FONT SIZE ─────────────────────────────────────────────────────────────
window.applyFontSize=function(pt){
  restoreSelection();
  wrapStyle('fontSize',pt+'pt');
  pushHistory();
};

// ── HIGHLIGHT ─────────────────────────────────────────────────────────────
window.applyHighlight=function(color){
  restoreSelection();
  if(!color||color==='none'){
    cmd('removeFormat');
  }else{
    cmd('hiliteColor',color);
  }
};

// ── ALIGNMENT ─────────────────────────────────────────────────────────────
window.applyAlign=function(align){
  restoreSelection();
  var map={left:'justifyLeft',center:'justifyCenter',right:'justifyRight',justify:'justifyFull'};
  if(map[align]) document.execCommand(map[align],false,null);
  var block=getBlock();
  if(block) block.style.textAlign=align;
  pushHistory();
  notifySelectionState();
};

// ── LINE SPACING ──────────────────────────────────────────────────────────
window.applyLineSpacing=function(spacing){
  restoreSelection();
  var block=getBlock();
  if(block) block.style.lineHeight=String(spacing);
  else editor.style.lineHeight=String(spacing);
  pushHistory();
};

// ── SPAN STYLE WRAPPER ────────────────────────────────────────────────────
function wrapStyle(prop,value){
  var sel=window.getSelection();
  if(!sel||!sel.rangeCount)return;
  var range=sel.getRangeAt(0);
  if(range.collapsed){
    var s=document.createElement('span');
    s.style[prop]=value;
    s.innerHTML='\\u200B';
    range.insertNode(s);
    var nr=document.createRange();
    nr.setStart(s.firstChild,1);nr.collapse(true);
    sel.removeAllRanges();sel.addRange(nr);
    _savedRange=nr.cloneRange();
    return;
  }
  try{
    var sp=document.createElement('span');
    sp.style[prop]=value;
    range.surroundContents(sp);
    _savedRange=sel.getRangeAt(0).cloneRange();
  }catch(e){
    document.execCommand('fontSize',false,'7');
    editor.querySelectorAll('font[size="7"]').forEach(function(n){
      n.removeAttribute('size');n.style[prop]=value;
    });
  }
}

function getBlock(){
  var sel=window.getSelection();
  if(!sel||!sel.rangeCount)return null;
  var node=sel.getRangeAt(0).commonAncestorContainer;
  if(node.nodeType===3)node=node.parentNode;
  while(node&&node!==editor){
    if(/^(DIV|P|H[1-6]|LI|BLOCKQUOTE)$/.test(node.nodeName))return node;
    node=node.parentNode;
  }
  return editor;
}

// ── IMAGE CROP ────────────────────────────────────────────────────────────
function startCrop(wrap,img){
  if(wrap.querySelector('.crop-overlay'))return;
  var w=img.offsetWidth,h=img.offsetHeight;
  var crop={t:0,l:0,r:1,b:1};
  var ov=document.createElement('div');
  ov.className='crop-overlay';
  ov.style.width=w+'px';ov.style.height=h+'px';
  var mT=document.createElement('div');mT.className='crop-mask';
  var mB=document.createElement('div');mB.className='crop-mask';
  var mL=document.createElement('div');mL.className='crop-mask';
  var mR=document.createElement('div');mR.className='crop-mask';
  [mT,mB,mL,mR].forEach(function(m){ov.appendChild(m);});
  var bdr=document.createElement('div');bdr.className='crop-border';ov.appendChild(bdr);
  function mkH(p){var d=document.createElement('div');d.className='crop-handle';d.dataset.pos=p;return d;}
  var hs={tl:mkH('tl'),tr:mkH('tr'),bl:mkH('bl'),br:mkH('br')};
  Object.values(hs).forEach(function(hh){ov.appendChild(hh);});
  function upd(){
    var cl=crop.l*w,ct=crop.t*h,cr=crop.r*w,cb=crop.b*h,cw=cr-cl,ch=cb-ct;
    mT.style.cssText='position:absolute;background:rgba(0,0,0,0.45);top:0;left:'+cl+'px;width:'+cw+'px;height:'+ct+'px;';
    mB.style.cssText='position:absolute;background:rgba(0,0,0,0.45);top:'+cb+'px;left:'+cl+'px;width:'+cw+'px;height:'+(h-cb)+'px;';
    mL.style.cssText='position:absolute;background:rgba(0,0,0,0.45);top:0;left:0;width:'+cl+'px;height:'+h+'px;';
    mR.style.cssText='position:absolute;background:rgba(0,0,0,0.45);top:0;left:'+cr+'px;width:'+(w-cr)+'px;height:'+h+'px;';
    bdr.style.cssText='position:absolute;border:2px dashed #1976D2;z-index:21;pointer-events:none;left:'+cl+'px;top:'+ct+'px;width:'+cw+'px;height:'+ch+'px;';
    hs.tl.style.left=(cl-9)+'px';hs.tl.style.top=(ct-9)+'px';
    hs.tr.style.left=(cr-9)+'px';hs.tr.style.top=(ct-9)+'px';
    hs.bl.style.left=(cl-9)+'px';hs.bl.style.top=(cb-9)+'px';
    hs.br.style.left=(cr-9)+'px';hs.br.style.top=(cb-9)+'px';
  }
  upd();
  var dh=null,dx0,dy0,dc;
  function hDown(e){e.preventDefault();e.stopPropagation();dh=e.currentTarget.dataset.pos;var pt=e.touches?e.touches[0]:e;dx0=pt.clientX;dy0=pt.clientY;dc={t:crop.t,l:crop.l,r:crop.r,b:crop.b};document.addEventListener('mousemove',hMove);document.addEventListener('mouseup',hUp);document.addEventListener('touchmove',hMove,{passive:false});document.addEventListener('touchend',hUp);}
  function hMove(e){e.preventDefault();if(!dh)return;var pt=e.touches?e.touches[0]:e;var fx=(pt.clientX-dx0)/w,fy=(pt.clientY-dy0)/h;if(dh[0]==='t')crop.t=Math.max(0,Math.min(crop.b-0.1,dc.t+fy));if(dh[0]==='b')crop.b=Math.max(crop.t+0.1,Math.min(1,dc.b+fy));if(dh[1]==='l')crop.l=Math.max(0,Math.min(crop.r-0.1,dc.l+fx));if(dh[1]==='r')crop.r=Math.max(crop.l+0.1,Math.min(1,dc.r+fx));upd();}
  function hUp(){dh=null;document.removeEventListener('mousemove',hMove);document.removeEventListener('mouseup',hUp);document.removeEventListener('touchmove',hMove);document.removeEventListener('touchend',hUp);}
  Object.values(hs).forEach(function(hh){hh.addEventListener('mousedown',hDown);hh.addEventListener('touchstart',hDown,{passive:false});});
  var bb=document.createElement('div');bb.className='crop-btn-bar';
  var apBtn=document.createElement('button');apBtn.className='crop-btn apply';apBtn.textContent='\\u2713 Crop';
  apBtn.addEventListener('click',function(e){e.stopPropagation();doCrop();});
  var caBtn=document.createElement('button');caBtn.className='crop-btn cancel';caBtn.textContent='Cancel';
  caBtn.addEventListener('click',function(e){e.stopPropagation();ov.remove();bb.remove();});
  bb.appendChild(apBtn);bb.appendChild(caBtn);
  wrap.appendChild(ov);wrap.appendChild(bb);
  function doCrop(){
    var cvs=document.createElement('canvas');
    var nw=img.naturalWidth,nh=img.naturalHeight;
    var sx=Math.round(crop.l*nw),sy=Math.round(crop.t*nh);
    var sw=Math.round((crop.r-crop.l)*nw),sh=Math.round((crop.b-crop.t)*nh);
    if(sw<1)sw=1;if(sh<1)sh=1;
    cvs.width=sw;cvs.height=sh;
    var ctx=cvs.getContext('2d');ctx.drawImage(img,sx,sy,sw,sh,0,0,sw,sh);
    img.src=cvs.toDataURL('image/png');
    var dw=img.offsetWidth;img.style.height=Math.round(dw*(sh/sw))+'px';
    ov.remove();bb.remove();pushHistory();
  }
}

// ── INSERTS ───────────────────────────────────────────────────────────────
window.insertImage=function(base64,mimeType){
  restoreSelection();
  var wrap=document.createElement('div');
  wrap.className='img-resize-wrap';wrap.contentEditable='false';
  var img=document.createElement('img');
  img.src='data:'+mimeType+';base64,'+base64;
  img.className='inserted-image';
  img.style.width='100%';img.style.height='auto';img.style.display='block';
  img.draggable=false;
  wrap.appendChild(img);

  // Resize handle (bottom-right)
  var handle=document.createElement('div');
  handle.className='img-resize-handle br';
  wrap.appendChild(handle);

  // Click to select
  wrap.addEventListener('click',function(e){
    e.stopPropagation();
    document.querySelectorAll('.img-resize-wrap').forEach(function(w){w.classList.remove('selected');});
    wrap.classList.add('selected');
  });

  // Deselect on outside click
  document.addEventListener('click',function(e){
    if(!wrap.contains(e.target)){wrap.classList.remove('selected');}
  });

  // Touch/pointer resize
  var startX,startY,startW,startH,ratio;
  function onDown(e){
    e.preventDefault();e.stopPropagation();
    startW=img.offsetWidth;startH=img.offsetHeight;
    ratio=startH/startW;
    var pt=e.touches?e.touches[0]:e;
    startX=pt.clientX;startY=pt.clientY;
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',onUp);
    document.addEventListener('touchmove',onMove,{passive:false});
    document.addEventListener('touchend',onUp);
  }
  function onMove(e){
    e.preventDefault();
    var pt=e.touches?e.touches[0]:e;
    var dx=pt.clientX-startX;
    var newW=Math.max(40,startW+dx);
    img.style.width=newW+'px';
    img.style.height=Math.round(newW*ratio)+'px';
  }
  function onUp(){
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onUp);
    document.removeEventListener('touchmove',onMove);
    document.removeEventListener('touchend',onUp);
    pushHistory();
  }
  handle.addEventListener('mousedown',onDown);
  handle.addEventListener('touchstart',onDown,{passive:false});

  // Action buttons (crop + delete)
  var actionBar=document.createElement('div');
  actionBar.className='img-action-bar';
  var cropBtn=document.createElement('div');
  cropBtn.className='img-action-btn';cropBtn.innerHTML='\\u2702';cropBtn.title='Crop';
  cropBtn.addEventListener('mousedown',function(e){e.preventDefault();});
  cropBtn.addEventListener('click',function(e){e.stopPropagation();startCrop(wrap,img);});
  actionBar.appendChild(cropBtn);
  var delBtn=document.createElement('div');
  delBtn.className='img-action-btn';delBtn.innerHTML='\\uD83D\\uDDD1';delBtn.title='Delete';delBtn.style.color='#D32F2F';
  delBtn.addEventListener('mousedown',function(e){e.preventDefault();});
  delBtn.addEventListener('click',function(e){e.stopPropagation();if(confirm('Delete this image?')){wrap.parentNode.removeChild(wrap);pushHistory();notifyContent();}});
  actionBar.appendChild(delBtn);
  wrap.appendChild(actionBar);

  // Long-press to delete
  var _lpt=null;
  wrap.addEventListener('touchstart',function(){
    _lpt=setTimeout(function(){if(confirm('Delete this image?')){wrap.parentNode.removeChild(wrap);pushHistory();notifyContent();}},600);
  });
  wrap.addEventListener('touchend',function(){clearTimeout(_lpt);});
  wrap.addEventListener('touchmove',function(){clearTimeout(_lpt);});

  insertNode(wrap);
};

// ── TABLE INSERT ──────────────────────────────────────────────────────────
window.insertTable=function(rows,cols){
  restoreSelection();
  var wrap=document.createElement('div');
  wrap.className='table-wrapper';

  // Mini toolbar
  var tb=document.createElement('div');
  tb.className='table-toolbar';
  var btns=[
    {label:'+Row',fn:function(){addRow(tbl);}},
    {label:'+Col',fn:function(){addCol(tbl);}},
    {label:'-Row',fn:function(){delRow(tbl);}},
    {label:'-Col',fn:function(){delCol(tbl);}}
  ];
  btns.forEach(function(b){
    var btn=document.createElement('button');
    btn.textContent=b.label;
    btn.addEventListener('mousedown',function(e){e.preventDefault();});
    btn.addEventListener('click',function(e){e.stopPropagation();b.fn();pushHistory();});
    tb.appendChild(btn);
  });
  wrap.appendChild(tb);

  var tbl=document.createElement('table');
  tbl.className='editor-table';
  for(var r=0;r<rows;r++){
    var tr=document.createElement('tr');
    for(var c=0;c<cols;c++){
      var td=document.createElement('td');
      td.contentEditable='true';
      td.innerHTML='<br>';
      setupCell(td);
      tr.appendChild(td);
    }
    tbl.appendChild(tr);
  }
  wrap.appendChild(tbl);

  // Persistent "+" add-row button at bottom-right
  var addBtn=document.createElement('div');
  addBtn.className='table-add-row-btn';addBtn.textContent='+';addBtn.title='Add row';
  addBtn.addEventListener('mousedown',function(e){e.preventDefault();});
  addBtn.addEventListener('click',function(e){e.stopPropagation();addRow(tbl);pushHistory();});
  wrap.appendChild(addBtn);

  insertNode(wrap);
  // Focus first cell
  var first=tbl.querySelector('td');
  if(first)setTimeout(function(){first.focus();},50);
};

function setupCell(td){
  td.addEventListener('keydown',function(e){
    if(e.key==='Tab'){
      e.preventDefault();
      var cells=Array.from(td.closest('table').querySelectorAll('td'));
      var idx=cells.indexOf(td);
      var next=e.shiftKey?cells[idx-1]:cells[idx+1];
      if(next)next.focus();
    }
  });
}
function addRow(tbl){
  var cols=tbl.rows[0]?tbl.rows[0].cells.length:1;
  var tr=document.createElement('tr');
  for(var c=0;c<cols;c++){
    var td=document.createElement('td');
    td.contentEditable='true';td.innerHTML='<br>';setupCell(td);tr.appendChild(td);
  }
  tbl.appendChild(tr);
}
function addCol(tbl){
  Array.from(tbl.rows).forEach(function(tr){
    var td=document.createElement('td');
    td.contentEditable='true';td.innerHTML='<br>';setupCell(td);tr.appendChild(td);
  });
}
function delRow(tbl){
  if(tbl.rows.length>1)tbl.deleteRow(tbl.rows.length-1);
}
function delCol(tbl){
  if(!tbl.rows[0]||tbl.rows[0].cells.length<=1)return;
  Array.from(tbl.rows).forEach(function(tr){tr.deleteCell(tr.cells.length-1);});
}

window.insertShape=function(type){
  restoreSelection();
  var wrap=document.createElement('div');
  wrap.className='shape-container';wrap.contentEditable='false';
  var NS='http://www.w3.org/2000/svg';
  var svg=document.createElementNS(NS,'svg');
  svg.setAttribute('width','120');svg.setAttribute('height','80');svg.style.display='block';
  if(type==='rectangle'){
    var r=document.createElementNS(NS,'rect');
    r.setAttribute('x','4');r.setAttribute('y','4');r.setAttribute('width','112');r.setAttribute('height','72');
    r.setAttribute('fill','none');r.setAttribute('stroke','#333');r.setAttribute('stroke-width','2');
    svg.appendChild(r);
  }else if(type==='circle'){
    var c=document.createElementNS(NS,'ellipse');
    c.setAttribute('cx','60');c.setAttribute('cy','40');c.setAttribute('rx','55');c.setAttribute('ry','34');
    c.setAttribute('fill','none');c.setAttribute('stroke','#333');c.setAttribute('stroke-width','2');
    svg.appendChild(c);
  }else if(type==='line'){
    var l=document.createElementNS(NS,'line');
    l.setAttribute('x1','4');l.setAttribute('y1','40');l.setAttribute('x2','116');l.setAttribute('y2','40');
    l.setAttribute('stroke','#333');l.setAttribute('stroke-width','2');svg.appendChild(l);
  }else if(type==='arrow'){
    var defs=document.createElementNS(NS,'defs');
    var mk=document.createElementNS(NS,'marker');
    mk.setAttribute('id','arr');mk.setAttribute('markerWidth','10');mk.setAttribute('markerHeight','7');
    mk.setAttribute('refX','9');mk.setAttribute('refY','3.5');mk.setAttribute('orient','auto');
    var poly=document.createElementNS(NS,'polygon');
    poly.setAttribute('points','0 0,10 3.5,0 7');poly.setAttribute('fill','#333');
    mk.appendChild(poly);defs.appendChild(mk);svg.appendChild(defs);
    var al=document.createElementNS(NS,'line');
    al.setAttribute('x1','4');al.setAttribute('y1','40');al.setAttribute('x2','106');al.setAttribute('y2','40');
    al.setAttribute('stroke','#333');al.setAttribute('stroke-width','2');al.setAttribute('marker-end','url(#arr)');
    svg.appendChild(al);
  }
  wrap.appendChild(svg);
  wrap.onclick=function(){
    document.querySelectorAll('.shape-container').forEach(function(s){s.classList.remove('selected');});
    wrap.classList.toggle('selected');
  };
  insertNode(wrap);
};

window.insertTextBox=function(){
  restoreSelection();
  var box=document.createElement('div');
  box.className='text-box';box.contentEditable='true';box.textContent='Text box';
  insertNode(box);setTimeout(function(){box.focus();},50);
};

window.insertSignature=function(base64){
  restoreSelection();
  var img=document.createElement('img');
  img.src='data:image/png;base64,'+base64;img.className='signature-img';
  insertNode(img);
};

window.insertHyperlink=function(text,url){
  restoreSelection();
  var a=document.createElement('a');
  a.href=url;a.textContent=text||url;a.className='hyperlink';a.contentEditable='false';
  insertNode(a);
};

window.insertDateTime=function(text){
  restoreSelection();document.execCommand('insertText',false,text);pushHistory();
};

window.insertComment=function(commentText,id){
  restoreSelection();
  var sel=window.getSelection();if(!sel||!sel.rangeCount)return;
  var range=sel.getRangeAt(0);
  var span=document.createElement('span');
  span.className='comment-mark';span.setAttribute('data-comment-id',id);span.title=commentText;
  try{range.surroundContents(span);}
  catch(e){span.textContent=sel.toString()||'[Comment]';range.deleteContents();range.insertNode(span);}
  pushHistory();
};

window.insertBookmark=function(name,id){
  restoreSelection();
  var anchor=document.createElement('span');
  anchor.className='bookmark-mark';anchor.id='bm-'+id;anchor.contentEditable='false';
  anchor.title='Bookmark: '+name;anchor.textContent='🔗';
  insertNode(anchor);
};

window.insertBlankPage=function(){
  restoreSelection();
  var hr=document.createElement('hr');hr.className='page-break';insertNode(hr);
  var p=document.createElement('p');p.innerHTML='<br>';insertNode(p);
};

window.insertAttachment=function(name){
  restoreSelection();
  var div=document.createElement('div');
  div.className='doc-attachment';div.contentEditable='false';
  div.innerHTML='<span>📎</span><span>'+name+'</span>';
  insertNode(div);
};

function insertNode(node){
  var sel=window.getSelection();
  if(sel&&sel.rangeCount){
    var range=sel.getRangeAt(0);
    range.deleteContents();range.insertNode(node);
    var after=document.createRange();
    after.setStartAfter(node);after.collapse(true);
    sel.removeAllRanges();sel.addRange(after);
    _savedRange=after.cloneRange();
  }else{
    editor.appendChild(node);
  }
  pushHistory();notifyContent();
}

// ── STATE NOTIFICATIONS ───────────────────────────────────────────────────
function notifySelectionState(){
  try{
    var bold=document.queryCommandState('bold');
    var italic=document.queryCommandState('italic');
    var underline=document.queryCommandState('underline');
    var strike=document.queryCommandState('strikeThrough');
    var subscript=document.queryCommandState('subscript');
    var superscript=document.queryCommandState('superscript');
    var align='left';
    if(document.queryCommandState('justifyCenter'))align='center';
    else if(document.queryCommandState('justifyRight'))align='right';
    else if(document.queryCommandState('justifyFull'))align='justify';
    var block=getBlock();
    if(block&&block.style.textAlign)align=block.style.textAlign;
    rn({type:'SELECTION_STATE',bold:bold,italic:italic,underline:underline,strikethrough:strike,subscript:subscript,superscript:superscript,align:align});
  }catch(e){}
}
function notifyContent(){
  var text=editor.innerText||'';
  var words=text.trim()?text.trim().split(/\\s+/).length:0;
  rn({type:'CONTENT_CHANGE',wordCount:words,charCount:text.length});
}
window.getContent=function(){
  // Marks are stripped on the way out — a save is never allowed to carry
  // decoration. Identical to editor.innerHTML when nothing is marked.
  rn({type:'SAVE_CONTENT',html:__pf_stripHtml(editor.innerHTML),text:editor.innerText||''});
};

window.loadContent=function(html){
  editor.innerHTML=html;
  pushHistory();
  notifyContent();
};

function rn(data){
  if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(data));
}

// ══════════════════════════════════════════════════════════════════════════
// PROOFREAD (R3) — inert until __pf_setEnabled(true), which only happens
// behind AI_PROOFREAD. With the flag off none of this ever runs.
// ══════════════════════════════════════════════════════════════════════════
var __pf_on=false;
var __pf_seq=0;

window.__pf_setEnabled=function(on){
  __pf_on=!!on;
  if(!__pf_on)window.__pf_clearMarks();
};

// ── SELECTION SAFETY ──────────────────────────────────────────────────────
// Marking splits text nodes, which can invalidate a live selection. The
// editor's whole formatting system depends on _savedRange surviving (see the
// SELECTION SAVE/RESTORE note at the top of this file), so every mutation
// below is bracketed by these two functions: character offsets are immune to
// node splitting in a way that Range objects are not.
function __pf_getSel(){
  try{
    var sel=window.getSelection();
    if(!sel||!sel.rangeCount)return null;
    var r=sel.getRangeAt(0);
    if(!editor.contains(r.commonAncestorContainer)&&r.commonAncestorContainer!==editor)return null;
    var pre=document.createRange();
    pre.selectNodeContents(editor);
    pre.setEnd(r.startContainer,r.startOffset);
    var start=pre.toString().length;
    pre.setEnd(r.endContainer,r.endOffset);
    var end=pre.toString().length;
    return {start:start,end:end,had:document.activeElement===editor};
  }catch(e){return null;}
}

function __pf_nodeAt(off){
  var tw=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT,null,false);
  var cnt=0,nd;
  while(nd=tw.nextNode()){
    var len=nd.textContent.length;
    if(cnt+len>=off)return {node:nd,offset:off-cnt};
    cnt+=len;
  }
  return null;
}

function __pf_setSel(saved){
  if(!saved)return;
  try{
    var a=__pf_nodeAt(saved.start),b=__pf_nodeAt(saved.end);
    if(!a||!b)return;
    var r=document.createRange();
    r.setStart(a.node,a.offset);
    r.setEnd(b.node,b.offset);
    var sel=window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    // Keep the editor's own saved range in step, so the very next toolbar
    // command restores the same selection it would have before marking.
    _savedRange=r.cloneRange();
  }catch(e){}
}

/** Run a DOM mutation without disturbing the caret or the selection. */
function __pf_preserving(fn){
  var saved=__pf_getSel();
  try{fn();}catch(e){}
  __pf_setSel(saved);
}

// ── BLOCKS ────────────────────────────────────────────────────────────────
// A block is a paragraph: the editor's block-level children. Each gets a
// stable data-pfid minted ONCE and kept across edits, so a paragraph's
// results survive typing elsewhere in the document.
function __pf_blockEls(){
  var out=[];
  var kids=editor.children;
  for(var i=0;i<kids.length;i++){
    var el=kids[i];
    var tag=el.tagName;
    if(tag==='UL'||tag==='OL'){
      var lis=el.querySelectorAll('li');
      for(var j=0;j<lis.length;j++)out.push(lis[j]);
    }else if(tag==='TABLE'||tag==='HR'||tag==='IMG'){
      continue;
    }else{
      out.push(el);
    }
  }
  return out;
}

function __pf_hash(s){
  var h=0;
  for(var i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h=h&h;}
  return Math.abs(h).toString(36);
}

window.__pf_collectBlocks=function(){
  if(!__pf_on){rn({type:'PF_BLOCKS',blocks:[]});return;}
  var els=__pf_blockEls();
  var blocks=[];
  for(var i=0;i<els.length;i++){
    var el=els[i];
    if(!el.getAttribute('data-pfid')){
      __pf_seq++;
      el.setAttribute('data-pfid','pf'+__pf_seq);
    }
    // textContent, not innerText: marks are inline spans and contribute no
    // text of their own, so the text is identical marked or unmarked.
    var text=el.textContent||'';
    if(!text.trim())continue;
    blocks.push({id:el.getAttribute('data-pfid'),text:text,hash:__pf_hash(text)});
  }
  rn({type:'PF_BLOCKS',blocks:blocks});
};

function __pf_blockById(id){
  return editor.querySelector('[data-pfid="'+id+'"]');
}

// ── MARKS ─────────────────────────────────────────────────────────────────
function __pf_clearIn(el){
  var ns=el.querySelectorAll('span.pf');
  for(var i=0;i<ns.length;i++){
    var n=ns[i],p=n.parentNode;
    if(!p)continue;
    while(n.firstChild)p.insertBefore(n.firstChild,n);
    p.removeChild(n);
  }
  el.normalize();
}

/**
 * Remove every mark. Called before save, export and print, when proofreading
 * is switched off, and before any accept.
 */
window.__pf_clearMarks=function(blockId){
  __pf_preserving(function(){
    if(blockId){
      var el=__pf_blockById(blockId);
      if(el)__pf_clearIn(el);
    }else{
      __pf_clearIn(editor);
    }
  });
};

/** Character offset → {node, offset} within one block element. */
function __pf_locate(el,offset){
  var tw=document.createTreeWalker(el,NodeFilter.SHOW_TEXT,null,false);
  var cnt=0,nd;
  while(nd=tw.nextNode()){
    var len=nd.textContent.length;
    if(cnt+len>=offset)return {node:nd,offset:offset-cnt};
    cnt+=len;
  }
  return null;
}

/**
 * Draw marks for one block. items is [{id,start,end,type}] with offsets
 * already resolved on the RN side against this block's text.
 *
 * Applied back-to-front so each wrap cannot shift the offsets of the ones
 * still to come.
 */
window.__pf_applyMarks=function(blockId,items){
  if(!__pf_on)return;
  var el=__pf_blockById(blockId);
  if(!el)return;
  __pf_preserving(function(){
    __pf_clearIn(el);
    var sorted=(items||[]).slice().sort(function(a,b){return b.start-a.start;});
    for(var i=0;i<sorted.length;i++){
      var it=sorted[i];
      try{
        var s=__pf_locate(el,it.start),e=__pf_locate(el,it.end);
        if(!s||!e)continue;
        var r=document.createRange();
        r.setStart(s.node,s.offset);
        r.setEnd(e.node,e.offset);
        var span=document.createElement('span');
        span.className='pf pf-'+(it.type||'grammar');
        span.setAttribute('data-pf-id',it.id);
        span.setAttribute('data-pf-block',blockId);
        // surroundContents throws when the range partially selects a node
        // (e.g. it straddles a <b>); extractContents handles that case.
        try{r.surroundContents(span);}
        catch(err){span.appendChild(r.extractContents());r.insertNode(span);}
      }catch(err2){}
    }
  });
};

// ── ACCEPT ────────────────────────────────────────────────────────────────
/**
 * Replace one located range with replacement, as a SINGLE undoable step.
 *
 * Order matters: marks come off FIRST, so the history snapshot taken after
 * the edit contains no decoration and undo restores clean text. The RN side
 * then re-checks the paragraph, which redraws whatever marks still apply —
 * positions are never shifted arithmetically.
 */
window.__pf_accept=function(blockId,start,end,replacement){
  var el=__pf_blockById(blockId);
  if(!el){rn({type:'PF_ACCEPTED',blockId:blockId,ok:false});return;}
  // Flush any pending debounced snapshot so the pre-edit state is the
  // previous undo step, making this edit exactly one step of its own.
  clearTimeout(_htimer);
  if(__pf_stripHtml(editor.innerHTML)!==_hist[_hidx].h)_snap();

  __pf_clearIn(el);
  var ok=false;
  try{
    var s=__pf_locate(el,start),e=__pf_locate(el,end);
    if(s&&e){
      var r=document.createRange();
      r.setStart(s.node,s.offset);
      r.setEnd(e.node,e.offset);
      r.deleteContents();
      if(replacement)r.insertNode(document.createTextNode(replacement));
      el.normalize();
      // Caret just after the replacement, which is where a writer expects it.
      try{
        var after=__pf_locate(el,start+(replacement?replacement.length:0));
        if(after){
          var cr=document.createRange();
          cr.setStart(after.node,after.offset);
          cr.collapse(true);
          var sel=window.getSelection();
          sel.removeAllRanges();sel.addRange(cr);
          _savedRange=cr.cloneRange();
        }
      }catch(e3){}
      ok=true;
    }
  }catch(e2){}

  pushHistory();
  notifyContent();
  rn({type:'PF_ACCEPTED',blockId:blockId,ok:ok});
};

// Tapping a mark opens its card on the RN side.
editor.addEventListener('click',function(ev){
  if(!__pf_on)return;
  var node=ev.target;
  while(node&&node!==editor){
    if(node.classList&&node.classList.contains('pf')){
      rn({
        type:'PF_MARK_TAP',
        blockId:node.getAttribute('data-pf-block'),
        suggestionId:node.getAttribute('data-pf-id')
      });
      return;
    }
    node=node.parentNode;
  }
});

// ── EVENT LISTENERS ───────────────────────────────────────────────────────
// ── SCROLL-TO-CARET (keyboard avoidance) ──────────────────────────────
// Uses getBoundingClientRect on the selection — never mutates the DOM.
function scrollToCaret(){
  try{
    var sel=window.getSelection();
    if(!sel||!sel.rangeCount)return;
    var range=sel.getRangeAt(0);
    var rect=range.getBoundingClientRect();
    if(!rect||rect.height===0){
      var node=range.commonAncestorContainer;
      if(node.nodeType===3)node=node.parentNode;
      if(node&&node.getBoundingClientRect)rect=node.getBoundingClientRect();
    }
    if(!rect)return;
    var vh=window.visualViewport?window.visualViewport.height:window.innerHeight;
    var margin=60;
    if(rect.bottom>vh-margin){
      window.scrollBy({top:rect.bottom-(vh-margin),behavior:'smooth'});
    }else if(rect.top<margin){
      window.scrollBy({top:rect.top-margin,behavior:'smooth'});
    }
  }catch(e){}
}

// Scroll on keyboard resize (visual viewport change)
if(window.visualViewport){
  window.visualViewport.addEventListener('resize',function(){
    setTimeout(scrollToCaret,80);
  });
}

editor.addEventListener('input',function(e){
  var isBoundary=false;
  if(e.inputType==='insertParagraph'||e.inputType==='insertLineBreak'){
    isBoundary=true;
  }else if(e.inputType==='insertText'&&e.data){
    if(/[\\s\\t\\n\\r\\.\\,;:!?\\-\\(\\)\\[\\]{}\\"\\'\\\/\\\\]/.test(e.data)){
      isBoundary=true;
    }
  }else if(e.inputType==='deleteContentBackward'||e.inputType==='deleteContentForward'||
           e.inputType==='deleteWordBackward'||e.inputType==='deleteWordForward'){
    isBoundary=true;
  }
  _inputChanged(isBoundary);
  notifyContent();
  scrollToCaret();
});
editor.addEventListener('keyup',function(){notifySelectionState();notifyContent();});
editor.addEventListener('mouseup',notifySelectionState);
editor.addEventListener('touchend',notifySelectionState);

setTimeout(function(){editor.focus();},200);
</script>
</body>
</html>
`;

// ── Component ──────────────────────────────────────────────────────────────

export default React.memo(function WebEditor() {
  const { webViewRef, dispatch, lastHtmlRef } = useDocument();
  const fontScriptRef = useRef<string | null>(null);

  // Load bundled font CSS injection script AFTER initial render settles —
  // the editor is usable with system fonts immediately; custom fonts are
  // injected once InteractionManager fires, avoiding mount-time jank.
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      getWebViewFontInjectionScript()
        .then((script) => {
          fontScriptRef.current = script;
          // If WebView is already loaded, inject now
          if (webViewRef.current) {
            webViewRef.current.injectJavaScript(script);
          }
        })
        .catch(() => {}); // fonts will just use system fallback
    });
    return () => handle.cancel();
  }, [webViewRef]);

  // Debounce timers for high-frequency messages from the WebView editor.
  // CONTENT_CHANGE fires on every input and SELECTION_STATE on every
  // keyup/mouseup — dispatching each one immediately causes the whole
  // editor tree to re-render.  Instead we batch them with a short timer.
  const contentChangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionStateTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingContentChange = useRef<{
    wordCount: number;
    charCount: number;
  } | null>(null);
  const pendingSelectionState = useRef<any>(null);

  // ── Proofread (R3) ──────────────────────────────────────────────────
  // Lives here because this is where onMessage is. With AI_PROOFREAD off the
  // controller renders nothing, injects nothing and sends nothing.
  const proofreadRef = useRef<ProofreadControllerHandle | null>(null);
  const [proofreadCount, setProofreadCount] = useState(0);
  /**
   * Bumped on every content change. This is what the controller debounces on
   * — never a keystroke, always a settled edit.
   */
  const [changeToken, setChangeToken] = useState(0);
  const handleProofreadHandle = useCallback(
    (handle: ProofreadControllerHandle) => {
      proofreadRef.current = handle;
      setProofreadCount(handle.count);
    },
    [],
  );

  const handleMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      try {
        const data: EditorWebViewMessage = JSON.parse(event.nativeEvent.data);

        // Proofread messages are handled first and consumed; everything else
        // falls through to the switch below exactly as before.
        if (
          AI_PROOFREAD &&
          proofreadRef.current?.handleMessage(data as Record<string, unknown>)
        ) {
          return;
        }

        switch (data.type) {
          case "CONTENT_CHANGE":
            // Proofread's debounce trigger. The controller waits ~1.8 s after
            // this stops changing before it checks anything.
            if (AI_PROOFREAD) setChangeToken((n) => n + 1);
            // Debounce word/char count updates (fire at most every 300ms)
            pendingContentChange.current = {
              wordCount: data.wordCount,
              charCount: data.charCount,
            };
            if (!contentChangeTimer.current) {
              contentChangeTimer.current = setTimeout(() => {
                if (pendingContentChange.current) {
                  dispatch({
                    type: "UPDATE_COUNTS",
                    ...pendingContentChange.current,
                  });
                  pendingContentChange.current = null;
                }
                contentChangeTimer.current = null;
              }, 300);
            }
            break;

          case "SELECTION_STATE":
            // Debounce formatting state updates (fire at most every 150ms)
            pendingSelectionState.current = {
              bold: data.bold,
              italic: data.italic,
              underline: data.underline,
              strikethrough: data.strikethrough,
              subscript: data.subscript,
              superscript: data.superscript,
              textAlign: data.align,
            };
            if (!selectionStateTimer.current) {
              selectionStateTimer.current = setTimeout(() => {
                if (pendingSelectionState.current) {
                  dispatch({
                    type: "SET_FORMATTING_STATE",
                    payload: pendingSelectionState.current,
                  });
                  pendingSelectionState.current = null;
                }
                selectionStateTimer.current = null;
              }, 150);
            }
            break;

          case "UNDO_REDO":
            dispatch({
              type: "SET_UNDO_REDO",
              canUndo: data.canUndo,
              canRedo: data.canRedo,
            });
            break;

          case "CONTENT":
            lastHtmlRef.current = data.html;
            break;

          case "SAVE_CONTENT":
            lastHtmlRef.current = data.html;
            break;

          default:
            break;
        }

        // Handle GET_CONTENT_RESULT for the getEditorHtml() promise
        if (
          (data as any).type === "GET_CONTENT_RESULT" &&
          (webViewRef.current as any)?.__htmlResolve
        ) {
          (webViewRef.current as any).__htmlResolve((data as any).html || "");
          delete (webViewRef.current as any).__htmlResolve;
        }
      } catch {
        // Ignore non-JSON messages
      }
    },
    [dispatch, lastHtmlRef],
  );

  // Inject bundled fonts into the WebView after it finishes loading
  const handleLoad = useCallback(() => {
    if (fontScriptRef.current && webViewRef.current) {
      webViewRef.current.injectJavaScript(fontScriptRef.current);
    }
  }, [webViewRef]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html: EDITOR_HTML }}
        onMessage={handleMessage}
        onLoad={handleLoad}
        scrollEnabled
        keyboardDisplayRequiresUserAction={false}
        showsVerticalScrollIndicator={false}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        mixedContentMode="always"
      />

      {/* ── Proofread (R3) ──────────────────────────────────────────
           Renders nothing at all when AI_PROOFREAD is off. */}
      {AI_PROOFREAD && (
        <>
          <ProofreadController
            webViewRef={webViewRef}
            changeToken={changeToken}
            onHandle={handleProofreadHandle}
          />
          {proofreadCount > 0 && (
            <Pressable
              style={styles.proofreadPill}
              onPress={() => proofreadRef.current?.openSummary()}
              accessibilityRole="button"
              accessibilityLabel={`${proofreadCount} writing suggestions`}
            >
              <MaterialIcons name="spellcheck" size={16} color="#FFFFFF" />
              <Text style={styles.proofreadPillText}>{proofreadCount}</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  webview: { flex: 1, backgroundColor: "transparent" },
  // Bottom-LEFT, so it never sits under the formatting toolbar's controls on
  // the right or over the caret area in the middle.
  proofreadPill: {
    position: "absolute",
    left: 12,
    bottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(17,24,39,0.85)",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  proofreadPillText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
});

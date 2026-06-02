// ============================================
// StudioEditor — a self-contained rich-text editor in a WebView.
// The editable surface lives in a contentEditable doc; formatting is driven by
// the native toolbar (Document Studio) through a small JS bridge. The editor
// reports {html, text, wordCount, headings} back on every change.
// ============================================

import React, { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

export interface EditorHeading {
  id: string;
  level: number;
  text: string;
}

export interface EditorChange {
  html: string;
  text: string;
  wordCount: number;
  headings: EditorHeading[];
}

export interface StudioEditorHandle {
  exec: (cmd: string, value?: string) => void;
  insertQuote: (quote: string, source: string) => void;
  insertText: (text: string) => void;
  insertOutline: (headings: string[]) => void;
  setContent: (html: string) => void;
  scrollToHeading: (id: string) => void;
  focus: () => void;
}

interface Props {
  initialHtml: string;
  onChange: (data: EditorChange) => void;
  onReady?: () => void;
  mode: "light" | "dark";
}

function buildHtml(initialHtml: string, mode: "light" | "dark"): string {
  const dark = mode === "dark";
  const bg = dark ? "#0F172A" : "#FFFFFF";
  const fg = dark ? "#E2E8F0" : "#0F172A";
  const muted = dark ? "#64748B" : "#94A3B8";
  const quoteBar = "#9333EA";
  const quoteBg = dark ? "rgba(147,51,234,0.12)" : "rgba(147,51,234,0.07)";
  const linkColor = dark ? "#A78BFA" : "#7C3AED";

  // NOTE: initialHtml is the editor body produced by this same editor (trusted,
  // local). It is injected as the starting document content.
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
<style>
  * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
  html, body { margin:0; padding:0; background:${bg}; }
  #ed {
    min-height: 100%;
    padding: 16px 16px 120px 16px;
    color:${fg};
    font-family: -apple-system, Roboto, "Segoe UI", system-ui, sans-serif;
    font-size: 16px;
    line-height: 1.6;
    outline: none;
    -webkit-user-select: text;
  }
  #ed:empty:before {
    content: attr(data-placeholder);
    color:${muted};
    pointer-events: none;
  }
  #ed h1 { font-size: 24px; font-weight: 800; margin: 18px 0 8px; letter-spacing: -0.3px; }
  #ed h2 { font-size: 20px; font-weight: 700; margin: 16px 0 6px; letter-spacing: -0.2px; }
  #ed h3 { font-size: 17px; font-weight: 700; margin: 14px 0 6px; }
  #ed p { margin: 0 0 12px; }
  #ed ul, #ed ol { margin: 0 0 12px; padding-left: 22px; }
  #ed li { margin: 0 0 5px; }
  #ed a { color:${linkColor}; }
  #ed blockquote {
    margin: 14px 0;
    padding: 10px 14px;
    border-left: 3px solid ${quoteBar};
    background:${quoteBg};
    border-radius: 0 8px 8px 0;
    font-style: italic;
  }
  #ed blockquote cite {
    display:block;
    margin-top: 6px;
    font-style: normal;
    font-size: 12.5px;
    color:${muted};
    font-weight: 600;
  }
</style>
</head>
<body>
<div id="ed" contenteditable="true" data-placeholder="Start writing… pull from your books, get AI help, all here.">${initialHtml}</div>
<script>
  var ed = document.getElementById('ed');
  var savedRange = null;
  var debounceTimer = null;

  function post(obj){
    if(window.ReactNativeWebView){ window.ReactNativeWebView.postMessage(JSON.stringify(obj)); }
  }

  function collectHeadings(){
    var hs = ed.querySelectorAll('h1,h2,h3');
    var out = [];
    for(var i=0;i<hs.length;i++){
      hs[i].id = 'h-' + i;
      out.push({ id:'h-'+i, level: parseInt(hs[i].tagName.substring(1),10), text:(hs[i].innerText||'').trim() });
    }
    return out;
  }

  function postChange(){
    var headings = collectHeadings();
    var text = ed.innerText || '';
    var t = text.trim();
    var words = t ? t.split(/\\s+/).length : 0;
    post({ type:'change', html: ed.innerHTML, text: text, wordCount: words, headings: headings });
  }

  function schedule(){
    if(debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(postChange, 250);
  }

  document.addEventListener('selectionchange', function(){
    var sel = window.getSelection();
    if(sel && sel.rangeCount && ed.contains(sel.anchorNode)){ savedRange = sel.getRangeAt(0); }
  });

  function restore(){
    if(savedRange){
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  }

  function exec(cmd, val){
    ed.focus();
    restore();
    try { document.execCommand(cmd, false, val || null); } catch(e){}
    postChange();
  }

  function escapeHtml(s){
    return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function insertQuote(quote, source){
    ed.focus();
    restore();
    var html = '<blockquote>' + escapeHtml(quote) +
      (source ? '<cite>— ' + escapeHtml(source) + '</cite>' : '') +
      '</blockquote><p><br></p>';
    try { document.execCommand('insertHTML', false, html); } catch(e){ ed.innerHTML += html; }
    postChange();
  }

  function insertText(text){
    ed.focus();
    restore();
    var html = '';
    var paras = (text||'').split(/\\n\\n+/);
    for(var i=0;i<paras.length;i++){
      html += '<p>' + escapeHtml(paras[i]).replace(/\\n/g,'<br>') + '</p>';
    }
    try { document.execCommand('insertHTML', false, html); } catch(e){ ed.innerHTML += html; }
    postChange();
  }

  function insertOutline(headings){
    ed.focus();
    restore();
    var html = '';
    for(var i=0;i<(headings||[]).length;i++){
      html += '<h2>' + escapeHtml(headings[i]) + '</h2><p><br></p>';
    }
    try { document.execCommand('insertHTML', false, html); } catch(e){ ed.innerHTML += html; }
    postChange();
  }

  window.rnExec = function(c){
    if(!c) return;
    if(c.type==='exec') exec(c.cmd, c.value);
    else if(c.type==='insertQuote') insertQuote(c.quote, c.source);
    else if(c.type==='insertText') insertText(c.text);
    else if(c.type==='insertOutline') insertOutline(c.headings);
    else if(c.type==='setContent'){ ed.innerHTML = c.html || ''; postChange(); }
    else if(c.type==='scrollTo'){ var el=document.getElementById(c.id); if(el) el.scrollIntoView({behavior:'smooth', block:'start'}); }
    else if(c.type==='focus'){ ed.focus(); }
  };

  ed.addEventListener('input', schedule);
  ed.addEventListener('blur', postChange);

  post({ type:'ready' });
  postChange();
</script>
</body>
</html>`;
}

const StudioEditor = forwardRef<StudioEditorHandle, Props>(function StudioEditor(
  { initialHtml, onChange, onReady, mode },
  ref,
) {
  const webRef = useRef<WebView>(null);
  // Track the latest content so a mode-triggered rebuild (which reloads the
  // WebView) starts from what the user has actually written, not the original.
  const contentRef = useRef(initialHtml);
  // Build the HTML once per mode — content updates otherwise flow through the
  // bridge, not by reloading the document (which would lose the cursor).
  const html = useMemo(() => buildHtml(contentRef.current, mode), [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = (cmd: Record<string, unknown>) => {
    webRef.current?.injectJavaScript(`window.rnExec(${JSON.stringify(cmd)}); true;`);
  };

  useImperativeHandle(ref, () => ({
    exec: (cmd, value) => send({ type: "exec", cmd, value }),
    insertQuote: (quote, source) => send({ type: "insertQuote", quote, source }),
    insertText: (text) => send({ type: "insertText", text }),
    insertOutline: (hs) => send({ type: "insertOutline", headings: hs }),
    setContent: (h) => send({ type: "setContent", html: h }),
    scrollToHeading: (id) => send({ type: "scrollTo", id }),
    focus: () => send({ type: "focus" }),
  }));

  const handleMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === "ready") onReady?.();
      else if (msg.type === "change") {
        contentRef.current = msg.html ?? "";
        onChange({
          html: msg.html ?? "",
          text: msg.text ?? "",
          wordCount: msg.wordCount ?? 0,
          headings: Array.isArray(msg.headings) ? msg.headings : [],
        });
      }
    } catch {
      /* ignore malformed bridge messages */
    }
  };

  return (
    <View style={styles.wrap}>
      <WebView
        ref={webRef}
        originWhitelist={["*"]}
        source={{ html }}
        onMessage={handleMessage}
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView
        textZoom={100}
        style={styles.web}
        // Editor is a single local document — no navigation needed.
        scrollEnabled
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
});

export default StudioEditor;

const styles = StyleSheet.create({
  wrap: { flex: 1, overflow: "hidden" },
  web: { flex: 1, backgroundColor: "transparent" },
});

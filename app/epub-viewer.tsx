/**
 * EPUB Viewer Screen
 *
 * In-app EPUB reader powered by epub.js running inside a WebView.
 * The epub.js and jszip libraries are bundled as base64 constants
 * (services/epubBundledScripts.ts) so the reader works fully offline.
 *
 * Features:
 *  - Paginated reading (tap left/right thirds or use nav buttons)
 *  - Table-of-contents modal
 *  - Reader settings (theme, font-size)
 *  - Reading progress persistence (via CFI)
 *  - Loading indicator while preparing book
 *  - Graceful error handling for malformed EPUBs
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
// SECONDARY (additive): records the open for context-awareness surfacing.
import { recordDocumentOpen } from "@/services/contextAwarenessService";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { PronunciationEditor } from "@/components/PronunciationEditor";
import { READ_ALOUD_HIGHLIGHTER_SOURCE } from "@/utils/readAloudHighlightScript";
import {
  AI_READER_PANEL,
  EPUB_PAGINATED_MODE,
  READING_SESSIONS,
  SAVED_PAGES,
} from "@/constants/featureFlags";
import { useReadingSession } from "@/hooks/useReadingSession";
import { useSavePage } from "@/hooks/useSavePage";
import { useKeepScreenAwake } from "@/hooks/useKeepScreenAwake";
import { MenuToggle } from "@/components/DocumentViewer/MenuToggle";
import { SNAPSHOT_MAX } from "@/services/savedPagesTypes";
import { PAGE_HTML_CAPTURE_JS } from "@/utils/pageHtmlCapture";
import { buildEpubTypographyCss } from "@/services/epubTypography";
import { useReaderSettings } from "@/hooks/useReaderSettings";
import { ReadAloudBar } from "@/components/ReadAloudBar";
import { BookmarkToast } from "@/components/DocumentViewer/BookmarkToast";
import { SelectionToolbar } from "@/components/DocumentViewer/SelectionToolbar";
import { VoicePicker } from "@/components/VoicePicker";
import {
  READ_ALOUD_PANEL_CLEARANCE,
  ReaderAIPanel,
  type ReaderAIPanelHandle,
} from "@/components/ai/ReaderAIPanel";
import { SOURCE_CARD_OVERLAY_STYLE, SourceCard } from "@/components/ai/SourceCard";
import { parseLocatorParams } from "@/services/ai/citationNavigator";
import { locatorLabel, type AICitation } from "@/services/ai/citations";
import { pickSearchRun } from "@/utils/quoteMatch";
import {
  DarkTheme,
  LightTheme,
  Palette,
  Spacing,
  Typography,
  openWithSystemApp,
  showOpenFailedAlert,
} from "@/services/document-manager";
import { markFileOpened } from "@/services/fileIndexService";
import { readAloudPersistence } from "@/services/readAloudPersistence";
import { useEpubReadAloud } from "@/src/hooks/useEpubReadAloud";

import {
  EpubReaderSettings,
  getDefaultReaderSettings,
  getEpubDisplayName,
  loadReaderSettings,
  loadReadingProgress,
  normalizeEpubUri,
  readEpubAsBase64,
  saveReaderSettings,
  saveReadingProgress,
} from "@/services/epubService";
import { loadSettings } from "@/services/settingsService";
import {
  getHighlights,
  getStrikethroughs,
  getUnderlines,
  saveHighlight,
  saveStrikethrough,
  saveUnderline,
} from "@/services/viewerStorageService";
import { setReadingProgress } from "@/services/readingProgressService";
import { bumpReadingTime } from "@/services/workspaceInsightsService";
import type { Highlight, Strikethrough, Underline } from "@/src/types/document-viewer.types";

import {
  EPUBJS_MIN_JS_B64,
  JSZIP_MIN_JS_B64,
} from "@/services/epubBundledScripts";

// ============================================================================
// Types for messages coming from the WebView
// ============================================================================
interface WVReadyMsg {
  type: "ready";
  data: { title?: string; author?: string };
}
interface WVErrorMsg {
  type: "error";
  data: { message: string };
}
interface WVLocationMsg {
  type: "location";
  data: { cfi: string; percentage: number; chapter: number; total: number };
}
interface WVTocMsg {
  type: "toc";
  data: { toc: Array<{ label: string; href: string }> };
}
interface WVOtherMsg {
  type: "webview-ready" | "end-of-book" | "start-of-book";
}
interface WVSearchMsg {
  type: "search-result";
  data: { count: number; current: number };
}
type WVMessage =
  | WVReadyMsg
  | WVErrorMsg
  | WVLocationMsg
  | WVTocMsg
  | WVSearchMsg
  | WVOtherMsg;

// ============================================================================
// Component
// ============================================================================
export default function EpubViewerScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const theme = colorScheme === "dark" ? DarkTheme : LightTheme;
  const webViewRef = useRef<WebView>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ── Reading-time heartbeat → WorkSpace Progress dashboard ──
  // ORIGINAL PATH (READING_SESSIONS off), kept verbatim so the flag is a true
  // kill switch. useReadingSession below replaces it when the flag is on.
  useEffect(() => {
    if (READING_SESSIONS) return; // the shared hook owns the heartbeat instead
    const BEAT_MS = 20000;
    const id = setInterval(() => {
      if (AppState.currentState === "active") bumpReadingTime(BEAT_MS);
    }, BEAT_MS);
    return () => clearInterval(id);
  }, []);

  /** R2's activity signal, held in a ref so callbacks never re-bind. */
  const noteActivityRef = useRef<(() => void) | null>(null);
  /** The CFI the reader is currently on — the exact Saved Pages locator. */
  const currentCfiRef = useRef<string | null>(null);
  /** Saves waiting on the epub.js bridge to report its visible text. */
  const visibleTextWaitersRef = useRef<((text: string) => void)[]>([]);
  const visibleHtmlWaitersRef = useRef<
    ((result: { html: string; css: string }) => void)[]
  >([]);

  const { uri, name, locatorType, locatorIndex, quote, savedCfi } =
    useLocalSearchParams<{
      uri: string;
      name: string;
      /** Optional citation target (a tapped source in Chat with File). */
      locatorType?: string;
      locatorIndex?: string;
      quote?: string;
      /**
       * Optional exact position from a saved page (R1). A CFI is exact, so it
       * takes priority over the saved reading position when both exist.
       */
      savedCfi?: string;
    }>();
  const displayName = name || getEpubDisplayName(uri || "");

  // ---- State ----
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookInfo, setBookInfo] = useState<{ title?: string; author?: string }>(
    {},
  );
  const [progress, setProgress] = useState(0);
  const [toc, setToc] = useState<Array<{ label: string; href: string }>>([]);
  const [showToc, setShowToc] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showReadAloud, setShowReadAloud] = useState(false);
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const [showPronunciation, setShowPronunciation] = useState(false);
  const [settings, setSettings] = useState<EpubReaderSettings>(
    getDefaultReaderSettings(),
  );
  const [webViewReady, setWebViewReady] = useState(false);

  // ── Shared reader typography ───────────────────────────
  // Line height, margin, alignment, paragraph spacing and typeface come
  // from the app-wide ReaderSettings, so a reader configures them once and
  // every format obeys. Font size and theme stay on the EPUB-specific
  // storage because epub.js owns them directly (see epubTypography.ts for
  // the point-to-percentage conversion that keeps the two consistent).
  const { settings: readerTypography } = useReaderSettings(colorScheme);

  const [dataReady, setDataReady] = useState(false);

  // ── Search ──────────────────────────────────────────────────────────
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [searchCurrent, setSearchCurrent] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Chapter to open if a citation's quote search finds nothing (W4). */
  const pendingChapterFallbackRef = useRef<number | null>(null);

  // ── Text selection toolbar ──────────────────────────────────────
  const [selectionVisible, setSelectionVisible] = useState(false);
  const [selectionText, setSelectionText] = useState("");
  const [selectionRect, setSelectionRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  // App settings (loaded once on init)
  const [readAloudEnabled, setReadAloudEnabled] = useState(true);
  const confirmBeforeClosingRef = useRef(false);
  const rememberLastPageRef = useRef(true);

  // Refs to survive across renders without triggering re-renders
  const normalizedUriRef = useRef<string | null>(null);
  const savedCfiRef = useRef<string | null>(null);
  const base64DataRef = useRef<string | null>(null);

  const readAloudFilePath = useMemo(() => {
    if (!dataReady) return null;

    const sourcePath = normalizedUriRef.current || uri || null;
    if (!sourcePath) return null;

    // react-native-fs expects an absolute local path, not a file:// URI.
    return decodeURIComponent(sourcePath.replace(/^file:\/\//, ""));
  }, [dataReady, uri]);

  // Auto-restore Read Aloud bar if the user had paused playback in a previous session
  useEffect(() => {
    if (!readAloudFilePath) return;
    readAloudPersistence.getState(readAloudFilePath).then((saved) => {
      if (saved?.status === "paused" && isMountedRef.current) {
        setShowReadAloud(true);
      }
    });
  }, [readAloudFilePath]);

  const epubReadAloud = useEpubReadAloud({
    filePath: readAloudFilePath,
    initialRate: 1.0,
    onChapterChange: (_chapterIndex, chapter) => {
      // When Read Aloud advances to a new chapter, navigate epub.js to it
      // The previous section's DOM is about to be replaced, so the
      // highlighter must forget its cached index and search position.
      webViewRef.current?.injectJavaScript("raResetHighlight();true;");
      if (webViewRef.current && chapter) {
        const href = toc.find((t) => t.label === chapter.title)?.href;
        if (href) {
          webViewRef.current.injectJavaScript(`goToHref("${href}");true;`);
        }
      }
    },
    onWordBoundary: (position, chunkText) => {
      // Already throttled by useReadAloud; this is one small injectJavaScript
      // per spoken word, which the bridge handles comfortably.
      webViewRef.current?.injectJavaScript(
        `raHighlightWord(${JSON.stringify(chunkText)},${position.chunkStart},${position.chunkEnd});true;`,
      );
    },
    onChunkChange: (chunk, totalChunks) => {
      if (!webViewRef.current || totalChunks <= 0) return;
      // Band the passage being read and bring it into view. Every engine gets
      // this; word-level highlighting refines it only on engines that report
      // word positions. The old version searched this page's own body, which
      // never holds book text (that lives in epub.js's iframes), so it always
      // fell through to the proportional jump — now only the fallback for a
      // passage whose section has not rendered yet.
      const fallbackPercent =
        totalChunks > 1
          ? Math.max(0, Math.min(100, (chunk.chunkIndex / (totalChunks - 1)) * 100))
          : 0;
      webViewRef.current.injectJavaScript(
        `(function(){` +
          `if(typeof raHighlightChunk==='function'&&raHighlightChunk(${JSON.stringify(chunk.text)}))return;` +
          `window.scrollTo({top:document.documentElement.scrollHeight*${fallbackPercent}/100,behavior:'smooth'});` +
          `})(); true;`,
      );
    },
  });

  // ── Push reader typography into the book ───────────────────
  // Rebuilt whenever a typography setting changes, and re-sent once the
  // WebView is ready. Building is async only because an embedded typeface
  // has to be read from the asset bundle and encoded; that result is cached,
  // so this costs nothing after the first time a face is used.
  useEffect(() => {
    if (!webViewReady) return;
    let cancelled = false;

    buildEpubTypographyCss(readerTypography)
      .then((css) => {
        if (cancelled) return;
        webViewRef.current?.injectJavaScript(
          `applyTypography(${JSON.stringify(css)});true;`,
        );
      })
      .catch(() => {
        // A typeface that will not load leaves the book at its own styling,
        // which is a downgrade rather than a failure.
      });

    return () => {
      cancelled = true;
    };
  }, [
    webViewReady,
    readerTypography.fontFamily,
    readerTypography.lineHeight,
    readerTypography.margin,
    readerTypography.textAlign,
    readerTypography.paragraphSpacing,
  ]);

  useEffect(() => {
    if (!__DEV__) return;
    console.log("[EpubViewer][ReadAloud] State", {
      filePath: readAloudFilePath,
      loadStatus: epubReadAloud.loadStatus,
      chapters: epubReadAloud.book?.chapters.length ?? 0,
      chunks: epubReadAloud.chunks.length,
    });
  }, [
    readAloudFilePath,
    epubReadAloud.loadStatus,
    epubReadAloud.book,
    epubReadAloud.chunks.length,
  ]);

  useEffect(() => {
    if (!showReadAloud || epubReadAloud.loadStatus !== "error") return;

    const message =
      epubReadAloud.errorMessage ||
      "This document doesn't have extractable text. Read Aloud can't be used.";

    Alert.alert("Read Aloud Unavailable", message, [
      {
        text: "OK",
        onPress: () => setShowReadAloud(false),
      },
    ]);
  }, [showReadAloud, epubReadAloud.loadStatus, epubReadAloud.errorMessage]);

  useEffect(() => {
    if (!showReadAloud) return;
    if (epubReadAloud.loadStatus !== "ready") return;
    if (epubReadAloud.chunks.length === 0) return;

    const { status, play } = epubReadAloud.controls;
    if (status === "idle" || status === "finished") {
      play(0);
    }
    // If status is "paused" (restored from persistence), show the bar but
    // do NOT auto-play — the user will explicitly press Play to resume.
  }, [
    showReadAloud,
    epubReadAloud.loadStatus,
    epubReadAloud.chunks.length,
    epubReadAloud.controls,
  ]);

  // Pause (not stop) when the Read Aloud bar is closed, so persisted state
  // is preserved for next time the document is opened.
  useEffect(() => {
    if (!showReadAloud && epubReadAloud.controls.status === "speaking") {
      epubReadAloud.controls.pause();
    }
    if (!showReadAloud) {
      // Never leave a word marked on the page after the bar is dismissed.
      webViewRef.current?.injectJavaScript("raClearHighlight();true;");
    }
  }, [showReadAloud]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Load on mount ----
  useEffect(() => {
    if (!uri) {
      setError("No EPUB file specified");
      setLoading(false);
      return;
    }
    initialise();
  }, [uri]);

  /** Prepare everything we need before the WebView can render. */
  const initialise = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load saved settings
      const savedSettings = await loadReaderSettings();
      if (!isMountedRef.current) return;
      setSettings(savedSettings);

      // Normalise URI (copy SAF content:// to cache if needed)
      const normalized = await normalizeEpubUri(uri!);
      normalizedUriRef.current = normalized;

      // Read the EPUB file as base64
      const base64 = await readEpubAsBase64(normalized);
      base64DataRef.current = base64;

      // Load app settings (readAloud toggle, rememberLastPage, confirmBeforeClosing)
      const appSettings = await loadSettings();
      rememberLastPageRef.current = appSettings.rememberLastPage;
      confirmBeforeClosingRef.current = appSettings.confirmBeforeClosing;
      setReadAloudEnabled(appSettings.readAloud);

      // Load any previously-saved reading progress
      const prog = await loadReadingProgress(uri!);
      if (prog?.cfi && appSettings.rememberLastPage) savedCfiRef.current = prog.cfi;
      // A saved page's CFI is an explicit destination the user just chose, so
      // it wins over both the remembered position and the rememberLastPage
      // setting (which is about resuming, not about honouring a direct tap).
      if (savedCfi) savedCfiRef.current = savedCfi;

      if (!isMountedRef.current) return;
      setDataReady(true);
      // Loading indicator will hide once epub.js sends the "ready" message.

      // Mark file as opened for recent files tracking
      if (uri && name) {
        markFileOpened(uri).catch((e) =>
          console.error("[EpubViewer] Failed to mark file as opened:", e),
        );
        // SECONDARY (additive): note this open for the Gozlin workspace's
        // context-awareness. Same uri key as the file index above.
        recordDocumentOpen({ uri, name, type: "epub" });
      }
    } catch (err) {
      console.error("[EpubViewer] Error initialising:", err);
      if (!isMountedRef.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load EPUB file. Please ensure it is a valid EPUB.",
      );
      setLoading(false);
    }
  };

  // ---- HTML template (epub.js + jszip bundled inline) ----
  const htmlContent = useMemo(() => {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <script>
    // Decode and execute bundled jszip
    (function(){var s=document.createElement('script');s.textContent=atob("${JSZIP_MIN_JS_B64}");document.head.appendChild(s);})();
  </script>
  <script>
    // Decode and execute bundled epub.js
    (function(){var s=document.createElement('script');s.textContent=atob("${EPUBJS_MIN_JS_B64}");document.head.appendChild(s);})();
  </script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{overflow:auto;background:#ffffff;-webkit-overflow-scrolling:touch}
    #area{width:100vw;min-height:100vh}
    .epub-container{background:#ffffff}
  </style>
</head>
<body>
  <div id="area"></div>
  <script>
    var book=null,rendition=null,currentCfi=null;
    var __RA_PAGINATED__ = ${EPUB_PAGINATED_MODE ? "true" : "false"};
    var __inscribedAnnotations=[];

    function sendMsg(type,data){
      window.ReactNativeWebView.postMessage(JSON.stringify({type:type,data:data||{}}));
    }

    function loadBook(base64Data,initialCfi,readerTheme,readerFontSize){
      try{
        book=ePub();
        book.open(base64Data,'base64').then(function(){
          var w=window.innerWidth;
          var h=window.innerHeight;
          rendition=book.renderTo("area",{
            width:w,
            flow:__RA_PAGINATED__?"paginated":"scrolled-doc",
            spread:"none",
            manager:__RA_PAGINATED__?"default":"continuous"
          });

          // epub.js builds a fresh document per section, so reader
          // typography has to be re-applied every time one renders —
          // this is what keeps it alive across chapter turns, theme
          // changes and font-size changes.
          rendition.on("rendered",function(){
            __raEachContents(__raApplyTypographyTo);
            // A section that has just appeared may hold the passage being read.
            __raReapply();
          });

          rendition.themes.register("light",{body:{background:"#ffffff",color:"#000000"}});
          rendition.themes.register("dark",{body:{background:"#1a1a1a",color:"#e0e0e0"}});
          rendition.themes.register("sepia",{body:{background:"#f5f1e8",color:"#5c4b37"}});
          var _t=readerTheme||'light';
          rendition.themes.select(_t);
          rendition.themes.fontSize((readerFontSize||100)+'%');
          document.body.style.background=_t==='dark'?'#1a1a1a':_t==='sepia'?'#f5f1e8':'#ffffff';

          // Resize handler
          window.addEventListener('resize',function(){
            if(rendition){
              rendition.resize(window.innerWidth);
            }
          });

          // Track scroll position for progress
          window.addEventListener('scroll',function(){
            var scrollTop=window.pageYOffset||document.documentElement.scrollTop;
            var docHeight=document.documentElement.scrollHeight-window.innerHeight;
            if(docHeight>0){
              var pct=Math.round(scrollTop/docHeight*100);
              sendMsg('location',{cfi:currentCfi||'',percentage:pct,chapter:0,total:0});
            }
          },{passive:true});

          // ── Text selection bridge for each rendered section ─────
          rendition.on('rendered',function(){
            setTimeout(function(){
              try{
                var contents=rendition.getContents();
                if(!contents||!contents.length) return;
                for(var ci=0;ci<contents.length;ci++){
                  var c=contents[ci];
                  var cdoc=c.document;
                  if(!cdoc||cdoc.__epubSelBridge) continue;
                  cdoc.__epubSelBridge=true;
                  (function(d){
                    var _last='';
                    function report(){
                      var sel=d.getSelection?d.getSelection():(d.defaultView?d.defaultView.getSelection():null);
                      if(!sel||sel.isCollapsed||!sel.toString().trim()){
                        if(_last){_last='';sendMsg('selection_clear',{});}
                        return;
                      }
                      var text=sel.toString().trim();
                      if(text===_last) return;
                      _last=text;
                      try{
                        var range=sel.getRangeAt(0);
                        var rect=range.getBoundingClientRect();
                        var iframe=d.defaultView?d.defaultView.frameElement:null;
                        var ox=0,oy=0;
                        if(iframe){var ir=iframe.getBoundingClientRect();ox=ir.left;oy=ir.top;}
                        sendMsg('selection',{
                          text:text,
                          rect:{x:rect.left+ox,y:rect.top+oy,width:rect.width,height:rect.height}
                        });
                      }catch(e){}
                    }
                    d.addEventListener('selectionchange',function(){setTimeout(report,120);});
                    d.addEventListener('touchend',function(){setTimeout(report,120);},{passive:true});
                    d.addEventListener('mouseup',function(){setTimeout(report,50);});
                    d.addEventListener('contextmenu',function(e){
                      var sel=d.getSelection?d.getSelection():(d.defaultView?d.defaultView.getSelection():null);
                      if(sel&&!sel.isCollapsed&&sel.toString().trim()) e.preventDefault();
                      setTimeout(report,100);
                    });
                    // Long-press polling fallback
                    var lpt,lpp,lpa=false;
                    d.addEventListener('touchstart',function(){
                      lpa=true;clearTimeout(lpt);clearInterval(lpp);
                      lpt=setTimeout(function(){
                        if(!lpa)return;report();
                        lpp=setInterval(function(){if(!lpa){clearInterval(lpp);return;}report();},80);
                      },350);
                    },{passive:true});
                    d.addEventListener('touchend',function(){lpa=false;clearTimeout(lpt);clearInterval(lpp);},{passive:true});
                    d.addEventListener('touchcancel',function(){lpa=false;clearTimeout(lpt);clearInterval(lpp);},{passive:true});
                  })(cdoc);
                }
              }catch(e){}
            },100);
          });

          // Highlight search matches in each chapter after it renders
          rendition.on('rendered',function(){
            if(!__srQuery) return;
            setTimeout(function(){
              try{
                var contents=rendition.getContents();
                if(!contents||!contents.length) return;
                var doc=contents[0].document;
                if(!doc||!doc.body) return;
                // Clear old search highlights
                var old=doc.querySelectorAll('[data-epub-sr]');
                for(var i=0;i<old.length;i++){
                  var el=old[i];var p=el.parentNode;
                  if(p){p.replaceChild(doc.createTextNode(el.textContent||''),el);p.normalize();}
                }
                // Walk text nodes and wrap matches
                var q=__srQuery;
                var walker=doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT,null,false);
                var nodes=[];var n;
                while((n=walker.nextNode())) nodes.push(n);
                var isFirst=true;
                nodes.forEach(function(nd){
                  var text=nd.nodeValue||'';var lower=text.toLowerCase();var idx=lower.indexOf(q);
                  if(idx===-1||!nd.parentNode) return;
                  var frag=doc.createDocumentFragment();var last=0;
                  while(idx!==-1){
                    if(idx>last) frag.appendChild(doc.createTextNode(text.substring(last,idx)));
                    var sp=doc.createElement('span');
                    sp.setAttribute('data-epub-sr','1');
                    sp.style.backgroundColor=isFirst?'#FF6F00':'#FFEB3B';
                    sp.style.color=isFirst?'#fff':'#000';
                    sp.style.borderRadius='2px';
                    sp.style.padding='0 1px';
                    sp.textContent=text.substring(idx,idx+q.length);
                    frag.appendChild(sp);isFirst=false;
                    last=idx+q.length;idx=lower.indexOf(q,last);
                  }
                  if(last<text.length) frag.appendChild(doc.createTextNode(text.substring(last)));
                  nd.parentNode.replaceChild(frag,nd);
                });
                // Scroll to first highlight
                var first=doc.querySelector('[data-epub-sr]');
                if(first) first.scrollIntoView({behavior:'smooth',block:'center'});
              }catch(e){}
            },150);
          });

          // ── Reapply persisted annotations on each render ──────
          rendition.on('rendered',function(){
            if(!__inscribedAnnotations||!__inscribedAnnotations.length) return;
            setTimeout(function(){
              try{
                var contents=rendition.getContents();
                if(!contents||!contents.length) return;
                for(var ci=0;ci<contents.length;ci++){
                  var d=contents[ci].document;
                  if(!d||!d.body||d.__inscribedAnnotated) continue;
                  d.__inscribedAnnotated=true;
                  for(var ai=0;ai<__inscribedAnnotations.length;ai++){
                    var ann=__inscribedAnnotations[ai];
                    var q=ann.text;if(!q) continue;
                    var walker=d.createTreeWalker(d.body,NodeFilter.SHOW_TEXT,null,false);
                    var nd;
                    while((nd=walker.nextNode())){
                      var txt=nd.nodeValue||'';
                      var idx=txt.indexOf(q);
                      if(idx===-1||!nd.parentNode) continue;
                      try{
                        var r=d.createRange();
                        r.setStart(nd,idx);
                        r.setEnd(nd,Math.min(idx+q.length,txt.length));
                        var sp=d.createElement('span');
                        var frag=r.extractContents();
                        sp.appendChild(frag);
                        if(ann.kind==='highlight'){
                          sp.style.backgroundColor=ann.color||'rgba(255,235,59,0.4)';
                          sp.style.borderRadius='2px';sp.style.padding='0 1px';
                          sp.className='inscribed-hl';
                          sp.setAttribute('data-hl-id',ann.id);
                        }else if(ann.kind==='underline'){
                          sp.style.textDecoration='underline';
                          sp.style.textDecorationColor='#1976D2';
                          sp.style.textDecorationThickness='2px';
                          sp.style.textUnderlineOffset='3px';
                          sp.className='inscribed-ul';
                          sp.setAttribute('data-ul-id',ann.id);
                        }else if(ann.kind==='strikethrough'){
                          sp.style.textDecoration='line-through';
                          sp.style.textDecorationColor='#E53935';
                          sp.style.textDecorationThickness='2px';
                          sp.className='inscribed-st';
                          sp.setAttribute('data-st-id',ann.id);
                        }
                        r.insertNode(sp);
                      }catch(e){}
                      break;
                    }
                  }
                }
              }catch(e){}
            },200);
          });

          // Track location changes
          rendition.on('relocated',function(location){
            if(!location||!location.start) return;
            currentCfi=location.start.cfi;
            var pct=0;
            try{pct=Math.round(book.locations?book.locations.percentageFromCfi(currentCfi)*100:location.start.percentage*100);}catch(e){pct=0;}
            sendMsg('location',{
              cfi:currentCfi,
              percentage:pct||0,
              chapter:location.start.displayed?location.start.displayed.page:0,
              total:location.start.displayed?location.start.displayed.total:0
            });
          });

          if(initialCfi){
            return rendition.display(initialCfi);
          }
          return rendition.display();
        }).then(function(){
          var meta=book.packaging?book.packaging.metadata:{};
          sendMsg('ready',{title:meta.title||'',author:meta.creator||''});
          if(book.navigation&&book.navigation.toc){
            sendMsg('toc',{toc:book.navigation.toc.map(function(t){return {label:t.label,href:t.href};})});
          }
        }).catch(function(e){
          sendMsg('error',{message:e.message||'Failed to load book'});
        });
      }catch(e){
        sendMsg('error',{message:e.message||'Unknown error'});
      }
    }

    // Saved Pages (R1): report the text of the section currently on screen.
    // A SEPARATE message type from 'location' on purpose — that one fires on
    // every scroll and drives reading progress; overloading it would couple
    // an occasional one-shot capture to a high-frequency channel.
    //
    // What comes back is the BOOKMARKED PAGE, not a preview of it: blocks are
    // joined with a BLANK LINE, because paragraph structure is what makes it
    // read as a page on /saved-page, and the cap is SNAPSHOT_MAX rather than
    // an excerpt-sized 1200.
    function captureVisibleText(){
      try{
        var LIMIT=${SNAPSHOT_MAX};
        var contents=rendition?rendition.getContents():null;
        if(!contents||!contents.length){sendMsg('visible-text',{text:''});return;}
        var parts=[];
        var size=0;
        for(var ci=0;ci<contents.length;ci++){
          var d=contents[ci].document;
          if(!d||!d.body)continue;
          var view=d.defaultView;
          var vh=(view&&view.innerHeight)||0;
          var nodes=d.body.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,blockquote');
          for(var i=0;i<nodes.length;i++){
            var r=nodes[i].getBoundingClientRect();
            // In scrolled-doc mode every section is laid out; keep only what
            // is inside the viewport. vh of 0 (paginated) keeps everything.
            if(vh===0||(r.bottom>0&&r.top<vh&&r.height>0)){
              // Horizontal whitespace only — blank lines are the structure.
              var t=(nodes[i].textContent||'').replace(/[ \\t\\u00a0]+/g,' ').trim();
              if(t){parts.push(t);size+=t.length+2;}
            }
            if(size>LIMIT)break;
          }
          if(size>LIMIT)break;
        }
        sendMsg('visible-text',{text:parts.join('\\n\\n').slice(0,LIMIT)});
      }catch(e){sendMsg('visible-text',{text:''});}
    }

    // The same region as MARKUP — the reflow answer to a picture of the page.
    // An EPUB section cannot be rasterised here, but its own markup re-renders
    // on /saved-page with the fonts, tables and lists that text loses.
    // Capture and sanitiser come from utils/pageHtmlCapture.ts, shared with the
    // DOCX reader so the two paths cannot drift apart.
    ${PAGE_HTML_CAPTURE_JS}
    function captureVisibleHtml(){
      try{
        var contents=rendition?rendition.getContents():null;
        if(!contents||!contents.length){sendMsg('visible-html',{html:'',css:''});return;}
        var htmlParts=[];
        var css='';
        for(var ci=0;ci<contents.length;ci++){
          var d=contents[ci].document;
          if(!d||!d.body)continue;
          var view=d.defaultView;
          var vh=(view&&view.innerHeight)||0;
          var res=__inscribedCaptureVisibleHtml(d,d.body,vh);
          if(res.html)htmlParts.push(res.html);
          if(!css&&res.css)css=res.css;
        }
        sendMsg('visible-html',{html:htmlParts.join(''),css:css});
      }catch(e){sendMsg('visible-html',{html:'',css:''});}
    }

    function goToCfi(cfi){if(rendition)rendition.display(cfi);}
    function goToHref(href){if(rendition)rendition.display(href);}
    function changeTheme(t){if(rendition)rendition.themes.select(t);document.body.style.background=t==='dark'?'#1a1a1a':t==='sepia'?'#f5f1e8':'#ffffff';}
    function changeFontSize(s){if(rendition)rendition.themes.fontSize(s+"%");}
    function setAnnotations(anns){__inscribedAnnotations=anns||[];}

    // ── Reader typography ──────────────────────────────
    // One replaceable <style> per section document. epub.js ships an
    // addStylesheetRules() helper, but its own id lookup never matches, so it
    // appends a new <style> on every call and leaks one per settings change.
    var __typographyCSS = '';

    function __raApplyTypographyTo(c){
      if(!c||!c.document)return;
      var d=c.document;
      var el=d.getElementById('inscribed-typography');
      if(!el){
        el=d.createElement('style');
        el.id='inscribed-typography';
        (d.head||d.documentElement).appendChild(el);
      }
      el.textContent=__typographyCSS;
    }

    function applyTypography(css){
      __typographyCSS=css||'';
      __raEachContents(__raApplyTypographyTo);
    }

    // The Read Aloud highlighter factory, defined in this page. See the bridge
    // below for why it cannot live inside the book's own iframes.
    ${READ_ALOUD_HIGHLIGHTER_SOURCE}
    // ── Read Aloud word highlighting ───────────────────────
    // epub.js puts each section in an iframe sandboxed with only
    // "allow-same-origin" (allowScriptedContent defaults to false), so no
    // script can run inside a book's pages; installing the highlighter there
    // silently did nothing. It runs out here instead and reaches into each
    // section's document through the same-origin DOM, one instance per
    // epub.js Contents. Sections are rebuilt as the reader moves, and a
    // rebuilt section is a new Contents with a fresh highlighter.
    function __raEachContents(fn){
      if(!rendition||!rendition.getContents)return;
      var cs=rendition.getContents();
      if(!cs)return;
      if(!cs.length&&cs.document)cs=[cs];
      for(var i=0;i<cs.length;i++){try{fn(cs[i]);}catch(e){}}
    }

    // The last highlight asked for, so a section that renders afterwards (a
    // chapter turn, a relocation) is highlighted as soon as it exists.
    var __raLast=null;

    function __raFor(c){
      if(!c||!c.document||typeof window.__raCreateHighlighter!=='function')return null;
      if(!c.__raHl||c.__raHlDoc!==c.document){
        c.__raHl=window.__raCreateHighlighter(c.document);
        c.__raHlDoc=c.document;
      }
      return c.__raHl;
    }

    // Run against every rendered section until one holds the text, clearing
    // the rest so an old highlight never lingers in a neighbouring section.
    function __raApply(run){
      var found=false;
      __raEachContents(function(c){
        var hl=__raFor(c);
        if(!hl)return;
        if(!found&&run(hl))found=true;
        else hl.clear();
      });
      return found;
    }

    function raHighlightWord(text,start,end){
      __raLast={text:text,start:start,end:end};
      return __raApply(function(hl){return hl.show(text,start,end);});
    }

    function raHighlightChunk(text){
      __raLast={text:text,start:-1,end:-1};
      return __raApply(function(hl){return hl.showChunk(text);});
    }

    function raClearHighlight(){
      __raLast=null;
      __raEachContents(function(c){if(c.__raHl)c.__raHl.clear();});
    }

    function raResetHighlight(){
      __raLast=null;
      __raEachContents(function(c){if(c.__raHl)c.__raHl.reset();});
    }

    function __raReapply(){
      var last=__raLast;
      if(!last)return;
      if(last.start<0)raHighlightChunk(last.text);
      else raHighlightWord(last.text,last.start,last.end);
    }

    // Poll for ReactNativeWebView bridge before signaling ready
    (function waitForBridge(){
      if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){
        sendMsg('webview-ready');
      }else{
        setTimeout(waitForBridge,50);
      }
    })();

    // ── Full-text search across all spine sections ─────────────────
    var __srResults=[];var __srIndex=0;var __srQuery='';

    function epubSearch(query){
      __srQuery=query?query.toLowerCase():'';
      __srResults=[];__srIndex=0;
      if(!__srQuery||!book){sendMsg('search-result',{count:0,current:0});return;}
      var sections=[];book.spine.each(function(s){sections.push(s);});
      var pending=sections.length;
      if(pending===0){sendMsg('search-result',{count:0,current:0});return;}
      sections.forEach(function(section,idx){
        section.load(book.load.bind(book)).then(function(doc){
          var text='';
          try{text=(doc.documentElement||doc.body||{}).textContent||'';}catch(e){}
          if(text.toLowerCase().indexOf(__srQuery)!==-1){
            __srResults.push({href:section.href,index:idx});
          }
          pending--;
          if(pending===0){
            __srResults.sort(function(a,b){return a.index-b.index;});
            if(__srResults.length>0){rendition.display(__srResults[0].href);}
            sendMsg('search-result',{count:__srResults.length,current:__srResults.length>0?1:0});
          }
        }).catch(function(){
          pending--;
          if(pending===0){
            __srResults.sort(function(a,b){return a.index-b.index;});
            if(__srResults.length>0){rendition.display(__srResults[0].href);}
            sendMsg('search-result',{count:__srResults.length,current:__srResults.length>0?1:0});
          }
        });
      });
    }
    function epubSearchNext(){
      if(__srResults.length===0)return;
      __srIndex=(__srIndex+1)%__srResults.length;
      rendition.display(__srResults[__srIndex].href);
      sendMsg('search-result',{count:__srResults.length,current:__srIndex+1});
    }
    function epubSearchPrev(){
      if(__srResults.length===0)return;
      __srIndex=(__srIndex-1+__srResults.length)%__srResults.length;
      rendition.display(__srResults[__srIndex].href);
      sendMsg('search-result',{count:__srResults.length,current:__srIndex+1});
    }
    function epubClearSearch(){
      __srResults=[];__srIndex=0;__srQuery='';
      // Clear highlights in the currently displayed chapter
      try{
        var contents=rendition.getContents();
        if(contents&&contents.length){
          var doc=contents[0].document;
          if(doc&&doc.body){
            var old=doc.querySelectorAll('[data-epub-sr]');
            for(var i=0;i<old.length;i++){
              var el=old[i];var p=el.parentNode;
              if(p){p.replaceChild(doc.createTextNode(el.textContent||''),el);p.normalize();}
            }
          }
        }
      }catch(e){}
      sendMsg('search-result',{count:0,current:0});
    }

    // Global error handler for debugging
    window.onerror=function(msg){
      try{sendMsg('error',{message:'JS: '+msg});}catch(e){}
    };
  </script>
</body>
</html>`;
  }, []);

  // ---- Inject the base64 data once BOTH WebView and data are ready ----
  useEffect(() => {
    if (
      webViewReady &&
      dataReady &&
      base64DataRef.current &&
      webViewRef.current
    ) {
      const cfiArg = savedCfiRef.current
        ? `,"${savedCfiRef.current}"`
        : ",null";

      // Apply reader settings and load the book
      const thm = settings.theme;
      const fs = settings.fontSize;
      webViewRef.current.injectJavaScript(
        `loadBook("${base64DataRef.current}"${cfiArg},"${thm}",${fs});true;`,
      );
    }
  }, [webViewReady, dataReady]);

  // ---- WebView message handler ----
  const handleMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);

        switch (msg.type) {
          case "webview-ready":
            setWebViewReady(true);
            break;

          case "ready":
            setLoading(false);
            setBookInfo((msg as WVReadyMsg).data);
            // Load and inject saved annotations
            if (uri) {
              Promise.all([getHighlights(uri), getUnderlines(uri), getStrikethroughs(uri)])
                .then(([hl, ul, st]) => {
                  const annotations = [
                    ...hl.map((h) => ({ id: h.id, text: h.text, kind: "highlight", color: h.color })),
                    ...ul.map((u) => ({ id: u.id, text: u.text, kind: "underline" })),
                    ...st.map((s) => ({ id: s.id, text: s.text, kind: "strikethrough" })),
                  ];
                  if (annotations.length) {
                    webViewRef.current?.injectJavaScript(
                      `setAnnotations(${JSON.stringify(annotations)}); true;`,
                    );
                  }
                })
                .catch(() => {});
            }
            break;

          case "error":
            setLoading(false);
            setError((msg as WVErrorMsg).data.message);
            break;

          // Bookmarks: the on-screen page, as markup and as text.
          case "visible-html": {
            const waiters = visibleHtmlWaitersRef.current;
            visibleHtmlWaitersRef.current = [];
            const payload = msg.data as
              | { html?: string; css?: string }
              | undefined;
            for (const resolve of waiters) {
              resolve({ html: payload?.html ?? "", css: payload?.css ?? "" });
            }
            break;
          }
          case "visible-text": {
            const waiters = visibleTextWaitersRef.current;
            visibleTextWaitersRef.current = [];
            const text = typeof msg.data?.text === "string" ? msg.data.text : "";
            for (const resolve of waiters) resolve(text);
            break;
          }

          case "location": {
            const loc = (msg as WVLocationMsg).data;
            // A relocation is reading activity (R2's guard).
            noteActivityRef.current?.();
            currentCfiRef.current = loc.cfi || null;
            setProgress(loc.percentage);
            // Persist progress
            if (uri) {
              saveReadingProgress(uri, {
                cfi: loc.cfi,
                percentage: loc.percentage,
                lastRead: Date.now(),
              }).catch(console.error);
              setReadingProgress(uri, (loc.percentage || 0) / 100, {
                source: "epub",
              }).catch(() => {});
            }
            break;
          }

          case "toc":
            setToc((msg as WVTocMsg).data.toc);
            break;

          // informational – no action needed
          case "end-of-book":
          case "start-of-book":
            break;

          case "search-result": {
            const sr = (msg as WVSearchMsg).data;
            setSearchMatchCount(sr.count);
            setSearchCurrent(sr.current);
            setSearchLoading(false);
            const fallbackChapter = pendingChapterFallbackRef.current;
            if (fallbackChapter !== null) {
              pendingChapterFallbackRef.current = null;
              if (sr.count === 0) {
                webViewRef.current?.injectJavaScript(epubShowChapterScript(fallbackChapter));
              }
            }
            break;
          }

          // ── Text selection from epub.js iframe ──────────────────
          case "selection": {
            const sel = msg.data || msg;
            if (sel.text) {
              setSelectionVisible(true);
              setSelectionText(sel.text);
              setSelectionRect(sel.rect ?? null);
            }
            break;
          }
          case "selection_clear":
            setSelectionVisible(false);
            setSelectionText("");
            setSelectionRect(null);
            break;
        }
      } catch {
        // ignore
      }
    },
    [uri],
  );

  // ---- Actions ----
  const handleClose = useCallback(() => {
    if (confirmBeforeClosingRef.current) {
      Alert.alert(
        "Close Document",
        "Are you sure you want to close this document?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Close", style: "destructive", onPress: () => router.back() },
        ],
      );
    } else {
      router.back();
    }
  }, []);

  const handleOpenWithSystem = useCallback(async () => {
    if (!uri) return;
    const result = await openWithSystemApp({
      uri,
      displayName,
      mimeType: "application/epub+zip",
    });
    if (!result.success) showOpenFailedAlert(displayName, result.error);
  }, [uri, displayName]);

  // ── Saved Pages (R1) + reading sessions (R2) ─────────────────────
  /**
   * The WHOLE text of the current position: the visible text from the epub.js
   * rendition, over its own `visible-text` message. This is the page the
   * bookmark keeps — useSavePage stores it as the snapshot and takes the list
   * excerpt from its first EXCERPT_MAX characters.
   *
   * Resolves "" rather than hanging, and never blocks the save.
   */
  const captureEpubPageText = useCallback((): Promise<string> => {
    const webView = webViewRef.current;
    if (!webView) return Promise.resolve("");
    return new Promise<string>((resolve) => {
      // Only HORIZONTAL whitespace is collapsed — the blank lines between
      // blocks are the page's paragraph structure.
      const done = (text: string) =>
        resolve(
          (text || "")
            .replace(/[ \t\u00a0]+/g, " ")
            .trim()
            .slice(0, SNAPSHOT_MAX),
        );
      const timer = setTimeout(() => {
        visibleTextWaitersRef.current = visibleTextWaitersRef.current.filter(
          (w) => w !== wrapped,
        );
        resolve("");
      }, 4000);
      const wrapped = (text: string) => {
        clearTimeout(timer);
        done(text);
      };
      visibleTextWaitersRef.current.push(wrapped);
      webView.injectJavaScript("captureVisibleText();true;");
    });
  }, []);

  /** The chapter label for the current position, when the TOC offers one. */
  const chapterLabel = useMemo(() => {
    if (toc.length === 0) return undefined;
    const index = Math.min(
      toc.length - 1,
      Math.max(0, Math.round((progress / 100) * (toc.length - 1))),
    );
    return toc[index]?.label?.trim() || undefined;
  }, [toc, progress]);

  /**
   * The MARKUP of the current position, over its own `visible-html` message.
   * Resolves empty rather than hanging, and never blocks the save.
   */
  const captureEpubPageHtml = useCallback((): Promise<{
    html: string;
    css: string;
  }> => {
    const webView = webViewRef.current;
    if (!webView) return Promise.resolve({ html: "", css: "" });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        visibleHtmlWaitersRef.current = visibleHtmlWaitersRef.current.filter(
          (w) => w !== wrapped,
        );
        resolve({ html: "", css: "" });
      }, 4000);
      const wrapped = (result: { html: string; css: string }) => {
        clearTimeout(timer);
        resolve(result);
      };
      visibleHtmlWaitersRef.current.push(wrapped);
      webView.injectJavaScript("captureVisibleHtml();true;");
    });
  }, []);

  /**
   * Keep Screen Awake — holds a wake lock while this viewer is mounted, so the
   * screen never dims mid-page. Released automatically on unmount.
   */
  const keepAwake = useKeepScreenAwake();

  const savePageState = useSavePage({
    uri,
    name: displayName,
    location: {
      locatorType: "chapter",
      cfi: currentCfiRef.current ?? undefined,
      chapterLabel,
    },
    capturePageText: captureEpubPageText,
    capturePageHtml: captureEpubPageHtml,
  });

  const [bookmarkToast, setBookmarkToast] = useState<{
    message: string;
    ok: boolean;
  } | null>(null);
  const bookmarkToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showBookmarkToast = useCallback((message: string, ok: boolean) => {
    setBookmarkToast({ message, ok });
    if (bookmarkToastTimer.current) clearTimeout(bookmarkToastTimer.current);
    bookmarkToastTimer.current = setTimeout(() => setBookmarkToast(null), 2400);
  }, []);
  useEffect(
    () => () => {
      if (bookmarkToastTimer.current) clearTimeout(bookmarkToastTimer.current);
    },
    [],
  );

  /** Bookmark or un-bookmark the current place, and confirm it on screen. */
  const handleSavePageToggle = useCallback(
    async (seedExcerpt?: string) => {
      const wasSaved = savePageState.isSaved;
      const result = await savePageState.toggle(seedExcerpt);
      if (wasSaved) {
        showBookmarkToast("Bookmark removed", true);
        return;
      }
      if ("ok" in result && result.ok) {
        showBookmarkToast(
          chapterLabel ? `${chapterLabel} bookmarked` : "Page bookmarked",
          true,
        );
        return;
      }
      showBookmarkToast(
        "message" in result ? result.message : "Could not bookmark this page.",
        false,
      );
    },
    [savePageState, chapterLabel, showBookmarkToast],
  );

  const { noteActivity } = useReadingSession({
    uri,
    name: displayName,
    isSpeaking: showReadAloud,
    pageLabel: chapterLabel,
    enabled: !loading && !error,
  });
  noteActivityRef.current = noteActivity;

  // ── Citation navigation (W4) ─────────────────────────────────────
  // The book's full-text search finds the cited words and shows the match;
  // if nothing matches, the cited chapter opens instead.
  const goToEpubCitation = useCallback((chapterIndex: number, quoteText: string) => {
    const chapter = Math.floor(chapterIndex);
    const run = pickSearchRun(quoteText || "", 4, 7);
    if (run) {
      pendingChapterFallbackRef.current = chapter > 0 ? chapter : null;
      setShowSearch(true);
      setSearchQuery(run);
      setSearchLoading(true);
      webViewRef.current?.injectJavaScript(`epubSearch(${JSON.stringify(run)});true;`);
      return true;
    }
    if (chapter > 0) {
      webViewRef.current?.injectJavaScript(epubShowChapterScript(chapter));
      return true;
    }
    return false;
  }, []);

  const locatorTarget = useMemo(
    () => parseLocatorParams({ locatorType, locatorIndex, quote }),
    [locatorType, locatorIndex, quote],
  );
  const locatorAppliedRef = useRef(false);
  const [sourceCard, setSourceCard] = useState<{ label: string; quote: string } | null>(null);
  const closeSourceCard = useCallback(() => setSourceCard(null), []);
  useEffect(() => {
    if (!locatorTarget || locatorAppliedRef.current || loading || !webViewReady) return;
    locatorAppliedRef.current = true;
    setSourceCard({
      label: locatorLabel(locatorTarget.locatorType, locatorTarget.index),
      quote: locatorTarget.quote,
    });
    setTimeout(() => {
      if (isMountedRef.current) {
        goToEpubCitation(
          locatorTarget.locatorType === "chapter" ? locatorTarget.index : 0,
          locatorTarget.quote,
        );
      }
    }, 600);
  }, [locatorTarget, loading, webViewReady, goToEpubCitation]);

  // ── In-reader Gozlin panel (AI_READER_PANEL, W7) ─────────────────
  const aiPanelRef = useRef<ReaderAIPanelHandle>(null);
  const panelDocument = useMemo(() => {
    const docUri = dataReady ? normalizedUriRef.current || uri : uri;
    return docUri
      ? { uri: docUri, name: name || "document.epub", mimeType: "application/epub+zip" }
      : null;
  }, [uri, name, dataReady]);
  const handlePanelCitation = useCallback(
    (citation: AICitation) =>
      goToEpubCitation(
        citation.locator?.type === "chapter" ? citation.locator.index : 0,
        citation.quote,
      ),
    [goToEpubCitation],
  );
  const openChatWithDocumentScreen = useCallback(() => {
    const docUri = normalizedUriRef.current || uri;
    if (!docUri) return;
    router.push({
      pathname: "/chat-with-document",
      params: {
        uri: docUri,
        name: name || "document.epub",
        mimeType: "application/epub+zip",
      },
    });
  }, [uri, name]);
  const handleChatWithDocument = useCallback(() => {
    if (AI_READER_PANEL) {
      aiPanelRef.current?.open({ state: "expanded" });
      return;
    }
    openChatWithDocumentScreen();
  }, [openChatWithDocumentScreen]);

  const handleTocSelect = useCallback((href: string) => {
    webViewRef.current?.injectJavaScript(`goToHref("${href}");true;`);
    setShowToc(false);
  }, []);

  const updateTheme = useCallback(
    (newTheme: EpubReaderSettings["theme"]) => {
      const updated = { ...settings, theme: newTheme };
      setSettings(updated);
      saveReaderSettings(updated).catch(console.error);
      webViewRef.current?.injectJavaScript(`changeTheme("${newTheme}");true;`);
    },
    [settings],
  );

  const updateFontSize = useCallback(
    (delta: number) => {
      const newSize = Math.max(60, Math.min(200, settings.fontSize + delta));
      const updated = { ...settings, fontSize: newSize };
      setSettings(updated);
      saveReaderSettings(updated).catch(console.error);
      webViewRef.current?.injectJavaScript(`changeFontSize(${newSize});true;`);
    },
    [settings],
  );

  // ── Search handlers ──────────────────────────────────────────────
  const handleOpenSearch = useCallback(() => {
    setShowSearch(true);
    setSearchQuery("");
    setSearchMatchCount(0);
    setSearchCurrent(0);
    setSearchLoading(false);
  }, []);

  const handleSearchQuery = useCallback((text: string) => {
    setSearchQuery(text);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!text.trim()) {
      setSearchMatchCount(0);
      setSearchCurrent(0);
      setSearchLoading(false);
      webViewRef.current?.injectJavaScript(`epubClearSearch();true;`);
      return;
    }
    searchDebounceRef.current = setTimeout(() => {
      setSearchLoading(true);
      webViewRef.current?.injectJavaScript(
        `epubSearch(${JSON.stringify(text)});true;`,
      );
    }, 400);
  }, []);

  const handleSearchNext = useCallback(() => {
    webViewRef.current?.injectJavaScript(`epubSearchNext();true;`);
  }, []);

  const handleSearchPrev = useCallback(() => {
    webViewRef.current?.injectJavaScript(`epubSearchPrev();true;`);
  }, []);

  const handleCloseSearch = useCallback(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    setShowSearch(false);
    setSearchQuery("");
    setSearchMatchCount(0);
    setSearchCurrent(0);
    setSearchLoading(false);
    webViewRef.current?.injectJavaScript(`epubClearSearch();true;`);
  }, []);

  // ── Selection toolbar handlers ────────────────────────────────────
  const handleSelectionHighlight = useCallback(
    (colorHex: string) => {
      if (!selectionText || !uri) return;
      const id = `hl_${Date.now()}`;
      const safeColor = JSON.stringify(colorHex);
      const safeId = JSON.stringify(id);
      webViewRef.current?.injectJavaScript(`
        (function(){
          try{
            var contents=rendition.getContents();
            if(!contents||!contents.length) return;
            for(var i=0;i<contents.length;i++){
              var d=contents[i].document;
              var sel=d.getSelection?d.getSelection():(d.defaultView?d.defaultView.getSelection():null);
              if(sel&&!sel.isCollapsed&&sel.toString().trim()){
                var range=sel.getRangeAt(0);
                var span=d.createElement('span');
                try{
                  var frag=range.extractContents();
                  span.appendChild(frag);
                  span.style.backgroundColor=${safeColor};
                  span.style.borderRadius='2px';
                  span.style.padding='0 1px';
                  span.className='inscribed-hl';
                  span.setAttribute('data-hl-id',${safeId});
                  range.insertNode(span);
                }catch(e){}
                sel.removeAllRanges();
                break;
              }
            }
          }catch(e){}
        })();true;
      `);
      saveHighlight({
        id,
        fileUri: uri,
        startOffset: 0,
        endOffset: 0,
        text: selectionText,
        color: colorHex,
        createdAt: Date.now(),
      });
    },
    [selectionText, uri],
  );

  const handleSelectionUnderline = useCallback(() => {
    if (!selectionText || !uri) return;
    const id = `ul_${Date.now()}`;
    const safeId = JSON.stringify(id);
    webViewRef.current?.injectJavaScript(`
      (function(){
        try{
          var contents=rendition.getContents();
          if(!contents||!contents.length) return;
          for(var i=0;i<contents.length;i++){
            var d=contents[i].document;
            var sel=d.getSelection?d.getSelection():(d.defaultView?d.defaultView.getSelection():null);
            if(sel&&!sel.isCollapsed&&sel.toString().trim()){
              var range=sel.getRangeAt(0);
              var span=d.createElement('span');
              try{
                var frag=range.extractContents();
                span.appendChild(frag);
                span.style.textDecoration='underline';
                span.style.textDecorationColor='#1976D2';
                span.style.textDecorationThickness='2px';
                span.style.textUnderlineOffset='3px';
                span.className='inscribed-ul';
                span.setAttribute('data-ul-id',${safeId});
                range.insertNode(span);
              }catch(e){}
              sel.removeAllRanges();
              break;
            }
          }
        }catch(e){}
      })();true;
    `);
    saveUnderline({
      id,
      fileUri: uri,
      startOffset: 0,
      endOffset: 0,
      text: selectionText,
      createdAt: Date.now(),
    });
  }, [selectionText, uri]);

  const handleSelectionStrikethrough = useCallback(() => {
    if (!selectionText || !uri) return;
    const id = `st_${Date.now()}`;
    const safeId = JSON.stringify(id);
    webViewRef.current?.injectJavaScript(`
      (function(){
        try{
          var contents=rendition.getContents();
          if(!contents||!contents.length) return;
          for(var i=0;i<contents.length;i++){
            var d=contents[i].document;
            var sel=d.getSelection?d.getSelection():(d.defaultView?d.defaultView.getSelection():null);
            if(sel&&!sel.isCollapsed&&sel.toString().trim()){
              var range=sel.getRangeAt(0);
              var span=d.createElement('span');
              try{
                var frag=range.extractContents();
                span.appendChild(frag);
                span.style.textDecoration='line-through';
                span.style.textDecorationColor='#E53935';
                span.style.textDecorationThickness='2px';
                span.className='inscribed-st';
                span.setAttribute('data-st-id',${safeId});
                range.insertNode(span);
              }catch(e){}
              sel.removeAllRanges();
              break;
            }
          }
        }catch(e){}
      })();true;
    `);
    saveStrikethrough({
      id,
      fileUri: uri,
      startOffset: 0,
      endOffset: 0,
      text: selectionText,
      createdAt: Date.now(),
    });
  }, [selectionText, uri]);

  const handleSelectionCopy = useCallback(() => {
    if (!selectionText) return;
    import("react-native").then(({ Clipboard }) => {
      // Clipboard is deprecated; use @react-native-clipboard if available
    }).catch(() => {});
    // Use the WebView's execCommand to copy
    webViewRef.current?.injectJavaScript(`
      (function(){
        try{
          var contents=rendition.getContents();
          if(!contents||!contents.length) return;
          for(var i=0;i<contents.length;i++){
            var d=contents[i].document;
            d.execCommand('copy');
          }
        }catch(e){}
      })();true;
    `);
  }, [selectionText]);

  const handleSelectionSearch = useCallback(() => {
    if (!selectionText) return;
    if (AI_READER_PANEL) {
      aiPanelRef.current?.open({ selection: selectionText });
      setSelectionVisible(false);
      return;
    }
    router.push({ pathname: "/gozlin", params: { prompt: selectionText } });
    setSelectionVisible(false);
  }, [selectionText]);

  const handleSelectionDismiss = useCallback(() => {
    setSelectionVisible(false);
    setSelectionText("");
    setSelectionRect(null);
    // Clear selection in epub.js iframes
    webViewRef.current?.injectJavaScript(`
      (function(){
        try{
          var contents=rendition.getContents();
          if(!contents||!contents.length) return;
          for(var i=0;i<contents.length;i++){
            var d=contents[i].document;
            var sel=d.getSelection?d.getSelection():(d.defaultView?d.defaultView.getSelection():null);
            if(sel) sel.removeAllRanges();
          }
        }catch(e){}
      })();true;
    `);
  }, []);

  // ============================================================================
  // RENDER – Error (before WebView loaded anything)
  // ============================================================================
  if (error && !webViewReady) {
    return (
      <SafeAreaView
        style={[
          styles.container,
          { backgroundColor: theme.background.primary },
        ]}
      >
        <Header
          title={displayName}
          theme={theme}
          onClose={handleClose}
          onOpenWithSystem={handleOpenWithSystem}
          showTocButton={false}
          onToggleToc={() => {}}
          onToggleSettings={() => {}}
        />
        <View style={styles.centerContent}>
          <MaterialIcons
            name="error-outline"
            size={64}
            color={Palette.error.main}
          />
          <Text style={[styles.errorTitle, { color: theme.text.primary }]}>
            Failed to load EPUB
          </Text>
          <Text style={[styles.errorMessage, { color: theme.text.secondary }]}>
            {error}
          </Text>
          <View style={styles.errorActions}>
            <Pressable
              style={[
                styles.retryButton,
                { backgroundColor: Palette.primary[500] },
              ]}
              onPress={initialise}
            >
              <MaterialIcons
                name="refresh"
                size={20}
                color={Palette.white}
                style={{ marginRight: Spacing.sm }}
              />
              <Text style={styles.retryButtonText}>Try Again</Text>
            </Pressable>
            <Pressable
              style={[
                styles.externalButton,
                { borderColor: theme.border.default },
              ]}
              onPress={handleOpenWithSystem}
            >
              <MaterialIcons
                name="open-in-new"
                size={20}
                color={theme.text.primary}
                style={{ marginRight: Spacing.sm }}
              />
              <Text
                style={[
                  styles.externalButtonText,
                  { color: theme.text.primary },
                ]}
              >
                Open Externally
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // RENDER – Main reader
  // ============================================================================
  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background.primary }]}
      edges={["top"]}
      // R2's activity signal. onTouchStart does not capture or consume the
      // touch, so every existing gesture behaves exactly as before.
      onTouchStart={() => noteActivityRef.current?.()}
    >
      <View onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
        <Header
          title={bookInfo.title || displayName}
          subtitle={bookInfo.author}
          theme={theme}
          onClose={handleClose}
          onOpenWithSystem={handleOpenWithSystem}
          showTocButton={toc.length > 0}
          onToggleToc={() => setShowToc(true)}
          onToggleSettings={() => setShowSettings(true)}
          onReadAloud={readAloudEnabled ? () => setShowReadAloud(true) : undefined}
          onSearchText={handleOpenSearch}
          onChatWithDocument={handleChatWithDocument}
          onSavePage={
            SAVED_PAGES && savePageState.enabled
              ? () => {
                  void handleSavePageToggle();
                }
              : undefined
          }
          isPageSaved={savePageState.isSaved}
          onToggleKeepAwake={keepAwake.supported ? keepAwake.toggle : undefined}
          isKeepAwake={keepAwake.enabled}
        />
      </View>

      {/* ── Search bar ──────────────────────────────────────────────── */}
      {showSearch && (
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: theme.surface.primary,
              borderBottomColor: theme.border.light,
            },
          ]}
        >
          {searchLoading ? (
            <ActivityIndicator size="small" color={Palette.primary[500]} style={{ marginRight: 4 }} />
          ) : (
            <MaterialIcons name="search" size={20} color={theme.text.secondary} />
          )}
          <TextInput
            value={searchQuery}
            onChangeText={handleSearchQuery}
            placeholder={searchLoading ? "Searching chapters…" : "Search in book..."}
            placeholderTextColor={theme.text.secondary}
            autoFocus
            style={[styles.searchInput, { color: theme.text.primary }]}
            returnKeyType="search"
            blurOnSubmit={false}
          />
          {searchQuery.length > 0 && !searchLoading && (
            <Text style={[styles.searchCount, { color: theme.text.secondary }]}>
              {searchMatchCount > 0
                ? `${searchCurrent}/${searchMatchCount} ch`
                : "0 results"}
            </Text>
          )}
          {searchMatchCount > 1 && (
            <>
              <Pressable onPress={handleSearchPrev} style={styles.searchBtn} hitSlop={8}>
                <MaterialIcons name="keyboard-arrow-up" size={22} color={theme.text.primary} />
              </Pressable>
              <Pressable onPress={handleSearchNext} style={styles.searchBtn} hitSlop={8}>
                <MaterialIcons name="keyboard-arrow-down" size={22} color={theme.text.primary} />
              </Pressable>
            </>
          )}
          <Pressable onPress={handleCloseSearch} style={styles.searchBtn}>
            <MaterialIcons name="close" size={20} color={theme.text.secondary} />
          </Pressable>
        </View>
      )}

      {/* Persistent loading overlay while epub.js parses */}
      {loading && (
        <View style={styles.chapterLoadingOverlay}>
          <ActivityIndicator size="small" color={Palette.primary[500]} />
          <Text style={[styles.overlayText, { color: theme.text.secondary }]}>
            Preparing book…
          </Text>
        </View>
      )}

      {/* WebView – always mounted so we can inject JS even while "loading" overlay is visible */}
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html: htmlContent }}
        style={styles.webview}
        onMessage={handleMessage}
        onError={() => {
          setError("WebView failed to load");
          setLoading(false);
        }}
        androidLayerType="hardware"
        cacheEnabled={true}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        mixedContentMode="always"
        allowFileAccess={true}
        showsVerticalScrollIndicator={false}
      />

      {/* Bottom progress bar */}
      <BottomBar progress={progress} theme={theme} />

      {/* TOC Modal */}
      <TocModal
        visible={showToc}
        toc={toc}
        onSelect={handleTocSelect}
        onClose={() => setShowToc(false)}
        theme={theme}
      />

      {/* Settings Modal */}
      <SettingsModal
        visible={showSettings}
        settings={settings}
        onThemeChange={updateTheme}
        onFontSizeChange={updateFontSize}
        onClose={() => setShowSettings(false)}
        theme={theme}
      />

      {/* Read Aloud */}
      <ReadAloudBar
        {...epubReadAloud.controls}
        stop={() => {
          epubReadAloud.controls.stop();
          setShowReadAloud(false);
        }}
        visible={
          showReadAloud &&
          !loading &&
          !error &&
          epubReadAloud.loadStatus === "ready" &&
          epubReadAloud.chunks.length > 0
        }
        colorScheme={colorScheme}
        sectionLabel="chapter"
        onVoicePress={() => setShowVoicePicker(true)}
        onPronunciationPress={() => {
          // The sheet's Test button speaks — pause so the two do not compete
          // for the engine and leave playback stalled mid-chunk.
          if (epubReadAloud.controls.status === "speaking") {
            epubReadAloud.controls.pause();
          }
          setShowPronunciation(true);
        }}
      />

      {/* Pronunciation rules */}
      <PronunciationEditor
        visible={showPronunciation}
        onClose={() => setShowPronunciation(false)}
        documentId={readAloudFilePath || undefined}
        documentName={bookInfo.title || displayName}
        colorScheme={colorScheme}
      />

      {/* ── Text selection toolbar ────────────────────────────────── */}
      <SelectionToolbar
        visible={selectionVisible}
        selectedText={selectionText}
        rect={
          selectionRect
            ? { ...selectionRect, y: selectionRect.y + headerHeight }
            : null
        }
        onHighlight={handleSelectionHighlight}
        onUnderline={handleSelectionUnderline}
        onStrikethrough={handleSelectionStrikethrough}
        onCopy={handleSelectionCopy}
        onSearch={handleSelectionSearch}
        onDismiss={handleSelectionDismiss}
        onSavePage={
          SAVED_PAGES && savePageState.enabled
            ? (selectedText) => {
                void handleSavePageToggle(selectedText);
              }
            : undefined
        }
      />

      {/* ── Bookmark confirmation (R1) ─────────────────────────── */}
      <BookmarkToast
        message={bookmarkToast?.message ?? null}
        ok={bookmarkToast?.ok}
        bottomOffset={showReadAloud ? READ_ALOUD_PANEL_CLEARANCE : 0}
      />

      <VoicePicker
        visible={showVoicePicker}
        onClose={() => setShowVoicePicker(false)}
        colorScheme={colorScheme}
      />

      {/* ── Source card for a citation opened from Chat with File ── */}
      {sourceCard && (
        <View style={SOURCE_CARD_OVERLAY_STYLE} pointerEvents="box-none">
          <SourceCard label={sourceCard.label} quote={sourceCard.quote} onClose={closeSourceCard} />
        </View>
      )}

      {/* ── In-reader Gozlin panel (AI_READER_PANEL) ─────────────── */}
      {AI_READER_PANEL && (
        <ReaderAIPanel
          ref={aiPanelRef}
          document={panelDocument}
          readerKind="epub"
          onNavigateToCitation={handlePanelCitation}
          bottomOffset={showReadAloud ? READ_ALOUD_PANEL_CLEARANCE : 0}
          onOpenFullScreen={openChatWithDocumentScreen}
        />
      )}
    </SafeAreaView>
  );
}

/** JS that opens a chapter (1-based spine index) inside the epub.js WebView. */
function epubShowChapterScript(chapter: number): string {
  const index = Math.max(0, Math.floor(chapter) - 1);
  return `(function(){try{var s=book.spine.get(${index});if(s){rendition.display(s.href);}}catch(e){}})();true;`;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// ---- Header ----
interface HeaderProps {
  title: string;
  subtitle?: string;
  theme: typeof LightTheme;
  onClose: () => void;
  onOpenWithSystem: () => void;
  onToggleToc: () => void;
  onToggleSettings: () => void;
  showTocButton?: boolean;
  onReadAloud?: () => void;
  onSearchText?: () => void;
  onChatWithDocument?: () => void;
  /** Bookmarks (R1) — omitted when the feature is off, as for the other entries. */
  onSavePage?: () => void;
  isPageSaved?: boolean;
  /** Keep Awake — omitted where the platform cannot hold a wake lock. */
  onToggleKeepAwake?: () => void;
  isKeepAwake?: boolean;
}

function Header({
  title,
  subtitle,
  theme,
  onClose,
  onOpenWithSystem,
  onToggleToc,
  onToggleSettings,
  showTocButton = true,
  onReadAloud,
  onSearchText,
  onChatWithDocument,
  onSavePage,
  isPageSaved = false,
  onToggleKeepAwake,
  isKeepAwake = false,
}: HeaderProps) {
  const [showOverflow, setShowOverflow] = React.useState(false);

  return (
    <View>
      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.surface.primary,
            borderBottomColor: theme.border.light,
          },
        ]}
      >
        <Pressable onPress={onClose} style={styles.headerButton}>
          <MaterialIcons name="close" size={28} color={theme.text.primary} />
        </Pressable>

        <View style={styles.headerCenter}>
          <Text
            style={[styles.headerTitle, { color: theme.text.primary }]}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[styles.headerSubtitle, { color: theme.text.secondary }]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>

        <View style={styles.headerActions}>
          {showTocButton && (
            <Pressable onPress={onToggleToc} style={styles.headerButton}>
              <MaterialIcons
                name="menu-book"
                size={24}
                color={theme.text.primary}
              />
            </Pressable>
          )}
          <Pressable onPress={onToggleSettings} style={styles.headerButton}>
            <MaterialIcons
              name="text-format"
              size={24}
              color={theme.text.primary}
            />
          </Pressable>

          {/* 3-dots overflow */}
          <Pressable
            onPress={() => setShowOverflow((v) => !v)}
            style={styles.headerButton}
          >
            <MaterialIcons
              name="more-vert"
              size={22}
              color={theme.text.primary}
            />
          </Pressable>
        </View>
      </View>

      {/* Overflow dropdown */}
      {showOverflow && (
        <Pressable
          style={styles.overflowBackdrop}
          onPress={() => setShowOverflow(false)}
        >
          <View
            style={[
              styles.overflowMenu,
              {
                backgroundColor: theme.surface.elevated,
                borderColor: theme.border.light,
              },
            ]}
          >
            {/* Search Text */}
            {onSearchText && (
              <Pressable
                style={styles.overflowItem}
                onPress={() => {
                  setShowOverflow(false);
                  onSearchText();
                }}
              >
                <MaterialIcons name="search" size={20} color={theme.text.primary} />
                <Text style={[styles.overflowLabel, { color: theme.text.primary }]}>
                  Search Text
                </Text>
              </Pressable>
            )}

            {/* Read Aloud */}
            {onReadAloud && (
              <Pressable
                style={styles.overflowItem}
                onPress={() => {
                  setShowOverflow(false);
                  onReadAloud();
                }}
              >
                <MaterialIcons
                  name="volume-up"
                  size={20}
                  color={theme.text.primary}
                />
                <Text
                  style={[styles.overflowLabel, { color: theme.text.primary }]}
                >
                  Read Aloud
                </Text>
              </Pressable>
            )}

            {/* Chat with File */}
            {onChatWithDocument && (
              <Pressable
                style={styles.overflowItem}
                onPress={() => {
                  setShowOverflow(false);
                  onChatWithDocument();
                }}
              >
                <MaterialIcons
                  name="chat"
                  size={20}
                  color={Palette.primary[500]}
                />
                <Text
                  style={[styles.overflowLabel, { color: theme.text.primary }]}
                >
                  Chat with File
                </Text>
              </Pressable>
            )}

            {/* Bookmark */}
            {onSavePage && (
              <Pressable
                style={styles.overflowItem}
                onPress={() => {
                  setShowOverflow(false);
                  onSavePage();
                }}
              >
                <MaterialIcons
                  name={isPageSaved ? "bookmark" : "bookmark-border"}
                  size={20}
                  color={theme.text.primary}
                />
                <Text
                  style={[styles.overflowLabel, { color: theme.text.primary }]}
                >
                  {isPageSaved ? "Remove Bookmark" : "Bookmark"}
                </Text>
              </Pressable>
            )}

            {/* Keep Awake — a setting, so the menu stays open and the switch
                flips in place instead of dismissing under the finger. */}
            {onToggleKeepAwake && (
              <Pressable
                style={[styles.overflowItem, styles.overflowItemToggle]}
                accessibilityRole="switch"
                accessibilityState={{ checked: isKeepAwake }}
                onPress={onToggleKeepAwake}
              >
                <MaterialIcons
                  name="local-cafe"
                  size={20}
                  color={theme.text.primary}
                />
                <Text
                  style={[styles.overflowLabel, { color: theme.text.primary }]}
                >
                  Keep Awake
                </Text>
                <View style={styles.overflowTrailing}>
                  <MenuToggle on={isKeepAwake} theme={theme} />
                </View>
              </Pressable>
            )}

            {/* Open externally */}
            <Pressable
              style={styles.overflowItem}
              onPress={() => {
                setShowOverflow(false);
                onOpenWithSystem();
              }}
            >
              <MaterialIcons
                name="open-in-new"
                size={20}
                color={theme.text.primary}
              />
              <Text
                style={[styles.overflowLabel, { color: theme.text.primary }]}
              >
                Open Externally
              </Text>
            </Pressable>
          </View>
        </Pressable>
      )}
    </View>
  );
}

// ---- Bottom bar (progress only) ----
interface BottomBarProps {
  progress: number;
  theme: typeof LightTheme;
}

function BottomBar({ progress, theme }: BottomBarProps) {
  return (
    <View
      style={[
        styles.bottomBar,
        {
          backgroundColor: theme.surface.primary,
          borderTopColor: theme.border.light,
        },
      ]}
    >
      <View style={styles.progressContainer}>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.min(100, Math.max(0, progress))}%` },
            ]}
          />
        </View>
        <Text style={[styles.progressText, { color: theme.text.secondary }]}>
          {progress}%
        </Text>
      </View>
    </View>
  );
}

// ---- TOC Modal ----
interface TocModalProps {
  visible: boolean;
  toc: Array<{ label: string; href: string }>;
  onSelect: (href: string) => void;
  onClose: () => void;
  theme: typeof LightTheme;
}

function TocModal({ visible, toc, onSelect, onClose, theme }: TocModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView
        style={[
          styles.modalContainer,
          { backgroundColor: theme.background.primary },
        ]}
      >
        <View
          style={[
            styles.modalHeader,
            {
              backgroundColor: theme.surface.primary,
              borderBottomColor: theme.border.light,
            },
          ]}
        >
          <Text style={[styles.modalTitle, { color: theme.text.primary }]}>
            Table of Contents
          </Text>
          <Pressable onPress={onClose} style={styles.modalCloseButton}>
            <MaterialIcons name="close" size={28} color={theme.text.primary} />
          </Pressable>
        </View>

        <ScrollView style={styles.tocList}>
          {toc.map((item, index) => (
            <TouchableOpacity
              key={`${item.href}-${index}`}
              style={[
                styles.tocItem,
                { borderBottomColor: theme.border.light },
              ]}
              onPress={() => onSelect(item.href)}
            >
              <Text
                style={[styles.tocItemText, { color: theme.text.primary }]}
                numberOfLines={2}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
          {toc.length === 0 && (
            <Text style={[styles.tocEmpty, { color: theme.text.tertiary }]}>
              No table of contents available.
            </Text>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ---- Settings Modal ----
interface SettingsModalProps {
  visible: boolean;
  settings: EpubReaderSettings;
  onThemeChange: (t: EpubReaderSettings["theme"]) => void;
  onFontSizeChange: (delta: number) => void;
  onClose: () => void;
  theme: typeof LightTheme;
}

function SettingsModal({
  visible,
  settings,
  onThemeChange,
  onFontSizeChange,
  onClose,
  theme,
}: SettingsModalProps) {
  const themes: Array<{
    key: EpubReaderSettings["theme"];
    label: string;
    bg: string;
    text: string;
  }> = [
    { key: "light", label: "Light", bg: "#ffffff", text: "#1a1a1a" },
    { key: "sepia", label: "Sepia", bg: "#f5f1e8", text: "#5c4b37" },
    { key: "dark", label: "Dark", bg: "#1a1a1a", text: "#e5e7eb" },
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView
        style={[
          styles.modalContainer,
          { backgroundColor: theme.background.primary },
        ]}
      >
        <View
          style={[
            styles.modalHeader,
            {
              backgroundColor: theme.surface.primary,
              borderBottomColor: theme.border.light,
            },
          ]}
        >
          <Text style={[styles.modalTitle, { color: theme.text.primary }]}>
            Reader Settings
          </Text>
          <Pressable onPress={onClose} style={styles.modalCloseButton}>
            <MaterialIcons name="close" size={28} color={theme.text.primary} />
          </Pressable>
        </View>

        <ScrollView style={styles.settingsContent}>
          {/* Theme selection */}
          <Text
            style={[styles.settingsSectionTitle, { color: theme.text.primary }]}
          >
            Theme
          </Text>
          <View style={styles.themeOptions}>
            {themes.map((t) => (
              <TouchableOpacity
                key={t.key}
                style={[
                  styles.themeOption,
                  {
                    backgroundColor: t.bg,
                    borderColor:
                      settings.theme === t.key
                        ? Palette.primary[500]
                        : theme.border.default,
                    borderWidth: settings.theme === t.key ? 2 : 1,
                  },
                ]}
                onPress={() => onThemeChange(t.key)}
              >
                <Text style={[styles.themeOptionText, { color: t.text }]}>
                  Aa
                </Text>
                <Text
                  style={[
                    styles.themeOptionLabel,
                    { color: theme.text.secondary },
                  ]}
                >
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Font size */}
          <Text
            style={[
              styles.settingsSectionTitle,
              { color: theme.text.primary, marginTop: Spacing.xl },
            ]}
          >
            Font Size
          </Text>
          <View style={styles.fontSizeControls}>
            <Pressable
              style={[
                styles.fontSizeButton,
                { backgroundColor: theme.surface.secondary },
              ]}
              onPress={() => onFontSizeChange(-10)}
            >
              <MaterialIcons
                name="remove"
                size={24}
                color={theme.text.primary}
              />
            </Pressable>

            <Text style={[styles.fontSizeValue, { color: theme.text.primary }]}>
              {settings.fontSize}%
            </Text>

            <Pressable
              style={[
                styles.fontSizeButton,
                { backgroundColor: theme.surface.secondary },
              ]}
              onPress={() => onFontSizeChange(10)}
            >
              <MaterialIcons name="add" size={24} color={theme.text.primary} />
            </Pressable>
          </View>

          {/* Preview */}
          <Text
            style={[
              styles.settingsSectionTitle,
              { color: theme.text.primary, marginTop: Spacing.xl },
            ]}
          >
            Preview
          </Text>
          <View
            style={[
              styles.previewBox,
              {
                backgroundColor:
                  themes.find((t) => t.key === settings.theme)?.bg || "#fff",
              },
            ]}
          >
            <Text
              style={{
                fontSize: (settings.fontSize / 100) * 16,
                lineHeight: (settings.fontSize / 100) * 16 * 1.6,
                color:
                  themes.find((t) => t.key === settings.theme)?.text || "#000",
              }}
            >
              The quick brown fox jumps over the lazy dog. This is a preview of
              your reading settings.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  container: { flex: 1 },
  // Search bar
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: 1,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 4,
  },
  searchCount: {
    fontSize: 12,
    marginHorizontal: 4,
  },
  searchBtn: {
    padding: 4,
  },
  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: Spacing.xs,
  },
  headerTitle: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
  },
  headerSubtitle: { fontSize: Typography.size.xs, marginTop: 2 },
  headerActions: { flexDirection: "row" },
  // Overflow menu
  overflowBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
  },
  overflowMenu: {
    position: "absolute",
    top: 56,
    right: 8,
    minWidth: 200,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 4,
    zIndex: 51,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  } as any,
  overflowItem: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 46,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  } as any,
  overflowItemToggle: {
    paddingVertical: 8,
  },
  overflowLabel: {
    fontSize: 15,
    fontWeight: "500" as const,
  },
  overflowTrailing: {
    marginLeft: "auto",
  },
  // Centre content (loading/error)
  centerContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing["2xl"],
  },
  loadingText: { fontSize: Typography.size.base, marginTop: Spacing.md },
  errorTitle: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.semibold,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  errorMessage: {
    fontSize: Typography.size.base,
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  errorActions: { gap: Spacing.md },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: 12,
  },
  retryButtonText: {
    color: Palette.white,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
  },
  externalButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: 12,
    borderWidth: 1,
  },
  externalButtonText: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.medium,
  },
  // WebView
  webview: { flex: 1 },
  chapterLoadingOverlay: {
    position: "absolute",
    top: 60,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: "center",
    paddingVertical: Spacing.sm,
    flexDirection: "row",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  overlayText: { fontSize: Typography.size.sm },
  // Bottom bar
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderTopWidth: 1,
  },
  navButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  progressContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    backgroundColor: "#e0e0e0",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: Palette.primary[500],
    borderRadius: 2,
  },
  progressText: {
    fontSize: Typography.size.xs,
    minWidth: 36,
    textAlign: "right",
  },
  // Modals
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.semibold,
  },
  modalCloseButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  // TOC
  tocList: { flex: 1 },
  tocItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
  },
  tocItemText: { flex: 1, fontSize: Typography.size.base },
  tocEmpty: {
    textAlign: "center",
    marginTop: Spacing["2xl"],
    fontSize: Typography.size.base,
  },
  // Settings
  settingsContent: { flex: 1, padding: Spacing.lg },
  settingsSectionTitle: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
    marginBottom: Spacing.md,
  },
  themeOptions: { flexDirection: "row", gap: Spacing.md },
  themeOption: {
    flex: 1,
    alignItems: "center",
    paddingVertical: Spacing.lg,
    borderRadius: 12,
  },
  themeOptionText: {
    fontSize: 24,
    fontWeight: "600",
    marginBottom: Spacing.xs,
  },
  themeOptionLabel: { fontSize: Typography.size.xs },
  fontSizeControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.lg,
  },
  fontSizeButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
  },
  fontSizeValue: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.semibold,
    minWidth: 80,
    textAlign: "center",
  },
  previewBox: {
    padding: Spacing.lg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
});

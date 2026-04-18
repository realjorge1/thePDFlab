/**
 * DOCX Viewer Screen
 * In-app DOCX viewer with WebView-based rendering using Mammoth.js.
 *
 * Features:
 *  - Mobile View / Normal View toggle (text reflow via documentReflowService)
 *  - Continuous / Facing reading mode toggle (CSS-based pagination)
 *  - Three-dots overflow menu (Share, Search, Read Aloud, Chat, Edit, Delete, Star)
 *  - In-document search with highlight navigation
 *  - Edit mode with save
 *  - Read Aloud integration
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import {
  MobileRenderer,
  type MobileRendererHandle,
} from "@/components/DocumentViewer/MobileRenderer";
import { SelectionToolbar } from "@/components/DocumentViewer/SelectionToolbar";
import { ThreeDotsMenu } from "@/components/DocumentViewer/ThreeDotsMenu";
import { ViewModeToggle } from "@/components/DocumentViewer/ViewModeToggle";
import DocxShareOptions from "@/components/DocxShareOptions";
import { ReadAloudController } from "@/components/ReadAloudController";
import type { Highlight, Strikethrough, Underline, ViewMode } from "@/src/types/document-viewer.types";
import {
  getHighlights,
  getStrikethroughs,
  getUnderlines,
  saveHighlight,
  saveStrikethrough,
  saveUnderline,
  removeHighlight,
  removeStrikethrough,
  removeUnderline,
} from "@/services/viewerStorageService";

import {
  DarkTheme,
  LightTheme,
  Palette,
  Spacing,
  Typography,
  openWithSystemApp,
  showOpenFailedAlert,
} from "@/services/document-manager";
import { reflowDOCX } from "@/services/documentReflowService";
import {
  generateDocxEditorHtml,
  generateDocxViewerHtml,
  generatePlainTextEditorHtml,
  generatePlainTextViewerHtml,
  getDocxDisplayName,
  isValidDocxFile,
  normalizeDocxUri,
  readDocxAsBase64,
  readFileAsText,
  saveEditedContent,
} from "@/services/docxService";
import {
  isFavorite as checkIsFavorite,
  deleteFileReference,
  getAllFiles,
  toggleFavorite,
} from "@/services/fileService";
import { loadMobileViewVendorScripts } from "@/services/mobileViewVendorLoader";
import { recycleFile } from "@/services/recycleBinService";

// ============================================================================
// TYPES
// ============================================================================
type ReadingMode = "continuous" | "facing";

interface ViewerState {
  originalUri: string | null;
  normalizedUri: string | null;
  base64Content: string | null;
  textContent: string | null;
  htmlContent: string | null;
  loading: boolean;
  error: string | null;
  mode: "view" | "edit";
  saving: boolean;
  isValidDocx: boolean;
  showShareModal: boolean;
  extractedText: string | null;
  fullscreen: boolean;
  // ── Mobile view ──
  viewMode: ViewMode;
  mobileHtml: string | null;
  mobileLoading: boolean;
  mobileError: string | null;
  // ── Reading mode ──
  readingMode: ReadingMode;
  // ── Menu & overlays ──
  showMenu: boolean;
  showSearch: boolean;
  searchQuery: string;
  searchMatchCount: number;
  // ── Read Aloud ──
  readAloudActive: boolean;
  readAloudText: string;
  // ── Star ──
  isStarred: boolean;
  fileId: string | null;
  // ── Text selection toolbar ──
  selectionVisible: boolean;
  selectionText: string;
  selectionRect: { x: number; y: number; width: number; height: number } | null;
  selectionOffsets: { startOffset: number; endOffset: number } | null;
}

// ============================================================================
// COMPONENT
// ============================================================================
export default function DocxViewerScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const theme = colorScheme === "dark" ? DarkTheme : LightTheme;
  const webViewRef = useRef<WebView>(null);
  const mobileRendererRef = useRef<MobileRendererHandle>(null);
  const mammothJsRef = useRef<string | null>(null);

  const { uri, name } = useLocalSearchParams<{ uri: string; name: string }>();
  const displayName = name || getDocxDisplayName(uri || "");

  const [state, setState] = useState<ViewerState>({
    originalUri: null,
    normalizedUri: null,
    base64Content: null,
    textContent: null,
    htmlContent: null,
    loading: true,
    error: null,
    mode: "view",
    saving: false,
    isValidDocx: false,
    showShareModal: false,
    extractedText: null,
    fullscreen: false,
    viewMode: "original",
    mobileHtml: null,
    mobileLoading: false,
    mobileError: null,
    readingMode: "continuous",
    showMenu: false,
    showSearch: false,
    searchQuery: "",
    searchMatchCount: 0,
    readAloudActive: false,
    readAloudText: "",
    isStarred: false,
    fileId: null,
    selectionVisible: false,
    selectionText: "",
    selectionRect: null,
    selectionOffsets: null,
  });

  const [headerHeight, setHeaderHeight] = useState(0);
  const isMountedRef = useRef(true);

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load document + check star on mount
  React.useEffect(() => {
    if (!uri) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: "No DOCX file specified",
      }));
      return;
    }
    loadDocument();
    checkStarStatus();
  }, [uri]);

  // ── Star status ──────────────────────────────────────────────────
  const checkStarStatus = useCallback(async () => {
    try {
      const allFiles = await getAllFiles();
      const match = allFiles.find((f) => f.uri === uri);
      if (match) {
        const starred = await checkIsFavorite(match.id);
        if (isMountedRef.current) {
          setState((prev) => ({
            ...prev,
            isStarred: starred,
            fileId: match.id,
          }));
        }
      }
    } catch {
      // non-critical
    }
  }, [uri]);

  // ── Load document ────────────────────────────────────────────────
  const loadDocument = async () => {
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      const normalized = await normalizeDocxUri(uri!);
      const isValid = await isValidDocxFile(normalized);

      let html: string;
      let base64: string | null = null;
      let textContent: string | null = null;

      if (isValid) {
        base64 = await readDocxAsBase64(normalized);
        if (!mammothJsRef.current) {
          const vendor = await loadMobileViewVendorScripts();
          mammothJsRef.current = vendor.mammothBrowserMinJs;
        }
        html = generateDocxViewerHtml(base64, mammothJsRef.current);
      } else {
        textContent = await readFileAsText(normalized);
        html = generatePlainTextViewerHtml(textContent);
      }

      setState((prev) => ({
        ...prev,
        originalUri: uri!,
        normalizedUri: normalized,
        base64Content: base64,
        textContent,
        htmlContent: html,
        loading: false,
        isValidDocx: isValid,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load DOCX",
      }));
    }
  };

  // ── Navigation ───────────────────────────────────────────────────
  const handleClose = useCallback(() => router.back(), []);

  const handleOpenWithSystem = useCallback(async () => {
    if (!uri) return;
    const result = await openWithSystemApp({
      uri,
      displayName,
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    if (!result.success) showOpenFailedAlert(displayName, result.error);
  }, [uri, displayName]);

  // ── Share ────────────────────────────────────────────────────────
  const handleShare = useCallback(() => {
    // Extract text from WebView for sharing options
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        (function() {
          try {
            var el = document.getElementById('content') || document.getElementById('editor') || document.body;
            var t = el ? el.innerText || el.textContent : '';
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'extract-text', content: t }));
          } catch (e) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'extract-text', content: '' }));
          }
        })(); true;
      `);
    }
    setState((prev) => ({ ...prev, showShareModal: true }));
  }, []);

  const handleCloseShareModal = useCallback(() => {
    setState((prev) => ({ ...prev, showShareModal: false }));
  }, []);

  // ── View mode toggle (Mobile ↔ Normal) ──────────────────────────
  const handleViewModeChange = useCallback(
    async (newMode: ViewMode) => {
      // Switching back to original — immediate, cancel any pending load
      if (newMode === "original") {
        setState((prev) => ({
          ...prev,
          viewMode: "original",
          mobileLoading: false,
        }));
        return;
      }

      // Android 8/9 ship Chrome-backed WebView that crashes the process on
      // init when running a recent Chrome build. Android 10+ decouples
      // WebView from Chrome, so the crash can't happen there.
      if (Platform.OS === "android" && (Platform.Version as number) < 29) {
        Alert.alert(
          "Mobile View Unavailable",
          "Mobile View requires Android 10 or newer. Your device will continue to work in Normal View.",
        );
        return;
      }

      // Already have mobile HTML cached
      if (state.mobileHtml) {
        setState((prev) => ({ ...prev, viewMode: "mobile" }));
        return;
      }

      if (!state.normalizedUri) return;
      setState((prev) => ({ ...prev, mobileLoading: true, mobileError: null }));

      try {
        const result = await reflowDOCX(state.normalizedUri, {
          fontSize: 17,
          lineHeight: 1.6,
          theme: colorScheme === "dark" ? "dark" : "light",
          fontFamily: "system-ui",
        });

        if (!isMountedRef.current) return;
        if (result.success && result.html) {
          setState((prev) => ({
            ...prev,
            viewMode: "mobile",
            mobileHtml: result.html!,
            mobileLoading: false,
          }));
        } else {
          Alert.alert(
            "Mobile View",
            result.message || "Mobile View not available.",
          );
          setState((prev) => ({ ...prev, mobileLoading: false }));
        }
      } catch {
        if (!isMountedRef.current) return;
        Alert.alert("Mobile View", "Failed to generate Mobile View.");
        setState((prev) => ({ ...prev, mobileLoading: false }));
      }
    },
    [state.mobileHtml, state.normalizedUri, colorScheme],
  );

  // ── Reading mode toggle (Continuous ↔ Facing) ───────────────────
  const toggleReadingMode = useCallback(() => {
    setState((prev) => {
      const newMode: ReadingMode =
        prev.readingMode === "continuous" ? "facing" : "continuous";

      // For original view, inject CSS to paginate or unpaginate
      if (prev.viewMode === "original" && webViewRef.current) {
        if (newMode === "facing") {
          webViewRef.current.injectJavaScript(`
            (function(){
              document.body.style.columnWidth = '100vw';
              document.body.style.columnGap = '0';
              document.body.style.height = '100vh';
              document.body.style.overflow = 'hidden';
              document.documentElement.style.overflowX = 'auto';
              document.documentElement.style.overflowY = 'hidden';
              document.documentElement.style.scrollSnapType = 'x mandatory';
              var style = document.createElement('style');
              style.id = '__facing_style';
              style.textContent = '* { scroll-snap-align: start; }';
              document.head.appendChild(style);
            })(); true;
          `);
        } else {
          webViewRef.current.injectJavaScript(`
            (function(){
              document.body.style.columnWidth = '';
              document.body.style.columnGap = '';
              document.body.style.height = '';
              document.body.style.overflow = '';
              document.documentElement.style.overflowX = '';
              document.documentElement.style.overflowY = '';
              document.documentElement.style.scrollSnapType = '';
              var s = document.getElementById('__facing_style');
              if (s) s.remove();
            })(); true;
          `);
        }
      }

      return { ...prev, readingMode: newMode };
    });
  }, []);

  // ── Fullscreen ───────────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    setState((prev) => {
      const entering = !prev.fullscreen;
      if (prev.viewMode === "original" && webViewRef.current) {
        if (entering) {
          webViewRef.current.injectJavaScript(`
            (function(){
              document.body.style.maxWidth='100vw';
              document.body.style.overflowX='hidden';
              document.body.style.margin='0 auto';
              document.body.style.padding='0 12px';
              document.body.style.boxSizing='border-box';
              document.body.style.fontSize='108%';
              document.body.style.lineHeight='1.65';
              document.body.style.wordBreak='break-word';
            })(); true;
          `);
        } else {
          webViewRef.current.injectJavaScript(`
            (function(){
              document.body.style.maxWidth='';
              document.body.style.overflowX='';
              document.body.style.margin='';
              document.body.style.padding='';
              document.body.style.boxSizing='';
              document.body.style.fontSize='';
              document.body.style.lineHeight='';
              document.body.style.wordBreak='';
            })(); true;
          `);
        }
      }
      return { ...prev, fullscreen: entering };
    });
  }, []);

  // ── Search ───────────────────────────────────────────────────────
  const handleOpenSearch = useCallback(() => {
    setState((prev) => ({
      ...prev,
      showSearch: true,
      searchQuery: "",
      searchMatchCount: 0,
    }));
  }, []);

  const handleSearchQuery = useCallback(
    (query: string) => {
      setState((prev) => ({ ...prev, searchQuery: query }));

      if (state.viewMode === "mobile" && mobileRendererRef.current) {
        mobileRendererRef.current.search(query);
      } else if (webViewRef.current && query.trim()) {
        // Search in original WebView
        webViewRef.current.injectJavaScript(`
          (function(){
            if(window.__pdfiqHighlights){
              window.__pdfiqHighlights.forEach(function(el){
                var p=el.parentNode;p.replaceChild(document.createTextNode(el.textContent),el);p.normalize();
              });
            }
            window.__pdfiqHighlights=[];
            var q=${JSON.stringify(query)}.toLowerCase();
            if(!q){window.ReactNativeWebView.postMessage(JSON.stringify({type:'search-count',count:0}));return;}
            var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null,false);
            var nodes=[];while(walker.nextNode()) nodes.push(walker.currentNode);
            var count=0;
            nodes.forEach(function(node){
              var text=node.nodeValue;var lower=text.toLowerCase();var idx=lower.indexOf(q);
              if(idx===-1) return;
              var frag=document.createDocumentFragment();var last=0;
              while(idx!==-1){
                frag.appendChild(document.createTextNode(text.substring(last,idx)));
                var span=document.createElement('span');
                span.style.backgroundColor='#FFEB3B';span.style.color='#000';span.style.borderRadius='2px';
                span.textContent=text.substring(idx,idx+q.length);
                frag.appendChild(span);window.__pdfiqHighlights.push(span);count++;
                last=idx+q.length;idx=lower.indexOf(q,last);
              }
              frag.appendChild(document.createTextNode(text.substring(last)));
              node.parentNode.replaceChild(frag,node);
            });
            if(window.__pdfiqHighlights.length>0){
              window.__pdfiqHighlights[0].scrollIntoView({behavior:'smooth',block:'center'});
            }
            window.ReactNativeWebView.postMessage(JSON.stringify({type:'search-count',count:count}));
          })(); true;
        `);
      } else if (!query.trim()) {
        setState((prev) => ({ ...prev, searchMatchCount: 0 }));
      }
    },
    [state.viewMode],
  );

  const handleCloseSearch = useCallback(() => {
    setState((prev) => ({
      ...prev,
      showSearch: false,
      searchQuery: "",
      searchMatchCount: 0,
    }));
    if (state.viewMode === "mobile" && mobileRendererRef.current) {
      mobileRendererRef.current.clearSearch();
    } else if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        (function(){
          window.getSelection().removeAllRanges();
          if(window.__pdfiqHighlights){
            window.__pdfiqHighlights.forEach(function(el){
              var parent=el.parentNode;parent.replaceChild(document.createTextNode(el.textContent),el);parent.normalize();
            });
            window.__pdfiqHighlights=[];
          }
        })(); true;
      `);
    }
  }, [state.viewMode]);

  // ── Read Aloud ───────────────────────────────────────────────────
  const handleReadAloud = useCallback(() => {
    // Extract text for read aloud
    if (state.viewMode === "original" && webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        (function(){
          var el = document.getElementById('content') || document.body;
          var text = el ? el.innerText || el.textContent : '';
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'read-aloud-extract', content: text }));
        })(); true;
      `);
    } else if (state.viewMode === "mobile" && mobileRendererRef.current) {
      mobileRendererRef.current.extractTextForReadAloud();
    }
    setState((prev) => ({ ...prev, readAloudActive: true }));
  }, [state.viewMode]);

  // ── Chat with File ───────────────────────────────────────────────
  const handleChatWithFile = useCallback(() => {
    router.push({
      pathname: "/chat-with-document",
      params: { uri, name },
    });
  }, [uri, name]);

  // ── Edit File ────────────────────────────────────────────────────
  const handleToggleEdit = useCallback(() => {
    // Ensure we're in original view for editing
    if (state.viewMode === "mobile") {
      setState((prev) => ({ ...prev, viewMode: "original" }));
    }

    if (state.mode === "view") {
      if (state.isValidDocx && state.base64Content && mammothJsRef.current) {
        const editorHtml = generateDocxEditorHtml(
          state.base64Content,
          mammothJsRef.current,
        );
        setState((prev) => ({
          ...prev,
          htmlContent: editorHtml,
          mode: "edit",
        }));
      } else if (state.textContent !== null) {
        const editorHtml = generatePlainTextEditorHtml(state.textContent);
        setState((prev) => ({
          ...prev,
          htmlContent: editorHtml,
          mode: "edit",
        }));
      }
    } else {
      Alert.alert("Exit Edit Mode", "Do you want to save your changes?", [
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            if (
              state.isValidDocx &&
              state.base64Content &&
              mammothJsRef.current
            ) {
              setState((prev) => ({
                ...prev,
                htmlContent: generateDocxViewerHtml(
                  state.base64Content!,
                  mammothJsRef.current!,
                ),
                mode: "view",
              }));
            } else if (state.textContent !== null) {
              setState((prev) => ({
                ...prev,
                htmlContent: generatePlainTextViewerHtml(state.textContent!),
                mode: "view",
              }));
            }
          },
        },
        { text: "Save", onPress: handleSave },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  }, [
    state.mode,
    state.base64Content,
    state.textContent,
    state.isValidDocx,
    state.viewMode,
  ]);

  const handleSave = useCallback(async () => {
    if (!webViewRef.current) return;
    setState((prev) => ({ ...prev, saving: true }));

    webViewRef.current.injectJavaScript(`
      (function() {
        var content = window.getEditorContent ? window.getEditorContent() : document.getElementById('editor').innerHTML;
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'save-content', content: content }));
      })(); true;
    `);
  }, []);

  // ── Delete ───────────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    Alert.alert("Delete File", `Move "${displayName}" to the recycle bin?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const allFiles = await getAllFiles();
            const match = allFiles.find((f) => f.uri === uri);
            if (match) {
              await recycleFile({
                id: match.id,
                name: match.name,
                uri: match.uri,
                size: match.size,
                type: match.type,
                mimeType: match.mimeType,
                source: match.source,
              });
              await deleteFileReference(match.id);
            }
            router.back();
          } catch {
            Alert.alert("Error", "Failed to delete file.");
          }
        },
      },
    ]);
  }, [uri, displayName]);

  // ── Star / Favourite ─────────────────────────────────────────────
  const handleStar = useCallback(async () => {
    if (!state.fileId) {
      Alert.alert("Info", "This file is not in your library.");
      return;
    }
    try {
      const nowStarred = await toggleFavorite(state.fileId);
      setState((prev) => ({ ...prev, isStarred: nowStarred }));
    } catch {
      Alert.alert("Error", "Failed to update favourite status.");
    }
  }, [state.fileId]);

  // ── WebView message handler ──────────────────────────────────────
  const handleWebViewMessage = useCallback(
    async (event: { nativeEvent: { data: string } }) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);

        switch (data.type) {
          case "loaded":
            // Reapply saved annotations to the original DOCX WebView
            if (uri) {
              Promise.all([getHighlights(uri), getUnderlines(uri), getStrikethroughs(uri)])
                .then(([hl, ul, st]) => {
                  if (!hl.length && !ul.length && !st.length) return;
                  const annotations = [
                    ...hl.map((h) => ({ id: h.id, startOffset: h.startOffset ?? 0, endOffset: h.endOffset ?? 0, kind: "highlight", color: h.color })),
                    ...ul.map((u) => ({ id: u.id, startOffset: u.startOffset, endOffset: u.endOffset, kind: "underline" })),
                    ...st.map((s) => ({ id: s.id, startOffset: s.startOffset, endOffset: s.endOffset, kind: "strikethrough" })),
                  ];
                  webViewRef.current?.injectJavaScript(
                    `window.__selBridge_reapplyAnnotations(${JSON.stringify(annotations)}); true;`,
                  );
                })
                .catch(() => {});
            }
            break;
          case "editor-loaded":
            break;

          case "error":
            setState((prev) => ({
              ...prev,
              error: data.message || "Failed to process document",
            }));
            break;

          case "save-content":
            try {
              const newUri = await saveEditedContent(data.content, displayName);
              setState((prev) => ({ ...prev, saving: false }));

              Alert.alert(
                "Document Saved",
                "Your changes have been saved successfully.",
                [
                  {
                    text: "Share",
                    onPress: async () => {
                      try {
                        await Sharing.shareAsync(newUri);
                      } catch {
                        Alert.alert("Error", "Failed to share document");
                      }
                    },
                  },
                  {
                    text: "OK",
                    onPress: () => {
                      if (
                        state.isValidDocx &&
                        state.base64Content &&
                        mammothJsRef.current
                      ) {
                        setState((prev) => ({
                          ...prev,
                          htmlContent: generateDocxViewerHtml(
                            state.base64Content!,
                            mammothJsRef.current!,
                          ),
                          mode: "view",
                        }));
                      } else if (state.textContent !== null) {
                        setState((prev) => ({
                          ...prev,
                          htmlContent: generatePlainTextViewerHtml(
                            state.textContent!,
                          ),
                          mode: "view",
                        }));
                      }
                    },
                  },
                ],
              );
            } catch {
              setState((prev) => ({ ...prev, saving: false }));
              Alert.alert("Error", "Failed to save document");
            }
            break;

          case "extract-text":
            setState((prev) => ({
              ...prev,
              extractedText: data.content?.trim() || "",
            }));
            break;

          case "read-aloud-extract":
            setState((prev) => ({
              ...prev,
              readAloudText: data.content?.trim() || "",
            }));
            break;

          case "search-count":
            setState((prev) => ({
              ...prev,
              searchMatchCount: data.count || 0,
            }));
            break;

          // ── Text selection from the original DOCX WebView ──────────
          // The SELECTION_BRIDGE_JS injected into generateDocxViewerHtml
          // sends these messages when the user selects text.
          case "selection":
            if (data.text) {
              setState((prev) => ({
                ...prev,
                selectionVisible: true,
                selectionText: data.text,
                selectionRect: data.rect ?? null,
                selectionOffsets: {
                  startOffset: data.startOffset ?? 0,
                  endOffset: data.endOffset ?? 0,
                },
              }));
            }
            break;

          case "selection_clear":
            setState((prev) => ({
              ...prev,
              selectionVisible: false,
              selectionText: "",
              selectionRect: null,
              selectionOffsets: null,
            }));
            break;

          case "annotation_applied":
            if (!data.success && data.id && uri) {
              if (data.kind === "highlight") removeHighlight(uri, data.id);
              else if (data.kind === "underline") removeUnderline(uri, data.id);
              else if (data.kind === "strikethrough") removeStrikethrough(uri, data.id);
            }
            break;
        }
      } catch {
        // Ignore non-JSON messages
      }
    },
    [displayName, state.base64Content, state.textContent, state.isValidDocx, uri],
  );

  // ── Mobile renderer messages ─────────────────────────────────────
  const handleMobileMessage = useCallback((msg: any) => {
    if (msg.type === "read-aloud-text" && msg.text) {
      setState((prev) => ({ ...prev, readAloudText: msg.text }));
    } else if (msg.type === "selection" && msg.text) {
      setState((prev) => ({
        ...prev,
        selectionVisible: true,
        selectionText: msg.text,
        selectionRect: msg.rect ?? null,
        selectionOffsets: {
          startOffset: msg.startOffset,
          endOffset: msg.endOffset,
        },
      }));
    } else if (msg.type === "selection_clear") {
      setState((prev) => ({
        ...prev,
        selectionVisible: false,
        selectionText: "",
        selectionRect: null,
        selectionOffsets: null,
      }));
    } else if (msg.type === "search-count") {
      setState((prev) => ({ ...prev, searchMatchCount: msg.count ?? 0 }));
    } else if (msg.type === "annotation_applied" && !msg.success && msg.id && uri) {
      if (msg.kind === "highlight") removeHighlight(uri, msg.id);
      else if (msg.kind === "underline") removeUnderline(uri, msg.id);
      else if (msg.kind === "strikethrough") removeStrikethrough(uri, msg.id);
    }
  }, [uri]);

  // ── Reapply saved annotations when MobileRenderer is ready ──────
  const handleMobileReady = useCallback(async () => {
    if (!uri) return;
    try {
      const [highlights, underlines, strikethroughs] = await Promise.all([
        getHighlights(uri),
        getUnderlines(uri),
        getStrikethroughs(uri),
      ]);
      if (highlights.length || underlines.length || strikethroughs.length) {
        mobileRendererRef.current?.bridgeReapplyAnnotations(
          highlights,
          underlines,
          strikethroughs,
        );
      }
    } catch {}
  }, [uri]);

  // ── Selection toolbar actions ────────────────────────────────────
  const handleSelectionHighlight = useCallback(
    (colorHex: string) => {
      const { selectionOffsets, selectionText, viewMode } = state;
      if (!selectionOffsets || !uri) return;
      const id = `hl_${Date.now()}`;
      if (viewMode === "original") {
        webViewRef.current?.injectJavaScript(
          `window.__selBridge_highlight(${JSON.stringify(id)},${selectionOffsets.startOffset},${selectionOffsets.endOffset},${JSON.stringify(colorHex)}); true;`,
        );
      } else {
        mobileRendererRef.current?.bridgeHighlight(
          id,
          selectionOffsets.startOffset,
          selectionOffsets.endOffset,
          colorHex,
        );
      }
      saveHighlight({
        id,
        fileUri: uri,
        startOffset: selectionOffsets.startOffset,
        endOffset: selectionOffsets.endOffset,
        text: selectionText,
        color: colorHex,
        createdAt: Date.now(),
      });
    },
    [state.selectionOffsets, state.selectionText, state.viewMode, uri],
  );

  const handleSelectionUnderline = useCallback(() => {
    const { selectionOffsets, selectionText, viewMode } = state;
    if (!selectionOffsets || !uri) return;
    const id = `ul_${Date.now()}`;
    if (viewMode === "original") {
      webViewRef.current?.injectJavaScript(
        `window.__selBridge_underline(${JSON.stringify(id)},${selectionOffsets.startOffset},${selectionOffsets.endOffset}); true;`,
      );
    } else {
      mobileRendererRef.current?.bridgeUnderline(
        id,
        selectionOffsets.startOffset,
        selectionOffsets.endOffset,
      );
    }
    saveUnderline({
      id,
      fileUri: uri,
      startOffset: selectionOffsets.startOffset,
      endOffset: selectionOffsets.endOffset,
      text: selectionText,
      createdAt: Date.now(),
    });
  }, [state.selectionOffsets, state.selectionText, state.viewMode, uri]);

  const handleSelectionStrikethrough = useCallback(() => {
    const { selectionOffsets, selectionText, viewMode } = state;
    if (!selectionOffsets || !uri) return;
    const id = `st_${Date.now()}`;
    if (viewMode === "original") {
      webViewRef.current?.injectJavaScript(
        `window.__selBridge_strikethrough(${JSON.stringify(id)},${selectionOffsets.startOffset},${selectionOffsets.endOffset}); true;`,
      );
    } else {
      mobileRendererRef.current?.bridgeStrikethrough(
        id,
        selectionOffsets.startOffset,
        selectionOffsets.endOffset,
      );
    }
    saveStrikethrough({
      id,
      fileUri: uri,
      startOffset: selectionOffsets.startOffset,
      endOffset: selectionOffsets.endOffset,
      text: selectionText,
      createdAt: Date.now(),
    });
  }, [state.selectionOffsets, state.viewMode]);

  const handleSelectionCopy = useCallback(() => {
    if (state.viewMode === "original") {
      webViewRef.current?.injectJavaScript(`document.execCommand('copy'); true;`);
    } else {
      mobileRendererRef.current?.bridgeCopySelection();
    }
  }, [state.viewMode]);

  const handleSelectionAskAthemi = useCallback(() => {
    if (!state.selectionText) return;
    router.push({ pathname: "/ai", params: { prompt: state.selectionText } });
    setState((prev) => ({ ...prev, selectionVisible: false }));
  }, [state.selectionText]);

  const handleSelectionDismiss = useCallback(() => {
    if (state.viewMode === "original") {
      webViewRef.current?.injectJavaScript(`window.__selBridge_clearSelection(); true;`);
    } else {
      mobileRendererRef.current?.bridgeClearSelection();
    }
    setState((prev) => ({
      ...prev,
      selectionVisible: false,
      selectionText: "",
      selectionRect: null,
      selectionOffsets: null,
    }));
  }, [state.viewMode]);

  const handleRetry = useCallback(() => {
    loadDocument();
  }, [uri]);

  // ====================================================================
  // RENDER — Loading
  // ====================================================================
  if (state.loading) {
    return (
      <SafeAreaView
        style={[
          styles.container,
          { backgroundColor: theme.background.primary },
        ]}
      >
        <Header
          name={displayName}
          theme={theme}
          mode="view"
          onClose={handleClose}
          viewMode={state.viewMode}
          onViewModeChange={handleViewModeChange}
          readingMode={state.readingMode}
          onToggleReadingMode={toggleReadingMode}
          onMenuPress={() => {}}
          mobileLoading={state.mobileLoading}
        />
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={Palette.primary[500]} />
          <Text style={[styles.loadingText, { color: theme.text.secondary }]}>
            Preparing document...
          </Text>
        </View>
        <DocxShareOptions
          visible={state.showShareModal}
          onClose={handleCloseShareModal}
          fileUri={state.normalizedUri || state.originalUri}
          textContent={state.extractedText || state.textContent}
          fileName={displayName}
        />
      </SafeAreaView>
    );
  }

  // ====================================================================
  // RENDER — Error
  // ====================================================================
  if (state.error) {
    return (
      <SafeAreaView
        style={[
          styles.container,
          { backgroundColor: theme.background.primary },
        ]}
      >
        <Header
          name={displayName}
          theme={theme}
          mode="view"
          onClose={handleClose}
          viewMode={state.viewMode}
          onViewModeChange={handleViewModeChange}
          readingMode={state.readingMode}
          onToggleReadingMode={toggleReadingMode}
          onMenuPress={() => {}}
          mobileLoading={state.mobileLoading}
        />
        <View style={styles.centerContent}>
          <MaterialIcons
            name="error-outline"
            size={64}
            color={Palette.error.main}
          />
          <Text style={[styles.errorTitle, { color: theme.text.primary }]}>
            Failed to load document
          </Text>
          <Text style={[styles.errorMessage, { color: theme.text.secondary }]}>
            {state.error}
          </Text>
          <View style={styles.errorActions}>
            <Pressable
              style={[
                styles.retryButton,
                { backgroundColor: Palette.primary[500] },
              ]}
              onPress={handleRetry}
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
        <DocxShareOptions
          visible={state.showShareModal}
          onClose={handleCloseShareModal}
          fileUri={state.normalizedUri || state.originalUri}
          textContent={state.extractedText || state.textContent}
          fileName={displayName}
        />
      </SafeAreaView>
    );
  }

  // ====================================================================
  // RENDER — Main viewer
  // ====================================================================
  const isMobileView = state.viewMode === "mobile";

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background.primary }]}
      edges={state.fullscreen ? [] : ["top"]}
    >
      {/* ── Header (hidden in fullscreen) ──────────────────────── */}
      {!state.fullscreen && (
        <View onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
        <Header
          name={displayName}
          theme={theme}
          mode={state.mode}
          saving={state.saving}
          onClose={handleClose}
          onSave={state.mode === "edit" ? handleSave : undefined}
          onToggleEdit={handleToggleEdit}
          viewMode={state.viewMode}
          onViewModeChange={handleViewModeChange}
          readingMode={state.readingMode}
          onToggleReadingMode={toggleReadingMode}
          onMenuPress={() => setState((prev) => ({ ...prev, showMenu: true }))}
          mobileLoading={state.mobileLoading}
        />
        </View>
      )}

      {/* ── Search bar ─────────────────────────────────────────── */}
      {state.showSearch && (
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: theme.surface.primary,
              borderBottomColor: theme.border.light,
            },
          ]}
        >
          <MaterialIcons name="search" size={20} color={theme.text.secondary} />
          <TextInput
            value={state.searchQuery}
            onChangeText={handleSearchQuery}
            placeholder="Search in document..."
            placeholderTextColor={theme.text.secondary}
            autoFocus
            style={[styles.searchInput, { color: theme.text.primary }]}
            returnKeyType="search"
          />
          {state.searchQuery.length > 0 && (
            <Text style={[styles.searchCount, { color: theme.text.secondary }]}>
              {state.searchMatchCount} found
            </Text>
          )}
          <Pressable onPress={handleCloseSearch} style={styles.searchClose}>
            <MaterialIcons
              name="close"
              size={20}
              color={theme.text.secondary}
            />
          </Pressable>
        </View>
      )}

      {/* ── Document content ───────────────────────────────────── */}
      {isMobileView ? (
        <View style={{ flex: 1 }}>
          <MobileRenderer
            ref={mobileRendererRef}
            html={state.mobileHtml}
            loading={state.mobileLoading}
            error={state.mobileError}
            onMessage={handleMobileMessage}
            onReady={handleMobileReady}
          />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {state.htmlContent && (
            <WebView
              ref={webViewRef}
              source={{ html: state.htmlContent }}
              style={styles.webview}
              originWhitelist={["*"]}
              javaScriptEnabled
              domStorageEnabled
              onMessage={handleWebViewMessage}
              onError={() => {
                setState((prev) => ({
                  ...prev,
                  error: "Failed to render document",
                }));
              }}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.webviewLoading}>
                  <ActivityIndicator
                    size="large"
                    color={Palette.primary[500]}
                  />
                </View>
              )}
            />
          )}
          {/* Loading overlay while generating mobile view */}
          {state.mobileLoading && (
            <View style={styles.mobileLoadingOverlay}>
              <ActivityIndicator size="large" color={Palette.white} />
              <Text style={styles.mobileLoadingText}>
                Generating Mobile View…
              </Text>
            </View>
          )}
        </View>
      )}

      {/* ── Fullscreen exit hint ───────────────────────────────── */}
      {state.fullscreen && (
        <Pressable style={styles.fullscreenExitHint} onPress={toggleFullscreen}>
          <View style={styles.fullscreenExitPill}>
            <MaterialIcons name="fullscreen-exit" size={18} color="#fff" />
            <Text style={styles.fullscreenExitText}>
              Tap to exit fullscreen
            </Text>
          </View>
        </Pressable>
      )}

      {/* ── Selection toolbar — at SafeAreaView level so it renders above
           WebView on Android. Rect y offset by headerHeight because the toolbar
           is positioned relative to the SafeAreaView while the rect is in
           WebView-container coordinates (below the header). */}
      <SelectionToolbar
        visible={state.selectionVisible}
        selectedText={state.selectionText}
        rect={
          state.selectionRect
            ? { ...state.selectionRect, y: state.selectionRect.y + headerHeight }
            : null
        }
        onHighlight={handleSelectionHighlight}
        onUnderline={handleSelectionUnderline}
        onStrikethrough={handleSelectionStrikethrough}
        onCopy={handleSelectionCopy}
        onSearch={handleSelectionAskAthemi}
        onDismiss={handleSelectionDismiss}
      />

      {/* ── Three dots menu ────────────────────────────────────── */}
      <ThreeDotsMenu
        visible={state.showMenu}
        onClose={() => setState((prev) => ({ ...prev, showMenu: false }))}
        theme={theme}
        fileType="docx"
        onShare={handleShare}
        onSearchText={handleOpenSearch}
        onReadAloud={handleReadAloud}
        onChatWithFile={handleChatWithFile}
        onEditFile={handleToggleEdit}
        onDelete={handleDelete}
        onStar={handleStar}
        isStarred={state.isStarred}
      />

      {/* ── Read Aloud controller ──────────────────────────────── */}
      <ReadAloudController
        text={
          state.readAloudText || state.extractedText || state.textContent || ""
        }
        colorScheme={colorScheme}
        active={state.readAloudActive}
        onRequestClose={() =>
          setState((prev) => ({ ...prev, readAloudActive: false }))
        }
        documentId={uri}
        documentName={displayName}
      />

      {/* ── DOCX Share Options Modal ───────────────────────────── */}
      <DocxShareOptions
        visible={state.showShareModal}
        onClose={handleCloseShareModal}
        fileUri={state.normalizedUri || state.originalUri}
        textContent={state.extractedText || state.textContent}
        fileName={displayName}
      />
    </SafeAreaView>
  );
}

// ============================================================================
// HEADER COMPONENT
// ============================================================================
interface HeaderProps {
  name: string;
  theme: typeof LightTheme;
  mode: "view" | "edit";
  saving?: boolean;
  onClose: () => void;
  onSave?: () => void;
  onToggleEdit?: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  readingMode: ReadingMode;
  onToggleReadingMode: () => void;
  onMenuPress: () => void;
  mobileLoading: boolean;
}

function Header({
  name,
  theme,
  mode,
  saving,
  onClose,
  onSave,
  onToggleEdit,
  viewMode,
  onViewModeChange,
  readingMode,
  onToggleReadingMode,
  onMenuPress,
  mobileLoading,
}: HeaderProps) {
  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: theme.surface.primary,
          borderBottomColor: theme.border.light,
        },
      ]}
    >
      {/* ── Left: Back / Close ──────────────────────────────────── */}
      <Pressable onPress={onClose} style={styles.headerButton} hitSlop={6}>
        <MaterialIcons name="close" size={26} color={theme.text.primary} />
      </Pressable>

      {/* ── Center: Filename ───────────────────────────────────── */}
      <View style={styles.headerCenter}>
        <Text
          style={[styles.headerTitle, { color: theme.text.primary }]}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {name}
        </Text>
        {mode === "edit" && (
          <Text
            style={[styles.headerSubtitle, { color: Palette.primary[500] }]}
          >
            Editing
          </Text>
        )}
      </View>

      {/* ── Right: Controls ────────────────────────────────────── */}
      <View style={styles.headerActions}>
        {/* Save button (edit mode) */}
        {mode === "edit" && onSave && (
          <Pressable
            onPress={onSave}
            style={[
              styles.saveButton,
              { backgroundColor: Palette.primary[500] },
            ]}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color={Palette.white} />
            ) : (
              <Text style={styles.saveButtonText}>Save</Text>
            )}
          </Pressable>
        )}

        {/* Exit edit mode */}
        {mode === "edit" && onToggleEdit && (
          <Pressable
            onPress={onToggleEdit}
            style={styles.headerButton}
            hitSlop={6}
          >
            <MaterialIcons name="close" size={22} color={theme.text.primary} />
          </Pressable>
        )}

        {/* View controls (view mode only) */}
        {mode === "view" && (
          <>
            {/* Mobile / Normal view toggle */}
            <ViewModeToggle
              mode={viewMode}
              onModeChange={onViewModeChange}
              disabled={mobileLoading}
            />

            {/* Continuous / Facing toggle */}
            <Pressable
              onPress={onToggleReadingMode}
              style={styles.headerButton}
              hitSlop={6}
            >
              <MaterialIcons
                name={
                  readingMode === "continuous" ? "view-day" : "view-carousel"
                }
                size={22}
                color={theme.text.primary}
              />
            </Pressable>

            {/* Three dots menu */}
            <Pressable
              onPress={onMenuPress}
              style={styles.headerButton}
              hitSlop={6}
            >
              <MaterialIcons
                name="more-vert"
                size={24}
                color={theme.text.primary}
              />
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mobileLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },
  mobileLoadingText: {
    marginTop: 12,
    fontSize: 15,
    color: "#fff",
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  headerButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: Spacing.xs,
  },
  headerTitle: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    textAlign: "center",
  },
  headerSubtitle: {
    fontSize: Typography.size.xs,
    marginTop: 2,
    fontWeight: Typography.weight.medium,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  saveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
    minWidth: 60,
    alignItems: "center",
  },
  saveButtonText: {
    color: Palette.white,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
  },
  centerContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing["2xl"],
  },
  loadingText: {
    fontSize: Typography.size.base,
    marginTop: Spacing.md,
  },
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
  errorActions: {
    gap: Spacing.md,
  },
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
  webview: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  webviewLoading: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  // ── Search bar ──
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 4,
  },
  searchCount: {
    fontSize: 12,
    marginRight: 4,
  },
  searchClose: {
    padding: 4,
  },
  // ── Fullscreen hint ──
  fullscreenExitHint: {
    position: "absolute",
    top: 48,
    alignSelf: "center",
    zIndex: 10,
  },
  fullscreenExitPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
    gap: 8,
  },
  fullscreenExitText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700" as const,
    letterSpacing: 0.3,
  },
});

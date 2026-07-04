# Mobile View — Architecture & Maintenance Guide

Mobile View is an **additional viewing mode** for PDF and DOCX documents that
reflows content into a responsive, typography-first reading layout — like
reading a modern web page. It never replaces the original renderers; users
switch between **Original View** and **Mobile View** from the viewer header
without reopening the document.

EPUB and PPTX have their own viewers and are **completely independent** of
this subsystem (zero imports in `app/epub-viewer.tsx` / `app/ppt-viewer.tsx`).

---

## High-level data flow

```
Document file (file:// or content://, normalized)
        │
        ▼
services/documentReflowService.ts        ← reflow engine (fully offline)
  • reflowPDF():  bundled pdf.js  → text items → line/paragraph/heading
                  reconstruction → semantic HTML (progressive, page by page)
  • reflowDOCX(): bundled Mammoth → style-mapped HTML (headings, lists,
                  tables, images as data URIs)
  • Output: ONE self-contained HTML string (vendor JS inlined, no network)
  • Document bytes: Android pages XHR them from a file:// URI inside the
    WebView (content:// documents get a cache copy first); iOS inlines
    base64. NEVER inline base64 on Android — building/staging a 30+ MB
    HTML string through the RN heap and bridge stalls, then OOM-crashes
    the app process.
        │
        ▼
utils/selectionScripts.ts (SELECTION_BRIDGE_JS)
  • injected into the HTML by MobileRenderer before loading
  • provides: text selection → offsets, highlights/underline/strikethrough,
    search (window.searchText/searchNext/searchPrev/clearSearch)
        │
        ▼
components/DocumentViewer/MobileRenderer.tsx
  • hosts the HTML in a react-native-webview
  • Android: stages the multi-MB HTML to a cache file and loads via file://
    (older System WebViews truncate large inline HTML); iOS loads inline
  • imperative handle: search, updateStyles, scrollToPercent, bridge* methods
  • blocks all non-local top-frame navigation (offline enforcement)
        │
        ▼
app/pdf-viewer.tsx  /  app/docx-viewer.tsx
  • own the ViewMode state ("original" | "mobile") and the header toggle
  • route search / annotations / Read Aloud to whichever view is active
```

### Key modules

| Module | Responsibility |
|---|---|
| `services/documentReflowService.ts` | Generate self-contained reflow HTML (PDF & DOCX); size guard; scanned-PDF detection |
| `services/mobileViewVendorLoader.ts` | Load bundled `assets/vendor/*.vlib` (pdf.js, pdf worker, Mammoth) once, cache in memory |
| `components/DocumentViewer/MobileRenderer.tsx` | WebView host + imperative API + Android file staging |
| `components/DocumentViewer/ViewModeToggle.tsx` | Header toggle + confirmation toast |
| `components/DocumentViewer/ReaderControls.tsx` | Bottom-sheet: font size, line spacing, theme (light/sepia/dark) |
| `services/readerSettingsService.ts` | Persist reader preferences (AsyncStorage) |
| `hooks/useReaderSettings.ts` | Settings state; theme follows app color scheme until user customizes |
| `utils/selectionScripts.ts` | Selection/annotation/search bridge shared by Original-DOCX and Mobile views |
| `src/types/document-viewer.types.ts` | `ViewMode`, `ReaderSettings`, `WebViewMessage`, annotation types |

---

## WebView → React Native message protocol

All messages are JSON via `window.ReactNativeWebView.postMessage`
(typed as `WebViewMessage` in `src/types/document-viewer.types.ts`):

| Type | Source | Meaning |
|---|---|---|
| `ready` | reflow HTML | Initial script ran; MobileRenderer flushes queued injections |
| `scroll` | reflow HTML | `{scrollY, scrollPercent}` (debounced 150 ms) — drives reading-progress persistence |
| `read-aloud-text` | reflow HTML | Full extracted text; **also the "render complete" signal** used to restore the carried-over reading position |
| `reflow-error` | reflow HTML | `{title, message}` — viewers auto-fall back to Original view with an alert |
| `search-count` | selection bridge | `{count, current}` for the in-viewer search bar |
| `selection` / `selection_clear` | selection bridge | Text selection with plain-text offsets + viewport rect |
| `annotation_applied` | selection bridge | Ack; on failure the viewer removes the annotation from storage |

RN → WebView is via `injectJavaScript` through the `MobileRendererHandle`
(`search`, `updateStyles`, `scrollToPercent`, `bridgeHighlight`, …).

---

## Behavior contracts

### View switching & position continuity
- **Original → Mobile (PDF):** current page is converted to a scroll %
  (`(page−1)/(total−1)`) and applied once `read-aloud-text` arrives (i.e. the
  full reflow has rendered), unless the user already scrolled.
- **Mobile → Original (PDF):** the last reported scroll % is mapped back to a
  page and passed to the native renderer via `targetPage`.
- **DOCX (both directions):** scroll % is persisted through the shared
  reading-progress service (`readingProgressService`), which both views keep
  fresh; returning to Original view re-runs its normal scroll restore.
- Reading progress from Mobile View feeds the same store used by the library
  and home screens, so progress bars stay accurate.

### Reader settings
- Defaults: 17 px font, 1.6 line height, `system-ui`, theme = app color scheme.
- User changes (ReaderControls sheet, `format-size` header button — shown only
  in Mobile View, replacing the Continuous/Facing toggle which does not apply
  there) are applied live via CSS variables (`updateStyles`) — **no
  regeneration** — and persisted app-wide via `readerSettingsService`.

### Fallbacks & guards (fail safe, never crash)
- **Size ceiling**: reflow refuses oversized files with a clear message
  (base64 inflation + inline vendor JS would risk an OOM). 25 MB normally;
  **15 MB on Android 9 and below**, whose WebView renderer often runs
  in-process with tighter memory.
- **Scanned/image-only PDFs**: detected after parse (no extractable text) →
  `reflow-error` → automatic return to Original view with an explanation.
- **Encrypted/corrupt PDFs**: pdf.js failure → same `reflow-error` fallback.
- **Vendor script can't run** (ancient frozen WebView): `pdfjsLib`/`mammoth`
  undefined → same `reflow-error` fallback.
- **Renderer process death** (legacy in-process WebView OOM):
  `onRenderProcessGone` in MobileRenderer synthesizes a `reflow-error`, so
  the user lands back in Original view instead of a dead blank view.
- **All Android versions are supported.** An earlier `< Android 10` hard gate
  was removed: it predated the `file://` staging fix (the real crash vector
  was multi-MB *inline* HTML in legacy WebViews), and the identical
  pdf.js-in-WebView workload already runs ungated on every Android version
  via `PDFTextExtractor` (Read Aloud/search pre-warm) and the DOCX Original
  view.
- **pdf.js runs in-thread** (`disableWorker`): Blob-URL workers frequently
  hang inside Android WebViews; progressive page-by-page rendering keeps
  first paint fast anyway.
- Any WebView staging failure falls back to inline HTML; any reflow failure
  leaves the user in Original view. The original renderers are never touched.

### Annotations
Highlights/underlines/strikethroughs are stored as **plain-text character
offsets** (stable across font-size/theme changes) under the file URI and are
re-applied by the bridge on every load. The in-place PDF page view uses a
separate `pageview::` storage key so page-relative offsets never collide with
reflow offsets.

---

## Performance notes
- Vendor scripts (~2 MB) load once per app session (`mobileViewVendorLoader`),
  and their `</script>`-escaping is cached by reference.
- PDF text extraction renders progressively — page 1 appears while the rest
  parses; large PDFs never block the UI thread (parsing happens inside the
  WebView, not the RN JS thread).
- Reflow HTML is generated lazily on first toggle and cached per document
  open (`state.mobileHtml`); style changes reuse it via CSS variables.
- On Android the HTML is written to `cacheDirectory/mobileview/` and deleted
  on unmount/replacement.

## Known limitations / future improvements
- PDF reflow is **text-first**: embedded images, complex tables, and
  multi-column semantics are flattened to paragraphs (the toggle toast says
  "Plain text reflow"). DOCX preserves images/tables/lists via Mammoth.
- Page ↔ scroll mapping is proportional, i.e. approximate for documents with
  very uneven page densities.
- OCR for scanned PDFs is out of scope (falls back to Original view).
- Returning to Original view restores the page but not the pinch-zoom level —
  the native PDF view remounts (preserving zoom would require changes to the
  shared `PdfViewer` wrapper, deliberately left untouched).
- `ReaderControls` uses a light-styled sheet in all app themes.

## Testing checklist (regression)
1. PDF & DOCX: toggle Original ↔ Mobile repeatedly — position survives.
2. Search in both views (count, next/prev, clear on close).
3. Highlight/underline/strikethrough in Mobile View; reopen → still applied.
4. Reader settings: change font/spacing/theme in PDF → also active in DOCX.
5. Scanned PDF → auto-fallback alert; >25 MB file → "too large" message.
6. Read Aloud from both views; Chat with File; Share; Edit File.
7. EPUB and PPTX open and behave exactly as before (no shared code paths).

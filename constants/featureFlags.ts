/**
 * Feature flags for optional UI enhancements.
 *
 * Each flag is a simple boolean constant. Set to `false` to revert the
 * associated feature globally — no other code changes required.
 */

/**
 * GLOBAL_CONTAINER_HEADERS
 *
 * Wraps every screen header in a floating card container that mirrors the
 * Bento Box / Recent Files card style (border, border-radius, margin).
 *
 * When true  → all headers render inside a rounded, bordered card.
 * When false → all headers render in their original flush layout.
 *
 * Controlled centrally via AppHeaderContainer — flipping this flag once
 * reverts every screen simultaneously without touching individual files.
 */
export const GLOBAL_CONTAINER_HEADERS = true;

/**
 * EPUB_PAGINATED_MODE
 *
 * Renders EPUBs as swipeable pages instead of one continuous scroll, by
 * switching epub.js from `flow: "scrolled-doc"` to `flow: "paginated"`.
 *
 * When true  → page-turn presentation.
 * When false → the continuous scroll the reader has always had.
 *
 * Defaults to **false**, and should stay there until it has had a testing
 * pass of its own. Pagination changes the geometry that four other features
 * are built on, each of which fails quietly rather than loudly:
 *   - Read Aloud scroll sync (the onChunkChange scroll-percentage path)
 *   - CFI-based reading-progress save and restore
 *   - Read Aloud word highlighting, which scrolls a span into view
 *   - Full-text search result navigation (epubSearch*)
 *
 * With the flag off, EPUB rendering is byte-for-byte what it was before.
 */
export const EPUB_PAGINATED_MODE = false;

// ─── Gozlin AI foundations (contract v2) ─────────────────────────────────────
// Every flag below is a kill switch. A new AI path runs only when BOTH its flag
// is true AND the backend reports the matching capability from
// GET /api/ai/status (see services/ai/capabilities.ts → canUse()). With the
// flag false the app behaves exactly as it did before the upgrade, whatever
// the backend reports.

/**
 * AI_DOCID_TASKS
 *
 * Whole-document tasks. Summarize, translate, analyze, extract tasks,
 * highlights, explain, quiz, Devil's Advocate and Narrative Arc send the
 * extracted document's `docId` (plus the user's typed text as `instruction`)
 * instead of a 15,000-character slice of its text, so the backend reads the
 * entire document. Pasted text without a document may use up to 90,000
 * characters, with a visible note when it is cut.
 *
 * When true  → docId requests when capability `docIdTasks` is live.
 * When false → the original 15,000-character text requests.
 */
export const AI_DOCID_TASKS = false;

/**
 * AI_PERSISTENT_DOC_CACHE
 *
 * Remembers uploaded documents across app launches (AsyncStorage + a cached
 * copy of the extracted text) so reopening the same file before it expires
 * makes no upload, and recovers once from DOC_NOT_FOUND by re-uploading.
 *
 * When true  → persistent cache when capability `persistentDocs` is live.
 * When false → the original 90-minute in-memory cache.
 *
 * On (verified by __tests__/docSessionCache.test.ts): re-opening a file makes
 * no upload, entries expire 10 minutes early, at most 200 are kept, and a
 * document the server lost is re-uploaded exactly once. Against a backend
 * without `persistentDocs` this changes nothing.
 */
export const AI_PERSISTENT_DOC_CACHE = true;

/**
 * AI_CITATIONS_V2
 *
 * Tappable citations. `[n]` markers in document answers render as chips and a
 * "Sources" list appears under the answer; tapping one jumps to the page,
 * chapter or slide in the reader.
 *
 * When true  → chips + Sources list when capability `citationsV2` is live.
 * When false → the original "📌 Sources" text block.
 */
export const AI_CITATIONS_V2 = false;

/**
 * AI_STREAMING
 *
 * Streams Chat with File, Gozlin chat and reader-panel answers token by token
 * over server-sent events instead of waiting for the whole answer.
 *
 * When true  → streaming when capability `streamChat` / `streamChatDocument`
 *              is live, falling back to the normal request on any early failure.
 * When false → the original single request with a spinner.
 */
export const AI_STREAMING = false;

/**
 * AI_MARKDOWN
 *
 * Keeps headings, lists, bold text and tables in free-text answers and renders
 * them with components/ai/MarkdownText. Structured renderers, QC Insights and
 * quickChat keep stripping Markdown either way.
 *
 * When true  → formatted answers when capability `markdown` is live.
 * When false → Markdown is stripped from every answer, as before.
 */
export const AI_MARKDOWN = false;

/**
 * AI_READER_PANEL
 *
 * Keeps users inside the PDF / DOCX / EPUB / PPTX readers: "Ask gozlin" and
 * "Chat with File" open an in-reader AI panel (bottom sheet on iPhone, side
 * panel on wide windows) instead of navigating away.
 *
 * When true  → the in-reader panel.
 * When false → the original navigation to /gozlin and /chat-with-document.
 */
export const AI_READER_PANEL = false;

// ─── Reader upgrade (R1 / R2 / R3) ───────────────────────────────────────────
// Saved Pages and reading sessions are fully on-device — no backend, no
// capability. Proofread additionally needs the backend to report
// `capabilities.proofread` (see services/ai/capabilities.ts → canUse()).
// Every flag below is a kill switch: false restores today's behavior exactly.

/**
 * SAVED_PAGES
 *
 * Save the page you are on instead of screenshotting it. Saved pages are
 * browsable as pages on /saved-pages, ranked by how often you return to them,
 * and they keep working after the source file is deleted — the excerpt, the
 * location label and the file name are all denormalized into the record at
 * save time (services/savedPagesService.ts), so nothing the list renders
 * needs the file, the file index or the network.
 *
 * When true  → Bookmark in each reader's three-dots menu, a
 *              selection-toolbar entry, and the Bookmarks chip in the Library
 *              filter row — which is the ONLY way into /saved-pages. There is
 *              deliberately no Tools tile and no Library header button: one
 *              entry point, not three.
 * When false → none of the above exists and nothing is written to
 *              @wordsinscribed/saved_pages_v1.
 *
 * Note the split between label and id: the feature is called BOOKMARKS
 * everywhere the user can see it, but the tool id "bookmarks" was already
 * taken by the PDF table-of-contents tool in app/tool-processor.tsx (and
 * components/editor/ has its own BookmarkModal), so the id stays
 * `saved-pages` and the route stays `/saved-pages`. Renaming either would
 * collide; renaming neither is invisible to the user.
 */
export const SAVED_PAGES = true;

/**
 * SAVED_PAGES_THUMBNAILS
 *
 * Whether a bookmark also keeps a PICTURE of the page.
 *
 * PDFs are rasterised by the pdf.js pass that already fetches the page text
 * (components/DocumentViewer/PDFTextExtractor.tsx → `imagePage`), so the cost
 * is one bitmap on a document load that was happening anyway. Reflow formats
 * have no rasteriser and store the visible region's HTML instead — see
 * services/savedPageSnapshotStore.ts.
 *
 * This was false while the pdf.js host page inlined the whole PDF as base64,
 * which made rasterising a page of a 300-page book a plausible OOM. That host
 * page now uses the same byte delivery as Mobile View (Android XHRs the
 * file:// URI; iOS inlines, as WKWebView handles that well), so the hazard is
 * gone. Unrelated to ENABLE_INPLACE_PDF_SELECTION, which stays false.
 *
 * When false → no image or HTML snapshot is requested or written; bookmarks
 *              are text-only and every screen renders exactly as before.
 */
export const SAVED_PAGES_THUMBNAILS = true;

/**
 * READING_SESSIONS
 *
 * Honest per-file, per-day reading time (services/readingSessionService.ts)
 * and a "continue where you left off" card.
 *
 * PREMIUM, and a Gozlin feature: the card lives at the top of Gozlin
 * WorkSpace → Progress, which is already inside <PremiumGate>, and the two
 * settings rows are hidden from non-subscribers. Reminders re-check the
 * subscription themselves (readingReminderService) so a lapsed subscription
 * stops the nudges. The TRACKING itself is unconditional — it is invisible,
 * it feeds the existing Progress dashboard, and gating it would make the
 * dashboard's totals depend on subscription state.
 *
 * Replaces the four duplicated 20-second heartbeats in the PDF / EPUB / DOCX /
 * PPTX viewers with one hook (hooks/useReadingSession.ts) that additionally
 * requires recent activity before crediting a beat, so a phone lying face-up
 * on a table stops earning reading time. It still calls bumpReadingTime() with
 * the same totals, so the workspace Progress dashboard reads identically.
 *
 * When true  → the shared hook, the activity guard, the resume card in
 *              WorkSpace → Progress, and two new settings rows.
 * When false → each viewer keeps its original heartbeat effect verbatim, there
 *              is no card, no new settings rows, and nothing is written to
 *              @wordsinscribed/reading_sessions_v1.
 */
export const READING_SESSIONS = true;

/**
 * AI_PROOFREAD
 *
 * Grammarly-style spelling / grammar / clarity marks inside the document
 * editors, with one-tap accept.
 *
 * PREMIUM. ProofreadController checks the subscription once, high up, so a
 * free user gets no marks, no injection and no request — the local pass
 * (utils/localProofread.ts) included, even though it is pure and offline.
 * The service layer keeps the local pass ungated because it is also the
 * fallback the remote half merges into; the premium decision lives in the
 * one component that mounts any of it.
 *
 * The network half additionally needs the backend to report capability
 * `proofread`. Without it a subscriber still gets the offline rules, which
 * is most of the perceived speed.
 *
 * When true  → proofreading for subscribers; the remote half joins in when
 *              capability `proofread` is live.
 * When false → no proofread UI anywhere and no request is ever sent.
 */
export const AI_PROOFREAD = true;

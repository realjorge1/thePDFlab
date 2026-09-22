# Reader upgrade: app agent

Read this whole prompt before you start.

You are the senior mobile engineer on this upgrade. The app is Expo SDK 54, React Native 0.81 (New Architecture), React 19, expo-router 6 and TypeScript 5.9. The main target is iPhone 16 on iOS 18, and Android must keep working. Work like the lead who owns production: small reversible steps, check everything, never guess.

---

## 0. Mission

Three reader features, built on top of infrastructure the app already has:

- **R1 — Saved Pages.** A reader hits an important page and screenshots it. Instead, they save the page. Saved pages are browsable as *pages*, not as files, ranked by how often the user returns to them, and they keep working **after the source file is deleted from the app and from the device**.
- **R2 — Reading sessions.** "You spent 40 minutes reading *Thermodynamics, Ch. 4* on Friday — continue where you left off?" Per-file, per-day reading time, an honest resume card, and an opt-in nudge.
- **R3 — Proofread.** A Grammarly-style spelling/grammar/clarity pass inside the document editors, with inline marks and one-tap accept.

R1 and R2 are **fully on-device**. They need no backend at all. R3 needs one new backend route; a separate backend agent is building it against the contract in section 4.

**A fourth idea (offline Whisper dictation) is explicitly out of scope.** Do not touch `services/whisperService.ts`, `components/VoiceInputButton.tsx` or `app/voice-to-document.tsx`. Do not add an audio dependency.

---

## 1. Rules you must not break

1. **Today's behavior is the fallback for everything.** Every new path is gated by a feature flag in `constants/featureFlags.ts`. R3 is additionally gated by the backend capability from `GET /api/ai/status`. If a flag (or, for R3, the capability) is off, the app behaves **exactly** as it does today.
2. **Don't delete or rename** exported functions, types, routes or screens. Add new code next to the old.
3. **The working tree already holds a large amount of uncommitted work that isn't yours** (read-aloud, library, QC calculators, EPUB, settings, AI tests, and staged deletions of `app/qr-code.tsx` and `components/qc/tools/LotToLotTool.tsx`). Don't revert, reformat, stage, stash or commit it. Don't commit or push anything; leave your changes uncommitted for review. Don't run repo-wide formatters.
4. **Every backend call goes through `resilientFetch` / `resilientUpload` / `resilientStream`** in `config/api.ts`. Never call a backend URL with raw `fetch`. **Never add backend warm-up or keep-alive pings**; the owner keeps servers warm externally. This applies to R3's proofread calls.
5. **Leave `ENABLE_INPLACE_PDF_SELECTION = false`** in `app/pdf-viewer.tsx`. Turning it on crashed the app on a real device: the pdf.js text layer inlines the whole PDF as base64 and runs out of memory. R1 must not turn it on, and must not depend on it.
6. **Leave `EPUB_PAGINATED_MODE` as it is.** R1's EPUB locator must work with the flag in its current state.
7. **Don't regress the Progress dashboard.** `services/workspaceInsightsService.ts` owns the reading-time total shown in the workspace. After R2, that total must read the same as it does today for the same amount of reading (see R2.2).
8. **No new npm dependency** unless you've confirmed it supports React 19, RN 0.81 and the New Architecture, and you explain why in your report. R1/R2/R3 as specified need **zero** new dependencies. If you conclude R1 phase 2 needs `react-native-view-shot`, stop and ask first.
9. **`crypto-js` is NOT a declared dependency.** `services/pdfThumbnailService.ts` imports it anyway (it resolves only as a transitive dependency and could vanish on any lockfile change). Do not import `crypto-js` in new code. Use the dependency-free hash already in `services/fileIndexService.ts` (`generateFileId`). Note the pre-existing import in your report; don't fix it as part of this work.
10. **No secrets in the app.** Every `EXPO_PUBLIC_*` value ships inside the binary and is public.
11. **The live Gozlin screens are in `app/`** (`app/gozlin.tsx`, `app/gozlin-workspace.tsx`). The files `components/ai/gozlin*.tsx` are old copies. Confirm with a search that nothing imports them, then leave them alone.
12. **Stop and ask instead of guessing** when:
    - the contract in section 4 can't work as written;
    - a change would alter the paywall or purchase flow;
    - R1 phase 2 (page images) can't be done within rule 5 and rule 8;
    - a test that passed at baseline starts failing and you can't fix it within your own change.

---

## 2. Before you change anything

1. Run these and save the output as your baseline: `npx tsc --noEmit`, `npm test`, `npm run lint`. Some may already fail; you answer only for **new** failures.
2. Read these files in full:
   - `services/readingProgressService.ts`, `services/viewerStorageService.ts`, `services/workspaceInsightsService.ts`
   - `services/fileIndexService.ts`, `services/contextAwarenessService.ts`, `services/predictiveRankingService.ts`, `services/knowledgeDecayService.ts`
   - `services/notificationService.ts`, `services/settingsService.ts`
   - `app/pdf-viewer.tsx`, `app/docx-viewer.tsx`, `app/epub-viewer.tsx`, `app/ppt-viewer.tsx`
   - `components/DocumentViewer/ThreeDotsMenu.tsx`, `components/DocumentViewer/SelectionToolbar.tsx`, `components/DocumentViewer/PDFTextExtractor.tsx`
   - `components/editor/WebEditor.tsx`, `components/editor/DocumentContext.tsx`, `components/editor/EditorToolbar.tsx`
   - `services/documentReflowService.ts`, `services/pdfTextLayerHtml.ts`, `services/pdfThumbnailService.ts`
   - `config/api.ts`, `services/ai/capabilities.ts`, `services/ai/ai.service.ts`, `services/ai/ai.types.ts`, `services/ai/aiErrors.ts`, `services/ai/premiumGuard.ts`
   - `constants/featureFlags.ts`, `app/_layout.tsx`, `app/(tabs)/tools.tsx`, `app/favorites.tsx`
3. Confirm the facts in section 3 still hold (code may have moved). Report any that don't.

---

## 3. What the code does today (checked 2026-09-22)

**Reading position and time**

- `services/readingProgressService.ts` persists one AsyncStorage map under `@wordsinscribed_reading_progress`, keyed by **file URI**, holding `{ progress, lastReadAt, currentPage?, totalPages?, source }`. It has an in-memory cache, a 400 ms debounced write and a pub/sub channel. This is the best template in the repo for a new local store — copy its shape.
- `services/workspaceInsightsService.ts` `bumpReadingTime(ms)` (line ~132) accumulates **one global counter** under `@wordsinscribed/ws_reading_time_v1` as `{ totalMs, updatedAt }`. It caps each call at 5 minutes. **It does not know which file, and it does not bucket by day.**
- A 20-second heartbeat calls `bumpReadingTime(BEAT_MS)` from four viewers, gated on `AppState.currentState === "active"`: `app/pdf-viewer.tsx` ~L385–388, `app/epub-viewer.tsx` ~L155–158, `app/docx-viewer.tsx` ~L279–282, `app/ppt-viewer.tsx` ~L11–14. The four effects are near-identical copies. The final partial interval before unmount is lost, and time is credited even if the user hasn't touched the screen.
- `services/contextAwarenessService.ts` `recordDocumentOpen()` counts opens per file under `@wordsinscribed/ws_context_v1` (max 200 tracked). `app/pdf-viewer.tsx` ~L294 calls it.
- `services/predictiveRankingService.ts` blends recency / frequency / review / centrality with a `WEIGHTS` object summing to 1. Copy this pattern for ranking, don't invent another.
- `services/knowledgeDecayService.ts` already computes what to resurface from reading progress. `BOOK_DONE = 0.9` in `workspaceInsightsService.ts` is the existing "finished" threshold.

**Readers and locators**

- Viewers accept only the params `uri` and `name`.
- PDF uses native `react-native-pdf` with `onPageChanged` (`handlePageChanged`, wired at `app/pdf-viewer.tsx` ~L2315 and ~L2355). `state.pageInfo.current` / `.total` hold the page. In Original view **there is no WebView**, so nothing on screen can be rasterised from JS.
- `components/DocumentViewer/PDFTextExtractor.tsx` is a hidden 0-height WebView that runs bundled pdf.js via `generatePdfTextExtractionHtml()` and returns **per-page text** through `onPageTexts` / `onProgress`. It is already used by Read Aloud. This is your PDF excerpt source for R1 — it is proven and does not require Mobile View.
- `services/pdfTextLayerHtml.ts` paints pages to `<canvas>` with pdf.js (lines ~236–245) and is fully offline (`assets/vendor/*.vlib` via `services/mobileViewVendorLoader.ts`). It inlines the whole PDF as base64, which is the crash in rule 5.
- EPUB reports `{ cfi, percentage, chapter, total }` from epub.js `relocated` (`app/epub-viewer.tsx` ~L696–704) and restores by CFI (`savedCfiRef`, ~L424, ~L917). `goToCfi(cfi)` exists in the injected script (~L726).
- DOCX/Mobile View is reflow HTML in a WebView (`services/documentReflowService.ts`) with a scroll-percentage position (`getScrollPosition` / `setScrollPosition` in `viewerStorageService.ts`).
- `services/pdfThumbnailService.ts` is a **stub**: `generatePlaceholderThumbnail` (~L138–160) writes a 1×1 gray JPEG, and it caches into `FileSystem.cacheDirectory`, which the OS evicts. **Do not build R1 on it.**

**Annotations and lists**

- `services/viewerStorageService.ts` stores highlights, underlines and strikethroughs **per file** under `@viewer_highlights_<uri>` etc. Good pattern, wrong keying for R1 (see R1.1).
- `app/favorites.tsx` is the closest existing template for a standalone list screen (header container, gradient header, `PINGate`, FlatList, theme).
- New routes must be registered as a `<Stack.Screen name="…" />` in `app/_layout.tsx` (~L188–233). File-based routing alone is not how this app does it.
- `app/(tabs)/tools.tsx` has `DEDICATED_SCREEN_TOOLS` (~L108–115) mapping a tool id to a route, and a `TOOLS_NEEDING_PDF` set (~L85–105) for tools that must be given a file first.

**Naming collision — important**

- The tool id `"bookmarks"` is **already taken**: it means "Add Bookmarks / table of contents" in `app/tool-processor.tsx` (~L105, ~L177, ~L929) and appears in `TOOLS_NEEDING_PDF`. `components/editor/` also has a `BookmarkModal` for authoring bookmarks into a document. R1 must therefore be called **Saved Pages**, id `saved-pages`, route `/saved-pages`. Do not use the word "bookmark" for any new identifier, route or storage key.

**Editors (R3's surface)**

- `components/editor/WebEditor.tsx` is a `contenteditable` WebView, `spellcheck="true"` at ~L180 (so the OS already draws red squiggles today — R3 must not break that).
- It posts messages via `rn({type:…})` (~L831) and receives injected JS. `SAVE_CONTENT` returns `{ html, text }` (~L821); `CONTENT_CHANGE` reports word/char counts (~L818); `SELECTION_STATE` reports formatting (~L812).
- **Selection is fragile by design.** The comment at ~L19–24 documents that toolbar taps blow away the WebView selection, so the editor saves the range on every `selectionchange` (~L211) and restores it before commands. R3 must not disturb that mechanism.
- Editor hosts: `app/create-blank-docx.tsx` and `app/create-blank-pdf.tsx`, both via `components/editor/DocumentContext.tsx`.
- `app/gozlin-workspace.tsx` notes are plain RN `<TextInput multiline>` (~L1334, ~L1591). **A plain TextInput cannot render inline underlines** — R3 there is a suggestion list, never squiggles.

**AI plumbing (R3)**

- `services/ai/capabilities.ts` holds `AICapabilityKey`, `AICapabilities`, `DEFAULT_AI_CAPABILITIES`, `BOOLEAN_KEYS`, `canUse(flag, key)`, `canUseAsync`. Adding a capability means touching all four of those.
- `config/api.ts` `API_ENDPOINTS.AI` lists the AI routes. `resilientFetch` attaches the C3 headers (`X-App-Key`, `X-User-Id`, `X-Client-Version`, `X-Request-Id`) automatically for any `/ai/*` path.
- `services/ai/aiErrors.ts` has `AIError` with codes `NETWORK | TIMEOUT | CANCELLED | UNAUTHORIZED | PREMIUM_REQUIRED | RATE_LIMITED | DOC_NOT_FOUND | UNAVAILABLE | SERVER | BAD_OUTPUT`, and `services/ai/aiErrorPresenter.ts` is the shared presenter.
- `services/ai/premiumGuard.ts` `assertAIPremium()` must be called by every user-facing AI operation.
- `AI_PERSISTENT_DOC_CACHE` is the only AI v2 flag currently `true`; the rest await device QA. Structured renderers live in `components/ai/renderers/`.
- Jest via `jest-expo`; `__tests__/` contains the existing suite plus new untracked AI tests.

---

## 4. Proofread contract (shared by the app agent and the backend agent)

> This section is word-for-word identical in the app prompt and the backend prompt. Build against it exactly. If something in it can't work, **stop and report the problem** instead of inventing a variation, because the other agent is building against the same text.

### P1. Compatibility

1. `POST /api/ai/proofread` is a **new** route. Nothing existing changes. Every other endpoint, field and status code is untouched.
2. The app calls it only when `canUse(AI_PROOFREAD, "proofread")` is true — the feature flag is on **and** `GET /api/ai/status` reported `capabilities.proofread === true`. A missing capability means `false` and the feature stays invisible.
3. The route sits under `/api/ai/`, so it carries the existing C3 headers (`X-App-Key`, `X-User-Id`, `X-Client-Version`, `X-Request-Id`) and obeys the existing `authMode` rules (`off` / `monitor` / `enforce`) and the existing error bodies for `UNAUTHORIZED`, `PREMIUM_REQUIRED` and `RATE_LIMITED`.
4. `GET /api/ai/status` adds `proofread` to its `capabilities` object. It is `true` only when the route is deployed and a model is configured for it.

### P2. Request

```json
POST /api/ai/proofread
{
  "blocks": [
    { "id": "b1", "text": "The data shows that recieve rates are up. it is unclear why." }
  ],
  "language": "auto",
  "dialect": "us",
  "goals": ["spelling", "grammar", "punctuation"]
}
```

| Field | Required | Rules |
|---|---|---|
| `blocks` | yes | 1–20 items. Each `id` is a non-empty string, unique within the request, at most 64 chars. Each `text` is 1–4,000 chars. Total `text` across all blocks at most 20,000 chars |
| `language` | no | `"auto"` (default) or a BCP-47 tag such as `"en"`, `"en-GB"`, `"fr"` |
| `dialect` | no | `"us"`, `"uk"` or `null` (default `null`) |
| `goals` | no | Any subset of `spelling`, `grammar`, `punctuation`, `clarity`, `tone`. Default `["spelling","grammar","punctuation"]` |

A request over any limit returns `400 { "success": false, "code": "BAD_REQUEST", "error": "…" }`. The app splits work to stay inside the limits and never relies on server-side splitting.

### P3. Response

```json
{
  "success": true,
  "task": "proofread",
  "data": {
    "blocks": [
      {
        "id": "b1",
        "language": "en",
        "suggestions": [
          {
            "id": "s1",
            "type": "spelling",
            "original": "recieve",
            "replacement": "receive",
            "occurrence": 1,
            "before": "shows that ",
            "reason": "Common misspelling of \"receive\".",
            "confidence": 0.99
          },
          {
            "id": "s2",
            "type": "punctuation",
            "original": "it",
            "replacement": "It",
            "occurrence": 1,
            "before": "are up. ",
            "reason": "Sentences start with a capital letter.",
            "confidence": 0.95
          }
        ]
      }
    ]
  }
}
```

| Field | Rules |
|---|---|
| `blocks` | One entry per requested block, **same `id`s, same order**. A block with nothing to fix returns `"suggestions": []` — never omitted |
| `language` | The detected language of that block, BCP-47 |
| `id` | Unique within its block |
| `type` | `spelling`, `grammar`, `punctuation`, `clarity`, `tone` or `style` |
| `original` | **An exact, verbatim substring of that block's `text`**, including case and internal whitespace. 1–200 chars |
| `replacement` | The text to substitute. May be `""` to delete. At most 400 chars |
| `occurrence` | 1-based index of **which** occurrence of `original` inside the block this refers to |
| `before` | The up-to-32 characters of the block's `text` immediately preceding that occurrence (`""` at the start of the block). A disambiguation aid, not a locator |
| `reason` | One short sentence, at most 140 chars, plain text, no Markdown |
| `confidence` | Number in `0..1` |

### P4. Rules that make this safe

These exist because language models do not return reliable character offsets. **There are no offsets anywhere in this contract, by design.**

1. **The server verifies every suggestion against the block text before returning it.** `original` must occur in `text` at least `occurrence` times. Any suggestion failing that check is **dropped silently** — never returned, never repaired by guessing.
2. **The server computes `occurrence` and `before` itself** from the verified match position. It does not pass through model-supplied values for those two fields.
3. **No two returned suggestions in the same block may overlap.** When spans overlap, the server keeps the higher `confidence` (ties: the earlier start) and drops the other.
4. **`replacement` must differ from `original`.** Identical pairs are dropped.
5. **Caps:** at most 50 suggestions per block and 200 per response. Excess is dropped lowest-confidence first.
6. **Determinism.** The same request body must produce the same response. The model runs at temperature 0, and the server caches responses keyed by a hash of the normalized block text plus `language`, `dialect`, `goals`, model id and prompt version.
7. **The app locates each suggestion client-side** by searching the block text for `original` and taking the `occurrence`-th match, using `before` only to break ties when the counts disagree. If the app cannot locate a suggestion, it **discards it** and shows nothing.

### P5. Latency, size and errors

1. This is a **high-frequency, low-latency** route, not a document task. The server answers within **15 seconds**; the app allows **20 seconds** per attempt and never the 180 s document-task budget.
2. Rate limits are **tighter than the other AI routes** and are their own bucket, keyed by `X-User-Id`. Over the limit returns the existing `429 RATE_LIMITED` body with `retryAfterSec` and a `Retry-After` header.
3. If the model's output cannot be made valid after one retry, the route returns `500 { "success": false, "code": "AI_BAD_OUTPUT", "error": "…" }`, matching the existing convention for JSON tasks.
4. `502 / 503 / 504 / 521–524` are returned only when the server genuinely cannot serve the request, so the app's failover pool works unchanged.
5. **Silence is the correct failure mode for a background check.** On any error from an automatic (debounced) check, the app shows no message at all. Only an explicit "Check document" surfaces an error, through the existing `aiErrorPresenter`.

### P6. Rollout order

1. The backend deploys to both servers with `capabilities.proofread` reporting only what is really live.
2. The app release that uses it ships next, and works against both old and new backends.
3. `AI_PROOFREAD` is flipped to `true` only after the acceptance checks in R3 pass.

---

## 5. Feature flags

Add these to `constants/featureFlags.ts`, in the same doc-comment style as the existing flags. Each starts `false` while you build its workstream, and you set it to `true` at the end of that workstream **only after its acceptance checks pass**. Each flag is a kill switch: `false` must restore today's behavior exactly.

| Flag | Workstream | Starts |
|---|---|---|
| `SAVED_PAGES` | R1 Saved Pages | `false` |
| `SAVED_PAGES_THUMBNAILS` | R1 phase 2, page images | `false` — leave it `false`, see R1.6 |
| `READING_SESSIONS` | R2 reading sessions | `false` |
| `AI_PROOFREAD` | R3 proofread | `false` |

R3 also needs a capability. In `services/ai/capabilities.ts` add `"proofread"` to `AICapabilityKey`, to the `AICapabilities` interface, to `DEFAULT_AI_CAPABILITIES` (as `false`) and to `BOOLEAN_KEYS`. Nothing else in that file changes.

---

## 6. Workstreams

Do them in this order. **R0 first** — R1 and R2 both depend on it, and building it twice is the main way this upgrade goes wrong.

### R0: One shared file identity

**Goal:** a key that identifies "this document" across URI changes, re-downloads, SAF `content://` paths, and deletion of the file itself.

**Why:** today everything keys on the raw file URI. URIs are not stable — the app copies files into its cache directory, SAF hands out re-encoded `content://` URIs (see the `reEncodeSafDocumentUri` helper duplicated in `services/doclib/database.ts` and `safBridge.ts`), and a re-downloaded book gets a new path. R1 must survive all of that *and* outlive the file.

1. Add `services/fileIdentity.ts`:

```ts
export interface FileIdentity {
  /** Stable composite key. This is what new stores persist. */
  key: string;
  /** Hash of the current URI, for cross-referencing the file index. */
  fileId: string;
  /** Last known URI. Informational — may be stale or dead. */
  uri: string;
  name: string;
  ext: string;
  size?: number;
  mtime?: number;
}

export async function getFileIdentity(uri: string, name?: string): Promise<FileIdentity>;
export function identityKeyFrom(name: string, size?: number): string;
```

2. **Key rule:** `key` is derived from the lowercased, whitespace-trimmed **file name plus the byte size**. It must **not** include the URI, the directory, or the mtime. When size is unknown, fall back to name alone and mark it lower-confidence in a comment.
   - Reuse the dependency-free string hash from `generateFileId` in `services/fileIndexService.ts`. **Do not import `crypto-js`** (rule 9).
   - Document the accepted trade-off in the file header: two genuinely different files with the same name *and* identical byte size collide. That is rare and preferable to losing every saved page when a URI changes.
3. Read size/mtime via `expo-file-system/legacy` `getInfoAsync`, the variant this repo uses. Never throw: a missing or unreadable file yields an identity with `size`/`mtime` undefined.
4. Add a small resolver `resolveIdentityToLiveUri(key)` that looks the key up against `getAllFiles()` from `fileIndexService` and returns a currently-valid URI, or `null` when the file is gone. R1 and R2 both need it to answer "can I still open this?".

**Acceptance:**
- Unit tests in `__tests__/fileIdentity.test.ts`: the same file at two different URIs yields one `key`; a `content://` URI and its re-encoded form yield one `key`; a missing file still yields a usable identity; identical names with different sizes yield different keys.
- No new dependency, and no `crypto-js` import.

---

### R1: Saved Pages

**Goal:** save a page, browse saved pages as pages, ranked by return visits, working forever regardless of the source file.

**Ship it in two phases. Phase 1 is text-only and is the deliverable. Phase 2 (images) is flagged off and may be left unfinished.**

#### R1.1 The store

Add `services/savedPagesService.ts`, modelled on `readingProgressService.ts` (in-memory cache + debounced write + pub/sub), **not** on `viewerStorageService.ts`.

- **One flat AsyncStorage key**, `@wordsinscribed/saved_pages_v1`, holding an array. Per-file keying (`@viewer_highlights_<uri>`) is wrong here: the whole point is that these outlive the file.
- Every displayable field is **denormalized into the record at save time**. After saving, rendering the list must require no access to the source file, the file index, or the network.

```ts
export type SavedPageLocatorType = "page" | "slide" | "sheet" | "chapter" | "section";

export interface SavedPage {
  id: string;                   // uuid
  identityKey: string;          // from R0
  fileName: string;
  fileExt: string;
  fileUriAtSave: string;        // informational only; may be dead
  locatorType: SavedPageLocatorType;
  page?: number;                // page/slide/sheet/section index, 1-based
  totalPages?: number;
  cfi?: string;                 // EPUB
  scrollPct?: number;           // reflow/DOCX fallback
  chapterLabel?: string;        // "Chapter 4", "Slide 7"
  excerpt: string;              // captured at save time, <= 600 chars
  note?: string;                // user's own note, <= 500 chars
  thumbPath?: string;           // phase 2 only
  createdAt: number;
  openCount: number;
  lastOpenedAt: number | null;
}
```

- Reuse the `locatorType` vocabulary from the AI contract (`page` / `slide` / `sheet` / `chapter` / `section`) so location labels read consistently with citations everywhere else in the app.
- **Retention cap:** at most 500 saved pages. At the cap, refuse the save with a clear message and a link to manage them — **never silently evict a user's saved page**. (This is the opposite of the eviction policy for caches; these are user data.)
- API: `savePage(input)`, `getSavedPages(sort)`, `getSavedPage(id)`, `updateNote(id, note)`, `recordOpen(id)`, `removeSavedPage(id)`, `subscribeSavedPages(listener)`, `preloadSavedPages()`.
- `removeSavedPage` must also delete any phase-2 thumbnail file.

#### R1.2 Ranking

`getSavedPages(sort)` takes `"frequent" | "recent" | "added"`, default `"frequent"`.

- `"frequent"` is a **blend**, not a raw `openCount` sort. A page saved yesterday and not yet reopened has `openCount === 0` and must not sink to the bottom of the list. Copy the `WEIGHTS` approach from `predictiveRankingService.ts`:
  - `opens` — normalized `openCount`
  - `recencyOfOpen` — decay on `lastOpenedAt`
  - `recencyOfSave` — decay on `createdAt`, so new saves surface
- Put the weights in one exported, commented object summing to 1. Pure function, no I/O — so it is unit-testable.
- The UI exposes all three sorts in a visible segmented control. Don't make the blend the user's only option.

#### R1.3 Capturing a save

Add a **Save Page** action in each reader, behind `SAVED_PAGES`:

- A new item in `components/DocumentViewer/ThreeDotsMenu.tsx` (follow the existing `items` array shape; the `isStarred` item shows how to render a toggle label — the Save Page item toggles to "Saved ✓" / "Remove saved page" when the current location is already saved).
- Plus a direct control in the reader chrome, for the one-tap case that replaces a screenshot. Place it so it **never overlaps the page indicator or the Read Aloud bar**.
- When text is selected, `components/DocumentViewer/SelectionToolbar.tsx` gains a "Save page" entry that seeds `excerpt` from the selection.

Excerpt capture, per format:

| Format | Locator | Excerpt source |
|---|---|---|
| PDF | `page`, from `state.pageInfo.current` / `.total` | Selection if any; otherwise **`components/DocumentViewer/PDFTextExtractor.tsx`** for that page's text, trimmed to 600 chars. Mount it on demand with `active` and unmount after; do not keep it running |
| EPUB | `chapter` + `cfi` + `chapterLabel` | Selection if any; otherwise the visible text from the epub.js rendition via the existing message bridge. Add a message type alongside `location` — don't repurpose it |
| DOCX / Mobile View | `section` + `scrollPct` | Selection if any; otherwise the visible reflow text via the WebView bridge |
| PPTX | `slide` | Slide title/body text if the viewer has it; otherwise `""` |

- An empty `excerpt` is acceptable and must render cleanly ("No text captured"). Never block a save on excerpt capture, and never make the user wait on it: save immediately with what you have, then fill the excerpt in asynchronously and notify subscribers.
- Confirm the save with the existing lightweight feedback used elsewhere in the readers (`expo-haptics` plus a brief toast). No modal, no `Alert`.

#### R1.4 The Saved Pages screen

- New route `app/saved-pages.tsx`. Register it as `<Stack.Screen name="saved-pages" />` in `app/_layout.tsx`.
- Use `app/favorites.tsx` as the structural template: `AppHeaderContainer`, `GradientView` header, `useTheme`, FlatList (or `@shopify/flash-list`, already a dependency, if the list gets long).
- Each row shows: the location label ("Page 12", "Chapter 4", "Slide 7"), the file name, the excerpt (2–3 lines), the user's note if any, relative save date, and return count.
- **Group by file, with the group order driven by the chosen sort** — the user's mental model is "the pages I keep going back to", and a flat list of 200 page cards is unreadable. Groups collapse; the file name is the group header and shows a "file no longer available" badge when `resolveIdentityToLiveUri` returns `null`.
- Search over `fileName`, `excerpt`, `note` and `chapterLabel`. Reuse the search-field styling from `favorites.tsx`.
- Entry points: a tile on the Library tab **and** an entry in `DEDICATED_SCREEN_TOOLS` in `app/(tabs)/tools.tsx` as `"saved-pages": "/saved-pages"`. It takes no file input, so **do not** add it to `TOOLS_NEEDING_PDF`.
- Respect `PINGate` the way `favorites.tsx` does if saved pages fall under an existing screen lock; if they don't, say so in your report rather than adding a new lock.

#### R1.5 Reopening, including when the file is gone

Tapping a saved page:

1. `recordOpen(id)` first, so ranking updates even if the open fails.
2. `resolveIdentityToLiveUri(identityKey)`. If it returns a URI, navigate to the right viewer with the existing `uri` / `name` params, then jump to the location: PDF by page, EPUB via `goToCfi(cfi)`, reflow via `setScrollPosition`.
3. If it returns `null`, open a **read-only detail view** of the snapshot: excerpt, note, location label, original file name, save date, thumbnail if present. Offer "Find this file" (the existing file picker) which, on a match, re-links the record by updating `fileUriAtSave`. Offer "Delete saved page".
4. **Never dead-end and never crash.** A missing file is a normal state in this feature, not an error.

#### R1.6 Phase 2: page images (leave `SAVED_PAGES_THUMBNAILS = false`)

Do **not** ship this on. Build the storage plumbing, then stop and report.

- Images go in `FileSystem.documentDirectory` + `saved-pages/`. **Never `cacheDirectory`** — the OS evicts it, which breaks the core promise of the feature. Do not reuse `services/pdfThumbnailService.ts`: it is a stub that writes 1×1 gray placeholders into the cache directory.
- Budget: at most ~100 MB and ~500 images, JPEG quality ~0.7, longest edge ~1200 px. Downscale with `expo-image-manipulator` (already a dependency).
- The only route consistent with rule 5 is rendering **one page** in a short-lived hidden WebView with the bundled pdf.js and `canvas.toDataURL("image/jpeg", 0.7)`, at DPR 1. The machinery is in `services/pdfTextLayerHtml.ts` (~L236–245).
- **The blocker:** that path inlines the whole PDF as base64, which is exactly the memory crash behind rule 5. Doing this properly means first changing the pdf.js host page to **stream the PDF by URL** instead of inlining base64. That is a real piece of work with device-crash risk, and it also unblocks `ENABLE_INPLACE_PDF_SELECTION` later.
- So: implement the storage, write-path and cleanup; leave the capture unimplemented behind the flag; and in your report state plainly what the base64→URL change would involve. **Do not attempt the streaming change in this workstream, and do not add `react-native-view-shot` without asking** (rules 8 and 12).

**Acceptance (R1):**
- Save a page in a PDF, an EPUB and a DOCX. All three appear on `/saved-pages` with the right location label and a non-empty excerpt.
- Delete the source file from the app **and** from the device. The saved pages still render fully, are still searchable, and open the snapshot view with a working "Find this file".
- Move/re-download a file so its URI changes. Its saved pages still resolve and still jump to the right location.
- Reopen the same saved page four times; it rises under "Most visited" and the count shows 4.
- With `SAVED_PAGES = false`: no menu item, no reader control, no tools entry, no library tile, and nothing written to AsyncStorage.
- Unit tests: `__tests__/savedPages.test.ts` (save/read/remove, the 500 cap refusing rather than evicting, note updates, `recordOpen`) and `__tests__/savedPagesRanking.test.ts` (the blend; a never-opened recent save outranks a stale once-opened one; all three sorts are stable and total-ordered).

---

### R2: Reading sessions and "continue where you left off"

**Goal:** honest per-file, per-day reading time, and a resume card that earns trust.

#### R2.1 The store

Add `services/readingSessionService.ts`.

- AsyncStorage key `@wordsinscribed/reading_sessions_v1`.
- Buckets are `{ identityKey, day, ms, opens, lastPageLabel? }` where **`day` is the local calendar date as `YYYY-MM-DD`**. Derive it from the device's local time, never from a UTC ISO slice — otherwise "Friday" is wrong for anyone reading in the evening. State this in a comment; it is the single easiest bug to introduce here.
- **Rolling 90-day window**, pruned on load. Per-file-per-day rows grow without bound otherwise (365 rows per file per year), and this app has no SQLite — every local store is an AsyncStorage JSON blob.
- API: `startSession(identity)`, `noteActivity()`, `endSession()`, `getDayTotals(day)`, `getFileTotals(identityKey)`, `getResumeCandidate()`, `subscribeReadingSessions(listener)`.

#### R2.2 Replace the four heartbeats with one hook

- Add `hooks/useReadingSession.ts` exposing `useReadingSession({ uri, name })`, which returns a `noteActivity` callback.
- It replaces the four duplicated `BEAT_MS` effects in `app/pdf-viewer.tsx`, `app/epub-viewer.tsx`, `app/docx-viewer.tsx` and `app/ppt-viewer.tsx`. Behind `READING_SESSIONS`; with the flag off, keep the existing effect exactly as it is (keep both paths in the file rather than rewriting the effect in place).
- **It must also call `bumpReadingTime(ms)`** with the same total it credits, so `services/workspaceInsightsService.ts` and the Progress dashboard read identically to today for the same reading (rule 7). Don't change `bumpReadingTime`'s signature; don't remove its 5-minute-per-call cap.
- Session boundaries: start on mount/focus, end and **flush** on blur, unmount, and every `AppState` change away from `active`. The current heartbeat loses the final partial interval; a claim of "40 minutes" can't afford that.

#### R2.3 The honesty guard (do not skip this)

The existing heartbeat credits time whenever a viewer is mounted and the app is foregrounded — **including a phone lying face-up on a table**. If the app tells a user they read for 40 minutes when they left the app open over lunch, they will stop believing the whole feature.

- Only credit a beat when `noteActivity()` has fired within the last **60 seconds**. Wire it to page changes, scroll, and touches in each viewer — page-change callbacks already exist (`handlePageChanged`, the epub.js `relocated` bridge, the reflow scroll handler).
- Read Aloud is the deliberate exception: while it is actively speaking, that counts as activity even with no touches. Check the existing read-aloud state in each viewer rather than adding a new global.
- Keep the 5-minute-per-beat ceiling.
- Put the rule in one commented constant so it can be tuned without hunting through four viewers.

#### R2.4 The resume surface

- `getResumeCandidate()` returns the best "continue reading" candidate, or `null`. Combine `readingSessionService` totals with `readingProgressService` (which already holds `currentPage` / `progress` / `lastReadAt`, and which the viewers already restore).
- **Exclusions:** progress `>= 0.9`, sessions under 2 minutes, and anything whose file no longer resolves via R0.
  - Use the existing threshold rather than defining a second one: `BOOK_DONE = 0.9` already exists in `services/workspaceInsightsService.ts` (~L27) but is **module-private**. Export it (an additive change, rule 2) and import it. Do not copy the literal `0.9` into a new file — two thresholds that can drift apart is exactly how the resume card and the Progress dashboard start disagreeing about which books are finished.
- Copy: `"You spent 40 minutes reading <name> on Friday"` — use the weekday name within the last 7 days, then "last week", then the date. Round to whole minutes; show "a few minutes" under 2. Never show seconds, and never show a number the guard in R2.3 didn't actually earn.
- Home-tab card in `app/(tabs)/index.tsx`, above Recent Files. Follow the existing `settings.hideRecentFiles` pattern (`services/settingsService.ts`) for hideability — add `hideContinueReading: boolean` to `AppSettings` and `DEFAULT_SETTINGS` (default `false`), and a Settings toggle next to the existing one.
- Tapping it opens the file at the stored position — reuse `readingProgressService`'s restore path; don't write a second one.

#### R2.5 The optional nudge

- **Opt-in, default off.** Add `readingReminders: boolean` to `AppSettings` / `DEFAULT_SETTINGS` (default `false`) and a Settings toggle with copy that says plainly what it does.
- Use `services/notificationService.ts` with the existing `task_reminder` type and `scheduleTaskReminder`. These are **local scheduled notifications only** — no push infrastructure, no backend, no new permission beyond the `POST_NOTIFICATIONS` already declared in `app.json`.
- Hard limits: at most **one per day**; never for a finished book; never for a file that no longer resolves; never within 3 hours of the user actually reading. Cancel any pending reminder when the user opens the file.
- If notification permission is absent, no-op silently — the existing service already behaves this way; don't add a prompt or an `Alert`.

**Acceptance (R2):**
- Read a PDF for ~3 minutes with normal page turns, leave, and come back: the home card names that file with a plausible minute count and the correct weekday.
- Open a file, don't touch the screen for 5 minutes: **almost no time is credited**. Then start Read Aloud and leave it speaking for 2 minutes: that time **is** credited.
- Background the app mid-read: the partial interval is flushed, and no time accrues while backgrounded.
- Finish a book past 90%: it never appears as a resume candidate and never triggers a reminder.
- The workspace Progress dashboard's reading-time total moves by the same amount it would have before this change.
- With `READING_SESSIONS = false`: the four viewers use their original heartbeat, no home card, no new settings rows, nothing written to the new key.
- Unit tests `__tests__/readingSessions.test.ts`: local-day bucketing across a UTC midnight boundary (fake a non-UTC timezone and assert the bucket is the local date); the 60-second activity guard; flush-on-background; 90-day pruning; `getResumeCandidate` exclusions.

---

### R3: Proofread

**Goal:** spelling, grammar and clarity marks inside the document editors, with one-tap accept, fast enough to feel local.

#### R3.1 Local pass first

Before any network code, add `utils/localProofread.ts` — a pure, dependency-free, synchronous pass over a block of text returning the **same suggestion shape** as P3.

Cover: double spaces, space before `,` `.` `;` `!` `?`, missing space after a sentence-ending period, missing capital at sentence start, standalone lowercase `i`, doubled words (`the the`), unbalanced quotes/brackets, straight vs. curly quotes, and multiple trailing punctuation.

- Runs with **no flag, no network, no premium gate, and no backend** — it is not an AI feature.
- This is most of the perceived value and all of the perceived speed. Ship it working before touching the endpoint.
- Every rule is unit-testable. Do that.

#### R3.2 The service

Add `services/ai/proofread.service.ts`:

- `proofreadBlocks(blocks, opts)` calling `API_ENDPOINTS.AI.PROOFREAD` (add `PROOFREAD: \`${API_BASE_URL}/ai/proofread\`` to the `AI` group in `config/api.ts`) through **`resilientFetch`**, with a **20,000 ms** timeout per P5.1. Not 180 s. No warm-up pings (rule 4).
- Gate with `canUse(AI_PROOFREAD, "proofread")` and `assertAIPremium()`, like every other AI operation.
- Enforce the P2 limits **client-side**: chunk into at most 20 blocks and 20,000 chars per request, and split any block over 4,000 chars at a sentence boundary. Never rely on the server to split.
- **Locate suggestions client-side, per P4.7.** Search the block text for `original`, take the `occurrence`-th match, use `before` to break ties when counts disagree, and **discard** anything you can't locate. Never trust a model-supplied position; there are no offsets in the contract.
- Merge local (R3.1) and remote suggestions, dropping remote ones that overlap a local one.
- **Cache by content hash**: `sha`-style hash of the normalized block text plus options → suggestions, in memory, capped (~200 entries). Users re-check the same paragraph constantly; without this the endpoint gets hammered.
- Parse defensively and validate every field against P3 before use — same discipline as the existing `normalizeDevilsAdvocate` / `normalizeNarrativeArc` normalizers. A malformed response yields zero suggestions, never a crash and never a partially-applied edit.

#### R3.3 The editor surface

In `components/editor/WebEditor.tsx` and `components/editor/DocumentContext.tsx`, behind `AI_PROOFREAD`:

1. **Blocks are paragraphs.** Add an injected function that walks the editor's block-level children and returns `[{ id, text }]`, where `id` is a stable per-paragraph id stamped as a `data-` attribute (mint it once, keep it across edits). Post it up as a new message type.
2. **Check only what changed.** Debounce **1,500–2,000 ms** after typing stops, and send **only paragraphs whose text hash changed** since their last result. Never check on every keystroke — that cannot work over a hop to a free-tier host, and it will get the endpoint rate-limited. A "Check document" toolbar action checks everything in chunks with visible progress.
3. **Rendering marks.** Draw marks inside the WebView by wrapping located ranges in a `<span class="pf pf-spelling">` with a coloured underline, via `Range` + `surroundContents` on a text-node walk.
   - Marks are **decoration only**: they must never change the document's text, and they must be **fully stripped before `SAVE_CONTENT` / export**. Add an explicit `__pf_clearMarks()` and call it before every save, export and print path. Verify by saving a marked document and diffing the HTML against the unmarked save — **put that diff in your report**.
   - Keep the native `spellcheck="true"` (~L180) on. Two underline styles coexisting is fine; silently losing the OS one is not.
   - **Do not disturb the selection save/restore mechanism** (~L19–24, ~L211). Marking must not move the caret or drop the user's selection. This is the single most likely regression in this workstream — test it explicitly by marking while text is selected.
4. **Accept / dismiss.** Tapping a mark opens a small card: `original` → `replacement`, `reason`, and Accept / Dismiss / "Dismiss all of this type".
   - Accept replaces exactly the located range, then **re-anchors or invalidates the remaining suggestions in that paragraph**, because every offset after the edit has shifted. Simplest correct approach: drop the paragraph's other suggestions and re-check it on the next debounce. Do not try to shift positions arithmetically.
   - Accept must be a **single undoable step** in the editor's existing `_hist` undo stack (~L263–307). Verify undo restores the original word.
   - Dismissals persist per paragraph hash for the session so a dismissed suggestion doesn't reappear on the next debounce.
5. **A summary panel** listing suggestions grouped by type, with counts and "Accept all" per type. Follow `components/ai/renderers/` conventions if you render it through that family.
6. **Where it does and doesn't go.** Wire it into `app/create-blank-docx.tsx` and `app/create-blank-pdf.tsx`. In `app/gozlin-workspace.tsx` the notes are plain RN `<TextInput>` (~L1334, ~L1591), which **cannot** render inline underlines — if you add it there at all, use a suggestions sheet below the field. **Do not** add proofreading to `pdf-viewer` / `docx-viewer` / `epub-viewer`: they are read-only.

#### R3.4 Failure behavior

- An automatic (debounced) check that fails shows **nothing at all** (P5.5). No toast, no banner, no spinner left behind. The local pass from R3.1 keeps working, so the feature degrades to "fewer suggestions", not "broken".
- Only an explicit "Check document" surfaces an error, via the existing `services/ai/aiErrorPresenter.ts`.
- `RATE_LIMITED` additionally **pauses automatic checking** for `retryAfterSec`; explicit checks still respect the presenter's message.
- Expect the first check after an idle period to be slow (free-tier cold start; `wakeUpBackend` already budgets up to ~65 s for health). That must never block typing or freeze the editor — all checking is off the critical path.

**Acceptance (R3):**
- Type "The data shows that recieve rates are up. it is unclear why." — both the misspelling and the missing capital get marked; accepting each fixes exactly that word and nothing else; undo restores it.
- Repeated words: in "the cat sat on the mat and the mat was flat", a suggestion targeting the second "mat" lands on the second "mat", not the first. **Test this specifically** — it is what `occurrence` exists for.
- Accept one suggestion in a paragraph with four; the other three either re-anchor correctly or vanish and come back correctly on re-check. **No suggestion ever applies to the wrong span.**
- Save a marked document: the saved HTML is byte-identical to saving the same document unmarked.
- Marking while text is selected does not move the caret or clear the selection; toolbar formatting still works immediately afterwards.
- Airplane mode: the local pass still marks double spaces and lowercase `i`, and no error appears.
- With `AI_PROOFREAD = false`, or with the backend reporting `proofread: false`: no proofread UI anywhere, no request ever sent, and the editors behave exactly as today.
- Unit tests: `__tests__/localProofread.test.ts` (every rule, plus no false positives on ordinary prose), `__tests__/proofreadLocate.test.ts` (occurrence matching, `before` tie-breaks, unlocatable suggestions discarded, overlap resolution), `__tests__/proofreadParse.test.ts` (malformed, partial and hostile responses yield zero suggestions and never throw).

---

### R4: Regression list

At the end, each of these must work with all flags on and all flags off:

- All four readers: open, page/chapter navigation, position restore, search, highlights/underlines/strikethroughs, Read Aloud (including the bar's layout against any new reader control), reader settings, Mobile View toggle, three-dots menu items.
- The workspace Progress dashboard's reading time, books-in-progress and books-completed counts.
- Knowledge decay / resurfacing and predictive ranking surfaces.
- The document editors: every toolbar command, insert modals (including the existing `BookmarkModal`), undo/redo, save, export to DOCX/PDF, print.
- The existing `bookmarks` **PDF table-of-contents tool** in `app/tool-processor.tsx` — confirm R1 didn't shadow its id or its route.
- Recent Files on the home tab, and the `hideRecentFiles` setting.
- All AI features (Gozlin, Chat with File, Devil's Advocate, Narrative Arc, Quiz, highlights, scheduled tasks, QC Insights).

---

## 7. Tests and verification

**New Jest tests in `__tests__/`:**

| File | Covers |
|---|---|
| `fileIdentity.test.ts` | Same file at different URIs → one key; SAF re-encoding; missing file; name collisions with different sizes |
| `savedPages.test.ts` | Save/read/remove; the 500 cap refuses instead of evicting; notes; `recordOpen`; thumbnail file cleanup on remove |
| `savedPagesRanking.test.ts` | The blend; a never-opened recent save outranks a stale once-opened one; all three sorts total-ordered and stable |
| `readingSessions.test.ts` | Local-day bucketing across a UTC midnight in a non-UTC timezone; the 60-second activity guard; flush on background; 90-day pruning; `getResumeCandidate` exclusions |
| `localProofread.test.ts` | Every local rule; no false positives on ordinary prose |
| `proofreadLocate.test.ts` | Occurrence matching; `before` tie-breaks; unlocatable discarded; overlap resolution |
| `proofreadParse.test.ts` | Malformed/partial/hostile responses → zero suggestions, never throws |
| `proofreadRequest.test.ts` | Flag or capability off → no request at all; on → bodies match P2 exactly, including chunking at the 20-block / 20,000-char / 4,000-char limits |

**At the end,** run `npx tsc --noEmit`, `npm test` and `npm run lint`. There must be **no new failures** compared with your baseline.

**Device QA.** You probably can't run a physical iPhone. Write `docs/reader-upgrade/QA_CHECKLIST.md` with exact steps and expected results for iPhone 16 (iOS 18) and one Android phone on a dev-client build, following the format of `docs/ai-upgrade/QA_CHECKLIST.md`.

- Matrix: each flag on/off, old backend vs. new (R3 only), premium vs. free, online vs. airplane mode.
- Test files: a 300-page text PDF, a scanned PDF, a 40-page DOCX, a PPTX of 12+ slides, an EPUB novel, and a file opened over SAF (`content://`) on Android.
- Must include: deleting a source file from the device and confirming its saved pages survive; changing the device timezone and confirming the weekday in the resume card; watching memory in Xcode while saving pages in a large PDF; and leaving a viewer idle for 5 minutes to confirm the activity guard.

In your report, be clear about **what you verified yourself and what still needs a device**.

---

## 8. Report when you're done

1. **Owner actions first:**
   - whether `AI_PROOFREAD` can be turned on (i.e. whether the backend reports `proofread: true` yet);
   - the decision on R1 phase 2: whether to fund the pdf.js base64→URL streaming change, with your assessment of its risk;
   - any privacy-policy wording needed for document text being sent to the proofread endpoint;
   - whether reading reminders should be opt-in (as specified) or opt-out.
2. **Per workstream:** files changed, the flag's final value, what you verified, what's left.
3. **The mark-stripping diff** from R3.3.3, showing a marked save is byte-identical to an unmarked save.
4. **Baseline vs. final** results for `tsc`, tests and lint.
5. **Any fact in section 3** that turned out to be different.
6. **Storage footprint measured**, not estimated: bytes added to AsyncStorage per saved page and per file-day session row, and the projected size at 500 saved pages and 90 days of daily reading across 20 files. Flag it if the JSON-blob approach looks like it needs `expo-sqlite` sooner than expected — this app has **no SQLite installed**, and `services/doclib/database.ts` is a FileSystem/JSON store despite its name.
7. **Any place you had to deviate** from section 4. There should be none without asking first.

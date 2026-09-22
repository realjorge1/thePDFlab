# Gozlin AI foundations upgrade: app agent

Read this whole prompt before you start.

You are the senior mobile engineer on this upgrade. The app is Expo SDK 54, React Native 0.81 (New Architecture), React 19, expo-router 6 and TypeScript 5.9. The main target is iPhone 16 on iOS 18, and Android must keep working. Work like the lead who owns production: small reversible steps, check everything, never guess.

---

## 0. Mission

The AI features (Gozlin, Chat with File, and "Ask gozlin" in the readers) are built on weak foundations:

- They read only about 15,000 characters of a document (5–6 pages).
- Citations almost never show, and when they do they can't be tapped.
- There's no streaming; users wait up to 60 seconds for a spinner.
- When the server is unreachable the app shows invented "mock" answers as if they were real.
- All formatting is stripped, so lists and tables come out flat.
- Using AI takes the user out of the reader.

Your job is to fix these foundations so Gozlin holds up against Adobe Acrobat AI and WPS AI. **The unique features must keep working exactly as they do now or better:** Devil's Advocate, Narrative Arc, the grounded Quiz, semantic library search, scheduled tasks, QC Insights and topic-to-deck.

A separate backend agent is building the server half against the same contract (section 4). Until the backend reports a capability as live, the app must keep using today's behavior for it.

---

## 1. Rules you must not break

1. **Today's behavior is the fallback for everything.** Every new path is gated by (a) a feature flag in `constants/featureFlags.ts` and (b) the matching backend capability from `GET /api/ai/status`. If either is off, the app behaves exactly as it does today.
2. **Don't delete or rename** exported functions, types, routes or screens. Add new code next to the old; old functions may delegate to new code only when the flag and capability are on.
3. **The working tree already holds uncommitted work that isn't yours** (read-aloud, library, QC calculators, EPUB, settings and more). Don't revert, reformat, stage, stash or commit it. Don't commit or push anything; leave your changes uncommitted for review. Don't run repo-wide formatters.
4. **Every backend call goes through `resilientFetch`, `resilientUpload`, or the new `resilientStream`** in `config/api.ts`. Never call a backend URL with raw `fetch`. Never add backend warm-up or keep-alive pings; the owner keeps servers warm externally.
5. **Leave `ENABLE_INPLACE_PDF_SELECTION = false`** in `app/pdf-viewer.tsx`. Turning it on crashed the app on a real device: the pdf.js text layer inlines the whole PDF as base64 and runs out of memory. Citation navigation in PDFs must use page jumps and on-screen quote cards, never on-page PDF highlighting.
6. **Leave `EPUB_PAGINATED_MODE` as it is.**
7. **The live Gozlin screens are in `app/`:** `app/gozlin.tsx`, `app/gozlin-workspace.tsx` and `app/gozlin-generated-preview.tsx`. The files `components/ai/gozlin*.tsx` are old copies. Confirm with a search that nothing imports them, then leave them alone.
8. **No new npm dependency** unless you've confirmed it supports React 19, RN 0.81 and the New Architecture, and you explain why in your report. Prefer what's installed: `react-native-reanimated` 4, `react-native-gesture-handler`, and `expo/fetch`.
9. **No secrets in the app.** Every `EXPO_PUBLIC_*` value ships inside the binary and is public.
10. **Stop and ask instead of guessing** when:
    - the contract can't work as written;
    - a change would alter the paywall or purchase flow beyond W1;
    - you need the real iOS RevenueCat key;
    - a test that passed at baseline starts failing and you can't fix it within your own change.

---

## 2. Before you change anything

1. Run these and save the output as your baseline: `npx tsc --noEmit`, `npm test`, `npm run lint`. Some may already fail; you answer only for new failures.
2. Read these files in full:
   - `services/ai/ai.service.ts`, `services/ai/ai.types.ts`, `services/ai/ai.provider.ts`
   - `services/ai/providers/backend.provider.ts`, `services/ai/providers/mock.provider.ts`
   - `services/ai/premiumGuard.ts`, `services/ai/quickChat.ts`, `services/documentChatService.ts`
   - `config/api.ts`, `config/revenuecat.ts`, `context/SubscriptionContext.tsx`
   - `app/gozlin.tsx`, `app/chat-with-document.tsx`
   - `app/pdf-viewer.tsx`, `app/docx-viewer.tsx`, `app/epub-viewer.tsx`
   - `components/DocumentViewer/SelectionToolbar.tsx`, `components/DocumentViewer/ThreeDotsMenu.tsx`
   - `utils/sanitizeAiText.ts`, `constants/featureFlags.ts`, `services/activity/activityStore.ts`
3. Confirm the facts in section 3 still hold (code may have moved). Report any that don't.

---

## 3. What the code does today (checked 2026-09-13)

- **The 15k cut.** `services/ai/ai.service.ts` sets `TEXT_INPUT_LIMIT = 15_000`, and `prepareText()` cuts every document to that length before sending.
- **Markdown stripping.** In the same file, `sanitizeAIResponse` strips Markdown from every response via a `Proxy` around the provider.
- **Mock answers.** The default provider is `MockAIProvider`. `initAIProvider()` switches to `BackendAIProvider` only when `/ai/status` answers. So users who can't reach the server get invented answers from `services/ai/providers/mock.provider.ts`, presented as real.
- **Gozlin actions.** `app/gozlin.tsx` (around lines 1090–1180) builds `effectiveText` from the extracted document text plus the user's text, then calls summarize, translate, analyze and the rest with it. Chat mode sends the cut-down text to plain `/chat`, not to document search.
- **Extraction.** `extractDocumentText()` in `ai.service.ts` uploads to `/ai/extract-pdf` or `/ai/extract-document` and stores `_extractionDocId` on the document ref, in memory only. Only `generateQuiz` passes `docId` on to the backend.
- **Chat with File service.** `services/documentChatService.ts` keeps `docId` in a 90-minute in-memory cache keyed by `uri::name`. `askDocumentQuestion` calls `/ai/chat-document` with a 60-second timeout, and a 404 throws `DOCUMENT_EXPIRED`.
- **Citations.** `app/chat-with-document.tsx` (around lines 228–242) appends citations as plain text and drops any citation without a quote. The backend currently sends empty quotes, so in practice no sources show. The screen takes params `uri`, `name` and `mimeType`.
- **Backend provider.** `services/ai/providers/backend.provider.ts` has a 60-second timeout and no streaming.
  - Devil's Advocate and Narrative Arc call endpoints the backend doesn't have yet, get a 404, then retry through `/chat` using prompts built in the app (`buildDevilsAdvocatePrompt`, `buildNarrativeArcPrompt`).
  - The results are cleaned by `normalizeDevilsAdvocate` and `normalizeNarrativeArc`. **Keep those normalizers**; they're the app's safety net.
- **Failover.** `config/api.ts` `resilientFetch` retargets requests to the active backend and fails over on network errors and on 502, 503, 504 and 521–524. Its internals are `_toApiPath`, `_backendOrder`, `_applyActive` and `_persistActive`.
- **Premium override.** `config/revenuecat.ts` has `FORCE_PREMIUM_UNLOCK = true`, which bypasses every paywall and `services/ai/premiumGuard.ts`. It's read in `context/SubscriptionContext.tsx`. `REVENUECAT_IOS_API_KEY` is still the placeholder `"appl_YOUR_IOS_KEY_HERE"`.
- **Readers.**
  - `app/pdf-viewer.tsx`, `app/docx-viewer.tsx` and `app/epub-viewer.tsx` accept only the params `uri` and `name`.
  - "Ask gozlin" on a text selection calls `router.push("/gozlin", { prompt })` (pdf-viewer ~L1501, docx-viewer ~L1176, epub-viewer ~L1239), which leaves the reader. The viewers also open `/chat-with-document` from their menu (pdf-viewer ~L1030).
  - Each viewer has a working text search (`searchQuery`). PDFs use the native `react-native-pdf` renderer with `onPageChanged`.
- **Stripping helpers.** `stripMarkdown` and `deepStripMarkdown` from `utils/sanitizeAiText.ts` are also used by `quickChat.ts`, `components/qc/QCInsights.tsx`, `app/gozlin-workspace.tsx` and `documentChatService.ts`. No Markdown renderer is installed.
- **Streaming.** There's no SSE code anywhere. Expo SDK 54 includes `expo/fetch`, whose responses expose a readable body stream; confirm on a device before relying on it.
- **Tests.** Jest via `jest-expo`, with 11 test files in `__tests__/` and none covering AI.

---

## 4. API contract v2 (shared by the app agent and the backend agent)

> This section is word-for-word identical in the app prompt and the backend prompt. Build against it exactly. If something in it can't work, stop and report the problem instead of inventing a variation, because the other agent is building against the same text.

### C1. Compatibility
1. Every existing endpoint, request field, response field and status code keeps working unchanged for a client that sends none of the new headers or fields. Everything new is additive.
2. The app never assumes a v2 feature exists. It reads `GET /api/ai/status` and uses a feature only when its capability is `true`. A missing capability means `false` and the legacy path.
3. Both backends in the app's failover pool (primary and backup) run the same code and use the same document store, so a `docId` created on one works on the other.
4. The app fails over to the other backend on network errors and on HTTP 502, 503, 504, 521, 522, 523 and 524. The backend returns those only when it genuinely can't serve the request, never for an application error.
5. New error bodies (C3, C4, C8) carry `error` as a plain string plus a top-level `code`. The existing task-route error body (`error: { code, message }`) stays as it is.

### C2. Capability discovery
`GET /api/ai/status` never requires auth. It keeps its current fields (`success`, `currentProvider`, `availableProviders`, `fallbackEnabled`, `fallbackOrder`) and adds:

```json
{
  "apiVersion": 2,
  "capabilities": {
    "docIdTasks": true,
    "persistentDocs": true,
    "citationsV2": true,
    "streamChat": true,
    "streamChatDocument": true,
    "devilsAdvocate": true,
    "narrativeArc": true,
    "markdown": true,
    "authMode": "monitor"
  }
}
```

Each boolean is `true` only when that feature is deployed and working on this server (for example, `persistentDocs` is `false` when no database is configured). `authMode` is `"off"`, `"monitor"` or `"enforce"`.

### C3. Request headers, auth and rate limits
The app sends these headers on every request under `/api/ai/` (JSON and multipart):

| Header | Value |
|---|---|
| `X-App-Key` | Build-time value of `EXPO_PUBLIC_AI_APP_KEY` |
| `X-User-Id` | RevenueCat app user ID (`Purchases.getAppUserID()`); omitted only if it can't be resolved |
| `X-Client-Version` | App version, e.g. `1.0.0` |
| `X-Request-Id` | A new UUID per request |

The backend echoes `X-Request-Id` (or one it generated) as a response header.

What auth does depends on `authMode`:
- `off` checks nothing.
- `monitor` checks and logs but never blocks.
- `enforce` blocks with 401 or 403.

Rate limits apply whenever they're enabled, in any mode.

| Status | `code` | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | `X-App-Key` missing or wrong (enforce only) |
| 403 | `PREMIUM_REQUIRED` | `X-User-Id` missing or without an active `premium` entitlement (enforce only) |
| 429 | `RATE_LIMITED` | Too many requests. Body has `retryAfterSec`; response has a `Retry-After` header |

Example body: `{ "success": false, "code": "RATE_LIMITED", "error": "Too many requests. Try again in 30 seconds.", "retryAfterSec": 30, "requestId": "…" }`

### C4. Documents
`POST /api/ai/extract-document` and `POST /api/ai/extract-pdf` (multipart) share one ingestion pipeline. Both keep every field they return today and add:

```json
{
  "locatorType": "page",
  "persisted": true,
  "expiresAt": "2026-09-20T12:00:00.000Z",
  "retrievalMode": "hybrid",
  "embedding": { "provider": "openai", "model": "text-embedding-3-small", "dims": 1536 },
  "contentHash": "<sha256 hex of the uploaded file>"
}
```

- `locatorType` is one of:
  - `"page"` for PDF
  - `"slide"` for PPTX, one unit per slide
  - `"sheet"` for XLSX, one unit per worksheet
  - `"chapter"` for EPUB
  - `"section"` for DOCX, TXT, MD and CSV

  `totalPages` is the number of units of that type.
- `retrievalMode` is `"hybrid"` when the document has real embeddings. Otherwise it's `"keyword"` and `embedding` is `null`.
- `?includeFullText=0` omits `fullText`. Without it, `fullText` is returned as today.
- Uploading the same file again for the same user before it expires returns the existing `docId` without re-processing.
- Any route given an unknown or expired `docId` returns `404 { "success": false, "code": "DOC_NOT_FOUND", "error": "Document not found or expired. Please re-upload the document." }`. The app re-uploads once and retries once.
- `DELETE /api/ai/doc/:docId` removes the document permanently.

### C5. Whole-document tasks
These routes accept two optional fields, `docId` and `instruction`: `/summarize`, `/translate`, `/analyze`, `/extract-tasks`, `/highlight`, `/explain`, `/quiz`, `/devils-advocate` and `/narrative-arc`.

- **With `docId`**, the backend loads the full stored document and processes all of it, splitting long documents into parts and merging the results. `text` is not used as document content. `instruction` (at most 2,000 characters) is the user's extra request, such as "focus on the risks".
- **Without `docId`**, behavior is exactly today's.
- `/devils-advocate` and `/narrative-arc` also accept `contextDocId` in place of `contextText`.
- Response shapes stay the same, and `data` gains:
  - `format`: `"markdown"`, `"text"` or `"json"`
  - `coverage`: `{ "totalChars": 812345, "processedChars": 812345, "chunked": true, "chunkCount": 14, "truncated": false }`
- `/translate` with `docId` translates the document part by part, in order, and joins the parts. If the output would pass the server's limit, it stops at a part boundary and sets `coverage.truncated: true`.
- A long document can take up to 180 seconds. The app allows 180 seconds per attempt for requests that include `docId`.

### C6. Chat with a document
`POST /api/ai/chat-document` keeps its body (`docId`, `question`, `history`) and its response fields (`question`, `answer`, `citations`, `found`, `retrievedChunks`, `docMeta`), with these changes and additions:

- `answer` is Markdown (C9) with inline markers `[1]`, `[2]` that refer to `citations[].id`.
- `citations` has this shape:

```json
[
  {
    "id": 1,
    "page": 12,
    "locator": { "type": "page", "index": 12, "label": "Page 12" },
    "quote": "Exact text copied from the document, at most 300 characters.",
    "chunkId": 7
  }
]
```

- `page` always equals `locator.index` (kept for older app builds). `locator.type` matches the document's `locatorType`.
- The server checks every `quote` against the stored document text, ignoring differences in whitespace, quote marks, dashes and hyphenation.
  - Citations that fail the check are dropped, and their markers are removed from `answer`.
  - The remaining ids are renumbered 1..n in order of first appearance.
- `found` is `false` when the document doesn't contain the answer, and then `citations` is `[]`.
- Adds `retrieval: { "mode": "hybrid" | "keyword", "embeddingProvider": "openai" | null }` and `format: "markdown"`.

`POST /api/ai/ask-pdf` returns `citations` and `format` in the same shape.

### C7. Streaming
Two new endpoints (the non-streaming ones stay):
- `POST /api/ai/chat-document/stream`, same body as `/chat-document`
- `POST /api/ai/chat/stream`, same body as `/chat`

Anything that fails before streaming starts (auth, validation, rate limit, `DOC_NOT_FOUND`) returns a normal JSON error with its HTTP status.

On success, the response is `200` with `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`. Each event is `event: <name>`, then `data: <one line of JSON>`, then a blank line:

| Event | `data` | Notes |
|---|---|---|
| `meta` | `{ "requestId": "…", "retrieval": { … } }` | Always first. `retrieval` only on chat-document |
| `delta` | `{ "text": "…" }` | Markdown to append. May include `[n]` markers that are later dropped |
| `citations` | `{ "citations": [ … ] }` | Once, after the last `delta`, chat-document only. Same shape as C6 |
| `done` | `{ "answer": "…", "citations": [ … ], "found": true }` | Always last on success. `answer` is final: the app replaces the streamed text with it |
| `error` | `{ "code": "…", "message": "…" }` | Ends the stream. The app may keep text already shown |

The server sends a comment line `: ping` every 15 seconds. If the client disconnects, the server stops the model call. A `404` from a `/stream` URL means the server doesn't support streaming, and the app falls back to the non-streaming endpoint.

### C8. Devil's Advocate and Narrative Arc
`POST /api/ai/devils-advocate`
- Body: `text?`, `docId?`, `instruction?`, `documentName?`, `role?`, `customRole?`, `contextText?`, `contextDocId?`, `contextName?`.
- `role` is one of `auto`, `investor`, `client`, `procurement`, `peer-reviewer`, `opposing-counsel`, `stakeholder`, `cfo`, `evaluation-committee`, `custom`.

`POST /api/ai/narrative-arc`
- Body: `text?`, `docId?`, `instruction?`, `documentName?`, `format?` (`pptx`, `docx` or `pdf`), `contextText?`, `contextDocId?`, `contextName?`.

Success response for both: `{ "success": true, "task": "devils-advocate" | "narrative-arc", "data": { "text": "<one-line summary>", "json": { … }, "format": "json", "coverage": { … } } }`

Devil's Advocate `data.json`:

```json
{
  "detectedRole": "Skeptical Investor",
  "roleKey": "investor",
  "documentType": "Pitch Deck",
  "killerObjections": [{ "title": "", "detail": "", "severity": "critical", "reference": "Slide 7" }],
  "secondaryChallenges": [{ "title": "", "detail": "", "severity": "medium" }],
  "blindSpots": [{ "text": "", "why": "" }],
  "groundedObjections": [{ "claim": "", "evidence": "", "source": "" }],
  "rfpCoverage": [{ "criterion": "", "status": "covered", "note": "" }]
}
```

- `severity` is `critical`, `high` or `medium`.
- Counts: 3–5 `killerObjections`, 3–6 `secondaryChallenges`, 2–4 `blindSpots`.
- `reference` names a real location ("Slide 7", "Page 2", "Section 3") or is `""`.
- `groundedObjections` and `rfpCoverage` appear only when a context document is given. Their `status` is `covered`, `missing` or `partial`.

Narrative Arc `data.json`:

```json
{
  "verdict": "weak",
  "verdictLine": "",
  "detectedType": "Business Proposal",
  "diagnosis": "",
  "idealStructure": [""],
  "detectedSections": [{ "title": "", "index": 1, "role": "", "status": "ok" }],
  "reorder": [{ "instruction": "", "from": 3, "to": 1 }],
  "rfpCoverage": [{ "criterion": "", "status": "partial", "note": "" }]
}
```

- `verdict` is `strong`, `weak` or `broken`.
- Section `status` is `ok`, `misplaced`, `missing` or `extra`, and `index` starts at 1.
- `from` and `to` are omitted when the change isn't a simple move.
- `rfpCoverage` appears only with a context document.

If the model's output can't be made valid after one retry, the route returns `500 { "success": false, "code": "AI_BAD_OUTPUT", "error": "…" }`.

### C9. Markdown
Free-text answers (`chat`, `chat-document`, `ask-pdf`, `summarize`, `explain`, `translate`, and the `text` of `analyze`) may use only:
- `##` and `###` headings
- `**bold**` and `*italic*`
- bullet and numbered lists, one nesting level
- `> quotes` and `` `inline code` ``
- simple pipe tables
- citation markers `[n]`

No HTML, images, code blocks, or links that aren't in the document. JSON tasks are unchanged. Older app builds strip Markdown, so this doesn't break them.

### C10. Rollout order
1. The backend deploys first, to both servers, with `authMode` set to `monitor`. Capabilities report only what's really live.
2. The app release that uses these capabilities ships next. It works with both old and new backends.
3. The owner switches `authMode` to `enforce` only after logs show most requests carry a valid app key and user ID.

---

## 5. Feature flags and capability checks

Add these flags to `constants/featureFlags.ts`, in the same doc-comment style as the existing flags. Each starts as `false` while you build its workstream, and you set it to `true` at the end of that workstream only after its acceptance checks pass. **Each flag is a kill switch: `false` must restore today's behavior exactly.**

| Flag | Workstream |
|---|---|
| `AI_DOCID_TASKS` | W2 whole-document tasks |
| `AI_PERSISTENT_DOC_CACHE` | W3 document cache and recovery |
| `AI_CITATIONS_V2` | W4 tappable citations |
| `AI_STREAMING` | W5 streaming |
| `AI_MARKDOWN` | W6 formatting |
| `AI_READER_PANEL` | W7 in-reader panel |

W1 (security) and the removal of silent mock answers (W6.1) are fixes, not features. They aren't flagged.

Add `services/ai/capabilities.ts`:
- `getAICapabilities()` fetches `/ai/status` through `resilientFetch` once per app session. It re-fetches when the app returns to the foreground after 10 minutes, and after any 404 from a v2 route.
- It returns a typed object where everything defaults to `false`.
- It exports `canUse(flag, capabilityKey)`, which every new path calls.
- It never throws. On failure, all capabilities are `false`.

---

## 6. Workstreams

Do them in this order. One exception: build the Markdown renderer (W6.2) at the start of W4, because the citation chips live inside it.

### W1: Lock down access

**Goal:** no free or anonymous AI use in release builds, and the backend can identify the app and the user.

1. **Premium override.** In `config/revenuecat.ts`, set `export const FORCE_PREMIUM_UNLOCK = __DEV__ && process.env.EXPO_PUBLIC_FORCE_PREMIUM_UNLOCK === "true";`.
   - Release builds are then always `false`. Keep a comment explaining this.
   - Check that `SubscriptionContext.tsx` (initial `isPremium` / `isLoading` state) and `premiumGuard.ts` still behave correctly for real subscribers and non-subscribers.
2. **RevenueCat keys.** Check that RevenueCat is configured with the right key per platform. If the iOS key is still the placeholder, don't invent one. Put this at the top of your report: with the override off, iOS users can't subscribe until the real key is set.
3. **Request headers.** Add `services/ai/aiRequestHeaders.ts`, returning the C3 headers.
   - Resolve the RevenueCat app user ID once after `Purchases.configure` and cache it (for example with a setter called from `SubscriptionContext`, like `setAIPremiumAccess`).
   - Before the first AI request, await the ID for at most 2 seconds, then send without it.
   - Get the version from `expo-constants` (`Constants.expoConfig?.version`); check it's installed, otherwise use `expo-application`.
4. **Attach the headers to every `/ai/*` call.** Find them all by searching for `API_ENDPOINTS.AI` and `/ai/`. Known call sites:
   - `callBackend` in `backend.provider.ts`
   - `ai.service.ts`: extraction, `askPdfQuestion`, `summarizeHighlights`, `convertHighlightToTask`
   - `documentChatService.ts` and `quickChat.ts`
   - direct calls in `app/gozlin-workspace.tsx`
   - OCR in `app/scan-to-text.tsx`
   - `src/ppt-module/services/topicToDeck.service.ts`

   For `FormData` uploads, don't set `Content-Type`.
5. **Typed errors.** Add `services/ai/aiErrors.ts`:
   - `class AIError extends Error` with `code` set to one of: `NETWORK`, `TIMEOUT`, `CANCELLED`, `UNAUTHORIZED`, `PREMIUM_REQUIRED`, `RATE_LIMITED`, `DOC_NOT_FOUND`, `UNAVAILABLE`, `SERVER`, `BAD_OUTPUT`.
   - Optional fields `retryAfterSec` and `requestId`.
   - `toAIError(responseOrError)` understands both error bodies (string `error` with top-level `code`, and `error: { code, message }`) as well as plain-text bodies.
   - Map `PremiumRequiredError` to `PREMIUM_REQUIRED`, and an aborted signal to `CANCELLED`.
6. **One shared error presenter** used by every AI screen:

   | Code | What the user sees |
   |---|---|
   | `PREMIUM_REQUIRED` | The existing paywall opens |
   | `RATE_LIMITED` | "You're going a bit fast. Try again in N seconds." |
   | `UNAUTHORIZED` | "Please update the app to keep using Gozlin." |
   | `NETWORK`, `UNAVAILABLE`, `TIMEOUT` | "Gozlin can't reach the server. Check your connection and try again." with a Retry button |
   | `CANCELLED` | No message |

**Acceptance:**
- With `__DEV__` false, a non-subscriber sees the premium gates, and AI calls throw `PREMIUM_REQUIRED` before any network request.
- Every `/ai/*` request carries the four headers (unit tests on the header builder and on `callBackend`).
- Against today's backend, which ignores the headers, everything works as before.

### W2: Process the whole document (stop the 15k cut)

**Goal:** document features read the entire document whenever the backend supports it.

1. **Send `docId` instead of text.** In `ai.service.ts`, when `canUse(AI_DOCID_TASKS, "docIdTasks")` and the doc ref has `_extractionDocId`, send `{ docId, instruction }` (C5) instead of `text`. This applies to summarize, translate, analyze, extractTasks, highlight, explain, quiz, devilsAdvocate and narrativeArc.
   - Add an optional `timeoutMs` to `callBackend` and use 180,000 ms for these calls.
   - Add optional `docId`, `instruction` and `contextDocId` fields to the request types in `ai.types.ts`.
2. **Gozlin actions.** In `app/gozlin.tsx`, when the above applies, pass the `docId` and the user's typed text as `instruction`, instead of building `effectiveText` from document text plus user text. Otherwise keep `effectiveText` exactly as it is.
3. **Gozlin chat with an attached document.** When `AI_DOCID_TASKS` is on and a `docId` exists, answer through `askDocumentQuestion` (document search, and citations per W4) instead of `/chat` with cut-down text. If that call fails for any reason other than `CANCELLED`, fall back to today's `/chat` call once.
4. **Pasted text, no document.** With the flag on, raise the limit from 15,000 to 90,000 characters (the backend rejects more than 100,000). If text is cut, show a visible note: "Only the first 90,000 characters were used." Never cut silently.
5. **Honest legacy path.** When a document goes down the legacy path (capability off) and was cut, show: "Gozlin read the first part of this document (about N pages)."
6. **Coverage note.** When a response has `coverage.truncated: true`, show "Gozlin covered about X% of this document."
7. **Secondary callers.** In `components/workspace/aiActions.ts`, `app/gozlin-workspace.tsx` and `services/scheduledTasks/executor.ts`, pass `docId` where the action works on a picked file. Leave free-form prompts alone.

**Acceptance:**
- For a 300-page text PDF, the request body contains `docId` rather than text, and the summary reflects the final chapters (manual check).
- With the flag or capability off, request bodies are identical to today's (unit test on the request builders).
- The pull-down cancel still aborts the request.

### W3: Keep documents available (the app side of "fix document search")

The backend is making documents persistent and shared across both servers. The app must stop re-uploading and must recover when a document is gone.

1. **Persistent cache.** Add `services/ai/docSessionCache.ts`, used only when `canUse(AI_PERSISTENT_DOC_CACHE, "persistentDocs")`; otherwise keep today's in-memory cache.
   - Store `{ docId, expiresAt, locatorType, retrievalMode, totalPages, fileType }` in AsyncStorage.
   - Key it by `uri + name + size + modificationTime` from `expo-file-system` (the repo uses `expo-file-system/legacy`).
   - Treat entries as expired 10 minutes before `expiresAt`. Keep at most 200 entries and evict the oldest.
2. **Reuse extracted text.** `extractDocumentText` also returns the full text used by legacy flows. Save it to `FileSystem.cacheDirectory + "ai-doc-text/"` keyed like the cache entry. On a cache hit with the text file present, skip the upload; if the file is missing, extract again.
3. **Recovery helper.** Add `withDocRecovery(docRef, fn)`. On `DOC_NOT_FOUND` it:
   - removes the cache entry,
   - re-uploads silently while showing "Reloading document…",
   - retries once, and never loops.

   Use it for chat-document, ask-pdf, `docId` tasks, and streams before their first byte.
4. **Chat with File.** In `app/chat-with-document.tsx`, handle `DOC_NOT_FOUND` through the helper instead of checking the `DOCUMENT_EXPIRED` string. A 404 from an old backend maps to `DOC_NOT_FOUND` too.
5. **No early uploads.** Upload only when the user first asks Gozlin something, never just because a reader opened.

**Acceptance:**
- Re-opening the same file before expiry makes no upload request.
- A mocked 404 triggers one re-upload and then an answer; a second 404 shows an error, not a loop.
- Unit tests cover expiry, eviction and the single retry.

### W4: Citations users can tap

1. **Types and parser.** Define `AICitation`:

   ```ts
   AICitation {
     id: number;
     page: number;
     locator?: { type: "page" | "slide" | "sheet" | "chapter" | "section"; index: number; label: string };
     quote: string;
     chunkId?: number;
   }
   ```

   The parser accepts both the old shape (`{ page, quote }`) and C6. It builds a label when `locator` is missing ("Page N", or "Chapter N" for EPUB).
2. **Rendering**, only when `canUse(AI_CITATIONS_V2, "citationsV2")`:
   - Stop appending the "📌 Sources" text block.
   - Render `[n]` markers inside the answer as small tappable chips through `MarkdownText`'s `onCitationPress`. A marker with no matching citation is removed.
   - Under the answer, add a "Sources" list: label plus quote, clamped to 2 lines, expanding on tap.
   - Otherwise keep today's rendering.
3. **One navigator.** Add `services/ai/citationNavigator.ts` as the single entry point for taps:
   - **Inside a reader (W7 panel):** move the current viewer to the location, shrink the panel to its peek height, and show a "Source" card above the panel with the label and quote. The card closes on tap or after 6 seconds.
   - **PDF:** jump to `locator.index` using the viewer's existing page navigation (find how `react-native-pdf` pages are set today). No on-page highlighting (rule 5). Optionally, run the viewer's existing search with a distinctive 6–10-word run from the quote, so the search panel highlights the snippet, but only if that doesn't reload the PDF or reset the page.
   - **EPUB:** use the existing full-text search to find the quote and navigate to the match; fall back to the chapter index.
   - **DOCX:** use the existing search to scroll to the first match; if there's no match, show the Source card only.
   - **PPTX:** go to slide `index` if the live PPTX viewer supports it; otherwise show the Source card.
   - **XLSX, TXT and anything else:** Source card only.
   - **From Chat with File, outside a reader:** open the matching viewer with new optional params `locatorType`, `locatorIndex` and `quote`. Each viewer acts on them after its document has loaded, and only if they're present. Missing params mean today's behavior.
4. **Quote matching.** Add `utils/quoteMatch.ts`:
   - Case-insensitive; collapse whitespace; normalize curly quotes, dashes and ligatures; remove soft hyphens and words hyphenated across line breaks.
   - Try the full quote first, then the longest 8–12-word window.
   - Return `null` when nothing matches, and never throw.

**Acceptance:**
- An answer with three citations shows three chips and three sources, and each tap lands on the right page, chapter or slide.
- The old backend's citation shape causes no crash and falls back to legacy rendering.
- Unit tests cover the parser and the quote matcher: hyphenation, curly quotes, partial match and not found.

### W5: Stream answers

1. **Streaming transport.** In `config/api.ts`, add `resilientStream(input, init, { connectTimeoutMs, idleTimeoutMs })` next to `resilientFetch`, reusing `_toApiPath`, `_backendOrder`, `_applyActive` and `_persistActive`.
   - It uses `fetch` from `expo/fetch`.
   - It fails over only until response headers arrive. Once a 200 stream has started, it never fails over, because that would duplicate the answer.
   - A non-2xx response before the stream is parsed as JSON into an `AIError`.
   - `idleTimeoutMs` (45 seconds with no bytes; pings reset it) aborts the request.
   - A caller abort cancels without failover.
2. **SSE parser.** Add `utils/sseParser.ts`, an incremental parser that:
   - handles chunks split at any point, including in the middle of a multi-byte character. Confirm `TextDecoder` with `{ stream: true }` is available under Hermes on RN 0.81; if not, write a small streaming UTF-8 decoder with tests.
   - handles `\n` and `\r\n`, multi-line `data:`, comment lines starting with `:`, and `event:` names;
   - ignores unknown events.
3. **Streaming clients.** Add `services/ai/streamingChat.ts` with `streamDocumentChat({ docId, question, history, signal, onMeta, onDelta, onCitations })` and `streamChat(...)`. Each resolves with the `done` payload.
4. **UI** in Chat with File, Gozlin chat and the W7 panel:
   - Create the assistant message immediately with a typing indicator.
   - Batch deltas into at most one state update about every 50 ms, so only the streaming bubble re-renders.
   - On `done`, replace the text with `done.answer` and attach the citations.
   - Keep the pull-down cancel (`runCancelable`) wired to the AbortController. A cancel keeps the partial text, marked "Stopped".
5. **Fallbacks.**
   - If the flag or capability is off, the stream URL returns 404, or anything fails before the first `delta`, call the non-streaming endpoint once.
   - If a failure comes after text has arrived, keep the partial text and show "Answer interrupted · Retry".
6. **iOS lifecycle.** iOS may suspend the connection when the app goes to the background. On return to the foreground (`AppState`), if the stream has died, show Retry rather than hanging.
7. **Accessibility.** Don't announce each delta. When `done` arrives, call `AccessibilityInfo.announceForAccessibility("Answer ready")`.

**Acceptance:**
- Text starts appearing as soon as the first delta arrives.
- Scrolling stays smooth during a long answer on iPhone.
- Cancel stops network traffic.
- Airplane mode in the middle of a stream shows Retry.
- An old backend still answers.
- Unit tests cover the SSE parser and `resilientStream`'s failover rules.

### W6: Stop faking answers and keep the formatting

1. **Mock answers.**
   - The default provider becomes `BackendAIProvider`, wrapped by the same `Proxy`. Remove the silent fallback to mock: if `/status` fails, keep using the backend provider (`resilientFetch` already fails over), and let failures surface as `AIError` with the W1 messages and a Retry button.
   - Keep `MockAIProvider` only when `__DEV__ && process.env.EXPO_PUBLIC_AI_MOCK === "true"`, and prefix every mock answer with "[Demo response] ".
   - If `/status` reports no provider configured, show "Gozlin is temporarily unavailable."
   - Check that every AI caller handles a thrown error without crashing or leaving a spinner running: Gozlin, Gozlin Workspace, Chat with File, QuizPanel, `services/scheduledTasks/executor.ts` (it must record a failure, not mark the task done), QCInsights and topic-to-deck. `quickChat` and semantic search already return `null` on failure; keep that.
2. **Formatting.**
   - Build `components/ai/MarkdownText.tsx`, a small renderer for exactly the C9 subset:
     - themed with `useTheme`, respecting Dynamic Type (`allowFontScaling`), with selectable text;
     - tables in a horizontal `ScrollView`;
     - citation markers through an `onCitationPress` prop;
     - tokens parsed once per text change (memoized);
     - malformed input (an unclosed `**`, a ragged table) rendered as literal text, never a crash.
   - **Switch every screen that shows free-text AI answers to `MarkdownText` before you stop stripping Markdown for it.** Otherwise users will see raw `**`. Find them all; they include `components/ai/AIChatBubble.tsx`, `components/ai/renderers/ExplainRenderer.tsx`, the Chat with File bubbles, the Gozlin result views and the W7 panel.
   - Then, when `canUse(AI_MARKDOWN, "markdown")`, the sanitizing `Proxy` stops stripping `content` for free-text tasks (chat, chat-document, ask-pdf, summarize, explain, translate, and analyze text).
   - Keep `deepStripMarkdown` on `structuredData`, and keep stripping in `quickChat` (it parses lists), `QCInsights` and the structured renderers.
   - Copy to clipboard copies clean text (`stripMarkdown`), not raw Markdown.
   - Saved sessions in `@wordsinscribed/ai_sessions` from before the change hold plain text and must still display correctly.

**Acceptance:**
- An unreachable backend shows a clear error with Retry, never invented text (Jest test on provider selection).
- A heading, list, bold text and a table render correctly in light and dark mode and at the largest Dynamic Type size.
- Malformed Markdown doesn't crash (renderer unit tests).

### W7: Keep users in the reader

1. **The panel.** Build `components/ai/ReaderAIPanel.tsx`:
   - **On iPhone:** a bottom sheet with three states: hidden, peek (about 40% of the screen) and expanded (about 90%).
   - **On iPad, or any window at least 768 pt wide:** a panel of about 380 pt on the right, beside the document.
   - Build it with the installed `react-native-reanimated` and `react-native-gesture-handler`.
   - Respect safe areas (Dynamic Island, home indicator), keep the input visible above the keyboard, and honor Reduce Motion.
   - **Contents:** a document chat thread (streaming per W5, citations per W4, Markdown per W6) and quick actions: Summarize (with `docId`), Explain selection, Translate selection and Ask about selection. The selected text appears as a quoted chip above the input.
   - Wrap the panel in an error boundary. If it crashes, it closes and shows a short toast, and the reader keeps working.
   - Use the same premium gate as the other AI features.
   - Extraction starts the first time the user sends something in the panel, using the W3 cache.
2. **Mount it** in `app/pdf-viewer.tsx`, `app/docx-viewer.tsx`, `app/epub-viewer.tsx` and the live PPTX viewer. Check which EPUB and PPTX screens the router actually renders (`src/screens/EpubViewerScreen.tsx`, `features/pptxViewerOnline/…`, `src/ppt-module/…`) and mount in those. Behind `AI_READER_PANEL`:
   - "Ask gozlin" in the selection toolbar opens the panel with the selection instead of calling `router.push("/gozlin")`.
   - The reader's "chat with this document" entry opens the panel instead of navigating to `/chat-with-document`. The panel header offers "Open full screen", which goes to the existing screen.
   - Put the entry point in the reader's existing controls. Add a floating button only if there's no room, and never over the page indicator or the Read Aloud bar.
3. **Performance.** Opening, closing or streaming in the panel must not re-render the document renderer, which would make the PDF flicker or reset its page and the EPUB reflow. Keep panel state inside the panel and pass stable callbacks (`useCallback`, refs). Check with the React DevTools profiler or a render counter.
4. **Coexistence.** Read Aloud, reader controls, search, highlights and notes all keep working with the panel open or closed. When the Read Aloud bar and the panel both need the bottom edge, the panel sits above the bar.

**Acceptance (iPhone 16):**
1. Select text in a PDF, tap Ask, and the panel slides up.
2. The answer streams in with citations.
3. Tapping a citation jumps the page, shows the Source card and shrinks the panel.
4. Swiping down closes the panel.
5. At no point does the PDF reload or jump back to page 1.
6. With the flag off, the reader behaves exactly as today.

### W8: Smaller fixes on the app side

1. **Devil's Advocate and Narrative Arc.** When `capabilities.devilsAdvocate` / `capabilities.narrativeArc` are `true`, call the real routes only, with no retry through `/chat` on 404 (a 404 from them now means `DOC_NOT_FOUND`). When `false`, keep today's try-then-fall-back logic unchanged. Keep the normalizers on both paths.
2. **Location labels.** Wherever the app shows a location (citations, highlight references, quiz source references), use "Slide N", "Sheet N", "Chapter N", "Section N" or "Page N" based on `locatorType`.
3. **After the backend ships its fixes,** verify in the app that:
   - a question about a number in an XLSX gets the number;
   - a summary of a 12-slide deck follows slide order.

### W9: Protect what's unique (regression list)

At the end, each of these must work with flags on and off, against both the old and the new backend:

- Devil's Advocate, with and without a context document, including RFP coverage
- Narrative Arc, including reorder instructions
- Quiz: grounded questions, weak topics, adaptive difficulty
- Highlights, highlight summary, and convert highlight to task
- Explain modes, Translate, and Generate Document
- Gozlin Workspace actions
- Topic-to-deck in the PPT module
- Semantic library search, which falls back to keyword search when AI is off
- Scheduled tasks and QC Insights
- AI session history, including sessions saved before this change

---

## 7. Tests and verification

**New Jest tests in `__tests__/`:**

| File | Covers |
|---|---|
| `sseParser.test.ts` | Split chunks, CRLF, multi-line data, comments, unknown events, multi-byte characters split across chunks |
| `resilientStream.test.ts` | Fails over before headers, never after the first byte; caller abort doesn't fail over; idle timeout |
| `aiErrors.test.ts` | Both error bodies, plain-text bodies, 401/403/404/429 mapping |
| `aiCapabilities.test.ts` | Missing or partial `/status` means all `false` and the legacy path |
| `aiRequestBuilders.test.ts` | Flag or capability off gives today's exact bodies; on gives `docId` and `instruction` |
| `citations.test.ts`, `quoteMatch.test.ts` | Both citation shapes; normalization; not found |
| `docSessionCache.test.ts` | Expiry, eviction, a single re-upload |
| `markdownText.test.tsx` | The subset renders; malformed input is safe |
| `premiumUnlock.test.ts` | `FORCE_PREMIUM_UNLOCK` is `false` when `__DEV__` is false (jest-expo sets `__DEV__` true by default, so mock it) |

**At the end,** run `npx tsc --noEmit`, `npm test` and `npm run lint`. There must be no new failures compared with the baseline.

**Device QA.** You probably can't run a physical iPhone. Write `docs/ai-upgrade/QA_CHECKLIST.md` with exact steps and expected results for iPhone 16 (iOS 18) and one Android phone on a dev-client build.
- Matrix: old backend or new, flags off or on, premium or free, online or airplane mode.
- Test files: a 300-page text PDF, a scanned PDF, a 40-page DOCX, a PPTX with 12 or more slides, an XLSX full of numbers, an EPUB novel, and 50,000 characters of pasted text.
- Include watching memory in Xcode during a long stream and while the panel is open over a large PDF.

In your report, be clear about what you verified yourself and what still needs a device.

---

## 8. Report when you're done

1. **Owner actions first:**
   - the real iOS RevenueCat key;
   - the value of `EXPO_PUBLIC_AI_APP_KEY` in `.env` and `eas.json` (must match the backend's `AI_APP_KEYS`);
   - privacy policy wording about documents being stored on the server;
   - when to switch the backend to `enforce`.
2. **Per workstream:** files changed, the flag's final value, what you verified, and what's left.
3. **Baseline vs. final** results for `tsc`, tests and lint.
4. **Any fact in section 3** that turned out to be different.
5. **Any place you had to deviate** from the contract, and why. There should be none without asking first.

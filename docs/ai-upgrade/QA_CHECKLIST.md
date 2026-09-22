# Gozlin AI foundations — device QA checklist

Everything in this upgrade is gated twice: a feature flag in
`constants/featureFlags.ts` **and** the matching capability from
`GET /api/ai/status`. With either off, the app must behave exactly as it did
before. That is the first thing to test, and the thing to re-test whenever a
flag is flipped.

**Devices:** iPhone 16 (iOS 18) and one Android phone, both on a dev-client
build (`npx expo run:ios` / `run:android`, or an EAS `development` build).
A release-configuration build is needed for the premium checks (§1).

**Test files** (keep them in the app library before starting):

| Key | File |
|---|---|
| PDF-300 | a 300-page text PDF |
| PDF-SCAN | a scanned (image-only) PDF |
| DOCX-40 | a 40-page DOCX |
| PPTX-12 | a deck of 12+ slides |
| XLSX-NUM | a spreadsheet full of numbers |
| EPUB-NOVEL | an EPUB novel |
| TEXT-50K | 50,000 characters of pasted text |

---

## 0. The matrix

Run §2–§8 in each state that applies to what you are testing.

| Axis | Values |
|---|---|
| Backend | old (no `capabilities` in `/ai/status`) · new (contract v2) |
| Flags | all false (shipping default) · the flag under test true |
| Account | premium · free (non-subscriber) |
| Network | online · airplane mode · airplane mode switched on mid-answer |

The quickest way to test "old backend" against a v2 server is to point
`EXPO_PUBLIC_API_URL` at a build of the backend before its v2 deploy. Failing
that, set the flag under test to `false`, which must produce the same result.

---

## 1. Access (W1) — needs a release-configuration build

| # | Step | Expected |
|---|---|---|
| 1.1 | Build in release configuration with a non-subscriber account | Every AI screen shows the premium upsell; no AI request leaves the device (check the backend log or a proxy) |
| 1.2 | Tap an AI feature as a non-subscriber | The paywall opens; nothing is generated |
| 1.3 | Subscribe (sandbox), reopen Gozlin | AI works; the gate is gone |
| 1.4 | Restore purchases on a second device | Premium is recognised, AI works |
| 1.5 | Watch the backend log for any AI request | Each carries `X-App-Key`, `X-User-Id`, `X-Client-Version`, `X-Request-Id` |
| 1.6 | Dev build only: start with `EXPO_PUBLIC_FORCE_PREMIUM_UNLOCK=true` | Premium is unlocked for testing; the same build in release configuration is NOT unlocked |

> iOS cannot complete a purchase until the real RevenueCat iOS key is set
> (`config/revenuecat.ts` still has the placeholder). Until then, 1.2–1.4 on
> iPhone can only be checked as far as the paywall appearing.

## 2. Nothing invented when the server is unreachable (W6.1)

| # | Step | Expected |
|---|---|---|
| 2.1 | Airplane mode → ask Gozlin anything | "Gozlin can't reach the server. Check your connection and try again." with **Retry**. Never a plausible-looking answer |
| 2.2 | Tap Retry with network back | The answer arrives |
| 2.3 | Airplane mode → Chat with File, Quiz, QC Insights, Gozlin Workspace, topic-to-deck | Each shows an error and stops; no spinner is left running |
| 2.4 | Airplane mode → a scheduled task fires | The task is marked **failed**, not completed |

## 3. Whole-document tasks — `AI_DOCID_TASKS` (W2)

| # | Step | Expected |
|---|---|---|
| 3.1 | New backend, flag on: summarize PDF-300 | The request body carries `docId` (backend log), not 15,000 characters of text |
| 3.2 | Read the summary | It reflects the **final** chapters, not only the opening |
| 3.3 | Pull down to cancel mid-request | The request aborts; the screen returns to its pre-send state |
| 3.4 | Summarize PDF-300 with the flag **off** | The body is text cut at 15,000 characters — exactly as before |
| 3.5 | Flag on, old backend, summarize PDF-300 | Same legacy body, plus the note "Gozlin read the first part of this document (about N pages)." |
| 3.6 | Paste TEXT-50K with no document | Processed whole; over 90,000 characters shows "Only the first 90,000 characters were used." |
| 3.7 | Translate PDF-300 with "All pages" | Whole document translated; a partial result shows "Gozlin covered about X% of this document." |
| 3.8 | Translate pages "2-5" | Only those pages, as before (no docId) |
| 3.9 | Quiz from DOCX-40 | Questions cover the whole document; sources still shown |
| 3.10 | Devil's Advocate + Narrative Arc on PPTX-12 with an RFP as context | Both work; RFP coverage appears; reorder instructions appear |
| 3.11 | Ask XLSX-NUM for a specific number ("what is the total for Q3?") | The actual number comes back, with the sheet cited |
| 3.12 | Summarize PPTX-12 | The summary follows slide order, start to finish |

## 4. Document cache — `AI_PERSISTENT_DOC_CACHE` (W3)

| # | Step | Expected |
|---|---|---|
| 4.1 | Open PDF-300 in Chat with File, then leave and re-enter | The second visit makes **no** upload request (backend log) |
| 4.2 | Force-quit the app, reopen, ask again | Still no upload; the answer comes straight back |
| 4.3 | Edit the file (or re-export it) and ask again | It uploads again (new size / modification time) |
| 4.4 | Ask a question after the server has dropped the document (restart the backend) | "Reloading document…" appears once, then the answer; no loop |
| 4.5 | Ask again with the server still unable to find it | A clear error, not an endless retry |
| 4.6 | Open a reader (PDF/DOCX/EPUB/PPTX) and do nothing | **No** upload happens just from opening |

## 5. Citations — `AI_CITATIONS_V2` (W4)

| # | Step | Expected |
|---|---|---|
| 5.1 | Ask PDF-300 a question whose answer has 3 citations | Three tappable chips in the answer and three rows under "Sources" |
| 5.2 | Tap each chip | The right page opens, with a Source card showing the quote |
| 5.3 | Tap a Sources row | Same navigation |
| 5.4 | Tap the quote text in Sources | It expands past two lines, and collapses again |
| 5.5 | Repeat on EPUB-NOVEL | Labels read "Chapter N"; the match is found by search, or the chapter opens |
| 5.6 | Repeat on PPTX-12 | Labels read "Slide N"; the deck jumps to that slide |
| 5.7 | Repeat on DOCX-40 | Labels read "Section N"; the viewer's search scrolls to the words |
| 5.8 | Repeat on XLSX-NUM | Source card only (no viewer) — nothing crashes |
| 5.9 | From Chat with File (not in a reader), tap a citation | The matching viewer opens at that location with the Source card |
| 5.10 | Old backend (empty quotes / legacy shape) | No chips, no crash: the original "📌 Sources" text block |
| 5.11 | Quiz and Highlights on PPTX-12 | Locations read "Slide N", not "Page N" |

## 6. Streaming — `AI_STREAMING` (W5)

| # | Step | Expected |
|---|---|---|
| 6.1 | Ask a long question in Chat with File | Text starts appearing within a second or two; no long blank spinner |
| 6.2 | Scroll the thread while the answer streams (iPhone 16) | Scrolling stays smooth; earlier bubbles don't flicker |
| 6.3 | Pull down to cancel mid-stream | Network traffic stops (backend log); the partial answer stays, marked "Stopped" |
| 6.4 | Turn on airplane mode mid-stream | The partial answer stays with "Answer interrupted · Retry"; Retry re-asks |
| 6.5 | Background the app mid-stream for ~30 s, return | Either the answer completed, or "Answer interrupted · Retry" — never a frozen spinner |
| 6.6 | Old backend (no `/stream` route) | The answer still arrives, in one piece |
| 6.7 | VoiceOver on: ask a question | Deltas are not announced one by one; "Answer ready" is announced at the end |
| 6.8 | Xcode → Debug navigator, stream several long answers | Memory returns to its baseline between answers; no steady climb |

## 7. Formatting — `AI_MARKDOWN` (W6)

| # | Step | Expected |
|---|---|---|
| 7.1 | Ask for a summary with headings, a list and a table | All render properly: no raw `##`, `**`, or pipes |
| 7.2 | Switch to dark mode | Headings, quotes, code and table borders are all legible |
| 7.3 | Settings → largest Dynamic Type, reopen the answer | Text scales; nothing is clipped; tables scroll sideways |
| 7.4 | Copy an answer | The clipboard has clean text — no `**` and no `[1]` markers |
| 7.5 | Open an AI session saved before this upgrade | It still renders correctly |
| 7.6 | Explain a selection, then switch mode/depth chips | Re-runs work and stay formatted |
| 7.7 | QC Insights and Gozlin Workspace | Still plain text, as before |

## 8. In-reader panel — `AI_READER_PANEL` (W7)

The acceptance run on iPhone 16, in order:

| # | Step | Expected |
|---|---|---|
| 8.1 | Open PDF-300, select text, tap **Ask gozlin** | The panel slides up to peek height with the selection quoted above the input |
| 8.2 | Ask a question | The answer streams in with citations |
| 8.3 | Tap a citation | The page jumps, the panel shrinks to peek, a Source card appears above it |
| 8.4 | Swipe the panel down | It closes |
| 8.5 | Throughout 8.1–8.4 | The PDF never reloads and never jumps back to page 1 |
| 8.6 | Set `AI_READER_PANEL = false`, repeat 8.1 | "Ask gozlin" navigates to the Gozlin screen, exactly as before |
| 8.7 | Quick actions: Summarize, Explain selection, Translate selection, Ask about selection | Each answers in the panel; Explain/Translate need a selection |
| 8.8 | Panel header → "Open full screen" | The existing Chat with File screen opens with the same document |
| 8.9 | Start Read Aloud, then open the panel | The panel sits above the Read Aloud bar; both keep working |
| 8.10 | With the panel open: reader search, highlights, notes, page indicator | All still work |
| 8.11 | Open the keyboard in the panel | The input stays visible above it (check on Android too) |
| 8.12 | Rotate to landscape, and on iPad | ≥ 768 pt wide shows a ~380 pt side panel instead of a sheet |
| 8.13 | Settings → Reduce Motion on | The panel appears without the spring animation |
| 8.14 | Repeat 8.1–8.5 in DOCX-40, EPUB-NOVEL and PPTX-12 | Same behavior; EPUB doesn't reflow, the deck doesn't reset |
| 8.15 | Xcode memory while the panel is open over PDF-300 | No steady climb while opening/closing or streaming |

## 9. Regression list (W9) — flags on and off, old and new backend

- [ ] Devil's Advocate, with and without a context document, including RFP coverage
- [ ] Narrative Arc, including reorder instructions
- [ ] Quiz: grounded questions, weak topics, adaptive difficulty
- [ ] Highlights, highlight summary, convert highlight to task
- [ ] Explain modes and depths, Translate, Generate Document
- [ ] Gozlin Workspace actions (AI block, chart data, note → summary/tasks, Ask about a block)
- [ ] Topic-to-deck in the PPT module
- [ ] Semantic library search, and its fallback to keyword search with AI off
- [ ] Scheduled tasks (quiz, workspace AI, generate document) and QC Insights
- [ ] AI session history, including sessions saved before this upgrade
- [ ] Read Aloud in every reader
- [ ] Scanned PDF (PDF-SCAN): extraction failure is reported honestly, nothing invented

## 10. Before flipping a flag to `true`

| Flag | Must pass first |
|---|---|
| `AI_DOCID_TASKS` | §3 (all), §9 |
| `AI_PERSISTENT_DOC_CACHE` | §4 (all) |
| `AI_CITATIONS_V2` | §5 (all) |
| `AI_STREAMING` | §6 (all) |
| `AI_MARKDOWN` | §7 (all) |
| `AI_READER_PANEL` | §8 (all), §9 |

Flip one flag at a time, and re-run §9 after each.

## 11. Known constraints

- `ENABLE_INPLACE_PDF_SELECTION` stays `false`: the pdf.js text layer inlines
  the whole PDF as base64 and ran the device out of memory. PDF citations use
  page jumps plus the Source card, never on-page highlighting. The optional
  "run the viewer's search for the cited words" step is deliberately not wired
  for PDFs, because that path mounts the hidden extractor over the whole file.
- `EPUB_PAGINATED_MODE` is untouched.
- Streaming needs `expo/fetch`, which only streams on a dev-client or release
  build — not in Expo Go.

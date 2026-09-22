# Reader upgrade — device QA checklist

Bookmarks (R1) and reading sessions (R2) are **fully on-device**: they need
no backend at all. Proofread (R3) is gated twice, like everything in the AI
upgrade: the `AI_PROOFREAD` flag in `constants/featureFlags.ts` **and** the
`proofread` capability from `GET /api/ai/status`.

Every flag ships `false`. With a flag off, the app must behave *exactly* as it
did before. That is the first thing to test, and the thing to re-test whenever
a flag is flipped.

**Devices:** iPhone 16 (iOS 18) and one Android phone, both on a dev-client
build (`npx expo run:ios` / `run:android`, or an EAS `development` build).
Android is needed for the SAF (`content://`) cases, which cannot be reproduced
on iOS.

**Test files** (keep them in the app library before starting):

| Key | File |
|---|---|
| PDF-300 | a 300-page text PDF |
| PDF-SCAN | a scanned (image-only) PDF |
| DOCX-40 | a 40-page DOCX |
| PPTX-12 | a deck of 12+ slides |
| EPUB-NOVEL | an EPUB novel |
| SAF-PDF | a PDF opened over SAF on Android (`content://`), from a folder the app was granted, **not** copied into the app |

---

## 0. The matrix

| Axis | Values |
|---|---|
| Flags | `SAVED_PAGES`, `READING_SESSIONS`, `AI_PROOFREAD` are now **true**; `SAVED_PAGES_THUMBNAILS` stays false · flip the flag under test back to false to confirm the off-path still holds |
| Backend (R3 only) | old (no `proofread` in `/ai/status`) · new (reports `proofread: true`) |
| Account (R2 + R3) | premium · free (non-subscriber) — see §3x |
| Network (R3 only) | online · airplane mode · airplane mode switched on mid-check |

R1 is unaffected by backend, account and network. R2 needs a subscription but
never the network. Test online once, then confirm §1.9 and §2.9 in airplane
mode — they must be identical.

---

## 1. Bookmarks — `SAVED_PAGES`

### 1a. With the flag **off** (shipping default)

| # | Step | Expected |
|---|---|---|
| 1.1 | Open PDF-300, DOCX-40, EPUB-NOVEL; open the three-dots menu in each | **No** "Bookmark" item. The menu is exactly as before |
| 1.2 | Look at the reader chrome | **No** bookmark button anywhere |
| 1.3 | Select text in each reader | The selection toolbar has **no** "Bookmark" entry |
| 1.4 | Library filter row, Tools tab, Library header | **No** "Bookmarks" chip anywhere, and no Tools tile |
| 1.5 | Open the Library tab | **No** saved-pages button in the header |
| 1.6 | Read for two minutes, then inspect AsyncStorage (React Native Debugger, or add a temporary dump) | `@wordsinscribed/saved_pages_v1` **does not exist** |

### 1b. With the flag **on**

| # | Step | Expected |
|---|---|---|
| 1.7 | PDF-300 → go to page 12 → three-dots → Bookmark | Brief toast "Page 12 bookmarked". No modal, no `Alert`. The reader does not move |
| 1.8 | Re-open the three-dots menu on page 12 | The item now reads **"Remove saved page"** with a green check |
| 1.9 | **Airplane mode**, bookmark a page | Identical behaviour. Bookmarks never touches the network |
| 1.10 | Open `/saved-pages` (Tools tile or Library header) | The page appears under a "PDF-300" group, labelled **Page 12**, with a non-empty excerpt of that page's text |
| 1.11 | Watch the excerpt right after saving | It may appear a moment later than the row itself. The save is **never** delayed waiting for it |
| 1.12 | EPUB-NOVEL → save mid-chapter | Appears under its own group, labelled with the chapter, with a non-empty excerpt |
| 1.13 | DOCX-40 in Mobile View → scroll to the middle → save | Appears labelled "Section · N%", with the **on-screen** text as its excerpt (not the start of the document) |
| 1.14 | PPTX-12 → save a slide | Appears labelled "Slide N". An empty excerpt is acceptable and must render as *"No text captured"* |
| 1.15 | PDF-SCAN → save a page | Saves cleanly. The excerpt is empty (there is no text layer) and renders as *"No text captured"* — **never** a spinner that never ends |
| 1.16 | Select a sentence → "Bookmark" in the selection toolbar | The bookmark's excerpt is **that selection** |
| 1.17 | Long-press a row on `/saved-pages` → type a note → Save note | The note shows on the row under the excerpt |
| 1.18 | Search "entropy" (a word in one excerpt) | Only matching pages remain; groups with no match disappear |
| 1.19 | Search a file name | That file's group stays, even if no excerpt matches |
| 1.20 | Tap a group header | It collapses and expands |

### 1c. The promise: it outlives the file

| # | Step | Expected |
|---|---|---|
| 1.21 | Save 3 pages in PDF-300. Delete PDF-300 **from the app** (Library → delete) **and from the device** (Files app / file manager) | |
| 1.22 | Open `/saved-pages` | All 3 pages still render **in full**: location label, excerpt, note, date, return count |
| 1.23 | Search for a word in one of those excerpts | It still matches |
| 1.24 | Tap one of them | A read-only snapshot opens — excerpt, note, location, original file name, save date. **Never** a crash, **never** a dead end |
| 1.25 | The group header for that file | Shows a **"File no longer available"** badge |
| 1.26 | Snapshot → Delete | The record is removed and the list updates |
| 1.27 | Re-download / re-add the same file so its **URI changes** (a different folder, or via Downloads) | |
| 1.28 | Open `/saved-pages` and tap a page of that file | The badge is gone and it **opens at the right location** — page 12 goes to page 12 |
| 1.29 | Android, SAF-PDF: save a page, then re-grant the folder so the `content://` URI is re-encoded | The saved page still resolves and still jumps correctly |

### 1d. Ranking

| # | Step | Expected |
|---|---|---|
| 1.30 | Open one saved page four times (back out and re-open each time) | The row reads **"Opened 4 times"** |
| 1.31 | Sort = "Most visited" | That page is at the top of its group, and its file's group has risen |
| 1.32 | Save a brand-new page and do **not** open it | Under "Most visited" it is **not** at the bottom — it outranks old, rarely-opened pages |
| 1.33 | Switch between all three sorts repeatedly | All three are offered. The order is stable — switching back and forth never reshuffles rows |

### 1e. Limits and layout

| # | Step | Expected |
|---|---|---|
| 1.34 | Start Read Aloud, then bookmark a page | The confirmation toast sits **above** the Read Aloud bar, overlapping neither it nor the page indicator |
| 1.35 | Bookmark twice in a row | The toast replaces itself rather than stacking, and clears on its own |
| 1.36 | Enter fullscreen | The button hides |
| 1.37 | **Memory:** Xcode → Instruments (or the Debug navigator) while saving 10 pages of PDF-300 in a row | No sustained growth. The hidden text extractor mounts, finishes and **unmounts** — it must not stay resident |
| 1.38 | Save a page while Read Aloud is running in PDF-300 | The excerpt is instant (the text is already extracted). No second extractor is mounted |

---

## 2. Reading sessions — `READING_SESSIONS`

### 2a. With the flag **off** (shipping default)

| # | Step | Expected |
|---|---|---|
| 2.1 | Open each of the four readers and read for a minute | The original 20-second heartbeat runs. The workspace Progress dashboard's reading time increases as it always did |
| 2.2 | Gozlin WorkSpace → Progress | **No** "continue reading" card |
| 2.3 | Settings → Security & Privacy | **No** "Hide continue reading" row and **no** "Reading reminders" row |
| 2.4 | Inspect AsyncStorage | `@wordsinscribed/reading_sessions_v1` **does not exist** |

### 2b. The honesty guard — the most important section here

| # | Step | Expected |
|---|---|---|
| 2.5 | Open PDF-300. Turn pages normally for ~3 minutes. Leave the reader | |
| 2.6 | Gozlin WorkSpace → Progress (as a subscriber) | A card: *"You spent 3 minutes reading PDF-300 today"* (or "a few minutes"). The minute count is **plausible** |
| 2.7 | Open a book and **do not touch the screen for 5 minutes**, screen on, app foregrounded | **Almost no time is credited.** Check the Progress dashboard before and after: it must barely move. This is the whole point |
| 2.8 | Now start Read Aloud and leave it **speaking** for 2 minutes without touching anything | That time **is** credited. Speech counts as reading |
| 2.9 | Airplane mode, read for 2 minutes | Identical. Reading sessions never touch the network |
| 2.10 | Read for 90 seconds, then **background the app** (home gesture) | The partial interval is flushed — the total includes those 90 seconds, not just complete 20-second beats |
| 2.11 | Leave the app backgrounded for 10 minutes, return | **No** time accrued while backgrounded |
| 2.12 | Read for 30 seconds, then navigate back (not background) | Those 30 seconds are credited |

### 2c. The Progress dashboard must not regress

| # | Step | Expected |
|---|---|---|
| 2.13 | Note the Progress dashboard's reading time. Read for exactly 5 minutes with the flag **off**. Note the increase | |
| 2.14 | Reset, flip the flag **on**, read for exactly 5 minutes the same way | The dashboard moves by **the same amount**. R2 credits `bumpReadingTime()` with the same totals |
| 2.15 | Books-in-progress and books-completed counts | Unchanged by this upgrade |

### 2d. The resume card

| # | Step | Expected |
|---|---|---|
| 2.16 | Read a book on a Friday evening, then open the app on Saturday | The card says **"on Friday"** — not Saturday |
| 2.17 | **Change the device timezone** to one several hours behind UTC (e.g. America/Los_Angeles), read at 21:00 local, check the card next day | Still names the **local** weekday. This is the single easiest bug in this feature: a UTC date would name the wrong day |
| 2.18 | Repeat with a timezone ahead of UTC (e.g. Asia/Tokyo), reading at 06:00 local | Still the local day |
| 2.19 | Read a book for **under 2 minutes** | It does **not** appear as a resume candidate |
| 2.20 | Read past 90% of a book | It **never** appears as a resume candidate |
| 2.21 | Delete the file of the current resume candidate | The card disappears. It never offers a file that is gone |
| 2.22 | Tap the card | The file opens **at the stored position** |
| 2.23 | Settings → "Hide continue reading in Gozlin WorkSpace" → on | The card disappears. The rest of the Progress tab is unaffected |
| 2.24 | Check "Hide recent files" still works independently | Yes |
| 2.25 | Read for exactly 40 minutes across a day | The card reads "40 minutes" — whole minutes, **never** seconds |

### 2e. Reminders (opt-in)

| # | Step | Expected |
|---|---|---|
| 2.26 | Fresh install, Settings | "Reading reminders" is **off** |
| 2.27 | Leave it off, read several books over a day | **No** notification ever arrives |
| 2.28 | Turn it on, read a book, leave it 3+ hours | At most **one** notification a day, naming the book and where you left off |
| 2.29 | Turn it on and read a book, then check within 3 hours | **No** reminder — never nudge someone who has just been reading |
| 2.30 | Open the reminded file | Any pending reminder for it is cancelled |
| 2.31 | Finish a book past 90%, wait a day | **No** reminder for it |
| 2.32 | Deny notification permission at OS level, turn the toggle on | Silent no-op. **No** prompt, **no** `Alert` |
| 2.33 | Turn the toggle off while a reminder is pending | It is cancelled immediately — it must not still fire |

---

## 3. Proofread — `AI_PROOFREAD` + backend capability

### 3a. With the flag **off**, or the backend not reporting `proofread`

| # | Step | Expected |
|---|---|---|
| 3.1 | Open the DOCX editor and the PDF editor, type a paragraph with obvious errors | **No** proofread UI at all: no marks, no pill, no panel |
| 3.2 | Watch the backend log / a proxy | **No** request to `/api/ai/proofread` is ever sent |
| 3.3 | Every toolbar command, insert modal (including the existing BookmarkModal), undo/redo, save, export, print | Exactly as before |
| 3.4 | Flag **on** but backend reports `proofread: false` | Same as 3.1–3.2: invisible, no request |

### 3b. The local pass — works with no network (but still needs premium)

| # | Step | Expected |
|---|---|---|
| 3.5 | **Airplane mode**, subscriber, type `This  has  double  spaces and i think so.` | The double spaces and the lowercase `i` are **still marked**. The offline rules do not need the backend |
| 3.6 | Airplane mode, keep typing | **No error message of any kind** appears. Silence is the correct failure mode for a background check |
| 3.7 | As a **free (non-subscriber)** account, type the same | **Nothing is marked at all**, and no request is sent. Proofread is premium, offline rules included (see §3x) |
| 3.8 | Type ordinary, correct prose (a paragraph from a book) | **Nothing is marked.** False positives are the fastest way to make the feature useless |

### 3c. The acceptance example

| # | Step | Expected |
|---|---|---|
| 3.9 | Type `The data shows that recieve rates are up. it is unclear why.` | Both **recieve** (spelling, red) and **it** (capitalisation, blue) are marked |
| 3.10 | Tap the `recieve` mark | A card: `recieve → receive`, a one-line reason, Accept / Dismiss / Dismiss all of this type |
| 3.11 | Accept | Exactly that word changes. Nothing else in the paragraph moves |
| 3.12 | Undo (the editor's undo button) | **`recieve` comes back.** One accept = one undo step |
| 3.13 | Redo | The fix returns |
| 3.14 | Accept the `it` → `It` suggestion | Exactly that word |

### 3d. The occurrence case — test this specifically

| # | Step | Expected |
|---|---|---|
| 3.15 | Type `the cat sat on the mat and the mat was flat` | |
| 3.16 | Trigger a suggestion on the **second** `mat` and accept it | It lands on the **second** `mat`. The first is untouched. **No suggestion may ever apply to the wrong span** |
| 3.17 | In a paragraph with four suggestions, accept one | The other three either re-anchor correctly or vanish and come back correctly on the next check. Never applied to a shifted span |
| 3.18 | Accept a suggestion near the start of a long paragraph, then immediately accept another near the end | The second lands correctly |

### 3e. Marks are decoration only

| # | Step | Expected |
|---|---|---|
| 3.19 | Type a document, let marks appear, **save to DOCX** | Open the .docx: **no** coloured underlines, **no** stray `<span>`s, text identical |
| 3.20 | Save the same document with marks cleared, and diff the two files | **Byte-identical.** (Verified in the harness — see the report — but confirm on device) |
| 3.21 | Export to PDF with marks on screen | Clean output |
| 3.22 | Print with marks on screen | Clean output |
| 3.23 | Check the native spellchecker still works | The OS red squiggles are **still there** alongside the proofread marks. Two underline styles coexisting is fine; losing the OS one is not |

### 3f. Selection must survive — the likeliest regression

| # | Step | Expected |
|---|---|---|
| 3.24 | Select a phrase and **hold the selection** while marks appear elsewhere (wait out the ~2 s debounce) | The selection is **not** cleared and the caret does **not** move |
| 3.25 | Immediately tap **Bold** | It bolds **the selection you made**, as before |
| 3.26 | Place the caret mid-word, wait for a check to run, then type | The text goes in **where the caret was** |
| 3.27 | Repeat 3.24–3.26 on both iPhone and Android | Both |

### 3g. Network behaviour

| # | Step | Expected |
|---|---|---|
| 3.28 | Type steadily for 30 seconds without pausing, watching the backend log | Requests fire **after pauses**, never per keystroke. Roughly one per settled edit |
| 3.29 | Edit one paragraph in a 20-paragraph document | Only that paragraph is sent |
| 3.30 | Re-check an unchanged paragraph repeatedly | **No** repeat request — the content cache answers |
| 3.31 | Watch a request body | Matches the contract: ≤20 blocks, ≤20,000 chars total, no block over 4,000 chars |
| 3.32 | Open the pill → "Check document" on a long document | Visible progress ("Checking N of M paragraphs…") and it completes |
| 3.33 | Airplane mode → "Check document" (an **explicit** check) | An error **is** shown, through the normal AI error presenter |
| 3.34 | Force a `429` | Automatic checking pauses for `retryAfterSec`; typing is never blocked |
| 3.35 | First check after the app has been idle (cold backend) | May take many seconds. **Typing must never freeze or stutter** while it runs |
| 3.36 | Kill the network mid-check | No spinner is left behind; no error for an automatic check |

---

## 3x. Premium gating — run this as a FREE account

Reading sessions and Proofread are subscriber-only. Bookmarks is not: it is
on-device, costs nothing to run, and is the screenshot replacement every
reader is promised.

| # | Step | Expected |
|---|---|---|
| X.1 | Free account → three-dots menu in each reader | "Bookmark" **is** present. Bookmarks is not premium |
| X.2 | Free account → Tools tab, Library header | The Bookmarks tile and the Library bookmark icon **are** present |
| X.3 | Free account → Gozlin WorkSpace → Progress | The whole WorkSpace shows the premium upsell. No resume card leaks through the blur |
| X.4 | Free account → Settings | **No** "Hide continue reading" and **no** "Reading reminders" rows |
| X.5 | Free account → leave a book part-read, wait a day | **No** reminder notification ever fires |
| X.6 | Free account → DOCX / PDF editor, type errors | **No** marks, no pill, no panel — including the offline rules |
| X.7 | Free account → watch a proxy while typing | **No** request to `/api/ai/proofread` |
| X.8 | Subscribe, then repeat X.3–X.6 | All of it appears, with no app restart needed |
| X.9 | Subscriber turns reminders on, then subscription lapses | No further reminders are scheduled |

## 4. Regression sweep — run with all flags **on** and all flags **off**

- [ ] All four readers: open, page/chapter navigation, position restore, search, highlights / underlines / strikethroughs
- [ ] Read Aloud in every reader, **including the bar's layout against the bookmark toast**
- [ ] Reader settings (typography, theme) in every reader
- [ ] Mobile View toggle in PDF and DOCX, and position continuity across the switch
- [ ] Every three-dots menu item in PDF and DOCX
- [ ] The workspace Progress dashboard: reading time, books-in-progress, books-completed
- [ ] Knowledge decay / resurfacing, and predictive ranking surfaces
- [ ] Document editors: every toolbar command, every insert modal (**including the existing `BookmarkModal`**), undo/redo, save, export to DOCX/PDF, print
- [ ] **The existing `bookmarks` PDF table-of-contents tool** (Tools → Add Bookmarks) — confirm R1 did not shadow its id or route
- [ ] Recent Files on the home tab, and the `hideRecentFiles` setting
- [ ] All AI features: Gozlin, Chat with File, Devil's Advocate, Narrative Arc, Quiz, highlights, scheduled tasks, QC Insights
- [ ] SAF-PDF on Android: open, read, save a page, resume

---

## 5. Before shipping a flag that is already `true`

The three flags below were turned on for device testing. Each must clear its
sections before it ships to users; if one cannot, set it back to `false` —
that path is still tested by §1a / §2a / §3a and restores today's behaviour.

| Flag | State | Must pass first |
|---|---|---|
| `SAVED_PAGES` | **true** | §1b, §1c, §1d, §1e, §3x, §4 |
| `READING_SESSIONS` | **true** | §2b, §2c, §2d, §3x, §4 — **§2.7 and §2.17 are non-negotiable** |
| `AI_PROOFREAD` | **true** | §3b–§3g, §3x, §4. Only the offline rules work until the backend reports `proofread: true` |
| `SAVED_PAGES_THUMBNAILS` | false | **Do not flip.** The owner has declined this feature — see §6 |

Re-run §4 after turning any of them back off.

---

## 6. Known constraints

- **`SAVED_PAGES_THUMBNAILS` stays `false`.** The storage, write path and
  cleanup are implemented (`services/savedPageImageStore.ts`); the capture is
  not. The only page-rasterising route consistent with
  `ENABLE_INPLACE_PDF_SELECTION` staying off is a short-lived hidden WebView
  running the bundled pdf.js — and that host page inlines the whole PDF as
  base64, which is exactly the out-of-memory crash that flag exists to
  prevent. It needs the pdf.js host page to stream the PDF by URL first.
- **`ENABLE_INPLACE_PDF_SELECTION` stays `false`**, untouched by this work.
  Bookmarks does not depend on it: PDF excerpts come from the hidden
  `PDFTextExtractor`, which Read Aloud already uses and which does not need
  Mobile View.
- **`EPUB_PAGINATED_MODE` is untouched.** The EPUB locator is a CFI, which is
  correct in either mode.
- **Haptics are a global no-op** (`utils/haptics.ts`). The Bookmark control
  calls the haptic API the normal way, so re-enabling vibration app-wide is a
  one-line change in that file; today the confirmation is the toast alone.
- **Bookmarks is not behind a PIN lock.** `PINGate` accepts only the six
  screens in `ScreenLockSettings` (library, downloads, createFiles, gozlin,
  folders, ai); none covers this, and adding a seventh lock was out of scope.
  Saved page excerpts can therefore be read without the PIN even when Library
  is locked — worth an owner decision if that matters.
- **PPTX has no fine-grained activity signal.** The PPTX screen owns its slide
  navigation internally and reports no slide changes, so an untouched PPTX
  earns no reading time. That is the honest answer given what it reports.

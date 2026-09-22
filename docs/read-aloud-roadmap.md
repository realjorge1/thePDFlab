# Read Aloud & Reading Experience — Implementation Spec

Seven phases that take Read Aloud from "text-to-speech bolted onto a document
viewer" to a listening experience that stands next to a dedicated reader.

**How to use this document.** Each phase below is a self-contained prompt.
Paste the **Shared Context** section first, then the single phase you want
built. Do not hand an agent more than one phase at a time — Phases 3 and 4
share a coordinate system and will fight each other if built together.

Phases are ordered by dependency, not by value. Phase 7 is worth more to a
user than Phases 1–6 combined and costs more than all of them together.

| # | Phase | Est. | Risk | Depends on |
|---|-------|------|------|-----------|
| 1 | Sleep timer, pitch, per-book rate | ~1 wk | None | — |
| 2 | Real pause/resume (iOS native + Android boundary-resume) | ~3 days | Minimal | — |
| 3 | Pronunciation dictionary with the offset map | ~1 wk | Low | 2 |
| 4 | Highlight tracking (EPUB + DOCX) | ~1 wk | Low | 3 |
| 5 | Reading customization (unify types; paginated mode flagged off) | ~2 wks | Medium | — |
| 6 | Bookshelf as a mode on the existing library | ~2 wks | Low | — |
| 7 | Background playback — iOS first, Android after | 3–6 wks | Medium | 2 |

---

# Shared Context

> Paste this section verbatim at the start of every phase prompt.

You are working in `wordsInscribed`, an Expo / React Native document toolbox
(Expo SDK 54, RN 0.81.5, React 19.1, Hermes, new architecture enabled,
`reactCompiler: true` in `app.json` experiments). It has ~77 document tools, a
QC calculator suite, and an AI workspace — **none of which import the Read
Aloud layer.** Keep it that way.

## Ground truth: what `expo-speech@14.0.8` can and cannot do

These facts were verified by reading the native module sources in
`node_modules/expo-speech/`. Do not assume otherwise; do not trust the JS
typings alone, which advertise more than Android implements.

| Capability | iOS | Android |
|---|---|---|
| `speak` / `stop` / `getVoices` / `isSpeaking` | yes | yes |
| `pause()` / `resume()` | **yes, native** | **NO — throws `UnavailabilityError`** |
| `onBoundary` → `{ charIndex, charLength }` | yes | **yes**, via `UtteranceProgressListener.onRangeStart` (API 26+) |
| `pitch` option | yes | yes |
| Synthesize-to-file | no | no |
| `volume` option | no (web only) | no (web only) |

- `android/src/main/java/expo/modules/speech/SpeechModule.kt` defines only
  `isSpeaking`, `getVoices`, `stop`, `speak`. There is no pause. Android's
  platform `TextToSpeech` has no pause API at all.
- `ios/SpeechModule.swift` additionally defines `pause` and `resume`.
- Consequence: **there is no cross-platform mid-utterance pause, and no
  fade-out anywhere.** Never ship UI that implies either.
- `Speech.maxSpeechInputLength` is a platform constant; respect it.

## Architecture: the narrow waist

All TTS behaviour funnels through two files with exactly three consumers.
This containment is why these phases are low-risk. Preserve it.

```
services/ttsService.ts      ← expo-speech wrapper, singleton state
hooks/useReadAloud.ts       ← playback state machine, owns ReadAloudControls
        ↑                    ↑
        |                    |
components/ReadAloudController.tsx   src/hooks/useEpubReadAloud.ts
  (app/pdf-viewer.tsx,                 (app/epub-viewer.tsx)
   app/docx-viewer.tsx)
        ↓                    ↓
      components/ReadAloudBar.tsx   ← UI
```

Key facts:

- `ReadAloudBarProps extends ReadAloudControls`. **Anything you add to the
  `ReadAloudControls` interface automatically reaches the bar** — you do not
  need to thread new props through the viewers.
- `ttsService` holds module-level singleton state: `currentRate`,
  `currentVoice`, `currentLanguage`, `_autoDetectLanguage`, and
  `_currentSpeakId`.
- `_currentSpeakId` is a **stale-callback guard**: `speakChunk()` captures it,
  `stopSpeaking()` increments it, and every lifecycle callback self-validates
  against it. This exists because Android fires `onDone` instead of
  `onStopped` after `Speech.stop()`. **Do not remove or bypass this guard.**
  Any new code path that stops speech must go through `stopSpeaking()`.
- `useReadAloud` keeps refs (`indexRef`, `statusRef`, `chunksRef`, `rateRef`,
  `mountedRef`) so TTS callbacks always read current values. `pause()`
  deliberately sets `statusRef.current` **before** calling `stopSpeaking()`,
  so a synchronous stop-callback does not auto-advance. Preserve that
  ordering in anything you touch.
- `utils/chunkText.ts` splits text into `TextChunk { text, pageIndex,
  chunkIndex }` with `MAX_CHUNK_CHARS = 300`. Exports: `cleanPdfText`,
  `cleanEpubText`, `chunkText`, `chunkPages`, `chunkSingleDocument`,
  `chunkEpubChapters`.
- `services/readAloudPersistence.ts` stores `{ documentId, chunkIndex,
  status, rate, voiceId?, timestamp }` per document, with 30-day cleanup.
- `useReadAloud` accepts a `documentName` option that is **currently unused
  by playback** and retained only for Phase 7's lock-screen title.

## Build workflow

- `android/` and `ios/` are **gitignored** — this is Continuous Native
  Generation. The checked-out `android/` tree is stale and disposable.
  **Any native change must be expressed as an Expo config plugin plus
  `app.json`**, never as a hand-edit to `android/` or `ios/`.
- `expo-dev-client` is already a dependency, so custom native code is
  buildable today. You are not on Expo Go.
- `git config core.autocrlf` is `true` and the repo has **mixed LF and CRLF
  files**. Preserve each file's existing line-ending convention; do not
  normalise a file you are only partially editing.

## Verification baseline

Before you start, confirm you reproduce this. After you finish, confirm you
have not moved it.

```bash
npx tsc --noEmit   # exactly 1 pre-existing error:
                   # app/(tabs)/_layout.tsx — 'freezeOnBlur' TS2353
npx jest           # 3 suites, 41 tests, all passing
```

Adding a new type error or breaking a test means the phase is not done.
`npx eslint <files>` has 2 pre-existing errors in `app/tool-processor.tsx`
(unescaped quotes, line ~2159) — not yours, leave them.

## House rules

1. **Match the surrounding code.** These files use header docblocks
   explaining *why*, section dividers (`// ── name ──`), and JSDoc on public
   interface members. Follow that density; do not add narration to obvious
   lines.
2. **Additive first.** Prefer a new optional field or a new function over
   changing an existing signature. If you must change one, update every
   call site in the same commit.
3. **Graceful degradation is mandatory, not optional.** Every platform
   capability gap (Android pause, missing boundary events, absent TTS engine)
   must fall back to current behaviour, never to a broken state or a thrown
   error.
4. **Never regress offline.** Read Aloud works with no network today. No
   phase may introduce a network dependency on the playback path.
5. Do not touch the tool suite, QC calculators, converters, AI workspace, or
   `app/tool-processor.tsx`.
6. Report honestly. If a sub-goal turns out to be infeasible, finish
   everything else and say plainly what you left out and why.

---

# Phase 1 — Sleep timer, pitch, per-book rate

**Estimate:** ~1 week · **Risk:** None (purely additive) · **Depends on:** nothing

## Goal

Three independent quality-of-life wins that touch no existing behaviour: a
sleep timer, a pitch control, and playback settings remembered per book rather
than globally.

## Constraints you must respect

- **There is no volume control.** `volume` is web-only in `SpeechOptions`. A
  fade-out is impossible — do not design or build one. The timer stops
  playback; that is the whole interaction.
- `pitch` **is** supported on both platforms and is already plumbed through the
  native modules. `ttsService.speakChunk()` simply never passes it.

## Files to touch

| File | Change |
|---|---|
| `services/ttsService.ts` | add `setPitch()` / `getPitch()`, pass `pitch` in `Speech.speak()` |
| `hooks/useReadAloud.ts` | add sleep-timer state + `pitch` to `ReadAloudControls` |
| `components/ReadAloudBar.tsx` | timer button + sheet, pitch control in the speed sheet |
| `services/readAloudPersistence.ts` | extend the stored record with `pitch` |
| `services/settingsService.ts` | global defaults only, if a default pitch is wanted |

## Implementation

### 1a — Pitch

Add a `currentPitch` singleton (default `1.0`, clamp `0.5`–`2.0`) to
`ttsService` alongside `currentRate`, and pass it in the `Speech.speak()`
options object. Mirror the existing `setRate`/`getRate` shape exactly.

Expose `pitch: number` and `setPitch(p: number): void` on `ReadAloudControls`.
Because `ReadAloudBarProps extends ReadAloudControls`, the bar receives it for
free — no prop threading through the viewers.

In the UI, put pitch inside the existing speed sheet (toggled by the speed chip
at `ReadAloudBar.tsx` ~line 469) rather than adding a fourth row of buttons.
The bar is already dense. A labelled slider or a three-preset row
(Low / Normal / High) is enough — pitch is a set-once preference, not a live
control.

### 1b — Sleep timer

Own the timer inside `useReadAloud` so it shares the playback state machine and
cannot drift from it. Add to `ReadAloudControls`:

```ts
/** Minutes remaining on the sleep timer, or null when unset. */
sleepTimerMinutesLeft: number | null;
/** Arm the timer. Pass null to cancel. */
setSleepTimer: (minutes: number | null) => void;
/** Stop at the end of the current page/chapter instead of at a wall-clock time. */
setSleepAtSectionEnd: (enabled: boolean) => void;
sleepAtSectionEnd: boolean;
```

Implementation notes:

- Use a single `setInterval` ticking every 60 s, stored in a ref, decrementing
  a countdown. On reaching zero call the hook's own `pause()` — not
  `stopSpeaking()` directly — so position is saved and the UI reflects paused
  state.
- **Clear the interval in the existing unmount cleanup effect.** The hook
  already has one that calls `stopSpeaking()`; extend it.
- Cancel the timer automatically when the user calls `stop()`.
- Pausing manually should *not* cancel the timer. A user who pauses to answer a
  question still wants to fall asleep on schedule.
- For `sleepAtSectionEnd`, watch `pageIndex` transitions in the existing
  `speakAt()` advance path and pause when it changes. `TextChunk.pageIndex` is
  the page index for PDF/DOCX and the **chapter index** for EPUB, so this one
  flag gives you "end of chapter" on EPUB for free — label it per format.
- Offer 15 / 30 / 45 / 60 minute presets plus "end of chapter". Show remaining
  time on the bar while armed; that is the whole affordance.

### 1c — Per-book rate and pitch

`readAloudPersistence` already keys everything by `documentId`. Add `pitch` to
the `ReadAloudState` interface and save it wherever `rate` is currently saved.

On document load the hook already restores `rate` from persisted state — do the
same for `pitch`. Fall back to the global `settingsService.readingSpeed`
default when a book has no saved value. Note that the existing restore is
guarded by `hasRestoredRef` so streamed text (chunks arriving page-by-page)
cannot yank playback backwards; keep new restores inside that same guard.

## Acceptance criteria

- [ ] Pitch changes are audible and persist across app restarts, per book.
- [ ] Rate set on book A does not affect book B.
- [ ] Timer counts down visibly and pauses playback at zero, with position saved.
- [ ] "End of chapter" pauses at a chapter boundary on EPUB, a page boundary on PDF.
- [ ] Cancelling works; `stop()` cancels the timer; manual pause does not.
- [ ] No timer interval survives unmount.
- [ ] Baseline typecheck/test state unchanged.

## Do not break

The `_currentSpeakId` guard, the `statusRef`-before-`stopSpeaking()` ordering in
`pause()`, and the `hasRestoredRef` one-time-restore guard.

---

# Phase 2 — Real pause/resume

**Estimate:** ~3 days · **Risk:** Minimal · **Depends on:** nothing

**This is the highest value-per-hour item in the roadmap.**

## Goal

Today `pause()` freezes the chunk index and resume re-speaks the chunk from its
start — up to 300 characters of repeated audio on every pause. Fix it on both
platforms, by different means.

## The platform split — this is the whole design

- **iOS:** `Speech.pause()` and `Speech.resume()` exist natively. Use them for
  true mid-utterance pause. Nothing is lost.
- **Android:** there is no pause and there never will be at this layer. But
  `onBoundary` reports `charIndex` as speech progresses. Track the last
  boundary and, on resume, speak `chunk.text.slice(lastCharIndex)`. That yields
  **word-accurate resume** instead of chunk-restart. Users will not perceive
  the difference from true pause.

Do not try to unify these into one code path. Branch on `Platform.OS` inside
`ttsService` and expose a single clean API upward.

## Files to touch

| File | Change |
|---|---|
| `services/ttsService.ts` | boundary tracking, `pauseSpeaking()` / `resumeSpeaking()`, platform branch |
| `hooks/useReadAloud.ts` | route `pause()` / `play()` through the new API |

## Implementation

### 2a — Boundary tracking in `ttsService`

Add module state `_lastBoundaryCharIndex: number` and `_currentChunkText:
string`. In `speakChunk()`, pass an `onBoundary` handler that — after the same
`_currentSpeakId` staleness check every other callback uses — records
`charIndex`. Reset it to 0 at the start of each new utterance.

Expose:

```ts
/** True when the platform can pause mid-utterance (iOS only). */
export function supportsNativePause(): boolean;

/** Pause. iOS suspends the utterance; Android stops and remembers the offset. */
export async function pauseSpeaking(): Promise<void>;

/**
 * Resume. iOS continues the suspended utterance. Android re-speaks the
 * remainder of the current chunk from the last reported word boundary.
 * Returns false when there was nothing to resume, so the caller can fall
 * back to replaying the chunk.
 */
export async function resumeSpeaking(callbacks?: TTSCallbacks): Promise<boolean>;
```

**Critical interaction with the staleness guard.** On Android, `pauseSpeaking()`
must call `stopSpeaking()` (which increments `_currentSpeakId`) so the in-flight
`onDone` cannot auto-advance; `resumeSpeaking()` then starts a *new* utterance
with a *new* speak id. On iOS, `Speech.pause()` must **not** touch
`_currentSpeakId` — the utterance is suspended, not cancelled, and its eventual
`onDone` is still the one you want.

### 2b — Resilience

- Wrap `Speech.pause()` / `resume()` in try/catch. If `UnavailabilityError` is
  thrown on a platform you expected to support it, fall back to the Android
  offset strategy rather than throwing.
- If no boundary event ever arrives (some OEM Android engines never report
  ranges), `_lastBoundaryCharIndex` stays 0 and resume replays the chunk —
  exactly today's behaviour. That is the correct degradation.
- When slicing, **back up to the preceding word boundary** so resume never
  starts mid-word: search backwards from `charIndex` for whitespace.

### 2c — Wire into `useReadAloud`

`pause()` keeps setting `statusRef.current = "paused"` first, then awaits
`pauseSpeaking()`. `play()` with no explicit index should try `resumeSpeaking()`
first and fall back to `speakAt(indexRef.current)` only if it returns false.

Update the now-inaccurate docblock above `pause()` — it currently claims resume
restarts from the chunk, "the best granularity expo-speech supports."

## Acceptance criteria

- [ ] iOS: pause mid-sentence, resume continues from the exact same word.
- [ ] Android: pause mid-sentence, resume continues from the last word boundary, not the chunk start.
- [ ] Android with an engine reporting no ranges: behaves as today, no crash.
- [ ] Rapid pause/play/pause/play produces no double-speaking and no skipped chunks.
- [ ] Pausing near the end of a chunk then resuming still advances correctly.
- [ ] Baseline typecheck/test state unchanged.

## Do not break

The `_currentSpeakId` guard — read the note in 2a twice. This phase is the one
most likely to introduce a double-advance bug, which presents as speech
skipping a sentence or reading two at once.

---

# Phase 3 — Pronunciation dictionary with the offset map

**Estimate:** ~1 week · **Risk:** Low · **Depends on:** Phase 2

## Goal

Let a user fix words the engine mispronounces (invented names, acronyms,
technical terms), plus add inter-paragraph pauses and header/footer skipping.

## Why the offset map is the entire point of this phase

A replacement changes string length. Rewriting a name phonetically shifts every
subsequent character. The moment you do that, the `charIndex` from `onBoundary`
— which Phase 2 uses for resume and Phase 4 uses for highlighting — refers to
the **spoken** string, while the text on screen is the **display** string. They
diverge silently.

**Build the mapping in this phase, before Phase 4 depends on it.** Retrofitting
it later means rewriting both.

## The data shape

```ts
export interface SpokenText {
  /** What the TTS engine receives. */
  spoken: string;
  /** What the user sees. Unchanged from the source chunk. */
  display: string;
  /** Sorted, non-overlapping edits applied to produce `spoken`. */
  edits: {
    displayStart: number;
    displayEnd: number;
    spokenStart: number;
    spokenEnd: number;
  }[];
}

/** Map a character offset in `spoken` back to its offset in `display`. */
export function spokenToDisplayOffset(t: SpokenText, spokenIndex: number): number;
```

`spokenToDisplayOffset` walks the sorted `edits`, accumulating the length delta
of every edit ending before `spokenIndex`. For an index landing *inside* a
replacement, return that edit's `displayStart` — the whole original word
highlights as one unit, which is what a reader expects anyway.

Keep the identity case cheap: when no rule matched, `edits` is empty and the
function returns `spokenIndex` unchanged. Most chunks take this path.

## Files to touch

| File | Change |
|---|---|
| `utils/pronunciation.ts` | **new** — rule types, matcher, `SpokenText` + offset mapping |
| `utils/chunkText.ts` | produce `SpokenText` per chunk; extend `TextChunk` |
| `services/pronunciationService.ts` | **new** — persist rules (global + per-book) |
| `services/ttsService.ts` | speak `spoken`, report display-mapped boundaries |
| `hooks/useReadAloud.ts` | thread `SpokenText` through |
| settings sheet | rule CRUD UI |

## Implementation

### 3a — Rules

```ts
export interface PronunciationRule {
  id: string;
  match: string;
  replacement: string;
  /** Whole-word only (default true) — stops "Ann" rewriting "Announce". */
  wholeWord: boolean;
  caseSensitive: boolean;
  /** Undefined = global rule; set = applies to one document only. */
  documentId?: string;
  enabled: boolean;
}
```

Apply rules in a **single left-to-right pass** so replacements cannot cascade
into one another — a rule's output must never be re-matched by another rule.
Build the `edits` array as you go. Escape user input before regex use: `match`
is a literal string, not a pattern the user authors. Sort rules
longest-match-first so a two-word rule wins over a one-word rule.

### 3b — Inter-paragraph pauses

Chunk boundaries already exist. Add a configurable delay (0–2000 ms) between
chunks in `useReadAloud`'s advance path, applied only when crossing a paragraph
— detect it from a blank line at the chunk boundary in the source text. Store
the delay in a ref; clear any pending timeout on pause, stop, and unmount.

### 3c — Header/footer skipping

For paginated formats you receive `pageTexts: string[]`. Detect lines recurring
on more than ~60% of pages with near-identical text (normalise digits to a
placeholder so running page numbers collapse together). Strip them before
chunking. Require at least 4 pages before the heuristic activates, and never
strip a line longer than ~80 characters — body text repeats too.

Put this in `utils/chunkText.ts` behind an option flag, defaulting **off** until
validated against real documents.

### 3d — Per-book settings surface

A rule sheet reachable from the Read Aloud bar's voice affordance. Each rule
needs a **test button** that speaks just the replacement, so a user can tune it
without restarting the book. That test loop is what makes the feature usable;
do not skip it.

## Acceptance criteria

- [ ] A rule changes pronunciation audibly; disabling it reverts immediately.
- [ ] With rules active, Phase 2's Android resume still lands on the right word.
- [ ] `spokenToDisplayOffset` has unit tests: empty edits, edit before index, index inside an edit, multiple edits, index past the last edit.
- [ ] Rules scoped to one book do not affect another.
- [ ] Paragraph pause is audible and does not desynchronise the chunk index.
- [ ] Header/footer detection, enabled manually, strips running heads on a real multi-page PDF and leaves body text intact.
- [ ] Baseline typecheck/test state unchanged; new tests added under `__tests__/`.

## Do not break

Phase 2's resume. Every boundary index leaving `ttsService` toward the UI must
already be mapped to display coordinates, so no consumer needs to know
pronunciation rules exist.

---

# Phase 4 — Highlight tracking (EPUB + DOCX)

**Estimate:** ~1 week · **Risk:** Low · **Depends on:** Phase 3

## Goal

Highlight the word being spoken and keep it on screen, replacing the current
approach — a string search for the first 60 characters of the chunk
(`app/epub-viewer.tsx` ~line 233), which is fragile on repeated text and
sentence-level at best.

## Why this is now cheap

`onBoundary` fires on **both** platforms with `{ charIndex, charLength }`.
Combined with Phase 3's offset map you know the exact display-character range
of the current word. No native code required.

## Scope — read before planning

- **DOCX / Mobile View first.** `components/DocumentViewer/MobileRenderer.tsx`
  is a WebView with an imperative `MobileRendererHandle`, an `injectJavaScript`
  queue that buffers calls made before the WebView is ready, and a typed
  message union (`WebViewMessage` in `src/types/document-viewer.types.ts`) that
  already carries a `read-aloud-text` message. Easiest surface; proves the
  design.
- **EPUB second.** `app/epub-viewer.tsx` renders epub.js in a WebView with
  bridge functions already defined (`goToHref`, `changeTheme`, `changeFontSize`,
  `epubSearch*`) and an `__inscribedAnnotations` array already declared.
  Mapping a character offset to a CFI means walking text nodes in the rendered
  iframe.
- **PDF is out of scope. Do not attempt it.** In-place PDF text selection is
  disabled because it crashes the app (`ENABLE_INPLACE_PDF_SELECTION`), so there
  is no reliable text layer to highlight into. PDF stays chunk-level until
  pdf.js is switched to stream the document by URL. Leave the existing page-sync
  behaviour untouched.

## Implementation

### 4a — Extend the chunk model

`TextChunk` is currently `{ text, pageIndex, chunkIndex }` — it has **no
character offset into the source**, so a chunk cannot locate itself. Add
absolute offsets:

```ts
export interface TextChunk {
  text: string;
  pageIndex: number;
  chunkIndex: number;
  /** Absolute start offset of `text` within its page/chapter source. */
  charStart: number;
  /** Absolute end offset, exclusive. */
  charEnd: number;
}
```

Populate these in `chunkPages`, `chunkSingleDocument`, and
`chunkEpubChapters`. They must be offsets into the **cleaned** text that was
chunked, and the renderer must display that same cleaned text — otherwise the
offsets are meaningless. Verify that assumption per format before building on
it. If a viewer renders raw source while TTS reads cleaned text, either
reconcile them or fall back to chunk-level highlighting for that format and say
so.

### 4b — Emit a word-position event

Add an optional callback to `UseReadAloudOptions`:

```ts
onWordBoundary?: (pos: {
  chunkIndex: number;
  displayStart: number;
  displayEnd: number;
  pageIndex: number;
}) => void;
```

Compute it from the boundary `charIndex`, mapped through Phase 3's
`spokenToDisplayOffset`, then offset by the chunk's `charStart`.

**Throttle it.** Boundary events fire per word — several per second. Coalesce to
at most ~10/s before crossing the React Native bridge, and drop events entirely
while the app is backgrounded.

### 4c — DOCX highlight

Inject a function into the Mobile View WebView that, given a character range,
walks the body text nodes to find it, wraps it in a `<span class="ra-word">`,
removes the previous wrapper, and calls
`scrollIntoView({ block: "center", behavior: "smooth" })` **only when the span
is outside the viewport** — constant re-centring on every word is nauseating.

Style `.ra-word` with a translucent accent background (the app's `#4F46E5` at
low alpha) that works on light, dark, and sepia reader themes. Also highlight
the containing sentence more faintly; that is what gives a reader their place
when they glance away.

### 4d — EPUB highlight

Prefer epub.js's own annotation API (`rendition.annotations.highlight(cfiRange)`)
so highlights survive re-pagination and theme changes. To get a CFI from a
character offset: walk the text nodes of the current section in the rendered
iframe, accumulate length until you reach the offset, build a Range, and use
epub.js's CFI generation from that Range.

If CFI generation proves unreliable, fall back to the DOCX span-wrapping
approach applied to the iframe document, and note the limitation.

### 4e — Fallback path

Detect within the first few utterances whether boundary events arrive at all.
If not, keep the current chunk-level highlight rather than showing nothing.
Ship this fallback in the same commit as the feature — some OEM Android engines
never report ranges.

## Acceptance criteria

- [ ] DOCX: the spoken word is highlighted and follows speech; the view auto-scrolls only when the word leaves the viewport.
- [ ] EPUB: same, and the highlight survives a theme change and a font-size change.
- [ ] Highlighting is correct on a chunk containing an active pronunciation rule (the Phase 3 integration test).
- [ ] An engine reporting no boundaries degrades to chunk-level highlight — no crash, no blank highlight.
- [ ] Bridge traffic is throttled; no jank on a long chapter.
- [ ] PDF read-aloud behaviour is unchanged.
- [ ] Baseline typecheck/test state unchanged.

## Do not break

PDF read-aloud. The 60-character search you are replacing is EPUB-only; make
sure removing it does not disturb the PDF page-sync path that shares
`onChunkChange`.

---

# Phase 5 — Reading customization

**Estimate:** ~2 weeks · **Risk:** Medium · **Depends on:** nothing

## Goal

Give readers control over typography and page presentation. Most of this is a
**consolidation job, not new engineering** — the app has already built reader
settings twice and forked them.

## The existing fork — understand this before writing code

| System | Shape | Used by |
|---|---|---|
| `services/readerSettingsService.ts` + `hooks/useReaderSettings.ts` | `ReaderSettings { fontSize 12–32, lineHeight 1.2–2.4, theme, fontFamily }` | Mobile View reflow renderer (DOCX/PDF) |
| `services/epubService.ts` | `EpubReaderSettings { fontSize (percent), theme }` | EPUB viewer only |

The canonical type lives in `src/types/document-viewer.types.ts` as
`ReaderSettings` / `ReaderTheme` with `DEFAULT_READER_SETTINGS`.
`readerSettingsService` clamps values on read so a corrupt entry can never
produce an unreadable page — preserve that behaviour.

**Strategy: unify the type, keep the two persistence layers, migrate
gradually.** Do not attempt a big-bang merge of the storage keys — the EPUB
viewer stores font size as a *percentage* for epub.js while Mobile View stores
*points*. A single type with a documented conversion at the EPUB boundary is
correct; a single storage key is not worth the migration risk.

## What to add

Extend `ReaderSettings` with the properties epub.js and the reflow renderer can
both honour:

```ts
export interface ReaderSettings {
  fontSize: number;      // existing, 12–32 pt
  lineHeight: number;    // existing, 1.2–2.4
  theme: ReaderTheme;    // existing: light | sepia | dark
  fontFamily: string;    // existing
  margin: number;        // new: horizontal page margin, 0–64 px
  textAlign: "left" | "justify";  // new
  paragraphSpacing: number;       // new: em multiplier, 0–2
}
```

Clamp every new field on read, exactly as the existing ones are.

## EPUB wiring

`app/epub-viewer.tsx` already has the bridge pattern. The WebView defines
`changeTheme(t)` and `changeFontSize(s)` (~lines 639–640) and registers the
three themes at load (~lines 418–423). Add sibling bridge functions —
`changeLineHeight`, `changeMargin`, `changeTextAlign`, `changeFontFamily` —
implemented with epub.js `rendition.themes.override()`. Keep them in the same
style as the existing ones and inject via the existing
`webViewRef.current?.injectJavaScript(...)` pattern.

### Fonts inside the WebView

The six bundled Google font families are React Native fonts and **do not reach
the WebView iframe.** To offer real font choice inside EPUB you must inject
`@font-face` with base64-embedded fonts.

The repo already has this exact pattern: `scripts/bundle-epub-scripts.js`
base64-bundles `jszip` and `epub.min.js` into `services/epubBundledScripts.ts`
for offline WebView use. Follow it — add a companion script that bundles two or
three reading faces (one serif, one sans, one dyslexia-friendly) the same way.

Do not bundle all six families: each embedded face is a meaningful bundle-size
cost, and a reader needs two good choices, not six mediocre ones.

## Brightness

`expo-brightness` is not installed. Adding it is trivial and it is the standard
way to offer in-reader brightness without leaving the app. Restore the system
brightness on unmount — never leave a user's device dimmed after they close a
book.

## Paginated mode — build it, ship it disabled

The EPUB viewer currently renders with `flow: "scrolled-doc"`, `spread: "none"`,
`manager: "continuous"` (~line 415). Page-turn animation requires switching to
`flow: "paginated"`.

**This is the risky part of the phase and the reason its risk rating is
Medium.** Paginated mode interacts with:

- Read Aloud scroll sync (the `onChunkChange` → scroll-percentage path)
- CFI-based reading-progress tracking and restore
- Phase 4's highlight positioning, if that phase has landed
- The search implementation (`epubSearch*`)

Put it behind a flag in `constants/featureFlags.ts` following the existing
`GLOBAL_CONTAINER_HEADERS` pattern — a documented boolean that reverts the
feature globally when flipped. **Default it to `false`.** Treat enabling it as
its own separate project with its own testing pass.

Everything else in this phase is safe and should ship regardless of whether
paginated mode is ever turned on.

## Acceptance criteria

- [ ] One `ReaderSettings` type is the source of truth; the EPUB percentage conversion is documented at the boundary.
- [ ] Font size, line height, margin, alignment, and theme all apply live in EPUB with no reload.
- [ ] The same settings apply in Mobile View for DOCX/PDF.
- [ ] At least two embedded reading faces are selectable inside EPUB and render offline with no network.
- [ ] Settings survive app restart and are clamped when storage is corrupt.
- [ ] Brightness restores on unmount.
- [ ] Paginated mode exists behind a `false`-default flag; with the flag off, EPUB rendering is byte-for-byte unchanged.
- [ ] Baseline typecheck/test state unchanged.

## Do not break

Reading-progress save/restore in all three viewers, and EPUB search. Both are
CFI- or scroll-percentage-based and are the things a typography change is most
likely to silently disturb.

---

# Phase 6 — Bookshelf as a mode on the existing library

**Estimate:** ~2 weeks · **Risk:** Low · **Depends on:** nothing

## Goal

Give readable documents a cover-first, progress-first home — so reopening a
half-read book is one tap from launch rather than a filename hunt.

## The critical design constraint

**Do not add a screen. Add a mode.**

The app already has `app/library.tsx` (3,074 lines) and
`app/doclib-library.tsx` (1,085 lines) plus a Library tab. A fourth library
surface would make the app harder to use, not better. This phase is rated Low
risk *because* it is additive to an existing screen; building a new route
forfeits that.

`app/library.tsx` already has exactly the right seam: a `viewMode` state
(`"list" | "grid"`, line ~154) driving a `FlatList` that is **keyed by
`viewMode`** so it re-mounts cleanly on switch (~line 1878), plus a `sortBy`
state. **Add `"shelf"` as a third `viewMode` value** with its own
`renderShelfItem`, filtered to readable types and sorted by last-read.

## The data layer already exists

Do not build new storage. Wire up what is there:

| Source | Gives you | Status |
|---|---|---|
| `services/readingProgressService.ts` | `{ progress 0..1, lastReadAt, currentPage?, totalPages?, source }` + `subscribeReadingProgress()` | Live; used by all three viewers |
| `src/utils/epubExtractor.ts` | Parses OPF metadata — **title and author already extracted** (`dc:title`, `dc:creator`) | Live |
| `services/pdfThumbnailService.ts` | `generateThumbnails()` + `isThumbnailCached` / `getCachedThumbnail` / `clearThumbnailCache` | **Exists with zero consumers — dead code that is exactly what you need** |
| `services/doclib/database.ts` | `DocumentRecord { name, uri, type, size, lastOpened, readingProgress, folder }` | Live (JSON-file backed, despite the "SQLite" docstring) |

So covers are roughly 70% built. The remaining work is EPUB cover extraction
and a grid renderer.

## Implementation

### 6a — EPUB cover extraction

`extractEpub()` already opens the zip and parses the OPF manifest. Add cover
resolution to it, in this order:

1. `<meta name="cover" content="...">` in OPF metadata → look up that id in the manifest
2. A manifest item with `properties="cover-image"`
3. A manifest item whose href matches `/cover\.(jpe?g|png)$/i`

Extract to a cached file rather than holding base64 in memory — a cover held as
a data URI in a list of 200 books will exhaust memory. Cache under a
covers directory keyed by a hash of the file URI, mirroring how
`pdfThumbnailService` caches.

Add `coverPath?: string` to `EpubBook`. Extraction must stay **optional and
non-fatal**: a book with no cover renders a generated placeholder (title +
author on a tinted card derived from a hash of the title, so it is stable
across launches). Never let cover extraction failure block opening a book.

### 6b — Covers for PDF and DOCX

PDF: call the existing `pdfThumbnailService.generateThumbnails()` for page 1.
DOCX: no cover concept — use the generated placeholder.

Generate covers **lazily, for visible items only**, and off the main
interaction path. `pdfThumbnailService` already exposes
`preloadVisibleThumbnails` — use it rather than writing new batching.

### 6c — The shelf renderer

A grid of cover cards, each showing cover art, title, author where known, and a
progress indicator. Sort by `lastReadAt` descending so the book you are reading
is first. Filter to `epub | pdf | docx`.

Subscribe via `subscribeReadingProgress()` so progress updates live without a
manual refresh — the subscription already exists for this purpose.

Put a "Continue reading" affordance at the top for the single most recent
in-progress book. That one row is most of this phase's user value: it turns
"where was I" into one tap.

### 6d — Empty and edge states

Design these deliberately; a shelf is mostly empty states early in its life.
Handle: no readable documents at all; documents but none opened yet; a book
whose file has been deleted or moved (SAF URIs go stale — do not crash, mark it
unavailable and offer to remove it from the shelf).

## Acceptance criteria

- [ ] Shelf is a third `viewMode` on the existing library — no new route added.
- [ ] Covers render for EPUB (real, from the file) and PDF (page-1 thumbnail); DOCX and coverless EPUBs get a stable generated placeholder.
- [ ] Progress rings reflect real reading position and update live via the existing subscription.
- [ ] "Continue reading" opens the most recent in-progress book at the saved position.
- [ ] Scrolling 200+ items is smooth; covers load lazily for visible items only.
- [ ] A deleted or moved file degrades gracefully.
- [ ] List and grid modes are completely unchanged.
- [ ] Baseline typecheck/test state unchanged.

## Do not break

Existing list and grid modes, and the `FlatList` `key={viewMode}` remount
behaviour that makes mode switching safe.

---

# Phase 7 — Background playback

**Estimate:** 3–6 weeks · **Risk:** Medium · **Depends on:** Phase 2

**The only phase requiring native code. Worth more to a user than Phases 1–6
combined, and costs more than all of them together.**

## Goal

Keep reading with the screen off, show real lock-screen media controls, and
respond to headset and Bluetooth buttons. This is the entire "listen to a book"
use case.

## Why it is hard

`expo-speech` binds synthesis to the app process and exposes **no
synthesize-to-file API**. There is no JS-only path to backgrounded audio with
media controls.

## Two paths — take Path A

### Path A — keep expo-speech, add a service layer (**recommended**)

- **iOS is nearly free.** `AVSpeechSynthesizer` continues in the background
  when the audio session is category `.playback` and `UIBackgroundModes`
  includes `audio`. `expo-speech@14` exposes `useApplicationAudioSession` in
  `SpeechOptions` precisely so the app can own the session. Lock-screen
  metadata and transport controls need `MPNowPlayingInfoCenter` and
  `MPRemoteCommandCenter`.
- **Android needs real native work.** A foreground service with
  `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK` (API 34+), plus
  a `MediaSession` for lock-screen controls. `expo-speech` provides none of
  this.

### Path B — synthesize to audio files, play through a real player

Would deliver background playback, lock-screen controls, true seeking, and real
pause/resume in one move. **Rejected**, because it requires either a new native
module exposing Android's `synthesizeToFile()`, or a backend TTS endpoint that
introduces network dependency, per-book cost, cold-start latency, and **breaks
offline listening** — the app's best current property. It also rewrites the
playback core that PDF, DOCX, and EPUB all depend on, which is the single
change most likely to destabilise the app.

Do not take Path B without an explicit decision to trade offline for
convenience.

## Sequencing — ship iOS first

Deliver iOS background playback as its own release (~1 week, mostly
configuration). Then evaluate whether Android's foreground service is worth the
native investment. Do not block the iOS win on the Android work.

## Implementation

### 7a — iOS

1. Add `UIBackgroundModes: ["audio"]` to `ios.infoPlist` in `app.json`.
2. Configure the audio session for `.playback` so speech continues when the
   screen locks. Pass `useApplicationAudioSession` appropriately in
   `ttsService.speakChunk()`.
3. Populate `MPNowPlayingInfoCenter` with title (the `documentName` option
   already retained on `useReadAloud` for exactly this), author, cover art from
   Phase 6 if available, and progress.
4. Wire `MPRemoteCommandCenter` play / pause / skip-forward / skip-backward to
   the existing `ReadAloudControls` methods. `skipForward10s` and
   `skipBack10s` already exist and map directly onto the standard transport
   commands.

### 7b — Android

1. A config plugin adding `FOREGROUND_SERVICE` and
   `FOREGROUND_SERVICE_MEDIA_PLAYBACK` permissions plus the service
   declaration. **`android/` is gitignored — this must be a config plugin, not
   a manifest edit.**
2. A foreground service hosting the TTS engine, with a `MediaSession` and a
   media-style notification.
3. Route transport controls back into the JS playback state machine, keeping
   `useReadAloud` the single source of truth. Do not fork playback state into
   native — a second source of truth here will produce bugs that are extremely
   hard to reproduce.

### 7c — Lifecycle

Handle `AppState` transitions explicitly. Today nothing in `useReadAloud`
observes `AppState` at all. Decide and document behaviour for: backgrounding
mid-utterance, an incoming phone call (audio interruption and resume), another
app taking audio focus, and the OS killing the process.

### 7d — Remove the fallback cleanly

The three fake read-aloud notifications (`read_aloud_playing`,
`read_aloud_stopped`, `read_aloud_end_of_file`) were already deleted precisely
so they cannot compete with the real MediaSession notification. Do not
reintroduce status notifications for playback — the media notification *is* the
control surface.

## Acceptance criteria

- [ ] iOS: playback continues with the screen locked and the app backgrounded.
- [ ] iOS: lock screen shows title, author, and cover, with working play/pause and skip.
- [ ] iOS: a phone call pauses playback and it resumes correctly afterwards.
- [ ] Android (when built): a foreground service keeps playback alive; the media notification controls it; headset buttons work.
- [ ] Playback state stays consistent between the native controls and the in-app bar — no divergence.
- [ ] Killing the app stops playback and the notification cleanly, leaving no orphaned service.
- [ ] Offline playback still works exactly as before.
- [ ] Baseline typecheck/test state unchanged.

## Do not break

Offline playback, and the single-source-of-truth property of `useReadAloud`.

---

# Cross-phase rules

1. **One phase at a time.** Phases 3 and 4 share a coordinate system; building
   them together produces a tangle in which neither can be verified.
2. **Phase 3 before Phase 4, always.** The offset map must exist before anything
   consumes boundary indices for display.
3. **Phase 2 before Phase 7.** Background transport controls need a resume that
   actually resumes.
4. **Re-verify the baseline after every phase.** One pre-existing type error,
   41 passing tests. If either moves, the phase is not done.
5. **Never regress offline, and never break PDF read-aloud.** These are the two
   properties most easily lost by accident across this roadmap.

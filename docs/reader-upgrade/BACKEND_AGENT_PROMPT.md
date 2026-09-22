# Reader upgrade: backend agent

Read this whole prompt before you start.

You are the senior backend engineer on this upgrade. You own the server that the wordsInscribed app talks to — the Node service deployed as a Docker image on Render, health-checked at `/api/health`, serving the app under `/api/…`. Work like the lead who owns production: small reversible steps, check everything, never guess.

---

## 0. Mission

The app is adding three reader features. **Two of them are entirely on-device and need nothing from you** (saved pages, reading sessions). Your entire scope is one new route:

**`POST /api/ai/proofread`** — a spelling / grammar / punctuation / clarity pass over short blocks of text, returning suggestions the app can apply safely.

Plus the one-line capability advertisement that lets the app discover it.

That's it. **Do not** build anything for saved pages or reading time; they never touch the network. **Do not** build an audio/transcription route — offline dictation was considered and dropped from this round.

A separate app agent is building the client half against the same contract (section 4). Until you report `capabilities.proofread: true`, the app keeps the feature completely invisible.

---

## 1. Rules you must not break

1. **Everything you add is additive.** Every existing endpoint, request field, response field and status code keeps working unchanged for a client that sends none of the new fields. No existing route changes behavior.
2. **The app must keep working against a server that doesn't have this route yet**, and the current shipped app must keep working against your new deploy. Both directions.
3. **Both servers in the app's failover pool run the same code.** The app treats the primary and the backup as interchangeable (it fails over on network errors and on 502, 503, 504, 521–524). Deploy to both. Never return a failover status for an application error — only when you genuinely cannot serve the request.
4. **`capabilities.proofread` is `true` only when the route is really deployed and a model is really configured for it.** If the model provider key is missing, report `false`. The app is built to treat a missing capability as "feature doesn't exist", which is the correct, quiet outcome.
5. **Never trust the model's positions.** This contract deliberately contains **no character offsets**. Models hallucinate them, and a wrong offset means the app corrupts the user's document. You verify every suggestion against the source text yourself (P4). This is the single most important rule in this prompt.
6. **No secrets in responses or logs.** Don't log full document text at info level; blocks are user document content. Log hashes, lengths and counts.
7. **This route is high-frequency.** It will be called far more often than any other AI route — on a debounce while the user types. It needs its own tighter rate-limit bucket and its own cache, or it will exhaust your model budget and your free-tier CPU.
8. **Stop and ask instead of guessing** when:
   - the contract in section 4 can't work as written;
   - you'd need a new paid dependency or a new infrastructure component (a database, Redis, a queue);
   - the existing auth / rate-limit middleware can't be reused for this route;
   - you can't hit the latency budget in P5.1 with the models available to you.

---

## 2. Before you change anything

You are working in the backend repo, which the app repo does not contain (`render.yaml` in the app repo points at `rootDir: backend`). So **start by confirming the ground truth** rather than assuming it:

1. Identify and report: the runtime and framework, the router layout, how `/api/ai/*` routes are registered, and how the service is built and deployed.
2. Read in full and report what you find:
   - the `GET /api/ai/status` handler — every field it currently returns, and where the `capabilities` object is built;
   - the auth / app-key / user-id middleware, and how `authMode` (`off` / `monitor` / `enforce`) is implemented;
   - the rate-limiting middleware and its current buckets;
   - two existing AI routes that return **structured JSON**, most likely `/api/ai/devils-advocate` and `/api/ai/narrative-arc`, plus `/api/ai/quiz`. Note exactly how they call the model, how they validate and repair JSON, how they retry once, and how they shape errors;
   - the LLM provider abstraction (which providers, the fallback order, how `currentProvider` is chosen);
   - the error-body conventions: the task-route shape `error: { code, message }` versus the newer shape with a string `error` plus a top-level `code`;
   - the existing test setup and how routes are tested.
3. Record the current behavior of `/api/ai/status` verbatim before you touch it.
4. Run the existing build, lint and test commands and **save the output as your baseline**. You answer only for new failures.

Report anything in section 3 that turns out to be different from what's written there.

---

## 3. What the app already does (checked 2026-09-22)

You don't need to change any of this, but your route has to fit it.

- **Capability discovery.** `services/ai/capabilities.ts` in the app fetches `GET /api/ai/status` once per session, again on the first AI use after 10 minutes in the foreground, and again after any 404 from a v2 route. It parses `capabilities` strictly: **any key that is missing, non-boolean, or malformed is treated as `false`.** A partial `capabilities` object is safe. An unreachable status endpoint means every capability is `false`.
- **The app's gate is `canUse(flag, key)`** — its local feature flag AND your reported capability. Both must be true.
- **Headers on every `/api/ai/*` request**, attached centrally in the app's `resilientFetch` so no call site can forget them:

  | Header | Value |
  |---|---|
  | `X-App-Key` | Build-time `EXPO_PUBLIC_AI_APP_KEY` (public — it ships inside the binary) |
  | `X-User-Id` | RevenueCat app user ID; omitted only if it can't be resolved |
  | `X-Client-Version` | App version, e.g. `1.0.0` |
  | `X-Request-Id` | A new UUID per request |

  Echo `X-Request-Id` (or one you generate) back as a response header.
- **Typed client errors.** The app maps your responses into `AIError` with codes `NETWORK | TIMEOUT | CANCELLED | UNAUTHORIZED | PREMIUM_REQUIRED | RATE_LIMITED | DOC_NOT_FOUND | UNAVAILABLE | SERVER | BAD_OUTPUT`, and its shared presenter decides what the user sees. `RATE_LIMITED` shows "You're going a bit fast. Try again in N seconds." from `retryAfterSec`. So the accuracy of your `code` and `retryAfterSec` directly determines what the user reads.
- **Failover.** The app retargets and fails over on network errors and on 502, 503, 504, 521, 522, 523, 524 — hence rule 3.
- **No warm-up.** The app deliberately sends no keep-alive or warm-up pings; the owner keeps servers warm externally. Don't build a design that depends on the app pre-warming you.
- **Free-tier reality.** Render free tier means cold starts of up to ~60 seconds and **no persistent disk**. Any cache you add must be in-process and survive nothing. Don't design around a disk or a database unless you ask first (rule 8).
- **Premium.** AI is premium-only in the app and is blocked client-side before any request. Server-side, `authMode: enforce` is the backstop via `PREMIUM_REQUIRED`.

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

## 5. Workstreams

### B1: Advertise the capability

**Goal:** the app can discover the route, and reports `false` whenever it isn't genuinely usable.

1. Add `proofread` to the `capabilities` object in `GET /api/ai/status`. Change nothing else in that response — the app parses the existing fields (`success`, `currentProvider`, `availableProviders`, `fallbackEnabled`, `fallbackOrder`, `apiVersion`) and every other capability key.
2. Compute it honestly: `true` only when the route is mounted **and** a model provider usable for proofreading is configured. If the provider key is absent, report `false`.
3. `/api/ai/status` stays **unauthenticated**, exactly as today.

**Acceptance:**
- With the provider configured: `capabilities.proofread === true`, and every other field in the response byte-identical to the recorded baseline from section 2.3.
- With the provider key removed: `capabilities.proofread === false`, and the route (if called anyway) returns a clean error, not a crash.
- A client that ignores `capabilities` entirely sees no change whatsoever.

---

### B2: The route

**Goal:** `POST /api/ai/proofread` implementing P2, P3, P4 and P5.

1. **Mount it** under the same router as the other `/api/ai/*` routes, so it inherits the existing app-key / user-id / `authMode` middleware and `X-Request-Id` echo without you re-implementing any of it. Confirm by test that `enforce` mode yields `401 UNAUTHORIZED` / `403 PREMIUM_REQUIRED` from this route exactly as from existing ones.
2. **Validate the request** against every limit in P2 before doing any work: 1–20 blocks, unique non-empty ids ≤ 64 chars, each `text` 1–4,000 chars, total ≤ 20,000 chars, `language` a valid BCP-47 tag or `"auto"`, `dialect` in `us|uk|null`, `goals` a subset of the five. Anything out of range → `400 BAD_REQUEST`. Never silently truncate, never silently split.
3. **Model call.** Follow the conventions you found in the existing structured-JSON routes (`/devils-advocate`, `/narrative-arc`, `/quiz`) for provider selection, JSON-mode/schema use, validation, and the single retry.
   - Temperature **0** (P4.6).
   - Prefer the **fastest, cheapest** model available to you that can do the job. This route is called on a typing debounce; a slow flagship model will blow the 15-second budget (P5.1) and the cost envelope. Report which model you chose and why.
   - Batch all blocks of one request into **one** model call where the model can handle it; fall back to per-block calls only if quality or reliability demands it, and say so in your report.
   - Ask the model for `{ blockId, type, original, replacement, reason, confidence }` only. **Do not ask it for offsets, positions, indices, or `occurrence`** — you compute those (P4.2). Asking for them invites the exact hallucination this contract is designed to avoid.
   - Instruct it to quote `original` **verbatim** from the input, and to prefer the shortest span that makes the correction unambiguous.
4. **The verification pass (P4) — this is the core of the route, not a postscript.** For each model-proposed suggestion, in this order:
   1. Reject unless `original` is a non-empty, ≤ 200-char exact substring of that block's `text` (byte-for-byte, case-sensitive — no normalization, no fuzzy matching, no "close enough").
   2. Reject if `replacement` is missing, > 400 chars, or equal to `original`.
   3. Find all match positions of `original` in `text`. Pick the intended one: use the model's own hint if it supplied contextual text and that resolves unambiguously; otherwise take the first match not already consumed by an accepted suggestion. **Compute `occurrence` from the chosen position** (1-based, counting matches of `original`), and compute `before` as the up-to-32 preceding characters.
   4. Reject if the chosen span overlaps an already-accepted span; when a later, higher-confidence suggestion conflicts with an earlier one, keep the higher-confidence one (ties: earlier start) and drop the other.
   5. Clamp `confidence` into `0..1`; default to `0.5` if absent. Truncate `reason` to 140 chars and strip any Markdown. Coerce an unrecognized `type` to `style`.
   6. Apply the caps: 50 per block, 200 per response, dropping lowest-confidence first.
   7. Mint a `suggestion.id` unique within its block. **Never** reuse a model-supplied id.
   - Every drop is silent to the client and **counted in a metric** (see B4). Drop rate is your main quality signal.
   - Blocks with no surviving suggestions return `"suggestions": []`. Every requested block appears in the response, in request order, with its original `id` (P3).
5. **Determinism and cache (P4.6).** In-process LRU keyed by a hash of: normalized block text, `language`, `dialect`, sorted `goals`, model id, and a **prompt-version constant you bump whenever you change the prompt**. Cache per *block*, not per request, so a user editing paragraph 3 still gets paragraphs 1, 2 and 4 from cache. TTL ~24 h; size it to your container's memory and report the number. In-process only — there's no persistent disk on the free tier (rule 8 / section 3).
6. **Language detection.** Return the detected BCP-47 language per block. When `language` is an explicit tag, honour it and echo it back. When it's `"auto"`, let the model report it. Apply `dialect` only for `en`.
7. **Timeout discipline (P5.1).** Budget the model call so the whole request answers within 15 seconds, including the retry. If you'd exceed it, return what you have already verified rather than blowing the budget — a partial set of good suggestions beats a timeout, because the app's background checks fail silently and the user would just see nothing.

**Acceptance:**
- `"The data shows that recieve rates are up. it is unclear why."` → at least the misspelling and the missing capital, each with `original` an exact substring, correct `occurrence`, correct `before`.
- `"the cat sat on the mat and the mat was flat"` with a suggestion on the second `"mat"` → `occurrence: 2` and a `before` that matches the text at that position. **This is the test that proves the design works.**
- A model reply where `original` is *not* in the text (paraphrased or re-cased) → that suggestion is **absent** from the response, and the response is still `200` with the other suggestions intact.
- A model reply that is invalid JSON → one retry, then `500 AI_BAD_OUTPUT`.
- Two suggestions covering overlapping spans → only one is returned.
- The same request twice → byte-identical responses, the second served from cache.
- 21 blocks, or 20,001 total chars, or a 4,001-char block → `400 BAD_REQUEST`, no model call.
- Every requested block id appears exactly once in the response, in order, including empty ones.

---

### B3: Rate limiting and abuse

**Goal:** the highest-frequency route on the service can't exhaust the model budget or the container.

1. **Its own bucket**, separate from the other AI routes, keyed by `X-User-Id` (fall back to IP when the header is absent). Suggested starting point: **30 requests/minute** and **400/hour** per user; tune from real numbers and report what you set.
2. Over the limit → the existing `429` shape with `retryAfterSec` **and** a `Retry-After` header (P5.2). The app pauses automatic checking for exactly that long, so the number must be real, not a constant.
3. A **global concurrency cap** on in-flight model calls for this route, so a burst can't starve document tasks on the same container. Over the cap, prefer a short queue; if the wait would break the 15-second budget, return `429` with a small `retryAfterSec` rather than a timeout.
4. **Character-budget limiting, not just request counting.** 30 requests of 20,000 chars is a very different load from 30 requests of 200. Track chars/minute per user as well.
5. Rate limits apply in **every** `authMode`, including `off` (P1.3 / the existing C3 rule).

**Acceptance:**
- Exceeding the per-minute limit returns `429`, a correct `Retry-After`, and a `retryAfterSec` that matches it.
- A burst on this route does not slow or fail a concurrent `/api/ai/summarize` request.
- Rate limiting is active with `authMode: off`.

---

### B4: Observability

**Goal:** you can tell whether this feature is working, and what it costs, without reading user documents.

Log per request (structured, with `requestId`, and **no document text** — rule 6): block count, total chars, `goals`, `language`/`dialect`, cache hits vs. misses, model id, model latency, total latency, suggestions proposed, **suggestions dropped and the reason each was dropped** (not-a-substring / overlap / identical / cap / bad-type), suggestions returned, retry count, and outcome.

- **The drop rate is your quality metric.** A high not-a-substring rate means the prompt is drifting toward paraphrasing and needs work — it does **not** mean you should relax P4.1.
- Track cost per request and per user per day. Report the observed averages.
- Keep the existing `X-Request-Id` echo so an app-side report can be traced to a server log.

**Acceptance:**
- One request produces one structured log line with all of the above and no document text.
- Drop reasons are individually countable.

---

### B5: Tests

Add to the existing suite, following its conventions:

| Area | Covers |
|---|---|
| Validation | Every P2 limit, at and over the boundary; duplicate ids; empty `blocks`; bad `language` / `dialect` / `goals`; no model call on a `400` |
| Verification | `original` not a substring → dropped; case-mismatch → dropped; `replacement === original` → dropped; overlap resolution by confidence then position; per-block and per-response caps dropping lowest-confidence first |
| Occurrence | Repeated `original` in one block resolves to the right occurrence, and `before` matches the text at that position — including a match at index 0 (`before === ""`) and a block where `original` appears 5+ times |
| Response shape | Every requested block present, in order, with its `id`; empty `suggestions` arrays preserved; ids unique within a block; `reason` ≤ 140 chars with Markdown stripped; `confidence` clamped |
| Model failure | Invalid JSON → one retry → `500 AI_BAD_OUTPUT`; provider unavailable → the correct status; provider timeout inside the 15 s budget |
| Cache | Identical requests → identical bytes, second from cache; a changed `goals`, `dialect` or prompt version is a cache miss; per-block hits when only one block of several changed |
| Auth | `enforce` → `401` / `403` exactly as on existing routes; `monitor` → logged, never blocked; `off` → no check but rate limits still apply |
| Rate limit | `429` with matching `Retry-After` and `retryAfterSec`; char-budget limiting; concurrency cap |
| Status | `capabilities.proofread` true/false per B1, and the rest of the status body unchanged from baseline |

Run the full build, lint and test commands at the end. **No new failures** versus your section 2.4 baseline.

---

## 6. Deploy

1. Deploy to **both** servers in the pool (rule 3). A cache and a rate-limit bucket are per-instance and per-container; say so in your report so the app-side numbers are read correctly.
2. Bring it up with `capabilities.proofread` reporting the truth from the start — the app handles `false` cleanly, so there's no reason to lie about readiness.
3. Confirm the existing `/api/health` check still passes and that container memory is stable with the cache at its configured size.
4. Watch cold-start behavior: the free tier can take ~60 s to wake, and the app sends no warm-up pings. The first proofread call after idle will be slow, and the app treats a slow background check as silence (P5.5). Confirm a cold start produces a clean timeout or a slow success, **never** a 500.

---

## 7. Report when you're done

1. **Owner actions first:**
   - the model you chose, with observed p50/p95 latency and cost per request;
   - the rate limits and concurrency cap you set, and your reasoning;
   - the environment variables you added (names and purpose — **no values**);
   - whether `capabilities.proofread` is live on both servers;
   - anything the app agent must know that isn't already in section 4.
2. **Section 2 findings:** the actual stack, the baseline `/api/ai/status` body, and how you reused the existing auth and rate-limit middleware.
3. **The measured drop rate** from B4 across a realistic sample, broken down by reason, with your read on prompt quality.
4. **Baseline vs. final** build, lint and test results.
5. **Anything in section 3** that turned out to be different.
6. **Any place you had to deviate** from section 4. There should be none without asking first — the app agent is building against the same text, and a silent variation will ship as a bug in the user's document.

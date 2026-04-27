---
name: Feature UX philosophy — interactive, actionable, non-breaking
description: User expects AI features to be fully interactive workflow engines, never static text. New capabilities must extend existing ones without breaking behavior.
type: feedback
---

When upgrading an AI feature in this app, the user expects the output to feel like a
**workflow engine**, not a static text blob. Specifically:

- Every AI result must be interactive: tappable, with per-item actions (jump to source,
  add to notes, convert to task, explain, copy).
- Navigation to the source document is mandatory for any feature that references
  passages (highlights, insights, citations). Source references should include page,
  section, paragraphIndex, and a verbatim snippet.
- Structured outputs are displayed via dedicated renderers in `components/ai/renderers/`,
  dispatched by `StructuredMessageRenderer` based on payload shape. Never show raw JSON.
- The `reason` field on any structured item must be contextual (why it matters for the
  reader) rather than generic ("key financial figure" → "directly impacts Q2 budgeting
  decisions and signals 15% expansion in spending capacity").

**Why:** Explicitly stated in the Highlight AI upgrade brief — the goal is to transform
features from "extract important text" into "identify, navigate, and act on the most
important information instantly."

**How to apply:** When extending any AI feature, preserve the existing backend
response shape and extend it additively. Add new optional fields (`sourceReference`,
`confidence`, `meta`) rather than changing required ones. Wire new UI into existing
renderer dispatch (shape-based routing in `StructuredMessageRenderer`). Pipe every
interactive callback up through `AIChatBubble` → `ai.tsx` so handlers can integrate
with the app's notes, tasks, quiz, and viewer systems.

// ============================================
// sanitizeAiText
// --------------------------------------------
// Strips Markdown formatting tokens from AI-generated text so results never
// surface raw "##", "**" or "*" symbols in the UI (which make answers look
// like an unfinished mock). We remove only formatting markers — bold, italic,
// ATX headings, and list bullets — and deliberately leave math / code
// punctuation intact (e.g. "3 * 10^8", "c**2", "C#", snake_case) so genuine
// content is never corrupted.
// ============================================

/** Strip Markdown emphasis / heading / bullet markers from a single string. */
export function stripMarkdown(text: string): string {
  if (!text || typeof text !== "string") return text;
  let out = text;

  // Bold: **text** -> text  (balanced pair within a single line).
  out = out.replace(/\*\*([^\n]*?)\*\*/g, "$1");

  // List bullets at the start of a line: "* item" / "+ item" -> "• item".
  out = out.replace(/^([ \t]*)[*+][ \t]+/gm, "$1• ");

  // Italic: *text* -> text, but only when it reads as emphasis (contains a
  // letter and isn't padded with spaces), so math like "3 * 10^8" is untouched.
  out = out.replace(/\*([^*\n]*?[A-Za-z][^*\n]*?)\*/g, (match, inner: string) =>
    /^\s|\s$/.test(inner) ? match : inner,
  );

  // ATX headings at the start of a line: "## Title" -> "Title".
  out = out.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");
  // A line made of nothing but hash marks -> empty.
  out = out.replace(/^[ \t]*#{1,6}[ \t]*$/gm, "");

  return out;
}

/**
 * Recursively strip Markdown from every string contained in `value`
 * (objects, arrays, and nested combinations). Non-string leaves pass through
 * unchanged. Use this for structured AI payloads whose text fields render
 * directly in the UI.
 */
export function deepStripMarkdown<T>(value: T): T {
  if (typeof value === "string") {
    return stripMarkdown(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepStripMarkdown(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = deepStripMarkdown(val);
    }
    return out as unknown as T;
  }
  return value;
}

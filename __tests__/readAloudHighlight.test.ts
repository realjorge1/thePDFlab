/**
 * readAloudHighlight.test.ts
 * Runs the WebView highlighter against a real DOM.
 *
 * The script normally executes inside a WebView where nothing can be
 * asserted, and its job — reconciling cleaned chunk text against the raw
 * markup a renderer displays — is exactly the part most likely to be subtly
 * wrong. jsdom lets these cases pin it down.
 *
 * @jest-environment jsdom
 */

import { cleanPdfText, chunkSingleDocument } from "@/utils/chunkText";
import {
  READ_ALOUD_HIGHLIGHT_BOOTSTRAP,
  buildHighlightChunk,
  buildHighlightInstall,
  buildHighlightShow,
} from "@/utils/readAloudHighlightScript";

// ── Harness ────────────────────────────────────────────────────

interface Highlighter {
  show: (chunkText: string, wordStart: number, wordEnd: number) => boolean;
  showChunk: (chunkText: string) => boolean;
  clear: () => void;
  reset: () => void;
}

function install(): Highlighter {
  (0, eval)(READ_ALOUD_HIGHLIGHT_BOOTSTRAP);
  return (window as unknown as { __raHighlight: Highlighter }).__raHighlight;
}

function setBody(html: string): void {
  document.body.innerHTML = html;
}

/** Text of the single .ra-word span, or null. */
function wordText(): string | null {
  const el = document.querySelector(".ra-word");
  return el ? el.textContent : null;
}

/** Concatenated text of the .ra-sentence spans. */
function sentenceText(): string {
  return Array.from(document.querySelectorAll(".ra-sentence"))
    .map((e) => e.textContent ?? "")
    .join("");
}

let ra: Highlighter;

beforeEach(() => {
  setBody("");
  ra = install();
  ra.reset();
});

// ---------------------------------------------------------------------------
// Locating a word
// ---------------------------------------------------------------------------

describe("word highlighting", () => {
  it("wraps the spoken word", () => {
    const chunk = "The quick brown fox jumps over the lazy dog.";
    setBody(`<div id="reader-content"><p>${chunk}</p></div>`);

    const at = chunk.indexOf("jumps");
    expect(ra.show(chunk, at, at + 5)).toBe(true);
    expect(wordText()).toBe("jumps");
  });

  it("also marks the containing sentence", () => {
    const chunk = "First sentence here. Second sentence follows it.";
    setBody(`<div id="reader-content"><p>${chunk}</p></div>`);

    const at = chunk.indexOf("follows");
    expect(ra.show(chunk, at, at + 7)).toBe(true);
    expect(wordText()).toBe("follows");
    // The sentence band covers the rest of the second sentence only.
    const sentence = sentenceText();
    // Normalisation only lowercases the search; the DOM keeps its own case.
    expect(sentence).toContain("Second sentence");
    expect(sentence).toContain("it.");
    expect(sentence).not.toContain("First sentence");
    expect(sentence).not.toContain("follows");
  });

  it("finds a word split across inline markup", () => {
    setBody(
      `<div id="reader-content"><p>The quick <em>brown</em> fox jumps over.</p></div>`,
    );
    const chunk = "The quick brown fox jumps over.";

    const at = chunk.indexOf("fox");
    expect(ra.show(chunk, at, at + 3)).toBe(true);
    expect(wordText()).toBe("fox");
  });

  it("spans a sentence that crosses element boundaries", () => {
    setBody(
      `<div id="reader-content"><p>Alpha <b>beta</b> gamma delta epsilon.</p></div>`,
    );
    const chunk = "Alpha beta gamma delta epsilon.";

    const at = chunk.indexOf("gamma");
    expect(ra.show(chunk, at, at + 5)).toBe(true);
    expect(wordText()).toBe("gamma");
    // The rest of the sentence sits under sentence spans, word excluded.
    const sentence = sentenceText();
    expect(sentence).toContain("Alpha");
    expect(sentence).toContain("epsilon.");
    expect(sentence).not.toContain("gamma");
  });
});

// ---------------------------------------------------------------------------
// Cleaned text vs rendered source
// ---------------------------------------------------------------------------

describe("reconciling cleaned chunks with raw markup", () => {
  it("matches despite collapsed whitespace", () => {
    setBody(
      `<div id="reader-content"><p>The   quick\n   brown fox jumps.</p></div>`,
    );
    const chunk = "The quick brown fox jumps.";

    const at = chunk.indexOf("brown");
    expect(ra.show(chunk, at, at + 5)).toBe(true);
    expect(wordText()).toBe("brown");
  });

  it("matches despite ligatures in the source", () => {
    setBody(`<div id="reader-content"><p>The ﬁnal chapter ends.</p></div>`);
    // cleanPdfText turns "ﬁnal" into "final".
    const chunk = cleanPdfText("The ﬁnal chapter ends.");
    expect(chunk).toContain("final");

    const at = chunk.indexOf("final");
    expect(ra.show(chunk, at, at + 5)).toBe(true);
    expect(wordText()).toBe("ﬁnal");
  });

  it("matches despite smart quotes in the source", () => {
    setBody(
      `<div id="reader-content"><p>She said “hello there” loudly.</p></div>`,
    );
    const chunk = cleanPdfText("She said “hello there” loudly.");

    const at = chunk.indexOf("loudly");
    expect(ra.show(chunk, at, at + 6)).toBe(true);
    expect(wordText()).toBe("loudly");
  });

  it("matches a chunk produced by the real chunker", () => {
    const source =
      "Salt was once carried across deserts at considerable expense. " +
      "Merchants weighed it against silver in distant markets.";
    setBody(`<div id="reader-content"><p>${source}</p></div>`);

    // Short sentences are packed together, so find whichever chunk holds it.
    const chunks = chunkSingleDocument(source);
    const text = chunks.find((c) => c.text.includes("silver"))?.text ?? "";
    expect(text).not.toBe("");

    const at = text.indexOf("silver");
    expect(ra.show(text, at, at + 6)).toBe(true);
    expect(wordText()).toBe("silver");
  });
});

// ---------------------------------------------------------------------------
// Repeated text
// ---------------------------------------------------------------------------

describe("repeated text", () => {
  it("advances through identical sentences rather than sticking on the first", () => {
    const line = "He said nothing at all.";
    setBody(
      `<div id="reader-content"><p>${line}</p><p>Something else entirely.</p><p>${line}</p></div>`,
    );

    const at = line.indexOf("nothing");

    ra.show(line, at, at + 7);
    const first = document.querySelector(".ra-word");
    const firstParagraph = first?.closest("p");

    // Move past the middle paragraph, then return to the identical sentence.
    ra.show("Something else entirely.", 0, 9);
    ra.show(line, at, at + 7);
    const second = document.querySelector(".ra-word");
    const secondParagraph = second?.closest("p");

    expect(wordText()).toBe("nothing");
    expect(secondParagraph).not.toBe(firstParagraph);
    expect(secondParagraph).toBe(document.querySelectorAll("p")[2]);
  });

  it("wraps back when the reader jumps backwards", () => {
    const line = "He said nothing at all.";
    setBody(
      `<div id="reader-content"><p>${line}</p><p>Filler sentence here.</p><p>${line}</p></div>`,
    );
    const at = line.indexOf("nothing");

    ra.show(line, at, at + 7);
    ra.show(line, at, at + 7); // now on the second occurrence
    ra.reset(); // a jump backwards resets the cursor
    ra.show(line, at, at + 7);

    expect(document.querySelector(".ra-word")?.closest("p")).toBe(
      document.querySelectorAll("p")[0],
    );
  });
});

// ---------------------------------------------------------------------------
// Lifecycle & degradation
// ---------------------------------------------------------------------------

describe("lifecycle", () => {
  it("leaves the document byte-identical after clear()", () => {
    const chunk = "The quick brown fox jumps over the lazy dog.";
    const html = `<div id="reader-content"><p>${chunk}</p></div>`;
    setBody(html);
    const before = document.body.innerHTML;

    const at = chunk.indexOf("jumps");
    ra.show(chunk, at, at + 5);
    expect(document.body.innerHTML).not.toBe(before);

    ra.clear();
    expect(document.body.innerHTML).toBe(before);
  });

  it("never stacks highlights across successive words", () => {
    const chunk = "One two three four five.";
    setBody(`<div id="reader-content"><p>${chunk}</p></div>`);

    for (const word of ["two", "three", "four"]) {
      const at = chunk.indexOf(word);
      ra.show(chunk, at, at + word.length);
      expect(document.querySelectorAll(".ra-word")).toHaveLength(1);
    }
    expect(wordText()).toBe("four");
  });

  it("reports failure rather than throwing when the chunk is not present", () => {
    setBody(`<div id="reader-content"><p>Entirely different text.</p></div>`);
    expect(ra.show("A sentence that does not appear at all.", 2, 10)).toBe(
      false,
    );
    expect(document.querySelector(".ra-word")).toBeNull();
  });

  it("reports failure on an empty document", () => {
    setBody("");
    expect(ra.show("Anything", 0, 5)).toBe(false);
  });

  it("falls back to document.body when there is no reader-content", () => {
    const chunk = "Plain body text without a wrapper.";
    setBody(`<p>${chunk}</p>`);

    const at = chunk.indexOf("without");
    expect(ra.show(chunk, at, at + 7)).toBe(true);
    expect(wordText()).toBe("without");
  });
});

// ---------------------------------------------------------------------------
// Styling
// ---------------------------------------------------------------------------

describe("stylesheet", () => {
  it("installs its own stylesheet exactly once", () => {
    setBody(`<div id="reader-content"><p>Some text to highlight here.</p></div>`);
    install();
    install();

    const styles = document.querySelectorAll("#ra-highlight-style");
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toContain(".ra-word");
    expect(styles[0].textContent).toContain(".ra-sentence");
  });

  it("styles only backgrounds, so reader themes keep control of text colour", () => {
    install();
    const css = document.querySelector("#ra-highlight-style")?.textContent ?? "";
    expect(css).toContain("background-color");
    expect(css).not.toMatch(/(^|[^-])color\s*:/m);
  });
});

// ---------------------------------------------------------------------------
// Per-word cost
// ---------------------------------------------------------------------------

describe("install once, show per word", () => {
  function uninstall(): void {
    delete (window as unknown as { __raHighlight?: unknown }).__raHighlight;
  }

  it("highlights through the lightweight per-word call", () => {
    const chunk = "The quick brown fox jumps over the lazy dog.";
    setBody(`<div id="reader-content"><p>${chunk}</p></div>`);
    uninstall();

    (0, eval)(buildHighlightInstall());
    const at = chunk.indexOf("fox");
    (0, eval)(buildHighlightShow(chunk, at, at + 3));

    expect(wordText()).toBe("fox");
  });

  it("does nothing, rather than throwing, before install", () => {
    setBody(`<div id="reader-content"><p>Some words here.</p></div>`);
    uninstall();

    expect(() =>
      (0, eval)(buildHighlightShow("Some words here.", 0, 4)),
    ).not.toThrow();
    expect(wordText()).toBeNull();
  });

  it("stays correct across many consecutive words", () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`);
    const chunk = `${words.join(" ")}.`;
    setBody(
      `<div id="reader-content"><p>${chunk}</p><p>${chunk.replace(/word/g, "item")}</p></div>`,
    );

    let offset = 0;
    for (const w of words) {
      expect(ra.show(chunk, offset, offset + w.length)).toBe(true);
      expect(wordText()).toBe(w);
      offset += w.length + 1;
    }
    // Still one highlight, and the document is back to one paragraph's text.
    expect(document.querySelectorAll(".ra-word")).toHaveLength(1);
  });

  it("picks up text that changed since the last word", () => {
    setBody(`<div id="reader-content"><p>Original opening sentence.</p></div>`);
    expect(ra.show("Original opening sentence.", 0, 8)).toBe(true);

    // Same container, different content — a re-render, say.
    const root = document.getElementById("reader-content") as HTMLElement;
    root.innerHTML = "<p>Completely different words now.</p>";

    const chunk = "Completely different words now.";
    const at = chunk.indexOf("words");
    expect(ra.show(chunk, at, at + 5)).toBe(true);
    expect(wordText()).toBe("words");
  });
});

// ---------------------------------------------------------------------------
// Where the spoken text and the page disagree
// ---------------------------------------------------------------------------

describe("text the page and the speech disagree about", () => {
  it("matches EPUB text where the extractor put spaces around inline markup", () => {
    // The EPUB extractor replaces every tag with a space, so this passage is
    // spoken from "This is very , important and rare ." while the page reads
    // normally. Whitespace-sensitive matching never found it.
    setBody(
      `<div id="reader-content"><p>This is <em>very</em>, important and <span>rare</span>.</p></div>`,
    );
    const spoken = "This is very , important and rare .";
    const at = spoken.indexOf("important");

    expect(ra.show(spoken, at, at + 9)).toBe(true);
    expect(wordText()).toBe("important");
  });

  it("matches across list items and line breaks with no whitespace in the DOM", () => {
    setBody(
      `<div id="reader-content"><ul><li>First item</li><li>Second item</li></ul><p>One<br>Two</p></div>`,
    );
    const spoken = "First item Second item";
    const at = spoken.indexOf("Second");

    expect(ra.show(spoken, at, at + 6)).toBe(true);
    expect(wordText()).toBe("Second");

    expect(ra.show("One Two", 4, 7)).toBe(true);
    expect(wordText()).toBe("Two");
  });

  it("still finds the word when another part of the passage never matches", () => {
    setBody(
      `<div id="reader-content"><p>It was late — and then, much later that evening, the rain finally stopped.</p></div>`,
    );
    // An entity the extractor left undecoded breaks a whole-passage match.
    const spoken =
      "It was late &mdash; and then, much later that evening, the rain finally stopped.";
    const at = spoken.indexOf("rain");

    expect(ra.show(spoken, at, at + 4)).toBe(true);
    expect(wordText()).toBe("rain");
  });

  it("never wraps text inside a style element", () => {
    setBody(
      `<div id="reader-content"><style>p{color:red}</style><p>Plain words here.</p></div>`,
    );

    expect(ra.showChunk("Plain words here.")).toBe(true);
    const style = document.querySelector(
      "#reader-content style",
    ) as HTMLStyleElement;
    expect(style.textContent).toBe("p{color:red}");
    expect(style.querySelector("span")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Passage highlight — what every engine gets
// ---------------------------------------------------------------------------

describe("passage highlight", () => {
  const PASSAGE = "The first sentence of the passage. And its second one.";

  it("bands the whole passage when no word position is available", () => {
    setBody(
      `<div id="reader-content"><p>Before this. ${PASSAGE} After it.</p></div>`,
    );

    expect(ra.showChunk(PASSAGE)).toBe(true);
    expect(document.querySelector(".ra-word")).toBeNull();

    const band = sentenceText();
    expect(band).toBe(PASSAGE);
  });

  it("gives way to the word highlight when boundaries arrive", () => {
    setBody(`<div id="reader-content"><p>${PASSAGE}</p></div>`);

    ra.showChunk(PASSAGE);
    const at = PASSAGE.indexOf("second");
    expect(ra.show(PASSAGE, at, at + 6)).toBe(true);

    expect(wordText()).toBe("second");
    expect(sentenceText()).not.toContain("first sentence");
  });

  it("works through the per-call bridge builder", () => {
    setBody(`<div id="reader-content"><p>${PASSAGE}</p></div>`);

    (0, eval)(buildHighlightChunk(PASSAGE));

    expect(sentenceText()).toBe(PASSAGE);
  });
});

// ---------------------------------------------------------------------------
// EPUB sections — sandboxed iframes with no scripts
// ---------------------------------------------------------------------------

describe("a document inside a script-less iframe", () => {
  function makeSection(html: string): Document {
    const frame = document.createElement("iframe");
    // What epub.js sets: same-origin DOM access, but no scripts.
    frame.setAttribute("sandbox", "allow-same-origin");
    document.body.appendChild(frame);
    const doc = frame.contentDocument as Document;
    doc.open();
    doc.write(`<!doctype html><html><head></head><body>${html}</body></html>`);
    doc.close();
    return doc;
  }

  function createFor(doc: Document): Highlighter {
    const factory = (
      window as unknown as {
        __raCreateHighlighter: (d: Document) => Highlighter;
      }
    ).__raCreateHighlighter;
    return factory(doc);
  }

  it("highlights inside the section from the host page", () => {
    setBody("");
    const text = "The harbour was quiet. Some years ago, the ferry stopped here.";
    const section = makeSection(`<p>${text}</p>`);

    const hl = createFor(section);
    const at = text.indexOf("years");
    expect(hl.show(text, at, at + 5)).toBe(true);

    expect(section.querySelector(".ra-word")?.textContent).toBe("years");
    // The stylesheet lands in the section's own document, beside the text.
    expect(section.getElementById("ra-highlight-style")).not.toBeNull();
    // Nothing leaks into the host page.
    expect(document.querySelector(".ra-word")).toBeNull();
  });

  it("bands a passage inside the section too", () => {
    setBody("");
    const text = "Chapter text lives in the iframe, not in the reader page.";
    const section = makeSection(`<p>Intro. ${text}</p>`);

    expect(createFor(section).showChunk(text)).toBe(true);
    expect(
      Array.from(section.querySelectorAll(".ra-sentence"))
        .map((e) => e.textContent)
        .join(""),
    ).toBe(text);
  });
});

/**
 * proofreadParse.test.ts
 *
 * A malformed, partial or hostile response must yield ZERO suggestions and
 * must never throw. The stakes are higher here than for a normal parse: a
 * bad suggestion that survives validation gets APPLIED to the user's document
 * on one tap, so "drop it silently" is the only safe failure mode.
 */

jest.mock("@/config/api", () => ({
  API_ENDPOINTS: { AI: { PROOFREAD: "https://b.test/api/ai/proofread" } },
  resilientFetch: jest.fn(),
}));

import {
  parseBlockSuggestions,
  parseProofreadResponse,
} from "@/services/ai/proofread.service";

const TEXT = "The data shows that recieve rates are up. it is unclear why.";
const SENT = [{ id: "b1", text: TEXT }];

function body(suggestions: unknown) {
  return {
    success: true,
    task: "proofread",
    data: { blocks: [{ id: "b1", language: "en", suggestions }] },
  };
}

describe("a well-formed response", () => {
  it("parses the contract's own example", () => {
    const parsed = parseProofreadResponse(
      body([
        {
          id: "s1",
          type: "spelling",
          original: "recieve",
          replacement: "receive",
          occurrence: 1,
          before: "shows that ",
          reason: 'Common misspelling of "receive".',
          confidence: 0.99,
        },
        {
          id: "s2",
          type: "punctuation",
          original: "it",
          replacement: "It",
          occurrence: 1,
          before: "are up. ",
          reason: "Sentences start with a capital letter.",
          confidence: 0.95,
        },
      ]),
      SENT,
    );

    const suggestions = parsed.get("b1")!;
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].original).toBe("recieve");
    expect(suggestions[0].replacement).toBe("receive");
    expect(suggestions[0].type).toBe("spelling");
    expect(suggestions.every((s) => s.source === "remote")).toBe(true);
  });

  it("recomputes occurrence and before from the position it found", () => {
    // The server's own values are not trusted: the app re-derives both from
    // where it actually located the match.
    const parsed = parseProofreadResponse(
      body([
        {
          id: "s1",
          type: "spelling",
          original: "recieve",
          replacement: "receive",
          occurrence: 1,
          before: "not the real context at all", // wrong, but recoverable
          reason: "x",
          confidence: 0.9,
        },
      ]),
      SENT,
    );
    const [s] = parsed.get("b1")!;
    expect(s.occurrence).toBe(1);
    expect(s.before.endsWith("shows that ")).toBe(true);
    expect(s.before).not.toContain("not the real context");
  });

  it("returns an empty array for a block with nothing to fix", () => {
    const parsed = parseProofreadResponse(body([]), SENT);
    expect(parsed.get("b1")).toEqual([]);
  });
});

describe("malformed responses yield zero suggestions and never throw", () => {
  const JUNK: [string, unknown][] = [
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["a string", "not json"],
    ["an array", [1, 2, 3]],
    ["an empty object", {}],
    ["success:false", { success: false, code: "AI_BAD_OUTPUT", error: "bad" }],
    ["no data", { success: true, task: "proofread" }],
    ["data is a string", { success: true, data: "nope" }],
    ["blocks is not an array", { success: true, data: { blocks: "nope" } }],
    ["blocks is null", { success: true, data: { blocks: null } }],
    ["block entries are junk", { success: true, data: { blocks: [null, 7, "x"] } }],
    ["suggestions is not an array", body("nope")],
    ["suggestions is null", body(null)],
    ["suggestion entries are junk", body([null, 3, "x", []])],
  ];

  it.each(JUNK)("handles %s", (_label, input) => {
    expect(() => parseProofreadResponse(input, SENT)).not.toThrow();
    const parsed = parseProofreadResponse(input, SENT);
    const suggestions = parsed.get("b1") ?? [];
    expect(suggestions).toEqual([]);
  });

  it("never throws on a deeply nested or circular-ish shape", () => {
    const weird: Record<string, unknown> = { success: true };
    weird.data = { blocks: [{ id: "b1", suggestions: [{ original: weird }] }] };
    expect(() => parseProofreadResponse(weird, SENT)).not.toThrow();
    expect(parseProofreadResponse(weird, SENT).get("b1")).toEqual([]);
  });
});

describe("hostile and partial suggestions are dropped individually", () => {
  it("drops a suggestion whose original is not in the text", () => {
    const parsed = parseProofreadResponse(
      body([
        { id: "ghost", original: "ELEPHANT", replacement: "x", reason: "r", confidence: 1 },
        { id: "real", original: "recieve", replacement: "receive", reason: "r", confidence: 1 },
      ]),
      SENT,
    );
    expect(parsed.get("b1")!.map((s) => s.original)).toEqual(["recieve"]);
  });

  it("drops a suggestion whose occurrence is out of range", () => {
    const parsed = parseProofreadResponse(
      body([{ id: "x", original: "recieve", replacement: "receive", occurrence: 9, reason: "r", confidence: 1 }]),
      SENT,
    );
    expect(parsed.get("b1")).toEqual([]);
  });

  it("drops an identical original/replacement pair (P4.4)", () => {
    const parsed = parseProofreadResponse(
      body([{ id: "x", original: "recieve", replacement: "recieve", reason: "r", confidence: 1 }]),
      SENT,
    );
    expect(parsed.get("b1")).toEqual([]);
  });

  it("drops an original over 200 characters and a replacement over 400", () => {
    expect(
      parseBlockSuggestions(
        { suggestions: [{ original: "x".repeat(201), replacement: "y", reason: "r", confidence: 1 }] },
        "x".repeat(300),
      ),
    ).toEqual([]);

    expect(
      parseBlockSuggestions(
        { suggestions: [{ original: "recieve", replacement: "y".repeat(401), reason: "r", confidence: 1 }] },
        TEXT,
      ),
    ).toEqual([]);
  });

  it("drops non-string originals and replacements", () => {
    expect(
      parseBlockSuggestions(
        {
          suggestions: [
            { original: 123, replacement: "x", reason: "r", confidence: 1 },
            { original: "recieve", replacement: { evil: true }, reason: "r", confidence: 1 },
            { original: null, replacement: null },
          ],
        },
        TEXT,
      ),
    ).toEqual([]);
  });

  it("accepts an empty replacement, which means delete", () => {
    const [s] = parseBlockSuggestions(
      { suggestions: [{ original: " why", replacement: "", reason: "Redundant.", confidence: 0.8 }] },
      TEXT,
    );
    expect(s.replacement).toBe("");
  });

  it("falls back to a safe type and confidence for junk values", () => {
    const [s] = parseBlockSuggestions(
      {
        suggestions: [
          {
            original: "recieve",
            replacement: "receive",
            type: "sql-injection",
            confidence: "very",
            reason: 12345,
          },
        ],
      },
      TEXT,
    );
    expect(s.type).toBe("grammar");
    expect(s.confidence).toBe(0.5);
    expect(s.reason).toBe("");
  });

  it("clamps an out-of-range confidence", () => {
    const [high] = parseBlockSuggestions(
      { suggestions: [{ original: "recieve", replacement: "receive", confidence: 99, reason: "r" }] },
      TEXT,
    );
    const [low] = parseBlockSuggestions(
      { suggestions: [{ original: "recieve", replacement: "receive", confidence: -5, reason: "r" }] },
      TEXT,
    );
    expect(high.confidence).toBe(1);
    expect(low.confidence).toBe(0);
  });

  it("truncates an over-long reason rather than rendering it", () => {
    const [s] = parseBlockSuggestions(
      { suggestions: [{ original: "recieve", replacement: "receive", reason: "z".repeat(500), confidence: 1 }] },
      TEXT,
    );
    expect(s.reason.length).toBeLessThanOrEqual(140);
  });

  it("drops overlapping suggestions, keeping the more confident (P4.3)", () => {
    const text = "the cat sat";
    const suggestions = parseBlockSuggestions(
      {
        suggestions: [
          { original: "the cat", replacement: "a cat", confidence: 0.6, reason: "r" },
          { original: "cat sat", replacement: "cat sits", confidence: 0.9, reason: "r" },
        ],
      },
      text,
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].original).toBe("cat sat");
  });

  it("caps a block at 50 suggestions", () => {
    const text = "a ".repeat(200);
    const suggestions = Array.from({ length: 120 }, (_, i) => ({
      original: "a",
      replacement: "b",
      occurrence: i + 1,
      confidence: 0.9,
      reason: "r",
    }));
    expect(parseBlockSuggestions({ suggestions }, text)).toHaveLength(50);
  });
});

describe("block-level integrity", () => {
  it("ignores a block id that was never sent", () => {
    const parsed = parseProofreadResponse(
      {
        success: true,
        data: {
          blocks: [
            { id: "b1", suggestions: [{ original: "recieve", replacement: "receive", reason: "r", confidence: 1 }] },
            { id: "injected", suggestions: [{ original: "x", replacement: "y", reason: "r", confidence: 1 }] },
          ],
        },
      },
      SENT,
    );
    expect([...parsed.keys()]).toEqual(["b1"]);
  });

  it("ignores a duplicated block entry", () => {
    const parsed = parseProofreadResponse(
      {
        success: true,
        data: {
          blocks: [
            { id: "b1", suggestions: [{ original: "recieve", replacement: "receive", reason: "r", confidence: 1 }] },
            { id: "b1", suggestions: [{ original: "it", replacement: "It", reason: "r", confidence: 1 }] },
          ],
        },
      },
      SENT,
    );
    expect(parsed.get("b1")!.map((s) => s.original)).toEqual(["recieve"]);
  });

  it("matches each block's suggestions against that block's own text", () => {
    const sent = [
      { id: "b1", text: "first block has recieve in it" },
      { id: "b2", text: "second block has seperate in it" },
    ];
    const parsed = parseProofreadResponse(
      {
        success: true,
        data: {
          blocks: [
            // "seperate" is in b2, not b1 → must be dropped from b1.
            { id: "b1", suggestions: [{ original: "seperate", replacement: "separate", reason: "r", confidence: 1 }] },
            { id: "b2", suggestions: [{ original: "seperate", replacement: "separate", reason: "r", confidence: 1 }] },
          ],
        },
      },
      sent,
    );
    expect(parsed.get("b1")).toEqual([]);
    expect(parsed.get("b2")).toHaveLength(1);
  });

  it("caps a whole response at 200 suggestions", () => {
    const sent = Array.from({ length: 10 }, (_, i) => ({
      id: `b${i}`,
      text: "a ".repeat(60),
    }));
    const blocks = sent.map((b) => ({
      id: b.id,
      suggestions: Array.from({ length: 40 }, (_, j) => ({
        original: "a",
        replacement: "b",
        occurrence: j + 1,
        confidence: 0.9,
        reason: "r",
      })),
    }));
    const parsed = parseProofreadResponse({ success: true, data: { blocks } }, sent);
    const total = [...parsed.values()].reduce((n, list) => n + list.length, 0);
    expect(total).toBe(200);
  });
});

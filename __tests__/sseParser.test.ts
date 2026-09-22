/**
 * sseParser.test.ts
 * The streaming answer is only as reliable as the event parser underneath it.
 * Network chunks split anywhere — mid-line, between \r and \n, and in the
 * middle of a multi-byte character — so every case here feeds the same stream
 * in many different chunkings and expects identical events.
 */

import { TextEncoder } from "util";

import { SSEParser, type SSEEvent } from "@/utils/sseParser";
import { Utf8StreamDecoder } from "@/utils/utf8StreamDecoder";

const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s);

function parse(
  chunks: Uint8Array[],
  knownEvents?: string[],
): { events: SSEEvent[]; comments: string[] } {
  const events: SSEEvent[] = [];
  const comments: string[] = [];
  const parser = new SSEParser({
    onEvent: (e) => events.push(e),
    onComment: (c) => comments.push(c),
    knownEvents,
  });
  for (const c of chunks) parser.feed(c);
  parser.end();
  return { events, comments };
}

/** Every two-way split of the byte stream. */
function allSplits(all: Uint8Array): Uint8Array[][] {
  const out: Uint8Array[][] = [];
  for (let i = 1; i < all.length; i++) out.push([all.slice(0, i), all.slice(i)]);
  return out;
}

const STREAM =
  'event: meta\ndata: {"requestId":"r1"}\n\n' +
  ": ping\n\n" +
  'event: delta\ndata: {"text":"Hello"}\n\n' +
  'event: delta\ndata: {"text":" world [1]"}\n\n' +
  'event: done\ndata: {"answer":"Hello world [1]","citations":[],"found":true}\n\n';

describe("SSEParser", () => {
  it("parses named events, data and comments", () => {
    const { events, comments } = parse([bytes(STREAM)]);
    expect(events.map((e) => e.event)).toEqual(["meta", "delta", "delta", "done"]);
    expect(JSON.parse(events[2].data)).toEqual({ text: " world [1]" });
    expect(comments).toEqual(["ping"]);
  });

  it("gives identical events however the chunks are split", () => {
    const all = bytes(STREAM);
    const expected = parse([all]).events;
    for (const chunks of allSplits(all)) {
      expect(parse(chunks).events).toEqual(expected);
    }
    // One byte at a time, too.
    const single = Array.from(all, (b) => Uint8Array.of(b));
    expect(parse(single).events).toEqual(expected);
  });

  it("accepts CRLF and lone CR line endings", () => {
    const crlf = STREAM.replace(/\n/g, "\r\n");
    const cr = STREAM.replace(/\n/g, "\r");
    const expected = parse([bytes(STREAM)]).events;
    expect(parse([bytes(crlf)]).events).toEqual(expected);
    expect(parse([bytes(cr)]).events).toEqual(expected);
    for (const chunks of allSplits(bytes(crlf))) {
      expect(parse(chunks).events).toEqual(expected);
    }
  });

  it("does not treat a \\r at a chunk end plus \\n in the next chunk as two lines", () => {
    const { events } = parse([bytes("data: a\r"), bytes("\ndata: b\r\n\r\n")]);
    expect(events).toEqual([{ event: "message", data: "a\nb" }]);
  });

  it("joins multi-line data with newlines", () => {
    const { events } = parse([bytes("event: delta\ndata: line one\ndata: line two\ndata:\n\n")]);
    expect(events[0].data).toBe("line one\nline two\n");
  });

  it("strips exactly one space after the colon and ignores unknown fields", () => {
    const { events } = parse([bytes("data:  two spaces\nretry: 100\nfoo: bar\n\n")]);
    expect(events).toEqual([{ event: "message", data: " two spaces" }]);
  });

  it("ignores unknown event names when a known list is given", () => {
    const { events } = parse(
      [bytes('event: surprise\ndata: {}\n\nevent: delta\ndata: {"text":"x"}\n\n')],
      ["meta", "delta", "done"],
    );
    expect(events.map((e) => e.event)).toEqual(["delta"]);
  });

  it("keeps multi-byte characters intact when split inside a character", () => {
    const text = 'event: delta\ndata: {"text":"héllo 😀 世界 — “quotes”"}\n\n';
    const all = bytes(text);
    for (const chunks of allSplits(all)) {
      const { events } = parse(chunks);
      expect(events).toHaveLength(1);
      expect(JSON.parse(events[0].data).text).toBe("héllo 😀 世界 — “quotes”");
    }
  });

  it("dispatches a final event that lost its closing blank line", () => {
    const { events } = parse([bytes('event: done\ndata: {"answer":"ok"}')]);
    expect(events).toEqual([{ event: "done", data: '{"answer":"ok"}' }]);
  });

  it("strips a leading byte-order mark", () => {
    const { events } = parse([Uint8Array.of(0xef, 0xbb, 0xbf), bytes("data: x\n\n")]);
    expect(events).toEqual([{ event: "message", data: "x" }]);
  });

  it("survives a throwing handler", () => {
    let calls = 0;
    const parser = new SSEParser({
      onEvent: () => {
        calls++;
        throw new Error("boom");
      },
    });
    parser.feed(bytes("data: 1\n\ndata: 2\n\n"));
    parser.end();
    expect(calls).toBe(2);
  });
});

describe("Utf8StreamDecoder", () => {
  it("replaces invalid bytes instead of throwing", () => {
    const d = new Utf8StreamDecoder();
    expect(d.decode(Uint8Array.of(0x61, 0xff, 0x62), { stream: false })).toBe("a�b");
  });

  it("holds an incomplete character until the rest arrives", () => {
    const d = new Utf8StreamDecoder();
    const euro = bytes("€"); // e2 82 ac
    expect(d.decode(euro.slice(0, 1))).toBe("");
    expect(d.decode(euro.slice(1, 2))).toBe("");
    expect(d.decode(euro.slice(2))).toBe("€");
  });

  it("flushes a truncated character as a replacement", () => {
    const d = new Utf8StreamDecoder();
    d.decode(bytes("😀").slice(0, 2));
    expect(d.flush()).toBe("��");
  });
});

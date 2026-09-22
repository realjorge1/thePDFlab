// ============================================
// Utf8StreamDecoder
// ---------------------------------------------
// Decodes UTF-8 bytes that arrive in arbitrary chunks (a streaming response
// body), holding back an incomplete multi-byte character until the rest of it
// arrives. Hermes has no native TextDecoder. Expo's winter polyfill
// (expo/src/winter/TextDecoder.ts) accepts `{ stream: true }` but, per its own
// "TODO: maintain stream on instance", does not carry partial bytes between
// calls — a character split across two network chunks would decode as
// replacement characters. This small decoder has no such gap.
// ============================================

const REPLACEMENT = 0xfffd;

function sequenceLength(lead: number): number {
  if (lead < 0x80) return 1;
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 0; // continuation byte or invalid lead
}

function isContinuation(b: number): boolean {
  return (b & 0xc0) === 0x80;
}

export class Utf8StreamDecoder {
  private pending: number[] = [];

  /**
   * Decode the next chunk. With `stream: true` (the default) a trailing
   * incomplete character is kept for the next call; with `stream: false` it is
   * flushed as U+FFFD.
   */
  decode(chunk?: Uint8Array | null, opts: { stream?: boolean } = {}): string {
    const stream = opts.stream !== false;
    const bytes: number[] | Uint8Array =
      this.pending.length > 0
        ? [...this.pending, ...(chunk ? Array.from(chunk) : [])]
        : (chunk ?? new Uint8Array(0));
    this.pending = [];

    let end = bytes.length;
    if (stream && end > 0) {
      // Look back at most 3 bytes for the lead byte of the final character.
      let i = end - 1;
      let back = 0;
      while (i > 0 && back < 3 && isContinuation(bytes[i])) {
        i--;
        back++;
      }
      const need = sequenceLength(bytes[i]);
      if (need > 1 && end - i < need) {
        end = i;
        for (let k = i; k < bytes.length; k++) this.pending.push(bytes[k]);
      }
    }

    const codeUnits: number[] = [];
    let out = "";
    const flushUnits = () => {
      if (codeUnits.length) {
        out += String.fromCharCode.apply(null, codeUnits);
        codeUnits.length = 0;
      }
    };

    let i = 0;
    while (i < end) {
      const b0 = bytes[i];
      const len = sequenceLength(b0);
      let cp = -1;
      if (len === 1) {
        cp = b0;
        i += 1;
      } else if (len > 1 && i + len <= end) {
        let valid = true;
        for (let k = 1; k < len; k++) {
          if (!isContinuation(bytes[i + k])) {
            valid = false;
            break;
          }
        }
        if (valid) {
          if (len === 2) {
            cp = ((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
          } else if (len === 3) {
            cp = ((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
            // Reject overlongs and UTF-16 surrogates.
            if (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff)) valid = false;
          } else {
            cp =
              ((b0 & 0x07) << 18) |
              ((bytes[i + 1] & 0x3f) << 12) |
              ((bytes[i + 2] & 0x3f) << 6) |
              (bytes[i + 3] & 0x3f);
            if (cp < 0x10000 || cp > 0x10ffff) valid = false;
          }
        }
        if (valid) {
          i += len;
        } else {
          cp = REPLACEMENT;
          i += 1;
        }
      } else {
        cp = REPLACEMENT;
        i += 1;
      }

      if (cp > 0xffff) {
        const v = cp - 0x10000;
        codeUnits.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
      } else {
        codeUnits.push(cp);
      }
      if (codeUnits.length >= 4096) flushUnits();
    }
    flushUnits();
    return out;
  }

  /** Flush any held-back bytes as replacement characters. */
  flush(): string {
    return this.pending.length ? this.decode(null, { stream: false }) : "";
  }
}

// ============================================
// File Identity — one stable key for "this document"
// ---------------------------------------------
// Everything in the app keys on the raw file URI, and URIs are not stable:
// the app copies picked files into its own cache directory, Android's SAF
// hands out re-encoded `content://` URIs (see reEncodeSafDocumentUri, which
// is duplicated in services/doclib/database.ts and safBridge.ts), and a
// re-downloaded book lands on a new path. Anything that has to survive those
// moves — and outlive the file itself — needs a key that does not contain a
// path.
//
// THE KEY RULE
//   `key` is derived from the lowercased, whitespace-trimmed FILE NAME plus
//   the BYTE SIZE. It deliberately contains no URI, no directory and no
//   mtime, because all three change while the document does not.
//
// ACCEPTED TRADE-OFF
//   Two genuinely different files that share a name AND have byte-identical
//   sizes collide onto one key. That is rare (it needs both to match exactly),
//   and it is much cheaper than the alternative: losing every saved page the
//   moment a URI changes, which is the common case rather than the rare one.
//
//   When the size cannot be read (a missing or unreadable file, a SAF URI the
//   platform will not stat), the key falls back to the NAME ALONE. Such a key
//   is lower-confidence: every same-named file collides with it. It is still
//   better than no key, and the resolver below matches both shapes so a record
//   saved without a size still finds its file once the size is known.
//
// No new dependency, and no `crypto-js` (which this repo does not declare —
// it resolves only as a transitive dependency of react-native-pdf and could
// vanish on any lockfile change). The hash is the dependency-free one already
// in services/fileIndexService.ts.
// ============================================

import * as FileSystem from "expo-file-system/legacy";

import { generateFileId, getAllFiles } from "@/services/fileIndexService";

export interface FileIdentity {
  /** Stable composite key. This is what new stores persist. */
  key: string;
  /** Hash of the current URI, for cross-referencing the file index. */
  fileId: string;
  /** Last known URI. Informational — may be stale or dead. */
  uri: string;
  name: string;
  ext: string;
  size?: number;
  mtime?: number;
}

/** Version prefix, so a future key-derivation change can be told apart. */
const KEY_PREFIX = "f1";
/** Size token used when the byte size is unknown (lower-confidence key). */
const NO_SIZE = "na";

/**
 * The dependency-free 32-bit string hash from fileIndexService, pinned to a
 * fixed timestamp so the result is a pure function of the input. Reusing
 * generateFileId keeps one hash implementation in the repo rather than two.
 */
function hashString(input: string): string {
  const parts = generateFileId(input, 0).split("_");
  return parts[1] || "0";
}

/** Lowercase + collapse whitespace, so "My Book .pdf" and "my book .pdf" agree. */
function normalizeName(name: string): string {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Last path segment of a URI, percent-decoded where possible. */
export function fileNameFromUri(uri: string): string {
  if (!uri) return "";
  const withoutQuery = uri.split(/[?#]/)[0];
  const segment = withoutQuery.split("/").filter(Boolean).pop() || "";
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Malformed escape sequence — keep the raw segment.
  }
  // SAF document IDs look like "primary:Documents/Book.pdf" — keep the tail.
  const colonTail = decoded.split(":").pop() || decoded;
  return (colonTail.split("/").pop() || decoded).trim();
}

/** Lowercase extension without the dot ("" when there is none). */
export function extensionFromName(name: string): string {
  const base = (name || "").trim();
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Build the stable key from a file name and (when known) its byte size.
 * Pure and synchronous — safe to call from a render or a test.
 */
export function identityKeyFrom(name: string, size?: number): string {
  const normalized = normalizeName(name);
  const sizeToken =
    typeof size === "number" && Number.isFinite(size) && size >= 0
      ? Math.floor(size).toString(36)
      : NO_SIZE;
  return `${KEY_PREFIX}_${hashString(normalized)}_${sizeToken}`;
}

/** True for a key built without a byte size (name-only, lower confidence). */
export function isLowConfidenceKey(key: string): boolean {
  return typeof key === "string" && key.endsWith(`_${NO_SIZE}`);
}

/**
 * Read size / mtime for a URI. Never throws: a missing, unreadable or
 * un-stattable file (SAF often is) yields an empty result.
 */
async function statFile(
  uri: string,
): Promise<{ size?: number; mtime?: number; exists: boolean | null }> {
  if (!uri) return { exists: false };
  try {
    const info = (await FileSystem.getInfoAsync(uri)) as {
      exists?: boolean;
      size?: number;
      modificationTime?: number;
    };
    if (!info || info.exists === false) return { exists: false };
    const out: { size?: number; mtime?: number; exists: boolean | null } = {
      exists: true,
    };
    if (typeof info.size === "number" && Number.isFinite(info.size)) {
      out.size = info.size;
    }
    if (
      typeof info.modificationTime === "number" &&
      Number.isFinite(info.modificationTime)
    ) {
      out.mtime = info.modificationTime;
    }
    return out;
  } catch {
    // Cannot stat (SAF, permissions, web). "Unknown", not "gone".
    return { exists: null };
  }
}

/**
 * Identity for a URI. Never throws — a file that is missing or cannot be
 * stat'ed still yields a usable identity, with `size` / `mtime` undefined.
 */
export async function getFileIdentity(
  uri: string,
  name?: string,
): Promise<FileIdentity> {
  const safeUri = uri || "";
  const resolvedName = (name || "").trim() || fileNameFromUri(safeUri) || "Document";
  const stat = await statFile(safeUri);

  const identity: FileIdentity = {
    key: identityKeyFrom(resolvedName, stat.size),
    fileId: hashString(safeUri),
    uri: safeUri,
    name: resolvedName,
    ext: extensionFromName(resolvedName),
  };
  if (typeof stat.size === "number") identity.size = stat.size;
  if (typeof stat.mtime === "number") identity.mtime = stat.mtime;
  return identity;
}

/**
 * Synchronous identity from values already in hand (a file-index record, a
 * saved record). Does no I/O, so it cannot discover a size it wasn't given.
 */
export function identityFromKnown(known: {
  uri?: string;
  name: string;
  size?: number;
  mtime?: number;
}): FileIdentity {
  const name = (known.name || "").trim() || fileNameFromUri(known.uri || "") || "Document";
  const identity: FileIdentity = {
    key: identityKeyFrom(name, known.size),
    fileId: hashString(known.uri || ""),
    uri: known.uri || "",
    name,
    ext: extensionFromName(name),
  };
  if (typeof known.size === "number") identity.size = known.size;
  if (typeof known.mtime === "number") identity.mtime = known.mtime;
  return identity;
}

/**
 * Every key a file-index record could have been saved under: the size-aware
 * key when the index knows the size, and always the name-only key. Matching
 * both directions means a record saved before the size was readable still
 * finds its file, and vice versa.
 */
function candidateKeysFor(file: { name: string; size?: number }): string[] {
  const keys = [identityKeyFrom(file.name)];
  if (typeof file.size === "number" && Number.isFinite(file.size)) {
    keys.unshift(identityKeyFrom(file.name, file.size));
  }
  return keys;
}

/**
 * Find a currently-valid URI for an identity key, or null when the file is
 * gone. Both Saved Pages and reading sessions need this to answer "can I
 * still open this?" — and a `null` is a normal answer there, not an error.
 *
 * Never throws.
 */
export async function resolveIdentityToLiveUri(
  key: string,
): Promise<string | null> {
  if (!key) return null;

  let files: { name: string; uri: string; size?: number }[] = [];
  try {
    files = await getAllFiles();
  } catch {
    return null;
  }

  // getAllFiles() is sorted most-recently-opened first, so the first match is
  // the copy the user actually reads.
  const matches = files.filter((f) => candidateKeysFor(f).includes(key));
  if (matches.length === 0) return null;

  for (const match of matches) {
    const stat = await statFile(match.uri);
    // exists === null means "could not stat" (SAF). We cannot prove it is
    // gone, so we hand it back and let the viewer report its own failure.
    if (stat.exists !== false) return match.uri;
  }
  return null;
}

/** Test-only: the key prefix, so tests assert on shape without hard-coding it. */
export const __IDENTITY_KEY_PREFIX = KEY_PREFIX;

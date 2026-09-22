// ============================================
// withDocRecovery (W3.3)
// ---------------------------------------------
// Runs a docId-based request and recovers ONCE when the backend says the
// document is gone (DOC_NOT_FOUND, or a 404 from an older backend):
//   1. forget the cached upload,
//   2. re-upload silently while the overlay reads "Reloading document…",
//   3. retry the request once with the new docId.
// A second failure is thrown to the caller — it never loops.
// ============================================

import { AI_PERSISTENT_DOC_CACHE } from "@/constants/featureFlags";
import { useActivityStore } from "@/services/activity/activityStore";

import type { AIDocumentRef } from "./ai.types";
import { AIError, isAIError } from "./aiErrors";
import { canUse } from "./capabilities";
import { ensureDocumentUploaded, forgetDocument, getDocRefDocId } from "./docSessionCache";

export const RELOADING_DOCUMENT_LABEL = "Reloading document…";

export interface DocRecoveryOptions {
  /** Upload the document again and return its new docId. */
  reupload?: (doc: AIDocumentRef) => Promise<string>;
  /** Called once, just before the re-upload starts. */
  onReloading?: () => void;
}

function defaultOnReloading(): void {
  try {
    useActivityStore.getState().update({ label: RELOADING_DOCUMENT_LABEL });
  } catch {
    // no overlay running — nothing to update
  }
}

async function defaultReupload(doc: AIDocumentRef): Promise<string> {
  const ensured = await ensureDocumentUploaded(doc, {
    force: true,
    needText: false,
    persist: canUse(AI_PERSISTENT_DOC_CACHE, "persistentDocs"),
  });
  return ensured.entry.docId;
}

export function isDocNotFound(err: unknown): boolean {
  return isAIError(err) && err.code === "DOC_NOT_FOUND";
}

export async function withDocRecovery<T>(
  docRef: AIDocumentRef,
  fn: (docId: string) => Promise<T>,
  opts: DocRecoveryOptions = {},
): Promise<T> {
  const reupload = opts.reupload ?? defaultReupload;
  let docId = getDocRefDocId(docRef);
  if (!docId) {
    if (!docRef.uri) throw new AIError("DOC_NOT_FOUND", "This document hasn't been uploaded yet.");
    docId = await reupload(docRef);
  }

  try {
    return await fn(docId);
  } catch (err) {
    if (!isDocNotFound(err) || !docRef.uri) throw err;
    await forgetDocument(docRef);
    (opts.onReloading ?? defaultOnReloading)();
    const freshId = await reupload(docRef);
    return await fn(freshId);
  }
}

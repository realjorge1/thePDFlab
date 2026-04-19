// ============================================================================
// usePptxRender — state machine hook driving the PPTX viewer screen.
//
// Orchestrates:
//   1. Persistent cache lookup (hybrid cache mode — instant if we have it)
//   2. Upload + convert on the backend (online mode, the common path)
//   3. Download and persist the rendered PDF
//   4. Retry with exponential backoff on transient failures
//
// Exposes a single `stage` object that fully describes what the UI should
// show, plus a `retry()` trigger.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";

import {
  buildCacheKey,
  lookupCached,
  storeRendered,
} from "../services/pptxCache";
import { uploadConvertAndDownload } from "../services/pptxRenderClient";
import { isLikelyOffline, withRetry } from "../services/pptxRetry";
import type { RenderStage } from "../types/pptxViewer";

export interface UsePptxRenderResult {
  stage: RenderStage;
  retry: () => void;
}

export function usePptxRender(
  fileUri: string,
  fileName: string,
): UsePptxRenderResult {
  const [stage, setStage] = useState<RenderStage>({ phase: "idle" });
  const mountedRef = useRef(true);
  const tickRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setStageIfMounted = useCallback((next: RenderStage) => {
    if (mountedRef.current) setStage(next);
  }, []);

  const run = useCallback(async () => {
    const myTick = ++tickRef.current;
    const cancelled = () => myTick !== tickRef.current || !mountedRef.current;

    if (!fileUri) {
      setStageIfMounted({
        phase: "error",
        message: "No file provided.",
        retryable: false,
        offlineSuspected: false,
      });
      return;
    }

    setStageIfMounted({
      phase: "preparing",
      message: "Checking local cache…",
    });

    // ── Validate source file exists ─────────────────────────────
    const info = await FileSystem.getInfoAsync(fileUri);
    if (!info.exists) {
      setStageIfMounted({
        phase: "error",
        message: "The source file could not be found.",
        retryable: false,
        offlineSuspected: false,
      });
      return;
    }

    // ── Hybrid cache mode: try local persistent cache first ─────
    let cacheKey = "";
    try {
      cacheKey = await buildCacheKey(fileUri);
      const hit = await lookupCached({ cacheKey });
      if (cancelled()) return;
      if (hit) {
        setStageIfMounted({
          phase: "ready",
          pdfUri: `file://${hit.pdfPath.replace(/^file:\/\//, "")}`,
          serverId: hit.serverId,
          fromCache: true,
          sizeBytes: hit.sizeBytes,
        });
        return;
      }
    } catch {
      // non-fatal — fall through to online mode
    }

    // ── Online mode: upload → convert → download, with retry ────
    try {
      const result = await withRetry(
        () =>
          uploadConvertAndDownload(fileUri, fileName, (progress) => {
            if (cancelled()) return;
            if (progress.stage === "uploading") {
              setStageIfMounted({
                phase: "uploading",
                message: "Uploading presentation…",
              });
            } else if (progress.stage === "rendering") {
              setStageIfMounted({
                phase: "rendering",
                message: "Rendering slides on server…",
              });
            } else if (progress.stage === "downloading") {
              setStageIfMounted({
                phase: "downloading",
                message: "Downloading rendered slides…",
              });
            }
          }),
        {
          maxAttempts: 3,
          baseDelayMs: 1200,
          onAttempt: (attempt) => {
            if (cancelled()) return;
            setStageIfMounted({
              phase: "rendering",
              message: `Retrying (attempt ${attempt + 1} of 3)…`,
            });
          },
        },
      );

      if (cancelled()) return;

      // Second cache check by serverId — handles content-dedup across URIs
      const byServerId = await lookupCached({ serverId: result.server.id });
      if (cancelled()) return;

      let finalPath: string;
      let sizeBytes: number;

      if (byServerId) {
        // Same content already cached under a different key — drop the just-
        // downloaded copy, reuse existing.
        try {
          await FileSystem.deleteAsync(result.localPdfUri, {
            idempotent: true,
          });
        } catch {
          // ignore
        }
        finalPath = byServerId.pdfPath;
        sizeBytes = byServerId.sizeBytes;
      } else {
        const stored = await storeRendered({
          cacheKey: cacheKey || `anon::${result.server.id}`,
          serverId: result.server.id,
          sourcePdfUri: result.localPdfUri,
          downloadName: result.server.downloadName,
          originalName: result.server.originalName,
        });
        finalPath = stored.pdfPath;
        sizeBytes = stored.sizeBytes;
      }

      if (cancelled()) return;

      setStageIfMounted({
        phase: "ready",
        pdfUri: finalPath.startsWith("file://") ? finalPath : `file://${finalPath}`,
        serverId: result.server.id,
        fromCache: false,
        sizeBytes,
      });
    } catch (err) {
      if (cancelled()) return;
      const e = err instanceof Error ? err : new Error(String(err));
      setStageIfMounted({
        phase: "error",
        message: e.message || "Conversion failed.",
        retryable: true,
        offlineSuspected: isLikelyOffline(e),
      });
    }
  }, [fileUri, fileName, setStageIfMounted]);

  useEffect(() => {
    run();
    return () => {
      // Invalidate in-flight work when fileUri/fileName changes or unmounts.
      tickRef.current += 1;
    };
  }, [run]);

  const retry = useCallback(() => {
    run();
  }, [run]);

  return { stage, retry };
}

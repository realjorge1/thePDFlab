// ============================================================================
// usePptxRender — state machine hook driving the PPTX viewer screen.
//
// Orchestrates:
//   1. Persistent cache lookup (hybrid cache mode — instant if we have it)
//   2. Upload + convert on the backend (online mode, the only render path)
//   3. Download and persist the rendered PDF
//   4. Retry with exponential backoff on transient failures
//   5. Cold-start recovery: wake the service + health-check before giving up
//
// Server failure NEVER silently degrades to the on-device HTML renderer —
// that low-fidelity output is only reachable through the explicit
// `showBasicPreview()` action the user taps on the error screen.
//
// Exposes a single `stage` object that fully describes what the UI should
// show, plus `retry()` and `showBasicPreview()` triggers.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";

import { wakeUpBackend } from "@/config/api";
import {
  buildCacheKey,
  lookupCached,
  storeRendered,
} from "../services/pptxCache";
import {
  isPptxRendererAvailable,
  PptxConversionError,
  uploadConvertAndDownload,
  type RenderProgress,
} from "../services/pptxRenderClient";
import { isLikelyOffline, withRetry } from "../services/pptxRetry";
import type { RenderStage } from "../types/pptxViewer";
import {
  buildPresentationHtml,
  parsePPTXForViewer,
} from "@/src/ppt-module/services/pptxHtmlRenderer.service";

// Render the deck entirely on-device (no backend). Text-only, low fidelity —
// only ever shown when the user explicitly asks for it via showBasicPreview().
async function renderOffline(fileUri: string): Promise<RenderStage> {
  const data = await parsePPTXForViewer(fileUri);
  if (!data.slides.length) {
    throw new Error("No slides found in this presentation.");
  }
  return {
    phase: "ready_offline",
    html: buildPresentationHtml(data),
    totalSlides: data.slides.length,
  };
}

export interface UsePptxRenderResult {
  stage: RenderStage;
  retry: () => void;
  showBasicPreview: () => void;
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
        canBasicPreview: false,
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
        canBasicPreview: false,
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

    const reportProgress = (progress: RenderProgress) => {
      if (cancelled()) return;
      if (progress.stage === "uploading") {
        setStageIfMounted({
          phase: "uploading",
          message: "Uploading presentation…",
        });
      } else if (progress.stage === "rendering") {
        setStageIfMounted({
          phase: "rendering",
          message: "Rendering slides…",
        });
      } else if (progress.stage === "downloading") {
        setStageIfMounted({
          phase: "downloading",
          message: "Downloading rendered slides…",
        });
      }
    };

    // Persist + publish a successful conversion result.
    const finalize = async (
      result: Awaited<ReturnType<typeof uploadConvertAndDownload>>,
    ) => {
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
        pdfUri: finalPath.startsWith("file://")
          ? finalPath
          : `file://${finalPath}`,
        serverId: result.server.id,
        fromCache: false,
        sizeBytes,
      });
    };

    // Build the terminal error stage. The basic-preview escape hatch is
    // offered for every render failure — it is never entered automatically.
    const fail = (e: Error) => {
      const offline = isLikelyOffline(e);
      const message =
        e instanceof PptxConversionError
          ? e.message
          : offline
            ? "Presentation viewing needs an internet connection. Check your connection and try again."
            : e.message || "Could not open presentation.";
      setStageIfMounted({
        phase: "error",
        message,
        // A 400 (INVALID_INPUT) won't succeed on retry — same file, same
        // rejection. Everything else may be transient.
        retryable: !(e instanceof PptxConversionError && e.status === 400),
        offlineSuspected: offline,
        canBasicPreview: true,
      });
    };

    // ── Online mode: upload → convert → download, with retry ────
    try {
      const result = await withRetry(
        () => uploadConvertAndDownload(fileUri, fileName, reportProgress),
        {
          maxAttempts: 3,
          baseDelayMs: 1200,
          // Don't burn retries (each re-uploads the file) when the renderer
          // is unavailable (503) or the file itself is rejected (400) — fall
          // straight through to the wake-up / health check below.
          shouldRetry: (e) => {
            if (e instanceof PptxConversionError) {
              if (e.status === 503 || e.status === 400) return false;
              return e.status >= 500;
            }
            return /network|timed out|timeout|fetch failed|aborted/i.test(
              e.message || "",
            );
          },
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
      await finalize(result);
    } catch (err) {
      if (cancelled()) return;
      const e = err instanceof Error ? err : new Error(String(err));

      // The file itself was rejected — waking the service can't help.
      if (e instanceof PptxConversionError && e.status === 400) {
        fail(e);
        return;
      }

      // ── Cold-start recovery ─────────────────────────────────────
      // Free-tier instances sleep; the failure may just mean the service
      // hadn't woken up yet. Wake it, confirm the renderer is healthy, then
      // make one final attempt before surfacing the error.
      setStageIfMounted({ phase: "preparing", message: "Please wait…" });
      const awake = await wakeUpBackend((msg) => {
        if (!cancelled()) setStageIfMounted({ phase: "preparing", message: msg });
      });
      if (cancelled()) return;
      const healthy = awake && (await isPptxRendererAvailable());
      if (cancelled()) return;

      if (!healthy) {
        fail(e);
        return;
      }

      try {
        const result = await uploadConvertAndDownload(
          fileUri,
          fileName,
          reportProgress,
        );
        if (cancelled()) return;
        await finalize(result);
      } catch (err2) {
        if (cancelled()) return;
        fail(err2 instanceof Error ? err2 : new Error(String(err2)));
      }
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

  // Explicit, user-initiated low-fidelity preview. Never runs automatically.
  const showBasicPreview = useCallback(async () => {
    const myTick = ++tickRef.current;
    const cancelled = () => myTick !== tickRef.current || !mountedRef.current;

    setStageIfMounted({
      phase: "preparing",
      message: "Preparing basic preview…",
    });
    try {
      const offline = await renderOffline(fileUri);
      if (cancelled()) return;
      setStageIfMounted(offline);
    } catch (err) {
      if (cancelled()) return;
      const e = err instanceof Error ? err : new Error(String(err));
      setStageIfMounted({
        phase: "error",
        message: e.message || "A basic preview isn't available for this file.",
        retryable: true,
        offlineSuspected: false,
        canBasicPreview: false,
      });
    }
  }, [fileUri, setStageIfMounted]);

  return { stage, retry, showBasicPreview };
}

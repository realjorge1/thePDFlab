// ============================================================================
// Types for the isolated online PPTX viewer feature.
// ============================================================================

export type RenderStage =
  | { phase: "idle" }
  | { phase: "preparing"; message: string }
  | { phase: "uploading"; message: string }
  | { phase: "rendering"; message: string }
  | { phase: "downloading"; message: string }
  | {
      phase: "ready";
      pdfUri: string;
      serverId: string;
      fromCache: boolean;
      sizeBytes: number;
    }
  | {
      phase: "error";
      message: string;
      retryable: boolean;
      offlineSuspected: boolean;
    };

export interface PptxRenderServerResult {
  id: string;
  sizeBytes: number;
  originalName: string | null;
  downloadName: string;
  streamUrl: string;
  downloadUrl: string;
}

export interface RenderedPptxPdf {
  serverId: string;
  localPdfUri: string;
  sizeBytes: number;
  fromCache: boolean;
}

export interface CacheEntry {
  cacheKey: string;
  serverId: string;
  pdfPath: string;
  sizeBytes: number;
  renderedAt: number;
  lastAccessedAt: number;
  originalName: string | null;
}

export interface CacheIndex {
  version: 1;
  entries: Record<string, CacheEntry>;
  serverIdIndex: Record<string, string>;
}

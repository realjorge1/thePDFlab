// ============================================================================
// Public surface of the isolated online PPTX viewer feature.
//
// The whole module is self-contained: to remove the feature, delete this
// folder and the route registration in app/_layout.tsx. Nothing else in the
// app depends on these exports.
// ============================================================================

export { default as PptxViewerOnlineScreen } from "./screens/PptxViewerOnlineScreen";
export { clearPptxCache, getCacheStats } from "./services/pptxCache";
export { isPptxRendererAvailable } from "./services/pptxRenderClient";
export type { RenderStage } from "./types/pptxViewer";

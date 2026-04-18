// DEPRECATED — the client-side WebView PPTX renderer is no longer used.
// PPTX display now flows through the backend: see services/pptxRenderClient.ts
// and app/ppt-viewer.tsx. The exports below remain only for reference.
export { default as PptxViewer } from './PptxViewer';
export type { PptxViewerProps, PptxViewerHandle } from './PptxViewer';

/**
 * DocLib — public surface for the SAF-backed document library.
 *
 * Internal modules are deliberately self-contained so the existing app code can
 * adopt them without restructuring.
 */

export { default as docLibDb } from "./database";
export type { DocumentRecord, FolderRecord, DocumentType } from "./database";

export { default as fileIndexer } from "./fileIndexer";
export type { IndexingStatus } from "./fileIndexer";

export { default as SAF } from "./safBridge";
export type { ScannedFile, FolderSelection } from "./safBridge";

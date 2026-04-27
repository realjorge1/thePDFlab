export interface GeneratedDocPreview {
  content: string;
  title: string;
  fileType: "pdf" | "docx" | "ppt";
  category?: string;
  tone?: string;
  wordCount?: number;
}

let _pending: GeneratedDocPreview | null = null;

export function setPendingGeneration(data: GeneratedDocPreview): void {
  _pending = data;
}

export function getPendingGeneration(): GeneratedDocPreview | null {
  return _pending;
}

export function clearPendingGeneration(): void {
  _pending = null;
}

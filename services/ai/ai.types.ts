// ============================================
// AI Types – shared across providers and UI
// ============================================

/** Every AI action the app supports. */
export type AIAction =
  | "chat"
  | "translate"
  | "summarize"
  | "extract-text"
  | "extract-data"
  | "analyze"
  | "tasks"
  | "fill-form"
  | "generate-document"
  | "chat-with-document"
  | "classify"
  | "highlight"
  | "explain"
  | "quiz";

/** A single message in a conversation. */
export interface AIChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number; // epoch ms
  /** Optional structured data attached to the message (for extract-data, fill-form, etc.) */
  structuredData?: Record<string, unknown>;
}

/** Metadata about a document attached to an AI session. */
export interface AIDocumentRef {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
  /** Extracted text content (may be partial or empty). */
  extractedText?: string;
}

/** A persistent AI session. */
export interface AISession {
  id: string;
  action: AIAction;
  title: string;
  messages: AIChatMessage[];
  document?: AIDocumentRef;
  createdAt: number;
  updatedAt: number;
}

// ─── Request / Response shapes ────────────────────────────────────────────────

export interface AISummarizeRequest {
  text: string;
  documentName?: string;
}

export interface AITranslateRequest {
  text: string;
  targetLanguage: string;
  documentName?: string;
}

export interface AIExtractDataRequest {
  text: string;
  dataType?: string; // "tables" | "entities" | "key-value" | "all"
  documentName?: string;
}

export interface AIAnalyzeRequest {
  text: string;
  analysisType?: string; // "sentiment" | "readability" | "structure" | "full"
  documentName?: string;
}

export interface AITasksRequest {
  text: string;
  documentName?: string;
}

export interface AIGenerateDocumentRequest {
  prompt: string;
  fileType: "docx" | "pdf" | "ppt";
  category: string;
  tone?: string;
  wordCount?: number;
  audience?: string;
}

export interface AIChatRequest {
  message: string;
  history: AIChatMessage[];
  documentText?: string;
  documentName?: string;
}

export interface AIClassifyRequest {
  text: string;
  filename?: string;
}

export interface AIHighlightRequest {
  text: string;
  documentName?: string;
}

export interface AIExplainRequest {
  text: string;
  mode?: "plain" | "legal" | "medical" | "technical";
}

export interface AIQuizRequest {
  text: string;
  quizType?: "quiz" | "comprehension" | "flashcards";
  count?: number;
  documentName?: string;
}

export interface AIResponse {
  content: string;
  structuredData?: Record<string, unknown>;
}

// ─── Language list (used by translate) ────────────────────────────────────────

export interface Language {
  code: string;
  name: string;
}

export const SUPPORTED_LANGUAGES: Language[] = [
  // ── Featured ──────────────────────────────────────────────────
  { code: "en", name: "English" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
  { code: "de", name: "German" },
  { code: "ig", name: "Igbo" },
  { code: "yo", name: "Yoruba" },
  { code: "ha", name: "Hausa" },

  // ── European Languages ────────────────────────────────────────
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "nl", name: "Dutch" },
  { code: "pl", name: "Polish" },
  { code: "sv", name: "Swedish" },
  { code: "da", name: "Danish" },
  { code: "fi", name: "Finnish" },
  { code: "no", name: "Norwegian" },
  { code: "el", name: "Greek" },
  { code: "cs", name: "Czech" },
  { code: "ro", name: "Romanian" },
  { code: "hu", name: "Hungarian" },
  { code: "sk", name: "Slovak" },
  { code: "bg", name: "Bulgarian" },
  { code: "hr", name: "Croatian" },
  { code: "sr", name: "Serbian" },
  { code: "sl", name: "Slovenian" },
  { code: "lt", name: "Lithuanian" },
  { code: "lv", name: "Latvian" },
  { code: "et", name: "Estonian" },
  { code: "uk", name: "Ukrainian" },
  { code: "be", name: "Belarusian" },
  { code: "ga", name: "Irish" },
  { code: "cy", name: "Welsh" },
  { code: "is", name: "Icelandic" },
  { code: "mt", name: "Maltese" },
  { code: "sq", name: "Albanian" },
  { code: "mk", name: "Macedonian" },
  { code: "bs", name: "Bosnian" },
  { code: "ca", name: "Catalan" },
  { code: "gl", name: "Galician" },
  { code: "eu", name: "Basque" },
  { code: "lb", name: "Luxembourgish" },

  // ── African Languages ─────────────────────────────────────────
  { code: "zu", name: "Zulu" },
  { code: "xh", name: "Xhosa" },
  { code: "sw", name: "Swahili" },
  { code: "am", name: "Amharic" },
  { code: "sn", name: "Shona" },
  { code: "rw", name: "Kinyarwanda" },
  { code: "so", name: "Somali" },
  { code: "af", name: "Afrikaans" },

  // ── Asian & Middle Eastern Languages ──────────────────────────
  { code: "ru", name: "Russian" },
  { code: "tr", name: "Turkish" },
  { code: "ar", name: "Arabic" },
  { code: "he", name: "Hebrew" },
  { code: "fa", name: "Persian" },
  { code: "hi", name: "Hindi" },
  { code: "bn", name: "Bengali" },
  { code: "ur", name: "Urdu" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "zh", name: "Chinese (Simplified)" },
  { code: "zh-TW", name: "Chinese (Traditional)" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "th", name: "Thai" },
  { code: "vi", name: "Vietnamese" },
  { code: "id", name: "Indonesian" },
  { code: "ms", name: "Malay" },
  { code: "tl", name: "Filipino (Tagalog)" },
];

// ─── AI Feature metadata (for UI) ────────────────────────────────────────────

export interface AIFeatureMeta {
  id: AIAction;
  name: string;
  description: string;
  color: string;
  /** lucide icon key */
  icon: string;
  /** Whether this feature requires document input */
  requiresDocument: boolean;
  /** Placeholder text for the input field */
  inputPlaceholder: string;
}

export const AI_FEATURES: AIFeatureMeta[] = [
  {
    id: "chat",
    name: "ask xumpta",
    description: "Have a conversation with xumpta",
    color: "#6366F1",
    icon: "message-square",
    requiresDocument: false,
    inputPlaceholder: "Ask me anything...",
  },
  {
    id: "summarize",
    name: "Summarize",
    description: "Get a concise summary of text or documents",
    color: "#2563EB",
    icon: "book-open",
    requiresDocument: false,
    inputPlaceholder: "Paste text or attach file...",
  },
  {
    id: "translate",
    name: "Translate",
    description: "Translate text to any language",
    color: "#9333EA",
    icon: "languages",
    requiresDocument: false,
    inputPlaceholder: "Paste text or attach file...",
  },
  {
    id: "extract-text",
    name: "Extract Text",
    description: "Pull readable text from PDFs",
    color: "#059669",
    icon: "file-text",
    requiresDocument: true,
    inputPlaceholder: "Attach a PDF to extract text...",
  },
  {
    id: "extract-data",
    name: "Extract Data",
    description: "Pull structured data from documents",
    color: "#10B981",
    icon: "file-search",
    requiresDocument: false,
    inputPlaceholder: "Paste text or attach file...",
  },
  {
    id: "analyze",
    name: "Analyze",
    description: "Deep analysis & insights",
    color: "#F59E0B",
    icon: "brain",
    requiresDocument: false,
    inputPlaceholder: "Paste text or attach file...",
  },
  {
    id: "tasks",
    name: "Extract Tasks",
    description: "Find action items & tasks",
    color: "#06B6D4",
    icon: "list-checks",
    requiresDocument: false,
    inputPlaceholder: "Paste text or attach a document to find tasks...",
  },
  {
    id: "fill-form",
    name: "Fill Form",
    description: "Auto-fill forms with xumpta",
    color: "#14B8A6",
    icon: "file-signature",
    requiresDocument: true,
    inputPlaceholder: "Describe the data to fill or paste source text...",
  },
  {
    id: "classify",
    name: "Classify",
    description: "Detect document type & suggest filename",
    color: "#F97316",
    icon: "scan-search",
    requiresDocument: true,
    inputPlaceholder: "Attach a document to classify...",
  },
  {
    id: "highlight",
    name: "Highlights",
    description: "Find key points & critical sentences",
    color: "#EAB308",
    icon: "highlighter",
    requiresDocument: false,
    inputPlaceholder: "Paste text or attach file to highlight...",
  },
  {
    id: "explain",
    name: "Explain",
    description: "Simplify complex text for anyone",
    color: "#22D3EE",
    icon: "lightbulb",
    requiresDocument: false,
    inputPlaceholder: "Paste complex text to simplify...",
  },
  {
    id: "quiz",
    name: "Quiz",
    description: "Generate quizzes & study materials",
    color: "#A855F7",
    icon: "graduation-cap",
    requiresDocument: false,
    inputPlaceholder: "Paste text or attach file to generate quiz...",
  },
  {
    id: "generate-document",
    name: "Generate Document",
    description: "Create professional documents from scratch",
    color: "#14B8A6",
    icon: "wand-2",
    requiresDocument: false,
    inputPlaceholder: "Describe the document you need...",
  },
  {
    id: "chat-with-document",
    name: "Chat with File",
    description: "Ask questions about a PDF, DOCX, or EPUB",
    color: "#EC4899",
    icon: "file-text",
    requiresDocument: true,
    inputPlaceholder: "Ask a question about the document...",
  },
];

/** Generate a unique id (good enough for local use). */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

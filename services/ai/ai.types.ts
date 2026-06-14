// ============================================
// AI Types – shared across providers and UI
// ============================================

/** Every AI action the app supports. */
export type AIAction =
  | "chat"
  | "translate"
  | "summarize"
  | "analyze"
  | "tasks"
  | "fill-form"
  | "generate-document"
  | "chat-with-document"
  | "devils-advocate"
  | "narrative-arc"
  | "highlight"
  | "explain"
  | "quiz";

/** A single message in a conversation. */
export interface AIChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number; // epoch ms
  /** Optional structured data attached to the message (for fill-form, classify, etc.) */
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
  /** Optional abort signal for cancellation (see runCancelable). */
  signal?: AbortSignal;
}

export interface AITranslateRequest {
  text: string;
  targetLanguage: string;
  documentName?: string;
  signal?: AbortSignal;
}

export interface AIAnalyzeRequest {
  text: string;
  analysisType?: string; // "sentiment" | "readability" | "structure" | "full"
  documentName?: string;
  signal?: AbortSignal;
}

export interface AITasksRequest {
  text: string;
  documentName?: string;
  signal?: AbortSignal;
}

export interface AIGenerateDocumentRequest {
  prompt: string;
  fileType: "docx" | "pdf" | "ppt";
  category: string;
  tone?: string;
  wordCount?: number;
  audience?: string;
  signal?: AbortSignal;
}

export interface AIChatRequest {
  message: string;
  history: AIChatMessage[];
  documentText?: string;
  documentName?: string;
  signal?: AbortSignal;
}

// ─── Devil's Advocate ────────────────────────────────────────────────────────

/** Who will scrutinize the document. "auto" lets the backend infer from type. */
export type ChallengerRole =
  | "auto"
  | "investor"
  | "client"
  | "procurement"
  | "peer-reviewer"
  | "opposing-counsel"
  | "stakeholder"
  | "cfo"
  | "evaluation-committee"
  | "custom";

/** Selectable challengers shown in the "Who will read this?" picker. */
export const CHALLENGER_ROLES: { key: ChallengerRole; label: string }[] = [
  { key: "auto", label: "Auto" },
  { key: "investor", label: "Investor" },
  { key: "client", label: "Client" },
  { key: "procurement", label: "Procurement" },
  { key: "peer-reviewer", label: "Peer Reviewer" },
  { key: "opposing-counsel", label: "Opposing Counsel" },
  { key: "cfo", label: "CFO" },
  { key: "stakeholder", label: "Stakeholder" },
  { key: "evaluation-committee", label: "Evaluation Cmte" },
];

export interface AIDevilsAdvocateRequest {
  text: string;
  documentName?: string;
  /** Auto-inferred challenger unless the user overrides it. */
  role?: ChallengerRole;
  /** Free-text role when role === "custom". */
  customRole?: string;
  /** Optional second context document (RFP, competitor doc, rejection letter…). */
  contextText?: string;
  contextName?: string;
  signal?: AbortSignal;
}

export type DocFormat = "pptx" | "docx" | "pdf";

export interface AINarrativeArcRequest {
  text: string;
  documentName?: string;
  /** Drives the expected structure + whether reorder is actionable. */
  format?: DocFormat;
  /** Optional RFP/context document for cross-document section coverage. */
  contextText?: string;
  contextName?: string;
  signal?: AbortSignal;
}

// ─── Devil's Advocate structured output ───────────────────────────────────────

export type ObjectionSeverity = "critical" | "high" | "medium";

export interface Objection {
  title: string;
  detail?: string;
  severity?: ObjectionSeverity;
  /** e.g. "Slide 7" / "Section 3" / "Clause 4.2". */
  reference?: string;
}

export interface BlindSpot {
  text: string;
  why?: string;
}

export interface FormatExtra {
  label: string;
  detail: string;
  /** Where it applies, e.g. "after slide 7". */
  location?: string;
}

export interface GroundedObjection {
  claim: string;
  evidence: string;
  /** Citation into the context document, e.g. "page 12". */
  source?: string;
}

export type CoverageStatus = "covered" | "missing" | "partial";

export interface RfpCriterion {
  criterion: string;
  status: CoverageStatus;
  note?: string;
}

export interface DevilsAdvocateData {
  __kind: "devils-advocate";
  /** Human label for the inferred/selected challenger, e.g. "Skeptical Investor". */
  detectedRole: string;
  roleKey: ChallengerRole;
  documentType?: string;
  killerObjections: Objection[];
  secondaryChallenges: Objection[];
  blindSpots: BlindSpot[];
  formatExtras?: FormatExtra[];
  groundedObjections?: GroundedObjection[];
  rfpCoverage?: RfpCriterion[];
}

// ─── Narrative Arc structured output ──────────────────────────────────────────

export type ArcVerdict = "strong" | "weak" | "broken";
export type ArcSectionStatus = "ok" | "misplaced" | "missing" | "extra";

export interface ArcSection {
  title: string;
  index: number;
  /** The structural role this section plays, e.g. "Problem", "Proof". */
  role?: string;
  status: ArcSectionStatus;
}

export interface ReorderStep {
  instruction: string;
  from?: number;
  to?: number;
}

export interface NarrativeArcData {
  __kind: "narrative-arc";
  verdict: ArcVerdict;
  verdictLine: string;
  detectedType: string;
  format: DocFormat;
  diagnosis: string;
  /** The ideal arc for the detected type, e.g. ["Problem","Agitate","Solution","Proof","CTA"]. */
  idealStructure?: string[];
  detectedSections: ArcSection[];
  reorder: ReorderStep[];
  rfpCoverage?: RfpCriterion[];
  /** PPTX/DOCX are reorderable; PDF is recommendations-only. */
  editable: boolean;
}

export interface AIHighlightRequest {
  text: string;
  documentName?: string;
  signal?: AbortSignal;
}

// ─── Highlight-specific types ────────────────────────────────────────────────

export type HighlightImportance = "critical" | "high" | "medium";

export interface HighlightSourceReference {
  page?: number;
  section?: string;
  paragraphIndex?: number;
  snippet?: string;
}

export interface HighlightItem {
  text: string;
  importance: HighlightImportance;
  category: string;
  reason: string;
  confidence?: number; // 0-100
  sourceReference?: HighlightSourceReference;
}

export interface HighlightMeta {
  summary?: string[];
  keyThemes?: string[];
  documentType?: string;
  /** Number of highlights per page — populated when sourceReferences include page numbers. */
  pageDensity?: Array<{ page: number; count: number }>;
}

export interface HighlightData {
  highlights: HighlightItem[];
  meta?: HighlightMeta;
}

export interface AIHighlightSummaryRequest {
  highlights: HighlightItem[];
  documentName?: string;
}

export type ExplainMode =
  | "simple"
  | "plain"
  | "professional"
  | "legal"
  | "medical"
  | "technical"
  | "bullet";

export type ExplainDepth = "short" | "medium" | "deep";

export interface AIExplainRequest {
  text: string;
  mode?: ExplainMode;
  depth?: ExplainDepth;
  signal?: AbortSignal;
}

// ─── Quiz-specific types ──────────────────────────────────────────────────────

export type QuizQuestionType = "mcq" | "true_false" | "short";
export type QuizDifficulty = "easy" | "medium" | "hard" | "adaptive";
export type QuizLength = "quick" | "standard" | "deep";

export interface QuizSourceReference {
  page?: number;
  slide?: number;
  section?: string;
  paragraphIndex?: number;
  snippet?: string;
}

export interface QuizQuestion {
  id: string;
  type: QuizQuestionType;
  question: string;
  /** Option strings – only present for MCQ type. */
  options?: string[];
  /** For MCQ: exact option text; for true_false: "True"/"False"; for short: sample answer. */
  answer: string;
  explanation: string;
  /** Verbatim passage copied from the document that proves the answer. Required for grounded output. */
  source_text?: string;
  /** Backend-validated location info for source_text (page/slide/section). */
  source_reference?: QuizSourceReference | string;
  difficulty: "easy" | "medium" | "hard";
  topic: string;
}

export interface AIQuizRequest {
  text: string;
  /** Backend docId from a prior extract-pdf/extract-document call. Enables true RAG grounding. */
  docId?: string;
  questionType?: QuizQuestionType | "mixed";
  length?: QuizLength;
  difficulty?: QuizDifficulty;
  documentName?: string;
  /** Topics the user struggled with (for Practice Weak Areas). */
  weakTopics?: string[];
  signal?: AbortSignal;
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
    name: "ask gozlin",
    description: "Have a conversation with gozlin",
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
    description: "Auto-fill forms with gozlin",
    color: "#14B8A6",
    icon: "file-signature",
    requiresDocument: true,
    inputPlaceholder: "Describe the data to fill or paste source text...",
  },
  {
    id: "devils-advocate",
    name: "Devil's Advocate",
    description: "Surfaces the hardest objections your audience will raise — grounded in what you wrote",
    color: "#DC2626",
    icon: "scale",
    requiresDocument: true,
    inputPlaceholder: "Attach a file or deck to stress-test...",
  },
  {
    id: "narrative-arc",
    name: "Narrative Arc",
    description: "Checks whether your slides or sections flow as a story, and suggests a reorder",
    color: "#0EA5E9",
    icon: "waypoints",
    requiresDocument: true,
    inputPlaceholder: "Attach a file or deck to check the arc...",
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

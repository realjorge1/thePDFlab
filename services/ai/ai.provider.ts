// ============================================
// AI Provider Interface
// Abstracting the backend so we can swap mock ↔ real easily.
// ============================================

import type {
    AIAnalyzeRequest,
    AIChatRequest,
    AIClassifyRequest,
    AIExplainRequest,
    AIExtractDataRequest,
    AIGenerateDocumentRequest,
    AIHighlightRequest,
    AIQuizRequest,
    AIResponse,
    AISummarizeRequest,
    AITasksRequest,
    AITranslateRequest,
} from "./ai.types";

/**
 * Any AI backend must implement this interface.
 * The mock provider fulfils it locally; the real one will call the server.
 */
export interface AIProvider {
  /** Free-form chat (optionally with document context). */
  chat(req: AIChatRequest): Promise<AIResponse>;

  /** Summarize the given text / document. */
  summarize(req: AISummarizeRequest): Promise<AIResponse>;

  /** Translate text to a target language. */
  translate(req: AITranslateRequest): Promise<AIResponse>;

  /** Extract structured data from text. */
  extractData(req: AIExtractDataRequest): Promise<AIResponse>;

  /** Analyze text for sentiment, readability, etc. */
  analyze(req: AIAnalyzeRequest): Promise<AIResponse>;

  /** Extract action items / tasks from text. */
  extractTasks(req: AITasksRequest): Promise<AIResponse>;

  /** Generate a document based on prompts and parameters. */
  generateDocument(req: AIGenerateDocumentRequest): Promise<AIResponse>;

  /** Classify a document and suggest a descriptive filename. */
  classify(req: AIClassifyRequest): Promise<AIResponse>;

  /** Identify key points and critical sentences in text. */
  highlight(req: AIHighlightRequest): Promise<AIResponse>;

  /** Simplify complex text for a given audience/domain. */
  explain(req: AIExplainRequest): Promise<AIResponse>;

  /** Generate quiz questions, comprehension Q&A, or flashcards from text. */
  quiz(req: AIQuizRequest): Promise<AIResponse>;
}

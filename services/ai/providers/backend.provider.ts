// ============================================
// Backend AI Provider
// Routes requests through the Express backend,
// which in turn calls the configured provider
// (e.g. Gemini, Claude, OpenAI).
// ============================================

import { API_ENDPOINTS } from "@/config/api";
import type { AIProvider } from "../ai.provider";
import type {
    AIAnalyzeRequest,
    AIChatRequest,
    AIClassifyRequest,
    AIExplainRequest,
    AIGenerateDocumentRequest,
    AIHighlightRequest,
    AIQuizRequest,
    AIResponse,
    AISummarizeRequest,
    AITasksRequest,
    AITranslateRequest,
} from "../ai.types";

/**
 * Calls the backend Express server's AI endpoints.
 * The backend decides which LLM provider to use (Gemini, Claude, etc.)
 * based on its own AI_PROVIDER env var.
 */
export class BackendAIProvider implements AIProvider {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    // Strip the "/ai/*" part – we build per-endpoint URLs ourselves
    this.baseUrl = baseUrl || API_ENDPOINTS.AI.CHAT.replace("/chat", "");
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  async chat(req: AIChatRequest): Promise<AIResponse> {
    const body: Record<string, unknown> = {
      message: req.message,
      history: req.history.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };
    if (req.documentText) body.documentText = req.documentText;
    if (req.documentName) body.documentName = req.documentName;

    const res = await this.post("/chat", body, req.signal);
    return { content: res.response || res.data?.text || "" };
  }

  // ── Summarize ─────────────────────────────────────────────────────────────
  async summarize(req: AISummarizeRequest): Promise<AIResponse> {
    const res = await this.post("/summarize", { text: req.text }, req.signal);
    return { content: res.summary || res.data?.text || "" };
  }

  // ── Translate ─────────────────────────────────────────────────────────────
  async translate(req: AITranslateRequest): Promise<AIResponse> {
    const res = await this.post(
      "/translate",
      {
        text: req.text,
        targetLanguage: req.targetLanguage,
      },
      req.signal,
    );
    return { content: res.translatedText || res.data?.text || "" };
  }

  // ── Analyze ───────────────────────────────────────────────────────────────
  async analyze(req: AIAnalyzeRequest): Promise<AIResponse> {
    const res = await this.post(
      "/analyze",
      {
        text: req.text,
        analysisType: req.analysisType,
      },
      req.signal,
    );
    const structured = pickStructured(res);
    return {
      content: res.analysis || res.data?.text || "",
      structuredData: structured,
    };
  }

  // ── Extract Tasks ─────────────────────────────────────────────────────────
  async extractTasks(req: AITasksRequest): Promise<AIResponse> {
    const res = await this.post(
      "/extract-tasks",
      {
        text: req.text,
      },
      req.signal,
    );
    const tasks = res.tasks || res.data?.tasks;
    const structured = pickStructured(res);
    const taskCount = Array.isArray(tasks) ? tasks.length : 0;
    return {
      content: taskCount > 0
        ? `Found ${taskCount} task${taskCount === 1 ? "" : "s"}.`
        : res.data?.text || "No tasks found.",
      structuredData: structured ?? (Array.isArray(tasks) ? { tasks } : undefined),
    };
  }

  // ── Generate Document ─────────────────────────────────────────────────────
  async generateDocument(req: AIGenerateDocumentRequest): Promise<AIResponse> {
    const res = await this.post(
      "/generate-document",
      {
        prompt: req.prompt,
        fileType: req.fileType,
        category: req.category,
        tone: req.tone,
        wordCount: req.wordCount,
        audience: req.audience,
      },
      req.signal,
    );
    return {
      content: res.generatedText || res.data?.text || "",
    };
  }

  // ── Classify ───────────────────────────────────────────────────────────
  async classify(req: AIClassifyRequest): Promise<AIResponse> {
    const res = await this.post(
      "/classify",
      {
        text: req.text,
        filename: req.filename,
      },
      req.signal,
    );
    return {
      content: res.data?.text || JSON.stringify(res.data, null, 2) || "",
      structuredData: res.data,
    };
  }

  // ── Highlight ──────────────────────────────────────────────────────────
  async highlight(req: AIHighlightRequest): Promise<AIResponse> {
    const res = await this.post("/highlight", { text: req.text }, req.signal);
    // res.data is either the structured { highlights, meta } object or a
    // fallback text string if the model returned non-JSON.
    const structured =
      res?.data && typeof res.data === "object" && !Array.isArray(res.data)
        ? (res.data as Record<string, unknown>)
        : undefined;
    const count =
      structured && Array.isArray((structured as any).highlights)
        ? (structured as any).highlights.length
        : 0;
    return {
      content: structured
        ? `Found ${count} key highlight${count === 1 ? "" : "s"}.`
        : typeof res?.data === "string"
          ? (res.data as string)
          : "",
      structuredData: structured,
    };
  }

  // ── Explain ────────────────────────────────────────────────────────────
  async explain(req: AIExplainRequest): Promise<AIResponse> {
    const res = await this.post(
      "/explain",
      {
        text: req.text,
        mode: req.mode,
        depth: (req as any).depth,
      },
      req.signal,
    );
    return {
      content: res.explanation || res.data?.text || "",
      structuredData: {
        __kind: "explain",
        mode: req.mode || "simple",
        depth: (req as any).depth || "medium",
        originalText: req.text,
      },
    };
  }

  // ── Quiz ───────────────────────────────────────────────────────────────
  async quiz(req: AIQuizRequest): Promise<AIResponse> {
    const body: Record<string, unknown> = {
      text: req.text,
      questionType: req.questionType,
      length: req.length,
      difficulty: req.difficulty,
      weakTopics: req.weakTopics ?? [],
    };
    if (req.docId) body.docId = req.docId;

    const res = await this.post("/quiz", body, req.signal);
    // res.data is the parsed JSON questions object or raw text envelope
    const structured =
      res?.data?.json ?? (res?.data && typeof res.data === "object" ? res.data : undefined);
    return {
      content: typeof res?.data?.text === "string" ? res.data.text : "",
      structuredData: structured,
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async post(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<any> {
    return callBackend(this.baseUrl + path, body, signal);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Try several shapes to get the structured JSON back from a backend response. */
function pickStructured(
  res: any,
): Record<string, unknown> | undefined {
  // res.data.json is the canonical path on successful structured responses
  if (res?.data?.json && typeof res.data.json === "object") {
    return res.data.json as Record<string, unknown>;
  }
  // Legacy: `data` at top-level may already be an object
  if (
    res?.data &&
    typeof res.data === "object" &&
    !Array.isArray(res.data) &&
    // Skip the raw {text,json,tasks,...} envelope
    !("text" in res.data && "json" in res.data)
  ) {
    return res.data as Record<string, unknown>;
  }
  // Some responses put structured data at the top level
  if (res?.analysis && typeof res.analysis === "object") {
    return res.analysis;
  }
  return undefined;
}

async function callBackend(
  url: string,
  body: Record<string, unknown>,
  externalSignal?: AbortSignal,
) {
  // Abort the request if EITHER the 60s timeout fires OR the caller cancels
  // (e.g. the user pulls down on the spring activity overlay).
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort);
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Backend AI error (${response.status}): ${errorBody || response.statusText}`,
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
}

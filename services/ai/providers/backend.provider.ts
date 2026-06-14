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
    AIDevilsAdvocateRequest,
    AIExplainRequest,
    AIGenerateDocumentRequest,
    AIHighlightRequest,
    AINarrativeArcRequest,
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

  // ── Devil's Advocate ─────────────────────────────────────────────────────
  // The dedicated /ai/devils-advocate endpoint is not deployed on every backend
  // yet (returns 404). When it's missing we synthesize the same structured
  // output through the always-present /ai/chat endpoint.
  async devilsAdvocate(req: AIDevilsAdvocateRequest): Promise<AIResponse> {
    try {
      const res = await this.post(
        "/devils-advocate",
        {
          text: req.text,
          documentName: req.documentName,
          role: req.role,
          customRole: req.customRole,
          contextText: req.contextText,
          contextName: req.contextName,
        },
        req.signal,
      );
      const structured = pickStructured(res);
      if (structured) {
        return {
          content:
            typeof res?.data?.text === "string"
              ? res.data.text
              : `Surfaced the hardest objections${req.documentName ? ` for "${req.documentName}"` : ""}.`,
          structuredData: { ...structured, __kind: "devils-advocate" },
        };
      }
      // Endpoint responded but gave no usable structure — fall back to /chat.
      return this.devilsAdvocateViaChat(req);
    } catch (err) {
      if (isEndpointMissing(err)) return this.devilsAdvocateViaChat(req);
      throw err;
    }
  }

  /** Synthesize Devil's Advocate output via the /chat endpoint. */
  private async devilsAdvocateViaChat(
    req: AIDevilsAdvocateRequest,
  ): Promise<AIResponse> {
    const prompt = buildDevilsAdvocatePrompt(req);
    const res = await callBackend(
      this.baseUrl + "/chat",
      { message: prompt, history: [] },
      req.signal,
    );
    const raw = res.response || res.data?.text || "";
    const data = normalizeDevilsAdvocate(extractJsonObject(raw), req);
    if (!data) {
      return {
        content:
          typeof raw === "string" && raw.trim()
            ? raw
            : "I couldn't generate grounded objections for this document.",
      };
    }
    return {
      content: `Surfaced the hardest objections${req.documentName ? ` for "${req.documentName}"` : ""}.`,
      structuredData: { ...data, __kind: "devils-advocate" },
    };
  }

  // ── Narrative Arc ────────────────────────────────────────────────────────
  // Same fallback contract as Devil's Advocate above.
  async narrativeArc(req: AINarrativeArcRequest): Promise<AIResponse> {
    try {
      const res = await this.post(
        "/narrative-arc",
        {
          text: req.text,
          documentName: req.documentName,
          format: req.format,
          contextText: req.contextText,
          contextName: req.contextName,
        },
        req.signal,
      );
      const structured = pickStructured(res);
      if (structured) {
        return {
          content:
            typeof res?.data?.text === "string"
              ? res.data.text
              : `Checked the narrative arc${req.documentName ? ` of "${req.documentName}"` : ""}.`,
          structuredData: { ...structured, __kind: "narrative-arc" },
        };
      }
      return this.narrativeArcViaChat(req);
    } catch (err) {
      if (isEndpointMissing(err)) return this.narrativeArcViaChat(req);
      throw err;
    }
  }

  /** Synthesize Narrative Arc output via the /chat endpoint. */
  private async narrativeArcViaChat(
    req: AINarrativeArcRequest,
  ): Promise<AIResponse> {
    const prompt = buildNarrativeArcPrompt(req);
    const res = await callBackend(
      this.baseUrl + "/chat",
      { message: prompt, history: [] },
      req.signal,
    );
    const raw = res.response || res.data?.text || "";
    const data = normalizeNarrativeArc(extractJsonObject(raw), req);
    if (!data) {
      return {
        content:
          typeof raw === "string" && raw.trim()
            ? raw
            : "I couldn't read enough structure to judge the narrative arc.",
      };
    }
    return {
      content: `Checked the narrative arc${req.documentName ? ` of "${req.documentName}"` : ""}.`,
      structuredData: { ...data, __kind: "narrative-arc" },
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

// ─── /chat fallback for endpoints the backend hasn't deployed yet ─────────────

/**
 * True when a request failed because the endpoint itself doesn't exist
 * (404) or rejects the method (405) — i.e. it isn't deployed. Genuine
 * processing errors (500) and user cancellations (AbortError) are NOT treated
 * as "missing" so they still surface to the caller.
 */
function isEndpointMissing(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /Backend AI error \((?:404|405|501)\)/.test(msg);
}

/**
 * Best-effort extraction of the first complete JSON object from a model reply.
 * Tolerates ```json fences and leading/trailing prose, and respects strings so
 * braces inside quotes don't end the scan early.
 */
function extractJsonObject(raw: unknown): any | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(s);
  } catch {
    /* fall through to brace scan */
  }
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const VALID_ROLE_KEYS = [
  "auto",
  "investor",
  "client",
  "procurement",
  "peer-reviewer",
  "opposing-counsel",
  "stakeholder",
  "cfo",
  "evaluation-committee",
  "custom",
];
const VALID_SEVERITY = ["critical", "high", "medium"];
const VALID_COVERAGE = ["covered", "missing", "partial"];
const VALID_ARC_VERDICT = ["strong", "weak", "broken"];
const VALID_ARC_STATUS = ["ok", "misplaced", "missing", "extra"];

function trimStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function inferFormat(req: AINarrativeArcRequest): "pptx" | "docx" | "pdf" {
  if (req.format) return req.format;
  const name = (req.documentName || "").toLowerCase();
  if (name.endsWith(".pptx") || name.endsWith(".ppt")) return "pptx";
  if (name.endsWith(".docx") || name.endsWith(".doc")) return "docx";
  return "pdf";
}

function buildDevilsAdvocatePrompt(req: AIDevilsAdvocateRequest): string {
  const roleLine =
    req.role && req.role !== "auto"
      ? `Adopt this challenger persona: ${req.customRole || req.role}.`
      : "Infer the single most demanding realistic reader for this document and adopt that persona.";
  const contextBlock =
    req.contextText && req.contextText.trim()
      ? `\n\nA second CONTEXT document was provided${
          req.contextName ? ` ("${req.contextName}")` : ""
        }. Ground objections in it, and if it reads like an RFP/criteria list, assess coverage:\n"""\n${req.contextText.slice(0, 6000)}\n"""`
      : "";
  const extraKeys = req.contextText && req.contextText.trim()
    ? `,"groundedObjections":[{"claim":string,"evidence":string,"source":string}],"rfpCoverage":[{"criterion":string,"status":"covered"|"missing"|"partial","note":string}]`
    : "";
  return (
    `You are a ruthless but fair devil's advocate. Surface the hardest objections a skeptical decision-maker will raise about the document below. ${roleLine}\n\n` +
    `Return ONLY minified JSON — no markdown, no code fences, no commentary — with EXACTLY this shape:\n` +
    `{"detectedRole":string,"roleKey":one of ${JSON.stringify(VALID_ROLE_KEYS)},"documentType":string,"killerObjections":[{"title":string,"detail":string,"severity":"critical"|"high"|"medium","reference":string}],"secondaryChallenges":[{"title":string,"detail":string,"severity":"critical"|"high"|"medium"}],"blindSpots":[{"text":string,"why":string}]${extraKeys}}\n\n` +
    `Rules: 3-5 killerObjections (the deal-enders), 3-6 secondaryChallenges, 2-4 blindSpots. ` +
    `"reference" cites a concrete location ("Slide 7", "Section 3", "page 2") when inferable, else "". ` +
    `"detectedRole" is a human label like "Skeptical Investor".\n\n` +
    `Document${req.documentName ? ` ("${req.documentName}")` : ""}:\n"""\n${(req.text || "").slice(0, 12000)}\n"""${contextBlock}`
  );
}

function asObjections(arr: unknown, defaultSeverity: string): any[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((o) => o && typeof o === "object" && trimStr((o as any).title))
    .map((o: any) => ({
      title: trimStr(o.title)!,
      detail: trimStr(o.detail),
      severity: VALID_SEVERITY.includes(o.severity) ? o.severity : defaultSeverity,
      reference: trimStr(o.reference),
    }));
}

function normalizeDevilsAdvocate(
  parsed: any,
  req: AIDevilsAdvocateRequest,
): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== "object") return null;
  const killerObjections = asObjections(parsed.killerObjections, "critical");
  if (killerObjections.length === 0) return null; // nothing useful to render

  const roleKey = VALID_ROLE_KEYS.includes(parsed.roleKey)
    ? parsed.roleKey
    : req.role && VALID_ROLE_KEYS.includes(req.role)
      ? req.role
      : "auto";

  const data: Record<string, unknown> = {
    detectedRole: trimStr(parsed.detectedRole) || "Skeptical Reviewer",
    roleKey,
    documentType: trimStr(parsed.documentType),
    killerObjections,
    secondaryChallenges: asObjections(parsed.secondaryChallenges, "medium"),
    blindSpots: Array.isArray(parsed.blindSpots)
      ? parsed.blindSpots
          .filter((b: any) => b && trimStr(b.text))
          .map((b: any) => ({ text: trimStr(b.text)!, why: trimStr(b.why) }))
      : [],
  };

  if (Array.isArray(parsed.groundedObjections)) {
    const grounded = parsed.groundedObjections
      .filter((g: any) => g && trimStr(g.claim))
      .map((g: any) => ({
        claim: trimStr(g.claim)!,
        evidence: trimStr(g.evidence) || "",
        source: trimStr(g.source),
      }));
    if (grounded.length) data.groundedObjections = grounded;
  }
  if (Array.isArray(parsed.rfpCoverage)) {
    const coverage = parsed.rfpCoverage
      .filter((c: any) => c && trimStr(c.criterion))
      .map((c: any) => ({
        criterion: trimStr(c.criterion)!,
        status: VALID_COVERAGE.includes(c.status) ? c.status : "partial",
        note: trimStr(c.note),
      }));
    if (coverage.length) data.rfpCoverage = coverage;
  }
  return data;
}

function buildNarrativeArcPrompt(req: AINarrativeArcRequest): string {
  const fmt = inferFormat(req);
  const contextBlock =
    req.contextText && req.contextText.trim()
      ? `\n\nA CONTEXT document was provided${
          req.contextName ? ` ("${req.contextName}")` : ""
        }; if it lists required sections/criteria, assess coverage:\n"""\n${req.contextText.slice(0, 5000)}\n"""`
      : "";
  const extraKeys = req.contextText && req.contextText.trim()
    ? `,"rfpCoverage":[{"criterion":string,"status":"covered"|"missing"|"partial","note":string}]`
    : "";
  return (
    `You are a narrative-structure editor. Judge whether the document below tells its story in the right order for its type (a ${fmt.toUpperCase()}).\n\n` +
    `Return ONLY minified JSON — no markdown, no code fences, no commentary — with EXACTLY this shape:\n` +
    `{"verdict":"strong"|"weak"|"broken","verdictLine":string,"detectedType":string,"diagnosis":string,"idealStructure":[string],"detectedSections":[{"title":string,"index":number,"role":string,"status":"ok"|"misplaced"|"missing"|"extra"}],"reorder":[{"instruction":string,"from":number,"to":number}]${extraKeys}}\n\n` +
    `Rules: "verdictLine" is one punchy sentence naming the core structural problem (or strength). ` +
    `"detectedType" is the document genre ("Pitch Deck", "Business Proposal", "Consulting Report", …). ` +
    `"idealStructure" is the ideal ordered arc for that type. ` +
    `"detectedSections" lists the document's actual sections in order with index starting at 1 and a status. ` +
    `"reorder" gives concrete move instructions (omit from/to when not a simple move).\n\n` +
    `Document${req.documentName ? ` ("${req.documentName}")` : ""}:\n"""\n${(req.text || "").slice(0, 12000)}\n"""${contextBlock}`
  );
}

function normalizeNarrativeArc(
  parsed: any,
  req: AINarrativeArcRequest,
): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== "object") return null;
  const verdict = VALID_ARC_VERDICT.includes(parsed.verdict)
    ? parsed.verdict
    : "weak";
  const verdictLine = trimStr(parsed.verdictLine);
  const detectedSections = Array.isArray(parsed.detectedSections)
    ? parsed.detectedSections
        .filter((s: any) => s && trimStr(s.title))
        .map((s: any, i: number) => ({
          title: trimStr(s.title)!,
          index: typeof s.index === "number" ? s.index : i + 1,
          role: trimStr(s.role),
          status: VALID_ARC_STATUS.includes(s.status) ? s.status : "ok",
        }))
    : [];
  // Need at least a verdict line or some detected structure to be worth rendering.
  if (!verdictLine && detectedSections.length === 0) return null;

  const fmt = inferFormat(req);
  const data: Record<string, unknown> = {
    verdict,
    verdictLine: verdictLine || "The narrative arc could be tightened.",
    detectedType: trimStr(parsed.detectedType) || "Document",
    format: fmt,
    diagnosis: trimStr(parsed.diagnosis) || "",
    detectedSections,
    reorder: Array.isArray(parsed.reorder)
      ? parsed.reorder
          .filter((r: any) => r && trimStr(r.instruction))
          .map((r: any) => ({
            instruction: trimStr(r.instruction)!,
            from: typeof r.from === "number" ? r.from : undefined,
            to: typeof r.to === "number" ? r.to : undefined,
          }))
      : [],
    editable: fmt !== "pdf",
  };
  if (Array.isArray(parsed.idealStructure)) {
    const ideal = parsed.idealStructure
      .map((x: unknown) => trimStr(x))
      .filter((x: string | undefined): x is string => !!x);
    if (ideal.length) data.idealStructure = ideal;
  }
  if (Array.isArray(parsed.rfpCoverage)) {
    const coverage = parsed.rfpCoverage
      .filter((c: any) => c && trimStr(c.criterion))
      .map((c: any) => ({
        criterion: trimStr(c.criterion)!,
        status: VALID_COVERAGE.includes(c.status) ? c.status : "partial",
        note: trimStr(c.note),
      }));
    if (coverage.length) data.rfpCoverage = coverage;
  }
  return data;
}

// ============================================
// FILE: services/aiService.js
// Unified AI Service — single entry point for all AI features.
// Routes prompt construction, provider dispatch, and response
// normalization through one clean interface.
// ============================================
const aiProvider = require("./aiProvider");
const documentProcessor = require("./documentProcessor");
const aiConfig = require("../config/aiConfig");
const logger = require("../utils/logger");

// ============================================
// Prompt templates per task type
// ============================================
const PROMPT_TEMPLATES = {
  summarize: {
    system:
      "You are a professional document summarizer. Be concise, accurate, and useful.",
    userPrompt: (text, mode) => {
      const instructions = {
        short:
          "Write a concise 2-3 sentence summary that captures the core purpose, main finding, and most important takeaway. Be direct.",
        detailed:
          "Write a comprehensive summary in 4-6 paragraphs. Cover the document's purpose, main sections, key points, conclusions, and any important data or figures. Preserve structure with clear paragraph breaks.",
        bullets:
          'Return a bullet-point summary. Use "## Section Name" headers where appropriate. Each bullet should be one clear, actionable or informative point. Aim for 8-12 bullets total.',
      };
      const instruction = instructions[mode] || instructions.detailed;
      return `${instruction}\n\nDocument:\n${text}`;
    },
  },

  translate: {
    system: (lang) =>
      `You are a professional translator with expertise in ${lang}. ` +
      "Translate text accurately and naturally. Preserve all formatting, paragraph breaks, " +
      "numbered lists, and structure. Do not add translator notes, explanations, or any content " +
      "not in the original. Provide only the translation.",
    userPrompt: (text) =>
      `Translate the following document. Preserve all formatting exactly.\n\n${text}`,
  },

  "extract-data": {
    system: (dataType) => {
      const typePrompts = {
        contact:
          "Extract all contact information (names, emails, phone numbers, addresses) from the text.",
        dates:
          "Extract all dates, deadlines, and time references from the text.",
        amounts:
          "Extract all monetary amounts, financial figures, and numeric data from the text.",
        tasks: "Extract all action items, tasks, and to-dos from the text.",
        entities:
          "Extract all named entities (people, organizations, locations) from the text.",
      };
      return (
        (typePrompts[dataType] ||
          `Extract ${dataType || "all key structured data (names, dates, amounts, entities, etc.)"} from the text.`) +
        " Return in a clear, organized format. Use JSON when appropriate."
      );
    },
    userPrompt: (text) => text,
  },

  analyze: {
    system: (analysisType) =>
      `You are an expert document analyst. Provide a ${analysisType || "comprehensive"} ` +
      "analysis of the document including: main topics and themes, sentiment, " +
      "key findings, strengths, weaknesses, and actionable recommendations.",
    userPrompt: (text) => text,
  },

  tasks: {
    system:
      "You are an expert at extracting action items and tasks from documents. " +
      "Return a structured response with clear task descriptions, owners, deadlines, and priorities.",
    userPrompt: (text) =>
      `Extract every action item, task, follow-up, decision, and commitment from this document.
For each task include:
- Action: clear description of what must be done
- Owner: person/team responsible (or "Unassigned")
- Deadline: due date or timeframe (or "Not specified")
- Priority: high | medium | low
- Context: one sentence of context from the document

Document:
${text}`,
  },

  "fill-form": {
    system:
      "You are a form-filling assistant. Given a form structure and optional " +
      "data source, extract relevant information and map it to the form fields. " +
      "Return the result as valid JSON with field names as keys and values filled in.",
    userPrompt: (formText, dataText) =>
      `Fill this form using the provided data.\n\nForm structure:\n${formText}\n\n` +
      (dataText
        ? `Data source:\n${dataText}`
        : "No additional data source provided — infer reasonable values from the form context."),
  },

  chat: {
    system: (docContext) =>
      docContext
        ? "You are xumpta, a helpful document assistant. Answer questions about the " +
          "document below precisely and clearly. Reference specific parts of " +
          `the document when relevant.\n\nDocument:\n${docContext}`
        : "You are xumpta, a helpful assistant. Provide clear, accurate, and well-structured answers.",
    userPrompt: (message) => message,
  },

  classify: {
    system:
      "You are a document classification expert. Return JSON only, no markdown.",
    userPrompt: (text, filename) =>
      `Analyze this document and return a JSON object with these exact keys:
- "type": one of: invoice | resume | contract | report | research_paper | letter | form | receipt | agreement | proposal | manual | financial_statement | other
- "confidence": integer 0-100
- "suggestedFilename": a clean, descriptive filename (no spaces, use underscores) ending in .pdf. Example: "Invoice_Acme_Corp_March_2026.pdf"
- "summary": one sentence describing what this document is and its purpose
- "keyEntities": array of up to 5 important names, organizations, or dates found

Original filename: ${filename || "document.pdf"}

Document (first portion):
${text.slice(0, 5000)}

Return ONLY valid JSON.`,
  },

  highlight: {
    system:
      "You are an expert at identifying critical information in documents. Return JSON only, no markdown.",
    userPrompt: (text) =>
      `Identify the 10-15 most important sentences or short passages in this document.
Return a JSON object with key "highlights" containing an array. Each item must have:
- "text": the exact sentence or passage from the document (copy it verbatim)
- "importance": one of "critical" | "high" | "medium"
- "reason": max 8 words explaining why this is important
- "category": one of "key_finding" | "action_required" | "important_date" | "financial" | "risk" | "definition" | "conclusion"

Document:
${text}

Return ONLY valid JSON.`,
  },

  explain: {
    system: (mode) => {
      const systems = {
        plain:
          "You are an expert at making complex text easy to understand for everyone.",
        legal:
          "You are a plain-language legal expert helping non-lawyers understand legal documents.",
        medical:
          "You are a health literacy specialist helping patients understand medical content.",
        technical:
          "You are a tech educator skilled at explaining technical concepts to non-technical people.",
      };
      return systems[mode] || systems.plain;
    },
    userPrompt: (text, mode) => {
      const prompts = {
        plain: `Rewrite this in simple, clear language a 14-year-old could understand. Keep the same meaning but remove jargon, complex sentences, and technical terms. If a term is essential, briefly define it.\n\nText:\n${text}`,
        legal: `Explain what this legal text actually means in plain English. Cover: 1) What it says in simple terms, 2) Key obligations or rights for each party, 3) Any important conditions or exceptions, 4) Red flags or risks to be aware of.\n\nLegal text:\n${text}`,
        medical: `Explain this medical content clearly for a patient. Cover: 1) What this means in everyday language, 2) What the patient needs to know or do, 3) Any important warnings or next steps.\n\nMedical text:\n${text}`,
        technical: `Explain this technical content to a non-technical person. Use simple analogies and everyday examples. Avoid acronyms without explaining them first.\n\nTechnical text:\n${text}`,
      };
      return prompts[mode] || prompts.plain;
    },
  },

  quiz: {
    system:
      "You are an expert educator who creates high-quality study materials. Return JSON only, no markdown.",
    userPrompt: (text, quizType, count) => {
      const n = Math.min(Math.max(parseInt(count) || 5, 3), 20);
      const prompts = {
        quiz: `Generate exactly ${n} multiple-choice quiz questions based on this document.
Return a JSON object with key "questions" containing an array. Each question object must have:
- "question": the question text
- "options": object with keys "A", "B", "C", "D" — four possible answers
- "correctAnswer": "A" | "B" | "C" | "D"
- "explanation": one sentence explaining why the correct answer is right
- "difficulty": "easy" | "medium" | "hard"`,
        comprehension: `Generate exactly ${n} open-ended comprehension questions based on this document.
Return a JSON object with key "questions" containing an array. Each must have:
- "question": the question text
- "sampleAnswer": a comprehensive sample answer (2-4 sentences)
- "difficulty": "easy" | "medium" | "hard"
- "topic": the main topic this question covers`,
        flashcards: `Generate exactly ${n} study flashcards based on this document.
Return a JSON object with key "cards" containing an array. Each must have:
- "front": the term, concept, or question
- "back": the definition, explanation, or answer (2-3 sentences max)
- "category": topic category for grouping`,
      };
      const prompt = prompts[quizType] || prompts.quiz;
      return `${prompt}\n\nReturn ONLY valid JSON.\n\nDocument:\n${text}`;
    },
  },
};

// ============================================
// AI Service
// ============================================
class AIService {
  /**
   * Run an AI task with standardized input/output.
   * This is the SINGLE entry point for all AI features.
   *
   * @param {string} task  One of: summarize, translate, extract-data, analyze,
   *                       tasks, extract-tasks, fill-form, chat
   * @param {object} params
   *   text           - pre-extracted document text
   *   prompt         - user prompt / message
   *   file           - express-fileupload file object
   *   formFile       - form file (fill-form)
   *   dataSourceFile - data source file (fill-form)
   *   targetLanguage - target language (translate)
   *   dataType       - extraction type (extract-data)
   *   analysisType   - analysis focus (analyze)
   *   history        - conversation history [{role, content}]
   *   options        - { temperature, maxTokens, timeoutMs }
   *
   * @returns {Promise<object>}  Standardized response
   */
  async run(task, params = {}) {
    const {
      text,
      prompt,
      file,
      formFile,
      dataSourceFile,
      targetLanguage,
      dataType,
      analysisType,
      history,
      options = {},
      // New feature params
      filename,
      explainMode,
      quizType,
      quizCount,
      summaryMode,
    } = params;

    // Ensure providers are ready
    aiProvider.initialize();

    const startTime = Date.now();

    try {
      let result;

      switch (task) {
        case "summarize":
          result = await this._summarize(
            text,
            file,
            options,
            params.summaryMode,
          );
          break;
        case "translate":
          result = await this._translate(text, file, targetLanguage, options);
          break;
        case "extract-data":
          result = await this._extractData(text, file, dataType, options);
          break;
        case "analyze":
          result = await this._analyze(text, file, analysisType, options);
          break;
        case "tasks":
        case "extract-tasks":
          result = await this._extractTasks(text, file, options);
          break;
        case "fill-form":
          result = await this._fillForm(
            formFile,
            dataSourceFile,
            text,
            options,
          );
          break;
        case "chat":
          result = await this._chat(text, file, prompt, history, options);
          break;
        case "classify":
          result = await this._classify(text, file, filename, options);
          break;
        case "highlight":
          result = await this._highlight(text, file, options);
          break;
        case "explain":
          result = await this._explain(text, explainMode, options);
          break;
        case "quiz":
          result = await this._quiz(text, file, quizType, quizCount, options);
          break;
        default: {
          const err = new Error(`Unknown AI task: "${task}"`);
          err.code = "VALIDATION_ERROR";
          throw err;
        }
      }

      const elapsed = Date.now() - startTime;
      logger.info(
        `AI task "${task}" completed in ${elapsed}ms via ${result.provider}`,
      );

      return this._formatSuccess(task, result);
    } catch (err) {
      const elapsed = Date.now() - startTime;
      logger.error(`AI task "${task}" failed after ${elapsed}ms`, {
        error: err.message,
        code: err.code,
      });
      throw err;
    }
  }

  // ─── Individual task implementations ───────────────────────────

  async _summarize(text, file, options, summaryMode) {
    const docText = await this._resolveDocumentText(text, file);
    const { text: safeText } = documentProcessor.truncate(
      docText,
      aiConfig.maxDocumentLength,
    );

    const messages = [
      { role: "system", content: PROMPT_TEMPLATES.summarize.system },
      {
        role: "user",
        content: PROMPT_TEMPLATES.summarize.userPrompt(safeText, summaryMode),
      },
    ];

    return aiProvider.chat(messages, options);
  }

  async _translate(text, file, targetLanguage, options) {
    if (!targetLanguage) {
      const err = new Error("Target language is required for translation");
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    const docText = await this._resolveDocumentText(text, file);
    const { text: safeText } = documentProcessor.truncate(
      docText,
      aiConfig.maxDocumentLength,
    );

    const systemContent =
      typeof PROMPT_TEMPLATES.translate.system === "function"
        ? PROMPT_TEMPLATES.translate.system(targetLanguage)
        : PROMPT_TEMPLATES.translate.system;

    const messages = [
      { role: "system", content: systemContent },
      {
        role: "user",
        content: PROMPT_TEMPLATES.translate.userPrompt(safeText),
      },
    ];

    return aiProvider.chat(messages, options);
  }

  async _extractData(text, file, dataType, options) {
    const docText = await this._resolveDocumentText(text, file);
    const { text: safeText } = documentProcessor.truncate(
      docText,
      aiConfig.maxDocumentLength,
    );

    const messages = [
      {
        role: "system",
        content: PROMPT_TEMPLATES["extract-data"].system(dataType),
      },
      {
        role: "user",
        content: PROMPT_TEMPLATES["extract-data"].userPrompt(safeText),
      },
    ];

    return aiProvider.chat(messages, options);
  }

  async _analyze(text, file, analysisType, options) {
    const docText = await this._resolveDocumentText(text, file);
    const { text: safeText } = documentProcessor.truncate(
      docText,
      aiConfig.maxDocumentLength,
    );

    const messages = [
      {
        role: "system",
        content: PROMPT_TEMPLATES.analyze.system(analysisType),
      },
      { role: "user", content: PROMPT_TEMPLATES.analyze.userPrompt(safeText) },
    ];

    return aiProvider.chat(messages, options);
  }

  async _extractTasks(text, file, options) {
    const docText = await this._resolveDocumentText(text, file);
    const { text: safeText } = documentProcessor.truncate(
      docText,
      aiConfig.maxDocumentLength,
    );

    const messages = [
      { role: "system", content: PROMPT_TEMPLATES.tasks.system },
      { role: "user", content: PROMPT_TEMPLATES.tasks.userPrompt(safeText) },
    ];

    const result = await aiProvider.chat(messages, options);

    // Parse tasks into a structured array
    const tasks = result.content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) =>
        line
          .replace(/^\d+[.)]\s*/, "")
          .replace(/^[-*•]\s*/, "")
          .trim(),
      )
      .filter((line) => line.length > 0);

    result.tasks = tasks;
    return result;
  }

  async _fillForm(formFile, dataSourceFile, text, options) {
    let formText = "";
    let dataText = text || "";

    if (formFile) {
      formText = await documentProcessor.extractText(formFile);
    }
    if (dataSourceFile) {
      dataText = await documentProcessor.extractText(dataSourceFile);
    }

    if (!formText && !dataText) {
      const err = new Error("Form file or data text is required");
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    const half = Math.floor(aiConfig.maxDocumentLength / 2);
    const { text: safeForm } = documentProcessor.truncate(formText, half);
    const { text: safeData } = documentProcessor.truncate(dataText, half);

    const messages = [
      { role: "system", content: PROMPT_TEMPLATES["fill-form"].system },
      {
        role: "user",
        content: PROMPT_TEMPLATES["fill-form"].userPrompt(safeForm, safeData),
      },
    ];

    const result = await aiProvider.chat(messages, options);

    // Attempt to parse JSON from the response
    try {
      const jsonMatch = result.content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        result.json = JSON.parse(jsonMatch[1].trim());
      } else {
        result.json = JSON.parse(result.content);
      }
    } catch {
      // Response isn't valid JSON — text output is still useful
    }

    return result;
  }

  async _chat(text, file, prompt, history, options) {
    if (!prompt) {
      const err = new Error("Message/prompt is required for chat");
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    let documentContext = text || "";
    if (file) {
      documentContext = await documentProcessor.extractText(file);
    }

    const { text: safeDoc } = documentProcessor.truncate(
      documentContext,
      aiConfig.maxDocumentLength,
    );

    const systemContent = PROMPT_TEMPLATES.chat.system(safeDoc || null);
    const messages = [{ role: "system", content: systemContent }];

    // Add conversation history
    if (history && Array.isArray(history)) {
      for (const msg of history) {
        if (msg.role && msg.content) {
          messages.push({
            role: msg.role === "assistant" ? "assistant" : "user",
            content: msg.content,
          });
        }
      }
    }

    // Add current user message
    messages.push({ role: "user", content: prompt });

    return aiProvider.chat(messages, options);
  }

  async _classify(text, file, filename, options) {
    const docText = await this._resolveDocumentText(text, file);
    const { text: safeText } = documentProcessor.truncate(
      docText,
      aiConfig.maxDocumentLength,
    );

    const messages = [
      { role: "system", content: PROMPT_TEMPLATES.classify.system },
      {
        role: "user",
        content: PROMPT_TEMPLATES.classify.userPrompt(safeText, filename),
      },
    ];

    const result = await aiProvider.chat(messages, options);

    // Parse JSON response
    try {
      const jsonMatch = result.content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const raw = jsonMatch ? jsonMatch[1].trim() : result.content;
      result.json = JSON.parse(raw);
    } catch {
      // Non-JSON response is still useful as text
    }

    return result;
  }

  async _highlight(text, file, options) {
    const docText = await this._resolveDocumentText(text, file);
    const { text: safeText } = documentProcessor.truncate(
      docText,
      aiConfig.maxDocumentLength,
    );

    const messages = [
      { role: "system", content: PROMPT_TEMPLATES.highlight.system },
      {
        role: "user",
        content: PROMPT_TEMPLATES.highlight.userPrompt(safeText),
      },
    ];

    const result = await aiProvider.chat(messages, options);

    // Parse JSON response
    try {
      const jsonMatch = result.content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const raw = jsonMatch ? jsonMatch[1].trim() : result.content;
      result.json = JSON.parse(raw);
    } catch {
      // Non-JSON response is still useful as text
    }

    return result;
  }

  async _explain(text, mode, options) {
    if (!text) {
      const err = new Error("Text is required for explanation");
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    const { text: safeText } = documentProcessor.truncate(
      text,
      aiConfig.maxDocumentLength,
    );

    const systemContent =
      typeof PROMPT_TEMPLATES.explain.system === "function"
        ? PROMPT_TEMPLATES.explain.system(mode)
        : PROMPT_TEMPLATES.explain.system;

    const messages = [
      { role: "system", content: systemContent },
      {
        role: "user",
        content: PROMPT_TEMPLATES.explain.userPrompt(safeText, mode),
      },
    ];

    return aiProvider.chat(messages, options);
  }

  async _quiz(text, file, quizType, count, options) {
    const docText = await this._resolveDocumentText(text, file);
    const { text: safeText } = documentProcessor.truncate(
      docText,
      aiConfig.maxDocumentLength,
    );

    const messages = [
      { role: "system", content: PROMPT_TEMPLATES.quiz.system },
      {
        role: "user",
        content: PROMPT_TEMPLATES.quiz.userPrompt(safeText, quizType, count),
      },
    ];

    const result = await aiProvider.chat(messages, options);

    // Parse JSON response
    try {
      const jsonMatch = result.content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const raw = jsonMatch ? jsonMatch[1].trim() : result.content;
      result.json = JSON.parse(raw);
    } catch {
      // Non-JSON response is still useful as text
    }

    return result;
  }

  // ─── Helpers ───────────────────────────────────────────────────

  /**
   * Resolve document text from either raw text or a file upload.
   */
  async _resolveDocumentText(text, file) {
    if (text && text.length > 0) return text;
    if (file) return documentProcessor.extractText(file);
    const err = new Error("No document text or file provided");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  /**
   * Format a successful AI result into the stable response shape.
   */
  _formatSuccess(task, result) {
    return {
      success: true,
      provider: result.provider || aiProvider.currentProvider,
      task,
      data: {
        text: result.content,
        json: result.json || null,
        tasks: result.tasks || null,
        usage: result.usage || null,
      },
    };
  }
}

module.exports = new AIService();

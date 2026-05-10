// ============================================
// Mock AI Provider
// Deterministic, realistic responses with simulated latency.
// ============================================

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

/** Simulate network latency (600–1200 ms). */
function delay(ms?: number): Promise<void> {
  const duration = ms ?? 600 + Math.random() * 600;
  return new Promise((resolve) => setTimeout(resolve, duration));
}

/** Truncate text for use in mock output previews. */
function preview(text: string, max = 120): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "…";
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class MockAIProvider implements AIProvider {
  // ── Chat ────────────────────────────────────────────────────────────────────
  async chat(req: AIChatRequest): Promise<AIResponse> {
    await delay();

    const msg = req.message.toLowerCase();
    const hasDoc = !!req.documentText;

    // Context-aware responses
    if (hasDoc) {
      if (msg.includes("summary") || msg.includes("summarize")) {
        return {
          content: `Based on "${req.documentName || "the document"}", here is a brief overview:\n\nThe document discusses several key topics including organizational structure, process improvements, and strategic planning. The main points revolve around efficiency optimization and stakeholder engagement. The document is well-structured with clear sections and supporting data.\n\nWould you like me to go deeper into any specific section?`,
        };
      }
      if (msg.includes("how many") || msg.includes("count")) {
        return {
          content: `Looking at "${req.documentName || "the document"}", I can identify the following counts:\n\n• Paragraphs: approximately ${Math.floor(5 + Math.random() * 20)}\n• Key sections: ${Math.floor(3 + Math.random() * 5)}\n• References/citations: ${Math.floor(2 + Math.random() * 10)}\n\nWould you like a more detailed breakdown?`,
        };
      }
      return {
        content: `Regarding your question about "${req.documentName || "the document"}":\n\nBased on my analysis of the document content, the text addresses your inquiry through several relevant passages. The document provides context around this topic in its main body and supporting sections.\n\nKey findings related to your question:\n1. The document contains relevant information in the introduction and methodology sections\n2. There are specific data points that support the main thesis\n3. The conclusion ties back to your area of interest\n\nWould you like me to elaborate on any of these points?`,
      };
    }

    // General chat (no document)
    if (msg.includes("hello") || msg.includes("hi") || msg.includes("hey")) {
      return {
        content:
          "Hello! I'm gozlin, your assistant. I can help you with:\n\n• Summarizing documents\n• Translating text\n• Extracting tasks and action items\n• Analyzing content\n• Filling forms\n• Answering questions about documents\n\nHow can I help you today?",
      };
    }
    if (msg.includes("help")) {
      return {
        content:
          "Here's what I can do for you:\n\n📄 **Summarize** – Get concise summaries of documents\n🌍 **Translate** – Convert text to 15+ languages\n🔍 **Analyze** – Deep analysis with sentiment and readability scores\n✅ **Tasks** – Find action items and to-dos\n📝 **Fill Form** – Auto-fill form fields using AI\n💬 **Chat with File** – Ask questions about any PDF, DOCX, or EPUB\n\nJust select a mode from the tabs above, or ask me anything here!",
      };
    }
    if (msg.includes("thank")) {
      return {
        content:
          "You're welcome! Let me know if there's anything else I can help with. 😊",
      };
    }

    return {
      content: `Great question! Here's my response:\n\nI understand you're asking about "${preview(req.message, 80)}". While I'm currently running in offline mock mode, in the full version I would:\n\n1. Process your query using advanced language models\n2. Provide detailed, contextual answers\n3. Reference relevant sources when available\n\nFor now, try attaching a document and I can demonstrate document-based features, or switch to a specific mode like Summarize or Translate for specialized results.`,
    };
  }

  // ── Summarize ───────────────────────────────────────────────────────────────
  async summarize(req: AISummarizeRequest): Promise<AIResponse> {
    await delay();

    const wordCount = req.text.split(/\s+/).length;
    const docLabel = req.documentName
      ? `"${req.documentName}"`
      : "the provided text";

    return {
      content: `📄 **Summary of ${docLabel}**\n\n**Overview:** This ${wordCount}-word document covers several important topics. The content is organized into distinct sections addressing key themes.\n\n**Key Points:**\n• The document opens with an introduction that establishes the main context and objectives\n• Core arguments are supported by data and references throughout the body\n• Several actionable recommendations are presented in the middle sections\n• The conclusion synthesizes findings and proposes next steps\n\n**Main Themes:**\n1. Strategic planning and resource allocation\n2. Process optimization and efficiency improvements\n3. Stakeholder engagement and communication\n\n**Statistics:**\n• Word count: ${wordCount}\n• Estimated reading time: ${Math.max(1, Math.round(wordCount / 200))} min\n• Complexity: ${wordCount > 500 ? "Moderate to High" : "Low to Moderate"}\n\n**Conclusion:** The document provides a comprehensive look at its subject matter with clear structure and well-supported arguments.`,
    };
  }

  // ── Translate ───────────────────────────────────────────────────────────────
  async translate(req: AITranslateRequest): Promise<AIResponse> {
    await delay();

    // Provide deterministic mock translations
    const mockTranslations: Record<string, string> = {
      es: `[Traducción al Español]\n\nEste documento ha sido traducido del inglés al español. El contenido original trata sobre temas importantes relacionados con la gestión y planificación estratégica.\n\n---\nTexto original (primeras líneas):\n"${preview(req.text, 200)}"\n\n---\nNota: Esta es una traducción simulada. La versión completa utilizará modelos de traducción avanzados para proporcionar traducciones precisas y naturales.`,
      fr: `[Traduction en Français]\n\nCe document a été traduit de l'anglais au français. Le contenu original traite de sujets importants liés à la gestion et à la planification stratégique.\n\n---\nTexte original (premières lignes):\n"${preview(req.text, 200)}"\n\n---\nNote: Ceci est une traduction simulée. La version complète utilisera des modèles de traduction avancés.`,
      de: `[Deutsche Übersetzung]\n\nDieses Dokument wurde aus dem Englischen ins Deutsche übersetzt. Der Originalinhalt behandelt wichtige Themen im Zusammenhang mit Management und strategischer Planung.\n\n---\nOriginaltext (erste Zeilen):\n"${preview(req.text, 200)}"\n\n---\nHinweis: Dies ist eine simulierte Übersetzung. Die Vollversion wird fortschrittliche Übersetzungsmodelle verwenden.`,
      ja: `[日本語翻訳]\n\nこの文書は英語から日本語に翻訳されました。原文は、管理と戦略的計画に関連する重要なトピックを扱っています。\n\n---\n原文（最初の行）：\n"${preview(req.text, 200)}"\n\n---\n注：これはシミュレートされた翻訳です。完全版では高度な翻訳モデルを使用します。`,
      zh: `[中文翻译]\n\n本文档已从英文翻译成中文。原始内容涉及与管理和战略规划相关的重要主题。\n\n---\n原文（前几行）：\n"${preview(req.text, 200)}"\n\n---\n注意：这是模拟翻译。完整版将使用高级翻译模型。`,
      ar: `[الترجمة العربية]\n\nتمت ترجمة هذا المستند من الإنجليزية إلى العربية. يتناول المحتوى الأصلي مواضيع مهمة تتعلق بالإدارة والتخطيط الاستراتيجي.\n\n---\nالنص الأصلي (الأسطر الأولى):\n"${preview(req.text, 200)}"\n\n---\nملاحظة: هذه ترجمة محاكاة. سيستخدم الإصدار الكامل نماذج ترجمة متقدمة.`,
      ko: `[한국어 번역]\n\n이 문서는 영어에서 한국어로 번역되었습니다. 원본 내용은 관리 및 전략 계획과 관련된 중요한 주제를 다룹니다.\n\n---\n원문 (첫 줄):\n"${preview(req.text, 200)}"\n\n---\n참고: 이것은 시뮬레이션된 번역입니다.`,
    };

    const langName =
      {
        es: "Spanish",
        fr: "French",
        de: "German",
        ja: "Japanese",
        zh: "Chinese",
        ar: "Arabic",
        ko: "Korean",
        it: "Italian",
        pt: "Portuguese",
        ru: "Russian",
        hi: "Hindi",
        tr: "Turkish",
        nl: "Dutch",
        pl: "Polish",
        sv: "Swedish",
      }[req.targetLanguage] || req.targetLanguage;

    const translated =
      mockTranslations[req.targetLanguage] ||
      `[Translation to ${langName}]\n\nThis document has been translated from English to ${langName}.\n\n---\nOriginal text preview:\n"${preview(req.text, 200)}"\n\n---\nNote: This is a simulated translation. The full version will use advanced translation models for accurate, natural translations.`;

    return { content: translated };
  }

  // ── Analyze ─────────────────────────────────────────────────────────────────
  async analyze(req: AIAnalyzeRequest): Promise<AIResponse> {
    await delay();

    // Match the InsightRenderer schema
    const structured = {
      summary:
        "This document outlines a strategic plan with clear objectives, supporting data, and actionable recommendations for the next quarter.",
      sentiment: "positive",
      sentimentScore: 0.62,
      insights: [
        {
          title: "Strong growth trajectory",
          detail:
            "Revenue projections show consistent double-digit growth, supported by historical trend data.",
          sourceQuote:
            "Revenue increased 23% year-over-year, driven by product expansion.",
        },
        {
          title: "Risk in vendor concentration",
          detail:
            "More than 60% of supply chain relies on two vendors, creating a material single-point-of-failure risk.",
          sourceQuote: "Top two vendors account for 62% of procurement spend.",
        },
        {
          title: "Clear recommendations",
          detail:
            "The document closes with five actionable recommendations, each with an owner and a target date.",
        },
        {
          title: "Data-backed claims",
          detail:
            "Key assertions are supported by internal metrics and third-party research citations.",
          sourceQuote:
            "According to McKinsey's 2026 industry report, our segment grew 18%.",
        },
      ],
      strengths: [
        "Well-structured executive summary",
        "Quantitative support for claims",
        "Clear ownership on recommendations",
      ],
      weaknesses: [
        "Vendor concentration risk under-addressed",
        "Limited discussion of competitive threats",
        "No scenario planning for downside cases",
      ],
      recommendations: [
        "Diversify supplier base within the next 2 quarters",
        "Add a competitor landscape section",
        "Model low/mid/high revenue scenarios",
        "Assign measurable KPIs to each initiative",
      ],
      topics: ["Strategy", "Finance", "Operations", "Risk"],
      readability: {
        level: "moderate",
        notes: "Clear prose, occasional technical jargon — suitable for managers.",
      },
    };

    return {
      content: `Comprehensive analysis of ${req.documentName ? `"${req.documentName}"` : "the provided text"}.`,
      structuredData: structured as unknown as Record<string, unknown>,
    };
  }

  // ── Tasks ───────────────────────────────────────────────────────────────────
  async extractTasks(req: AITasksRequest): Promise<AIResponse> {
    await delay();

    // Match TaskRenderer schema: { tasks: [{ action, owner, deadline, priority, context, category }] }
    const structured = {
      tasks: [
        {
          action: "Review and approve the project proposal",
          owner: "Team Lead",
          deadline: "Feb 20, 2026",
          priority: "high",
          context: "Board needs a decision before the Q1 kickoff.",
          category: "decision",
        },
        {
          action: "Schedule the stakeholder meeting for Q1 review",
          owner: "Project Manager",
          deadline: "Feb 25, 2026",
          priority: "high",
          context: "Align all departments on Q1 goals and resourcing.",
          category: "communication",
        },
        {
          action: "Update documentation with the latest API changes",
          owner: "Technical Writer",
          deadline: "Mar 1, 2026",
          priority: "medium",
          context: "Keep customer-facing docs in sync with the new release.",
          category: "deliverable",
        },
        {
          action: "Conduct user testing for the new onboarding flow",
          owner: "QA Team",
          deadline: "Mar 5, 2026",
          priority: "medium",
          context: "Validate the redesign before the public rollout.",
          category: "review",
        },
        {
          action: "Prepare the monthly progress report",
          owner: "Analyst",
          deadline: "Mar 10, 2026",
          priority: "low",
          context: "Standard monthly reporting cadence.",
          category: "follow-up",
        },
        {
          action: "Follow up on vendor contract renewals",
          owner: "Procurement",
          deadline: "Mar 15, 2026",
          priority: "medium",
          context: "Three contracts expire this quarter and need review.",
          category: "follow-up",
        },
      ],
    };

    return {
      content: `Extracted 6 action items from ${req.documentName ? `"${req.documentName}"` : "the provided text"}.`,
      structuredData: structured as unknown as Record<string, unknown>,
    };
  }

  // ── Generate Document ─────────────────────────────────────────────────────────
  async generateDocument(req: AIGenerateDocumentRequest): Promise<AIResponse> {
    await delay(1000 + Math.random() * 1000); // Slightly longer delay for generation

    const fileTypeLabel = req.fileType.toUpperCase();
    const contentPreview = [
      `📄 **Document Generated Successfully**`,
      ``,
      `**File Type:** ${fileTypeLabel}`,
      `**Category:** ${req.category}`,
      `**Tone:** ${req.tone || "Professional"}`,
      `**Target Audience:** ${req.audience || "General"}`,
      `**Word Count:** ~${req.wordCount || 1500} words`,
      ``,
      `---`,
      ``,
    ].join("\n");

    // Generate realistic sample content based on category and parameters
    const sampleContent = this._generateSampleContent(
      req.category,
      req.tone || "Professional",
    );

    return {
      content: `${contentPreview}**Generated Content:**\n\n${sampleContent}\n\n---\n\n✅ Document generation complete! Your ${fileTypeLabel} file is ready to download.\n\n_In the full version with backend integration, this will create a properly formatted ${fileTypeLabel} document that you can save and edit._`,
    };
  }

  private _generateSampleContent(category: string, tone: string): string {
    const templates: Record<string, Record<string, string>> = {
      Finance: {
        Professional: `**Executive Summary**\n\nThis financial report provides a comprehensive analysis of key performance indicators and fiscal performance for the reporting period. The analysis covers revenue trends, cost structure, profitability metrics, and strategic financial recommendations.\n\n**Key Metrics**\n• Revenue Growth: 12.5% YoY\n• Operating Margin: 18.3%\n• Net Profit: $2.4M\n• ROI: 24.7%\n\n**Analysis & Recommendations**\n\nThe organization has demonstrated solid financial performance with consistent revenue growth and margin expansion...`,
        Casual: `**Money Matters**\n\nHey! Here's what's been happening with our finances. We've been doing pretty well – revenue is up, costs are under control, and we're making good money.\n\n**The Numbers**\n• We brought in 12.5% more money than last year\n• We're keeping about 18% as profit\n• Bottom line: $2.4M profit\n\nThings are looking good, and here are some ideas for keeping it that way...`,
      },
      Law: {
        Professional: `**LEGAL MEMORANDUM**\n\n**TO:** Concerned Parties\n**FROM:** Legal Department\n**DATE:** ${new Date().toLocaleDateString()}\n**RE:** Legal Analysis and Recommendations\n\n**I. EXECUTIVE SUMMARY**\n\nThis memorandum provides legal analysis regarding the matter at hand, with particular attention to applicable statutory provisions, case law precedent, and regulatory requirements.\n\n**II. FACTS**\n\nThe relevant facts are as follows:\n1. [Fact 1]\n2. [Fact 2]\n3. [Fact 3]...`,
        Casual: `**Legal Note**\n\nHere's what you need to know legally about this situation. We've looked at the rules, similar cases, and what could happen.\n\n**What We Know**\n- Here's what led to this\n- Important background info\n- Relevant details\n\n**What It Means**\n\nBased on everything, here's what we recommend...`,
      },
      Technology: {
        Professional: `**TECHNICAL SPECIFICATION**\n\n**Project:** [Project Name]\n**Version:** 1.0\n**Date:** ${new Date().toLocaleDateString()}\n\n**1. OVERVIEW**\n\nThis document outlines the technical architecture, implementation strategy, and deployment approach for the proposed system.\n\n**2. ARCHITECTURE**\n- Backend: Scalable microservices\n- Frontend: React-based SPA\n- Database: PostgreSQL with Redis cache\n- Infrastructure: Docker/Kubernetes\n\n**3. IMPLEMENTATION ROADMAP**...`,
        Casual: `**Tech Writeup**\n\nHere's how we're building this thing and what to expect.\n\n**The Setup**\nWe're using modern tech that scales well:\n- Backend that can grow\n- Slick frontend interface  \n- Quick database with caching\n- Cloud-ready deployment\n\n**How We'll Do It**\nPhase 1: Get the basics running\nPhase 2: Add features\nPhase 3: Polish and optimize...`,
      },
    };

    // Use template if available, otherwise use a generic one
    const categoryTemplates = templates[category] || templates.Technology;
    return (
      categoryTemplates[tone] ||
      categoryTemplates.Professional ||
      "Generated content for your document. Customize as needed."
    );
  }

  // ── Classify ──────────────────────────────────────────────────────────────
  async classify(req: AIClassifyRequest): Promise<AIResponse> {
    await delay();

    const filename = req.filename || "document.pdf";
    const structured = {
      type: "report",
      confidence: 87,
      suggestedFilename: "Report_Strategic_Planning_Q1_2026.pdf",
      summary:
        "A strategic planning report outlining key initiatives and resource allocation for Q1 2026.",
      keyEntities: [
        "Acme Corporation",
        "Q1 2026",
        "Strategic Planning",
        "John Smith",
        "Board of Directors",
      ],
    };

    return {
      content: `📋 **Document Classification: "${filename}"**

**Type:** Report (87% confidence)
**Suggested Filename:** Report_Strategic_Planning_Q1_2026.pdf

**Summary:** A strategic planning report outlining key initiatives and resource allocation for Q1 2026.

**Key Entities:**
• Acme Corporation
• Q1 2026
• Strategic Planning
• John Smith
• Board of Directors

_Note: In the full version, the document will be analyzed by AI for accurate classification._`,
      structuredData: structured as unknown as Record<string, unknown>,
    };
  }

  // ── Highlight ─────────────────────────────────────────────────────────────
  async highlight(req: AIHighlightRequest): Promise<AIResponse> {
    await delay();

    const docLabel = req.documentName
      ? `"${req.documentName}"`
      : "the provided text";

    const structured = {
      highlights: [
        {
          text: "The total budget allocation for Q2 is $4.2 million, a 15% increase from last quarter.",
          importance: "critical",
          category: "financial",
          reason:
            "Directly impacts Q2 planning and signals a 15% expansion in spending capacity — forecasts and approvals will shift.",
          confidence: 96,
          sourceReference: {
            page: 2,
            section: "Financial Overview",
            paragraphIndex: 3,
            snippet: "total budget allocation for Q2 is $4.2 million",
          },
        },
        {
          text: "All department heads must submit their quarterly reports by March 31st.",
          importance: "critical",
          category: "important_date",
          reason:
            "Hard deadline that blocks downstream reporting cycles if missed — add to task system immediately.",
          confidence: 94,
          sourceReference: {
            page: 3,
            section: "Deadlines",
            paragraphIndex: 1,
            snippet: "submit their quarterly reports by March 31st",
          },
        },
        {
          text: "The board has approved the merger with Global Industries pending regulatory review.",
          importance: "high",
          category: "key_finding",
          reason:
            "Strategic decision that reshapes the company's competitive position and may trigger new compliance obligations.",
          confidence: 88,
          sourceReference: {
            page: 4,
            section: "Strategic Initiatives",
            paragraphIndex: 2,
            snippet: "approved the merger with Global Industries",
          },
        },
        {
          text: "Failure to comply with the new data retention policy may result in significant penalties.",
          importance: "high",
          category: "risk",
          reason:
            "Compliance exposure with direct financial consequences — needs legal/security review before the policy takes effect.",
          confidence: 91,
          sourceReference: {
            page: 6,
            section: "Compliance",
            paragraphIndex: 0,
            snippet: "Failure to comply with the new data retention policy",
          },
        },
        {
          text: "The study concludes that remote work has improved employee satisfaction by 23%.",
          importance: "high",
          category: "conclusion",
          reason:
            "Evidence-backed conclusion supporting ongoing remote work policy — cite in upcoming workforce decisions.",
          confidence: 83,
          sourceReference: {
            page: 8,
            section: "Findings",
            paragraphIndex: 1,
            snippet: "remote work has improved employee satisfaction by 23%",
          },
        },
        {
          text: "Action item: Legal team to review all vendor contracts before renewal.",
          importance: "medium",
          category: "action_required",
          reason:
            "Actionable next step with a clear owner — convert to a task and assign before renewal cycle begins.",
          confidence: 85,
          sourceReference: {
            page: 9,
            section: "Action Items",
            paragraphIndex: 0,
            snippet: "Legal team to review all vendor contracts",
          },
        },
      ],
      meta: {
        summary: [
          "Q2 budget expanded 15% to $4.2M, enabling broader initiatives.",
          "Key deadline: quarterly reports due March 31st from all department heads.",
          "Board-approved Global Industries merger introduces strategic and regulatory considerations.",
          "New data retention policy creates material compliance risk if unaddressed.",
          "Remote work correlates with 23% satisfaction improvement — supports current policy.",
        ],
        keyThemes: [
          "Budget & Finance",
          "Compliance Risk",
          "Strategic Decisions",
          "Deadlines",
          "Workforce",
        ],
        documentType: "report",
        pageDensity: [
          { page: 2, count: 1 },
          { page: 3, count: 1 },
          { page: 4, count: 1 },
          { page: 6, count: 1 },
          { page: 8, count: 1 },
          { page: 9, count: 1 },
        ],
      },
    };

    return {
      content: `Found ${structured.highlights.length} key highlight${structured.highlights.length === 1 ? "" : "s"} from ${docLabel}.`,
      structuredData: structured as unknown as Record<string, unknown>,
    };
  }

  // ── Explain ───────────────────────────────────────────────────────────────
  async explain(req: AIExplainRequest): Promise<AIResponse> {
    await delay();

    const mode = req.mode || "simple";
    const depth = (req as any).depth || "medium";
    const textPreview = preview(req.text, 100);

    const mockExplanations: Record<string, string> = {
      simple: `**Simple Explanation**

In plain words, this text is about ${textPreview}. Think of it like a set of clear steps: someone has to do something, by a certain time, to get a specific result.

**The main idea:**
• There's a clear goal
• A few important rules to follow
• And a timeline to keep things on track

Anyone can follow this — no special background needed.`,
      professional: `**Professional Rewrite**

**Overview**
This content outlines an initiative with defined objectives, responsibilities, and deliverables. It is structured for clarity and aimed at informed stakeholders.

**Key points**
• The scope and objectives are stated explicitly
• Accountability is mapped to specific owners
• Milestones are time-bound and measurable

**Implication**
Teams should align their execution plans to the stated milestones and report progress on the defined cadence.`,
      bullet: `**Quick Breakdown**

## Main idea
• Short, focused: someone does X, by Y date, to achieve Z.

## Who's involved
• Owners, reviewers, and approvers are named.

## What matters most
• The deadline
• The deliverable
• The quality bar

## Watch out for
• Missing owner on at least one line
• Ambiguous deadlines ("soon", "TBD")`,
      plain: `**Simplified Explanation**

Here's what this means in plain language:

The text is talking about ${textPreview}. In simple terms, this means that there are certain rules and guidelines that need to be followed. The key takeaway is that everyone involved should understand their responsibilities and act accordingly.

**Key Points:**
• The main idea is straightforward — it sets out what needs to happen
• There are specific steps people need to follow
• The timeline and expectations are clearly laid out

_This explanation was written at a reading level suitable for a 14-year-old._`,
      legal: `**Legal Text Explained**

**What it says in simple terms:**
This text establishes certain obligations and rights. In plain English, it means that the parties involved have agreed to specific terms.

**Key obligations:**
• Each party must fulfill their commitments as described
• There are deadlines that must be respected
• Certain conditions must be met before actions can be taken

**Important conditions/exceptions:**
• There are specific circumstances where the rules may not apply
• Force majeure (unexpected events) may excuse certain obligations

**Red flags to watch for:**
⚠️ Pay attention to any automatic renewal clauses
⚠️ Note any limitation of liability sections`,
      medical: `**Medical Content Explained for Patients**

**In everyday language:**
This medical information is about your health condition and treatment options. Here's what you need to know in simple terms.

**What you need to do:**
• Follow the prescribed treatment plan
• Take any medications as directed
• Schedule follow-up appointments as recommended

**Important warnings:**
⚠️ Contact your doctor if you experience unusual symptoms
⚠️ Do not stop treatment without consulting your healthcare provider`,
      technical: `**Technical Content Made Simple**

Think of it like this: the text is describing a system that works similar to how a post office delivers mail. Just like letters go through sorting, routing, and delivery, data in this system goes through similar steps.

**The basics:**
• The system takes in information (like dropping off a letter)
• It processes and organizes that information (like the sorting facility)
• It delivers the results to where they need to go (like your mailbox)

**Why it matters:**
This approach makes things faster, more reliable, and easier to manage — just like how modern mail sorting machines are much faster than hand-sorting.`,
    };

    return {
      content: mockExplanations[mode] || mockExplanations.simple || mockExplanations.plain,
      structuredData: {
        __kind: "explain",
        mode,
        depth,
        originalText: req.text,
      },
    };
  }

  // ── Quiz ──────────────────────────────────────────────────────────────────
  async quiz(req: AIQuizRequest): Promise<AIResponse> {
    await delay(900 + Math.random() * 600);

    const qType = req.questionType || "mixed";
    const docLabel = req.documentName ? `"${req.documentName}"` : "the document";
    const rawText = req.text || "";

    // Only generate document-based questions when we have real extracted text.
    // Placeholder strings begin with "[" (e.g. "[PDF document: ..." or "[Document: ...").
    const hasRealText =
      rawText.trim().length > 120 &&
      !rawText.trim().startsWith("[");

    const countTarget =
      req.length === "quick" ? 5 : req.length === "deep" ? 15 : 10;

    if (hasRealText) {
      const questions = buildDocumentQuestions(rawText, docLabel, countTarget, qType);
      if (questions.length >= 3) {
        return {
          content: `Generated ${questions.length} questions from ${docLabel}.`,
          structuredData: {
            questions,
            insufficient: false,
          } as unknown as Record<string, unknown>,
        };
      }
    }

    // No backend, and not enough real document text to ground questions —
    // refuse to fabricate generic textbook questions. This mirrors the
    // backend's STRICT DOCUMENT-GROUNDED behaviour.
    return {
      content: "",
      structuredData: {
        questions: [],
        insufficient: true,
        reason:
          "This document does not contain enough clear information to generate a full quiz. Try a different file or reduce quiz length.",
      } as unknown as Record<string, unknown>,
    };
  }
}

// ── Helpers for document-aware mock questions ────────────────────────────────

function _shuffleArr<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Derive a short topic label from a sentence (first long capitalised word, else first word).
 */
function _topicFrom(sentence: string): string {
  const words = sentence.split(/\s+/);
  const cap = words.find((w) => w.length > 4 && /^[A-Z]/.test(w));
  const raw = cap || words[0] || "Content";
  return raw.replace(/[^a-zA-Z\s]/g, "").trim().slice(0, 22) || "Document Content";
}

const DIFF_CYCLE: Array<"easy" | "medium" | "hard"> = [
  "easy", "easy", "medium", "medium", "hard",
];

/**
 * Build document-aware questions from extracted text.
 * Uses a simple sentence-extraction approach (no LLM needed).
 */
function buildDocumentQuestions(
  text: string,
  docLabel: string,
  maxCount: number,
  qType: string,
): any[] {
  // Strip page markers and normalise whitespace
  const clean = text
    .replace(/\[Page \d+\]\n?/g, "")
    .replace(/\[Slide \d+\]\n?/g, "")
    .replace(/\[Sheet \d+\]\n?/g, "")
    .replace(/\[Document truncated[^\]]*\]/g, "");

  // Split into sentences
  const sentences = clean
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 55 && s.length <= 280 && /[a-zA-Z]{4,}/.test(s));

  if (sentences.length < 3) return [];

  const shuffled = _shuffleArr(sentences);
  // Keep a pool big enough for MCQ wrong-option candidates
  const pool = shuffled.slice(0, Math.min(maxCount + 6, shuffled.length));
  const selected = pool.slice(0, maxCount);

  const TYPES: Array<"mcq" | "true_false" | "short"> = ["mcq", "true_false", "short"];

  return selected.map((sentence, i) => {
    const diff = DIFF_CYCLE[i % DIFF_CYCLE.length];
    const type: "mcq" | "true_false" | "short" =
      qType === "mixed"
        ? TYPES[i % 3]
        : (["mcq", "true_false", "short"].includes(qType) ? (qType as any) : TYPES[i % 3]);
    const topic = _topicFrom(sentence);

    if (type === "true_false") {
      return {
        id: `q${i + 1}`,
        type: "true_false",
        question: `True or False: The following appears in ${docLabel} — "${sentence}"`,
        answer: "True",
        explanation: `This sentence is taken directly from ${docLabel}.`,
        source_text: sentence,
        source_reference: { snippet: sentence.slice(0, 80) },
        difficulty: diff,
        topic,
      };
    }

    if (type === "short") {
      const words = sentence.split(/\s+/);
      const pivot = Math.max(3, Math.ceil(words.length * 0.45));
      const stem = words.slice(0, pivot).join(" ");
      return {
        id: `q${i + 1}`,
        type: "short",
        question: `According to ${docLabel}, complete or explain: "${stem}…"`,
        answer: sentence,
        explanation: `The full statement from the document: "${sentence}"`,
        source_text: sentence,
        source_reference: { snippet: sentence.slice(0, 80) },
        difficulty: diff,
        topic,
      };
    }

    // MCQ — correct answer is the real sentence; distractors are other sentences from the pool
    const distractors = _shuffleArr(
      pool.filter((s) => s !== sentence),
    ).slice(0, 3);
    // Pad with shortened variants if not enough distractors
    while (distractors.length < 3) {
      const fallback = distractors[0] ?? sentence;
      distractors.push(fallback.split(/\s+/).reverse().slice(0, 8).join(" ") + "…");
    }
    const options = _shuffleArr([sentence, ...distractors]);
    return {
      id: `q${i + 1}`,
      type: "mcq",
      question: `Which of the following statements appears in ${docLabel}?`,
      options,
      answer: sentence,
      explanation: `"${sentence.slice(0, 80)}…" is taken directly from the document.`,
      source_text: sentence,
      source_reference: { snippet: sentence.slice(0, 80) },
      difficulty: diff,
      topic,
    };
  });
}


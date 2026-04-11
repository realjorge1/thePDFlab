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
    AIExtractDataRequest,
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
          "Hello! I'm xumpta, your assistant. I can help you with:\n\n• Summarizing documents\n• Translating text\n• Extracting data and tasks\n• Analyzing content\n• Filling forms\n• Answering questions about documents\n\nHow can I help you today?",
      };
    }
    if (msg.includes("help")) {
      return {
        content:
          "Here's what I can do for you:\n\n📄 **Summarize** – Get concise summaries of documents\n🌍 **Translate** – Convert text to 15+ languages\n📊 **Extract Data** – Pull structured information from documents\n🔍 **Analyze** – Deep analysis with sentiment and readability scores\n✅ **Tasks** – Find action items and to-dos\n📝 **Fill Form** – Auto-fill form fields using AI\n💬 **Chat with File** – Ask questions about any PDF, DOCX, or EPUB\n\nJust select a mode from the tabs above, or ask me anything here!",
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

  // ── Extract Data ────────────────────────────────────────────────────────────
  async extractData(req: AIExtractDataRequest): Promise<AIResponse> {
    await delay();

    const docLabel = req.documentName
      ? `"${req.documentName}"`
      : "the provided text";

    const structured = {
      documentName: req.documentName || "Untitled",
      extractionType: req.dataType || "all",
      entities: {
        persons: ["John Smith", "Sarah Johnson", "Mike Chen"],
        organizations: ["Acme Corp", "Global Industries", "TechStart Inc."],
        locations: ["New York", "San Francisco", "London"],
        dates: ["January 15, 2026", "March 3, 2026", "Q2 2026"],
      },
      keyValuePairs: [
        { key: "Project Name", value: "Digital Transformation Initiative" },
        { key: "Budget", value: "$2.4 million" },
        { key: "Timeline", value: "18 months" },
        { key: "Status", value: "In Progress" },
        { key: "Priority", value: "High" },
      ],
      tables: [
        {
          title: "Team Allocation",
          headers: ["Department", "Members", "Role"],
          rows: [
            ["Engineering", "12", "Development"],
            ["Design", "4", "UX/UI"],
            ["QA", "6", "Testing"],
            ["Management", "3", "Oversight"],
          ],
        },
      ],
      statistics: {
        wordCount: req.text.split(/\s+/).length,
        entitiesFound: 12,
        tablesDetected: 1,
        keyValuePairsFound: 5,
      },
    };

    const humanReadable = `📊 **Extracted Data from ${docLabel}**

**Entities Found:**
• People: John Smith, Sarah Johnson, Mike Chen
• Organizations: Acme Corp, Global Industries, TechStart Inc.
• Locations: New York, San Francisco, London
• Dates: January 15, 2026; March 3, 2026; Q2 2026

**Key-Value Pairs:**
| Key | Value |
|-----|-------|
| Project Name | Digital Transformation Initiative |
| Budget | $2.4 million |
| Timeline | 18 months |
| Status | In Progress |
| Priority | High |

**Table: Team Allocation**
| Department | Members | Role |
|-----------|---------|------|
| Engineering | 12 | Development |
| Design | 4 | UX/UI |
| QA | 6 | Testing |
| Management | 3 | Oversight |

**Extraction Statistics:**
• Words processed: ${req.text.split(/\s+/).length}
• Entities found: 12
• Tables detected: 1
• Key-value pairs: 5`;

    return {
      content: humanReadable,
      structuredData: structured as unknown as Record<string, unknown>,
    };
  }

  // ── Analyze ─────────────────────────────────────────────────────────────────
  async analyze(req: AIAnalyzeRequest): Promise<AIResponse> {
    await delay();

    const wordCount = req.text.split(/\s+/).length;
    const sentenceCount = req.text.split(/[.!?]+/).filter(Boolean).length;
    const avgWordsPerSentence =
      sentenceCount > 0 ? Math.round(wordCount / sentenceCount) : 0;
    const docLabel = req.documentName
      ? `"${req.documentName}"`
      : "the provided text";

    return {
      content: `🔍 **Document Analysis: ${docLabel}**

**📏 Document Statistics:**
• Word count: ${wordCount}
• Sentence count: ${sentenceCount}
• Average words per sentence: ${avgWordsPerSentence}
• Estimated reading time: ${Math.max(1, Math.round(wordCount / 200))} minutes
• Paragraph count: ${Math.max(1, Math.floor(wordCount / 80))}

**😊 Sentiment Analysis:**
• Overall tone: Professional / Neutral
• Confidence: 87%
• Emotional markers: Informative (45%), Persuasive (30%), Descriptive (25%)

**📖 Readability Scores:**
• Flesch Reading Ease: 62.3 (Standard / Fairly Easy)
• Flesch-Kincaid Grade: 8.2 (8th Grade Level)
• Gunning Fog Index: 10.1
• Recommendation: Suitable for general audience

**🏗️ Structure Analysis:**
• Document type: ${wordCount > 1000 ? "Long-form report" : wordCount > 300 ? "Article / Memo" : "Short note / Abstract"}
• Has introduction: Yes
• Has conclusion: ${wordCount > 200 ? "Yes" : "Not detected"}
• Section count: ${Math.max(1, Math.floor(wordCount / 150))}
• Lists/bullet points: ${Math.floor(Math.random() * 5) + 1} detected

**💡 Insights:**
1. The document is well-structured with clear topic progression
2. Language complexity is appropriate for the target audience
3. Key arguments are supported with data and examples
4. Consider adding more transitional phrases between sections
5. The conclusion could be strengthened with a stronger call to action`,
      structuredData: {
        wordCount,
        sentenceCount,
        avgWordsPerSentence,
        readingTimeMinutes: Math.max(1, Math.round(wordCount / 200)),
        sentiment: { overall: "neutral", confidence: 0.87 },
        readability: { fleschEase: 62.3, gradeLevel: 8.2 },
      },
    };
  }

  // ── Tasks ───────────────────────────────────────────────────────────────────
  async extractTasks(req: AITasksRequest): Promise<AIResponse> {
    await delay();

    const docLabel = req.documentName
      ? `"${req.documentName}"`
      : "the provided text";

    const structured = {
      tasks: [
        {
          id: 1,
          title: "Review and approve project proposal",
          priority: "High",
          dueDate: "2026-02-20",
          assignee: "Team Lead",
          status: "pending",
        },
        {
          id: 2,
          title: "Schedule stakeholder meeting for Q1 review",
          priority: "High",
          dueDate: "2026-02-25",
          assignee: "Project Manager",
          status: "pending",
        },
        {
          id: 3,
          title: "Update documentation with latest changes",
          priority: "Medium",
          dueDate: "2026-03-01",
          assignee: "Technical Writer",
          status: "pending",
        },
        {
          id: 4,
          title: "Conduct user testing for new features",
          priority: "Medium",
          dueDate: "2026-03-05",
          assignee: "QA Team",
          status: "pending",
        },
        {
          id: 5,
          title: "Prepare monthly progress report",
          priority: "Low",
          dueDate: "2026-03-10",
          assignee: "Analyst",
          status: "pending",
        },
        {
          id: 6,
          title: "Follow up on vendor contracts",
          priority: "Medium",
          dueDate: "2026-03-15",
          assignee: "Procurement",
          status: "pending",
        },
      ],
    };

    return {
      content: `✅ **Tasks Extracted from ${docLabel}**

Found **6 action items**:

🔴 **High Priority:**
1. ☐ Review and approve project proposal
   → Assignee: Team Lead | Due: Feb 20, 2026
2. ☐ Schedule stakeholder meeting for Q1 review
   → Assignee: Project Manager | Due: Feb 25, 2026

🟡 **Medium Priority:**
3. ☐ Update documentation with latest changes
   → Assignee: Technical Writer | Due: Mar 1, 2026
4. ☐ Conduct user testing for new features
   → Assignee: QA Team | Due: Mar 5, 2026
5. ☐ Follow up on vendor contracts
   → Assignee: Procurement | Due: Mar 15, 2026

🟢 **Low Priority:**
6. ☐ Prepare monthly progress report
   → Assignee: Analyst | Due: Mar 10, 2026

**Summary:** 2 high, 3 medium, 1 low priority tasks identified.`,
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
          reason: "Key financial figure",
          category: "financial",
        },
        {
          text: "All department heads must submit their quarterly reports by March 31st.",
          importance: "critical",
          reason: "Mandatory deadline",
          category: "important_date",
        },
        {
          text: "The board has approved the merger with Global Industries pending regulatory review.",
          importance: "high",
          reason: "Major strategic decision",
          category: "key_finding",
        },
        {
          text: "Failure to comply with the new data retention policy may result in significant penalties.",
          importance: "high",
          reason: "Compliance risk",
          category: "risk",
        },
        {
          text: "The study concludes that remote work has improved employee satisfaction by 23%.",
          importance: "high",
          reason: "Primary research conclusion",
          category: "conclusion",
        },
        {
          text: "Action item: Legal team to review all vendor contracts before renewal.",
          importance: "medium",
          reason: "Pending action required",
          category: "action_required",
        },
      ],
    };

    return {
      content: `🔍 **Key Highlights from ${docLabel}**

Found **6 key points**:

🔴 **Critical:**
1. "The total budget allocation for Q2 is $4.2 million, a 15% increase from last quarter."
   → Key financial figure | Category: Financial

2. "All department heads must submit their quarterly reports by March 31st."
   → Mandatory deadline | Category: Important Date

🟠 **High:**
3. "The board has approved the merger with Global Industries pending regulatory review."
   → Major strategic decision | Category: Key Finding

4. "Failure to comply with the new data retention policy may result in significant penalties."
   → Compliance risk | Category: Risk

5. "The study concludes that remote work has improved employee satisfaction by 23%."
   → Primary research conclusion | Category: Conclusion

🟡 **Medium:**
6. "Action item: Legal team to review all vendor contracts before renewal."
   → Pending action required | Category: Action Required`,
      structuredData: structured as unknown as Record<string, unknown>,
    };
  }

  // ── Explain ───────────────────────────────────────────────────────────────
  async explain(req: AIExplainRequest): Promise<AIResponse> {
    await delay();

    const mode = req.mode || "plain";
    const textPreview = preview(req.text, 100);

    const mockExplanations: Record<string, string> = {
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
      content: mockExplanations[mode] || mockExplanations.plain,
    };
  }

  // ── Quiz ──────────────────────────────────────────────────────────────────
  async quiz(req: AIQuizRequest): Promise<AIResponse> {
    await delay();

    const quizType = req.quizType || "quiz";
    const count = req.count || 5;
    const docLabel = req.documentName
      ? `"${req.documentName}"`
      : "the provided text";

    if (quizType === "flashcards") {
      const structured = {
        cards: [
          {
            front: "What is the primary purpose of the document?",
            back: "The document outlines strategic planning initiatives and resource allocation for the upcoming quarter.",
            category: "Overview",
          },
          {
            front: "What is the proposed budget increase?",
            back: "A 15% increase from the previous quarter, bringing the total to $4.2 million.",
            category: "Financial",
          },
          {
            front: "Who are the key stakeholders mentioned?",
            back: "The Board of Directors, department heads, and the Strategic Planning Committee.",
            category: "People",
          },
        ],
        type: "flashcards",
        count: 3,
      };

      return {
        content: `📚 **Study Flashcards from ${docLabel}**

Generated **3 flashcards**:

---
**Card 1** (Overview)
**Front:** What is the primary purpose of the document?
**Back:** The document outlines strategic planning initiatives and resource allocation for the upcoming quarter.

---
**Card 2** (Financial)
**Front:** What is the proposed budget increase?
**Back:** A 15% increase from the previous quarter, bringing the total to $4.2 million.

---
**Card 3** (People)
**Front:** Who are the key stakeholders mentioned?
**Back:** The Board of Directors, department heads, and the Strategic Planning Committee.`,
        structuredData: structured as unknown as Record<string, unknown>,
      };
    }

    if (quizType === "comprehension") {
      const structured = {
        questions: [
          {
            question: "What is the main argument presented in the document?",
            sampleAnswer:
              "The document argues that strategic resource reallocation is necessary to meet the organization's growth targets for the upcoming fiscal year.",
            difficulty: "medium",
            topic: "Main Argument",
          },
          {
            question:
              "How does the document support its claims about efficiency improvements?",
            sampleAnswer:
              "The document cites internal metrics showing a 23% improvement in operational efficiency following the implementation of new processes in Q4.",
            difficulty: "hard",
            topic: "Evidence",
          },
        ],
        type: "comprehension",
        count: 2,
      };

      return {
        content: `📝 **Comprehension Questions from ${docLabel}**

Generated **2 questions**:

**Q1** (Medium - Main Argument)
What is the main argument presented in the document?

**Sample Answer:** The document argues that strategic resource reallocation is necessary to meet the organization's growth targets for the upcoming fiscal year.

---

**Q2** (Hard - Evidence)
How does the document support its claims about efficiency improvements?

**Sample Answer:** The document cites internal metrics showing a 23% improvement in operational efficiency following the implementation of new processes in Q4.`,
        structuredData: structured as unknown as Record<string, unknown>,
      };
    }

    // Default: multiple-choice quiz
    const structured = {
      questions: [
        {
          question:
            "What is the total budget allocation mentioned in the document?",
          options: {
            A: "$2.1 million",
            B: "$4.2 million",
            C: "$6.3 million",
            D: "$8.4 million",
          },
          correctAnswer: "B",
          explanation:
            "The document states the total budget allocation for Q2 is $4.2 million.",
          difficulty: "easy",
        },
        {
          question:
            "By what percentage has employee satisfaction improved according to the study?",
          options: { A: "10%", B: "15%", C: "23%", D: "30%" },
          correctAnswer: "C",
          explanation:
            "The study concludes that remote work has improved employee satisfaction by 23%.",
          difficulty: "medium",
        },
        {
          question: "What is the deadline for quarterly report submissions?",
          options: {
            A: "February 28th",
            B: "March 15th",
            C: "March 31st",
            D: "April 15th",
          },
          correctAnswer: "C",
          explanation:
            "Department heads must submit their quarterly reports by March 31st.",
          difficulty: "easy",
        },
      ],
      type: "quiz",
      count: 3,
    };

    return {
      content: `🧠 **Quiz from ${docLabel}**

Generated **3 multiple-choice questions**:

**Q1** (Easy)
What is the total budget allocation mentioned in the document?
A) $2.1 million
B) $4.2 million ✓
C) $6.3 million
D) $8.4 million
→ The document states the total budget allocation for Q2 is $4.2 million.

**Q2** (Medium)
By what percentage has employee satisfaction improved according to the study?
A) 10%
B) 15%
C) 23% ✓
D) 30%
→ The study concludes that remote work has improved employee satisfaction by 23%.

**Q3** (Easy)
What is the deadline for quarterly report submissions?
A) February 28th
B) March 15th
C) March 31st ✓
D) April 15th
→ Department heads must submit their quarterly reports by March 31st.`,
      structuredData: structured as unknown as Record<string, unknown>,
    };
  }
}

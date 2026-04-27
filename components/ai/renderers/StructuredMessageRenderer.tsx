// ============================================
// StructuredMessageRenderer
// Central dispatch for any structured AI output attached to a chat message.
// Picks the best renderer based on the message's AIAction + structuredData shape.
// ============================================

import type {
  AIAction,
  AIChatMessage,
  HighlightData,
  HighlightItem,
} from "@/services/ai/ai.types";
import React from "react";
import { ClassifyRenderer, ClassifyData } from "./ClassifyRenderer";
import { DocumentRenderer } from "./DocumentRenderer";
import { ExplainRenderer } from "./ExplainRenderer";
import { HighlightRenderer } from "./HighlightRenderer";
import { InsightRenderer, InsightData } from "./InsightRenderer";
import { TableRenderer, TableData } from "./TableRenderer";
import { TaskRenderer, TaskData } from "./TaskRenderer";

interface Props {
  message: AIChatMessage;
  action?: AIAction;
  documentName?: string;
  onAddAllToTodos?: (tasks: any[]) => void;
  onSourceTap?: (quote: string) => void;
  onAskMore?: (prompt: string) => void;
  onConvertToEditable?: (sections: any[]) => void;
  onRenameFile?: (filename: string) => void;
  onMoveToFolder?: (folder: string) => void;
  onToggleAutoSort?: (enabled: boolean) => void;
  autoSortEnabled?: boolean;
  onExport?: () => void;
  onAddToNotes?: () => void;
  onExtractTasks?: () => void;
  onExplainDocParagraph?: (text: string) => void;
  onSummarizeDocParagraph?: (text: string) => void;
  // Highlight-specific handlers
  onJumpToHighlight?: (highlight: HighlightItem) => void;
  onConvertHighlightToTask?: (highlight: HighlightItem) => void;
  onAddHighlightToNotes?: (highlight: HighlightItem) => void;
  onExplainHighlight?: (highlight: HighlightItem) => void;
  onGenerateQuizFromHighlights?: (highlights: HighlightItem[]) => void;
  onConvertHighlightsToFlashcards?: (highlights: HighlightItem[]) => void;
  onExportHighlights?: (highlights: HighlightItem[]) => void;
}

export function StructuredMessageRenderer({
  message,
  action,
  documentName,
  onAddAllToTodos,
  onSourceTap,
  onAskMore,
  onConvertToEditable,
  onRenameFile,
  onMoveToFolder,
  onToggleAutoSort,
  autoSortEnabled,
  onExport,
  onAddToNotes,
  onExtractTasks,
  onExplainDocParagraph,
  onSummarizeDocParagraph,
  onJumpToHighlight,
  onConvertHighlightToTask,
  onAddHighlightToNotes,
  onExplainHighlight,
  onGenerateQuizFromHighlights,
  onConvertHighlightsToFlashcards,
  onExportHighlights,
}: Props) {
  if (message.role !== "assistant") return null;
  const sd = message.structuredData as Record<string, any> | undefined;

  // Dispatch priority: structuredData SHAPE first, then session action, so
  // that a stale session action doesn't mis-route a message's rich output.

  // ── Explain shim ────────────────────────────────────────────────────────
  if (sd?.__kind === "explain") {
    return (
      <ExplainRenderer
        content={message.content}
        originalText={sd?.originalText}
        initialMode={sd?.mode}
        initialDepth={sd?.depth}
        onAddToNotes={onAddToNotes}
        onExport={onExport}
      />
    );
  }

  // ── Document (extract-text) shim ────────────────────────────────────────
  if (sd?.__kind === "document") {
    return (
      <DocumentRenderer
        fullText={sd.fullText || message.content}
        documentName={documentName}
        onConvertToEditable={onConvertToEditable}
        onAddToNotes={onAddToNotes}
        onExport={onExport}
        onExplainParagraph={onExplainDocParagraph}
        onSummarizeParagraph={onSummarizeDocParagraph}
        onAskAboutSection={
          onAskMore
            ? (heading, sectionText) =>
                onAskMore(
                  `Tell me more about the "${heading || "section"}" section:\n\n${sectionText.slice(0, 500)}`,
                )
            : undefined
        }
      />
    );
  }

  // Shape-based routing for structured payloads
  if (sd && typeof sd === "object") {
    // ── Highlights (has a .highlights array with highlight-shaped items) ────
    if (
      Array.isArray(sd.highlights) &&
      sd.highlights.length > 0 &&
      typeof sd.highlights[0] === "object" &&
      sd.highlights[0] !== null &&
      "text" in (sd.highlights[0] as object) &&
      "importance" in (sd.highlights[0] as object)
    ) {
      return (
        <HighlightRenderer
          data={sd as HighlightData}
          documentName={documentName}
          onJumpToSource={onJumpToHighlight}
          onConvertToTask={onConvertHighlightToTask}
          onAddToNotes={onAddHighlightToNotes}
          onExplain={onExplainHighlight}
          onGenerateQuiz={onGenerateQuizFromHighlights}
          onConvertToFlashcards={onConvertHighlightsToFlashcards}
          onExport={onExportHighlights}
        />
      );
    }

    if (
      Array.isArray(sd.insights) ||
      typeof sd.sentiment === "string" ||
      Array.isArray(sd.recommendations) ||
      Array.isArray(sd.strengths) ||
      Array.isArray(sd.weaknesses)
    ) {
      return (
        <InsightRenderer
          data={sd as InsightData}
          onSourceTap={onSourceTap}
          onAskMore={onAskMore}
          onAddToNotes={onAddToNotes}
          onExtractTasks={onExtractTasks}
          onExport={onExport}
        />
      );
    }

    if (
      ("type" in sd && "confidence" in sd) ||
      ("suggestedFilename" in sd && "keyEntities" in sd)
    ) {
      return (
        <ClassifyRenderer
          data={sd as ClassifyData}
          documentName={documentName}
          onRenameFile={onRenameFile}
          onMoveToFolder={onMoveToFolder}
          onToggleAutoSort={onToggleAutoSort}
          autoSortEnabled={autoSortEnabled}
        />
      );
    }

    if (Array.isArray(sd.tasks)) {
      return (
        <TaskRenderer
          data={sd as TaskData}
          onAddAllToTodos={onAddAllToTodos}
          onExport={onExport}
          onAddToNotes={onAddToNotes}
        />
      );
    }

    if (
      "documentType" in sd ||
      Array.isArray(sd.rows) ||
      Array.isArray(sd.columns)
    ) {
      return (
        <TableRenderer
          data={sd as TableData}
          onAddToNotes={onAddToNotes}
          onExtractTasks={onExtractTasks}
        />
      );
    }
  }

  // Fall back on session action only when the message has no recognizable
  // structured payload — this keeps the Explain UI active for explain-mode
  // messages even when the LLM returned plain text.
  if (action === "explain") {
    return (
      <ExplainRenderer
        content={message.content}
        originalText={sd?.originalText}
        initialMode={sd?.mode}
        initialDepth={sd?.depth}
        onAddToNotes={onAddToNotes}
        onExport={onExport}
      />
    );
  }

  return null;
}

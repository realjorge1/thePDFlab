// ============================================
// AI Chat Bubble – renders a single message with markdown support
// ============================================

import { AI_CITATIONS_V2, AI_MARKDOWN } from "@/constants/featureFlags";
import { spacing } from "@/constants/theme";
import { useTheme } from "@/services/ThemeProvider";
import { copyToClipboard } from "@/services/ai/ai.service";
import type {
  AIAction,
  AIChatMessage,
  ChallengerRole,
  HighlightItem,
} from "@/services/ai/ai.types";
import { stripCitationMarkers, type AICitation } from "@/services/ai/citations";
import { stripMarkdown } from "@/utils/sanitizeAiText";
import { Check, Copy, RotateCcw } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { CitationSources } from "./CitationSources";
import { MarkdownText } from "./MarkdownText";
import { StructuredMessageRenderer } from "./renderers/StructuredMessageRenderer";

/**
 * Whether a message should render with MarkdownText: it kept its Markdown
 * (AI_MARKDOWN) or carries tappable citations (AI_CITATIONS_V2). Messages from
 * before the upgrade have neither and render with the original renderer.
 */
export function shouldRenderRich(message: AIChatMessage): boolean {
  return (
    (AI_MARKDOWN && message.format === "markdown") ||
    (AI_CITATIONS_V2 && Array.isArray(message.citations) && message.citations.length > 0)
  );
}

/** Clean text for the clipboard: never raw Markdown or [n] markers. */
export function clipboardTextFor(message: AIChatMessage): string {
  if (message.format === "markdown" || (message.citations && message.citations.length > 0)) {
    return stripMarkdown(stripCitationMarkers(message.content));
  }
  return message.content;
}

interface Props {
  message: AIChatMessage;
  action?: AIAction;
  documentName?: string;
  /** Tap on a citation chip or a Sources row (AI_CITATIONS_V2). */
  onCitationPress?: (citation: AICitation, message: AIChatMessage) => void;
  /** Retry an answer whose stream was interrupted. */
  onRetry?: (message: AIChatMessage) => void;
  onAddAllToTodos?: (tasks: any[]) => void;
  onSourceTap?: (quote: string) => void;
  onAskMore?: (prompt: string) => void;
  onExport?: () => void;
  onAddToNotes?: () => void;
  onExtractTasks?: () => void;
  onRerunWithRole?: (role: ChallengerRole, customRole?: string) => void;
  onJumpToHighlight?: (highlight: HighlightItem) => void;
  onConvertHighlightToTask?: (highlight: HighlightItem) => void;
  onAddHighlightToNotes?: (highlight: HighlightItem) => void;
  onExplainHighlight?: (highlight: HighlightItem) => void;
  onGenerateQuizFromHighlights?: (highlights: HighlightItem[]) => void;
  onConvertHighlightsToFlashcards?: (highlights: HighlightItem[]) => void;
  onExportHighlights?: (highlights: HighlightItem[]) => void;
}

// ── Lightweight markdown renderer ────────────────────────────────────────────
// Handles: headings, bold, italic, code, bullets, blockquotes, dividers
interface Segment {
  type:
    | "h1" | "h2" | "h3"
    | "bullet"
    | "blockquote"
    | "divider"
    | "paragraph"
    | "empty";
  content: string;
}

function parseBlocks(text: string): Segment[] {
  const lines = text.split("\n");
  const blocks: Segment[] = [];

  for (const raw of lines) {
    const line = raw;

    if (/^---+$/.test(line.trim())) {
      blocks.push({ type: "divider", content: "" });
    } else if (/^# (.+)/.test(line)) {
      blocks.push({ type: "h1", content: line.replace(/^# /, "") });
    } else if (/^## (.+)/.test(line)) {
      blocks.push({ type: "h2", content: line.replace(/^## /, "") });
    } else if (/^### (.+)/.test(line)) {
      blocks.push({ type: "h3", content: line.replace(/^### /, "") });
    } else if (/^[-*•] (.+)/.test(line)) {
      blocks.push({ type: "bullet", content: line.replace(/^[-*•] /, "") });
    } else if (/^\d+\. (.+)/.test(line)) {
      const match = line.match(/^\d+\. (.+)/);
      blocks.push({ type: "bullet", content: match![1] });
    } else if (/^> (.+)/.test(line)) {
      blocks.push({ type: "blockquote", content: line.replace(/^> /, "") });
    } else if (line.trim() === "") {
      blocks.push({ type: "empty", content: "" });
    } else {
      blocks.push({ type: "paragraph", content: line });
    }
  }

  return blocks;
}

// Render inline markdown: **bold**, *italic*, `code`
function InlineText({
  text,
  baseStyle,
}: {
  text: string;
  baseStyle: object;
}) {
  // Split on bold, italic, and code markers
  const parts: Array<{ content: string; bold?: boolean; italic?: boolean; code?: boolean }> = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ content: text.slice(lastIndex, match.index) });
    }
    if (match[2] !== undefined) {
      parts.push({ content: match[2], bold: true });
    } else if (match[3] !== undefined) {
      parts.push({ content: match[3], italic: true });
    } else if (match[4] !== undefined) {
      parts.push({ content: match[4], code: true });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ content: text.slice(lastIndex) });
  }

  return (
    <Text style={baseStyle}>
      {parts.map((p, i) => {
        if (p.bold) return <Text key={i} style={{ fontWeight: "700" }}>{p.content}</Text>;
        if (p.italic) return <Text key={i} style={{ fontStyle: "italic" }}>{p.content}</Text>;
        if (p.code) return <Text key={i} style={styles.inlineCode}>{p.content}</Text>;
        return <Text key={i}>{p.content}</Text>;
      })}
    </Text>
  );
}

function MarkdownContent({
  text,
  textColor,
  isUser,
}: {
  text: string;
  textColor: string;
  isUser: boolean;
}) {
  const blocks = parseBlocks(text);
  const baseTextStyle = { color: textColor, fontSize: 14, lineHeight: 21 };

  return (
    <>
      {blocks.map((block, idx) => {
        switch (block.type) {
          case "h1":
            return (
              <InlineText
                key={idx}
                text={block.content}
                baseStyle={[baseTextStyle, styles.h1, { color: textColor }]}
              />
            );
          case "h2":
            return (
              <InlineText
                key={idx}
                text={block.content}
                baseStyle={[baseTextStyle, styles.h2, { color: textColor }]}
              />
            );
          case "h3":
            return (
              <InlineText
                key={idx}
                text={block.content}
                baseStyle={[baseTextStyle, styles.h3, { color: textColor }]}
              />
            );
          case "bullet":
            return (
              <View key={idx} style={styles.bulletRow}>
                <Text style={[{ color: textColor, fontSize: 14, lineHeight: 21 }, styles.bulletDot]}>•</Text>
                <InlineText
                  text={block.content}
                  baseStyle={[baseTextStyle, styles.bulletText]}
                />
              </View>
            );
          case "blockquote":
            return (
              <View key={idx} style={[styles.blockquote, isUser ? styles.blockquoteUser : styles.blockquoteAI]}>
                <InlineText
                  text={block.content}
                  baseStyle={[baseTextStyle, styles.blockquoteText, { color: textColor }]}
                />
              </View>
            );
          case "divider":
            return (
              <View
                key={idx}
                style={[styles.divider, { borderBottomColor: isUser ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.12)" }]}
              />
            );
          case "empty":
            return <View key={idx} style={styles.emptyLine} />;
          default:
            return (
              <InlineText
                key={idx}
                text={block.content}
                baseStyle={baseTextStyle}
              />
            );
        }
      })}
    </>
  );
}

/** Small status line for streaming / stopped / interrupted answers and notices. */
function MessageFooterNotes({
  message,
  color,
  onRetry,
}: {
  message: AIChatMessage;
  color: string;
  onRetry?: (message: AIChatMessage) => void;
}) {
  const notes: React.ReactNode[] = [];
  if (message.notice) {
    notes.push(
      <Text key="notice" allowFontScaling style={[styles.notice, { color }]}>
        {message.notice}
      </Text>,
    );
  }
  if (message.streamState === "stopped") {
    notes.push(
      <Text key="stopped" allowFontScaling style={[styles.notice, { color }]}>
        Stopped
      </Text>,
    );
  }
  if (message.streamState === "interrupted") {
    notes.push(
      <View key="interrupted" style={styles.interruptedRow}>
        <Text allowFontScaling style={[styles.notice, { color }]}>
          Answer interrupted
        </Text>
        {onRetry ? (
          <TouchableOpacity
            onPress={() => onRetry(message)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.retryBtn}
            accessibilityRole="button"
            accessibilityLabel="Retry answer"
          >
            <RotateCcw size={12} color="#9333EA" />
            <Text allowFontScaling style={styles.retryText}>
              Retry
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>,
    );
  }
  return notes.length ? <View style={styles.notes}>{notes}</View> : null;
}

export const AIChatBubble = React.memo(function AIChatBubble({
  message,
  action,
  documentName,
  onCitationPress,
  onRetry,
  onAddAllToTodos,
  onSourceTap,
  onAskMore,
  onExport,
  onAddToNotes,
  onExtractTasks,
  onRerunWithRole,
  onJumpToHighlight,
  onConvertHighlightToTask,
  onAddHighlightToNotes,
  onExplainHighlight,
  onGenerateQuizFromHighlights,
  onConvertHighlightsToFlashcards,
  onExportHighlights,
}: Props) {
  const { colors: t, mode } = useTheme();
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(clipboardTextFor(message));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [message]);

  const handleCitation = useCallback(
    (citation: AICitation) => onCitationPress?.(citation, message),
    [onCitationPress, message],
  );
  const showSources =
    AI_CITATIONS_V2 && !isUser && Array.isArray(message.citations) && message.citations.length > 0;

  const textColor = isUser ? "#FFFFFF" : t.text;

  const hasStructured =
    !isUser &&
    !!message.structuredData &&
    typeof message.structuredData === "object";

  // Structured assistant output: skip the narrow bubble and let the renderer use full width.
  if (hasStructured) {
    return (
      <View style={[styles.row, { alignItems: "flex-start" }]}>
        <View style={styles.structuredWrap}>
          <StructuredMessageRenderer
            message={message}
            action={action}
            documentName={documentName}
            onAddAllToTodos={onAddAllToTodos}
            onSourceTap={onSourceTap}
            onAskMore={onAskMore}
            onExport={onExport}
            onAddToNotes={onAddToNotes}
            onExtractTasks={onExtractTasks}
            onRerunWithRole={onRerunWithRole}
            onJumpToHighlight={onJumpToHighlight}
            onConvertHighlightToTask={onConvertHighlightToTask}
            onAddHighlightToNotes={onAddHighlightToNotes}
            onExplainHighlight={onExplainHighlight}
            onGenerateQuizFromHighlights={onGenerateQuizFromHighlights}
            onConvertHighlightsToFlashcards={onConvertHighlightsToFlashcards}
            onExportHighlights={onExportHighlights}
          />
          <MessageFooterNotes message={message} color={t.textTertiary} onRetry={onRetry} />
          <View style={styles.meta}>
            <Text style={[styles.time, { color: t.textTertiary }]}>
              {new Date(message.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
            <TouchableOpacity
              onPress={handleCopy}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.copyBtn}
            >
              {copied ? (
                <Check size={14} color={t.success} />
              ) : (
                <Copy size={14} color={t.textTertiary} />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[styles.row, { alignItems: isUser ? "flex-end" : "flex-start" }]}
    >
      <View
        style={[
          styles.bubble,
          isUser
            ? { backgroundColor: "#9333EA", borderBottomRightRadius: 4 }
            : {
                backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9",
                borderBottomLeftRadius: 4,
              },
        ]}
      >
        {!isUser && message.streamState === "streaming" && !message.content ? (
          <View
            style={styles.typingRow}
            accessible
            accessibilityLabel="Gozlin is writing an answer"
          >
            <ActivityIndicator size="small" color="#9333EA" />
            <Text allowFontScaling style={[styles.notice, { color: t.textTertiary }]}>
              Gozlin is writing…
            </Text>
          </View>
        ) : !isUser && shouldRenderRich(message) ? (
          <MarkdownText
            text={message.content}
            color={textColor}
            accentColor="#9333EA"
            citations={message.citations}
            onCitationPress={onCitationPress ? handleCitation : undefined}
          />
        ) : (
          <MarkdownContent
            text={message.content}
            textColor={textColor}
            isUser={isUser}
          />
        )}

        {showSources ? (
          <CitationSources
            citations={message.citations!}
            onPress={onCitationPress ? handleCitation : undefined}
            accentColor="#9333EA"
          />
        ) : null}

        {!isUser ? (
          <MessageFooterNotes message={message} color={t.textTertiary} onRetry={onRetry} />
        ) : null}

        {/* Timestamp + copy for assistant messages */}
        <View style={styles.meta}>
          <Text
            style={[
              styles.time,
              { color: isUser ? "rgba(255,255,255,0.6)" : t.textTertiary },
            ]}
          >
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
          {!isUser && (
            <TouchableOpacity
              onPress={handleCopy}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.copyBtn}
            >
              {copied ? (
                <Check size={14} color={t.success} />
              ) : (
                <Copy size={14} color={t.textTertiary} />
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    marginBottom: spacing.sm,
  },
  bubble: {
    maxWidth: "85%",
    padding: spacing.sm + 2,
    borderRadius: 16,
  },
  // Heading styles
  h1: {
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 26,
    marginTop: 4,
    marginBottom: 2,
  },
  h2: {
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 24,
    marginTop: 4,
    marginBottom: 2,
  },
  h3: {
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 22,
    marginTop: 2,
    marginBottom: 1,
  },
  // Bullet list
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 2,
  },
  bulletDot: {
    marginRight: 6,
    marginTop: 0,
  },
  bulletText: {
    flex: 1,
  },
  // Blockquote
  blockquote: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    marginVertical: 4,
  },
  blockquoteUser: {
    borderLeftColor: "rgba(255,255,255,0.5)",
  },
  blockquoteAI: {
    borderLeftColor: "#9333EA",
  },
  blockquoteText: {
    fontStyle: "italic",
    opacity: 0.85,
  },
  // Inline code
  inlineCode: {
    fontFamily: "monospace",
    backgroundColor: "rgba(0,0,0,0.08)",
    borderRadius: 3,
    paddingHorizontal: 3,
    fontSize: 13,
  },
  // Divider
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
  // Empty line spacing
  emptyLine: {
    height: 6,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    gap: 8,
  },
  time: {
    fontSize: 11,
  },
  copyBtn: {
    padding: 2,
  },
  structuredWrap: {
    width: "100%",
    maxWidth: "100%",
  },
  notes: {
    marginTop: 6,
    gap: 2,
  },
  notice: {
    fontSize: 12,
    fontStyle: "italic",
  },
  interruptedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  retryText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#9333EA",
  },
  typingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 2,
  },
});

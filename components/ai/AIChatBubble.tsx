// ============================================
// AI Chat Bubble – renders a single message with markdown support
// ============================================

import { spacing } from "@/constants/theme";
import { useTheme } from "@/services/ThemeProvider";
import { copyToClipboard } from "@/services/ai/ai.service";
import type {
  AIAction,
  AIChatMessage,
  ChallengerRole,
  HighlightItem,
} from "@/services/ai/ai.types";
import { Check, Copy } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { StructuredMessageRenderer } from "./renderers/StructuredMessageRenderer";

interface Props {
  message: AIChatMessage;
  action?: AIAction;
  documentName?: string;
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

export const AIChatBubble = React.memo(function AIChatBubble({
  message,
  action,
  documentName,
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
    const ok = await copyToClipboard(message.content);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [message.content]);

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
        <MarkdownContent
          text={message.content}
          textColor={textColor}
          isUser={isUser}
        />

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
});

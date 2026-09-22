// ============================================
// MarkdownText — renders the contract-v2 Markdown subset (C9)
// ---------------------------------------------
// Supported: ## / ### headings, **bold**, *italic*, `inline code`, bullet and
// numbered lists (one nesting level), > quotes, simple pipe tables, and
// citation markers [n] rendered as tappable chips.
//
// Anything else — HTML, code fences, images, deeper nesting, an unclosed **,
// a ragged table — renders as literal text. Parsing never throws; the tokens
// are computed once per text change. Text is selectable and follows Dynamic
// Type.
// ============================================

import React, { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View, type TextStyle } from "react-native";

import type { AICitation } from "@/services/ai/citations";
import { useTheme } from "@/services/ThemeProvider";

// ─── Tokens ──────────────────────────────────────────────────────────────────

export type MdInline =
  | { type: "text"; text: string }
  | { type: "bold"; children: MdInline[] }
  | { type: "italic"; children: MdInline[] }
  | { type: "code"; text: string }
  | { type: "citation"; id: number };

export interface MdListItem {
  inline: MdInline[];
  marker: string;
  children: MdListItem[];
}

export type MdBlock =
  | { type: "heading"; level: 2 | 3; inline: MdInline[] }
  | { type: "paragraph"; lines: MdInline[][] }
  | { type: "list"; ordered: boolean; items: MdListItem[] }
  | { type: "quote"; lines: MdInline[][] }
  | { type: "table"; header: MdInline[][]; rows: MdInline[][][] }
  | { type: "divider" };

// ─── Inline parser ───────────────────────────────────────────────────────────

function pushText(out: MdInline[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.type === "text") last.text += text;
  else out.push({ type: "text", text });
}

/** Parse inline Markdown. Unbalanced markers stay literal. */
export function parseInline(src: string, depth = 0): MdInline[] {
  const out: MdInline[] = [];
  const s = typeof src === "string" ? src : "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];

    if (c === "\\" && i + 1 < s.length && "*`[]\\_".includes(s[i + 1])) {
      pushText(out, s[i + 1]);
      i += 2;
      continue;
    }

    if (c === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i + 1) {
        out.push({ type: "code", text: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
      pushText(out, c);
      i++;
      continue;
    }

    if (c === "[") {
      const m = /^\[(\d{1,3})\]/.exec(s.slice(i, i + 5));
      if (m) {
        out.push({ type: "citation", id: Number(m[1]) });
        i += m[0].length;
        continue;
      }
      pushText(out, c);
      i++;
      continue;
    }

    if (c === "*" && s[i + 1] === "*" && depth < 2) {
      const end = s.indexOf("**", i + 2);
      if (end > i + 2 && s[i + 2] !== " " && s[end - 1] !== " ") {
        out.push({ type: "bold", children: parseInline(s.slice(i + 2, end), depth + 1) });
        i = end + 2;
        continue;
      }
      pushText(out, "**");
      i += 2;
      continue;
    }

    if (c === "*" && depth < 2) {
      const next = s[i + 1];
      if (next && next !== " " && next !== "*") {
        let end = -1;
        for (let j = i + 1; j < s.length; j++) {
          if (s[j] === "*" && s[j + 1] !== "*" && s[j - 1] !== " " && s[j - 1] !== "*") {
            end = j;
            break;
          }
        }
        if (end > i + 1) {
          out.push({ type: "italic", children: parseInline(s.slice(i + 1, end), depth + 1) });
          i = end + 1;
          continue;
        }
      }
      pushText(out, c);
      i++;
      continue;
    }

    // Plain run up to the next special character.
    let j = i + 1;
    while (j < s.length && !"\\`[*".includes(s[j])) j++;
    pushText(out, s.slice(i, j));
    i = j;
  }
  return out;
}

// ─── Block parser ────────────────────────────────────────────────────────────

const BULLET_RE = /^(\s*)([-*+•])\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((cell) => cell.trim());
}

function isTableRow(line: string | undefined): boolean {
  return !!line && line.includes("|") && line.trim().length > 1;
}

/** Parse text into blocks. Never throws (falls back to one literal paragraph). */
export function parseMarkdown(text: string): MdBlock[] {
  try {
    return parseBlocks(typeof text === "string" ? text : "");
  } catch {
    return [{ type: "paragraph", lines: [[{ type: "text", text: String(text ?? "") }]] }];
  }
}

function parseBlocks(text: string): MdBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Headings (# is promoted to ##, #### and deeper render as ###).
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length <= 2 ? 2 : 3;
      blocks.push({ type: "heading", level, inline: parseInline(heading[2]) });
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "divider" });
      i++;
      continue;
    }

    // Tables: a header row followed by a separator row.
    if (isTableRow(line) && TABLE_SEP_RE.test(lines[i + 1] ?? "") && (lines[i + 1] ?? "").includes("-")) {
      const header = splitRow(line);
      const width = header.length;
      const rows: MdInline[][][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i]) && lines[i].trim()) {
        const cells = splitRow(lines[i]);
        const normalized: string[] = [];
        for (let k = 0; k < width; k++) normalized.push(cells[k] ?? "");
        if (cells.length > width) {
          normalized[width - 1] = [normalized[width - 1], ...cells.slice(width)].join(" | ");
        }
        rows.push(normalized.map((cell) => parseInline(cell)));
        i++;
      }
      blocks.push({ type: "table", header: header.map((h) => parseInline(h)), rows });
      continue;
    }

    // Quotes.
    if (/^\s*>/.test(line)) {
      const quoteLines: MdInline[][] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoteLines.push(parseInline(lines[i].replace(/^\s*>\s?/, "")));
        i++;
      }
      blocks.push({ type: "quote", lines: quoteLines });
      continue;
    }

    // Lists.
    const firstBullet = BULLET_RE.exec(line);
    const firstOrdered = ORDERED_RE.exec(line);
    if (firstBullet || firstOrdered) {
      const ordered = !firstBullet && !!firstOrdered;
      const baseIndent = (firstBullet ?? firstOrdered)![1].length;
      const items: MdListItem[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          // A blank line ends the list unless the next line continues it
          // with an item of the same kind (bullets vs numbers).
          const next = lines[i + 1];
          const nextSameKind = next && (ordered ? ORDERED_RE.test(next) : BULLET_RE.test(next));
          if (nextSameKind) {
            i++;
            continue;
          }
          break;
        }
        const b = BULLET_RE.exec(l);
        const o = ORDERED_RE.exec(l);
        const m = b ?? o;
        if (m) {
          const indent = m[1].length;
          const nested = indent >= baseIndent + 2 && items.length > 0;
          // A top-level item of the other kind starts a new list.
          if (!nested && (ordered ? !!b : !b)) break;
          const marker = b ? "•" : `${m[2]}.`;
          const item: MdListItem = { inline: parseInline(m[3]), marker, children: [] };
          if (nested) {
            items[items.length - 1].children.push(item); // one nesting level
          } else {
            items.push(item);
          }
          i++;
          continue;
        }
        if (/^\s{2,}\S/.test(l) && items.length > 0) {
          // Continuation line of the previous item.
          const target = items[items.length - 1];
          const holder = target.children.length ? target.children[target.children.length - 1] : target;
          holder.inline.push({ type: "text", text: "\n" }, ...parseInline(l.trim()));
          i++;
          continue;
        }
        break;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Paragraph: consecutive plain lines (line breaks kept).
    const paraLines: MdInline[][] = [];
    while (i < lines.length) {
      const l = lines[i];
      const t = l.trim();
      if (
        !t ||
        /^#{1,6}\s+/.test(t) ||
        /^\s*>/.test(l) ||
        BULLET_RE.test(l) ||
        ORDERED_RE.test(l) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(t) ||
        (isTableRow(l) && TABLE_SEP_RE.test(lines[i + 1] ?? "") && (lines[i + 1] ?? "").includes("-"))
      ) {
        break;
      }
      paraLines.push(parseInline(l));
      i++;
    }
    if (paraLines.length) blocks.push({ type: "paragraph", lines: paraLines });
    else i++; // safety: never loop forever
  }
  return blocks;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

export interface MarkdownTextProps {
  text: string;
  /** Base text color (defaults to the theme text color). */
  color?: string;
  fontSize?: number;
  lineHeight?: number;
  /** Accent for chips and quote bars. */
  accentColor?: string;
  citations?: AICitation[];
  onCitationPress?: (citation: AICitation) => void;
  selectable?: boolean;
  testID?: string;
}

interface RenderCtx {
  color: string;
  accent: string;
  codeBg: string;
  fontSize: number;
  lineHeight: number;
  citations: Map<number, AICitation>;
  onCitationPress?: (citation: AICitation) => void;
  chipBg: string;
  selectable: boolean;
}

function renderInline(nodes: MdInline[], ctx: RenderCtx, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  nodes.forEach((node, idx) => {
    const key = `${keyPrefix}-${idx}`;
    switch (node.type) {
      case "text":
        out.push(node.text);
        break;
      case "bold":
        out.push(
          <Text key={key} style={styles.bold}>
            {renderInline(node.children, ctx, key)}
          </Text>,
        );
        break;
      case "italic":
        out.push(
          <Text key={key} style={styles.italic}>
            {renderInline(node.children, ctx, key)}
          </Text>,
        );
        break;
      case "code":
        out.push(
          <Text key={key} style={[styles.code, { backgroundColor: ctx.codeBg, fontSize: ctx.fontSize - 1 }]}>
            {node.text}
          </Text>,
        );
        break;
      case "citation": {
        const citation = ctx.citations.get(node.id);
        if (!citation) break; // a marker with no citation is removed
        const label = citation.locator?.label ?? `Page ${citation.page}`;
        out.push(
          <Text
            key={key}
            onPress={ctx.onCitationPress ? () => ctx.onCitationPress?.(citation) : undefined}
            suppressHighlighting={false}
            accessibilityRole="button"
            accessibilityLabel={`Source ${node.id}, ${label}`}
            style={[
              styles.chip,
              { color: ctx.accent, backgroundColor: ctx.chipBg, fontSize: Math.max(10, ctx.fontSize - 3) },
            ]}
          >
            {` ${node.id} `}
          </Text>,
        );
        break;
      }
    }
  });
  return out;
}

function ListView({ items, ordered, ctx, keyPrefix, nested }: {
  items: MdListItem[];
  ordered: boolean;
  ctx: RenderCtx;
  keyPrefix: string;
  nested?: boolean;
}) {
  const textStyle: TextStyle = { color: ctx.color, fontSize: ctx.fontSize, lineHeight: ctx.lineHeight };
  return (
    <View style={nested ? styles.nestedList : styles.list}>
      {items.map((item, idx) => (
        <View key={`${keyPrefix}-${idx}`}>
          <View style={styles.listRow}>
            <Text allowFontScaling style={[textStyle, styles.listMarker, ordered && styles.listMarkerOrdered]}>
              {ordered ? item.marker : nested ? "◦" : "•"}
            </Text>
            <Text allowFontScaling selectable={ctx.selectable} style={[textStyle, styles.flex]}>
              {renderInline(item.inline, ctx, `${keyPrefix}-${idx}`)}
            </Text>
          </View>
          {item.children.length > 0 && (
            <ListView
              items={item.children}
              ordered={/^\d/.test(item.children[0].marker)}
              ctx={ctx}
              keyPrefix={`${keyPrefix}-${idx}-c`}
              nested
            />
          )}
        </View>
      ))}
    </View>
  );
}

function MarkdownTextImpl({
  text,
  color,
  fontSize = 14,
  lineHeight,
  accentColor,
  citations,
  onCitationPress,
  selectable = true,
  testID,
}: MarkdownTextProps) {
  const { colors: t, mode } = useTheme();
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const citationMap = useMemo(() => {
    const m = new Map<number, AICitation>();
    for (const c of citations ?? []) m.set(c.id, c);
    return m;
  }, [citations]);

  const baseColor = color ?? t.text;
  const accent = accentColor ?? t.primary;
  const lh = lineHeight ?? Math.round(fontSize * 1.5);
  const ctx: RenderCtx = {
    color: baseColor,
    accent,
    codeBg: mode === "dark" ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)",
    fontSize,
    lineHeight: lh,
    citations: citationMap,
    onCitationPress,
    chipBg: mode === "dark" ? "rgba(147,51,234,0.28)" : "rgba(147,51,234,0.12)",
    selectable,
  };
  const textStyle: TextStyle = { color: baseColor, fontSize, lineHeight: lh };
  const borderColor = mode === "dark" ? "#334155" : "#E2E8F0";

  return (
    <View testID={testID}>
      {blocks.map((block, bi) => {
        const key = `b${bi}`;
        switch (block.type) {
          case "heading":
            return (
              <Text
                key={key}
                allowFontScaling
                selectable={selectable}
                accessibilityRole="header"
                style={[
                  textStyle,
                  block.level === 2 ? styles.h2 : styles.h3,
                  { fontSize: block.level === 2 ? fontSize + 3 : fontSize + 1, lineHeight: Math.round((block.level === 2 ? fontSize + 3 : fontSize + 1) * 1.4) },
                  bi > 0 && styles.blockGap,
                ]}
              >
                {renderInline(block.inline, ctx, key)}
              </Text>
            );
          case "paragraph":
            return (
              <Text key={key} allowFontScaling selectable={selectable} style={[textStyle, bi > 0 && styles.blockGap]}>
                {block.lines.map((lineNodes, li) => (
                  <React.Fragment key={`${key}-l${li}`}>
                    {li > 0 ? "\n" : null}
                    {renderInline(lineNodes, ctx, `${key}-l${li}`)}
                  </React.Fragment>
                ))}
              </Text>
            );
          case "list":
            return (
              <View key={key} style={bi > 0 && styles.blockGap}>
                <ListView items={block.items} ordered={block.ordered} ctx={ctx} keyPrefix={key} />
              </View>
            );
          case "quote":
            return (
              <View key={key} style={[styles.quote, { borderLeftColor: accent }, bi > 0 && styles.blockGap]}>
                <Text allowFontScaling selectable={selectable} style={[textStyle, styles.quoteText]}>
                  {block.lines.map((lineNodes, li) => (
                    <React.Fragment key={`${key}-q${li}`}>
                      {li > 0 ? "\n" : null}
                      {renderInline(lineNodes, ctx, `${key}-q${li}`)}
                    </React.Fragment>
                  ))}
                </Text>
              </View>
            );
          case "table":
            return (
              <ScrollView
                key={key}
                horizontal
                showsHorizontalScrollIndicator
                style={[styles.tableScroll, bi > 0 && styles.blockGap]}
                accessibilityLabel="Table"
              >
                <View style={[styles.table, { borderColor }]}>
                  <View style={[styles.tableRow, { backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9", borderColor }]}>
                    {block.header.map((cell, ci) => (
                      <View key={`${key}-h${ci}`} style={[styles.tableCell, { borderColor }]}>
                        <Text allowFontScaling selectable={selectable} style={[textStyle, styles.bold]}>
                          {renderInline(cell, ctx, `${key}-h${ci}`)}
                        </Text>
                      </View>
                    ))}
                  </View>
                  {block.rows.map((row, ri) => (
                    <View key={`${key}-r${ri}`} style={[styles.tableRow, { borderColor }]}>
                      {row.map((cell, ci) => (
                        <View key={`${key}-r${ri}-c${ci}`} style={[styles.tableCell, { borderColor }]}>
                          <Text allowFontScaling selectable={selectable} style={textStyle}>
                            {renderInline(cell, ctx, `${key}-r${ri}-c${ci}`)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            );
          case "divider":
            return <View key={key} style={[styles.divider, { borderBottomColor: borderColor }]} />;
          default:
            return null;
        }
      })}
    </View>
  );
}

export const MarkdownText = React.memo(MarkdownTextImpl);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  code: { fontFamily: "monospace" },
  chip: { fontWeight: "700" },
  h2: { fontWeight: "700" },
  h3: { fontWeight: "600" },
  blockGap: { marginTop: 8 },
  list: { gap: 2 },
  nestedList: { marginLeft: 16, marginTop: 2, gap: 2 },
  listRow: { flexDirection: "row", alignItems: "flex-start" },
  listMarker: { width: 16 },
  listMarkerOrdered: { width: 24 },
  quote: { borderLeftWidth: 3, paddingLeft: 10 },
  quoteText: { fontStyle: "italic", opacity: 0.9 },
  tableScroll: { flexGrow: 0 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, overflow: "hidden" },
  tableRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  tableCell: {
    minWidth: 96,
    maxWidth: 240,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, marginVertical: 8 },
});

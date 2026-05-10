/**
 * ai-generated-preview.tsx
 *
 * Shows a preview of AI-generated document content before creating the actual
 * file. Supports PDF, DOCX, and PPTX output. The user can edit the title, then
 * press "Save File" to build the file and register it in the app's file index.
 *
 * Data flow: ai.tsx → setPendingGeneration() → [navigate here] → save → library
 */

import { useTheme } from "@/services/ThemeProvider";
import {
  clearPendingGeneration,
  getPendingGeneration,
} from "@/services/generatedDocStore";
import { markFileAsCreated } from "@/services/fileService";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  BookOpen,
  Check,
  Eye,
  FileText,
  FolderOpen,
  Pencil,
  ScanSearch,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ─── Colours ─────────────────────────────────────────────────────────────────
const ACCENT = "#7C3AED";
const FORMAT_COLOR: Record<string, string> = {
  pdf: "#DC2626",
  docx: "#2563EB",
  ppt: "#EA580C",
};
const FORMAT_LABEL: Record<string, string> = {
  pdf: "PDF",
  docx: "DOCX",
  ppt: "PPTX",
};

// ─── Slide type ───────────────────────────────────────────────────────────────
interface Slide {
  title: string;
  bullets: string[];
  subtitle?: string;
}

// ─── Markdown helpers ─────────────────────────────────────────────────────────
function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inlineMd(line: string): string {
  return line
    .replace(/\*\*(.+?)\*\*/g, (_, t) => `<strong>${escHtml(t)}</strong>`)
    .replace(/\*(.+?)\*/g, (_, t) => `<em>${escHtml(t)}</em>`)
    .replace(/__(.+?)__/g, (_, t) => `<strong>${escHtml(t)}</strong>`)
    .replace(/_(.+?)_/g, (_, t) => `<em>${escHtml(t)}</em>`)
    .replace(/`(.+?)`/g, (_, t) => `<code>${escHtml(t)}</code>`);
}

function contentToHtml(content: string, title: string): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  const closeList = () => {
    if (inUl) { out.push("</ul>"); inUl = false; }
    if (inOl) { out.push("</ol>"); inOl = false; }
  };
  for (const raw of lines) {
    const t = raw.trim();
    if (/^#{1,6}\s/.test(t)) {
      closeList();
      const level = (t.match(/^#+/) || [""])[0].length;
      out.push(`<h${level}>${inlineMd(t.replace(/^#+\s*/, ""))}</h${level}>`);
    } else if (/^[-*+]\s/.test(t)) {
      if (inOl) { out.push("</ol>"); inOl = false; }
      if (!inUl) { out.push("<ul>"); inUl = true; }
      out.push(`<li>${inlineMd(t.replace(/^[-*+]\s+/, ""))}</li>`);
    } else if (/^\d+\.\s/.test(t)) {
      if (inUl) { out.push("</ul>"); inUl = false; }
      if (!inOl) { out.push("<ol>"); inOl = true; }
      out.push(`<li>${inlineMd(t.replace(/^\d+\.\s+/, ""))}</li>`);
    } else if (/^[-*_]{3,}$/.test(t)) {
      closeList(); out.push("<hr>");
    } else if (!t) {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inlineMd(t)}</p>`);
    }
  }
  closeList();
  return `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           padding:56px 52px; line-height:1.75; color:#1a1a2e; font-size:15px; }
    h1 { font-size:30px; font-weight:800; color:#0f0f23; margin:0 0 20px; letter-spacing:-0.5px; }
    h2 { font-size:22px; font-weight:700; color:#1e293b; margin:28px 0 10px;
         padding-bottom:6px; border-bottom:2.5px solid #7c3aed33; }
    h3 { font-size:18px; font-weight:700; color:#334155; margin:20px 0 8px; }
    h4 { font-size:15px; font-weight:700; color:#475569; margin:14px 0 6px; }
    p  { margin-bottom:13px; color:#334155; }
    ul, ol { margin:8px 0 12px 22px; }
    li { margin-bottom:6px; color:#374151; }
    strong { color:#1e293b; font-weight:700; }
    em { color:#4b5563; }
    code { background:#f1f5f9; padding:2px 5px; border-radius:4px;
           font-family:monospace; font-size:13px; }
    hr { border:none; border-top:1px solid #e2e8f0; margin:18px 0; }
  </style>
</head>
<body>
  <h1>${escHtml(title)}</h1>
  ${out.join("\n")}
</body></html>`;
}

// ─── Slide parser ─────────────────────────────────────────────────────────────
function parseSlidesFromContent(docTitle: string, content: string): Slide[] {
  const slideMarkerRe = /^##\s+SLIDE\s+\d+\s*:?\s*/im;
  if (slideMarkerRe.test(content)) {
    const raw = content.split(/^##\s+SLIDE\s+\d+\s*:?\s*/im);
    // raw[0] is preamble before SLIDE 1
    const titleSlide: Slide = { title: docTitle, bullets: [] };
    const slides: Slide[] = [titleSlide];
    // start at index 1 — each entry starts with the slide title line
    for (let i = 1; i < raw.length; i++) {
      const part = raw[i].trim();
      const lines = part.split("\n");
      const title = lines[0]?.replace(/^#+\s*/, "").trim() || `Slide ${i}`;
      const bullets = lines
        .slice(1)
        .filter((l) => /^[-*+]\s/.test(l.trim()))
        .map((l) => l.trim().replace(/^[-*+]\s+/, "").trim())
        .filter(Boolean)
        .slice(0, 7);
      slides.push({ title, bullets });
    }
    return slides.slice(0, 25);
  }
  // Fallback: split on ## headings
  const slides: Slide[] = [{ title: docTitle, bullets: [] }];
  let cur: Slide | null = null;
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (/^##\s+/.test(t)) {
      if (cur) slides.push(cur);
      cur = { title: t.replace(/^#+\s+/, ""), bullets: [] };
    } else if (cur && /^[-*+]\s/.test(t)) {
      cur.bullets.push(t.replace(/^[-*+]\s+/, "").slice(0, 120));
    }
  }
  if (cur) slides.push(cur);
  return slides.slice(0, 20).map((s) => ({ ...s, bullets: s.bullets.slice(0, 7) }));
}

// ─── Section type for doc preview ────────────────────────────────────────────
interface DocSection {
  type: "h1" | "h2" | "h3" | "paragraph" | "bullets" | "divider";
  text?: string;
  items?: string[];
}

function sectionsToContent(secs: DocSection[]): string {
  const parts: string[] = [];
  for (const sec of secs) {
    switch (sec.type) {
      case "h1": parts.push(`# ${sec.text ?? ""}`); break;
      case "h2": parts.push(`## ${sec.text ?? ""}`); break;
      case "h3": parts.push(`### ${sec.text ?? ""}`); break;
      case "paragraph": parts.push(sec.text ?? ""); break;
      case "bullets":
        parts.push((sec.items ?? []).map((item) => `- ${item}`).join("\n"));
        break;
      case "divider": parts.push("---"); break;
    }
  }
  return parts.join("\n\n");
}

function parseDocSections(content: string): DocSection[] {
  const sections: DocSection[] = [];
  let bulletBuf: string[] = [];
  const flushBullets = () => {
    if (bulletBuf.length) {
      sections.push({ type: "bullets", items: [...bulletBuf] });
      bulletBuf = [];
    }
  };
  for (const raw of content.split("\n")) {
    const t = raw.trim();
    if (!t) { flushBullets(); continue; }
    if (/^#{1}\s/.test(t) && !t.startsWith("##")) {
      flushBullets(); sections.push({ type: "h1", text: t.replace(/^#+\s+/, "") });
    } else if (/^##\s/.test(t) && !t.startsWith("###")) {
      flushBullets(); sections.push({ type: "h2", text: t.replace(/^#+\s+/, "") });
    } else if (/^###\s/.test(t)) {
      flushBullets(); sections.push({ type: "h3", text: t.replace(/^#+\s+/, "") });
    } else if (/^[-*+]\s/.test(t)) {
      bulletBuf.push(t.replace(/^[-*+]\s+/, ""));
    } else if (/^[-*_]{3,}$/.test(t)) {
      flushBullets(); sections.push({ type: "divider" });
    } else {
      flushBullets(); sections.push({ type: "paragraph", text: t });
    }
  }
  flushBullets();
  return sections;
}

// ─── File creation helpers ────────────────────────────────────────────────────

async function buildPdfFile(
  title: string,
  content: string,
): Promise<{ uri: string; fileName: string }> {
  const Print = await import("expo-print");
  const html = contentToHtml(content, title);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const safeTitle = title.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 60);
  const fileName = `${safeTitle}_${Date.now()}.pdf`;
  return { uri, fileName };
}

async function buildDocxFile(
  title: string,
  content: string,
): Promise<{ uri: string; fileName: string }> {
  const { saveDocxFromHtml } = await import("@/utils/docxGenerator");
  const htmlBody = contentToHtml(content, title);
  const safeTitle = title.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 60);
  const saved = await saveDocxFromHtml({
    html: htmlBody,
    title,
    fileName: `${safeTitle}_${Date.now()}`,
  });
  if (!saved.success || !saved.uri) throw new Error(saved.error ?? "Failed to create DOCX");
  const fileName = `${title}.docx`;
  return { uri: saved.uri, fileName };
}

async function buildPptxFile(
  title: string,
  content: string,
): Promise<{ uri: string; fileName: string }> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";

  const slides = parseSlidesFromContent(title, content);
  slides.forEach((slide, i) => {
    const s = pptx.addSlide();
    const isTitle = i === 0;
    s.background = { color: isTitle ? "1E1B4B" : "FFFFFF" };

    // Slide title
    s.addText(slide.title, {
      x: 0.5,
      y: isTitle ? 2.6 : 0.35,
      w: 12.3,
      h: 1.2,
      fontSize: isTitle ? 40 : 28,
      bold: true,
      color: isTitle ? "FFFFFF" : "1E293B",
      fontFace: "Calibri",
      align: isTitle ? "center" : "left",
    });

    if (isTitle) {
      // Subtitle / category on title slide
      s.addText(title, {
        x: 0.5, y: 4.1, w: 12.3, h: 0.7,
        fontSize: 16, color: "A5B4FC", fontFace: "Calibri", align: "center",
      });
    }

    if (!isTitle && slide.bullets.length > 0) {
      s.addText(
        slide.bullets.map((b) => ({ text: b, options: { bullet: true, paraSpaceAfter: 5 } })),
        {
          x: 0.5, y: 1.95, w: 12.3, h: 4.8,
          fontSize: 18, color: "374151", fontFace: "Calibri",
        },
      );
    }

    // Slide number (non-title slides)
    if (!isTitle) {
      s.addText(`${i}`, {
        x: 12.5, y: 7.0, w: 0.5, h: 0.3,
        fontSize: 9, color: "94A3B8", align: "right",
      });
    }
  });

  const base64 = (await pptx.write({ outputType: "base64" })) as string;
  const safeTitle = title.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 60);
  const fileName = `${safeTitle}_${Date.now()}.pptx`;
  const uri = `${FileSystem.documentDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return { uri, fileName };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function AIGeneratedPreviewScreen() {
  const router = useRouter();
  const { colors: t, mode } = useTheme();
  const isDark = mode === "dark";

  const data = useMemo(() => getPendingGeneration(), []);
  const [title, setTitle] = useState(data?.title ?? "Generated Document");
  const [content, setContent] = useState(data?.content ?? "");
  const [editMode, setEditMode] = useState(false);
  const [editingSectionIdx, setEditingSectionIdx] = useState<number | null>(null);
  const [editingSectionDraft, setEditingSectionDraft] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [savedUri, setSavedUri] = useState<string | null>(null);
  const [savedType, setSavedType] = useState<"pdf" | "docx" | "pptx">("pdf");

  const fileType = data?.fileType ?? "pdf";
  const fmtColor = FORMAT_COLOR[fileType] ?? ACCENT;
  const fmtLabel = FORMAT_LABEL[fileType] ?? "FILE";

  // Safety: if no pending data, go back
  useEffect(() => {
    if (!data) router.replace("/(tabs)" as any);
  }, [data]);

  // Slides (PPTX only) — computed once
  const slides = useMemo(
    () => (fileType === "ppt" ? parseSlidesFromContent(title, content) : []),
    [fileType, content, title],
  );

  // Doc sections (PDF/DOCX) — computed once
  const sections = useMemo(
    () => (fileType !== "ppt" ? parseDocSections(content) : []),
    [fileType, content],
  );

  const handleSave = useCallback(async () => {
    if (state !== "idle" || !content) return;
    setState("saving");
    try {
      const trimTitle = title.trim() || "Generated Document";
      let uri: string;
      let fileName: string;
      let fileTypeForIndex: "pdf" | "docx" | "pptx";

      if (fileType === "pdf") {
        ({ uri, fileName } = await buildPdfFile(trimTitle, content));
        fileTypeForIndex = "pdf";
      } else if (fileType === "docx") {
        ({ uri, fileName } = await buildDocxFile(trimTitle, content));
        fileTypeForIndex = "docx";
      } else {
        // ppt → pptx
        ({ uri, fileName } = await buildPptxFile(trimTitle, content));
        fileTypeForIndex = "pptx";
      }

      await markFileAsCreated(uri, fileName, fileTypeForIndex);
      clearPendingGeneration();
      setSavedUri(uri);
      setSavedType(fileTypeForIndex);
      setState("saved");
    } catch (e: any) {
      setState("idle");
      Alert.alert(
        "Save Failed",
        e?.message || "Could not create the file. Please try again.",
      );
    }
  }, [state, content, title, fileType]);

  const handleOpen = useCallback(() => {
    if (!savedUri) return;
    const ext = savedType;
    const name = title.trim() || "Generated Document";
    const viewerMap: Record<string, string> = {
      pdf: "/pdf-viewer",
      docx: "/docx-viewer",
      pptx: "/ppt-viewer",
    };
    const viewer = viewerMap[ext] ?? "/pdf-viewer";
    router.replace({
      pathname: viewer as any,
      params: { uri: savedUri, name: `${name}.${ext}` },
    });
  }, [savedUri, savedType, title, router]);

  const handleDiscard = useCallback(() => {
    clearPendingGeneration();
    router.back();
  }, [router]);

  const commitSectionEdit = useCallback(() => {
    if (editingSectionIdx === null) return;
    const sec = sections[editingSectionIdx];
    if (!sec) { setEditingSectionIdx(null); return; }
    const updated = sections.map((s, i) => {
      if (i !== editingSectionIdx) return s;
      if (s.type === "bullets") {
        const items = editingSectionDraft
          .split("\n")
          .map((l) => l.trim().replace(/^[-*+•]\s*/, ""))
          .filter(Boolean);
        return { ...s, items };
      }
      return { ...s, text: editingSectionDraft };
    });
    setContent(sectionsToContent(updated));
    setEditingSectionIdx(null);
  }, [editingSectionIdx, editingSectionDraft, sections]);

  const surface = isDark ? "#1E293B" : "#FFFFFF";
  const border = isDark ? "#334155" : "#E2E8F0";
  const bg = isDark ? "#0F172A" : "#F1F5F9";

  if (!data) return null;

  // ── Success screen ────────────────────────────────────────────────────────
  if (state === "saved") {
    const FmtIcon = fileType === "pdf" ? ScanSearch : fileType === "docx" ? FileText : BookOpen;
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
        <View style={styles.successWrap}>
          <View style={[styles.successIconWrap, { backgroundColor: `${fmtColor}18` }]}>
            <FmtIcon size={48} color={fmtColor} strokeWidth={1.8} />
          </View>
          <Text style={[styles.successTitle, { color: isDark ? "#F1F5F9" : "#0F172A" }]}>
            File Saved!
          </Text>
          <Text style={[styles.successSub, { color: isDark ? "#94A3B8" : "#64748B" }]}>
            {title.trim()} has been added to your library.
          </Text>
          <View style={[styles.successBadge, { backgroundColor: `${fmtColor}18`, borderColor: `${fmtColor}44` }]}>
            <Check size={13} color={fmtColor} strokeWidth={2.5} />
            <Text style={[styles.successBadgeText, { color: fmtColor }]}>
              Saved as {fmtLabel}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.successBtn, { backgroundColor: fmtColor }]}
            onPress={handleOpen}
            activeOpacity={0.85}
          >
            <FolderOpen size={17} color="#FFF" strokeWidth={2} />
            <Text style={styles.successBtnText}>Open File</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.successGhost, { borderColor: border }]}
            onPress={() => { clearPendingGeneration(); router.replace("/(tabs)" as any); }}
            activeOpacity={0.7}
          >
            <Text style={[styles.successGhostText, { color: isDark ? "#94A3B8" : "#64748B" }]}>
              Go to Library
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main preview screen ───────────────────────────────────────────────────
  const FmtIcon = fileType === "pdf" ? ScanSearch : fileType === "docx" ? FileText : BookOpen;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: t.card, borderBottomColor: t.border }]}>
        <Pressable onPress={handleDiscard} style={styles.backBtn}>
          <ArrowLeft size={24} color={t.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: t.text }]}>Preview Document</Text>
        <Pressable onPress={() => setEditMode((e) => !e)} style={styles.editBtn}>
          {editMode
            ? <Eye size={20} color={ACCENT} strokeWidth={2} />
            : <Pencil size={18} color={t.text} strokeWidth={2} />}
        </Pressable>
      </View>

      {/* Title editor */}
      <View style={[styles.titleBar, { backgroundColor: isDark ? "#0F172A" : "#F8FAFC", borderBottomColor: border }]}>
        <View style={[styles.fmtBadge, { backgroundColor: `${fmtColor}18`, borderColor: `${fmtColor}44` }]}>
          <FmtIcon size={11} color={fmtColor} strokeWidth={2} />
          <Text style={[styles.fmtBadgeText, { color: fmtColor }]}>{fmtLabel}</Text>
        </View>
        <TextInput
          style={[styles.titleInput, { color: isDark ? "#F1F5F9" : "#0F172A" }]}
          value={title}
          onChangeText={setTitle}
          placeholder="Document title…"
          placeholderTextColor={isDark ? "#475569" : "#94A3B8"}
          returnKeyType="done"
        />
      </View>

      {/* Inline-edit hint (PDF/DOCX only, not when raw editor is open) */}
      {fileType !== "ppt" && !editMode && (
        <View style={[styles.editHintBanner, { backgroundColor: `${fmtColor}0D`, borderBottomColor: border }]}>
          <Pencil size={11} color={fmtColor} strokeWidth={2.5} />
          <Text style={[styles.editHintText, { color: fmtColor }]}>Tap any section to edit</Text>
        </View>
      )}

      {/* Preview content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {editMode ? (
          <TextInput
            style={[styles.editInput, {
              color: isDark ? "#F1F5F9" : "#0F172A",
              backgroundColor: surface,
              borderColor: border,
            }]}
            value={content}
            onChangeText={setContent}
            multiline
            textAlignVertical="top"
            placeholder="Edit document content (Markdown)…"
            placeholderTextColor={isDark ? "#475569" : "#94A3B8"}
            scrollEnabled={false}
          />
        ) : fileType === "ppt" ? (
          // PPTX: render slide cards
          <View style={styles.slideList}>
            {slides.map((slide, i) => (
              <View
                key={i}
                style={[
                  styles.slideCard,
                  {
                    backgroundColor: i === 0 ? "#1E1B4B" : surface,
                    borderColor: i === 0 ? "#4C1D95" : border,
                  },
                ]}
              >
                <View style={styles.slideTopRow}>
                  <View style={[styles.slideNumBadge, { backgroundColor: `${fmtColor}22` }]}>
                    <Text style={[styles.slideNumText, { color: fmtColor }]}>
                      {i === 0 ? "TITLE" : `SLIDE ${i}`}
                    </Text>
                  </View>
                </View>
                <Text
                  style={[
                    styles.slideTitle,
                    { color: i === 0 ? "#FFFFFF" : (isDark ? "#F1F5F9" : "#0F172A") },
                  ]}
                  numberOfLines={3}
                >
                  {slide.title}
                </Text>
                {slide.bullets.length > 0 && (
                  <View style={[styles.slideDivider, { backgroundColor: i === 0 ? "#4C1D95" : `${fmtColor}44` }]} />
                )}
                {slide.bullets.map((b, bi) => (
                  <View key={bi} style={styles.slideBulletRow}>
                    <View style={[styles.slideBulletDot, { backgroundColor: i === 0 ? "#A5B4FC" : fmtColor }]} />
                    <Text
                      style={[
                        styles.slideBullet,
                        { color: i === 0 ? "#C7D2FE" : (isDark ? "#CBD5E1" : "#374151") },
                      ]}
                      numberOfLines={3}
                    >
                      {b}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        ) : (
          // PDF/DOCX: render document sections (tap any section to edit inline)
          <View style={[styles.docPage, { backgroundColor: surface, borderColor: border }]}>
            <Text style={[styles.docH1, { color: isDark ? "#F1F5F9" : "#0F172A" }]}>
              {title}
            </Text>
            {sections.map((sec, i) => {
              const isEditing = editingSectionIdx === i;
              const startEdit = () => {
                const draft = sec.type === "bullets"
                  ? (sec.items ?? []).join("\n")
                  : sec.text ?? "";
                setEditingSectionDraft(draft);
                setEditingSectionIdx(i);
              };

              // Active inline editor
              if (isEditing) {
                const isMultiline = sec.type !== "h1" && sec.type !== "h2" && sec.type !== "h3";
                const editorFontSize = sec.type === "h1" ? 20 : sec.type === "h2" ? 17 : sec.type === "h3" ? 15 : 14;
                const editorFontWeight = (sec.type === "h1" || sec.type === "h2" || sec.type === "h3") ? "700" : "400" as any;
                return (
                  <View key={i} style={[styles.inlineEditWrap, { borderColor: fmtColor, backgroundColor: isDark ? "#1E293B" : `${fmtColor}08` }]}>
                    <TextInput
                      autoFocus
                      value={editingSectionDraft}
                      onChangeText={setEditingSectionDraft}
                      onBlur={commitSectionEdit}
                      multiline={isMultiline}
                      style={[styles.inlineEditInput, { color: isDark ? "#F1F5F9" : "#0F172A", fontSize: editorFontSize, fontWeight: editorFontWeight }]}
                      textAlignVertical={isMultiline ? "top" : "center"}
                      returnKeyType={isMultiline ? "default" : "done"}
                      onSubmitEditing={isMultiline ? undefined : commitSectionEdit}
                      blurOnSubmit={!isMultiline}
                      placeholder={sec.type === "bullets" ? "One item per line…" : "Enter text…"}
                      placeholderTextColor={isDark ? "#475569" : "#94A3B8"}
                    />
                  </View>
                );
              }

              if (sec.type === "h1") {
                return (
                  <TouchableOpacity key={i} onPress={startEdit} activeOpacity={0.7}>
                    <Text style={[styles.docH1Body, { color: isDark ? "#F1F5F9" : "#0F172A" }]}>
                      {sec.text}
                    </Text>
                  </TouchableOpacity>
                );
              }
              if (sec.type === "h2") {
                return (
                  <TouchableOpacity key={i} onPress={startEdit} activeOpacity={0.7}>
                    <View style={[styles.docH2Wrap, { borderBottomColor: `${fmtColor}33` }]}>
                      <Text style={[styles.docH2, { color: isDark ? "#E2E8F0" : "#1E293B" }]}>
                        {sec.text}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }
              if (sec.type === "h3") {
                return (
                  <TouchableOpacity key={i} onPress={startEdit} activeOpacity={0.7}>
                    <Text style={[styles.docH3, { color: isDark ? "#CBD5E1" : "#334155" }]}>
                      {sec.text}
                    </Text>
                  </TouchableOpacity>
                );
              }
              if (sec.type === "bullets") {
                return (
                  <TouchableOpacity key={i} onPress={startEdit} activeOpacity={0.7} style={styles.docBulletGroup}>
                    {(sec.items ?? []).map((item, bi) => (
                      <View key={bi} style={styles.docBulletRow}>
                        <View style={[styles.docBulletDot, { backgroundColor: fmtColor }]} />
                        <Text style={[styles.docBulletText, { color: isDark ? "#CBD5E1" : "#374151" }]}>
                          {item}
                        </Text>
                      </View>
                    ))}
                  </TouchableOpacity>
                );
              }
              if (sec.type === "divider") {
                return <View key={i} style={[styles.docDivider, { backgroundColor: border }]} />;
              }
              // paragraph
              return (
                <TouchableOpacity key={i} onPress={startEdit} activeOpacity={0.7}>
                  <Text style={[styles.docParagraph, { color: isDark ? "#94A3B8" : "#475569" }]}>
                    {sec.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Footer */}
      <View
        style={[
          styles.footer,
          { backgroundColor: isDark ? "#0F172A" : "#FFFFFF", borderTopColor: border },
        ]}
      >
        <TouchableOpacity
          style={[styles.footerGhost, { borderColor: border }]}
          onPress={handleDiscard}
          activeOpacity={0.7}
        >
          <Text style={[styles.footerGhostText, { color: isDark ? "#94A3B8" : "#64748B" }]}>
            Discard
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSave}
          disabled={state !== "idle"}
          activeOpacity={0.85}
          style={[styles.footerPrimary, { backgroundColor: fmtColor, opacity: state !== "idle" ? 0.5 : 1 }]}
        >
          {state === "saving" ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <FmtIcon size={17} color="#FFF" strokeWidth={2} />
          )}
          <Text style={styles.footerPrimaryText}>
            {state === "saving" ? "Saving…" : `Save as ${fmtLabel}`}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Saving overlay */}
      {state === "saving" && (
        <View style={styles.overlay}>
          <View style={[styles.overlayCard, { backgroundColor: surface }]}>
            <ActivityIndicator size="large" color={fmtColor} />
            <Text style={[styles.overlayText, { color: isDark ? "#F1F5F9" : "#0F172A" }]}>
              Creating {fmtLabel} file…
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: { width: 40, alignItems: "flex-start" },
  editBtn: { width: 40, alignItems: "flex-end" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "700" },

  // Format badge (used in title bar)
  fmtBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 8, borderWidth: 1,
    flexShrink: 0,
  },
  fmtBadgeText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },

  // Title bar
  titleBar: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1,
  },
  titleInput: { flex: 1, fontSize: 15, fontWeight: "700" },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 8, paddingTop: 14, paddingBottom: 14 },

  // PPTX slides
  slideList: { gap: 12 },
  slideCard: {
    borderRadius: 14, borderWidth: 1,
    padding: 14, gap: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  slideTopRow: { flexDirection: "row", alignItems: "center" },
  slideNumBadge: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5,
  },
  slideNumText: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.6 },
  slideTitle: { fontSize: 17, fontWeight: "800", lineHeight: 24, marginTop: 4 },
  slideDivider: { height: 1.5, marginVertical: 6, borderRadius: 1 },
  slideBulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingLeft: 2 },
  slideBulletDot: { width: 5, height: 5, borderRadius: 3, marginTop: 6, flexShrink: 0 },
  slideBullet: { flex: 1, fontSize: 13.5, lineHeight: 20 },

  // Doc preview
  docPage: {
    borderRadius: 14, borderWidth: 1,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  docH1: { fontSize: 22, fontWeight: "800", marginBottom: 16, lineHeight: 30 },
  docH1Body: { fontSize: 20, fontWeight: "800", marginBottom: 12, marginTop: 8 },
  docH2Wrap: { borderBottomWidth: 2, paddingBottom: 4, marginTop: 16, marginBottom: 8 },
  docH2: { fontSize: 17, fontWeight: "700" },
  docH3: { fontSize: 15, fontWeight: "700", marginTop: 12, marginBottom: 4 },
  docParagraph: { fontSize: 14, lineHeight: 22, marginBottom: 10 },
  docBulletGroup: { gap: 5, marginBottom: 8 },
  docBulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  docBulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7, flexShrink: 0 },
  docBulletText: { flex: 1, fontSize: 14, lineHeight: 21 },
  docDivider: { height: 1, marginVertical: 12 },

  // Edit mode textarea (raw markdown, via pencil toggle)
  editInput: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    fontSize: 13,
    lineHeight: 21,
    minHeight: 500,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  // Inline section editor
  editHintBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 7,
    borderBottomWidth: 1,
  },
  editHintText: { fontSize: 12, fontWeight: "600" },
  inlineEditWrap: {
    borderRadius: 8, borderWidth: 1.5,
    marginVertical: 3, padding: 8,
  },
  inlineEditInput: {
    lineHeight: 22,
    minHeight: 36,
  },

  // Footer
  footer: {
    flexDirection: "row", gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: Platform.OS === "ios" ? 8 : 12,
    borderTopWidth: 1,
  },
  footerGhost: {
    flex: 1, paddingVertical: 14,
    borderRadius: 12, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
  footerGhostText: { fontSize: 14, fontWeight: "700" },
  footerPrimary: {
    flex: 2, paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 8,
  },
  footerPrimaryText: { fontSize: 15, fontWeight: "800", color: "#FFF" },

  // Saving overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center", justifyContent: "center",
  },
  overlayCard: {
    borderRadius: 20, padding: 32,
    alignItems: "center", gap: 14,
    minWidth: 220,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
  },
  overlayText: { fontSize: 15, fontWeight: "700" },

  // Success screen
  successWrap: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 32, gap: 14,
  },
  successIconWrap: {
    width: 96, height: 96, borderRadius: 24,
    alignItems: "center", justifyContent: "center",
    marginBottom: 8,
  },
  successTitle: { fontSize: 26, fontWeight: "800", letterSpacing: -0.3 },
  successSub: { fontSize: 14, textAlign: "center", lineHeight: 21 },
  successBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 10, borderWidth: 1.5,
    marginTop: 4,
  },
  successBadgeText: { fontSize: 13, fontWeight: "700" },
  successBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 28, paddingVertical: 14,
    borderRadius: 14, marginTop: 16, width: "100%",
    justifyContent: "center",
  },
  successBtnText: { fontSize: 16, fontWeight: "800", color: "#FFF" },
  successGhost: {
    paddingHorizontal: 28, paddingVertical: 14,
    borderRadius: 14, borderWidth: 1.5,
    width: "100%", alignItems: "center",
  },
  successGhostText: { fontSize: 14, fontWeight: "700" },
});

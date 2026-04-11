// ============================================
// Generate Document Modal – Premium redesign
// ============================================

import { GradientView } from "@/components/GradientView";
import { useTheme } from "@/services/ThemeProvider";
import {
  BookOpen,
  Check,
  ChevronLeft,
  FileText,
  ScanSearch,
  Sparkles,
  Wand2,
  X,
} from "lucide-react-native";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ─── Design tokens ────────────────────────────────────────────────────────────
const PURPLE = "#7C3AED";
const PURPLE_MID = "#9333EA";
const INDIGO = "#4F46E5";
const HEADER_GRADIENT: [string, string, string] = ["#4F46E5", "#7C3AED", "#9333EA"];

// ─── Types ────────────────────────────────────────────────────────────────────
export interface GenerateDocumentParams {
  title: string;
  prompt: string;
  fileType: "docx" | "pdf" | "ppt";
  category: string;
  tone: string;
  wordCount: number;
  audience: string;
}

export interface GenerateDocumentModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (params: GenerateDocumentParams) => Promise<void>;
  isLoading?: boolean;
}

// ─── Format data ──────────────────────────────────────────────────────────────
const FORMATS = [
  {
    type: "docx" as const,
    label: "Word Document",
    ext: ".DOCX",
    gradient: ["#1E40AF", "#3B82F6"] as [string, string],
    borderColor: "#2563EB",
    textColor: "#1D4ED8",
    Icon: FileText,
    tagline: "Edit · Format · Collaborate",
    description:
      "Fully editable rich-text document. Opens natively in Microsoft Word, Google Docs, and LibreOffice.",
  },
  {
    type: "pdf" as const,
    label: "PDF Document",
    ext: ".PDF",
    gradient: ["#991B1B", "#EF4444"] as [string, string],
    borderColor: "#DC2626",
    textColor: "#B91C1C",
    Icon: ScanSearch,
    tagline: "Share · Publish · Archive",
    description:
      "Universally compatible, print-ready format. Preserves layout on every device and platform.",
  },
  {
    type: "ppt" as const,
    label: "Presentation",
    ext: ".PPT",
    gradient: ["#9A3412", "#F97316"] as [string, string],
    borderColor: "#EA580C",
    textColor: "#C2410C",
    Icon: BookOpen,
    tagline: "Present · Pitch · Inspire",
    description:
      "Slide-based presentation format. Imports directly into PowerPoint and Google Slides.",
  },
] as const;

// ─── Categories ───────────────────────────────────────────────────────────────
const CATEGORIES = [
  { label: "Finance", emoji: "💰" },
  { label: "Technology", emoji: "💻" },
  { label: "Business", emoji: "💼" },
  { label: "Education", emoji: "🎓" },
  { label: "Health", emoji: "🏥" },
  { label: "Law", emoji: "⚖️" },
  { label: "Marketing", emoji: "📣" },
  { label: "Science", emoji: "🔬" },
  { label: "Literature", emoji: "📚" },
  { label: "HR", emoji: "👥" },
  { label: "Real Estate", emoji: "🏠" },
  { label: "Insurance", emoji: "🛡️" },
  { label: "History", emoji: "📜" },
  { label: "Travel", emoji: "✈️" },
  { label: "Environment", emoji: "🌿" },
  { label: "Government", emoji: "🏛️" },
  { label: "Psychology", emoji: "🧠" },
  { label: "Design", emoji: "🎨" },
  { label: "Engineering", emoji: "⚙️" },
  { label: "Retail", emoji: "🛍️" },
  { label: "Sports", emoji: "⚽" },
  { label: "Culinary", emoji: "🍽️" },
  { label: "Media", emoji: "📱" },
  { label: "Agriculture", emoji: "🌾" },
  { label: "Construction", emoji: "🏗️" },
  { label: "Art", emoji: "🖼️" },
  { label: "Hospitality", emoji: "🏨" },
  { label: "Manufacturing", emoji: "🏭" },
  { label: "Philosophy", emoji: "💡" },
  { label: "Transportation", emoji: "🚗" },
] as const;

const TONES = [
  { label: "Professional", color: "#2563EB" },
  { label: "Formal", color: "#1D4ED8" },
  { label: "Academic", color: "#7C3AED" },
  { label: "Casual", color: "#059669" },
  { label: "Creative", color: "#D97706" },
  { label: "Persuasive", color: "#DC2626" },
] as const;

const AUDIENCES = [
  { label: "General", sub: "Mixed audience" },
  { label: "Professionals", sub: "Field experts" },
  { label: "Experts", sub: "Specialists" },
  { label: "Students", sub: "Learners" },
  { label: "Beginners", sub: "Newcomers" },
  { label: "Executives", sub: "Decision makers" },
] as const;

const LENGTHS = [
  { label: "Short", words: "~500 words", value: 500 },
  { label: "Medium", words: "~1,500 words", value: 1500 },
  { label: "Long", words: "~3,000 words", value: 3000 },
  { label: "Extended", words: "5,000+ words", value: 5000 },
] as const;

// ─── Step labels ──────────────────────────────────────────────────────────────
const STEP_META = [
  { num: 1, label: "Format" },
  { num: 2, label: "Topic" },
  { num: 3, label: "Compose" },
];

// ─── Component ────────────────────────────────────────────────────────────────
export default function GenerateDocumentModal({
  visible,
  onClose,
  onSubmit,
  isLoading = false,
}: GenerateDocumentModalProps) {
  const { colors: t, mode } = useTheme();
  const isDark = mode === "dark";

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileType, setFileType] = useState<"docx" | "pdf" | "ppt">("docx");
  const [category, setCategory] = useState("Business");
  const [customCategory, setCustomCategory] = useState("");
  const [tone, setTone] = useState("Professional");
  const [wordCount, setWordCount] = useState(1500);
  const [audience, setAudience] = useState("Professionals");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [categorySearch, setCategorySearch] = useState("");

  const scrollRef = useRef<ScrollView>(null);

  const effectiveCategory = useMemo(
    () => (customCategory.trim() ? customCategory.trim() : category),
    [category, customCategory],
  );

  const filteredCategories = useMemo(() => {
    if (!categorySearch.trim()) return CATEGORIES;
    const q = categorySearch.toLowerCase();
    return CATEGORIES.filter((c) => c.label.toLowerCase().includes(q));
  }, [categorySearch]);

  const isStep1Valid = !!fileType;
  const isStep2Valid = !!effectiveCategory;
  const isStep3Valid = !!tone && !!audience && wordCount > 0 && prompt.trim().length > 10;
  const canSubmit = isStep1Valid && isStep2Valid && isStep3Valid;

  const selectedFormat = FORMATS.find((f) => f.type === fileType)!;

  const handleReset = useCallback(() => {
    setStep(1);
    setFileType("docx");
    setCategory("Business");
    setCustomCategory("");
    setTone("Professional");
    setWordCount(1500);
    setAudience("Professionals");
    setTitle("");
    setPrompt("");
    setCategorySearch("");
  }, []);

  const handleClose = useCallback(() => {
    handleReset();
    onClose();
  }, [handleReset, onClose]);

  const handleBack = useCallback(() => {
    if (step > 1) {
      setStep((p) => (p - 1) as 1 | 2 | 3);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [step]);

  const handleNext = useCallback(() => {
    if (step === 1 && isStep1Valid) {
      setStep(2);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    } else if (step === 2 && isStep2Valid) {
      setStep(3);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [step, isStep1Valid, isStep2Valid]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || isLoading) return;
    try {
      await onSubmit({
        title: title.trim() || `${effectiveCategory} ${selectedFormat.label}`,
        prompt: prompt.trim(),
        fileType,
        category: effectiveCategory,
        tone,
        wordCount,
        audience,
      });
      handleReset();
    } catch (e) {
      Alert.alert(
        "Generation Failed",
        e instanceof Error ? e.message : "Something went wrong. Please try again.",
      );
    }
  }, [
    canSubmit, isLoading, onSubmit, title, prompt,
    fileType, effectiveCategory, tone, wordCount, audience,
    selectedFormat, handleReset,
  ]);

  if (!visible) return null;

  // ── Shared colors ───────────────────────────────────────────────────
  const surface = isDark ? "#1E293B" : "#FFFFFF";
  const surfaceSub = isDark ? "#0F172A" : "#F8FAFC";
  const muted = isDark ? "#64748B" : "#94A3B8";
  const border = isDark ? "#334155" : "#E2E8F0";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose} transparent={false}>
      <SafeAreaView style={[s.safe, { backgroundColor: isDark ? "#0F172A" : "#F1F5F9" }]} edges={["top"]}>

        {/* ══════════════════════════════════════════════════════════════
            GRADIENT HEADER
        ══════════════════════════════════════════════════════════════ */}
        <GradientView
          colors={HEADER_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.headerWrap}
        >
          {/* Top row: back / title / close */}
          <View style={s.headerRow}>
            <TouchableOpacity
              onPress={step > 1 ? handleBack : handleClose}
              style={s.headerIconBtn}
              disabled={isLoading}
              activeOpacity={0.7}
            >
              {step > 1
                ? <ChevronLeft size={22} color="#FFF" strokeWidth={2.5} />
                : <X size={20} color="rgba(255,255,255,0.85)" strokeWidth={2.5} />}
            </TouchableOpacity>

            <View style={s.headerMid}>
              <Wand2 size={15} color="rgba(255,255,255,0.9)" strokeWidth={2} />
              <Text style={s.headerTitle}>Generate Document</Text>
            </View>

            <View style={s.headerIconBtn} />
          </View>

          {/* Progress strip */}
          <View style={s.progressStrip}>
            {STEP_META.map((sm, idx) => {
              const done = step > sm.num;
              const active = step === sm.num;
              return (
                <React.Fragment key={sm.num}>
                  <View style={s.stepItem}>
                    <View style={[
                      s.stepCircle,
                      done ? s.stepDone : active ? s.stepActive : s.stepIdle,
                    ]}>
                      {done
                        ? <Check size={12} color="#7C3AED" strokeWidth={3} />
                        : <Text style={[s.stepNum, active ? s.stepNumOn : s.stepNumOff]}>
                            {sm.num}
                          </Text>}
                    </View>
                    <Text style={[s.stepLabel, (active || done) ? s.stepLabelOn : s.stepLabelOff]}>
                      {sm.label}
                    </Text>
                  </View>
                  {idx < STEP_META.length - 1 && (
                    <View style={s.stepConnectorWrap}>
                      <View style={[s.stepConnector, { backgroundColor: step > sm.num ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.25)" }]} />
                    </View>
                  )}
                </React.Fragment>
              );
            })}
          </View>
        </GradientView>

        {/* ══════════════════════════════════════════════════════════════
            SCROLLABLE CONTENT
        ══════════════════════════════════════════════════════════════ */}
        <KeyboardAvoidingView
          style={s.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
        >
          <ScrollView
            ref={scrollRef}
            style={s.flex}
            contentContainerStyle={[s.content, { backgroundColor: isDark ? "#0F172A" : "#F1F5F9" }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >

            {/* ════════════════════════════════════════════════════════
                STEP 1 — FORMAT
            ════════════════════════════════════════════════════════ */}
            {step === 1 && (
              <>
                <View style={s.pageTitleWrap}>
                  <Text style={[s.pageTitle, { color: isDark ? "#F1F5F9" : "#0F172A" }]}>
                    Choose a format
                  </Text>
                  <Text style={[s.pageSub, { color: muted }]}>
                    Select the output format for your document
                  </Text>
                </View>

                {FORMATS.map((fmt) => {
                  const selected = fileType === fmt.type;
                  const FmtIcon = fmt.Icon;
                  return (
                    <TouchableOpacity
                      key={fmt.type}
                      onPress={() => setFileType(fmt.type)}
                      activeOpacity={0.82}
                      style={[
                        s.fmtCard,
                        {
                          backgroundColor: surface,
                          borderColor: selected ? fmt.borderColor : border,
                          borderWidth: selected ? 2 : 1,
                        },
                      ]}
                    >
                      {/* Gradient banner */}
                      <GradientView
                        colors={fmt.gradient}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={s.fmtBanner}
                      >
                        {/* Mock document lines */}
                        <View style={s.docMockLines}>
                          {[70, 90, 55, 80, 40].map((w, i) => (
                            <View
                              key={i}
                              style={[s.docMockLine, { width: `${w}%` as any, opacity: 0.18 + i * 0.04 }]}
                            />
                          ))}
                        </View>

                        {/* Big icon + ext badge */}
                        <View style={s.fmtIconArea}>
                          <View style={s.fmtIconCircle}>
                            <FmtIcon size={30} color="#FFF" strokeWidth={1.8} />
                          </View>
                          <View style={s.fmtExtBadge}>
                            <Text style={s.fmtExtText}>{fmt.ext}</Text>
                          </View>
                        </View>

                        {/* Selected checkmark */}
                        {selected && (
                          <View style={s.fmtCheckBadge}>
                            <Check size={11} color="#FFF" strokeWidth={3} />
                          </View>
                        )}
                      </GradientView>

                      {/* Card body */}
                      <View style={s.fmtBody}>
                        <View style={s.fmtBodyTop}>
                          <Text style={[s.fmtLabel, { color: selected ? fmt.textColor : (isDark ? "#F1F5F9" : "#0F172A") }]}>
                            {fmt.label}
                          </Text>
                          <Text style={[s.fmtTagline, { color: selected ? fmt.borderColor : muted }]}>
                            {fmt.tagline}
                          </Text>
                        </View>
                        <Text style={[s.fmtDesc, { color: muted }]} numberOfLines={2}>
                          {fmt.description}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}

            {/* ════════════════════════════════════════════════════════
                STEP 2 — CATEGORY / TOPIC
            ════════════════════════════════════════════════════════ */}
            {step === 2 && (
              <>
                <View style={s.pageTitleWrap}>
                  <Text style={[s.pageTitle, { color: isDark ? "#F1F5F9" : "#0F172A" }]}>
                    Pick a topic
                  </Text>
                  <Text style={[s.pageSub, { color: muted }]}>
                    Choose the domain that best fits your document
                  </Text>
                </View>

                {/* Search bar */}
                <View style={[s.searchBar, { backgroundColor: surface, borderColor: border }]}>
                  <Sparkles size={15} color={muted} strokeWidth={2} />
                  <TextInput
                    style={[s.searchInput, { color: isDark ? "#F1F5F9" : "#0F172A" }]}
                    placeholder="Search categories…"
                    placeholderTextColor={muted}
                    value={categorySearch}
                    onChangeText={setCategorySearch}
                    returnKeyType="search"
                    editable={!isLoading}
                  />
                  {categorySearch.length > 0 && (
                    <TouchableOpacity onPress={() => setCategorySearch("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <X size={14} color={muted} strokeWidth={2.5} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Category grid */}
                <View style={s.catGrid}>
                  {filteredCategories.map((cat) => {
                    const selected = category === cat.label && !customCategory.trim();
                    return (
                      <TouchableOpacity
                        key={cat.label}
                        onPress={() => { setCategory(cat.label); setCustomCategory(""); }}
                        activeOpacity={0.75}
                        style={[
                          s.catTile,
                          selected
                            ? { backgroundColor: PURPLE, borderColor: PURPLE }
                            : { backgroundColor: surface, borderColor: border },
                        ]}
                      >
                        {selected && (
                          <View style={s.catCheckBadge}>
                            <Check size={9} color="#FFF" strokeWidth={3} />
                          </View>
                        )}
                        <Text style={s.catEmoji}>{cat.emoji}</Text>
                        <Text
                          style={[s.catLabel, { color: selected ? "#FFF" : (isDark ? "#CBD5E1" : "#334155") }]}
                          numberOfLines={2}
                        >
                          {cat.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Custom category */}
                <View style={[s.customBlock, { backgroundColor: surface, borderColor: border }]}>
                  <Text style={[s.customBlockLabel, { color: muted }]}>
                    Or enter your own
                  </Text>
                  <TextInput
                    style={[
                      s.customBlockInput,
                      {
                        backgroundColor: surfaceSub,
                        color: isDark ? "#F1F5F9" : "#0F172A",
                        borderColor: customCategory.trim() ? PURPLE_MID : border,
                      },
                    ]}
                    placeholder="e.g., Blockchain, Fashion, Space Tech…"
                    placeholderTextColor={muted}
                    value={customCategory}
                    onChangeText={setCustomCategory}
                    editable={!isLoading}
                    returnKeyType="done"
                  />
                  {customCategory.trim().length > 0 && (
                    <View style={[s.customActiveRow, { borderColor: "#10B981" }]}>
                      <Check size={13} color="#10B981" strokeWidth={2.5} />
                      <Text style={[s.customActiveText, { color: "#059669" }]}>
                        Using: <Text style={{ fontWeight: "800" }}>{customCategory.trim()}</Text>
                      </Text>
                    </View>
                  )}
                </View>
              </>
            )}

            {/* ════════════════════════════════════════════════════════
                STEP 3 — COMPOSE
            ════════════════════════════════════════════════════════ */}
            {step === 3 && (
              <>
                <View style={s.pageTitleWrap}>
                  <Text style={[s.pageTitle, { color: isDark ? "#F1F5F9" : "#0F172A" }]}>
                    Compose your prompt
                  </Text>
                  <Text style={[s.pageSub, { color: muted }]}>
                    Describe your document — the more detail, the better the result
                  </Text>
                </View>

                {/* Prompt hero input */}
                <GradientView
                  colors={isDark ? ["#1E1B4B", "#2D1B69"] : ["#EEF2FF", "#F3E8FF"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[s.promptWrap, { borderColor: prompt.trim().length > 10 ? PURPLE_MID : border }]}
                >
                  <View style={s.promptHeader}>
                    <Wand2 size={14} color={PURPLE_MID} strokeWidth={2} />
                    <Text style={[s.promptHeaderLabel, { color: PURPLE_MID }]}>Your prompt</Text>
                    <Text style={[
                      s.promptCharCount,
                      { color: prompt.trim().length > 10 ? "#10B981" : muted },
                    ]}>
                      {prompt.length} chars {prompt.trim().length > 10 ? "✓" : "(min 10)"}
                    </Text>
                  </View>
                  <TextInput
                    style={[s.promptInput, { color: isDark ? "#F1F5F9" : "#0F172A" }]}
                    placeholder={`Describe the ${effectiveCategory.toLowerCase()} document you need…\n\nExample: "Write a comprehensive market analysis report covering industry trends, competitor landscape, and strategic opportunities for the next fiscal year."`}
                    placeholderTextColor={muted}
                    value={prompt}
                    onChangeText={setPrompt}
                    multiline
                    editable={!isLoading}
                    textAlignVertical="top"
                  />
                </GradientView>

                {/* Optional title */}
                <View style={s.fieldRow}>
                  <Text style={[s.fieldRowLabel, { color: isDark ? "#CBD5E1" : "#475569" }]}>
                    Document Title
                    <Text style={{ color: muted, fontWeight: "400" }}> — optional</Text>
                  </Text>
                  <TextInput
                    style={[s.titleInput, { backgroundColor: surface, color: isDark ? "#F1F5F9" : "#0F172A", borderColor: title.trim() ? PURPLE_MID : border }]}
                    placeholder={`e.g., Q3 ${effectiveCategory} Strategy Report`}
                    placeholderTextColor={muted}
                    value={title}
                    onChangeText={setTitle}
                    editable={!isLoading}
                    returnKeyType="next"
                  />
                </View>

                {/* Config section */}
                <View style={[s.configSection, { backgroundColor: surface, borderColor: border }]}>
                  <Text style={[s.configSectionTitle, { color: isDark ? "#94A3B8" : "#64748B" }]}>
                    CONFIGURATION
                  </Text>

                  {/* Tone */}
                  <View style={s.configRow}>
                    <Text style={[s.configRowLabel, { color: isDark ? "#CBD5E1" : "#374151" }]}>Tone</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipScroll}>
                      {TONES.map((opt) => {
                        const sel = tone === opt.label;
                        return (
                          <TouchableOpacity
                            key={opt.label}
                            onPress={() => setTone(opt.label)}
                            activeOpacity={0.75}
                            style={[
                              s.chip,
                              sel
                                ? { backgroundColor: opt.color, borderColor: opt.color }
                                : { backgroundColor: surfaceSub, borderColor: border },
                            ]}
                          >
                            <Text style={[s.chipText, { color: sel ? "#FFF" : (isDark ? "#CBD5E1" : "#374151") }]}>
                              {opt.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>

                  <View style={[s.configDivider, { backgroundColor: border }]} />

                  {/* Audience */}
                  <View style={s.configRow}>
                    <Text style={[s.configRowLabel, { color: isDark ? "#CBD5E1" : "#374151" }]}>Audience</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipScroll}>
                      {AUDIENCES.map((opt) => {
                        const sel = audience === opt.label;
                        return (
                          <TouchableOpacity
                            key={opt.label}
                            onPress={() => setAudience(opt.label)}
                            activeOpacity={0.75}
                            style={[
                              s.chip,
                              sel
                                ? { backgroundColor: PURPLE, borderColor: PURPLE }
                                : { backgroundColor: surfaceSub, borderColor: border },
                            ]}
                          >
                            <Text style={[s.chipText, { color: sel ? "#FFF" : (isDark ? "#CBD5E1" : "#374151") }]}>
                              {opt.label}
                            </Text>
                            <Text style={[s.chipSub, { color: sel ? "rgba(255,255,255,0.7)" : muted }]}>
                              {opt.sub}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>

                  <View style={[s.configDivider, { backgroundColor: border }]} />

                  {/* Length */}
                  <View style={s.configRow}>
                    <Text style={[s.configRowLabel, { color: isDark ? "#CBD5E1" : "#374151" }]}>Length</Text>
                    <View style={s.lengthGrid}>
                      {LENGTHS.map((opt) => {
                        const sel = wordCount === opt.value;
                        return (
                          <TouchableOpacity
                            key={opt.value}
                            onPress={() => setWordCount(opt.value)}
                            activeOpacity={0.75}
                            style={[
                              s.lengthCard,
                              sel
                                ? { backgroundColor: isDark ? "#1E1B4B" : "#EEF2FF", borderColor: INDIGO, borderWidth: 2 }
                                : { backgroundColor: surfaceSub, borderColor: border, borderWidth: 1 },
                            ]}
                          >
                            {sel && (
                              <View style={[s.lengthCheck, { backgroundColor: INDIGO }]}>
                                <Check size={8} color="#FFF" strokeWidth={3} />
                              </View>
                            )}
                            <Text style={[s.lengthLabel, { color: sel ? INDIGO : (isDark ? "#CBD5E1" : "#374151") }]}>
                              {opt.label}
                            </Text>
                            <Text style={[s.lengthWords, { color: muted }]}>{opt.words}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                </View>

                {/* Ready summary */}
                {canSubmit && (
                  <GradientView
                    colors={isDark ? ["#1E1B4B", "#2D1B69"] : ["#EEF2FF", "#F5F3FF"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[s.readyCard, { borderColor: isDark ? "#4C1D95" : "#C4B5FD" }]}
                  >
                    <View style={s.readyRow}>
                      <Sparkles size={15} color={PURPLE_MID} strokeWidth={2} />
                      <Text style={[s.readyTitle, { color: PURPLE_MID }]}>Ready to generate</Text>
                    </View>
                    <View style={s.readyDetails}>
                      {[
                        { k: "Format", v: selectedFormat.label, c: selectedFormat.textColor },
                        { k: "Topic", v: effectiveCategory },
                        { k: "Tone", v: tone },
                        { k: "Audience", v: audience },
                        { k: "Length", v: `~${wordCount.toLocaleString()} words` },
                      ].map((row) => (
                        <View key={row.k} style={s.readyDetailRow}>
                          <Text style={[s.readyDetailKey, { color: muted }]}>{row.k}</Text>
                          <Text style={[s.readyDetailVal, { color: row.c || (isDark ? "#F1F5F9" : "#0F172A") }]}>
                            {row.v}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </GradientView>
                )}
              </>
            )}

          </ScrollView>

          {/* ══════════════════════════════════════════════════════════
              FOOTER
          ══════════════════════════════════════════════════════════ */}
          <View style={[s.footer, { backgroundColor: isDark ? "#0F172A" : "#F1F5F9", borderTopColor: border }]}>
            {/* Cancel / Back ghost button */}
            <TouchableOpacity
              style={[s.footerGhost, { borderColor: border }]}
              onPress={step === 1 ? handleClose : handleBack}
              disabled={isLoading}
              activeOpacity={0.7}
            >
              <Text style={[s.footerGhostText, { color: isDark ? "#94A3B8" : "#64748B" }]}>
                {step === 1 ? "Cancel" : "Back"}
              </Text>
            </TouchableOpacity>

            {/* Continue / Generate gradient button */}
            <TouchableOpacity
              onPress={step < 3 ? handleNext : handleSubmit}
              disabled={
                isLoading ||
                (step === 1 && !isStep1Valid) ||
                (step === 2 && !isStep2Valid) ||
                (step === 3 && !canSubmit)
              }
              activeOpacity={0.85}
              style={s.footerPrimaryWrap}
            >
              <GradientView
                colors={HEADER_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[
                  s.footerPrimary,
                  (isLoading ||
                    (step === 1 && !isStep1Valid) ||
                    (step === 2 && !isStep2Valid) ||
                    (step === 3 && !canSubmit)) && { opacity: 0.45 },
                ]}
              >
                {isLoading ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <ActivityIndicator size="small" color="#FFF" />
                    <Text style={s.footerPrimaryText}>Generating…</Text>
                  </View>
                ) : step < 3 ? (
                  <Text style={s.footerPrimaryText}>Continue →</Text>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                    <Wand2 size={16} color="#FFF" strokeWidth={2.2} />
                    <Text style={s.footerPrimaryText}>Generate</Text>
                  </View>
                )}
              </GradientView>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },

  // Header
  headerWrap: { paddingBottom: 18 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingTop: Platform.OS === "android" ? 16 : 12,
    paddingBottom: 6,
  },
  headerIconBtn: {
    width: 44, height: 44,
    alignItems: "center", justifyContent: "center",
    borderRadius: 22,
  },
  headerMid: {
    flex: 1, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 7,
  },
  headerTitle: { fontSize: 16, fontWeight: "800", color: "#FFF", letterSpacing: 0.2 },

  // Progress
  progressStrip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 28,
    paddingTop: 4,
  },
  stepItem: { alignItems: "center", gap: 5 },
  stepConnectorWrap: { flex: 1, paddingHorizontal: 4, marginBottom: 18 },
  stepConnector: { height: 2, borderRadius: 1 },
  stepCircle: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: "center", justifyContent: "center",
  },
  stepDone: { backgroundColor: "#FFF" },
  stepActive: { backgroundColor: "#FFF" },
  stepIdle: { backgroundColor: "rgba(255,255,255,0.2)", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.35)" },
  stepNum: { fontSize: 13, fontWeight: "800" },
  stepNumOn: { color: "#7C3AED" },
  stepNumOff: { color: "rgba(255,255,255,0.55)" },
  stepLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
  stepLabelOn: { color: "rgba(255,255,255,0.95)" },
  stepLabelOff: { color: "rgba(255,255,255,0.4)" },

  // Content
  content: { padding: 16, paddingBottom: 24 },
  pageTitleWrap: { marginBottom: 18, marginTop: 4 },
  pageTitle: { fontSize: 22, fontWeight: "800", marginBottom: 3, letterSpacing: -0.3 },
  pageSub: { fontSize: 13, lineHeight: 19 },

  // Format cards (Step 1)
  fmtCard: {
    borderRadius: 18,
    marginBottom: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
  fmtBanner: {
    height: 110,
    overflow: "hidden",
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
  },
  docMockLines: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    paddingTop: 18, paddingHorizontal: 20, gap: 9,
  },
  docMockLine: {
    height: 7, borderRadius: 4,
    backgroundColor: "rgba(255,255,255,1)",
  },
  fmtIconArea: {
    alignItems: "center", justifyContent: "center",
    zIndex: 2, gap: 8,
  },
  fmtIconCircle: {
    width: 58, height: 58, borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center", justifyContent: "center",
  },
  fmtExtBadge: {
    paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: "rgba(0,0,0,0.28)",
    borderRadius: 8,
  },
  fmtExtText: {
    fontSize: 12, fontWeight: "800", color: "#FFF", letterSpacing: 1.2,
  },
  fmtCheckBadge: {
    position: "absolute", top: 10, right: 12,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.9)",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  fmtBody: { padding: 16, gap: 6 },
  fmtBodyTop: { gap: 2 },
  fmtLabel: { fontSize: 17, fontWeight: "800", letterSpacing: -0.2 },
  fmtTagline: { fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  fmtDesc: { fontSize: 13, lineHeight: 18 },

  // Category (Step 2)
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11,
    marginBottom: 16,
  },
  searchInput: { flex: 1, fontSize: 14, fontWeight: "500" },
  catGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: 8,
    marginBottom: 16,
  },
  catTile: {
    width: "30.5%",
    aspectRatio: 1,
    borderRadius: 14, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
    padding: 8, position: "relative",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  catCheckBadge: {
    position: "absolute", top: 6, right: 6,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.3)",
    alignItems: "center", justifyContent: "center",
  },
  catEmoji: { fontSize: 26, marginBottom: 4 },
  catLabel: { fontSize: 11, fontWeight: "700", textAlign: "center", letterSpacing: 0.1 },
  customBlock: {
    borderRadius: 14, borderWidth: 1,
    padding: 14, gap: 10,
  },
  customBlockLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  customBlockInput: {
    borderWidth: 1.5, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14,
  },
  customActiveRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 10, borderRadius: 8, borderWidth: 1.5,
    backgroundColor: "#F0FDF4",
  },
  customActiveText: { fontSize: 13 },

  // Compose (Step 3)
  promptWrap: {
    borderRadius: 16, borderWidth: 2,
    padding: 14, marginBottom: 12,
    overflow: "hidden",
  },
  promptHeader: {
    flexDirection: "row", alignItems: "center", gap: 7,
    marginBottom: 10,
  },
  promptHeaderLabel: { fontSize: 12, fontWeight: "800", flex: 1, letterSpacing: 0.3 },
  promptCharCount: { fontSize: 11, fontWeight: "700" },
  promptInput: { fontSize: 14, lineHeight: 22, minHeight: 130 },
  fieldRow: { marginBottom: 14 },
  fieldRowLabel: { fontSize: 12, fontWeight: "700", marginBottom: 8, letterSpacing: 0.2 },
  titleInput: {
    borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14,
  },
  configSection: {
    borderRadius: 16, borderWidth: 1,
    overflow: "hidden", marginBottom: 14,
  },
  configSectionTitle: {
    fontSize: 10, fontWeight: "800", letterSpacing: 1.2,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
  },
  configDivider: { height: 1, marginHorizontal: 16 },
  configRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  configRowLabel: { fontSize: 13, fontWeight: "700" },
  chipScroll: { gap: 8, paddingVertical: 2 },
  chip: {
    paddingVertical: 7, paddingHorizontal: 14,
    borderRadius: 20, borderWidth: 1.5,
    alignItems: "center",
  },
  chipText: { fontSize: 12, fontWeight: "700" },
  chipSub: { fontSize: 10, fontWeight: "500", marginTop: 1 },
  lengthGrid: { flexDirection: "row", gap: 8 },
  lengthCard: {
    flex: 1, borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 6,
    alignItems: "center", position: "relative",
  },
  lengthCheck: {
    position: "absolute", top: 5, right: 5,
    width: 14, height: 14, borderRadius: 7,
    alignItems: "center", justifyContent: "center",
  },
  lengthLabel: { fontSize: 12, fontWeight: "800", marginBottom: 2 },
  lengthWords: { fontSize: 9, fontWeight: "600", textAlign: "center" },

  // Ready card
  readyCard: {
    borderRadius: 16, borderWidth: 1.5,
    padding: 14, overflow: "hidden",
  },
  readyRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 12 },
  readyTitle: { fontSize: 13, fontWeight: "800" },
  readyDetails: { gap: 5 },
  readyDetailRow: { flexDirection: "row", justifyContent: "space-between" },
  readyDetailKey: { fontSize: 12 },
  readyDetailVal: { fontSize: 12, fontWeight: "700" },

  // Footer
  footer: {
    flexDirection: "row", gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    paddingBottom: Platform.OS === "ios" ? 8 : 12,
    borderTopWidth: 1,
  },
  footerGhost: {
    flex: 1, paddingVertical: 15,
    borderRadius: 14, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
  footerGhostText: { fontSize: 14, fontWeight: "700" },
  footerPrimaryWrap: { flex: 1.8 },
  footerPrimary: {
    paddingVertical: 15, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    flexDirection: "row", overflow: "hidden",
  },
  footerPrimaryText: { fontSize: 15, fontWeight: "800", color: "#FFF", letterSpacing: 0.2 },
});

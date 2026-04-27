// ============================================
// QuizPanel – Interactive AI Quiz Experience
// Phases: idle → setup → generating → active → complete
// File-only: requires an attached document.
// ============================================

import { LibraryFilePicker } from "@/components/LibraryFilePicker";
import {
  extractDocumentText,
  generateQuiz,
  pickDocument,
} from "@/services/ai/ai.service";
import { useTheme } from "@/services/ThemeProvider";
import type { AIDocumentRef } from "@/services/ai/ai.types";
import {
  AlertTriangle,
  BarChart2,
  BookOpen,
  Brain,
  Check,
  ChevronRight,
  FileText,
  GraduationCap,
  Paperclip,
  RotateCcw,
  Star,
  Target,
  Trophy,
  X,
  Zap,
} from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

// ── Constants ──────────────────────────────────────────────────────────────────
const ACCENT = "#A855F7";

// ── Types ──────────────────────────────────────────────────────────────────────
type QuizPhase = "idle" | "setup" | "generating" | "active" | "complete";
type QuestionType = "mcq" | "true_false" | "short" | "mixed";
type QuizLength = "quick" | "standard" | "deep";
type QuizDifficulty = "easy" | "medium" | "hard" | "adaptive";

interface QuizSourceReference {
  page?: number;
  slide?: number;
  section?: string;
  paragraphIndex?: number;
  snippet?: string;
}

interface QuizQuestion {
  id: string;
  type: "mcq" | "true_false" | "short";
  question: string;
  options?: string[];
  answer: string;
  explanation: string;
  /** Verbatim passage from the document that proves the answer. */
  source_text?: string;
  /** Structured location (page/slide/section) or legacy string quote. */
  source_reference?: QuizSourceReference | string;
  difficulty: "easy" | "medium" | "hard";
  topic: string;
}

interface QuizAnswer {
  questionId: string;
  userAnswer: string;
  isCorrect: boolean;
  difficulty: "easy" | "medium" | "hard";
  topic: string;
}

interface QuizConfig {
  questionType: QuestionType;
  length: QuizLength;
  difficulty: QuizDifficulty;
}

const LENGTH_COUNT: Record<QuizLength, number> = {
  quick: 5,
  standard: 10,
  deep: 15,
};

const DIFF_COLORS = {
  easy: "#10B981",
  medium: "#F59E0B",
  hard: "#EF4444",
} as const;

const RANK_TABLE = [
  { min: 90, rank: "Expert",  color: "#F59E0B", Icon: Trophy },
  { min: 70, rank: "Skilled", color: "#10B981", Icon: Star   },
  { min: 50, rank: "Learner", color: "#3B82F6", Icon: Target },
  { min: 0,  rank: "Beginner",color: ACCENT,    Icon: Brain  },
];

function getRank(score: number, total: number) {
  const pct = total > 0 ? (score / total) * 100 : 0;
  return RANK_TABLE.find((r) => pct >= r.min) ?? RANK_TABLE[3];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseQuestions(raw: any[]): QuizQuestion[] {
  return raw.map((q, i) => {
    let options: string[] | undefined;

    if (Array.isArray(q.options)) {
      options = q.options as string[];
    } else if (q.options && typeof q.options === "object") {
      // Legacy A/B/C/D object shape
      options = Object.values(q.options) as string[];
      if (
        typeof q.correctAnswer === "string" &&
        q.correctAnswer.length === 1 &&
        !q.answer
      ) {
        const idx = q.correctAnswer.charCodeAt(0) - 65;
        q.answer = options[idx] ?? q.correctAnswer;
      }
    }

    let type: QuizQuestion["type"] = q.type ?? "mcq";
    if (!q.type) {
      if (options && options.length === 2) type = "true_false";
      else if (options && options.length > 2) type = "mcq";
      else type = "short";
    }

    return {
      id: q.id ?? `q${i + 1}`,
      type,
      question: q.question ?? "",
      options,
      answer: q.answer ?? q.correctAnswer ?? "",
      explanation: q.explanation ?? "",
      source_text: typeof q.source_text === "string" ? q.source_text : undefined,
      source_reference: q.source_reference ?? q.sourceQuote ?? undefined,
      difficulty: q.difficulty ?? "medium",
      topic: q.topic ?? "General",
    };
  });
}

function formatSourceLocation(ref: QuizSourceReference | string | undefined): string {
  if (!ref) return "";
  if (typeof ref === "string") return ref;
  const parts: string[] = [];
  if (typeof ref.page === "number") parts.push(`Page ${ref.page}`);
  if (typeof ref.slide === "number") parts.push(`Slide ${ref.slide}`);
  if (ref.section) parts.push(ref.section);
  return parts.join(" · ");
}

function checkShortAnswer(userAnswer: string, sampleAnswer: string): boolean {
  const userWords = new Set(
    userAnswer.toLowerCase().split(/\W+/).filter((w) => w.length > 3),
  );
  const keyWords = sampleAnswer.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  if (keyWords.length === 0) return true;
  const hits = keyWords.filter((w) => userWords.has(w)).length;
  return hits / keyWords.length >= 0.4;
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  initialDoc?: AIDocumentRef;
  initialDocText?: string;
}

export function QuizPanel({ initialDoc, initialDocText }: Props) {
  const { colors: t, mode } = useTheme();
  const isDark = mode === "dark";

  // ── Document state ──────────────────────────────────────────────────────────
  const [doc, setDoc] = useState<AIDocumentRef | undefined>(initialDoc);
  const [docText, setDocText] = useState<string | undefined>(initialDocText);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionFailed, setExtractionFailed] = useState(false);
  const [showFileSourcePicker, setShowFileSourcePicker] = useState(false);
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);

  // ── Quiz state ──────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<QuizPhase>(initialDoc ? "setup" : "idle");
  const [config, setConfig] = useState<QuizConfig>({
    questionType: "mixed",
    length: "standard",
    difficulty: "adaptive",
  });
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState("");
  const [shortAnswerText, setShortAnswerText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [answers, setAnswers] = useState<QuizAnswer[]>([]);
  const [genError, setGenError] = useState<string | undefined>();

  const scrollRef = useRef<ScrollView>(null);

  // Sync if parent passes a doc after mount
  useEffect(() => {
    if (initialDoc && !doc) {
      setDoc(initialDoc);
      setDocText(initialDocText);
      setPhase("setup");
    }
  }, [initialDoc, initialDocText, doc]);

  // ── Doc picking ─────────────────────────────────────────────────────────────
  const applyDoc = useCallback(async (picked: AIDocumentRef) => {
    setDoc(picked);
    setIsExtracting(true);
    setExtractionFailed(false);
    try {
      const text = await extractDocumentText(picked);
      // Detect placeholder/failure responses — these start with "[" and contain no real content
      const isPlaceholder =
        !text ||
        (text.trimStart().startsWith("[") &&
          (text.includes("extraction was not available") ||
            text.includes("Extraction failed") ||
            text.includes("extraction is not available") ||
            text.includes("Failed to read") ||
            text.includes("no text extracted")));
      if (isPlaceholder) {
        setDocText("");
        setExtractionFailed(true);
      } else {
        setDocText(text);
      }
    } catch {
      setDocText("");
      setExtractionFailed(true);
    } finally {
      setIsExtracting(false);
    }
    setPhase("setup");
  }, []);

  const handlePickFromDevice = useCallback(async () => {
    setShowFileSourcePicker(false);
    const picked = await pickDocument();
    if (picked) await applyDoc(picked);
  }, [applyDoc]);

  const handleLibrarySelect = useCallback(
    async (files: any[]) => {
      setShowLibraryPicker(false);
      if (!files.length) return;
      const f = files[0];
      await applyDoc({
        uri: f.uri,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
      });
    },
    [applyDoc],
  );

  const handleRemoveDoc = useCallback(() => {
    setDoc(undefined);
    setDocText(undefined);
    setExtractionFailed(false);
    setPhase("idle");
    setAnswers([]);
    setQuestions([]);
    setCurrentIdx(0);
    setSubmitted(false);
    setSelectedAnswer("");
    setShortAnswerText("");
  }, []);

  // ── Quiz generation ─────────────────────────────────────────────────────────
  const runGeneration = useCallback(
    async (
      overrideDifficulty?: QuizDifficulty,
      overrideLength?: QuizLength,
      weakTopics?: string[],
    ) => {
      if (extractionFailed || !docText?.trim()) {
        Alert.alert(
          "Extraction Failed",
          "Could not read text from this document. Please ensure the backend is running, or try a different file (PDF and DOCX work best).",
        );
        return;
      }

      setPhase("generating");
      setGenError(undefined);
      setAnswers([]);
      setCurrentIdx(0);
      setSelectedAnswer("");
      setShortAnswerText("");
      setSubmitted(false);

      try {
        const response = await generateQuiz(
          docText,
          config.questionType,
          overrideLength ?? config.length,
          overrideDifficulty ?? config.difficulty,
          doc?.name,
          weakTopics,
          doc,
        );

        const sd = response.structuredData as any;
        let payload: any = sd;
        if ((!sd || !Array.isArray(sd?.questions)) && response.content) {
          try {
            payload = JSON.parse(response.content);
          } catch {
            /* ignore — handled below */
          }
        }

        // Backend-signalled insufficient-content: do not silently fall back.
        if (payload && payload.insufficient === true) {
          const msg =
            payload.reason ||
            "This document does not contain enough clear information to generate a full quiz. Try a different file or reduce quiz length.";
          setGenError(msg);
          setPhase("setup");
          return;
        }

        const qs: QuizQuestion[] =
          payload && Array.isArray(payload.questions) ? parseQuestions(payload.questions) : [];

        if (qs.length === 0) {
          setGenError(
            "This document does not contain enough clear information to generate a full quiz. Try a different file or reduce quiz length.",
          );
          setPhase("setup");
          return;
        }

        setQuestions(qs);
        setPhase("active");
      } catch (e: any) {
        setGenError(e.message ?? "Failed to generate quiz. Please try again.");
        setPhase("setup");
      }
    },
    [docText, doc, config, extractionFailed],
  );

  const handleStartQuiz = useCallback(() => runGeneration(), [runGeneration]);

  // ── Answer logic ────────────────────────────────────────────────────────────
  const currentQ = questions[currentIdx];

  const currentUserAnswer = currentQ?.type === "short" ? shortAnswerText.trim() : selectedAnswer;
  const hasAnswer = currentUserAnswer.length > 0;

  const handleSubmit = useCallback(() => {
    if (!currentQ || !hasAnswer) return;

    const ua = currentUserAnswer;
    const correct = currentQ.answer;

    let isCorrect: boolean;
    if (currentQ.type === "short") {
      isCorrect = checkShortAnswer(ua, correct);
    } else {
      isCorrect = ua === correct;
    }

    setAnswers((prev) => [
      ...prev,
      {
        questionId: currentQ.id,
        userAnswer: ua,
        isCorrect,
        difficulty: currentQ.difficulty,
        topic: currentQ.topic,
      },
    ]);
    setSubmitted(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
  }, [currentQ, currentUserAnswer, hasAnswer]);

  const handleNext = useCallback(() => {
    const next = currentIdx + 1;
    if (next >= questions.length) {
      setPhase("complete");
    } else {
      setCurrentIdx(next);
      setSelectedAnswer("");
      setShortAnswerText("");
      setSubmitted(false);
      setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 100);
    }
  }, [currentIdx, questions.length]);

  // ── Results computation ─────────────────────────────────────────────────────
  const computeResults = useCallback(() => {
    const score = answers.filter((a) => a.isCorrect).length;
    const total = answers.length;
    const pct = total > 0 ? Math.round((score / total) * 100) : 0;

    const byDiff = {
      easy:   { correct: 0, total: 0 },
      medium: { correct: 0, total: 0 },
      hard:   { correct: 0, total: 0 },
    };
    const topicMap: Record<string, { correct: number; total: number }> = {};

    for (const a of answers) {
      const d = a.difficulty as "easy" | "medium" | "hard";
      byDiff[d].total++;
      if (a.isCorrect) byDiff[d].correct++;

      if (!topicMap[a.topic]) topicMap[a.topic] = { correct: 0, total: 0 };
      topicMap[a.topic].total++;
      if (a.isCorrect) topicMap[a.topic].correct++;
    }

    const strongTopics = Object.entries(topicMap)
      .filter(([, v]) => v.total > 0 && v.correct / v.total >= 0.7)
      .map(([k]) => k);
    const weakTopics = Object.entries(topicMap)
      .filter(([, v]) => v.total > 0 && v.correct / v.total < 0.5)
      .map(([k]) => k);

    const rank = getRank(score, total);

    let feedback = "";
    if (pct >= 90)
      feedback = "Excellent work! You demonstrated outstanding understanding across all topics.";
    else if (pct >= 70)
      feedback = `Good job! You performed well${strongTopics.length ? ` in ${strongTopics.slice(0, 2).join(", ")}` : ""}${weakTopics.length ? `, but there's room to improve in ${weakTopics.slice(0, 2).join(", ")}` : ""}.`;
    else if (pct >= 50)
      feedback = `You're on the right track! Focus on reviewing ${weakTopics.slice(0, 2).join(" and ") || "the challenging topics"} to boost your score.`;
    else
      feedback = `Keep practising! Use "Practice Weak Areas" to build a stronger foundation in the topics you found difficult.`;

    return { score, total, pct, byDiff, strongTopics, weakTopics, rank, feedback };
  }, [answers]);

  // ── End-of-quiz actions ─────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    setAnswers([]);
    setCurrentIdx(0);
    setSelectedAnswer("");
    setShortAnswerText("");
    setSubmitted(false);
    setPhase("setup");
  }, []);

  const handlePracticeWeakAreas = useCallback(() => {
    const { weakTopics } = computeResults();
    if (!weakTopics.length) {
      Alert.alert("No Weak Areas", "You did great on everything! Try a harder challenge instead.");
      return;
    }
    runGeneration("easy", "quick", weakTopics);
  }, [computeResults, runGeneration]);

  const handleHarderChallenge = useCallback(() => {
    runGeneration("hard", config.length);
  }, [runGeneration, config.length]);

  // ── Shared file picker modals ───────────────────────────────────────────────
  const filePickers = (
    <>
      {showFileSourcePicker && (
        <View style={styles.pickerBackdrop}>
          <View style={[styles.pickerModal, { backgroundColor: t.card }]}>
            <Text style={[styles.pickerTitle, { color: t.text }]}>Attach Document</Text>
            <Text style={[styles.pickerSub, { color: t.textSecondary }]}>
              Choose where to pick from
            </Text>
            <TouchableOpacity
              style={[styles.pickerOption, { backgroundColor: isDark ? "#1E293B" : t.backgroundSecondary }]}
              onPress={() => { setShowFileSourcePicker(false); setShowLibraryPicker(true); }}
              activeOpacity={0.7}
            >
              <BookOpen size={22} color={ACCENT} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.pickerOptTitle, { color: t.text }]}>Pick from App Library</Text>
                <Text style={[styles.pickerOptSub, { color: t.textSecondary }]}>From your imported documents</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pickerOption, { backgroundColor: isDark ? "#1E293B" : t.backgroundSecondary }]}
              onPress={handlePickFromDevice}
              activeOpacity={0.7}
            >
              <FileText size={22} color={ACCENT} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.pickerOptTitle, { color: t.text }]}>Pick from Device</Text>
                <Text style={[styles.pickerOptSub, { color: t.textSecondary }]}>Browse files on your device</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pickerCancel}
              onPress={() => setShowFileSourcePicker(false)}
            >
              <Text style={[styles.pickerCancelText, { color: t.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      <LibraryFilePicker
        visible={showLibraryPicker}
        onClose={() => setShowLibraryPicker(false)}
        onSelect={handleLibrarySelect}
        allowedTypes={["pdf", "docx", "pptx", "xlsx"]}
        multiple={false}
        title="Select Document for Quiz"
      />
    </>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase: IDLE
  // ═══════════════════════════════════════════════════════════════════════════
  if (phase === "idle") {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: "transparent" }]}
        contentContainerStyle={styles.idleContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.idleIconWrap, { backgroundColor: `${ACCENT}18` }]}>
          <GraduationCap size={44} color={ACCENT} />
        </View>
        <Text style={[styles.idleTitle, { color: t.text }]}>Smart Quiz Mode</Text>
        <Text style={[styles.idleSub, { color: t.textSecondary }]}>
          Upload a document and I'll turn it into an interactive quiz that tests and improves your understanding.
        </Text>

        <View style={[styles.formatsCard, { backgroundColor: isDark ? "#1E293B" : "#F8F4FF", borderColor: `${ACCENT}28` }]}>
          <Text style={[styles.formatsLabel, { color: t.textTertiary }]}>SUPPORTED FORMATS</Text>
          <View style={styles.formatsRow}>
            {["PDF", "DOCX", "PPTX", "XLSX"].map((fmt) => (
              <View key={fmt} style={[styles.fmtBadge, { backgroundColor: `${ACCENT}18` }]}>
                <Text style={[styles.fmtText, { color: ACCENT }]}>{fmt}</Text>
              </View>
            ))}
          </View>
        </View>

        <TouchableOpacity
          style={[styles.attachBtn, { backgroundColor: ACCENT }]}
          onPress={() => setShowFileSourcePicker(true)}
          activeOpacity={0.8}
        >
          <Paperclip size={18} color="#FFF" />
          <Text style={styles.attachBtnText}>Attach Document</Text>
        </TouchableOpacity>

        {filePickers}
      </ScrollView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase: SETUP
  // ═══════════════════════════════════════════════════════════════════════════
  if (phase === "setup") {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: "transparent" }]}
        contentContainerStyle={styles.setupContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Doc chip */}
        <View style={[styles.docChip, {
          backgroundColor: isDark ? "#1E293B" : "#F3E8FF",
          borderColor: extractionFailed ? "#EF4444" : `${ACCENT}30`,
        }]}>
          <FileText size={15} color={extractionFailed ? "#EF4444" : ACCENT} />
          <Text style={[styles.docChipName, { color: t.text }]} numberOfLines={1}>{doc?.name}</Text>
          {isExtracting
            ? <ActivityIndicator size="small" color={ACCENT} />
            : extractionFailed
              ? <AlertTriangle size={13} color="#EF4444" />
              : <Check size={13} color="#10B981" />}
          <TouchableOpacity onPress={handleRemoveDoc} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={13} color={t.textTertiary} />
          </TouchableOpacity>
        </View>

        {extractionFailed ? (
          <View style={[styles.errorCard, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
            <AlertTriangle size={13} color="#EF4444" />
            <Text style={styles.errorText}>
              Could not extract text from this file. Make sure the backend is running, or try a different document (PDF and DOCX work best).
            </Text>
          </View>
        ) : genError ? (
          <View style={[styles.errorCard, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
            <AlertTriangle size={13} color="#EF4444" />
            <Text style={styles.errorText}>{genError}</Text>
          </View>
        ) : null}

        {/* ── Question Type ── */}
        <Text style={[styles.sectionLabel, { color: t.textSecondary }]}>QUESTION TYPE</Text>
        <View style={styles.optGrid}>
          {(
            [
              { value: "mcq",        label: "Multiple Choice", sub: "4 options each" },
              { value: "true_false", label: "True / False",    sub: "Binary choice"  },
              { value: "short",      label: "Short Answer",    sub: "Theory based"   },
              { value: "mixed",      label: "Mixed",           sub: "All types"      },
            ] as const
          ).map((opt) => {
            const active = config.questionType === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.optCard,
                  {
                    backgroundColor: active ? `${ACCENT}14` : (isDark ? "#1E293B" : "#F8FAFC"),
                    borderColor: active ? ACCENT : t.border,
                    borderWidth: active ? 1.5 : 1,
                  },
                ]}
                onPress={() => setConfig((c) => ({ ...c, questionType: opt.value }))}
                activeOpacity={0.75}
              >
                <Text style={[styles.optCardLabel, { color: active ? ACCENT : t.text }]}>{opt.label}</Text>
                <Text style={[styles.optCardSub, { color: t.textTertiary }]}>{opt.sub}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Quiz Length ── */}
        <Text style={[styles.sectionLabel, { color: t.textSecondary }]}>QUIZ LENGTH</Text>
        <View style={styles.rowCards}>
          {(
            [
              { value: "quick",    label: "Quick",    count: "5 Qs"  },
              { value: "standard", label: "Standard", count: "10 Qs" },
              { value: "deep",     label: "Deep",     count: "15 Qs" },
            ] as const
          ).map((opt) => {
            const active = config.length === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.rowCard,
                  {
                    backgroundColor: active ? `${ACCENT}14` : (isDark ? "#1E293B" : "#F8FAFC"),
                    borderColor: active ? ACCENT : t.border,
                    borderWidth: active ? 1.5 : 1,
                  },
                ]}
                onPress={() => setConfig((c) => ({ ...c, length: opt.value }))}
                activeOpacity={0.75}
              >
                <Text style={[styles.rowCardLabel, { color: active ? ACCENT : t.text }]}>{opt.label}</Text>
                <Text style={[styles.rowCardSub, { color: t.textTertiary }]}>{opt.count}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Difficulty ── */}
        <Text style={[styles.sectionLabel, { color: t.textSecondary }]}>DIFFICULTY</Text>
        <View style={styles.rowCards}>
          {(
            [
              { value: "easy",     label: "Easy",       color: "#10B981" },
              { value: "medium",   label: "Medium",     color: "#F59E0B" },
              { value: "hard",     label: "Hard",       color: "#EF4444" },
              { value: "adaptive", label: "Adaptive ★", color: ACCENT    },
            ] as const
          ).map((opt) => {
            const active = config.difficulty === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.diffCard,
                  {
                    backgroundColor: active ? `${opt.color}18` : (isDark ? "#1E293B" : "#F8FAFC"),
                    borderColor: active ? opt.color : t.border,
                    borderWidth: active ? 1.5 : 1,
                  },
                ]}
                onPress={() => setConfig((c) => ({ ...c, difficulty: opt.value }))}
                activeOpacity={0.75}
              >
                <Text style={[styles.diffCardLabel, { color: active ? opt.color : t.text }]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={[styles.startBtn, { backgroundColor: ACCENT, opacity: (isExtracting || extractionFailed) ? 0.45 : 1 }]}
          onPress={handleStartQuiz}
          disabled={isExtracting || extractionFailed}
          activeOpacity={0.8}
        >
          <Brain size={18} color="#FFF" />
          <Text style={styles.startBtnText}>Start Quiz</Text>
          <ChevronRight size={16} color="#FFF" />
        </TouchableOpacity>

        <View style={{ height: 28 }} />
        {filePickers}
      </ScrollView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase: GENERATING
  // ═══════════════════════════════════════════════════════════════════════════
  if (phase === "generating") {
    return (
      <View style={[styles.container, styles.centeredFill]}>
        <View style={[styles.genCard, { backgroundColor: isDark ? "#1E293B" : "#F8F4FF", borderColor: `${ACCENT}28` }]}>
          <ActivityIndicator size="large" color={ACCENT} />
          <Text style={[styles.genTitle, { color: t.text }]}>Generating Your Quiz</Text>
          <Text style={[styles.genSub, { color: t.textSecondary }]}>
            Analysing {doc?.name ?? "document"} and crafting {LENGTH_COUNT[config.length]} questions…
          </Text>
        </View>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase: ACTIVE
  // ═══════════════════════════════════════════════════════════════════════════
  if (phase === "active" && currentQ) {
    const progress = (currentIdx + 1) / questions.length;
    const isLast = currentIdx === questions.length - 1;
    const savedAnswer = answers.find((a) => a.questionId === currentQ.id);
    const isCorrect = savedAnswer?.isCorrect;
    const diffColor = DIFF_COLORS[currentQ.difficulty];

    return (
      <ScrollView
        ref={scrollRef}
        style={[styles.container, { backgroundColor: "transparent" }]}
        contentContainerStyle={styles.activeContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Progress header ── */}
        <View style={styles.progressRow}>
          <View style={styles.progressLeft}>
            <Text style={[styles.progressCount, { color: t.textSecondary }]}>
              Question {currentIdx + 1} of {questions.length}
            </Text>
            <View style={[styles.topicBadge, { backgroundColor: `${ACCENT}14` }]}>
              <Text style={[styles.topicBadgeText, { color: ACCENT }]} numberOfLines={1}>
                {currentQ.topic}
              </Text>
            </View>
          </View>
          <View style={[styles.diffBadge, { backgroundColor: `${diffColor}20` }]}>
            <Text style={[styles.diffBadgeText, { color: diffColor, textTransform: "capitalize" }]}>
              {currentQ.difficulty}
            </Text>
          </View>
        </View>

        {/* ── Progress bar ── */}
        <View style={[styles.progressBg, { backgroundColor: isDark ? "#334155" : "#E9D5FF" }]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: ACCENT, width: `${Math.round(progress * 100)}%` as any },
            ]}
          />
        </View>

        {/* ── Question card ── */}
        <View style={[styles.questionCard, { backgroundColor: isDark ? "#1E293B" : "#FFFFFF", borderColor: t.border }]}>
          <Text style={[styles.questionText, { color: t.text }]}>{currentQ.question}</Text>
        </View>

        {/* ── Answer UI (before submission) ── */}
        {!submitted ? (
          <>
            {currentQ.type === "mcq" && currentQ.options && (
              <View style={styles.optionsWrap}>
                {currentQ.options.map((opt, i) => {
                  const active = selectedAnswer === opt;
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[
                        styles.mcqOption,
                        {
                          backgroundColor: active ? `${ACCENT}14` : (isDark ? "#1E293B" : "#F8FAFC"),
                          borderColor: active ? ACCENT : t.border,
                          borderWidth: active ? 1.5 : 1,
                        },
                      ]}
                      onPress={() => setSelectedAnswer(opt)}
                      activeOpacity={0.75}
                    >
                      <View style={[styles.radioCircle, { borderColor: active ? ACCENT : t.border, backgroundColor: active ? ACCENT : "transparent" }]}>
                        {active && <View style={styles.radioDot} />}
                      </View>
                      <Text style={[styles.mcqOptionText, { color: t.text }]}>{opt}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {currentQ.type === "true_false" && (
              <View style={styles.tfRow}>
                {["True", "False"].map((val) => {
                  const active = selectedAnswer === val;
                  const col = val === "True" ? "#10B981" : "#EF4444";
                  return (
                    <TouchableOpacity
                      key={val}
                      style={[
                        styles.tfBtn,
                        {
                          backgroundColor: active ? `${col}18` : (isDark ? "#1E293B" : "#F8FAFC"),
                          borderColor: active ? col : t.border,
                          borderWidth: active ? 1.5 : 1,
                        },
                      ]}
                      onPress={() => setSelectedAnswer(val)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.tfBtnText, { color: active ? col : t.text }]}>
                        {val === "True" ? "✓  True" : "✗  False"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {currentQ.type === "short" && (
              <TextInput
                value={shortAnswerText}
                onChangeText={setShortAnswerText}
                placeholder="Type your answer here…"
                placeholderTextColor={t.textTertiary}
                style={[
                  styles.shortInput,
                  {
                    color: t.text,
                    backgroundColor: isDark ? "#1E293B" : "#F8FAFC",
                    borderColor: t.border,
                  },
                ]}
                multiline
                maxLength={600}
                textAlignVertical="top"
              />
            )}

            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: hasAnswer ? ACCENT : t.border }]}
              onPress={handleSubmit}
              disabled={!hasAnswer}
              activeOpacity={0.8}
            >
              <Text style={[styles.submitBtnText, { color: hasAnswer ? "#FFF" : t.textTertiary }]}>
                Submit Answer
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          /* ── Feedback (after submission) ── */
          <>
            {/* Reviewed options for MCQ / T-F */}
            {currentQ.type !== "short" && (
              <View style={currentQ.type === "true_false" ? styles.tfRow : styles.optionsWrap}>
                {(currentQ.type === "true_false"
                  ? ["True", "False"]
                  : currentQ.options ?? []
                ).map((opt, i) => {
                  const isUserPick = savedAnswer?.userAnswer === opt;
                  const isRight = opt === currentQ.answer;
                  let bg = isDark ? "#1E293B" : "#F8FAFC";
                  let bc = t.border;
                  let tc = t.text;
                  if (isRight) { bg = "#10B98112"; bc = "#10B981"; tc = "#10B981"; }
                  if (isUserPick && !isCorrect) { bg = "#EF444412"; bc = "#EF4444"; tc = "#EF4444"; }

                  const RowWrapper = currentQ.type === "true_false" ? styles.tfBtn : styles.mcqOption;
                  return (
                    <View
                      key={i}
                      style={[
                        RowWrapper,
                        { backgroundColor: bg, borderColor: bc, borderWidth: 1.5 },
                      ]}
                    >
                      {isRight && <Check size={13} color="#10B981" style={{ marginRight: 5 }} />}
                      {isUserPick && !isCorrect && <X size={13} color="#EF4444" style={{ marginRight: 5 }} />}
                      <Text style={[
                        currentQ.type === "true_false" ? styles.tfBtnText : styles.mcqOptionText,
                        { color: tc },
                      ]}>
                        {currentQ.type === "true_false" ? (opt === "True" ? "✓  True" : "✗  False") : opt}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Feedback card */}
            <View style={[
              styles.feedbackCard,
              {
                backgroundColor: isCorrect ? "#10B98112" : "#EF444412",
                borderColor: isCorrect ? "#10B981" : "#EF4444",
              },
            ]}>
              <View style={styles.feedbackHeader}>
                {isCorrect
                  ? <Check size={17} color="#10B981" />
                  : <X size={17} color="#EF4444" />}
                <Text style={[styles.feedbackResult, { color: isCorrect ? "#10B981" : "#EF4444" }]}>
                  {isCorrect ? "Correct!" : "Incorrect"}
                </Text>
              </View>

              {/* For short answer, always show model answer */}
              {(currentQ.type === "short" || !isCorrect) && (
                <View style={styles.correctAnswerRow}>
                  <Text style={[styles.feedbackLabelSmall, { color: t.textSecondary }]}>
                    {currentQ.type === "short" ? "Model answer:" : "Correct answer:"}
                  </Text>
                  <Text style={[styles.feedbackAnswerText, { color: t.text }]}>{currentQ.answer}</Text>
                </View>
              )}

              <Text style={[styles.feedbackExplanation, { color: t.text }]}>
                {currentQ.explanation}
              </Text>

              {(!!currentQ.source_text || !!currentQ.source_reference) && (
                <View
                  style={[
                    styles.sourceCard,
                    {
                      backgroundColor: isDark ? "#0F172A" : "#F0FDF4",
                      borderColor: "#BBF7D0",
                    },
                  ]}
                >
                  <View style={styles.sourceHeader}>
                    <BookOpen size={12} color="#10B981" />
                    <Text style={[styles.sourceHeaderText, { color: "#10B981" }]}>
                      Source from document
                    </Text>
                    {!!formatSourceLocation(currentQ.source_reference) && (
                      <Text style={[styles.sourceLocation, { color: t.textTertiary }]}>
                        {formatSourceLocation(currentQ.source_reference)}
                      </Text>
                    )}
                  </View>
                  {!!currentQ.source_text && (
                    <Text style={[styles.sourceQuote, { color: t.text }]} numberOfLines={4}>
                      “{currentQ.source_text}”
                    </Text>
                  )}
                  {(() => {
                    const ref = currentQ.source_reference;
                    const page =
                      ref && typeof ref === "object"
                        ? ref.page ?? ref.slide
                        : undefined;
                    if (typeof page !== "number") return null;
                    return (
                      <TouchableOpacity
                        style={styles.viewInDocBtn}
                        onPress={() =>
                          Alert.alert(
                            "In document",
                            `This passage appears on ${
                              ref && typeof ref === "object" && typeof ref.slide === "number"
                                ? `slide ${ref.slide}`
                                : `page ${page}`
                            } of "${doc?.name ?? "your document"}".`,
                          )
                        }
                        activeOpacity={0.75}
                      >
                        <Text style={styles.viewInDocBtnText}>View in document</Text>
                        <ChevronRight size={12} color="#10B981" />
                      </TouchableOpacity>
                    );
                  })()}
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[styles.nextBtn, { backgroundColor: ACCENT }]}
              onPress={handleNext}
              activeOpacity={0.8}
            >
              <Text style={styles.nextBtnText}>{isLast ? "See Results" : "Next Question"}</Text>
              <ChevronRight size={16} color="#FFF" />
            </TouchableOpacity>
          </>
        )}

        <View style={{ height: 28 }} />
      </ScrollView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase: COMPLETE
  // ═══════════════════════════════════════════════════════════════════════════
  if (phase === "complete") {
    const { score, total, pct, byDiff, strongTopics, weakTopics, rank, feedback } =
      computeResults();
    const RankIcon = rank.Icon;
    const accuracyColor = pct >= 70 ? "#10B981" : pct >= 50 ? "#F59E0B" : "#EF4444";

    return (
      <ScrollView
        style={[styles.container, { backgroundColor: "transparent" }]}
        contentContainerStyle={styles.completeContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Score card ── */}
        <View style={[styles.scoreCard, { backgroundColor: isDark ? "#1E293B" : "#FFFFFF", borderColor: t.border }]}>
          <View style={[styles.rankBadge, { backgroundColor: `${rank.color}1A` }]}>
            <RankIcon size={22} color={rank.color} />
            <Text style={[styles.rankText, { color: rank.color }]}>{rank.rank}</Text>
          </View>
          <Text style={[styles.scoreNum, { color: t.text }]}>{score} / {total}</Text>
          <Text style={[styles.scorePct, { color: accuracyColor }]}>{pct}% Accuracy</Text>
        </View>

        {/* ── Feedback summary ── */}
        <View style={[styles.feedbackSummary, { backgroundColor: isDark ? "#1E293B" : "#F8F4FF", borderColor: `${ACCENT}28` }]}>
          <Text style={[styles.feedbackSummaryText, { color: t.text }]}>{feedback}</Text>
        </View>

        {/* ── Difficulty breakdown ── */}
        {(byDiff.easy.total > 0 || byDiff.medium.total > 0 || byDiff.hard.total > 0) && (
          <View style={[styles.diffBreakdown, { backgroundColor: isDark ? "#1E293B" : "#FFFFFF", borderColor: t.border }]}>
            <View style={styles.diffBreakdownHeader}>
              <BarChart2 size={13} color={t.textSecondary} />
              <Text style={[styles.sectionLabel, { color: t.textSecondary, marginBottom: 0, marginTop: 0 }]}>
                DIFFICULTY BREAKDOWN
              </Text>
            </View>
            {(["easy", "medium", "hard"] as const).map((d) => {
              if (byDiff[d].total === 0) return null;
              const dp = Math.round((byDiff[d].correct / byDiff[d].total) * 100);
              const dc = DIFF_COLORS[d];
              return (
                <View key={d} style={styles.diffRow}>
                  <Text style={[styles.diffRowLabel, { color: t.text }]}>{d.charAt(0).toUpperCase() + d.slice(1)}</Text>
                  <View style={[styles.diffBarBg, { backgroundColor: isDark ? "#334155" : "#F1F5F9" }]}>
                    <View style={[styles.diffBarFill, { backgroundColor: dc, width: `${dp}%` as any }]} />
                  </View>
                  <Text style={[styles.diffRowCount, { color: t.textSecondary }]}>
                    {byDiff[d].correct}/{byDiff[d].total}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Topics ── */}
        {(strongTopics.length > 0 || weakTopics.length > 0) && (
          <View style={[styles.topicsCard, { backgroundColor: isDark ? "#1E293B" : "#FFFFFF", borderColor: t.border }]}>
            {strongTopics.length > 0 && (
              <View style={styles.topicSection}>
                <View style={styles.topicSectionHeader}>
                  <Check size={13} color="#10B981" />
                  <Text style={[styles.topicSectionTitle, { color: "#10B981" }]}>Strong Topics</Text>
                </View>
                <View style={styles.topicTagsRow}>
                  {strongTopics.map((tp) => (
                    <View key={tp} style={[styles.topicTag, { backgroundColor: "#10B98115" }]}>
                      <Text style={[styles.topicTagText, { color: "#10B981" }]}>{tp}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            {weakTopics.length > 0 && (
              <View style={[
                styles.topicSection,
                strongTopics.length > 0 && { borderTopWidth: 1, borderTopColor: isDark ? "#334155" : "#F1F5F9", paddingTop: 12, marginTop: 4 },
              ]}>
                <View style={styles.topicSectionHeader}>
                  <AlertTriangle size={13} color="#F59E0B" />
                  <Text style={[styles.topicSectionTitle, { color: "#F59E0B" }]}>Needs Review</Text>
                </View>
                <View style={styles.topicTagsRow}>
                  {weakTopics.map((tp) => (
                    <View key={tp} style={[styles.topicTag, { backgroundColor: "#F59E0B15" }]}>
                      <Text style={[styles.topicTagText, { color: "#F59E0B" }]}>{tp}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        {/* ── Action buttons ── */}
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: isDark ? "#1E293B" : "#F1F5F9", borderColor: t.border }]}
          onPress={handleRetry}
          activeOpacity={0.75}
        >
          <RotateCcw size={15} color={t.text} />
          <Text style={[styles.actionBtnText, { color: t.text }]}>Retry Quiz</Text>
        </TouchableOpacity>

        {weakTopics.length > 0 && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: "#10B98118", borderColor: "#10B981" }]}
            onPress={handlePracticeWeakAreas}
            activeOpacity={0.75}
          >
            <Target size={15} color="#10B981" />
            <Text style={[styles.actionBtnText, { color: "#10B981" }]}>Practice Weak Areas</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: `${ACCENT}18`, borderColor: ACCENT }]}
          onPress={handleHarderChallenge}
          activeOpacity={0.75}
        >
          <Zap size={15} color={ACCENT} />
          <Text style={[styles.actionBtnText, { color: ACCENT }]}>Harder Challenge</Text>
        </TouchableOpacity>

        <View style={{ height: 28 }} />
      </ScrollView>
    );
  }

  return null;
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centeredFill: {
    justifyContent: "center",
    alignItems: "center",
  },

  // ── Idle ──
  idleContent: {
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 24,
    alignItems: "center",
  },
  idleIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  idleTitle: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 10,
  },
  idleSub: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21,
    maxWidth: 300,
    marginBottom: 24,
  },
  formatsCard: {
    width: "100%",
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 22,
    alignItems: "center",
    gap: 10,
  },
  formatsLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  formatsRow: {
    flexDirection: "row",
    gap: 8,
  },
  fmtBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
  },
  fmtText: {
    fontSize: 12,
    fontWeight: "700",
  },
  attachBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 13,
    paddingHorizontal: 28,
    borderRadius: 14,
  },
  attachBtnText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "700",
  },

  // ── Setup ──
  setupContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
  },
  docChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 14,
  },
  docChipName: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
  },
  errorCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: "#EF4444",
    lineHeight: 17,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginTop: 14,
    marginBottom: 8,
  },
  optGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optCard: {
    width: "47%",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 2,
  },
  optCardLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  optCardSub: {
    fontSize: 11,
  },
  rowCards: {
    flexDirection: "row",
    gap: 8,
  },
  rowCard: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: "center",
    gap: 2,
  },
  rowCardLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  rowCardSub: {
    fontSize: 11,
  },
  diffCard: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  diffCardLabel: {
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  startBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 14,
  },
  startBtnText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "700",
  },

  // ── Generating ──
  genCard: {
    alignItems: "center",
    gap: 14,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 36,
    paddingHorizontal: 28,
    width: "80%",
    maxWidth: 320,
  },
  genTitle: {
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  genSub: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },

  // ── Active ──
  activeContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  progressLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  progressCount: {
    fontSize: 12,
    fontWeight: "600",
  },
  topicBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    maxWidth: 130,
  },
  topicBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  diffBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  diffBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  progressBg: {
    height: 5,
    borderRadius: 4,
    marginBottom: 14,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 4,
  },
  questionCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 18,
    paddingHorizontal: 16,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  questionText: {
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 23,
  },
  optionsWrap: {
    gap: 8,
    marginBottom: 14,
  },
  mcqOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 11,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FFF",
  },
  mcqOptionText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  tfRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  tfBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    paddingVertical: 14,
    paddingHorizontal: 10,
  },
  tfBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  shortInput: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    fontSize: 14,
    lineHeight: 21,
    minHeight: 100,
    marginBottom: 14,
  },
  submitBtn: {
    alignItems: "center",
    paddingVertical: 13,
    borderRadius: 12,
    marginBottom: 4,
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: "700",
  },
  feedbackCard: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 14,
    gap: 8,
    marginBottom: 12,
  },
  feedbackHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  feedbackResult: {
    fontSize: 16,
    fontWeight: "700",
  },
  correctAnswerRow: {
    gap: 2,
  },
  feedbackLabelSmall: {
    fontSize: 11,
    fontWeight: "600",
  },
  feedbackAnswerText: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
  },
  feedbackExplanation: {
    fontSize: 13,
    lineHeight: 19,
  },
  sourceRef: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    borderRadius: 8,
    borderWidth: 1,
    padding: 8,
    marginTop: 2,
  },
  sourceRefText: {
    flex: 1,
    fontSize: 11,
    fontStyle: "italic",
    lineHeight: 16,
  },
  sourceCard: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 4,
    gap: 6,
  },
  sourceHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sourceHeaderText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  sourceLocation: {
    marginLeft: "auto",
    fontSize: 11,
    fontWeight: "600",
  },
  sourceQuote: {
    fontSize: 12,
    fontStyle: "italic",
    lineHeight: 18,
  },
  viewInDocBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  viewInDocBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#10B981",
  },
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    borderRadius: 12,
  },
  nextBtnText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "700",
  },

  // ── Complete ──
  completeContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
    gap: 12,
  },
  scoreCard: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 24,
    paddingHorizontal: 20,
    gap: 6,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  rankBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 4,
  },
  rankText: {
    fontSize: 14,
    fontWeight: "700",
  },
  scoreNum: {
    fontSize: 42,
    fontWeight: "800",
    lineHeight: 50,
  },
  scorePct: {
    fontSize: 16,
    fontWeight: "700",
  },
  feedbackSummary: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  feedbackSummaryText: {
    fontSize: 14,
    lineHeight: 21,
  },
  diffBreakdown: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
  },
  diffBreakdownHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  diffRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  diffRowLabel: {
    width: 56,
    fontSize: 13,
    fontWeight: "600",
  },
  diffBarBg: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  diffBarFill: {
    height: "100%",
    borderRadius: 4,
  },
  diffRowCount: {
    width: 36,
    fontSize: 12,
    fontWeight: "600",
    textAlign: "right",
  },
  topicsCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  topicSection: {
    gap: 8,
  },
  topicSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  topicSectionTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  topicTagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  topicTag: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  topicTagText: {
    fontSize: 12,
    fontWeight: "600",
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },

  // ── File Picker Modal ──
  pickerBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.52)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  pickerModal: {
    borderRadius: 18,
    padding: 24,
    width: "87%",
    maxWidth: 400,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 6,
  },
  pickerSub: {
    fontSize: 14,
    marginBottom: 20,
  },
  pickerOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
  },
  pickerOptTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 2,
  },
  pickerOptSub: {
    fontSize: 12,
  },
  pickerCancel: {
    alignItems: "center",
    paddingVertical: 10,
    marginTop: 2,
  },
  pickerCancelText: {
    fontSize: 15,
    fontWeight: "600",
  },
});

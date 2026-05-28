// ============================================
// Gozlin WorkSpace — premium notebook-style environment
// Mix notes, math, charts, AI prompts, and scientific calculations.
// State auto-persists to AsyncStorage and restores exactly on reopen.
// ============================================

import { PINGate } from "@/components/PINGate";
import { PremiumGate } from "@/components/PremiumGate";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { isVoiceAvailable } from "@/services/whisperService";
import { spacing } from "@/constants/theme";
import { colors as appColors } from "@/constants/theme";
import { sendChat, summarize, extractTasks } from "@/services/ai/ai.service";
import { SCHEDULE_PENDING_KEY_PREFIX } from "@/app/schedule-task";
import type { PendingScheduleData } from "@/app/schedule-task";
import { useTheme } from "@/services/ThemeProvider";
import { AppHeaderContainer } from "@/components/AppHeaderContainer";
import { GradientView } from "@/components/GradientView";
import AILogoIcon from "@/components/AIButton/AILogoIcon";
import { API_ENDPOINTS } from "@/config/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  AlarmClock,
  Atom,
  BarChart3,
  Bell,
  BellOff,
  BookOpen,
  Calculator,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Copy as CopyIcon,
  FileText,
  ListChecks,
  Pin,
  Plus,
  Square,
  Sparkles,
  Trash2,
  Wand2,
  Zap,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
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

// ─── Storage ─────────────────────────────────────────────────────────────────
const WORKSPACE_KEY = "@wordsinscribed/ai_workspace_state_v1";
const PINNED_NOTE_KEY = "@wordsinscribed/pinned_note_v1";
const ACCENT = "#9333EA";

// ─── Sticky Note Color Palette ───────────────────────────────────────────────
const STICKY_COLORS = [
  "#1E3A8A", // Deep Blue
  "#6D28D9", // Royal Purple
  "#0F766E", // Teal
  "#4ADE80", // Light Green
  "#D97706", // Amber
  "#B91C1C", // Crimson Red
  "#334155", // Slate Gray
  "#1F2937", // Charcoal
] as const;

function stickyTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#1F2937" : "#F8FAFC";
}

// ─── GozlinScientia categories ───────────────────────────────────────────────
const SCIENTIA_CATEGORIES = [
  { id: "Ask",         label: "Ask",         color: "#a78bfa" },
  { id: "Medical",     label: "Medical",     color: "#f87171" },
  { id: "Chemistry",   label: "Chemistry",   color: "#34d399" },
  { id: "Physics",     label: "Physics",     color: "#60a5fa" },
  { id: "Biology",     label: "Biology",     color: "#4ade80" },
  { id: "Mathematics", label: "Math",        color: "#f59e0b" },
  { id: "Astronomy",   label: "Astronomy",   color: "#818cf8" },
  { id: "Engineering", label: "Engineering", color: "#fb923c" },
  { id: "Conversions", label: "Convert",     color: "#2dd4bf" },
] as const;

type ScientiaCategory = typeof SCIENTIA_CATEGORIES[number]["id"];

function scientiaCatColor(cat: string): string {
  return SCIENTIA_CATEGORIES.find((c) => c.id === cat)?.color ?? "#a78bfa";
}

// ─── Safe expression evaluator ───────────────────────────────────────────────
type Token =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "comma" };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n") { i++; continue; }
    if (c === "(") { out.push({ t: "lp" }); i++; continue; }
    if (c === ")") { out.push({ t: "rp" }); i++; continue; }
    if (c === ",") { out.push({ t: "comma" }); i++; continue; }
    if ("+-*/%^".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    if (/[0-9.]/.test(c)) {
      let s = "";
      while (i < src.length && /[0-9.]/.test(src[i])) { s += src[i]; i++; }
      const n = parseFloat(s);
      if (Number.isNaN(n)) throw new Error(`Invalid number "${s}"`);
      out.push({ t: "num", v: n });
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let s = "";
      while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) { s += src[i]; i++; }
      out.push({ t: "id", v: s });
      continue;
    }
    throw new Error(`Unexpected character "${c}"`);
  }
  return out;
}

const FUNCTIONS: Record<string, (args: number[]) => number> = {
  sum: (a) => a.reduce((x, y) => x + y, 0),
  avg: (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0),
  min: (a) => Math.min(...a),
  max: (a) => Math.max(...a),
  round: (a) => Math.round(a[0] ?? 0),
  abs: (a) => Math.abs(a[0] ?? 0),
  sqrt: (a) => Math.sqrt(a[0] ?? 0),
  pow: (a) => Math.pow(a[0] ?? 0, a[1] ?? 0),
};

function evalExpression(src: string, vars: Record<string, number>): number {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = () => tokens[pos++];

  function parseExpr(minPrec = 0): number {
    let left = parseUnary();
    while (true) {
      const tk = peek();
      if (!tk || tk.t !== "op") break;
      const prec = precedence(tk.v);
      if (prec < minPrec) break;
      eat();
      const right = parseExpr(prec + 1);
      left = apply(tk.v, left, right);
    }
    return left;
  }

  function parseUnary(): number {
    const tk = peek();
    if (tk && tk.t === "op" && (tk.v === "-" || tk.v === "+")) {
      eat();
      const v = parseUnary();
      return tk.v === "-" ? -v : v;
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const tk = eat();
    if (!tk) throw new Error("Unexpected end of expression");
    if (tk.t === "num") return tk.v;
    if (tk.t === "lp") {
      const v = parseExpr();
      const close = eat();
      if (!close || close.t !== "rp") throw new Error("Expected ')'");
      return v;
    }
    if (tk.t === "id") {
      const next = peek();
      if (next && next.t === "lp") {
        eat();
        const args: number[] = [];
        if (peek() && peek().t !== "rp") {
          args.push(parseExpr());
          while (peek() && peek().t === "comma") {
            eat();
            args.push(parseExpr());
          }
        }
        const close = eat();
        if (!close || close.t !== "rp") throw new Error("Expected ')'");
        const fn = FUNCTIONS[tk.v];
        if (!fn) throw new Error(`Unknown function "${tk.v}"`);
        return fn(args);
      }
      if (tk.v in vars) return vars[tk.v];
      if (tk.v === "pi") return Math.PI;
      if (tk.v === "e") return Math.E;
      throw new Error(`Unknown variable "${tk.v}"`);
    }
    throw new Error("Unexpected token");
  }

  function precedence(op: string): number {
    if (op === "+" || op === "-") return 1;
    if (op === "*" || op === "/" || op === "%") return 2;
    if (op === "^") return 3;
    return 0;
  }

  function apply(op: string, a: number, b: number): number {
    switch (op) {
      case "+": return a + b;
      case "-": return a - b;
      case "*": return a * b;
      case "/": return b === 0 ? NaN : a / b;
      case "%": return b === 0 ? NaN : a % b;
      case "^": return Math.pow(a, b);
      default: throw new Error(`Unknown operator "${op}"`);
    }
  }

  const result = parseExpr();
  if (pos < tokens.length) throw new Error("Unexpected trailing tokens");
  return result;
}

// ─── Block types ─────────────────────────────────────────────────────────────

type BlockKind = "note" | "compute" | "chart" | "ai" | "task" | "scientia";

interface BaseBlock {
  id: string;
  kind: BlockKind;
}

interface NoteBlock extends BaseBlock {
  kind: "note";
  text: string;
  color?: string;
  pinned?: boolean;
  sourceLabel?: string;
}

interface ComputeBlock extends BaseBlock {
  kind: "compute";
  name: string;
  expr: string;
  value?: number;
  error?: string;
}

interface ChartBlock extends BaseBlock {
  kind: "chart";
  title: string;
  rawData: string;
}

interface AIBlock extends BaseBlock {
  kind: "ai";
  prompt: string;
  response?: string;
  loading?: boolean;
  error?: string;
}

interface TaskBlock extends BaseBlock {
  kind: "task";
  text: string;
  completed?: boolean;
  reminder?: boolean;
  sourceLabel?: string;
}

interface ScientiaResult {
  category: string;
  title: string;
  result: { value: string; unit?: string; formatted?: string };
  formula?: {
    expression?: string;
    variables?: Array<{ symbol: string; name?: string; value: string; unit?: string }>;
  };
  steps?: string[];
  explanation?: string;
  warnings?: string[];
  confidence?: "high" | "medium" | "low";
  related?: string[];
}

interface ScientiaBlock extends BaseBlock {
  kind: "scientia";
  query: string;
  category: ScientiaCategory;
  result?: ScientiaResult | null;
  loading?: boolean;
  error?: string;
}

type Block = NoteBlock | ComputeBlock | ChartBlock | AIBlock | TaskBlock | ScientiaBlock;

interface PersistedState {
  blocks: Block[];
  lastEditedId: string | null;
  updatedAt: number;
}

let _uid = 0;
const newId = () => `b${Date.now()}_${_uid++}`;

const DEFAULT_BLOCKS = (): Block[] => [
  {
    id: newId(),
    kind: "note",
    text:
      "Welcome to Gozlin WorkSpace.\n\nMix notes, math, charts, AI prompts, and scientific calculations in one persistent document. Tap + to add a block.",
  },
];

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function GozlinWorkspaceScreen() {
  const { colors: t, mode } = useTheme();
  const router = useRouter();
  const { focusPin } = useLocalSearchParams<{ focusPin?: string }>();

  const [blocks, setBlocks] = useState<Block[]>(DEFAULT_BLOCKS);
  const [hydrated, setHydrated] = useState(false);
  const [lastEditedId, setLastEditedId] = useState<string | null>(null);
  const [restoredHint, setRestoredHint] = useState<string | null>(null);
  const [pinnedNoteId, setPinnedNoteId] = useState<string | null>(null);

  // Per-block "Ask AI About This Block" modal
  const [askBlock, setAskBlock] = useState<Block | null>(null);
  const [askPrompt, setAskPrompt] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const blockYRef = useRef<Map<string, number>>(new Map());

  // ── Persistence: load on mount ────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    Promise.all([
      AsyncStorage.getItem(WORKSPACE_KEY),
      AsyncStorage.getItem(PINNED_NOTE_KEY),
    ])
      .then(([raw, pinnedRaw]) => {
        if (!mounted) return;
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as PersistedState;
            if (Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
              setBlocks(parsed.blocks);
              setLastEditedId(parsed.lastEditedId ?? null);
              const minutes = Math.max(
                1,
                Math.round((Date.now() - (parsed.updatedAt || 0)) / 60000),
              );
              setRestoredHint(
                minutes < 60
                  ? `Continuing where you left off · ${minutes}m ago`
                  : `Continuing where you left off`,
              );
              setTimeout(() => setRestoredHint(null), 3500);
            }
          } catch {
            // corrupted state: fall back to default
          }
        }
        if (pinnedRaw) {
          try {
            const rec = JSON.parse(pinnedRaw);
            if (rec?.id) setPinnedNoteId(rec.id);
          } catch {}
        }
        setHydrated(true);
      })
      .catch(() => setHydrated(true));
    return () => { mounted = false; };
  }, []);

  // ── Persistence: save on every change (debounced) ─────────────────────────
  useEffect(() => {
    if (!hydrated) return;
    const handle = setTimeout(() => {
      const snapshot: PersistedState = { blocks, lastEditedId, updatedAt: Date.now() };
      AsyncStorage.setItem(WORKSPACE_KEY, JSON.stringify(snapshot)).catch(() => {});
    }, 350);
    return () => clearTimeout(handle);
  }, [blocks, lastEditedId, hydrated]);

  const computeVars = useMemo(() => {
    const env: Record<string, number> = {};
    for (const b of blocks) {
      if (b.kind === "compute" && b.name && typeof b.value === "number" && !b.error) {
        env[b.name] = b.value;
      }
    }
    return env;
  }, [blocks]);

  const update = useCallback(
    (id: string, patch: Partial<Block>) => {
      setBlocks((prev) =>
        prev.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)),
      );
      setLastEditedId(id);
    },
    [],
  );

  const remove = useCallback((id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const move = useCallback((id: string, dir: -1 | 1) => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx < 0) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const copy = prev.slice();
      const [item] = copy.splice(idx, 1);
      copy.splice(newIdx, 0, item);
      return copy;
    });
  }, []);

  const duplicate = useCallback((id: string) => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx < 0) return prev;
      const original = prev[idx];
      const copy: Block = { ...(original as any), id: newId() };
      if (copy.kind === "ai") {
        (copy as AIBlock).response = undefined;
        (copy as AIBlock).loading = false;
        (copy as AIBlock).error = undefined;
      }
      if (copy.kind === "scientia") {
        (copy as ScientiaBlock).result = undefined;
        (copy as ScientiaBlock).loading = false;
        (copy as ScientiaBlock).error = undefined;
      }
      const next = prev.slice();
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }, []);

  const pinNote = useCallback(
    (id: string) => {
      const block = blocks.find((b) => b.id === id);
      if (!block || block.kind !== "note") return;
      setBlocks((prev) =>
        prev.map((b) =>
          b.kind === "note"
            ? ({ ...b, pinned: b.id === id } as NoteBlock)
            : b,
        ),
      );
      setPinnedNoteId(id);
      const record = {
        id,
        color: (block as NoteBlock).color ?? STICKY_COLORS[0],
        textSnippet: (block as NoteBlock).text.slice(0, 60),
      };
      AsyncStorage.setItem(PINNED_NOTE_KEY, JSON.stringify(record)).catch(() => {});
      DeviceEventEmitter.emit("pinnedNoteUpdated", record);
    },
    [blocks],
  );

  const unpinNote = useCallback(() => {
    setBlocks((prev) =>
      prev.map((b) =>
        b.kind === "note" && (b as NoteBlock).pinned
          ? ({ ...b, pinned: false } as NoteBlock)
          : b,
      ),
    );
    setPinnedNoteId(null);
    AsyncStorage.removeItem(PINNED_NOTE_KEY).catch(() => {});
    DeviceEventEmitter.emit("pinnedNoteUpdated", null);
  }, []);

  const prevPinnedColorRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!hydrated || !pinnedNoteId) return;
    const block = blocks.find((b) => b.id === pinnedNoteId);
    if (!block || block.kind !== "note") return;
    const nb = block as NoteBlock;
    if (nb.color === prevPinnedColorRef.current) return;
    prevPinnedColorRef.current = nb.color;
    const record = {
      id: pinnedNoteId,
      color: nb.color ?? STICKY_COLORS[0],
      textSnippet: nb.text.slice(0, 60),
    };
    AsyncStorage.setItem(PINNED_NOTE_KEY, JSON.stringify(record)).catch(() => {});
    DeviceEventEmitter.emit("pinnedNoteUpdated", record);
  }, [blocks, pinnedNoteId, hydrated]);

  const addBlock = useCallback((kind: BlockKind) => {
    const base: Block =
      kind === "note"
        ? { id: newId(), kind: "note", text: "" }
        : kind === "compute"
          ? { id: newId(), kind: "compute", name: "", expr: "" }
          : kind === "chart"
            ? { id: newId(), kind: "chart", title: "Untitled chart", rawData: "" }
            : kind === "task"
              ? { id: newId(), kind: "task", text: "", completed: false, reminder: false }
              : kind === "scientia"
                ? { id: newId(), kind: "scientia", query: "", category: "Ask" }
                : { id: newId(), kind: "ai", prompt: "" };
    setBlocks((prev) => [...prev, base]);
    setLastEditedId(base.id);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  // ── Voice → instant note ──────────────────────────────────────────────────
  // Dictate a thought/meeting/lecture and drop it straight in as a new note
  // block. From there the existing "To summary" / "To tasks" actions take over.
  const addVoiceNote = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const base: NoteBlock = { id: newId(), kind: "note", text: trimmed };
    setBlocks((prev) => [...prev, base]);
    setLastEditedId(base.id);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
  }, []);

  const runCompute = useCallback(
    (id: string) => {
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== id || b.kind !== "compute") return b;
          if (!b.expr.trim()) return { ...b, value: undefined, error: undefined };
          try {
            const v = evalExpression(b.expr, computeVars);
            return { ...b, value: v, error: undefined };
          } catch (e: any) {
            return { ...b, value: undefined, error: e?.message || "Error" };
          }
        }),
      );
    },
    [computeVars],
  );

  const buildContextBefore = useCallback(
    (id: string): string => {
      const idx = blocks.findIndex((b) => b.id === id);
      if (idx <= 0) return "";
      const lines: string[] = [];
      for (let i = 0; i < idx; i++) {
        const b = blocks[i];
        if (b.kind === "note" && b.text.trim()) {
          lines.push(`Note: ${b.text.trim()}`);
        } else if (b.kind === "task" && (b as TaskBlock).text.trim()) {
          lines.push(`Task: ${(b as TaskBlock).text.trim()}`);
        } else if (b.kind === "compute" && b.name && typeof b.value === "number") {
          lines.push(`${b.name} = ${b.value}`);
        } else if (b.kind === "ai" && b.response) {
          lines.push(`Earlier AI answer: ${b.response.trim()}`);
        } else if (b.kind === "scientia" && (b as ScientiaBlock).result) {
          const sr = (b as ScientiaBlock).result!;
          lines.push(
            `Scientific: ${(b as ScientiaBlock).query} → ${sr.result?.formatted || sr.result?.value || ""}`,
          );
        }
      }
      const joined = lines.join("\n").trim();
      if (joined.length > 2400) return joined.slice(joined.length - 2400);
      return joined;
    },
    [blocks],
  );

  const runAI = useCallback(
    async (id: string) => {
      const block = blocks.find((b) => b.id === id);
      if (!block || block.kind !== "ai" || !block.prompt.trim()) return;
      update(id, { loading: true, error: undefined, response: undefined });
      try {
        const ctx = buildContextBefore(id);
        const promptWithCtx = ctx
          ? `Workspace context:\n${ctx}\n\n---\nMy question: ${block.prompt}`
          : block.prompt;
        const res = await sendChat(promptWithCtx, []);
        update(id, { response: res.content, loading: false });
      } catch (e: any) {
        update(id, { error: e?.message || "Failed", loading: false });
      }
    },
    [blocks, update, buildContextBefore],
  );

  // ── GozlinScientia: run calculation ──────────────────────────────────────
  const runScientia = useCallback(
    async (id: string, queryOverride?: string) => {
      const block = blocks.find((b) => b.id === id);
      if (!block || block.kind !== "scientia") return;
      const sb = block as ScientiaBlock;
      const queryToUse = queryOverride ?? sb.query;
      if (!queryToUse.trim()) return;
      update(id, { loading: true, error: undefined, result: undefined });
      try {
        const res = await fetch(API_ENDPOINTS.SCIENTIFIC_CALC.CALCULATE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: queryToUse.trim(),
            category: sb.category !== "Ask" ? sb.category : null,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || "Calculation failed");
        update(id, { result: json.data, loading: false });
      } catch (e: any) {
        update(id, { error: e?.message || "Calculation failed", loading: false });
      }
    },
    [blocks, update],
  );

  const convertBlock = useCallback(
    async (id: string, mode: "summary" | "tasks") => {
      const src = blocks.find((b) => b.id === id);
      if (!src || src.kind !== "note" || !src.text.trim()) return;

      const aiBlock: AIBlock = {
        id: newId(),
        kind: "ai",
        prompt:
          mode === "summary"
            ? `Summarize the following:\n\n${src.text}`
            : `Extract action items from:\n\n${src.text}`,
        loading: true,
      };

      setBlocks((prev) => {
        const idx = prev.findIndex((b) => b.id === id);
        if (idx < 0) return prev;
        const next = prev.slice();
        next.splice(idx + 1, 0, aiBlock);
        return next;
      });

      try {
        const res =
          mode === "summary"
            ? await summarize(src.text)
            : await extractTasks(src.text);
        setBlocks((prev) =>
          prev.map((b) =>
            b.id === aiBlock.id
              ? ({ ...b, loading: false, response: res.content } as AIBlock)
              : b,
          ),
        );
      } catch (e: any) {
        setBlocks((prev) =>
          prev.map((b) =>
            b.id === aiBlock.id
              ? ({ ...b, loading: false, error: e?.message || "Conversion failed" } as AIBlock)
              : b,
          ),
        );
      }
    },
    [blocks],
  );

  const saveScientiaNote = useCallback((blockId: string, noteText: string) => {
    const randomColor = STICKY_COLORS[Math.floor(Math.random() * STICKY_COLORS.length)];
    const noteBlock: NoteBlock = {
      id: newId(),
      kind: "note",
      text: noteText,
      color: randomColor,
      sourceLabel: "⚠ GozlinScientia Safety Note",
    };
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === blockId);
      if (idx < 0) return [...prev, noteBlock];
      const next = prev.slice();
      next.splice(idx + 1, 0, noteBlock);
      return next;
    });
  }, []);

  const askAboutBlock = useCallback((b: Block) => {
    setAskBlock(b);
    setAskPrompt("");
    setAskError(null);
  }, []);

  const submitAskBlock = useCallback(async () => {
    if (!askBlock || !askPrompt.trim() || askLoading) return;
    setAskLoading(true);
    setAskError(null);
    try {
      const blockText =
        askBlock.kind === "note"
          ? askBlock.text
          : askBlock.kind === "task"
            ? (askBlock as TaskBlock).text
            : askBlock.kind === "compute"
              ? `${askBlock.name || "expr"} = ${askBlock.expr}${
                  typeof askBlock.value === "number" ? ` → ${askBlock.value}` : ""
                }`
              : askBlock.kind === "ai"
                ? `Q: ${askBlock.prompt}\n\nA: ${askBlock.response || ""}`
                : askBlock.kind === "scientia"
                  ? `Scientific query: ${(askBlock as ScientiaBlock).query}\nResult: ${
                      (askBlock as ScientiaBlock).result?.result?.formatted || ""
                    }`
                  : `Chart: ${(askBlock as ChartBlock).title}\n${(askBlock as ChartBlock).rawData}`;

      const prompt = `Use only the following block as the source:\n\n"""\n${blockText}\n"""\n\nQuestion: ${askPrompt.trim()}`;
      const res = await sendChat(prompt, []);

      const aiBlock: AIBlock = {
        id: newId(),
        kind: "ai",
        prompt: askPrompt.trim(),
        response: res.content,
      };
      setBlocks((prev) => {
        const idx = prev.findIndex((b) => b.id === askBlock.id);
        if (idx < 0) return [...prev, aiBlock];
        const next = prev.slice();
        next.splice(idx + 1, 0, aiBlock);
        return next;
      });
      setAskBlock(null);
      setAskPrompt("");
    } catch (e: any) {
      setAskError(e?.message || "Failed to ask AI");
    } finally {
      setAskLoading(false);
    }
  }, [askBlock, askPrompt, askLoading]);

  useEffect(() => {
    if (!hydrated) return;
    if (focusPin === "1" && pinnedNoteId) {
      setTimeout(() => {
        const y = blockYRef.current.get(pinnedNoteId);
        if (y !== undefined) {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
        }
      }, 350);
      return;
    }
    if (!lastEditedId) return;
    const idx = blocks.findIndex((b) => b.id === lastEditedId);
    if (idx === blocks.length - 1) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 220);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  return (
    <PremiumGate
      feature="Gozlin WorkSpace"
      description="The AI-powered notebook is a Premium feature."
    >
    <PINGate screen="gozlin">
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]}>
      {/* ── Gradient header matching app-wide design ── */}
      <AppHeaderContainer>
        <GradientView
          colors={[appColors.gradientStart, appColors.gradientMid, appColors.gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
          >
            <ChevronLeft color="#fff" size={24} strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <AILogoIcon size={18} color="#fff" />
            <View>
              <Text style={styles.headerTitle}>Gozlin WorkSpace</Text>
              <Text style={styles.headerSubtitle}>Notes · Math · Charts · AI · Science</Text>
            </View>
          </View>
          <View style={{ width: 40 }} />
        </GradientView>
      </AppHeaderContainer>

      {restoredHint ? (
        <View
          style={[
            styles.restoredStrip,
            { backgroundColor: mode === "dark" ? "#1E1B4B" : "#FAF5FF" },
          ]}
        >
          <Sparkles color={ACCENT} size={13} />
          <Text style={[styles.restoredStripText, { color: ACCENT }]}>
            {restoredHint}
          </Text>
        </View>
      ) : null}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          {blocks.map((b, i) => (
            <React.Fragment key={b.id}>
              <View
                onLayout={(e) =>
                  blockYRef.current.set(b.id, e.nativeEvent.layout.y)
                }
              >
                <BlockCard
                  block={b}
                  index={i}
                  total={blocks.length}
                  onUpdate={update}
                  onRemove={remove}
                  onMove={move}
                  onDuplicate={duplicate}
                  onRunCompute={runCompute}
                  onRunAI={runAI}
                  onRunScientia={runScientia}
                  onSaveScientiaNote={saveScientiaNote}
                  onAskAboutBlock={askAboutBlock}
                  onConvert={convertBlock}
                  onPinNote={pinNote}
                  onUnpinNote={unpinNote}
                  pinnedNoteId={pinnedNoteId}
                  mode={mode}
                  t={t}
                />
              </View>
              {i < blocks.length - 1 ? (
                <View
                  style={[
                    styles.blockSeparator,
                    {
                      backgroundColor:
                        mode === "dark" ? "rgba(148,163,184,0.18)" : "rgba(15,23,42,0.08)",
                    },
                  ]}
                />
              ) : null}
            </React.Fragment>
          ))}

          {blocks.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyTitle, { color: t.textSecondary }]}>
                Empty workspace
              </Text>
              <Text style={[styles.emptyHint, { color: t.textTertiary }]}>
                Tap + below to add your first block.
              </Text>
            </View>
          ) : null}

          <View style={{ height: spacing.xl }} />
        </ScrollView>

        <AddBar onAdd={addBlock} onVoiceNote={addVoiceNote} t={t} mode={mode} />
      </KeyboardAvoidingView>

      {/* ── Ask AI About This Block modal ────────────────────────────── */}
      <Modal
        visible={askBlock !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setAskBlock(null);
          setAskPrompt("");
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={styles.modalBackdrop}
            onPress={() => {
              if (!askLoading) {
                setAskBlock(null);
                setAskPrompt("");
              }
            }}
          >
            <View
              style={[
                styles.askModal,
                {
                  backgroundColor: mode === "dark" ? "#0F172A" : "#FFFFFF",
                  borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
                },
              ]}
              onStartShouldSetResponder={() => true}
            >
              <Text style={[styles.askTitle, { color: t.text }]}>
                Ask AI about this block
              </Text>
              <Text style={[styles.askSub, { color: t.textTertiary }]}>
                The AI will answer based ONLY on the selected block.
              </Text>
              <TextInput
                value={askPrompt}
                onChangeText={setAskPrompt}
                placeholder="e.g. Summarize this, or what's the main point?"
                placeholderTextColor={t.textTertiary}
                multiline
                style={[
                  styles.askInput,
                  {
                    color: t.text,
                    backgroundColor: mode === "dark" ? "#1E293B" : "#F8FAFC",
                  },
                ]}
              />
              {askError ? (
                <Text style={[styles.errorText, { color: "#EF4444" }]}>
                  ⚠ {askError}
                </Text>
              ) : null}
              <View style={styles.askActions}>
                <TouchableOpacity
                  onPress={() => {
                    if (askLoading) return;
                    setAskBlock(null);
                    setAskPrompt("");
                  }}
                  style={[
                    styles.askBtn,
                    { backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9" },
                  ]}
                >
                  <Text style={[styles.askBtnText, { color: t.text }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={submitAskBlock}
                  disabled={askLoading || !askPrompt.trim()}
                  style={[
                    styles.askBtn,
                    {
                      backgroundColor: ACCENT,
                      opacity: askLoading || !askPrompt.trim() ? 0.5 : 1,
                    },
                  ]}
                >
                  {askLoading ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <Text style={[styles.askBtnText, { color: "#FFF" }]}>Ask AI</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
    </PINGate>
    </PremiumGate>
  );
}

// ─── Block Card ──────────────────────────────────────────────────────────────

interface BlockCardProps {
  block: Block;
  index: number;
  total: number;
  onUpdate: (id: string, patch: Partial<Block>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  onRunCompute: (id: string) => void;
  onRunAI: (id: string) => void;
  onRunScientia: (id: string, queryOverride?: string) => void;
  onSaveScientiaNote: (blockId: string, noteText: string) => void;
  onAskAboutBlock: (b: Block) => void;
  onConvert: (id: string, mode: "summary" | "tasks") => void;
  onPinNote: (id: string) => void;
  onUnpinNote: () => void;
  pinnedNoteId: string | null;
  mode: "light" | "dark";
  t: any;
}

function BlockCard({
  block,
  index,
  total,
  onUpdate,
  onRemove,
  onMove,
  onDuplicate,
  onRunCompute,
  onRunAI,
  onRunScientia,
  onSaveScientiaNote,
  onAskAboutBlock,
  onConvert,
  onPinNote,
  onUnpinNote,
  pinnedNoteId,
  mode,
  t,
}: BlockCardProps) {
  const noteColor = block.kind === "note" ? (block as NoteBlock).color : undefined;
  const isPinned = block.kind === "note" && pinnedNoteId === block.id;
  const cardBg = noteColor
    ? `${noteColor}${mode === "dark" ? "55" : "28"}`
    : mode === "dark" ? "#0F172A" : "#FFFFFF";
  const borderColor = noteColor
    ? `${noteColor}${mode === "dark" ? "99" : "66"}`
    : mode === "dark" ? "#334155" : "#E2E8F0";
  const [showActions, setShowActions] = useState(false);

  const canConvert = block.kind === "note" && (block as NoteBlock).text.trim().length > 30;

  const kindLabel =
    block.kind === "scientia" ? "GozlinScientia" : block.kind.toUpperCase();

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
      <View style={styles.cardHeader}>
        <BlockIcon kind={block.kind} />
        <Text style={[styles.cardKind, { color: t.textSecondary }]}>{kindLabel}</Text>
        <View style={{ flex: 1 }} />

        <TouchableOpacity
          onPress={() => onAskAboutBlock(block)}
          style={[styles.iconBtn, styles.askPill, { backgroundColor: `${ACCENT}18` }]}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Zap color={ACCENT} size={12} strokeWidth={2.5} />
          <Text style={styles.askPillText}>Ask AI</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setShowActions((v) => !v)}
          style={styles.iconBtn}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={{ color: t.textSecondary, fontSize: 18, lineHeight: 18 }}>⋯</Text>
        </TouchableOpacity>
      </View>

      {showActions ? (
        <View
          style={[
            styles.actionRow,
            { backgroundColor: mode === "dark" ? "#1E293B" : "#F8FAFC" },
          ]}
        >
          <TouchableOpacity
            onPress={() => onMove(block.id, -1)}
            disabled={index === 0}
            style={styles.actionBtn}
          >
            <ChevronUp color={index === 0 ? t.textTertiary : t.textSecondary} size={14} />
            <Text style={[styles.actionBtnText, { color: index === 0 ? t.textTertiary : t.textSecondary }]}>Up</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onMove(block.id, 1)}
            disabled={index === total - 1}
            style={styles.actionBtn}
          >
            <ChevronDown color={index === total - 1 ? t.textTertiary : t.textSecondary} size={14} />
            <Text style={[styles.actionBtnText, { color: index === total - 1 ? t.textTertiary : t.textSecondary }]}>Down</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { onDuplicate(block.id); setShowActions(false); }}
            style={styles.actionBtn}
          >
            <CopyIcon color={t.textSecondary} size={14} />
            <Text style={[styles.actionBtnText, { color: t.textSecondary }]}>Duplicate</Text>
          </TouchableOpacity>
          {canConvert ? (
            <>
              <TouchableOpacity
                onPress={() => { onConvert(block.id, "summary"); setShowActions(false); }}
                style={styles.actionBtn}
              >
                <BookOpen color="#2563EB" size={14} />
                <Text style={[styles.actionBtnText, { color: "#2563EB" }]}>To summary</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { onConvert(block.id, "tasks"); setShowActions(false); }}
                style={styles.actionBtn}
              >
                <ListChecks color="#06B6D4" size={14} />
                <Text style={[styles.actionBtnText, { color: "#06B6D4" }]}>To tasks</Text>
              </TouchableOpacity>
            </>
          ) : null}
          <TouchableOpacity
            onPress={() => { onRemove(block.id); setShowActions(false); }}
            style={styles.actionBtn}
          >
            <Trash2 color="#EF4444" size={14} />
            <Text style={[styles.actionBtnText, { color: "#EF4444" }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {block.kind === "note" ? (
        <>
          <View style={styles.stickyToolbar}>
            {STICKY_COLORS.map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() =>
                  onUpdate(block.id, {
                    color: (block as NoteBlock).color === c ? undefined : c,
                  } as Partial<Block>)
                }
                style={[
                  styles.swatch,
                  {
                    backgroundColor: c,
                    borderWidth: (block as NoteBlock).color === c ? 2.5 : 0,
                    borderColor: "#FFFFFF",
                    transform: [{ scale: (block as NoteBlock).color === c ? 1.15 : 1 }],
                  },
                ]}
              />
            ))}
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              onPress={() => isPinned ? onUnpinNote() : onPinNote(block.id)}
              style={[styles.pinBtn, isPinned && { backgroundColor: "#F59E0B22" }]}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Pin
                size={13}
                color={isPinned ? "#F59E0B" : t.textTertiary}
                strokeWidth={2.4}
                fill={isPinned ? "#F59E0B" : "none"}
              />
            </TouchableOpacity>
          </View>
          <View style={styles.fieldWrap}>
            <TextInput
              value={(block as NoteBlock).text}
              onChangeText={(v) => onUpdate(block.id, { text: v } as Partial<Block>)}
              placeholder="Write a note…"
              placeholderTextColor={
                noteColor ? `${stickyTextColor(noteColor)}88` : t.textTertiary
              }
              multiline
              style={[
                styles.textArea,
                {
                  color: noteColor ? stickyTextColor(noteColor) : t.text,
                  backgroundColor: noteColor
                    ? `${noteColor}${mode === "dark" ? "44" : "22"}`
                    : mode === "dark" ? "#1E293B" : "#F8FAFC",
                  paddingRight: 38,
                },
              ]}
            />
            <FieldMic
              current={(block as NoteBlock).text}
              onText={(next) => onUpdate(block.id, { text: next } as Partial<Block>)}
            />
          </View>
          {(block as NoteBlock).sourceLabel ? (
            <Text
              style={{
                fontSize: 11,
                color: noteColor ? `${stickyTextColor(noteColor)}99` : t.textTertiary,
                fontStyle: "italic",
                marginTop: 2,
              }}
              numberOfLines={1}
            >
              {(block as NoteBlock).sourceLabel}
            </Text>
          ) : null}
        </>
      ) : null}

      {block.kind === "compute" ? (
        <ComputeBody block={block} onUpdate={onUpdate} onRun={onRunCompute} t={t} mode={mode} />
      ) : null}

      {block.kind === "chart" ? (
        <ChartBody block={block} onUpdate={onUpdate} t={t} mode={mode} />
      ) : null}

      {block.kind === "ai" ? (
        <AIBody block={block} onUpdate={onUpdate} onRun={onRunAI} t={t} mode={mode} />
      ) : null}

      {block.kind === "task" ? (
        <TaskBody block={block as TaskBlock} onUpdate={onUpdate} t={t} mode={mode} />
      ) : null}

      {block.kind === "scientia" ? (
        <ScientiaBody
          block={block as ScientiaBlock}
          onUpdate={onUpdate}
          onRun={onRunScientia}
          onSaveNote={(text) => onSaveScientiaNote(block.id, text)}
          t={t}
          mode={mode}
        />
      ) : null}
    </View>
  );
}

function BlockIcon({ kind }: { kind: BlockKind }) {
  const color =
    kind === "note" ? "#6366F1" :
    kind === "compute" ? "#10B981" :
    kind === "chart" ? "#F59E0B" :
    kind === "task" ? "#06B6D4" :
    kind === "scientia" ? "#0EA5E9" :
    "#9333EA";
  const Icon =
    kind === "note" ? FileText :
    kind === "compute" ? Calculator :
    kind === "chart" ? BarChart3 :
    kind === "task" ? ListChecks :
    kind === "scientia" ? Atom :
    Wand2;
  return (
    <View style={[styles.iconBadge, { backgroundColor: `${color}22` }]}>
      <Icon color={color} size={12} strokeWidth={2.4} />
    </View>
  );
}

// ─── Inline dictation mic (additive; reuses the shared VoiceInputButton) ─────
// Floats in the bottom-right corner of a block's text field and APPENDS the
// transcribed text to whatever is already there. Renders nothing on builds
// where on-device voice isn't available (VoiceInputButton self-hides), so the
// field keeps working exactly as before. This does not alter any existing flow.
function FieldMic({
  current,
  onText,
  disabled,
}: {
  current: string;
  onText: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <VoiceInputButton
      size={15}
      color={ACCENT}
      disabled={disabled}
      onTranscribed={(text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const base = current && current.trim() ? `${current} ` : "";
        onText(`${base}${trimmed}`);
      }}
      onError={(msg) => Alert.alert("Voice", msg)}
      style={styles.fieldMic}
    />
  );
}

// ─── Compute body ────────────────────────────────────────────────────────────

function ComputeBody({
  block, onUpdate, onRun, t, mode,
}: {
  block: ComputeBlock;
  onUpdate: (id: string, patch: Partial<Block>) => void;
  onRun: (id: string) => void;
  t: any;
  mode: "light" | "dark";
}) {
  const bg = mode === "dark" ? "#1E293B" : "#F8FAFC";
  return (
    <View style={styles.computeWrap}>
      <View style={styles.computeRow}>
        <TextInput
          value={block.name}
          onChangeText={(v) => onUpdate(block.id, { name: v.replace(/[^a-zA-Z0-9_]/g, "") } as Partial<Block>)}
          placeholder="name"
          placeholderTextColor={t.textTertiary}
          style={[styles.computeName, { color: t.text, backgroundColor: bg }]}
        />
        <Text style={[styles.eq, { color: t.textSecondary }]}>=</Text>
        <TextInput
          value={block.expr}
          onChangeText={(v) => onUpdate(block.id, { expr: v } as Partial<Block>)}
          onBlur={() => onRun(block.id)}
          onSubmitEditing={() => onRun(block.id)}
          placeholder="2 * 3 + sum(10, 20)"
          placeholderTextColor={t.textTertiary}
          style={[styles.computeExpr, { color: t.text, backgroundColor: bg }]}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <TouchableOpacity
        onPress={() => onRun(block.id)}
        style={[styles.runBtn, { backgroundColor: "#10B981" }]}
      >
        <Sparkles color="#FFF" size={13} />
        <Text style={styles.runBtnText}>Compute</Text>
      </TouchableOpacity>
      {block.error ? (
        <Text style={[styles.errorText, { color: "#EF4444" }]}>⚠ {block.error}</Text>
      ) : typeof block.value === "number" ? (
        <View style={[styles.resultPill, { backgroundColor: "#10B98122" }]}>
          <Text style={[styles.resultLabel, { color: "#10B981" }]}>Result</Text>
          <Text style={[styles.resultValue, { color: t.text }]}>{formatNumber(block.value)}</Text>
        </View>
      ) : null}
    </View>
  );
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

// ─── Chart body ──────────────────────────────────────────────────────────────

interface ChartPoint { label: string; value: number; }

function parseChartData(raw: string): ChartPoint[] {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const points: ChartPoint[] = [];
  for (const line of lines) {
    const parts = line.split(/[,\t]/).map((p) => p.trim());
    if (parts.length < 2) continue;
    const label = parts[0];
    const num = parseFloat(parts[1]);
    if (!label || Number.isNaN(num)) continue;
    points.push({ label, value: num });
  }
  return points;
}

function ChartBody({
  block, onUpdate, t, mode,
}: {
  block: ChartBlock;
  onUpdate: (id: string, patch: Partial<Block>) => void;
  t: any;
  mode: "light" | "dark";
}) {
  const bg = mode === "dark" ? "#1E293B" : "#F8FAFC";
  const points = useMemo(() => parseChartData(block.rawData), [block.rawData]);
  const max = points.length ? Math.max(...points.map((p) => p.value)) : 0;
  const min = points.length ? Math.min(0, ...points.map((p) => p.value)) : 0;
  const range = max - min || 1;

  return (
    <View style={{ gap: 8 }}>
      <TextInput
        value={block.title}
        onChangeText={(v) => onUpdate(block.id, { title: v } as Partial<Block>)}
        placeholder="Chart title"
        placeholderTextColor={t.textTertiary}
        style={[styles.chartTitle, { color: t.text, backgroundColor: bg }]}
      />
      <TextInput
        value={block.rawData}
        onChangeText={(v) => onUpdate(block.id, { rawData: v } as Partial<Block>)}
        placeholder={"Jan, 120\nFeb, 180\nMar, 240\nApr, 160"}
        placeholderTextColor={t.textTertiary}
        multiline
        style={[styles.chartData, { color: t.text, backgroundColor: bg }]}
      />
      {points.length === 0 ? (
        <Text style={{ color: t.textTertiary, fontSize: 12, fontStyle: "italic" }}>
          Enter "label, value" per line to build the chart.
        </Text>
      ) : (
        <View style={styles.chartArea}>
          {points.map((p, idx) => {
            const pct = Math.max(2, ((p.value - min) / range) * 100);
            return (
              <View key={idx} style={styles.chartRow}>
                <Text style={[styles.chartLabel, { color: t.textSecondary }]} numberOfLines={1}>
                  {p.label}
                </Text>
                <View style={[styles.chartTrack, { backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9" }]}>
                  <View
                    style={[
                      styles.chartBar,
                      { width: `${pct}%`, backgroundColor: `hsl(${(idx * 50) % 360}, 70%, 55%)` },
                    ]}
                  />
                </View>
                <Text style={[styles.chartValue, { color: t.text }]}>{formatNumber(p.value)}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ─── AI body ─────────────────────────────────────────────────────────────────

function AIBody({
  block, onUpdate, onRun, t, mode,
}: {
  block: AIBlock;
  onUpdate: (id: string, patch: Partial<Block>) => void;
  onRun: (id: string) => void;
  t: any;
  mode: "light" | "dark";
}) {
  const bg = mode === "dark" ? "#1E293B" : "#F8FAFC";
  const router = useRouter();
  const handleSchedule = useCallback(async () => {
    if (!block.prompt.trim()) return;
    const key = `${Date.now()}`;
    const taskTitle = block.prompt.length > 50 ? block.prompt.slice(0, 47) + "…" : block.prompt;
    const pending: PendingScheduleData = {
      type: "workspace_ai",
      title: taskTitle,
      payload: {
        type: "workspace_ai",
        data: { prompt: block.prompt, contextSnapshot: "" },
      },
    };
    await AsyncStorage.setItem(SCHEDULE_PENDING_KEY_PREFIX + key, JSON.stringify(pending));
    router.push({ pathname: "/schedule-task", params: { pendingKey: key, taskType: "workspace_ai", taskTitle } } as any);
  }, [block.prompt]);

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.fieldWrap}>
        <TextInput
          value={block.prompt}
          onChangeText={(v) => onUpdate(block.id, { prompt: v } as Partial<Block>)}
          placeholder="Ask gozlin anything…"
          placeholderTextColor={t.textTertiary}
          multiline
          style={[styles.textArea, { color: t.text, backgroundColor: bg, paddingRight: 38 }]}
        />
        <FieldMic
          current={block.prompt}
          onText={(next) => onUpdate(block.id, { prompt: next } as Partial<Block>)}
          disabled={block.loading}
        />
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <TouchableOpacity
          onPress={() => onRun(block.id)}
          disabled={block.loading || !block.prompt.trim()}
          style={[
            styles.runBtn,
            { flex: 2, backgroundColor: ACCENT, opacity: block.loading || !block.prompt.trim() ? 0.5 : 1 },
          ]}
        >
          {block.loading ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <Sparkles color="#FFF" size={13} />
          )}
          <Text style={styles.runBtnText}>{block.loading ? "Thinking…" : "Run"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSchedule}
          disabled={!block.prompt.trim()}
          style={[styles.deferBtn, { opacity: block.prompt.trim() ? 1 : 0.4 }]}
        >
          <AlarmClock size={14} color={ACCENT} />
          <Text style={[styles.deferBtnText, { color: ACCENT }]}>Schedule</Text>
        </TouchableOpacity>
      </View>

      {block.error ? (
        <Text style={[styles.errorText, { color: "#EF4444" }]}>⚠ {block.error}</Text>
      ) : null}
      {block.response ? (
        <View style={[styles.aiResponse, { backgroundColor: mode === "dark" ? "#1E1B4B" : "#FAF5FF" }]}>
          <Text style={{ color: t.text, fontSize: 13, lineHeight: 19 }}>{block.response}</Text>
        </View>
      ) : null}

    </View>
  );
}

// ─── Task body ───────────────────────────────────────────────────────────────

function TaskBody({
  block, onUpdate, t, mode,
}: {
  block: TaskBlock;
  onUpdate: (id: string, patch: Partial<Block>) => void;
  t: any;
  mode: "light" | "dark";
}) {
  const bg = mode === "dark" ? "#1E293B" : "#F8FAFC";
  const isDone = !!block.completed;
  const hasReminder = !!block.reminder;

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.taskBodyRow}>
        <TouchableOpacity
          onPress={() => onUpdate(block.id, { completed: !isDone } as Partial<Block>)}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          {isDone ? (
            <CheckSquare size={20} color="#06B6D4" />
          ) : (
            <Square size={20} color={t.textSecondary} />
          )}
        </TouchableOpacity>
        <TextInput
          value={block.text}
          onChangeText={(v) => onUpdate(block.id, { text: v } as Partial<Block>)}
          placeholder="What needs to be done?"
          placeholderTextColor={t.textTertiary}
          multiline
          style={[
            styles.taskBodyInput,
            {
              color: t.text,
              backgroundColor: bg,
              textDecorationLine: isDone ? "line-through" : "none",
              opacity: isDone ? 0.6 : 1,
              paddingRight: 36,
            },
          ]}
        />
        <FieldMic
          current={block.text}
          onText={(next) => onUpdate(block.id, { text: next } as Partial<Block>)}
        />
      </View>
      <TouchableOpacity
        onPress={() => onUpdate(block.id, { reminder: !hasReminder } as Partial<Block>)}
        activeOpacity={0.7}
        style={[
          styles.taskReminderBtn,
          {
            backgroundColor: hasReminder ? "#06B6D41A" : mode === "dark" ? "#1E293B" : "#F8FAFC",
            borderColor: hasReminder ? "#06B6D4" : mode === "dark" ? "#334155" : "#E2E8F0",
          },
        ]}
      >
        {hasReminder ? (
          <Bell size={12} color="#06B6D4" />
        ) : (
          <BellOff size={12} color={t.textTertiary} />
        )}
        <Text style={{ fontSize: 11, fontWeight: "600", color: hasReminder ? "#06B6D4" : t.textSecondary }}>
          {hasReminder ? "Reminder set" : "Set reminder"}
        </Text>
      </TouchableOpacity>
      {block.sourceLabel ? (
        <Text style={{ fontSize: 10.5, color: t.textTertiary, fontStyle: "italic" }} numberOfLines={1}>
          {block.sourceLabel}
        </Text>
      ) : null}
    </View>
  );
}

// ─── GozlinScientia: formula templates & conversion data ─────────────────────

interface ScientiaFormulaVar { key: string; label: string; unit?: string; placeholder: string; }
interface ScientiaFormula { id: string; label: string; vars: ScientiaFormulaVar[]; buildQuery: (v: Record<string, string>) => string; }

const SCIENCE_TEMPLATES: Partial<Record<string, ScientiaFormula[]>> = {
  Physics: [
    { id: "f_ma", label: "F = ma", vars: [{key:"m",label:"Mass",unit:"kg",placeholder:"10"},{key:"a",label:"Accel.",unit:"m/s²",placeholder:"9.8"}], buildQuery: v => `Newton's 2nd law: mass = ${v.m||"?"} kg, acceleration = ${v.a||"?"} m/s²` },
    { id: "ke", label: "KE = ½mv²", vars: [{key:"m",label:"Mass",unit:"kg",placeholder:"5"},{key:"v",label:"Velocity",unit:"m/s",placeholder:"10"}], buildQuery: v => `Kinetic energy: mass = ${v.m||"?"} kg, velocity = ${v.v||"?"} m/s` },
    { id: "ohm", label: "V = IR", vars: [{key:"I",label:"Current",unit:"A",placeholder:"2"},{key:"R",label:"Resistance",unit:"Ω",placeholder:"5"}], buildQuery: v => `Ohm's law: find voltage, current = ${v.I||"?"} A, resistance = ${v.R||"?"} Ω` },
    { id: "pe", label: "PE = mgh", vars: [{key:"m",label:"Mass",unit:"kg",placeholder:"10"},{key:"h",label:"Height",unit:"m",placeholder:"5"}], buildQuery: v => `Gravitational potential energy: mass = ${v.m||"?"} kg, height = ${v.h||"?"} m` },
    { id: "vel", label: "v = u + at", vars: [{key:"u",label:"Init v",unit:"m/s",placeholder:"0"},{key:"a",label:"Accel.",unit:"m/s²",placeholder:"9.8"},{key:"t",label:"Time",unit:"s",placeholder:"3"}], buildQuery: v => `Final velocity: u = ${v.u||"?"} m/s, a = ${v.a||"?"} m/s², t = ${v.t||"?"} s` },
    { id: "power", label: "P = IV", vars: [{key:"I",label:"Current",unit:"A",placeholder:"5"},{key:"V",label:"Voltage",unit:"V",placeholder:"12"}], buildQuery: v => `Electrical power: current = ${v.I||"?"} A, voltage = ${v.V||"?"} V` },
  ],
  Chemistry: [
    { id: "molarity", label: "Molarity M=n/V", vars: [{key:"n",label:"Moles",unit:"mol",placeholder:"0.5"},{key:"V",label:"Volume",unit:"L",placeholder:"1"}], buildQuery: v => `Molarity: moles = ${v.n||"?"} mol, volume = ${v.V||"?"} L` },
    { id: "ph", label: "pH = -log[H⁺]", vars: [{key:"H",label:"[H⁺]",unit:"mol/L",placeholder:"1e-7"}], buildQuery: v => `pH from H+ concentration = ${v.H||"?"} mol/L` },
    { id: "ideal_gas", label: "PV = nRT", vars: [{key:"P",label:"Pressure",unit:"atm",placeholder:"1"},{key:"V",label:"Volume",unit:"L",placeholder:"22.4"},{key:"n",label:"Moles",unit:"mol",placeholder:"1"},{key:"T",label:"Temp",unit:"K",placeholder:"273"}], buildQuery: v => `Ideal gas: P = ${v.P||"?"} atm, V = ${v.V||"?"} L, n = ${v.n||"?"} mol, T = ${v.T||"?"} K` },
    { id: "dilution", label: "C₁V₁ = C₂V₂", vars: [{key:"C1",label:"C₁",unit:"M",placeholder:"2"},{key:"V1",label:"V₁",unit:"mL",placeholder:"50"},{key:"V2",label:"V₂ final",unit:"mL",placeholder:"100"}], buildQuery: v => `Dilution: C1 = ${v.C1||"?"} M, V1 = ${v.V1||"?"} mL, final volume = ${v.V2||"?"} mL` },
    { id: "molar_mass", label: "Molar Mass", vars: [{key:"cpd",label:"Compound",placeholder:"H₂O"}], buildQuery: v => `Molar mass of ${v.cpd||"?"}` },
    { id: "pct_yield", label: "% Yield", vars: [{key:"act",label:"Actual",unit:"g",placeholder:"45"},{key:"theo",label:"Theoretical",unit:"g",placeholder:"60"}], buildQuery: v => `Percent yield: actual = ${v.act||"?"} g, theoretical = ${v.theo||"?"} g` },
  ],
  Medical: [
    { id: "bmi", label: "BMI", vars: [{key:"w",label:"Weight",unit:"kg",placeholder:"70"},{key:"h",label:"Height",unit:"m",placeholder:"1.75"}], buildQuery: v => `BMI: weight = ${v.w||"?"} kg, height = ${v.h||"?"} m` },
    { id: "map", label: "MAP", vars: [{key:"s",label:"Systolic",unit:"mmHg",placeholder:"120"},{key:"d",label:"Diastolic",unit:"mmHg",placeholder:"80"}], buildQuery: v => `Mean arterial pressure: systolic = ${v.s||"?"} mmHg, diastolic = ${v.d||"?"} mmHg` },
    { id: "gfr", label: "eGFR (CKD-EPI)", vars: [{key:"cr",label:"Creatinine",unit:"mg/dL",placeholder:"1.0"},{key:"age",label:"Age",unit:"yrs",placeholder:"45"},{key:"sex",label:"Sex M/F",placeholder:"M"}], buildQuery: v => `eGFR (CKD-EPI): creatinine = ${v.cr||"?"} mg/dL, age = ${v.age||"?"} yrs, sex = ${v.sex||"M"}` },
    { id: "dose", label: "Drug Dose", vars: [{key:"dose",label:"Dose",unit:"mg/kg",placeholder:"10"},{key:"w",label:"Weight",unit:"kg",placeholder:"70"}], buildQuery: v => `Drug dose: ${v.dose||"?"} mg/kg × ${v.w||"?"} kg patient` },
    { id: "bsa", label: "Body Surface Area", vars: [{key:"w",label:"Weight",unit:"kg",placeholder:"70"},{key:"h",label:"Height",unit:"cm",placeholder:"175"}], buildQuery: v => `Body surface area (Mosteller): weight = ${v.w||"?"} kg, height = ${v.h||"?"} cm` },
    { id: "hba1c", label: "HbA1c → Glucose", vars: [{key:"a1c",label:"HbA1c",unit:"%",placeholder:"6.5"}], buildQuery: v => `Convert HbA1c ${v.a1c||"?"}% to average blood glucose mg/dL` },
  ],
  Mathematics: [
    { id: "quad", label: "Quadratic", vars: [{key:"a",label:"a",placeholder:"1"},{key:"b",label:"b",placeholder:"-5"},{key:"c",label:"c",placeholder:"6"}], buildQuery: v => `Quadratic formula: ${v.a||"?"}x² + ${v.b||"?"}x + ${v.c||"?"} = 0` },
    { id: "pyth", label: "Pythagorean", vars: [{key:"a",label:"Side a",placeholder:"3"},{key:"b",label:"Side b",placeholder:"4"}], buildQuery: v => `Pythagorean theorem: a = ${v.a||"?"}, b = ${v.b||"?"}, find hypotenuse c` },
    { id: "circle", label: "Circle", vars: [{key:"r",label:"Radius",placeholder:"5"}], buildQuery: v => `Area and circumference of circle with radius = ${v.r||"?"}` },
    { id: "deriv", label: "Derivative", vars: [{key:"f",label:"f(x)",placeholder:"x³ + 2x"}], buildQuery: v => `Derivative of f(x) = ${v.f||"?"}` },
    { id: "integ", label: "Definite Integral", vars: [{key:"f",label:"f(x)",placeholder:"x²"},{key:"a",label:"From",placeholder:"0"},{key:"b",label:"To",placeholder:"1"}], buildQuery: v => `Definite integral of ${v.f||"?"} from ${v.a||"?"} to ${v.b||"?"}` },
    { id: "log", label: "Logarithm", vars: [{key:"base",label:"Base",placeholder:"e"},{key:"x",label:"x",placeholder:"100"}], buildQuery: v => `Logarithm base ${v.base||"?"} of ${v.x||"?"}` },
  ],
  Biology: [
    { id: "pop", label: "Population Growth", vars: [{key:"N0",label:"Initial N",placeholder:"100"},{key:"r",label:"Rate",unit:"/yr",placeholder:"0.05"},{key:"t",label:"Time",unit:"yrs",placeholder:"10"}], buildQuery: v => `Exponential population growth: N₀=${v.N0||"?"}, r=${v.r||"?"}/yr, t=${v.t||"?"} yrs` },
    { id: "hw", label: "Hardy-Weinberg", vars: [{key:"p",label:"Allele freq p",placeholder:"0.7"}], buildQuery: v => `Hardy-Weinberg equilibrium: p = ${v.p||"?"}` },
    { id: "mm", label: "Michaelis-Menten", vars: [{key:"Vm",label:"Vmax",unit:"μmol/min",placeholder:"10"},{key:"Km",label:"Km",unit:"mM",placeholder:"2"},{key:"S",label:"[S]",unit:"mM",placeholder:"5"}], buildQuery: v => `Michaelis-Menten: Vmax=${v.Vm||"?"} μmol/min, Km=${v.Km||"?"} mM, [S]=${v.S||"?"} mM` },
    { id: "double", label: "Doubling Time", vars: [{key:"r",label:"Growth rate",unit:"%",placeholder:"3"}], buildQuery: v => `Cell doubling time with growth rate = ${v.r||"?"}%` },
    { id: "mort", label: "Mortality Rate", vars: [{key:"d",label:"Deaths",placeholder:"50"},{key:"n",label:"Population",placeholder:"10000"}], buildQuery: v => `Mortality rate: ${v.d||"?"} deaths in population of ${v.n||"?"}` },
  ],
  Engineering: [
    { id: "stress", label: "Stress σ=F/A", vars: [{key:"F",label:"Force",unit:"N",placeholder:"5000"},{key:"A",label:"Area",unit:"m²",placeholder:"0.01"}], buildQuery: v => `Mechanical stress: F=${v.F||"?"} N, A=${v.A||"?"} m²` },
    { id: "strain", label: "Strain ε=ΔL/L", vars: [{key:"dL",label:"ΔLength",unit:"m",placeholder:"0.002"},{key:"L",label:"Orig length",unit:"m",placeholder:"2"}], buildQuery: v => `Strain: ΔL=${v.dL||"?"} m, L₀=${v.L||"?"} m` },
    { id: "mech_pwr", label: "Power P=Fv", vars: [{key:"F",label:"Force",unit:"N",placeholder:"100"},{key:"v",label:"Velocity",unit:"m/s",placeholder:"10"}], buildQuery: v => `Mechanical power: F=${v.F||"?"} N, v=${v.v||"?"} m/s` },
    { id: "flow", label: "Fluid Flow Q=Av", vars: [{key:"A",label:"Area",unit:"m²",placeholder:"0.01"},{key:"v",label:"Velocity",unit:"m/s",placeholder:"2"}], buildQuery: v => `Volumetric flow rate: A=${v.A||"?"} m², v=${v.v||"?"} m/s` },
    { id: "beam", label: "Beam Deflection", vars: [{key:"P",label:"Load",unit:"N",placeholder:"1000"},{key:"L",label:"Length",unit:"m",placeholder:"3"},{key:"E",label:"E",unit:"GPa",placeholder:"200"},{key:"I",label:"I",unit:"m⁴",placeholder:"1e-4"}], buildQuery: v => `Simply supported beam: P=${v.P||"?"}N, L=${v.L||"?"}m, E=${v.E||"?"}GPa, I=${v.I||"?"}m⁴` },
    { id: "thermal", label: "Heat Transfer Q=UAΔt", vars: [{key:"U",label:"U coeff",unit:"W/m²K",placeholder:"5"},{key:"A",label:"Area",unit:"m²",placeholder:"10"},{key:"dT",label:"ΔTemp",unit:"°C",placeholder:"30"}], buildQuery: v => `Heat transfer: U=${v.U||"?"} W/m²K, A=${v.A||"?"} m², ΔT=${v.dT||"?"}°C` },
  ],
  Astronomy: [
    { id: "kepler3", label: "Kepler's 3rd Law", vars: [{key:"a",label:"Semi-major axis",unit:"AU",placeholder:"1"}], buildQuery: v => `Kepler's 3rd law: orbital period for a = ${v.a||"?"} AU` },
    { id: "hubble", label: "Hubble's Law", vars: [{key:"v",label:"Recession v",unit:"km/s",placeholder:"1000"}], buildQuery: v => `Hubble's law distance: recession velocity = ${v.v||"?"} km/s` },
    { id: "schw", label: "Schwarzschild R", vars: [{key:"M",label:"Mass",unit:"M☉",placeholder:"10"}], buildQuery: v => `Schwarzschild radius: mass = ${v.M||"?"} solar masses` },
    { id: "dist", label: "Parallax Distance", vars: [{key:"p",label:"Parallax",unit:"arcsec",placeholder:"0.1"}], buildQuery: v => `Stellar distance from parallax = ${v.p||"?"} arcsec` },
    { id: "lum", label: "Luminosity", vars: [{key:"R",label:"Radius",unit:"R☉",placeholder:"1"},{key:"T",label:"Temperature",unit:"K",placeholder:"5778"}], buildQuery: v => `Stellar luminosity: R=${v.R||"?"} R☉, T=${v.T||"?"} K` },
    { id: "esc", label: "Escape Velocity", vars: [{key:"M",label:"Mass",unit:"kg",placeholder:"5.97e24"},{key:"R",label:"Radius",unit:"m",placeholder:"6.37e6"}], buildQuery: v => `Escape velocity: M=${v.M||"?"} kg, R=${v.R||"?"} m` },
  ],
};

const CONV_TYPES = [
  { id: "Length",      label: "Length",      units: ["m", "km", "cm", "mm", "mile", "yard", "ft", "in", "nm"] },
  { id: "Mass",        label: "Mass",        units: ["kg", "g", "mg", "lb", "oz", "tonne", "μg"] },
  { id: "Temperature", label: "Temp",        units: ["°C", "°F", "K"] },
  { id: "Volume",      label: "Volume",      units: ["L", "mL", "m³", "gallon", "fl oz", "cup", "tbsp"] },
  { id: "Speed",       label: "Speed",       units: ["m/s", "km/h", "mph", "knot", "ft/s"] },
  { id: "Area",        label: "Area",        units: ["m²", "km²", "cm²", "acre", "hectare", "ft²", "in²"] },
  { id: "Energy",      label: "Energy",      units: ["J", "kJ", "cal", "kcal", "kWh", "eV", "BTU"] },
  { id: "Pressure",    label: "Pressure",    units: ["Pa", "kPa", "bar", "atm", "psi", "mmHg"] },
  { id: "Data",        label: "Data",        units: ["bit", "byte", "KB", "MB", "GB", "TB"] },
  { id: "Time",        label: "Time",        units: ["s", "min", "hr", "day", "week", "month", "year"] },
];

// ─── GozlinScientia body ─────────────────────────────────────────────────────

function ScientiaBody({
  block, onUpdate, onRun, onSaveNote, t, mode,
}: {
  block: ScientiaBlock;
  onUpdate: (id: string, patch: Partial<Block>) => void;
  onRun: (id: string, queryOverride?: string) => void;
  onSaveNote?: (text: string) => void;
  t: any;
  mode: "light" | "dark";
}) {
  const bg = mode === "dark" ? "#1E293B" : "#F8FAFC";
  const borderC = mode === "dark" ? "#334155" : "#E2E8F0";

  const handleCategoryChange = (catId: ScientiaCategory) => {
    onUpdate(block.id, { category: catId, result: undefined, error: undefined, query: "" } as Partial<Block>);
  };

  return (
    <View style={{ gap: 10 }}>
      {/* GozlinScientia brand header */}
      <View style={scStyles.scientiaHeader}>
        <Atom size={13} color="#0EA5E9" strokeWidth={2.2} />
        <Text style={scStyles.scientiaHeaderText}>GozlinScientia</Text>
        <Text style={[scStyles.scientiaHeaderSub, { color: t.textTertiary }]}>Scientific Computing</Text>
      </View>
      {/* Category selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: 6, paddingVertical: 2 }}>
          {SCIENTIA_CATEGORIES.map((cat) => {
            const isActive = block.category === cat.id;
            return (
              <TouchableOpacity
                key={cat.id}
                onPress={() => handleCategoryChange(cat.id as ScientiaCategory)}
                style={[
                  scStyles.catChip,
                  { backgroundColor: isActive ? `${cat.color}20` : bg, borderColor: isActive ? cat.color : borderC },
                ]}
                activeOpacity={0.7}
              >
                <Text style={[scStyles.catChipText, { color: isActive ? cat.color : t.textSecondary }]}>{cat.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Mode-specific UI */}
      {block.category === "Ask" ? (
        <AskScientiaBody block={block} onUpdate={onUpdate} onRun={onRun} onSaveNote={onSaveNote} t={t} mode={mode} />
      ) : block.category === "Conversions" ? (
        <ConversionBody block={block} onUpdate={onUpdate} onRun={onRun} onSaveNote={onSaveNote} t={t} mode={mode} />
      ) : (
        <ScienceCalcBody block={block} onUpdate={onUpdate} onRun={onRun} onSaveNote={onSaveNote} t={t} mode={mode} />
      )}
    </View>
  );
}

// ─── Ask mode ────────────────────────────────────────────────────────────────

function AskScientiaBody({
  block, onUpdate, onRun, onSaveNote, t, mode,
}: {
  block: ScientiaBlock;
  onUpdate: (id: string, patch: Partial<Block>) => void;
  onRun: (id: string, queryOverride?: string) => void;
  onSaveNote?: (text: string) => void;
  t: any;
  mode: "light" | "dark";
}) {
  const bg = mode === "dark" ? "#1E293B" : "#F8FAFC";
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.fieldWrap}>
        <TextInput
          value={block.query}
          onChangeText={(v) => onUpdate(block.id, { query: v, result: undefined, error: undefined } as Partial<Block>)}
          placeholder="Ask GozlinScientia anything… formulas, calculations, concepts, units…"
          placeholderTextColor={t.textTertiary}
          multiline
          style={[styles.textArea, { color: t.text, backgroundColor: bg, paddingRight: 38 }]}
        />
        <FieldMic
          current={block.query}
          onText={(next) => onUpdate(block.id, { query: next, result: undefined, error: undefined } as Partial<Block>)}
          disabled={block.loading}
        />
      </View>
      <TouchableOpacity
        onPress={() => onRun(block.id)}
        disabled={block.loading || !block.query.trim()}
        style={[styles.runBtn, { backgroundColor: "#a78bfa", opacity: block.loading || !block.query.trim() ? 0.5 : 1 }]}
      >
        {block.loading ? <ActivityIndicator color="#FFF" size="small" /> : <Atom color="#FFF" size={13} strokeWidth={2.4} />}
        <Text style={styles.runBtnText}>{block.loading ? "Thinking…" : "Ask GozlinScientia"}</Text>
      </TouchableOpacity>
      {block.error ? <Text style={[styles.errorText, { color: "#EF4444" }]}>⚠ {block.error}</Text> : null}
      {block.result && !block.loading ? (
        <ScientiaResultPanel result={block.result} catColor="#a78bfa" mode={mode} t={t} onSaveNote={onSaveNote} />
      ) : null}
    </View>
  );
}

// ─── Conversion mode ──────────────────────────────────────────────────────────

function ConversionBody({
  block, onUpdate, onRun, onSaveNote, t, mode,
}: {
  block: ScientiaBlock;
  onUpdate: (id: string, patch: Partial<Block>) => void;
  onRun: (id: string, queryOverride?: string) => void;
  onSaveNote?: (text: string) => void;
  t: any;
  mode: "light" | "dark";
}) {
  const bg = mode === "dark" ? "#1E293B" : "#F8FAFC";
  const borderC = mode === "dark" ? "#334155" : "#E2E8F0";
  const CAT_COLOR = "#2dd4bf";

  const [convType, setConvType] = React.useState(CONV_TYPES[0]);
  const [fromUnit, setFromUnit] = React.useState(CONV_TYPES[0].units[0]);
  const [toUnit, setToUnit] = React.useState(CONV_TYPES[0].units[1]);
  const [value, setValue] = React.useState("");

  const handleConvert = () => {
    const q = `Convert ${value || "1"} ${fromUnit} to ${toUnit}`;
    onUpdate(block.id, { query: q, result: undefined, error: undefined } as Partial<Block>);
    onRun(block.id, q);
  };

  return (
    <View style={{ gap: 10 }}>
      {/* Conversion type chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {CONV_TYPES.map((ct) => {
            const active = convType.id === ct.id;
            return (
              <TouchableOpacity
                key={ct.id}
                onPress={() => { setConvType(ct); setFromUnit(ct.units[0]); setToUnit(ct.units[1] || ct.units[0]); }}
                style={[scStyles.catChip, { backgroundColor: active ? `${CAT_COLOR}20` : bg, borderColor: active ? CAT_COLOR : borderC }]}
                activeOpacity={0.7}
              >
                <Text style={[scStyles.catChipText, { color: active ? CAT_COLOR : t.textSecondary }]}>{ct.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Value input */}
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder="Enter value…"
        keyboardType="decimal-pad"
        placeholderTextColor={t.textTertiary}
        style={[{ borderRadius: 10, paddingHorizontal: 14, paddingVertical: 14, fontSize: 24, fontWeight: "700", textAlign: "center", color: t.text, backgroundColor: bg }]}
      />

      {/* From / To columns */}
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Text style={[scStyles.sectionLabel, { color: t.textTertiary, marginBottom: 6 }]}>FROM</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
            {convType.units.map((u) => {
              const active = fromUnit === u;
              return (
                <TouchableOpacity key={u} onPress={() => setFromUnit(u)} style={[scStyles.catChip, { backgroundColor: active ? `${CAT_COLOR}20` : bg, borderColor: active ? CAT_COLOR : borderC }]} activeOpacity={0.7}>
                  <Text style={[scStyles.catChipText, { color: active ? CAT_COLOR : t.textSecondary }]}>{u}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        <View style={{ paddingTop: 22 }}>
          <Text style={{ color: CAT_COLOR, fontSize: 18, fontWeight: "700" }}>→</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[scStyles.sectionLabel, { color: t.textTertiary, marginBottom: 6 }]}>TO</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
            {convType.units.map((u) => {
              const active = toUnit === u;
              return (
                <TouchableOpacity key={u} onPress={() => setToUnit(u)} style={[scStyles.catChip, { backgroundColor: active ? `${CAT_COLOR}20` : bg, borderColor: active ? CAT_COLOR : borderC }]} activeOpacity={0.7}>
                  <Text style={[scStyles.catChipText, { color: active ? CAT_COLOR : t.textSecondary }]}>{u}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>

      {/* Convert button */}
      <TouchableOpacity
        onPress={handleConvert}
        disabled={block.loading || !value.trim()}
        style={[styles.runBtn, { backgroundColor: CAT_COLOR, opacity: block.loading || !value.trim() ? 0.5 : 1 }]}
      >
        {block.loading ? <ActivityIndicator color="#FFF" size="small" /> : <Atom color="#FFF" size={13} strokeWidth={2.4} />}
        <Text style={styles.runBtnText}>{block.loading ? "Converting…" : "Convert"}</Text>
      </TouchableOpacity>

      {block.error ? <Text style={[styles.errorText, { color: "#EF4444" }]}>⚠ {block.error}</Text> : null}
      {block.result && !block.loading ? (
        <ScientiaResultPanel result={block.result} catColor={CAT_COLOR} mode={mode} t={t} onSaveNote={onSaveNote} />
      ) : null}
    </View>
  );
}

// ─── Science field calculator ─────────────────────────────────────────────────

function ScienceCalcBody({
  block, onUpdate, onRun, onSaveNote, t, mode,
}: {
  block: ScientiaBlock;
  onUpdate: (id: string, patch: Partial<Block>) => void;
  onRun: (id: string, queryOverride?: string) => void;
  onSaveNote?: (text: string) => void;
  t: any;
  mode: "light" | "dark";
}) {
  const bg = mode === "dark" ? "#1E293B" : "#F8FAFC";
  const borderC = mode === "dark" ? "#334155" : "#E2E8F0";
  const catColor = scientiaCatColor(block.category);
  const templates = SCIENCE_TEMPLATES[block.category] ?? [];

  const [selectedFormula, setSelectedFormula] = React.useState<ScientiaFormula | null>(null);
  const [varValues, setVarValues] = React.useState<Record<string, string>>({});
  const [customMode, setCustomMode] = React.useState(!!block.query);

  const handleFormulaSelect = (f: ScientiaFormula) => {
    setSelectedFormula(f);
    setVarValues({});
    setCustomMode(false);
  };

  const handleCalculate = () => {
    if (customMode) {
      onRun(block.id);
      return;
    }
    if (!selectedFormula) return;
    const builtQuery = selectedFormula.buildQuery(varValues);
    onUpdate(block.id, { query: builtQuery, result: undefined, error: undefined } as Partial<Block>);
    onRun(block.id, builtQuery);
  };

  const canRun = customMode
    ? !block.loading && !!block.query.trim()
    : !block.loading && !!selectedFormula;

  return (
    <View style={{ gap: 10 }}>
      {/* Formula chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: 6, paddingVertical: 2 }}>
          {templates.map((f) => {
            const active = !customMode && selectedFormula?.id === f.id;
            return (
              <TouchableOpacity
                key={f.id}
                onPress={() => handleFormulaSelect(f)}
                style={[scStyles.catChip, { backgroundColor: active ? `${catColor}20` : bg, borderColor: active ? catColor : borderC }]}
                activeOpacity={0.7}
              >
                <Text style={[scStyles.catChipText, { color: active ? catColor : t.textSecondary }]}>{f.label}</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            onPress={() => { setCustomMode(true); setSelectedFormula(null); }}
            style={[scStyles.catChip, { backgroundColor: customMode ? `${catColor}20` : bg, borderColor: customMode ? catColor : borderC }]}
            activeOpacity={0.7}
          >
            <Text style={[scStyles.catChipText, { color: customMode ? catColor : t.textSecondary }]}>Custom</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Formula variable inputs */}
      {!customMode && selectedFormula ? (
        <View style={[scStyles.varInputPanel, { backgroundColor: `${catColor}08`, borderColor: `${catColor}30` }]}>
          <Text style={[scStyles.sectionLabel, { color: catColor, marginBottom: 8 }]}>{selectedFormula.label}</Text>
          {selectedFormula.vars.map((v) => (
            <View key={v.key} style={scStyles.varInputRow}>
              <Text style={[scStyles.varInputLabel, { color: t.textSecondary }]}>
                {v.label}{v.unit ? ` (${v.unit})` : ""}
              </Text>
              <TextInput
                value={varValues[v.key] ?? ""}
                onChangeText={(val) => setVarValues((prev) => ({ ...prev, [v.key]: val }))}
                placeholder={v.placeholder}
                keyboardType="decimal-pad"
                placeholderTextColor={t.textTertiary}
                style={[scStyles.varInputField, { color: t.text, backgroundColor: bg, borderColor: borderC }]}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          ))}
        </View>
      ) : null}

      {/* Custom text input */}
      {customMode ? (
        <View style={styles.fieldWrap}>
          <TextInput
            value={block.query}
            onChangeText={(v) => onUpdate(block.id, { query: v, result: undefined, error: undefined } as Partial<Block>)}
            placeholder={`Custom ${block.category} calculation or question…`}
            placeholderTextColor={t.textTertiary}
            multiline
            style={[styles.textArea, { color: t.text, backgroundColor: bg, paddingRight: 38 }]}
          />
          <FieldMic
            current={block.query}
            onText={(next) => onUpdate(block.id, { query: next, result: undefined, error: undefined } as Partial<Block>)}
            disabled={block.loading}
          />
        </View>
      ) : !selectedFormula ? (
        <View style={[scStyles.formulaHint, { backgroundColor: `${catColor}08`, borderColor: `${catColor}25` }]}>
          <Atom color={catColor} size={14} strokeWidth={2.2} />
          <Text style={{ color: t.textTertiary, fontSize: 12, flex: 1 }}>
            Select a formula above, or tap <Text style={{ color: catColor, fontWeight: "700" }}>Custom</Text> to type freely.
          </Text>
        </View>
      ) : null}

      {/* Calculate button */}
      <TouchableOpacity
        onPress={handleCalculate}
        disabled={!canRun}
        style={[styles.runBtn, { backgroundColor: catColor, opacity: !canRun ? 0.5 : 1 }]}
      >
        {block.loading ? <ActivityIndicator color="#FFF" size="small" /> : <Atom color="#FFF" size={13} strokeWidth={2.4} />}
        <Text style={styles.runBtnText}>{block.loading ? "Calculating…" : "Calculate"}</Text>
      </TouchableOpacity>

      {block.error ? <Text style={[styles.errorText, { color: "#EF4444" }]}>⚠ {block.error}</Text> : null}
      {block.result && !block.loading ? (
        <ScientiaResultPanel result={block.result} catColor={catColor} mode={mode} t={t} onSaveNote={onSaveNote} />
      ) : null}
    </View>
  );
}

// ─── GozlinScientia result panel ─────────────────────────────────────────────

function confidenceConfig(level?: string) {
  if (level === "high") return { bg: "rgba(52,211,153,0.12)", border: "#34d39960", text: "#34d399" };
  if (level === "low") return { bg: "rgba(248,113,113,0.12)", border: "#f8717160", text: "#f87171" };
  return { bg: "rgba(251,191,36,0.12)", border: "#fbbf2460", text: "#fbbf24" };
}

function ScientiaResultPanel({
  result, catColor, mode, t, onSaveNote,
}: {
  result: ScientiaResult;
  catColor: string;
  mode: "light" | "dark";
  t: any;
  onSaveNote?: (text: string) => void;
}) {
  const conf = confidenceConfig(result.confidence);
  const [noteSaved, setNoteSaved] = React.useState(false);

  const handleSaveNote = () => {
    if (!result.warnings?.filter(Boolean).length) return;
    const text = `⚠ Safety Notes — ${result.title}\n\n${result.warnings!.filter(Boolean).map(w => `• ${w}`).join("\n")}`;
    onSaveNote?.(text);
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 2500);
  };

  return (
    <View
      style={[
        scStyles.resultPanel,
        {
          backgroundColor: mode === "dark" ? "#080D1A" : "#F0F9FF",
          borderColor: `${catColor}40`,
        },
      ]}
    >
      {/* Badges */}
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <View style={[scStyles.catBadge, { backgroundColor: `${catColor}20`, borderColor: `${catColor}40` }]}>
          <Text style={[scStyles.catBadgeText, { color: catColor }]}>{result.category}</Text>
        </View>
        {result.confidence ? (
          <View style={[scStyles.catBadge, { backgroundColor: conf.bg, borderColor: conf.border }]}>
            <Text style={[scStyles.catBadgeText, { color: conf.text }]}>
              {result.confidence} confidence
            </Text>
          </View>
        ) : null}
      </View>

      {/* Title */}
      <Text style={[scStyles.resultTitle, { color: t.text }]}>{result.title}</Text>

      {/* Main value */}
      {result.result ? (
        <View style={[scStyles.valueBox, { backgroundColor: `${catColor}12`, borderColor: `${catColor}30` }]}>
          <Text style={[scStyles.valueLabel, { color: t.textTertiary }]}>Result</Text>
          <Text style={[scStyles.valuePrimary, { color: catColor }]}>
            {result.result.value}
            {result.result.unit ? (
              <Text style={[scStyles.valueUnit, { color: t.textSecondary }]}> {result.result.unit}</Text>
            ) : null}
          </Text>
          {result.result.formatted && result.result.formatted !== `${result.result.value} ${result.result.unit ?? ""}`.trim() ? (
            <Text style={[scStyles.valueFormatted, { color: t.textSecondary }]}>{result.result.formatted}</Text>
          ) : null}
        </View>
      ) : null}

      {/* Formula */}
      {result.formula?.expression ? (
        <View style={{ marginBottom: 8 }}>
          <Text style={[scStyles.sectionLabel, { color: t.textTertiary }]}>Formula</Text>
          <View style={[scStyles.formulaBox, { backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9" }]}>
            <Text style={[scStyles.formulaText, { color: t.text }]}>{result.formula.expression}</Text>
          </View>
          {result.formula.variables && result.formula.variables.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
              {result.formula.variables.map((v, i) => (
                <View key={i} style={[scStyles.varChip, { backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9" }]}>
                  <Text style={{ color: catColor, fontWeight: "700", fontSize: 11 }}>{v.symbol}</Text>
                  <Text style={{ color: t.textTertiary, fontSize: 11 }}>
                    {" "}= {v.value}{v.unit ? ` ${v.unit}` : ""}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Steps */}
      {result.steps && result.steps.length > 0 ? (
        <View style={{ marginBottom: 8 }}>
          <Text style={[scStyles.sectionLabel, { color: t.textTertiary }]}>Steps</Text>
          {result.steps.map((step, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 5, alignItems: "flex-start" }}>
              <View style={[scStyles.stepNum, { backgroundColor: `${catColor}20`, borderColor: `${catColor}40` }]}>
                <Text style={{ color: catColor, fontSize: 10, fontWeight: "700" }}>{i + 1}</Text>
              </View>
              <Text style={[scStyles.stepText, { color: t.textSecondary, flex: 1 }]}>{step}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Explanation */}
      {result.explanation ? (
        <View style={[scStyles.explanationBox, { backgroundColor: mode === "dark" ? "#1E293B" : "#EFF6FF" }]}>
          <Text style={{ color: t.textSecondary, fontSize: 12.5, lineHeight: 18 }}>{result.explanation}</Text>
        </View>
      ) : null}

      {/* Warnings + Save Note button */}
      {result.warnings && result.warnings.filter(Boolean).length > 0 ? (
        <View style={[
          scStyles.warningBox,
          mode === "dark"
            ? { backgroundColor: "rgba(251,191,36,0.08)", borderColor: "rgba(251,191,36,0.25)" }
            : { backgroundColor: "rgba(180,120,0,0.07)", borderColor: "rgba(180,120,0,0.22)" },
        ]}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <Text style={{ color: mode === "dark" ? "#FBBF24" : "#92600A", fontSize: 11, fontWeight: "700" }}>
              ⚠ Footer Note
            </Text>
            {onSaveNote ? (
              <TouchableOpacity
                onPress={handleSaveNote}
                style={[scStyles.saveNoteBtn, {
                  backgroundColor: noteSaved ? "#10B981" : mode === "dark" ? "#FBBF2420" : "#92600A14",
                  borderColor: noteSaved ? "#10B981" : mode === "dark" ? "#FBBF2450" : "#92600A40",
                }]}
                activeOpacity={0.75}
              >
                <Text style={{ color: noteSaved ? "#fff" : mode === "dark" ? "#FBBF24" : "#92600A", fontSize: 10, fontWeight: "700" }}>
                  {noteSaved ? "✓ Saved!" : "Save Note"}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {result.warnings.filter(Boolean).map((w, i) => (
            <Text key={i} style={{ color: mode === "dark" ? "#FDE68A" : "#7A4F08", fontSize: 12, lineHeight: 17 }}>• {w}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ─── Add bar ─────────────────────────────────────────────────────────────────

function AddBar({
  onAdd, onVoiceNote, t, mode,
}: {
  onAdd: (kind: BlockKind) => void;
  onVoiceNote: (text: string) => void;
  t: any;
  mode: "light" | "dark";
}) {
  const items: Array<{ kind: BlockKind; label: string; color: string; Icon: any }> = [
    { kind: "note",     label: "Note",     color: "#6366F1", Icon: FileText },
    { kind: "task",     label: "Task",     color: "#06B6D4", Icon: ListChecks },
    { kind: "compute",  label: "Compute",  color: "#10B981", Icon: Calculator },
    { kind: "chart",    label: "Chart",    color: "#F59E0B", Icon: BarChart3 },
    { kind: "ai",       label: "gozlin",   color: "#9333EA", Icon: Wand2 },
    { kind: "scientia", label: "GozlinScientia", color: "#0EA5E9", Icon: Atom },
  ];
  return (
    <View
      style={[
        styles.addBar,
        {
          backgroundColor: mode === "dark" ? "#0F172A" : "#FFFFFF",
          borderTopColor: t.border,
        },
      ]}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.addBarInner}>
          {/* Voice → instant note (only shown when on-device voice is available) */}
          {isVoiceAvailable() ? (
            <View
              style={[
                styles.addBtn,
                { backgroundColor: `${ACCENT}15`, borderColor: `${ACCENT}55` },
              ]}
            >
              <VoiceInputButton
                size={13}
                color={ACCENT}
                onTranscribed={onVoiceNote}
                onError={(msg) => Alert.alert("Voice", msg)}
                style={styles.voiceChipMic}
              />
              <Text style={[styles.addBtnText, { color: ACCENT }]}>Voice</Text>
            </View>
          ) : null}
          {items.map((it) => (
            <TouchableOpacity
              key={it.kind}
              onPress={() => onAdd(it.kind)}
              style={[
                styles.addBtn,
                { backgroundColor: `${it.color}15`, borderColor: `${it.color}55` },
              ]}
            >
              <it.Icon color={it.color} size={13} strokeWidth={2.4} />
              <Text style={[styles.addBtnText, { color: it.color }]}>{it.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: -0.3,
    lineHeight: 20,
  },
  headerSubtitle: {
    fontSize: 10.5,
    color: "rgba(255,255,255,0.7)",
    lineHeight: 13,
  },
  iconBtn: { padding: 4 },
  restoredStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  restoredStripText: { fontSize: 11.5, fontWeight: "600" },
  body: { paddingHorizontal: 10, paddingVertical: spacing.sm, gap: 0 },
  emptyWrap: { alignItems: "center", paddingVertical: 40, gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: "600" },
  emptyHint: { fontSize: 12 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.sm + 2,
    gap: 8,
  },
  blockSeparator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardKind: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.5 },
  iconBadge: {
    width: 22, height: 22, borderRadius: 6,
    alignItems: "center", justifyContent: "center",
  },
  askPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  askPillText: { color: ACCENT, fontSize: 11, fontWeight: "700" },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    padding: 6,
    borderRadius: 8,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  actionBtnText: { fontSize: 11.5, fontWeight: "600" },
  stickyToolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "nowrap",
  },
  swatch: { width: 18, height: 18, borderRadius: 9 },
  pinBtn: { padding: 5, borderRadius: 7 },
  textArea: {
    minHeight: 80,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13.5,
    lineHeight: 19,
    textAlignVertical: "top",
  },
  // ── Inline dictation mic (additive — see FieldMic) ──
  fieldWrap: { position: "relative" },
  fieldMic: {
    position: "absolute",
    right: 6,
    bottom: 6,
    backgroundColor: `${ACCENT}14`,
    borderRadius: 8,
    paddingHorizontal: 3,
    paddingVertical: 3,
  },
  voiceChipMic: { paddingHorizontal: 0 },
  computeWrap: { gap: 8 },
  computeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  computeName: {
    width: 90,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 13, fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
  },
  eq: { fontSize: 15, fontWeight: "700" },
  computeExpr: {
    flex: 1,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 13, fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
  },
  runBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8,
  },
  runBtnText: { color: "#FFF", fontSize: 12.5, fontWeight: "700" },
  deferBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: `${ACCENT}66`,
    backgroundColor: `${ACCENT}14`,
  },
  deferBtnText: { fontSize: 12.5, fontWeight: "700" },
  deferBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#D1FAE5",
  },
  deferBannerText: { flex: 1, fontSize: 12, color: "#065F46", lineHeight: 17 },
  errorText: { fontSize: 12, fontWeight: "600" },
  resultPill: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    alignSelf: "flex-start",
  },
  resultLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  resultValue: {
    fontSize: 15, fontWeight: "700",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
  },
  chartTitle: {
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 13, fontWeight: "600",
  },
  chartData: {
    minHeight: 80,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 12.5,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    textAlignVertical: "top",
  },
  chartArea: { gap: 6, marginTop: 4 },
  chartRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  chartLabel: { width: 70, fontSize: 11.5 },
  chartTrack: { flex: 1, height: 18, borderRadius: 4, overflow: "hidden" },
  chartBar: { height: "100%", borderRadius: 4 },
  chartValue: {
    width: 62, textAlign: "right", fontSize: 12, fontWeight: "600",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
  },
  aiResponse: { borderRadius: 10, padding: 12 },
  taskBodyRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  taskBodyInput: {
    flex: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13.5,
    lineHeight: 19,
    textAlignVertical: "top",
    minHeight: 42,
  },
  taskReminderBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  addBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  addBarInner: { flexDirection: "row", alignItems: "center", gap: 6 },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1,
  },
  addBtnText: { fontSize: 12.5, fontWeight: "700" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.md,
  },
  askModal: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.md,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 16,
  },
  askTitle: { fontSize: 16, fontWeight: "700" },
  askSub: { fontSize: 12 },
  askInput: {
    minHeight: 80,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: "top",
  },
  askActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  askBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  askBtnText: { fontSize: 14, fontWeight: "700" },
});

// ─── GozlinScientia styles ────────────────────────────────────────────────────

const scStyles = StyleSheet.create({
  catChip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  catChipText: { fontSize: 12, fontWeight: "700" },
  resultPanel: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 0,
  },
  catBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  catBadgeText: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  resultTitle: { fontSize: 14, fontWeight: "700", marginBottom: 12, lineHeight: 20 },
  valueBox: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 12,
  },
  valueLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 },
  valuePrimary: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
    lineHeight: 34,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
  },
  valueUnit: { fontSize: 16, fontWeight: "400" },
  valueFormatted: { fontSize: 12.5, marginTop: 2 },
  sectionLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 },
  formulaBox: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  formulaText: {
    fontSize: 14,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    letterSpacing: 0.2,
  },
  varChip: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  stepNum: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  stepText: { fontSize: 12.5, lineHeight: 18 },
  explanationBox: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  warningBox: {
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
  },
  scientiaHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingBottom: 2,
  },
  scientiaHeaderText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#0EA5E9",
    letterSpacing: 0.3,
  },
  scientiaHeaderSub: {
    fontSize: 10,
    fontWeight: "500",
    letterSpacing: 0.2,
    marginLeft: 2,
  },
  saveNoteBtn: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  varInputPanel: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  varInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  varInputLabel: {
    fontSize: 11.5,
    fontWeight: "600",
    width: 100,
    flexShrink: 0,
  },
  varInputField: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontWeight: "600",
  },
  formulaHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
});

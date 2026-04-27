// ============================================
// AI Workspace — premium notebook-style environment
// Mix notes, math, charts, and AI prompts in one persistent document.
// State auto-persists to AsyncStorage and restores exactly on reopen.
// ============================================

import { spacing } from "@/constants/theme";
import { sendChat, summarize, extractTasks } from "@/services/ai/ai.service";
import { useTheme } from "@/services/ThemeProvider";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  BarChart3,
  Bell,
  BellOff,
  BookOpen,
  Calculator,
  CheckSquare,
  ChevronDown,
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
const WORKSPACE_KEY = "@pdflab/ai_workspace_state_v1";
const PINNED_NOTE_KEY = "@pdflab/pinned_note_v1";
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

// Returns dark text for light backgrounds, light text for dark backgrounds
function stickyTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#1F2937" : "#F8FAFC";
}

// ─── Safe expression evaluator ───────────────────────────────────────────────
// Tokenizer + Pratt parser. Supports numbers, + - * / %, parens, and
// named variables. Functions: sum(), avg(), min(), max(), round(), abs(),
// sqrt(), pow().
// ──────────────────────────────────────────────────────────────────────────────

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

type BlockKind = "note" | "compute" | "chart" | "ai" | "task";

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
  /** CSV-ish input: "label, value" per line */
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

type Block = NoteBlock | ComputeBlock | ChartBlock | AIBlock | TaskBlock;

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
      "Welcome to your AI Workspace.\n\nMix notes, math, charts, and AI prompts in one document. Tap +  to add a block, or ⚡ on any block to run an AI action on it.",
  },
];

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function AIWorkspaceScreen() {
  const { colors: t, mode } = useTheme();
  const router = useRouter();
  const { focusPin } = useLocalSearchParams<{ focusPin?: string }>();

  const [blocks, setBlocks] = useState<Block[]>(DEFAULT_BLOCKS);
  const [hydrated, setHydrated] = useState(false);
  const [lastEditedId, setLastEditedId] = useState<string | null>(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [restoredHint, setRestoredHint] = useState<string | null>(null);
  const [pinnedNoteId, setPinnedNoteId] = useState<string | null>(null);

  // Per-block "Ask AI About This Block" modal
  const [askBlock, setAskBlock] = useState<Block | null>(null);
  const [askPrompt, setAskPrompt] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  // Maps each block id → its measured Y offset for focus-scroll
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
    return () => {
      mounted = false;
    };
  }, []);

  // ── Persistence: save on every change (debounced) ─────────────────────────
  useEffect(() => {
    if (!hydrated) return;
    const handle = setTimeout(() => {
      const snapshot: PersistedState = {
        blocks,
        lastEditedId,
        updatedAt: Date.now(),
      };
      AsyncStorage.setItem(WORKSPACE_KEY, JSON.stringify(snapshot)).catch(
        () => {},
      );
    }, 350);
    return () => clearTimeout(handle);
  }, [blocks, lastEditedId, hydrated]);

  // Variables from compute blocks (accessible to subsequent compute blocks)
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
      // Strip transient state on duplicate
      if (copy.kind === "ai") {
        (copy as AIBlock).response = undefined;
        (copy as AIBlock).loading = false;
        (copy as AIBlock).error = undefined;
      }
      if (copy.kind === "compute") {
        // keep value/error so the duplicate shows the same result
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
      // Mark the block as pinned, unmark all others
      setBlocks((prev) =>
        prev.map((b) =>
          b.kind === "note"
            ? ({ ...b, pinned: b.id === id } as NoteBlock)
            : b,
        ),
      );
      setPinnedNoteId(id);
      // Persist pinned note record for the global floating button
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

  // Sync pinned note color changes to the global floating button in real-time
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
    setShowSlashMenu(false);
    const base: Block =
      kind === "note"
        ? { id: newId(), kind: "note", text: "" }
        : kind === "compute"
          ? { id: newId(), kind: "compute", name: "", expr: "" }
          : kind === "chart"
            ? { id: newId(), kind: "chart", title: "Untitled chart", rawData: "" }
            : kind === "task"
              ? { id: newId(), kind: "task", text: "", completed: false, reminder: false }
              : { id: newId(), kind: "ai", prompt: "" };
    setBlocks((prev) => [...prev, base]);
    setLastEditedId(base.id);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
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

  // Build a shared context window from preceding text/AI/compute blocks so
  // the AI block has light awareness of what came before. Limit length to
  // avoid blowing the context budget.
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

  // ── Convert block (text → summary / tasks / quiz prompt) ──────────────────
  const convertBlock = useCallback(
    async (
      id: string,
      mode: "summary" | "tasks",
    ) => {
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

      // Insert just below the source block
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
              ? ({
                  ...b,
                  loading: false,
                  response: res.content,
                } as AIBlock)
              : b,
          ),
        );
      } catch (e: any) {
        setBlocks((prev) =>
          prev.map((b) =>
            b.id === aiBlock.id
              ? ({
                  ...b,
                  loading: false,
                  error: e?.message || "Conversion failed",
                } as AIBlock)
              : b,
          ),
        );
      }
    },
    [blocks],
  );

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
                : `Chart: ${askBlock.title}\n${askBlock.rawData}`;

      const prompt = `Use only the following block as the source:\n\n"""\n${blockText}\n"""\n\nQuestion: ${askPrompt.trim()}`;
      const res = await sendChat(prompt, []);

      // Append a new AI block with the answer just below the source
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

  // ── Auto-focus last edited block on re-entry ──────────────────────────────
  useEffect(() => {
    if (!hydrated) return;
    // If navigated with focusPin=1, scroll to the pinned note
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
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]}>
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.7}
        >
          <ArrowLeft color={t.text} size={24} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: t.text }]}>AI Workspace</Text>
          <Text style={[styles.subtitle, { color: t.textSecondary }]}>
            Notes · Math · Charts · AI
          </Text>
        </View>
      </View>

      {/* Captivation strip — shown briefly when restoring saved state */}
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

        <AddBar
          onOpenSlash={() => setShowSlashMenu(true)}
          onAdd={addBlock}
          t={t}
          mode={mode}
        />
      </KeyboardAvoidingView>

      {/* ── Slash / Quick-Insert menu ─────────────────────────────────── */}
      <Modal
        visible={showSlashMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSlashMenu(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.modalBackdrop}
          onPress={() => setShowSlashMenu(false)}
        >
          <View
            style={[
              styles.slashMenu,
              {
                backgroundColor: mode === "dark" ? "#0F172A" : "#FFFFFF",
                borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
              },
            ]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.slashTitle, { color: t.textSecondary }]}>
              Quick insert
            </Text>
            {(
              [
                { kind: "note" as const, label: "Text", color: "#6366F1", Icon: FileText, hint: "Plain note" },
                { kind: "task" as const, label: "Task", color: "#06B6D4", Icon: ListChecks, hint: "Simple to-do item" },
                { kind: "ai" as const, label: "AI", color: "#9333EA", Icon: Wand2, hint: "Ask athemi anything" },
                { kind: "compute" as const, label: "Compute", color: "#10B981", Icon: Calculator, hint: "Math / variables" },
                { kind: "chart" as const, label: "Chart", color: "#F59E0B", Icon: BarChart3, hint: "Bar chart from CSV" },
              ]
            ).map((it) => (
              <TouchableOpacity
                key={it.kind}
                style={[
                  styles.slashItem,
                  {
                    borderColor: mode === "dark" ? "#1E293B" : "#F1F5F9",
                  },
                ]}
                onPress={() => addBlock(it.kind)}
                activeOpacity={0.75}
              >
                <View
                  style={[
                    styles.slashIcon,
                    { backgroundColor: `${it.color}22` },
                  ]}
                >
                  <it.Icon color={it.color} size={14} strokeWidth={2.4} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.slashLabel, { color: t.text }]}>
                    {it.label}
                  </Text>
                  <Text style={[styles.slashHint, { color: t.textTertiary }]}>
                    {it.hint}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

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
                    {
                      backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9",
                    },
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
                    <Text style={[styles.askBtnText, { color: "#FFF" }]}>
                      Ask AI
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
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

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
      <View style={styles.cardHeader}>
        <BlockIcon kind={block.kind} />
        <Text style={[styles.cardKind, { color: t.textSecondary }]}>
          {block.kind.toUpperCase()}
        </Text>
        <View style={{ flex: 1 }} />

        {/* Per-block AI: ask AI about this block */}
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
            onPress={() => {
              onDuplicate(block.id);
              setShowActions(false);
            }}
            style={styles.actionBtn}
          >
            <CopyIcon color={t.textSecondary} size={14} />
            <Text style={[styles.actionBtnText, { color: t.textSecondary }]}>Duplicate</Text>
          </TouchableOpacity>
          {canConvert ? (
            <>
              <TouchableOpacity
                onPress={() => {
                  onConvert(block.id, "summary");
                  setShowActions(false);
                }}
                style={styles.actionBtn}
              >
                <BookOpen color="#2563EB" size={14} />
                <Text style={[styles.actionBtnText, { color: "#2563EB" }]}>To summary</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  onConvert(block.id, "tasks");
                  setShowActions(false);
                }}
                style={styles.actionBtn}
              >
                <ListChecks color="#06B6D4" size={14} />
                <Text style={[styles.actionBtnText, { color: "#06B6D4" }]}>To tasks</Text>
              </TouchableOpacity>
            </>
          ) : null}
          <TouchableOpacity
            onPress={() => {
              onRemove(block.id);
              setShowActions(false);
            }}
            style={styles.actionBtn}
          >
            <Trash2 color="#EF4444" size={14} />
            <Text style={[styles.actionBtnText, { color: "#EF4444" }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {block.kind === "note" ? (
        <>
          {/* Sticky Note toolbar: color picker + pin button */}
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
              onPress={() =>
                isPinned ? onUnpinNote() : onPinNote(block.id)
              }
              style={[
                styles.pinBtn,
                isPinned && { backgroundColor: "#F59E0B22" },
              ]}
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
          <TextInput
            value={(block as NoteBlock).text}
            onChangeText={(v) => onUpdate(block.id, { text: v } as Partial<Block>)}
            placeholder="Write a note…"
            placeholderTextColor={
              noteColor
                ? `${stickyTextColor(noteColor)}88`
                : t.textTertiary
            }
            multiline
            style={[
              styles.textArea,
              {
                color: noteColor ? stickyTextColor(noteColor) : t.text,
                backgroundColor: noteColor
                  ? `${noteColor}${mode === "dark" ? "44" : "22"}`
                  : mode === "dark" ? "#1E293B" : "#F8FAFC",
              },
            ]}
          />
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
        <ComputeBody
          block={block}
          onUpdate={onUpdate}
          onRun={onRunCompute}
          t={t}
          mode={mode}
        />
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
    </View>
  );
}

function BlockIcon({ kind }: { kind: BlockKind }) {
  const color =
    kind === "note" ? "#6366F1" :
    kind === "compute" ? "#10B981" :
    kind === "chart" ? "#F59E0B" :
    kind === "task" ? "#06B6D4" :
    "#9333EA";
  const Icon =
    kind === "note" ? FileText :
    kind === "compute" ? Calculator :
    kind === "chart" ? BarChart3 :
    kind === "task" ? ListChecks :
    Wand2;
  return (
    <View style={[styles.iconBadge, { backgroundColor: `${color}22` }]}>
      <Icon color={color} size={12} strokeWidth={2.4} />
    </View>
  );
}

// ─── Compute body ────────────────────────────────────────────────────────────

function ComputeBody({
  block,
  onUpdate,
  onRun,
  t,
  mode,
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
          <Text style={[styles.resultValue, { color: t.text }]}>
            {formatNumber(block.value)}
          </Text>
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

interface ChartPoint {
  label: string;
  value: number;
}

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
  block,
  onUpdate,
  t,
  mode,
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
        style={[
          styles.chartData,
          { color: t.text, backgroundColor: bg },
        ]}
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
                      {
                        width: `${pct}%`,
                        backgroundColor: `hsl(${(idx * 50) % 360}, 70%, 55%)`,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.chartValue, { color: t.text }]}>
                  {formatNumber(p.value)}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ─── AI body ────────────────────────────────────────────────────────────────

function AIBody({
  block,
  onUpdate,
  onRun,
  t,
  mode,
}: {
  block: AIBlock;
  onUpdate: (id: string, patch: Partial<Block>) => void;
  onRun: (id: string) => void;
  t: any;
  mode: "light" | "dark";
}) {
  const bg = mode === "dark" ? "#1E293B" : "#F8FAFC";
  return (
    <View style={{ gap: 8 }}>
      <TextInput
        value={block.prompt}
        onChangeText={(v) => onUpdate(block.id, { prompt: v } as Partial<Block>)}
        placeholder="Ask athemi anything…"
        placeholderTextColor={t.textTertiary}
        multiline
        style={[styles.textArea, { color: t.text, backgroundColor: bg }]}
      />
      <TouchableOpacity
        onPress={() => onRun(block.id)}
        disabled={block.loading || !block.prompt.trim()}
        style={[
          styles.runBtn,
          {
            backgroundColor: ACCENT,
            opacity: block.loading || !block.prompt.trim() ? 0.5 : 1,
          },
        ]}
      >
        {block.loading ? (
          <ActivityIndicator color="#FFF" size="small" />
        ) : (
          <Sparkles color="#FFF" size={13} />
        )}
        <Text style={styles.runBtnText}>
          {block.loading ? "Thinking…" : "Run"}
        </Text>
      </TouchableOpacity>
      {block.error ? (
        <Text style={[styles.errorText, { color: "#EF4444" }]}>⚠ {block.error}</Text>
      ) : null}
      {block.response ? (
        <View
          style={[
            styles.aiResponse,
            { backgroundColor: mode === "dark" ? "#1E1B4B" : "#FAF5FF" },
          ]}
        >
          <Text style={{ color: t.text, fontSize: 13, lineHeight: 19 }}>
            {block.response}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Task body ───────────────────────────────────────────────────────────────

function TaskBody({
  block,
  onUpdate,
  t,
  mode,
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
            },
          ]}
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

// ─── Add bar ─────────────────────────────────────────────────────────────────

function AddBar({
  onOpenSlash,
  onAdd,
  t,
  mode,
}: {
  onOpenSlash: () => void;
  onAdd: (kind: BlockKind) => void;
  t: any;
  mode: "light" | "dark";
}) {
  const items: Array<{ kind: BlockKind; label: string; color: string; Icon: any }> = [
    { kind: "note", label: "Note", color: "#6366F1", Icon: FileText },
    { kind: "task", label: "Task", color: "#06B6D4", Icon: ListChecks },
    { kind: "compute", label: "Compute", color: "#10B981", Icon: Calculator },
    { kind: "chart", label: "Chart", color: "#F59E0B", Icon: BarChart3 },
    { kind: "ai", label: "AI", color: "#9333EA", Icon: Wand2 },
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
      <View style={styles.addBarInner}>
        <TouchableOpacity
          onPress={onOpenSlash}
          style={[
            styles.slashBtn,
            { backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9" },
          ]}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          activeOpacity={0.75}
        >
          <Plus color={t.textSecondary} size={13} strokeWidth={2.4} />
          <Text style={[styles.slashBtnText, { color: t.textSecondary }]}>/</Text>
        </TouchableOpacity>
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
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: "700", letterSpacing: -0.3 },
  subtitle: { fontSize: 12, marginTop: 2 },
  restoredStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  restoredStripText: { fontSize: 11.5, fontWeight: "600" },
  body: { padding: spacing.md, gap: 0 },
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
  // Per-block "Ask AI" pill
  askPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  askPillText: { color: ACCENT, fontSize: 11, fontWeight: "700" },
  // Hover-style action row
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
  // ─── Sticky Note ───
  stickyToolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "nowrap",
  },
  swatch: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  pinBtn: {
    padding: 5,
    borderRadius: 7,
  },
  textArea: {
    minHeight: 80,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13.5,
    lineHeight: 19,
    textAlignVertical: "top",
  },
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
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8,
    alignSelf: "flex-start",
  },
  runBtnText: { color: "#FFF", fontSize: 12.5, fontWeight: "700" },
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
  addBarInner: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  slashBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  slashBtnText: { fontSize: 13, fontWeight: "700" },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1,
  },
  addBtnText: { fontSize: 12.5, fontWeight: "700" },
  // ─── Slash menu ───
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.md,
  },
  slashMenu: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 16,
  },
  slashTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    textTransform: "uppercase",
  },
  slashItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  slashIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  slashLabel: { fontSize: 14, fontWeight: "700" },
  slashHint: { fontSize: 11.5, marginTop: 1 },
  // ─── Ask modal ───
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
  askActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
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

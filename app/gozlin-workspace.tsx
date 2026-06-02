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
import { recordAIInteraction } from "@/services/workspaceInsightsService";
import { getFileByUri, type UnifiedFileRecord } from "@/services/fileIndexService";
import { runNoteAction, type NoteAction } from "@/components/workspace/aiActions";
import DocumentStudio from "@/components/workspace/DocumentStudio";
import KnowledgeGraph from "@/components/workspace/KnowledgeGraph";
import ProgressDashboard from "@/components/workspace/ProgressDashboard";
import SourceLibraryPicker from "@/components/workspace/SourceLibraryPicker";
import { SCHEDULE_PENDING_KEY_PREFIX } from "@/app/schedule-task";
import type { PendingScheduleData } from "@/app/schedule-task";
import { useTheme } from "@/services/ThemeProvider";
import { AppHeaderContainer } from "@/components/AppHeaderContainer";
import { GradientView } from "@/components/GradientView";
import AILogoIcon from "@/components/AIButton/AILogoIcon";
import { API_ENDPOINTS } from "@/config/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import Svg, { Circle, G, Line as SvgLine, Path, Polyline, Rect } from "react-native-svg";
import {
  AlarmClock,
  ArrowDownUp,
  ArrowRight,
  Atom,
  BarChart3,
  BarChartHorizontal,
  Bell,
  BellOff,
  BookOpen,
  Calculator,
  ChartColumn,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Copy as CopyIcon,
  FileText,
  FunctionSquare,
  LineChart,
  Link2,
  ListChecks,
  Maximize2,
  Network,
  PenLine,
  PieChart,
  Pin,
  Plus,
  Square,
  Sparkles,
  Trash2,
  Variable,
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
  { id: "Ask",         label: "Ask" },
  { id: "Medical",     label: "Medical" },
  { id: "Chemistry",   label: "Chemistry" },
  { id: "Physics",     label: "Physics" },
  { id: "Biology",     label: "Biology" },
  { id: "Mathematics", label: "Math" },
  { id: "Statistics",  label: "Statistics" },
  { id: "Finance",     label: "Finance" },
  { id: "Astronomy",   label: "Astronomy" },
  { id: "Engineering", label: "Engineering" },
  { id: "Conversions", label: "Convert" },
] as const;

type ScientiaCategory = typeof SCIENTIA_CATEGORIES[number]["id"];

// One calm, theme-aware accent for every field — no childish per-discipline rainbow.
// Reads as frosted white on dark surfaces, slate ink on light ones.
function scientiaAccent(mode: "light" | "dark"): string {
  return mode === "dark" ? "#E2E8F0" : "#475569";
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

const DEG = Math.PI / 180;
const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
};

const _sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const _mean = (a: number[]) => (a.length ? _sum(a) / a.length : 0);
const _gcd2 = (p: number, q: number) => {
  p = Math.abs(p); q = Math.abs(q);
  while (q) { [p, q] = [q, p % q]; }
  return p;
};

const FUNCTIONS: Record<string, (args: number[]) => number> = {
  // ── aggregates (take any number of args) ──
  sum: _sum,
  avg: _mean,
  mean: _mean,
  median: (a) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  },
  min: (a) => (a.length ? Math.min(...a) : 0),
  max: (a) => (a.length ? Math.max(...a) : 0),
  count: (a) => a.length,
  product: (a) => a.reduce((x, y) => x * y, 1),
  stdev: (a) => {
    if (a.length < 2) return 0;
    const m = _mean(a);
    return Math.sqrt(_sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
  },
  variance: (a) => {
    if (a.length < 2) return 0;
    const m = _mean(a);
    return _sum(a.map((x) => (x - m) ** 2)) / (a.length - 1);
  },
  // ── rounding / sign ──
  round: (a) => (a.length > 1 ? Math.round(a[0] * 10 ** a[1]) / 10 ** a[1] : Math.round(a[0] ?? 0)),
  floor: (a) => Math.floor(a[0] ?? 0),
  ceil: (a) => Math.ceil(a[0] ?? 0),
  trunc: (a) => Math.trunc(a[0] ?? 0),
  sign: (a) => Math.sign(a[0] ?? 0),
  abs: (a) => Math.abs(a[0] ?? 0),
  // ── powers / roots ──
  sqrt: (a) => Math.sqrt(a[0] ?? 0),
  cbrt: (a) => Math.cbrt(a[0] ?? 0),
  root: (a) => {
    const x = a[0] ?? 0;
    const n = a[1] ?? 2;
    return Math.sign(x) * Math.abs(x) ** (1 / n);
  },
  pow: (a) => Math.pow(a[0] ?? 0, a[1] ?? 0),
  exp: (a) => Math.exp(a[0] ?? 0),
  hypot: (a) => Math.hypot(...a),
  // ── logarithms ──
  ln: (a) => Math.log(a[0] ?? 0),
  log: (a) => (a.length > 1 ? Math.log(a[0]) / Math.log(a[1]) : Math.log10(a[0] ?? 0)),
  log2: (a) => Math.log2(a[0] ?? 0),
  log10: (a) => Math.log10(a[0] ?? 0),
  // ── number theory ──
  gcd: (a) => (a.length ? a.reduce((x, y) => _gcd2(x, y)) : 0),
  lcm: (a) => (a.length ? a.reduce((x, y) => (!x || !y ? 0 : Math.abs(x * y) / _gcd2(x, y))) : 0),
  mod: (a) => (a[1] ? ((a[0] % a[1]) + a[1]) % a[1] : NaN),
  clamp: (a) => Math.min(Math.max(a[0] ?? 0, a[1] ?? -Infinity), a[2] ?? Infinity),
  fact: (a) => {
    const n = Math.round(a[0] ?? 0);
    if (n < 0 || n > 170) return NaN;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  },
  // ── trig (radians) ──
  sin: (a) => Math.sin(a[0] ?? 0),
  cos: (a) => Math.cos(a[0] ?? 0),
  tan: (a) => Math.tan(a[0] ?? 0),
  asin: (a) => Math.asin(a[0] ?? 0),
  acos: (a) => Math.acos(a[0] ?? 0),
  atan: (a) => Math.atan(a[0] ?? 0),
  atan2: (a) => Math.atan2(a[0] ?? 0, a[1] ?? 0),
  sinh: (a) => Math.sinh(a[0] ?? 0),
  cosh: (a) => Math.cosh(a[0] ?? 0),
  tanh: (a) => Math.tanh(a[0] ?? 0),
  // ── trig (degrees) + angle conversions ──
  sind: (a) => Math.sin((a[0] ?? 0) * DEG),
  cosd: (a) => Math.cos((a[0] ?? 0) * DEG),
  tand: (a) => Math.tan((a[0] ?? 0) * DEG),
  deg: (a) => (a[0] ?? 0) * (180 / Math.PI),
  rad: (a) => (a[0] ?? 0) * DEG,
  // ── misc ──
  percent: (a) => (a[1] ? (a[0] / a[1]) * 100 : NaN),
};
FUNCTIONS.factorial = FUNCTIONS.fact;
FUNCTIONS.stddev = FUNCTIONS.stdev;

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
      // "^" is right-associative (2^3^2 = 2^9 = 512); everything else left.
      const right = parseExpr(tk.v === "^" ? prec : prec + 1);
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
        if (!fn) throw new Error(`Unknown function "${tk.v}()"`);
        return fn(args);
      }
      if (tk.v in vars) return vars[tk.v];
      if (tk.v in CONSTANTS) return CONSTANTS[tk.v];
      const names = Object.keys(vars);
      throw new Error(
        names.length
          ? `Unknown name "${tk.v}" — available: ${names.join(", ")}`
          : `Unknown name "${tk.v}"`,
      );
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
      case "/":
        if (b === 0) throw new Error("Division by zero");
        return a / b;
      case "%":
        if (b === 0) throw new Error("Modulo by zero");
        return a % b;
      case "^": return Math.pow(a, b);
      default: throw new Error(`Unknown operator "${op}"`);
    }
  }

  const result = parseExpr();
  if (pos < tokens.length) throw new Error("Unexpected trailing input");
  return result;
}

// Identifiers an expression references — excludes function calls and constants,
// so they map to other named compute blocks (the dependency graph edges).
function extractRefs(expr: string): string[] {
  let toks: Token[];
  try { toks = tokenize(expr); } catch { return []; }
  const refs = new Set<string>();
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.t === "id") {
      const isCall = toks[i + 1]?.t === "lp";
      if (!isCall && !(tk.v in CONSTANTS) && !(tk.v in FUNCTIONS)) refs.add(tk.v);
    }
  }
  return [...refs];
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
  /** Smart Notes: a linked library document for grounding + automatic citations. */
  sourceUri?: string;
  sourceName?: string;
}

interface ComputeBlock extends BaseBlock {
  kind: "compute";
  name: string;
  expr: string;
  value?: number;
  error?: string;
}

type ChartType = "bar" | "column" | "line" | "pie";
type ChartSort = "none" | "desc" | "asc";

interface ChartBlock extends BaseBlock {
  kind: "chart";
  title: string;
  rawData: string;
  chartType?: ChartType;
  sort?: ChartSort;
  loading?: boolean;
  error?: string;
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

// Top-level WorkSpace views (segmented switcher under the header).
type WorkspaceView = "notebook" | "studio" | "graph" | "progress";

const WORKSPACE_VIEWS: Array<{ id: WorkspaceView; label: string; Icon: any }> = [
  { id: "notebook", label: "Notebook", Icon: BookOpen },
  { id: "studio", label: "Studio", Icon: PenLine },
  { id: "graph", label: "Graph", Icon: Network },
  { id: "progress", label: "Progress", Icon: BarChart3 },
];

interface PersistedState {
  blocks: Block[];
  lastEditedId: string | null;
  updatedAt: number;
}

let _uid = 0;
const newId = () => `b${Date.now()}_${_uid++}`;

// Re-evaluate every compute block in dependency order so a change to one value
// flows through to everything that references it (a live spreadsheet). Returns
// possibly-new blocks plus whether any value/error actually changed, so callers
// can skip a no-op state update and avoid render loops.
function recomputeComputeBlocks(blocks: Block[]): { blocks: Block[]; changed: boolean } {
  const computes = blocks.filter((b) => b.kind === "compute") as ComputeBlock[];
  if (computes.length === 0) return { blocks, changed: false };

  const byName = new Map<string, ComputeBlock>();
  for (const c of computes) if (c.name) byName.set(c.name, c);
  const byId = new Map<string, ComputeBlock>(computes.map((c) => [c.id, c]));

  // Edges: this block depends on the compute blocks whose names it references.
  const depIds = new Map<string, Set<string>>();
  for (const c of computes) {
    const set = new Set<string>();
    for (const name of extractRefs(c.expr)) {
      const dep = byName.get(name);
      if (dep) set.add(dep.id);
    }
    depIds.set(c.id, set);
  }

  // Kahn topological sort. Anything left unordered participates in a cycle.
  const indeg = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const c of computes) {
    indeg.set(c.id, depIds.get(c.id)!.size);
    for (const d of depIds.get(c.id)!) {
      (dependents.get(d) ?? dependents.set(d, []).get(d)!).push(c.id);
    }
  }
  const queue = computes.filter((c) => indeg.get(c.id) === 0).map((c) => c.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const dep of dependents.get(id) ?? []) {
      const next = indeg.get(dep)! - 1;
      indeg.set(dep, next);
      if (next === 0) queue.push(dep);
    }
  }
  const cyclic = new Set(computes.map((c) => c.id));
  for (const id of order) cyclic.delete(id);

  // Evaluate in order, threading each named result into the environment.
  const env: Record<string, number> = {};
  const out = new Map<string, { value?: number; error?: string }>();
  for (const id of order) {
    const c = byId.get(id)!;
    if (!c.expr.trim()) { out.set(id, { value: undefined, error: undefined }); continue; }
    try {
      const v = evalExpression(c.expr, env);
      out.set(id, { value: v, error: undefined });
      if (c.name) env[c.name] = v;
    } catch (e: any) {
      out.set(id, { value: undefined, error: e?.message || "Error" });
    }
  }
  for (const id of cyclic) {
    out.set(id, { value: undefined, error: "Circular reference" });
  }

  let changed = false;
  const next = blocks.map((b) => {
    if (b.kind !== "compute") return b;
    const r = out.get(b.id);
    if (!r) return b;
    if (b.value === r.value && b.error === r.error) return b;
    changed = true;
    return { ...b, value: r.value, error: r.error } as ComputeBlock;
  });
  return { blocks: changed ? next : blocks, changed };
}

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

  // ── WorkSpace view switcher + Smart Notes ───────────────────────────────────
  const [view, setView] = useState<WorkspaceView>("notebook");
  const [noteAIBusyId, setNoteAIBusyId] = useState<string | null>(null);
  const [linkTargetId, setLinkTargetId] = useState<string | null>(null);

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

  // ── Live recompute ─────────────────────────────────────────────────────────
  // Signature over only the *inputs* (name + expr) of compute blocks. When an
  // input changes we re-evaluate the whole dependency graph; writing the new
  // values back doesn't change this signature, so there's no render loop.
  const computeSig = useMemo(
    () =>
      blocks
        .filter((b) => b.kind === "compute")
        .map((b) => `${b.id}␟${(b as ComputeBlock).name}␟${(b as ComputeBlock).expr}`)
        .join("␀"),
    [blocks],
  );
  useEffect(() => {
    if (!hydrated) return;
    setBlocks((prev) => {
      const { blocks: nb, changed } = recomputeComputeBlocks(prev);
      return changed ? nb : prev;
    });
  }, [computeSig, hydrated]);

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
      if (copy.kind === "chart") {
        (copy as ChartBlock).loading = false;
        (copy as ChartBlock).error = undefined;
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
      recordAIInteraction().catch(() => {});
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

  // ── Chart: let AI draft the data from the title + surrounding context ──────
  const runChartAI = useCallback(
    async (id: string) => {
      const block = blocks.find((b) => b.id === id);
      if (!block || block.kind !== "chart") return;
      const cb = block as ChartBlock;
      if (cb.loading) return;
      update(id, { loading: true, error: undefined } as Partial<Block>);
      recordAIInteraction().catch(() => {});
      try {
        const ctx = buildContextBefore(id);
        const prompt =
          `You produce chart data. Reply with ONLY rows of "label, value" — one per ` +
          `line, at most 12 rows. No prose, no header row, no markdown, no code fences.` +
          (cb.title?.trim() ? `\nChart title: "${cb.title.trim()}".` : "") +
          (ctx ? `\nWorkspace context:\n${ctx}` : "") +
          (cb.rawData.trim() ? `\nRefine or extend this existing data:\n${cb.rawData.trim()}` : "");
        const res = await sendChat(prompt, []);
        const cleaned = cleanChartCsv(res.content);
        if (!cleaned) throw new Error("AI returned no usable rows");
        update(id, { rawData: cleaned, loading: false } as Partial<Block>);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } catch (e: any) {
        update(id, { error: e?.message || "AI failed", loading: false } as Partial<Block>);
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
      recordAIInteraction().catch(() => {});
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
      recordAIInteraction().catch(() => {});

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

  // ── Smart Notes: AI actions + source linking ───────────────────────────────
  const runNoteAI = useCallback(
    async (id: string, action: NoteAction) => {
      const block = blocks.find((b) => b.id === id);
      if (!block || block.kind !== "note") return;
      const nb = block as NoteBlock;
      if (!nb.text.trim() || noteAIBusyId) return;
      setNoteAIBusyId(id);
      try {
        let source: UnifiedFileRecord | undefined;
        if (nb.sourceUri) {
          source = (await getFileByUri(nb.sourceUri)) ?? undefined;
        }
        const out = await runNoteAction(action, nb.text, source);
        if (out) {
          const base = `${nb.text}\n\n${out}`.trim();
          const withCite =
            nb.sourceName && !base.includes(nb.sourceName)
              ? `${base}\n\n— ${nb.sourceName}`
              : base;
          update(id, { text: withCite } as Partial<Block>);
        }
      } catch (e: any) {
        Alert.alert("Smart Notes", e?.message || "AI request failed.");
      } finally {
        setNoteAIBusyId(null);
      }
    },
    [blocks, noteAIBusyId, update],
  );

  const linkSourceToNote = useCallback(
    (file: UnifiedFileRecord) => {
      if (!linkTargetId) return;
      const clean = file.name.replace(/\.[a-z0-9]+$/i, "");
      update(linkTargetId, {
        sourceUri: file.uri,
        sourceName: clean,
        sourceLabel: `Source: ${clean}`,
      } as Partial<Block>);
      setLinkTargetId(null);
    },
    [linkTargetId, update],
  );

  const unlinkNoteSource = useCallback(
    (id: string) => {
      update(id, { sourceUri: undefined, sourceName: undefined, sourceLabel: undefined } as Partial<Block>);
    },
    [update],
  );

  const handleJumpToNote = useCallback((noteId: string) => {
    setView("notebook");
    setTimeout(() => {
      const y = blockYRef.current.get(noteId);
      if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
    }, 250);
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
    recordAIInteraction().catch(() => {});
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

      {/* ── View switcher: Notebook · Studio · Graph · Progress ── */}
      <View
        style={[
          styles.viewSwitcher,
          { backgroundColor: mode === "dark" ? "#0F172A" : "#FFFFFF", borderBottomColor: t.border },
        ]}
      >
        {WORKSPACE_VIEWS.map((v) => {
          const activeV = view === v.id;
          return (
            <TouchableOpacity
              key={v.id}
              onPress={() => setView(v.id)}
              style={[styles.viewTab, activeV && { backgroundColor: `${ACCENT}14` }]}
              activeOpacity={0.7}
            >
              <v.Icon size={15} color={activeV ? ACCENT : t.textTertiary} strokeWidth={2.2} />
              <Text style={[styles.viewTabText, { color: activeV ? ACCENT : t.textTertiary }]}>
                {v.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {restoredHint && view === "notebook" ? (
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
        {view === "studio" ? (
          <DocumentStudio mode={mode} t={t} />
        ) : view === "graph" ? (
          <KnowledgeGraph mode={mode} t={t} onJumpToNote={handleJumpToNote} />
        ) : view === "progress" ? (
          <ProgressDashboard mode={mode} t={t} />
        ) : (
        <>
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
                  onRunAI={runAI}
                  onRunChartAI={runChartAI}
                  onRunScientia={runScientia}
                  onSaveScientiaNote={saveScientiaNote}
                  onAskAboutBlock={askAboutBlock}
                  onConvert={convertBlock}
                  onPinNote={pinNote}
                  onUnpinNote={unpinNote}
                  onLinkSource={setLinkTargetId}
                  onUnlinkSource={unlinkNoteSource}
                  onNoteAI={runNoteAI}
                  noteAIBusy={noteAIBusyId === b.id}
                  pinnedNoteId={pinnedNoteId}
                  computeVars={computeVars}
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
        </>
        )}
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

      {/* ── Smart Notes: link a library document as a source ── */}
      <SourceLibraryPicker
        visible={linkTargetId !== null}
        onClose={() => setLinkTargetId(null)}
        onPick={linkSourceToNote}
        title="Link a source"
      />
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
  onRunAI: (id: string) => void;
  onRunChartAI: (id: string) => void;
  onRunScientia: (id: string, queryOverride?: string) => void;
  onSaveScientiaNote: (blockId: string, noteText: string) => void;
  onAskAboutBlock: (b: Block) => void;
  onConvert: (id: string, mode: "summary" | "tasks") => void;
  onPinNote: (id: string) => void;
  onUnpinNote: () => void;
  onLinkSource: (id: string) => void;
  onUnlinkSource: (id: string) => void;
  onNoteAI: (id: string, action: NoteAction) => void;
  noteAIBusy: boolean;
  pinnedNoteId: string | null;
  computeVars: Record<string, number>;
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
  onRunAI,
  onRunChartAI,
  onRunScientia,
  onSaveScientiaNote,
  onAskAboutBlock,
  onConvert,
  onPinNote,
  onUnpinNote,
  onLinkSource,
  onUnlinkSource,
  onNoteAI,
  noteAIBusy,
  pinnedNoteId,
  computeVars,
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
          <SmartNotesBar
            note={block as NoteBlock}
            busy={noteAIBusy}
            onLinkSource={() => onLinkSource(block.id)}
            onUnlinkSource={() => onUnlinkSource(block.id)}
            onNoteAI={(action) => onNoteAI(block.id, action)}
            t={t}
            mode={mode}
          />
        </>
      ) : null}

      {block.kind === "compute" ? (
        <ComputeBody block={block} vars={computeVars} onUpdate={onUpdate} t={t} mode={mode} />
      ) : null}

      {block.kind === "chart" ? (
        <ChartBody
          block={block}
          onUpdate={onUpdate}
          onRunAI={onRunChartAI}
          computeVars={computeVars}
          t={t}
          mode={mode}
        />
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

// ─── Smart Notes bar: AI actions + source linking on a note block ────────────
function SmartNotesBar({
  note,
  busy,
  onLinkSource,
  onUnlinkSource,
  onNoteAI,
  t,
}: {
  note: NoteBlock;
  busy: boolean;
  onLinkSource: () => void;
  onUnlinkSource: () => void;
  onNoteAI: (action: NoteAction) => void;
  t: any;
  mode: "light" | "dark";
}) {
  const hasText = note.text.trim().length > 0;
  const disabled = !hasText || busy;
  const actions: Array<{ action: NoteAction; label: string; Icon: any }> = [
    { action: "expand", label: "Expand", Icon: Maximize2 },
    { action: "summarize", label: "Summarize", Icon: FileText },
    { action: "continue", label: "Continue", Icon: ArrowRight },
    { action: "cleanup", label: "Clean up", Icon: Wand2 },
  ];
  return (
    <View style={styles.smartWrap}>
      <View style={styles.smartActionsRow}>
        {actions.map((a) => (
          <TouchableOpacity
            key={a.action}
            disabled={disabled}
            onPress={() => onNoteAI(a.action)}
            style={[
              styles.smartBtn,
              { backgroundColor: `${ACCENT}14`, borderColor: `${ACCENT}33`, opacity: disabled ? 0.45 : 1 },
            ]}
          >
            <a.Icon size={11} color={ACCENT} strokeWidth={2.4} />
            <Text style={styles.smartBtnText}>{a.label}</Text>
          </TouchableOpacity>
        ))}
        {busy ? <ActivityIndicator size="small" color={ACCENT} style={{ marginLeft: 2 }} /> : null}
      </View>
      {note.sourceName ? (
        <TouchableOpacity
          onPress={onUnlinkSource}
          style={[styles.sourceChipNote, { backgroundColor: `${ACCENT}14` }]}
          activeOpacity={0.7}
        >
          <Link2 size={11} color={ACCENT} />
          <Text style={[styles.sourceChipNoteText, { color: ACCENT }]} numberOfLines={1}>
            {note.sourceName}
          </Text>
          <Text style={[styles.sourceChipX, { color: ACCENT }]}>✕</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={onLinkSource}
          style={[styles.linkSourceBtn, { borderColor: t.border }]}
          activeOpacity={0.7}
        >
          <Link2 size={11} color={t.textSecondary} />
          <Text style={[styles.linkSourceText, { color: t.textSecondary }]}>Link source</Text>
        </TouchableOpacity>
      )}
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

// Function palette for the ƒx helper — names map 1:1 to FUNCTIONS above.
const FN_HELP: { group: string; items: string[] }[] = [
  { group: "Basic", items: ["sqrt", "pow", "abs", "round", "floor", "ceil", "mod", "clamp"] },
  { group: "Stats", items: ["sum", "avg", "median", "min", "max", "stdev", "count", "product"] },
  { group: "Trig°", items: ["sind", "cosd", "tand", "deg", "rad"] },
  { group: "Trig", items: ["sin", "cos", "tan", "asin", "acos", "atan"] },
  { group: "Logs", items: ["ln", "log", "log2", "exp"] },
];
const CONSTANT_CHIPS = ["pi", "e", "tau", "phi"];

function ComputeBody({
  block, vars, onUpdate, t, mode,
}: {
  block: ComputeBlock;
  vars: Record<string, number>;
  onUpdate: (id: string, patch: Partial<Block>) => void;
  t: any;
  mode: "light" | "dark";
}) {
  const bg = mode === "dark" ? "#1E293B" : "#F8FAFC";
  const [showFx, setShowFx] = useState(false);
  const [copied, setCopied] = useState(false);
  // Controlled selection only momentarily, right after a chip insert, so we can
  // drop the caret inside fn(); during normal typing it stays uncontrolled.
  const [sel, setSel] = useState<{ start: number; end: number } | undefined>(undefined);
  const caretRef = useRef(0);
  const exprRef = useRef<TextInput>(null);

  // Every other named compute result is a variable this block can reference.
  const otherVars = useMemo(
    () => Object.entries(vars).filter(([n]) => n !== block.name),
    [vars, block.name],
  );
  const referenced = useMemo(
    () => extractRefs(block.expr).filter((n) => n in vars && n !== block.name),
    [block.expr, block.name, vars],
  );

  const insertAtCursor = useCallback(
    (snippet: string, caretBack = 0) => {
      const cur = block.expr ?? "";
      const pos = Math.min(caretRef.current, cur.length);
      const next = cur.slice(0, pos) + snippet + cur.slice(pos);
      onUpdate(block.id, { expr: next } as Partial<Block>);
      const caret = pos + snippet.length - caretBack;
      caretRef.current = caret;
      setSel({ start: caret, end: caret });
      requestAnimationFrame(() => exprRef.current?.focus());
    },
    [block.expr, block.id, onUpdate],
  );

  const copyResult = useCallback(async () => {
    if (typeof block.value !== "number") return;
    await Clipboard.setStringAsync(formatNumber(block.value)).catch(() => {});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }, [block.value]);

  return (
    <View style={styles.computeWrap}>
      <View style={styles.computeRow}>
        <TextInput
          value={block.name}
          onChangeText={(v) => onUpdate(block.id, { name: v.replace(/[^a-zA-Z0-9_]/g, "") } as Partial<Block>)}
          placeholder="name"
          placeholderTextColor={t.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.computeName, { color: t.text, backgroundColor: bg }]}
        />
        <Text style={[styles.eq, { color: t.textSecondary }]}>=</Text>
        <TextInput
          ref={exprRef}
          value={block.expr}
          onChangeText={(v) => onUpdate(block.id, { expr: v } as Partial<Block>)}
          selection={sel}
          onSelectionChange={(e) => {
            caretRef.current = e.nativeEvent.selection.end;
            if (sel) setSel(undefined);
          }}
          placeholder="2 * 3 + sqrt(16)"
          placeholderTextColor={t.textTertiary}
          style={[styles.computeExpr, { color: t.text, backgroundColor: bg }]}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* ƒx + tap-to-insert variables (discoverability without leaving the field) */}
      <View style={styles.varChipRow}>
        <TouchableOpacity
          onPress={() => setShowFx((v) => !v)}
          style={[styles.fxToggle, { backgroundColor: mode === "dark" ? "#1E293B" : "#EEF2FF" }]}
        >
          <FunctionSquare size={13} color="#6366F1" />
          <Text style={[styles.fxToggleText, { color: "#6366F1" }]}>ƒx</Text>
        </TouchableOpacity>
        {otherVars.map(([name, val]) => (
          <TouchableOpacity
            key={name}
            onPress={() => insertAtCursor(name)}
            style={[styles.varChip, { backgroundColor: "#10B98118" }]}
          >
            <Variable size={11} color="#10B981" />
            <Text style={[styles.varChipText, { color: "#10B981" }]}>
              {name} = {formatNumber(val)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {showFx ? (
        <View style={[styles.fxPanel, { backgroundColor: mode === "dark" ? "#0B1220" : "#F1F5F9" }]}>
          {FN_HELP.map((grp) => (
            <View key={grp.group} style={styles.fxGroup}>
              <Text style={[styles.fxGroupTitle, { color: t.textTertiary }]}>{grp.group}</Text>
              <View style={styles.fxChips}>
                {grp.items.map((fn) => (
                  <TouchableOpacity
                    key={fn}
                    onPress={() => insertAtCursor(`${fn}()`, 1)}
                    style={[styles.fxChip, { backgroundColor: mode === "dark" ? "#1E293B" : "#FFFFFF" }]}
                  >
                    <Text style={[styles.fxChipText, { color: t.text }]}>{fn}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
          <View style={styles.fxGroup}>
            <Text style={[styles.fxGroupTitle, { color: t.textTertiary }]}>Constants</Text>
            <View style={styles.fxChips}>
              {CONSTANT_CHIPS.map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => insertAtCursor(c)}
                  style={[styles.fxChip, { backgroundColor: mode === "dark" ? "#1E293B" : "#FFFFFF" }]}
                >
                  <Text style={[styles.fxChipText, { color: t.text }]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      ) : null}

      {/* Live result / error — no button to press, it recalculates as you type */}
      {block.error ? (
        <Text style={[styles.errorText, { color: "#EF4444" }]}>⚠ {block.error}</Text>
      ) : typeof block.value === "number" ? (
        <View style={styles.resultRow}>
          <TouchableOpacity
            onPress={copyResult}
            activeOpacity={0.7}
            style={[styles.resultPill, { backgroundColor: "#10B98122" }]}
          >
            <Text style={[styles.resultLabel, { color: "#10B981" }]}>=</Text>
            <Text style={[styles.resultValue, { color: t.text }]}>{formatNumber(block.value)}</Text>
            <CopyIcon size={12} color="#10B981" />
          </TouchableOpacity>
          {copied ? <Text style={styles.copiedPill}>Copied</Text> : null}
        </View>
      ) : null}

      {/* Contextual nudge: name it to reuse, or show what it depends on */}
      {!block.name && typeof block.value === "number" ? (
        <Text style={[styles.computeHint, { color: t.textTertiary }]}>
          Name this to reuse its result in other blocks.
        </Text>
      ) : referenced.length ? (
        <Text style={[styles.computeHint, { color: t.textTertiary }]}>
          Live · uses {referenced.join(", ")}
        </Text>
      ) : null}
    </View>
  );
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return n.toLocaleString();
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e9 || abs < 1e-4)) return n.toExponential(3);
  return Number(n.toFixed(4)).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

// ─── Chart body ──────────────────────────────────────────────────────────────

const CHART_PALETTE = [
  "#6366F1", "#06B6D4", "#10B981", "#F59E0B",
  "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6",
] as const;

interface ChartDatum { label: string; values: number[]; }
interface ParsedChart {
  points: ChartDatum[];
  series: number;
  seriesNames: string[];
  skipped: number;
}

// A cell is a plain number, or "=expr" that pulls live values from compute blocks.
function resolveCell(token: string, vars: Record<string, number>): number | null {
  const s = token.trim();
  if (!s) return null;
  if (s.startsWith("=")) {
    try {
      const v = evalExpression(s.slice(1), vars);
      return Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function parseChart(raw: string, vars: Record<string, number>): ParsedChart {
  const rows = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const points: ChartDatum[] = [];
  let seriesNames: string[] = [];
  let series = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.startsWith("#")) continue; // comment
    const cells = row.split(/[,\t]/).map((c) => c.trim());
    if (row.startsWith("@")) { // header: @, Series A, Series B
      seriesNames = cells.slice(1).filter(Boolean);
      continue;
    }
    if (cells.length < 2) { skipped++; continue; }
    const label = cells[0];
    const values: number[] = [];
    for (let i = 1; i < cells.length; i++) {
      const v = resolveCell(cells[i], vars);
      if (v !== null) values.push(v);
    }
    if (!label || values.length === 0) { skipped++; continue; }
    series = Math.max(series, values.length);
    points.push({ label, values });
  }
  for (const p of points) while (p.values.length < series) p.values.push(0);
  return { points, series, seriesNames, skipped };
}

// Keep only "label, number" rows from an AI reply (drop prose / code fences).
function cleanChartCsv(text: string): string {
  return text
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/```/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[^,\t#@]+[,\t]\s*-?\d/.test(l))
    .slice(0, 14)
    .join("\n");
}

const CHART_TYPES: { id: ChartType; label: string; Icon: any }[] = [
  { id: "bar", label: "Bar", Icon: BarChartHorizontal },
  { id: "column", label: "Column", Icon: ChartColumn },
  { id: "line", label: "Line", Icon: LineChart },
  { id: "pie", label: "Pie", Icon: PieChart },
];

function ChartBody({
  block, onUpdate, onRunAI, computeVars, t, mode,
}: {
  block: ChartBlock;
  onUpdate: (id: string, patch: Partial<Block>) => void;
  onRunAI: (id: string) => void;
  computeVars: Record<string, number>;
  t: any;
  mode: "light" | "dark";
}) {
  const bg = mode === "dark" ? "#1E293B" : "#F8FAFC";
  const chartType: ChartType = block.chartType ?? "bar";
  const sort: ChartSort = block.sort ?? "none";
  const [selected, setSelected] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const [showData, setShowData] = useState(!block.rawData.trim());

  const parsed = useMemo(() => parseChart(block.rawData, computeVars), [block.rawData, computeVars]);

  // Apply the sort to display order only (never rewrites the user's text).
  const display = useMemo(() => {
    const order = parsed.points.map((_, i) => i);
    if (sort === "desc") order.sort((a, b) => parsed.points[b].values[0] - parsed.points[a].values[0]);
    else if (sort === "asc") order.sort((a, b) => parsed.points[a].values[0] - parsed.points[b].values[0]);
    return order.map((i) => parsed.points[i]);
  }, [parsed, sort]);

  const total = useMemo(() => display.reduce((s, p) => s + (p.values[0] || 0), 0), [display]);
  const hasData = display.length > 0;
  const usesPrimaryOnly = parsed.series > 1 && (chartType === "bar" || chartType === "pie");

  const select = useCallback((i: number | null) => {
    setSelected((cur) => (cur === i ? null : i));
    Haptics.selectionAsync().catch(() => {});
  }, []);

  // Selection can dangle when data shrinks/resorts — drop it if out of range.
  useEffect(() => {
    if (selected !== null && selected >= display.length) setSelected(null);
  }, [display.length, selected]);

  const cycleSort = useCallback(() => {
    const next: ChartSort = sort === "none" ? "desc" : sort === "desc" ? "asc" : "none";
    onUpdate(block.id, { sort: next } as Partial<Block>);
    setSelected(null); // positions shift, so a stale highlight would mislead
    Haptics.selectionAsync().catch(() => {});
  }, [sort, block.id, onUpdate]);

  return (
    <View style={{ gap: 8 }}>
      <TextInput
        value={block.title}
        onChangeText={(v) => onUpdate(block.id, { title: v } as Partial<Block>)}
        placeholder="Chart title"
        placeholderTextColor={t.textTertiary}
        style={[styles.chartTitle, { color: t.text, backgroundColor: bg }]}
      />

      {/* Chart-type switcher — same data, instantly re-shaped */}
      <View style={styles.chartTypeRow}>
        {CHART_TYPES.map(({ id, label, Icon }) => {
          const active = id === chartType;
          return (
            <TouchableOpacity
              key={id}
              onPress={() => {
                onUpdate(block.id, { chartType: id } as Partial<Block>);
                Haptics.selectionAsync().catch(() => {});
              }}
              style={[
                styles.chartTypeBtn,
                { backgroundColor: active ? "#F59E0B" : mode === "dark" ? "#1E293B" : "#F1F5F9" },
              ]}
            >
              <Icon size={14} color={active ? "#FFFFFF" : t.textSecondary} />
              <Text style={[styles.chartTypeText, { color: active ? "#FFFFFF" : t.textSecondary }]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* The chart itself */}
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {!hasData ? (
          <Text style={[styles.chartHint, { color: t.textTertiary }]}>
            One “label, value” per line. Add extra columns for more series, “=name” to pull a
            Compute result, “#” to comment.
          </Text>
        ) : chartType === "bar" ? (
          <BarChartView points={display} selected={selected} onSelect={select} t={t} mode={mode} />
        ) : chartType === "column" ? (
          <ColumnChartView
            points={display} series={parsed.series} width={width}
            selected={selected} onSelect={select} t={t} mode={mode}
          />
        ) : chartType === "line" ? (
          <LineChartView
            points={display} series={parsed.series} width={width}
            selected={selected} onSelect={select} t={t} mode={mode}
          />
        ) : (
          <PieChartView points={display} width={width} selected={selected} onSelect={select} t={t} />
        )}
      </View>

      {/* Footer: selection detail or totals, plus the sort toggle */}
      {hasData ? (
        <View style={styles.chartFooter}>
          {selected !== null && display[selected] ? (
            <Text style={[styles.chartFooterText, { color: t.text }]} numberOfLines={1}>
              {display[selected].label}: {formatNumber(display[selected].values[0])}
              {total ? ` · ${((display[selected].values[0] / total) * 100).toFixed(1)}%` : ""}
            </Text>
          ) : (
            <Text style={[styles.chartFooterText, { color: t.textTertiary }]} numberOfLines={1}>
              {display.length} points · total {formatNumber(total)}
              {parsed.skipped ? ` · ${parsed.skipped} skipped` : ""}
            </Text>
          )}
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            onPress={cycleSort}
            style={[styles.chartMiniBtn, { backgroundColor: sort !== "none" ? "#F59E0B22" : "transparent" }]}
          >
            <ArrowDownUp size={12} color={sort !== "none" ? "#F59E0B" : t.textSecondary} />
            <Text style={[styles.chartMiniText, { color: sort !== "none" ? "#F59E0B" : t.textSecondary }]}>
              {sort === "none" ? "Sort" : sort === "desc" ? "High→Low" : "Low→High"}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {usesPrimaryOnly ? (
        <Text style={[styles.chartHint, { color: t.textTertiary }]}>
          Showing series 1 of {parsed.series}. Switch to Line or Column to see them all.
        </Text>
      ) : null}

      {/* Data editor — collapsed once a chart exists to keep the result front-and-center */}
      <TouchableOpacity
        onPress={() => setShowData((v) => !v)}
        style={[styles.chartDataToggle, { backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9" }]}
      >
        <Text style={[styles.chartDataToggleText, { color: t.textSecondary }]}>
          {showData ? "Hide data" : hasData ? "Edit data" : "Add data"}
        </Text>
      </TouchableOpacity>

      {showData ? (
        <>
          <TextInput
            value={block.rawData}
            onChangeText={(v) => onUpdate(block.id, { rawData: v } as Partial<Block>)}
            placeholder={"Jan, 120\nFeb, 180\nMar, 240\nApr, 160"}
            placeholderTextColor={t.textTertiary}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.chartData, { color: t.text, backgroundColor: bg }]}
          />
          <TouchableOpacity
            onPress={() => onRunAI(block.id)}
            disabled={block.loading}
            style={[styles.chartAIBtn, { backgroundColor: `${ACCENT}14`, opacity: block.loading ? 0.6 : 1 }]}
          >
            {block.loading ? (
              <ActivityIndicator color={ACCENT} size="small" />
            ) : (
              <Sparkles color={ACCENT} size={13} />
            )}
            <Text style={[styles.chartDataToggleText, { color: ACCENT }]}>
              {block.loading ? "Drafting…" : "AI data"}
            </Text>
          </TouchableOpacity>
          {block.error ? (
            <Text style={[styles.errorText, { color: "#EF4444" }]}>⚠ {block.error}</Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

// Horizontal bars — diverge from a zero baseline so negatives read correctly.
function BarChartView({
  points, selected, onSelect, t, mode,
}: {
  points: ChartDatum[];
  selected: number | null;
  onSelect: (i: number) => void;
  t: any;
  mode: "light" | "dark";
}) {
  const vals = points.map((p) => p.values[0]);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const range = max - min || 1;
  const zeroPct = ((0 - min) / range) * 100;
  const hasNeg = min < 0;
  const trackBg = mode === "dark" ? "#0B1220" : "#EEF2F7";

  return (
    <View style={styles.chartArea}>
      {points.map((p, i) => {
        const v = p.values[0];
        const leftPct = ((Math.min(v, 0) - min) / range) * 100;
        const wPct = Math.max(1.5, (Math.abs(v) / range) * 100);
        const dim = selected !== null && selected !== i;
        const color = CHART_PALETTE[i % CHART_PALETTE.length];
        return (
          <TouchableOpacity key={i} activeOpacity={0.7} onPress={() => onSelect(i)} style={styles.chartRow}>
            <Text
              style={[styles.chartLabel, { color: selected === i ? t.text : t.textSecondary, fontWeight: selected === i ? "700" : "400" }]}
              numberOfLines={1}
            >
              {p.label}
            </Text>
            <View style={[styles.chartTrack, { backgroundColor: trackBg }]}>
              {hasNeg ? <View style={[styles.chartZeroLine, { left: `${zeroPct}%` }]} /> : null}
              <View style={[styles.chartBarAbs, { left: `${leftPct}%`, width: `${wPct}%`, backgroundColor: color, opacity: dim ? 0.3 : 1 }]} />
            </View>
            <Text style={[styles.chartValue, { color: t.text }]}>{formatNumber(v)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// Vertical grouped columns (all series), drawn in SVG for a clean baseline.
function ColumnChartView({
  points, series, width, selected, onSelect, t, mode,
}: {
  points: ChartDatum[];
  series: number;
  width: number;
  selected: number | null;
  onSelect: (i: number) => void;
  t: any;
  mode: "light" | "dark";
}) {
  const H = 180, padTop = 10, padBottom = 6;
  const w = Math.max(width, 40);
  const plotH = H - padTop - padBottom;
  const all = points.flatMap((p) => p.values.slice(0, series));
  const min = Math.min(0, ...all);
  const max = Math.max(0, ...all);
  const range = max - min || 1;
  const yOf = (v: number) => padTop + ((max - v) / range) * plotH;
  const zeroY = yOf(0);
  const n = points.length;
  const groupW = w / Math.max(1, n);
  const innerPad = Math.min(groupW * 0.16, 10);
  const barsW = groupW - innerPad * 2;
  const barW = barsW / Math.max(1, series);

  return (
    <View>
      <Svg width={w} height={H}>
        <SvgLine x1={0} y1={zeroY} x2={w} y2={zeroY} stroke={mode === "dark" ? "#334155" : "#CBD5E1"} strokeWidth={1} />
        {points.map((p, i) => {
          const dim = selected !== null && selected !== i;
          const gx = i * groupW + innerPad;
          return (
            <G key={i}>
              {p.values.slice(0, series).map((v, s) => {
                const x = gx + s * barW;
                const y = yOf(Math.max(v, 0));
                const h = Math.max(1, Math.abs(yOf(v) - zeroY));
                return (
                  <Rect
                    key={s}
                    x={x + barW * 0.1}
                    y={y}
                    width={barW * 0.8}
                    height={h}
                    rx={2}
                    fill={CHART_PALETTE[s % CHART_PALETTE.length]}
                    opacity={dim ? 0.3 : 1}
                  />
                );
              })}
              <Rect x={i * groupW} y={0} width={groupW} height={H} fill="transparent" onPress={() => onSelect(i)} />
            </G>
          );
        })}
      </Svg>
      <View style={styles.chartXLabels}>
        {points.map((p, i) => (
          <Text
            key={i}
            numberOfLines={1}
            style={[styles.chartXLabel, { color: selected === i ? t.text : t.textTertiary, fontWeight: selected === i ? "700" : "400" }]}
          >
            {p.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

// Multi-series line chart with selectable points.
function LineChartView({
  points, series, width, selected, onSelect, t, mode,
}: {
  points: ChartDatum[];
  series: number;
  width: number;
  selected: number | null;
  onSelect: (i: number) => void;
  t: any;
  mode: "light" | "dark";
}) {
  const H = 180, padTop = 12, padBottom = 8, padX = 8;
  const w = Math.max(width, 40);
  const plotH = H - padTop - padBottom;
  const all = points.flatMap((p) => p.values.slice(0, series));
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (min === max) { min -= 1; max += 1; }
  const range = max - min || 1;
  const n = points.length;
  const xOf = (i: number) => (n <= 1 ? w / 2 : padX + (i / (n - 1)) * (w - padX * 2));
  const yOf = (v: number) => padTop + ((max - v) / range) * plotH;
  const bandW = w / Math.max(1, n);

  return (
    <View>
      <Svg width={w} height={H}>
        {min < 0 && max > 0 ? (
          <SvgLine x1={0} y1={yOf(0)} x2={w} y2={yOf(0)} stroke={mode === "dark" ? "#334155" : "#E2E8F0"} strokeWidth={1} />
        ) : null}
        {Array.from({ length: series }).map((_, s) => {
          const pts = points.map((p, i) => `${xOf(i)},${yOf(p.values[s] ?? 0)}`).join(" ");
          return (
            <Polyline
              key={s}
              points={pts}
              fill="none"
              stroke={CHART_PALETTE[s % CHART_PALETTE.length]}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
        {points.map((p, i) => {
          const sel = selected === i;
          return (
            <G key={i}>
              {p.values.slice(0, series).map((v, s) => (
                <Circle
                  key={s}
                  cx={xOf(i)}
                  cy={yOf(v)}
                  r={sel ? 4.5 : 3}
                  fill={CHART_PALETTE[s % CHART_PALETTE.length]}
                  opacity={selected !== null && !sel ? 0.35 : 1}
                />
              ))}
              <Rect x={xOf(i) - bandW / 2} y={0} width={bandW} height={H} fill="transparent" onPress={() => onSelect(i)} />
            </G>
          );
        })}
      </Svg>
      <View style={styles.chartXLabels}>
        {points.map((p, i) => (
          <Text
            key={i}
            numberOfLines={1}
            style={[styles.chartXLabel, { color: selected === i ? t.text : t.textTertiary, fontWeight: selected === i ? "700" : "400" }]}
          >
            {p.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

// Donut + legend (primary series). Tap a slice or a legend row to focus it.
function PieChartView({
  points, width, selected, onSelect, t,
}: {
  points: ChartDatum[];
  width: number;
  selected: number | null;
  onSelect: (i: number) => void;
  t: any;
}) {
  const size = Math.min(Math.max(width * 0.45, 120), 180);
  const r = size / 2;
  const inner = r * 0.56;
  const cx = r, cy = r;
  const vals = points.map((p) => Math.max(0, p.values[0]));
  const total = vals.reduce((a, b) => a + b, 0);

  const polar = (ang: number, rad: number): [number, number] => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
  const arcPath = (start: number, end: number, outer: number, innerR: number) => {
    const large = end - start > Math.PI ? 1 : 0;
    const [x1, y1] = polar(start, outer);
    const [x2, y2] = polar(end, outer);
    const [x3, y3] = polar(end, innerR);
    const [x4, y4] = polar(start, innerR);
    return `M ${x1} ${y1} A ${outer} ${outer} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${large} 0 ${x4} ${y4} Z`;
  };

  let angle = -Math.PI / 2;
  const arcs = vals.map((v) => {
    const frac = total > 0 ? v / total : 0;
    const start = angle;
    const end = angle + frac * Math.PI * 2;
    angle = end;
    return { start, end, frac };
  });

  return (
    <View style={styles.pieWrap}>
      <Svg width={size} height={size}>
        {total > 0
          ? arcs.map((a, i) => {
              if (a.frac <= 0) return null;
              const sel = selected === i;
              const outer = sel ? r : r * 0.93;
              return (
                <Path
                  key={i}
                  d={arcPath(a.start, a.end, outer, inner)}
                  fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                  opacity={selected !== null && !sel ? 0.4 : 1}
                  onPress={() => onSelect(i)}
                />
              );
            })
          : null}
      </Svg>
      <View style={styles.pieLegend}>
        {points.map((p, i) => {
          const pct = total > 0 ? (Math.max(0, p.values[0]) / total) * 100 : 0;
          const sel = selected === i;
          return (
            <TouchableOpacity key={i} onPress={() => onSelect(i)} activeOpacity={0.7} style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length], opacity: selected !== null && !sel ? 0.4 : 1 }]} />
              <Text style={[styles.legendLabel, { color: sel ? t.text : t.textSecondary, fontWeight: sel ? "700" : "500" }]} numberOfLines={1}>
                {p.label}
              </Text>
              <Text style={[styles.legendPct, { color: t.textTertiary }]}>{pct.toFixed(0)}%</Text>
            </TouchableOpacity>
          );
        })}
      </View>
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

type ScientiaVarType = "number" | "expr" | "text" | "choice";
interface ScientiaFormulaVar { key: string; label: string; unit?: string; placeholder: string; type?: ScientiaVarType; options?: string[]; }
interface ScientiaFormula { id: string; label: string; vars: ScientiaFormulaVar[]; buildQuery: (v: Record<string, string>) => string; }

const SCIENCE_TEMPLATES: Partial<Record<string, ScientiaFormula[]>> = {
  Physics: [
    { id: "f_ma", label: "F = ma", vars: [{key:"m",label:"Mass",unit:"kg",placeholder:"10"},{key:"a",label:"Accel.",unit:"m/s²",placeholder:"9.8"}], buildQuery: v => `Newton's 2nd law: mass = ${v.m||"?"} kg, acceleration = ${v.a||"?"} m/s²` },
    { id: "ke", label: "KE = ½mv²", vars: [{key:"m",label:"Mass",unit:"kg",placeholder:"5"},{key:"v",label:"Velocity",unit:"m/s",placeholder:"10"}], buildQuery: v => `Kinetic energy: mass = ${v.m||"?"} kg, velocity = ${v.v||"?"} m/s` },
    { id: "ohm", label: "V = IR", vars: [{key:"I",label:"Current",unit:"A",placeholder:"2"},{key:"R",label:"Resistance",unit:"Ω",placeholder:"5"}], buildQuery: v => `Ohm's law: find voltage, current = ${v.I||"?"} A, resistance = ${v.R||"?"} Ω` },
    { id: "pe", label: "PE = mgh", vars: [{key:"m",label:"Mass",unit:"kg",placeholder:"10"},{key:"h",label:"Height",unit:"m",placeholder:"5"}], buildQuery: v => `Gravitational potential energy: mass = ${v.m||"?"} kg, height = ${v.h||"?"} m` },
    { id: "vel", label: "v = u + at", vars: [{key:"u",label:"Init v",unit:"m/s",placeholder:"0"},{key:"a",label:"Accel.",unit:"m/s²",placeholder:"9.8"},{key:"t",label:"Time",unit:"s",placeholder:"3"}], buildQuery: v => `Final velocity: u = ${v.u||"?"} m/s, a = ${v.a||"?"} m/s², t = ${v.t||"?"} s` },
    { id: "power", label: "P = IV", vars: [{key:"I",label:"Current",unit:"A",placeholder:"5"},{key:"V",label:"Voltage",unit:"V",placeholder:"12"}], buildQuery: v => `Electrical power: current = ${v.I||"?"} A, voltage = ${v.V||"?"} V` },
    { id: "momentum", label: "p = mv", vars: [{key:"m",label:"Mass",unit:"kg",placeholder:"2"},{key:"v",label:"Velocity",unit:"m/s",placeholder:"15"}], buildQuery: v => `Momentum: mass = ${v.m||"?"} kg, velocity = ${v.v||"?"} m/s` },
    { id: "work", label: "W = Fd", vars: [{key:"F",label:"Force",unit:"N",placeholder:"50"},{key:"d",label:"Distance",unit:"m",placeholder:"3"}], buildQuery: v => `Work done: force = ${v.F||"?"} N, distance = ${v.d||"?"} m` },
    { id: "density", label: "ρ = m/V", vars: [{key:"m",label:"Mass",unit:"kg",placeholder:"2"},{key:"V",label:"Volume",unit:"m³",placeholder:"0.001"}], buildQuery: v => `Density: mass = ${v.m||"?"} kg, volume = ${v.V||"?"} m³` },
    { id: "pressure", label: "P = F/A", vars: [{key:"F",label:"Force",unit:"N",placeholder:"500"},{key:"A",label:"Area",unit:"m²",placeholder:"0.25"}], buildQuery: v => `Pressure: force = ${v.F||"?"} N, area = ${v.A||"?"} m²` },
    { id: "wave", label: "v = fλ", vars: [{key:"f",label:"Frequency",unit:"Hz",placeholder:"440"},{key:"lam",label:"Wavelength",unit:"m",placeholder:"0.78"}], buildQuery: v => `Wave speed: frequency = ${v.f||"?"} Hz, wavelength = ${v.lam||"?"} m` },
    { id: "grav", label: "F = Gm₁m₂/r²", vars: [{key:"m1",label:"Mass 1",unit:"kg",placeholder:"5.97e24"},{key:"m2",label:"Mass 2",unit:"kg",placeholder:"7.35e22"},{key:"r",label:"Distance",unit:"m",placeholder:"3.84e8"}], buildQuery: v => `Newton's law of gravitation: m₁ = ${v.m1||"?"} kg, m₂ = ${v.m2||"?"} kg, r = ${v.r||"?"} m` },
  ],
  Chemistry: [
    { id: "molarity", label: "Molarity M=n/V", vars: [{key:"n",label:"Moles",unit:"mol",placeholder:"0.5"},{key:"V",label:"Volume",unit:"L",placeholder:"1"}], buildQuery: v => `Molarity: moles = ${v.n||"?"} mol, volume = ${v.V||"?"} L` },
    { id: "ph", label: "pH = -log[H⁺]", vars: [{key:"H",label:"[H⁺]",unit:"mol/L",placeholder:"1e-7"}], buildQuery: v => `pH from H+ concentration = ${v.H||"?"} mol/L` },
    { id: "poh", label: "pOH = -log[OH⁻]", vars: [{key:"OH",label:"[OH⁻]",unit:"mol/L",placeholder:"1e-7"}], buildQuery: v => `pOH and pH from OH- concentration = ${v.OH||"?"} mol/L` },
    { id: "ideal_gas", label: "PV = nRT", vars: [{key:"P",label:"Pressure",unit:"atm",placeholder:"1"},{key:"V",label:"Volume",unit:"L",placeholder:"22.4"},{key:"n",label:"Moles",unit:"mol",placeholder:"1"},{key:"T",label:"Temp",unit:"K",placeholder:"273"}], buildQuery: v => `Ideal gas: P = ${v.P||"?"} atm, V = ${v.V||"?"} L, n = ${v.n||"?"} mol, T = ${v.T||"?"} K` },
    { id: "dilution", label: "C₁V₁ = C₂V₂", vars: [{key:"C1",label:"C₁",unit:"M",placeholder:"2"},{key:"V1",label:"V₁",unit:"mL",placeholder:"50"},{key:"V2",label:"V₂ final",unit:"mL",placeholder:"100"}], buildQuery: v => `Dilution: C1 = ${v.C1||"?"} M, V1 = ${v.V1||"?"} mL, final volume = ${v.V2||"?"} mL` },
    { id: "moles", label: "n = m/M", vars: [{key:"m",label:"Mass",unit:"g",placeholder:"18"},{key:"M",label:"Molar mass",unit:"g/mol",placeholder:"18.02"}], buildQuery: v => `Moles from mass: mass = ${v.m||"?"} g, molar mass = ${v.M||"?"} g/mol` },
    { id: "molar_mass", label: "Molar Mass", vars: [{key:"cpd",label:"Compound",placeholder:"H₂O",type:"text"}], buildQuery: v => `Molar mass of ${v.cpd||"?"}` },
    { id: "mass_pct", label: "Mass %", vars: [{key:"solute",label:"Solute",unit:"g",placeholder:"5"},{key:"soln",label:"Solution",unit:"g",placeholder:"100"}], buildQuery: v => `Mass percent: solute = ${v.solute||"?"} g, total solution = ${v.soln||"?"} g` },
    { id: "pct_yield", label: "% Yield", vars: [{key:"act",label:"Actual",unit:"g",placeholder:"45"},{key:"theo",label:"Theoretical",unit:"g",placeholder:"60"}], buildQuery: v => `Percent yield: actual = ${v.act||"?"} g, theoretical = ${v.theo||"?"} g` },
    { id: "half_life", label: "Radioactive Decay", vars: [{key:"N0",label:"Initial amount",placeholder:"100"},{key:"hl",label:"Half-life",unit:"s",placeholder:"30"},{key:"t",label:"Elapsed time",unit:"s",placeholder:"90"}], buildQuery: v => `Radioactive decay: N₀ = ${v.N0||"?"}, half-life = ${v.hl||"?"} s, elapsed time = ${v.t||"?"} s` },
    { id: "particles", label: "N = n·Nₐ", vars: [{key:"n",label:"Moles",unit:"mol",placeholder:"2"}], buildQuery: v => `Number of particles in ${v.n||"?"} mol (Avogadro's number)` },
  ],
  Medical: [
    { id: "bmi", label: "BMI", vars: [{key:"w",label:"Weight",unit:"kg",placeholder:"70"},{key:"h",label:"Height",unit:"m",placeholder:"1.75"}], buildQuery: v => `BMI: weight = ${v.w||"?"} kg, height = ${v.h||"?"} m` },
    { id: "map", label: "MAP", vars: [{key:"s",label:"Systolic",unit:"mmHg",placeholder:"120"},{key:"d",label:"Diastolic",unit:"mmHg",placeholder:"80"}], buildQuery: v => `Mean arterial pressure: systolic = ${v.s||"?"} mmHg, diastolic = ${v.d||"?"} mmHg` },
    { id: "gfr", label: "eGFR (CKD-EPI)", vars: [{key:"cr",label:"Creatinine",unit:"mg/dL",placeholder:"1.0"},{key:"age",label:"Age",unit:"yrs",placeholder:"45"},{key:"sex",label:"Sex",placeholder:"M",type:"choice",options:["M","F"]}], buildQuery: v => `eGFR (CKD-EPI): creatinine = ${v.cr||"?"} mg/dL, age = ${v.age||"?"} yrs, sex = ${v.sex||"M"}` },
    { id: "crcl", label: "CrCl (Cockcroft-Gault)", vars: [{key:"age",label:"Age",unit:"yrs",placeholder:"60"},{key:"w",label:"Weight",unit:"kg",placeholder:"70"},{key:"cr",label:"Creatinine",unit:"mg/dL",placeholder:"1.2"},{key:"sex",label:"Sex",placeholder:"M",type:"choice",options:["M","F"]}], buildQuery: v => `Creatinine clearance (Cockcroft-Gault): age = ${v.age||"?"} yrs, weight = ${v.w||"?"} kg, creatinine = ${v.cr||"?"} mg/dL, sex = ${v.sex||"M"}` },
    { id: "dose", label: "Drug Dose", vars: [{key:"dose",label:"Dose",unit:"mg/kg",placeholder:"10"},{key:"w",label:"Weight",unit:"kg",placeholder:"70"}], buildQuery: v => `Drug dose: ${v.dose||"?"} mg/kg × ${v.w||"?"} kg patient` },
    { id: "bsa", label: "Body Surface Area", vars: [{key:"w",label:"Weight",unit:"kg",placeholder:"70"},{key:"h",label:"Height",unit:"cm",placeholder:"175"}], buildQuery: v => `Body surface area (Mosteller): weight = ${v.w||"?"} kg, height = ${v.h||"?"} cm` },
    { id: "ibw", label: "Ideal Body Weight", vars: [{key:"h",label:"Height",unit:"cm",placeholder:"175"},{key:"sex",label:"Sex",placeholder:"M",type:"choice",options:["M","F"]}], buildQuery: v => `Ideal body weight (Devine): height = ${v.h||"?"} cm, sex = ${v.sex||"M"}` },
    { id: "anion_gap", label: "Anion Gap", vars: [{key:"na",label:"Na⁺",unit:"mEq/L",placeholder:"140"},{key:"cl",label:"Cl⁻",unit:"mEq/L",placeholder:"104"},{key:"hco3",label:"HCO₃⁻",unit:"mEq/L",placeholder:"24"}], buildQuery: v => `Anion gap: Na = ${v.na||"?"}, Cl = ${v.cl||"?"}, HCO3 = ${v.hco3||"?"} mEq/L` },
    { id: "corr_ca", label: "Corrected Calcium", vars: [{key:"ca",label:"Calcium",unit:"mg/dL",placeholder:"8.0"},{key:"alb",label:"Albumin",unit:"g/dL",placeholder:"2.5"}], buildQuery: v => `Corrected calcium: measured Ca = ${v.ca||"?"} mg/dL, albumin = ${v.alb||"?"} g/dL` },
    { id: "qtc", label: "QTc (Bazett)", vars: [{key:"qt",label:"QT interval",unit:"ms",placeholder:"400"},{key:"hr",label:"Heart rate",unit:"bpm",placeholder:"75"}], buildQuery: v => `Corrected QT (Bazett): QT = ${v.qt||"?"} ms, heart rate = ${v.hr||"?"} bpm` },
    { id: "ldl", label: "LDL (Friedewald)", vars: [{key:"tc",label:"Total chol.",unit:"mg/dL",placeholder:"200"},{key:"hdl",label:"HDL",unit:"mg/dL",placeholder:"50"},{key:"tg",label:"Triglycerides",unit:"mg/dL",placeholder:"150"}], buildQuery: v => `LDL cholesterol (Friedewald): total = ${v.tc||"?"}, HDL = ${v.hdl||"?"}, triglycerides = ${v.tg||"?"} mg/dL` },
    { id: "hba1c", label: "HbA1c → Glucose", vars: [{key:"a1c",label:"HbA1c",unit:"%",placeholder:"6.5"}], buildQuery: v => `Convert HbA1c ${v.a1c||"?"}% to average blood glucose mg/dL` },
  ],
  Mathematics: [
    { id: "quad", label: "Quadratic", vars: [{key:"a",label:"a",placeholder:"1"},{key:"b",label:"b",placeholder:"-5"},{key:"c",label:"c",placeholder:"6"}], buildQuery: v => `Quadratic formula: ${v.a||"?"}x² + ${v.b||"?"}x + ${v.c||"?"} = 0` },
    { id: "pyth", label: "Pythagorean", vars: [{key:"a",label:"Side a",placeholder:"3"},{key:"b",label:"Side b",placeholder:"4"}], buildQuery: v => `Pythagorean theorem: a = ${v.a||"?"}, b = ${v.b||"?"}, find hypotenuse c` },
    { id: "circle", label: "Circle", vars: [{key:"r",label:"Radius",placeholder:"5"}], buildQuery: v => `Area and circumference of circle with radius = ${v.r||"?"}` },
    { id: "deriv", label: "Derivative", vars: [{key:"f",label:"f(x)",placeholder:"x^3 + 2x",type:"expr"}], buildQuery: v => `Derivative of f(x) = ${v.f||"?"}` },
    { id: "integ", label: "Definite Integral", vars: [{key:"f",label:"f(x)",placeholder:"x^2",type:"expr"},{key:"a",label:"From",placeholder:"0"},{key:"b",label:"To",placeholder:"1"}], buildQuery: v => `Definite integral of ${v.f||"?"} from ${v.a||"?"} to ${v.b||"?"}` },
    { id: "log", label: "Logarithm", vars: [{key:"base",label:"Base",placeholder:"e",type:"text"},{key:"x",label:"x",placeholder:"100"}], buildQuery: v => `Logarithm base ${v.base||"?"} of ${v.x||"?"}` },
    { id: "ncr", label: "Combination ⁿCᵣ", vars: [{key:"n",label:"n",placeholder:"10"},{key:"r",label:"r",placeholder:"3"}], buildQuery: v => `Combinations: choose ${v.r||"?"} from ${v.n||"?"} (nCr)` },
    { id: "npr", label: "Permutation ⁿPᵣ", vars: [{key:"n",label:"n",placeholder:"10"},{key:"r",label:"r",placeholder:"3"}], buildQuery: v => `Permutations: arrange ${v.r||"?"} from ${v.n||"?"} (nPr)` },
    { id: "fact", label: "Factorial n!", vars: [{key:"n",label:"n",placeholder:"6"}], buildQuery: v => `Factorial of ${v.n||"?"}` },
    { id: "slope", label: "Slope of Line", vars: [{key:"x1",label:"x₁",placeholder:"1"},{key:"y1",label:"y₁",placeholder:"2"},{key:"x2",label:"x₂",placeholder:"4"},{key:"y2",label:"y₂",placeholder:"10"}], buildQuery: v => `Slope and equation of line through (${v.x1||"?"}, ${v.y1||"?"}) and (${v.x2||"?"}, ${v.y2||"?"})` },
    { id: "trig", label: "Trig Function", vars: [{key:"fn",label:"Function",placeholder:"sin",type:"choice",options:["sin","cos","tan"]},{key:"ang",label:"Angle",unit:"°",placeholder:"30"}], buildQuery: v => `${v.fn||"sin"}(${v.ang||"?"}°)` },
  ],
  Biology: [
    { id: "pop", label: "Population Growth", vars: [{key:"N0",label:"Initial N",placeholder:"100"},{key:"r",label:"Rate",unit:"/yr",placeholder:"0.05"},{key:"t",label:"Time",unit:"yrs",placeholder:"10"}], buildQuery: v => `Exponential population growth: N₀=${v.N0||"?"}, r=${v.r||"?"}/yr, t=${v.t||"?"} yrs` },
    { id: "hw", label: "Hardy-Weinberg", vars: [{key:"p",label:"Allele freq p",placeholder:"0.7"}], buildQuery: v => `Hardy-Weinberg equilibrium: p = ${v.p||"?"}` },
    { id: "mm", label: "Michaelis-Menten", vars: [{key:"Vm",label:"Vmax",unit:"μmol/min",placeholder:"10"},{key:"Km",label:"Km",unit:"mM",placeholder:"2"},{key:"S",label:"[S]",unit:"mM",placeholder:"5"}], buildQuery: v => `Michaelis-Menten: Vmax=${v.Vm||"?"} μmol/min, Km=${v.Km||"?"} mM, [S]=${v.S||"?"} mM` },
    { id: "double", label: "Doubling Time", vars: [{key:"r",label:"Growth rate",unit:"%",placeholder:"3"}], buildQuery: v => `Cell doubling time with growth rate = ${v.r||"?"}%` },
    { id: "mort", label: "Mortality Rate", vars: [{key:"d",label:"Deaths",placeholder:"50"},{key:"n",label:"Population",placeholder:"10000"}], buildQuery: v => `Mortality rate: ${v.d||"?"} deaths in population of ${v.n||"?"}` },
    { id: "bmr", label: "BMR (Mifflin)", vars: [{key:"w",label:"Weight",unit:"kg",placeholder:"70"},{key:"h",label:"Height",unit:"cm",placeholder:"175"},{key:"age",label:"Age",unit:"yrs",placeholder:"30"},{key:"sex",label:"Sex",placeholder:"M",type:"choice",options:["M","F"]}], buildQuery: v => `Basal metabolic rate (Mifflin-St Jeor): weight = ${v.w||"?"} kg, height = ${v.h||"?"} cm, age = ${v.age||"?"} yrs, sex = ${v.sex||"M"}` },
    { id: "fold", label: "Fold Change", vars: [{key:"treat",label:"Treated",placeholder:"800"},{key:"ctrl",label:"Control",placeholder:"200"}], buildQuery: v => `Fold change: treated = ${v.treat||"?"}, control = ${v.ctrl||"?"}` },
    { id: "dilf", label: "Dilution Factor", vars: [{key:"stock",label:"Stock vol.",unit:"mL",placeholder:"1"},{key:"final",label:"Final vol.",unit:"mL",placeholder:"10"}], buildQuery: v => `Dilution factor: stock = ${v.stock||"?"} mL diluted to ${v.final||"?"} mL` },
    { id: "gc", label: "GC Content", vars: [{key:"seq",label:"DNA sequence",placeholder:"ATGCGC",type:"text"}], buildQuery: v => `GC content (%) of DNA sequence: ${v.seq||"?"}` },
    { id: "punnett", label: "Cross Ratio", vars: [{key:"p1",label:"Parent 1",placeholder:"Aa",type:"text"},{key:"p2",label:"Parent 2",placeholder:"Aa",type:"text"}], buildQuery: v => `Monohybrid cross genotype/phenotype ratio: ${v.p1||"?"} × ${v.p2||"?"}` },
  ],
  Statistics: [
    { id: "mean_sd", label: "Mean & Std Dev", vars: [{key:"data",label:"Data set",placeholder:"4, 8, 15, 16, 23, 42",type:"text"}], buildQuery: v => `Mean, median, variance and standard deviation of: ${v.data||"?"}` },
    { id: "zscore", label: "Z-Score", vars: [{key:"x",label:"Value x",placeholder:"85"},{key:"mu",label:"Mean μ",placeholder:"70"},{key:"sd",label:"Std dev σ",placeholder:"10"}], buildQuery: v => `Z-score: x = ${v.x||"?"}, mean = ${v.mu||"?"}, standard deviation = ${v.sd||"?"}` },
    { id: "ncr", label: "Combination ⁿCᵣ", vars: [{key:"n",label:"n",placeholder:"52"},{key:"r",label:"r",placeholder:"5"}], buildQuery: v => `Combinations nCr: choose ${v.r||"?"} from ${v.n||"?"}` },
    { id: "prob", label: "Probability", vars: [{key:"fav",label:"Favorable",placeholder:"13"},{key:"tot",label:"Total",placeholder:"52"}], buildQuery: v => `Probability: ${v.fav||"?"} favorable outcomes out of ${v.tot||"?"}` },
    { id: "ci", label: "95% Conf. Interval", vars: [{key:"mu",label:"Sample mean",placeholder:"100"},{key:"sd",label:"Std dev",placeholder:"15"},{key:"n",label:"Sample size",placeholder:"30"}], buildQuery: v => `95% confidence interval: mean = ${v.mu||"?"}, std dev = ${v.sd||"?"}, n = ${v.n||"?"}` },
    { id: "binom", label: "Binomial P", vars: [{key:"n",label:"Trials n",placeholder:"10"},{key:"k",label:"Successes k",placeholder:"3"},{key:"p",label:"P(success)",placeholder:"0.5"}], buildQuery: v => `Binomial probability: n = ${v.n||"?"} trials, k = ${v.k||"?"} successes, p = ${v.p||"?"}` },
    { id: "perc", label: "Percentile (Normal)", vars: [{key:"x",label:"Value",placeholder:"120"},{key:"mu",label:"Mean",placeholder:"100"},{key:"sd",label:"Std dev",placeholder:"15"}], buildQuery: v => `Normal-distribution percentile of value = ${v.x||"?"} (mean = ${v.mu||"?"}, std dev = ${v.sd||"?"})` },
    { id: "samp", label: "Sample Size", vars: [{key:"moe",label:"Margin of error",unit:"%",placeholder:"5"},{key:"conf",label:"Confidence",placeholder:"95%",type:"choice",options:["90%","95%","99%"]},{key:"p",label:"Est. proportion",placeholder:"0.5"}], buildQuery: v => `Required sample size: margin of error = ${v.moe||"?"}%, confidence = ${v.conf||"95%"}, proportion = ${v.p||"0.5"}` },
  ],
  Finance: [
    { id: "compound", label: "Compound Interest", vars: [{key:"P",label:"Principal",placeholder:"1000"},{key:"r",label:"Annual rate",unit:"%",placeholder:"5"},{key:"n",label:"Compounds/yr",placeholder:"12"},{key:"t",label:"Years",placeholder:"10"}], buildQuery: v => `Compound interest: principal = ${v.P||"?"}, annual rate = ${v.r||"?"}%, compounded ${v.n||"?"}×/yr, ${v.t||"?"} years` },
    { id: "simple", label: "Simple Interest", vars: [{key:"P",label:"Principal",placeholder:"1000"},{key:"r",label:"Annual rate",unit:"%",placeholder:"5"},{key:"t",label:"Years",placeholder:"3"}], buildQuery: v => `Simple interest: principal = ${v.P||"?"}, rate = ${v.r||"?"}%, time = ${v.t||"?"} years` },
    { id: "loan", label: "Loan Payment", vars: [{key:"P",label:"Loan amount",placeholder:"20000"},{key:"r",label:"Annual rate",unit:"%",placeholder:"6"},{key:"n",label:"Term",unit:"months",placeholder:"60"}], buildQuery: v => `Monthly loan payment: amount = ${v.P||"?"}, annual rate = ${v.r||"?"}%, term = ${v.n||"?"} months` },
    { id: "fv", label: "Future Value", vars: [{key:"P",label:"Present value",placeholder:"5000"},{key:"r",label:"Rate/period",unit:"%",placeholder:"4"},{key:"n",label:"Periods",placeholder:"10"}], buildQuery: v => `Future value: present value = ${v.P||"?"}, rate = ${v.r||"?"}% per period, ${v.n||"?"} periods` },
    { id: "pv", label: "Present Value", vars: [{key:"FV",label:"Future value",placeholder:"10000"},{key:"r",label:"Rate/period",unit:"%",placeholder:"4"},{key:"n",label:"Periods",placeholder:"10"}], buildQuery: v => `Present value: future value = ${v.FV||"?"}, discount rate = ${v.r||"?"}% per period, ${v.n||"?"} periods` },
    { id: "roi", label: "ROI", vars: [{key:"gain",label:"Final value",placeholder:"1500"},{key:"cost",label:"Initial cost",placeholder:"1000"}], buildQuery: v => `Return on investment: final value = ${v.gain||"?"}, initial cost = ${v.cost||"?"}` },
    { id: "cagr", label: "CAGR", vars: [{key:"begin",label:"Start value",placeholder:"1000"},{key:"end",label:"End value",placeholder:"2500"},{key:"yrs",label:"Years",placeholder:"5"}], buildQuery: v => `Compound annual growth rate (CAGR): start = ${v.begin||"?"}, end = ${v.end||"?"}, ${v.yrs||"?"} years` },
    { id: "breakeven", label: "Break-Even", vars: [{key:"fixed",label:"Fixed cost",placeholder:"10000"},{key:"price",label:"Unit price",placeholder:"25"},{key:"varc",label:"Unit var. cost",placeholder:"15"}], buildQuery: v => `Break-even units: fixed cost = ${v.fixed||"?"}, price/unit = ${v.price||"?"}, variable cost/unit = ${v.varc||"?"}` },
  ],
  Engineering: [
    { id: "stress", label: "Stress σ=F/A", vars: [{key:"F",label:"Force",unit:"N",placeholder:"5000"},{key:"A",label:"Area",unit:"m²",placeholder:"0.01"}], buildQuery: v => `Mechanical stress: F=${v.F||"?"} N, A=${v.A||"?"} m²` },
    { id: "strain", label: "Strain ε=ΔL/L", vars: [{key:"dL",label:"ΔLength",unit:"m",placeholder:"0.002"},{key:"L",label:"Orig length",unit:"m",placeholder:"2"}], buildQuery: v => `Strain: ΔL=${v.dL||"?"} m, L₀=${v.L||"?"} m` },
    { id: "mech_pwr", label: "Power P=Fv", vars: [{key:"F",label:"Force",unit:"N",placeholder:"100"},{key:"v",label:"Velocity",unit:"m/s",placeholder:"10"}], buildQuery: v => `Mechanical power: F=${v.F||"?"} N, v=${v.v||"?"} m/s` },
    { id: "torque", label: "Torque τ=Fr", vars: [{key:"F",label:"Force",unit:"N",placeholder:"50"},{key:"r",label:"Lever arm",unit:"m",placeholder:"0.3"}], buildQuery: v => `Torque: force = ${v.F||"?"} N, lever arm = ${v.r||"?"} m` },
    { id: "flow", label: "Fluid Flow Q=Av", vars: [{key:"A",label:"Area",unit:"m²",placeholder:"0.01"},{key:"v",label:"Velocity",unit:"m/s",placeholder:"2"}], buildQuery: v => `Volumetric flow rate: A=${v.A||"?"} m², v=${v.v||"?"} m/s` },
    { id: "reynolds", label: "Reynolds Number", vars: [{key:"rho",label:"Density",unit:"kg/m³",placeholder:"1000"},{key:"v",label:"Velocity",unit:"m/s",placeholder:"2"},{key:"D",label:"Diameter",unit:"m",placeholder:"0.05"},{key:"mu",label:"Viscosity",unit:"Pa·s",placeholder:"0.001"}], buildQuery: v => `Reynolds number: ρ=${v.rho||"?"} kg/m³, v=${v.v||"?"} m/s, D=${v.D||"?"} m, μ=${v.mu||"?"} Pa·s` },
    { id: "beam", label: "Beam Deflection", vars: [{key:"P",label:"Load",unit:"N",placeholder:"1000"},{key:"L",label:"Length",unit:"m",placeholder:"3"},{key:"E",label:"E",unit:"GPa",placeholder:"200"},{key:"I",label:"I",unit:"m⁴",placeholder:"1e-4"}], buildQuery: v => `Simply supported beam: P=${v.P||"?"}N, L=${v.L||"?"}m, E=${v.E||"?"}GPa, I=${v.I||"?"}m⁴` },
    { id: "thermal", label: "Heat Transfer Q=UAΔt", vars: [{key:"U",label:"U coeff",unit:"W/m²K",placeholder:"5"},{key:"A",label:"Area",unit:"m²",placeholder:"10"},{key:"dT",label:"ΔTemp",unit:"°C",placeholder:"30"}], buildQuery: v => `Heat transfer: U=${v.U||"?"} W/m²K, A=${v.A||"?"} m², ΔT=${v.dT||"?"}°C` },
    { id: "eff", label: "Efficiency", vars: [{key:"out",label:"Output",unit:"W",placeholder:"750"},{key:"in",label:"Input",unit:"W",placeholder:"1000"}], buildQuery: v => `Efficiency: output = ${v.out||"?"} W, input = ${v.in||"?"} W` },
    { id: "fos", label: "Factor of Safety", vars: [{key:"ult",label:"Ultimate stress",unit:"MPa",placeholder:"400"},{key:"work",label:"Working stress",unit:"MPa",placeholder:"100"}], buildQuery: v => `Factor of safety: ultimate stress = ${v.ult||"?"} MPa, working stress = ${v.work||"?"} MPa` },
  ],
  Astronomy: [
    { id: "kepler3", label: "Kepler's 3rd Law", vars: [{key:"a",label:"Semi-major axis",unit:"AU",placeholder:"1"}], buildQuery: v => `Kepler's 3rd law: orbital period for a = ${v.a||"?"} AU` },
    { id: "hubble", label: "Hubble's Law", vars: [{key:"v",label:"Recession v",unit:"km/s",placeholder:"1000"}], buildQuery: v => `Hubble's law distance: recession velocity = ${v.v||"?"} km/s` },
    { id: "schw", label: "Schwarzschild R", vars: [{key:"M",label:"Mass",unit:"M☉",placeholder:"10"}], buildQuery: v => `Schwarzschild radius: mass = ${v.M||"?"} solar masses` },
    { id: "dist", label: "Parallax Distance", vars: [{key:"p",label:"Parallax",unit:"arcsec",placeholder:"0.1"}], buildQuery: v => `Stellar distance from parallax = ${v.p||"?"} arcsec` },
    { id: "lum", label: "Luminosity", vars: [{key:"R",label:"Radius",unit:"R☉",placeholder:"1"},{key:"T",label:"Temperature",unit:"K",placeholder:"5778"}], buildQuery: v => `Stellar luminosity: R=${v.R||"?"} R☉, T=${v.T||"?"} K` },
    { id: "esc", label: "Escape Velocity", vars: [{key:"M",label:"Mass",unit:"kg",placeholder:"5.97e24"},{key:"R",label:"Radius",unit:"m",placeholder:"6.37e6"}], buildQuery: v => `Escape velocity: M=${v.M||"?"} kg, R=${v.R||"?"} m` },
    { id: "redshift", label: "Redshift z", vars: [{key:"obs",label:"Observed λ",unit:"nm",placeholder:"660"},{key:"rest",label:"Rest λ",unit:"nm",placeholder:"656"}], buildQuery: v => `Cosmological redshift z: observed wavelength = ${v.obs||"?"} nm, rest wavelength = ${v.rest||"?"} nm` },
    { id: "orbv", label: "Orbital Velocity", vars: [{key:"M",label:"Central mass",unit:"kg",placeholder:"1.99e30"},{key:"r",label:"Orbit radius",unit:"m",placeholder:"1.5e11"}], buildQuery: v => `Orbital velocity: central mass = ${v.M||"?"} kg, orbital radius = ${v.r||"?"} m` },
    { id: "surfg", label: "Surface Gravity", vars: [{key:"M",label:"Mass",unit:"kg",placeholder:"5.97e24"},{key:"R",label:"Radius",unit:"m",placeholder:"6.37e6"}], buildQuery: v => `Surface gravity: mass = ${v.M||"?"} kg, radius = ${v.R||"?"} m` },
    { id: "distmod", label: "Distance Modulus", vars: [{key:"m",label:"Apparent mag",placeholder:"8"},{key:"M",label:"Absolute mag",placeholder:"4.8"}], buildQuery: v => `Distance from distance modulus: apparent magnitude = ${v.m||"?"}, absolute magnitude = ${v.M||"?"}` },
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
  { id: "Power",       label: "Power",       units: ["W", "kW", "MW", "hp", "BTU/h"] },
  { id: "Force",       label: "Force",       units: ["N", "kN", "lbf", "kgf", "dyne"] },
  { id: "Pressure",    label: "Pressure",    units: ["Pa", "kPa", "bar", "atm", "psi", "mmHg"] },
  { id: "Angle",       label: "Angle",       units: ["°", "rad", "grad", "arcmin", "arcsec"] },
  { id: "Frequency",   label: "Frequency",   units: ["Hz", "kHz", "MHz", "GHz", "rpm"] },
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
  const accent = scientiaAccent(mode);

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
                  { backgroundColor: isActive ? `${accent}26` : bg, borderColor: isActive ? accent : borderC },
                ]}
                activeOpacity={0.7}
              >
                <Text style={[scStyles.catChipText, { color: isActive ? accent : t.textSecondary }]}>{cat.label}</Text>
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
        <ScienceCalcBody key={block.category} block={block} onUpdate={onUpdate} onRun={onRun} onSaveNote={onSaveNote} t={t} mode={mode} />
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
  const accent = scientiaAccent(mode);
  const onBtn = mode === "dark" ? "#0F172A" : "#FFFFFF";
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
        style={[styles.runBtn, { backgroundColor: accent, opacity: block.loading || !block.query.trim() ? 0.5 : 1 }]}
      >
        {block.loading ? <ActivityIndicator color={onBtn} size="small" /> : <Atom color={onBtn} size={13} strokeWidth={2.4} />}
        <Text style={[styles.runBtnText, { color: onBtn }]}>{block.loading ? "Thinking…" : "Ask GozlinScientia"}</Text>
      </TouchableOpacity>
      {block.error ? <Text style={[styles.errorText, { color: "#EF4444" }]}>⚠ {block.error}</Text> : null}
      {block.result && !block.loading ? (
        <ScientiaResultPanel result={block.result} catColor={accent} mode={mode} t={t} onSaveNote={onSaveNote} />
      ) : null}
    </View>
  );
}

// ─── Scientific keypad ────────────────────────────────────────────────────────
// One tactile, calculator-style keypad shared by every field. The "science row"
// swaps its symbols per discipline so each calculator feels purpose-built —
// physics gets π/^/√, chemistry gets parentheses & ×10ⁿ, math gets operators…

interface SciKey { label: string; ins?: string; }
interface FieldKeypad { sci: SciKey[]; extra: SciKey; }

const SCI_EE: SciKey = { label: "×10ⁿ", ins: "e" };
const KEYPAD_CONFIG: Record<string, FieldKeypad> = {
  Medical:     { sci: [], extra: { label: "%" } },
  Chemistry:   { sci: [{ label: "(" }, { label: ")" }, { label: "−", ins: "-" }], extra: SCI_EE },
  Physics:     { sci: [{ label: "π" }, { label: "^" }, { label: "√" }], extra: SCI_EE },
  Biology:     { sci: [{ label: "%" }, { label: "(" }, { label: ")" }], extra: SCI_EE },
  Mathematics: { sci: [{ label: "x" }, { label: "^" }, { label: "√" }, { label: "π" }, { label: "(" }, { label: ")" }, { label: "+" }, { label: "−", ins: "-" }, { label: "×", ins: "*" }, { label: "÷", ins: "/" }], extra: { label: "00" } },
  Statistics:  { sci: [{ label: "%" }, { label: "(" }, { label: ")" }], extra: SCI_EE },
  Finance:     { sci: [], extra: { label: "%" } },
  Astronomy:   { sci: [{ label: "π" }, { label: "^" }], extra: SCI_EE },
  Engineering: { sci: [{ label: "π" }, { label: "^" }, { label: "√" }], extra: SCI_EE },
};
const DEFAULT_KEYPAD: FieldKeypad = { sci: [{ label: "π" }, { label: "^" }, { label: "√" }], extra: SCI_EE };
const CONV_KEYPAD: FieldKeypad = { sci: [], extra: SCI_EE };

type KeyAction =
  | { type: "char"; value: string }
  | { type: "back" }
  | { type: "clear" }
  | { type: "neg" };

function applyKey(value: string, a: KeyAction): string {
  switch (a.type) {
    case "char": return value + a.value;
    case "back": return value.slice(0, -1);
    case "clear": return "";
    case "neg": return value.startsWith("-") ? value.slice(1) : "-" + value;
    default: return value;
  }
}

function CalcButton({
  label, onPress, mode, accent, variant = "digit", flex = 1,
}: {
  label: string;
  onPress: () => void;
  mode: "light" | "dark";
  accent: string;
  variant?: "digit" | "action";
  flex?: number;
}) {
  const isDark = mode === "dark";
  const isAction = variant === "action";
  const bg = isAction ? `${accent}1F` : isDark ? "#1E293B" : "#FFFFFF";
  const border = isAction ? `${accent}55` : isDark ? "#334155" : "#E2E8F0";
  const color = isAction ? accent : isDark ? "#F1F5F9" : "#0F172A";
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      style={[scStyles.calcKey, { flex, backgroundColor: bg, borderColor: border }]}
    >
      <Text style={[scStyles.calcKeyText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function CalcKeypad({
  config, onAction, mode, accent,
}: {
  config: FieldKeypad;
  onAction: (a: KeyAction) => void;
  mode: "light" | "dark";
  accent: string;
}) {
  const ch = (v: string): KeyAction => ({ type: "char", value: v });
  // Chunk the discipline-specific keys into even rows (max 5 per row) so a long
  // row like Math's operators wraps cleanly instead of squeezing into one line.
  const sciRows: SciKey[][] = [];
  for (let i = 0; i < config.sci.length; i += 5) sciRows.push(config.sci.slice(i, i + 5));
  return (
    <View style={{ gap: 7 }}>
      {/* Field-specific science rows */}
      {sciRows.map((row, ri) => (
        <View key={ri} style={scStyles.calcRow}>
          {row.map((k, i) => (
            <CalcButton key={i} label={k.label} variant="action" mode={mode} accent={accent} onPress={() => onAction(ch(k.ins ?? k.label))} />
          ))}
        </View>
      ))}
      {/* Number pad */}
      <View style={scStyles.calcRow}>
        <CalcButton label="7" mode={mode} accent={accent} onPress={() => onAction(ch("7"))} />
        <CalcButton label="8" mode={mode} accent={accent} onPress={() => onAction(ch("8"))} />
        <CalcButton label="9" mode={mode} accent={accent} onPress={() => onAction(ch("9"))} />
        <CalcButton label="⌫" variant="action" mode={mode} accent={accent} onPress={() => onAction({ type: "back" })} />
      </View>
      <View style={scStyles.calcRow}>
        <CalcButton label="4" mode={mode} accent={accent} onPress={() => onAction(ch("4"))} />
        <CalcButton label="5" mode={mode} accent={accent} onPress={() => onAction(ch("5"))} />
        <CalcButton label="6" mode={mode} accent={accent} onPress={() => onAction(ch("6"))} />
        <CalcButton label="C" variant="action" mode={mode} accent={accent} onPress={() => onAction({ type: "clear" })} />
      </View>
      <View style={scStyles.calcRow}>
        <CalcButton label="1" mode={mode} accent={accent} onPress={() => onAction(ch("1"))} />
        <CalcButton label="2" mode={mode} accent={accent} onPress={() => onAction(ch("2"))} />
        <CalcButton label="3" mode={mode} accent={accent} onPress={() => onAction(ch("3"))} />
        <CalcButton label="±" variant="action" mode={mode} accent={accent} onPress={() => onAction({ type: "neg" })} />
      </View>
      <View style={scStyles.calcRow}>
        <CalcButton label="0" flex={2} mode={mode} accent={accent} onPress={() => onAction(ch("0"))} />
        <CalcButton label="." mode={mode} accent={accent} onPress={() => onAction(ch("."))} />
        <CalcButton label={config.extra.label} variant="action" mode={mode} accent={accent} onPress={() => onAction(ch(config.extra.ins ?? config.extra.label))} />
      </View>
    </View>
  );
}

// Frosted "calculator screen" that shows the value being entered.
function CalcDisplay({
  label, unit, value, placeholder, accent, t, mode,
}: {
  label: string;
  unit?: string;
  value: string;
  placeholder?: string;
  accent: string;
  t: any;
  mode: "light" | "dark";
}) {
  const hasVal = !!value;
  return (
    <View style={[scStyles.calcDisplay, {
      backgroundColor: mode === "dark" ? "#0B1220" : "#F1F5F9",
      borderColor: `${accent}30`,
    }]}>
      <Text style={[scStyles.calcDisplayLabel, { color: t.textTertiary }]} numberOfLines={1}>
        {label}{unit ? `  ·  ${unit}` : ""}
      </Text>
      <Text
        style={[scStyles.calcDisplayValue, { color: hasVal ? t.text : t.textTertiary }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {hasVal ? value : (placeholder || "0")}
      </Text>
    </View>
  );
}

// ─── Conversion calculator ────────────────────────────────────────────────────
// A real converter: a numeric keypad for the value, and the units themselves as
// calculator keys. Tap a unit to assign it to the active side (From/To), then it
// auto-advances to the other — no typing, pure tapping.

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
  const accent = scientiaAccent(mode);
  const onBtn = mode === "dark" ? "#0F172A" : "#FFFFFF";

  const [convType, setConvType] = React.useState(CONV_TYPES[0]);
  const [fromUnit, setFromUnit] = React.useState(CONV_TYPES[0].units[0]);
  const [toUnit, setToUnit] = React.useState(CONV_TYPES[0].units[1]);
  const [value, setValue] = React.useState("");
  const [target, setTarget] = React.useState<"from" | "to">("from");

  const handleUnitTap = (u: string) => {
    if (target === "from") { setFromUnit(u); setTarget("to"); }
    else { setToUnit(u); setTarget("from"); }
  };

  const handleConvert = () => {
    const q = `Convert ${value || "1"} ${fromUnit} to ${toUnit}`;
    onUpdate(block.id, { query: q, result: undefined, error: undefined } as Partial<Block>);
    onRun(block.id, q);
  };

  return (
    <View style={{ gap: 10 }}>
      {/* Conversion type chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: 6, paddingVertical: 2 }}>
          {CONV_TYPES.map((ct) => {
            const active = convType.id === ct.id;
            return (
              <TouchableOpacity
                key={ct.id}
                onPress={() => { setConvType(ct); setFromUnit(ct.units[0]); setToUnit(ct.units[1] || ct.units[0]); setTarget("from"); }}
                style={[scStyles.catChip, { backgroundColor: active ? `${accent}26` : bg, borderColor: active ? accent : borderC }]}
                activeOpacity={0.7}
              >
                <Text style={[scStyles.catChipText, { color: active ? accent : t.textSecondary }]}>{ct.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Display: value + From → To target toggles */}
      <View style={[scStyles.calcDisplay, {
        backgroundColor: mode === "dark" ? "#0B1220" : "#F1F5F9",
        borderColor: `${accent}30`,
        gap: 10,
      }]}>
        <Text style={[scStyles.calcDisplayValue, { color: value ? t.text : t.textTertiary }]} numberOfLines={1} adjustsFontSizeToFit>
          {value || "0"}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TouchableOpacity
            onPress={() => setTarget("from")}
            style={[scStyles.convPill, {
              backgroundColor: target === "from" ? `${accent}26` : "transparent",
              borderColor: target === "from" ? accent : borderC,
            }]}
            activeOpacity={0.7}
          >
            <Text style={[scStyles.convPillLabel, { color: t.textTertiary }]}>FROM</Text>
            <Text style={[scStyles.convPillUnit, { color: t.text }]}>{fromUnit}</Text>
          </TouchableOpacity>
          <Text style={{ color: accent, fontSize: 20, fontWeight: "800" }}>→</Text>
          <TouchableOpacity
            onPress={() => setTarget("to")}
            style={[scStyles.convPill, {
              backgroundColor: target === "to" ? `${accent}26` : "transparent",
              borderColor: target === "to" ? accent : borderC,
            }]}
            activeOpacity={0.7}
          >
            <Text style={[scStyles.convPillLabel, { color: t.textTertiary }]}>TO</Text>
            <Text style={[scStyles.convPillUnit, { color: t.text }]}>{toUnit}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Unit keys — tap to assign to the active side */}
      <View style={scStyles.unitGrid}>
        {convType.units.map((u) => {
          const isFrom = fromUnit === u;
          const isTo = toUnit === u;
          return (
            <TouchableOpacity
              key={u}
              onPress={() => handleUnitTap(u)}
              activeOpacity={0.6}
              style={[scStyles.unitKey, {
                backgroundColor: isFrom ? `${accent}26` : mode === "dark" ? "#1E293B" : "#FFFFFF",
                borderColor: isFrom || isTo ? accent : borderC,
                borderWidth: isFrom ? 1.5 : isTo ? 1.5 : 1,
                borderStyle: "solid",
              }]}
            >
              <Text style={[scStyles.unitKeyText, { color: isFrom || isTo ? accent : t.text }]}>{u}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Numeric keypad for the value */}
      <CalcKeypad config={CONV_KEYPAD} mode={mode} accent={accent} onAction={(a) => setValue((prev) => applyKey(prev, a))} />

      {/* Convert button */}
      <TouchableOpacity
        onPress={handleConvert}
        disabled={block.loading}
        style={[styles.runBtn, { backgroundColor: accent, opacity: block.loading ? 0.5 : 1 }]}
      >
        {block.loading ? <ActivityIndicator color={onBtn} size="small" /> : <Atom color={onBtn} size={13} strokeWidth={2.4} />}
        <Text style={[styles.runBtnText, { color: onBtn }]}>{block.loading ? "Converting…" : "Convert"}</Text>
      </TouchableOpacity>

      {block.error ? <Text style={[styles.errorText, { color: "#EF4444" }]}>⚠ {block.error}</Text> : null}
      {block.result && !block.loading ? (
        <ScientiaResultPanel result={block.result} catColor={accent} mode={mode} t={t} onSaveNote={onSaveNote} />
      ) : null}
    </View>
  );
}

// ─── Science field calculator ─────────────────────────────────────────────────
// Pick a formula → a purpose-built calculator appears. Each variable is a tab;
// the active one is filled with a real keypad (or option buttons / text field
// for non-numeric inputs). No empty placeholders — it feels like a calculator.

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
  const accent = scientiaAccent(mode);
  const onBtn = mode === "dark" ? "#0F172A" : "#FFFFFF";
  const templates = SCIENCE_TEMPLATES[block.category] ?? [];
  const keypad = KEYPAD_CONFIG[block.category] ?? DEFAULT_KEYPAD;

  const [selectedFormula, setSelectedFormula] = React.useState<ScientiaFormula | null>(templates[0] ?? null);
  const [varValues, setVarValues] = React.useState<Record<string, string>>({});
  const [activeKey, setActiveKey] = React.useState<string | null>(templates[0]?.vars[0]?.key ?? null);
  const [customMode, setCustomMode] = React.useState(false);

  const handleFormulaSelect = (f: ScientiaFormula) => {
    setSelectedFormula(f);
    setVarValues({});
    setActiveKey(f.vars[0]?.key ?? null);
    setCustomMode(false);
    if (block.result || block.error) onUpdate(block.id, { result: undefined, error: undefined } as Partial<Block>);
  };

  const setVar = (key: string, val: string) => setVarValues((prev) => ({ ...prev, [key]: val }));

  const advance = (fromKey: string) => {
    if (!selectedFormula) return;
    const idx = selectedFormula.vars.findIndex((v) => v.key === fromKey);
    const next = selectedFormula.vars[idx + 1];
    if (next) setActiveKey(next.key);
  };

  const handleCalculate = () => {
    if (customMode) { onRun(block.id); return; }
    if (!selectedFormula) return;
    const builtQuery = selectedFormula.buildQuery(varValues);
    onUpdate(block.id, { query: builtQuery, result: undefined, error: undefined } as Partial<Block>);
    onRun(block.id, builtQuery);
  };

  const canRun = customMode
    ? !block.loading && !!block.query.trim()
    : !block.loading && !!selectedFormula;

  const activeVar = !customMode && selectedFormula
    ? selectedFormula.vars.find((v) => v.key === activeKey) ?? selectedFormula.vars[0]
    : undefined;
  const activeType = activeVar?.type ?? "number";

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
                style={[scStyles.catChip, { backgroundColor: active ? `${accent}26` : bg, borderColor: active ? accent : borderC }]}
                activeOpacity={0.7}
              >
                <Text style={[scStyles.catChipText, { color: active ? accent : t.textSecondary }]}>{f.label}</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            onPress={() => { setCustomMode(true); setSelectedFormula(null); }}
            style={[scStyles.catChip, { backgroundColor: customMode ? `${accent}26` : bg, borderColor: customMode ? accent : borderC }]}
            activeOpacity={0.7}
          >
            <Text style={[scStyles.catChipText, { color: customMode ? accent : t.textSecondary }]}>Custom</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Custom free-text mode */}
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
      ) : selectedFormula && activeVar ? (
        <View style={{ gap: 9 }}>
          {/* Variable tabs (only when more than one) */}
          {selectedFormula.vars.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", gap: 6, paddingVertical: 2 }}>
                {selectedFormula.vars.map((v) => {
                  const on = v.key === activeKey;
                  const val = varValues[v.key]?.trim();
                  return (
                    <TouchableOpacity
                      key={v.key}
                      onPress={() => setActiveKey(v.key)}
                      activeOpacity={0.7}
                      style={[scStyles.varTab, {
                        backgroundColor: on ? `${accent}26` : bg,
                        borderColor: on ? accent : borderC,
                      }]}
                    >
                      <Text style={[scStyles.varTabLabel, { color: on ? accent : t.textSecondary }]} numberOfLines={1}>{v.label}</Text>
                      <Text style={[scStyles.varTabValue, { color: val ? t.text : t.textTertiary }]} numberOfLines={1}>
                        {val || v.placeholder}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          ) : null}

          {/* Active variable input */}
          {activeType === "text" ? (
            <View style={[scStyles.calcDisplay, { backgroundColor: mode === "dark" ? "#0B1220" : "#F1F5F9", borderColor: `${accent}30`, gap: 8 }]}>
              <Text style={[scStyles.calcDisplayLabel, { color: t.textTertiary }]}>{activeVar.label}{activeVar.unit ? `  ·  ${activeVar.unit}` : ""}</Text>
              <TextInput
                value={varValues[activeVar.key] ?? ""}
                onChangeText={(val) => setVar(activeVar.key, val)}
                placeholder={activeVar.placeholder}
                placeholderTextColor={t.textTertiary}
                style={[scStyles.calcTextInput, { color: t.text, backgroundColor: bg, borderColor: borderC }]}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          ) : activeType === "choice" ? (
            <View style={{ gap: 8 }}>
              <CalcDisplay label={activeVar.label} unit={activeVar.unit} value={varValues[activeVar.key] ?? ""} placeholder={`Pick ${activeVar.label.toLowerCase()}`} accent={accent} t={t} mode={mode} />
              <View style={scStyles.calcSciRow}>
                {(activeVar.options ?? []).map((opt) => {
                  const sel = varValues[activeVar.key] === opt;
                  return (
                    <TouchableOpacity
                      key={opt}
                      onPress={() => { setVar(activeVar.key, opt); advance(activeVar.key); }}
                      activeOpacity={0.6}
                      style={[scStyles.calcKey, {
                        backgroundColor: sel ? `${accent}26` : mode === "dark" ? "#1E293B" : "#FFFFFF",
                        borderColor: sel ? accent : borderC,
                      }]}
                    >
                      <Text style={[scStyles.calcKeyText, { color: sel ? accent : t.text, fontSize: 15 }]}>{opt}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : (
            <>
              <CalcDisplay label={activeVar.label} unit={activeVar.unit} value={varValues[activeVar.key] ?? ""} placeholder={activeVar.placeholder} accent={accent} t={t} mode={mode} />
              <CalcKeypad config={keypad} mode={mode} accent={accent} onAction={(a) => setVarValues((prev) => ({ ...prev, [activeVar.key]: applyKey(prev[activeVar.key] ?? "", a) }))} />
            </>
          )}
        </View>
      ) : (
        <View style={[scStyles.formulaHint, { backgroundColor: `${accent}10`, borderColor: `${accent}25` }]}>
          <Atom color={accent} size={14} strokeWidth={2.2} />
          <Text style={{ color: t.textTertiary, fontSize: 12, flex: 1 }}>
            Select a formula above, or tap <Text style={{ color: accent, fontWeight: "700" }}>Custom</Text> to type freely.
          </Text>
        </View>
      )}

      {/* Calculate button */}
      <TouchableOpacity
        onPress={handleCalculate}
        disabled={!canRun}
        style={[styles.runBtn, { backgroundColor: accent, opacity: !canRun ? 0.5 : 1 }]}
      >
        {block.loading ? <ActivityIndicator color={onBtn} size="small" /> : <Atom color={onBtn} size={13} strokeWidth={2.4} />}
        <Text style={[styles.runBtnText, { color: onBtn }]}>{block.loading ? "Calculating…" : "Calculate"}</Text>
      </TouchableOpacity>

      {block.error ? <Text style={[styles.errorText, { color: "#EF4444" }]}>⚠ {block.error}</Text> : null}
      {block.result && !block.loading ? (
        <ScientiaResultPanel result={block.result} catColor={accent} mode={mode} t={t} onSaveNote={onSaveNote} />
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
  // Compute is replaced by the Document Studio view (top switcher), so it's no
  // longer offered here. Existing compute blocks still render for backward-compat.
  const items: Array<{ kind: BlockKind; label: string; color: string; Icon: any }> = [
    { kind: "note",     label: "Note",     color: "#6366F1", Icon: FileText },
    { kind: "task",     label: "Task",     color: "#06B6D4", Icon: ListChecks },
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

  // ── View switcher ──
  viewSwitcher: {
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  viewTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 7,
    borderRadius: 10,
  },
  viewTabText: { fontSize: 12, fontWeight: "700" },

  // ── Smart Notes bar ──
  smartWrap: { gap: 7, marginTop: 2 },
  smartActionsRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  smartBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
    borderWidth: 1,
  },
  smartBtnText: { color: ACCENT, fontSize: 11, fontWeight: "700" },
  sourceChipNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
    maxWidth: "100%",
  },
  sourceChipNoteText: { fontSize: 11.5, fontWeight: "700", flexShrink: 1 },
  sourceChipX: { fontSize: 11, fontWeight: "700", marginLeft: 1 },
  linkSourceBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
    borderWidth: 1,
  },
  linkSourceText: { fontSize: 11.5, fontWeight: "600" },

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
  chartBarAbs: { position: "absolute", top: 0, bottom: 0, borderRadius: 4 },
  chartZeroLine: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "rgba(148,163,184,0.7)" },
  chartValue: {
    width: 62, textAlign: "right", fontSize: 12, fontWeight: "600",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
  },
  // chart type switcher + footer
  chartTypeRow: { flexDirection: "row", gap: 6 },
  chartTypeBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 4, paddingVertical: 7, borderRadius: 8,
  },
  chartTypeText: { fontSize: 11, fontWeight: "700" },
  chartHint: { fontSize: 12, fontStyle: "italic", lineHeight: 17 },
  chartXLabels: { flexDirection: "row", marginTop: 4 },
  chartXLabel: { flex: 1, fontSize: 10, textAlign: "center", paddingHorizontal: 1 },
  chartFooter: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  chartFooterText: { flexShrink: 1, fontSize: 12, fontWeight: "600" },
  chartMiniBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6,
  },
  chartMiniText: { fontSize: 11, fontWeight: "700" },
  chartDataToggle: { alignSelf: "flex-start", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 7 },
  chartDataToggleText: { fontSize: 12, fontWeight: "700" },
  chartAIBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, alignSelf: "flex-start",
  },
  pieWrap: { flexDirection: "row", alignItems: "center", gap: 14 },
  pieLegend: { flex: 1, gap: 5 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  legendDot: { width: 11, height: 11, borderRadius: 3 },
  legendLabel: { flex: 1, fontSize: 12 },
  legendPct: {
    fontSize: 11.5, fontWeight: "700",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
  },
  // compute: ƒx helper, variable chips, result row
  varChipRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 2 },
  fxToggle: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8,
  },
  fxToggleText: { fontSize: 12.5, fontWeight: "800" },
  varChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999,
  },
  varChipText: {
    fontSize: 11, fontWeight: "600",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
  },
  fxPanel: { gap: 8, padding: 10, borderRadius: 10, marginTop: 2 },
  fxGroup: { gap: 5 },
  fxGroupTitle: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  fxChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  fxChip: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 6 },
  fxChipText: {
    fontSize: 11.5, fontWeight: "600",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
  },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  copiedPill: { fontSize: 11, fontWeight: "700", color: "#10B981" },
  computeHint: { fontSize: 11, marginTop: 2 },
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
  // ── Scientific calculator keypad ──
  calcRow: { flexDirection: "row", gap: 8 },
  calcSciRow: { flexDirection: "row", gap: 8 },
  calcKey: {
    flex: 1,
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  calcKeyText: {
    fontSize: 19,
    fontWeight: "700",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
  },
  calcDisplay: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 6,
  },
  calcDisplayLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  calcDisplayValue: {
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.5,
    lineHeight: 38,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
  },
  calcTextInput: {
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 18,
    fontWeight: "600",
  },
  // ── Variable tabs ──
  varTab: {
    minWidth: 78,
    maxWidth: 150,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 1,
  },
  varTabLabel: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.2 },
  varTabValue: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
  },
  // ── Conversion calculator ──
  convPill: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
    gap: 1,
  },
  convPillLabel: { fontSize: 9.5, fontWeight: "700", letterSpacing: 0.6 },
  convPillUnit: {
    fontSize: 16,
    fontWeight: "800",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
  },
  unitGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  unitKey: {
    minWidth: 64,
    flexGrow: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  unitKeyText: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
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

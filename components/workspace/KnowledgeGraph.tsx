// ============================================
// KnowledgeGraph — an auto-built visual map of the workspace: books/documents,
// notebook notes, and AI-extracted concepts, with the edges between them.
// Structural edges (note → linked source) are exact; the concept layer is built
// by one AI call and cached so the graph renders instantly next time.
// ============================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Circle, G, Line, Rect, Text as SvgText } from "react-native-svg";
import { BookMarked, Minus, Plus, RefreshCw, Sparkles, X } from "lucide-react-native";

import type { UnifiedFileRecord } from "@/services/fileIndexService";
import {
  buildGraph,
  getLibraryBooks,
  getNotebookNotesForGraph,
  type ConceptInput,
  type GraphData,
  type GraphNode,
  type GraphNoteInput,
} from "@/services/workspaceInsightsService";
import { extractConcepts } from "@/components/workspace/aiActions";

const CONCEPTS_KEY = "@wordsinscribed/ws_graph_concepts_v1";
const ACCENT = "#9333EA";

const NODE_COLORS: Record<string, string> = {
  book: "#2563EB",
  note: "#6366F1",
  concept: "#9333EA",
};

interface Positioned extends GraphNode {
  x: number;
  y: number;
  r: number;
}

export default function KnowledgeGraph({
  mode,
  t,
  onJumpToNote,
}: {
  mode: "light" | "dark";
  t: any;
  onJumpToNote?: (noteId: string) => void;
}) {
  const router = useRouter();

  const [books, setBooks] = useState<UnifiedFileRecord[]>([]);
  const [notes, setNotes] = useState<GraphNoteInput[]>([]);
  const [concepts, setConcepts] = useState<ConceptInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [scale, setScale] = useState(1);

  const pan = useRef(new Animated.ValueXY()).current;
  const panResponder = useRef(
    PanResponder.create({
      // Let taps through; only claim the gesture once the finger moves.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        pan.extractOffset();
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: () => {
        pan.flattenOffset();
      },
    }),
  ).current;

  // ── Load structural data + cached concepts ─────────────────────────────────
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [bs, ns, cachedRaw] = await Promise.all([
          getLibraryBooks(),
          getNotebookNotesForGraph(),
          AsyncStorage.getItem(CONCEPTS_KEY),
        ]);
        if (!active) return;
        setBooks(bs);
        setNotes(ns);
        if (cachedRaw) {
          try {
            const parsed = JSON.parse(cachedRaw) as ConceptInput[];
            if (Array.isArray(parsed)) setConcepts(parsed);
          } catch {
            /* ignore */
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const rebuild = useCallback(async () => {
    if (building) return;
    setBuilding(true);
    try {
      const [bs, ns] = await Promise.all([getLibraryBooks(), getNotebookNotesForGraph()]);
      setBooks(bs);
      setNotes(ns);
      const cs = await extractConcepts(
        ns.map((n) => n.text),
        bs.map((b) => b.name.replace(/\.[a-z0-9]+$/i, "")),
      );
      setConcepts(cs);
      AsyncStorage.setItem(CONCEPTS_KEY, JSON.stringify(cs)).catch(() => {});
    } catch (e: any) {
      // surface nothing intrusive; keep prior graph
      console.warn("[KnowledgeGraph] rebuild failed:", e?.message);
    } finally {
      setBuilding(false);
    }
  }, [building]);

  const graph: GraphData = useMemo(
    () => buildGraph(notes, books, concepts),
    [notes, books, concepts],
  );

  // ── Deterministic clustered layout ─────────────────────────────────────────
  const { positioned, posById, canvas } = useMemo(() => {
    const bookNodes = graph.nodes.filter((n) => n.type === "book");
    const conceptNodes = graph.nodes.filter((n) => n.type === "concept");
    const noteNodes = graph.nodes.filter((n) => n.type === "note");

    const count = graph.nodes.length;
    const size = Math.max(520, 360 + count * 26);
    const cx = size / 2;
    const cy = size / 2;
    const rBooks = size * 0.4;
    const rConcepts = size * 0.16;
    const rNotes = size * 0.28;

    const map = new Map<string, Positioned>();
    const out: Positioned[] = [];

    const place = (node: GraphNode, x: number, y: number, r: number) => {
      const p: Positioned = { ...node, x, y, r };
      map.set(node.id, p);
      out.push(p);
    };

    conceptNodes.forEach((n, i) => {
      const a = conceptNodes.length ? (i / conceptNodes.length) * Math.PI * 2 : 0;
      place(n, cx + rConcepts * Math.cos(a), cy + rConcepts * Math.sin(a), 11);
    });

    const bookAngle = new Map<string, number>();
    bookNodes.forEach((n, i) => {
      const a = (i / Math.max(1, bookNodes.length)) * Math.PI * 2 - Math.PI / 2;
      bookAngle.set(n.id, a);
      place(n, cx + rBooks * Math.cos(a), cy + rBooks * Math.sin(a), 15);
    });

    noteNodes.forEach((n, i) => {
      // anchor near linked source if present
      const link = graph.edges.find((e) => e.from === n.id && e.kind === "link");
      let a: number;
      if (link && bookAngle.has(link.to)) {
        a = bookAngle.get(link.to)! + 0.18;
      } else {
        a = (i / Math.max(1, noteNodes.length)) * Math.PI * 2 + 0.3;
      }
      place(n, cx + rNotes * Math.cos(a), cy + rNotes * Math.sin(a), 10);
    });

    return { positioned: out, posById: map, canvas: size };
  }, [graph]);

  const edgeColor = mode === "dark" ? "rgba(148,163,184,0.28)" : "rgba(100,116,139,0.25)";
  const conceptEdgeColor = mode === "dark" ? "rgba(147,51,234,0.40)" : "rgba(147,51,234,0.30)";
  const labelColor = mode === "dark" ? "#E2E8F0" : "#334155";
  const boardBg = mode === "dark" ? "#0B1220" : "#F1F5F9";
  const boardBorder = mode === "dark" ? "#1E293B" : "#E2E8F0";
  const chipFill = mode === "dark" ? "#0F172A" : "#FFFFFF";
  // Node ring blends into the board so circles read crisply at any zoom.
  const nodeRing = mode === "dark" ? "#0B1220" : "#FFFFFF";

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  const hasData = books.length > 0 || notes.length > 0;

  return (
    <View style={styles.container}>
      {/* toolbar */}
      <View style={styles.toolbar}>
        <View style={styles.legend}>
          <LegendDot color={NODE_COLORS.book} label="Books" t={t} />
          <LegendDot color={NODE_COLORS.note} label="Notes" t={t} />
          <LegendDot color={NODE_COLORS.concept} label="Concepts" t={t} />
        </View>
        <TouchableOpacity
          onPress={rebuild}
          disabled={building}
          style={[styles.rebuildBtn, { backgroundColor: `${ACCENT}18` }]}
        >
          {building ? (
            <ActivityIndicator size="small" color={ACCENT} />
          ) : (
            <RefreshCw size={13} color={ACCENT} />
          )}
          <Text style={styles.rebuildText}>{concepts.length ? "Rebuild" : "Build with AI"}</Text>
        </TouchableOpacity>
      </View>

      {!hasData ? (
        <View style={styles.center}>
          <BookMarked size={40} color={t.textTertiary} />
          <Text style={[styles.emptyTitle, { color: t.textSecondary }]}>Nothing to map yet</Text>
          <Text style={[styles.emptyHint, { color: t.textTertiary }]}>
            Add books to your library and write a few notes — they’ll appear here as a connected map.
          </Text>
        </View>
      ) : (
        <View
          style={[styles.canvasWrap, { backgroundColor: boardBg, borderColor: boardBorder }]}
          {...panResponder.panHandlers}
        >
          <Animated.View
            style={{
              transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale }],
            }}
          >
            <Svg width={canvas} height={canvas}>
              {/* edges */}
              {graph.edges.map((e, i) => {
                const a = posById.get(e.from);
                const b = posById.get(e.to);
                if (!a || !b) return null;
                const isConcept = e.kind === "concept";
                const dim = selected ? selected.id !== e.from && selected.id !== e.to : false;
                return (
                  <Line
                    key={`e${i}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={isConcept ? conceptEdgeColor : edgeColor}
                    strokeWidth={isConcept ? 1.25 : 1.75}
                    opacity={dim ? 0.25 : 1}
                  />
                );
              })}
              {/* nodes */}
              {positioned.map((n) => {
                const isSel = !!selected && selected.id === n.id;
                const dim = !!selected && !isSel;
                const color = NODE_COLORS[n.type];
                const label = clip(n.label, n.type === "book" ? 16 : 14);
                const fontSize = n.type === "book" ? 10 : 9;
                const chipH = fontSize + 9;
                const chipW = Math.max(label.length * fontSize * 0.62 + 12, 24);
                const chipY = n.y + n.r + 5;
                return (
                  <G key={n.id} onPress={() => setSelected(n)} opacity={dim ? 0.45 : 1}>
                    {/* soft halo for depth */}
                    <Circle cx={n.x} cy={n.y} r={n.r + (isSel ? 8 : 5)} fill={color} opacity={isSel ? 0.3 : 0.16} />
                    {/* node */}
                    <Circle
                      cx={n.x}
                      cy={n.y}
                      r={n.r}
                      fill={color}
                      stroke={isSel ? "#FFFFFF" : nodeRing}
                      strokeWidth={isSel ? 2.5 : 2}
                    />
                    {/* inner highlight for concepts */}
                    {n.type === "concept" ? (
                      <Circle cx={n.x} cy={n.y} r={n.r * 0.42} fill="#FFFFFF" opacity={0.92} />
                    ) : null}
                    {/* label chip for readability over edges */}
                    <Rect
                      x={n.x - chipW / 2}
                      y={chipY}
                      width={chipW}
                      height={chipH}
                      rx={chipH / 2}
                      fill={chipFill}
                      opacity={0.94}
                    />
                    <SvgText
                      x={n.x}
                      y={chipY + chipH / 2 + fontSize * 0.36}
                      fill={labelColor}
                      fontSize={fontSize}
                      fontWeight={n.type === "concept" ? "700" : "600"}
                      textAnchor="middle"
                    >
                      {label}
                    </SvgText>
                  </G>
                );
              })}
            </Svg>
          </Animated.View>

          {/* zoom controls */}
          <View style={styles.zoomCol}>
            <TouchableOpacity
              style={[styles.zoomBtn, { backgroundColor: mode === "dark" ? "#1E293B" : "#FFFFFF" }]}
              onPress={() => setScale((s) => Math.min(2.2, s + 0.2))}
            >
              <Plus size={16} color={t.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.zoomBtn, { backgroundColor: mode === "dark" ? "#1E293B" : "#FFFFFF" }]}
              onPress={() => setScale((s) => Math.max(0.5, s - 0.2))}
            >
              <Minus size={16} color={t.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* detail sheet */}
      {selected ? (
        <View
          style={[
            styles.detail,
            {
              backgroundColor: mode === "dark" ? "#0F172A" : "#FFFFFF",
              borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
            },
          ]}
        >
          <View style={styles.detailHeader}>
            <View style={[styles.detailDot, { backgroundColor: NODE_COLORS[selected.type] }]} />
            <Text style={[styles.detailType, { color: t.textTertiary }]}>{selected.type.toUpperCase()}</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={() => setSelected(null)} hitSlop={10}>
              <X size={18} color={t.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.detailLabel, { color: t.text }]}>{selected.label}</Text>
          <Text style={[styles.detailMeta, { color: t.textSecondary }]}>
            {connectionSummary(selected, graph)}
          </Text>
          {selected.type === "book" && selected.ref ? (
            <TouchableOpacity
              style={[styles.detailBtn, { backgroundColor: ACCENT }]}
              onPress={() => openBook(router, selected)}
            >
              <Text style={styles.detailBtnText}>Open document</Text>
            </TouchableOpacity>
          ) : null}
          {selected.type === "note" && selected.ref && onJumpToNote ? (
            <TouchableOpacity
              style={[styles.detailBtn, { backgroundColor: ACCENT }]}
              onPress={() => {
                onJumpToNote(selected.ref!);
                setSelected(null);
              }}
            >
              <Text style={styles.detailBtnText}>Go to note</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <View style={[styles.hintBar, { backgroundColor: mode === "dark" ? "#0F172A" : "#F8FAFC" }]}>
          <Sparkles size={12} color={ACCENT} />
          <Text style={[styles.hintText, { color: t.textTertiary }]}>
            Drag to pan · tap a node for details{concepts.length === 0 ? " · Build with AI to add concepts" : ""}
          </Text>
        </View>
      )}
    </View>
  );
}

function openBook(router: ReturnType<typeof useRouter>, node: GraphNode) {
  const uri = node.ref!;
  const type = node.meta;
  const pathname =
    type === "epub" ? "/epub-viewer" : type === "docx" ? "/docx-viewer" : "/pdf-viewer";
  router.push({ pathname: pathname as any, params: { uri, name: node.label } });
}

function connectionSummary(node: GraphNode, graph: GraphData): string {
  const n = graph.edges.filter((e) => e.from === node.id || e.to === node.id).length;
  if (node.type === "concept") return `Connects ${n} item${n === 1 ? "" : "s"} in your workspace.`;
  if (node.type === "note") return n ? `Linked to ${n} item${n === 1 ? "" : "s"}.` : "Not yet linked.";
  return n ? `Referenced by ${n} connection${n === 1 ? "" : "s"}.` : "No connections yet.";
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function LegendDot({ color, label, t }: { color: string; label: string; t: any }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={[styles.legendLabel, { color: t.textTertiary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  emptyTitle: { fontSize: 15, fontWeight: "700", marginTop: 6 },
  emptyHint: { fontSize: 12.5, textAlign: "center", lineHeight: 18 },

  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { fontSize: 11.5, fontWeight: "600" },
  rebuildBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 12 },
  rebuildText: { color: ACCENT, fontWeight: "700", fontSize: 12.5 },

  canvasWrap: {
    flex: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    borderWidth: 1,
    marginHorizontal: 0,
    marginBottom: 6,
  },
  zoomCol: { position: "absolute", right: 12, bottom: 12, gap: 8 },
  zoomBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(148,163,184,0.35)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },

  detail: { borderTopWidth: 1, borderWidth: 1, borderRadius: 14, marginVertical: 10, marginHorizontal: 0, padding: 14 },
  detailHeader: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 8 },
  detailDot: { width: 10, height: 10, borderRadius: 5 },
  detailType: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.5 },
  detailLabel: { fontSize: 15.5, fontWeight: "700", marginBottom: 4 },
  detailMeta: { fontSize: 12.5, lineHeight: 18, marginBottom: 10 },
  detailBtn: { borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  detailBtnText: { color: "#FFF", fontWeight: "700", fontSize: 13.5 },

  hintBar: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9 },
  hintText: { fontSize: 11.5, fontWeight: "500" },
});

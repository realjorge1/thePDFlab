/**
 * ProofreadController — the RN half of proofreading in the editors.
 *
 * Behind AI_PROOFREAD and a Premium subscription. With the flag off, without a
 * subscription, or with the backend not reporting the `proofread` capability,
 * this renders nothing, injects nothing and sends nothing, and the editors
 * behave exactly as they do today.
 *
 * FOUR THINGS IT IS CAREFUL ABOUT
 *
 * 1. IT CHECKS ONLY WHAT CHANGED. A 1,800 ms debounce after typing stops,
 *    and only paragraphs whose text hash changed since their last result are
 *    sent. Checking on every keystroke cannot work over a hop to a free-tier
 *    host and would get the endpoint rate-limited within a minute.
 *
 * 2. AN AUTOMATIC CHECK THAT FAILS SHOWS NOTHING AT ALL (contract P5.5).
 *    No toast, no banner, no spinner left behind. The local pass keeps
 *    working, so the feature degrades to "fewer suggestions". Only an
 *    explicit "Check document" surfaces an error, through the existing
 *    aiErrorPresenter.
 *
 * 3. ACCEPT NEVER SHIFTS OFFSETS ARITHMETICALLY. Accepting an edit
 *    invalidates every other suggestion in that paragraph, so the paragraph's
 *    suggestions are DROPPED and it is re-checked. No suggestion is ever
 *    applied to a span that has moved.
 *
 * 4. IT NEVER TOUCHES THE SELECTION. All marking goes through the injected
 *    __pf_preserving(), which saves and restores the caret by character
 *    offset around every mutation.
 */
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type WebView from "react-native-webview";

import { AI_PROOFREAD } from "@/constants/featureFlags";
import { useSubscription } from "@/context/SubscriptionContext";
import { presentAIError } from "@/services/ai/aiErrorPresenter";
import {
  canProofreadRemotely,
  proofreadBlocks,
} from "@/services/ai/proofread.service";
import { useTheme } from "@/services/ThemeProvider";
import { toSpan, type ProofreadSuggestion } from "@/utils/proofreadTypes";

/** Debounce after typing stops. Never per keystroke. */
const DEBOUNCE_MS = 1_800;

export interface ProofreadBlockState {
  id: string;
  text: string;
  hash: string;
  suggestions: ProofreadSuggestion[];
}

export interface ProofreadControllerHandle {
  /** Handle a message posted by the editor. Returns true if it was ours. */
  handleMessage: (data: { type?: string; [k: string]: unknown }) => boolean;
  /** Ask the editor for its paragraphs and check whatever changed. */
  requestCheck: (opts?: { explicit?: boolean }) => void;
  /** Strip every mark. Call before save, export and print. */
  clearMarks: () => void;
  /** Open the summary panel. */
  openSummary: () => void;
  /** Total suggestions currently on screen. */
  count: number;
}

interface Props {
  webViewRef: React.RefObject<WebView | null>;
  /** Bumped by the host whenever the document content changes. */
  changeToken: number;
  onHandle?: (handle: ProofreadControllerHandle) => void;
}

const TYPE_LABEL: Record<string, string> = {
  spelling: "Spelling",
  grammar: "Grammar",
  punctuation: "Punctuation",
  clarity: "Clarity",
  tone: "Tone",
  style: "Style",
};

const TYPE_COLOR: Record<string, string> = {
  spelling: "#E53935",
  grammar: "#1E88E5",
  punctuation: "#8E24AA",
  clarity: "#00897B",
  tone: "#F4511E",
  style: "#6D4C41",
};

export function ProofreadController({
  webViewRef,
  changeToken,
  onHandle,
}: Props) {
  const { colors: t } = useTheme();

  /** blockId → last checked state. */
  const blocksRef = useRef<Map<string, ProofreadBlockState>>(new Map());
  /** blockHash → set of dismissed suggestion signatures, for this session. */
  const dismissedRef = useRef<Map<string, Set<string>>>(new Map());
  /** Paused until this timestamp after a RATE_LIMITED response. */
  const pausedUntilRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explicitRef = useRef(false);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const [card, setCard] = useState<{
    blockId: string;
    suggestion: ProofreadSuggestion;
  } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [count, setCount] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );

  // Premium-only, local pass included: a free user sees today's editor, with
  // no marks, no injection and no request. Checked here rather than deeper
  // down so every path below it — including the offline rules — is covered.
  const { isPremium } = useSubscription();
  const enabled = AI_PROOFREAD && isPremium;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const inject = useCallback(
    (js: string) => {
      webViewRef.current?.injectJavaScript(`${js} true;`);
    },
    [webViewRef],
  );

  // Turn the editor-side engine on/off to match the flag.
  useEffect(() => {
    inject(`window.__pf_setEnabled && window.__pf_setEnabled(${enabled});`);
  }, [enabled, inject]);

  const clearMarks = useCallback(() => {
    inject("window.__pf_clearMarks && window.__pf_clearMarks();");
  }, [inject]);

  /** Ask the editor for its paragraphs. The answer arrives as PF_BLOCKS. */
  const requestCheck = useCallback(
    (opts?: { explicit?: boolean }) => {
      if (!enabled) return;
      explicitRef.current = opts?.explicit === true;
      inject("window.__pf_collectBlocks && window.__pf_collectBlocks();");
    },
    [enabled, inject],
  );

  const dismissKey = (s: ProofreadSuggestion) =>
    `${s.type}|${s.original}|${s.replacement}|${s.occurrence}`;

  /** Draw a block's marks, minus anything dismissed this session. */
  const renderBlock = useCallback(
    (block: ProofreadBlockState) => {
      const dismissed = dismissedRef.current.get(block.hash);
      const visible = block.suggestions.filter(
        (s) => !dismissed?.has(dismissKey(s)),
      );
      const items = visible
        .map((s) => {
          const span = toSpan(block.text, s);
          if (!span) return null; // unlocatable → shown to nobody
          return { id: s.id, start: span.start, end: span.end, type: s.type };
        })
        .filter(Boolean);

      inject(
        `window.__pf_applyMarks && window.__pf_applyMarks(${JSON.stringify(
          block.id,
        )}, ${JSON.stringify(items)});`,
      );
    },
    [inject],
  );

  const recount = useCallback(() => {
    let total = 0;
    for (const block of blocksRef.current.values()) {
      const dismissed = dismissedRef.current.get(block.hash);
      total += block.suggestions.filter(
        (s) => !dismissed?.has(dismissKey(s)),
      ).length;
    }
    if (mountedRef.current) setCount(total);
  }, []);

  /** Check the paragraphs the editor just reported. */
  const runCheck = useCallback(
    async (incoming: { id: string; text: string; hash: string }[]) => {
      if (!enabled || inFlightRef.current) return;

      const explicit = explicitRef.current;
      explicitRef.current = false;

      // Automatic checks respect a RATE_LIMITED pause; an explicit one is the
      // user asking directly, so it still goes out and still shows its error.
      if (!explicit && Date.now() < pausedUntilRef.current) return;

      // Drop state for paragraphs that no longer exist.
      const liveIds = new Set(incoming.map((b) => b.id));
      for (const id of [...blocksRef.current.keys()]) {
        if (!liveIds.has(id)) blocksRef.current.delete(id);
      }

      // ONLY what changed — unless this is an explicit whole-document check.
      const changed = incoming.filter((b) => {
        if (explicit) return true;
        const previous = blocksRef.current.get(b.id);
        return !previous || previous.hash !== b.hash;
      });
      if (changed.length === 0) {
        recount();
        return;
      }

      inFlightRef.current = true;
      if (explicit && mountedRef.current) {
        setChecking(true);
        setProgress({ done: 0, total: changed.length });
      }

      try {
        // An explicit check goes in visible chunks so progress can move; an
        // automatic one is a single quiet call.
        const groups = explicit ? chunk(changed, 10) : [changed];
        let done = 0;

        for (const group of groups) {
          const outcome = await proofreadBlocks(
            group.map((b) => ({ id: b.id, text: b.text })),
            { noCache: explicit },
          );

          for (const result of outcome.blocks) {
            const source = group.find((b) => b.id === result.id);
            if (!source) continue;
            const state: ProofreadBlockState = {
              id: result.id,
              text: source.text,
              hash: source.hash,
              suggestions: result.suggestions,
            };
            blocksRef.current.set(result.id, state);
            renderBlock(state);
          }

          done += group.length;
          if (explicit && mountedRef.current) {
            setProgress({ done, total: changed.length });
          }

          if (outcome.error) {
            if (outcome.error.code === "RATE_LIMITED") {
              // Pause AUTOMATIC checking for as long as the server asked.
              const seconds = outcome.error.retryAfterSec ?? 60;
              pausedUntilRef.current = Date.now() + seconds * 1000;
            }
            // P5.5: silence is the correct failure mode for a background
            // check. Only an explicit one surfaces anything.
            if (explicit) presentAIError(outcome.error);
            break;
          }
        }
      } catch {
        // proofreadBlocks does not throw; this is belt-and-braces so a
        // failure can never leave the editor in a checking state.
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current) {
          setChecking(false);
          setProgress(null);
        }
        recount();
      }
    },
    [enabled, recount, renderBlock],
  );

  // Debounced automatic check after typing stops.
  useEffect(() => {
    if (!enabled || changeToken === 0) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      requestCheck();
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [changeToken, enabled, requestCheck]);

  /** Messages from the editor. Returns true when the message was ours. */
  const handleMessage = useCallback(
    (data: { type?: string; [k: string]: unknown }): boolean => {
      if (!enabled) return false;

      if (data.type === "PF_BLOCKS") {
        const blocks = Array.isArray(data.blocks)
          ? (data.blocks as { id: string; text: string; hash: string }[])
          : [];
        void runCheck(blocks);
        return true;
      }

      if (data.type === "PF_MARK_TAP") {
        const blockId = String(data.blockId ?? "");
        const suggestionId = String(data.suggestionId ?? "");
        const block = blocksRef.current.get(blockId);
        const suggestion = block?.suggestions.find((s) => s.id === suggestionId);
        if (block && suggestion) setCard({ blockId, suggestion });
        return true;
      }

      if (data.type === "PF_ACCEPTED") {
        // The paragraph's remaining suggestions are stale the instant one is
        // applied, so they are dropped and the paragraph is re-checked.
        const blockId = String(data.blockId ?? "");
        blocksRef.current.delete(blockId);
        recount();
        setTimeout(() => requestCheck(), 250);
        return true;
      }

      return false;
    },
    [enabled, recount, requestCheck, runCheck],
  );

  const acceptSuggestion = useCallback(
    (blockId: string, suggestion: ProofreadSuggestion) => {
      const block = blocksRef.current.get(blockId);
      if (!block) return;
      const span = toSpan(block.text, suggestion);
      if (!span) {
        // Cannot locate it any more → discard rather than guess.
        setCard(null);
        return;
      }
      inject(
        `window.__pf_accept && window.__pf_accept(${JSON.stringify(
          blockId,
        )}, ${span.start}, ${span.end}, ${JSON.stringify(suggestion.replacement)});`,
      );
      setCard(null);
    },
    [inject],
  );

  const dismissSuggestion = useCallback(
    (blockId: string, suggestion: ProofreadSuggestion, allOfType = false) => {
      const block = blocksRef.current.get(blockId);
      if (!block) {
        setCard(null);
        return;
      }
      let set = dismissedRef.current.get(block.hash);
      if (!set) {
        set = new Set();
        dismissedRef.current.set(block.hash, set);
      }
      if (allOfType) {
        for (const other of block.suggestions) {
          if (other.type === suggestion.type) set.add(dismissKey(other));
        }
      } else {
        set.add(dismissKey(suggestion));
      }
      renderBlock(block);
      recount();
      setCard(null);
    },
    [recount, renderBlock],
  );

  const acceptAllOfType = useCallback(
    (type: string) => {
      // One at a time: each accept invalidates its paragraph's other spans,
      // and the re-check that follows produces fresh, correct positions.
      for (const block of blocksRef.current.values()) {
        const first = block.suggestions.find((s) => s.type === type);
        if (first) {
          acceptSuggestion(block.id, first);
          break;
        }
      }
    },
    [acceptSuggestion],
  );

  /**
   * Suggestions grouped by type, for the summary panel.
   *
   * Deliberately NOT memoized: the source is blocksRef/dismissedRef, and a
   * ref cannot be a dependency, so any memo here would either go stale or
   * carry fake dependencies purely to force recomputation. Recomputing on
   * each render is correct and cheap — the panel is capped at a few dozen
   * rows and only renders while it is open.
   */
  const grouped = ((): [string, { blockId: string; s: ProofreadSuggestion }[]][] => {
    if (!summaryOpen) return [];
    const byType = new Map<string, { blockId: string; s: ProofreadSuggestion }[]>();
    for (const block of blocksRef.current.values()) {
      const dismissed = dismissedRef.current.get(block.hash);
      for (const s of block.suggestions) {
        if (dismissed?.has(dismissKey(s))) continue;
        const list = byType.get(s.type) ?? [];
        list.push({ blockId: block.id, s });
        byType.set(s.type, list);
      }
    }
    return [...byType.entries()];
  })();

  const handle = useMemo<ProofreadControllerHandle>(
    () => ({
      handleMessage,
      requestCheck,
      clearMarks,
      openSummary: () => setSummaryOpen(true),
      count,
    }),
    [handleMessage, requestCheck, clearMarks, count],
  );

  useEffect(() => {
    onHandle?.(handle);
  }, [handle, onHandle]);

  if (!enabled) return null;

  return (
    <>
      {/* Explicit "Check document" progress. An AUTOMATIC check shows
          nothing at all — no spinner, no banner — per P5.5. */}
      {checking && (
        <View style={[styles.progressBar, { backgroundColor: t.card, borderColor: t.border }]}>
          <ActivityIndicator size="small" color={t.primary} />
          <Text style={[styles.progressText, { color: t.textSecondary }]}>
            {progress
              ? `Checking ${progress.done} of ${progress.total} paragraphs…`
              : "Checking document…"}
          </Text>
        </View>
      )}

      {/* Accept / dismiss card */}
      <Modal
        visible={card !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setCard(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setCard(null)}>
          <Pressable
            style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}
            onPress={() => {}}
          >
            {card && (
              <>
                <View style={styles.cardHead}>
                  <View
                    style={[
                      styles.typeDot,
                      { backgroundColor: TYPE_COLOR[card.suggestion.type] ?? t.primary },
                    ]}
                  />
                  <Text style={[styles.typeLabel, { color: t.textSecondary }]}>
                    {TYPE_LABEL[card.suggestion.type] ?? card.suggestion.type}
                  </Text>
                </View>

                <View style={styles.changeRow}>
                  <Text style={[styles.original, { color: t.textSecondary }]}>
                    {card.suggestion.original}
                  </Text>
                  <MaterialIcons name="arrow-forward" size={16} color={t.textTertiary} />
                  <Text style={[styles.replacement, { color: t.text }]}>
                    {card.suggestion.replacement || "(delete)"}
                  </Text>
                </View>

                {!!card.suggestion.reason && (
                  <Text style={[styles.reason, { color: t.textSecondary }]}>
                    {card.suggestion.reason}
                  </Text>
                )}

                <View style={styles.cardActions}>
                  <Pressable
                    style={[styles.btn, { backgroundColor: t.primary }]}
                    onPress={() => acceptSuggestion(card.blockId, card.suggestion)}
                  >
                    <Text style={styles.btnText}>Accept</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.btn, { backgroundColor: t.backgroundSecondary }]}
                    onPress={() => dismissSuggestion(card.blockId, card.suggestion)}
                  >
                    <Text style={[styles.btnText, { color: t.text }]}>Dismiss</Text>
                  </Pressable>
                </View>
                <Pressable
                  style={styles.dismissAll}
                  onPress={() => dismissSuggestion(card.blockId, card.suggestion, true)}
                >
                  <Text style={[styles.dismissAllText, { color: t.textTertiary }]}>
                    Dismiss all {(TYPE_LABEL[card.suggestion.type] ?? "").toLowerCase()}{" "}
                    suggestions here
                  </Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Summary panel, grouped by type */}
      <Modal
        visible={summaryOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSummaryOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setSummaryOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: t.card, borderColor: t.border }]}
            onPress={() => {}}
          >
            <View style={styles.sheetHead}>
              <Text style={[styles.sheetTitle, { color: t.text }]}>
                {count === 0
                  ? "No suggestions"
                  : `${count} suggestion${count === 1 ? "" : "s"}`}
              </Text>
              <Pressable onPress={() => setSummaryOpen(false)} hitSlop={10}>
                <MaterialIcons name="close" size={22} color={t.textSecondary} />
              </Pressable>
            </View>

            <Pressable
              style={[styles.checkAllBtn, { borderColor: t.border }]}
              onPress={() => requestCheck({ explicit: true })}
            >
              <MaterialIcons name="spellcheck" size={18} color={t.primary} />
              <Text style={[styles.checkAllText, { color: t.primary }]}>
                Check document
              </Text>
            </Pressable>

            <ScrollView style={styles.sheetList}>
              {grouped.map(([type, items]) => (
                <View key={type} style={styles.group}>
                  <View style={styles.groupHead}>
                    <View
                      style={[
                        styles.typeDot,
                        { backgroundColor: TYPE_COLOR[type] ?? t.primary },
                      ]}
                    />
                    <Text style={[styles.groupTitle, { color: t.text }]}>
                      {TYPE_LABEL[type] ?? type} ({items.length})
                    </Text>
                    <Pressable onPress={() => acceptAllOfType(type)} hitSlop={8}>
                      <Text style={[styles.acceptAll, { color: t.primary }]}>
                        Accept all
                      </Text>
                    </Pressable>
                  </View>
                  {items.slice(0, 20).map(({ blockId, s }) => (
                    <Pressable
                      key={`${blockId}-${s.id}`}
                      style={[styles.item, { borderTopColor: t.borderLight }]}
                      onPress={() => {
                        setSummaryOpen(false);
                        setCard({ blockId, suggestion: s });
                      }}
                    >
                      <Text style={[styles.itemChange, { color: t.text }]} numberOfLines={1}>
                        {s.original} → {s.replacement || "(delete)"}
                      </Text>
                      {!!s.reason && (
                        <Text
                          style={[styles.itemReason, { color: t.textTertiary }]}
                          numberOfLines={2}
                        >
                          {s.reason}
                        </Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              ))}
              {count === 0 && (
                <Text style={[styles.empty, { color: t.textSecondary }]}>
                  {canProofreadRemotely()
                    ? "Nothing to fix here."
                    : "Nothing to fix here. Advanced checks need a connection."}
                </Text>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const styles = StyleSheet.create({
  progressBar: {
    position: "absolute",
    top: 8,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    zIndex: 200,
    elevation: 8,
  },
  progressText: { fontSize: 13, fontWeight: "600" },

  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: { width: "100%", maxWidth: 400, borderRadius: 16, borderWidth: 1, padding: 18 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  typeDot: { width: 8, height: 8, borderRadius: 4 },
  typeLabel: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 },
  changeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    flexWrap: "wrap",
  },
  original: { fontSize: 16, textDecorationLine: "line-through" },
  replacement: { fontSize: 16, fontWeight: "700" },
  reason: { fontSize: 13, lineHeight: 18, marginTop: 10 },
  cardActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  btnText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
  dismissAll: { marginTop: 12, alignItems: "center" },
  dismissAllText: { fontSize: 12 },

  sheet: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "80%",
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitle: { fontSize: 17, fontWeight: "800" },
  checkAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    marginTop: 12,
  },
  checkAllText: { fontSize: 13, fontWeight: "700" },
  sheetList: { marginTop: 12 },
  group: { marginBottom: 16 },
  groupHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  groupTitle: { flex: 1, fontSize: 14, fontWeight: "700" },
  acceptAll: { fontSize: 12, fontWeight: "700" },
  item: { paddingVertical: 10, borderTopWidth: 1, marginTop: 6 },
  itemChange: { fontSize: 13, fontWeight: "600" },
  itemReason: { fontSize: 12, marginTop: 2 },
  empty: { fontSize: 13, textAlign: "center", paddingVertical: 24 },
});

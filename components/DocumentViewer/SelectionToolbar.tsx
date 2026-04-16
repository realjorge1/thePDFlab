/**
 * SelectionToolbar — WPS Office-style floating action bar that appears when
 * the user selects text in the document WebView.
 *
 * Layout (horizontal, scrollable):
 *   "Highlight" label → 5 colour circles | Underline | Ask athemi |
 *   Cross Out | Copy | Share | Cancel
 *
 * Positions itself above the selection when there is room, otherwise below.
 * Falls back to a safe bottom position when no rect is provided.
 *
 * Based on /sleek/SelectionToolbar.js.
 */
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const ARROW_SIZE = 7;

// ── Highlight colour palette (5 colours, matching /sleek) ─────────────────────
const HIGHLIGHT_COLORS = [
  { id: "yellow", color: "#FFD600", label: "Yellow" },
  { id: "green", color: "#00C853", label: "Green" },
  { id: "blue", color: "#2979FF", label: "Blue" },
  { id: "pink", color: "#FF4081", label: "Pink" },
  { id: "orange", color: "#FF6D00", label: "Orange" },
] as const;

// ── Props ──────────────────────────────────────────────────────────────────────
export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  visible: boolean;
  selectedText: string;
  /** Viewport-relative rect of the selection (with header offset applied). */
  rect?: SelectionRect | null;
  onHighlight: (colorHex: string) => void;
  onUnderline: () => void;
  onStrikethrough: () => void;
  onCopy: () => void;
  onShare: () => void;
  onAskAthemi: () => void;
  onDismiss: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────
export function SelectionToolbar({
  visible,
  selectedText,
  rect,
  onHighlight,
  onUnderline,
  onStrikethrough,
  onCopy,
  onShare,
  onAskAthemi,
  onDismiss,
}: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 8,
          duration: 120,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  if (!visible) return null;

  // ── Positioning ──────────────────────────────────────────────────────────────
  const TOOLBAR_HEIGHT = 56;
  const TOOLBAR_WIDTH = Math.min(SCREEN_WIDTH - 24, 380);
  const { height: SCREEN_HEIGHT } = Dimensions.get("window");

  let toolbarX: number;
  let toolbarY: number;
  let showAbove = false;
  let arrowLeft = TOOLBAR_WIDTH / 2 - ARROW_SIZE;

  if (rect) {
    const selectionMidX = rect.x + rect.width / 2;

    toolbarX = selectionMidX - TOOLBAR_WIDTH / 2;
    toolbarX = Math.max(
      12,
      Math.min(toolbarX, SCREEN_WIDTH - TOOLBAR_WIDTH - 12),
    );

    const spaceAbove = rect.y - 12;
    showAbove = spaceAbove > TOOLBAR_HEIGHT + ARROW_SIZE + 4;

    toolbarY = showAbove
      ? rect.y - TOOLBAR_HEIGHT - ARROW_SIZE - 8
      : rect.y + rect.height + ARROW_SIZE + 8;

    arrowLeft = Math.max(
      8,
      Math.min(selectionMidX - toolbarX - ARROW_SIZE, TOOLBAR_WIDTH - 16),
    );
  } else {
    // Fallback: float above the keyboard area at bottom of screen
    toolbarX = (SCREEN_WIDTH - TOOLBAR_WIDTH) / 2;
    toolbarY = SCREEN_HEIGHT - TOOLBAR_HEIGHT - 120;
  }

  return (
    <Animated.View
      style={[
        styles.container,
        {
          left: toolbarX,
          top: toolbarY,
          width: TOOLBAR_WIDTH,
          opacity,
          transform: [{ translateY }],
        },
      ]}
      pointerEvents="box-none"
    >
      {/* Arrow pointing toward selection */}
      {rect && showAbove && (
        <View style={[styles.arrowDown, { left: arrowLeft }]} />
      )}
      {rect && !showAbove && (
        <View style={[styles.arrowUp, { left: arrowLeft }]} />
      )}

      <View
        style={[
          styles.toolbar,
          showAbove ? styles.toolbarAbove : styles.toolbarBelow,
        ]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="always"
        >
          {/* ── "Highlight" label + 5 colour circles ── */}
          <View style={styles.sectionLabel}>
            <Text style={styles.sectionLabelText}>Highlight</Text>
          </View>

          {HIGHLIGHT_COLORS.map((c) => (
            <TouchableOpacity
              key={c.id}
              onPress={() => {
                onHighlight(c.color);
                onDismiss();
              }}
              style={styles.colorBtn}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              accessibilityLabel={`Highlight ${c.label}`}
            >
              <View
                style={[styles.colorCircle, { backgroundColor: c.color }]}
              />
            </TouchableOpacity>
          ))}

          <View style={styles.divider} />

          {/* ── Underline ── */}
          <TouchableOpacity
            onPress={() => {
              onUnderline();
              onDismiss();
            }}
            style={styles.actionBtn}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityLabel="Underline"
          >
            <Text style={styles.actionIcon}>U̲</Text>
            <Text style={styles.actionLabel}>Underline</Text>
          </TouchableOpacity>

          {/* ── Ask athemi ── */}
          <TouchableOpacity
            onPress={onAskAthemi}
            style={styles.actionBtn}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityLabel="Ask athemi"
          >
            <Text style={[styles.actionIcon, { color: "#A78BFA" }]}>✦</Text>
            <Text style={styles.actionLabel}>Ask athemi</Text>
          </TouchableOpacity>

          {/* ── Cross Out (strikethrough) ── */}
          <TouchableOpacity
            onPress={() => {
              onStrikethrough();
              onDismiss();
            }}
            style={styles.actionBtn}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityLabel="Cross out"
          >
            <Text style={styles.actionIcon}>S̶</Text>
            <Text style={styles.actionLabel}>Cross Out</Text>
          </TouchableOpacity>

          {/* ── Copy ── */}
          <TouchableOpacity
            onPress={() => {
              onCopy();
              onDismiss();
            }}
            style={styles.actionBtn}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityLabel="Copy"
          >
            <Text style={styles.actionIcon}>⎘</Text>
            <Text style={styles.actionLabel}>Copy</Text>
          </TouchableOpacity>

          {/* ── Share ── */}
          <TouchableOpacity
            onPress={() => {
              onShare();
              onDismiss();
            }}
            style={styles.actionBtn}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityLabel="Share"
          >
            <Text style={styles.actionIcon}>↗</Text>
            <Text style={styles.actionLabel}>Share</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* ── Cancel / Dismiss ── */}
          <TouchableOpacity
            onPress={onDismiss}
            style={styles.actionBtn}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityLabel="Cancel"
          >
            <Text style={[styles.actionIcon, { color: "#FF4444" }]}>✕</Text>
            <Text style={styles.actionLabel}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Animated.View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    position: "absolute",
    zIndex: 9999,
    elevation: 20,
  },
  toolbar: {
    backgroundColor: "#1E1E2E",
    borderRadius: 12,
    height: 56,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 12,
    elevation: 12,
    overflow: "hidden",
  },
  toolbarAbove: { marginBottom: 0 },
  toolbarBelow: { marginTop: 0 },

  scrollContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    height: 56,
  },

  // "Highlight" label
  sectionLabel: {
    justifyContent: "center",
    paddingRight: 4,
  },
  sectionLabelText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 10,
    fontWeight: "500",
  },

  // Colour circle button
  colorBtn: {
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 4,
    width: 28,
    height: 56,
  },
  colorCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.15)",
  },

  // Vertical separator
  divider: {
    width: 1,
    height: 30,
    backgroundColor: "rgba(255,255,255,0.12)",
    marginHorizontal: 6,
  },

  // Text action button
  actionBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    height: 56,
    minWidth: 44,
  },
  actionIcon: {
    fontSize: 18,
    color: "#FFFFFF",
    lineHeight: 22,
  },
  actionLabel: {
    fontSize: 9,
    color: "rgba(255,255,255,0.55)",
    marginTop: 1,
  },

  // Arrow indicators
  arrowUp: {
    position: "absolute",
    top: -(ARROW_SIZE * 2 - 1),
    width: 0,
    height: 0,
    borderLeftWidth: ARROW_SIZE,
    borderRightWidth: ARROW_SIZE,
    borderBottomWidth: ARROW_SIZE * 2,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#1E1E2E",
  },
  arrowDown: {
    position: "absolute",
    bottom: -(ARROW_SIZE * 2 - 1),
    width: 0,
    height: 0,
    borderLeftWidth: ARROW_SIZE,
    borderRightWidth: ARROW_SIZE,
    borderTopWidth: ARROW_SIZE * 2,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "#1E1E2E",
  },
});

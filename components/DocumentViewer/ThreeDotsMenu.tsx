/**
 * ThreeDotsMenu — Shared overflow menu for PDF and DOCX viewer screens.
 * Renders as a full-screen overlay with a card positioned near the top-right.
 *
 * Menu items:
 *   Share · Search Text · Read Aloud · Chat with File · Bookmark
 *   Keep Awake · Lock File (PDF only) · Edit File · Delete · Star
 */
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import {
  type LightTheme as ThemeType,
  Palette,
  Spacing,
  Typography,
} from "@/services/document-manager";
import { MenuToggle } from "./MenuToggle";

// ── Types ────────────────────────────────────────────────────────────────────

type IconName = React.ComponentProps<typeof MaterialIcons>["name"];

interface MenuItem {
  id: string;
  label: string;
  icon: IconName;
  onPress: () => void;
  destructive?: boolean;
  /** Render a trailing element (e.g. filled star). */
  trailing?: React.ReactNode;
  /**
   * Renders an on/off switch on the right, and reports the row to assistive
   * tech as a switch rather than a button. For rows that flip a setting in
   * place instead of navigating or opening something.
   */
  toggle?: boolean;
  /** State of the switch, when `toggle` is set. */
  toggleOn?: boolean;
}

export interface ThreeDotsMenuProps {
  visible: boolean;
  onClose: () => void;
  theme: typeof ThemeType;
  // ── Action callbacks ──
  onShare: () => void;
  onSearchText: () => void;
  onReadAloud: () => void;
  onChatWithFile: () => void;
  /** Opens the Devil's Advocate / Narrative Arc analysis chooser. */
  onAnalyze?: () => void;
  onLockFile?: () => void;
  onEditFile: () => void;
  onDelete: () => void;
  onStar: () => void;
  isStarred: boolean;
  /**
   * Bookmarks (R1). Optional and additive: when onSavePage is omitted the
   * menu is exactly what it was before. Follows the isStarred pattern above —
   * the label toggles to reflect the CURRENT location's state.
   */
  onSavePage?: () => void;
  isPageSaved?: boolean;
  /**
   * Keep Awake — stops the screen sleeping while the document is open.
   * Optional in the same additive way as onSavePage above: with
   * onToggleKeepAwake omitted the row is not rendered at all, which is how a
   * platform that cannot hold a wake lock opts out.
   */
  onToggleKeepAwake?: () => void;
  isKeepAwake?: boolean;
  /** "pdf" shows Lock File; "docx" hides it. */
  fileType: "pdf" | "docx";
}

/** Distance from the top of the screen to the top of the card. */
const CARD_TOP = 56;
/** Breathing room kept below the card, so it never sits flush on the edge. */
const CARD_BOTTOM_GUTTER = 24;

// ── Component ────────────────────────────────────────────────────────────────

export function ThreeDotsMenu({
  visible,
  onClose,
  theme,
  onShare,
  onSearchText,
  onReadAloud,
  onChatWithFile,
  onAnalyze,
  onLockFile,
  onEditFile,
  onDelete,
  onStar,
  isStarred,
  onSavePage,
  isPageSaved = false,
  onToggleKeepAwake,
  isKeepAwake = false,
  fileType,
}: ThreeDotsMenuProps) {
  // The full menu runs to eleven rows. Compact rows keep that on one screen,
  // and this cap is the backstop for the cases rows alone cannot cover — small
  // devices, landscape, and large accessibility text sizes.
  const { height: windowHeight } = useWindowDimensions();
  const maxHeight = Math.max(240, windowHeight - CARD_TOP - CARD_BOTTOM_GUTTER);

  const items: MenuItem[] = [
    { id: "share", label: "Share", icon: "share", onPress: onShare },
    { id: "search", label: "Search Text", icon: "search", onPress: onSearchText },
    { id: "read-aloud", label: "Read Aloud", icon: "volume-up", onPress: onReadAloud },
    { id: "chat", label: "Chat with File", icon: "chat", onPress: onChatWithFile },
  ];

  if (onSavePage) {
    items.push({
      id: "save-page",
      label: isPageSaved ? "Remove Bookmark" : "Bookmark",
      icon: isPageSaved ? "bookmark" : "bookmark-border",
      onPress: onSavePage,
      trailing: isPageSaved ? (
        <MaterialIcons name="check" size={18} color="#10B981" />
      ) : undefined,
    });
  }

  if (onToggleKeepAwake) {
    items.push({
      id: "keep-awake",
      // Label and icon both stay put, because the switch on the right already
      // carries the state; a second state signal on the left would only make
      // the row ambiguous. A cup is the long-standing glyph for keep-awake
      // (Caffeine and friends), and unlike a sun or an eye it cannot be
      // misread as the reader's theme or show/hide controls.
      label: "Keep Awake",
      icon: "local-cafe",
      onPress: onToggleKeepAwake,
      toggle: true,
      toggleOn: isKeepAwake,
    });
  }

  if (onAnalyze) {
    items.push({ id: "analyze", label: "Analyze", icon: "auto-awesome", onPress: onAnalyze });
  }

  if (fileType === "pdf" && onLockFile) {
    items.push({ id: "lock", label: "Lock File", icon: "lock", onPress: onLockFile });
  }

  items.push({ id: "edit", label: "Edit File", icon: "edit", onPress: onEditFile });
  items.push({ id: "delete", label: "Delete", icon: "delete-outline", onPress: onDelete, destructive: true });
  items.push({
    id: "star",
    label: isStarred ? "Unstar" : "Star",
    icon: isStarred ? "star" : "star-outline",
    onPress: onStar,
    trailing: isStarred ? (
      <MaterialIcons name="star" size={18} color="#F59E0B" />
    ) : undefined,
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.positioner}>
          <Pressable
            testID="three-dots-menu-card"
            style={[
              styles.card,
              {
                backgroundColor: theme.surface.elevated,
                borderColor: theme.border.light,
                maxHeight,
              },
            ]}
            // Prevent backdrop press from propagating through the card
            onPress={() => {}}
          >
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              // Only scrolls on the devices that actually need it; on the rest
              // the content is shorter than maxHeight and this is inert.
            >
              {items.map((item, idx) => {
                const isLast = idx === items.length - 1;
                return (
                  <Pressable
                    key={item.id}
                    style={({ pressed }) => [
                      styles.menuItem,
                      // The switch is taller than an icon, so the row trades
                      // padding for it and every row keeps the same height.
                      item.toggle && styles.menuItemToggle,
                      !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border.light },
                      pressed && { backgroundColor: theme.background.secondary },
                    ]}
                    accessibilityRole={item.toggle ? "switch" : "button"}
                    accessibilityState={
                      item.toggle ? { checked: !!item.toggleOn } : undefined
                    }
                    onPress={() => {
                      // A toggle row flips a setting rather than going anywhere,
                      // so the menu stays open and the switch animates under the
                      // finger that pressed it.
                      if (item.toggle) {
                        item.onPress();
                        return;
                      }
                      onClose();
                      // Small delay so the menu closes before the action fires
                      setTimeout(item.onPress, 120);
                    }}
                  >
                    <MaterialIcons
                      name={item.icon}
                      size={20}
                      color={item.destructive ? Palette.error.main : theme.text.secondary}
                    />
                    <Text
                      style={[
                        styles.menuLabel,
                        { color: item.destructive ? Palette.error.main : theme.text.primary },
                      ]}
                      numberOfLines={1}
                    >
                      {item.label}
                    </Text>
                    {item.toggle && (
                      <View style={styles.trailing}>
                        <MenuToggle on={!!item.toggleOn} theme={theme} />
                      </View>
                    )}
                    {item.trailing && <View style={styles.trailing}>{item.trailing}</View>}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  positioner: {
    position: "absolute",
    top: 56,
    right: Spacing.sm,
    maxWidth: 240,
    minWidth: 200,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    // Shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    // 42 keeps all eleven rows on one screen while staying a comfortable
    // target; the row was 46 when the menu was four items shorter.
    minHeight: 42,
    paddingVertical: 9,
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
  },
  menuItemToggle: {
    // 7 + the 28pt switch + 7 lands on the same 42 as every other row.
    paddingVertical: 7,
  },
  menuLabel: {
    flex: 1,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.medium,
  },
  trailing: {
    marginLeft: "auto",
  },
});

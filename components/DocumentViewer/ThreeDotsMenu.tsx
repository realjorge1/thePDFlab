/**
 * ThreeDotsMenu — Shared overflow menu for PDF and DOCX viewer screens.
 * Renders as a full-screen overlay with a card positioned near the top-right.
 *
 * Menu items:
 *   Share · Search Text · Read Aloud · Chat with File
 *   Lock File (PDF only) · Edit File · Delete · Star
 */
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  type LightTheme as ThemeType,
  Palette,
  Spacing,
  Typography,
} from "@/services/document-manager";

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
  onLockFile?: () => void;
  onEditFile: () => void;
  onDelete: () => void;
  onStar: () => void;
  isStarred: boolean;
  /** "pdf" shows Lock File; "docx" hides it. */
  fileType: "pdf" | "docx";
}

// ── Component ────────────────────────────────────────────────────────────────

export function ThreeDotsMenu({
  visible,
  onClose,
  theme,
  onShare,
  onSearchText,
  onReadAloud,
  onChatWithFile,
  onLockFile,
  onEditFile,
  onDelete,
  onStar,
  isStarred,
  fileType,
}: ThreeDotsMenuProps) {
  const items: MenuItem[] = [
    { id: "share", label: "Share", icon: "share", onPress: onShare },
    { id: "search", label: "Search Text", icon: "search", onPress: onSearchText },
    { id: "read-aloud", label: "Read Aloud", icon: "volume-up", onPress: onReadAloud },
    { id: "chat", label: "Chat with File", icon: "chat", onPress: onChatWithFile },
  ];

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
            style={[
              styles.card,
              {
                backgroundColor: theme.surface.elevated,
                borderColor: theme.border.light,
              },
            ]}
            // Prevent backdrop press from propagating through the card
            onPress={() => {}}
          >
            {items.map((item, idx) => {
              const isLast = idx === items.length - 1;
              return (
                <Pressable
                  key={item.id}
                  style={({ pressed }) => [
                    styles.menuItem,
                    !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border.light },
                    pressed && { backgroundColor: theme.background.secondary },
                  ]}
                  onPress={() => {
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
                  {item.trailing && <View style={styles.trailing}>{item.trailing}</View>}
                </Pressable>
              );
            })}
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
    paddingVertical: 13,
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
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

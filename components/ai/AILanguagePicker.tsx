// ============================================
// AI Language Picker – modal for selecting target language
// ============================================

import { spacing } from "@/constants/theme";
import { useTheme } from "@/services/ThemeProvider";
import type { Language } from "@/services/ai/ai.types";
import { SUPPORTED_LANGUAGES } from "@/services/ai/ai.types";
import { Check, Search, X } from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

interface Props {
  visible: boolean;
  selected: string;
  onSelect: (code: string) => void;
  onClose: () => void;
}

export const AILanguagePicker = React.memo(function AILanguagePicker({
  visible,
  selected,
  onSelect,
  onClose,
}: Props) {
  const { colors: t, mode } = useTheme();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SUPPORTED_LANGUAGES;
    return SUPPORTED_LANGUAGES.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.native.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q),
    );
  }, [query]);

  const handleClose = useCallback(() => {
    setQuery("");
    onClose();
  }, [onClose]);

  const renderItem = useCallback(
    ({ item }: { item: Language }) => {
      const isActive = item.code === selected;
      return (
        <TouchableOpacity
          style={[
            styles.item,
            {
              backgroundColor: isActive
                ? mode === "dark"
                  ? "#312E81"
                  : "#EEF2FF"
                : t.card,
              borderColor: isActive ? "#6366F1" : t.border,
            },
          ]}
          onPress={() => {
            onSelect(item.code);
            handleClose();
          }}
          activeOpacity={0.7}
        >
          <View style={styles.itemTextWrap}>
            <Text style={[styles.itemNative, { color: t.text }]}>
              {item.native}
            </Text>
            {item.native !== item.name && (
              <Text style={[styles.itemName, { color: t.textSecondary }]}>
                {item.name}
              </Text>
            )}
          </View>
          {isActive && <Check size={18} color="#6366F1" />}
        </TouchableOpacity>
      );
    },
    [selected, mode, t.card, t.border, t.text, t.textSecondary, onSelect, handleClose],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: t.background }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: t.border }]}>
            <Text style={[styles.headerTitle, { color: t.text }]}>
              Select Language
            </Text>
            <TouchableOpacity onPress={handleClose}>
              <X size={22} color={t.text} />
            </TouchableOpacity>
          </View>

          {/* Search bar */}
          <View
            style={[
              styles.searchRow,
              {
                backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9",
                borderColor: t.border,
              },
            ]}
          >
            <Search size={16} color={t.textSecondary} />
            <TextInput
              style={[styles.searchInput, { color: t.text }]}
              placeholder="Search languages..."
              placeholderTextColor={t.textSecondary}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery("")}>
                <X size={14} color={t.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* List */}
          <FlatList
            data={filtered}
            renderItem={renderItem}
            keyExtractor={(item) => item.code}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => (
              <View style={{ height: spacing.sm }} />
            )}
            ListEmptyComponent={
              <Text style={[styles.emptyText, { color: t.textSecondary }]}>
                No languages match "{query}"
              </Text>
            }
          />
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "75%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 34,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: 2,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  listContent: {
    padding: spacing.md,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  itemTextWrap: {
    flex: 1,
    marginRight: spacing.sm,
  },
  itemNative: {
    fontSize: 16,
    fontWeight: "600",
  },
  itemName: {
    fontSize: 12.5,
    fontWeight: "400",
    marginTop: 2,
  },
  emptyText: {
    textAlign: "center",
    paddingVertical: spacing.xl,
    fontSize: 14,
  },
});

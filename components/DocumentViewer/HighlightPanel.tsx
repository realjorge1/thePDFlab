/**
 * HighlightPanel — Modal list of saved highlights.
 * Color picking is handled by SelectionToolbar (WPS-style inline toolbar).
 */
import {
  type Highlight,
} from "@/src/types/document-viewer.types";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import React from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

// ============================================================================
// Highlights Panel (modal list of saved highlights)
// ============================================================================
interface PanelProps {
  visible: boolean;
  highlights: Highlight[];
  onClose: () => void;
  onTapHighlight: (h: Highlight) => void;
  onDeleteHighlight: (id: string) => void;
}

export function HighlightPanel({
  visible,
  highlights,
  onClose,
  onTapHighlight,
  onDeleteHighlight,
}: PanelProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={panelStyles.overlay} onPress={onClose} />
      <View style={panelStyles.sheet}>
        <View style={panelStyles.handle} />
        <View style={panelStyles.header}>
          <Text style={panelStyles.title}>
            Highlights ({highlights.length})
          </Text>
          <Pressable onPress={onClose}>
            <MaterialIcons name="close" size={24} color="#333" />
          </Pressable>
        </View>

        {highlights.length === 0 ? (
          <View style={panelStyles.empty}>
            <MaterialIcons name="highlight" size={48} color="#ccc" />
            <Text style={panelStyles.emptyText}>No highlights yet</Text>
            <Text style={panelStyles.emptyHint}>
              Select text in Mobile View to highlight it
            </Text>
          </View>
        ) : (
          <FlatList
            data={highlights}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable
                style={panelStyles.item}
                onPress={() => onTapHighlight(item)}
              >
                <View
                  style={[
                    panelStyles.colorDot,
                    { backgroundColor: item.color },
                  ]}
                />
                <View style={panelStyles.itemContent}>
                  <Text style={panelStyles.itemText} numberOfLines={2}>
                    {item.text}
                  </Text>
                  {item.pageNumber != null && (
                    <Text style={panelStyles.pageRef}>
                      Page {item.pageNumber}
                    </Text>
                  )}
                </View>
                <Pressable
                  onPress={() => onDeleteHighlight(item.id)}
                  hitSlop={8}
                >
                  <MaterialIcons name="delete-outline" size={20} color="#999" />
                </Pressable>
              </Pressable>
            )}
            contentContainerStyle={{ paddingBottom: 20 }}
          />
        )}
      </View>
    </Modal>
  );
}

const panelStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "60%",
    paddingTop: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#ddd",
    alignSelf: "center",
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: "700" },
  empty: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyText: { fontSize: 16, fontWeight: "600", color: "#999", marginTop: 12 },
  emptyHint: { fontSize: 13, color: "#bbb", marginTop: 4 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    gap: 12,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  itemContent: { flex: 1 },
  itemText: { fontSize: 14, color: "#333" },
  pageRef: { fontSize: 11, color: "#888", marginTop: 2 },
});

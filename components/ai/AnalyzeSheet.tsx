// ============================================
// AnalyzeSheet — one-tap entry into Gozlin's document-intelligence features
// Presents Devil's Advocate + Narrative Arc, then deep-links into /gozlin with
// the file attached and the chosen analysis mode pre-selected.
// Drop into any viewer header or the library long-press menu.
// ============================================

import { useTheme } from "@/services/ThemeProvider";
import { useRouter } from "expo-router";
import { Swords, Waypoints, X } from "lucide-react-native";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";

export interface AnalyzeTarget {
  uri: string;
  name: string;
  mimeType?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  file: AnalyzeTarget | null;
}

const OPTIONS = [
  {
    action: "devils-advocate",
    title: "Devil's Advocate",
    blurb: "The hardest objections your audience will raise",
    color: "#DC2626",
    Icon: Swords,
  },
  {
    action: "narrative-arc",
    title: "Narrative Arc",
    blurb: "Does your story flow — or fall apart?",
    color: "#0EA5E9",
    Icon: Waypoints,
  },
] as const;

export function AnalyzeSheet({ visible, onClose, file }: Props) {
  const { colors: t, mode } = useTheme();
  const router = useRouter();

  const go = (action: string) => {
    if (!file) return;
    onClose();
    router.push({
      pathname: "/gozlin",
      params: {
        fileUri: file.uri,
        fileName: file.name,
        fileMime: file.mimeType || "application/octet-stream",
        initialAction: action,
      },
    } as any);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: t.card, borderColor: t.border },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: t.text }]}>Analyze with Gozlin</Text>
              {file?.name ? (
                <Text style={[styles.subtitle, { color: t.textSecondary }]} numberOfLines={1}>
                  {file.name}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={20} color={t.textTertiary} />
            </TouchableOpacity>
          </View>

          {OPTIONS.map((o) => (
            <TouchableOpacity
              key={o.action}
              activeOpacity={0.8}
              onPress={() => go(o.action)}
              style={[
                styles.option,
                {
                  backgroundColor: mode === "dark" ? "#0F172A" : "#F8FAFC",
                  borderColor: t.border,
                },
              ]}
            >
              <View style={[styles.iconWrap, { backgroundColor: o.color }]}>
                <o.Icon size={20} color="#FFF" strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionTitle, { color: t.text }]}>{o.title}</Text>
                <Text style={[styles.optionBlurb, { color: t.textSecondary }]}>{o.blurb}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: { fontSize: 18, fontWeight: "800" },
  subtitle: { fontSize: 13, marginTop: 2 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  optionTitle: { fontSize: 15, fontWeight: "700" },
  optionBlurb: { fontSize: 12.5, marginTop: 2, lineHeight: 17 },
});

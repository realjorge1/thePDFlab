import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePathname, useRouter } from "expo-router";
import { StickyNote } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import { DeviceEventEmitter, StyleSheet, TouchableOpacity, View } from "react-native";

export const PINNED_NOTE_KEY = "@pdflab/pinned_note_v1";

export interface PinnedNoteRecord {
  id: string;
  color: string;
  textSnippet: string;
}

const BUTTON_SIZE = 36;
const CONTAINER_SIZE = BUTTON_SIZE + 8;

const ALLOWED_PATHS = ["/tools", "/library", "/download", "/folders"];

export default function PinnedNoteButton() {
  const router = useRouter();
  const pathname = usePathname();
  const [pinned, setPinned] = useState<PinnedNoteRecord | null>(null);

  const isHome = pathname === "/" || pathname === "/(tabs)";
  const isVisible =
    (isHome || ALLOWED_PATHS.some(
      (p) => pathname === p || pathname === `/(tabs)${p}`,
    )) && pinned !== null;

  // Re-read from AsyncStorage whenever the pathname changes
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(PINNED_NOTE_KEY)
      .then((raw) => {
        if (!mounted) return;
        setPinned(raw ? (JSON.parse(raw) as PinnedNoteRecord) : null);
      })
      .catch(() => {
        if (mounted) setPinned(null);
      });
    return () => {
      mounted = false;
    };
  }, [pathname]);

  // Real-time updates when workspace changes the pinned note color
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      "pinnedNoteUpdated",
      (record: PinnedNoteRecord | null) => {
        setPinned(record);
      },
    );
    return () => sub.remove();
  }, []);

  const handlePress = useCallback(() => {
    router.push({
      pathname: "/ai-workspace",
      params: { focusPin: "1" },
    } as any);
  }, [router]);

  if (!isVisible) return null;

  const noteColor = pinned!.color;

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View
        style={[
          styles.glow,
          { backgroundColor: `${noteColor}40`, borderColor: `${noteColor}80` },
        ]}
      />
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: noteColor }]}
        onPress={handlePress}
        activeOpacity={0.8}
        accessibilityLabel="Open pinned note"
        accessibilityRole="button"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <StickyNote size={15} color="#FFFFFF" strokeWidth={2.2} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 172,
    right: 18,
    width: CONTAINER_SIZE,
    height: CONTAINER_SIZE,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9998,
    elevation: 19,
  },
  glow: {
    position: "absolute",
    width: CONTAINER_SIZE,
    height: CONTAINER_SIZE,
    borderRadius: CONTAINER_SIZE / 2,
    borderWidth: 1.5,
  },
  btn: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
});

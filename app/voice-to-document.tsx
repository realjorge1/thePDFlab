/**
 * voice-to-document.tsx
 *
 * Voice transcription is temporarily disabled. This screen now shows a
 * friendly "Coming soon" message in place of the previous record/transcribe
 * UI. It is no longer reachable from the Create screen (that tile is also
 * marked Coming Soon), but the route is preserved so any stray navigation
 * lands here gracefully rather than on a broken screen.
 */

import { AppHeaderContainer } from "@/components/AppHeaderContainer";
import { GradientView } from "@/components/GradientView";
import { colors as brandColors } from "@/constants/theme";
import { useTheme } from "@/services/ThemeProvider";
import { useRouter } from "expo-router";
import { ChevronLeft, Mic } from "lucide-react-native";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function VoiceToDocumentScreen() {
  const router = useRouter();
  const { colors: t } = useTheme();

  return (
    <SafeAreaView edges={["top"]} style={[styles.screen, { backgroundColor: t.background }]}>
      <AppHeaderContainer>
        <GradientView
          colors={[
            brandColors.gradientStart,
            brandColors.gradientMid,
            brandColors.gradientEnd,
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.backBtn}
          >
            <ChevronLeft size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Voice to Document</Text>
          <View style={{ width: 38 }} />
        </GradientView>
      </AppHeaderContainer>

      <View style={styles.body}>
        <View style={[styles.iconWrap, { backgroundColor: "#A855F715" }]}>
          <Mic size={36} color="#A855F7" />
        </View>
        <Text style={[styles.title, { color: t.text }]}>Coming Soon</Text>
        <Text style={[styles.subtitle, { color: t.textSecondary }]}>
          Voice recording and transcription is on the way. Check back in an
          upcoming update.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backToBtn}
          activeOpacity={0.85}
        >
          <Text style={styles.backToBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 14,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  title: { fontSize: 22, fontWeight: "800" },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 320,
  },
  backToBtn: {
    marginTop: 18,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "#A855F7",
  },
  backToBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
});

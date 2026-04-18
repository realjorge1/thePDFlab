/**
 * PPT Viewer Screen
 *
 * Backend-driven. Uploads the .pptx to /api/pptx/convert, downloads the
 * rendered PDF, and displays it with react-native-pdf. No client-side
 * PPTX parsing or rendering.
 */

import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Pdf from "react-native-pdf";
import { SafeAreaView } from "react-native-safe-area-context";

import { renderPptxAsPdf } from "@/services/pptxRenderClient";

const BG = "#111827";
const HEADER_BG = "#1F2937";
const ACCENT = "#6366F1";

type LoadState =
  | { phase: "idle" }
  | { phase: "converting" }
  | { phase: "ready"; pdfUri: string }
  | { phase: "error"; message: string };

export default function PPTViewerScreen() {
  const params = useLocalSearchParams<{ uri: string; name?: string }>();
  const fileUri = params.uri ?? "";
  const fileName = params.name ?? "Presentation";

  const [state, setState] = useState<LoadState>({ phase: "idle" });
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const convert = useCallback(async () => {
    if (!fileUri) {
      setState({ phase: "error", message: "No file provided" });
      return;
    }
    setState({ phase: "converting" });
    try {
      const result = await renderPptxAsPdf(fileUri, fileName);
      if (mountedRef.current) {
        setState({ phase: "ready", pdfUri: result.localPdfUri });
      }
    } catch (err) {
      if (mountedRef.current) {
        const message =
          err instanceof Error ? err.message : "PPTX conversion failed";
        setState({ phase: "error", message });
      }
    }
  }, [fileUri, fileName]);

  useEffect(() => {
    convert();
  }, [convert]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={10}
        >
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {fileName}
          </Text>
          {state.phase === "ready" && totalPages > 0 && (
            <Text style={styles.pageCounter}>
              Slide {currentPage} / {totalPages}
            </Text>
          )}
          {state.phase === "converting" && (
            <Text style={styles.pageCounter}>Rendering on server…</Text>
          )}
        </View>

        <View style={styles.headerRight} />
      </View>

      {state.phase === "ready" ? (
        <Pdf
          source={{ uri: state.pdfUri }}
          style={styles.viewer}
          trustAllCerts={false}
          onLoadComplete={(pages) => setTotalPages(pages)}
          onPageChanged={(page) => setCurrentPage(page)}
          onError={(err: any) => {
            const message =
              err instanceof Error ? err.message : "PDF render error";
            setState({ phase: "error", message });
          }}
        />
      ) : state.phase === "error" ? (
        <View style={styles.center}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Can’t open presentation</Text>
          <Text style={styles.errorBody}>{state.message}</Text>
          <Text style={styles.errorHint}>
            This feature requires a network connection to the server.
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={convert}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.retryBtn, styles.secondaryBtn]}
            onPress={() => router.back()}
          >
            <Text style={styles.retryText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={ACCENT} size="large" />
          <Text style={styles.loadingText}>Converting presentation…</Text>
          <Text style={styles.loadingSub}>
            The server is rendering your slides. Large decks may take a moment.
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: HEADER_BG,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
    gap: 10,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: { color: "#FFFFFF", fontSize: 26, lineHeight: 30, marginTop: -2 },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  pageCounter: { color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 1 },
  headerRight: { width: 34 },
  viewer: { flex: 1, backgroundColor: BG },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    padding: 32,
  },
  errorIcon: { fontSize: 52 },
  errorTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
  errorBody: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    textAlign: "center",
    marginHorizontal: 16,
  },
  loadingText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
  loadingSub: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    textAlign: "center",
    marginHorizontal: 32,
  },
  errorHint: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 11,
    textAlign: "center",
    marginHorizontal: 32,
    marginTop: -4,
  },
  retryBtn: {
    marginTop: 8,
    paddingVertical: 11,
    paddingHorizontal: 28,
    borderRadius: 12,
    backgroundColor: ACCENT,
  },
  secondaryBtn: { backgroundColor: "rgba(255,255,255,0.1)" },
  retryText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
});

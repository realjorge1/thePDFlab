/**
 * scan-to-text.tsx
 *
 * OCR-based scan flow: Images → extract text (Tesseract on backend) →
 * optional AI cleanup → editable text → export as PDF or DOCX.
 *
 * Two modes:
 *   Fast Scan     — OCR only, no AI call. Up to 10 images.
 *   Enhanced Scan — OCR + AI text cleanup per image. Up to 4 images.
 *
 * Images are processed sequentially (one-by-one). Results are joined
 * in pick order so the first image's text leads the document.
 */

import { PremiumGate } from "@/components/PremiumGate";
import { usePermissionPrimer } from "@/components/PermissionPrimer";
import { API_ENDPOINTS } from "@/config/api";
import { markFileAsCreated } from "@/services/fileService";
import {
  createDocxFromBlank,
  createPdfFromBlank,
  pickImageFromCamera,
  pickImagesFromLibrary,
  saveFile,
  shareFile as shareCreatedFile,
} from "@/services/fileCreationService";
import { useTheme } from "@/services/ThemeProvider";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Camera,
  CheckCircle,
  ChevronLeft,
  Edit3,
  File,
  FileText,
  Images,
  ScanLine,
  Sparkles,
  X,
  Zap,
} from "lucide-react-native";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppHeaderContainer } from "@/components/AppHeaderContainer";
import { GradientView } from "@/components/GradientView";
import { colors as brandColors } from "@/constants/theme";

const MAX_IMAGES_FAST = 10;
const MAX_IMAGES_ENHANCED = 4;

type ScanMode = "fast" | "enhanced";
type OutputFormat = "pdf" | "docx";
type Step = "select" | "processing" | "editing";

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ScanToTextScreen() {
  const router = useRouter();
  const { colors: t } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ fileType?: string }>();
  const titleInputRef = useRef<TextInput>(null);
  const { requestPrime, primer } = usePermissionPrimer();

  const [imageUris, setImageUris] = useState<string[]>([]);
  const [mode, setMode] = useState<ScanMode>("fast");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(
    params.fileType === "docx" ? "docx" : "pdf",
  );
  const [step, setStep] = useState<Step>("select");
  const [progressMsg, setProgressMsg] = useState("");
  const [extractedText, setExtractedText] = useState("");
  const [title, setTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [wasEnhanced, setWasEnhanced] = useState(false);

  const imageLimit = mode === "enhanced" ? MAX_IMAGES_ENHANCED : MAX_IMAGES_FAST;

  // ── Image management ───────────────────────────────────────────────────────

  const removeImage = useCallback((index: number) => {
    setImageUris((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleModeChange = useCallback(
    (newMode: ScanMode) => {
      const newLimit = newMode === "enhanced" ? MAX_IMAGES_ENHANCED : MAX_IMAGES_FAST;
      setMode(newMode);
      if (imageUris.length > newLimit) {
        setImageUris((prev) => prev.slice(0, newLimit));
      }
    },
    [imageUris],
  );

  const handlePickGallery = useCallback(async () => {
    const remaining = imageLimit - imageUris.length;
    if (remaining <= 0) {
      Alert.alert(
        "Limit Reached",
        `${mode === "enhanced" ? "Enhanced" : "Fast"} Scan supports up to ${imageLimit} images. Remove some to add more.`,
      );
      return;
    }
    const primed = await requestPrime("gallery");
    if (!primed) return;
    const result = await pickImagesFromLibrary();
    if (result.success && result.uris?.length) {
      const toAdd = result.uris.slice(0, remaining);
      if (result.uris.length > remaining) {
        Alert.alert(
          "Limit Applied",
          `Only the first ${remaining} image${remaining === 1 ? "" : "s"} were added (max ${imageLimit} for ${mode === "enhanced" ? "Enhanced" : "Fast"} Scan).`,
        );
      }
      setImageUris((prev) => [...prev, ...toAdd]);
      setExtractedText("");
    } else if (result.error) {
      Alert.alert("Error", result.error);
    }
  }, [imageUris, mode, imageLimit, requestPrime]);

  const handlePickCamera = useCallback(async () => {
    if (imageUris.length >= imageLimit) {
      Alert.alert(
        "Limit Reached",
        `${mode === "enhanced" ? "Enhanced" : "Fast"} Scan supports up to ${imageLimit} images. Remove some to add more.`,
      );
      return;
    }
    const primed = await requestPrime("camera");
    if (!primed) return;
    const result = await pickImageFromCamera();
    if (result.success && result.uris?.[0]) {
      setImageUris((prev) => [...prev, result.uris![0]]);
      setExtractedText("");
    } else if (result.error) {
      Alert.alert("Error", result.error);
    }
  }, [imageUris, mode, imageLimit, requestPrime]);

  // ── OCR extraction (sequential queue) ─────────────────────────────────────

  const handleExtract = useCallback(async () => {
    if (imageUris.length === 0) {
      Alert.alert("No Images", "Please select at least one image.");
      return;
    }

    setStep("processing");
    const toProcess = imageUris.slice(0, imageLimit);
    const allTexts: string[] = [];
    let anyEnhanced = false;

    try {
      for (let i = 0; i < toProcess.length; i++) {
        setProgressMsg(
          toProcess.length > 1
            ? `Scanning image ${i + 1} of ${toProcess.length}…`
            : "Extracting text…",
        );

        const formData = new FormData();
        formData.append("image", {
          uri: toProcess[i],
          type: "image/jpeg",
          name: `scan_${i + 1}.jpg`,
        } as any);
        formData.append("mode", mode);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120_000);

        let response: Response;
        try {
          response = await fetch(API_ENDPOINTS.AI.OCR_SCAN, {
            method: "POST",
            body: formData,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }

        const result = await response.json();

        if (!response.ok || !result.success) {
          const errMsg: string = result.error || "OCR processing failed";
          if (errMsg.toLowerCase().includes("no readable text")) {
            allTexts.push(`[Image ${i + 1}: No readable text found]`);
            continue;
          }
          Alert.alert("Scan Failed", errMsg, [
            { text: "OK", onPress: () => setStep("select") },
          ]);
          return;
        }

        allTexts.push(result.text || "");
        if (result.enhanced === true) anyEnhanced = true;
      }

      setExtractedText(allTexts.join("\n\n"));
      setWasEnhanced(anyEnhanced);
      setStep("editing");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isTimeout = /abort|timed? ?out/i.test(msg);
      Alert.alert(
        isTimeout ? "Scan Timed Out" : "Scan Error",
        isTimeout
          ? "The scan took too long. Try fewer or smaller images."
          : `Failed to scan: ${msg}`,
        [{ text: "OK", onPress: () => setStep("select") }],
      );
    }
  }, [imageUris, imageLimit, mode]);

  // ── Document creation ──────────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    if (!extractedText.trim()) {
      Alert.alert("No Text", "There is no text to create a document from.");
      return;
    }
    const effectiveTitle = title.trim();
    if (!effectiveTitle) {
      Alert.alert(
        "Title Required",
        "Please enter a document title before creating.",
        [{ text: "OK", onPress: () => titleInputRef.current?.focus() }],
      );
      return;
    }
    setIsCreating(true);
    try {
      const result =
        outputFormat === "pdf"
          ? await createPdfFromBlank(effectiveTitle, extractedText)
          : await createDocxFromBlank(effectiveTitle, extractedText);

      if (result.success && result.uri) {
        const fileName = result.fileName || `${effectiveTitle}.${outputFormat}`;
        await markFileAsCreated(result.uri, fileName, outputFormat);

        Alert.alert("Document Created", "Your scanned document was created.", [
          {
            text: "Save",
            onPress: async () => {
              await saveFile(outputFormat, result.uri!, result.fileName);
              router.back();
            },
          },
          {
            text: "Share",
            onPress: async () => {
              await shareCreatedFile(outputFormat, result.uri!, result.fileName);
              router.back();
            },
          },
          {
            text: "Done",
            style: "cancel",
            onPress: () => router.back(),
          },
        ]);
      } else if (result.error) {
        Alert.alert("Error", result.error);
      }
    } catch (error) {
      Alert.alert(
        "Error",
        `Failed to create document: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsCreating(false);
    }
  }, [extractedText, title, outputFormat, router]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PremiumGate
      feature="Scan to Text"
      description="OCR scanning and AI text cleanup is a Premium feature."
    >
    <SafeAreaView edges={["top"]} style={[styles.screen, { backgroundColor: t.background }]}>
      <KeyboardAvoidingView
        style={styles.flex1}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* ─── Gradient Header ─── */}
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
            <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn}>
              <ChevronLeft color="#FFFFFF" size={26} strokeWidth={2.2} />
            </Pressable>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {step === "editing" ? "Edit Scanned Text" : "Scan to Text"}
            </Text>
            {step === "editing" ? (
              <Pressable
                onPress={handleCreate}
                disabled={isCreating || !extractedText.trim()}
                style={[
                  styles.createBtn,
                  (isCreating || !extractedText.trim()) && styles.createBtnDisabled,
                ]}
              >
                {isCreating ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.createBtnText}>
                    Create {outputFormat.toUpperCase()}
                  </Text>
                )}
              </Pressable>
            ) : (
              <View style={styles.headerSpacer} />
            )}
          </GradientView>
        </AppHeaderContainer>

        <ScrollView
          style={styles.flex1}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step !== "editing" ? (
            // ── SELECT STEP ──────────────────────────────────────────────────
            <>
              {/* Image preview / thumbnail area */}
              <View
                style={[
                  styles.imageArea,
                  { backgroundColor: t.card, borderColor: t.borderLight },
                ]}
              >
                {imageUris.length === 0 ? (
                  <View style={styles.imagePlaceholder}>
                    <ScanLine color={t.textTertiary} size={48} strokeWidth={1.5} />
                    <Text style={[styles.placeholderTitle, { color: t.text }]}>
                      Select Images
                    </Text>
                    <Text style={[styles.placeholderBody, { color: t.textSecondary }]}>
                      Choose photos from your gallery or take new ones.{"\n"}
                      Supported formats: PNG, JPEG
                    </Text>
                  </View>
                ) : imageUris.length === 1 ? (
                  <Image
                    source={{ uri: imageUris[0] }}
                    style={styles.imagePreview}
                    contentFit="contain"
                    transition={150}
                  />
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.thumbRow}
                  >
                    {imageUris.map((uri, index) => (
                      <View key={`${uri}-${index}`} style={styles.thumbItem}>
                        <Image
                          source={{ uri }}
                          style={styles.thumbImage}
                          contentFit="cover"
                          transition={100}
                        />
                        <View style={styles.thumbIndexBadge}>
                          <Text style={styles.thumbIndexText}>{index + 1}</Text>
                        </View>
                        <Pressable
                          onPress={() => removeImage(index)}
                          style={styles.thumbRemoveBtn}
                          hitSlop={6}
                        >
                          <X color="#fff" size={10} strokeWidth={2.5} />
                        </Pressable>
                      </View>
                    ))}
                  </ScrollView>
                )}
              </View>

              {/* Image count */}
              {imageUris.length > 0 && (
                <Text style={[styles.countText, { color: t.textSecondary }]}>
                  {imageUris.length} / {imageLimit} image{imageUris.length !== 1 ? "s" : ""} selected
                </Text>
              )}

              {/* Gallery / Camera buttons */}
              <View style={styles.pickRow}>
                <Pressable
                  onPress={handlePickGallery}
                  style={[styles.pickBtn, { backgroundColor: t.card, borderColor: t.borderLight }]}
                >
                  <Images color={t.primary} size={20} strokeWidth={2.2} />
                  <Text style={[styles.pickBtnLabel, { color: t.text }]}>
                    {imageUris.length > 0 ? "Add from Gallery" : "Gallery"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handlePickCamera}
                  style={[styles.pickBtn, { backgroundColor: t.card, borderColor: t.borderLight }]}
                >
                  <Camera color={t.primary} size={20} strokeWidth={2.2} />
                  <Text style={[styles.pickBtnLabel, { color: t.text }]}>
                    {imageUris.length > 0 ? "Add from Camera" : "Camera"}
                  </Text>
                </Pressable>
              </View>

              {/* Mode selector */}
              <View style={[styles.sectionCard, { backgroundColor: t.card, borderColor: t.borderLight }]}>
                <Text style={[styles.sectionLabel, { color: t.textSecondary }]}>Scan Mode</Text>
                <View style={styles.toggleRow}>
                  <Pressable
                    onPress={() => handleModeChange("fast")}
                    style={[
                      styles.toggleBtn,
                      mode === "fast"
                        ? { backgroundColor: t.primary }
                        : { backgroundColor: t.background, borderColor: t.border },
                    ]}
                  >
                    <Zap
                      color={mode === "fast" ? "#fff" : t.textSecondary}
                      size={16}
                      strokeWidth={2.2}
                    />
                    <Text
                      style={[
                        styles.toggleLabel,
                        { color: mode === "fast" ? "#fff" : t.textSecondary },
                      ]}
                    >
                      Fast Scan
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleModeChange("enhanced")}
                    style={[
                      styles.toggleBtn,
                      mode === "enhanced"
                        ? { backgroundColor: "#7C3AED" }
                        : { backgroundColor: t.background, borderColor: t.border },
                    ]}
                  >
                    <Sparkles
                      color={mode === "enhanced" ? "#fff" : t.textSecondary}
                      size={16}
                      strokeWidth={2.2}
                    />
                    <Text
                      style={[
                        styles.toggleLabel,
                        { color: mode === "enhanced" ? "#fff" : t.textSecondary },
                      ]}
                    >
                      Enhanced (AI)
                    </Text>
                  </Pressable>
                </View>
                <Text style={[styles.modeHint, { color: t.textTertiary }]}>
                  {mode === "fast"
                    ? `Offline — raw OCR only, no AI call. Up to ${MAX_IMAGES_FAST} images per batch.`
                    : `OCR + AI cleanup — fixes errors, reconstructs paragraphs. Up to ${MAX_IMAGES_ENHANCED} images per batch.`}
                </Text>
              </View>

              {/* Output format selector */}
              <View style={[styles.sectionCard, { backgroundColor: t.card, borderColor: t.borderLight }]}>
                <Text style={[styles.sectionLabel, { color: t.textSecondary }]}>Output Format</Text>
                <View style={styles.toggleRow}>
                  <Pressable
                    onPress={() => setOutputFormat("pdf")}
                    style={[
                      styles.toggleBtn,
                      outputFormat === "pdf"
                        ? { backgroundColor: "#DC2626" }
                        : { backgroundColor: t.background, borderColor: t.border },
                    ]}
                  >
                    <File
                      color={outputFormat === "pdf" ? "#fff" : t.textSecondary}
                      size={16}
                      strokeWidth={2.2}
                    />
                    <Text
                      style={[
                        styles.toggleLabel,
                        { color: outputFormat === "pdf" ? "#fff" : t.textSecondary },
                      ]}
                    >
                      PDF
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setOutputFormat("docx")}
                    style={[
                      styles.toggleBtn,
                      outputFormat === "docx"
                        ? { backgroundColor: "#2563EB" }
                        : { backgroundColor: t.background, borderColor: t.border },
                    ]}
                  >
                    <FileText
                      color={outputFormat === "docx" ? "#fff" : t.textSecondary}
                      size={16}
                      strokeWidth={2.2}
                    />
                    <Text
                      style={[
                        styles.toggleLabel,
                        { color: outputFormat === "docx" ? "#fff" : t.textSecondary },
                      ]}
                    >
                      Word (DOCX)
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* Extract button */}
              <Pressable
                onPress={handleExtract}
                disabled={imageUris.length === 0}
                style={[
                  styles.extractBtn,
                  { backgroundColor: t.primary },
                  imageUris.length === 0 && styles.extractBtnDisabled,
                ]}
              >
                <ScanLine color="#fff" size={20} strokeWidth={2.2} />
                <Text style={styles.extractBtnLabel}>
                  {mode === "enhanced"
                    ? `Scan & Enhance${imageUris.length > 1 ? ` (${imageUris.length} images)` : ""}`
                    : `Scan & Extract${imageUris.length > 1 ? ` (${imageUris.length} images)` : ""}`}
                </Text>
              </Pressable>
            </>
          ) : (
            // ── EDITING STEP ─────────────────────────────────────────────────
            <>
              {/* Enhancement badge */}
              {wasEnhanced && (
                <View style={[styles.enhancedBadge, { backgroundColor: "#EDE9FE" }]}>
                  <CheckCircle color="#7C3AED" size={14} strokeWidth={2.2} />
                  <Text style={[styles.enhancedBadgeText, { color: "#7C3AED" }]}>
                    AI-enhanced text
                  </Text>
                </View>
              )}

              {/* Title input — required before creating */}
              <View
                style={[styles.sectionCard, { backgroundColor: t.card, borderColor: t.borderLight }]}
              >
                <Text style={[styles.sectionLabel, { color: t.textSecondary }]}>
                  Document Title
                </Text>
                <TextInput
                  ref={titleInputRef}
                  style={[styles.titleInput, { color: t.text, borderBottomColor: t.border }]}
                  placeholder="Enter document title…"
                  placeholderTextColor={t.textTertiary}
                  value={title}
                  onChangeText={setTitle}
                  returnKeyType="done"
                  maxLength={120}
                />
                <Text style={[styles.titleHint, { color: t.textTertiary }]}>
                  This will be used as the filename for your document.
                </Text>
              </View>

              {/* Format selector (still switchable in editing step) */}
              <View
                style={[styles.sectionCard, { backgroundColor: t.card, borderColor: t.borderLight }]}
              >
                <Text style={[styles.sectionLabel, { color: t.textSecondary }]}>Output Format</Text>
                <View style={styles.toggleRow}>
                  <Pressable
                    onPress={() => setOutputFormat("pdf")}
                    style={[
                      styles.toggleBtn,
                      outputFormat === "pdf"
                        ? { backgroundColor: "#DC2626" }
                        : { backgroundColor: t.background, borderColor: t.border },
                    ]}
                  >
                    <File
                      color={outputFormat === "pdf" ? "#fff" : t.textSecondary}
                      size={16}
                      strokeWidth={2.2}
                    />
                    <Text
                      style={[
                        styles.toggleLabel,
                        { color: outputFormat === "pdf" ? "#fff" : t.textSecondary },
                      ]}
                    >
                      PDF
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setOutputFormat("docx")}
                    style={[
                      styles.toggleBtn,
                      outputFormat === "docx"
                        ? { backgroundColor: "#2563EB" }
                        : { backgroundColor: t.background, borderColor: t.border },
                    ]}
                  >
                    <FileText
                      color={outputFormat === "docx" ? "#fff" : t.textSecondary}
                      size={16}
                      strokeWidth={2.2}
                    />
                    <Text
                      style={[
                        styles.toggleLabel,
                        { color: outputFormat === "docx" ? "#fff" : t.textSecondary },
                      ]}
                    >
                      Word (DOCX)
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* Extracted text editor */}
              <View
                style={[
                  styles.textEditorCard,
                  { backgroundColor: t.card, borderColor: t.borderLight },
                ]}
              >
                <View style={styles.textEditorHeader}>
                  <Edit3 color={t.textSecondary} size={14} strokeWidth={2.2} />
                  <Text style={[styles.sectionLabel, { color: t.textSecondary, marginBottom: 0 }]}>
                    Extracted Text
                  </Text>
                  <Text style={[styles.charCount, { color: t.textTertiary }]}>
                    {extractedText.length} chars
                  </Text>
                </View>
                <TextInput
                  style={[styles.textEditor, { color: t.text }]}
                  value={extractedText}
                  onChangeText={setExtractedText}
                  multiline
                  textAlignVertical="top"
                  placeholder="Extracted text appears here…"
                  placeholderTextColor={t.textTertiary}
                  scrollEnabled={false}
                />
              </View>

              {/* Go back to select step */}
              <Pressable
                onPress={() => setStep("select")}
                style={styles.rescanLink}
              >
                <ScanLine color={t.primary} size={14} strokeWidth={2.2} />
                <Text style={[styles.rescanLinkText, { color: t.primary }]}>
                  {imageUris.length > 1 ? "Change images" : "Scan a different image"}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>

        {/* Processing overlay */}
        {step === "processing" && (
          <View style={styles.overlay}>
            <View style={[styles.overlayCard, { backgroundColor: t.card }]}>
              <ActivityIndicator size="large" color={t.primary} />
              <Text style={[styles.overlayText, { color: t.text }]}>{progressMsg}</Text>
              <Text style={[styles.overlayHint, { color: t.textSecondary }]}>
                {mode === "enhanced"
                  ? "OCR + AI cleanup — may take up to 30 s per image"
                  : "This may take a few seconds per image"}
              </Text>
            </View>
          </View>
        )}

        {/* Create overlay */}
        {isCreating && (
          <View style={styles.overlay}>
            <View style={[styles.overlayCard, { backgroundColor: t.card }]}>
              <ActivityIndicator size="large" color={t.primary} />
              <Text style={[styles.overlayText, { color: t.text }]}>Generating document…</Text>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Pre-permission priming sheet for camera / gallery */}
      {primer}
    </SafeAreaView>
    </PremiumGate>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex1: { flex: 1 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: "#FFFFFF",
  },
  headerSpacer: { width: 80 },
  createBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    minWidth: 80,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  createBtnDisabled: { opacity: 0.45 },
  createBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },

  // Scroll
  scrollContent: { paddingHorizontal: 10, paddingTop: 16, paddingBottom: 16, gap: 14 },

  // Image area
  imageArea: {
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
    minHeight: 200,
    alignItems: "center",
    justifyContent: "center",
  },
  imagePreview: { width: "100%", aspectRatio: 4 / 3 },
  imagePlaceholder: { padding: 32, alignItems: "center", gap: 10 },
  placeholderTitle: { fontSize: 16, fontWeight: "700" },
  placeholderBody: { fontSize: 13, textAlign: "center", lineHeight: 19 },

  // Thumbnail grid (multi-image)
  thumbRow: {
    flexDirection: "row",
    padding: 12,
    gap: 10,
    alignItems: "center",
    minHeight: 200,
  },
  thumbItem: {
    width: 110,
    height: 145,
    borderRadius: 10,
    overflow: "hidden",
    position: "relative",
  },
  thumbImage: { width: "100%", height: "100%" },
  thumbIndexBadge: {
    position: "absolute",
    bottom: 5,
    left: 5,
    backgroundColor: "rgba(0,0,0,0.62)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  thumbIndexText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  thumbRemoveBtn: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.62)",
    alignItems: "center",
    justifyContent: "center",
  },

  // Image count label
  countText: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "right",
    marginTop: -6,
  },

  // Pick buttons
  pickRow: { flexDirection: "row", gap: 10 },
  pickBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 12,
    gap: 8,
  },
  pickBtnLabel: { fontSize: 14, fontWeight: "600" },

  // Section cards
  sectionCard: { borderWidth: 1, borderRadius: 14, padding: 14 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },

  // Toggles
  toggleRow: { flexDirection: "row", gap: 8 },
  toggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  toggleLabel: { fontSize: 13, fontWeight: "600" },
  modeHint: { fontSize: 12, marginTop: 10, lineHeight: 17, fontWeight: "500" },

  // Extract button
  extractBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 14,
    gap: 8,
  },
  extractBtnDisabled: { opacity: 0.4 },
  extractBtnLabel: { color: "#fff", fontSize: 16, fontWeight: "700" },

  // Editing step
  enhancedBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    gap: 5,
  },
  enhancedBadgeText: { fontSize: 12, fontWeight: "700" },

  titleInput: {
    fontSize: 17,
    fontWeight: "600",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleHint: {
    fontSize: 11,
    fontWeight: "500",
    marginTop: 6,
  },

  textEditorCard: { borderWidth: 1, borderRadius: 14, padding: 14 },
  textEditorHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  charCount: { fontSize: 11, fontWeight: "500", marginLeft: "auto" },
  textEditor: { fontSize: 14, lineHeight: 22, minHeight: 220 },

  rescanLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
  },
  rescanLinkText: { fontSize: 13, fontWeight: "600" },

  // Overlays
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,23,42,0.55)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  overlayCard: {
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    minWidth: 240,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  overlayText: { fontSize: 15, fontWeight: "700", textAlign: "center" },
  overlayHint: { fontSize: 12, textAlign: "center", fontWeight: "500", lineHeight: 17 },
});

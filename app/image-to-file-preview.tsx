/**
 * image-to-file-preview.tsx
 *
 * Preview screen shown after the user picks images from gallery or camera.
 * The user can:
 *   • reorder, remove, or add more images (from gallery or camera)
 *   • type a title for the generated file
 *   • confirm creation — at which point the PDF/DOCX is assembled
 */

import { markFileAsCreated } from "@/services/fileService";
import {
  createDocxFromImageUris,
  createPdfFromImageUris,
  FileType,
  pickImageFromCamera,
  pickImagesFromLibrary,
  saveFile,
  shareFile as shareCreatedFile,
} from "@/services/fileCreationService";
import { useTheme } from "@/services/ThemeProvider";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowDown,
  ArrowUp,
  Camera,
  ChevronLeft,
  Images,
  Trash2,
} from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
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

export default function ImageToFilePreviewScreen() {
  const router = useRouter();
  const { colors: t } = useTheme();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{
    uris?: string;
    fileType?: string;
  }>();

  const fileType: FileType = params.fileType === "docx" ? "docx" : "pdf";

  const initialUris = useMemo<string[]>(() => {
    try {
      if (!params.uris) return [];
      const parsed = JSON.parse(params.uris);
      return Array.isArray(parsed) ? parsed.filter((u: unknown) => typeof u === "string") : [];
    } catch {
      return [];
    }
  }, [params.uris]);

  const [uris, setUris] = useState<string[]>(initialUris);
  const [title, setTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isPicking, setIsPicking] = useState(false);

  const defaultTitle = fileType === "pdf" ? "Images_PDF" : "Images_Document";

  const handleRemoveImage = useCallback((index: number) => {
    setUris((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleMoveUp = useCallback((index: number) => {
    if (index === 0) return;
    setUris((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setUris((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  const handleAddFromGallery = useCallback(async () => {
    setIsPicking(true);
    try {
      const result = await pickImagesFromLibrary();
      if (result.success && result.uris) {
        setUris((prev) => [...prev, ...result.uris!]);
      } else if (result.error) {
        Alert.alert("Error", result.error);
      }
    } finally {
      setIsPicking(false);
    }
  }, []);

  const handleAddFromCamera = useCallback(async () => {
    setIsPicking(true);
    try {
      const result = await pickImageFromCamera();
      if (result.success && result.uris) {
        setUris((prev) => [...prev, ...result.uris!]);
      } else if (result.error) {
        Alert.alert("Error", result.error);
      }
    } finally {
      setIsPicking(false);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    if (uris.length === 0) {
      Alert.alert("No Images", "Please add at least one image before creating the file.");
      return;
    }

    setIsCreating(true);
    try {
      const effectiveTitle = title.trim() || defaultTitle;
      const result =
        fileType === "pdf"
          ? await createPdfFromImageUris(uris, effectiveTitle)
          : await createDocxFromImageUris(uris, effectiveTitle);

      if (result.success && result.uri) {
        const fileName = result.fileName || `${effectiveTitle}.${fileType}`;
        await markFileAsCreated(result.uri, fileName, fileType);

        Alert.alert("File Created", "Your file was created successfully.", [
          {
            text: "Save",
            onPress: async () => {
              await saveFile(fileType, result.uri!, result.fileName);
              router.back();
              router.back();
            },
          },
          {
            text: "Share",
            onPress: async () => {
              await shareCreatedFile(fileType, result.uri!, result.fileName);
              router.back();
              router.back();
            },
          },
          {
            text: "Done",
            style: "cancel",
            onPress: () => {
              router.back();
              router.back();
            },
          },
        ]);
      } else if (result.error) {
        Alert.alert("Error", result.error);
      }
    } catch (error) {
      Alert.alert(
        "Error",
        `Failed to create file: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsCreating(false);
    }
  }, [uris, title, fileType, defaultTitle, router]);

  const headerTitle = fileType === "pdf" ? "New PDF from Images" : "New Word from Images";

  return (
    <SafeAreaView edges={["top"]} style={[styles.screen, { backgroundColor: t.background }]}>
      <KeyboardAvoidingView
        style={styles.flex1}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* ── Header ── */}
        <View
          style={[
            styles.header,
            { backgroundColor: t.card, borderBottomColor: t.border },
          ]}
        >
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={styles.headerBtn}
          >
            <ChevronLeft color={t.primary} size={26} strokeWidth={2.2} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: t.text }]} numberOfLines={1}>
            {headerTitle}
          </Text>
          <Pressable
            onPress={handleCreate}
            disabled={isCreating || uris.length === 0}
            style={[
              styles.createBtn,
              { backgroundColor: t.primary },
              (isCreating || uris.length === 0) && styles.createBtnDisabled,
            ]}
          >
            {isCreating ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.createBtnText}>Create</Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          style={styles.flex1}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Title input ── */}
          <View style={[styles.titleCard, { backgroundColor: t.card, borderColor: t.borderLight }]}>
            <Text style={[styles.label, { color: t.textSecondary }]}>File title</Text>
            <TextInput
              style={[styles.titleInput, { color: t.text, borderBottomColor: t.border }]}
              placeholder={defaultTitle}
              placeholderTextColor={t.textTertiary}
              value={title}
              onChangeText={setTitle}
              returnKeyType="done"
              maxLength={120}
            />
            <Text style={[styles.helper, { color: t.textTertiary }]}>
              {uris.length} {uris.length === 1 ? "image" : "images"} · exported as {fileType.toUpperCase()}
            </Text>
          </View>

          {/* ── Add actions ── */}
          <View style={styles.addRow}>
            <Pressable
              onPress={handleAddFromGallery}
              disabled={isPicking || isCreating}
              style={[styles.addBtn, { backgroundColor: t.card, borderColor: t.borderLight }]}
            >
              <Images color={t.primary} size={20} strokeWidth={2.2} />
              <Text style={[styles.addBtnLabel, { color: t.text }]}>Add from Gallery</Text>
            </Pressable>
            <Pressable
              onPress={handleAddFromCamera}
              disabled={isPicking || isCreating}
              style={[styles.addBtn, { backgroundColor: t.card, borderColor: t.borderLight }]}
            >
              <Camera color={t.primary} size={20} strokeWidth={2.2} />
              <Text style={[styles.addBtnLabel, { color: t.text }]}>Capture Photo</Text>
            </Pressable>
          </View>

          {/* ── Image list ── */}
          {uris.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: t.card, borderColor: t.borderLight }]}>
              <Text style={[styles.emptyTitle, { color: t.text }]}>No images yet</Text>
              <Text style={[styles.emptyBody, { color: t.textSecondary }]}>
                Add images from your gallery or take a new photo to get started.
              </Text>
            </View>
          ) : (
            uris.map((uri, index) => (
              <View
                key={`${uri}-${index}`}
                style={[styles.imageCard, { backgroundColor: t.card, borderColor: t.borderLight }]}
              >
                <View style={styles.imageIndexPill}>
                  <Text style={styles.imageIndexText}>{index + 1}</Text>
                </View>
                <Image
                  source={{ uri }}
                  style={styles.imagePreview}
                  contentFit="contain"
                  transition={100}
                />
                <View style={[styles.imageActions, { borderTopColor: t.borderLight }]}>
                  <Pressable
                    onPress={() => handleMoveUp(index)}
                    disabled={index === 0}
                    style={[styles.actionBtn, index === 0 && styles.actionBtnDisabled]}
                    hitSlop={6}
                  >
                    <ArrowUp
                      color={index === 0 ? t.textTertiary : t.text}
                      size={18}
                      strokeWidth={2.2}
                    />
                    <Text
                      style={[
                        styles.actionLabel,
                        { color: index === 0 ? t.textTertiary : t.text },
                      ]}
                    >
                      Up
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleMoveDown(index)}
                    disabled={index === uris.length - 1}
                    style={[
                      styles.actionBtn,
                      index === uris.length - 1 && styles.actionBtnDisabled,
                    ]}
                    hitSlop={6}
                  >
                    <ArrowDown
                      color={index === uris.length - 1 ? t.textTertiary : t.text}
                      size={18}
                      strokeWidth={2.2}
                    />
                    <Text
                      style={[
                        styles.actionLabel,
                        {
                          color:
                            index === uris.length - 1 ? t.textTertiary : t.text,
                        },
                      ]}
                    >
                      Down
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleRemoveImage(index)}
                    style={styles.actionBtn}
                    hitSlop={6}
                  >
                    <Trash2 color={t.error} size={18} strokeWidth={2.2} />
                    <Text style={[styles.actionLabel, { color: t.error }]}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </ScrollView>

        {(isCreating || isPicking) && (
          <View style={styles.overlay}>
            <View style={[styles.overlayCard, { backgroundColor: t.card }]}>
              <ActivityIndicator size="large" color={t.primary} />
              <Text style={[styles.overlayText, { color: t.text }]}>
                {isCreating ? "Creating file..." : "Loading images..."}
              </Text>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex1: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  createBtn: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 10,
    minWidth: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  createBtnDisabled: { opacity: 0.5 },
  createBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  scrollContent: { padding: 16, gap: 16 },

  titleCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  titleInput: {
    fontSize: 17,
    fontWeight: "600",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  helper: { fontSize: 12, marginTop: 10, fontWeight: "500" },

  addRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  addBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 12,
    gap: 8,
  },
  addBtnLabel: { fontSize: 14, fontWeight: "600" },

  emptyCard: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 14,
    padding: 24,
    alignItems: "center",
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", marginBottom: 4 },
  emptyBody: { fontSize: 13, textAlign: "center", lineHeight: 18 },

  imageCard: {
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 12,
    overflow: "hidden",
  },
  imageIndexPill: {
    position: "absolute",
    top: 10,
    left: 10,
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    zIndex: 2,
  },
  imageIndexText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  imagePreview: {
    width: "100%",
    aspectRatio: 4 / 3,
    backgroundColor: "#000",
  },
  imageActions: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 6,
  },
  actionBtnDisabled: { opacity: 0.45 },
  actionLabel: { fontSize: 13, fontWeight: "600" },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,23,42,0.5)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  overlayCard: {
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    minWidth: 200,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  overlayText: {
    marginTop: 16,
    fontSize: 15,
    fontWeight: "600",
  },
});

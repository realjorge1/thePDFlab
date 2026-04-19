import { AppHeaderContainer } from "@/components/AppHeaderContainer";
import { GradientView } from "@/components/GradientView";
import { colors } from "@/constants/theme";
import {
  createDocxFromCamera,
  createDocxFromImages,
  createPdfFromCamera,
  createPdfFromImages,
  FileType,
  saveFile,
  shareFile as shareCreatedFile,
} from "@/services/fileCreationService";
import { markFileAsCreated } from "@/services/fileService";
import { useTheme } from "@/services/ThemeProvider";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  Camera,
  ChevronLeft,
  File,
  FileText,
  Images,
  Layers,
  MonitorPlay,
  ScanLine,
  Sheet as SheetIcon,
} from "lucide-react-native";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

// ─── Types ──────────────────────────────────────────────────────────────────
interface CreationOption {
  id: string;
  title: string;
  subtitle: string;
  icon: typeof File;
  iconColor: string;
  bgColor: string;
  accentColor: string;
  fileType: FileType | null;
  method: "blank" | "image" | "camera" | "merge";
}

// ─── Creation Options Data ──────────────────────────────────────────────────
const CREATION_OPTIONS: CreationOption[] = [
  {
    id: "blank-pdf",
    title: "Blank PDF",
    subtitle: "Start with an empty PDF",
    icon: File,
    iconColor: colors.pdf,
    bgColor: "#FEE2E2",
    accentColor: colors.pdf,
    fileType: "pdf",
    method: "blank",
  },
  {
    id: "blank-docx",
    title: "Blank Document",
    subtitle: "Start with an empty Word doc",
    icon: FileText,
    iconColor: colors.word,
    bgColor: "#DBEAFE",
    accentColor: colors.word,
    fileType: "docx",
    method: "blank",
  },
  {
    id: "pdf-from-images",
    title: "PDF from Images",
    subtitle: "Pick photos from gallery",
    icon: Images,
    iconColor: colors.secondary,
    bgColor: "#EDE9FE",
    accentColor: colors.secondary,
    fileType: "pdf",
    method: "image",
  },
  {
    id: "docx-from-images",
    title: "Word from Images",
    subtitle: "Pick photos from gallery",
    icon: Images,
    iconColor: colors.word,
    bgColor: "#DBEAFE",
    accentColor: colors.word,
    fileType: "docx",
    method: "image",
  },
  {
    id: "scan-to-pdf",
    title: "Scan to PDF",
    subtitle: "Use camera to capture pages",
    icon: ScanLine,
    iconColor: "#EC4899",
    bgColor: "#FCE7F3",
    accentColor: "#EC4899",
    fileType: "pdf",
    method: "camera",
  },
  {
    id: "scan-to-docx",
    title: "Scan to Word",
    subtitle: "Capture and save as Word",
    icon: Camera,
    iconColor: colors.accent,
    bgColor: "#CFFAFE",
    accentColor: colors.accent,
    fileType: "docx",
    method: "camera",
  },
  {
    id: "blank-ppt",
    title: "Presentation",
    subtitle: "Create a .pptx slideshow",
    icon: MonitorPlay,
    iconColor: "#D24726",
    bgColor: "#FEF3EE",
    accentColor: "#D24726",
    fileType: null,
    method: "blank",
  },
  {
    id: "blank-xlsx",
    title: "Spreadsheet",
    subtitle: "Create an .xlsx workbook",
    icon: SheetIcon,
    iconColor: "#107C41",
    bgColor: "#E6F4EA",
    accentColor: "#107C41",
    fileType: null,
    method: "blank",
  },
  {
    id: "merge-files",
    title: "Merge Files",
    subtitle: "Combine multiple PDFs",
    icon: Layers,
    iconColor: colors.success,
    bgColor: "#D1FAE5",
    accentColor: colors.success,
    fileType: null,
    method: "merge",
  },
];

// ─── Section grouping ───────────────────────────────────────────────────────
interface Section {
  title: string;
  items: CreationOption[];
}

const SECTIONS: Section[] = [
  {
    title: "New Document",
    items: CREATION_OPTIONS.filter((o) => o.method === "blank"),
  },
  {
    title: "From Images",
    items: CREATION_OPTIONS.filter((o) => o.method === "image"),
  },
  {
    title: "From Camera",
    items: CREATION_OPTIONS.filter((o) => o.method === "camera"),
  },
  {
    title: "Quick Actions",
    items: CREATION_OPTIONS.filter((o) => o.method === "merge"),
  },
];

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const GRID_PADDING = 20;
const GRID_GAP = 12;
const CARD_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP) / 2;

// ─── Memoized Card Component ────────────────────────────────────────────────
interface CardProps {
  option: CreationOption;
  onPress: (option: CreationOption) => void;
  theme: any;
  isProcessing: boolean;
}

const CreationCard = React.memo(function CreationCard({
  option,
  onPress,
  theme,
  isProcessing,
}: CardProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
      tension: 300,
      friction: 10,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 300,
      friction: 10,
    }).start();
  }, [scaleAnim]);

  const handlePress = useCallback(() => {
    if (!isProcessing) onPress(option);
  }, [option, onPress, isProcessing]);

  const { icon: Icon, iconColor, bgColor, title, subtitle, accentColor } =
    option;

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={isProcessing}
        android_ripple={{ color: accentColor + "20", borderless: false }}
        style={[
          styles.card,
          {
            backgroundColor: theme.card,
            borderColor: theme.borderLight,
          },
        ]}
      >
        <View style={[styles.cardIconBox, { backgroundColor: bgColor }]}>
          <Icon color={iconColor} size={26} strokeWidth={2} />
        </View>
        <Text
          style={[styles.cardTitle, { color: theme.text }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Text
          style={[styles.cardSubtitle, { color: theme.textSecondary }]}
          numberOfLines={2}
        >
          {subtitle}
        </Text>
      </Pressable>
    </Animated.View>
  );
});

// ─── Bottom Quick Action ────────────────────────────────────────────────────
interface QuickActionProps {
  icon: typeof File;
  label: string;
  onPress: () => void;
  color: string;
}

const QuickAction = React.memo(function QuickAction({
  icon: Icon,
  label,
  onPress,
  color,
}: QuickActionProps) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: color + "20", borderless: true }}
      style={styles.quickAction}
    >
      <View style={[styles.quickActionIcon, { backgroundColor: color + "15" }]}>
        <Icon color={color} size={20} strokeWidth={2.2} />
      </View>
      <Text style={[styles.quickActionLabel, { color }]}>{label}</Text>
    </Pressable>
  );
});

// ─── Main Screen ────────────────────────────────────────────────────────────
export default function CreateFileScreen() {
  const router = useRouter();
  const { colors: t } = useTheme();
  const insets = useSafeAreaInsets();
  const [isProcessing, setIsProcessing] = useState(false);

  // Bottom bar height: bar content + safe area
  const bottomBarHeight = 72 + Math.max(insets.bottom, Platform.OS === "ios" ? 20 : 8);

  const handleCreation = useCallback(
    async (option: CreationOption) => {
      // Blank documents → navigate to editor immediately
      if (option.id === "blank-ppt") {
        router.push("/ppt-studio" as any);
        return;
      }
      if (option.id === "blank-xlsx") {
        router.push("/xlsx-viewer" as any);
        return;
      }
      if (option.method === "blank" && option.fileType === "pdf") {
        router.push("/create-blank-pdf");
        return;
      }
      if (option.method === "blank" && option.fileType === "docx") {
        router.push("/create-blank-docx");
        return;
      }

      // Merge → navigate to tool processor
      if (option.method === "merge") {
        router.push({
          pathname: "/tool-processor",
          params: { tool: "merge" },
        });
        return;
      }

      // Image/camera creation → async process
      setIsProcessing(true);
      try {
        let result;
        if (option.fileType === "pdf" && option.method === "image") {
          result = await createPdfFromImages();
        } else if (option.fileType === "pdf" && option.method === "camera") {
          result = await createPdfFromCamera();
        } else if (option.fileType === "docx" && option.method === "image") {
          result = await createDocxFromImages();
        } else if (option.fileType === "docx" && option.method === "camera") {
          result = await createDocxFromCamera();
        }

        if (result?.success && result.uri) {
          Alert.alert("Success", "File created successfully!", [
            {
              text: "Save",
              onPress: async () => {
                await saveFile(option.fileType!, result.uri!, result.fileName);
                await markFileAsCreated(
                  result.uri!,
                  result.fileName || `Document_${Date.now()}`,
                  option.fileType!,
                );
                router.back();
              },
            },
            {
              text: "Share",
              onPress: async () => {
                await shareCreatedFile(
                  option.fileType!,
                  result.uri!,
                  result.fileName,
                );
                await markFileAsCreated(
                  result.uri!,
                  result.fileName || `Document_${Date.now()}`,
                  option.fileType!,
                );
                router.back();
              },
            },
            { text: "Close", style: "cancel" },
          ]);
        } else if (result?.error) {
          Alert.alert("Error", result.error);
        }
      } catch (error) {
        Alert.alert(
          "Error",
          `Failed to create file: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setIsProcessing(false);
      }
    },
    [router],
  );

  // Quick actions for bottom bar
  const quickActions = useMemo(
    () => [
      {
        icon: ScanLine,
        label: "Scan",
        color: "#EC4899",
        onPress: () =>
          handleCreation(CREATION_OPTIONS.find((o) => o.id === "scan-to-pdf")!),
      },
      {
        icon: Images,
        label: "Import",
        color: colors.secondary,
        onPress: () =>
          handleCreation(
            CREATION_OPTIONS.find((o) => o.id === "pdf-from-images")!,
          ),
      },
      {
        icon: Layers,
        label: "Merge",
        color: colors.success,
        onPress: () =>
          handleCreation(
            CREATION_OPTIONS.find((o) => o.id === "merge-files")!,
          ),
      },
    ],
    [handleCreation],
  );

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: t.background }]}>
      {/* ── Header ── */}
      <AppHeaderContainer>
        <GradientView
          colors={[colors.gradientStart, colors.gradientMid, colors.gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <Pressable
            onPress={() => router.back()}
            android_ripple={{ color: "rgba(255,255,255,0.2)", borderless: true }}
            hitSlop={12}
            style={styles.backButton}
          >
            <ChevronLeft color="#FFFFFF" size={26} strokeWidth={2.2} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: "#FFFFFF" }]}>Create File</Text>
          <View style={styles.headerSpacer} />
        </GradientView>
      </AppHeaderContainer>

      {/* ── Content ── */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: bottomBarHeight + 16 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>
              {section.title}
            </Text>
            <View style={styles.grid}>
              {section.items.map((option) => (
                <View key={option.id} style={styles.gridItem}>
                  <CreationCard
                    option={option}
                    onPress={handleCreation}
                    theme={t}
                    isProcessing={isProcessing}
                  />
                </View>
              ))}
              {/* If odd number, add spacer to keep grid aligned */}
              {section.items.length % 2 !== 0 && (
                <View style={styles.gridItem} />
              )}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* ── Fixed Bottom Bar ── */}
      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: t.card,
            borderTopColor: t.borderLight,
            paddingBottom: Math.max(
              insets.bottom,
              Platform.OS === "ios" ? 20 : 8,
            ),
          },
        ]}
      >
        <View style={styles.bottomBarContent}>
          {quickActions.map((action) => (
            <QuickAction
              key={action.label}
              icon={action.icon}
              label={action.label}
              onPress={action.onPress}
              color={action.color}
            />
          ))}
        </View>
      </View>

      {/* ── Processing Overlay ── */}
      {isProcessing && (
        <View style={styles.overlay}>
          <View style={[styles.overlayCard, { backgroundColor: t.card }]}>
            <ActivityIndicator size="large" color={t.primary} />
            <Text style={[styles.overlayText, { color: t.text }]}>
              Creating file...
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
    textAlign: "center",
    marginRight: 40, // balance the back button width
  },
  headerSpacer: {
    width: 0,
  },

  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: GRID_PADDING,
    paddingTop: 20,
  },

  // Sections
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginBottom: 12,
  },

  // Grid
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
  },
  gridItem: {
    width: CARD_WIDTH,
  },

  // Card
  card: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardIconBox: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
  },

  // Bottom Bar — layout-isolated, always fixed
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 10,
  },
  bottomBarContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingTop: 10,
    paddingHorizontal: 16,
  },

  // Quick Action
  quickAction: {
    alignItems: "center",
    gap: 4,
    minWidth: 64,
  },
  quickActionIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  quickActionLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.1,
  },

  // Processing overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,23,42,0.5)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  overlayCard: {
    borderRadius: 24,
    padding: 36,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  overlayText: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: "700",
  },
});

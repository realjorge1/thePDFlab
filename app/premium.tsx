/**
 * Premium Screen — Go Pro
 *
 * Fully integrated premium paywall screen from design system.
 * Displays pricing plans, features, and CTA button.
 * NO functional wiring: all buttons provide UI feedback only.
 */
import { AppHeaderContainer } from "@/components/AppHeaderContainer";
import { GradientView } from "@/components/GradientView";
import { colors } from "@/constants/theme";
import { useTheme } from "@/services/ThemeProvider";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  BarChart3,
  FileText,
  Lock,
  MessageSquare,
  Package,
  PenSquare,
  Search,
  Zap,
} from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
// TODO: configure RevenueCat API key before re-enabling
// import Purchases from "react-native-purchases";
import { SafeAreaView } from "react-native-safe-area-context";

// Pricing — single source of truth
const MONTHLY_PRICE = 4.99;
const ANNUAL_PRICE = 46.89;
const ANNUAL_IF_MONTHLY = parseFloat((MONTHLY_PRICE * 12).toFixed(2)); // 59.88
const ANNUAL_SAVINGS = parseFloat(
  (ANNUAL_IF_MONTHLY - ANNUAL_PRICE).toFixed(2),
); // 13.89
const ANNUAL_MONTHLY_EQUIV = parseFloat((ANNUAL_PRICE / 12).toFixed(2)); // 3.83

// Curated top features — most compelling shown upfront
const TOP_AI_FEATURES = [
  {
    label: "Chat with Documents",
    icon: MessageSquare,
    detail: "Ask anything, get instant answers",
  },
  {
    label: "Summarize & Translate",
    icon: FileText,
    detail: "Any language, any length",
  },
  { label: "Generate Documents", icon: Zap, detail: "AI-drafted in seconds" },
  {
    label: "Analyze & Explain",
    icon: BarChart3,
    detail: "Deep insights on any file",
  },
];

const TOP_TOOL_FEATURES = [
  {
    label: "Sign Documents",
    icon: PenSquare,
    detail: "Legally binding e-signatures",
  },
  {
    label: "File Security & Lock",
    icon: Lock,
    detail: "Password-protect anything",
  },
  {
    label: "Edit & Annotate",
    icon: PenSquare,
    detail: "Mark up PDFs with precision",
  },
  {
    label: "Research Files",
    icon: Search,
    detail: "Smart search across all your docs",
  },
];

export default function PremiumScreen() {
  const router = useRouter();
  const { colors: themeColors, mode } = useTheme();
  const [selectedPlan, setSelectedPlan] = useState<"yearly" | "monthly">(
    "yearly",
  );
  const [isLoading, setIsLoading] = useState(false);

  const isDark = mode === "dark";

  const handleUpgradePress = async () => {
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 800);
  };

  return (
    <SafeAreaView
      style={[
        styles.safe,
        { backgroundColor: themeColors.backgroundSecondary },
      ]}
    >
      <AppHeaderContainer>
        <View style={styles.headerContainer}>
          <GradientView
            colors={[
              colors.gradientStart,
              colors.gradientMid,
              colors.gradientEnd,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.header}
          >
            <View style={styles.headerTop}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => router.back()}
              >
                <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
              </TouchableOpacity>
              <View style={styles.headerTitleContainer}>
                <Text style={styles.headerTitle}>Premium</Text>
              </View>
              <TouchableOpacity
                style={styles.navRestore}
                activeOpacity={0.7}
                onPress={() => {}}
              >
                <Text style={styles.navRestoreText}>Restore</Text>
              </TouchableOpacity>
            </View>
          </GradientView>
        </View>
      </AppHeaderContainer>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ── */}
        <View style={styles.hero}>
          {/* PRO MEMBERSHIP badge — gold bullet */}
          <View
            style={[
              styles.proBadge,
              {
                backgroundColor: themeColors.primary + "18",
                borderColor: themeColors.primary + "40",
              },
            ]}
          >
            <View style={styles.goldDot} />
            <Text style={[styles.proBadgeText, { color: themeColors.primary }]}>
              PRO MEMBERSHIP
            </Text>
          </View>

          <Text style={[styles.heroTitle, { color: themeColors.text }]}>
            Work smarter,{"\n"}
            <Text style={{ color: themeColors.primary }}>do more.</Text>
          </Text>
          <Text style={[styles.heroSub, { color: themeColors.textSecondary }]}>
            Everything you need to work smarter — AI, tools, research & explore
            and security in one place.
          </Text>
        </View>

        {/* ── Plans ── */}
        <View style={styles.plansContainer}>
          {/* Annual */}
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => setSelectedPlan("yearly")}
            style={[
              styles.planCard,
              {
                backgroundColor: themeColors.card,
                borderColor:
                  selectedPlan === "yearly"
                    ? themeColors.primary
                    : themeColors.border,
                borderWidth: selectedPlan === "yearly" ? 2 : 1,
              },
            ]}
          >
            <View
              style={[
                styles.popularRibbon,
                { backgroundColor: themeColors.primary },
              ]}
            >
              <Text style={styles.popularRibbonText}>BEST VALUE</Text>
            </View>

            <View style={styles.planHead}>
              <View style={styles.planHeadLeft}>
                <View
                  style={[
                    styles.radio,
                    {
                      borderColor:
                        selectedPlan === "yearly"
                          ? themeColors.primary
                          : themeColors.border,
                      backgroundColor:
                        selectedPlan === "yearly"
                          ? themeColors.primary
                          : "transparent",
                    },
                  ]}
                >
                  {selectedPlan === "yearly" && (
                    <View style={styles.radioInner} />
                  )}
                </View>
                <View>
                  <Text style={[styles.planName, { color: themeColors.text }]}>
                    Annual Plan
                  </Text>
                  <Text
                    style={[
                      styles.planSub,
                      { color: themeColors.textSecondary },
                    ]}
                  >
                    Billed once a year
                  </Text>
                </View>
              </View>

              <View style={styles.planPriceBlock}>
                <Text style={[styles.planPrice, { color: themeColors.text }]}>
                  ${ANNUAL_PRICE.toFixed(2)}
                  <Text
                    style={[
                      styles.planPeriod,
                      { color: themeColors.textSecondary },
                    ]}
                  >
                    {" "}
                    /yr
                  </Text>
                </Text>
                <Text
                  style={[
                    styles.planOriginal,
                    { color: themeColors.textTertiary },
                  ]}
                >
                  ${ANNUAL_IF_MONTHLY.toFixed(2)} if monthly
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.planDivider,
                { backgroundColor: themeColors.border },
              ]}
            />

            <View style={styles.planFooter}>
              <View
                style={[styles.savePill, { backgroundColor: "#F5C842" + "22" }]}
              >
                <Text style={styles.savePillText}>
                  💰 You save ${ANNUAL_SAVINGS.toFixed(2)}/yr
                </Text>
              </View>
              <Text
                style={[
                  styles.planMonthly,
                  { color: themeColors.textSecondary },
                ]}
              >
                ~${ANNUAL_MONTHLY_EQUIV.toFixed(2)} / mo
              </Text>
            </View>
          </TouchableOpacity>

          {/* Monthly */}
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => setSelectedPlan("monthly")}
            style={[
              styles.planCard,
              {
                backgroundColor: themeColors.card,
                borderColor:
                  selectedPlan === "monthly"
                    ? themeColors.primary
                    : themeColors.border,
                borderWidth: selectedPlan === "monthly" ? 2 : 1,
              },
            ]}
          >
            <View style={styles.planHead}>
              <View style={styles.planHeadLeft}>
                <View
                  style={[
                    styles.radio,
                    {
                      borderColor:
                        selectedPlan === "monthly"
                          ? themeColors.primary
                          : themeColors.border,
                      backgroundColor:
                        selectedPlan === "monthly"
                          ? themeColors.primary
                          : "transparent",
                    },
                  ]}
                >
                  {selectedPlan === "monthly" && (
                    <View style={styles.radioInner} />
                  )}
                </View>
                <View>
                  <Text style={[styles.planName, { color: themeColors.text }]}>
                    Monthly Plan
                  </Text>
                  <Text
                    style={[
                      styles.planSub,
                      { color: themeColors.textSecondary },
                    ]}
                  >
                    Flexible · Cancel anytime
                  </Text>
                </View>
              </View>

              <View style={styles.planPriceBlock}>
                <Text style={[styles.planPrice, { color: themeColors.text }]}>
                  ${MONTHLY_PRICE.toFixed(2)}
                  <Text
                    style={[
                      styles.planPeriod,
                      { color: themeColors.textSecondary },
                    ]}
                  >
                    {" "}
                    /mo
                  </Text>
                </Text>
                <Text
                  style={[
                    styles.planOriginal,
                    { color: themeColors.textTertiary },
                  ]}
                >
                  ${ANNUAL_IF_MONTHLY.toFixed(2)} / yr
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>

        {/* ── Features ── */}
        <View style={styles.featuresSection}>
          <Text
            style={[styles.sectionLabel, { color: themeColors.textTertiary }]}
          >
            WHAT YOU GET
          </Text>

          {/* AI Features */}
          <View
            style={[
              styles.featCard,
              {
                backgroundColor: themeColors.card,
                borderColor: themeColors.border,
              },
            ]}
          >
            <View style={styles.featCardHeader}>
              <View
                style={[
                  styles.featCardIconWrap,
                  { backgroundColor: themeColors.primary + "18" },
                ]}
              >
                <Zap size={14} color={themeColors.primary} />
              </View>
              <Text style={[styles.featCardTitle, { color: themeColors.text }]}>
                AI Features
              </Text>
            </View>

            {TOP_AI_FEATURES.map((feat, idx) => (
              <View key={idx}>
                {idx > 0 && (
                  <View
                    style={[
                      styles.featDivider,
                      { backgroundColor: themeColors.border },
                    ]}
                  />
                )}
                <View style={styles.featRow}>
                  <View
                    style={[
                      styles.featIconWrap,
                      { backgroundColor: themeColors.primary + "12" },
                    ]}
                  >
                    <feat.icon size={15} color={themeColors.primary} />
                  </View>
                  <View style={styles.featText}>
                    <Text
                      style={[styles.featName, { color: themeColors.text }]}
                    >
                      {feat.label}
                    </Text>
                    <Text
                      style={[
                        styles.featDetail,
                        { color: themeColors.textSecondary },
                      ]}
                    >
                      {feat.detail}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.checkDot,
                      { backgroundColor: "#22C55E" + "20" },
                    ]}
                  >
                    <View
                      style={[
                        styles.checkDotInner,
                        { backgroundColor: "#22C55E" },
                      ]}
                    />
                  </View>
                </View>
              </View>
            ))}
          </View>

          {/* Productivity Tools */}
          <View
            style={[
              styles.featCard,
              {
                backgroundColor: themeColors.card,
                borderColor: themeColors.border,
                marginTop: 14,
              },
            ]}
          >
            <View style={styles.featCardHeader}>
              <View
                style={[
                  styles.featCardIconWrap,
                  { backgroundColor: themeColors.primary + "18" },
                ]}
              >
                <FileText size={14} color={themeColors.primary} />
              </View>
              <Text style={[styles.featCardTitle, { color: themeColors.text }]}>
                Productivity Tools
              </Text>
            </View>

            {TOP_TOOL_FEATURES.map((feat, idx) => (
              <View key={idx}>
                {idx > 0 && (
                  <View
                    style={[
                      styles.featDivider,
                      { backgroundColor: themeColors.border },
                    ]}
                  />
                )}
                <View style={styles.featRow}>
                  <View
                    style={[
                      styles.featIconWrap,
                      { backgroundColor: themeColors.primary + "12" },
                    ]}
                  >
                    <feat.icon size={15} color={themeColors.primary} />
                  </View>
                  <View style={styles.featText}>
                    <Text
                      style={[styles.featName, { color: themeColors.text }]}
                    >
                      {feat.label}
                    </Text>
                    <Text
                      style={[
                        styles.featDetail,
                        { color: themeColors.textSecondary },
                      ]}
                    >
                      {feat.detail}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.checkDot,
                      { backgroundColor: "#22C55E" + "20" },
                    ]}
                  >
                    <View
                      style={[
                        styles.checkDotInner,
                        { backgroundColor: "#22C55E" },
                      ]}
                    />
                  </View>
                </View>
              </View>
            ))}
          </View>

          {/* ── And More card ── */}
          <View
            style={[
              styles.andMoreCard,
              {
                backgroundColor: themeColors.primary + "08",
                borderColor: themeColors.primary + "30",
              },
            ]}
          >
            <View style={styles.andMoreHeader}>
              <View
                style={[
                  styles.featCardIconWrap,
                  { backgroundColor: themeColors.primary + "18" },
                ]}
              >
                <Package size={14} color={themeColors.primary} />
              </View>
              <View style={styles.andMoreHeaderText}>
                <Text
                  style={[styles.featCardTitle, { color: themeColors.text }]}
                >
                  And so much more
                </Text>
                <Text
                  style={[
                    styles.andMoreSub,
                    { color: themeColors.textSecondary },
                  ]}
                >
                  Exclusive features unlocked with Pro
                </Text>
              </View>
            </View>

            <View style={styles.andMorePillsWrap}></View>
          </View>
        </View>

        {/* Spacing for sticky CTA */}
        <View style={{ height: 150 }} />
      </ScrollView>

      {/* ── Sticky CTA ── */}
      <View
        style={[
          styles.ctaWrap,
          {
            backgroundColor: isDark
              ? themeColors.backgroundSecondary + "F2"
              : themeColors.background + "F2",
            borderTopColor: themeColors.border,
          },
        ]}
      >
        <TouchableOpacity
          activeOpacity={0.82}
          onPress={handleUpgradePress}
          disabled={isLoading}
          style={[
            styles.ctaBtn,
            {
              backgroundColor: themeColors.primary,
              opacity: isLoading ? 0.65 : 1,
            },
          ]}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <View style={styles.ctaBtnInner}>
              <Text style={styles.ctaBtnText}>
                {selectedPlan === "yearly"
                  ? "Start Annual Plan"
                  : "Start Monthly Plan"}
              </Text>
              <Text style={styles.ctaBtnSub}>
                {selectedPlan === "yearly"
                  ? `$${ANNUAL_PRICE.toFixed(2)} / year  ·  Save $${ANNUAL_SAVINGS.toFixed(2)}`
                  : `$${MONTHLY_PRICE.toFixed(2)} / month`}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.ctaMeta}>
          <Text
            style={[styles.ctaMetaText, { color: themeColors.textTertiary }]}
          >
            🔒 Secure payment
          </Text>
          <Text
            style={[styles.ctaMetaDot, { color: themeColors.textTertiary }]}
          >
            ·
          </Text>
          <Text
            style={[styles.ctaMetaText, { color: themeColors.textTertiary }]}
          >
            Cancel anytime
          </Text>
          <Text
            style={[styles.ctaMetaDot, { color: themeColors.textTertiary }]}
          >
            ·
          </Text>
          <Text
            style={[styles.ctaMetaText, { color: themeColors.textTertiary }]}
          >
            No hidden fees
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  /* Header */
  headerContainer: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? 20 : 16,
    paddingBottom: 16,
  },
  headerTop: { flexDirection: "row", alignItems: "center" },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 4,
  },
  headerTitleContainer: { flex: 1 },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFF",
    letterSpacing: -0.3,
  },
  navRestore: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  navRestoreText: { fontSize: 13, fontWeight: "600", color: "#FFFFFF" },

  scrollContent: { paddingBottom: 20 },

  /* Hero */
  hero: { paddingHorizontal: 24, paddingTop: 24, marginBottom: 20 },
  proBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 100,
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 13,
    alignSelf: "flex-start",
    marginBottom: 16,
  },
  goldDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#D4A017",
  },
  proBadgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.08 },
  heroTitle: {
    fontSize: 34,
    fontWeight: "800",
    lineHeight: 42,
    letterSpacing: -0.5,
    marginBottom: 10,
  },
  heroSub: { fontSize: 14, lineHeight: 22, fontWeight: "400", maxWidth: "92%" },

  /* Plans */
  plansContainer: { paddingHorizontal: 16, gap: 10, marginBottom: 4 },
  planCard: { borderRadius: 18, padding: 18, overflow: "hidden" },
  popularRibbon: {
    position: "absolute",
    top: 0,
    right: 0,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderBottomLeftRadius: 14,
  },
  popularRibbonText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.8,
  },
  planHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  planHeadLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#fff" },
  planName: { fontSize: 15, fontWeight: "700" },
  planSub: { fontSize: 12, marginTop: 2 },
  planPriceBlock: { alignItems: "flex-end" },
  planPrice: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  planPeriod: { fontSize: 13, fontWeight: "400" },
  planOriginal: {
    fontSize: 11,
    textDecorationLine: "line-through",
    marginTop: 2,
  },
  planDivider: { height: StyleSheet.hairlineWidth, marginBottom: 12 },
  planFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  savePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  savePillText: { fontSize: 12, fontWeight: "700", color: "#b8860b" },
  planMonthly: { fontSize: 12 },

  /* Features section */
  featuresSection: { paddingHorizontal: 16, marginTop: 20 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.1,
    textTransform: "uppercase",
    marginBottom: 14,
  },

  featCard: { borderRadius: 20, borderWidth: 1.5, overflow: "hidden" },
  featCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
  },
  featCardIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  featCardTitle: { fontSize: 14, fontWeight: "700", letterSpacing: -0.1 },

  featDivider: { height: StyleSheet.hairlineWidth, marginLeft: 56 },
  featRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
  },
  featIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  featText: { flex: 1 },
  featName: { fontSize: 14, fontWeight: "600" },
  featDetail: { fontSize: 12, marginTop: 1 },
  checkDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  checkDotInner: { width: 9, height: 9, borderRadius: 5 },

  /* And More card */
  andMoreCard: {
    marginTop: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    overflow: "hidden",
    padding: 16,
  },
  andMoreHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  andMoreHeaderText: { flex: 1 },
  andMoreSub: { fontSize: 12, marginTop: 2 },
  andMorePillsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  andMorePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  andMorePillDot: { width: 6, height: 6, borderRadius: 3 },
  andMorePillText: { fontSize: 12, fontWeight: "500" },

  /* CTA */
  ctaWrap: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ctaBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaBtnInner: { alignItems: "center", gap: 3 },
  ctaBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  ctaBtnSub: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    fontWeight: "500",
  },
  ctaMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 10,
  },
  ctaMetaText: { fontSize: 11 },
  ctaMetaDot: { fontSize: 10 },
});

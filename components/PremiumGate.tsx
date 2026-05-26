/**
 * PremiumGate
 * Wraps screen content behind a premium subscription.
 *
 * - While subscription status is loading → shows a spinner.
 * - If the user has premium → renders children.
 * - Otherwise → renders the real screen blurred in the background with a
 *   frosted premium upsell card floating on top, so users get a teasing
 *   preview of what they're unlocking.
 *
 * Usage: <PremiumGate feature="AI Assistant">{...screen...}</PremiumGate>
 */
import { GradientView } from "@/components/GradientView";
import { colors as brandColors } from "@/constants/theme";
import { useSubscription } from "@/context/SubscriptionContext";
import { useTheme } from "@/services/ThemeProvider";
import { BlurView } from "expo-blur";
import { useRouter } from "expo-router";
import { ArrowLeft, Crown, Sparkles } from "lucide-react-native";
import React, { type ReactNode } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface PremiumGateProps {
  /** Display name of the gated feature, e.g. "AI Assistant" or "Downloads". */
  feature?: string;
  /** Optional one-line description shown under the title. */
  description?: string;
  children: ReactNode;
}

export function PremiumGate({
  feature = "This feature",
  description = "Unlock it with a Premium subscription.",
  children,
}: PremiumGateProps) {
  const { isPremium, isLoading } = useSubscription();
  const { colors: t, mode } = useTheme();
  const router = useRouter();

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: t.background }]}>
        <ActivityIndicator color={t.primary} size="large" />
      </View>
    );
  }

  if (isPremium) return <>{children}</>;

  const isDark = mode === "dark";

  return (
    <View style={[styles.root, { backgroundColor: t.background }]}>
      {/* Real screen rendered behind — non-interactive preview */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {children}
      </View>

      {/* Frosted blur over the preview */}
      <BlurView
        intensity={isDark ? 75 : 60}
        tint={isDark ? "dark" : "light"}
        style={StyleSheet.absoluteFill}
      />
      {/* Subtle scrim to lift the card off the blur for contrast */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: isDark
              ? "rgba(0,0,0,0.35)"
              : "rgba(255,255,255,0.25)",
          },
        ]}
      />

      {/* Gate UI floating on top */}
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={12}
          activeOpacity={0.7}
        >
          <ArrowLeft size={24} color={t.text} />
        </TouchableOpacity>

        <View style={styles.body}>
          <View
            style={[
              styles.card,
              {
                backgroundColor: t.card,
                borderColor: t.border,
              },
            ]}
          >
            <GradientView
              colors={[
                brandColors.gradientStart,
                brandColors.gradientMid,
                brandColors.gradientEnd,
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.iconBadge}
            >
              <Crown size={34} color="#FFFFFF" />
            </GradientView>

            <Text style={[styles.title, { color: t.text }]}>{feature}</Text>
            <Text style={[styles.subtitle, { color: t.textSecondary }]}>
              {description}
            </Text>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => router.push("/premium" as any)}
              style={styles.ctaWrap}
            >
              <GradientView
                colors={[
                  brandColors.gradientStart,
                  brandColors.gradientMid,
                  brandColors.gradientEnd,
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.cta}
              >
                <Sparkles size={18} color="#FFFFFF" />
                <Text style={styles.ctaText}>Unlock Premium</Text>
              </GradientView>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, backgroundColor: "transparent" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  backBtn: { padding: 16, alignSelf: "flex-start" },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingBottom: 80,
  },
  card: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: 28,
    paddingVertical: 36,
    borderRadius: 28,
    borderWidth: 1,
    // soft float
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  iconBadge: {
    width: 84,
    height: 84,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 10,
    maxWidth: "90%",
  },
  ctaWrap: { marginTop: 32, width: "100%" },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
  },
  ctaText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
});

import { AppHeaderContainer } from "@/components/AppHeaderContainer";
import { GradientView } from "@/components/GradientView";
import { KeypadProvider, QCKeypadBar } from "@/components/qc/QCKeypad";
import { QCLegalFooter } from "@/components/qc/QCLegalFooter";
import { colors as brandColors } from "@/constants/theme";
import { useTheme } from "@/services/ThemeProvider";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface QCScreenShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Hub screens don't need the number pad; tool screens do (default). */
  showKeypad?: boolean;
}

/**
 * Shared scaffold for the QC calculator screens: gradient header with back
 * button (matching the PDF Tools screens) over a scrollable body.
 */
export function QCScreenShell({
  title,
  subtitle,
  children,
  showKeypad = true,
}: QCScreenShellProps) {
  const router = useRouter();
  const { colors: t } = useTheme();

  return (
    <KeypadProvider>
    <SafeAreaView style={[styles.safe, { backgroundColor: t.settingsBg }]}>
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
            hitSlop={12}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.headerTitleArea}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <View style={styles.headerRight} />
        </GradientView>
      </AppHeaderContainer>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
        <QCLegalFooter />
      </ScrollView>

      {showKeypad ? <QCKeypadBar /> : null}
    </SafeAreaView>
    </KeypadProvider>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  headerTitleArea: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  headerSubtitle: {
    fontSize: 12,
    color: "rgba(255,255,255,0.85)",
    marginTop: 2,
  },
  headerRight: {
    width: 40,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 96,
  },
});

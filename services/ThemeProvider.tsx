/**
 * ThemeProvider
 *
 * Wraps the app and provides dynamic theme tokens based on the user's
 * chosen theme mode (system / light / dark). Reads from settingsService.
 */
import { colors as brandColors } from "@/constants/theme";
import { useNoir } from "@/services/NoirProvider";
import { useSettings } from "@/services/settingsService";
import { StatusBar } from "expo-status-bar";
import React, { createContext, useContext, useMemo } from "react";
import { useColorScheme as useSystemColorScheme } from "react-native";

// ─── Theme tokens ─────────────────────────────────────────────────────────────

export interface ThemeTokens {
  mode: "light" | "dark";
  colors: {
    // Core
    primary: string;
    primaryDark: string;
    primaryLight: string;
    secondary: string;
    accent: string;

    // Surfaces
    background: string;
    backgroundSecondary: string;
    card: string;
    surface: string;

    // Text
    text: string;
    textSecondary: string;
    textTertiary: string;
    textInverse: string;

    // Borders
    border: string;
    borderLight: string;

    // Status
    success: string;
    error: string;
    warning: string;
    info: string;

    // Tab / Nav
    tabBar: string;
    tabBarBorder: string;
    tabActive: string;
    tabInactive: string;

    // Settings-specific
    settingsBg: string;
    sectionHeader: string;
    rowBg: string;
    separator: string;
    comingSoonBadge: string;
    comingSoonText: string;
  };
}

const lightTheme: ThemeTokens = {
  mode: "light",
  colors: {
    primary: brandColors.primary,
    primaryDark: brandColors.primaryDark,
    primaryLight: brandColors.primaryLight,
    secondary: brandColors.secondary,
    accent: brandColors.accent,

    background: "#F8FAFC",
    backgroundSecondary: "#F1F5F9",
    card: "#FFFFFF",
    surface: "#FFFFFF",

    text: "#0F172A",
    textSecondary: "#64748B",
    textTertiary: "#94A3B8",
    textInverse: "#FFFFFF",

    border: "#E2E8F0",
    borderLight: "#F1F5F9",

    success: brandColors.success,
    error: brandColors.error,
    warning: brandColors.warning,
    info: brandColors.info,

    tabBar: "#FFFFFF",
    tabBarBorder: "#E2E8F0",
    tabActive: brandColors.primary,
    tabInactive: "#64748B",

    settingsBg: "#F1F5F9",
    sectionHeader: "#64748B",
    rowBg: "#FFFFFF",
    separator: "#E2E8F0",
    comingSoonBadge: "#EEF2FF",
    comingSoonText: "#6366F1",
  },
};

const darkTheme: ThemeTokens = {
  mode: "dark",
  colors: {
    primary: "#818CF8",
    primaryDark: "#6366F1",
    primaryLight: "#A5B4FC",
    secondary: "#A78BFA",
    accent: "#22D3EE",

    background: "#000000",
    backgroundSecondary: "#0A0A0A",
    card: "#121212",
    surface: "#121212",

    text: "#F1F5F9",
    textSecondary: "#94A3B8",
    textTertiary: "#64748B",
    textInverse: "#000000",

    border: "#262626",
    borderLight: "#1A1A1A",

    success: "#34D399",
    error: "#F87171",
    warning: "#FBBF24",
    info: "#60A5FA",

    tabBar: "#000000",
    tabBarBorder: "#1A1A1A",
    tabActive: "#818CF8",
    tabInactive: "#94A3B8",

    settingsBg: "#000000",
    sectionHeader: "#94A3B8",
    rowBg: "#121212",
    separator: "#262626",
    comingSoonBadge: "#1E1B4B",
    comingSoonText: "#A5B4FC",
  },
};

// "Noir" — a fully desaturated charcoal palette. Every token is a neutral gray
// (no hue at all), giving the deliberate "dark gray / old photo" base. Paired
// with the whole-app grayscale filter in NoirProvider; this half guarantees the
// UI still reads as monochrome on devices where the filter is unsupported.
const noirTheme: ThemeTokens = {
  mode: "dark",
  colors: {
    primary: "#9CA3AF",
    primaryDark: "#6B7280",
    primaryLight: "#D1D5DB",
    secondary: "#9CA3AF",
    accent: "#A1A1AA",

    background: "#1A1A1A",
    backgroundSecondary: "#202020",
    card: "#262626",
    surface: "#262626",

    text: "#E5E5E5",
    textSecondary: "#A3A3A3",
    textTertiary: "#737373",
    textInverse: "#1A1A1A",

    border: "#404040",
    borderLight: "#2E2E2E",

    success: "#A3A3A3",
    error: "#C4C4C4",
    warning: "#BDBDBD",
    info: "#9E9E9E",

    tabBar: "#1A1A1A",
    tabBarBorder: "#2E2E2E",
    tabActive: "#E5E5E5",
    tabInactive: "#737373",

    settingsBg: "#1A1A1A",
    sectionHeader: "#A3A3A3",
    rowBg: "#262626",
    separator: "#404040",
    comingSoonBadge: "#2E2E2E",
    comingSoonText: "#D1D5DB",
  },
};

// ─── Context ──────────────────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeTokens>(lightTheme);

export function useTheme(): ThemeTokens {
  return useContext(ThemeContext);
}

// ─── Status bar ───────────────────────────────────────────────────────────────

/**
 * App-wide status bar whose icon contrast follows the app's *resolved* theme
 * (light/dark/noir) — NOT the device color scheme.
 *
 * Why this matters: under Android edge-to-edge (mandatory in SDK 54) the app
 * draws behind a transparent status bar, so the bar's icons sit directly on the
 * screen background. expo-status-bar's `style="auto"` picks icon color from the
 * OS appearance, which desyncs the moment the in-app theme differs from the
 * device — e.g. the app forced to Light while the phone is in Dark mode renders
 * white clock/battery icons on the light background, so they vanish and the
 * notification bar looks "covered" (only noticeable in light mode).
 *
 * `useTheme().mode` already folds in noir + settings.themeMode + system scheme,
 * making it the single source of truth: dark background → light icons; light
 * background → dark icons. Must render inside <ThemeProvider/>.
 */
export function ThemedStatusBar() {
  const { mode } = useTheme();
  return <StatusBar style={mode === "dark" ? "light" : "dark"} animated />;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const systemScheme = useSystemColorScheme();
  const { noir } = useNoir();

  const theme = useMemo(() => {
    // Noir overrides the user's light/dark choice while it's active.
    if (noir) return noirTheme;
    let mode: "light" | "dark" = "light";
    if (settings.themeMode === "dark") {
      mode = "dark";
    } else if (settings.themeMode === "system") {
      mode = systemScheme === "dark" ? "dark" : "light";
    }
    return mode === "dark" ? darkTheme : lightTheme;
  }, [settings.themeMode, systemScheme, noir]);

  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}

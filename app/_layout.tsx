import '../shim';
import "react-native-gesture-handler";
import { LogBox } from "react-native";
import { enableScreens } from "react-native-screens";

// Enable native screens for better performance (must be called before any navigation)
enableScreens(true);

// Ignore non-critical warnings in development
if (__DEV__) {
  LogBox.ignoreLogs([
    "Non-serializable values were found in the navigation state",
  ]);

  // Surface unhandled promise rejections in Metro terminal (dev only).
  // This makes errors like ExpoAsset.downloadAsync failures visible.
  const globalAny = global as any;
  if (!globalAny.__unhandledRejectionSetup) {
    globalAny.__unhandledRejectionSetup = true;
    const tracking = require("promise/setimmediate/rejection-tracking");
    tracking.enable({
      allRejections: true,
      onUnhandled: (id: number, error: unknown) => {
        const msg =
          error instanceof Error
            ? `${error.message}\n${error.stack}`
            : String(error);
        console.warn(`[UnhandledPromiseRejection id:${id}]`, msg);
      },
      onHandled: () => {},
    });
  }
}

import { FloatingAIButton } from "@/components/AIButton";
import { OnboardingScreen } from "@/components/OnboardingScreen";
import { ReturnCardOverlay } from "@/components/ScheduledTasks";
import { SubscriptionProvider } from "@/context/SubscriptionContext";
import { useScheduledTasks } from "@/hooks/useScheduledTasks";
import { initNotifications } from "@/services/notificationService";
import { setPendingGeneration } from "@/services/generatedDocStore";
import type { ScheduledTask } from "@/services/scheduledTasks";
import { useRouter } from "expo-router";
import docLibDb from "@/services/doclib/database";
import docLibIndexer from "@/services/doclib/fileIndexer";
import { loadNativeFonts } from "@/services/editorFontService";
import { runImportedFileRetentionCheck } from "@/services/fileRetentionService";
import { purgeExpired } from "@/services/recycleBinService";
import { loadSettings } from "@/services/settingsService";
import { ThemeProvider, ThemedStatusBar } from "@/services/ThemeProvider";
import { NoirLayer, NoirProvider } from "@/services/NoirProvider";
import { setAutoDetectLanguage, setRate } from "@/services/ttsService";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ActivityOverlay } from "@/components/activity/ActivityOverlay";
import { SafeBoundary } from "@/components/ui/SafeBoundary";

// Prevent the splash screen from hiding until fonts are loaded.
SplashScreen.preventAutoHideAsync().catch(() => {});

// ── Scheduled Tasks Watcher ───────────────────────────────────────────────────
// Separate component so it can call hooks inside the provider + router context.

function ScheduledTasksWatcher() {
  const router = useRouter();
  const { unseenTasks, dismissTask } = useScheduledTasks();

  const handleDocumentResult = useCallback(async (task: ScheduledTask) => {
    if (task.result?.type !== 'generate_document') return;
    const { content, title, fileType, category, wordCount } = task.result.data;
    setPendingGeneration({ content, title, fileType: fileType as any, category, tone: 'professional', wordCount });
    router.push('/gozlin-generated-preview' as any);
  }, [router]);

  const handleQuizResult = useCallback((task: ScheduledTask) => {
    router.push({ pathname: '/gozlin', params: { scheduledQuizId: task.id } } as any);
  }, [router]);

  const handleWorkspaceResult = useCallback((task: ScheduledTask) => {
    router.push({ pathname: '/gozlin-workspace', params: { scheduledAIId: task.id } } as any);
  }, [router]);

  return (
    <ReturnCardOverlay
      tasks={unseenTasks}
      onDismiss={dismissTask}
      onDocumentResult={handleDocumentResult}
      onQuizResult={handleQuizResult}
      onWorkspaceResult={handleWorkspaceResult}
    />
  );
}

export const unstable_settings = {
  anchor: "(tabs)",
};

export default function RootLayout() {
  const [fontsReady, setFontsReady] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);

  useEffect(() => {
    // Run background startup tasks in parallel with font loading.
    // NOTE: the app does NOT proactively wake or warm the backend here. Backend
    // warmth is handled by a separate external system; a backend is contacted
    // only when a real user request needs it (and each such request fails over
    // across the backend pool). AI's provider probe runs when an AI screen opens.

    // Prepare the OS notification channel + permission early so task/Read-Aloud
    // notifications post to the device's notification drawer (not as alerts).
    initNotifications().catch(() => {});

    Promise.all([
      loadNativeFonts(),
      // Purge expired recycle bin entries (15-day retention)
      purgeExpired().catch(console.error),
      // Auto-delete imported files past their retention period (if enabled)
      runImportedFileRetentionCheck().catch(console.error),
      // Initialise TTS rate and language detection from saved settings
      loadSettings().then((s) => {
        setRate(s.readingSpeed);
        setAutoDetectLanguage(s.autoDetectLanguage);
      }).catch(console.error),
      // Initialise the SAF document library DB and kick off a background scan
      docLibDb
        .init()
        .then(() => docLibIndexer.scheduleIncrementalScan(2500))
        .catch((e) => console.warn("[DocLib] init failed:", e)),
    ])
      .then(() => setFontsReady(true))
      .catch(() => setFontsReady(true)); // show app even if tasks fail
  }, []);

  const onLayoutReady = useCallback(async () => {
    if (fontsReady) {
      await SplashScreen.hideAsync();
    }
  }, [fontsReady]);

  if (!fontsReady) {
    return null; // native splash screen stays visible
  }

  return (
    <NoirProvider>
    <ThemeProvider>
      <SubscriptionProvider>
      <GestureHandlerRootView style={styles.container} onLayout={onLayoutReady}>
      {/* NoirLayer applies a whole-app grayscale filter when noir mode is on and
          hosts the noir toast overlay. It's a transparent flex pass-through when
          noir is off, so it never affects normal rendering. */}
      <NoirLayer>
      {/* Cold-start fade-in: RootLayout only mounts on a fresh process launch
          ("first open after being closed"), so this entrance plays exactly once. */}
      <Animated.View style={styles.container} entering={FadeIn.duration(450)}>
        {/* Edge-to-edge is mandatory on Android (SDK 54): the app draws behind a
            transparent status bar. ThemedStatusBar sets icon contrast from the
            app's resolved theme (light → dark icons, dark/noir → light icons) so
            the bar stays readable even when the in-app theme differs from the
            device's OS appearance. Screens reserve the bar's height via
            SafeAreaView / useSafeAreaInsets. */}
        <ThemedStatusBar />
        <Stack
          screenOptions={{
            headerShown: false,
            // PERF: Freeze inactive screens to prevent background re-renders
            freezeOnBlur: true,
            // Consistent, smooth push/pop transition across the whole app.
            // Individual screens can still override (e.g. the editor screens
            // below opt into `animation: "none"` for instant open).
            animation: "slide_from_right",
            animationDuration: 260,
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="gozlin" />
          <Stack.Screen name="manage-pages" />
          <Stack.Screen name="file-details" />
          <Stack.Screen name="browse-files" />
          <Stack.Screen name="tool-processor" />
          <Stack.Screen name="library" />
          <Stack.Screen name="doclib-library" />
          <Stack.Screen name="share" />
          <Stack.Screen name="folders" />
          <Stack.Screen name="pdf-viewer" />
          <Stack.Screen name="docx-viewer" />
          <Stack.Screen name="epub-viewer" />
          <Stack.Screen name="image-viewer" />
          {/* PERF: Use fast 'none' animation for editor screens — avoids
              layout animation overhead so the screen appears instantly */}
          <Stack.Screen name="create-file" />
          <Stack.Screen
            name="create-blank-pdf"
            options={{ animation: "none" }}
          />
          <Stack.Screen
            name="create-blank-docx"
            options={{ animation: "none" }}
          />
          <Stack.Screen name="image-to-file-preview" />
          <Stack.Screen name="gozlin-generated-preview" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="privacy-policy" />
          <Stack.Screen name="terms-of-service" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="premium" />
          <Stack.Screen name="recycle" />
          <Stack.Screen name="chat-with-document" />
          <Stack.Screen name="extract-images" />
          <Stack.Screen name="batch-compress" />
          <Stack.Screen name="find-replace" />
          <Stack.Screen name="qr-code" />
          <Stack.Screen name="highlight-export" />
          <Stack.Screen name="citation-extractor" />
          <Stack.Screen name="ppt-studio" />
          <Stack.Screen name="ppt-viewer" />
          <Stack.Screen name="scheduled-tasks" />
          <Stack.Screen name="schedule-task" />
          <Stack.Screen name="qc-calculators/index" />
          <Stack.Screen name="qc-calculators/[tool]" />
        </Stack>
        <FloatingAIButton />
        <ScheduledTasksWatcher />
        {!onboardingDone && (
          <OnboardingScreen onFinish={() => setOnboardingDone(true)} />
        )}
      </Animated.View>
      {/* Global spring "pull-to-cancel" overlay — renders null when idle, so it
          never affects screens that don't register a cancelable task. */}
      <SafeBoundary label="activity">
        <ActivityOverlay />
      </SafeBoundary>
      </NoirLayer>
      </GestureHandlerRootView>
      </SubscriptionProvider>
    </ThemeProvider>
    </NoirProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

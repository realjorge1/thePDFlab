/**
 * NoirProvider — "Noir mode"
 *
 * A secret, app-wide monochrome mode. It's toggled by tapping the "Activity"
 * header on the home screen (see app/(tabs)/index.tsx).
 *
 * Two independent mechanisms work together so the effect holds up everywhere:
 *
 *   1. A grayscale `filter` applied to the whole app tree (NoirLayer). This is
 *      the true "old photo / bedtime mode" desaturation — it also catches
 *      images, gradients and hardcoded colors. It needs the New Architecture
 *      `filter` style, which renders via RenderEffect on Android (API 31+) and
 *      CALayer filters on iOS. On older Android it's simply a no-op.
 *   2. A dedicated grayscale theme (noirTheme in ThemeProvider). This supplies
 *      the deliberate dark-gray base and guarantees the UI reads as monochrome
 *      even on older Android where the filter does nothing.
 *
 * State is intentionally in-memory only (resets on a cold start) — it's a fun
 * easter egg, not a persisted user setting, so it can never get "stuck" on.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import Animated, { FadeInUp, FadeOut } from "react-native-reanimated";
import { StatusBar } from "expo-status-bar";

interface NoirContextValue {
  noir: boolean;
  toggleNoir: () => void;
  /** Transient message shown by <NoirLayer/>'s overlay; null when hidden. */
  toast: string | null;
}

// Safe defaults so useNoir() never throws if read outside the provider.
const NoirContext = createContext<NoirContextValue>({
  noir: false,
  toggleNoir: () => {},
  toast: null,
});

export function useNoir(): NoirContextValue {
  return useContext(NoirContext);
}

export function NoirProvider({ children }: { children: React.ReactNode }) {
  const [noir, setNoir] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);

  const toggleNoir = useCallback(() => setNoir((v) => !v), []);

  // Surface a toast whenever noir flips — but never on the initial mount.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setToast(
      noir ? "Noir mode activated, press Activity to exit" : "Noir mode off",
    );
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [noir]);

  const value = useMemo(
    () => ({ noir, toggleNoir, toast }),
    [noir, toggleNoir, toast],
  );

  return <NoirContext.Provider value={value}>{children}</NoirContext.Provider>;
}

// Whole-tree grayscale. Typed loosely: the `filter` style is New-Architecture
// only and isn't present on every RN ViewStyle surface.
const NOIR_FILTER = { filter: [{ grayscale: 1 }] } as ViewStyle;

/**
 * Wraps the app's visible tree. Applies the grayscale filter when noir is on,
 * and renders the toast as a crisp (non-grayscaled) overlay sibling.
 */
export function NoirLayer({ children }: { children: React.ReactNode }) {
  const { noir } = useNoir();
  return (
    <View style={styles.fill}>
      <View style={[styles.fill, noir && NOIR_FILTER]}>{children}</View>
      <NoirToast />
    </View>
  );
}

/** StatusBar that flips to light icons in noir (dark-gray) mode. */
export function NoirStatusBar() {
  const { noir } = useNoir();
  return <StatusBar style={noir ? "light" : "auto"} />;
}

function NoirToast() {
  const { noir, toast } = useNoir();
  // When noir is switching ON, the whole app turns dark gray, so a dark toast
  // would blend in. Use a white pill (dark text) to draw the eye. The "Noir
  // mode off" toast keeps the default dark pill.
  return (
    <View pointerEvents="none" style={styles.toastWrap}>
      {toast ? (
        <Animated.View
          entering={FadeInUp.duration(220)}
          exiting={FadeOut.duration(180)}
          style={[styles.toast, noir && styles.toastLight]}
        >
          <Text style={[styles.toastText, noir && styles.toastTextLight]}>
            {toast}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 110,
    alignItems: "center",
  },
  toast: {
    maxWidth: "88%",
    backgroundColor: "rgba(28,28,28,0.96)",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.16)",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  toastText: {
    color: "#F5F5F5",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    letterSpacing: 0.3,
  },
  // White pill used on noir activation so it stands out against the dark base.
  toastLight: {
    backgroundColor: "rgba(255,255,255,0.98)",
    borderColor: "rgba(0,0,0,0.12)",
  },
  toastTextLight: {
    color: "#1A1A1A",
  },
});

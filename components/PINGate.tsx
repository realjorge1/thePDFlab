/**
 * PINGate & PINSetupModal
 * PIN interface with light/dark mode support.
 *
 * PINGate: wraps content behind a PIN screen when a screen is locked.
 * PINSetupModal: full-screen modal for create/verify/change PIN flows.
 *
 * PIN length: exactly 6 digits. Uses the device's native numeric keyboard.
 * The user types into a hidden TextInput; animated dots reflect progress.
 */
import { GradientView } from "@/components/GradientView";
import { useTheme } from "@/services/ThemeProvider";
import {
  getLockoutRemaining,
  verifyPIN,
  type VerifyResult,
} from "@/services/pinLockService";
import {
  useSettings,
  type ScreenLockSettings,
} from "@/services/settingsService";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  Lock,
  ShieldCheck,
} from "lucide-react-native";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ── Constants ─────────────────────────────────────────────────────────────────
const MIN_PIN = 6;
const MAX_PIN = 6;
const MAX_DOTS = MAX_PIN; // dots rendered = max possible length

// ── Theme-aware colour palettes ──────────────────────────────────────────────

interface PinColors {
  bgPrimary: string;
  bgTertiary: string;
  inputBg: string;
  inputBorder: string;
  inputBorderFocused: string;
  accentPrimary: string;
  accentSecondary: string;
  textPrimary: string;
  textSecondary: string;
  textPlaceholder: string;
  border: string;
  success: string;
  error: string;
  errorBg: string;
  errorBorder: string;
  btnText: string;
}

function usePinColors(): PinColors {
  const { mode, colors } = useTheme();
  return useMemo(
    () =>
      mode === "dark"
        ? {
            bgPrimary: "#0a0e16",
            bgTertiary: "#1c2333",
            inputBg: "#111827",
            inputBorder: "#2d3748",
            inputBorderFocused: "#3b82f6",
            accentPrimary: "#3b82f6",
            accentSecondary: "#60a5fa",
            textPrimary: "#f8fafc",
            textSecondary: "#94a3b8",
            textPlaceholder: "#4b5563",
            border: "#2d3748",
            success: "#10b981",
            error: "#ef4444",
            errorBg: "rgba(239,68,68,0.10)",
            errorBorder: "rgba(239,68,68,0.20)",
            btnText: "#fff",
          }
        : {
            bgPrimary: colors.background,
            bgTertiary: colors.card,
            inputBg: "#f9fafb",
            inputBorder: "#d1d5db",
            inputBorderFocused: "#3b82f6",
            accentPrimary: "#3b82f6",
            accentSecondary: "#60a5fa",
            textPrimary: colors.text,
            textSecondary: colors.textSecondary,
            textPlaceholder: "#9ca3af",
            border: colors.border,
            success: colors.success,
            error: colors.error,
            errorBg: "rgba(239,68,68,0.08)",
            errorBorder: "rgba(239,68,68,0.18)",
            btnText: "#fff",
          },
    [mode, colors],
  );
}

// ── Shake helper ──────────────────────────────────────────────────────────────

function triggerShake(anim: Animated.Value) {
  Animated.sequence([
    Animated.timing(anim, { toValue: -10, duration: 55, useNativeDriver: true }),
    Animated.timing(anim, { toValue: 10, duration: 55, useNativeDriver: true }),
    Animated.timing(anim, { toValue: -8, duration: 55, useNativeDriver: true }),
    Animated.timing(anim, { toValue: 8, duration: 55, useNativeDriver: true }),
    Animated.timing(anim, { toValue: 0, duration: 55, useNativeDriver: true }),
  ]).start();
}

// ── Dot indicators ────────────────────────────────────────────────────────────

interface DotsProps {
  length: number;
  shakeAnim: Animated.Value;
  statusType: "error" | "success" | "";
  colors: PinColors;
}

function PINDots({ length, shakeAnim, statusType, colors: c }: DotsProps) {
  return (
    <Animated.View
      style={[s.dotsRow, { transform: [{ translateX: shakeAnim }] }]}
    >
      {Array.from({ length: MAX_DOTS }).map((_, i) => {
        const filled = i < length;
        const isError = statusType === "error" && length === 0;
        const isSuccess = statusType === "success";
        return (
          <View
            key={i}
            style={[
              s.dot,
              { backgroundColor: c.bgTertiary, borderColor: c.border },
              filled && {
                backgroundColor: c.accentPrimary,
                borderColor: c.accentPrimary,
                shadowColor: c.accentPrimary,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.55,
                shadowRadius: 10,
                elevation: 4,
              },
              isError && { backgroundColor: c.error, borderColor: c.error },
              isSuccess && {
                backgroundColor: c.success,
                borderColor: c.success,
                shadowColor: c.success,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.55,
                shadowRadius: 10,
                elevation: 4,
              },
            ]}
          />
        );
      })}
    </Animated.View>
  );
}

// ── Shared PIN entry view ─────────────────────────────────────────────────────

interface PINEntryViewProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  pin: string;
  onChangePin: (p: string) => void;
  error: string;
  statusType: "error" | "success" | "";
  shakeAnim: Animated.Value;
  colors: PinColors;
  onBack: () => void;
  /** Primary action button label — shown only when pin.length >= MIN_PIN */
  actionLabel: string;
  onAction: () => void;
  /** Optional secondary button (e.g. Cancel) */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Disable auto-focus (useful when shown inside a modal that animates in) */
  autoFocus?: boolean;
  inputRef?: React.RefObject<TextInput | null>;
}

function PINEntryView({
  icon,
  title,
  subtitle,
  pin,
  onChangePin,
  error,
  statusType,
  shakeAnim,
  colors: c,
  onBack,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  autoFocus = true,
  inputRef: externalRef,
}: PINEntryViewProps) {
  const localRef = useRef<TextInput>(null);
  const ref = externalRef ?? localRef;
  const canSubmit = pin.length >= MIN_PIN;

  // Tap anywhere on the dots/input area to focus keyboard
  const focusInput = useCallback(() => ref.current?.focus(), [ref]);

  return (
    <KeyboardAvoidingView
      style={s.padWrapper}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* ── Back button ── */}
      <TouchableOpacity
        style={[s.backBtn, { borderColor: c.border, backgroundColor: c.bgTertiary }]}
        onPress={onBack}
        activeOpacity={0.7}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <ArrowLeft color={c.textSecondary} size={20} strokeWidth={2} />
      </TouchableOpacity>

      {/* ── Shield icon ── */}
      <View style={[s.iconBox, { shadowColor: c.accentPrimary }]}>
        <GradientView
          colors={[c.accentPrimary, c.accentSecondary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.iconGradient}
        >
          {icon}
        </GradientView>
      </View>

      {/* ── Header ── */}
      <Text style={[s.title, { color: c.textPrimary }]}>{title}</Text>
      <Text style={[s.subtitle, { color: c.textSecondary }]}>{subtitle}</Text>

      {/* ── Dot indicators (tappable to refocus keyboard) ── */}
      <Pressable onPress={focusInput} style={s.dotsTouchable}>
        <PINDots
          length={pin.length}
          shakeAnim={shakeAnim}
          statusType={statusType}
          colors={c}
        />
      </Pressable>

      {/* ── Hidden native TextInput (captures keystrokes) ── */}
      <TextInput
        ref={ref}
        style={s.hiddenInput}
        value={pin}
        onChangeText={(text) => {
          // Allow digits only, max MAX_PIN chars
          const digits = text.replace(/[^0-9]/g, "").slice(0, MAX_PIN);
          onChangePin(digits);
        }}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={MAX_PIN}
        autoFocus={autoFocus}
        caretHidden
        contextMenuHidden
        selectTextOnFocus={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityLabel="PIN input"
      />

      {/* ── Hint to tap if keyboard dismissed ── */}
      <TouchableOpacity onPress={focusInput} activeOpacity={0.6} style={s.tapHint}>
        <Text style={[s.tapHintText, { color: c.accentPrimary }]}>
          Tap here to type PIN
        </Text>
      </TouchableOpacity>

      {/* ── Status / error message ── */}
      {error !== "" && (
        <View
          style={[
            s.errorBadge,
            statusType === "error" && {
              backgroundColor: c.errorBg,
              borderColor: c.errorBorder,
            },
            statusType === "success" && {
              backgroundColor: "rgba(16,185,129,0.08)",
              borderColor: "rgba(16,185,129,0.2)",
            },
          ]}
        >
          <Text
            style={[
              s.errorText,
              statusType === "error" && { color: c.error },
              statusType === "success" && { color: c.success },
            ]}
          >
            {error}
          </Text>
        </View>
      )}

      {/* ── Action buttons ── */}
      <View style={s.btnRow}>
        {secondaryLabel && onSecondary && (
          <TouchableOpacity
            style={[s.btn, s.btnSecondary, { backgroundColor: c.bgTertiary, borderColor: c.border }]}
            onPress={onSecondary}
            activeOpacity={0.7}
          >
            <Text style={[s.btnSecondaryText, { color: c.textSecondary }]}>
              {secondaryLabel}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[s.btn, s.btnPrimary, !canSubmit && s.btnDisabled]}
          onPress={onAction}
          activeOpacity={canSubmit ? 0.7 : 1}
          disabled={!canSubmit}
        >
          <GradientView
            colors={canSubmit ? [c.accentPrimary, c.accentSecondary] : [c.bgTertiary, c.bgTertiary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.btnGradient}
          >
            <Text style={[s.btnPrimaryText, !canSubmit && { opacity: 0.45 }]}>
              {actionLabel}
            </Text>
          </GradientView>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PINGate — wraps screen content behind a PIN wall
// ═══════════════════════════════════════════════════════════════════════════════

interface PINGateProps {
  screen: keyof ScreenLockSettings;
  children: React.ReactNode;
}

export function PINGate({ screen, children }: PINGateProps) {
  const { settings } = useSettings();
  const isLocked =
    settings.appLock &&
    settings.pinHash.length > 0 &&
    settings.screenLocks[screen] === true;

  if (!isLocked) return <>{children}</>;

  return <PINGateInner>{children}</PINGateInner>;
}

/** Heavy inner component — only mounted when the screen is actually locked */
function PINGateInner({ children }: { children: React.ReactNode }) {
  const c = usePinColors();
  const router = useRouter();

  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [statusType, setStatusType] = useState<"error" | "success" | "">("");
  const [lockedOut, setLockedOut] = useState(false);
  const lockoutTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const inputRef = useRef<TextInput>(null);

  // Check for existing lockout on mount
  useEffect(() => {
    if (unlocked) return;
    getLockoutRemaining().then((secs) => {
      if (secs > 0) {
        setLockedOut(true);
        setStatusType("error");
        setError(`Too many attempts. Try again in ${secs}s`);
        startLockoutCountdown(secs);
      }
    });
    return () => {
      if (lockoutTimer.current) clearInterval(lockoutTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  const startLockoutCountdown = useCallback((secs: number) => {
    let remaining = secs;
    if (lockoutTimer.current) clearInterval(lockoutTimer.current);
    lockoutTimer.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (lockoutTimer.current) clearInterval(lockoutTimer.current);
        setLockedOut(false);
        setError("");
        setStatusType("");
      } else {
        setError(`Too many attempts. Try again in ${remaining}s`);
      }
    }, 1000);
  }, []);

  const handleChangePin = useCallback(
    (text: string) => {
      if (lockedOut) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setPin(text);
      setError("");
      setStatusType("");
    },
    [lockedOut],
  );

  const handleSubmit = useCallback(() => {
    if (pin.length < MIN_PIN || lockedOut) return;
    verifyPIN(pin).then((result: VerifyResult) => {
      if (result.valid) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setStatusType("success");
        setError("PIN verified successfully!");
        setTimeout(() => setUnlocked(true), 350);
      } else if (result.locked) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        triggerShake(shakeAnim);
        setLockedOut(true);
        setStatusType("error");
        setError(`Too many attempts. Try again in ${result.secondsLeft ?? 30}s`);
        startLockoutCountdown(result.secondsLeft ?? 30);
        setTimeout(() => setPin(""), 300);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        triggerShake(shakeAnim);
        setStatusType("error");
        setError(
          result.attemptsLeft === 1
            ? "Wrong PIN. 1 attempt left before lockout."
            : `Wrong PIN. ${result.attemptsLeft ?? "?"} attempts left.`,
        );
        setTimeout(() => setPin(""), 300);
      }
    });
  }, [pin, lockedOut, shakeAnim, startLockoutCountdown]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  if (unlocked) return <>{children}</>;

  return (
    <View style={[s.fullScreen, { backgroundColor: c.bgPrimary }]}>
      <SafeAreaView style={[s.container, { backgroundColor: c.bgPrimary }]}>
        <PINEntryView
          icon={<Lock color="#fff" size={26} strokeWidth={2} />}
          title="Enter PIN"
          subtitle="Enter your PIN to continue"
          pin={pin}
          onChangePin={handleChangePin}
          error={error}
          statusType={statusType}
          shakeAnim={shakeAnim}
          colors={c}
          onBack={handleBack}
          actionLabel="Unlock"
          onAction={handleSubmit}
          inputRef={inputRef}
        />
      </SafeAreaView>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PINSetupModal — full-screen modal for create / verify / change PIN
// ═══════════════════════════════════════════════════════════════════════════════

interface PINSetupProps {
  visible: boolean;
  onComplete: (pin: string) => void;
  onCancel: () => void;
  mode: "setup" | "verify" | "change";
}

export function PINSetupModal({
  visible,
  onComplete,
  onCancel,
  mode,
}: PINSetupProps) {
  const c = usePinColors();
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [pin, setPin] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError] = useState("");
  const [statusType, setStatusType] = useState<"error" | "success" | "">("");
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const inputRef = useRef<TextInput>(null);

  // Re-focus and clear when modal becomes visible
  useEffect(() => {
    if (visible) {
      setPin("");
      setFirstPin("");
      setStep("enter");
      setError("");
      setStatusType("");
      // slight delay so the modal has rendered before focusing
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible]);

  const resetState = useCallback(() => {
    setPin("");
    setFirstPin("");
    setStep("enter");
    setError("");
    setStatusType("");
  }, []);

  const handleChangePin = useCallback(
    (text: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setPin(text);
      setError("");
      setStatusType("");
    },
    [],
  );

  // ── Primary action ─────────────────────────────────────────────────────────

  const handleAction = useCallback(() => {
    if (pin.length < MIN_PIN) return;

    if (mode === "verify" || (mode === "change" && step === "enter")) {
      // Verify against stored PIN
      verifyPIN(pin).then((result: VerifyResult) => {
        if (result.valid) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setStatusType("success");
          setError("PIN verified successfully!");
          setTimeout(() => {
            onComplete(pin);
            resetState();
          }, 350);
        } else if (result.locked) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          triggerShake(shakeAnim);
          setStatusType("error");
          setError(`Locked out. Try again in ${result.secondsLeft ?? 30}s`);
          setTimeout(() => setPin(""), 300);
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          triggerShake(shakeAnim);
          setStatusType("error");
          setError(
            result.attemptsLeft === 1
              ? "Wrong PIN. 1 attempt left."
              : `Wrong PIN. ${result.attemptsLeft ?? "?"} attempts left.`,
          );
          setTimeout(() => setPin(""), 300);
        }
      });
      return;
    }

    if (mode === "setup" && step === "enter") {
      // Store first entry; move to confirm step
      setFirstPin(pin);
      setPin("");
      setStep("confirm");
      setError("");
      setStatusType("");
      setTimeout(() => inputRef.current?.focus(), 80);
      return;
    }

    if (mode === "setup" && step === "confirm") {
      if (pin === firstPin) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setStatusType("success");
        setError("PIN set successfully!");
        setTimeout(() => {
          onComplete(pin);
          resetState();
        }, 350);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        triggerShake(shakeAnim);
        setStatusType("error");
        setError("PINs do not match. Try again.");
        setTimeout(() => setPin(""), 300);
      }
    }
  }, [pin, step, firstPin, mode, onComplete, resetState, shakeAnim]);

  const handleCancel = useCallback(() => {
    resetState();
    onCancel();
  }, [resetState, onCancel]);

  if (!visible) return null;

  const title =
    mode === "setup"
      ? step === "enter"
        ? "Create PIN"
        : "Confirm PIN"
      : mode === "verify"
        ? "Enter PIN"
        : "Enter Current PIN";

  const subtitle =
    mode === "setup"
      ? step === "enter"
        ? "Enter a 4–8 digit PIN"
        : "Re-enter your PIN to confirm"
      : "Enter your PIN to continue";

  const actionLabel =
    mode === "setup"
      ? step === "enter"
        ? "Next"
        : "Confirm"
      : "Verify";

  return (
    <View
      style={[StyleSheet.absoluteFill, s.modalOverlay, { backgroundColor: c.bgPrimary }]}
    >
      <SafeAreaView style={[s.container, { backgroundColor: c.bgPrimary }]}>
        <PINEntryView
          icon={<ShieldCheck color="#fff" size={26} strokeWidth={2} />}
          title={title}
          subtitle={subtitle}
          pin={pin}
          onChangePin={handleChangePin}
          error={error}
          statusType={statusType}
          shakeAnim={shakeAnim}
          colors={c}
          onBack={handleCancel}
          actionLabel={actionLabel}
          onAction={handleAction}
          secondaryLabel="Cancel"
          onSecondary={handleCancel}
          autoFocus={false}
          inputRef={inputRef}
        />
      </SafeAreaView>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════════════════

const s = StyleSheet.create({
  fullScreen: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
  },
  modalOverlay: {
    zIndex: 999,
  },
  container: {
    flex: 1,
  },
  padWrapper: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },

  // ── Back button ──
  backBtn: {
    position: "absolute",
    top: 40,
    left: 20,
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },

  // ── Icon ──
  iconBox: {
    marginBottom: 22,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 8,
  },
  iconGradient: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Header ──
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 6,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 28,
    textAlign: "center",
    lineHeight: 20,
  },

  // ── Dots ──
  dotsTouchable: {
    marginBottom: 6,
  },
  dotsRow: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    paddingVertical: 8,
  },
  dot: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
  },

  // ── Hidden TextInput ──
  hiddenInput: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    // Ensure the caret / selection highlight is invisible
    color: "transparent",
  },

  // ── Tap hint ──
  tapHint: {
    marginTop: 8,
    marginBottom: 18,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  tapHintText: {
    fontSize: 13,
    fontWeight: "500",
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
  },

  // ── Error/success badge ──
  errorBadge: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 20,
    maxWidth: 300,
    alignItems: "center",
  },
  errorText: {
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
  },

  // ── Buttons ──
  btnRow: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  btn: {
    flex: 1,
    borderRadius: 14,
    overflow: "hidden",
    minHeight: 50,
  },
  btnPrimary: {},
  btnSecondary: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnGradient: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    minHeight: 50,
  },
  btnPrimaryText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
    letterSpacing: 0.2,
  },
  btnSecondaryText: {
    fontSize: 16,
    fontWeight: "500",
  },
});

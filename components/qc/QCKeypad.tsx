/**
 * Scientific number pad shared by every QC calculator.
 *
 * A `KeypadProvider` (mounted once by QCScreenShell) tracks the focused input
 * field. Fields opt in with `useKeypadField(value, onChange)`. A docked
 * `QCKeypadBar` edits the focused field and evaluates expressions on "=",
 * so all tools get π/√/^ entry without any per-tool keypad code. The native
 * keyboard keeps working alongside it.
 */
import { tryEval } from "@/components/qc/qcMath";
import { useTheme } from "@/services/ThemeProvider";
import { Calculator, ChevronDown, Delete } from "lucide-react-native";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Keyboard, StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface KeypadTarget {
  id: string;
  value: string;
  onChange: (next: string) => void;
}

interface KeypadCtx {
  focusedId: string | null;
  focus: (target: KeypadTarget) => void;
  sync: (target: KeypadTarget) => void;
  press: (key: string) => void;
  visible: boolean;
  show: () => void;
  toggle: () => void;
  hide: () => void;
  hasTarget: boolean;
}

const KeypadContext = createContext<KeypadCtx | null>(null);

let kfCounter = 0;

function formatEval(n: number): string {
  if (!Number.isFinite(n)) return "";
  return String(Number(n.toPrecision(12)));
}

function applyKey(value: string, key: string): string {
  switch (key) {
    case "back":
      return value.slice(0, -1);
    case "clear":
      return "";
    case "neg":
      return value.startsWith("-") ? value.slice(1) : "-" + value;
    case "eval": {
      const r = tryEval(value);
      return r === null ? value : formatEval(r);
    }
    default:
      return value + key;
  }
}

export function KeypadProvider({ children }: { children: React.ReactNode }) {
  const targetRef = useRef<KeypadTarget | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [hasTarget, setHasTarget] = useState(false);

  const focus = useCallback((target: KeypadTarget) => {
    targetRef.current = target;
    setFocusedId(target.id);
    setHasTarget(true);
  }, []);

  const sync = useCallback((target: KeypadTarget) => {
    if (targetRef.current?.id === target.id) targetRef.current = target;
  }, []);

  const press = useCallback((key: string) => {
    const target = targetRef.current;
    if (!target) return;
    const next = applyKey(target.value, key);
    target.onChange(next);
    // Keep the ref current so rapid consecutive presses accumulate correctly.
    targetRef.current = { ...target, value: next };
  }, []);

  const show = useCallback(() => {
    // Opening the pad dismisses the native keyboard so they don't fight for space.
    Keyboard.dismiss();
    setVisible(true);
  }, []);
  const toggle = useCallback(() => {
    setVisible((v) => {
      if (!v) Keyboard.dismiss();
      return !v;
    });
  }, []);
  const hide = useCallback(() => setVisible(false), []);

  return (
    <KeypadContext.Provider
      value={{
        focusedId,
        focus,
        sync,
        press,
        visible,
        show,
        toggle,
        hide,
        hasTarget,
      }}
    >
      {children}
    </KeypadContext.Provider>
  );
}

/**
 * Register a text field with the number pad. Returns an `onFocus` handler and
 * whether the field is the active keypad target. Safe to call with no provider
 * (returns inert values).
 */
export function useKeypadField(
  value: string,
  onChange: (next: string) => void,
): {
  onFocus: () => void;
  focused: boolean;
  enabled: boolean;
  /** True while the pad is open — suppress the native soft keyboard then. */
  padVisible: boolean;
} {
  const ctx = useContext(KeypadContext);
  const idRef = useRef<string>("");
  if (!idRef.current) idRef.current = `kf_${kfCounter++}`;
  const id = idRef.current;
  const focused = ctx?.focusedId === id;

  useEffect(() => {
    if (focused && ctx) ctx.sync({ id, value, onChange });
  }, [focused, value, onChange, ctx, id]);

  const onFocus = useCallback(() => {
    ctx?.focus({ id, value, onChange });
  }, [ctx, id, value, onChange]);

  return {
    onFocus,
    focused,
    enabled: !!ctx,
    padVisible: !!ctx?.visible,
  };
}

// ─── Keypad UI ────────────────────────────────────────────────────────────────

type KeyDef = { label: string; key: string; kind?: "fn" | "op" | "eq" };

const ROWS: KeyDef[][] = [
  [
    { label: "7", key: "7" },
    { label: "8", key: "8" },
    { label: "9", key: "9" },
    { label: "÷", key: "÷", kind: "op" },
    { label: "√", key: "√", kind: "fn" },
    { label: "C", key: "clear", kind: "fn" },
  ],
  [
    { label: "4", key: "4" },
    { label: "5", key: "5" },
    { label: "6", key: "6" },
    { label: "×", key: "×", kind: "op" },
    { label: "^", key: "^", kind: "fn" },
    { label: "(", key: "(", kind: "fn" },
  ],
  [
    { label: "1", key: "1" },
    { label: "2", key: "2" },
    { label: "3", key: "3" },
    { label: "−", key: "-", kind: "op" },
    { label: "π", key: "π", kind: "fn" },
    { label: ")", key: ")", kind: "fn" },
  ],
  [
    { label: "0", key: "0" },
    { label: ".", key: "." },
    { label: "±", key: "neg", kind: "fn" },
    { label: "+", key: "+", kind: "op" },
    { label: "=", key: "eval", kind: "eq" },
  ],
];

/**
 * Docked keypad + toggle. Renders nothing structural when collapsed except a
 * floating toggle button. Mounted once by QCScreenShell.
 */
export function QCKeypadBar() {
  const { colors: t } = useTheme();
  const ctx = useContext(KeypadContext);
  if (!ctx) return null;

  if (!ctx.visible) {
    return (
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: t.primary }]}
        onPress={ctx.show}
        accessibilityRole="button"
        accessibilityLabel="Open number pad"
        activeOpacity={0.85}
      >
        <Calculator size={22} color="#FFFFFF" />
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.bar, { backgroundColor: t.card, borderColor: t.border }]}>
      <View style={styles.barHeader}>
        <Text style={[styles.barHint, { color: t.textTertiary }]}>
          {ctx.hasTarget
            ? "Editing selected field"
            : "Tap a field, then use the pad"}
        </Text>
        <TouchableOpacity
          onPress={ctx.hide}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Hide number pad"
          style={styles.barClose}
        >
          <ChevronDown size={18} color={t.textSecondary} />
        </TouchableOpacity>
      </View>
      {ROWS.map((row, ri) => (
        <View key={ri} style={styles.keyRow}>
          {row.map((k) => {
            const isEq = k.kind === "eq";
            const bg = isEq
              ? t.primary
              : k.kind === "op" || k.kind === "fn"
                ? t.backgroundSecondary
                : t.background;
            const fg = isEq
              ? "#FFFFFF"
              : k.kind === "fn"
                ? t.primary
                : t.text;
            return (
              <TouchableOpacity
                key={k.key}
                style={[
                  styles.key,
                  { backgroundColor: bg, borderColor: t.border },
                  isEq && styles.keyEq,
                ]}
                onPress={() => ctx.press(k.key)}
                accessibilityRole="button"
                accessibilityLabel={k.label === "=" ? "Equals" : k.label}
                activeOpacity={0.7}
              >
                <Text style={[styles.keyText, { color: fg }]}>{k.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
      <TouchableOpacity
        style={[styles.backspace, { borderColor: t.border }]}
        onPress={() => ctx.press("back")}
        accessibilityRole="button"
        accessibilityLabel="Delete"
        activeOpacity={0.7}
      >
        <Delete size={18} color={t.textSecondary} />
        <Text style={[styles.backspaceText, { color: t.textSecondary }]}>
          Delete
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 16,
    bottom: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 6,
  },
  barHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 2,
    marginBottom: 2,
  },
  barHint: {
    fontSize: 12,
    fontWeight: "600",
  },
  barClose: {
    padding: 2,
  },
  keyRow: {
    flexDirection: "row",
    gap: 6,
  },
  key: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  keyEq: {
    flex: 2,
  },
  keyText: {
    fontSize: 18,
    fontWeight: "600",
  },
  backspace: {
    flexDirection: "row",
    alignSelf: "center",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 8,
    marginTop: 2,
  },
  backspaceText: {
    fontSize: 13,
    fontWeight: "600",
  },
});

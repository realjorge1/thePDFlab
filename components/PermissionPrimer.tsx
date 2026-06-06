/**
 * PermissionPrimer
 *
 * A lightweight, purely-additive "pre-permission" priming sheet shown *before*
 * the OS camera / photo-library prompt is triggered. It explains, in the app's
 * own voice, why access is needed and lets the user tap "Allow" or "Don't
 * Allow" first — giving them more control and making the request feel safe.
 *
 * Usage (per screen):
 *   const { requestPrime, primer } = usePermissionPrimer();
 *   ...
 *   const ok = await requestPrime("camera");
 *   if (!ok) return;                 // user declined — abort silently
 *   await pickImageFromCamera();     // existing flow, unchanged
 *   ...
 *   render {primer} somewhere in the screen tree (e.g. before </SafeAreaView>).
 *
 * camera and folder access prime the sheet EVERY time (per product requirement
 * that the user must always be asked before those are accessed). gallery skips
 * the sheet once photos access is already granted, so picking images repeatedly
 * is not nagged.
 *
 * This component never throws and never blocks the underlying feature: it only
 * gates the moment *before* the existing picker runs.
 */

import { colors as brandColors } from "@/constants/theme";
import permissionService from "@/services/permissionService";
import { useTheme } from "@/services/ThemeProvider";
import { Camera, FolderOpen, Images } from "lucide-react-native";
import React, { useCallback, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

// ─── Kinds & copy ─────────────────────────────────────────────────────────────

export type PrimerKind = "camera" | "gallery" | "folder";

interface PrimerConfig {
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  accent: string;
  title: string;
  message: string;
  allowLabel: string;
}

const PRIMER_CONFIG: Record<PrimerKind, PrimerConfig> = {
  camera: {
    Icon: Camera,
    accent: brandColors.primary,
    title: "Let's get started",
    message:
      "We'd like to access your camera to take a photo of the document you want to create.",
    allowLabel: "Allow Camera",
  },
  gallery: {
    Icon: Images,
    accent: brandColors.secondary,
    title: "Let's get started",
    message:
      "We'd like to access your photos so you can pick images for the document you want to create.",
    allowLabel: "Allow Photos",
  },
  folder: {
    Icon: FolderOpen,
    accent: "#8B5E3C",
    title: "Bring your files in",
    message:
      "Pick a folder on your device and we'll bring its documents into your library. Nothing leaves your phone — we only read what's inside the folder you choose.",
    allowLabel: "Choose Folder",
  },
};

// PrimerKind → permission type used to decide whether the sheet can be skipped.
// Only "gallery" is allowed to skip when already granted; "camera" and "folder"
// always re-prompt (see requestPrime), so they are intentionally absent here.
const PERMISSION_FOR_KIND = {
  gallery: "media",
} as const;

// ─── Presentational sheet ─────────────────────────────────────────────────────

interface PermissionPrimerProps {
  visible: boolean;
  kind: PrimerKind;
  onAllow: () => void;
  onDeny: () => void;
}

export function PermissionPrimer({
  visible,
  kind,
  onAllow,
  onDeny,
}: PermissionPrimerProps) {
  const { colors: t } = useTheme();
  const cfg = PRIMER_CONFIG[kind];
  const Icon = cfg.Icon;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDeny}
    >
      <View style={styles.backdrop}>
        {/* Tapping the backdrop is treated as "Don't Allow". */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDeny}
          accessible={false}
        />
        <View style={[styles.sheet, { backgroundColor: t.card }]}>
          <View style={[styles.iconWrap, { backgroundColor: cfg.accent + "15" }]}>
            <Icon size={34} color={cfg.accent} />
          </View>

          <Text style={[styles.title, { color: t.text }]}>{cfg.title}</Text>
          <Text style={[styles.message, { color: t.textSecondary }]}>
            {cfg.message}
          </Text>

          <TouchableOpacity
            style={[styles.allowBtn, { backgroundColor: cfg.accent }]}
            onPress={onAllow}
            activeOpacity={0.85}
          >
            <Text style={styles.allowText}>{cfg.allowLabel}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.denyBtn}
            onPress={onDeny}
            activeOpacity={0.7}
          >
            <Text style={[styles.denyText, { color: t.textSecondary }]}>
              Don't Allow
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePermissionPrimer() {
  const [kind, setKind] = useState<PrimerKind>("camera");
  const [visible, setVisible] = useState(false);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  // Tracks the kind being requested (reserved for future per-kind handling).
  const kindRef = useRef<PrimerKind>("camera");

  const settle = useCallback((ok: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setVisible(false);
    resolve?.(ok);
  }, []);

  /**
   * Show the priming sheet and resolve true if the user is happy to proceed,
   * false to abort. Never rejects.
   *
   * Per user requirement: camera and folder access MUST prompt the user *every*
   * time — so for those kinds the sheet is shown unconditionally and we never
   * short-circuit on an already-granted OS permission or a prior folder ack.
   * (The OS itself still only shows its own system dialog once per grant; this
   * sheet is the app-controlled confirmation that always reappears.)
   * "gallery" keeps the friendlier behavior of skipping the sheet once photos
   * access is already granted.
   */
  const requestPrime = useCallback(
    async (k: PrimerKind): Promise<boolean> => {
      kindRef.current = k;

      // gallery is the only kind allowed to skip the sheet once granted.
      if (k === "gallery") {
        try {
          const granted = await permissionService.isGranted(
            PERMISSION_FOR_KIND.gallery,
          );
          if (granted) return true;
        } catch {
          // If the check fails for any reason, fall through and show the sheet.
        }
      }

      // Defensively settle any previous pending request as declined.
      resolverRef.current?.(false);

      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setKind(k);
        setVisible(true);
      });
    },
    [],
  );

  const primer = (
    <PermissionPrimer
      visible={visible}
      kind={kind}
      onAllow={() => settle(true)}
      onDeny={() => settle(false)}
    />
  );

  return { requestPrime, primer };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 36,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 16,
  },
  iconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.3,
    marginBottom: 8,
    textAlign: "center",
  },
  message: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    maxWidth: 320,
    marginBottom: 24,
  },
  allowBtn: {
    width: "100%",
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  allowText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  denyBtn: {
    width: "100%",
    paddingVertical: 13,
    marginTop: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  denyText: {
    fontSize: 15,
    fontWeight: "600",
  },
});

export default PermissionPrimer;

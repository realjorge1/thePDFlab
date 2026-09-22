import { useMemo } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Geometry for the floating bottom dock (see app/(tabs)/_layout.tsx).
 *
 * This lives outside the layout because BOTH sides need it and they must never
 * disagree: the dock draws itself from these numbers, and every tab screen
 * reserves `dockHeight` at the bottom of its own scrollable content so the last
 * row can be scrolled clear of the islands.
 *
 * Why the screens and not the navigator: padding the *scene* (which is what
 * `sceneStyle: { paddingBottom }` does) cuts the screen short and leaves a
 * dock-height band of the navigator's own background below it — the visible
 * white/black strip where the old tab bar used to be. Full-height scenes with an
 * inset applied to their scroll *content* instead means the screen's background
 * and its content both run edge to edge, passing under the dock as you scroll,
 * while nothing ever comes to rest beneath it.
 */

// Gap above the islands, inside the (transparent) dock area.
export const DOCK_TOP_PAD = 8;

/**
 * Read from the *live* window, so the dock re-lays itself out on rotation,
 * split-screen, foldable unfold and web resize without a remount — and every
 * screen's bottom inset follows it in the same pass.
 */
export function useTabDockMetrics() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  return useMemo(() => {
    const compact = width < 360; // small phones (SE-class)
    const roomy = width >= 600; // tablets, foldables, desktop web
    const short = height < 600; // landscape phones

    // Resting slots are square, so an icon alone sits optically centred with
    // no extra maths, and the square's side doubles as the row height.
    const slot = compact || short ? 42 : 46;
    const pad = 6; // island inner padding
    const iconSize = compact ? 21 : 22;

    const bottomPad =
      insets.bottom > 0
        ? Math.max(insets.bottom - 10, 10)
        : Platform.OS === "ios"
          ? 14
          : 12;

    return {
      slot,
      pad,
      iconSize,
      labelSize: compact ? 12 : 13,
      // The single spacing constant the whole dock is tuned from: the air
      // between a label's far edge and the capsule around it. It is set one
      // point wider than the slack the icon already carries inside its square
      // ((slot - iconSize) / 2), because text needs marginally more breathing
      // room than a glyph that comes with its own bounding box. Every capsule
      // in the dock — the trio's pill and Download's island — is then exactly
      // `slot + labelWidth + edge` wide, which lands the same rhythm on both:
      //   12 · icon · 12 · label · 13   (and its mirror for Download)
      edge: Math.round((slot - iconSize) / 2) + 1,
      // Nested-radius rule: the pill inside sits at radius (slot / 2), so the
      // island must be exactly that plus its padding for the two curves to run
      // parallel instead of one cutting across the other.
      radius: slot / 2 + pad,
      hInset: roomy ? 28 : compact ? 12 : 16,
      maxWidth: 560,
      bottomPad,
      // What the dock occupies, measured from the bottom of the window.
      dockHeight: DOCK_TOP_PAD + slot + pad * 2 + bottomPad,
    };
  }, [width, height, insets.bottom]);
}

export type TabDockMetrics = ReturnType<typeof useTabDockMetrics>;

/**
 * Bottom inset a tab screen should add to its scrollable content so the last
 * item clears the floating dock. Put it on `contentContainerStyle`, never on
 * the screen container — the background is supposed to run underneath.
 */
export function useTabDockInset() {
  return useTabDockMetrics().dockHeight;
}

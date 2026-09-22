/**
 * Icon micro-motion
 * ─────────────────────────────────────────────────────────────────────────────
 * The small "the app noticed you" gestures: a wrench that takes two turns on a
 * bolt, books that get shoved together and stand back up, a pencil that lifts,
 * writes a line and is set down again.
 *
 * Every gesture below is one dictionary of *tracks* rather than imperative
 * animation code, for three reasons:
 *
 *   1. The whole gesture is legible in one place — you can read what the icon
 *      does without simulating a stack of `withSequence` calls in your head.
 *   2. Its duration is derivable, which is what lets the Activity card space
 *      five of them 1.2s apart without a hand-maintained number per icon.
 *   3. Nothing animates that a recipe doesn't name, so an icon that only
 *      rotates costs one shared value's worth of work on the UI thread.
 *
 * All of it is transforms and opacity — no layout, no colour interpolation on
 * the JS thread — so a gesture is unaffected by whatever the screen is busy
 * doing when it fires. On the Activity card it fires while the file index is
 * still settling, which is exactly when JS is least able to help.
 */

import React, { useCallback, useEffect, useMemo } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  type SharedValue,
  type WithTimingConfig,
} from "react-native-reanimated";

// ─── Timing vocabulary ───────────────────────────────────────────────────────
type Ease = WithTimingConfig["easing"];

const OUT: Ease = Easing.out(Easing.quad); // leaves fast, arrives gently
const IN: Ease = Easing.in(Easing.quad); // falls under its own weight
const BOTH: Ease = Easing.inOut(Easing.quad); // the in-between beats
// A little overshoot on the *last* beat of every recipe, so the icon comes to
// rest by settling rather than by stopping — which is most of the difference
// between "animated" and "alive".
const LAND: Ease = Easing.out(Easing.back(1.7));
const TURN: Ease = Easing.inOut(Easing.cubic); // one deliberate half-turn

/** `[to, ms]`, or `[to, ms, easing]`. A step onto its own value is a hold. */
type Step = [to: number, ms: number, ease?: Ease];
type Track = { delay?: number; steps: Step[] };

type Recipe = {
  /** CSS-style pivot for the whole glyph. Defaults to its centre. */
  origin?: string;
  /** Pixels, authored against a 24dp glyph and scaled to the real one. */
  tx?: Track;
  ty?: Track;
  /** Degrees. */
  rot?: Track;
  sx?: Track;
  sy?: Track;
  /** 0 = primary glyph, 1 = the alternate one. */
  swap?: Track;
  /** 0 rest → 1 white → 2 gold → 3 rest. See `useGlowOpacity`. */
  glow?: Track;
};

/** Everything that can be asked to perform. */
export type MotionKind =
  // the four tab icons…
  | "home"
  | "tools"
  | "library"
  | "download"
  // …and the five on the Activity card.
  | "create"
  | "workspace"
  | "folders"
  | "premium"
  | "gozlin";

// Recipes are written for a 24dp icon — lucide's own viewBox — so "lift by 3"
// means the same *fraction* of the glyph on an 18dp folder chip as on the 32dp
// pencil. Rotations and scales are already relative and pass straight through.
const AUTHORED_AT = 24;

// ─── The recipes ─────────────────────────────────────────────────────────────
const RECIPES: Record<MotionKind, Recipe> = {
  // ── Home ── the house hops and settles back onto its plot: it stretches as
  // it leaves the ground and squashes as it takes its own weight again.
  home: {
    ty: { steps: [[-2.8, 150, OUT], [0.9, 130, IN], [0, 210, LAND]] },
    sx: { steps: [[0.965, 150, OUT], [1.05, 130, IN], [1, 210, LAND]] },
    sy: { steps: [[1.055, 150, OUT], [0.945, 130, IN], [1, 210, LAND]] },
  },

  // ── Tools ── two turns of a wrench. Bite hard, ratchet back, bite again, let
  // go. The asymmetry — a long pull against a short give — is what reads as
  // work being done rather than as a glyph waggling.
  tools: {
    rot: {
      steps: [
        [-16, 150, OUT],
        [5, 120, BOTH],
        [-13, 130, BOTH],
        [3, 110, BOTH],
        [0, 190, LAND],
      ],
    },
    sx: { steps: [[1.045, 150, OUT], [1, 550, BOTH]] },
    sy: { steps: [[1.045, 150, OUT], [1, 550, BOTH]] },
  },

  // ── Library ── four spines of different heights. They lean, get pushed
  // together along the shelf (that's the scaleX pinch), then stand back up —
  // which is what re-shelving one book does to the books either side of it.
  library: {
    rot: { steps: [[-8, 170, OUT], [6, 150, BOTH], [-3, 140, BOTH], [0, 220, LAND]] },
    tx: { steps: [[-1.7, 170, OUT], [1.5, 150, BOTH], [-0.6, 140, BOTH], [0, 220, LAND]] },
    ty: { steps: [[-1.5, 170, OUT], [0.7, 150, BOTH], [0, 360, LAND]] },
    sx: { steps: [[0.93, 170, OUT], [1.05, 150, BOTH], [0.99, 140, BOTH], [1, 220, LAND]] },
  },

  // ── Download ── the arrow drops into the tray under its own weight (ease-in,
  // stretching as it accelerates), the tray takes the impact, both recover.
  download: {
    ty: { steps: [[3.1, 180, IN], [-1.3, 150, OUT], [0, 220, LAND]] },
    sx: { steps: [[0.96, 180, IN], [1.08, 150, OUT], [1, 220, LAND]] },
    sy: { steps: [[1.07, 180, IN], [0.9, 150, OUT], [1, 220, LAND]] },
  },

  // ── Create ── the pencil lifts off the page, writes a short line, and is set
  // back down. Pivoted at the nib rather than the middle: a held pencil swings
  // about its point, and about its centre it see-saws like a metronome.
  create: {
    origin: "18% 84%",
    ty: { steps: [[-3.4, 190, OUT], [-3.4, 400], [0, 220, LAND]] },
    rot: {
      steps: [
        [-11, 190, OUT],
        [-6, 130, BOTH],
        [-13, 140, BOTH],
        [-7, 130, BOTH],
        [0, 220, LAND],
      ],
    },
    tx: {
      steps: [
        [-2.2, 190, OUT],
        [2.4, 140, BOTH],
        [-1.4, 130, BOTH],
        [1.6, 130, BOTH],
        [0, 220, LAND],
      ],
    },
  },

  // ── Workspace ── lucide's LayoutDashboard is exactly 180°-symmetric about
  // its centre: the tall left panel lands on the tall right one, the short
  // right on the short left. So half a turn leaves the glyph *identical* while
  // every panel is seen travelling to another panel's place — a real
  // rearrangement rather than a cross-fade pretending to be one. The scale dip
  // through the middle is what stops it reading as a loading spinner, and the
  // zero-length step home is free: 180° and 0° draw the same pixels.
  workspace: {
    rot: { steps: [[180, 620, TURN], [0, 0]] },
    sx: { steps: [[0.89, 310, BOTH], [1, 310, LAND]] },
    sy: { steps: [[0.89, 310, BOTH], [1, 310, LAND]] },
  },

  // ── Folders ── pulls out of the row, shuts, opens again, slides back. The
  // squash is what carries the close: swapping FolderOpen for Folder on its own
  // is a dissolve, but a dissolve under a flattening scaleY reads as a lid
  // coming down on it.
  folders: {
    tx: { steps: [[-2.3, 170, OUT], [-2.3, 480], [0, 220, LAND]] },
    ty: { steps: [[-1.8, 170, OUT], [-1.8, 480], [0, 220, LAND]] },
    swap: { delay: 170, steps: [[1, 150, BOTH], [1, 160], [0, 170, BOTH]] },
    sx: {
      delay: 170,
      steps: [[1.06, 150, BOTH], [1.06, 160], [0.96, 170, BOTH], [1, 220, LAND]],
    },
    sy: {
      delay: 170,
      steps: [[0.9, 150, BOTH], [0.9, 160], [1.06, 170, BOTH], [1, 220, LAND]],
    },
  },

  // ── Premium ── the crown grows, shivers on the spot, and sits back down. The
  // shiver is delayed past the growth so the two never cancel each other into a
  // single vague wobble.
  premium: {
    sx: { steps: [[1.22, 180, OUT], [1.22, 340], [1, 200, LAND]] },
    sy: { steps: [[1.22, 180, OUT], [1.22, 340], [1, 200, LAND]] },
    rot: {
      delay: 180,
      steps: [[-9, 70, BOTH], [8, 70, BOTH], [-7, 70, BOTH], [5, 70, BOTH], [0, 60, BOTH]],
    },
  },

  // ── Gozlin ── the disc behind the mark goes white, then gold, then back to
  // the app gradient. One value drives both layers (see `useGlowOpacity`), so
  // the hand-over between them cannot drift out of step.
  gozlin: {
    glow: { steps: [[1, 200, OUT], [1, 150], [2, 220, BOTH], [2, 180], [3, 280, IN]] },
  },
};

// ─── Recipe → animation ──────────────────────────────────────────────────────
const TRACKS = ["tx", "ty", "rot", "sx", "sy", "swap", "glow"] as const;
type TrackName = (typeof TRACKS)[number];

/** Where each track sits when nothing is playing. */
const REST: Record<TrackName, number> = {
  tx: 0,
  ty: 0,
  rot: 0,
  sx: 1,
  sy: 1,
  swap: 0,
  glow: 0,
};

/** Tracks measured in pixels, and so scaled to the glyph they are driving. */
const IN_PIXELS: Partial<Record<TrackName, true>> = { tx: true, ty: true };

function trackLength(track: Track): number {
  return track.steps.reduce((total, [, ms]) => total + ms, track.delay ?? 0);
}

/** The longest track in a recipe — i.e. how long the whole gesture runs. */
function recipeLength(recipe: Recipe): number {
  return TRACKS.reduce((longest, name) => {
    const track = recipe[name];
    return track ? Math.max(longest, trackLength(track)) : longest;
  }, 0);
}

function buildTrack(track: Track, scale: number) {
  const steps = track.steps.map(([to, ms, ease]) =>
    withTiming(to * scale, { duration: ms, easing: ease ?? BOTH }),
  );
  const run = steps.length > 1 ? withSequence(...steps) : steps[0];
  return track.delay ? withDelay(track.delay, run) : run;
}

// ─── The handle a caller holds ───────────────────────────────────────────────
export interface IconMotion {
  /** Goes on the icon's wrapper. Pair it with `origin`. */
  style: StyleProp<ViewStyle>;
  /** Static transform pivot, or undefined for the glyph's centre. */
  origin: string | undefined;
  /** Cross-fade between the primary and alternate glyph (Folders only). */
  swap: SharedValue<number>;
  /** Drives the Gozlin disc's white → gold → normal hand-over. */
  glow: SharedValue<number>;
  /** Runs the gesture once. A no-op under Reduce Motion. */
  play: () => void;
  /** Cuts it short and snaps back to rest. */
  stop: () => void;
  /** How long `play()` runs, in ms — what schedulers space their beats from. */
  duration: number;
}

/**
 * @param kind which gesture this icon performs
 * @param size the glyph's rendered size in dp, so pixel travel stays
 *             proportional between an 18dp chip and a 32dp one
 */
export function useIconMotion(kind: MotionKind, size: number): IconMotion {
  const recipe = RECIPES[kind];
  const reduced = useReducedMotion();

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const rot = useSharedValue(0);
  const sx = useSharedValue(1);
  const sy = useSharedValue(1);
  const swap = useSharedValue(0);
  const glow = useSharedValue(0);

  const values = useMemo(
    () =>
      ({ tx, ty, rot, sx, sy, swap, glow }) as Record<TrackName, SharedValue<number>>,
    [tx, ty, rot, sx, sy, swap, glow],
  );

  const scale = size / AUTHORED_AT;

  const play = useCallback(() => {
    // Reduce Motion is a system setting, not a preference to weigh against how
    // nice the gesture is: under it the icon simply stays still.
    if (reduced) return;
    for (const name of TRACKS) {
      const track = recipe[name];
      if (!track) continue;
      const value = values[name];
      cancelAnimation(value);
      value.value = buildTrack(track, IN_PIXELS[name] ? scale : 1);
    }
  }, [recipe, reduced, scale, values]);

  const stop = useCallback(() => {
    for (const name of TRACKS) {
      if (!recipe[name]) continue;
      const value = values[name];
      cancelAnimation(value);
      // Safe to snap: `stop` only ever runs as the screen is leaving or the app
      // is going away, so there is nothing left for the jump to be seen against.
      value.value = REST[name];
    }
  }, [recipe, values]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${rot.value}deg` },
      { scaleX: sx.value },
      { scaleY: sy.value },
    ],
  }));

  const duration = useMemo(() => recipeLength(recipe), [recipe]);

  return useMemo(
    () => ({ style, origin: recipe.origin, swap, glow, play, stop, duration }),
    [style, recipe.origin, swap, glow, play, stop, duration],
  );
}

// ─── Two-glyph cross-fade (Folders) ──────────────────────────────────────────
export function useSwapOpacity(swap: SharedValue<number>) {
  const front = useAnimatedStyle(() => ({ opacity: 1 - swap.value }));
  const back = useAnimatedStyle(() => ({ opacity: swap.value }));
  return { front, back };
}

// ─── Gozlin's disc (white → gold → normal) ───────────────────────────────────
/**
 * Both layers ride the one `glow` value, stacked gold-over-white over the app
 * gradient.
 *
 * White is *cut* at the hand-over rather than faded out: at glow = 2 the gold
 * above it is already fully opaque, so the step is never seen. Cross-fading the
 * two instead would put a half-white, half-gold wash over the gradient for a
 * beat, which reads as a mistake rather than as a colour change.
 */
export function useGlowOpacity(glow: SharedValue<number>) {
  const white = useAnimatedStyle(() => ({
    opacity: interpolate(
      glow.value,
      [0, 1, 1.999, 2, 3],
      [0, 1, 1, 0, 0],
      Extrapolation.CLAMP,
    ),
  }));
  const gold = useAnimatedStyle(() => ({
    opacity: interpolate(glow.value, [0, 1, 2, 3], [0, 0, 1, 0], Extrapolation.CLAMP),
  }));
  return { white, gold };
}

// ─── Ready-made icon ─────────────────────────────────────────────────────────
type Glyph = React.ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

/**
 * A lucide glyph wrapped in its gesture. Occupies exactly `size` square — the
 * same box the bare icon already occupied — so it drops into an existing chip
 * without moving anything around it.
 *
 * `AltIcon` is the second glyph a `swap` recipe cross-fades to: Folders' shut
 * folder. Both are mounted from the start; only their opacity moves.
 */
export function MotionIcon({
  motion,
  Icon,
  AltIcon,
  size,
  color,
  strokeWidth,
  style,
}: {
  motion: IconMotion;
  Icon: Glyph;
  AltIcon?: Glyph;
  size: number;
  color: string;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { front, back } = useSwapOpacity(motion.swap);
  const glyph = { color, size, strokeWidth };

  return (
    <Animated.View
      // Decorative: the card around it already carries the label and the role.
      pointerEvents="none"
      style={[
        styles.box,
        { width: size, height: size, transformOrigin: motion.origin },
        motion.style,
        style,
      ]}
    >
      {AltIcon ? (
        <>
          <Animated.View style={[styles.layer, front]}>
            <Icon {...glyph} />
          </Animated.View>
          <Animated.View style={[styles.layer, back]}>
            <AltIcon {...glyph} />
          </Animated.View>
        </>
      ) : (
        <Icon {...glyph} />
      )}
    </Animated.View>
  );
}

// ─── Play on arrival ─────────────────────────────────────────────────────────
/**
 * The beat between a screen arriving and its tab icon acknowledging it. Long
 * enough that the gesture reads as the screen *having* arrived rather than as
 * part of the transition into it — short enough to still feel like an answer.
 */
export const ARRIVAL_DELAY = 700;

/** Fires `motion` once, `delay` after `focused` goes true; cancels on leaving. */
export function usePlayOnFocus(
  motion: IconMotion,
  focused: boolean,
  delay: number = ARRIVAL_DELAY,
) {
  const { play, stop } = motion;

  useEffect(() => {
    if (!focused) {
      stop();
      return;
    }
    const timer = setTimeout(play, delay);
    return () => clearTimeout(timer);
  }, [focused, delay, play, stop]);
}

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    justifyContent: "center",
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});

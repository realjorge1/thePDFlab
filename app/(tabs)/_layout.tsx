import { GradientView } from "@/components/GradientView";
import { colors as brandColors } from "@/constants/theme";
// Every measurement the dock is built from. It lives outside this file because
// the tab screens need the same numbers: each insets its own scroll content by
// `dockHeight` so its last row clears the floating islands.
import {
  DOCK_TOP_PAD,
  type TabDockMetrics,
  useTabDockMetrics,
} from "@/hooks/useTabDock";
import { useSettings } from "@/services/settingsService";
import { useTheme } from "@/services/ThemeProvider";
// Haptics are globally disabled — this is a no-op shim (see utils/haptics.ts).
import * as Haptics from "@/utils/haptics";
import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import type { MaterialTopTabBarProps } from "@react-navigation/material-top-tabs";
import { useRouter, withLayoutContext } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  InteractionManager,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Download, Ellipsis, Home, Library, Wrench } from "lucide-react-native";

// ─── Swipeable tab navigator ─────────────────────────────────────────────────
// WhatsApp-style swipe-between-tabs is a horizontal pager, which bottom-tabs
// can't do (it's tap-only). material-top-tabs is backed by the native
// react-native-pager-view, so the swipe + page transform run entirely on the
// UI thread (smooth even when JS is busy). We pin its bar to the bottom and
// hand it the custom dock below.
const { Navigator } = createMaterialTopTabNavigator();
const MaterialTopTabs = withLayoutContext(Navigator);

// ─── Tab metadata ────────────────────────────────────────────────────────────
const TAB_META: Record<string, { title: string; Icon: typeof Home }> = {
  index: { title: "Home", Icon: Home },
  tools: { title: "Tools", Icon: Wrench },
  library: { title: "Library", Icon: Library },
  download: { title: "Download", Icon: Download },
};

const TAB_ORDER = ["index", "tools", "library", "download"] as const;

// The tab that sits by itself at the far end. Home / Tools / Library are all
// "browse what you already have"; Download is the one that brings new things
// in, so it earns its own island — the same reason Photos isolates Search.
//
// And like Photos' Search, opening it takes the whole bar: Download spreads
// leftward across the dock while the trio folds down to a single "…" square —
// each island staying at the end it already owns, so nothing crosses the dock.
// Tapping "…" unfolds it again, on the tab you came from.
const LONE_TAB = "download";
const TRIO = TAB_ORDER.filter((n) => n !== LONE_TAB);

// Air between the spread-out Download bar and the folded "…" square.
const SPREAD_GAP = 10;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ─── Motion ──────────────────────────────────────────────────────────────────
// Everything that moves on a *per-frame* basis is a translateX or an opacity,
// both composited on the GPU. The only layout values that animate are the three
// capsule widths — the two islands and the pill inside the trio — and they have
// to, because a capsule holding a label really is a different size from one
// holding a bare icon. That is three nodes springing for ~300ms on a tab change,
// not six nodes resizing continuously.
const GLIDE = { damping: 20, stiffness: 210, mass: 0.85 } as const;
// The fold between the trio and the spread-out Download bar moves a *lot* more
// width than the pill ever does, and at GLIDE's damping that much travel reads
// as slack rather than as gliding. Stated the way iOS states its own — a time to
// arrive and how much bounce is allowed on the way — and tuned the way the
// Photos bar behaves: a third of a second, and no wobble at the end of it.
const FOLD = { duration: 320, dampingRatio: 0.92 } as const;
const FADE = { duration: 170 } as const;
// Press feedback, deliberately quicker and deader than anything it can overlap:
// tapping Download starts the fold, and a springy rebound running underneath a
// fold reads as the whole dock wobbling rather than as a button being pressed.
const PRESS = { duration: 220, dampingRatio: 1 } as const;
// Whichever of the two — three tabs, or the single "…" — is leaving goes fast,
// because it has to be gone before the card has finished narrowing around it.
// The one arriving can take its time.
const SWAP_IN = { duration: 150 } as const;
const SWAP_OUT = { duration: 90 } as const;
// A label lives *inside* its capsule, but the tab it belongs to keeps gliding
// for the whole spring — so on the way out it has to be gone well before that
// move finishes, or it is briefly seen sliding past the island's edge. Fast
// out, unhurried in.
const LABEL_IN = { duration: 190 } as const;
const LABEL_OUT = { duration: 70 } as const;

// Stroke weights. The active icon sits a long way past the resting one: it is
// white-on-gradient at 22px, where a hairline reads as thin rather than as
// "selected", and the extra weight is what makes the capsule look like it
// contains the icon instead of merely sitting behind it.
const REST_STROKE = 1.9;
const ACTIVE_STROKE = 2.75;

/** Springs a value, but lands the very first real one without animating. */
function useSettled(
  target: number,
  ready: boolean,
  spring: typeof GLIDE | typeof FOLD = GLIDE,
) {
  const v = useSharedValue(target);
  const settled = useRef(false);

  useEffect(() => {
    if (!ready) {
      v.value = target;
      return;
    }
    v.value = settled.current ? withSpring(target, spring) : target;
    settled.current = true;
  }, [target, ready, spring, v]);

  return v;
}

// ─── Solid island ────────────────────────────────────────────────────────────
// Deliberately opaque. `t.card` is the one token that is a genuine step up from
// the screen behind it in all three themes — #FFF on light's #F8FAFC, #121212
// on dark's pure black, #262626 on noir's charcoal — so the island reads as a
// solid raised surface everywhere instead of a translucent smear.
function useIslandSkin(metrics: TabDockMetrics) {
  const { colors: t, mode } = useTheme();
  return {
    height: metrics.slot + metrics.pad * 2,
    borderRadius: metrics.radius,
    backgroundColor: t.card,
    borderColor: t.border,
    shadowOpacity: mode === "dark" ? 0.55 : 0.13,
  };
}

// ─── The trio's island ───────────────────────────────────────────────────────
// Home / Tools / Library, until Download takes the bar — then it folds down to
// one square holding "…", pinned to the dock's leading edge where the three
// tabs started. No second card fades in over it and nothing travels: it is the
// same island throughout, one width spring narrower, with its contents swapped.
//
// Its tabs keep the geometry they had when you left, so the fold has nothing to
// re-measure and the tab you come back to is already lit as it unfolds.
function TrioIsland({
  metrics,
  width,
  collapsed,
  ready,
  onExpand,
  children,
}: {
  metrics: TabDockMetrics;
  width: number;
  collapsed: boolean;
  ready: boolean;
  onExpand: () => void;
  children: React.ReactNode;
}) {
  const { colors: t } = useTheme();
  const { slot, pad, iconSize } = metrics;
  const skin = useIslandSkin(metrics);

  const w = useSettled(collapsed ? slot : width, ready, FOLD);
  const press = useSharedValue(1);
  const tabs = useSharedValue(collapsed ? 0 : 1);
  const more = useSharedValue(collapsed ? 1 : 0);

  useEffect(() => {
    tabs.value = withTiming(collapsed ? 0 : 1, collapsed ? SWAP_OUT : SWAP_IN);
    more.value = withTiming(collapsed ? 1 : 0, collapsed ? SWAP_IN : SWAP_OUT);
  }, [collapsed, tabs, more]);

  const islandStyle = useAnimatedStyle(() => ({ width: w.value + pad * 2 }));
  const tabsStyle = useAnimatedStyle(() => ({ opacity: tabs.value }));
  const moreStyle = useAnimatedStyle(() => ({
    opacity: more.value,
    // Arrives at 88% and grows into place as it fades up — the last of the fold
    // rather than a glyph switching on once the fold is over.
    transform: [{ scale: press.value * (0.88 + 0.12 * more.value) }],
  }));

  return (
    <Animated.View style={[styles.island, styles.leadIsland, skin, islandStyle]}>
      {/* One opacity for the pill and all three tabs, so the fold costs a single
          node rather than four. box-none keeps the tabs themselves tappable. */}
      <Animated.View
        pointerEvents={collapsed ? "none" : "box-none"}
        accessibilityElementsHidden={collapsed}
        importantForAccessibility={collapsed ? "no-hide-descendants" : "auto"}
        style={[StyleSheet.absoluteFill, tabsStyle]}
      >
        {children}
      </Animated.View>

      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel="Show Home, Tools and Library"
        accessibilityElementsHidden={!collapsed}
        importantForAccessibility={collapsed ? "auto" : "no-hide-descendants"}
        pointerEvents={collapsed ? "auto" : "none"}
        onPress={onExpand}
        onPressIn={() => {
          press.value = withSpring(0.9, PRESS);
          Haptics.selectionAsync().catch(() => {});
        }}
        onPressOut={() => {
          press.value = withSpring(1, PRESS);
        }}
        // Takes the target out to the card's own edge — folded, the island is a
        // 58pt circle, and all of it should answer to a tap.
        hitSlop={pad}
        style={[
          styles.iconBox,
          styles.moreButton,
          { width: slot, height: slot, left: pad, top: pad },
          moreStyle,
        ]}
      >
        <Ellipsis
          color={t.tabInactive}
          size={iconSize}
          strokeWidth={REST_STROKE}
        />
      </AnimatedPressable>
    </Animated.View>
  );
}

// ─── The gradient pill ───────────────────────────────────────────────────────
// One capsule that glides between the three resting places, sized to whichever
// label it is holding so the highlight is always *filled* rather than slack.
// Its position is a translateX, so the glide itself costs no layout; the width
// is the one layout value, and it springs in step with everything else.
function Pill({
  x,
  ready,
  width,
  height,
  inset,
}: {
  x: number;
  ready: boolean;
  width: number;
  height: number;
  inset: number;
}) {
  // Snaps until the labels are measured, so the pill is never seen gliding in
  // from nowhere on the first frame.
  const tx = useSettled(x, ready);
  const w = useSettled(width, ready);

  const style = useAnimatedStyle(() => ({
    width: w.value,
    transform: [{ translateX: tx.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.pill,
        { height, borderRadius: height / 2, left: inset, top: inset },
        style,
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
        style={[StyleSheet.absoluteFill, { borderRadius: height / 2 }]}
      />
    </Animated.View>
  );
}

/** The two stacked icons that cross-fade between resting and active. */
function IconPair({
  Icon,
  size,
  on,
  restColor,
}: {
  Icon: typeof Home;
  size: number;
  /** 0 = resting, 1 = active. */
  on: SharedValue<number>;
  restColor: string;
}) {
  const rest = useAnimatedStyle(() => ({ opacity: 1 - on.value }));
  const active = useAnimatedStyle(() => ({ opacity: on.value }));

  return (
    <>
      <Animated.View style={[styles.iconLayer, rest]}>
        <Icon color={restColor} size={size} strokeWidth={REST_STROKE} />
      </Animated.View>
      <Animated.View style={[styles.iconLayer, active]}>
        <Icon color="#FFFFFF" size={size} strokeWidth={ACTIVE_STROKE} />
      </Animated.View>
    </>
  );
}

// ─── One tab in the trio ─────────────────────────────────────────────────────
// Absolutely positioned and moved only by translateX, so the three never push
// each other around — each glides independently to a spot the bar worked out.
//
// The label is a plain flex child, laid out (and so *measured*) at its natural
// width rather than pinned anywhere: the row it sits in is auto-width, which is
// the only way the text gets told it has room. A resting tab therefore reaches
// further right than the square it appears to occupy, but that costs nothing —
// both platforms hit-test a child through its ancestors, so the part hanging
// past the island's rounded edge is not touchable, and inside the island the
// next tab is drawn over it and wins the touch.
function TrioTab({
  title,
  Icon,
  focused,
  x,
  ready,
  metrics,
  accessibilityLabel,
  onLabelWidth,
  onPress,
  onLongPress,
}: {
  title: string;
  Icon: typeof Home;
  focused: boolean;
  x: number;
  ready: boolean;
  metrics: TabDockMetrics;
  accessibilityLabel: string;
  onLabelWidth: (w: number) => void;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { colors: t } = useTheme();
  const { slot, pad, iconSize, labelSize } = metrics;

  const tx = useSettled(x, ready);
  const press = useSharedValue(1);
  const on = useSharedValue(focused ? 1 : 0);
  const label = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    on.value = withTiming(focused ? 1 : 0, FADE);
    label.value = withTiming(focused ? 1 : 0, focused ? LABEL_IN : LABEL_OUT);
  }, [focused, on, label]);

  const groupStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { scale: press.value }],
  }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: label.value }));

  return (
    <AnimatedPressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => {
        press.value = withSpring(0.9, PRESS);
        Haptics.selectionAsync().catch(() => {});
      }}
      onPressOut={() => {
        press.value = withSpring(1, PRESS);
      }}
      // Grows the target to the island's full height, which is as far as it can
      // usefully go: the island's bounds are what gate the touch either way.
      hitSlop={{ top: pad, bottom: pad }}
      style={[styles.group, { height: slot, left: pad, top: pad }, groupStyle]}
    >
      <View style={[styles.iconBox, { width: slot, height: slot }]}>
        <IconPair
          Icon={Icon}
          size={iconSize}
          on={on}
          restColor={t.tabInactive}
        />
      </View>

      {/* Begins exactly where the icon's square ends, so the gap between glyph
          and text is the square's own slack — the same air the capsule leaves at
          its leading edge, which is what makes the pair read as centred. */}
      <Animated.Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        onLayout={(e) => onLabelWidth(Math.ceil(e.nativeEvent.layout.width))}
        style={[
          styles.label,
          { fontSize: labelSize, lineHeight: labelSize + 4 },
          labelStyle,
        ]}
      >
        {title}
      </Animated.Text>
    </AnimatedPressable>
  );
}

// ─── The lone tab ────────────────────────────────────────────────────────────
// Its island IS its button, because the island has to grow to hold the label.
// Resting, it is a bare square at the far end of the dock. Opened, it spreads
// leftward across everything the folded "…" leaves behind — one gradient capsule
// the width of the bar, with the icon and its label riding to the centre as the
// capsule grows around them.
//
// It is pinned by its *trailing* edge, so the spread is a single width spring
// with nothing travelling: the card grows out of the corner it already sits in,
// which is the whole reason the move can be this cheap and this quick.
function LoneIsland({
  title,
  Icon,
  focused,
  ready,
  spread,
  labelW,
  metrics,
  accessibilityLabel,
  onLabelWidth,
  onPress,
  onLongPress,
}: {
  title: string;
  Icon: typeof Home;
  focused: boolean;
  ready: boolean;
  /** Inner width once opened: everything the folded "…" leaves behind. */
  spread: number;
  labelW: number;
  metrics: TabDockMetrics;
  accessibilityLabel: string;
  onLabelWidth: (w: number) => void;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { colors: t } = useTheme();
  const { slot, pad, iconSize, labelSize } = metrics;
  const skin = useIslandSkin(metrics);

  const inner = focused ? spread : slot;
  const w = useSettled(inner, ready, FOLD);
  const press = useSharedValue(1);
  const on = useSharedValue(focused ? 1 : 0);
  const label = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    on.value = withTiming(focused ? 1 : 0, FADE);
    // The label overhangs the island's left edge while it is resting, so on the
    // way out it has to clear before the island has finished shrinking past it.
    label.value = withTiming(focused ? 1 : 0, focused ? LABEL_IN : LABEL_OUT);
  }, [focused, on, label]);

  const islandStyle = useAnimatedStyle(() => ({
    width: w.value + pad * 2,
    transform: [{ scale: press.value }],
  }));
  const pillStyle = useAnimatedStyle(() => ({
    width: w.value,
    opacity: on.value,
  }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: label.value }));

  // Icon and label are pinned to the island's trailing edge, which is the right
  // place for a square and the wrong one for a bar — so they are pushed back by
  // half of whatever slack the capsule has grown, which reads as "centred" the
  // moment there is any. Derived from the width spring itself, so it is the same
  // motion rather than a second one chasing it: no extra layout, one worklet.
  const contentW = slot + labelW;
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -Math.max(0, (w.value - contentW) / 2) }],
  }));

  return (
    <AnimatedPressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => {
        // A tenth off a 46pt square is a press; a tenth off a bar the width of
        // the dock is a lurch — and it answers a tap that does nothing, since
        // the tab is already open. Scale the feedback to what is being pressed.
        press.value = withSpring(focused ? 0.985 : 0.9, PRESS);
        Haptics.selectionAsync().catch(() => {});
      }}
      onPressOut={() => {
        press.value = withSpring(1, PRESS);
      }}
      style={[styles.island, styles.trailIsland, skin, islandStyle]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.pill,
          { height: slot, borderRadius: slot / 2, right: pad, top: pad },
          pillStyle,
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
          style={[StyleSheet.absoluteFill, { borderRadius: slot / 2 }]}
        />
      </Animated.View>

      {/* row-reverse: icon anchored at the trailing edge, label unfurling to its
          left. While the island is a bare square that keeps the glyph optically
          centred in it; once it spreads, contentStyle walks the pair inward. */}
      <Animated.View
        style={[
          styles.loneContent,
          { height: slot, right: pad, top: pad },
          contentStyle,
        ]}
      >
        <View style={[styles.iconBox, { width: slot, height: slot }]}>
          <IconPair
            Icon={Icon}
            size={iconSize}
            on={on}
            restColor={t.tabInactive}
          />
        </View>

        <Animated.Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          onLayout={(e) => onLabelWidth(Math.ceil(e.nativeEvent.layout.width))}
          style={[
            styles.label,
            { fontSize: labelSize, lineHeight: labelSize + 4 },
            labelStyle,
          ]}
        >
          {title}
        </Animated.Text>
      </Animated.View>
    </AnimatedPressable>
  );
}

// ─── The dock ────────────────────────────────────────────────────────────────
function CustomTabBar({
  state,
  descriptors,
  navigation,
}: MaterialTopTabBarProps) {
  const metrics = useTabDockMetrics();
  const { slot, pad, edge } = metrics;

  // Labels are measured, never guessed, so every capsule fits exactly at any
  // font scale and in any language.
  const [labelWidths, setLabelWidths] = useState<Record<string, number>>({});
  const onLabelWidth = useCallback((name: string, w: number) => {
    setLabelWidths((prev) =>
      Math.abs((prev[name] ?? 0) - w) < 0.5 ? prev : { ...prev, [name]: w },
    );
  }, []);
  const measured = TAB_ORDER.every((n) => (labelWidths[n] ?? 0) > 0);

  // Each island is pinned to its own end of the row and sized from there, so the
  // fold is nothing but two widths changing. The row's width is the one thing
  // that has to be known rather than derived: it is what Download spreads into.
  const [rowW, setRowW] = useState(0);
  const ready = measured && rowW > 0;

  const activeName = state.routes[state.index]?.name;
  const trioIndex = TRIO.indexOf(activeName as (typeof TRIO)[number]);
  const trioActive = trioIndex >= 0;

  // ── Geometry ──
  // Every capsule in the dock is the same expression: the icon's square, the
  // label, and one `edge` of air past it. Because the icon stays centred inside
  // that square, the capsule ends up carrying (slot - iconSize) / 2 of air at
  // the leading edge and `edge` at the trailing one — set one point apart, so
  // the glyph and the text each get the room they need and the pair reads as
  // optically centred rather than shoved at the label end.
  //
  //   ┌──────────────────────────┐
  //   │ 12 │ icon │ 12 │ label │13│      slot + label + edge
  //   └──────────────────────────┘
  //
  // Sizing it per label rather than to the longest of the three is what keeps
  // the highlight *occupied*: "Home" gets a Home-shaped capsule, not a
  // Library-shaped one with the word floating inside it.
  const capsuleFor = (labelW: number) => slot + labelW + edge;

  // Which trio tab the island is dressed for. While Download has the bar the
  // island is hidden, so it simply keeps the shape it had when you left: nothing
  // resizes or slides behind the cover, and the tab you return to via "…" is
  // already highlighted as the island fades back in.
  const lastTrio = useRef(0);
  if (trioActive) lastTrio.current = trioIndex;
  const shownTrio = trioActive ? trioIndex : lastTrio.current;

  const capsuleW = capsuleFor(labelWidths[TRIO[shownTrio]] ?? 0);
  const trioW = slot * 2 + capsuleW;

  // Each tab's resting x — and the active tab's is its resting x, unchanged:
  // the capsule blooms around the icon exactly where it already sits and the
  // label unfurls to its right, so the icon you tapped never jumps. Only the
  // tabs *after* it have to step aside to make room.
  const xFor = (j: number) =>
    j > shownTrio
      ? shownTrio * slot + capsuleW + (j - shownTrio - 1) * slot
      : j * slot;

  // What Download spreads into: the row, less the folded "…" square, less the
  // air between them — and less its own padding, since this is an inner width.
  const spreadW = Math.max(slot, rowW - (slot + pad * 2) - SPREAD_GAP - pad * 2);

  const handlers = (route: (typeof state.routes)[number], focused: boolean) => ({
    onPress: () => {
      const event = navigation.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      });
      if (!focused && !event.defaultPrevented) {
        navigation.navigate(route.name, route.params);
      }
    },
    onLongPress: () => {
      navigation.emit({ type: "tabLongPress", target: route.key });
    },
  });

  const loneRoute = state.routes.find((r) => r.name === LONE_TAB);
  const loneFocused = activeName === LONE_TAB;

  // "…" is not a tab of its own — it is the way back to the one you were on
  // when you opened Download.
  const backRoute = state.routes.find((r) => r.name === TRIO[shownTrio]);

  return (
    <View
      // box-none: the transparent dock area itself is not touchable, only the
      // islands are — so the strip never swallows taps meant for the screen.
      pointerEvents="box-none"
      style={[
        styles.dockWrap,
        {
          paddingBottom: metrics.bottomPad,
          paddingHorizontal: metrics.hInset,
        },
      ]}
    >
      <View
        accessibilityRole="tablist"
        pointerEvents="box-none"
        onLayout={(e) => setRowW(Math.round(e.nativeEvent.layout.width))}
        style={[
          styles.dockRow,
          {
            height: slot + pad * 2,
            maxWidth: metrics.maxWidth,
            opacity: ready ? 1 : 0,
          },
        ]}
      >
        <TrioIsland
          metrics={metrics}
          width={trioW}
          collapsed={loneFocused}
          ready={ready}
          onExpand={backRoute ? handlers(backRoute, false).onPress : () => {}}
        >
          <Pill
            x={shownTrio * slot}
            ready={ready}
            width={capsuleW}
            height={slot}
            inset={pad}
          />
          {TRIO.map((name, j) => {
            const route = state.routes.find((r) => r.name === name);
            const meta = TAB_META[name];
            if (!route || !meta) return null;
            return (
              <TrioTab
                key={route.key}
                title={meta.title}
                Icon={meta.Icon}
                focused={j === shownTrio}
                x={xFor(j)}
                ready={ready}
                metrics={metrics}
                accessibilityLabel={
                  descriptors[route.key]?.options.tabBarAccessibilityLabel ??
                  meta.title
                }
                onLabelWidth={(w) => onLabelWidth(name, w)}
                {...handlers(route, activeName === name)}
              />
            );
          })}
        </TrioIsland>

        {loneRoute ? (
          <LoneIsland
            title={TAB_META[LONE_TAB].title}
            Icon={TAB_META[LONE_TAB].Icon}
            focused={loneFocused}
            ready={ready}
            spread={spreadW}
            labelW={labelWidths[LONE_TAB] ?? 0}
            metrics={metrics}
            accessibilityLabel={
              descriptors[loneRoute.key]?.options.tabBarAccessibilityLabel ??
              TAB_META[LONE_TAB].title
            }
            onLabelWidth={(w) => onLabelWidth(LONE_TAB, w)}
            {...handlers(loneRoute, loneFocused)}
          />
        ) : null}
      </View>
    </View>
  );
}

// ─── Tab Layout ──────────────────────────────────────────────────────────────
export default function TabLayout() {
  const { settings, isLoading } = useSettings();
  const router = useRouter();
  const hasNavigatedRef = useRef(false);

  // Handle default start screen on first load
  useEffect(() => {
    if (isLoading || hasNavigatedRef.current) return;
    hasNavigatedRef.current = true;

    const startScreen = settings.defaultStartScreen;
    if (startScreen === "home") return;

    const handle = InteractionManager.runAfterInteractions(() => {
      try {
        switch (startScreen) {
          case "library":
            router.push("/library");
            break;
          case "downloads":
            router.push("/(tabs)/download");
            break;
          case "gozlin":
            router.push("/gozlin");
            break;
          case "tools":
            router.push("/(tabs)/tools");
            break;
          case "folders":
            router.push("/folders");
            break;
          default:
            break;
        }
      } catch {
        // Fall back to home silently
      }
    });

    return () => handle.cancel();
  }, [isLoading, settings.defaultStartScreen]);

  return (
    <MaterialTopTabs
      tabBar={(props) => <CustomTabBar {...props} />}
      // Bar sits at the bottom; the swipeable pager fills the space above it.
      tabBarPosition="bottom"
      screenOptions={{
        swipeEnabled: true,
        // No `sceneStyle` bottom padding, deliberately. Padding the scene ends
        // the screen a dock-height early and leaves the navigator's own
        // background showing below it — the white-in-light / black-in-dark band
        // that used to be the tab bar. Scenes run the full height of the pager
        // instead, so every screen's background and content pass *under* the
        // floating islands, and each tab screen reserves the dock's height on
        // its own scroll content (useTabDockInset) so nothing comes to rest
        // beneath them.

        // Don't mount all four screens at startup — the Library tab is the
        // heavy app/library.tsx, so eager-mounting would risk a startup hitch.
        // Instead mount on demand but PRELOAD the adjacent tab, so the page you
        // swipe to is already rendered before your finger reaches it.
        lazy: true,
        lazyPreloadDistance: 1,
        // Guarantees we never flash a blank page: in the rare sub-second window
        // before a not-yet-mounted screen is ready, show a placeholder painted
        // in the exact theme background colour instead of empty white.
        lazyPlaceholder: () => <TabLazyPlaceholder />,
      }}
    >
      {/* Page order = swipe order: Home → Tools → Library → Download.
          A pager hard-stops at the ends, so swiping back past Home or
          forward past Download does nothing (no bounce). */}
      {TAB_ORDER.map((name) => (
        <MaterialTopTabs.Screen
          key={name}
          name={name}
          options={{ title: TAB_META[name].title }}
        />
      ))}
    </MaterialTopTabs>
  );
}

// ─── Lazy placeholder ────────────────────────────────────────────────────────
// Shown for a not-yet-mounted tab while swiping. Painted in the theme's screen
// background colour so it's indistinguishable from a real (empty) screen — the
// user never sees a blank white flash, in any theme.
function TabLazyPlaceholder() {
  const { colors: t } = useTheme();
  return (
    <View style={[styles.lazyPlaceholder, { backgroundColor: t.background }]}>
      <ActivityIndicator size="small" color={t.tabActive} />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Lifted out of the navigator's flex column and pinned to the bottom, so the
  // scenes run the full height of the pager and their own background continues
  // behind the islands. There is no bar-shaped band left to see.
  dockWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    paddingTop: DOCK_TOP_PAD,
    backgroundColor: "transparent",
  },
  dockRow: {
    width: "100%",
  },

  // Solid raised surface. No clipping anywhere, so the corner radius is drawn
  // by the platform rather than cut out of a child — which is what keeps the
  // curves clean instead of aliased.
  island: {
    position: "absolute",
    top: 0,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    elevation: 10,
  },
  // Each island is nailed to its own end of the row, so a width change grows or
  // folds it in place. Nothing in the dock ever needs to travel to make room.
  leadIsland: { left: 0 },
  trailIsland: { right: 0 },

  moreButton: {
    position: "absolute",
  },

  // No glow. A coloured shadow here has only the island's 6pt padding to fall
  // into, so any spread at all washes straight over the island's border.
  pill: {
    position: "absolute",
  },

  // Absolutely positioned children do NOT inherit the parent's padding, so
  // each one is inset explicitly — otherwise they sit flush against the border.
  group: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
  },
  loneContent: {
    position: "absolute",
    flexDirection: "row-reverse",
    alignItems: "center",
  },

  iconBox: {
    alignItems: "center",
    justifyContent: "center",
  },
  iconLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },

  label: {
    color: "#FFFFFF",
    fontWeight: "700",
    letterSpacing: 0.1,
  },

  lazyPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});

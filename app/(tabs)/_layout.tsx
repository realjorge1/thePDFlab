import { GradientView } from "@/components/GradientView";
import { colors as brandColors } from "@/constants/theme";
import { useSettings } from "@/services/settingsService";
import { useTheme } from "@/services/ThemeProvider";
import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import type { MaterialTopTabBarProps } from "@react-navigation/material-top-tabs";
import { useRouter, withLayoutContext } from "expo-router";
import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  InteractionManager,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Download, Home, Library, Wrench } from "lucide-react-native";

// ─── Swipeable tab navigator ─────────────────────────────────────────────────
// WhatsApp-style swipe-between-tabs is a horizontal pager, which bottom-tabs
// can't do (it's tap-only). material-top-tabs is backed by the native
// react-native-pager-view, so the swipe + page transform run entirely on the
// UI thread (smooth even when JS is busy). We pin its bar to the bottom and
// hand it the same CustomTabBar below, so it looks identical to before.
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

// ─── Animated Tab Item ───────────────────────────────────────────────────────
function TabItem({
  route,
  focused,
  descriptor,
  onPress,
  onLongPress,
}: {
  route: any;
  focused: boolean;
  descriptor: any;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { colors: t } = useTheme();
  const scaleAnim = useRef(new Animated.Value(focused ? 1 : 0.88)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: focused ? 1 : 0.88,
      useNativeDriver: true,
      tension: 160,
      friction: 9,
    }).start();
  }, [focused]);

  const meta = TAB_META[route.name];
  if (!meta) return null;

  const { Icon, title } = meta;
  const iconSize = 22;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      accessibilityLabel={descriptor.options.tabBarAccessibilityLabel ?? title}
      onPress={onPress}
      onLongPress={onLongPress}
      android_ripple={{ color: t.tabActive + "20", borderless: true }}
      style={styles.tabSlot}
    >
      <Animated.View
        style={[styles.tabContent, { transform: [{ scale: scaleAnim }] }]}
      >
        {/* ── Icon pill (only the icon lives inside the pill) ── */}
        {focused ? (
          <GradientView
            colors={[brandColors.gradientStart, brandColors.gradientMid]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.activePill}
          >
            <Icon color="#FFFFFF" size={iconSize} strokeWidth={2.8} />
          </GradientView>
        ) : (
          <View style={styles.inactivePill}>
            <Icon color={t.tabInactive} size={iconSize} strokeWidth={1.8} />
          </View>
        )}

        {/* ── Label sits BELOW the pill, outside it ── */}
        <Text
          style={[
            styles.tabLabel,
            focused
              ? { color: t.tabActive, fontWeight: "700" }
              : { color: t.tabInactive, fontWeight: "400" },
          ]}
          numberOfLines={1}
        >
          {title}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

// ─── Custom Tab Bar ──────────────────────────────────────────────────────────
function CustomTabBar({ state, descriptors, navigation }: MaterialTopTabBarProps) {
  const { colors: t } = useTheme();
  const insets = useSafeAreaInsets();

  // Bottom padding: respect safe area on notch devices, minimum 8px
  const bottomPad = Math.max(insets.bottom, Platform.OS === "ios" ? 20 : 8);

  return (
    <View
      style={[
        styles.tabBar,
        {
          backgroundColor: t.tabBar,
          borderTopColor: t.tabBarBorder,
          paddingBottom: bottomPad,
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const descriptor = descriptors[route.key];

        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        const onLongPress = () => {
          navigation.emit({ type: "tabLongPress", target: route.key });
        };

        return (
          <TabItem
            key={route.key}
            route={route}
            focused={focused}
            descriptor={descriptor}
            onPress={onPress}
            onLongPress={onLongPress}
          />
        );
      })}
    </View>
  );
}

// ─── Tab Layout ──────────────────────────────────────────────────────────────
export default function TabLayout() {
  const { colors: t } = useTheme();
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
        // Keep off-screen tabs mounted but frozen (no background re-renders),
        // matching the freezeOnBlur behaviour the rest of the app already uses.
        freezeOnBlur: true,
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
  /* ── Tab bar container ── */
  tabBar: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    // paddingBottom set dynamically via safe area
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },

  /* ── Each tab slot ── */
  tabSlot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
  },

  /* ── Inner column: pill + label ── */
  tabContent: {
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },

  /* ── Active: gradient pill, icon only ── */
  activePill: {
    width: 60,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  /* ── Inactive: transparent same-size container for layout stability ── */
  inactivePill: {
    width: 60,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  /* ── Label below the pill ── */
  tabLabel: {
    fontSize: 11,
    letterSpacing: 0.1,
  },

  /* ── Lazy placeholder: fills the page, theme-coloured, centred spinner ── */
  lazyPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});

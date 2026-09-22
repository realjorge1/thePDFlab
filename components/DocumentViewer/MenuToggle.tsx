/**
 * MenuToggle — the on/off switch drawn on the right of a menu row that flips a
 * setting in place (as opposed to a row that navigates or opens something).
 *
 * Drawn from Views rather than a `toggle-on` icon glyph so it reads at the size
 * a real control should be, and purely presentational: the whole menu row is
 * the touch target, so this never handles a press of its own.
 */
import React from "react";
import { StyleSheet, View } from "react-native";

import {
  type LightTheme as ThemeType,
  Palette,
} from "@/services/document-manager";

const TRACK_WIDTH = 46;
const TRACK_HEIGHT = 28;
const THUMB_SIZE = 22;
const INSET = (TRACK_HEIGHT - THUMB_SIZE) / 2;

export interface MenuToggleProps {
  on: boolean;
  theme: typeof ThemeType;
}

export function MenuToggle({ on, theme }: MenuToggleProps) {
  return (
    <View
      style={[
        styles.track,
        {
          backgroundColor: on ? Palette.primary[500] : theme.border.default,
        },
      ]}
    >
      <View
        style={[
          styles.thumb,
          // The thumb slides to the far end of the track; insetting from both
          // sides keeps the gap even whichever end it rests at.
          on ? { right: INSET } : { left: INSET },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    justifyContent: "center",
  },
  thumb: {
    position: "absolute",
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: Palette.white,
    // Lifts the thumb off the track, so the off state still reads as a switch
    // rather than a flat grey pill.
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 2,
  },
});

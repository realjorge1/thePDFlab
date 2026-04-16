/**
 * HeptagonRing
 *
 * Renders a regular 7-sided heptagon as an SVG polygon stroke with a
 * linear gradient. Drop-in replacement for the circular gradient rings
 * in FloatingAIButton and AILogoBadge.
 *
 * The component is `position: 'absolute'` so it layers inside a centred
 * flex container without displacing siblings.
 */

import React, { useMemo } from "react";
import Svg, { Defs, LinearGradient, Polygon, Stop } from "react-native-svg";

interface HeptagonRingProps {
  /**
   * Canvas size in dp. The heptagon's outermost points touch the canvas
   * edge minus half a strokeWidth so the stroke never clips.
   */
  size: number;
  /** Stroke (ring) thickness in dp. */
  strokeWidth: number;
  /** Overall opacity of the ring. Default 1. */
  opacity?: number;
  /** Gradient colour stops (minimum 2). */
  colors: string[];
  /** Gradient start in 0–1 normalised coords. Default top-left (0,0). */
  gradientStart?: { x: number; y: number };
  /** Gradient end in 0–1 normalised coords. Default bottom-right (1,1). */
  gradientEnd?: { x: number; y: number };
  /**
   * Unique ID string for the SVG <LinearGradient> element.
   * Must be unique across all rings rendered simultaneously to avoid
   * Android SVG gradient ID collisions.
   */
  gradientId: string;
}

/** Returns space-separated "x,y x,y …" polygon points for a regular heptagon. */
function heptagonPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 7 }, (_, i) => {
    // Start at top (−90°) and step clockwise
    const angle = (i / 7) * 2 * Math.PI - Math.PI / 2;
    return `${(cx + r * Math.cos(angle)).toFixed(3)},${(cy + r * Math.sin(angle)).toFixed(3)}`;
  }).join(" ");
}

export function HeptagonRing({
  size,
  strokeWidth,
  opacity = 1,
  colors,
  gradientStart = { x: 0, y: 0 },
  gradientEnd = { x: 1, y: 1 },
  gradientId,
}: HeptagonRingProps) {
  const center = size / 2;
  // Inset circumradius by half strokeWidth so the polygon stroke stays
  // entirely within the canvas (no edge clipping).
  const r = center - strokeWidth / 2;

  const pts = useMemo(
    () => heptagonPoints(center, center, r),
    [center, r],
  );

  return (
    <Svg
      width={size}
      height={size}
      style={{ position: "absolute", opacity }}
    >
      <Defs>
        <LinearGradient
          id={gradientId}
          x1={`${gradientStart.x * 100}%`}
          y1={`${gradientStart.y * 100}%`}
          x2={`${gradientEnd.x * 100}%`}
          y2={`${gradientEnd.y * 100}%`}
        >
          {colors.map((color, i) => (
            <Stop
              key={i}
              offset={`${Math.round((i / (colors.length - 1)) * 100)}%`}
              stopColor={color}
              stopOpacity={1}
            />
          ))}
        </LinearGradient>
      </Defs>
      <Polygon
        points={pts}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * CircleRing
 *
 * Renders a circular gradient ring as an SVG stroke.
 * Drop-in replacement for HeptagonRing in FloatingAIButton and AILogoBadge.
 */

import React from "react";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";

interface CircleRingProps {
  size: number;
  strokeWidth: number;
  opacity?: number;
  colors: string[];
  gradientStart?: { x: number; y: number };
  gradientEnd?: { x: number; y: number };
  gradientId: string;
}

export function CircleRing({
  size,
  strokeWidth,
  opacity = 1,
  colors,
  gradientStart = { x: 0, y: 0 },
  gradientEnd = { x: 1, y: 1 },
  gradientId,
}: CircleRingProps) {
  const center = size / 2;
  const r = center - strokeWidth / 2;

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
      <Circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={strokeWidth}
      />
    </Svg>
  );
}

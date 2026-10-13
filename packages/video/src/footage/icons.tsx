import React from "react";

/** Lucide icon paths (ISC licence, https://lucide.dev), inlined so @reel/video needs no icon package. */
type IconProps = { size: number; color: string };
const Svg: React.FC<IconProps & { strokeWidth?: number; children: React.ReactNode }> = ({ size, color, strokeWidth = 2, children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

/** Lucide "check", drawn left to right up to `progress` (0–1): pathLength 1 makes the dash offset the share drawn. */
export const CheckDraw: React.FC<IconProps & { progress: number }> = ({ progress, ...p }) => (
  <Svg {...p} strokeWidth={3}>
    <path d="M4 12l5 5L20 6" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - Math.max(0, Math.min(1, progress))} />
  </Svg>
);

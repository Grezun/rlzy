import React from "react";

/** Lucide icons (ISC licence, https://lucide.dev), inlined so @reel/video needs no icon package. */
type IconProps = { size: number; color: string };
const Svg: React.FC<IconProps & { children: React.ReactNode }> = ({ size, color, children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
export const Check: React.FC<IconProps> = (p) => <Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>;
export const ArrowDown: React.FC<IconProps> = (p) => <Svg {...p}><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></Svg>;

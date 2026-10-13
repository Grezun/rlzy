import type React from "react";

export type Glass = { background: string; blurPx: number; saturate: number; border: string; shadow: string };

/** iOS frosted glass: blurs and saturates what is behind it; the translucent fill alone keeps text readable (house-style.test). */
export function glassStyle(g: Glass): React.CSSProperties {
  const filter = `blur(${g.blurPx}px) saturate(${g.saturate})`;
  return { background: g.background, backdropFilter: filter, WebkitBackdropFilter: filter, border: `2px solid ${g.border}`, boxShadow: g.shadow };
}

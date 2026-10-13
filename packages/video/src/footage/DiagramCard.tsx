import type { Timeline, TimelineCutaway } from "@reel/core";
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { ArrowDown, Check } from "./icons";
import { popBounce, revealedCount } from "./motion";

const d = houseStyle.diagram;
type Diagram = Extract<TimelineCutaway["media"], { kind: "diagram" }>;

/** Three slow violet waves drifting across the card (ref R3 explainer panels). */
const Waves: React.FC<{ frame: number }> = ({ frame }) => (
  <svg width="100%" height="100%" viewBox="0 0 1080 1920" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, opacity: d.waveOpacity }}>
    {[520, 960, 1400].map((y, i) => (
      <path key={y} d={`M-200 ${y} Q 70 ${y - 60} 340 ${y} T 880 ${y} T 1420 ${y}`} stroke={d.wave} strokeWidth={4} fill="none" transform={`translate(${(((frame * (1 + i * 0.4)) % 540) - 270).toFixed(1)} 0)`} />
    ))}
  </svg>
);

/** Spec §6: compare (2 boxes + VS), list (check rows), flow (steps with down arrows). Items pop in one by one. */
export const DiagramCard: React.FC<{ diagram: Diagram; direction: Timeline["direction"]; compact: boolean }> = ({ diagram, direction, compact }) => {
  const frame = useCurrentFrame();
  const k = compact ? d.compactScale : 1;
  const shown = revealedCount(diagram.items.length, frame, d.itemFrames);
  const look = (i: number): React.CSSProperties => ({
    opacity: i < shown ? 1 : 0,
    transform: `scale(${(i < shown ? popBounce(frame - i * d.itemFrames, d.popFrames, 0.6) : 0.6).toFixed(4)})`,
  });
  const text: React.CSSProperties = { color: d.line, fontFamily: HEEBO, fontWeight: 800, fontSize: d.fontSize * k, lineHeight: 1.15, unicodeBidi: "isolate" };
  const box = (t: string, i: number, flex?: number) => (
    <div key={i} style={{ ...text, ...look(i), flex, border: `${d.stroke}px solid ${d.line}`, borderRadius: d.radius, padding: `${28 * k}px ${32 * k}px`, textAlign: "center" }}>{t}</div>
  );
  let body: React.ReactNode;
  if (diagram.template === "compare") {
    body = (
      <div dir={direction} style={{ display: "flex", alignItems: "center", gap: 28 * k, width: "100%" }}>
        {box(diagram.items[0], 0, 1)}
        <div style={{ ...text, ...look(1), fontSize: d.fontSize * 0.8 * k, color: d.wave }}>VS</div>
        {box(diagram.items[1], 1, 1)}
      </div>
    );
  } else if (diagram.template === "list") {
    body = (
      <div dir={direction} style={{ display: "flex", flexDirection: "column", gap: 36 * k, width: "100%" }}>
        {diagram.items.map((t, i) => (
          <div key={i} style={{ ...look(i), display: "flex", alignItems: "center", gap: 24 * k }}>
            <Check size={d.iconSize * k} color={d.line} />
            <span style={text}>{t}</span>
          </div>
        ))}
      </div>
    );
  } else {
    body = (
      <div dir={direction} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 * k, width: "100%" }}>
        {diagram.items.map((t, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <div style={look(i)}><ArrowDown size={d.iconSize * k} color={d.line} /></div> : null}
            {box(t, i)}
          </React.Fragment>
        ))}
      </div>
    );
  }
  return (
    <AbsoluteFill style={{ backgroundColor: d.bg }}>
      <Waves frame={frame} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: `${80 * k}px ${72 * k}px` }}>{body}</AbsoluteFill>
    </AbsoluteFill>
  );
};

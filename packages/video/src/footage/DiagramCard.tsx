import type { Timeline, TimelineCutaway } from "@reel/core";
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { CheckDraw } from "./icons";
import { diagramFontScale, drawProgress, springValue } from "./motion";

const d = houseStyle.diagram;
type Diagram = Extract<TimelineCutaway["media"], { kind: "diagram" }>;

/**
 * Spec §6 DiagramCard, iOS look: a white card filling its slot. list = rows with a red check circle that draws itself;
 * compare = two tiles and a red VS badge; flow = numbered red circles joined by a line that draws downward. Rows and
 * tiles flex to fill the card, and items spring in one after another.
 */
export const DiagramCard: React.FC<{ diagram: Diagram; direction: Timeline["direction"]; compact: boolean }> = ({ diagram, direction, compact }) => {
  const frame = useCurrentFrame();
  const k = compact ? d.compactScale : 1;
  const font = d.fontSize * k * diagramFontScale(diagram.items, d.fontSteps);
  const icon = d.iconSize * k;
  const at = (i: number) => frame - i * d.itemFrames;
  const enter = (i: number): React.CSSProperties => {
    const s = springValue(at(i), d.spring);
    return {
      opacity: Math.min(1, Math.max(0, s * d.opacityGain)),
      transform: `translateY(${((1 - s) * d.riseFrom * k).toFixed(2)}px) scale(${(d.itemScaleFrom + (1 - d.itemScaleFrom) * s).toFixed(4)})`,
    };
  };
  const text: React.CSSProperties = { color: d.ink, fontFamily: HEEBO, fontWeight: d.fontWeight, fontSize: font, lineHeight: 1.2, unicodeBidi: "isolate", overflowWrap: "anywhere" };
  const circle = (children: React.ReactNode, extra: React.CSSProperties = {}) => (
    <div style={{ width: icon, height: icon, borderRadius: icon / 2, background: d.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, ...extra }}>{children}</div>
  );
  const badgeText: React.CSSProperties = { ...text, color: d.onAccent, fontWeight: 800 };

  let body: React.ReactNode;
  if (diagram.template === "list") {
    body = diagram.items.map((t, i) => (
      <React.Fragment key={i}>
        {i > 0 ? <div style={{ ...enter(i), height: 2, background: d.separator, marginInlineStart: icon + 32 * k }} /> : null}
        <div style={{ ...enter(i), flex: 1, display: "flex", alignItems: "center", gap: 32 * k }}>
          {circle(<CheckDraw size={icon * 0.62} color={d.onAccent} progress={drawProgress(at(i) - d.drawDelayFrames, d.drawFrames)} />)}
          <span style={text}>{t}</span>
        </div>
      </React.Fragment>
    ));
  } else if (diagram.template === "compare") {
    const vs = springValue(at(2), d.spring);
    const tile = (t: string, i: number) => (
      <div key={i} style={{ ...enter(i), flex: 1, background: d.tile, borderRadius: d.radius * 0.7 * k, display: "flex", alignItems: "center", justifyContent: "center", padding: 28 * k, textAlign: "center" }}>
        <span style={text}>{t}</span>
      </div>
    );
    body = (
      <div style={{ flex: 1, display: "flex", alignItems: "stretch", gap: 24 * k, position: "relative" }}>
        {tile(diagram.items[0], 0)}
        {tile(diagram.items[1], 1)}
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: `translate(-50%, -50%) scale(${vs.toFixed(4)})` }}>
          {circle(<span style={{ ...badgeText, fontSize: icon * 0.36 }}>VS</span>, { boxShadow: `0 0 0 ${10 * k}px ${d.card}` })}
        </div>
      </div>
    );
  } else {
    body = diagram.items.map((t, i) => (
      <div key={i} style={{ flex: 1, display: "flex", alignItems: "stretch", gap: 32 * k }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: icon }}>
          <div style={enter(i)}>{circle(<span style={{ ...badgeText, fontSize: icon * 0.45 }}>{i + 1}</span>)}</div>
          {i < diagram.items.length - 1 ? (
            <div style={{ flex: 1, width: 6 * k, borderRadius: 3 * k, margin: `${8 * k}px 0`, background: d.accent, transformOrigin: "top", transform: `scaleY(${drawProgress(at(i) - d.drawDelayFrames, d.itemFrames).toFixed(4)})` }} />
          ) : null}
        </div>
        <div style={{ ...enter(i), flex: 1, display: "flex", alignItems: "flex-start", paddingTop: Math.max(0, (icon - font * 1.2) / 2) }}>
          <span style={text}>{t}</span>
        </div>
      </div>
    ));
  }

  const card = springValue(frame, d.spring);
  return (
    <AbsoluteFill style={{ backgroundColor: d.backdrop, padding: compact ? d.compactInset : d.inset }}>
      <div
        dir={direction}
        style={{
          flex: 1, display: "flex", flexDirection: "column", direction, background: d.card, borderRadius: d.radius * k, boxShadow: d.shadow,
          padding: compact ? d.compactPadding : d.padding, transform: `scale(${(d.cardScaleFrom + (1 - d.cardScaleFrom) * card).toFixed(4)})`,
        }}
      >
        {body}
      </div>
    </AbsoluteFill>
  );
};

import type { Timeline } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { ctaLines, popIn } from "./motion";

const k = houseStyle.cta;

/** "Comment 'KEYWORD'": white lines, the keyword in white on a tilted red sticker (look pass; no yellow). */
const Card: React.FC<{ keyword: string; timeline: Timeline }> = ({ keyword, timeline }) => {
  const frame = useCurrentFrame();
  const lines = ctaLines(keyword, timeline.language);
  const line = (text: string) =>
    text ? <div style={{ fontSize: k.smallSize, fontWeight: k.smallWeight, color: k.color, textShadow: k.shadow, unicodeBidi: "isolate" }}>{text}</div> : null;
  return (
    <AbsoluteFill style={{ background: k.scrim }}>
      <div
        dir={timeline.direction}
        style={{ position: "absolute", top: `${k.topPct}%`, left: 40, right: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, textAlign: "center", fontFamily: HEEBO, lineHeight: 1.1, direction: timeline.direction, transform: `scale(${popIn(frame, k.popFrames, k.popFrom).toFixed(4)})` }}
      >
        {line(lines.before)}
        <div
          style={{
            background: k.sticker.color, color: k.color, borderRadius: k.sticker.radius, padding: `${k.sticker.padY}px ${k.sticker.padX}px`, fontSize: k.bigSize, fontWeight: k.bigWeight,
            boxShadow: k.shadow, transform: `rotate(${k.sticker.tiltDeg}deg)`, unicodeBidi: "isolate", maxWidth: "100%", overflowWrap: "anywhere",
          }}
        >
          {lines.keyword}
        </div>
        {line(lines.after)}
      </div>
    </AbsoluteFill>
  );
};

export const CtaCard: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const ending = timeline.ending;
  if (ending?.kind !== "cta") return null;
  return (
    <Sequence from={ending.fromFrame} durationInFrames={ending.durationInFrames} layout="none">
      <Card keyword={ending.keyword} timeline={timeline} />
    </Sequence>
  );
};

import type { Timeline } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { ctaLines, popIn } from "./motion";

const k = houseStyle.cta;

const Card: React.FC<{ keyword: string; timeline: Timeline }> = ({ keyword, timeline }) => {
  const frame = useCurrentFrame();
  const lines = ctaLines(keyword, timeline.language);
  const line = (text: string, size: number, color: string) =>
    text ? <div style={{ fontSize: size, color, textShadow: k.shadow, unicodeBidi: "isolate" }}>{text}</div> : null;
  return (
    <AbsoluteFill style={{ background: k.scrim }}>
      <div
        dir={timeline.direction}
        style={{ position: "absolute", top: `${k.topPct}%`, left: 40, right: 40, textAlign: "center", fontFamily: HEEBO, fontWeight: 800, lineHeight: 1.05, direction: timeline.direction, transform: `scale(${popIn(frame, k.popFrames, k.popFrom).toFixed(4)})` }}
      >
        {line(lines.before, k.smallSize, k.color)}
        {line(lines.keyword, k.bigSize, k.keywordColor)}
        {line(lines.after, k.smallSize, k.color)}
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

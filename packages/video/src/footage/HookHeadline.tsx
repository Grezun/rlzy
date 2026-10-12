import type { Timeline } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { popIn, revealedCount } from "./motion";

const h = houseStyle.headline;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

const Headline: React.FC<{ small: string; big: string; direction: Timeline["direction"] }> = ({ small, big, direction }) => {
  const frame = useCurrentFrame();
  const smallWords = words(small);
  const bigWords = words(big);
  const all = [...smallWords, ...bigWords];
  const shown = revealedCount(all.length, frame, houseStyle.edit.headlineWordFrames);
  const word = (text: string, i: number, size: number, color: string) => {
    if (i >= shown) return null;
    const scale = popIn(frame - i * houseStyle.edit.headlineWordFrames, h.popFrames, h.popFrom);
    return (
      <span key={i} style={{ display: "inline-block", margin: "0 0.18em", transform: `scale(${scale.toFixed(4)})`, fontSize: size, color, textShadow: h.shadow, unicodeBidi: "isolate" }}>
        {text}
      </span>
    );
  };
  return (
    <div dir={direction} style={{ position: "absolute", top: `${h.topPct}%`, left: 40, right: 40, textAlign: "center", direction, fontFamily: HEEBO, fontWeight: 800, lineHeight: 1.05 }}>
      <div>{smallWords.map((t, i) => word(t, i, h.smallSize, h.smallColor))}</div>
      <div>{bigWords.map((t, j) => word(t, smallWords.length + j, h.bigSize, h.bigColor))}</div>
    </div>
  );
};

export const HookHeadline: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const headline = timeline.hook?.headline;
  if (!headline) return null;
  return (
    <AbsoluteFill>
      <Sequence from={headline.fromFrame} durationInFrames={headline.durationInFrames} layout="none">
        <Headline small={headline.small} big={headline.big} direction={timeline.direction} />
      </Sequence>
    </AbsoluteFill>
  );
};

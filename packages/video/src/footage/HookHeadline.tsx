import type { Timeline } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { glassStyle } from "./glass";
import { popIn, revealedCount } from "./motion";

const h = houseStyle.headline;
const wf = houseStyle.edit.headlineWordFrames;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/** Small line on the caption glass, big words in white on a tilted red sticker; words pop in one by one (spec §5.7). */
const Headline: React.FC<{ small: string; big: string; direction: Timeline["direction"] }> = ({ small, big, direction }) => {
  const frame = useCurrentFrame();
  const smallWords = words(small);
  const bigWords = words(big);
  const shown = revealedCount(smallWords.length + bigWords.length, frame, wf);
  const scaleAt = (i: number) => (i < shown ? popIn(frame - i * wf, h.popFrames, h.popFrom) : h.popFrom);
  // Unrevealed words keep their space (visibility: hidden), so the pill and the sticker never resize while words appear.
  const word = (text: string, i: number) => (
    <span key={i} style={{ display: "inline-block", margin: "0 0.16em", visibility: i < shown ? "visible" : "hidden", transform: `scale(${scaleAt(i).toFixed(4)})`, unicodeBidi: "isolate" }}>
      {text}
    </span>
  );
  const firstBig = smallWords.length;
  return (
    <div
      dir={direction}
      style={{ position: "absolute", top: `${h.topPct}%`, left: 40, right: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 18, textAlign: "center", direction, fontFamily: HEEBO, color: h.color, lineHeight: 1.1 }}
    >
      {smallWords.length > 0 ? (
        <div style={{ ...glassStyle(houseStyle.captions.glass), borderRadius: houseStyle.captions.radius, padding: "8px 30px", fontSize: h.smallSize, fontWeight: h.smallWeight, opacity: shown > 0 ? 1 : 0 }}>
          {smallWords.map((t, i) => word(t, i))}
        </div>
      ) : null}
      <div
        style={{
          background: h.sticker.color, borderRadius: h.sticker.radius, padding: `${h.sticker.padY}px ${h.sticker.padX}px`, fontSize: h.bigSize, fontWeight: h.bigWeight,
          boxShadow: h.shadow, maxWidth: "100%", overflowWrap: "anywhere", visibility: shown > firstBig ? "visible" : "hidden",
          transform: `rotate(${h.sticker.tiltDeg}deg) scale(${scaleAt(firstBig).toFixed(4)})`,
        }}
      >
        {bigWords.map((t, j) => word(t, firstBig + j))}
      </div>
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

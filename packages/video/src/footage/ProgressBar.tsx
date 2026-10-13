import type { Timeline } from "@reel/core";
import React from "react";
import { useCurrentFrame } from "remotion";
import { houseStyle } from "../house-style";
import { progressShare } from "./motion";

const p = houseStyle.progress;

/** Footage reels only: a thin red bar along the top edge, filling from the reading-start side (right in Hebrew). */
export const ProgressBar: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const frame = useCurrentFrame();
  if (!timeline.progressBar) return null;
  const rtl = timeline.direction === "rtl";
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: p.heightPx, background: p.track }}>
      <div
        style={{
          position: "absolute", top: 0, bottom: 0, [rtl ? "right" : "left"]: 0, background: p.color,
          width: `${(progressShare(frame, timeline.durationInFrames) * 100).toFixed(3)}%`,
          borderRadius: rtl ? `${p.radius}px 0 0 ${p.radius}px` : `0 ${p.radius}px ${p.radius}px 0`,
        }}
      />
    </div>
  );
};

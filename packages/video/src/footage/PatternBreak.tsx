import type { Timeline } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { houseStyle } from "../house-style";

/** "flash": white frames at frame 0. "zoom_hit" lives in the first speaker clip's crop (punchFrames), so nothing to draw. */
export const PatternBreak: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  if (timeline.hook?.patternBreak !== "flash") return null;
  return (
    <Sequence from={0} durationInFrames={houseStyle.edit.flashFrames} layout="none">
      <AbsoluteFill style={{ backgroundColor: houseStyle.flash.color }} />
    </Sequence>
  );
};

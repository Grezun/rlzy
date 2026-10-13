import type { Timeline } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { houseStyle } from "../house-style";

/** White flash frames: the hook's (frame 0) and every recurring "flash" break. Zoom hits and zoom blurs live on the clips. */
export const PatternBreak: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const frames = [
    ...(timeline.hook?.patternBreak === "flash" ? [0] : []),
    ...(timeline.patternBreaks ?? []).filter((b) => b.kind === "flash").map((b) => b.frame),
  ];
  return (
    <>
      {frames.map((f) => (
        <Sequence key={f} from={f} durationInFrames={houseStyle.edit.flashFrames} layout="none">
          <AbsoluteFill style={{ backgroundColor: houseStyle.flash.color }} />
        </Sequence>
      ))}
    </>
  );
};

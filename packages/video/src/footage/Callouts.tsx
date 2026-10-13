import type { Timeline, TimelineCallout } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { calloutScale } from "./motion";

const k = houseStyle.callout;
const pad = houseStyle.edit.callouts.sidePadPct;

const Badge: React.FC<{ callout: TimelineCallout; direction: Timeline["direction"] }> = ({ callout, direction }) => {
  const frame = useCurrentFrame();
  const scale = calloutScale(frame, callout.durationInFrames, k.spring, k.outFrames);
  const row: React.CSSProperties =
    callout.align === "center" ? { left: 0, right: 0, justifyContent: "center" }
    : callout.align === "left" ? { left: `${pad}%`, justifyContent: "flex-start" }
    : { right: `${pad}%`, justifyContent: "flex-end" };
  return (
    <div style={{ position: "absolute", top: `${callout.topPct}%`, display: "flex", ...row }}>
      <div
        dir={direction}
        style={{
          transform: `translateY(-50%) rotate(${k.tiltDeg}deg) scale(${scale.toFixed(4)})`, background: k.background, color: k.color, borderRadius: k.radius,
          padding: `${k.padY}px ${k.padX}px`, boxShadow: k.shadow, fontFamily: HEEBO, fontWeight: k.fontWeight, fontSize: k.fontSize, lineHeight: 1.2,
          whiteSpace: "nowrap", unicodeBidi: "isolate",
        }}
      >
        {callout.text}
      </div>
    </div>
  );
};

/** Look pass keyword callouts. compileFootage places them above or beside the face, never with a cutaway, the headline or the CTA card. */
export const Callouts: React.FC<{ timeline: Timeline }> = ({ timeline }) => (
  <AbsoluteFill>
    {(timeline.callouts ?? []).map((c, i) => (
      <Sequence key={i} from={c.fromFrame} durationInFrames={c.durationInFrames} layout="none">
        <Badge callout={c} direction={timeline.direction} />
      </Sequence>
    ))}
  </AbsoluteFill>
);

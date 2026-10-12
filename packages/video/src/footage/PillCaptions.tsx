import type { CaptionPage, Timeline } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { popIn } from "./motion";

const c = houseStyle.captions;

const PillPage: React.FC<{ page: CaptionPage; direction: Timeline["direction"] }> = ({ page, direction }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", top: `${c.topPct}%`, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
      <div
        dir={direction}
        style={{
          transform: `translateY(-50%) scale(${popIn(frame, c.popFrames, c.popFrom).toFixed(4)})`,
          maxWidth: `${c.maxWidthPct}%`,
          background: c.pillColor,
          color: c.textColor,
          borderRadius: c.radius,
          padding: `${c.padY}px ${c.padX}px`,
          fontFamily: HEEBO,
          fontWeight: 800,
          fontSize: c.fontSize,
          lineHeight: 1.25,
          textAlign: "center",
          direction,
        }}
      >
        {page.words.map((w, i) => (
          <React.Fragment key={i}>
            {i > 0 ? " " : null}
            <span style={{ color: w.emphasis ? c.emphasisColor : undefined, unicodeBidi: "isolate" }}>{w.text}</span>
          </React.Fragment>
        ))}
        {page.emoji ? <span style={{ unicodeBidi: "isolate" }}> {page.emoji}</span> : null}
      </div>
    </div>
  );
};

/** The footage caption preset "pill": rendered last in Reel, above every other layer, so it survives cuts. */
export const PillCaptions: React.FC<{ timeline: Timeline }> = ({ timeline }) => (
  <AbsoluteFill>
    {(timeline.captions.pages ?? []).map((page, i) => (
      <Sequence key={i} from={page.fromFrame} durationInFrames={page.durationInFrames} layout="none">
        <PillPage page={page} direction={timeline.direction} />
      </Sequence>
    ))}
  </AbsoluteFill>
);

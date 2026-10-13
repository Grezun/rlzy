import type { CaptionPage, Timeline } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { glassStyle } from "./glass";
import { activeWordIndex, captionHideRanges, emojiScale, popBounce, visiblePages, wordPulse } from "./motion";

const c = houseStyle.captions;

/** One page on an iOS glass pill: white text, the spoken word red with a pulse, Claude's emphasis word on a red capsule. */
const PillPage: React.FC<{ page: CaptionPage; startAt: number; direction: Timeline["direction"] }> = ({ page, startAt, direction }) => {
  const frame = useCurrentFrame();
  const abs = startAt + frame;
  const active = activeWordIndex(page.words, abs);
  const emojiAt = page.words.at(-1)?.startFrame ?? startAt;
  const e = c.emphasis;
  return (
    <div style={{ position: "absolute", top: `${page.topPct ?? c.topPct}%`, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
      <div
        dir={direction}
        style={{
          ...glassStyle(c.glass),
          transform: `translateY(-50%) scale(${popBounce(frame, c.popFrames, c.popFrom).toFixed(4)})`,
          opacity: Math.min(1, (frame + 1) / c.fadeFrames),
          maxWidth: `${c.maxWidthPct}%`, color: c.textColor, borderRadius: c.radius, padding: `${c.padY}px ${c.padX}px`,
          fontFamily: HEEBO, fontWeight: c.fontWeight, fontSize: c.fontSize, lineHeight: 1.25, textAlign: "center", direction, textShadow: c.textShadow,
        }}
      >
        {page.words.map((w, i) => {
          const on = i === active;
          const scale = on ? wordPulse(abs - (w.startFrame ?? startAt), c.activeWord.upFrames, c.activeWord.downFrames, c.activeWord.peak) : 1;
          return (
            <React.Fragment key={i}>
              {i > 0 ? " " : null}
              <span
                style={{
                  display: "inline-block", unicodeBidi: "isolate", transform: `scale(${scale.toFixed(4)})`,
                  ...(w.emphasis
                    ? { background: e.background, color: e.color, fontWeight: e.fontWeight, borderRadius: e.radius, padding: `0 ${e.padX}px`, textShadow: "none" }
                    : on ? { color: c.activeWord.color } : {}),
                }}
              >
                {w.text}
              </span>
            </React.Fragment>
          );
        })}
        {page.emoji ? (
          <span style={{ unicodeBidi: "isolate", display: "inline-block", marginInlineStart: "0.25em", transform: `scale(${emojiScale(abs - emojiAt, c.emoji.popFrames, c.emoji.overshoot).toFixed(4)})` }}>
            {page.emoji}
          </span>
        ) : null}
      </div>
    </div>
  );
};

/**
 * The footage caption preset "pill": rendered above the clips, cutaways and callouts, so it survives cuts. It gives way to the hook
 * headline and the CTA card (those show bigger text); the SRT keeps every page.
 */
export const PillCaptions: React.FC<{ timeline: Timeline }> = ({ timeline }) => (
  <AbsoluteFill>
    {visiblePages(timeline.captions.pages ?? [], captionHideRanges(timeline), c.minVisibleFrames).map((page, i) => (
      <Sequence key={i} from={page.fromFrame} durationInFrames={page.durationInFrames} layout="none">
        <PillPage page={page} startAt={page.fromFrame} direction={timeline.direction} />
      </Sequence>
    ))}
  </AbsoluteFill>
);

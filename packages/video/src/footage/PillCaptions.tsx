import type { CaptionPage, Timeline } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { activeWordIndex, captionHideRanges, emojiScale, popBounce, visiblePages, wordPop } from "./motion";

const c = houseStyle.captions;

const PillPage: React.FC<{ page: CaptionPage; startAt: number; direction: Timeline["direction"] }> = ({ page, startAt, direction }) => {
  const frame = useCurrentFrame();
  const abs = startAt + frame;
  const active = activeWordIndex(page.words, abs);
  const emojiAt = page.words.at(-1)?.startFrame ?? startAt;
  return (
    <div style={{ position: "absolute", top: `${page.topPct ?? c.topPct}%`, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
      <div
        dir={direction}
        style={{
          transform: `translateY(-50%) scale(${popBounce(frame, c.popFrames, c.popFrom).toFixed(4)})`,
          maxWidth: `${c.maxWidthPct}%`, background: c.pillColor, color: c.textColor, borderRadius: c.radius,
          padding: `${c.padY}px ${c.padX}px`, fontFamily: HEEBO, fontWeight: 800, fontSize: c.fontSize, lineHeight: 1.25, textAlign: "center", direction,
        }}
      >
        {page.words.map((w, i) => {
          const on = i === active;
          const pop = on ? wordPop(abs - (w.startFrame ?? startAt), c.activeWord.popFrames, c.activeWord.peak) : 1;
          return (
            <React.Fragment key={i}>
              {i > 0 ? " " : null}
              <span
                style={{
                  color: w.emphasis ? c.emphasisColor : undefined, unicodeBidi: "isolate", display: "inline-block",
                  transform: `scale(${pop.toFixed(4)})`,
                  ...(on ? { background: c.activeWord.highlight, borderRadius: c.activeWord.radius, padding: `0 ${c.activeWord.padX}px`, margin: `0 -${c.activeWord.padX}px` } : {}),
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
 * The footage caption preset "pill": rendered last in Reel, so it survives cuts. It gives way to the hook headline and
 * the CTA card (those show bigger text); the SRT keeps every page.
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

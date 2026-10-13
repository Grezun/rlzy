import type { Timeline, TimelineCutaway } from "@reel/core";
import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";
import { houseStyle } from "../house-style";
import { DiagramCard } from "./DiagramCard";
import { kenBurnsScale } from "./motion";

const k = houseStyle.cutaway;
type Media = Exclude<TimelineCutaway["media"], { kind: "diagram" }>;

const MediaEl: React.FC<{ media: Media; fit: "cover" | "contain" }> = ({ media, fit }) => {
  const style: React.CSSProperties = { width: "100%", height: "100%", objectFit: fit };
  return media.kind === "image" ? <Img src={media.src} style={style} /> : <OffthreadVideo src={media.src} muted style={style} />;
};

/** Hard cut in and out (spec §6); stills get the Ken Burns zoom; misfit uploads show whole over a blurred fill. */
const MediaSlot: React.FC<{ media: Media; durationInFrames: number }> = ({ media, durationInFrames }) => {
  const frame = useCurrentFrame();
  const zoom = media.kind === "image" ? `scale(${kenBurnsScale(frame, durationInFrames, media.kenBurns).toFixed(4)})` : undefined;
  if (media.fit === "cover") {
    return <AbsoluteFill style={{ transform: zoom }}><MediaEl media={media} fit="cover" /></AbsoluteFill>;
  }
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${k.fillScale})`, filter: `blur(${k.blurPx}px) brightness(${1 - k.dim})` }}><MediaEl media={media} fit="cover" /></AbsoluteFill>
      <AbsoluteFill style={{ transform: zoom }}><MediaEl media={media} fit="contain" /></AbsoluteFill>
    </AbsoluteFill>
  );
};

const Slot: React.FC<{ cutaway: TimelineCutaway; direction: Timeline["direction"] }> = ({ cutaway, direction }) => {
  const split = cutaway.layout === "split";
  // Split: the top half (seam at y = 0.50); the speaker clip underneath draws the bottom half.
  const frame: React.CSSProperties = { position: "absolute", top: 0, left: 0, width: "100%", height: split ? "50%" : "100%", overflow: "hidden", backgroundColor: "#000000" };
  return (
    <div style={frame}>
      {cutaway.media.kind === "diagram"
        ? <DiagramCard diagram={cutaway.media} direction={direction} compact={split} />
        : <MediaSlot media={cutaway.media} durationInFrames={cutaway.durationInFrames} />}
    </div>
  );
};

export const Cutaways: React.FC<{ timeline: Timeline }> = ({ timeline }) => (
  <>
    {(timeline.cutaways ?? []).map((c) => (
      <Sequence key={`${c.id}@${c.fromFrame}`} from={c.fromFrame} durationInFrames={c.durationInFrames} layout="none">
        <Slot cutaway={c} direction={timeline.direction} />
      </Sequence>
    ))}
  </>
);

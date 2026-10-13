import type { Timeline, TimelineCutaway } from "@reel/core";
import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";
import { houseStyle } from "../house-style";
import { DiagramCard } from "./DiagramCard";
import { cutawayMotion, kenBurnsTransform, parallaxFill } from "./motion";

const k = houseStyle.cutaway;
type Media = Exclude<TimelineCutaway["media"], { kind: "diagram" }>;
const NO_DRIFT = { x: 0, y: 0 };

const MediaEl: React.FC<{ media: Media; fit: "cover" | "contain" }> = ({ media, fit }) => {
  const style: React.CSSProperties = { width: "100%", height: "100%", objectFit: fit };
  return media.kind === "image" ? <Img src={media.src} style={style} /> : <OffthreadVideo src={media.src} muted style={style} />;
};

/** Stills zoom and drift (Ken Burns); misfit uploads show whole over a blurred fill that drifts the other way (parallax). */
const MediaSlot: React.FC<{ media: Media; durationInFrames: number }> = ({ media, durationInFrames }) => {
  const frame = useCurrentFrame();
  const drift = media.kind === "image" ? (media.drift ?? NO_DRIFT) : NO_DRIFT;
  const zoom = media.kind === "image" ? kenBurnsTransform(frame, durationInFrames, media.kenBurns, drift) : undefined;
  if (media.fit === "cover") {
    return <AbsoluteFill style={{ transform: zoom }}><MediaEl media={media} fit="cover" /></AbsoluteFill>;
  }
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: parallaxFill(frame, durationInFrames, k.fillScale, drift), filter: `blur(${k.blurPx}px) brightness(${1 - k.dim})` }}><MediaEl media={media} fit="cover" /></AbsoluteFill>
      <AbsoluteFill style={{ transform: zoom }}><MediaEl media={media} fit="contain" /></AbsoluteFill>
    </AbsoluteFill>
  );
};

/** One cutaway: full screen or the top half (seam at y = 0.50), entering and leaving with its transition (spec §5.4). */
const Slot: React.FC<{ cutaway: TimelineCutaway; direction: Timeline["direction"] }> = ({ cutaway, direction }) => {
  const frame = useCurrentFrame();
  const split = cutaway.layout === "split";
  const m = cutawayMotion(cutaway.transition, frame, cutaway.durationInFrames, direction, k.transition);
  return (
    <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: split ? "50%" : "100%", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute", inset: 0, backgroundColor: "#000000", opacity: m.opacity,
          transform: `translate(${m.x.toFixed(3)}%, ${m.y.toFixed(3)}%) scale(${m.scale.toFixed(4)})`,
          ...(m.blurPx > 0 ? { filter: `blur(${m.blurPx.toFixed(2)}px)` } : {}),
        }}
      >
        {cutaway.media.kind === "diagram"
          ? <DiagramCard diagram={cutaway.media} direction={direction} compact={split} />
          : <MediaSlot media={cutaway.media} durationInFrames={cutaway.durationInFrames} />}
      </div>
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

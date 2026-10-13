import type { TimelineClip } from "@reel/core";
import React from "react";
import { AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";
import { houseStyle } from "../house-style";
import { enterEffect, speakerTransform } from "./motion";

/** A segment of the working copy with a face-centred zoom. Muted: the voice is one pre-cut track. */
export const SpeakerShot: React.FC<{ clip: TimelineClip }> = ({ clip }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!clip.src || !clip.source || !clip.crop) return <AbsoluteFill style={{ backgroundColor: "#000000" }} />;
  const fx = enterEffect(clip.enter, frame, houseStyle.motion);
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000000" }}>
      <AbsoluteFill style={{ transform: speakerTransform(clip.crop, frame, clip.durationInFrames, fx.scale), ...(fx.blurPx > 0 ? { filter: `blur(${fx.blurPx.toFixed(2)}px)` } : {}) }}>
        <OffthreadVideo src={clip.src} muted trimBefore={Math.round((clip.source.inMs / 1000) * fps)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

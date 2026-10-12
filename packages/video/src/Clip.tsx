import type { TimelineClip } from "@reel/core";
import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame } from "remotion";
import { enterStyle, motionTransform } from "./motion";

const FILL: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

/** The voice-reel media for a clip, or null for the palette gradient. Speaker clips are drawn by SpeakerShot, never here. */
function clipMedia(clip: TimelineClip): React.ReactNode {
  const kind = clip.kind;
  switch (kind) {
    case "video":
      return clip.src ? <OffthreadVideo src={clip.src} muted style={FILL} /> : null;
    case "image":
      return clip.src ? <Img src={clip.src} style={FILL} /> : null;
    case "graphic":
      return null;
    case "speaker":
      throw new Error(`Clip ${clip.sceneId} is a speaker clip: Reel draws it with SpeakerShot.`);
    default:
      return kind satisfies never;
  }
}

export const Clip: React.FC<{ clip: TimelineClip; palette: string[] }> = ({ clip, palette }) => {
  const frame = useCurrentFrame();
  const media = clipMedia(clip) ?? (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${palette[0]} 0%, ${palette[1] ?? "#111111"} 100%)` }} />
  );
  return (
    <AbsoluteFill style={enterStyle(clip.transitionIn, frame)}>
      <AbsoluteFill style={{ transform: motionTransform(clip.motion, frame, clip.durationInFrames) }}>{media}</AbsoluteFill>
    </AbsoluteFill>
  );
};

import type { Timeline, TimelineClip } from "@reel/core";
import React from "react";
import { AbsoluteFill, Audio, Sequence } from "remotion";
import { Captions } from "./Captions";
import { Clip } from "./Clip";
import { CtaCard } from "./footage/CtaCard";
import { HookHeadline } from "./footage/HookHeadline";
import { PatternBreak } from "./footage/PatternBreak";
import { PillCaptions } from "./footage/PillCaptions";
import { SfxCues } from "./footage/SfxCues";
import { SpeakerShot } from "./footage/SpeakerShot";
import { TRANSITION_FRAMES } from "./motion";
import { Overlays } from "./Overlays";

export type ReelProps = { timeline: Timeline };

/** Exhaustive on clip kind: a new kind must be routed here, never fall through to the voice-reel Clip. */
function ClipLayer({ clip, palette }: { clip: TimelineClip; palette: string[] }) {
  const kind = clip.kind;
  switch (kind) {
    case "speaker":
      return <SpeakerShot clip={clip} />;
    case "video":
    case "image":
    case "graphic":
      return <Clip clip={clip} palette={palette} />;
    default:
      return kind satisfies never;
  }
}

/** Exhaustive on caption preset: "pill" is the footage page layout, the rest are the voice-reel word captions. */
function CaptionLayer({ timeline }: { timeline: Timeline }) {
  const preset = timeline.style.captionPreset;
  switch (preset) {
    case "pill":
      return <PillCaptions timeline={timeline} />;
    case "bold_pop":
    case "clean":
      return <Captions timeline={timeline} preset={preset} />;
    default:
      return preset satisfies never;
  }
}

export const Reel: React.FC<ReelProps> = ({ timeline }) => {
  const { clips, audio } = timeline;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {clips.map((clip, i) => {
        // Keep the outgoing clip visible while the next one animates in on top, so cuts stay on the audio beat.
        const next = clips[i + 1];
        const overlap = next && next.transitionIn !== "cut" ? TRANSITION_FRAMES : 0;
        return (
          <Sequence key={clip.sceneId} from={clip.fromFrame} durationInFrames={clip.durationInFrames + overlap}>
            <ClipLayer clip={clip} palette={timeline.style.palette} />
          </Sequence>
        );
      })}
      <Overlays timeline={timeline} />
      <HookHeadline timeline={timeline} />
      <CtaCard timeline={timeline} />
      <PatternBreak timeline={timeline} />
      <CaptionLayer timeline={timeline} />
      <SfxCues timeline={timeline} />
      {audio.voiceUrl ? <Audio src={audio.voiceUrl} /> : null}
      {audio.musicUrl ? <Audio src={audio.musicUrl} loop volume={Math.pow(10, audio.musicDuckingDb / 20)} /> : null}
    </AbsoluteFill>
  );
};

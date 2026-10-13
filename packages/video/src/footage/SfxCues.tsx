import type { Timeline } from "@reel/core";
import React from "react";
import { Audio, Sequence } from "remotion";

export const SfxCues: React.FC<{ timeline: Timeline }> = ({ timeline }) => (
  <>
    {(timeline.sfx ?? []).map((cue, i) => (
      <Sequence key={i} from={cue.frame} layout="none">
        <Audio src={cue.src} volume={Math.pow(10, cue.volumeDb / 20)} />
      </Sequence>
    ))}
  </>
);

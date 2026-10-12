import { RawFaceTrackSchema, smoothFaceTrack, type FaceTrack } from "@reel/core";
import { faceHelperAvailable, runFaceHelper } from "@reel/media";

/** `model` is part of the face-track cache key, so a fake (no-face) track never answers for the real tracker. */
export type FaceTracker = { readonly model: string; track(videoPath: string): Promise<FaceTrack> };
const VISION = "vision/face-rectangles-v1";

/** Pass the conformed working copy: the Swift helper ignores rotation metadata. */
export const visionFaceTracker = (): FaceTracker => ({
  model: VISION,
  async track(video) {
    return smoothFaceTrack(RawFaceTrackSchema.parse(await runFaceHelper(video)));
  },
});

/** Fake worker without the Swift binary: no faces, so every crop is centred. */
export const noFaceTracker: FaceTracker = { model: "fake/no-face", track: async () => ({ intervalMs: 100, samples: [] }) };

export function createFaceTracker(mode: "real" | "fake", helperAvailable = faceHelperAvailable()): FaceTracker {
  if (helperAvailable) return visionFaceTracker();
  if (mode === "fake") return noFaceTracker;
  return {
    model: VISION,
    track: async () => {
      throw new Error('face-helper is not built on this worker. Run "npm run build:face-helper" (needs Xcode command line tools), then retry.');
    },
  };
}

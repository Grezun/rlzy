import { makeEllipseMatte, makeMatte, MATTE_MODEL, segmentHelperAvailable } from "@reel/media";

/** Makes the speaker's matte from the working copy. `model` is part of the matte cache key (fake and real never mix). */
export type Segmenter = { readonly model: string; matte(videoPath: string, faceTrackPath: string, out: string): Promise<void> };

/** Mean coverage below this means Vision found nobody, or almost nobody (spec §7: segmentation fails). */
export const MIN_MATTE_COVERAGE = 0.03;
const LENGTH_TOLERANCE_MS = 100;

export class SegmenterMissingError extends Error {
  constructor() {
    super('the cut-out tool isn\'t built on this worker. Run "npm run build:segment-helper" on the worker Mac, then upload the video again');
    this.name = "SegmenterMissingError";
  }
}

export const visionSegmenter = (): Segmenter => ({ model: MATTE_MODEL, matte: (video, faces, out) => makeMatte(video, out, { faces }) });

/** Fake worker without the Swift binary: a still head-and-shoulders shape, so the whole background flow is free to try. */
export const fakeSegmenter: Segmenter = { model: "fake/matte-ellipse", matte: (video, _faces, out) => makeEllipseMatte(video, out) };

export function createSegmenter(mode: "real" | "fake", helperAvailable = segmentHelperAvailable()): Segmenter {
  if (helperAvailable) return visionSegmenter();
  if (mode === "fake") return fakeSegmenter;
  return { model: MATTE_MODEL, matte: async () => { throw new SegmenterMissingError(); } };
}

/** Why a made matte can't be used (completing "Background replacement is off for this video: …"), or null. */
export function cutoutProblem(coverage: number, matteMs: number, videoMs: number): string | null {
  if (Math.abs(matteMs - videoMs) > LENGTH_TOLERANCE_MS) return "the cut-out doesn't match the video's length";
  if (coverage < MIN_MATTE_COVERAGE) return "the cut-out couldn't find you in the picture";
  return null;
}

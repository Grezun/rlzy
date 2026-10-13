import { describe, expect, it } from "vitest";
import { createSegmenter, cutoutProblem, fakeSegmenter, SegmenterMissingError } from "./segmenter";

describe("segmenter", () => {
  it("uses Apple Vision when the helper is built, the fake ellipse on a fake worker without it, and a plain error on a real one", async () => {
    expect(createSegmenter("real", true).model).toBe("vision/person-segmentation-accurate-v1");
    expect(createSegmenter("fake", false)).toBe(fakeSegmenter);
    const missing = createSegmenter("real", false);
    expect(missing.model).toBe("vision/person-segmentation-accurate-v1");
    await expect(missing.matte("v", "f", "o")).rejects.toThrow(SegmenterMissingError);
    await expect(missing.matte("v", "f", "o")).rejects.toThrow('the cut-out tool isn\'t built on this worker. Run "npm run build:segment-helper" on the worker Mac, then upload the video again');
  });
  it("refuses a matte that covers almost nothing or doesn't match the video's length", () => {
    expect(cutoutProblem(0.25, 6000, 6033)).toBeNull();
    expect(cutoutProblem(0.02, 6000, 6000)).toBe("the cut-out couldn't find you in the picture");
    expect(cutoutProblem(0.25, 5000, 6000)).toBe("the cut-out doesn't match the video's length");
  });
});

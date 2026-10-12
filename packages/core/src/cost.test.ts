import { describe, expect, it } from "vitest";
import { assertWithinCap, DEFAULT_COST_TABLE, estimateCost, estimateFootageCost, estimateReelSeconds, estimateSceneSeconds, MUSIC_MIN_MS, musicBillSeconds, videoBillSeconds } from "./cost";
import { SpendCapError, UnknownCostModelError } from "./errors";
import { parseStoryboard } from "./schema/storyboard";
import { validStoryboard } from "./testing/fixtures";

const MODELS = {
  image: "higgsfield-ai/soul/v2/standard",
  video: "bytedance/seedance-2.5/image-to-video",
  voice: "elevenlabs/eleven_v4",
};

describe("cost", () => {
  it("videoBillSeconds clamps to the 4–30 s integer range Seedance accepts", () => {
    expect(videoBillSeconds(1.2)).toBe(4);
    expect(videoBillSeconds(6.1)).toBe(7);
    expect(videoBillSeconds(45)).toBe(30);
  });

  it("estimateSceneSeconds is at least 2 s and grows with words", () => {
    expect(estimateSceneSeconds("hi", "en")).toBe(2);
    expect(estimateSceneSeconds(Array(26).fill("w").join(" "), "en")).toBeCloseTo(10, 0);
  });

  it("charges image scenes one image, broll one image plus video seconds, graphic nothing, voice per char", () => {
    const input = validStoryboard();
    input.scenes[1].visual = { kind: "broll_video", prompt: "city", motion: "none" } as never;
    const est = estimateCost(parseStoryboard(input), MODELS, {
      [MODELS.image]: { perImage: 0.1 },
      [MODELS.video]: { perSecond: 0.05 },
      [MODELS.voice]: { per1kChars: 1 },
    });
    const items = est.lines.map((l) => l.item);
    expect(items).toEqual(["image s1", "image s2", "video s2", "voice"]);
    expect(est.lines[2].quantity).toBe(4);
    expect(est.totalUsd).toBeCloseTo(0.1 + 0.1 + 0.2 + (est.lines[3].quantity / 1000) * 1, 5);
  });

  it("throws UnknownCostModelError when a model has no price", () => {
    expect(() => estimateCost(parseStoryboard(validStoryboard()), { ...MODELS, image: "nope" }, {})).toThrow(
      UnknownCostModelError,
    );
  });

  it("assertWithinCap throws SpendCapError over the cap", () => {
    expect(() => assertWithinCap({ totalUsd: 11, lines: [] }, 10)).toThrow(SpendCapError);
    expect(() => assertWithinCap({ totalUsd: 9, lines: [] }, 10)).not.toThrow();
  });
});

describe("footage cost", () => {
  it("prices AI music per started second; no music and library music cost nothing", () => {
    expect(estimateFootageCost({ music: { kind: "ai", prompt: "x" } }, 7.3)).toBeCloseTo(0.08, 9);
    expect(estimateFootageCost({ music: { kind: "none" } }, 7.3)).toBe(0);
    expect(estimateFootageCost({ music: { kind: "library", assetId: "6f1c2b9e-3a4d-4e5f-8a7b-1c2d3e4f5a6b" } }, 7.3)).toBe(0);
  });

  it("throws UnknownCostModelError for AI music when the table has no price for it", () => {
    expect(() => estimateFootageCost({ music: { kind: "ai", prompt: "x" } }, 7.3, {})).toThrow(UnknownCostModelError);
    expect(DEFAULT_COST_TABLE["elevenlabs/scribe_v2"].perSecond).toBeCloseTo(0.4 / 3600, 12);
  });

  it("estimateReelSeconds is the one billable-seconds rule: whole seconds, rounded up from the exact length", () => {
    // 211 frames = 7033.3 ms: rounding to 0.1 s first (7.0) then ceil would bill 7 s; the rule bills 8 s.
    expect(estimateReelSeconds((211 * 1000) / 30)).toBe(8);
    expect(Math.ceil(Math.round((211 * 1000) / 30 / 100) / 10)).toBe(7);
    expect(estimateReelSeconds(7000)).toBe(7);
    expect(estimateReelSeconds((210 * 1000) / 30)).toBe(7); // float noise around a whole second is not a started second
    expect(estimateReelSeconds(7001)).toBe(8);
    expect(estimateFootageCost({ music: { kind: "ai", prompt: "x" } }, estimateReelSeconds((211 * 1000) / 30))).toBeCloseTo(0.08, 9);
  });

  it("bills AI music for at least the provider's 3 s minimum, so a short reel's estimate covers what is billed", () => {
    expect(MUSIC_MIN_MS).toBe(3000);
    expect(musicBillSeconds(estimateReelSeconds(1200))).toBe(3);
    expect(musicBillSeconds(estimateReelSeconds(3001))).toBe(4);
    expect(estimateFootageCost({ music: { kind: "ai", prompt: "x" } }, estimateReelSeconds(1200))).toBeCloseTo(0.03, 9);
  });
});

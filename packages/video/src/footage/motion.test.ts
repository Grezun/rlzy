import { describe, expect, it } from "vitest";
import { activeWordIndex, ctaLines, emojiScale, enterEffect, popBounce, popIn, kenBurnsScale, revealedCount, speakerTransform, splitTransform, visiblePages, wordPulse } from "./motion";

describe("speakerTransform", () => {
  const punch = { cx: 0.5, cy: 0.4, scaleFrom: 1, scaleTo: 1.3, punchFrames: 6 };
  it("punches in over punchFrames and holds, moving the face centre towards the frame centre", () => {
    // At scale 1 there is no room to move; the centre is clamped per frame so no frame edge shows.
    expect(speakerTransform(punch, 0, 45)).toBe("scale(1.0000) translate(0.000%, 0.000%)");
    expect(speakerTransform(punch, 3, 45)).toBe("scale(1.1500) translate(0.000%, 6.522%)");
    expect(speakerTransform(punch, 6, 45)).toBe("scale(1.3000) translate(0.000%, 10.000%)");
    expect(speakerTransform(punch, 40, 45)).toBe("scale(1.3000) translate(0.000%, 10.000%)");
  });
  it("pushes in linearly across the clip and resets on the next clip", () => {
    const push = { cx: 0.6, cy: 0.5, scaleFrom: 1, scaleTo: 1.08 };
    expect(speakerTransform(push, 0, 61)).toBe("scale(1.0000) translate(0.000%, 0.000%)");
    expect(speakerTransform(push, 60, 61)).toBe("scale(1.0800) translate(-3.704%, 0.000%)");
  });
  it("never shows a frame edge: |translate| ≤ (1 − 1/s) / 2 on both axes, every frame, any crop", () => {
    const grid = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1];
    const scales = [1, 1.08, 1.15, 1.25, 1.3];
    for (const cx of grid)
      for (const cy of grid)
        for (const scaleFrom of scales)
          for (const scaleTo of scales.filter((s) => s >= scaleFrom))
            for (const punchFrames of [undefined, 6]) {
              const crop = { cx, cy, scaleFrom, scaleTo, ...(punchFrames ? { punchFrames } : {}) };
              for (let frame = 0; frame < 30; frame++) {
                const m = speakerTransform(crop, frame, 30).match(/^scale\(([\d.]+)\) translate\((-?[\d.]+)%, (-?[\d.]+)%\)$/);
                expect(m).not.toBeNull();
                const [s, tx, ty] = m!.slice(1).map(Number);
                const limit = ((1 - 1 / s) / 2) * 100 + 0.005; // the 4-decimal scale and 3-decimal translate are rounded (< 0.1 px)
                expect(Math.abs(tx)).toBeLessThanOrEqual(limit);
                expect(Math.abs(ty)).toBeLessThanOrEqual(limit);
              }
            }
  });
});

describe("caption, headline and CTA helpers", () => {
  it("pops from 90 % to 100 % over 4 frames", () => {
    expect(popIn(0, 4, 0.9)).toBeCloseTo(0.9);
    expect(popIn(4, 4, 0.9)).toBeCloseTo(1);
    expect(popIn(10, 4, 0.9)).toBeCloseTo(1);
  });
  it("reveals one headline word every 6 frames", () => {
    expect([0, 5, 6, 12, 18, 100].map((f) => revealedCount(4, f, 6))).toEqual([1, 1, 2, 3, 4, 4]);
  });
  it("words the CTA per language", () => {
    expect(ctaLines("AI", "he")).toEqual({ before: "תכתבו", keyword: "'AI'", after: "בתגובות" });
    expect(ctaLines("AI", "en")).toEqual({ before: "Comment", keyword: "'AI'", after: "" });
  });
});

describe("caption visibility under the headline and the CTA card", () => {
  it("cuts the hidden ranges out of each page and drops what is left under 8 frames", () => {
    const pages = [{ fromFrame: 0, durationInFrames: 30 }, { fromFrame: 50, durationInFrames: 30 }, { fromFrame: 58, durationInFrames: 6 }, { fromFrame: 80, durationInFrames: 20 }, { fromFrame: 100, durationInFrames: 40 }];
    expect(visiblePages(pages, [[0, 60], [120, 140]], 8).map((p) => [p.fromFrame, p.durationInFrames])).toEqual([[60, 20], [80, 20], [100, 20]]);
  });
});

describe("word, page and emoji pops", () => {
  it("finds the word being spoken", () => {
    const words = [{ startFrame: 10 }, { startFrame: 20 }, { startFrame: 30 }];
    expect([5, 10, 25, 99].map((f) => activeWordIndex(words, f))).toEqual([-1, 0, 1, 2]);
    expect(activeWordIndex([{}, {}], 50)).toBe(-1);
  });
  it("pulses the spoken word 1 → 1.08 → 1 (3 frames up, 4 down)", () => {
    expect(wordPulse(-2, 3, 4, 1.08)).toBe(1);
    expect(wordPulse(0, 3, 4, 1.08)).toBe(1);
    expect(wordPulse(1, 3, 4, 1.08)).toBeGreaterThan(1.03);
    expect(wordPulse(3, 3, 4, 1.08)).toBeCloseTo(1.08, 6);
    expect(wordPulse(5, 3, 4, 1.08)).toBeLessThan(1.08);
    expect(wordPulse(7, 3, 4, 1.08)).toBeCloseTo(1, 6);
    expect(wordPulse(40, 3, 4, 1.08)).toBe(1);
  });
  it("bounces pages in from 80 % with a small overshoot", () => {
    expect(popBounce(0, 6, 0.8)).toBeCloseTo(0.8);
    expect(Math.max(...[1, 2, 3, 4, 5].map((f) => popBounce(f, 6, 0.8)))).toBeGreaterThan(1);
    expect(popBounce(6, 6, 0.8)).toBeCloseTo(1);
  });
  it("pops emoji 0 → 1.35 → 1 over 8 frames", () => {
    expect(emojiScale(-1, 8, 1.35)).toBe(0);
    expect(emojiScale(0, 8, 1.35)).toBe(0);
    expect(emojiScale(5, 8, 1.35)).toBeGreaterThan(1.25);
    expect(emojiScale(8, 8, 1.35)).toBe(1);
  });
});

describe("clip entries", () => {
  const m = { snapScale: 1.06, zoomBlurScale: 1.22, zoomBlurPx: 16 };
  it("snaps 1.06 → 1 and zoom-blurs 1.22 / 16 px → 1 / 0", () => {
    expect(enterEffect({ kind: "snap", frames: 4 }, 0, m)).toEqual({ scale: 1.06, blurPx: 0 });
    expect(enterEffect({ kind: "snap", frames: 4 }, 4, m)).toEqual({ scale: 1, blurPx: 0 });
    const mid = enterEffect({ kind: "zoom_blur", frames: 6 }, 3, m);
    expect(mid.scale).toBeCloseTo(1.0275, 4);
    expect(mid.blurPx).toBeCloseTo(2, 4);
    expect(enterEffect(undefined, 0, m)).toEqual({ scale: 1, blurPx: 0 });
  });
  it("speakerTransform multiplies the zoom and still never shows a frame edge", () => {
    expect(speakerTransform({ cx: 0.5, cy: 0.4, scaleFrom: 1, scaleTo: 1 }, 0, 30, 1.06)).toBe("scale(1.0600) translate(0.000%, 2.830%)");
  });
});

describe("split speaker and Ken Burns", () => {
  it("moves the full frame so the face sits at the bottom panel's centre, never showing past the frame", () => {
    expect(splitTransform(0.285)).toBe("translateY(-3.500%)");
    expect(splitTransform(0.5)).toBe("translateY(-25.000%)");
    expect(splitTransform(0.1)).toBe("translateY(0.000%)");
    expect(splitTransform(0.95)).toBe("translateY(-50.000%)");
  });
  it("zooms stills +6 % across the cutaway", () => {
    expect(kenBurnsScale(0, 45, 1.06)).toBe(1);
    expect(kenBurnsScale(44, 45, 1.06)).toBeCloseTo(1.06, 6);
  });
});

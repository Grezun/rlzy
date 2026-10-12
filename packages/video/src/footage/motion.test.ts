import { describe, expect, it } from "vitest";
import { ctaLines, popIn, revealedCount, speakerTransform } from "./motion";

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

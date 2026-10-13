import { describe, expect, it } from "vitest";
import { testEditStyle } from "../testing/fixtures";
import { placeCaptionPages, screenChinY } from "./caption-place";

const P = testEditStyle().captionPlacement;
const page = (fromFrame: number) => ({ fromFrame, durationInFrames: 30 });

describe("screenChinY", () => {
  it("takes the lowest chin over the crop's zoom range, with the centre clamped as the renderer does", () => {
    const face = { x: 0.35, y: 0.45, w: 0.3, h: 0.2 };
    expect(screenChinY(face, { cx: 0.5, cy: 0.55, scaleFrom: 1, scaleTo: 1.15 })).toBe(0.65);
    expect(screenChinY({ x: 0.35, y: 0.2, w: 0.3, h: 0.17 }, { cx: 0.5, cy: 0.4, scaleFrom: 1.25, scaleTo: 1.25 })).toBe(0.4625);
    expect(screenChinY(null, { cx: 0.5, cy: 0.5, scaleFrom: 1, scaleTo: 1 })).toBeNull();
  });
});

describe("placeCaptionPages", () => {
  it("puts each page under the chin, clamps to 55–72 %, holds small moves, keeps no-face pages where they were, and uses the seam for split", () => {
    const spans = [
      { fromFrame: 0, endFrame: 30, chinY: 0.65 },
      { fromFrame: 30, endFrame: 60, chinY: 0.62 },
      { fromFrame: 60, endFrame: 90, chinY: 0.63 },
      { fromFrame: 90, endFrame: 120, chinY: null },
      { fromFrame: 120, endFrame: 150, chinY: 0.5, split: true },
      { fromFrame: 150, endFrame: 180, chinY: 0.3 },
    ];
    expect(placeCaptionPages([0, 30, 60, 90, 120, 150].map(page), spans, P)).toEqual([71, 68, 68, 68, 50, 55]);
  });
  it("uses the lowest chin of every clip a page overlaps, and clamps at 72 %", () => {
    const spans = [{ fromFrame: 0, endFrame: 15, chinY: 0.4 }, { fromFrame: 15, endFrame: 40, chinY: 0.8 }];
    expect(placeCaptionPages([page(0)], spans, P)).toEqual([72]);
  });
  it("gives leading no-face pages the first known position, and 60 % when there is no face at all", () => {
    expect(placeCaptionPages([page(0), page(30)], [{ fromFrame: 30, endFrame: 60, chinY: 0.65 }], P)).toEqual([71, 71]);
    expect(placeCaptionPages([page(0), page(30)], [], P)).toEqual([60, 60]);
  });
});

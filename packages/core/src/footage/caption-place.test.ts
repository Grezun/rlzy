import { describe, expect, it } from "vitest";
import { testEditStyle } from "../testing/fixtures";
import { headlineSpot, placeCaptionPages, screenChinY, screenFaceRect } from "./caption-place";

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

describe("screenFaceRect", () => {
  it("maps the face box through the crop's zoom range onto the screen", () => {
    const face = { x: 0.35, y: 0.2, w: 0.3, h: 0.17 };
    expect(screenFaceRect(face, { cx: 0.5, cy: 0.4, scaleFrom: 1.25, scaleTo: 1.25 })).toEqual({ top: 0.25, bottom: 0.4625, left: 0.3125, right: 0.6875 });
    expect(screenFaceRect(null, { cx: 0.5, cy: 0.5, scaleFrom: 1, scaleTo: 1 })).toBeNull();
  });
});

describe("headlineSpot", () => {
  const H = testEditStyle().headline; // 15 % tall (10.5 % big only), 2 % gap, 9 %–75 % band, 58 % preferred
  const face = (top: number, bottom: number) => ({ top, bottom, left: 0.3, right: 0.7 });
  it("keeps the preferred spot with no face, or when the face ends above it", () => {
    expect(headlineSpot(null, true, H)).toEqual({ topPct: 58, clear: true });
    expect(headlineSpot(face(0.2, 0.48), true, H)).toEqual({ topPct: 58, clear: true });
  });
  it("goes just below the chin when it still ends above the caption band's bottom", () => {
    expect(headlineSpot(face(0.3, 0.571), true, H)).toEqual({ topPct: 59.5, clear: true }); // 59.1 rounded away from the chin
    expect(headlineSpot(face(0.3, 0.6), false, H)).toEqual({ topPct: 62, clear: true }); // big words only: 10.5 % tall
  });
  it("goes above the head when there is no room below the chin (a punched-in close-up)", () => {
    expect(headlineSpot(face(0.3, 0.6), true, H)).toEqual({ topPct: 13, clear: true });
    expect(headlineSpot(face(0.303, 0.695), false, H)).toEqual({ topPct: 17.5, clear: true }); // 17.8 rounded away from the head
  });
  it("never covers the mouth: with no room either side it takes the top band (forehead, not mouth) and says so", () => {
    expect(headlineSpot(face(0.15, 0.7), true, H)).toEqual({ topPct: 9, clear: false });
  });
});

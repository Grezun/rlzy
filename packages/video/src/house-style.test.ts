import { EditStyleSchema } from "@reel/core";
import { describe, expect, it } from "vitest";
import { testEditStyle } from "../../core/src/testing/fixtures";
import { houseStyle, IOS } from "./house-style";

const hexes = (o: unknown) => [...JSON.stringify(o).matchAll(/#([0-9a-fA-F]{6})\b/g)].map((m) => m[1]);
function hsl(hex: string) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s, l };
}
const luminance = (rgb: number[]) => {
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgb.map((v) => f(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** The glass fill composited over a flat backdrop: the worst case, as if the backdrop blur didn't render. */
const glassOver = (bg: number[]) => {
  const m = houseStyle.captions.glass.background.match(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/)!;
  const [r, g, b, a] = m.slice(1).map(Number);
  return [r, g, b].map((v, i) => v * a + bg[i] * (1 - a));
};

describe("houseStyle", () => {
  it("is a valid edit style and matches the core test fixture", () => {
    expect(EditStyleSchema.parse(houseStyle.edit)).toEqual(testEditStyle());
  });
  it("uses iOS white and red for captions, headline and CTA (Heebo SemiBold 64 px captions)", () => {
    expect(houseStyle.captions).toMatchObject({ fontSize: 64, fontWeight: 600, textColor: "#FFFFFF", radius: 48 });
    expect(houseStyle.captions.activeWord).toMatchObject({ color: "#FF3B30", peak: 1.08, upFrames: 3, downFrames: 4 });
    expect(houseStyle.captions.emphasis).toMatchObject({ background: IOS.red, color: IOS.white });
    expect(houseStyle.headline.sticker.color).toBe("#FF3B30");
    expect(houseStyle.cta.sticker.color).toBe("#FF3B30");
  });
  it("has no yellow or orange anywhere", () => {
    const warm = hexes(houseStyle).filter((h) => {
      const c = hsl(h);
      return c.s > 0.4 && c.l > 0.25 && c.l < 0.85 && c.h >= 20 && c.h <= 70;
    });
    expect(warm).toEqual([]);
  });
  it("keeps white caption text readable on the glass over black, mid-grey and white frames", () => {
    for (const bg of [[0, 0, 0], [128, 128, 128], [255, 255, 255]]) expect(contrast([255, 255, 255], glassOver(bg))).toBeGreaterThanOrEqual(4.5);
  });
});

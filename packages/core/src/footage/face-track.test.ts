import { describe, expect, it } from "vitest";
import { faceAt, smoothFaceTrack } from "./face-track";

const box = (x: number) => ({ x, y: 0.2, w: 0.3, h: 0.2 });
const raw = (xs: (number | null)[]) => ({
  width: 1080, height: 1920, fps: 30, sampleEvery: 3,
  samples: xs.map((x, i) => ({ tMs: i * 100, box: x === null ? null : box(x) })),
});

describe("smoothFaceTrack", () => {
  it("fills a gap of up to 1 s by interpolation", () => {
    const t = smoothFaceTrack(raw([0.4, 0.4, 0.4, 0.4, null, null, null, null, null, null, 0.6, 0.6, 0.6, 0.6]));
    expect(t.intervalMs).toBe(100);
    expect(t.samples.every((s) => s.box)).toBe(true);
    const xs = t.samples.map((s) => s.box!.x);
    for (let i = 4; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 1e-9);
    expect(xs[6]).toBeGreaterThan(0.4);
    expect(xs[6]).toBeLessThan(0.6);
  });
  it("leaves gaps over 1 s and leading/trailing gaps as no face", () => {
    const t = smoothFaceTrack(raw([null, 0.4, ...Array(15).fill(null), 0.5, null]));
    expect(t.samples[0].box).toBeNull();
    expect(t.samples[5].box).toBeNull();
    expect(t.samples.at(-1)!.box).toBeNull();
  });
  it("smooths jitter with a moving average", () => {
    const t = smoothFaceTrack(raw([0.4, 0.5, 0.4, 0.5, 0.4, 0.5, 0.4, 0.5, 0.4, 0.5]));
    for (const s of t.samples.slice(2, 8)) {
      expect(s.box!.x).toBeGreaterThan(0.42);
      expect(s.box!.x).toBeLessThan(0.48);
    }
  });
});

describe("faceAt", () => {
  const t = smoothFaceTrack(raw([0.4, 0.4, 0.4]));
  it("returns the nearest sample within one interval", () => {
    expect(faceAt(t, 140)!.x).toBeCloseTo(0.4);
    expect(faceAt(t, 290)).not.toBeNull();
  });
  it("returns null past the track or for an empty track", () => {
    expect(faceAt(t, 350)).toBeNull();
    expect(faceAt({ intervalMs: 100, samples: [] }, 0)).toBeNull();
  });
});

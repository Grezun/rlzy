import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compositeSpeakerPlate } from "./plate";
import { probe } from "./probe";
import { runFfmpeg } from "./run";
import { makeTestImage, pixelRgb } from "./testing";

const LOOK = { zoom: 1.08, driftPct: 2.5, driftPeriodSec: 24, driftPeriodYSec: 38.4, blurSigma: 5, dim: 0.1, saturation: 0.9, featherPx: 3 };
const S = "216x384";

/** A red speaker clip and a matte that keeps its left half. */
async function inputs(dir: string) {
  await runFfmpeg(["-f", "lavfi", "-i", `color=c=red:s=${S}:r=30:d=2`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", join(dir, "speaker.mp4")]);
  await runFfmpeg(["-f", "lavfi", "-i", `color=c=black:s=${S}:r=30:d=2`, "-vf", "format=gray,geq=lum='if(lt(X,W/2),255,0)',format=yuv420p", "-c:v", "libx264", "-preset", "ultrafast", join(dir, "matte.mp4")]);
  await makeTestImage(join(dir, "blue.png"), { width: 600, height: 1000, color: "blue" });
  await makeTestImage(join(dir, "green.png"), { width: 600, height: 1000, color: "green" });
}

describe("compositeSpeakerPlate", () => {
  it("keeps the speaker where the matte is white and shows the dimmed backdrop elsewhere, frame-aligned with the speaker clip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plate-"));
    await inputs(dir);
    await compositeSpeakerPlate({ video: join(dir, "speaker.mp4"), matte: join(dir, "matte.mp4"), backgrounds: [{ image: join(dir, "blue.png"), fromMs: 0 }], out: join(dir, "plate.mp4"), look: LOOK, tmpDir: join(dir, "t") });
    const info = await probe(join(dir, "plate.mp4"));
    const src = await probe(join(dir, "speaker.mp4"));
    expect(info.video).toMatchObject({ width: 216, height: 384 });
    expect(info.video!.fps).toBeCloseTo(30, 3);
    expect(Math.abs(info.video!.durationSec - src.video!.durationSec)).toBeLessThan(0.04);
    expect(info.audio).toBeUndefined();
    const [r1, g1, b1] = await pixelRgb(join(dir, "plate.mp4"), dir, 1, 0.1, 0.5);
    expect(r1).toBeGreaterThan(200);
    expect(b1).toBeLessThan(60);
    expect(g1).toBeLessThan(60);
    const [r2, , b2] = await pixelRgb(join(dir, "plate.mp4"), dir, 1, 0.85, 0.5);
    expect(b2).toBeGreaterThan(150);
    expect(b2).toBeLessThan(235); // dimmed
    expect(r2).toBeLessThan(60);
  }, 120_000);

  it("switches to the next section's backdrop at its start (source time)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plate2-"));
    await inputs(dir);
    await compositeSpeakerPlate({
      video: join(dir, "speaker.mp4"), matte: join(dir, "matte.mp4"), out: join(dir, "plate.mp4"), look: LOOK, tmpDir: join(dir, "t"),
      backgrounds: [{ image: join(dir, "blue.png"), fromMs: 0 }, { image: join(dir, "green.png"), fromMs: 1000 }],
    });
    const before = await pixelRgb(join(dir, "plate.mp4"), dir, 0.5, 0.85, 0.5);
    const after = await pixelRgb(join(dir, "plate.mp4"), dir, 1.5, 0.85, 0.5);
    expect(before[2]).toBeGreaterThan(before[1]);
    expect(after[1]).toBeGreaterThan(after[2]);
  }, 120_000);

  it("refuses an empty background list", async () => {
    await expect(compositeSpeakerPlate({ video: "v", matte: "m", backgrounds: [], out: "o", look: LOOK, tmpDir: tmpdir() })).rejects.toThrow(RangeError);
  });
});

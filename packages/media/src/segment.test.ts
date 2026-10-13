import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { faceHelperAvailable, FIXTURE_TALKING_HEAD, runFaceHelper } from "./face";
import { probe } from "./probe";
import { runFfmpeg } from "./run";
import { makeEllipseMatte, makeMatte, matteCoverage, matteRefineFilter, segmentHelperAvailable } from "./segment";
import { makeTestVideo } from "./testing";

const HELPER = segmentHelperAvailable();
type Box = { x: number; y: number; w: number; h: number };

/** Average grey level (0–255) of a box of the frame at `sec` (box in fractions of the frame). */
async function boxLuma(video: string, dir: string, sec: number, b: Box): Promise<number> {
  const out = join(dir, `box-${sec}-${b.x}-${b.y}-${b.w}.gray`);
  await runFfmpeg(["-ss", String(sec), "-i", video, "-vf", `crop=iw*${b.w}:ih*${b.h}:iw*${b.x}:ih*${b.y},scale=1:1:flags=area,format=gray`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", out]);
  return (await readFile(out))[0];
}

describe("mattes", () => {
  it("builds the refine filter from MATTE_REFINE (erode 2 px, stretch 64…191, light blur)", () => {
    expect(matteRefineFilter()).toBe("erosion,erosion,lut=c0='clip((val-64)*255/127,0,255)',gblur=sigma=0.8,format=yuv420p");
  });

  it("makes the fake head-and-shoulders matte, as long as the video", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ellipse-"));
    await makeTestVideo(join(dir, "v.mp4"), { durationSec: 2, width: 216, height: 384 });
    await makeEllipseMatte(join(dir, "v.mp4"), join(dir, "m.mp4"));
    const info = await probe(join(dir, "m.mp4"));
    expect(info.video).toMatchObject({ width: 216, height: 384 });
    expect(Math.abs(info.video!.durationSec - 2)).toBeLessThan(0.05);
    const coverage = await matteCoverage(join(dir, "m.mp4"));
    expect(coverage).toBeGreaterThan(0.15);
    expect(coverage).toBeLessThan(0.6);
    expect(await boxLuma(join(dir, "m.mp4"), dir, 1, { x: 0.45, y: 0.37, w: 0.1, h: 0.05 })).toBeGreaterThan(200);
    expect(await boxLuma(join(dir, "m.mp4"), dir, 1, { x: 0, y: 0, w: 0.1, h: 0.05 })).toBeLessThan(20);
  }, 120_000);

  it.skipIf(!HELPER)("matte on a synthetic clip: one frame per video frame, nobody found (skipped: run npm run build:segment-helper)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "matte-"));
    await makeTestVideo(join(dir, "t.mp4"), { durationSec: 1, width: 360, height: 640 });
    await makeMatte(join(dir, "t.mp4"), join(dir, "m.mp4"));
    const info = await probe(join(dir, "m.mp4"));
    expect(info.video).toMatchObject({ width: 360, height: 640 });
    expect(Math.abs(info.video!.durationSec - 1)).toBeLessThan(0.05);
    expect(await matteCoverage(join(dir, "m.mp4"))).toBeLessThan(0.1);
  }, 300_000);

  it.skipIf(!HELPER)("fails fast when ffmpeg cannot write the output, leaving no partial file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "matte-bad-out-"));
    await makeTestVideo(join(dir, "t.mp4"), { durationSec: 1, width: 360, height: 640 });
    const out = join(dir, "no-such-dir", "m.mp4");
    const started = Date.now();
    await expect(makeMatte(join(dir, "t.mp4"), out)).rejects.toThrow(/encoding the cut-out failed/);
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(existsSync(out)).toBe(false);
  }, 120_000);

  it.skipIf(!HELPER)("fails clearly for a missing file", async () => {
    await expect(makeMatte("/no/such/video.mp4", join(tmpdir(), "never.mp4"))).rejects.toThrow(/no such file/);
  });

  it.skipIf(!HELPER || !faceHelperAvailable() || !existsSync(FIXTURE_TALKING_HEAD))(
    "keeps the speaker on the fixture: the face is white, the top corners dark (skipped: needs both helpers and packages/media/fixtures/talking-head-he.mp4)",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "matte-fixture-"));
      const raw = (await runFaceHelper(FIXTURE_TALKING_HEAD)) as { fps: number; sampleEvery: number; samples: { tMs: number; box: Box | null }[] };
      const faces = join(dir, "faces.json");
      await writeFile(faces, JSON.stringify({ intervalMs: (raw.sampleEvery * 1000) / raw.fps, samples: raw.samples }));
      await makeMatte(FIXTURE_TALKING_HEAD, join(dir, "m.mp4"), { faces });
      const at = raw.samples.find((s) => s.box && s.tMs >= 1000)!;
      const b = at.box!;
      // The middle half of the face box, at that sample's time.
      const inner = { x: b.x + b.w / 4, y: b.y + b.h / 4, w: b.w / 2, h: b.h / 2 };
      expect(await boxLuma(join(dir, "m.mp4"), dir, at.tMs / 1000, inner)).toBeGreaterThan(180);
      expect(await boxLuma(join(dir, "m.mp4"), dir, at.tMs / 1000, { x: 0, y: 0, w: 0.12, h: 0.06 })).toBeLessThan(60);
      expect(await matteCoverage(join(dir, "m.mp4"))).toBeGreaterThan(0.1);
    },
    600_000,
  );
});

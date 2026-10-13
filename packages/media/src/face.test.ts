import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { faceHelperAvailable, FIXTURE_TALKING_HEAD, runFaceHelper } from "./face";
import { makeTestVideo } from "./testing";

const HELPER = faceHelperAvailable();
const FIXTURE = existsSync(FIXTURE_TALKING_HEAD);
type Out = { width: number; height: number; fps: number; sampleEvery: number; samples: { tMs: number; box: { x: number; y: number; w: number; h: number } | null }[] };

describe("face-helper", () => {
  it.skipIf(!HELPER)("samples every 3rd frame and reports no face on a synthetic clip (skipped: run npm run build:face-helper)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "face-"));
    await makeTestVideo(join(dir, "t.mp4"), { durationSec: 1, width: 360, height: 640 });
    const out = (await runFaceHelper(join(dir, "t.mp4"))) as Out;
    expect(out).toMatchObject({ width: 360, height: 640, sampleEvery: 3 });
    expect(out.samples).toHaveLength(10);
    expect(out.samples.every((s) => s.box === null)).toBe(true);
  }, 120_000);

  it.skipIf(!HELPER)("fails clearly for a missing file", async () => {
    await expect(runFaceHelper("/no/such/video.mp4")).rejects.toThrow(/no such file/);
  });

  it.skipIf(!HELPER || !FIXTURE)("finds the speaker's face on the fixture clip (skipped: needs the binary and packages/media/fixtures/talking-head-he.mp4)", async () => {
    const out = (await runFaceHelper(FIXTURE_TALKING_HEAD)) as Out;
    const found = out.samples.filter((s) => s.box);
    expect(found.length / out.samples.length).toBeGreaterThan(0.8);
    for (const s of found) {
      expect(s.box!.x).toBeGreaterThanOrEqual(-0.05);
      expect(s.box!.x + s.box!.w).toBeLessThanOrEqual(1.05);
      expect(s.box!.w).toBeGreaterThan(0.05);
    }
  }, 120_000);
});

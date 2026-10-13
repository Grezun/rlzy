import { averageLuma, makeTestVideo, runFfmpeg } from "@reel/media";
import { renderReelStill } from "@reel/video/render";
import { sampleCutawayTimeline, sampleFootageTimeline } from "@reel/video/sample-footage";
import { mkdir, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { serveDir } from "./serve";

describe("footage render (speaker shot, flash)", () => {
  it("flashes white at frame 0, then shows the zoomed speaker video", async () => {
    const dir = await mkdtemp(join(tmpdir(), "footage-render-"));
    await makeTestVideo(join(dir, "speaker.mp4"), { durationSec: 8 });
    const server = await serveDir(dir);
    try {
      const timeline = sampleFootageTimeline("he", server.urlFor("speaker.mp4"));
      const out = resolve("work/stills");
      await mkdir(out, { recursive: true });
      await renderReelStill(timeline, join(out, "footage-flash.png"), 0);
      await renderReelStill(timeline, join(out, "footage-speaker.png"), 50);
      expect(await averageLuma(join(out, "footage-flash.png"))).toBeGreaterThan(200);
      expect(await averageLuma(join(out, "footage-speaker.png"))).toBeLessThan(200);
      expect((await stat(join(out, "footage-speaker.png"))).size).toBeGreaterThan(50_000);
      // The zoomed video covers the whole frame: the top 1 % rows are not a black band.
      const top = join(dir, "speaker-top.png");
      await runFfmpeg(["-i", join(out, "footage-speaker.png"), "-vf", "crop=iw:ih*0.01:0:0", top]);
      expect(await averageLuma(top)).toBeGreaterThan(40);
    } finally {
      await server.close();
    }
  }, 300_000);
});

describe("diagram cards (iOS card fills its slot)", () => {
  it("renders light full and split cards with no large dark area", async () => {
    const dir = await mkdtemp(join(tmpdir(), "diagram-"));
    const full = join(dir, "list.png");
    await renderReelStill(sampleCutawayTimeline("he"), full, 130);
    expect(await averageLuma(full)).toBeGreaterThan(170);
    const split = join(dir, "flow.png");
    await renderReelStill(sampleCutawayTimeline("he"), split, 40);
    const top = join(dir, "flow-top.png");
    // The top 45 % (above the pill on the seam) is the split card.
    await runFfmpeg(["-i", split, "-vf", "crop=iw:ih*0.45:0:0", top]);
    expect(await averageLuma(top)).toBeGreaterThan(170);
  }, 300_000);
});

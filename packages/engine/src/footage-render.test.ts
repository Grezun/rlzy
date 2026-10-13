import { averageLuma, makeTestVideo, runFfmpeg } from "@reel/media";
import { renderReelStill } from "@reel/video/render";
import { sampleFootageTimeline } from "@reel/video/sample-footage";
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

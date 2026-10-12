import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { probe } from "./probe";
import { runFfmpeg } from "./run";
import { makeTestTone, makeTestVideo } from "./testing";

describe("probe", () => {
  it("reads video dimensions, fps, duration and absence of audio", async () => {
    const dir = await mkdtemp(join(tmpdir(), "media-"));
    const file = join(dir, "v.mp4");
    await makeTestVideo(file, { durationSec: 2, width: 640, height: 360, fps: 30 });
    const info = await probe(file);
    expect(info.video).toMatchObject({ width: 640, height: 360, codec: "h264", pixFmt: "yuv420p" });
    expect(info.video!.fps).toBeCloseTo(30, 3);
    expect(info.durationSec).toBeCloseTo(2, 1);
    expect(info.video!.durationSec).toBeCloseTo(2, 1);
    expect(info.audio).toBeUndefined();
  });

  it("reads the video stream's own duration when the audio runs longer than the video", async () => {
    const dir = await mkdtemp(join(tmpdir(), "media-"));
    const file = join(dir, "long-audio.mp4");
    await runFfmpeg([
      "-f", "lavfi", "-i", "color=c=gray:s=64x64:d=1:r=30",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2.5",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", file,
    ]);
    const info = await probe(file);
    expect(info.durationSec).toBeGreaterThan(2.4);
    expect(info.video!.durationSec).toBeCloseTo(1, 1);
  });

  it("reads audio sample rate and channels", async () => {
    const dir = await mkdtemp(join(tmpdir(), "media-"));
    const file = join(dir, "t.wav");
    await makeTestTone(file, { durationSec: 1 });
    const info = await probe(file);
    expect(info.audio).toEqual({ codec: "pcm_s16le", sampleRate: 48000, channels: 1 });
    expect(info.video).toBeUndefined();
  });
});

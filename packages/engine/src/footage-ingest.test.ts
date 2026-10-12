import { faceHelperAvailable, FIXTURE_TALKING_HEAD, makeTestVideo, probe, runFfmpeg } from "@reel/media";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileAssetStore } from "./asset-store";
import { noFaceTracker, visionFaceTracker } from "./face-tracker";
import { footageHashes, ingestFootage, loadFootageInputs } from "./footage-ingest";
import { createFakeProviders } from "./providers/fake";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "ingest-"));
  const providers = createFakeProviders({ workDir: dir });
  const deps = { store: new FileAssetStore(join(dir, "cache")), transcriber: providers.transcriber, faceTracker: noFaceTracker, tmpDir: join(dir, "tmp"), log: () => {} };
  return { dir, providers, deps };
}

/** Average RGB of a horizontal band of the first frame (fromTop and height as fractions of the frame height). */
async function bandColor(video: string, dir: string, fromTop: number, height: number): Promise<[number, number, number]> {
  const out = join(dir, `band-${fromTop}.rgb`);
  await runFfmpeg(["-i", video, "-vf", `crop=iw:ih*${height}:0:ih*${fromTop},scale=1:1`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-y", out]);
  const [r, g, b] = await readFile(out);
  return [r, g, b];
}

describe("ingestFootage (real ffmpeg, fake Scribe, no face helper)", () => {
  it("makes a 1080×1920 30 fps working copy from a landscape upload, transcribes it and caches every step", async () => {
    const { dir, providers, deps } = await setup();
    await makeTestVideo(join(dir, "land.mp4"), { durationSec: 4, width: 1280, height: 720, fps: 25, withAudio: true });
    const { source, transcript } = await ingestFootage(join(dir, "land.mp4"), deps);
    const inputs = await loadFootageInputs(deps.store, source);
    const info = await probe(inputs.working.path);
    expect(info.video).toMatchObject({ width: 1080, height: 1920, sar: "1:1" });
    expect(info.video!.fps).toBeCloseTo(30, 3);
    expect(info.audio).toBeDefined();
    expect(source.durationMs).toBeGreaterThan(3900);
    expect(transcript.words.length).toBeGreaterThanOrEqual(5);
    expect(inputs.faceTrack.samples).toEqual([]);
    expect(inputs.transcriptAsset.fileName).toBe(`${source.transcriptAssetId}.data`);
    expect(inputs.transcriptAsset.meta).toMatchObject({ kind: "data", model: "fake/scribe" });
    await ingestFootage(join(dir, "land.mp4"), deps);
    expect(providers.calls.transcribe).toBe(1);
  }, 300_000);

  it("accepts a rotated phone clip and applies the rotation (blue half on top, red half at the bottom)", async () => {
    const { dir, deps } = await setup();
    // Landscape 640×360: left half red, right half blue. Rotated 90° for display, blue ends up on top.
    await runFfmpeg([
      "-f", "lavfi", "-i", "color=c=red:s=320x360:d=2:r=30",
      "-f", "lavfi", "-i", "color=c=blue:s=320x360:d=2:r=30",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
      "-filter_complex", "[0:v][1:v]hstack[v]", "-map", "[v]", "-map", "2:a",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(dir, "raw.mp4"),
    ]);
    await runFfmpeg(["-display_rotation", "90", "-i", join(dir, "raw.mp4"), "-c", "copy", join(dir, "rotated.mp4")]);
    const { source } = await ingestFootage(join(dir, "rotated.mp4"), deps);
    const working = (await loadFootageInputs(deps.store, source)).working.path;
    expect((await probe(working)).video).toMatchObject({ width: 1080, height: 1920 });
    // Unrotated, a centre crop of the landscape frame would be half red, half blue at both top and bottom.
    const [tr, , tb] = await bandColor(working, dir, 0.02, 0.1);
    const [br, , bb] = await bandColor(working, dir, 0.88, 0.1);
    expect(tb).toBeGreaterThan(200);
    expect(tr).toBeLessThan(40);
    expect(br).toBeGreaterThan(200);
    expect(bb).toBeLessThan(40);
  }, 300_000);

  it.each([
    ["no audio", { durationSec: 2, withAudio: false }, /has no sound/],
    ["over 3:00", { durationSec: 182, width: 64, height: 64, withAudio: true }, /3:02 long/],
  ] as const)("fails plainly for %s", async (_name, opts, message) => {
    const { dir, deps } = await setup();
    await makeTestVideo(join(dir, "v.mp4"), opts);
    await expect(ingestFootage(join(dir, "v.mp4"), deps)).rejects.toThrow(message);
  }, 300_000);

  it("fails plainly for a file that isn't a video", async () => {
    const { dir, deps } = await setup();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "notes.mp4"), "not a video");
    await expect(ingestFootage(join(dir, "notes.mp4"), deps)).rejects.toThrow(/isn't a readable video/);
  });

  it("fails with 'No speech found' under 5 words, after caching the transcript", async () => {
    const { dir, deps } = await setup();
    await makeTestVideo(join(dir, "v.mp4"), { durationSec: 2, width: 360, height: 640, withAudio: true });
    let calls = 0;
    const quiet = {
      model: "fake/quiet",
      transcribe: async () => {
        calls++;
        return { transcript: { languageCode: "heb", languageProbability: 0.5, words: [{ text: "אה", startMs: 0, endMs: 300 }], events: [] } };
      },
    };
    await expect(ingestFootage(join(dir, "v.mp4"), { ...deps, transcriber: quiet })).rejects.toThrow(/No speech found/);
    await expect(ingestFootage(join(dir, "v.mp4"), { ...deps, transcriber: quiet })).rejects.toThrow(/No speech found/);
    expect(calls).toBe(1);
  }, 300_000);

  it("runs the face tracker on the conformed working copy, never on the original upload", async () => {
    const { dir, deps } = await setup();
    await makeTestVideo(join(dir, "v.mp4"), { durationSec: 2, width: 640, height: 360, withAudio: true });
    const seen: string[] = [];
    const tracker = { model: "fake/spy", track: async (video: string) => { seen.push(video); return { intervalMs: 100, samples: [] }; } };
    const { source } = await ingestFootage(join(dir, "v.mp4"), { ...deps, faceTracker: tracker });
    const { working } = await loadFootageInputs(deps.store, source);
    expect(seen).toHaveLength(1);
    expect((await probe(seen[0])).video).toMatchObject({ width: 1080, height: 1920 });
    expect(seen[0]).not.toBe(join(dir, "v.mp4"));
    expect(working.hash).toBe(source.assetId);
  }, 300_000);

  it("keys transcripts and faces by model, so fake data never answers for a real provider", () => {
    const h = "a".repeat(64);
    expect(footageHashes.transcript("fake/scribe", h)).not.toBe(footageHashes.transcript("elevenlabs/scribe_v2", h));
    expect(footageHashes.faces("fake/no-face", h)).not.toBe(footageHashes.faces("vision/face-rectangles-v1", h));
    expect(footageHashes.musicAi("fake/music", "x", 5000)).not.toBe(footageHashes.musicAi("elevenlabs/music", "x", 5000));
  });

  it.skipIf(!existsSync(FIXTURE_TALKING_HEAD) || !faceHelperAvailable())(
    "ingests the Hebrew fixture with real FFmpeg and face-helper, fake Scribe (skipped: needs packages/media/fixtures/talking-head-he.mp4 and npm run build:face-helper)",
    async () => {
      const { deps } = await setup();
      const { source } = await ingestFootage(FIXTURE_TALKING_HEAD, { ...deps, faceTracker: visionFaceTracker() });
      const { faceTrack } = await loadFootageInputs(deps.store, source);
      expect(faceTrack.samples.filter((s) => s.box).length / faceTrack.samples.length).toBeGreaterThan(0.8);
    },
    300_000,
  );
});

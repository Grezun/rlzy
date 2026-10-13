import { addExifOrientation, faceHelperAvailable, FIXTURE_TALKING_HEAD, makeTestImage, makeTestVideo, matteCoverage, probe, runFfmpeg } from "@reel/media";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileAssetStore } from "./asset-store";
import { createFaceTracker, noFaceTracker, visionFaceTracker } from "./face-tracker";
import { footageHashes, ingestExtras, ingestFootage, loadFootageInputs } from "./footage-ingest";
import { createFakeProviders } from "./providers/fake";
import { createSegmenter, fakeSegmenter, type Segmenter } from "./segmenter";

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

  it("takes the source length from the video stream, not the longer audio, so no shot asks for frames past the last one", async () => {
    const { dir, deps } = await setup();
    await runFfmpeg([
      "-f", "lavfi", "-i", "color=c=gray:s=360x640:d=2:r=30",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", join(dir, "long-audio.mp4"),
    ]);
    const { source } = await ingestFootage(join(dir, "long-audio.mp4"), deps);
    const working = (await loadFootageInputs(deps.store, source)).working.path;
    const info = await probe(working);
    expect(info.durationSec).toBeGreaterThan(3.9);
    expect(source.durationMs).toBe(Math.round(info.video!.durationSec * 1000));
    expect(source.durationMs).toBeLessThanOrEqual(2050);
  }, 300_000);

  it("finds the face before transcribing, so a real worker without the face helper fails before any paid call", async () => {
    const { dir, deps } = await setup();
    await makeTestVideo(join(dir, "v.mp4"), { durationSec: 2, width: 360, height: 640, withAudio: true });
    let calls = 0;
    const paid = { model: "elevenlabs/scribe_v2", transcribe: async () => { calls++; throw new Error("must not be called"); } };
    await expect(ingestFootage(join(dir, "v.mp4"), { ...deps, transcriber: paid, faceTracker: createFaceTracker("real", false) })).rejects.toThrow(/face-helper is not built/);
    expect(calls).toBe(0);
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
  it("re-makes a lost working copy from the original upload (free and deterministic), and refuses a different original", async () => {
    const { dir, providers, deps } = await setup();
    await makeTestVideo(join(dir, "up.mp4"), { durationSec: 3, width: 720, height: 1280, withAudio: true });
    const { source } = await ingestFootage(join(dir, "up.mp4"), deps);
    // Lost on this machine and never mirrored: the store no longer knows the working copy.
    await unlink(join(deps.store.root, `${source.assetId}.json`));
    await expect(loadFootageInputs(deps.store, source)).rejects.toThrow(/Upload the video again/);
    const original = async (dest: string) => {
      await copyFile(join(dir, "up.mp4"), join(dest, "original.mp4"));
      return join(dest, "original.mp4");
    };
    const remake = { original, tmpDir: join(dir, "remake"), log: () => {} };
    const inputs = await loadFootageInputs(deps.store, source, remake);
    expect(inputs.working.hash).toBe(source.assetId);
    expect((await probe(inputs.working.path)).video).toMatchObject({ width: 1080, height: 1920 });
    expect(providers.calls.transcribe).toBe(1);

    await unlink(join(deps.store.root, `${source.assetId}.json`));
    await makeTestVideo(join(dir, "other.mp4"), { durationSec: 2, width: 720, height: 1280, withAudio: true });
    const other = async (dest: string) => {
      await copyFile(join(dir, "other.mp4"), join(dest, "other.mp4"));
      return join(dest, "other.mp4");
    };
    await expect(loadFootageInputs(deps.store, source, { ...remake, original: other })).rejects.toThrow(/Upload the video again/);
    await expect(loadFootageInputs(deps.store, source, { ...remake, original: async () => null })).rejects.toThrow(/Upload the video again/);
  }, 300_000);
});

describe("cutaway cache keys", () => {
  it("separate fake and real models, characters, strengths and fit lengths", () => {
    const a = footageHashes.selfImage("higgsfield-ai/soul/v2/standard", "p", "ref-1", 1);
    expect(footageHashes.selfImage("fake/image", "p", "ref-1", 1)).not.toBe(a);
    expect(footageHashes.selfImage("higgsfield-ai/soul/v2/standard", "p", "ref-2", 1)).not.toBe(a);
    expect(footageHashes.selfImage("higgsfield-ai/soul/v2/standard", "p", "ref-1", 0.8)).not.toBe(a);
    expect(footageHashes.cutawayFit("x".repeat(64), 2000)).not.toBe(footageHashes.cutawayFit("x".repeat(64), 2033));
    expect(footageHashes.extra("y".repeat(64), "image")).not.toBe(footageHashes.extra("y".repeat(64), "video"));
  });
});

describe("ingest extras", () => {
  it("stores photos as they are, fits clips inside 1080×1920 (first 10 s), and leaves out unreadable files with a warning", async () => {
    const { dir, deps } = await setup();
    await makeTestVideo(join(dir, "talk.mp4"), { durationSec: 4, width: 720, height: 1280, withAudio: true });
    await makeTestImage(join(dir, "shot.png"), { width: 1920, height: 1080 });
    await makeTestVideo(join(dir, "demo.mov"), { durationSec: 12, width: 1280, height: 720 });
    await makeTestImage(join(dir, "raw.jpg"), { width: 400, height: 300 });
    await addExifOrientation(join(dir, "raw.jpg"), join(dir, "phone.jpg"), 6);
    await writeFile(join(dir, "bad.jpg"), "not an image");
    const { source, warnings } = await ingestFootage(join(dir, "talk.mp4"), deps, [
      { path: join(dir, "shot.png"), label: "צילום מסך" },
      { path: join(dir, "demo.mov"), label: "demo" },
      { path: join(dir, "phone.jpg"), label: "phone" },
      { path: join(dir, "bad.jpg"), label: "bad" },
    ]);
    expect(source.extras.map((e) => [e.kind, e.width, e.label])).toEqual([["image", 1920, "צילום מסך"], ["video", 1080, "demo"], ["image", 300, "phone"]]);
    expect(source.extras[2].height).toBe(400);
    expect(source.extras[1].durationMs).toBeGreaterThan(9900);
    expect(source.extras[1].durationMs).toBeLessThanOrEqual(10_050);
    expect((await deps.store.get(source.extras[0].assetId))!.fileName).toMatch(/\.png$/);
    expect((await deps.store.get(source.extras[2].assetId))!.fileName).toMatch(/\.jpg$/);
    expect(warnings).toEqual(['The extra file "bad" couldn\'t be read, so it was left out.']);
  }, 300_000);

  it("leaves out a file that probes fine but ffmpeg can't convert (corrupted body), keeping the other extras", async () => {
    const { dir, deps } = await setup();
    await makeTestImage(join(dir, "good.png"), { width: 400, height: 300 });
    await makeTestImage(join(dir, "src.png"), { width: 400, height: 300 });
    // Valid PNG header (probe reads 400×300), every byte after the image data header scrambled: decoding fails.
    const png = await readFile(join(dir, "src.png"));
    const idat = png.indexOf("IDAT");
    for (let k = idat + 8; k < png.length - 20; k++) png[k] = 0x55;
    await writeFile(join(dir, "broken.png"), png);
    expect((await probe(join(dir, "broken.png"))).video?.width).toBe(400);
    const { extras, warnings } = await ingestExtras([
      { path: join(dir, "broken.png"), label: "broken" },
      { path: join(dir, "good.png"), label: "good" },
    ], deps);
    expect(extras.map((e) => e.label)).toEqual(["good"]);
    expect(warnings).toEqual(['The extra file "broken" couldn\'t be read, so it was left out.']);
  }, 120_000);
});

describe("ingestFootage: the cut-out (plan 3)", () => {
  const counting = (inner: Segmenter) => {
    const calls: string[] = [];
    return { calls, segmenter: { model: inner.model, matte: async (v: string, f: string, o: string) => { calls.push(v); await inner.matte(v, f, o); } } };
  };

  it("cuts the speaker out after transcribing: a matte the size and length of the working copy, cached, with its steps", async () => {
    const { dir, deps } = await setup();
    await makeTestVideo(join(dir, "v.mp4"), { durationSec: 2, width: 360, height: 640, withAudio: true });
    const spy = counting(fakeSegmenter);
    const steps: string[] = [];
    const run = () => ingestFootage(join(dir, "v.mp4"), { ...deps, segmenter: spy.segmenter, onEvent: (e) => e.type === "step" && steps.push(`${e.step}:${e.status}`) });
    const { source, warnings } = await run();
    expect(warnings).toEqual([]);
    const matte = await deps.store.get(source.matteAssetId!);
    const info = await probe(matte!.path);
    expect(info.video).toMatchObject({ width: 1080, height: 1920 });
    expect(Math.abs(info.video!.durationSec * 1000 - source.durationMs)).toBeLessThan(100);
    expect(await matteCoverage(matte!.path)).toBeGreaterThan(0.15);
    expect(matte!.meta).toMatchObject({ kind: "video", model: "fake/matte-ellipse" });
    expect(steps).toEqual(["conform:running", "conform:done", "faces:running", "faces:done", "transcribe:running", "transcribe:done", "cutout:running", "cutout:done"]);
    expect((await probe(spy.calls[0])).video).toMatchObject({ width: 1080, height: 1920 });
    await run();
    expect(spy.calls).toHaveLength(1);
  }, 300_000);

  it("turns a missing helper into a plan warning, never a failure, and leaves the video without a cut-out", async () => {
    const { dir, deps } = await setup();
    await makeTestVideo(join(dir, "v.mp4"), { durationSec: 2, width: 360, height: 640, withAudio: true });
    const { source, warnings } = await ingestFootage(join(dir, "v.mp4"), { ...deps, segmenter: createSegmenter("real", false) });
    expect(source.matteAssetId).toBeUndefined();
    expect(warnings).toEqual(['Background replacement is off for this video: the cut-out tool isn\'t built on this worker. Run "npm run build:segment-helper" on the worker Mac, then upload the video again.']);
  }, 300_000);

  it.each([
    ["finds nobody", "color=c=black:s=1080x1920:r=30:d=2", "the cut-out couldn't find you in the picture"],
    ["is too short", "color=c=white:s=1080x1920:r=30:d=1", "the cut-out doesn't match the video's length"],
  ])("warns when the cut-out %s", async (_name, lavfi, reason) => {
    const { dir, deps } = await setup();
    await makeTestVideo(join(dir, "v.mp4"), { durationSec: 2, width: 360, height: 640, withAudio: true });
    const bad: Segmenter = { model: `fake/bad-${reason.length}`, matte: async (_v, _f, out) => { await runFfmpeg(["-f", "lavfi", "-i", lavfi, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", out]); } };
    const { source, warnings } = await ingestFootage(join(dir, "v.mp4"), { ...deps, segmenter: bad });
    expect(source.matteAssetId).toBeUndefined();
    expect(warnings).toEqual([`Background replacement is off for this video: ${reason}.`]);
  }, 300_000);

  it("reports a failing helper as a warning with its first line", async () => {
    const { dir, deps } = await setup();
    await makeTestVideo(join(dir, "v.mp4"), { durationSec: 2, width: 360, height: 640, withAudio: true });
    const broken: Segmenter = { model: "fake/broken", matte: async () => { throw new Error("Vision gave up\nstack…"); } };
    expect((await ingestFootage(join(dir, "v.mp4"), { ...deps, segmenter: broken })).warnings).toEqual(["Background replacement is off for this video: cutting you out failed (Vision gave up)."]);
  }, 300_000);

  it("never cuts out a video without speech (it fails first)", async () => {
    const { dir, deps } = await setup();
    await makeTestVideo(join(dir, "v.mp4"), { durationSec: 2, width: 360, height: 640, withAudio: true });
    const spy = counting(fakeSegmenter);
    const quiet = { model: "fake/quiet", transcribe: async () => ({ transcript: { languageCode: "heb", languageProbability: 0.5, words: [{ text: "אה", startMs: 0, endMs: 300 }], events: [] } }) };
    await expect(ingestFootage(join(dir, "v.mp4"), { ...deps, transcriber: quiet, segmenter: spy.segmenter })).rejects.toThrow(/No speech found/);
    expect(spy.calls).toEqual([]);
  }, 300_000);
});

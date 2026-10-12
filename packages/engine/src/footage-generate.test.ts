import { parseEditPlan, SFX_NAMES, type EditPlan } from "@reel/core";
import { makeSfxPlaceholders, makeTestTone, makeTestVideo, probe } from "@reel/media";
import { houseStyle } from "@reel/video/house-style";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileAssetStore } from "./asset-store";
import { noFaceTracker } from "./face-tracker";
import { buildFootageTimeline, generateFootageAssets, renderFootage } from "./footage-generate";
import { ingestFootage } from "./footage-ingest";
import { createFakeProviders } from "./providers/fake";

async function prepared(music: EditPlan["music"] = { kind: "none" }) {
  const dir = await mkdtemp(join(tmpdir(), "footage-gen-"));
  const providers = createFakeProviders({ workDir: dir });
  const store = new FileAssetStore(join(dir, "cache"));
  await makeTestVideo(join(dir, "up.mp4"), { durationSec: 6, width: 720, height: 1280, withAudio: true });
  const { source, transcript } = await ingestFootage(join(dir, "up.mp4"), { store, transcriber: providers.transcriber, faceTracker: noFaceTracker, tmpDir: join(dir, "t"), log: () => {} });
  const planned = await providers.footagePlanner.plan({ settings: { language: "he", targetDurationSec: 15, ctaKeyword: "AI" }, source, transcript, library: [], warnings: [] });
  const plan = parseEditPlan({ ...planned, music });
  await makeSfxPlaceholders(join(dir, "sfx"), SFX_NAMES);
  const deps = { music: providers.music, store, tmpDir: join(dir, "g"), log: () => {}, library: async () => null, sfxDir: join(dir, "sfx"), style: houseStyle.edit };
  return { dir, providers, plan, deps };
}

describe("generateFootageAssets + renderFootage (fake music, placeholder sfx, real ffmpeg + Remotion)", () => {
  it("renders a 1080×1920 reel whose length matches the plan, then reuses every cached asset", async () => {
    const { dir, providers, plan: p, deps } = await prepared({ kind: "ai", prompt: "calm lo-fi" });
    const plan = parseEditPlan({ ...p, estimate: { ...p.estimate, credits: 1 } });
    const gen = await generateFootageAssets(plan, deps);
    expect(gen.notes).toEqual([]);
    expect(gen.music).toBeDefined();
    const out = await renderFootage(plan, gen, deps, join(dir, "out"));
    const info = await probe(out.reel);
    expect(info.video).toMatchObject({ width: 1080, height: 1920 });
    expect(Math.abs(info.durationSec - out.timeline.durationInFrames / 30)).toBeLessThan(0.1);
    expect(out.timeline.sfx?.length).toBeGreaterThan(0);
    const before = providers.calls.music;
    await generateFootageAssets(plan, deps);
    expect(providers.calls.music).toBe(before);
  }, 900_000);

  it("skips AI music that would exceed the approved estimate, with a note, and still renders", async () => {
    const { plan, deps, providers } = await prepared({ kind: "ai", prompt: "calm lo-fi" });
    const gen = await generateFootageAssets(parseEditPlan({ ...plan, estimate: { ...plan.estimate, credits: 0 } }), deps);
    expect(gen.music).toBeUndefined();
    expect(gen.notes).toEqual(["AI music was skipped: it would cost more than the approved estimate. Use Edit as new version and approve again to update it."]);
    expect(providers.calls.music).toBe(0);
  }, 300_000);

  it("makes exactly one paid music call: a failure skips music with a note (never a second, possibly billed, attempt) and the reel renders", async () => {
    const { dir, plan: p, deps } = await prepared({ kind: "ai", prompt: "calm lo-fi" });
    const plan = parseEditPlan({ ...p, estimate: { ...p.estimate, credits: 1 } });
    let calls = 0;
    const broken = { model: "fake/broken", compose: async () => { calls++; throw new Error("service down"); } };
    const gen = await generateFootageAssets(plan, { ...deps, music: broken });
    expect(calls).toBe(1);
    expect(gen.music).toBeUndefined();
    expect(gen.notes).toEqual(["AI music failed (service down), so the reel has no music."]);
    const out = await renderFootage(plan, gen, deps, join(dir, "out"));
    expect((await probe(out.reel)).video).toMatchObject({ width: 1080, height: 1920 });
    expect(out.timeline.audio.musicUrl).toBeUndefined();
  }, 900_000);

  it("loops a short library track; a removed track and a missing sfx pack become notes", async () => {
    const { dir, plan, deps } = await prepared({ kind: "library", assetId: "3f2c8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e" });
    await makeTestTone(join(dir, "short.wav"), { durationSec: 1 });
    const library = async (_id: string, dest: string) => { await copyFile(join(dir, "short.wav"), join(dest, "track.wav")); return join(dest, "track.wav"); };
    const gen = await generateFootageAssets(plan, { ...deps, library });
    expect((await probe(gen.music!.path)).durationSec).toBeGreaterThan(2);
    const gone = await generateFootageAssets(plan, { ...deps, library: async () => null, sfxDir: null });
    expect(gone.notes).toEqual(["The library track was removed, so the reel has no music.", "Sound effects aren't installed on this worker yet, so the reel has none."]);
    expect(buildFootageTimeline(plan, gone, (f) => `asset:${f}`, houseStyle.edit).sfx).toBeUndefined();
  }, 300_000);
});

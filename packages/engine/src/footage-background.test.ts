import { parseEditPlan, SFX_NAMES, withFootageEstimate, type EditPlan } from "@reel/core";
import { makeSfxPlaceholders, makeTestVideo, pixelRgb, prepareBackdrop, probe } from "@reel/media";
import { houseStyle } from "@reel/video/house-style";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileAssetStore } from "./asset-store";
import { noFaceTracker } from "./face-tracker";
import { backgroundPrompt } from "./footage-background";
import { buildFootageTimeline, generateFootageAssets, renderFootage } from "./footage-generate";
import { footageHashes, ingestFootage, loadFootageInputs } from "./footage-ingest";
import { createFakeProviders } from "./providers/fake";
import { fakeSegmenter } from "./segmenter";

const style = houseStyle.edit;
const KEEP = "so the reel uses your real background";

/** A 6 s upload ingested with the fake cut-out and planned by the fake planner: an AI scene, plus a split diagram on b1. */
async function prepared(music: EditPlan["music"] = { kind: "none" }) {
  const dir = await mkdtemp(join(tmpdir(), "footage-bg-"));
  const providers = createFakeProviders({ workDir: dir });
  const store = new FileAssetStore(join(dir, "cache"));
  await makeTestVideo(join(dir, "up.mp4"), { durationSec: 6, width: 720, height: 1280, withAudio: true });
  const { source, transcript } = await ingestFootage(join(dir, "up.mp4"), { store, transcriber: providers.transcriber, faceTracker: noFaceTracker, segmenter: fakeSegmenter, tmpDir: join(dir, "t"), log: () => {} });
  const planned = await providers.footagePlanner.plan({ settings: { language: "he", targetDurationSec: 15, ctaKeyword: "AI" }, source, transcript, library: [], warnings: [] });
  const plan = withFootageEstimate(parseEditPlan({ ...planned, music }), transcript.words, style);
  await makeSfxPlaceholders(join(dir, "sfx"), SFX_NAMES);
  const deps = { music: providers.music, image: providers.image, video: providers.video, uploader: providers.uploader, character: null, store, tmpDir: join(dir, "g"), log: () => {}, library: async () => null, sfxDir: join(dir, "sfx"), style };
  return { dir, providers, plan, deps, store };
}

const dist = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);

describe("background replacement at generation (fake still, fake cut-out, real ffmpeg + Remotion)", () => {
  it("makes one AI still, a plate frame-aligned with the working copy, and every speaker clip (split pieces too) shows it", async () => {
    const { dir, providers, plan, deps, store } = await prepared();
    expect(plan.background.mode).toBe("replace");
    expect(plan.estimate.credits).toBe(0.04);
    const gen = await generateFootageAssets(plan, deps);
    expect(gen.notes).toEqual([]);
    expect(providers.calls.image).toBe(1);
    const working = (await loadFootageInputs(store, plan.source)).working;
    const [p, w] = [await probe(gen.plate!.path), await probe(working.path)];
    expect(p.video).toMatchObject({ width: 1080, height: 1920 });
    expect(Math.abs(p.video!.durationSec - w.video!.durationSec)).toBeLessThan(0.04);
    // Inside the fake cut-out (shoulders) the plate is the speaker; outside it is the prepared backdrop.
    expect(dist(await pixelRgb(gen.plate!.path, dir, 2, 0.5, 0.88), await pixelRgb(working.path, dir, 2, 0.5, 0.88))).toBeLessThan(45);
    const still = await store.get(footageHashes.background(providers.image.model, backgroundPrompt("a bright modern studio with plants and soft daylight")));
    await prepareBackdrop(still!.path, join(dir, "backdrop.png"), { width: 1080, height: 1920 }, style.background);
    expect(dist(await pixelRgb(gen.plate!.path, dir, 2, 0.03, 0.03), await pixelRgb(join(dir, "backdrop.png"), dir, 0, 0.5, 0.5))).toBeLessThan(30);
    const timeline = buildFootageTimeline(plan, gen, (f) => `asset:${f}`, style);
    expect(timeline.clips.some((c) => c.layout === "split")).toBe(true);
    expect(timeline.clips.every((c) => c.src === `asset:${gen.plate!.fileName}`)).toBe(true);
    const out = await renderFootage(plan, gen, deps, join(dir, "out"));
    expect((await probe(out.reel)).video).toMatchObject({ width: 1080, height: 1920 });
    await generateFootageAssets(plan, deps);
    expect(providers.calls.image).toBe(1);
  }, 900_000);

  it("makes AI music and the background when approved at exactly their estimate", async () => {
    const { plan, deps, providers } = await prepared({ kind: "ai", prompt: "calm lo-fi" });
    expect(plan.estimate.credits).toBeGreaterThan(0.04);
    const gen = await generateFootageAssets(plan, deps);
    expect(gen.notes).toEqual([]);
    expect(gen.music).toBeDefined();
    expect(gen.plate).toBeDefined();
    expect([providers.calls.music, providers.calls.image]).toEqual([1, 1]);
  }, 300_000);

  it("skips the still the estimate can't cover, with a note, and never pays for it", async () => {
    const { plan, deps, providers } = await prepared();
    const gen = await generateFootageAssets(parseEditPlan({ ...plan, estimate: { ...plan.estimate, credits: 0 } }), deps);
    expect(gen.plate).toBeUndefined();
    expect(gen.notes).toEqual([`The AI background was skipped: it would cost more than the approved estimate, ${KEEP}. Use Edit as new version and approve again to update it.`]);
    expect(providers.calls.image).toBe(0);
  }, 300_000);

  it("makes one paid attempt: a failed still is a note and the reel renders on the real background", async () => {
    const { dir, plan, deps } = await prepared();
    let calls = 0;
    const broken = { model: "fake/broken", generate: async () => { calls++; throw new Error("blocked by content moderation"); } };
    const gen = await generateFootageAssets(plan, { ...deps, image: broken });
    expect(calls).toBe(1);
    expect(gen.plate).toBeUndefined();
    expect(gen.notes).toEqual([`The AI background failed (blocked by content moderation), ${KEEP}.`]);
    const out = await renderFootage(plan, gen, deps, join(dir, "out"));
    expect(out.timeline.clips.every((c) => c.src!.endsWith(`${plan.source.assetId}.mp4`))).toBe(true);
  }, 900_000);

  it("never pays for a still when the cut-out is missing", async () => {
    const { plan, deps, providers } = await prepared();
    const lost = parseEditPlan({ ...plan, source: { ...plan.source, matteAssetId: "7".repeat(64) } });
    const gen = await generateFootageAssets(lost, deps);
    expect(gen.notes).toEqual([`The cut-out of you is missing, ${KEEP}. Upload the video again to replace the background.`]);
    expect(providers.calls.image).toBe(0);
  }, 300_000);

  it("wraps the scene so the still is an empty place with room for the speaker", () => {
    expect(backgroundPrompt("  a bright home office ")).toBe(
      "a bright home office, an empty place with no people, vertical 9:16 photo, photorealistic, eye-level view, open space in the centre for a person standing in front, soft natural light, shallow depth of field, no text, no captions, no logos, no watermark",
    );
  });
});

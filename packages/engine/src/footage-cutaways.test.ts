import { parseEditPlan, planCutaways, type EditPlan, type PlacedCutaway } from "@reel/core";
import { makeTestImage, probe } from "@reel/media";
import { houseStyle } from "@reel/video/house-style";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHARACTER_ID, EXTRA_IMG, fixtureExtras, footageTranscript, validEditPlan } from "../../core/src/testing/fixtures";
import { FileAssetStore } from "./asset-store";
import { cutawayPrompt, generateCutaways, makeBudget } from "./footage-cutaways";
import { createFakeProviders } from "./providers/fake";

const REF = { referenceId: "soul-ref-123", strength: 1 };
// b1: AI clip, full, frames 0–60 ($0.36); b2: AI shot of you, split, frames 89–134 ($0.04); b3: no cutaway.
const plan = (): EditPlan => parseEditPlan({
  ...validEditPlan(),
  source: { ...validEditPlan().source, extras: fixtureExtras() },
  character: { id: CHARACTER_ID, name: "Alex" },
  beats: validEditPlan().beats.map((b) =>
    b.id === "b1" ? { ...b, cutaway: { source: { kind: "ai_broll", prompt: "laptop on a desk", media: "video" }, layout: "full", atMs: 0, durationMs: 2000 } }
    : b.id === "b2" ? { ...b, cutaway: { source: { kind: "ai_self", prompt: "the person on a plane", media: "image" }, layout: "split", atMs: 0, durationMs: 1500 } }
    : b),
});

async function setup(over: { failPromptsContaining?: string } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "cutaways-"));
  const providers = createFakeProviders({ workDir: dir, ...over });
  const store = new FileAssetStore(join(dir, "cache"));
  const p = plan();
  const placed = planCutaways(p, footageTranscript().words, houseStyle.edit).placed;
  const deps = (usd: number, character: typeof REF | null = REF) => ({
    image: providers.image, video: providers.video, uploader: providers.uploader, store, tmpDir: join(dir, "t"), log: () => {}, character, budget: makeBudget(usd),
  });
  return { dir, providers, store, p, placed, deps };
}

describe("generateCutaways (fake Higgsfield, real ffmpeg)", () => {
  it("makes a 2 s 1080×1920 clip and a Soul ID still, then reuses both from the cache at no cost", async () => {
    const s = await setup();
    const first = await generateCutaways(s.placed, s.p, s.deps(0.4));
    expect(first.notes).toEqual([]);
    expect(Object.keys(first.assets).sort()).toEqual(["b1", "b2"]);
    const clip = await probe(first.assets.b1.asset.path);
    expect(clip.video).toMatchObject({ width: 1080, height: 1920 });
    expect(clip.durationSec).toBeCloseTo(2, 1);
    expect([s.providers.calls.image, s.providers.calls.selfImage, s.providers.calls.video]).toEqual([2, 1, 1]);
    const budget = makeBudget(0);
    const again = await generateCutaways(s.placed, s.p, { ...s.deps(0), budget });
    expect(again.notes).toEqual([]);
    expect([s.providers.calls.image, s.providers.calls.video]).toEqual([2, 1]);
    expect(budget.remaining).toBe(0);
  }, 300_000);

  it("skips what the approved estimate can't cover, before paying", async () => {
    const s = await setup();
    const r = await generateCutaways(s.placed, s.p, s.deps(0.05));
    expect(Object.keys(r.assets)).toEqual(["b2"]);
    expect(r.notes).toEqual(["The cutaway in b1 was skipped: it would cost more than the approved estimate. Use Edit as new version and approve again to update it."]);
    expect(s.providers.calls.video).toBe(0);
  }, 300_000);

  it("skips AI shots of you when the character is gone, and never sends a reference-less prompt", async () => {
    const s = await setup();
    const r = await generateCutaways(s.placed, s.p, s.deps(1, null));
    expect(r.notes).toEqual(["The AI shot of you in b2 was skipped: its character no longer exists."]);
    expect(s.providers.calls.selfImage).toBe(0);
    expect(Object.keys(r.assets)).toEqual(["b1"]);
  }, 300_000);

  it("a failed generation is one attempt, a note, and the speaker stays on screen", async () => {
    const s = await setup({ failPromptsContaining: "laptop" });
    const r = await generateCutaways(s.placed, s.p, s.deps(1));
    expect(r.notes).toEqual(["The cutaway in b1 failed (Higgsfield (fake) was blocked by content moderation), so you stay on screen there."]);
    expect(s.providers.calls.image).toBe(2);
    expect(s.providers.calls.video).toBe(0);
  }, 300_000);

  it("uses an upload from the store, and notes one that is missing", async () => {
    const s = await setup();
    const up = parseEditPlan({ ...s.p, beats: s.p.beats.map((b) => (b.id === "b1" ? { ...b, cutaway: { source: { kind: "upload", assetId: EXTRA_IMG }, layout: "full", atMs: 0, durationMs: 1000 } } : b)) });
    const placed = planCutaways(up, footageTranscript().words, houseStyle.edit).placed;
    expect((await generateCutaways(placed, up, s.deps(1))).notes[0]).toBe("The upload for the cutaway in b1 is missing, so you stay on screen there.");
    await makeTestImage(join(s.dir, "shot.png"), { width: 1920, height: 1080 });
    await s.store.putFile(EXTRA_IMG, join(s.dir, "shot.png"), "png", { kind: "image", provider: "upload" });
    const r = await generateCutaways(placed, up, s.deps(1));
    expect(r.assets.b1).toMatchObject({ kind: "image" });
  }, 300_000);

  it("asks for vertical, text-free stills, centred for split", () => {
    expect(cutawayPrompt(" laptop ", "full")).toBe("laptop, vertical 9:16 photo, photorealistic, natural light, no text, no captions, no watermark");
    expect(cutawayPrompt("laptop", "split")).toMatch(/main subject centred in the middle of the frame$/);
  });

  it("at the full 30 s budget, reserves in reel order and skips the one clip the estimate can't cover", async () => {
    const s = await setup();
    const placed: PlacedCutaway[] = Array.from({ length: 10 }, (_, i) => ({
      beatId: `b${i + 1}`, source: { kind: "ai_broll", prompt: `scene ${i + 1}`, media: i % 3 === 0 ? "video" : "image" },
      layout: "full", fromFrame: i * 90, durationInFrames: 45, pulled: false,
    }));
    const budget = makeBudget(1.67); // the full price is $1.68
    const r = await generateCutaways(placed, s.p, { ...s.deps(0), budget });
    expect(r.notes).toEqual(["The cutaway in b10 was skipped: it would cost more than the approved estimate. Use Edit as new version and approve again to update it."]);
    expect(Object.keys(r.assets)).toHaveLength(9);
    expect([s.providers.calls.image, s.providers.calls.video]).toEqual([9, 3]);
    expect(budget.remaining).toBeCloseTo(1.67 - 1.32, 6);
  }, 300_000);
});

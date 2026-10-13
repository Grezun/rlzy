import { EmptyEditError, SFX_NAMES, type EditPlan } from "@reel/core";
import { createFakeProviders, FileAssetStore, noFaceTracker } from "@reel/engine";
import { makeSfxPlaceholders, makeTestVideo } from "@reel/media";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryBlobStore, InMemoryReelDb, makeJob } from "../testing/fakes";
import { createIngestFootageHandler } from "./footage";
import { createGenerateFootageHandler } from "./generate-footage";

const PID = "0b5f8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e";
const PATH = `footage/${PID}/source.mp4`;
const ctx = { report: () => {}, log: () => {} };
const FILLERS_HASH = "f".repeat(64);
const REAL_MODELS = { transcriber: "elevenlabs/scribe_v2", faceTracker: "vision/face-rectangles-v1" };

async function approvedPlan() {
  const dir = await mkdtemp(join(tmpdir(), "gen-footage-"));
  const providers = createFakeProviders({ workDir: dir });
  const db = new InMemoryReelDb();
  const blobs = new InMemoryBlobStore();
  const store = new FileAssetStore(join(dir, "cache"));
  await makeTestVideo(join(dir, "up.mp4"), { durationSec: 6, width: 720, height: 1280, withAudio: true });
  await blobs.upload("assets", PATH, join(dir, "up.mp4"));
  await createIngestFootageHandler({ store, blobs, db, transcriber: providers.transcriber, faceTracker: noFaceTracker, footagePlanner: providers.footagePlanner })(
    makeJob({ type: "ingest_footage", project_id: PID, payload: { storagePath: PATH, settings: { language: "he", targetDurationSec: 15, ctaKeyword: "AI" } } }), ctx);
  const record = db.storyboards[0];
  record.status = "approved";
  await makeSfxPlaceholders(join(dir, "sfx"), SFX_NAMES);
  const inputModels = { transcriber: providers.transcriber.model, faceTracker: noFaceTracker.model };
  const deps = { music: providers.music, image: providers.image, video: providers.video, uploader: providers.uploader, store, blobs, db, sfxDir: join(dir, "sfx"), spendCapUsd: 10, inputModels };
  return { dir, record, deps, db, blobs, providers, store };
}

describe("generate_footage", () => {
  it("renders the approved plan (re-making a lost working copy from the upload), uploads the files and records the render", async () => {
    const s = await approvedPlan();
    // The working copy's mirror is best-effort: lose it here so the job has to conform the original upload again.
    await unlink(join(s.store.root, `${(s.record.json as EditPlan).source.assetId}.json`));
    const outcome = await createGenerateFootageHandler(s.deps)(makeJob({ type: "generate_footage", project_id: PID, payload: { storyboardId: s.record.id } }), ctx);
    expect(outcome.status).toBe("done");
    expect([...s.blobs.objects.keys()].filter((k) => k.startsWith("renders/")).sort()).toEqual([`renders/${PID}/v1/preview.mp4`, `renders/${PID}/v1/reel.mp4`, `renders/${PID}/v1/reel.srt`, `renders/${PID}/v1/thumbnail.jpg`]);
    expect(s.db.renders[0].timeline.clips.every((c) => c.kind === "speaker" && c.src?.startsWith("asset:"))).toBe(true);
    expect(s.db.projectStatus.get(PID)?.status).toBe("rendered");
  }, 900_000);

  it("a real worker refuses a plan built on a fake transcript or face track, before any spend", async () => {
    const s = await approvedPlan();
    const job = () => makeJob({ type: "generate_footage", project_id: PID, payload: { storyboardId: s.record.id } });
    await expect(createGenerateFootageHandler({ ...s.deps, inputModels: REAL_MODELS })(job(), ctx)).rejects.toThrow(/made by the fake worker \(fake transcript\)/);
    const fakeFaces = { transcriber: s.providers.transcriber.model, faceTracker: REAL_MODELS.faceTracker };
    await expect(createGenerateFootageHandler({ ...s.deps, inputModels: fakeFaces })(job(), ctx)).rejects.toThrow(/made by the fake worker \(fake face track\)/);
    expect(s.providers.calls.music).toBe(0);
    expect(s.db.renders).toEqual([]);
    expect(s.db.projectStatus.get(PID)?.status).toBe("failed");
  }, 300_000);

  it("refuses an unapproved plan and one over the spend cap", async () => {
    const s = await approvedPlan();
    s.record.status = "draft";
    await expect(createGenerateFootageHandler(s.deps)(makeJob({ type: "generate_footage", project_id: PID, payload: { storyboardId: s.record.id } }), ctx)).rejects.toThrow(/not approved/);
    s.record.status = "approved";
    s.record.json = { ...(s.record.json as object), estimate: { durationSec: 5, credits: 50 } };
    await expect(createGenerateFootageHandler(s.deps)(makeJob({ type: "generate_footage", project_id: PID, payload: { storyboardId: s.record.id } }), ctx)).rejects.toThrow(/exceeds the per-reel cap/);
    expect(s.providers.calls.music).toBe(0);
    expect(s.db.renders).toEqual([]);
  }, 300_000);

  it("refuses a plan with nothing left to show (only fillers kept) before any music call", async () => {
    const s = await approvedPlan();
    const fillers = { languageCode: "heb", languageProbability: 0.99, events: [], words: [{ text: "אממ", startMs: 0, endMs: 500 }, { text: "אהה", startMs: 900, endMs: 1600 }] };
    await writeFile(join(s.dir, "fillers.data"), JSON.stringify(fillers));
    await s.store.putFile(FILLERS_HASH, join(s.dir, "fillers.data"), "data", { kind: "data", provider: "fake", model: s.providers.transcriber.model });
    const plan = s.record.json as EditPlan;
    s.record.json = {
      ...plan,
      source: { ...plan.source, transcriptAssetId: FILLERS_HASH },
      beats: [{ id: plan.beats[0].id, startWordIdx: 0, endWordIdx: 1, keep: true }],
      hook: { ...plan.hook, coldOpenBeatId: undefined, patternBreak: "none" },
      music: { kind: "ai", prompt: "calm lo-fi" },
      estimate: { durationSec: 5, credits: 1 },
    };
    await expect(createGenerateFootageHandler(s.deps)(makeJob({ type: "generate_footage", project_id: PID, payload: { storyboardId: s.record.id } }), ctx)).rejects.toThrow(EmptyEditError);
    expect(s.providers.calls.music).toBe(0);
    expect(s.db.renders).toEqual([]);
    expect(s.db.projectStatus.get(PID)?.status).toBe("failed");
  }, 300_000);
});

import { parseEditPlan, type EditPlan } from "@reel/core";
import type { JobProgress } from "@reel/db";
import { createFakeProviders, fakeSegmenter, FileAssetStore, noFaceTracker, type FootagePlanRequest } from "@reel/engine";
import { makeTestImage, makeTestVideo } from "@reel/media";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHARACTER_ID } from "../../../../packages/core/src/testing/fixtures";
import { MirroredAssetStore } from "../storage";
import { InMemoryAssetIndex, InMemoryBlobStore, InMemoryReelDb, makeJob } from "../testing/fakes";
import { createIngestFootageHandler, createPlanFootageHandler } from "./footage";

const PID = "0b5f8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e";
const PATH = `footage/${PID}/source.mp4`;
const TRACK = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const settings = { language: "he", targetDurationSec: 30, ctaKeyword: "AI" };
const ctx = { report: () => {}, log: () => {} };

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "footage-handlers-"));
  const providers = createFakeProviders({ workDir: dir });
  const db = new InMemoryReelDb();
  const blobs = new InMemoryBlobStore();
  await makeTestVideo(join(dir, "upload.mp4"), { durationSec: 6, width: 720, height: 1280, withAudio: true });
  await blobs.upload("assets", PATH, join(dir, "upload.mp4"));
  const requests: FootagePlanRequest[] = [];
  const footagePlanner = { plan: async (r: FootagePlanRequest) => { requests.push(r); return providers.footagePlanner.plan(r); } };
  const deps = { store: new FileAssetStore(join(dir, "cache")), blobs, db, transcriber: providers.transcriber, faceTracker: noFaceTracker, footagePlanner };
  return { dir, db, deps, requests, providers };
}

const ingestJob = (over: Partial<{ project_id: string; settings: typeof settings | { language: string; targetDurationSec: number } }> = {}) =>
  makeJob({ type: "ingest_footage", project_id: over.project_id ?? PID, payload: { storagePath: PATH, settings: over.settings ?? settings } });

async function ingested() {
  const s = await setup();
  await createIngestFootageHandler(s.deps)(ingestJob(), ctx);
  const first = s.db.storyboards[0];
  return { ...s, first, source: (first.json as EditPlan).source };
}

describe("ingest_footage", () => {
  it("prepares the upload and writes edit plan v1 as a draft", async () => {
    const s = await setup();
    const reports: JobProgress[] = [];
    const outcome = await createIngestFootageHandler(s.deps)(ingestJob(), { ...ctx, report: (p) => reports.push(p) });
    expect(outcome.status).toBe("done");
    const plan = parseEditPlan(s.db.storyboards[0].json);
    expect(plan).toMatchObject({ format: "footage", version: 1, ending: { kind: "cta", keyword: "AI" } });
    expect(s.db.projectStatus.get(PID)?.status).toBe("draft");
    expect(s.requests[0].warnings).toEqual([]);
    expect(reports.at(-1)?.steps).toEqual({ conform: "done", transcribe: "done", faces: "done", plan: "done" });
  }, 300_000);

  it("passes transcript warnings and the team music library to the planner", async () => {
    const s = await setup();
    s.db.music.push({ id: TRACK, storagePath: `music/${TRACK}.mp3`, title: "Calm piano", mood: "calm", durationSec: 60 });
    await createIngestFootageHandler(s.deps)(ingestJob({ settings: { ...settings, language: "en" } }), ctx);
    expect(s.requests[0].warnings).toEqual([expect.stringMatching(/You picked English, but the speech sounds like Hebrew/)]);
    expect(s.requests[0].library).toEqual([{ id: TRACK, title: "Calm piano", mood: "calm", durationSec: 60 }]);
    const plan = parseEditPlan(s.db.storyboards[0].json);
    expect(plan.warnings).toEqual(s.requests[0].warnings);
    expect(plan.music).toEqual({ kind: "library", assetId: TRACK });
  }, 300_000);

  it("cuts the speaker out at ingest when the worker has a segmenter, and reports the step", async () => {
    const s = await setup();
    const reports: JobProgress[] = [];
    await createIngestFootageHandler({ ...s.deps, segmenter: fakeSegmenter })(ingestJob(), { report: (p) => reports.push(p), log: () => {} });
    expect((s.db.storyboards[0].json as EditPlan).source.matteAssetId).toMatch(/^[0-9a-f]{64}$/);
    expect(reports.at(-1)?.steps).toMatchObject({ cutout: "done", plan: "done" });
  }, 300_000);

  it("refuses a path that belongs to another project and marks the project failed", async () => {
    const s = await setup();
    const other = "11111111-2222-4333-8444-555555555555";
    await expect(createIngestFootageHandler(s.deps)(ingestJob({ project_id: other }), ctx)).rejects.toThrow(/another reel/);
    expect(s.db.projectStatus.get(other)?.status).toBe("failed");
  });
});

describe("plan_footage (Re-plan)", () => {
  it("re-plans with the instruction and the previous plan, superseding the old draft", async () => {
    const s = await ingested();
    await createPlanFootageHandler(s.deps)(makeJob({ type: "plan_footage", project_id: PID, payload: { settings, source: s.source, fromStoryboardId: s.first.id, instruction: "tighten to 15 s" } }), ctx);
    expect(s.db.storyboards.map((r) => [r.version, r.status])).toEqual([[1, "superseded"], [2, "draft"]]);
    expect(s.requests[1].instruction).toBe("tighten to 15 s");
    expect(s.requests[1].previous?.version).toBe(1);
    expect(s.requests[1].warnings).toEqual([]);
    expect(s.providers.calls.transcribe).toBe(1);
    expect(s.db.projectStatus.get(PID)?.status).toBe("draft");
  }, 300_000);

  it("trims the instruction before it reaches the planner", async () => {
    const s = await ingested();
    await createPlanFootageHandler(s.deps)(makeJob({ type: "plan_footage", project_id: PID, payload: { settings, source: s.source, fromStoryboardId: s.first.id, instruction: "  drop the intro \n" } }), ctx);
    expect(s.requests[1].instruction).toBe("drop the intro");
  }, 300_000);

  it("refuses an instruction over 500 characters without calling the planner, keeping the draft", async () => {
    const s = await ingested();
    const job = makeJob({ type: "plan_footage", project_id: PID, payload: { settings, source: s.source, fromStoryboardId: s.first.id, instruction: "x".repeat(501) } });
    await expect(createPlanFootageHandler(s.deps)(job, ctx)).rejects.toThrow(/500/);
    expect(s.requests).toHaveLength(1);
    expect(s.db.projectStatus.get(PID)?.status).toBe("draft");
    expect(s.db.storyboards.map((r) => r.status)).toEqual(["draft"]);
  }, 300_000);

  it("puts the project back to draft when a Re-plan fails", async () => {
    const s = await ingested();
    const failing = { ...s.deps, footagePlanner: { plan: async () => { throw new Error("Claude is down"); } } };
    await expect(createPlanFootageHandler(failing)(makeJob({ type: "plan_footage", project_id: PID, payload: { settings, source: s.source, fromStoryboardId: s.first.id } }), ctx)).rejects.toThrow(/Claude is down/);
    expect(s.db.projectStatus.get(PID)?.status).toBe("draft");
    expect(s.db.storyboards[0].status).toBe("draft");
  }, 300_000);

  it("keeps the old draft when saving the new one fails", async () => {
    const s = await ingested();
    const db = Object.assign(Object.create(s.db) as InMemoryReelDb, { insertStoryboard: async () => { throw new Error("insert failed"); } });
    await expect(createPlanFootageHandler({ ...s.deps, db })(makeJob({ type: "plan_footage", project_id: PID, payload: { settings, source: s.source, fromStoryboardId: s.first.id } }), ctx)).rejects.toThrow(/insert failed/);
    expect(s.db.storyboards.map((r) => [r.version, r.status])).toEqual([[1, "draft"]]);
    expect(s.db.projectStatus.get(PID)?.status).toBe("draft");
  }, 300_000);

  it("warns and re-plans without context when the previous plan can't be read", async () => {
    const s = await ingested();
    s.first.json = { format: "footage", broken: true };
    const logs: string[] = [];
    await createPlanFootageHandler(s.deps)(makeJob({ type: "plan_footage", project_id: PID, payload: { settings, source: s.source, fromStoryboardId: s.first.id } }), { ...ctx, log: (m) => logs.push(m) });
    expect(s.requests[1].previous).toBeUndefined();
    expect(logs.join("\n")).toMatch(new RegExp(`previous plan ${s.first.id} is not a valid edit plan`));
    expect(s.db.storyboards.map((r) => [r.version, r.status])).toEqual([[1, "superseded"], [2, "draft"]]);
  }, 300_000);

  it("ignores a previous plan from another reel", async () => {
    const s = await ingested();
    s.first.projectId = "11111111-2222-4333-8444-555555555555";
    await createPlanFootageHandler(s.deps)(makeJob({ type: "plan_footage", project_id: PID, payload: { settings, source: s.source, fromStoryboardId: s.first.id } }), ctx);
    expect(s.requests[1].previous).toBeUndefined();
  }, 300_000);

  it("refuses a transcript made by another transcriber (fake vs real) before calling the planner", async () => {
    const s = await ingested();
    const real = { ...s.deps, transcriber: { model: "elevenlabs/scribe_v2", transcribe: async () => { throw new Error("must not transcribe"); } } };
    await expect(createPlanFootageHandler(real)(makeJob({ type: "plan_footage", project_id: PID, payload: { settings, source: s.source, fromStoryboardId: s.first.id } }), ctx)).rejects.toThrow(/fake\/scribe/);
    expect(s.requests).toHaveLength(1);
    expect(s.db.projectStatus.get(PID)?.status).toBe("draft");
  }, 300_000);
});

describe("ingest_footage with a mirrored asset store", () => {
  /** Mirror uploads fail for files with this extension; the upload itself still downloads from s.deps.blobs. */
  async function mirrored(failExt: string) {
    const s = await setup();
    const mirrorBlobs = new InMemoryBlobStore();
    const flaky = {
      upload: async (bucket: string, path: string, file: string) => {
        if (path.endsWith(`.${failExt}`)) throw new Error("object too large");
        return mirrorBlobs.upload(bucket, path, file);
      },
      download: (...a: Parameters<InMemoryBlobStore["download"]>) => mirrorBlobs.download(...a),
    };
    const logs: string[] = [];
    const store = new MirroredAssetStore(new FileAssetStore(join(s.dir, "mcache")), flaky, new InMemoryAssetIndex(), (m) => logs.push(m));
    return { ...s, deps: { ...s.deps, store }, logs, mirrorBlobs };
  }

  it("a failed working-copy mirror logs a warning and ingest still completes", async () => {
    const s = await mirrored("mp4");
    const outcome = await createIngestFootageHandler(s.deps)(ingestJob(), ctx);
    expect(outcome.status).toBe("done");
    expect(s.logs.join("\n")).toMatch(/mirror failed .*object too large.*kept locally/);
    expect([...s.mirrorBlobs.objects.keys()].filter((k) => k.endsWith(".data"))).toHaveLength(2);
    expect(s.db.projectStatus.get(PID)?.status).toBe("draft");
  }, 300_000);

  it("a failed transcript mirror still fails ingest", async () => {
    const s = await mirrored("data");
    await expect(createIngestFootageHandler(s.deps)(ingestJob(), ctx)).rejects.toThrow(/object too large/);
    expect(s.db.projectStatus.get(PID)?.status).toBe("failed");
  }, 300_000);
});

describe("ingest_footage with extras and a character", () => {
  const OTHER = "11111111-2222-4333-8444-555555555555";
  async function run(payloadOver: object, characters = [{ id: CHARACTER_ID, name: "Alex", referenceId: "soul-ref-123" }]) {
    const dir = await mkdtemp(join(tmpdir(), "ingest-extras-"));
    const providers = createFakeProviders({ workDir: dir });
    const db = new InMemoryReelDb();
    db.characters.push(...characters);
    const blobs = new InMemoryBlobStore();
    const store = new FileAssetStore(join(dir, "cache"));
    await makeTestVideo(join(dir, "up.mp4"), { durationSec: 6, width: 720, height: 1280, withAudio: true });
    await makeTestImage(join(dir, "shot.png"), { width: 1920, height: 1080 });
    await blobs.upload("assets", `footage/${PID}/source.mp4`, join(dir, "up.mp4"));
    await blobs.upload("assets", `footage/${PID}/extra-1.png`, join(dir, "shot.png"));
    const payload = {
      storagePath: `footage/${PID}/source.mp4`,
      settings: { language: "he", targetDurationSec: 15, characterId: CHARACTER_ID },
      extras: [{ storagePath: `footage/${PID}/extra-1.png`, label: "צילום מסך" }],
      ...payloadOver,
    };
    await createIngestFootageHandler({ store, blobs, db, transcriber: providers.transcriber, faceTracker: noFaceTracker, footagePlanner: providers.footagePlanner })(
      makeJob({ type: "ingest_footage", project_id: PID, payload }), { report: () => {}, log: () => {} });
    return parseEditPlan(db.storyboards[0].json);
  }
  it("conforms the extras, plans with them and with the picked character", async () => {
    const plan = await run({});
    expect(plan.source.extras.map((e) => [e.kind, e.label])).toEqual([["image", "צילום מסך"]]);
    expect(plan.character).toEqual({ id: CHARACTER_ID, name: "Alex" });
    expect(plan.beats[0].cutaway?.source).toEqual({ kind: "upload", assetId: plan.source.extras[0].assetId });
  }, 300_000);
  it("warns (and plans without AI shots of you) when the picked character was removed", async () => {
    const plan = await run({}, []);
    expect(plan.character).toBeUndefined();
    expect(plan.warnings).toContain("The character you picked was removed, so AI shots of you are off.");
  }, 300_000);
  it("refuses extras stored under another reel", async () => {
    await expect(run({ extras: [{ storagePath: `footage/${OTHER}/extra-1.png`, label: "x" }] })).rejects.toThrow("This upload belongs to another reel.");
  }, 300_000);
});

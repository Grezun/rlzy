import { parseEditPlan, type EditPlan } from "@reel/core";
import type { JobProgress } from "@reel/db";
import { createFakeProviders, FileAssetStore, noFaceTracker, type FootagePlanRequest } from "@reel/engine";
import { makeTestVideo } from "@reel/media";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryBlobStore, InMemoryReelDb, makeJob } from "../testing/fakes";
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
  return { db, deps, requests, providers };
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

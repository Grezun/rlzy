import { parseEditPlan, type EditPlan } from "@reel/core";
import { describe, expect, it, vi } from "vitest";
import { footageTranscript, validEditPlan } from "../../../packages/core/src/testing/fixtures";
import { approvePlan, newPlanVersion, replan, retryFootageGenerate, retryIngest, savePlan, type PlanWriteDeps } from "./approve-plan";

const SB = "9a1b2c3d-1111-4222-8333-444455556666";
const stored = () => parseEditPlan(validEditPlan());
type Row = Awaited<ReturnType<PlanWriteDeps["getStoryboard"]>>;
function deps(over: Partial<PlanWriteDeps> = {}): PlanWriteDeps & { queued: unknown[]; written: EditPlan[]; inserted: EditPlan[] } {
  const queued: unknown[] = [];
  const written: EditPlan[] = [];
  const inserted: EditPlan[] = [];
  return {
    queued, written, inserted,
    getStoryboard: vi.fn(async (): Promise<Row> => ({ projectId: "p1", version: 1, status: "draft", json: stored() })),
    loadWords: vi.fn(async () => footageTranscript().words),
    updateDraft: vi.fn(async (_p, _id, json) => { written.push(json); return 1; }),
    queueJob: vi.fn(async (_p, type, payload) => { queued.push([type, payload]); }),
    setProjectStatus: vi.fn(async () => {}),
    activeJobCount: vi.fn(async () => 0),
    hasDoneGenerate: vi.fn(async () => false),
    maxVersion: vi.fn(async () => 1),
    projectStatus: vi.fn(async () => "failed" as const),
    ingestPayload: vi.fn(async () => ({ storagePath: "footage/x/source.mp4", settings: { language: "he" as const, targetDurationSec: 15 as const, notes: "קצר" }, extras: [] })),
    insertDraft: vi.fn(async (_p, _v, json) => { inserted.push(json); }),
    ...over,
  };
}
const approvedRow = async (): Promise<Row> => ({ projectId: "p1", version: 1, status: "approved", json: stored() });

describe("savePlan / approvePlan", () => {
  it("keeps server-owned fields and recomputes the estimate (never trusts the client)", async () => {
    const d = deps();
    const client = { ...stored(), source: { ...stored().source, assetId: "f".repeat(64) }, estimate: { durationSec: 1, credits: 0 }, music: { kind: "ai", prompt: "lofi" } };
    expect(await savePlan(d, { projectId: "p1", storyboardId: SB, json: client })).toEqual({ ok: true });
    expect(d.written[0].source.assetId).toBe("a".repeat(64));
    expect(d.written[0].estimate).toEqual({ durationSec: 7.3, credits: 0.08 });
  });
  it("keeps the stored beat spans and reports a red word moved outside its beat as an error", async () => {
    const d = deps();
    const client = { ...stored(), beats: stored().beats.map((b, i) => (i === 1 ? { ...b, startWordIdx: 0, endWordIdx: 14, emphasisWordIdx: 2 } : b)) };
    const r = await savePlan(d, { projectId: "p1", storyboardId: SB, json: client });
    expect(r.ok).toBe(false);
    expect(d.written).toEqual([]);
  });
  it("approves and queues generate_footage", async () => {
    const d = deps();
    expect(await approvePlan(d, { projectId: "p1", storyboardId: SB, json: stored() })).toEqual({ ok: true });
    expect(d.queued).toEqual([["generate_footage", { storyboardId: SB }]]);
    expect(d.setProjectStatus).toHaveBeenCalledWith("p1", "generating");
  });
  it("refuses while a job is running", async () => {
    const r = await approvePlan(deps({ activeJobCount: async () => 1 }), { projectId: "p1", storyboardId: SB, json: stored() });
    expect(r).toEqual({ ok: false, errors: ["A job for this reel is already queued or running."] });
  });
  it("refuses a plan with nothing left to show (every kept word is a filler) and writes nothing", async () => {
    const fillersOnly = footageTranscript().words.map((w) => ({ ...w, text: "אממ" }));
    const d = deps({ loadWords: async () => fillersOnly });
    const r = await approvePlan(d, { projectId: "p1", storyboardId: SB, json: stored() });
    expect(r).toEqual({ ok: false, errors: ["Nothing to show: no kept beat has speech left after cutting pauses and fillers. Keep at least one beat with speech."] });
    expect(d.written).toEqual([]);
    expect(d.queued).toEqual([]);
  });
});

describe("retryFootageGenerate / newPlanVersion", () => {
  const input = { projectId: "p1", storyboardId: SB };
  it("re-queues generate_footage for the latest approved, never-generated plan", async () => {
    const d = deps({ getStoryboard: approvedRow });
    expect(await retryFootageGenerate(d, input)).toEqual({ ok: true });
    expect(d.queued).toEqual([["generate_footage", { storyboardId: SB }]]);
  });
  it("keeps the retry guards: not approved, a newer version, already generated", async () => {
    expect(await retryFootageGenerate(deps(), input)).toEqual({ ok: false, errors: ["Only an approved edit plan can be generated."] });
    const old = deps({ getStoryboard: approvedRow, maxVersion: async () => 2 });
    expect(await retryFootageGenerate(old, input)).toEqual({ ok: false, errors: ["A newer version exists — approve that one instead."] });
    const done = deps({ getStoryboard: approvedRow, hasDoneGenerate: async () => true });
    expect(await retryFootageGenerate(done, input)).toEqual({ ok: false, errors: ["This version was already generated. Use “Edit as new version” to make changes."] });
    expect([...old.queued, ...done.queued]).toEqual([]);
  });
  it("copies the plan into the next draft version", async () => {
    const d = deps({ getStoryboard: approvedRow });
    expect(await newPlanVersion(d, input)).toEqual({ ok: true });
    expect(d.inserted[0]).toMatchObject({ version: 2, format: "footage", source: stored().source });
    expect(d.setProjectStatus).toHaveBeenCalledWith("p1", "draft");
  });
});

describe("replan / retryIngest", () => {
  it("queues plan_footage with the original settings, the source and the instruction", async () => {
    const d = deps();
    expect(await replan(d, { projectId: "p1", storyboardId: SB, instruction: " tighten to 15 s " })).toEqual({ ok: true });
    expect(d.queued).toEqual([["plan_footage", { settings: { language: "he", targetDurationSec: 15, notes: "קצר" }, source: stored().source, fromStoryboardId: SB, instruction: "tighten to 15 s" }]]);
    expect(d.setProjectStatus).toHaveBeenCalledWith("p1", "planning");
  });
  it("refuses a Re-plan of an old version", async () => {
    const r = await replan(deps({ maxVersion: async () => 2 }), { projectId: "p1", storyboardId: SB, instruction: "" });
    expect(r.ok).toBe(false);
  });
  it("refuses a Re-plan of an approved plan and an over-long instruction, queuing nothing", async () => {
    const approved = deps({ getStoryboard: approvedRow });
    expect(await replan(approved, { projectId: "p1", storyboardId: SB, instruction: "" })).toEqual({
      ok: false, errors: ["Only a draft edit plan can be re-planned. Use “Edit as new version” first."],
    });
    const long = deps();
    expect(await replan(long, { projectId: "p1", storyboardId: SB, instruction: "x".repeat(501) })).toEqual({
      ok: false, errors: ["Keep the Re-plan instruction to 500 characters or fewer."],
    });
    expect([...approved.queued, ...long.queued]).toEqual([]);
  });
  it("re-queues the last ingest payload after a failed ingest (failed project, no plan yet)", async () => {
    const d = deps({ maxVersion: async () => 0 });
    expect(await retryIngest(d, { projectId: "p1" })).toEqual({ ok: true });
    expect(d.queued[0]).toEqual(["ingest_footage", { storagePath: "footage/x/source.mp4", settings: { language: "he", targetDurationSec: 15, notes: "קצר" }, extras: [] }]);
  });
  it("refuses to re-run ingest once an edit plan exists, queuing nothing", async () => {
    const d = deps({ maxVersion: async () => 1 });
    expect(await retryIngest(d, { projectId: "p1" })).toEqual({ ok: false, errors: ["This video already has an edit plan. Open it instead of re-running the upload steps."] });
    expect(d.queued).toEqual([]);
    expect(d.setProjectStatus).not.toHaveBeenCalled();
  });
  it("refuses unless the project failed, queuing nothing", async () => {
    for (const status of ["draft", "planning", "generating", "rendered", "needs_attention"] as const) {
      const d = deps({ maxVersion: async () => 0, projectStatus: async () => status });
      expect(await retryIngest(d, { projectId: "p1" })).toEqual({ ok: false, errors: ["Only a failed upload can be retried."] });
      expect(d.queued).toEqual([]);
    }
  });
});

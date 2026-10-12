import { describe, expect, it } from "vitest";
import { applyPipelineEvent, emptyProgress, GenerateJobPayloadSchema, IngestFootageJobPayloadSchema, JobProgressSchema, PlanFootageJobPayloadSchema, renderPaths } from "./index";

describe("@reel/db", () => {
  it("folds pipeline events into job progress", () => {
    let p = emptyProgress();
    p = applyPipelineEvent(p, { type: "step", step: "voice", status: "running" });
    p = applyPipelineEvent(p, { type: "step", step: "voice", status: "done" });
    p = applyPipelineEvent(p, { type: "scene", sceneId: "s2", status: "failed", reason: "blocked" });
    p = applyPipelineEvent(p, { type: "render-progress", progress: 0.42 });
    expect(p).toEqual({
      steps: { voice: "done" },
      scenes: { s2: { status: "failed", reason: "blocked" } },
      renderProgress: 0.42,
    });
    expect(JobProgressSchema.parse(p)).toEqual(p);
  });

  it("does not mutate the input progress", () => {
    const p = emptyProgress();
    applyPipelineEvent(p, { type: "step", step: "voice", status: "running" });
    expect(p).toEqual(emptyProgress());
  });

  it("parses stored progress with defaults for missing keys", () => {
    expect(JobProgressSchema.parse({})).toEqual({ steps: {}, scenes: {} });
  });

  it("builds render storage paths per project version", () => {
    expect(renderPaths("p1", 3)).toEqual({ reel: "p1/v3/reel.mp4", preview: "p1/v3/preview.mp4", thumbnail: "p1/v3/thumbnail.jpg", srt: "p1/v3/reel.srt" });
  });

  it("validates generate payloads", () => {
    expect(GenerateJobPayloadSchema.safeParse({ storyboardId: "not-a-uuid" }).success).toBe(false);
    expect(GenerateJobPayloadSchema.parse({ storyboardId: "0b5f7a2e-8c2d-4b8a-9f3e-2a1c5d6e7f80" }).storyboardId).toBeTruthy();
  });
});

describe("footage payloads and progress", () => {
  it("validates the ingest payload path", () => {
    const settings = { language: "he", targetDurationSec: 30 };
    const id = "0b5f8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e";
    expect(IngestFootageJobPayloadSchema.parse({ storagePath: `footage/${id}/source.mp4`, settings }).storagePath).toContain(id);
    expect(() => IngestFootageJobPayloadSchema.parse({ storagePath: "footage/x/source.mp4", settings })).toThrow();
  });
  it("accepts footage steps and appends notes", () => {
    let p = applyPipelineEvent(emptyProgress(), { type: "step", step: "transcribe", status: "running" });
    p = applyPipelineEvent(p, { type: "note", message: "AI music failed twice" });
    p = applyPipelineEvent(p, { type: "note", message: "No sound effects" });
    expect(JobProgressSchema.parse(p)).toEqual({ steps: { transcribe: "running" }, scenes: {}, notes: ["AI music failed twice", "No sound effects"] });
  });
  it("validates the plan-footage payload", () => {
    const base = {
      settings: { language: "he", targetDurationSec: 30 },
      source: { assetId: "a".repeat(64), durationMs: 9000, transcriptAssetId: "b".repeat(64), faceTrackAssetId: "c".repeat(64) },
    };
    expect(PlanFootageJobPayloadSchema.parse(base).instruction).toBeUndefined();
    expect(() => PlanFootageJobPayloadSchema.parse({ ...base, instruction: "x".repeat(501) })).toThrow();
    expect(() => PlanFootageJobPayloadSchema.parse({ ...base, fromStoryboardId: "not-a-uuid" })).toThrow();
  });
});

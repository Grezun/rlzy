import { describe, expect, it } from "vitest";
import { describeJob } from "./progress-view";

const job = (over: Record<string, unknown>) => ({ type: "generate", status: "running", progress: {}, error: null, ...over });

describe("describeJob", () => {
  it("returns null without a job", () => {
    expect(describeJob(null, [])).toBeNull();
  });
  it("describes planning", () => {
    expect(describeJob(job({ type: "plan", status: "running" }), [])).toMatchObject({ headline: "Claude is writing the storyboard…", tone: "info", steps: [] });
    expect(describeJob(job({ type: "plan", status: "failed", error: "No voice for he" }), [])).toMatchObject({ tone: "error", error: "No voice for he" });
  });
  it("maps generate progress to steps, scene states and render percent", () => {
    const view = describeJob(
      job({ progress: { steps: { voice: "done", visuals: "done", render: "running" }, scenes: { s1: { status: "done" } }, renderProgress: 0.456 } }),
      ["s1", "s2"],
    )!;
    expect(view.steps.map((s) => `${s.key}:${s.state}`)).toEqual(["voice:done", "visuals:done", "render:running", "export:pending"]);
    expect(view.scenes).toEqual([{ id: "s1", state: "done" }, { id: "s2", state: "pending" }]);
    expect(view.renderPercent).toBe(46);
  });
  it("explains needs_attention with the failing scene reasons", () => {
    const view = describeJob(
      job({ status: "needs_attention", error: "1 scene(s) failed", progress: { scenes: { s2: { status: "failed", reason: "blocked by content moderation" } } } }),
      ["s2"],
    )!;
    expect(view.tone).toBe("warning");
    expect(view.headline).toMatch(/fix their prompts/);
    expect(view.scenes[0]).toEqual({ id: "s2", state: "failed", reason: "blocked by content moderation" });
  });
  it("tolerates malformed progress JSON", () => {
    expect(describeJob(job({ progress: { steps: "nope" } }), ["s1"])!.steps.every((s) => s.state === "pending")).toBe(true);
  });
  it("describes footage jobs with their steps and notes", () => {
    const ingest = describeJob({ type: "ingest_footage", status: "running", progress: { steps: { conform: "done", faces: "done", transcribe: "running" }, scenes: {} }, error: null }, []);
    expect(ingest!.headline).toBe("Preparing your video: transcribing, cutting you out and planning the edit…");
    expect(ingest!.steps.map((s) => `${s.label}:${s.state}`)).toEqual(["Prepare video:done", "Find face:done", "Transcribe:running", "Cut you out:pending", "Plan the edit:pending"]);
    const gen = describeJob({ type: "generate_footage", status: "done", progress: { steps: {}, scenes: {}, notes: ["AI music failed (x), so the reel has no music."] }, error: null }, []);
    expect(gen!.headline).toBe("Your reel is ready. Some parts were skipped:");
    expect(gen!.tone).toBe("warning");
    expect(gen!.notes).toEqual(["AI music failed (x), so the reel has no music."]);
    expect(describeJob({ type: "generate_footage", status: "done", progress: {}, error: null }, [])).toMatchObject({ headline: "Your reel is ready.", tone: "success", notes: [] });
    expect(describeJob({ type: "plan_footage", status: "running", progress: {}, error: null }, [])!.headline).toBe("Claude is re-planning the edit…");
  });
  it("lists the cutaway step of footage generation", () => {
    const v = describeJob({ type: "generate_footage", status: "running", progress: { steps: { voice: "done", music: "done", visuals: "running" }, scenes: {}, notes: [] }, error: null }, []);
    expect(v!.steps.map((s) => [s.key, s.label, s.state])).toEqual([
      ["voice", "Cut audio", "done"], ["music", "Music", "done"], ["background", "Background", "pending"], ["visuals", "Cutaways", "running"], ["render", "Render", "pending"], ["export", "Export", "pending"],
    ]);
  });
});

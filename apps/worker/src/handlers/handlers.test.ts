import { SpendCapError } from "@reel/core";
import type { PlanRequest } from "@reel/engine";
import { costModels, createFakeProviders, FileAssetStore, loadConfig } from "@reel/engine";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FAKE_VOICE_ID } from "../fake-voice";
import { InMemoryBlobStore, InMemoryReelDb, makeJob } from "../testing/fakes";
import { createGenerateHandler } from "./generate";
import { createPlanHandler } from "./plan";

const FORM = { brief: "3 טיפים לצמיחה בטיקטוק", language: "he", targetDurationSec: 15, pacing: "punchy", captionPreset: "bold_pop", palette: ["#FFE14D", "#111111"] };
const ctx = () => {
  const reports: unknown[] = [];
  return { reports, ctx: { report: (p: unknown) => void reports.push(p), log: () => {} } };
};

async function setup(failPromptsContaining?: string) {
  const dir = await mkdtemp(join(tmpdir(), "handlers-"));
  const providers = createFakeProviders({ workDir: dir, failPromptsContaining });
  const db = new InMemoryReelDb();
  const blobs = new InMemoryBlobStore();
  const config = loadConfig({ REEL_CACHE_DIR: join(dir, "cache") }, { providers: "fake" });
  const plan = createPlanHandler({ planner: providers.planner, db, voices: {}, voiceModelId: "eleven_v4", forceVoiceId: FAKE_VOICE_ID });
  const generate = (over: Partial<Parameters<typeof createGenerateHandler>[0]> = {}) =>
    createGenerateHandler({ providers, store: new FileAssetStore(config.cacheDir), blobs, db, spendCapUsd: 10, costModels: costModels(config), requireVoiceId: FAKE_VOICE_ID, ...over });
  return { dir, providers, db, blobs, plan, generate };
}

async function planAndApprove(s: Awaited<ReturnType<typeof setup>>) {
  await s.plan(makeJob({ type: "plan", project_id: "p1", payload: FORM }), ctx().ctx);
  const record = s.db.storyboards[0];
  record.status = "approved";
  return record;
}

describe("plan handler", () => {
  it("writes storyboard v1 as an agent draft and moves the project to draft with the title", async () => {
    const s = await setup();
    const outcome = await s.plan(makeJob({ type: "plan", project_id: "p1", payload: FORM }), ctx().ctx);
    expect(outcome).toEqual({ status: "done" });
    expect(s.db.storyboards).toHaveLength(1);
    expect(s.db.storyboards[0]).toMatchObject({ projectId: "p1", version: 1, status: "draft" });
    expect((s.db.storyboards[0].json as { voice: { voiceId: string }; version: number }).voice.voiceId).toBe(FAKE_VOICE_ID);
    expect(s.db.projectStatus.get("p1")?.status).toBe("draft");
  });

  it("uses the form's voice id, else the language default, and fails clearly without either", async () => {
    const s = await setup();
    const withDefaults = createPlanHandler({ planner: s.providers.planner, db: s.db, voices: { he: "voice-he" }, voiceModelId: "eleven_v4" });
    await withDefaults(makeJob({ type: "plan", project_id: "p2", payload: FORM }), ctx().ctx);
    expect((s.db.storyboards.at(-1)!.json as { voice: { voiceId: string } }).voice.voiceId).toBe("voice-he");
    await withDefaults(makeJob({ type: "plan", project_id: "p3", payload: { ...FORM, voiceId: "chosen" } }), ctx().ctx);
    expect((s.db.storyboards.at(-1)!.json as { voice: { voiceId: string } }).voice.voiceId).toBe("chosen");
    const noVoice = createPlanHandler({ planner: s.providers.planner, db: s.db, voices: {}, voiceModelId: "eleven_v4" });
    await expect(noVoice(makeJob({ type: "plan", project_id: "p4", payload: FORM }), ctx().ctx)).rejects.toThrow(/ELEVENLABS_VOICE_HE/);
    expect(s.db.projectStatus.get("p4")?.status).toBe("failed");
  });

  it("rejects an invalid payload and marks the project failed", async () => {
    const s = await setup();
    await expect(s.plan(makeJob({ type: "plan", project_id: "p5", payload: { brief: "x" } }), ctx().ctx)).rejects.toThrow();
    expect(s.db.projectStatus.get("p5")?.status).toBe("failed");
  });
});

describe("plan handler with a style", () => {
  const MYTH = { id: "myth-fact", values: { TOPIC: "שינה", MYTH: "8 שעות", FACT: "משתנה", EVIL: "x" }, script: "שלום עולם" };
  async function recording() {
    const s = await setup();
    const calls: PlanRequest[] = [];
    const planner = { plan: async (r: PlanRequest) => { calls.push(r); return s.providers.planner.plan(r); } };
    const handler = createPlanHandler({ planner, db: s.db, voices: {}, voiceModelId: "eleven_v4", forceVoiceId: FAKE_VOICE_ID });
    return { s, calls, handler };
  }

  it("fills the style template and passes style to the planner", async () => {
    const { calls, handler } = await recording();
    await handler(makeJob({ type: "plan", project_id: "p1", payload: { ...FORM, brief: "Myth vs Fact: שינה", style: MYTH } }), ctx().ctx);
    const st = calls[0].style!;
    expect(st.name).toBe("Myth vs Fact");
    expect(st.brief).toMatch(/Misconception: 8 שעות/);
    expect(st.brief).toMatch(/Exact Hebrew narration: שלום עולם/);
    expect(st.brief).not.toMatch(/\{\{/);
    expect(st.engineNotes.length).toBeGreaterThan(0);
    expect(st.script).toBe("שלום עולם");
  });

  it("drafts the voiceover when the style payload has no script", async () => {
    const { calls, handler } = await recording();
    const { script: _omit, ...noScript } = MYTH;
    await handler(makeJob({ type: "plan", project_id: "p9", payload: { ...FORM, brief: "Myth vs Fact: שינה", style: noScript } }), ctx().ctx);
    const st = calls[0].style!;
    expect(st.brief).toMatch(/Exact Hebrew narration: not provided: draft one/);
    expect(st.brief).not.toMatch(/\{\{/);
    expect(st.script).toBeUndefined();
    expect("script" in st).toBe(false);
  });

  it.each([["presenter"], ["no-such-style"], ["custom"]])("refuses style %s and marks the project failed", async (id) => {
    const { s, handler } = await recording();
    await expect(handler(makeJob({ type: "plan", project_id: "p6", payload: { ...FORM, style: { id, values: { TOPIC: "t", MAIN_MESSAGE: "m" } } } }), ctx().ctx)).rejects.toThrow(/not available/);
    expect(s.db.projectStatus.get("p6")?.status).toBe("failed");
  });

  it("refuses a style payload missing a required field", async () => {
    const { s, handler } = await recording();
    await expect(handler(makeJob({ type: "plan", project_id: "p7", payload: { ...FORM, style: { id: "myth-fact", values: { TOPIC: "t" } } } }), ctx().ctx)).rejects.toThrow(/Misconception is required/);
    expect(s.db.projectStatus.get("p7")?.status).toBe("failed");
  });

  it("passes no style for a payload without one (Custom, old jobs)", async () => {
    const { calls, handler } = await recording();
    await handler(makeJob({ type: "plan", project_id: "p8", payload: FORM }), ctx().ctx);
    expect(calls[0].style).toBeUndefined();
    expect(calls[0].brief).toBe(FORM.brief);
  });
});

describe("generate handler", () => {
  it("renders, uploads the three deliverables, stores an asset-ref timeline and marks the project rendered", async () => {
    const s = await setup();
    const record = await planAndApprove(s);
    const { reports, ctx: c } = ctx();
    const outcome = await s.generate()(makeJob({ type: "generate", project_id: "p1", payload: { storyboardId: record.id } }), c);
    expect(outcome.status).toBe("done");
    expect([...s.blobs.objects.keys()].sort()).toEqual(["renders/p1/v1/preview.mp4", "renders/p1/v1/reel.mp4", "renders/p1/v1/reel.srt", "renders/p1/v1/thumbnail.jpg"]);
    expect(s.db.renders).toHaveLength(1);
    const render = s.db.renders[0];
    expect(render).toMatchObject({ projectId: "p1", storyboardId: record.id, storyboardVersion: 1 });
    expect(render.paths.srt).toBe("p1/v1/reel.srt");
    expect(render.timeline.audio.voiceUrl).toMatch(/^asset:/);
    expect(render.timeline.clips.filter((c) => c.kind !== "graphic").every((c) => c.src?.startsWith("asset:"))).toBe(true);
    expect(s.db.projectStatus.get("p1")?.status).toBe("rendered");
    expect(reports.length).toBeGreaterThan(0);
    expect(outcome.progress?.steps.export).toBe("done");
  }, 600_000);

  it("is idempotent: a second generate for an already-rendered storyboard makes no provider calls and keeps one render", async () => {
    const s = await setup();
    const record = await planAndApprove(s);
    const job = () => makeJob({ type: "generate", project_id: "p1", payload: { storyboardId: record.id } });
    expect((await s.generate()(job(), ctx().ctx)).status).toBe("done");
    s.db.projectStatus.set("p1", { status: "generating" });
    const voice = vi.spyOn(s.providers.voice, "synthesize");
    const image = vi.spyOn(s.providers.image, "generate");
    const video = vi.spyOn(s.providers.video, "imageToVideo");
    const second = await s.generate()(job(), ctx().ctx);
    expect(second.status).toBe("done");
    expect(voice).not.toHaveBeenCalled();
    expect(image).not.toHaveBeenCalled();
    expect(video).not.toHaveBeenCalled();
    expect(s.db.renders).toHaveLength(1);
    expect(s.db.projectStatus.get("p1")?.status).toBe("rendered");
  }, 600_000);

  it("refuses a storyboard that isn't approved, before any spend", async () => {
    const s = await setup();
    await s.plan(makeJob({ type: "plan", project_id: "p1", payload: FORM }), ctx().ctx);
    const draft = s.db.storyboards[0];
    await expect(s.generate()(makeJob({ type: "generate", project_id: "p1", payload: { storyboardId: draft.id } }), ctx().ctx)).rejects.toThrow(/not approved/);
    expect(s.providers.calls.voice + s.providers.calls.image + s.providers.calls.video).toBe(0);
  });

  it("refuses a storyboard from another project", async () => {
    const s = await setup();
    const record = await planAndApprove(s);
    await expect(s.generate()(makeJob({ type: "generate", project_id: "other", payload: { storyboardId: record.id } }), ctx().ctx)).rejects.toThrow(/not found for this project/);
    expect(s.providers.calls.voice + s.providers.calls.image + s.providers.calls.video).toBe(0);
  });

  it("stops at the spend cap before any provider call and marks the project failed", async () => {
    const s = await setup();
    const record = await planAndApprove(s);
    await expect(s.generate({ spendCapUsd: 0.0001 })(makeJob({ type: "generate", project_id: "p1", payload: { storyboardId: record.id } }), ctx().ctx)).rejects.toBeInstanceOf(SpendCapError);
    expect(s.providers.calls.voice + s.providers.calls.image + s.providers.calls.video).toBe(0);
    expect(s.db.projectStatus.get("p1")?.status).toBe("failed");
  });

  it("returns needs_attention with the failed scene when a scene fails", async () => {
    const s = await setup("FAIL");
    await s.plan(makeJob({ type: "plan", project_id: "p1", payload: FORM }), ctx().ctx);
    const record = s.db.storyboards[0];
    (record.json as { scenes: { visual: { prompt?: string } }[] }).scenes[1].visual.prompt = "FAIL this prompt";
    record.status = "approved";
    const outcome = await s.generate()(makeJob({ type: "generate", project_id: "p1", payload: { storyboardId: record.id } }), ctx().ctx);
    expect(outcome.status).toBe("needs_attention");
    expect(outcome.status !== "done" && outcome.error).toMatch(/s2/);
    expect(outcome.progress?.scenes.s2?.status).toBe("failed");
    expect(s.db.projectStatus.get("p1")?.status).toBe("needs_attention");
  }, 300_000);

  it("in fake mode refuses storyboards that use a real voice (keeps fake audio out of the shared cache)", async () => {
    const s = await setup();
    const record = await planAndApprove(s);
    (record.json as { voice: { voiceId: string } }).voice.voiceId = "real-voice-id";
    await expect(s.generate()(makeJob({ type: "generate", project_id: "p1", payload: { storyboardId: record.id } }), ctx().ctx)).rejects.toThrow(/fake providers/);
    expect(s.providers.calls.voice + s.providers.calls.image + s.providers.calls.video).toBe(0);
  });

  it("real mode refuses a fake-voice storyboard before any spend", async () => {
    const s = await setup();
    const record = await planAndApprove(s);
    await expect(s.generate({ requireVoiceId: undefined, forbidVoiceId: FAKE_VOICE_ID })(makeJob({ type: "generate", project_id: "p1", payload: { storyboardId: record.id } }), ctx().ctx)).rejects.toThrow(/fake-mode worker/);
    expect(s.providers.calls.voice + s.providers.calls.image + s.providers.calls.video).toBe(0);
  });

  it("refuses a record whose JSON version differs from the stored version", async () => {
    const s = await setup();
    const record = await planAndApprove(s);
    (record.json as { version: number }).version = 7;
    await expect(s.generate()(makeJob({ type: "generate", project_id: "p1", payload: { storyboardId: record.id } }), ctx().ctx)).rejects.toThrow(/does not match stored version/);
    expect(s.providers.calls.voice + s.providers.calls.image + s.providers.calls.video).toBe(0);
  });
});

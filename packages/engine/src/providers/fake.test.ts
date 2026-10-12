import { makeTestTone } from "@reel/media";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { footageTranscript, validEditPlan } from "../../../core/src/testing/fixtures";
import { createFakeProviders } from "./fake";

describe("fake footage providers", () => {
  it("transcribes any audio into the fake Hebrew talk, inside the audio's length", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fake-footage-"));
    const p = createFakeProviders({ workDir: dir });
    await makeTestTone(join(dir, "a.wav"), { durationSec: 6 });
    const { transcript } = await p.transcriber.transcribe(join(dir, "a.wav"));
    expect(p.transcriber.model).toBe("fake/scribe");
    expect(transcript.languageCode).toBe("heb");
    expect(transcript.words.length).toBeGreaterThanOrEqual(5);
    expect(transcript.words.at(-1)!.endMs).toBeLessThanOrEqual(6000);
    expect(p.calls.transcribe).toBe(1);
  });
  it("composes fake music of the requested length", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fake-music-"));
    const p = createFakeProviders({ workDir: dir });
    const { audio, ext } = await p.music.compose({ prompt: "x", durationMs: 4000 });
    expect(ext).toBe("wav");
    expect(audio.length).toBeGreaterThan(1000);
    expect(p.music.model).toBe("fake/music");
    expect(p.calls.music).toBe(1);
  });
  it("plans a footage edit through the real planner validation: all beats kept, the CTA keyword, AI music", async () => {
    const p = createFakeProviders({ workDir: await mkdtemp(join(tmpdir(), "fake-plan-")) });
    const plan = await p.footagePlanner.plan({
      settings: { language: "he", targetDurationSec: 15, ctaKeyword: "AI" },
      source: validEditPlan().source,
      transcript: footageTranscript(),
      library: [],
      warnings: [],
    });
    expect(plan.beats.map((b) => [b.id, b.keep])).toEqual([["b1", true], ["b2", true], ["b3", true]]);
    expect(plan.ending).toEqual({ kind: "cta", keyword: "AI" });
    expect(plan.music.kind).toBe("ai");
    expect(p.calls.plan).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { validEditPlan } from "../testing/fixtures";
import { EditPlanDraftSchema, EditPlanSchema, parseEditPlan } from "./edit-plan";
import { FaceTrackSchema, RawFaceTrackSchema, TranscriptSchema } from "./footage";

describe("EditPlanSchema", () => {
  it("accepts the fixture and defaults warnings", () => {
    const { warnings: _w, ...noWarnings } = validEditPlan();
    expect(parseEditPlan(noWarnings).warnings).toEqual([]);
  });
  it("requires contiguous beats in source order", () => {
    const p = validEditPlan();
    p.beats[1].startWordIdx = 9;
    expect(() => parseEditPlan(p)).toThrow(/beats\.1\.startWordIdx: beat b2 must start at word 8/);
  });
  it("keeps the emphasis word inside its beat", () => {
    const p = validEditPlan();
    p.beats[0].emphasisWordIdx = 9;
    expect(() => parseEditPlan(p)).toThrow(/word 9 is outside beat b1 \(words 0–7\)/);
  });
  it("needs at least one kept beat and a kept cold-open beat", () => {
    const none = validEditPlan();
    none.beats.forEach((b) => (b.keep = false));
    expect(() => parseEditPlan(none)).toThrow(/Keep at least one beat/);
    const cold = validEditPlan();
    cold.beats[1].keep = false;
    expect(() => parseEditPlan({ ...cold, hook: { ...cold.hook, coldOpenBeatId: "b2" } })).toThrow(/cold-open beat b2 is dropped/);
    expect(() => parseEditPlan({ ...cold, hook: { ...cold.hook, coldOpenBeatId: "b9" } })).toThrow(/no beat b9/);
  });
  it("needs a keyword for a CTA ending", () => {
    expect(() => parseEditPlan({ ...validEditPlan(), ending: { kind: "cta", keyword: " " } })).toThrow(/ending\.keyword/);
  });
});

describe("plan 1 limits", () => {
  it("accepts the full plan 2/3 shape in the schema but parseEditPlan rejects it with clear messages", () => {
    const p = {
      ...validEditPlan(),
      hook: { ...validEditPlan().hook, patternBreak: "broll" },
      background: { mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "ai", prompt: "office" } }] },
      beats: validEditPlan().beats.map((b, i) =>
        i === 0 ? { ...b, cutaway: { source: { kind: "ai_broll", prompt: "laptop" }, layout: "full", atMs: 0, durationMs: 1500 } } : b,
      ),
    };
    expect(EditPlanSchema.safeParse(p).success).toBe(true);
    let message = "";
    try { parseEditPlan(p); } catch (err) { message = (err as Error).message; }
    expect(message).toContain("Beat b1 has a cutaway. Cutaways arrive in a later update: remove it.");
    expect(message).toContain("Background replacement arrives in a later update: keep the original background.");
    expect(message).toContain("The B-roll pattern break needs cutaways, which arrive in a later update: pick zoom hit, flash or none.");
  });
  it("never offers cutaways, background or broll to Claude", () => {
    const json = JSON.stringify(EditPlanDraftSchema.toJSONSchema());
    expect(json).not.toMatch(/cutaway|background|broll/);
  });
});

describe("footage data schemas", () => {
  it("parses a transcript, a raw face track (null boxes) and a smoothed track", () => {
    expect(TranscriptSchema.parse({ languageCode: "heb", languageProbability: 0.9, words: [{ text: "שלום", startMs: 0, endMs: 300 }] }).events).toEqual([]);
    expect(RawFaceTrackSchema.parse({ width: 1080, height: 1920, fps: 30, sampleEvery: 3, samples: [{ tMs: 0, box: null }] }).samples[0].box).toBeNull();
    expect(() => FaceTrackSchema.parse({ intervalMs: 0, samples: [] })).toThrow();
  });
});

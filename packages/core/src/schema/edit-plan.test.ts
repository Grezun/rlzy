import { describe, expect, it } from "vitest";
import { CHARACTER_ID, EXTRA_IMG, fixtureExtras, MATTE_HASH, validEditPlan } from "../testing/fixtures";
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

const withCutaway = (cutaway: unknown, beat = 0, over: object = {}) => ({
  ...validEditPlan(),
  source: { ...validEditPlan().source, extras: fixtureExtras() },
  beats: validEditPlan().beats.map((b, i) => (i === beat ? { ...b, cutaway } : b)),
  ...over,
});
const broll = { source: { kind: "ai_broll", prompt: "laptop on a desk", media: "image" }, layout: "full", atMs: 0, durationMs: 1500 };
const message = (p: unknown) => { try { parseEditPlan(p); return ""; } catch (err) { return (err as Error).message; } };

describe("cutaways (plan 2)", () => {
  it("accepts every cutaway kind and both layouts", () => {
    expect(parseEditPlan(withCutaway(broll)).beats[0].cutaway).toEqual(broll);
    expect(() => parseEditPlan(withCutaway({ ...broll, layout: "split", source: { kind: "upload", assetId: EXTRA_IMG } }))).not.toThrow();
    expect(() => parseEditPlan(withCutaway({ ...broll, source: { kind: "diagram", template: "list", items: ["אחת", "שתיים", "שלוש"] } }))).not.toThrow();
    expect(() => parseEditPlan(withCutaway({ ...broll, source: { kind: "ai_self", prompt: "on a plane", media: "video" } }, 0, { character: { id: CHARACTER_ID, name: "Alex" } }))).not.toThrow();
  });
  it("keeps cutaways 1–3 s long", () => {
    expect(message(withCutaway({ ...broll, durationMs: 900 }))).toMatch(/durationMs/);
    expect(message(withCutaway({ ...broll, durationMs: 3100 }))).toMatch(/durationMs/);
  });
  it("needs uploads from this video, a character for AI shots of you, and the right number of diagram items", () => {
    expect(message(withCutaway({ ...broll, source: { kind: "upload", assetId: "f".repeat(64) } }))).toContain("Beat b1 uses an upload that isn't part of this video. Pick one of its uploads.");
    expect(message(withCutaway({ ...broll, source: { kind: "ai_self", prompt: "on a plane", media: "image" } }))).toContain("Beat b1 has an AI shot of you, but no character is picked. Pick one in Settings or remove the shot.");
    expect(message(withCutaway({ ...broll, source: { kind: "diagram", template: "compare", items: ["a", "b", "c"] } }))).toContain("A compare diagram has exactly 2 items.");
    expect(message(withCutaway({ ...broll, source: { kind: "diagram", template: "flow", items: ["a", "b", "c", "d"] } }))).toContain("A flow diagram has 2 or 3 steps.");
  });
  it("allows the B-roll pattern break only with a cutaway on a kept beat", () => {
    const hook = { ...validEditPlan().hook, patternBreak: "broll" };
    expect(() => parseEditPlan(withCutaway(broll, 0, { hook }))).not.toThrow();
    expect(message({ ...validEditPlan(), hook })).toContain("The B-roll pattern break needs a cutaway on a kept beat: add one, or pick zoom hit, flash or none.");
  });
  it("parses plan-1 plans (no extras) unchanged", () => {
    const { extras: _none, ...plan1Source } = validEditPlan().source;
    expect(parseEditPlan({ ...validEditPlan(), source: plan1Source }).source.extras).toEqual([]);
  });
});

describe("Claude's draft schema", () => {
  it("offers a callout per beat", () => {
    expect(JSON.stringify(EditPlanDraftSchema.toJSONSchema())).toMatch(/"callout"/);
  });
  it("offers cutaways, the B-roll break and a background choice (never brand backdrops)", () => {
    const json = JSON.stringify(EditPlanDraftSchema.toJSONSchema());
    expect(json).toMatch(/cutaway/);
    expect(json).toMatch(/broll/);
    expect(json).toMatch(/"background"/);
    expect(json).toMatch(/"replace"/);
    expect(json).not.toMatch(/brand/);
  });
  it("sends Claude a draft schema without min/max bounds", () => {
    expect(JSON.stringify(EditPlanDraftSchema.toJSONSchema())).not.toMatch(/minimum|maximum|minLength|maxLength|minItems|maxItems/);
  });
});

describe("footage data schemas", () => {
  it("parses a transcript, a raw face track (null boxes) and a smoothed track", () => {
    expect(TranscriptSchema.parse({ languageCode: "heb", languageProbability: 0.9, words: [{ text: "שלום", startMs: 0, endMs: 300 }] }).events).toEqual([]);
    expect(RawFaceTrackSchema.parse({ width: 1080, height: 1920, fps: 30, sampleEvery: 3, samples: [{ tMs: 0, box: null }] }).samples[0].box).toBeNull();
    expect(() => FaceTrackSchema.parse({ intervalMs: 0, samples: [] })).toThrow();
  });
});

describe("callouts (look pass)", () => {
  const withCallout = (text: string) => ({ ...validEditPlan(), beats: validEditPlan().beats.map((b) => (b.id === "b2" ? { ...b, callout: { text } } : b)) });
  it("accepts a number or 1–3 words, trimmed, in either language", () => {
    expect(parseEditPlan(withCallout(" 1/5 ")).beats[1].callout).toEqual({ text: "1/5" });
    expect(parseEditPlan(withCallout("חוסך שעות")).beats[1].callout).toEqual({ text: "חוסך שעות" });
    expect(parseEditPlan(validEditPlan()).beats[1].callout).toBeUndefined();
  });
  it("refuses 4 words, 17 characters or an empty callout with plain messages", () => {
    expect(() => parseEditPlan(withCallout("a b c d"))).toThrow("beats.1.callout.text: A callout is a number or 1–3 words.");
    expect(() => parseEditPlan(withCallout("a".repeat(17)))).toThrow("beats.1.callout.text: A callout is at most 16 characters.");
    expect(() => parseEditPlan(withCallout("  "))).toThrow(/beats\.1\.callout\.text/);
  });
});

describe("background replacement (plan 3)", () => {
  const scene = (prompt = "a bright home office") => ({ mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "ai", prompt } }] });
  const withMatte = (background: unknown) => ({ ...validEditPlan(), source: { ...validEditPlan().source, matteAssetId: MATTE_HASH }, background });
  it("accepts one AI scene from the first beat when the video has a cut-out (prompt trimmed)", () => {
    expect(parseEditPlan(withMatte(scene(" a bright home office "))).background).toEqual(scene());
  });
  it("needs the cut-out, a scene description and sections that start at the first beat, in beat order", () => {
    expect(message({ ...validEditPlan(), background: scene() })).toContain("Background replacement needs the cut-out of you, and this video has none. Keep the original background.");
    expect(message(withMatte(scene("  ")))).toContain("Describe the AI background scene, or keep the original background.");
    expect(message(withMatte({ mode: "replace", sections: [{ fromBeatId: "b2", source: { kind: "ai", prompt: "x" } }] }))).toContain("the first background starts at the first beat (b1)");
    expect(message(withMatte({ mode: "replace", sections: [{ fromBeatId: "b9", source: { kind: "ai", prompt: "x" } }] }))).toContain("there is no beat b9");
    const twice = { mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "ai", prompt: "x" } }, { fromBeatId: "b1", source: { kind: "ai", prompt: "y" } }] };
    expect(message(withMatte(twice))).toContain("background sections follow the beats in order, at most one per beat");
  });
  it("refuses brand backdrops and a second section for now, with plain messages (the schema itself allows both, spec §3)", () => {
    const brand = { mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "brand", assetId: "x" } }] };
    expect(message(withMatte(brand))).toContain("Brand backdrops arrive in a later update: use an AI scene or the original background.");
    const two = { mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "ai", prompt: "office" } }, { fromBeatId: "b2", source: { kind: "ai", prompt: "beach" } }] };
    expect(message(withMatte(two))).toContain("One background per reel for now: remove the extra background sections.");
    expect(EditPlanSchema.safeParse(withMatte(two)).success).toBe(true);
  });
  it("parses plans made before plan 3 (no cut-out) unchanged", () => {
    expect(parseEditPlan(validEditPlan()).source.matteAssetId).toBeUndefined();
    expect(parseEditPlan(validEditPlan()).background).toEqual({ mode: "original" });
  });
});

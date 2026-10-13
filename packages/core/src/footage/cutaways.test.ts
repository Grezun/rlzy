import { describe, expect, it } from "vitest";
import { parseEditPlan, type Cutaway, type EditPlan } from "../schema/edit-plan";
import { EXTRA_IMG, EXTRA_VID, fixtureExtras, footageTranscript, testEditStyle, validEditPlan } from "../testing/fixtures";
import { plural } from "../plural";
import { applyCutawayBudget, cutawayBudget, cutawayFit, planCutaways } from "./cutaways";

const style = testEditStyle();
const words = footageTranscript().words;
const img = (atMs: number, durationMs: number, layout: "full" | "split" = "full"): Cutaway => ({ source: { kind: "ai_broll", prompt: "laptop", media: "image" }, layout, atMs, durationMs });
const plan = (cuts: Record<string, Cutaway>, over: Partial<EditPlan> = {}) =>
  parseEditPlan({ ...validEditPlan(), beats: validEditPlan().beats.map((b) => (cuts[b.id] ? { ...b, cutaway: cuts[b.id] } : b)), ...over });
const show = (p: EditPlan) => planCutaways(p, words, style);

// Fixture reel: b1 = frames 0–89, b2 = 89–146, b3 = 146–218; the CTA card starts at 143.
describe("placeCutaways", () => {
  it("places each cutaway at beat start + atMs, clips it to its beat and keeps it off the CTA card", () => {
    const r = show(plan({ b1: img(500, 1500), b2: img(0, 3000), b3: img(0, 1000) }));
    expect(r.placed.map((c) => [c.beatId, c.fromFrame, c.durationInFrames, c.layout])).toEqual([["b1", 15, 45, "full"], ["b2", 89, 54, "full"]]);
    expect(r.warnings).toEqual([
      "The cutaway in b2 was shortened to 1.8 s: it ran under the CTA card.",
      "The cutaway in b3 was dropped: it ran under the CTA card.",
    ]);
  });
  it("B-roll pattern break: the first cutaway moves to 0 s, full screen, 1 s; the next one never overlaps it", () => {
    const beats = [
      { id: "b1", startWordIdx: 0, endWordIdx: 1, keep: true, cutaway: img(300, 2000, "split") },
      { id: "b2", startWordIdx: 2, endWordIdx: 7, keep: true, cutaway: img(0, 1500) },
      { id: "b3", startWordIdx: 8, endWordIdx: 11, keep: true },
      { id: "b4", startWordIdx: 12, endWordIdx: 14, keep: true },
    ];
    const r = show(parseEditPlan({ ...validEditPlan(), beats, hook: { patternBreak: "broll", reason: "" } }));
    expect(r.placed.map((c) => [c.beatId, c.fromFrame, c.durationInFrames, c.layout, c.pulled])).toEqual([["b1", 0, 30, "full", true], ["b2", 30, 41, "full", false]]);
    expect(r.warnings).toEqual(["The cutaway in b2 was shortened to 1.4 s: it overlapped the previous cutaway."]);
  });
  it("keeps at least 40 % of the reel on the speaker (split counts as speaker)", () => {
    const loop = { ending: { kind: "loop" as const } }; // 194 frames: full cutaways may cover 116
    const r = show(plan({ b1: img(0, 2500), b2: img(0, 3000), b3: img(0, 1000) }, loop));
    expect(r.placed.map((c) => [c.beatId, c.fromFrame, c.durationInFrames])).toEqual([["b1", 0, 75], ["b2", 89, 41]]);
    expect(r.warnings).toEqual([
      "The cutaway in b2 was shortened to 1.4 s: at least 40% of the reel must show you.",
      "The cutaway in b3 was dropped: at least 40% of the reel must show you.",
    ]);
    expect(show(plan({ b1: img(0, 2500), b2: img(0, 3000), b3: img(0, 1000, "split") }, loop)).placed.map((c) => c.beatId)).toEqual(["b1", "b2", "b3"]);
  });
  it("follows the cold open's reel order and ignores dropped beats", () => {
    const cold = plan({ b1: img(0, 1000), b2: img(0, 1000) }, { hook: { coldOpenBeatId: "b2", patternBreak: "none", reason: "" } });
    expect(show(cold).placed.map((c) => [c.beatId, c.fromFrame])).toEqual([["b2", 0], ["b1", 57]]);
    const dropped = parseEditPlan({ ...validEditPlan(), beats: validEditPlan().beats.map((b) => (b.id === "b2" ? { ...b, keep: false, cutaway: img(0, 1000) } : b)) });
    expect(show(dropped).placed).toEqual([]);
  });
  it("is deterministic", () => {
    const p = plan({ b1: img(500, 1500), b2: img(0, 3000) });
    expect(JSON.stringify(show(p))).toBe(JSON.stringify(show(p)));
  });
});

describe("cutaway budget", () => {
  it("allows about one cutaway every 3 s and one clip every 7.5 s", () => {
    expect(cutawayBudget(15, false)).toEqual({ max: 5, maxVideo: 2, maxSelf: 0 });
    expect(cutawayBudget(30, true)).toEqual({ max: 10, maxVideo: 4, maxSelf: 1 });
    expect(cutawayBudget(45, true)).toEqual({ max: 15, maxVideo: 6, maxSelf: 2 });
    expect(cutawayBudget(60, false)).toEqual({ max: 20, maxVideo: 8, maxSelf: 0 });
    expect(cutawayBudget(90, true)).toEqual({ max: 30, maxVideo: 12, maxSelf: 4 });
  });
  it("removes AI shots of you without a character, then extras past the maximum, then turns surplus clips into stills", () => {
    const vid = (kind: "ai_broll" | "ai_self"): Cutaway => ({ source: { kind, prompt: "x", media: "video" }, layout: "full", atMs: 0, durationMs: 1000 });
    const beats = [
      { id: "b1", keep: true, cutaway: vid("ai_broll") },
      { id: "b2", keep: true, cutaway: vid("ai_broll") },
      { id: "b3", keep: true, cutaway: vid("ai_self") },
      { id: "b4", keep: false, cutaway: vid("ai_broll") },
      { id: "b5", keep: true, cutaway: { source: { kind: "diagram", template: "list", items: ["a", "b"] }, layout: "full", atMs: 0, durationMs: 1000 } as Cutaway },
      { id: "b6", keep: true, cutaway: vid("ai_broll") },
      { id: "b7", keep: false, cutaway: vid("ai_self") },
    ];
    const r = applyCutawayBudget(beats, { max: 3, maxVideo: 1, maxSelf: 0 }, 15);
    // b7 is dropped, but an AI shot of you without a character would still fail the schema: it is stripped too (no warning, it never shows).
    expect(r.beats.map((b) => b.cutaway && ("media" in b.cutaway.source ? `${b.cutaway.source.kind}:${b.cutaway.source.media}` : b.cutaway.source.kind))).toEqual(
      ["ai_broll:video", "ai_broll:image", undefined, "ai_broll:video", "diagram", undefined, undefined],
    );
    expect(r.warnings).toEqual([
      "1 AI shot of you was removed (no character is picked).",
      "1 cutaway was removed (at most 3 for a 15 s reel).",
      "1 video cutaway became a still (at most 1 video clip for a 15 s reel).",
    ]);
  });
  it("says counts other than 1 in the plural, and a budget of 1 in the singular", () => {
    const vid = (kind: "ai_broll" | "ai_self"): Cutaway => ({ source: { kind, prompt: "x", media: "video" }, layout: "full", atMs: 0, durationMs: 1000 });
    const beats = ["ai_self", "ai_self", "ai_self", "ai_broll", "ai_broll", "ai_broll", "ai_broll", "ai_broll"].map((k, i) => ({ id: `b${i + 1}`, keep: true, cutaway: vid(k as "ai_broll" | "ai_self") }));
    expect(applyCutawayBudget(beats, { max: 3, maxVideo: 1, maxSelf: 1 }, 15).warnings).toEqual([
      "2 AI shots of you were removed (at most 1 for a 15 s reel).",
      "3 cutaways were removed (at most 3 for a 15 s reel).",
      "2 video cutaways became stills (at most 1 video clip for a 15 s reel).",
    ]);
    expect(plural(1, "clip", "clips")).toBe("1 clip");
    expect(plural(0, "clip", "clips")).toBe("0 clips");
    expect(plural(2, "clip", "clips")).toBe("2 clips");
  });
});

describe("uploads", () => {
  it("shortens a cutaway to the uploaded clip's length", () => {
    const p = parseEditPlan({
      ...validEditPlan(),
      source: { ...validEditPlan().source, extras: fixtureExtras() },
      beats: validEditPlan().beats.map((b) => (b.id === "b1" ? { ...b, cutaway: { source: { kind: "upload", assetId: EXTRA_VID }, layout: "full", atMs: 0, durationMs: 3000 } } : b)),
    });
    const r = show(p);
    expect(r.placed[0].durationInFrames).toBe(60);
    expect(r.warnings).toEqual(["The cutaway in b1 was shortened to 2.0 s: the uploaded clip is only 2.0 s long."]);
  });
  it("shows an upload whole on a blurred fill when its shape doesn't fit the slot", () => {
    const x = fixtureExtras();
    expect(cutawayFit({ kind: "upload", assetId: EXTRA_IMG }, x, "full", 1.3)).toBe("contain_blur"); // landscape in 9:16
    expect(cutawayFit({ kind: "upload", assetId: EXTRA_VID }, x, "full", 1.3)).toBe("cover"); // portrait in 9:16
    expect(cutawayFit({ kind: "upload", assetId: EXTRA_VID }, x, "split", 1.3)).toBe("contain_blur"); // portrait in 9:8
    expect(cutawayFit({ kind: "ai_broll", prompt: "x", media: "image" }, x, "split", 1.3)).toBe("cover");
  });
});

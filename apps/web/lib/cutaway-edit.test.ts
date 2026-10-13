import { parseEditPlan } from "@reel/core";
import { houseStyle } from "@reel/video/house-style";
import { describe, expect, it } from "vitest";
import { EXTRA_IMG, fixtureExtras, footageTranscript, validEditPlan } from "../../../packages/core/src/testing/fixtures";
import { cutawayChoice, cutawayLengthMs, cutawayPriceLabel, defaultCutaway, placementWarnings } from "./cutaway-edit";

const plan = () => parseEditPlan({ ...validEditPlan(), source: { ...validEditPlan().source, extras: fixtureExtras() } });

describe("cutaway editing helpers", () => {
  it("adds callout warnings to the placement list", () => {
    const p = parseEditPlan({ ...plan(), beats: plan().beats.map((b) => (b.id === "b3" ? { ...b, callout: { text: "AI" } } : b)) });
    expect(placementWarnings(p, footageTranscript().words, houseStyle.edit)).toEqual(["The callout in b3 was dropped: the hook headline, a cutaway or the CTA card covers its beat."]);
  });
  it("round-trips the type picker and keeps the prompt and timing when switching AI kinds", () => {
    const c = defaultCutaway("ai_broll:video", plan())!;
    expect(c).toEqual({ source: { kind: "ai_broll", prompt: "", media: "video" }, layout: "full", atMs: 0, durationMs: 1500 });
    expect(cutawayChoice(c)).toBe("ai_broll:video");
    const typed = { ...c, source: { ...c.source, prompt: "laptop" }, atMs: 400 };
    expect(defaultCutaway("ai_self:image", plan(), typed)).toEqual({ source: { kind: "ai_self", prompt: "laptop", media: "image" }, layout: "full", atMs: 400, durationMs: 1500 });
    expect(defaultCutaway("upload", plan())!.source).toEqual({ kind: "upload", assetId: EXTRA_IMG });
    expect(defaultCutaway("diagram", plan())!.source).toEqual({ kind: "diagram", template: "list", items: ["", ""] });
    expect(defaultCutaway("none", plan())).toBeNull();
    expect(cutawayChoice(undefined)).toBe("none");
  });
  it("prices each cutaway the way the estimate does", () => {
    expect(cutawayPriceLabel(defaultCutaway("ai_broll:image", plan())!)).toBe("$0.04");
    expect(cutawayPriceLabel(defaultCutaway("ai_self:video", plan())!)).toBe("$0.36");
    expect(cutawayPriceLabel(defaultCutaway("diagram", plan())!)).toBe("free");
  });
  it("lists the placement warnings for the review page", () => {
    const p = parseEditPlan({ ...plan(), beats: plan().beats.map((b) => (b.id === "b3" ? { ...b, cutaway: { source: { kind: "ai_broll", prompt: "x", media: "image" }, layout: "full", atMs: 0, durationMs: 1000 } } : b)) });
    expect(placementWarnings(p, footageTranscript().words, houseStyle.edit)).toEqual(["The cutaway in b3 was dropped: it ran under the CTA card."]);
  });
});

describe("cutawayLengthMs (the Length (s) field)", () => {
  it("clamps to 1–3 s and keeps the previous length for an empty or unreadable field", () => {
    expect(cutawayLengthMs("2.5", 1500)).toBe(2500);
    expect(cutawayLengthMs("10", 1500)).toBe(3000);
    expect(cutawayLengthMs("0.2", 1500)).toBe(1000);
    expect(cutawayLengthMs("-4", 1500)).toBe(1000);
    expect(cutawayLengthMs("", 1500)).toBe(1500);
    expect(cutawayLengthMs("  ", 2000)).toBe(2000);
    expect(cutawayLengthMs("abc", 2000)).toBe(2000);
    expect(cutawayLengthMs("1.2345", 1500)).toBe(1235);
  });
});

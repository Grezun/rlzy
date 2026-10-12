import { describe, expect, it } from "vitest";
import { PlanFormSchema } from "./plan-form";

const valid = {
  brief: "3 טיפים לצמיחה בטיקטוק",
  language: "he",
  targetDurationSec: 30,
  pacing: "punchy",
  captionPreset: "bold_pop",
  palette: ["#FFE14D", "#111111"],
};

describe("PlanFormSchema", () => {
  it("accepts a valid form and leaves voiceId optional", () => {
    expect(PlanFormSchema.parse(valid)).toEqual(valid);
    expect(PlanFormSchema.parse({ ...valid, voiceId: " v1 " }).voiceId).toBe("v1");
  });
  it("rejects a too-short brief, bad length and bad colours", () => {
    expect(PlanFormSchema.safeParse({ ...valid, brief: "hi" }).success).toBe(false);
    expect(PlanFormSchema.safeParse({ ...valid, targetDurationSec: 20 }).success).toBe(false);
    expect(PlanFormSchema.safeParse({ ...valid, palette: ["yellow"] }).success).toBe(false);
  });
});

describe("PlanFormSchema style", () => {
  const base = { brief: "Listicle: 3 tips", language: "he", targetDurationSec: 30, pacing: "punchy", captionPreset: "bold_pop", palette: ["#FFE14D"] };
  it("accepts a style part", () => {
    const f = PlanFormSchema.parse({ ...base, style: { id: "listicle", values: { TOPIC: "טיפים" }, script: "שלום עולם" } });
    expect(f.style).toEqual({ id: "listicle", values: { TOPIC: "טיפים" }, script: "שלום עולם" });
  });
  it("stays valid without style", () => {
    expect(PlanFormSchema.parse(base).style).toBeUndefined();
  });
  it("rejects bad ids and oversized values", () => {
    expect(() => PlanFormSchema.parse({ ...base, style: { id: "../x", values: {} } })).toThrow();
    expect(() => PlanFormSchema.parse({ ...base, style: { id: "faceless", values: { TOPIC: "x".repeat(2001) } } })).toThrow();
    expect(() => PlanFormSchema.parse({ ...base, style: { id: "faceless", values: {}, script: "x".repeat(5001) } })).toThrow();
  });
});

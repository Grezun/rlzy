import { describe, expect, it } from "vitest";
import { parseStyleForm } from "./style-form";

const fd = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ language: "he", targetDurationSec: "30", pacing: "punchy", captionPreset: "bold_pop", color1: "#ffe14d", color2: "#111111", ...entries })) f.set(k, v);
  return f;
};

describe("parseStyleForm", () => {
  it("builds a plan payload with style, brief summary and title", () => {
    const r = parseStyleForm("myth-fact", fd({ "field.TOPIC": "שינה", "field.MYTH": "8 שעות", "field.FACT": "משתנה", "field.EVIL": "x", script: " שלום " }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.form.style).toEqual({ id: "myth-fact", values: { TOPIC: "שינה", MYTH: "8 שעות", FACT: "משתנה" }, script: "שלום" });
    expect(r.form.brief).toBe("Myth vs Fact: שינה");
    expect(r.title).toBe("שינה");
  });
  it("omits an empty script", () => {
    const r = parseStyleForm("myth-fact", fd({ "field.TOPIC": "t", "field.MYTH": "m", "field.FACT": "f", script: "  " }));
    expect(r.ok && r.form.style?.script).toBeUndefined();
  });
  it("reports missing required fields", () => {
    const r = parseStyleForm("myth-fact", fd({ "field.TOPIC": "t" }));
    expect(r).toEqual({ ok: false, errors: ["Misconception is required", "Accurate explanation is required"] });
  });
  it.each(["presenter", "custom", "nope"])("refuses %s", (id) => {
    expect(parseStyleForm(id, fd({})).ok).toBe(false);
  });
});

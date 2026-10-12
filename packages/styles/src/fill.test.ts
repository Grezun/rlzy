import { describe, expect, it } from "vitest";
import { fillTemplate } from "./fill";
import { getStyle } from "./registry";

const def = getStyle("myth-fact")!;
const input = (over = {}) => ({ values: { TOPIC: "שינה", MYTH: "צריך 8 שעות", FACT: "זה משתנה" }, language: "he" as const, durationSec: 30, accentColor: "#FFE14D", voiceDescription: "the team Hebrew voice", ...over });

describe("fillTemplate", () => {
  it("substitutes the nested script variable before LANGUAGE", () => {
    const out = fillTemplate("Script: {{{{LANGUAGE}}_SCRIPT}} in {{LANGUAGE}}", def, input({ script: "שלום" }));
    expect(out).toBe("Script: שלום in Hebrew");
  });
  it("uses the draft marker when there is no script, and English for en", () => {
    expect(fillTemplate("{{{{LANGUAGE}}_SCRIPT}}|{{LANGUAGE}}", def, input({ language: "en" }))).toBe("not provided: draft one|English");
  });
  it("fills shared, asset, empty and field variables", () => {
    const out = fillTemplate("{{TOPIC}}|{{AUDIENCE}}|{{ASSETS}}|{{ACCENT_COLOR}}|{{DURATION}}", def, input());
    expect(out).toBe("שינה|not provided|not provided (file uploads are not available yet; use generated visuals)|#FFE14D|30");
  });
  it("does not re-substitute variables typed inside values", () => {
    const out = fillTemplate("{{TOPIC}}", def, input({ values: { TOPIC: "{{LANGUAGE}} {{MYTH}}", MYTH: "m", FACT: "f" } }));
    expect(out).toBe("{{LANGUAGE}} {{MYTH}}");
  });
  it("throws on a variable with no source", () => {
    expect(() => fillTemplate("{{NOPE}}", def, input())).toThrow(/NOPE/);
  });
  it("fills every shipped prompt without throwing", async () => {
    const { STYLES } = await import("./registry");
    const { readPrompt } = await import("./load");
    for (const s of STYLES.filter((x) => x.id !== "custom")) {
      const values = Object.fromEntries(s.fields.map((f) => [f.key, f.default ?? "x"]));
      expect(() => fillTemplate(readPrompt(s.id), s, { ...input(), values })).not.toThrow();
    }
  });
});

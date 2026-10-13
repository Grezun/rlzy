import { describe, expect, it } from "vitest";
import { parseFootageSettings } from "./footage-form";

const fd = (e: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(e)) f.set(k, v); return f; };

describe("parseFootageSettings", () => {
  it("reads language, target, keyword and notes, dropping empty optionals", () => {
    expect(parseFootageSettings(fd({ language: "he", targetDurationSec: "90", ctaKeyword: " AI ", notes: "" }))).toEqual({ ok: true, settings: { language: "he", targetDurationSec: 90, ctaKeyword: "AI" } });
  });
  it("reports bad values", () => {
    const r = parseFootageSettings(fd({ language: "fr", targetDurationSec: "20" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBe(2);
  });
  it("reads the character (empty = none)", () => {
    const fd = (c: string) => { const f = new FormData(); f.set("language", "he"); f.set("targetDurationSec", "30"); f.set("characterId", c); return f; };
    expect(parseFootageSettings(fd(""))).toEqual({ ok: true, settings: { language: "he", targetDurationSec: 30 } });
    const id = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    expect(parseFootageSettings(fd(id))).toEqual({ ok: true, settings: { language: "he", targetDurationSec: 30, characterId: id } });
  });
});

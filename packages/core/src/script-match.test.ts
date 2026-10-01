import { describe, expect, it } from "vitest";
import { scriptMatches } from "./script-match";

describe("scriptMatches", () => {
  const he = "רוצים יותר צפיות? הנה ה״טיפ״ הכי חשוב:\n\nשלוש השניות הראשונות קובעות הכול - 100%.";
  it("accepts a split that differs only in whitespace", () => {
    expect(scriptMatches(he, ["רוצים יותר צפיות?", "הנה ה״טיפ״ הכי חשוב: שלוש השניות", "הראשונות  קובעות הכול - 100%."])).toEqual({ ok: true });
  });
  it("rejects one changed punctuation mark and points at it", () => {
    const r = scriptMatches(he, ["רוצים יותר צפיות!", "הנה ה״טיפ״ הכי חשוב: שלוש השניות הראשונות קובעות הכול - 100%."]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diff).toMatch(/צפיות\?/);
  });
  it("rejects a dropped word and an added word", () => {
    expect(scriptMatches("one two three", ["one three"]).ok).toBe(false);
    expect(scriptMatches("one two", ["one two three"]).ok).toBe(false);
  });
  it("treats NFC-equivalent text as equal", () => {
    expect(scriptMatches("\u00e9", ["e\u0301"]).ok).toBe(true);
  });
});

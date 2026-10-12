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
  it("ignores invisible formatting marks", () => {
    expect(scriptMatches("שלום\u200F עולם", ["שלום עולם"]).ok).toBe(true);
  });
  it("reports the differing characters with code points", () => {
    const r = scriptMatches("ה״טיפ", ['ה"טיפ']);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.diff).toMatch(/U\+05F4/);
      expect(r.diff).toMatch(/U\+0022/);
    }
    const end = scriptMatches("abc", ["ab"]);
    if (!end.ok) expect(end.diff).toMatch(/\(end\)/);
  });

  describe("Hebrew with niqqud and maqaf (U+05BE)", () => {
    // שָׁלוֹם לְבֵית־הַסֵּפֶר: niqqud marks plus a maqaf joining two words.
    const pointed = "\u05E9\u05B8\u05C1\u05DC\u05D5\u05B9\u05DD \u05DC\u05B0\u05D1\u05B5\u05D9\u05EA\u05BE\u05D4\u05B7\u05E1\u05BC\u05B5\u05E4\u05B6\u05E8.";
    const [first, second] = pointed.split(" ");
    it("accepts whitespace-only differences", () => {
      expect(pointed).toContain("\u05BE");
      expect(scriptMatches(pointed, [first, second]).ok).toBe(true);
      expect(scriptMatches(pointed, [`  ${first}\n`, `\t${second}  `]).ok).toBe(true);
    });
    it("rejects one changed vowel mark and names both code points", () => {
      const r = scriptMatches(pointed, [pointed.replace("\u05B8", "\u05B7")]); // qamats -> patah
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.diff).toMatch(/U\+05B8/);
        expect(r.diff).toMatch(/U\+05B7/);
      }
    });
    it("rejects a dropped niqqud mark", () => {
      expect(scriptMatches(pointed, [pointed.replace("\u05BC", "")]).ok).toBe(false);
    });
    it("rejects a maqaf replaced by a hyphen or a space", () => {
      expect(scriptMatches(pointed, [pointed.replace("\u05BE", "-")]).ok).toBe(false);
      expect(scriptMatches(pointed, [pointed.replace("\u05BE", " ")]).ok).toBe(false);
    });
  });
});

import { describe, expect, it } from "vitest";
import { pageWords, visibleLength, type ReelWord } from "./captions";

const rw = (texts: string[], beatId = "b1"): ReelWord[] => texts.map((text, i) => ({ text, startMs: i * 300, endMs: i * 300 + 250, idx: i, beatId }));
const pages = (ws: ReelWord[]) => pageWords(ws, { captionMaxChars: 22, captionMaxWords: 3 }).map((p) => p.map((w) => w.text).join(" "));

describe("visibleLength", () => {
  it("doesn't count niqqud, counts maqaf and emoji as visible", () => {
    expect(visibleLength("שָׁלוֹם")).toBe(4);
    expect(visibleLength("בית־ספר")).toBe(7);
    expect(visibleLength("👇")).toBe(1);
  });
});

describe("pageWords", () => {
  it("makes pages of up to 3 words", () => {
    expect(pages(rw(["אחת", "שתיים", "שלוש", "ארבע", "חמש"]))).toEqual(["אחת שתיים שלוש", "ארבע חמש"]);
  });
  it("breaks at punctuation first", () => {
    expect(pages(rw(["היי", "חברים,", "היום", "אני", "אראה"]))).toEqual(["היי חברים,", "היום אני אראה"]);
    expect(pages(rw(["סוף.", "התחלה", "חדשה"]))).toEqual(["סוף.", "התחלה חדשה"]);
  });
  it("keeps every page within 22 visible characters, niqqud not counted", () => {
    const ws = rw(["אָנֹכִי", "מְדַבֵּר", "עַכְשָׁו", "בְּעִבְרִית", "מְנֻקֶּדֶת"]);
    for (const p of pageWords(ws, { captionMaxChars: 22, captionMaxWords: 3 })) {
      expect(visibleLength(p.map((w) => w.text).join(" "))).toBeLessThanOrEqual(22);
    }
    expect(pages(rw(["אינטרנציונליזציה", "ממש", "ארוכה"]))).toEqual(["אינטרנציונליזציה ממש", "ארוכה"]);
  });
  it("puts a word longer than 22 characters alone on its page and never splits a maqaf word", () => {
    expect(pages(rw(["שלום", "סופרקליפרג׳יליסטיקאקספיאלידושס", "בית־ספר"]))).toEqual(["שלום", "סופרקליפרג׳יליסטיקאקספיאלידושס", "בית־ספר"]);
  });
  it("never puts two beats on one page", () => {
    expect(pages([...rw(["א", "ב"], "b1"), ...rw(["ג", "ד"], "b2")])).toEqual(["א ב", "ג ד"]);
  });
});

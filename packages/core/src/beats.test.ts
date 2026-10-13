import { describe, expect, it } from "vitest";
import { splitBeats } from "./beats";
import { footageTranscript } from "./testing/fixtures";

/** Words of 300 ms separated by `gaps[i]` ms (gap before word i+1). */
const timed = (texts: string[], gaps: number[] = []) => {
  let t = 0;
  return texts.map((text, i) => {
    const w = { text, startMs: t, endMs: t + 300 };
    t += 300 + (gaps[i] ?? 50);
    return w;
  });
};
const spans = (words: { text: string }[]) => splitBeats(words as never).map((b) => [b.id, b.startWordIdx, b.endWordIdx]);

describe("splitBeats", () => {
  it("splits the fixture at its three sentence ends", () => {
    expect(spans(footageTranscript().words)).toEqual([["b1", 0, 7], ["b2", 8, 11], ["b3", 12, 14]]);
  });
  it("splits at Hebrew and English sentence punctuation, also before closing quotes", () => {
    const w = timed(["אחת", "שתיים", "שלוש", "ארבע.", "חמש", "שש", "שבע", "שמונה?״", "nine", "ten", "eleven", "twelve!"]);
    expect(spans(w)).toEqual([["b1", 0, 3], ["b2", 4, 7], ["b3", 8, 11]]);
  });
  it("splits at a pause of 600 ms or more, not at 599 ms", () => {
    const w = timed(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"], [50, 50, 599, 50, 50, 600, 50, 50, 50, 50, 50]);
    expect(spans(w)).toEqual([["b1", 0, 5], ["b2", 6, 11]]);
  });
  it("splits a beat over 10 s at its longest internal pause", () => {
    const texts = Array.from({ length: 30 }, (_, i) => `w${i}`);
    const gaps = texts.map((_, i) => (i === 11 ? 400 : 50)); // ≈ 10.5 s with no punctuation; longest pause after w11
    expect(spans(timed(texts, gaps))).toEqual([["b1", 0, 11], ["b2", 12, 29]]);
  });
  it("merges a beat under 1.2 s into the neighbour across the smaller gap", () => {
    const w = timed(["a", "b", "c", "d.", "short.", "e", "f", "g", "h."], [50, 50, 50, 700, 650, 50, 50, 50]);
    // "short." is 300 ms: 700 ms gap before it, 650 ms after → it joins the next beat.
    expect(spans(w)).toEqual([["b1", 0, 3], ["b2", 4, 8]]);
  });
  it("returns one beat for a single short sentence and none for no words", () => {
    expect(spans(timed(["hi."]))).toEqual([["b1", 0, 0]]);
    expect(splitBeats([])).toEqual([]);
  });
});

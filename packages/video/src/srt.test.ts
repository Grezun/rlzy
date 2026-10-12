import { describe, expect, it } from "vitest";
import { createTikTokStyleCaptions } from "@remotion/captions";
import { COMBINE_MS, wordsToCaptions } from "./Captions";
import { buildSrt, formatSrtTime } from "./srt";

const w = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs });

describe("buildSrt", () => {
  it("formats timestamps", () => {
    expect(formatSrtTime(3_723_004)).toBe("01:02:03,004");
  });
  it("numbers cues from 1 and ends each cue at the next page start", () => {
    const words = [w("שלום", 0, 400), w("עולם", 450, 800), w("מה", 2000, 2300), w("נשמע", 2350, 2800), w("טוב", 6000, 6400), w("מאוד", 6450, 6900)];
    // Page boundaries come from the same library call the renderer uses.
    const { pages } = createTikTokStyleCaptions({ captions: wordsToCaptions(words), combineTokensWithinMilliseconds: COMBINE_MS });
    expect(pages.length).toBeGreaterThan(1);
    const expected = pages
      .map((pg, i) => {
        const end = pages[i + 1]?.startMs ?? pg.startMs + pg.durationMs;
        return `${i + 1}\n${formatSrtTime(pg.startMs)} --> ${formatSrtTime(end)}\n${pg.tokens.map((t) => t.text.trim()).join(" ")}\n`;
      })
      .join("\n");
    const srt = buildSrt(words);
    expect(srt).toBe(expected);
    expect(srt.startsWith("1\n00:00:00,000 --> ")).toBe(true);
    expect(srt).toContain("שלום עולם");
    expect(srt.endsWith("\n")).toBe(true);
  });
  it("splits a long cue into two lines at the space nearest the middle", () => {
    const words = "this caption page is definitely longer than forty two characters".split(" ").map((t, i) => w(t, i * 50, i * 50 + 40));
    const text = buildSrt(words).split("\n").slice(2, 4);
    expect(text).toHaveLength(2);
    expect(text.join(" ")).toBe("this caption page is definitely longer than forty two characters");
  });
  it("returns an empty string for no words", () => expect(buildSrt([])).toBe(""));
});

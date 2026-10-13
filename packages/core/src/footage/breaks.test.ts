import { describe, expect, it } from "vitest";
import { testEditStyle } from "../testing/fixtures";
import { pickBreaks } from "./breaks";

const B = testEditStyle().breaks;
/** 15 shots of 2 s (60 frames) each: cuts at 0, 60, …, 840. */
const shots = (over: Record<number, number> = {}) => Array.from({ length: 15 }, (_, i) => ({ fromFrame: i * 60, frames: over[i] ?? 60 }));

describe("pickBreaks", () => {
  it("picks the cut closest to every 10 s inside the 8–12 s window, cycling the kinds, and skips blocked frames", () => {
    expect(pickBreaks(shots(), B, [[825, 900]], [])).toEqual([
      { index: 5, frame: 300, kind: "zoom_blur" },
      { index: 10, frame: 600, kind: "zoom_hit" },
    ]);
  });
  it("restarts the count at a cutaway (it is a break of its own); ties go to the earlier cut", () => {
    expect(pickBreaks(shots(), B, [], [450])).toEqual([
      { index: 5, frame: 300, kind: "zoom_blur" },
      { index: 12, frame: 720, kind: "zoom_hit" },
    ]);
  });
  it("skips shots shorter than minShotFrames", () => {
    expect(pickBreaks(shots({ 5: 10 }), B, [[600, 900]], [])[0]).toEqual({ index: 4, frame: 240, kind: "zoom_blur" });
  });
  it("never breaks at frame 0 (the hook owns it) and returns nothing for a short reel", () => {
    expect(pickBreaks(shots().slice(0, 4), B, [], [])).toEqual([]);
  });
});

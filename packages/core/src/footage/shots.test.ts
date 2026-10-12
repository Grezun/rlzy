import { describe, expect, it } from "vitest";
import { parseEditPlan, type EditPlan } from "../schema/edit-plan";
import { footageTranscript, testEditStyle, validEditPlan } from "../testing/fixtures";
import { framesToMs, isFiller, planShots, shotCrop } from "./shots";

const style = testEditStyle();
const words = footageTranscript().words;
const plan = (over: Partial<EditPlan> = {}) => parseEditPlan({ ...validEditPlan(), ...over });
const layout = (p: EditPlan) => planShots(p, words, style).map((s) => [s.id, s.inFrame, s.frames, s.speechFrames]);

describe("isFiller", () => {
  it("matches fillers with stretched letters, punctuation and case", () => {
    for (const w of ["אממממ", "אהה,", "Umm", "hmmm", "אה."]) expect(isFiller(w, style.fillerWords)).toBe(true);
    for (const w of ["אמא", "שָׁלוֹם", "um-hum", "AI"]) expect(isFiller(w, style.fillerWords)).toBe(false);
  });
});

describe("planShots", () => {
  it("cuts pauses of 150 ms or more and fillers, pads 50 ms, and snaps to frames", () => {
    // b1 splits around the filler; the CTA extends the last shot by the 22 frames of source left after the last word.
    expect(layout(plan())).toEqual([["b1-1", 0, 26, 26], ["b1-2", 44, 63, 63], ["b2-1", 125, 57, 57], ["b3-1", 198, 72, 50]]);
    expect(planShots(plan(), words, style)[0].wordIdx).toEqual([0, 1]);
  });
  it("cuts at a gap of exactly 150 ms but not 149 ms, and always around a filler", () => {
    const w = [
      { text: "a", startMs: 0, endMs: 300 }, { text: "b", startMs: 449, endMs: 700 }, { text: "c", startMs: 850, endMs: 1100 },
      { text: "אממ", startMs: 1120, endMs: 1300 }, { text: "d.", startMs: 1320, endMs: 1600 },
    ];
    const p = plan({ beats: [{ id: "b1", startWordIdx: 0, endWordIdx: 4, keep: true }], hook: { patternBreak: "none", reason: "" }, ending: { kind: "none" } });
    expect(planShots(p, w, style).map((s) => s.wordIdx)).toEqual([[0, 1], [2], [4]]);
  });
  it("plays the cold-open beat first and never repeats it", () => {
    const p = plan({ hook: { ...validEditPlan().hook, coldOpenBeatId: "b2" } });
    expect(planShots(p, words, style).map((s) => s.id)).toEqual(["b2-1", "b1-1", "b1-2", "b3-1"]);
  });
  it("skips dropped beats", () => {
    const p = validEditPlan();
    p.beats[1].keep = false;
    expect(planShots(parseEditPlan(p), words, style).map((s) => s.beatId)).toEqual(["b1", "b1", "b3"]);
  });
  it("never plays a source frame twice when kept beats are 60 ms apart, whatever the reel order", () => {
    const w = [
      { text: "one", startMs: 0, endMs: 500 }, { text: "two.", startMs: 560, endMs: 1000 },
      { text: "three.", startMs: 1060, endMs: 1500 },
    ];
    const beats = [
      { id: "b1", startWordIdx: 0, endWordIdx: 0, keep: true },
      { id: "b2", startWordIdx: 1, endWordIdx: 1, keep: true },
      { id: "b3", startWordIdx: 2, endWordIdx: 2, keep: true },
    ];
    for (const coldOpenBeatId of [undefined, "b2", "b3"]) {
      for (const ending of [{ kind: "none" as const }, { kind: "cta" as const, keyword: "AI" }, { kind: "loop" as const }]) {
        const p = plan({ beats, hook: { patternBreak: "none", reason: "", coldOpenBeatId }, ending });
        const shots = planShots(p, w, style);
        expect(shots).toHaveLength(3);
        const bySource = [...shots].sort((a, b) => a.inFrame - b.inFrame);
        for (let i = 1; i < bySource.length; i++) {
          const prevEnd = bySource[i - 1].inFrame + bySource[i - 1].frames;
          expect(bySource[i].inFrame).toBeGreaterThanOrEqual(prevEnd);
          expect(framesToMs(bySource[i].inFrame)).toBeGreaterThanOrEqual(framesToMs(prevEnd));
        }
        const played = shots.flatMap((s) => Array.from({ length: s.frames }, (_, k) => s.inFrame + k));
        expect(new Set(played).size).toBe(played.length);
      }
    }
    // b1 ends at 550 ms (frame 17 after rounding 16.5); b2's padded start (510 ms, frame 15) is clamped to 17.
    const p = plan({ beats, hook: { patternBreak: "none", reason: "" }, ending: { kind: "none" } });
    expect(planShots(p, w, style).map((s) => [s.id, s.inFrame, s.frames])).toEqual([["b1-1", 0, 17], ["b2-1", 17, 15], ["b3-1", 32, 15]]);
  });
  it("loop: the last shot ends exactly on its last word", () => {
    expect(layout(plan({ ending: { kind: "loop" } })).at(-1)).toEqual(["b3-1", 198, 48, 48]);
  });
  it("CTA: adds no frames when the speaker talks to the last frame of the source", () => {
    const p = plan({ source: { ...validEditPlan().source, durationMs: 8250 } });
    expect(layout(p).at(-1)).toEqual(["b3-1", 198, 49, 49]);
  });
  it("CTA: the extension stops before the next (dropped) beat's speech", () => {
    const p = validEditPlan();
    p.beats[2].keep = false;
    // b2 ends at frame 182; b3's first word starts at 6650 ms, so the extension may run to frame 198 (6600 ms) only.
    expect(layout(parseEditPlan(p)).at(-1)).toEqual(["b2-1", 125, 73, 57]);
  });
  it("returns no shots when every kept beat is only fillers", () => {
    const w = [{ text: "אממ", startMs: 0, endMs: 400 }, { text: "אהה", startMs: 900, endMs: 1500 }];
    const p = plan({ beats: [{ id: "b1", startWordIdx: 0, endWordIdx: 1, keep: true }], hook: { patternBreak: "none", reason: "" }, ending: { kind: "none" } });
    expect(planShots(p, w, style)).toEqual([]);
  });
});

describe("shotCrop", () => {
  it("alternates 1.0 → 1.15 → 1.25 and pushes in on shots over 2 s", () => {
    expect(shotCrop(0, 1000, null, style)).toEqual({ cx: 0.5, cy: 0.5, scaleFrom: 1, scaleTo: 1 });
    expect(shotCrop(1, 1000, null, style)).toEqual({ cx: 0.5, cy: 0.5, scaleFrom: 1.15, scaleTo: 1.15 });
    expect(shotCrop(2, 2500, null, style)).toEqual({ cx: 0.5, cy: 0.5, scaleFrom: 1.25, scaleTo: 1.35 });
    expect(shotCrop(3, 1000, null, style).scaleFrom).toBe(1);
  });
  it("centres on the face and clamps to the frame", () => {
    expect(shotCrop(2, 1000, { x: 0.85, y: 0.3, w: 0.15, h: 0.1 }, style)).toEqual({ cx: 0.6, cy: 0.4, scaleFrom: 1.25, scaleTo: 1.25 });
    expect(shotCrop(1, 1000, { x: 0.4, y: 0.1, w: 0.2, h: 0.12 }, style)).toEqual({ cx: 0.5, cy: 0.4348, scaleFrom: 1.15, scaleTo: 1.15 });
  });
  it("never zooms past a face that fills the frame", () => {
    expect(shotCrop(2, 2500, { x: 0.05, y: 0.1, w: 0.9, h: 0.5 }, style)).toEqual({ cx: 0.5, cy: 0.5, scaleFrom: 1, scaleTo: 1 });
  });
  it("keeps every face fully inside the visible window at both ends of the push-in", () => {
    for (const x of [0, 0.2, 0.5, 0.75]) for (const y of [0, 0.3, 0.7]) for (const w of [0.1, 0.25, 0.5]) for (let i = 0; i < 3; i++) {
      const face = { x, y, w, h: w * 0.6 };
      const c = shotCrop(i, 2500, face, style);
      for (const s of [c.scaleFrom, c.scaleTo]) {
        const half = 1 / (2 * s);
        expect(face.x).toBeGreaterThanOrEqual(c.cx - half - 1e-4);
        expect(Math.min(1, face.x + face.w)).toBeLessThanOrEqual(c.cx + half + 1e-4);
        expect(face.y).toBeGreaterThanOrEqual(c.cy - half - 1e-4);
        expect(Math.min(1, face.y + face.h)).toBeLessThanOrEqual(c.cy + half + 1e-4);
      }
    }
  });
});

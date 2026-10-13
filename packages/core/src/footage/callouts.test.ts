import { describe, expect, it } from "vitest";
import { testEditStyle } from "../testing/fixtures";
import { applyCalloutBudget, calloutBudget, calloutSpot } from "./callouts";

const p = testEditStyle().callouts;

describe("callout budget", () => {
  it("allows one callout per 5 s and removes the rest of the kept beats' callouts in beat order", () => {
    expect([15, 30, 90].map(calloutBudget)).toEqual([3, 6, 18]);
    const beats = ["b1", "b2", "b3", "b4", "b5"].map((id, i) => ({ id, keep: i !== 1, callout: { text: `${i + 1}/5` } }));
    const r = applyCalloutBudget(beats, 3, 15);
    expect(r.beats.map((b) => b.callout?.text)).toEqual(["1/5", "2/5", "3/5", "4/5", undefined]);
    expect(r.warnings).toEqual(["1 callout was removed (at most 3 for a 15 s reel)."]);
    expect(applyCalloutBudget(beats, 5, 30).warnings).toEqual([]);
  });
});

describe("calloutSpot", () => {
  it("centres the badge just above the face when there is room below the top safe area", () => {
    expect(calloutSpot({ top: 0.25, bottom: 0.46, left: 0.31, right: 0.69 }, p)).toEqual({ topPct: 19.5, align: "center" });
  });
  it("moves into the top band beside the face when the face reaches the top", () => {
    expect(calloutSpot({ top: 0.1, bottom: 0.4, left: 0.05, right: 0.35 }, p)).toEqual({ topPct: 12.5, align: "right" });
    expect(calloutSpot({ top: 0.1, bottom: 0.4, left: 0.65, right: 0.95 }, p)).toEqual({ topPct: 12.5, align: "left" });
  });
  it("gives up when the face fills the top of the frame, and centres at 20 % with no face", () => {
    expect(calloutSpot({ top: 0.05, bottom: 0.55, left: 0.08, right: 0.92 }, p)).toBeNull();
    expect(calloutSpot(null, p)).toEqual({ topPct: 20, align: "center" });
  });
});

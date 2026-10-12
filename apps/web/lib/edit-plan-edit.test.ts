import { parseEditPlan } from "@reel/core";
import { houseStyle } from "@reel/video/house-style";
import { describe, expect, it } from "vitest";
import { footageTranscript, validEditPlan } from "../../../packages/core/src/testing/fixtures";
import { checkEditPlan, describeFootageLength, editPlan, normalizePlanForSave } from "./edit-plan-edit";

const plan = () => parseEditPlan(validEditPlan());

describe("editPlan", () => {
  it("toggles keep and clears a cold open on a dropped beat", () => {
    const withCold = editPlan(plan(), { type: "setColdOpen", beatId: "b2" });
    const dropped = editPlan(withCold, { type: "toggleKeep", beatId: "b2" });
    expect(dropped.beats[1].keep).toBe(false);
    expect(dropped.hook.coldOpenBeatId).toBeUndefined();
  });
  it("sets and clears the red word, only inside the beat", () => {
    expect(editPlan(plan(), { type: "setEmphasis", beatId: "b2", wordIdx: 9 }).beats[1].emphasisWordIdx).toBe(9);
    expect(editPlan(plan(), { type: "setEmphasis", beatId: "b2", wordIdx: 2 }).beats[1].emphasisWordIdx).toBeUndefined();
    expect(editPlan(plan(), { type: "setEmphasis", beatId: "b1", wordIdx: null }).beats[0].emphasisWordIdx).toBeUndefined();
  });
  it("edits hook, ending, music and sfx", () => {
    let p = editPlan(plan(), { type: "setHeadline", small: " ", big: "" });
    p = editPlan(p, { type: "setPatternBreak", value: "flash" });
    p = editPlan(p, { type: "setEnding", ending: { kind: "loop" } });
    p = editPlan(p, { type: "setMusic", music: { kind: "ai", prompt: "upbeat pop" } });
    p = editPlan(p, { type: "setSfx", sfx: "lively" });
    const saved = normalizePlanForSave(p);
    expect(saved.hook.headline).toBeUndefined();
    expect(saved).toMatchObject({ hook: { patternBreak: "flash" }, ending: { kind: "loop" }, music: { kind: "ai", prompt: "upbeat pop" }, sfx: "lively" });
  });
});

describe("checkEditPlan", () => {
  it("refuses unticking every beat with a plain message", () => {
    let p = plan();
    for (const id of ["b1", "b2", "b3"]) p = editPlan(p, { type: "toggleKeep", beatId: id });
    const r = checkEditPlan(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/Keep at least one beat/);
  });
  it("refuses plan-2/3 fields a crafted client might send", () => {
    const r = checkEditPlan({ ...plan(), background: { mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "ai", prompt: "x" } }] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/Background replacement arrives in a later update/);
  });
});

describe("describeFootageLength", () => {
  it("warns when the kept beats run over the target", () => {
    const words = footageTranscript().words;
    expect(describeFootageLength(plan(), words, houseStyle.edit)).toEqual({ text: "Length ≈ 7 s (target 15 s)", tooLong: false });
    expect(describeFootageLength({ ...plan(), source: { ...plan().source, durationMs: 40_000 } }, words.map((w) => ({ ...w, startMs: w.startMs * 4, endMs: w.endMs * 4 })), houseStyle.edit).tooLong).toBe(true);
  });
});

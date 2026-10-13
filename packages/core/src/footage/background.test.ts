import { describe, expect, it } from "vitest";
import { parseEditPlan, EditPlanSchema } from "../schema/edit-plan";
import { footageTranscript, MATTE_HASH, validEditPlan } from "../testing/fixtures";
import { backgroundStarts } from "./background";

const words = footageTranscript().words;
const withMatte = (background: unknown) => ({ ...validEditPlan(), source: { ...validEditPlan().source, matteAssetId: MATTE_HASH }, background });

describe("backgroundStarts", () => {
  it("is empty for the original background and starts the one scene at 0", () => {
    expect(backgroundStarts(parseEditPlan(validEditPlan()), words, 50)).toEqual([]);
    const one = parseEditPlan(withMatte({ mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "ai", prompt: "office" } }] }));
    expect(backgroundStarts(one, words, 50)).toEqual([0]);
  });
  it("starts a later section padMs before its beat's first word (source time)", () => {
    const two = EditPlanSchema.parse(withMatte({ mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "ai", prompt: "office" } }, { fromBeatId: "b2", source: { kind: "ai", prompt: "beach" } }] }));
    expect(backgroundStarts(two, words, 50)).toEqual([0, 4150]);
  });
});

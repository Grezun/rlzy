import { EditStyleSchema } from "@reel/core";
import { describe, expect, it } from "vitest";
import { testEditStyle } from "../../core/src/testing/fixtures";
import { houseStyle } from "./house-style";

describe("houseStyle", () => {
  it("is a valid edit style and matches the core test fixture", () => {
    expect(EditStyleSchema.parse(houseStyle.edit)).toEqual(testEditStyle());
  });
  it("uses the reference colours and caption position", () => {
    expect(houseStyle.captions).toMatchObject({ topPct: 45, emphasisColor: "#E5262A", textColor: "#000000", pillColor: "#FFFFFF", popFrames: 6, popFrom: 0.8 });
    expect(houseStyle.headline.bigColor).toBe("#FEE80A");
  });
});

import { describe, expect, it } from "vitest";
import { describeScriptLength } from "./script-estimate";

describe("describeScriptLength", () => {
  it("is null for an empty script", () => expect(describeScriptLength("  ", "he", 30)).toBeNull());
  it("warns when the script is over the target", () => {
    const script = Array.from({ length: 90 }, () => "מילה").join(" ");
    expect(describeScriptLength(script, "he", 30)).toEqual({ text: "≈ 39 s of speech; longer than your 30 s target", tooLong: true });
  });
  it("shows the estimate when it fits", () => {
    expect(describeScriptLength("one two three four five", "en", 15)).toEqual({ text: "≈ 2 s of speech", tooLong: false });
  });
});

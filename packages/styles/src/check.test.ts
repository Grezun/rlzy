import { describe, expect, it } from "vitest";
import { checkStyleInput, styleTitle } from "./check";
import { getStyle } from "./registry";

describe("checkStyleInput", () => {
  const def = getStyle("myth-fact")!;
  it("reports missing required fields by label", () => {
    expect(checkStyleInput(def, { TOPIC: " " }).errors).toEqual(["Topic is required", "Misconception is required", "Accurate explanation is required"]);
  });
  it("trims values, drops unknown keys and keeps optional empties out", () => {
    const r = checkStyleInput(def, { TOPIC: " a ", MYTH: "b", FACT: "c", EVIL: "x", EXAMPLE: "" });
    expect(r).toEqual({ values: { TOPIC: "a", MYTH: "b", FACT: "c" }, errors: [] });
  });
  it("rejects a select value outside its options", () => {
    const l = getStyle("listicle")!;
    expect(checkStyleInput(l, { TOPIC: "t", TIPS_MISTAKES_TOOLS_OR_IDEAS: "hacks", NUMBER: "9" }).errors).toEqual(["List type must be one of: tips, mistakes, tools, ideas", "Number of items must be one of: 3, 4, 5, 6, 7"]);
  });
  it("builds the title from the title field, max 120 chars", () => {
    expect(styleTitle(def, { TOPIC: "x".repeat(200) })).toHaveLength(120);
  });
});

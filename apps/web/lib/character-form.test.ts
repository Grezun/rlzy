import { describe, expect, it } from "vitest";
import { CharacterInputSchema } from "./character-form";

describe("CharacterInputSchema", () => {
  it("accepts a name and a Soul ID reference id", () => {
    expect(CharacterInputSchema.parse({ name: " Alex ", referenceId: " 3f2c8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e " })).toEqual({ name: "Alex", referenceId: "3f2c8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e" });
  });
  it("explains a bad name or id", () => {
    const r = CharacterInputSchema.safeParse({ name: "", referenceId: "abc" });
    expect(r.success ? [] : r.error.issues.map((i) => i.message)).toEqual(["Give the character a name.", "Paste the Soul ID reference id (8–64 letters, digits, - or _)."]);
  });
});

import { SFX_NAMES } from "@reel/core";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { missingSfx, SFX_DIR, SFX_PROMPTS, sfxFileIn } from "./sfx";

describe("sound-effect pack", () => {
  it("has a prompt for every sound, each 0.5–3 s (ElevenLabs minimum 0.5 s)", () => {
    expect(Object.keys(SFX_PROMPTS).sort()).toEqual([...SFX_NAMES].sort());
    for (const p of Object.values(SFX_PROMPTS)) {
      expect(p.durationSec).toBeGreaterThanOrEqual(0.5);
      expect(p.durationSec).toBeLessThanOrEqual(3);
    }
  });
  it("finds .mp3 or .wav files and lists what is missing", async () => {
    const d = await mkdtemp(join(tmpdir(), "sfx-"));
    await writeFile(join(d, "pop1.mp3"), "x");
    await writeFile(join(d, "tick.wav"), "x");
    expect(sfxFileIn(d, "pop1")).toBe(join(d, "pop1.mp3"));
    expect(sfxFileIn(d, "tick")).toBe(join(d, "tick.wav"));
    expect(sfxFileIn(d, "ding")).toBeNull();
    expect(missingSfx(d)).toEqual(SFX_NAMES.filter((n) => n !== "pop1" && n !== "tick"));
  });
  it("points at packages/video/assets/sfx", () => {
    expect(SFX_DIR.replaceAll("\\", "/")).toMatch(/packages\/video\/assets\/sfx$/);
  });
});

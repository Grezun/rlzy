import { SFX_NAMES } from "@reel/core";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { missingSfx, SFX_DIR, SFX_PROMPTS, sfxFileIn, sfxToGenerate } from "./sfx";

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
  it("sfxToGenerate plans only the missing sounds (a rerun never re-pays existing files)", async () => {
    const d = await mkdtemp(join(tmpdir(), "sfx-"));
    const all = sfxToGenerate(d);
    expect(all.names).toEqual([...SFX_NAMES]);
    expect(all.totalSec).toBeCloseTo(SFX_NAMES.reduce((s, n) => s + SFX_PROMPTS[n].durationSec, 0), 9);
    await writeFile(join(d, "whoosh1.mp3"), "x");
    await writeFile(join(d, "riser.wav"), "x");
    const rest = sfxToGenerate(d);
    expect(rest.names).toEqual(SFX_NAMES.filter((n) => n !== "whoosh1" && n !== "riser"));
    expect(rest.totalSec).toBeCloseTo(all.totalSec - 0.6 - 1.2, 9);
    for (const n of SFX_NAMES) await writeFile(join(d, `${n}.mp3`), "x");
    expect(sfxToGenerate(d)).toEqual({ names: [], totalSec: 0 });
  });
  it("points at packages/video/assets/sfx", () => {
    expect(SFX_DIR.replaceAll("\\", "/")).toMatch(/packages\/video\/assets\/sfx$/);
  });
});

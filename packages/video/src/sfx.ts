import { SFX_NAMES, type SfxName } from "@reel/core";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Committed sound-effect pack (generated once with `npm run sfx:generate -- --yes`, checked by ear). */
export const SFX_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/sfx");

export const SFX_PROMPTS: Record<SfxName, { text: string; durationSec: number }> = {
  whoosh1: { text: "Short fast airy whoosh transition, clean, no music", durationSec: 0.6 },
  whoosh2: { text: "Quick bright swish whoosh, clean, no music", durationSec: 0.5 },
  pop1: { text: "Soft bubbly UI pop, very short, clean", durationSec: 0.5 },
  pop2: { text: "Light plucky click pop, very short, clean", durationSec: 0.5 },
  tick: { text: "Very soft subtle tick, like a quiet clock, very short", durationSec: 0.5 },
  riser: { text: "Short clean tension riser building up", durationSec: 1.2 },
  ding: { text: "Single bright notification ding, clean", durationSec: 0.8 },
  swoosh_out: { text: "Soft swoosh moving away and fading out", durationSec: 0.7 },
};

export function sfxFileIn(dir: string, name: SfxName): string | null {
  for (const ext of ["mp3", "wav"]) {
    const file = path.join(dir, `${name}.${ext}`);
    if (existsSync(file)) return file;
  }
  return null;
}

export const missingSfx = (dir: string): SfxName[] => SFX_NAMES.filter((n) => !sfxFileIn(dir, n));

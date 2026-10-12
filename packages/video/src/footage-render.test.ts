import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderReelStill } from "./render";
import { sampleFootageTimeline } from "./sample-footage";

const OUT = resolve("work/stills");

describe("footage components (stills)", () => {
  it.each([
    ["headline-and-pill", 20],
    ["pill-emphasis-emoji", 70],
    ["cta-card", 120],
  ] as const)("renders %s for he and en", async (name, frame) => {
    await mkdir(OUT, { recursive: true });
    for (const lang of ["he", "en"] as const) {
      const file = join(OUT, `footage-${name}-${lang}.png`);
      await renderReelStill(sampleFootageTimeline(lang), file, frame);
      expect((await stat(file)).size).toBeGreaterThan(20_000);
    }
  }, 300_000);
});

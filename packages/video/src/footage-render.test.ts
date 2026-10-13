import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderReelStill } from "./render";
import { sampleCutawayTimeline, sampleFootageTimeline } from "./sample-footage";

const OUT = resolve("work/stills");

describe("footage components (stills)", () => {
  it.each([
    ["headline-only", 20],
    ["pill-active-word", 70],
    ["pill-emphasis-emoji", 110],
    ["cta-card", 160],
    ["callout-progress", 80],
  ] as const)("renders %s for he and en", async (name, frame) => {
    await mkdir(OUT, { recursive: true });
    for (const lang of ["he", "en"] as const) {
      const file = join(OUT, `footage-${name}-${lang}.png`);
      await renderReelStill(sampleFootageTimeline(lang), file, frame);
      expect((await stat(file)).size).toBeGreaterThan(20_000);
    }
  }, 300_000);
  it.each([["diagram-flow-split", 40], ["diagram-compare", 80], ["diagram-list", 130]] as const)("renders %s for he and en", async (name, frame) => {
    await mkdir(OUT, { recursive: true });
    for (const lang of ["he", "en"] as const) {
      const file = join(OUT, `footage-${name}-${lang}.png`);
      await renderReelStill(sampleCutawayTimeline(lang), file, frame);
      expect((await stat(file)).size).toBeGreaterThan(20_000);
    }
  }, 300_000);
});

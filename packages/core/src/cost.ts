import { SpendCapError, UnknownCostModelError } from "./errors";
import type { EditPlan } from "./schema/edit-plan";
import type { Language, Storyboard } from "./schema/storyboard";

export type CostTable = Record<string, { perImage?: number; perSecond?: number; per1kChars?: number }>;

/**
 * Estimated USD prices. These are planning numbers, not invoices: check them against your
 * Higgsfield and ElevenLabs plans and edit here (Plan 1b moves this table into settings).
 */
export const DEFAULT_COST_TABLE: CostTable = {
  "higgsfield-ai/soul/v2/standard": { perImage: 0.04 },
  "bytedance/seedance-2.5/image-to-video": { perSecond: 0.08 },
  "elevenlabs/eleven_v4": { per1kChars: 0.3 },
  // Scribe: about $0.40 per hour of audio (spec §4.2).
  "elevenlabs/scribe_v2": { perSecond: 0.4 / 3600 },
  // ElevenLabs Music: a planning number. Check it against the team's ElevenLabs plan before the first paid run.
  "elevenlabs/music": { perSecond: 0.01 },
};

export const WORDS_PER_SECOND: Record<Language, number> = { he: 2.3, en: 2.6 };

export function estimateSceneSeconds(script: string, language: Language): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2, words / WORDS_PER_SECOND[language]);
}

export function videoBillSeconds(sceneSec: number): number {
  return Math.min(30, Math.max(4, Math.ceil(sceneSec)));
}

export type CostLine = { item: string; model: string; quantity: number; unit: string; usd: number };
export type CostEstimate = { totalUsd: number; lines: CostLine[] };

function price(table: CostTable, model: string, key: "perImage" | "perSecond" | "per1kChars"): number {
  const value = table[model]?.[key];
  if (value === undefined) throw new UnknownCostModelError(model);
  return value;
}

export function estimateCost(
  sb: Storyboard,
  models: { image: string; video: string; voice: string },
  table: CostTable = DEFAULT_COST_TABLE,
): CostEstimate {
  const lines: CostLine[] = [];
  for (const scene of sb.scenes) {
    const kind = scene.visual.kind;
    if (kind === "image" || kind === "broll_video") {
      const model = scene.visual.model && kind === "image" ? scene.visual.model : models.image;
      lines.push({ item: `image ${scene.id}`, model, quantity: 1, unit: "image", usd: price(table, model, "perImage") });
    }
    if (kind === "broll_video") {
      const model = scene.visual.model ?? models.video;
      const seconds = videoBillSeconds(estimateSceneSeconds(scene.script, sb.language));
      lines.push({ item: `video ${scene.id}`, model, quantity: seconds, unit: "s", usd: seconds * price(table, model, "perSecond") });
    }
  }
  if (sb.voice) {
    const chars = sb.scenes.map((s) => s.script).join(" ").length;
    lines.push({ item: "voice", model: models.voice, quantity: chars, unit: "chars", usd: (chars / 1000) * price(table, models.voice, "per1kChars") });
  }
  return { totalUsd: lines.reduce((sum, l) => sum + l.usd, 0), lines };
}

/**
 * The one rule for billable reel seconds (footage estimate and music generation both use it): whole seconds, rounded up
 * from the exact length. The length is first rounded to whole ms so float noise (210 frames = 7000.0000001 ms) is not
 * billed as a started second. Never round to 0.1 s first: 7033 ms is 8 billable seconds, not 7.
 */
export function estimateReelSeconds(durationMs: number): number {
  return Math.ceil(Math.round(durationMs) / 1000);
}

/** ElevenLabs Music's length limits. The provider clamps to them, so billing (and the estimate) starts at the minimum. */
export const MUSIC_MIN_MS = 3000;
export const MUSIC_MAX_MS = 600_000;

/** Billed seconds of AI music for a reel of `reelSeconds` (from estimateReelSeconds): never below the provider minimum. */
export function musicBillSeconds(reelSeconds: number): number {
  return Math.max(Math.ceil(reelSeconds), MUSIC_MIN_MS / 1000);
}

/** Generation spend of an approved footage plan, in USD. Plan 1's only paid generation is AI music, fitted to the reel. */
/** Rounds USD up to the cent (float noise on an exact cent, e.g. 0.1 + 0.2, stays on that cent). */
export function ceilToCent(usd: number): number {
  return Math.ceil(Math.round(usd * 1e6) / 1e4) / 100;
}

export function estimateFootageCost(plan: Pick<EditPlan, "music">, durationSec: number, table: CostTable = DEFAULT_COST_TABLE): number {
  return plan.music.kind === "ai" ? musicBillSeconds(durationSec) * price(table, "elevenlabs/music", "perSecond") : 0;
}

export function assertWithinCap(estimate: CostEstimate, capUsd: number): void {
  if (estimate.totalUsd > capUsd) throw new SpendCapError(estimate.totalUsd, capUsd);
}

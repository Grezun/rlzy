import { cutawayCost, planCutaways, type Cutaway, type EditPlan, type EditStyle, type Word } from "@reel/core";

export type CutawayChoice = "none" | "ai_broll:image" | "ai_broll:video" | "ai_self:image" | "ai_self:video" | "upload" | "diagram";

export const CUTAWAY_CHOICES: [CutawayChoice, string][] = [
  ["none", "No cutaway"], ["ai_broll:image", "AI B-roll photo"], ["ai_broll:video", "AI B-roll clip"],
  ["ai_self:image", "AI photo of you"], ["ai_self:video", "AI clip of you"], ["upload", "One of your uploads"], ["diagram", "Diagram card"],
];

export function cutawayChoice(c?: Cutaway): CutawayChoice {
  if (!c) return "none";
  const s = c.source;
  return s.kind === "ai_broll" || s.kind === "ai_self" ? `${s.kind}:${s.media}` : s.kind;
}

/** A fresh cutaway for the picked type, keeping the previous one's timing, layout and (for AI kinds) prompt. */
export function defaultCutaway(choice: CutawayChoice, plan: EditPlan, previous?: Cutaway): Cutaway | null {
  if (choice === "none") return null;
  const timing = { layout: previous?.layout ?? "full", atMs: previous?.atMs ?? 0, durationMs: previous?.durationMs ?? 1500 } as const;
  const prompt = previous && (previous.source.kind === "ai_broll" || previous.source.kind === "ai_self") ? previous.source.prompt : "";
  if (choice === "upload") return plan.source.extras[0] ? { source: { kind: "upload", assetId: plan.source.extras[0].assetId }, ...timing } : null;
  if (choice === "diagram") return { source: { kind: "diagram", template: "list", items: ["", ""] }, ...timing };
  const [kind, media] = choice.split(":") as ["ai_broll" | "ai_self", "image" | "video"];
  return { source: { kind, prompt, media }, ...timing };
}

export const CUTAWAY_MIN_MS = 1000;
export const CUTAWAY_MAX_MS = 3000;

/** The Length (s) field in ms: clamped to 1–3 s (the schema's range); an empty or unreadable field keeps the previous length. */
export function cutawayLengthMs(input: string, previousMs: number): number {
  const sec = input.trim() === "" ? NaN : Number(input);
  if (!Number.isFinite(sec)) return previousMs;
  return Math.min(CUTAWAY_MAX_MS, Math.max(CUTAWAY_MIN_MS, Math.round(sec * 1000)));
}

export const cutawayPriceLabel = (c: Cutaway) => {
  const usd = cutawayCost(c.source, c.durationMs);
  return usd === 0 ? "free" : `$${usd.toFixed(2)}`;
};

/** Spec §7: the compiler's trims and drops, shown before approval. An invalid plan has none to show yet. */
export function placementWarnings(plan: EditPlan, words: Word[], style: EditStyle): string[] {
  try {
    return planCutaways(plan, words, style).warnings;
  } catch {
    return [];
  }
}

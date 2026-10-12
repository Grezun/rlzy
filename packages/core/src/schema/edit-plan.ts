import * as z from "zod";
import { FootageTargetSchema } from "../footage-form";
import { FootageSourceSchema } from "./footage";
import { LanguageSchema } from "./storyboard";

export const BEAT_ID_RE = /^b[0-9]{1,3}$/;
const BeatId = z.string().regex(BEAT_ID_RE, "beat ids look like b1, b2, …");
export const SfxLevelSchema = z.enum(["off", "subtle", "lively"]);
export const MusicMoodSchema = z.enum(["calm", "upbeat", "dramatic"]);
export type MusicMood = z.infer<typeof MusicMoodSchema>;
export const PatternBreakSchema = z.enum(["zoom_hit", "flash", "broll", "none"]);

const Prompt = z.string().trim().min(1).max(1500);
/** Plan 2. Present in the shape so later plans extend it; parseEditPlan rejects it in plan 1. */
const CutawaySchema = z.object({
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("ai_broll"), prompt: Prompt }),
    z.object({ kind: z.literal("ai_self"), prompt: Prompt }),
    z.object({ kind: z.literal("upload"), assetId: z.string().min(1) }),
    z.object({ kind: z.literal("diagram"), template: z.enum(["compare", "list", "flow"]), items: z.array(z.string().trim().min(1).max(40)).min(2).max(4) }),
  ]),
  layout: z.enum(["full", "split"]),
  atMs: z.number().int().nonnegative(),
  durationMs: z.number().int().min(1000).max(3000),
});

export const BeatSchema = z.object({
  id: BeatId,
  startWordIdx: z.number().int().nonnegative(),
  endWordIdx: z.number().int().nonnegative(), // inclusive
  keep: z.boolean(),
  dropReason: z.string().trim().max(200).optional(),
  emphasisWordIdx: z.number().int().nonnegative().optional(),
  emoji: z.string().trim().min(1).max(8).optional(),
  cutaway: CutawaySchema.optional(),
});
export type Beat = z.infer<typeof BeatSchema>;

export const EditPlanSchema = z
  .object({
    format: z.literal("footage"),
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(120),
    language: LanguageSchema,
    targetDurationSec: FootageTargetSchema,
    source: FootageSourceSchema,
    beats: z.array(BeatSchema).min(1).max(300),
    hook: z.object({
      coldOpenBeatId: BeatId.optional(),
      headline: z.object({ small: z.string().trim().max(40), big: z.string().trim().min(1).max(24) }).optional(),
      patternBreak: PatternBreakSchema,
      reason: z.string().trim().max(300),
    }),
    ending: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("cta"), keyword: z.string().trim().min(1).max(30) }),
      z.object({ kind: z.literal("loop") }),
      z.object({ kind: z.literal("none") }),
    ]),
    background: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("original") }),
      z.object({
        mode: z.literal("replace"), // plan 3
        sections: z.array(z.object({
          fromBeatId: BeatId,
          source: z.discriminatedUnion("kind", [z.object({ kind: z.literal("ai"), prompt: Prompt }), z.object({ kind: z.literal("brand"), assetId: z.string().min(1) })]),
        })).min(1),
      }),
    ]),
    music: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("library"), assetId: z.uuid() }), // team_music.id
      z.object({ kind: z.literal("ai"), prompt: z.string().trim().min(1).max(300) }),
      z.object({ kind: z.literal("none") }),
    ]),
    sfx: SfxLevelSchema,
    estimate: z.object({ durationSec: z.number().nonnegative(), credits: z.number().nonnegative() }), // computed by code; credits in USD
    warnings: z.array(z.string()).default([]),
  })
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    plan.beats.forEach((b, i) => {
      if (seen.has(b.id)) ctx.addIssue({ code: "custom", path: ["beats", i, "id"], message: `duplicate beat id "${b.id}"` });
      seen.add(b.id);
      const expected = i === 0 ? 0 : plan.beats[i - 1].endWordIdx + 1;
      if (b.startWordIdx !== expected) ctx.addIssue({ code: "custom", path: ["beats", i, "startWordIdx"], message: `beat ${b.id} must start at word ${expected}` });
      if (b.endWordIdx < b.startWordIdx) ctx.addIssue({ code: "custom", path: ["beats", i, "endWordIdx"], message: `beat ${b.id} ends before it starts` });
      if (b.emphasisWordIdx !== undefined && (b.emphasisWordIdx < b.startWordIdx || b.emphasisWordIdx > b.endWordIdx)) {
        ctx.addIssue({ code: "custom", path: ["beats", i, "emphasisWordIdx"], message: `word ${b.emphasisWordIdx} is outside beat ${b.id} (words ${b.startWordIdx}–${b.endWordIdx})` });
      }
    });
    if (!plan.beats.some((b) => b.keep)) ctx.addIssue({ code: "custom", path: ["beats"], message: "Keep at least one beat." });
    const cold = plan.hook.coldOpenBeatId;
    if (cold) {
      const beat = plan.beats.find((b) => b.id === cold);
      if (!beat) ctx.addIssue({ code: "custom", path: ["hook", "coldOpenBeatId"], message: `there is no beat ${cold}` });
      else if (!beat.keep) ctx.addIssue({ code: "custom", path: ["hook", "coldOpenBeatId"], message: `the cold-open beat ${cold} is dropped` });
    }
  });
export type EditPlan = z.infer<typeof EditPlanSchema>;

export const NOT_IN_PLAN_ONE = {
  cutaway: (beatId: string) => `Beat ${beatId} has a cutaway. Cutaways arrive in a later update: remove it.`,
  background: "Background replacement arrives in a later update: keep the original background.",
  brollBreak: "The B-roll pattern break needs cutaways, which arrive in a later update: pick zoom hit, flash or none.",
};

/** Plan 1 renders no cutaways, keeps the real background and has no B-roll pattern break. Plans 2 and 3 shrink this list. */
export function planOneIssues(plan: EditPlan): string[] {
  return [
    ...plan.beats.filter((b) => b.cutaway).map((b) => NOT_IN_PLAN_ONE.cutaway(b.id)),
    ...(plan.background.mode === "replace" ? [NOT_IN_PLAN_ONE.background] : []),
    ...(plan.hook.patternBreak === "broll" ? [NOT_IN_PLAN_ONE.brollBreak] : []),
  ];
}

/** Parses an edit plan, throwing an Error that lists every schema issue and every plan-1 limit as one line each. */
export function parseEditPlan(input: unknown): EditPlan {
  const result = EditPlanSchema.safeParse(input);
  const lines = result.success
    ? planOneIssues(result.data).map((m) => `  - ${m}`)
    : result.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  if (result.success && lines.length === 0) return result.data;
  throw new Error(`Invalid edit plan:\n${lines.join("\n")}`);
}

/**
 * What Claude writes. Free of min/max constraints (structured outputs don't enforce them); empty strings and -1 mean
 * "none". emphasisWordIdx is a plain number (z.number().int() would emit safe-integer bounds); parseEditPlan checks it
 * is an integer. Code fills in the beat spans, source, estimate and warnings, then validates with parseEditPlan.
 */
export const EditPlanDraftSchema = z.object({
  title: z.string(),
  beats: z.array(z.object({ id: z.string(), keep: z.boolean(), dropReason: z.string(), emphasisWordIdx: z.number(), emoji: z.string() })),
  hook: z.object({
    coldOpenBeatId: z.string(),
    headlineSmall: z.string(),
    headlineBig: z.string(),
    patternBreak: z.enum(["zoom_hit", "flash", "none"]),
    reason: z.string(),
  }),
  ending: z.object({ kind: z.enum(["cta", "loop", "none"]), keyword: z.string() }),
  music: z.object({ kind: z.enum(["library", "ai", "none"]), trackId: z.string(), prompt: z.string() }),
  sfx: SfxLevelSchema,
});
export type EditPlanDraft = z.infer<typeof EditPlanDraftSchema>;

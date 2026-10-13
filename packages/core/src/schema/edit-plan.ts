import * as z from "zod";
import { FootageTargetSchema } from "../footage-form";
import { AssetHashSchema, FootageSourceSchema } from "./footage";
import { LanguageSchema } from "./storyboard";

export const BEAT_ID_RE = /^b[0-9]{1,3}$/;
const BeatId = z.string().regex(BEAT_ID_RE, "beat ids look like b1, b2, …");
export const SfxLevelSchema = z.enum(["off", "subtle", "lively"]);
export const MusicMoodSchema = z.enum(["calm", "upbeat", "dramatic"]);
export type MusicMood = z.infer<typeof MusicMoodSchema>;
export const PatternBreakSchema = z.enum(["zoom_hit", "flash", "broll", "none"]);

const Prompt = z.string().trim().min(1).max(1500);
export const DiagramTemplateSchema = z.enum(["compare", "list", "flow"]);
export const CutawayMediaSchema = z.enum(["image", "video"]);
export const CutawaySourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ai_broll"), prompt: Prompt, media: CutawayMediaSchema }),
  z.object({ kind: z.literal("ai_self"), prompt: Prompt, media: CutawayMediaSchema }),
  z.object({ kind: z.literal("upload"), assetId: AssetHashSchema }),
  z.object({ kind: z.literal("diagram"), template: DiagramTemplateSchema, items: z.array(z.string().trim().min(1).max(40)).min(2).max(4) }),
]);
export type CutawaySource = z.infer<typeof CutawaySourceSchema>;
/** Spec §3: atMs is measured from the beat's first reel frame (after pause cuts). */
export const CutawaySchema = z.object({
  source: CutawaySourceSchema,
  layout: z.enum(["full", "split"]),
  atMs: z.number().int().nonnegative(),
  durationMs: z.number().int().min(1000).max(3000),
});
export type Cutaway = z.infer<typeof CutawaySchema>;

/** Look pass: a short sticker on a beat: a number like "1/5" or 1–3 words. */
export const CALLOUT_MAX_CHARS = 16;
export const CalloutSchema = z.object({
  text: z.string().trim()
    .min(1, "A callout needs text.")
    .max(CALLOUT_MAX_CHARS, `A callout is at most ${CALLOUT_MAX_CHARS} characters.`)
    .refine((t) => t.split(/\s+/).length <= 3, "A callout is a number or 1–3 words."),
});
export type Callout = z.infer<typeof CalloutSchema>;

export const BeatSchema = z.object({
  id: BeatId,
  startWordIdx: z.number().int().nonnegative(),
  endWordIdx: z.number().int().nonnegative(), // inclusive
  keep: z.boolean(),
  dropReason: z.string().trim().max(200).optional(),
  emphasisWordIdx: z.number().int().nonnegative().optional(),
  emoji: z.string().trim().min(1).max(8).optional(),
  cutaway: CutawaySchema.optional(),
  callout: CalloutSchema.optional(),
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
    character: z.object({ id: z.uuid(), name: z.string().trim().min(1).max(40) }).optional(),
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
    const extras = new Set(plan.source.extras.map((e) => e.assetId));
    plan.beats.forEach((b, i) => {
      const s = b.cutaway?.source;
      if (!s) return;
      const path = ["beats", i, "cutaway", "source"];
      if (s.kind === "upload" && !extras.has(s.assetId)) ctx.addIssue({ code: "custom", path, message: `Beat ${b.id} uses an upload that isn't part of this video. Pick one of its uploads.` });
      if (s.kind === "ai_self" && !plan.character) ctx.addIssue({ code: "custom", path, message: `Beat ${b.id} has an AI shot of you, but no character is picked. Pick one in Settings or remove the shot.` });
      if (s.kind === "diagram" && s.template === "compare" && s.items.length !== 2) ctx.addIssue({ code: "custom", path, message: "A compare diagram has exactly 2 items." });
      if (s.kind === "diagram" && s.template === "flow" && s.items.length > 3) ctx.addIssue({ code: "custom", path, message: "A flow diagram has 2 or 3 steps." });
    });
    if (plan.hook.patternBreak === "broll" && !plan.beats.some((b) => b.keep && b.cutaway)) {
      ctx.addIssue({ code: "custom", path: ["hook", "patternBreak"], message: "The B-roll pattern break needs a cutaway on a kept beat: add one, or pick zoom hit, flash or none." });
    }
  });
export type EditPlan = z.infer<typeof EditPlanSchema>;

export const NOT_YET = { background: "Background replacement arrives in a later update: keep the original background." };

/** What the schema describes but no plan renders yet (plan 3 removes this). */
export function notYetIssues(plan: EditPlan): string[] {
  return plan.background.mode === "replace" ? [NOT_YET.background] : [];
}

/** Parses an edit plan, throwing an Error that lists every schema issue and every not-yet-supported limit as one line each. */
export function parseEditPlan(input: unknown): EditPlan {
  const result = EditPlanSchema.safeParse(input);
  const lines = result.success
    ? notYetIssues(result.data).map((m) => `  - ${m}`)
    : result.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  if (result.success && lines.length === 0) return result.data;
  throw new Error(`Invalid edit plan:\n${lines.join("\n")}`);
}

/** The draft's flat cutaway (one object, no unions, so structured outputs stay simple). kind "none" = no cutaway. */
const DraftCutawaySchema = z.object({
  kind: z.enum(["none", "ai_broll", "ai_self", "upload", "diagram"]),
  media: z.enum(["image", "video"]),
  prompt: z.string(),
  uploadId: z.string(),
  template: z.enum(["compare", "list", "flow"]),
  items: z.array(z.string()),
  layout: z.enum(["full", "split"]),
  atMs: z.number(),
  durationMs: z.number(),
});
export type DraftCutaway = z.infer<typeof DraftCutawaySchema>;
export const NO_CUTAWAY: DraftCutaway = { kind: "none", media: "image", prompt: "", uploadId: "", template: "list", items: [], layout: "full", atMs: 0, durationMs: 0 };

/**
 * What Claude writes. Free of min/max constraints (structured outputs don't enforce them); empty strings and -1 mean
 * "none" (callout: "" for none). emphasisWordIdx is a plain number (z.number().int() would emit safe-integer bounds); parseEditPlan checks it
 * is an integer. uploadId is the x1…x6 id from the prompt; code maps it to the asset. Code fills in the beat spans, source, estimate and warnings, then validates with parseEditPlan.
 */
export const EditPlanDraftSchema = z.object({
  title: z.string(),
  beats: z.array(z.object({ id: z.string(), keep: z.boolean(), dropReason: z.string(), emphasisWordIdx: z.number(), emoji: z.string(), cutaway: DraftCutawaySchema, callout: z.string() })),
  hook: z.object({
    coldOpenBeatId: z.string(),
    headlineSmall: z.string(),
    headlineBig: z.string(),
    patternBreak: z.enum(["zoom_hit", "flash", "broll", "none"]),
    reason: z.string(),
  }),
  ending: z.object({ kind: z.enum(["cta", "loop", "none"]), keyword: z.string() }),
  music: z.object({ kind: z.enum(["library", "ai", "none"]), trackId: z.string(), prompt: z.string() }),
  sfx: SfxLevelSchema,
});
export type EditPlanDraft = z.infer<typeof EditPlanDraftSchema>;

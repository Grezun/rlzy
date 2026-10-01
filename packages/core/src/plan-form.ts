import * as z from "zod";
import { CaptionPresetSchema, LanguageSchema, PaletteColorSchema } from "./schema/storyboard";

export const PlanStyleInputSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  values: z.record(z.string().regex(/^[A-Z_]{1,40}$/), z.string().max(2000)),
  script: z.string().max(5000).optional(),
});
export type PlanStyleInput = z.infer<typeof PlanStyleInputSchema>;

/** The "new reel" form. It is also the payload of a `plan` job. */
export const PlanFormSchema = z.object({
  brief: z.string().trim().min(3, "brief must be at least 3 characters").max(2000),
  language: LanguageSchema,
  targetDurationSec: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]),
  pacing: z.enum(["calm", "punchy"]),
  captionPreset: CaptionPresetSchema,
  palette: z.array(PaletteColorSchema).min(1).max(5),
  style: PlanStyleInputSchema.optional(),
  voiceId: z.string().trim().min(1).optional(),
});
export type PlanForm = z.infer<typeof PlanFormSchema>;

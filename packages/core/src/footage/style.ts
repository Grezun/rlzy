import * as z from "zod";

export const EditStyleSchema = z.object({
  cutGapMs: z.number().positive(),
  padMs: z.number().nonnegative(),
  zoomSteps: z.array(z.number().min(1).max(2)).min(1),
  /** The visible window must be at least the face size × this, so a zoom never cuts the face. */
  faceMargin: z.number().min(1),
  pushInAfterMs: z.number().positive(),
  pushInFactor: z.number().min(1).max(1.5),
  captionMaxChars: z.number().int().positive(),
  captionMaxWords: z.number().int().positive(),
  headlineMs: z.number().positive(),
  headlineWordFrames: z.number().int().positive(),
  ctaMs: z.number().positive(),
  zoomHitFrames: z.number().int().positive(),
  zoomHitScale: z.number().min(1).max(2),
  flashFrames: z.number().int().positive(),
  musicUnderVoiceDb: z.number().max(0),
  sfxVolumeDb: z.object({ whoosh: z.number(), pop: z.number(), tick: z.number() }),
  fillerWords: z.array(z.string().min(1)),
  /** Mean word logprob below this adds a "noisy audio" note to the plan. */
  noisyLogprob: z.number().max(0),
});
export type EditStyle = z.infer<typeof EditStyleSchema>;

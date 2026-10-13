import * as z from "zod";
import { BreakKindSchema, CutawayTransitionSchema } from "../schema/timeline";

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
  /** Pill caption placement (Task 1 of plan 2): centre = on-screen chin + chinGapPct + pillHalfPct, clamped. */
  captionPlacement: z.object({
    minTopPct: z.number().min(0).max(100),
    maxTopPct: z.number().min(0).max(100),
    chinGapPct: z.number().min(0).max(100),
    pillHalfPct: z.number().min(0).max(100),
    holdPct: z.number().min(0).max(100),
    noFaceTopPct: z.number().min(0).max(100),
    seamTopPct: z.number().min(0).max(100),
  }),
  /** Recurring pattern breaks after the hook: one every everyMs (window minMs–maxMs), at cuts. */
  breaks: z.object({
    everyMs: z.number().positive(),
    minMs: z.number().positive(),
    maxMs: z.number().positive(),
    minShotFrames: z.number().int().positive(),
    kinds: z.array(BreakKindSchema).min(1),
    hitFactor: z.number().min(1).max(2),
    zoomBlurFrames: z.number().int().positive(),
  }),
  /** Punch-in cuts (to a larger zoom step) enter with a short scale snap. */
  snapFrames: z.number().int().positive(),
  /** Spec §5.4–5.5. contentFitRatio: an upload whose aspect differs from its slot by more than this is shown whole on a blurred fill. */
  cutaways: z.object({
    minMs: z.number().positive(),
    minSpeakerShare: z.number().min(0).max(1),
    brollBreakMs: z.number().positive(),
    kenBurns: z.number().min(1).max(1.5),
    /** Stills also drift this far (% of the frame) while they zoom; the direction changes per still. */
    driftPct: z.number().min(0).max(10),
    contentFitRatio: z.number().min(1),
    /** Full cutaways cycle these entries (split ones slide in from the top). */
    transitions: z.array(CutawayTransitionSchema.extract(["whip", "zoom"])).min(1),
    /** A cutaway followed by another within this many frames leaves with a cut (and the next enters with one), so the speaker never flickers between them. */
    backToBackFrames: z.number().int().nonnegative(),
    /** Whoosh level for cutaway entries (quieter than the hook's: about one every 3 s). */
    whooshDb: z.number(),
  }),
  /** Look pass callouts: timing, and the badge box (in % of the frame) used to keep it off the face and the captions. */
  callouts: z.object({
    durationMs: z.number().positive(),
    minMs: z.number().positive(),
    /** Frames kept clear after a cutaway (its exit) and before a callout (no pattern break starts there). */
    clearFrames: z.number().int().nonnegative(),
    topSafePct: z.number().min(0).max(100),
    gapPct: z.number().min(0).max(100),
    heightPct: z.number().min(0).max(100),
    noFaceTopPct: z.number().min(0).max(100),
    sideWidthPct: z.number().min(0).max(100),
    sidePadPct: z.number().min(0).max(100),
  }),
});
export type EditStyle = z.infer<typeof EditStyleSchema>;

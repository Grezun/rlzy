import * as z from "zod";
import {
  CaptionPresetSchema,
  LanguageSchema,
  MotionSchema,
  OverlayAnimationSchema,
  OverlayPositionSchema,
  TransitionSchema,
} from "./storyboard";

export const WordSchema = z.object({
  text: z.string().min(1),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
});
export type Word = z.infer<typeof WordSchema>;

export const SFX_NAMES = ["whoosh1", "whoosh2", "pop1", "pop2", "tick", "riser", "ding", "swoosh_out"] as const;
export const SfxNameSchema = z.enum(SFX_NAMES);
export type SfxName = z.infer<typeof SfxNameSchema>;

/** Face-centred zoom of a speaker clip: (cx, cy) is the visible centre, normalised; scale goes from→to across the clip, or within punchFrames. */
export const TimelineCropSchema = z.object({
  cx: z.number().min(0).max(1),
  cy: z.number().min(0).max(1),
  scaleFrom: z.number().min(1).max(3),
  scaleTo: z.number().min(1).max(3),
  punchFrames: z.number().int().positive().optional(),
});
export type TimelineCrop = z.infer<typeof TimelineCropSchema>;

export const TimelineClipSchema = z.object({
  sceneId: z.string(),
  kind: z.enum(["video", "image", "graphic", "speaker"]),
  src: z.string().optional(),
  fromFrame: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  motion: MotionSchema,
  transitionIn: TransitionSchema,
  /** speaker clips: the span of the working copy this clip plays (source time). */
  source: z.object({ inMs: z.number().nonnegative(), outMs: z.number().positive() }).optional(),
  crop: TimelineCropSchema.optional(),
  layout: z.enum(["full", "split"]).optional(),
  enter: z.object({ kind: z.enum(["snap", "zoom_blur"]), frames: z.number().int().positive() }).optional(),
});
export type TimelineClip = z.infer<typeof TimelineClipSchema>;

export const TimelineOverlaySchema = z.object({
  text: z.string().min(1),
  fromFrame: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  position: OverlayPositionSchema,
  animation: OverlayAnimationSchema,
});
export type TimelineOverlay = z.infer<typeof TimelineOverlaySchema>;

/** Recurring pattern-break kinds (plan 2 Task 1). The only definition: EditStyle and the timeline both use it. */
export const BreakKindSchema = z.enum(["zoom_hit", "flash", "zoom_blur"]);
export type BreakKind = z.infer<typeof BreakKindSchema>;

export const CaptionPageSchema = z.object({
  fromFrame: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  words: z.array(z.object({ text: z.string().min(1), emphasis: z.boolean(), startFrame: z.number().int().nonnegative().optional() })).min(1),
  /** Pill centre in % of the height (absent: the component's default 45 %). */
  topPct: z.number().min(0).max(100).optional(),
  emoji: z.string().optional(),
});
export type CaptionPage = z.infer<typeof CaptionPageSchema>;

export const TimelineSchema = z.object({
  fps: z.literal(30),
  width: z.literal(1080),
  height: z.literal(1920),
  durationInFrames: z.number().int().positive(),
  language: LanguageSchema,
  direction: z.enum(["rtl", "ltr"]),
  style: z.object({
    captionPreset: z.union([CaptionPresetSchema, z.literal("pill")]),
    font: z.string().min(1),
    palette: z.array(z.string()).min(1),
  }),
  audio: z.object({
    voiceUrl: z.string().optional(),
    musicUrl: z.string().optional(),
    musicDuckingDb: z.number(),
  }),
  clips: z.array(TimelineClipSchema),
  captions: z.object({ words: z.array(WordSchema), pages: z.array(CaptionPageSchema).optional() }),
  overlays: z.array(TimelineOverlaySchema),
  hook: z.object({
    patternBreak: z.enum(["zoom_hit", "flash", "none"]),
    headline: z.object({ small: z.string(), big: z.string().min(1), fromFrame: z.number().int().nonnegative(), durationInFrames: z.number().int().positive() }).optional(),
  }).optional(),
  ending: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("cta"), keyword: z.string().min(1), fromFrame: z.number().int().nonnegative(), durationInFrames: z.number().int().positive() }),
    z.object({ kind: z.literal("loop") }),
    z.object({ kind: z.literal("none") }),
  ]).optional(),
  sfx: z.array(z.object({ name: SfxNameSchema, frame: z.number().int().nonnegative(), src: z.string().min(1), volumeDb: z.number() })).optional(),
  patternBreaks: z.array(z.object({ frame: z.number().int().nonnegative(), kind: BreakKindSchema })).optional(),
});
export type Timeline = z.infer<typeof TimelineSchema>;

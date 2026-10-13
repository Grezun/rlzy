import * as z from "zod";
import { WordSchema } from "./timeline";

export const AssetHashSchema = z.string().regex(/^[0-9a-f]{64}$/, "must be an asset hash");

export const TranscriptWordSchema = WordSchema.extend({ logprob: z.number().optional() });
/** Scribe output, reduced: spoken words (indexable, in order) and audio events (laughter, breaths) kept apart. */
export const TranscriptSchema = z.object({
  languageCode: z.string(),
  languageProbability: z.number().min(0).max(1),
  words: z.array(TranscriptWordSchema),
  events: z.array(WordSchema).default([]),
});
export type Transcript = z.infer<typeof TranscriptSchema>;

/** Normalised to the frame, origin top-left. */
export const FaceBoxSchema = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });
export type FaceBox = z.infer<typeof FaceBoxSchema>;
const FaceSampleSchema = z.object({ tMs: z.number().nonnegative(), box: FaceBoxSchema.nullable() });

/** What tools/face-helper prints: the largest face on every `sampleEvery`-th frame, or null. */
export const RawFaceTrackSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  sampleEvery: z.number().int().positive(),
  samples: z.array(FaceSampleSchema),
});
export type RawFaceTrack = z.infer<typeof RawFaceTrackSchema>;

/** Smoothed and gap-filled (see footage/face-track.ts). null = no face at that time. */
export const FaceTrackSchema = z.object({ intervalMs: z.number().positive(), samples: z.array(FaceSampleSchema) });
export type FaceTrack = z.infer<typeof FaceTrackSchema>;

/** An extra photo or clip uploaded with the video, conformed and stored by ingest. durationMs is 0 for photos. */
export const FootageExtraSchema = z.object({
  assetId: AssetHashSchema,
  kind: z.enum(["image", "video"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationMs: z.number().int().nonnegative(),
  label: z.string().trim().min(1).max(80),
});
export type FootageExtra = z.infer<typeof FootageExtraSchema>;

export const FootageSourceSchema = z.object({
  assetId: AssetHashSchema, // the 1080×1920 working copy in the asset store
  durationMs: z.number().int().positive(),
  transcriptAssetId: AssetHashSchema,
  faceTrackAssetId: AssetHashSchema,
  extras: z.array(FootageExtraSchema).max(6).default([]),
});
export type FootageSource = z.infer<typeof FootageSourceSchema>;

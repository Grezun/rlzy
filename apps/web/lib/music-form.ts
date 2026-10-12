import { MusicMoodSchema } from "@reel/core";
import * as z from "zod";

export const MUSIC_EXTS = ["mp3", "wav", "m4a", "aac"] as const;
export const MUSIC_MAX_BYTES = 100 * 1024 * 1024;
export const MUSIC_MAX_SEC = 900;

export const musicExt = (name: string) => MUSIC_EXTS.find((e) => name.toLowerCase().endsWith(`.${e}`)) ?? null;
export const musicStoragePath = (id: string, ext: string) => `music/${id}.${ext}`;

export function checkMusicFile(f: { name: string; size: number; durationSec: number | null }): string[] {
  const errors: string[] = [];
  if (!musicExt(f.name)) errors.push("Upload an MP3, WAV, M4A or AAC file.");
  if (f.size > MUSIC_MAX_BYTES) errors.push("This track is over 100 MB.");
  if (f.durationSec !== null && f.durationSec > MUSIC_MAX_SEC) errors.push("This track is over 15 minutes.");
  return errors;
}

/** The team_music row the server inserts (the table's checks, mirrored). */
export const MusicTrackInputSchema = z.object({
  storagePath: z.string().regex(/^music\/[0-9a-f-]{36}\.(mp3|wav|m4a|aac)$/, "Upload the track again."),
  title: z.string().trim().min(1, "Give the track a title.").max(80),
  mood: MusicMoodSchema,
  durationSec: z.number().positive().max(MUSIC_MAX_SEC),
});
export type MusicTrackInput = z.infer<typeof MusicTrackInputSchema>;

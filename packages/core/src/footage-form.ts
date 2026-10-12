import * as z from "zod";
import { LanguageSchema } from "./schema/storyboard";

export const FOOTAGE_MAX_BYTES = 2 * 1024 ** 3;
export const FOOTAGE_MAX_SEC = 180;
/** Ingest allows half a second more than the browser check: containers round durations differently. */
export const FOOTAGE_MAX_SEC_INGEST = 180.5;
export const FOOTAGE_PATH_RE = /^footage\/[0-9a-f-]{36}\/source\.(mp4|mov)$/;

export type FootageExt = "mp4" | "mov";
export const FootageTargetSchema = z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60), z.literal(90)]);

/** The "Edit my video" form. It travels in the ingest and plan job payloads. */
export const FootageSettingsSchema = z.object({
  language: LanguageSchema,
  targetDurationSec: FootageTargetSchema,
  ctaKeyword: z.string().trim().min(1).max(30).optional(),
  notes: z.string().trim().min(1).max(2000).optional(),
});
export type FootageSettings = z.infer<typeof FootageSettingsSchema>;

export function footageExt(fileName: string): FootageExt | null {
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  return ext === "mp4" || ext === "mov" ? ext : null;
}

export const footageStoragePath = (projectId: string, ext: FootageExt) => `footage/${projectId}/source.${ext}`;

export const formatMinSec = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** Browser checks before upload. durationSec is null when the browser can't read it; ingest checks again. */
export function checkFootageFile(file: { name: string; size: number; durationSec: number | null }): string[] {
  const errors: string[] = [];
  if (!footageExt(file.name)) errors.push("Upload an MP4 or MOV video.");
  if (file.size === 0) errors.push("This file is empty.");
  if (file.size > FOOTAGE_MAX_BYTES) errors.push("This video is over 2 GB. Trim or compress it first.");
  if (file.durationSec !== null && file.durationSec > FOOTAGE_MAX_SEC) {
    errors.push(`This video is ${formatMinSec(file.durationSec)} long. Trim it to 3:00 or less.`);
  }
  return errors;
}

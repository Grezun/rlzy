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
  characterId: z.uuid().optional(),
});
export type FootageSettings = z.infer<typeof FootageSettingsSchema>;

export function footageExt(fileName: string): FootageExt | null {
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  return ext === "mp4" || ext === "mov" ? ext : null;
}

export const footageStoragePath = (projectId: string, ext: FootageExt) => `footage/${projectId}/source.${ext}`;

/** m:ss, rounded UP to the whole second: a clip just over a limit never reads as the limit (180.4 s → "3:01"). */
export function formatMinSec(sec: number): string {
  const whole = Math.ceil(sec);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

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

export const EXTRA_MAX_FILES = 6;
export const EXTRA_IMAGE_MAX_BYTES = 25 * 1024 ** 2;
export const EXTRA_VIDEO_MAX_BYTES = 500 * 1024 ** 2;
export type ExtraExt = "mp4" | "mov" | "jpg" | "jpeg" | "png" | "webp";
const EXTRA_EXTS: readonly ExtraExt[] = ["mp4", "mov", "jpg", "jpeg", "png", "webp"];
export const EXTRA_PATH_RE = /^footage\/[0-9a-f-]{36}\/extra-[1-6]\.(mp4|mov|jpg|jpeg|png|webp)$/;

export function extraExt(fileName: string): ExtraExt | null {
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  return (EXTRA_EXTS as readonly string[]).includes(ext) ? (ext as ExtraExt) : null;
}
export const extraKind = (ext: ExtraExt): "image" | "video" => (ext === "mp4" || ext === "mov" ? "video" : "image");
export const extraStoragePath = (projectId: string, n: number, ext: ExtraExt) => `footage/${projectId}/extra-${n}.${ext}`;
/** A file name without its extension, trimmed, at most `max` characters (code points); `fallback` when nothing is left. */
export function baseName(fileName: string, max: number, fallback: string): string {
  const base = fileName.replace(/\.[^.]*$/, "").trim();
  return base ? Array.from(base).slice(0, max).join("") : fallback;
}
export const extraLabel = (fileName: string) => baseName(fileName, 80, "Upload");

/** Browser and server checks for the optional extra photos and clips (used as cutaways). */
export function checkExtraFiles(files: { name: string; size: number }[]): string[] {
  if (files.length > EXTRA_MAX_FILES) return [`Add at most ${EXTRA_MAX_FILES} extra files.`];
  const errors: string[] = [];
  for (const f of files) {
    const ext = extraExt(f.name);
    if (!ext) {
      errors.push(`${f.name}: use a JPG, PNG or WEBP photo${/\.hei[cf]$/i.test(f.name) ? " (convert HEIC to JPG first)" : ""}, or an MP4 or MOV clip.`);
      continue;
    }
    if (f.size === 0) errors.push(`${f.name} is empty.`);
    else if (extraKind(ext) === "image" && f.size > EXTRA_IMAGE_MAX_BYTES) errors.push(`${f.name}: photos can be at most 25 MB.`);
    else if (extraKind(ext) === "video" && f.size > EXTRA_VIDEO_MAX_BYTES) errors.push(`${f.name}: clips can be at most 500 MB.`);
  }
  return errors;
}

export const ExtraUploadSchema = z.object({ storagePath: z.string().regex(EXTRA_PATH_RE), label: z.string().trim().min(1).max(80) });
export type ExtraUpload = z.infer<typeof ExtraUploadSchema>;

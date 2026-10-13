import type { FinishResult } from "./create-footage";

export type SendOutcome =
  | { kind: "done" }
  /** The upload stopped: "Resume upload" continues it. */
  | { kind: "interrupted"; errors: string[] }
  /** Recording the upload failed. `uploaded`: the file is in storage, so a retry only records it again. */
  | { kind: "failed"; errors: string[]; uploaded: boolean }
  /** The video is already with the worker: nothing to retry, open the reel. */
  | { kind: "queued"; errors: string[] };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Uploads (unless this file is already uploaded) and then records the upload. A retry after a failed
 * record never uploads again: tus forgets a finished upload, so it would resend the whole file.
 */
export async function sendFootage(
  steps: { upload(): Promise<void>; finish(): Promise<FinishResult>; onUploaded(): void },
  uploaded: boolean,
): Promise<SendOutcome> {
  if (!uploaded) {
    try {
      await steps.upload();
    } catch (err) {
      return { kind: "interrupted", errors: [`Upload interrupted: ${message(err)}. Check your connection and press Resume upload: it continues where it stopped.`] };
    }
    steps.onUploaded();
  }
  let r: FinishResult;
  try {
    r = await steps.finish();
  } catch (err) {
    return { kind: "failed", errors: [`Couldn't record the upload: ${message(err)}`], uploaded: true };
  }
  if (r.ok) return { kind: "done" };
  if (r.queued) return { kind: "queued", errors: r.errors };
  return { kind: "failed", errors: r.errors, uploaded: !r.uploadMissing };
}

/** The button offered after an outcome, or null when there is nothing to retry. */
export function retryLabel(o: SendOutcome): "Resume upload" | "Try again" | "Upload again" | null {
  if (o.kind === "interrupted") return "Resume upload";
  if (o.kind === "failed") return o.uploaded ? "Try again" : "Upload again";
  return null;
}

const EXTRA_TYPES: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
export const extraContentType = (ext: string) => EXTRA_TYPES[ext] ?? "application/octet-stream";

/**
 * After finish says a file is missing from storage ("Upload again"), `done` no longer matches storage: forget it, so
 * the next send uploads every file again. Interruptions and failed recordings keep it (nothing is missing there).
 */
export function forgetUploadsAfter(done: Set<string>, outcome: SendOutcome): void {
  if (outcome.kind === "failed" && !outcome.uploaded) done.clear();
}

/**
 * Uploads every item not yet in `done`, in order; each finished one joins `done`, so "Resume upload" never sends a
 * finished file again (tus forgets finished uploads and would start over). Progress is by bytes over all items.
 */
export async function uploadAll<T extends { objectName: string; size: number }>(
  items: T[], done: Set<string>, upload: (item: T, onFraction: (f: number) => void) => Promise<void>, onProgress: (fraction: number) => void,
): Promise<void> {
  const total = items.reduce((s, i) => s + i.size, 0) || 1;
  const doneBytes = () => items.filter((i) => done.has(i.objectName)).reduce((s, i) => s + i.size, 0);
  for (const item of items) {
    if (done.has(item.objectName)) continue;
    const base = doneBytes();
    await upload(item, (f) => onProgress((base + f * item.size) / total));
    done.add(item.objectName);
    onProgress(doneBytes() / total);
  }
}

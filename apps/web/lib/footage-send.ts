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

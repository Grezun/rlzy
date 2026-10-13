import { baseName, checkExtraFiles, checkFootageFile, EXTRA_MAX_FILES, extraExt, extraStoragePath, ExtraUploadSchema, footageExt, footageStoragePath, FOOTAGE_PATH_RE, FootageSettingsSchema, type FootageSettings } from "@reel/core";
import * as z from "zod";
import type { IngestFootagePayload } from "@reel/db";

export interface FootageDeps {
  /** Inserts a projects row with format 'footage' and status 'uploading'. */
  insertProject(input: { title: string; language: "he" | "en" }): Promise<{ id: string } | { error: string }>;
  /** Throws when the lookup fails; null when the project doesn't exist (or isn't visible). */
  getProject(id: string): Promise<{ status: string; format: string } | null>;
  /** Throws when the check fails; false when the object doesn't exist. */
  objectExists(path: string): Promise<boolean>;
  insertIngestJob(projectId: string, payload: IngestFootagePayload): Promise<{ ok: true } | { error: string; code?: string }>;
  /** Throws when the update fails. */
  setStatus(projectId: string, status: "planning"): Promise<void>;
}
type Result<T = object> = ({ ok: true } & T) | { ok: false; errors: string[] };
/** `queued`: the video is already with the worker (or past it); retrying the finish can't help, open the reel instead. */
/** `uploadMissing`: storage has no file at the path, so a retry must upload again. */
export type FinishResult = { ok: true } | { ok: false; errors: string[]; queued?: true; uploadMissing?: true };

export const footageTitle = (fileName: string) => baseName(fileName, 120, "My video");

/** Creates the 'uploading' project the browser uploads into. The file checks run again here: the browser's can be bypassed. */
export async function startFootage(
  deps: FootageDeps,
  input: { settings: FootageSettings; fileName: string; size: number; durationSec: number | null; extras?: { name: string; size: number }[] },
): Promise<Result<{ projectId: string; storagePath: string; extraPaths: string[] }>> {
  const settings = FootageSettingsSchema.safeParse(input.settings);
  if (!settings.success) return { ok: false, errors: ["The reel settings are invalid. Start again."] };
  const extras = input.extras ?? [];
  const errors = [...checkFootageFile({ name: input.fileName, size: input.size, durationSec: input.durationSec }), ...checkExtraFiles(extras)];
  if (errors.length) return { ok: false, errors };
  const project = await deps.insertProject({ title: footageTitle(input.fileName), language: settings.data.language });
  if ("error" in project) return { ok: false, errors: [`Couldn't create the reel: ${project.error}`] };
  return {
    ok: true,
    projectId: project.id,
    storagePath: footageStoragePath(project.id, footageExt(input.fileName)!),
    extraPaths: extras.map((e, i) => extraStoragePath(project.id, i + 1, extraExt(e.name)!)),
  };
}

/** Records a finished upload: queues ingest and moves the project out of 'uploading'. */
export async function finishFootage(deps: FootageDeps, input: { projectId: string; storagePath: string; settings: unknown; extras?: unknown }): Promise<FinishResult> {
  const fail = (m: string): FinishResult => ({ ok: false, errors: [m] });
  const queued = (m: string): FinishResult => ({ ok: false, errors: [m], queued: true });
  if (!FOOTAGE_PATH_RE.test(input.storagePath) || !input.storagePath.startsWith(`footage/${input.projectId}/`)) return fail("This upload doesn't belong to this reel.");
  const settings = FootageSettingsSchema.safeParse(input.settings);
  if (!settings.success) return fail("The reel settings are invalid. Start again.");
  const extras = z.array(ExtraUploadSchema).max(EXTRA_MAX_FILES).safeParse(input.extras ?? []);
  if (!extras.success || extras.data.some((e) => !e.storagePath.startsWith(`footage/${input.projectId}/`))) return fail("This upload doesn't belong to this reel.");
  const project = await deps.getProject(input.projectId);
  if (!project || project.format !== "footage") return fail("This upload doesn't belong to this reel.");
  if (project.status !== "uploading") return queued("This video was already submitted.");
  if (!(await deps.objectExists(input.storagePath))) return { ok: false, errors: ["The upload didn't finish. Upload the video again."], uploadMissing: true };
  for (const e of extras.data) {
    if (!(await deps.objectExists(e.storagePath))) return { ok: false, errors: [`"${e.label}" didn't finish uploading. Upload again.`], uploadMissing: true };
  }
  const job = await deps.insertIngestJob(input.projectId, { storagePath: input.storagePath, settings: settings.data, extras: extras.data });
  if ("error" in job) return job.code === "23505" ? queued("A job for this reel is already queued or running.") : fail(`Couldn't start: ${job.error}`);
  try {
    await deps.setStatus(input.projectId, "planning");
  } catch (err) {
    // The ingest job is queued and moves the project to planning when it starts.
    return queued(`Your video is queued, but the reel's status couldn't be updated (${err instanceof Error ? err.message : String(err)}).`);
  }
  return { ok: true };
}

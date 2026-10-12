import { parseStoryboard, type Storyboard } from "@reel/core";
import { checkStoryboard } from "./storyboard-edit";

export const ACTIVE_JOB_ERROR = "A job for this reel is already queued or running.";
export const wrongProjectError = (noun: string) => `This ${noun} doesn't belong to this reel. Refresh the page.`;

export type Result = { ok: true } | { ok: false; errors: string[] };
export const fail = (message: string): Result => ({ ok: false, errors: [message] });

export interface StoryboardRow {
  projectId: string;
  version: number;
  status: "draft" | "approved" | "superseded";
  json: unknown;
}

/**
 * Storage of a reel's versioned document (a faceless storyboard or a footage edit plan; both live in `storyboards`).
 * `J` is the document type.
 */
export interface DraftWriteDeps<J> {
  getStoryboard(storyboardId: string): Promise<StoryboardRow | null>;
  /** Updates a storyboard only while it is a draft of this project; returns the number of rows changed (0 or 1). */
  updateDraft(projectId: string, storyboardId: string, json: J, status: "draft" | "approved"): Promise<number>;
  /** Queues this format's generate job for the storyboard. */
  queueGenerate(projectId: string, storyboardId: string): Promise<void>;
  setProjectStatus(projectId: string, status: "draft" | "generating" | "planning"): Promise<void>;
  activeJobCount(projectId: string): Promise<number>;
  hasDoneGenerate(storyboardId: string): Promise<boolean>;
  insertDraft(projectId: string, version: number, json: J): Promise<void>;
  maxVersion(projectId: string): Promise<number>;
}
export type StoryboardWriteDeps = DraftWriteDeps<Storyboard>;

/** What the shared steps need to know about a document type: its name in messages and its parser. */
export type DocKind<J extends { version: number }> = { noun: string; parse(json: unknown): J };
const STORYBOARD: DocKind<Storyboard> = { noun: "storyboard", parse: parseStoryboard };

type Ids = { projectId: string; storyboardId: string };

type Prepared = { ok: true; row: StoryboardRow; json: Storyboard } | { ok: false; errors: string[] };

/** Loads the stored row and validates client JSON; identity fields always come from the server row. */
async function prepare(deps: StoryboardWriteDeps, projectId: string, storyboardId: string, clientJson: unknown): Promise<Prepared> {
  const row = await deps.getStoryboard(storyboardId);
  if (!row || row.projectId !== projectId) return fail(wrongProjectError("storyboard")) as Prepared;
  const checked = checkStoryboard(clientJson);
  if (!checked.ok) return checked;
  let stored: Storyboard;
  try {
    stored = parseStoryboard(row.json);
  } catch {
    return fail("The stored storyboard is invalid and can't be edited.") as Prepared;
  }
  const json: Storyboard = { ...checked.storyboard, version: row.version, voice: stored.voice, format: stored.format, aspect: stored.aspect };
  return { ok: true, row, json };
}

/** Saves an already validated draft document. */
export async function writeDraft<J>(deps: DraftWriteDeps<J>, input: Ids, json: J, noun: string): Promise<Result> {
  const updated = await deps.updateDraft(input.projectId, input.storyboardId, json, "draft");
  return updated ? { ok: true } : fail(`Only draft ${noun}s can be edited. Use “Edit as new version”.`);
}

/** Approves an already validated draft document, then queues exactly one generate job. */
export async function approveDraft<J>(deps: DraftWriteDeps<J>, input: Ids, json: J, noun: string): Promise<Result> {
  // An approved row cannot be reverted by the web user (RLS), so refuse before writing if a job is already active.
  if ((await deps.activeJobCount(input.projectId)) > 0) return fail(ACTIVE_JOB_ERROR);
  // The draft→approved update is the lock: concurrent approvals serialize on the row and only one sees status='draft'.
  const updated = await deps.updateDraft(input.projectId, input.storyboardId, json, "approved");
  if (!updated) return fail(`This ${noun} was already approved. Refresh the page.`);
  try {
    await deps.queueGenerate(input.projectId, input.storyboardId);
    await deps.setProjectStatus(input.projectId, "generating");
  } catch {
    return fail("Approved, but queuing failed — use “Retry generation”.");
  }
  return { ok: true };
}

/** Re-queues generation of the latest approved version, unless it already rendered. */
export async function retryApproved<J>(deps: DraftWriteDeps<J>, input: Ids, noun: string): Promise<Result> {
  if ((await deps.activeJobCount(input.projectId)) > 0) return fail(ACTIVE_JOB_ERROR);
  const row = await deps.getStoryboard(input.storyboardId);
  if (!row || row.projectId !== input.projectId || row.status !== "approved") return fail(`Only an approved ${noun} can be generated.`);
  if (row.version !== (await deps.maxVersion(input.projectId))) return fail("A newer version exists — approve that one instead.");
  if (await deps.hasDoneGenerate(input.storyboardId)) return fail("This version was already generated. Use “Edit as new version” to make changes.");
  await deps.queueGenerate(input.projectId, input.storyboardId);
  await deps.setProjectStatus(input.projectId, "generating");
  return { ok: true };
}

/** Copies a stored version into a new draft with the next version number. */
export async function copyAsNewDraft<J extends { version: number }>(
  deps: DraftWriteDeps<J>,
  input: { projectId: string; sourceStoryboardId: string },
  kind: DocKind<J>,
): Promise<Result> {
  if ((await deps.activeJobCount(input.projectId)) > 0) return fail("Wait for the current job to finish before editing.");
  const row = await deps.getStoryboard(input.sourceStoryboardId);
  if (!row || row.projectId !== input.projectId) return fail(wrongProjectError(kind.noun));
  let stored: J;
  try {
    stored = kind.parse(row.json);
  } catch {
    return fail(`The stored ${kind.noun} is invalid and can't be copied.`);
  }
  const version = (await deps.maxVersion(input.projectId)) + 1;
  try {
    await deps.insertDraft(input.projectId, version, { ...stored, version });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("23505") || message.includes("duplicate key")) return fail("A newer version already exists. Refresh the page.");
    throw err;
  }
  await deps.setProjectStatus(input.projectId, "draft");
  return { ok: true };
}

export async function saveDraft(deps: StoryboardWriteDeps, input: Ids & { json: unknown }): Promise<Result> {
  const p = await prepare(deps, input.projectId, input.storyboardId, input.json);
  return p.ok ? writeDraft(deps, input, p.json, STORYBOARD.noun) : p;
}

export async function approveStoryboard(deps: StoryboardWriteDeps, input: Ids & { json: unknown }): Promise<Result> {
  const p = await prepare(deps, input.projectId, input.storyboardId, input.json);
  return p.ok ? approveDraft(deps, input, p.json, STORYBOARD.noun) : p;
}

export async function retryGenerate(deps: StoryboardWriteDeps, input: Ids): Promise<Result> {
  return retryApproved(deps, input, STORYBOARD.noun);
}

export async function newDraftFrom(deps: StoryboardWriteDeps, input: { projectId: string; sourceStoryboardId: string }): Promise<Result> {
  return copyAsNewDraft(deps, input, STORYBOARD);
}

import { EmptyEditError, footageDurationMs, parseEditPlan, withFootageEstimate, type EditPlan, type FootageSettings, type Word } from "@reel/core";
import { PlanFootageJobPayloadSchema, type IngestFootagePayload } from "@reel/db";
import { houseStyle } from "@reel/video/house-style";
import { ACTIVE_JOB_ERROR, approveDraft, copyAsNewDraft, fail, retryApproved, wrongProjectError, writeDraft, type DocKind, type DraftWriteDeps, type Result } from "./approve";
import { checkEditPlan } from "./edit-plan-edit";

export type { Result } from "./approve";

export const REPLAN_INSTRUCTION_MAX = 500;
const EDIT_PLAN: DocKind<EditPlan> = { noun: "edit plan", parse: parseEditPlan };

/** The storyboard deps (generation is queued through queueJob), plus what the footage flow needs. */
export interface PlanWriteDeps extends Omit<DraftWriteDeps<EditPlan>, "queueGenerate"> {
  /** Words of the transcript asset (by hash). */
  loadWords(transcriptAssetId: string): Promise<Word[]>;
  queueJob(projectId: string, type: "generate_footage" | "plan_footage" | "ingest_footage", payload: object): Promise<void>;
  /** Payload of the project's latest ingest_footage job (the user's original settings), or null. */
  ingestPayload(projectId: string): Promise<IngestFootagePayload | null>;
}

const asDraftDeps = (deps: PlanWriteDeps): DraftWriteDeps<EditPlan> => ({
  ...deps,
  queueGenerate: (projectId, storyboardId) => deps.queueJob(projectId, "generate_footage", { storyboardId }),
});

type Ids = { projectId: string; storyboardId: string };
type Prepared = { ok: true; json: EditPlan; words: Word[] } | { ok: false; errors: string[] };

/**
 * Validates the client's plan. The source, language, target, warnings and the beat spans come from the stored row
 * (the client only toggles and decorates beats), and the estimate is recomputed here with the worker's helper.
 */
async function prepare(deps: PlanWriteDeps, input: Ids, clientJson: unknown): Promise<Prepared> {
  const row = await deps.getStoryboard(input.storyboardId);
  if (!row || row.projectId !== input.projectId) return { ok: false, errors: [wrongProjectError(EDIT_PLAN.noun)] };
  const checked = checkEditPlan(clientJson);
  if (!checked.ok) return checked;
  let stored: EditPlan;
  try {
    stored = parseEditPlan(row.json);
  } catch {
    return { ok: false, errors: ["The stored edit plan is invalid and can't be edited."] };
  }
  if (checked.plan.beats.length !== stored.beats.length) return { ok: false, errors: ["Beats can't be added or removed; untick a beat to drop it."] };
  const merged = checkEditPlan({
    ...checked.plan,
    format: "footage",
    version: row.version,
    source: stored.source,
    language: stored.language,
    targetDurationSec: stored.targetDurationSec,
    warnings: stored.warnings,
    beats: checked.plan.beats.map((b, i) => ({ ...b, id: stored.beats[i].id, startWordIdx: stored.beats[i].startWordIdx, endWordIdx: stored.beats[i].endWordIdx })),
  });
  if (!merged.ok) return merged;
  const words = await deps.loadWords(stored.source.transcriptAssetId);
  return { ok: true, json: withFootageEstimate(merged.plan, words, houseStyle.edit), words };
}

export async function savePlan(deps: PlanWriteDeps, input: Ids & { json: unknown }): Promise<Result> {
  const p = await prepare(deps, input, input.json);
  return p.ok ? writeDraft(asDraftDeps(deps), input, p.json, EDIT_PLAN.noun) : p;
}

export async function approvePlan(deps: PlanWriteDeps, input: Ids & { json: unknown }): Promise<Result> {
  const p = await prepare(deps, input, input.json);
  if (!p.ok) return p;
  // Same rule as compileFootage: never approve (or pay for) a reel with nothing to show.
  if (footageDurationMs(p.json, p.words, houseStyle.edit) === 0) return fail(new EmptyEditError().message);
  return approveDraft(asDraftDeps(deps), input, p.json, EDIT_PLAN.noun);
}

export async function retryFootageGenerate(deps: PlanWriteDeps, input: Ids): Promise<Result> {
  return retryApproved(asDraftDeps(deps), input, EDIT_PLAN.noun);
}

export async function newPlanVersion(deps: PlanWriteDeps, input: Ids): Promise<Result> {
  return copyAsNewDraft(asDraftDeps(deps), { projectId: input.projectId, sourceStoryboardId: input.storyboardId }, EDIT_PLAN);
}

/** Asks Claude for a new plan of the same video (the worker adds it as the next draft version). */
export async function replan(deps: PlanWriteDeps, input: Ids & { instruction: string }): Promise<Result> {
  if ((await deps.activeJobCount(input.projectId)) > 0) return fail(ACTIVE_JOB_ERROR);
  const row = await deps.getStoryboard(input.storyboardId);
  if (!row || row.projectId !== input.projectId) return fail(wrongProjectError(EDIT_PLAN.noun));
  if (row.status !== "draft") return fail("Only a draft edit plan can be re-planned. Use “Edit as new version” first.");
  if (row.version !== (await deps.maxVersion(input.projectId))) return fail("A newer version exists. Re-plan from that one.");
  const instruction = input.instruction.trim();
  if (instruction.length > REPLAN_INSTRUCTION_MAX) return fail(`Keep the Re-plan instruction to ${REPLAN_INSTRUCTION_MAX} characters or fewer.`);
  let stored: EditPlan;
  try {
    stored = parseEditPlan(row.json);
  } catch {
    return fail("The stored edit plan is invalid. Use “Edit as new version” or upload the video again.");
  }
  const fallback: FootageSettings = { language: stored.language, targetDurationSec: stored.targetDurationSec, ...(stored.ending.kind === "cta" ? { ctaKeyword: stored.ending.keyword } : {}) };
  const settings = (await deps.ingestPayload(input.projectId))?.settings ?? fallback;
  const payload = PlanFootageJobPayloadSchema.safeParse({ settings, source: stored.source, fromStoryboardId: input.storyboardId, ...(instruction ? { instruction } : {}) });
  if (!payload.success) return fail(`Couldn't queue the Re-plan: ${payload.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  await deps.queueJob(input.projectId, "plan_footage", payload.data);
  await deps.setProjectStatus(input.projectId, "planning");
  return { ok: true };
}

/** After a failed ingest (or a failed first plan): run ingest again. Finished steps are cached, so they cost nothing again. */
export async function retryIngest(deps: PlanWriteDeps, input: { projectId: string }): Promise<Result> {
  if ((await deps.activeJobCount(input.projectId)) > 0) return fail(ACTIVE_JOB_ERROR);
  const payload = await deps.ingestPayload(input.projectId);
  if (!payload) return fail("There is no uploaded video to retry. Upload it again.");
  await deps.queueJob(input.projectId, "ingest_footage", payload);
  await deps.setProjectStatus(input.projectId, "planning");
  return { ok: true };
}

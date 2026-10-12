import { parseEditPlan, type EditPlan, type FootageSettings, type FootageSource, type PipelineEvent, type Transcript } from "@reel/core";
import { applyPipelineEvent, BUCKETS, emptyProgress, IngestFootageJobPayloadSchema, PlanFootageJobPayloadSchema } from "@reel/db";
import { ingestFootage, loadFootageInputs, transcriptWarnings, type AssetStore, type FaceTracker, type FootagePlanner, type Transcriber } from "@reel/engine";
import { houseStyle } from "@reel/video/house-style";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { JobHandler } from "../loop";
import type { ReelDb } from "../reel-db";
import type { BlobStore } from "../storage";

export type FootageHandlerDeps = { store: AssetStore; blobs: BlobStore; db: ReelDb; transcriber: Transcriber; faceTracker: FaceTracker; footagePlanner: FootagePlanner };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function planAndSave(deps: FootageHandlerDeps, projectId: string, input: { settings: FootageSettings; source: FootageSource; transcript: Transcript; instruction?: string; previous?: EditPlan }) {
  const library = await deps.db.listTeamMusic();
  const planned = await deps.footagePlanner.plan({
    ...input,
    library: library.map(({ id, title, mood, durationSec }) => ({ id, title, mood, durationSec })),
    warnings: transcriptWarnings(input.transcript, input.settings, houseStyle.edit),
  });
  const version = await deps.db.nextStoryboardVersion(projectId);
  const plan = { ...planned, version };
  // Insert first, then supersede the older drafts: a failed insert must never leave the reel without a draft.
  const id = await deps.db.insertStoryboard({ projectId, version, json: plan, createdBy: "agent" });
  await deps.db.supersedeDrafts(projectId, id);
  await deps.db.setProjectStatus(projectId, "draft", plan.title);
}

/**
 * Ingest, then plan in the same job: the queue allows one active job per reel, so a running ingest job can't queue
 * plan_footage. A failed plan step is retried with Re-plan (or Retry), and ingest's cached assets make that free.
 */
export function createIngestFootageHandler(deps: FootageHandlerDeps): JobHandler {
  return async (job, ctx) => {
    let progress = emptyProgress();
    const onEvent = (e: PipelineEvent) => {
      progress = applyPipelineEvent(progress, e);
      ctx.report(progress);
    };
    const tmpDir = await mkdtemp(join(tmpdir(), "reel-ingest-"));
    try {
      const { storagePath, settings } = IngestFootageJobPayloadSchema.parse(job.payload);
      if (!storagePath.startsWith(`footage/${job.project_id}/`)) throw new Error("This upload belongs to another reel.");
      await deps.db.setProjectStatus(job.project_id, "planning");
      const original = join(tmpDir, basename(storagePath));
      ctx.log("ingest: downloading the upload");
      await deps.blobs.download(BUCKETS.assets, storagePath, original);
      const { source, transcript } = await ingestFootage(original, { store: deps.store, transcriber: deps.transcriber, faceTracker: deps.faceTracker, tmpDir, log: ctx.log, onEvent });
      onEvent({ type: "step", step: "plan", status: "running" });
      await planAndSave(deps, job.project_id, { settings, source, transcript });
      onEvent({ type: "step", step: "plan", status: "done" });
      return { status: "done", progress };
    } catch (err) {
      await deps.db.setProjectStatus(job.project_id, "failed").catch(() => {});
      throw err;
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  };
}

const FromStoryboardSchema = PlanFootageJobPayloadSchema.pick({ fromStoryboardId: true });

export function createPlanFootageHandler(deps: FootageHandlerDeps): JobHandler {
  return async (job, ctx) => {
    let hadPlan = false;
    try {
      // Find the plan the user was looking at before validating the rest, so even a rejected payload puts a Re-plan back to draft.
      const from = FromStoryboardSchema.safeParse(job.payload);
      const record = from.success && from.data.fromStoryboardId ? await deps.db.getStoryboard(from.data.fromStoryboardId) : null;
      hadPlan = record?.projectId === job.project_id;
      // The schema trims the instruction and caps it at 500 characters.
      const payload = PlanFootageJobPayloadSchema.parse(job.payload);
      let previous: EditPlan | undefined;
      if (record && hadPlan) {
        try {
          previous = parseEditPlan(record.json);
        } catch (err) {
          ctx.log(`plan_footage: previous plan ${record.id} is not a valid edit plan (${message(err)}); re-planning without it`);
        }
      }
      await deps.db.setProjectStatus(job.project_id, "planning");
      const { transcript, transcriptAsset } = await loadFootageInputs(deps.store, payload.source);
      // Fake and real workers share the asset index: never plan (and pay Claude) on a transcript another transcriber made.
      if (transcriptAsset.meta.model !== deps.transcriber.model) {
        throw new Error(`This video was transcribed by ${transcriptAsset.meta.model ?? "an unknown transcriber"}, but this worker uses ${deps.transcriber.model}. Upload the video again.`);
      }
      await planAndSave(deps, job.project_id, { settings: payload.settings, source: payload.source, transcript, instruction: payload.instruction, previous });
      return { status: "done" };
    } catch (err) {
      // A failed Re-plan leaves the previous draft as it was.
      await deps.db.setProjectStatus(job.project_id, hadPlan ? "draft" : "failed").catch(() => {});
      throw err;
    }
  };
}

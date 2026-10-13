import { assetSrc, parseEditPlan, SpendCapError, type FootageSource, type PipelineEvent } from "@reel/core";
import { applyPipelineEvent, BUCKETS, emptyProgress, GenerateJobPayloadSchema } from "@reel/db";
import { buildFootageTimeline, generateFootageAssets, renderFootage, SOUL_REFERENCE_STRENGTH, type AssetStore, type ImageGen, type MediaUploader, type MusicGen, type VideoGen } from "@reel/engine";
import { houseStyle } from "@reel/video/house-style";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import type { JobHandler } from "../loop";
import type { ReelDb } from "../reel-db";
import type { BlobStore } from "../storage";
import { uploadRender } from "./render-upload";

export type GenerateFootageHandlerDeps = {
  music: MusicGen;
  image: ImageGen;
  video: VideoGen;
  uploader: MediaUploader;
  store: AssetStore;
  blobs: BlobStore;
  db: ReelDb;
  sfxDir: string | null;
  spendCapUsd: number;
  /** This worker's transcriber and face tracker: fake and real workers share the asset index, so a plan must be built on the same models. */
  inputModels: { transcriber: string; faceTracker: string };
};

/** Refuses a plan whose transcript or face track another provider made (e.g. the fake worker), before any spend. */
async function assertSameInputModels(store: AssetStore, source: FootageSource, models: GenerateFootageHandlerDeps["inputModels"]) {
  const checks = [
    { what: "transcript", id: source.transcriptAssetId, model: models.transcriber },
    { what: "face track", id: source.faceTrackAssetId, model: models.faceTracker },
  ];
  for (const { what, id, model } of checks) {
    const made = (await store.get(id))?.meta.model;
    if (!made || made === model) continue; // a missing asset fails when the inputs load
    if (made.startsWith("fake/")) throw new Error(`This edit plan was made by the fake worker (fake ${what}). Upload the video again with the real worker running.`);
    throw new Error(`This edit plan's ${what} was made by ${made}, but this worker uses ${model}. Upload the video again.`);
  }
}

export function createGenerateFootageHandler(deps: GenerateFootageHandlerDeps): JobHandler {
  const style = houseStyle.edit;
  return async (job, ctx) => {
    const { storyboardId } = GenerateJobPayloadSchema.parse(job.payload);
    const record = await deps.db.getStoryboard(storyboardId);
    if (!record || record.projectId !== job.project_id) throw new Error(`edit plan ${storyboardId} not found for this project`);
    if (record.status !== "approved") throw new Error("edit plan is not approved; approve it before generating");
    let progress = emptyProgress();
    if (await deps.db.hasRender(storyboardId)) {
      await deps.db.setProjectStatus(job.project_id, "rendered");
      return { status: "done", progress };
    }
    const tmpDir = await mkdtemp(join(tmpdir(), "reel-footage-"));
    try {
      const plan = parseEditPlan(record.json);
      if (plan.version !== record.version) throw new Error(`edit plan JSON version ${plan.version} does not match stored version ${record.version}`);
      if (plan.estimate.credits > deps.spendCapUsd) throw new SpendCapError(plan.estimate.credits, deps.spendCapUsd);
      await assertSameInputModels(deps.store, plan.source, deps.inputModels);
      await deps.db.setProjectStatus(job.project_id, "generating");
      const onEvent = (e: PipelineEvent) => {
        progress = applyPipelineEvent(progress, e);
        ctx.report(progress);
      };
      const library = async (trackId: string, destDir: string) => {
        const track = await deps.db.getTeamTrack(trackId);
        if (!track) return null;
        const dest = join(destDir, `library-${track.id}${extname(track.storagePath)}`);
        await deps.blobs.download(BUCKETS.assets, track.storagePath, dest);
        return dest;
      };
      // Only used when the working copy is gone from this machine and from storage (its mirror is best-effort).
      const original = async (destDir: string) => {
        for (const ext of ["mp4", "mov"]) {
          const dest = join(destDir, `original.${ext}`);
          try {
            await deps.blobs.download(BUCKETS.assets, `footage/${job.project_id}/source.${ext}`, dest);
            return dest;
          } catch {
            // not this extension (or gone); try the next
          }
        }
        return null;
      };
      const found = plan.character ? await deps.db.getCharacter(plan.character.id) : null;
      const character = found ? { referenceId: found.referenceId, strength: SOUL_REFERENCE_STRENGTH } : null;
      const genDeps = { music: deps.music, image: deps.image, video: deps.video, uploader: deps.uploader, character, store: deps.store, tmpDir, log: ctx.log, onEvent, library, original, sfxDir: deps.sfxDir, style };
      const gen = await generateFootageAssets(plan, genDeps);
      const out = await renderFootage(plan, gen, genDeps, join(tmpDir, "out"));
      const paths = await uploadRender(deps.blobs, job.project_id, record.version, out);
      await deps.db.insertRender({ projectId: job.project_id, storyboardId, storyboardVersion: record.version, paths, timeline: buildFootageTimeline(plan, gen, assetSrc, style) });
      await deps.db.setProjectStatus(job.project_id, "rendered");
      return { status: "done", progress };
    } catch (err) {
      await deps.db.setProjectStatus(job.project_id, "failed").catch(() => {});
      throw err;
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  };
}

import { cutawayCost, videoBillSeconds, type EditPlan, type PlacedCutaway } from "@reel/core";
import { conformVideo, fitDuration } from "@reel/media";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AssetStore, StoredAsset } from "./asset-store";
import { contentTypeFor, downloadTo, extFromUrl } from "./download";
import { footageHashes } from "./footage-ingest";
import { cached, estUsd, hashes } from "./pipeline";
import type { ImageGen, MediaUploader, SoulReference, VideoGen } from "./providers/types";

/** What is left of the approved estimate (USD). Every uncached paid element is reserved here before it is paid. */
export type SpendBudget = { remaining: number };
export const makeBudget = (usd: number): SpendBudget => ({ remaining: usd });
export function takeBudget(b: SpendBudget, usd: number): boolean {
  if (usd > b.remaining + 1e-9) return false;
  b.remaining = Math.max(0, b.remaining - usd);
  return true;
}

export type CutawayGenDeps = {
  image: ImageGen; video: VideoGen; uploader: MediaUploader; store: AssetStore; tmpDir: string; log: (m: string) => void;
  character: SoulReference | null; budget: SpendBudget;
};
export type CutawayAssets = Record<string, { kind: "image" | "video"; asset: StoredAsset }>;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function cutawayPrompt(prompt: string, layout: "full" | "split"): string {
  return `${prompt.trim()}, vertical 9:16 photo, photorealistic, natural light, no text, no captions, no watermark${layout === "split" ? ", main subject centred in the middle of the frame" : ""}`;
}

type Job = { c: PlacedCutaway; prompt: string; self: boolean; video: boolean; imageHash: string; videoHash?: string; billSec: number; durationMs: number };

/**
 * Spec §4.4 for cutaways. Uploads come from the store; AI stills and clips are reserved against the approved estimate in
 * reel order (cached parts cost nothing), then generated in parallel (the Higgsfield gateway limits concurrency).
 * One attempt each: a failure is a note and the speaker stays on screen (no repeat paid calls).
 */
export async function generateCutaways(placed: PlacedCutaway[], plan: EditPlan, deps: CutawayGenDeps): Promise<{ assets: CutawayAssets; notes: string[] }> {
  await mkdir(deps.tmpDir, { recursive: true });
  const assets: CutawayAssets = {};
  const notes = new Map<string, string>();
  const jobs: Job[] = [];
  for (const c of placed) {
    const s = c.source;
    if (s.kind === "diagram") continue;
    if (s.kind === "upload") {
      const extra = plan.source.extras.find((e) => e.assetId === s.assetId);
      const asset = extra ? await deps.store.get(s.assetId) : null;
      if (!extra || !asset) notes.set(c.beatId, `The upload for the cutaway in ${c.beatId} is missing, so you stay on screen there.`);
      else assets[c.beatId] = { kind: extra.kind, asset };
      continue;
    }
    const self = s.kind === "ai_self";
    if (self && !deps.character) {
      notes.set(c.beatId, `The AI shot of you in ${c.beatId} was skipped: its character no longer exists.`);
      continue;
    }
    const prompt = cutawayPrompt(s.prompt, c.layout);
    const durationMs = Math.round((c.durationInFrames * 1000) / 30);
    const billSec = videoBillSeconds(durationMs / 1000);
    const imageHash = self ? footageHashes.selfImage(deps.image.model, prompt, deps.character!.referenceId, deps.character!.strength) : hashes.image(deps.image.model, prompt);
    const video = s.media === "video";
    const videoHash = video ? hashes.video(deps.video.model, deps.video.resolution, prompt, imageHash, billSec) : undefined;
    // Priced with the approval's table and models, so fake and real workers skip exactly what the estimate didn't cover.
    const stillUsd = cutawayCost({ ...s, media: "image" }, durationMs);
    const usd = ((await deps.store.get(imageHash)) ? 0 : stillUsd) + (videoHash && !(await deps.store.get(videoHash)) ? cutawayCost(s, durationMs) - stillUsd : 0);
    if (!takeBudget(deps.budget, usd)) {
      notes.set(c.beatId, `The cutaway in ${c.beatId} was skipped: it would cost more than the approved estimate. Use Edit as new version and approve again to update it.`);
      continue;
    }
    jobs.push({ c, prompt, self, video, imageHash, videoHash, billSec, durationMs });
  }
  await Promise.all(jobs.map(async (j) => {
    try {
      assets[j.c.beatId] = await makeOne(j, deps);
    } catch (err) {
      notes.set(j.c.beatId, `The cutaway in ${j.c.beatId} failed (${message(err)}), so you stay on screen there.`);
    }
  }));
  // Notes in reel order, whatever order the parallel jobs finished in.
  return { assets, notes: placed.flatMap((c) => (notes.has(c.beatId) ? [notes.get(c.beatId)!] : [])) };
}

/**
 * One paid AI still, cached under `hash`: a cached still costs nothing and is never generated again.
 * `file` is the download path without its extension (taken from the result URL).
 */
export async function makeStill(
  deps: Pick<CutawayGenDeps, "image" | "store" | "log">, hash: string, prompt: string, file: string, logLine: string, character?: SoulReference,
): Promise<StoredAsset> {
  return cached(deps.store, hash, async () => {
    deps.log(logLine);
    const res = await deps.image.generate({ prompt, resumeKey: hash, ...(character ? { character } : {}) });
    const ext = extFromUrl(res.url, "png");
    const path = `${file}.${ext}`;
    await downloadTo(res.url, path);
    return { path, ext, meta: { kind: "image", provider: deps.image.model.split("/")[0], model: deps.image.model, requestId: res.requestId, estUsd: estUsd(deps.image.model, "perImage", 1) } };
  });
}

async function makeOne(j: Job, deps: CutawayGenDeps): Promise<CutawayAssets[string]> {
  const beat = j.c.beatId;
  const tmp = (name: string) => join(deps.tmpDir, `${beat}-${name}`);
  const image = await makeStill(deps, j.imageHash, j.prompt, tmp("image"), `${beat}: generating ${j.self ? "an AI shot of you" : "a B-roll still"}`, j.self ? deps.character! : undefined);
  if (!j.video) return { kind: "image", asset: image };
  const raw = await cached(deps.store, j.videoHash!, async () => {
    deps.log(`${beat}: animating the still (${j.billSec} s)`);
    const imageUrl = await deps.uploader.upload(await readFile(image.path), contentTypeFor(image.fileName));
    const res = await deps.video.imageToVideo({ imageUrl, prompt: j.prompt, durationSec: j.billSec, resumeKey: j.videoHash });
    const file = tmp("raw.mp4");
    await downloadTo(res.url, file);
    return { path: file, ext: "mp4", meta: { kind: "video", provider: deps.video.model.split("/")[0], model: deps.video.model, requestId: res.requestId, estUsd: estUsd(deps.video.model, "perSecond", j.billSec) } };
  });
  const fitted = await cached(deps.store, footageHashes.cutawayFit(raw.hash, j.durationMs), async () => {
    const conformed = tmp("conformed.mp4");
    await conformVideo(raw.path, conformed);
    const out = tmp("fitted.mp4");
    await fitDuration(conformed, out, j.durationMs / 1000);
    return { path: out, ext: "mp4", meta: { kind: "video", provider: "ffmpeg", reproducible: true } };
  });
  return { kind: "video", asset: fitted };
}

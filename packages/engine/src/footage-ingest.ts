import { FaceTrackSchema, FOOTAGE_MAX_SEC_INGEST, formatMinSec, TranscriptSchema, type FaceTrack, type FootageSource, type PipelineEvent, type Transcript, type VoiceSegment } from "@reel/core";
import { inputHash } from "@reel/core/hash";
import { conformVideo, extractAudio, probe, sha256File } from "@reel/media";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type * as z from "zod";
import type { AssetStore, StoredAsset } from "./asset-store";
import type { FaceTracker } from "./face-tracker";
import { cached, estUsd } from "./pipeline";
import type { Transcriber } from "./providers/types";

/** A problem with the uploaded file itself; the message is shown to the user as is. */
export class FootageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FootageInputError";
  }
}

/** Cache keys. Every provider-made asset includes the provider's model id (fake vs real never mix). */
export const footageHashes = {
  working: (originalSha: string) => inputHash({ step: "footage-working", v: 1, originalSha }),
  transcript: (model: string, workingHash: string) => inputHash({ step: "transcript", v: 1, model, workingHash }),
  faces: (model: string, workingHash: string) => inputHash({ step: "faces", v: 1, model, workingHash }),
  voice: (workingHash: string, segments: VoiceSegment[]) => inputHash({ step: "footage-voice", v: 1, workingHash, segments }),
  musicFit: (trackSha: string, durationMs: number) => inputHash({ step: "music-fit", v: 1, trackSha, durationMs }),
  musicAi: (model: string, prompt: string, durationMs: number) => inputHash({ step: "music-ai", v: 1, model, prompt, durationMs }),
  sfx: (fileSha: string) => inputHash({ step: "sfx", v: 1, fileSha }),
  extra: (sha: string, kind: "image" | "video") => inputHash({ step: "footage-extra", v: 1, sha, kind }),
  selfImage: (model: string, prompt: string, referenceId: string, strength: number) => inputHash({ step: "self-image", v: 1, model, prompt, referenceId, strength }),
  cutawayFit: (rawHash: string, durationMs: number) => inputHash({ step: "cutaway-fit", v: 1, rawHash, durationMs }),
};

export type IngestDeps = { store: AssetStore; transcriber: Transcriber; faceTracker: FaceTracker; tmpDir: string; log: (m: string) => void; onEvent?: (e: PipelineEvent) => void };
export type FootageInputs = { working: StoredAsset; transcriptAsset: StoredAsset; transcript: Transcript; faceTrack: FaceTrack };

/** JSON payloads are stored with ext "data": the asset store keeps its own metadata in <hash>.json. */
const DATA_EXT = "data";

async function readJson<T>(asset: StoredAsset, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await readFile(asset.path, "utf8")));
}

/** Spec §4.2: probe, working copy, face track, transcript. Every step is a cached asset, so a retry skips finished work. */
export async function ingestFootage(originalPath: string, deps: IngestDeps): Promise<{ source: FootageSource; transcript: Transcript }> {
  const { store, log } = deps;
  const emit = (e: PipelineEvent) => deps.onEvent?.(e);
  await mkdir(deps.tmpDir, { recursive: true });
  const tmp = (name: string) => join(deps.tmpDir, name);

  emit({ type: "step", step: "conform", status: "running" });
  const info = await probe(originalPath).catch(() => {
    throw new FootageInputError("This file isn't a readable video. Upload an MP4 or MOV.");
  });
  if (!info.video) throw new FootageInputError("This file has no video track. Upload an MP4 or MOV video.");
  if (!info.audio) throw new FootageInputError("This video has no sound. Upload a video where you speak.");
  if (info.durationSec > FOOTAGE_MAX_SEC_INGEST) throw new FootageInputError(`This video is ${formatMinSec(info.durationSec)} long. Trim it to 3:00 or less and upload it again.`);
  const working = await workingCopy(store, originalPath, await sha256File(originalPath), deps.tmpDir, log);
  // The video stream's length, never the container's (audio can run longer): shots must not ask for frames past the last one.
  const workingInfo = await probe(working.path);
  const durationMs = Math.round((workingInfo.video?.durationSec ?? workingInfo.durationSec) * 1000);
  emit({ type: "step", step: "conform", status: "done" });

  // Faces first: it is free, so a worker without the face helper fails before the paid transcription.
  emit({ type: "step", step: "faces", status: "running" });
  const faces = await cached(store, footageHashes.faces(deps.faceTracker.model, working.hash), async () => {
    log("ingest: finding the face");
    const file = tmp("faces.json");
    // The working copy, never the original: rotation is already applied there and the helper ignores rotation metadata.
    await writeFile(file, JSON.stringify(FaceTrackSchema.parse(await deps.faceTracker.track(working.path))));
    return { path: file, ext: DATA_EXT, meta: { kind: "data", provider: "face-helper", model: deps.faceTracker.model } };
  });
  emit({ type: "step", step: "faces", status: "done" });

  emit({ type: "step", step: "transcribe", status: "running" });
  const model = deps.transcriber.model;
  const transcriptAsset = await cached(store, footageHashes.transcript(model, working.hash), async () => {
    log("ingest: transcribing");
    const wav = tmp("speech.wav");
    await extractAudio(working.path, wav);
    const { transcript, requestId } = await deps.transcriber.transcribe(wav);
    const file = tmp("transcript.json");
    await writeFile(file, JSON.stringify(TranscriptSchema.parse(transcript)));
    const real = model === "elevenlabs/scribe_v2";
    return { path: file, ext: DATA_EXT, meta: { kind: "data", provider: real ? "elevenlabs" : "fake", model, requestId, estUsd: real ? estUsd(model, "perSecond", durationMs / 1000) : undefined } };
  });
  const transcript = await readJson(transcriptAsset, TranscriptSchema);
  if (transcript.words.length < 5) throw new FootageInputError("No speech found. This editor needs a video of you talking.");
  emit({ type: "step", step: "transcribe", status: "done" });
  return { source: { assetId: working.hash, durationMs, transcriptAssetId: transcriptAsset.hash, faceTrackAssetId: faces.hash, extras: [] }, transcript };
}

/** The conformed 1080×1920 working copy, keyed by the original's hash (ffmpeg only, so remaking it is free). */
async function workingCopy(store: AssetStore, originalPath: string, originalSha: string, tmpDir: string, log: (m: string) => void): Promise<StoredAsset> {
  return cached(store, footageHashes.working(originalSha), async () => {
    log("ingest: making the 1080×1920 working copy");
    await mkdir(tmpDir, { recursive: true });
    const out = join(tmpDir, "working.mp4");
    await conformVideo(originalPath, out, { keepAudio: true });
    return { path: out, ext: "mp4", meta: { kind: "video", provider: "ffmpeg", reproducible: true, extra: { originalSha } } };
  });
}

/** Downloads the original upload into `destDir`; null when it is gone. */
export type OriginalFetch = (destDir: string) => Promise<string | null>;
/** How to re-make a working copy that is neither on this machine nor in storage (its mirror is best-effort). */
export type RemakeWorking = { original: OriginalFetch; tmpDir: string; log: (m: string) => void };

const MISSING = "The prepared video is missing from storage. Upload the video again.";

export async function loadFootageInputs(store: AssetStore, source: FootageSource, remake?: RemakeWorking): Promise<FootageInputs> {
  const [found, transcriptAsset, facesAsset] = await Promise.all([store.get(source.assetId), store.get(source.transcriptAssetId), store.get(source.faceTrackAssetId)]);
  if (!transcriptAsset || !facesAsset) throw new Error(MISSING);
  const working = found ?? (remake ? await remakeWorking(store, source.assetId, remake) : null);
  if (!working) throw new Error(MISSING);
  return { working, transcriptAsset, transcript: await readJson(transcriptAsset, TranscriptSchema), faceTrack: await readJson(facesAsset, FaceTrackSchema) };
}

async function remakeWorking(store: AssetStore, assetId: string, remake: RemakeWorking): Promise<StoredAsset | null> {
  await mkdir(remake.tmpDir, { recursive: true });
  const original = await remake.original(remake.tmpDir);
  if (!original) return null;
  const originalSha = await sha256File(original);
  // Only the exact upload this plan was made from conforms to the same working copy.
  if (footageHashes.working(originalSha) !== assetId) {
    remake.log(`working copy ${assetId} is missing and the stored upload no longer matches it`);
    return null;
  }
  remake.log("the working copy is missing here and in storage: re-making it from the original upload");
  return workingCopy(store, original, originalSha, remake.tmpDir, remake.log);
}

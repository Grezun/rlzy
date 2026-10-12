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
};

export type IngestDeps = { store: AssetStore; transcriber: Transcriber; faceTracker: FaceTracker; tmpDir: string; log: (m: string) => void; onEvent?: (e: PipelineEvent) => void };
export type FootageInputs = { working: StoredAsset; transcriptAsset: StoredAsset; transcript: Transcript; faceTrack: FaceTrack };

/** JSON payloads are stored with ext "data": the asset store keeps its own metadata in <hash>.json. */
const DATA_EXT = "data";

async function readJson<T>(asset: StoredAsset, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await readFile(asset.path, "utf8")));
}

/** Spec §4.2: probe, working copy, transcript, face track. Every step is a cached asset, so a retry skips finished work. */
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
  const originalSha = await sha256File(originalPath);
  const working = await cached(store, footageHashes.working(originalSha), async () => {
    log("ingest: making the 1080×1920 working copy");
    const out = tmp("working.mp4");
    await conformVideo(originalPath, out, { keepAudio: true });
    return { path: out, ext: "mp4", meta: { kind: "video", provider: "ffmpeg", extra: { originalSha } } };
  });
  const durationMs = Math.round((await probe(working.path)).durationSec * 1000);
  emit({ type: "step", step: "conform", status: "done" });

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

  emit({ type: "step", step: "faces", status: "running" });
  const faces = await cached(store, footageHashes.faces(deps.faceTracker.model, working.hash), async () => {
    log("ingest: finding the face");
    const file = tmp("faces.json");
    // The working copy, never the original: rotation is already applied there and the helper ignores rotation metadata.
    await writeFile(file, JSON.stringify(FaceTrackSchema.parse(await deps.faceTracker.track(working.path))));
    return { path: file, ext: DATA_EXT, meta: { kind: "data", provider: "face-helper", model: deps.faceTracker.model } };
  });
  emit({ type: "step", step: "faces", status: "done" });
  return { source: { assetId: working.hash, durationMs, transcriptAssetId: transcriptAsset.hash, faceTrackAssetId: faces.hash }, transcript };
}

export async function loadFootageInputs(store: AssetStore, source: FootageSource): Promise<FootageInputs> {
  const [working, transcriptAsset, facesAsset] = await Promise.all([store.get(source.assetId), store.get(source.transcriptAssetId), store.get(source.faceTrackAssetId)]);
  if (!working || !transcriptAsset || !facesAsset) throw new Error("The prepared video is missing from storage. Upload the video again.");
  return { working, transcriptAsset, transcript: await readJson(transcriptAsset, TranscriptSchema), faceTrack: await readJson(facesAsset, FaceTrackSchema) };
}

import { compileFootage, estimateFootageCost, estimateReelSeconds, musicBillSeconds, planCallouts, planCutaways, SFX_NAMES, type EditPlan, type EditStyle, type PipelineEvent, type SfxName, type Timeline } from "@reel/core";
import { concatAudioSegments, fitMusic, makeSfxPlaceholders, normalizeLoudness, sha256File, SOCIAL_LOUDNESS } from "@reel/media";
import { missingSfx, SFX_DIR, sfxFileIn } from "@reel/video/sfx";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { AssetStore, StoredAsset } from "./asset-store";
import { generateCutaways, makeBudget, takeBudget, type CutawayAssets } from "./footage-cutaways";
import { footageHashes, loadFootageInputs, type FootageInputs, type OriginalFetch } from "./footage-ingest";
import { cached, estUsd, renderTimeline, type RenderOutputs } from "./pipeline";
import type { ImageGen, MediaUploader, MusicGen, SoulReference, VideoGen } from "./providers/types";
import { serveDir } from "./serve";

export type LibraryFetch = (trackId: string, destDir: string) => Promise<string | null>;
export type FootageGenDeps = {
  music: MusicGen;
  image: ImageGen;
  video: VideoGen;
  uploader: MediaUploader;
  /** The plan's Soul ID character, or null when it has none or it was deleted (its AI shots of you are skipped). */
  character: SoulReference | null;
  store: AssetStore;
  tmpDir: string;
  log: (m: string) => void;
  onEvent?: (e: PipelineEvent) => void;
  library: LibraryFetch;
  sfxDir: string | null;
  style: EditStyle;
  /** The original upload, to re-make a working copy that was lost (free: ffmpeg only). */
  original?: OriginalFetch;
};
export type FootageGenerated = { inputs: FootageInputs; voice: StoredAsset; music?: StoredAsset; sfx: Partial<Record<SfxName, StoredAsset>>; cutaways: CutawayAssets; notes: string[] };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Spec §4.4: cut voice, music (library, AI or none), cutaways, sound effects. A failed optional element is a note, never a failure.
 * Every paid element is reserved against the approved estimate before it is paid; one that doesn't fit is skipped with a note.
 */
export async function generateFootageAssets(plan: EditPlan, deps: FootageGenDeps): Promise<FootageGenerated> {
  const { store, log } = deps;
  const emit = (e: PipelineEvent) => deps.onEvent?.(e);
  await mkdir(deps.tmpDir, { recursive: true });
  const tmp = (name: string) => join(deps.tmpDir, name);
  const inputs = await loadFootageInputs(store, plan.source, deps.original && { original: deps.original, tmpDir: deps.tmpDir, log });
  const draft = compileFootage(plan, inputs.transcript, inputs.faceTrack, { videoSrc: "draft", sfx: {} }, deps.style);
  const notes: string[] = [];
  const budget = makeBudget(plan.estimate.credits);

  emit({ type: "step", step: "voice", status: "running" });
  const voice = await cached(store, footageHashes.voice(inputs.working.hash, draft.voiceSegments), async () => {
    log(`voice: cutting ${draft.voiceSegments.length} segments`);
    const cut = tmp("voice-cut.wav");
    await concatAudioSegments(inputs.working.path, draft.voiceSegments, cut);
    const out = tmp("voice.wav");
    await normalizeLoudness(cut, out, SOCIAL_LOUDNESS);
    return { path: out, ext: "wav", meta: { kind: "audio", provider: "ffmpeg" } };
  });
  emit({ type: "step", step: "voice", status: "done" });

  emit({ type: "step", step: "music", status: "running" });
  const durationSec = draft.durationMs / 1000;
  // The one billing rule (same as the approval estimate): whole seconds, rounded up.
  const billSec = estimateReelSeconds(draft.durationMs);
  const fitted = async (file: string, trackSha: string) =>
    cached(store, footageHashes.musicFit(trackSha, Math.round(draft.durationMs)), async () => {
      const fit = tmp("music-fit.wav");
      await fitMusic(file, fit, durationSec);
      const out = tmp("music.wav");
      await normalizeLoudness(fit, out, SOCIAL_LOUDNESS);
      return { path: out, ext: "wav", meta: { kind: "audio", provider: "ffmpeg" } };
    });
  let music: StoredAsset | undefined;
  if (plan.music.kind === "library") {
    try {
      const file = await deps.library(plan.music.assetId, deps.tmpDir);
      if (!file) notes.push("The library track was removed, so the reel has no music.");
      else music = await fitted(file, await sha256File(file));
    } catch (err) {
      notes.push(`Library music failed (${message(err)}), so the reel has no music.`);
    }
  } else if (plan.music.kind === "ai") {
    const prompt = plan.music.prompt;
    if (!takeBudget(budget, estimateFootageCost(plan, billSec))) {
      notes.push("AI music was skipped: it would cost more than the approved estimate. Use Edit as new version and approve again to update it.");
    } else {
      // Exactly one paid generation per job: the approved estimate covers one track, and a failure after the provider
      // accepted the request (e.g. mid-download) may already be billed. A failure skips music; the reel still renders.
      try {
        const raw = await cached(store, footageHashes.musicAi(deps.music.model, prompt, Math.round(draft.durationMs)), async () => {
          log("music: composing");
          const res = await deps.music.compose({ prompt, durationMs: draft.durationMs });
          const file = tmp(`music-ai.${res.ext}`);
          await writeFile(file, res.audio);
          return { path: file, ext: res.ext, meta: { kind: "audio", provider: deps.music.model.split("/")[0], model: deps.music.model, estUsd: estUsd(deps.music.model, "perSecond", musicBillSeconds(billSec)) } };
        });
        music = await fitted(raw.path, raw.hash);
      } catch (err) {
        notes.push(`AI music failed (${message(err)}), so the reel has no music.`);
      }
    }
  }
  emit({ type: "step", step: "music", status: "done" });

  emit({ type: "step", step: "visuals", status: "running" });
  const { placed, warnings: placementNotes } = planCutaways(plan, inputs.transcript.words, deps.style);
  // Spec §5.5: every trim or drop is also a generation note (the review page showed the same lines before approval).
  notes.push(...placementNotes, ...planCallouts(plan, inputs.transcript.words, deps.style).warnings);
  const cut = await generateCutaways(placed, plan, { image: deps.image, video: deps.video, uploader: deps.uploader, store, tmpDir: join(deps.tmpDir, "cutaways"), log, character: deps.character, budget });
  notes.push(...cut.notes);
  // Callouts with no room beside the face: needs the face track and the cutaways that were actually made.
  const made = Object.fromEntries(Object.entries(cut.assets).map(([id, c]) => [id, { kind: c.kind, src: "draft" }]));
  notes.push(...compileFootage(plan, inputs.transcript, inputs.faceTrack, { videoSrc: "draft", sfx: {}, cutaways: made }, deps.style).notes);
  emit({ type: "step", step: "visuals", status: "done" });

  const sfx: Partial<Record<SfxName, StoredAsset>> = {};
  if (plan.sfx !== "off") {
    if (!deps.sfxDir) notes.push("Sound effects aren't installed on this worker yet, so the reel has none.");
    else {
      for (const name of SFX_NAMES) {
        const file = sfxFileIn(deps.sfxDir, name);
        if (!file) continue;
        // putFile copies, so handing it the pack file itself is safe.
        sfx[name] = await cached(store, footageHashes.sfx(await sha256File(file)), async () => ({ path: file, ext: extname(file).slice(1), meta: { kind: "audio", provider: "sfx-pack" } }));
      }
    }
  }
  for (const n of notes) emit({ type: "note", message: n });
  return { inputs, voice, music, sfx, cutaways: cut.assets, notes };
}

/** The footage Timeline for this plan + generated assets, with each asset file mapped through `urlFor`. */
export function buildFootageTimeline(plan: EditPlan, gen: FootageGenerated, urlFor: (fileName: string) => string, style: EditStyle): Timeline {
  const sfx = Object.fromEntries(Object.entries(gen.sfx).map(([name, a]) => [name, urlFor(a!.fileName)]));
  return compileFootage(plan, gen.inputs.transcript, gen.inputs.faceTrack, {
    videoSrc: urlFor(gen.inputs.working.fileName),
    voiceSrc: urlFor(gen.voice.fileName),
    ...(gen.music ? { musicSrc: urlFor(gen.music.fileName) } : {}),
    sfx,
    cutaways: Object.fromEntries(Object.entries(gen.cutaways).map(([id, c]) => [id, { kind: c.kind, src: urlFor(c.asset.fileName) }])),
  }, style).timeline;
}

export async function renderFootage(
  plan: EditPlan,
  gen: FootageGenerated,
  deps: Pick<FootageGenDeps, "store" | "log" | "onEvent" | "style">,
  outDir: string,
  onProgress?: (p: number) => void,
): Promise<RenderOutputs> {
  await mkdir(outDir, { recursive: true });
  const server = await serveDir(deps.store.root);
  try {
    return await renderTimeline(buildFootageTimeline(plan, gen, server.urlFor, deps.style), deps, outDir, onProgress);
  } finally {
    await server.close();
  }
}

/** Real workers use the committed pack (or none, with a note); fake workers fall back to placeholder blips. */
export async function resolveSfxDir(mode: "real" | "fake", cacheDir: string): Promise<string | null> {
  if (missingSfx(SFX_DIR).length === 0) return SFX_DIR;
  if (mode === "real") return null;
  const dir = join(cacheDir, "sfx-placeholders");
  if (missingSfx(dir).length) await makeSfxPlaceholders(dir, SFX_NAMES);
  return dir;
}

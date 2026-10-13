import { backgroundCost, backgroundStarts, type EditPlan, type EditStyle } from "@reel/core";
import { compositeSpeakerPlate } from "@reel/media";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AssetStore, StoredAsset } from "./asset-store";
import { makeStill, takeBudget, type SpendBudget } from "./footage-cutaways";
import { footageHashes, type FootageInputs } from "./footage-ingest";
import { cached } from "./pipeline";
import type { ImageGen } from "./providers/types";

export type BackgroundDeps = { image: ImageGen; store: AssetStore; tmpDir: string; log: (m: string) => void; budget: SpendBudget; style: EditStyle };

const KEEP = "so the reel uses your real background";
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The scene the user or Claude described, as an empty place with room for the speaker (spec §12). */
export function backgroundPrompt(prompt: string): string {
  return `${prompt.trim()}, an empty place with no people, vertical 9:16 photo, photorealistic, eye-level view, open space in the centre for a person standing in front, soft natural light, shallow depth of field, no text, no captions, no logos, no watermark`;
}

/**
 * Spec §4.4 step 2. For a "replace" plan: check the cut-out, reserve and make each AI still (one attempt, cached), then
 * composite the speaker plate. Any problem is a note and the reel keeps its real background.
 * - The cut-out is checked before anything is paid.
 * - A still that the approved estimate can't cover is skipped.
 * - A finished still stays cached, so a retry after a compositing failure is free.
 */
export async function makeSpeakerPlate(plan: EditPlan, inputs: FootageInputs, deps: BackgroundDeps): Promise<{ plate?: StoredAsset; notes: string[] }> {
  const bg = plan.background;
  if (bg.mode !== "replace") return { notes: [] };
  const matte = plan.source.matteAssetId ? await deps.store.get(plan.source.matteAssetId) : null;
  if (!matte) return { notes: [`The cut-out of you is missing, ${KEEP}. Upload the video again to replace the background.`] };
  await mkdir(deps.tmpDir, { recursive: true });
  const starts = backgroundStarts(plan, inputs.transcript.words, deps.style.padMs);
  const stills: { image: StoredAsset; fromMs: number }[] = [];
  for (const [i, section] of bg.sections.entries()) {
    const s = section.source;
    if (s.kind !== "ai") return { notes: [`Brand backdrops aren't available yet, ${KEEP}.`] };
    const prompt = backgroundPrompt(s.prompt);
    const hash = footageHashes.background(deps.image.model, prompt);
    const usd = (await deps.store.get(hash)) ? 0 : backgroundCost({ mode: "replace", sections: [section] });
    if (!takeBudget(deps.budget, usd)) {
      return { notes: [`The AI background was skipped: it would cost more than the approved estimate, ${KEEP}. Use Edit as new version and approve again to update it.`] };
    }
    try {
      const image = await makeStill(deps, hash, prompt, join(deps.tmpDir, `scene-${i + 1}`), "background: generating the AI scene");
      stills.push({ image, fromMs: starts[i] ?? 0 });
    } catch (err) {
      return { notes: [`The AI background failed (${message(err)}), ${KEEP}.`] };
    }
  }
  try {
    const key = footageHashes.plate(inputs.working.hash, matte.hash, stills.map((s) => ({ imageHash: s.image.hash, fromMs: s.fromMs })), deps.style.background);
    const plate = await cached(deps.store, key, async () => {
      deps.log("background: compositing you over the scene");
      const out = join(deps.tmpDir, "plate.mp4");
      await compositeSpeakerPlate({
        video: inputs.working.path, matte: matte.path, out, look: deps.style.background, tmpDir: join(deps.tmpDir, "backdrops"),
        backgrounds: stills.map((s) => ({ image: s.image.path, fromMs: s.fromMs })),
      });
      return { path: out, ext: "mp4", meta: { kind: "video", provider: "ffmpeg", reproducible: true } };
    });
    return { plate, notes: [] };
  } catch (err) {
    return { notes: [`Your background couldn't be replaced (${message(err).split("\n")[0]}), ${KEEP}.`] };
  }
}

import type { Handlers } from "../loop";
import { FAKE_VOICE_ID } from "../fake-voice";
import { createIngestFootageHandler, createPlanFootageHandler, type FootageHandlerDeps } from "./footage";
import { createGenerateHandler, type GenerateHandlerDeps } from "./generate";
import { createGenerateFootageHandler } from "./generate-footage";
import { createPlanHandler, type PlanHandlerDeps } from "./plan";

export type BuildHandlersDeps = {
  mode: "real" | "fake";
  planner: PlanHandlerDeps["planner"];
  providers: GenerateHandlerDeps["providers"];
  store: GenerateHandlerDeps["store"];
  blobs: GenerateHandlerDeps["blobs"];
  db: GenerateHandlerDeps["db"];
  voices: PlanHandlerDeps["voices"];
  voiceModelId: string;
  spendCapUsd: number;
  costModels: GenerateHandlerDeps["costModels"];
  transcriber: FootageHandlerDeps["transcriber"];
  faceTracker: FootageHandlerDeps["faceTracker"];
  footagePlanner: FootageHandlerDeps["footagePlanner"];
  /** Sound-effect pack directory, or null when this worker has none (reels render without them, with a note). */
  sfxDir: string | null;
};

/** Fake workers only plan and generate with the fake voice; real workers refuse storyboards that use it. */
export function buildHandlers(deps: BuildHandlersDeps): Handlers {
  const fake = deps.mode === "fake";
  const footage: FootageHandlerDeps = {
    store: deps.store, blobs: deps.blobs, db: deps.db, transcriber: deps.transcriber, faceTracker: deps.faceTracker, footagePlanner: deps.footagePlanner,
  };
  return {
    plan: createPlanHandler({
      planner: deps.planner, db: deps.db, voices: deps.voices, voiceModelId: deps.voiceModelId,
      ...(fake ? { forceVoiceId: FAKE_VOICE_ID } : {}),
    }),
    generate: createGenerateHandler({
      providers: deps.providers, store: deps.store, blobs: deps.blobs, db: deps.db,
      spendCapUsd: deps.spendCapUsd, costModels: deps.costModels,
      ...(fake ? { requireVoiceId: FAKE_VOICE_ID } : { forbidVoiceId: FAKE_VOICE_ID }),
    }),
    ingest_footage: createIngestFootageHandler(footage),
    plan_footage: createPlanFootageHandler(footage),
    // Same models as ingest: a plan built on another worker's transcript or face track (fake vs real) is refused before any spend.
    generate_footage: createGenerateFootageHandler({
      music: deps.providers.music, image: deps.providers.image, video: deps.providers.video, uploader: deps.providers.uploader,
      store: deps.store, blobs: deps.blobs, db: deps.db, sfxDir: deps.sfxDir, spendCapUsd: deps.spendCapUsd,
      inputModels: { transcriber: deps.transcriber.model, faceTracker: deps.faceTracker.model },
    }),
  };
}

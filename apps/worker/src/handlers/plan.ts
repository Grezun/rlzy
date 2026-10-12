import { PlanJobPayloadSchema } from "@reel/db";
import type { PlanRequest, Planner } from "@reel/engine";
import { checkStyleInput, fillTemplate, getStyle } from "@reel/styles";
import { readPrompt } from "@reel/styles/load";
import type { JobHandler } from "../loop";
import type { ReelDb } from "../reel-db";

export type PlanHandlerDeps = {
  planner: Planner;
  db: ReelDb;
  voices: { he?: string; en?: string };
  voiceModelId: string;
  /** Fake mode: always use this voice id so fake audio never shares a cache key with a real voice. */
  forceVoiceId?: string;
};

export function createPlanHandler(deps: PlanHandlerDeps): JobHandler {
  return async (job) => {
    try {
      const form = PlanJobPayloadSchema.parse(job.payload);
      const voiceId = deps.forceVoiceId ?? form.voiceId ?? deps.voices[form.language];
      if (!voiceId) {
        throw new Error(`No voice for ${form.language}: set ELEVENLABS_VOICE_${form.language.toUpperCase()} in the worker's .env.local or enter a voice id`);
      }
      let style: PlanRequest["style"];
      if (form.style) {
        const def = getStyle(form.style.id);
        if (!def || def.status !== "available" || def.id === "custom") throw new Error(`Style "${form.style.id}" is not available`);
        const checked = checkStyleInput(def, form.style.values);
        if (checked.errors.length) throw new Error(`Style form is incomplete: ${checked.errors.join("; ")}`);
        const script = form.style.script?.trim() || undefined;
        const voiceDescription = form.voiceId ? `ElevenLabs voice ${form.voiceId}` : `the team ${form.language === "he" ? "Hebrew" : "English"} voice`;
        const brief = fillTemplate(readPrompt(def.id), def, {
          values: checked.values, script, language: form.language, durationSec: form.targetDurationSec,
          accentColor: form.palette[0], voiceDescription,
        });
        style = { name: def.name, brief, engineNotes: def.engineNotes, ...(script ? { script } : {}) };
      }
      const planned = await deps.planner.plan({
        brief: form.brief,
        language: form.language,
        targetDurationSec: form.targetDurationSec,
        pacing: form.pacing,
        captionPreset: form.captionPreset,
        palette: form.palette,
        voice: { voiceId, modelId: deps.voiceModelId },
        ...(style ? { style } : {}),
      });
      const version = await deps.db.nextStoryboardVersion(job.project_id);
      const storyboard = { ...planned, version };
      await deps.db.insertStoryboard({ projectId: job.project_id, version, json: storyboard, createdBy: "agent" });
      await deps.db.setProjectStatus(job.project_id, "draft", storyboard.title);
      return { status: "done" };
    } catch (err) {
      await deps.db.setProjectStatus(job.project_id, "failed").catch(() => {});
      throw err;
    }
  };
}

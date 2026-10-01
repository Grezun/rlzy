import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { lengthIssues, maxScenesFor, parseStoryboard, normalizeScript, scriptMatches, StoryboardDraftSchema, targetWordsFor, type Storyboard, type StoryboardDraft } from "@reel/core";
import type { PlanRequest, Planner } from "./providers/types";

export type DraftModel = (req: { system: string; user: string }) => Promise<{
  stopReason: string | null;
  draft: StoryboardDraft | null;
  raw: string;
}>;

export class PlannerRefusedError extends Error {
  constructor() {
    super("Claude declined to write this storyboard. Rephrase the brief and try again.");
    this.name = "PlannerRefusedError";
  }
}

export class ScriptMismatchError extends Error {
  constructor(readonly diff: string) {
    super("Couldn't split your script without changing words. Try shorter sentences or break it into paragraphs.");
    this.name = "ScriptMismatchError";
  }
}

export function claudeDraftModel(client: Anthropic, model: string): DraftModel {
  return async ({ system, user }) => {
    const res = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      // On a safety decline, the API re-runs the request on a fallback model inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: betaZodOutputFormat(StoryboardDraftSchema) },
      system,
      messages: [{ role: "user", content: user }],
    });
    const raw = res.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    return { stopReason: res.stop_reason, draft: res.parsed_output ?? null, raw };
  };
}

export function systemPrompt(opts: { style?: boolean } = {}): string {
  const base = [
    "You write storyboards for short vertical social videos (Instagram Reels, TikTok, YouTube Shorts).",
    "A storyboard is a list of scenes. Each scene has the voiceover line spoken during it, one visual, optional on-screen text overlays, and the transition into the next scene.",
    "",
    "What makes a strong reel:",
    "- Scene 1 is the hook: a bold claim, question, or surprising number within the first 2 seconds. No greetings or channel intros.",
    "- One idea per scene. Voiceover lines are short, spoken, conversational sentences, not written prose.",
    "- End with a clear payoff or call to action.",
    "",
    "Visuals:",
    '- kind "image": a still the editor animates with a slow camera move; set motion to zoom_in, zoom_out, pan_left or pan_right.',
    '- kind "broll_video": a moving shot for action and atmosphere. It costs more, so use it for at most half of the scenes.',
    '- kind "graphic": a plain branded background for text-heavy moments (lists, numbers); put the key text in an overlay and leave prompt empty.',
    "- Write every visual prompt in English, even for Hebrew reels, as a concrete photographic description: subject, setting, lighting, camera angle, vertical 9:16 framing. Never ask for text, captions, logos or watermarks inside the image.",
    "",
    "Overlays: at most 2 per scene, each under 6 words, in the reel's language. Voiceover captions are added automatically, so overlays must not repeat the voiceover.",
    'Transitions: mostly "cut"; use "whip" or "zoom" for energy and "fade" for calm moments.',
  ];
  if (!opts.style) return base.join("\n");
  return [
    ...base,
    "",
    "Style reels: the user message contains a style brief written for a full production team. Follow its structure, pacing and tone, but this renderer can only do: AI images, AI b-roll video, plain graphic backgrounds, up to 2 text overlays per scene, automatic voiceover captions, and transitions.",
    "Ignore requests for music, sound effects, split-screen, lip-sync, subtitle files or supplied assets, and never claim to provide them.",
    "Never invent quotes, numbers, results, certifications or testimonials that are not in the brief.",
    "Write labels and overlays in the reel's language: if the brief names a Hebrew label and the reel is English, use its English equivalent.",
  ].join("\n");
}

function exactScriptOf(req: PlanRequest): string | undefined {
  const script = req.style?.script?.trim();
  return script ? script : undefined;
}

function exactSceneCap(req: PlanRequest, script: string): number {
  return Math.max(maxScenesFor(req.targetDurationSec), Math.ceil(normalizeScript(script).length / 350));
}

export function userPrompt(req: PlanRequest): string {
  const words = targetWordsFor(req.targetDurationSec, req.language);
  const scenes = Math.max(3, Math.round(req.targetDurationSec / (req.pacing === "punchy" ? 3 : 5)));
  const exactScript = exactScriptOf(req);
  const head = req.style
    ? ["Style brief (follow its structure, pacing and tone):", req.style.brief, "", "Engine notes:", ...req.style.engineNotes.map((n) => `- ${n}`), ""]
    : [`Brief: ${req.brief}`];
  const tail = !req.style
    ? []
    : exactScript
      ? ["Exact script mode: the voiceover must be exactly the script below, split into scenes at natural pauses. Do not add, remove, reorder or change any word or punctuation mark. Only choose where each scene starts.\nScript:\n" + req.style.script]
      : ["No script was provided: write the voiceover yourself following the style brief."];
  const lengthLines = exactScript
    ? [
        `Target length: ${req.targetDurationSec} seconds (the script decides the actual length).`,
        `Use at most ${exactSceneCap(req, exactScript)} scenes, each under 400 characters of voiceover; split long sentences at commas if needed.`,
      ]
    : [
        `Target length: ${req.targetDurationSec} seconds, about ${words} spoken words in total, about ${scenes} scenes.`,
        `Stay within ${maxScenesFor(req.targetDurationSec)} scenes and about ${targetWordsFor(req.targetDurationSec, req.language)} spoken words in total.`,
      ];
  return [
    ...head,
    `Language of the voiceover and overlays: ${req.language === "he" ? "Hebrew" : "English"}.`,
    ...lengthLines,
    `Pacing: ${req.pacing}.`,
    ...(exactScript ? [] : ["Keep each scene's voiceover under 400 characters."]),
    ...tail,
  ].join("\n");
}

export function buildStoryboard(draft: StoryboardDraft, req: PlanRequest): Storyboard {
  return parseStoryboard({
    version: 1,
    title: draft.title,
    language: req.language,
    format: "faceless",
    aspect: "9:16",
    targetDurationSec: req.targetDurationSec,
    voice: req.voice,
    style: { captionPreset: req.captionPreset, font: "Heebo", palette: req.palette, pacing: req.pacing },
    scenes: draft.scenes.map((scene, i) => ({
      id: `s${i + 1}`,
      script: scene.script,
      visual: { kind: scene.visual.kind, prompt: scene.visual.prompt.trim() || undefined, motion: scene.visual.motion },
      overlays: scene.overlays.slice(0, 2),
      transitionOut: scene.transitionOut,
    })),
  });
}

type Attempt =
  | { ok: true; storyboard: Storyboard }
  | { ok: false; error: string; storyboard?: Storyboard; mismatch?: boolean };

function attempt(result: Awaited<ReturnType<DraftModel>>, req: PlanRequest): Attempt {
  if (result.stopReason === "refusal") throw new PlannerRefusedError();
  if (!result.draft) return { ok: false, error: "The output did not match the storyboard schema." };
  let storyboard: Storyboard;
  const exact = exactScriptOf(req);
  try {
    storyboard = buildStoryboard(result.draft, req);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), ...(exact ? { mismatch: true } : {}) };
  }
  if (exact) {
    const match = scriptMatches(exact, storyboard.scenes.map((s) => s.script));
    if (!match.ok) return { ok: false, error: match.diff, mismatch: true };
    const max = exactSceneCap(req, exact);
    return storyboard.scenes.length > max
      ? { ok: false, error: `Use at most ${max} scenes (you wrote ${storyboard.scenes.length}). Merge neighbouring scenes; keep every word.`, storyboard }
      : { ok: true, storyboard };
  }
  const issues = lengthIssues(storyboard);
  return issues.length ? { ok: false, error: issues.join("\n"), storyboard } : { ok: true, storyboard };
}

export function createPlanner(model: DraftModel): Planner {
  return {
    async plan(req) {
      const system = systemPrompt({ style: Boolean(req.style) });
      const user = userPrompt(req);
      const first = await model({ system, user });
      const firstAttempt = attempt(first, req);
      if (firstAttempt.ok) return firstAttempt.storyboard;

      const repairUser = [
        user,
        "",
        "Your previous storyboard was rejected:",
        firstAttempt.error,
        "",
        "Previous output:",
        first.raw,
        "",
        "Return a corrected storyboard.",
      ].join("\n");
      const second = attempt(await model({ system, user: repairUser }), req);
      if (second.ok) return second.storyboard;
      // Valid but still over length: return it — the editor shows the length warning.
      const fallback = second.storyboard ?? firstAttempt.storyboard;
      if (fallback) return fallback;
      if (second.mismatch || firstAttempt.mismatch) throw new ScriptMismatchError(second.mismatch ? second.error : firstAttempt.error);
      throw new Error(`Claude returned an invalid storyboard twice:\n${second.error}`);
    },
  };
}

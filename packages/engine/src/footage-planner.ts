import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  EditPlanDraftSchema, LENGTH_TOLERANCE, parseEditPlan, splitBeats, withFootageEstimate,
  type BeatSpan, type EditPlan, type EditPlanDraft, type EditStyle, type FootageSettings, type FootageSource, type MusicMood, type Transcript,
} from "@reel/core";

export type LibraryTrack = { id: string; title: string; mood: MusicMood; durationSec: number };
export type FootagePlanRequest = {
  settings: FootageSettings;
  source: FootageSource;
  transcript: Transcript;
  library: LibraryTrack[];
  warnings: string[];
  instruction?: string;
  previous?: EditPlan;
};
export interface FootagePlanner {
  plan(req: FootagePlanRequest): Promise<EditPlan>;
}
export type EditDraftModel = (req: { system: string; user: string }) => Promise<{ stopReason: string | null; draft: EditPlanDraft | null; raw: string }>;

export class FootagePlannerRefusedError extends Error {
  constructor() {
    super("Claude declined to plan this edit. Check the video's content, then use Re-plan.");
    this.name = "FootagePlannerRefusedError";
  }
}

export function claudeEditDraftModel(client: Anthropic, model: string): EditDraftModel {
  return async ({ system, user }) => {
    const res = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: betaZodOutputFormat(EditPlanDraftSchema) },
      system,
      messages: [{ role: "user", content: user }],
    });
    const raw = res.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    return { stopReason: res.stop_reason, draft: res.parsed_output ?? null, raw };
  };
}

export function footageSystemPrompt(): string {
  return [
    "You edit short vertical talking-head reels (Instagram Reels, TikTok) in the style of top creators.",
    "The user filmed themselves talking. Code has already split the transcript into beats (sentences). You decide what stays, and you design the hook and the ending. Code does all micro-editing (pause cuts, zooms, caption timing, audio levels): never describe it.",
    "",
    "House style:",
    "- Tight: drop retakes, false starts, repeated sentences, greetings and weak tangents. When a sentence was said twice, keep the better (usually the later) take.",
    "- Fit the target length: if the talk is longer, drop the weakest beats, never the main point.",
    "- The hook is the first 3 seconds. Combine:",
    "  - coldOpenBeatId: the single most surprising or valuable line, played first and not repeated later. Empty when the first kept beat already hooks.",
    "  - headlineSmall + headlineBig: a small white line (at most 5 words) and a huge yellow word or two (at most 12 characters), in the reel's language. Both empty for no headline.",
    '  - patternBreak: "zoom_hit" (a fast punch-in), "flash" (two white frames) or "none".',
    "  - reason: one sentence explaining the hook, shown to the user.",
    "- emphasisWordIdx: in about one beat in three, the index of its single most important word (shown in red). -1 for none.",
    "- emoji: rarely; 👆 or 👇 when the speaker points, or one emoji that fits the line. Empty otherwise.",
    '- ending: "cta" when there is a comment keyword (the user gave one, or the speaker asks viewers to comment a word: put that word in keyword); "loop" when the last line can flow back into the first; otherwise "none".',
    '- music: a library track whose mood fits (kind "library", trackId); "ai" with a short English instrumental prompt (genre, mood, tempo) only when no library track fits; "none" for serious or emotional talks.',
    '- sfx: "subtle" by default, "lively" for energetic tips, "off" for serious topics.',
    "- dropReason: for every dropped beat, a short English reason (\"retake of b4\", \"false start\", \"tangent\").",
    "- Return every beat id exactly once, in the given order.",
  ].join("\n");
}

const sec = (ms: number) => (ms / 1000).toFixed(1);
const LANGUAGE = { he: "Hebrew", en: "English" } as const;

export function footageUserPrompt(req: FootagePlanRequest, beats: BeatSpan[]): string {
  const w = req.transcript.words;
  const speechMs = beats.reduce((s, b) => s + (w[b.endWordIdx].endMs - w[b.startWordIdx].startMs), 0);
  const lines = [
    `Reel language: ${LANGUAGE[req.settings.language]}. Target length: ${req.settings.targetDurationSec} seconds. The talk has ${sec(speechMs)} s of speech in ${beats.length} beats.`,
    req.settings.ctaKeyword
      ? `Comment keyword from the user: "${req.settings.ctaKeyword}" (use ending "cta").`
      : 'No comment keyword was given: use "cta" only if the speaker asks viewers to comment a specific word, and put that word in ending.keyword.',
    ...(req.settings.notes ? [`Notes from the user: ${req.settings.notes}`] : []),
    "Cutaways, B-roll and background replacement are not available in this version: never mention them.",
    req.library.length ? "Music library:" : "Music library: empty.",
    ...req.library.map((t) => `- ${t.id} "${t.title}" (${t.mood}, ${Math.round(t.durationSec)} s)`),
    "",
    "Beats (id, length, then every word as index:word):",
    ...beats.map((b) => `${b.id} (${sec(w[b.endWordIdx].endMs - w[b.startWordIdx].startMs)} s): ${w.slice(b.startWordIdx, b.endWordIdx + 1).map((x, i) => `${b.startWordIdx + i}:${x.text}`).join(" ")}`),
  ];
  if (req.previous) {
    const p = req.previous;
    const kept = p.beats.filter((b) => b.keep).map((b) => b.id).join(", ") || "none";
    const dropped = p.beats.filter((b) => !b.keep).map((b) => (b.dropReason ? `${b.id} (${b.dropReason})` : b.id)).join(", ") || "none";
    lines.push("", `Your previous plan: kept ${kept}; dropped ${dropped}. Hook: ${p.hook.reason || p.hook.patternBreak}.`);
  }
  if (req.instruction) lines.push(`The user asked for this change: ${req.instruction}`);
  return lines.join("\n");
}

/** Fills in what code owns (beat spans, source, keyword, estimate, warnings) and validates with parseEditPlan. Throws a repair-ready message. */
export function buildEditPlan(draft: EditPlanDraft, req: FootagePlanRequest, beats: BeatSpan[], style: EditStyle): EditPlan {
  const byId = new Map(draft.beats.map((b) => [b.id, b]));
  const missing = beats.filter((b) => !byId.has(b.id)).map((b) => b.id);
  const unknown = draft.beats.filter((d) => !beats.some((b) => b.id === d.id)).map((d) => d.id);
  const idErrors = [
    ...(missing.length ? [`Return every beat id exactly once: missing ${missing.join(", ")}.`] : []),
    ...(unknown.length ? [`Unknown beat ids: ${unknown.join(", ")}.`] : []),
  ];
  if (idErrors.length) throw new Error(idErrors.join("\n"));
  const m = draft.music;
  if (m.kind === "library" && !req.library.some((t) => t.id === m.trackId)) {
    throw new Error(`music.trackId "${m.trackId}" is not in the library. Use a listed id, or "ai" or "none".`);
  }
  const plan = {
    format: "footage",
    version: 1,
    title: draft.title.trim(),
    language: req.settings.language,
    targetDurationSec: req.settings.targetDurationSec,
    source: req.source,
    beats: beats.map((b) => {
      const d = byId.get(b.id)!;
      return {
        id: b.id, startWordIdx: b.startWordIdx, endWordIdx: b.endWordIdx, keep: d.keep,
        ...(!d.keep && d.dropReason.trim() ? { dropReason: d.dropReason.trim().slice(0, 200) } : {}),
        ...(d.emphasisWordIdx >= 0 ? { emphasisWordIdx: d.emphasisWordIdx } : {}),
        ...(d.emoji.trim() ? { emoji: d.emoji.trim() } : {}),
      };
    }),
    hook: {
      ...(draft.hook.coldOpenBeatId.trim() ? { coldOpenBeatId: draft.hook.coldOpenBeatId.trim() } : {}),
      ...(draft.hook.headlineBig.trim() ? { headline: { small: draft.hook.headlineSmall.trim(), big: draft.hook.headlineBig.trim() } } : {}),
      patternBreak: draft.hook.patternBreak,
      reason: draft.hook.reason.trim().slice(0, 300),
    },
    // The user's keyword is owned by code: when set, the reel always ends on that CTA.
    ending: req.settings.ctaKeyword
      ? { kind: "cta", keyword: req.settings.ctaKeyword }
      : draft.ending.kind === "cta" ? { kind: "cta", keyword: draft.ending.keyword.trim() } : { kind: draft.ending.kind },
    background: { mode: "original" },
    music: m.kind === "library" ? { kind: "library", assetId: m.trackId } : m.kind === "ai" ? { kind: "ai", prompt: m.prompt.trim() } : { kind: "none" },
    sfx: draft.sfx,
    estimate: { durationSec: 0, credits: 0 },
    warnings: req.warnings,
  };
  return withFootageEstimate(parseEditPlan(plan), req.transcript.words, style);
}

type Attempt = { ok: true; plan: EditPlan } | { ok: false; error: string; plan?: EditPlan };

function attempt(result: Awaited<ReturnType<EditDraftModel>>, req: FootagePlanRequest, beats: BeatSpan[], style: EditStyle): Attempt {
  if (result.stopReason === "refusal") throw new FootagePlannerRefusedError();
  if (!result.draft) return { ok: false, error: "The output did not match the edit plan schema." };
  let plan: EditPlan;
  try {
    plan = buildEditPlan(result.draft, req, beats, style);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (plan.estimate.durationSec === 0) return { ok: false, error: "Every kept beat is only fillers. Keep at least one beat with speech." };
  const target = req.settings.targetDurationSec;
  if (plan.estimate.durationSec > target * LENGTH_TOLERANCE) {
    return { ok: false, error: `The kept beats run about ${Math.round(plan.estimate.durationSec)} s but the target is ${target} s: drop the weakest beats until they fit.`, plan };
  }
  return { ok: true, plan };
}

export function createFootagePlanner(model: EditDraftModel, style: EditStyle): FootagePlanner {
  return {
    async plan(req) {
      const beats = splitBeats(req.transcript.words);
      if (!beats.length) throw new Error("No speech found. This editor needs a video of you talking.");
      const system = footageSystemPrompt();
      const user = footageUserPrompt(req, beats);
      const first = await model({ system, user });
      const a1 = attempt(first, req, beats, style);
      if (a1.ok) return a1.plan;
      const repair = [user, "", "Your previous edit plan was rejected:", a1.error, "", "Previous output:", first.raw, "", "Return a corrected edit plan."].join("\n");
      const a2 = attempt(await model({ system, user: repair }), req, beats, style);
      if (a2.ok) return a2.plan;
      // Valid but long: return it; the review page shows the length warning and the user decides.
      const fallback = a2.plan ?? a1.plan;
      if (fallback) return fallback;
      if (/Keep at least one beat with speech/.test(a2.error)) throw new Error(a2.error);
      throw new Error(`Claude returned an invalid edit plan twice:\n${a2.error}`);
    },
  };
}

/** Plan warnings from the transcript (spec §7): language mismatch and noisy audio. */
export function transcriptWarnings(transcript: Transcript, settings: FootageSettings, style: EditStyle): string[] {
  const out: string[] = [];
  const detected = transcript.languageCode.slice(0, 2).toLowerCase();
  if (detected && detected !== settings.language) {
    const name = detected === "he" ? "Hebrew" : detected === "en" ? "English" : transcript.languageCode;
    out.push(`You picked ${LANGUAGE[settings.language]}, but the speech sounds like ${name}. Captions follow what was said.`);
  }
  const probs = transcript.words.flatMap((w) => (w.logprob === undefined ? [] : [w.logprob]));
  if (probs.length && probs.reduce((a, b) => a + b, 0) / probs.length < style.noisyLogprob) {
    out.push("The audio sounds noisy or unclear, so some caption words may be wrong.");
  }
  return out;
}

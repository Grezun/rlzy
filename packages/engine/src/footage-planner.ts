import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  CALLOUT_MAX_CHARS, CalloutSchema, EditPlanDraftSchema, LENGTH_TOLERANCE, applyCalloutBudget, applyCutawayBudget, calloutBudget, cutawayBudget, parseEditPlan, plural, splitBeats, withFootageEstimate,
  type BeatSpan, type Cutaway, type DraftCutaway, type EditPlan, type EditPlanDraft, type EditStyle, type FootageExtra, type FootageSettings, type FootageSource, type MusicMood, type Transcript,
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
  character?: { id: string; name: string };
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
    "  - headlineSmall + headlineBig: a small white line (at most 5 words) and one or two huge words on a red sticker (at most 12 characters), in the reel's language. Both empty for no headline.",
    '  - patternBreak: "zoom_hit" (a fast punch-in), "flash" (two white frames), "broll" (your first cutaway opens the reel, full screen, for 1 s: only when it is a strong visual hook) or "none".',
    "  - reason: one sentence explaining the hook, shown to the user.",
    "- emphasisWordIdx: in about one beat in three, the index of its single most important word (shown in red). -1 for none.",
    "- emoji: in about one beat in four: 👆 or 👇 when the speaker points, or one emoji that fits the line (it pops in when the line ends). Empty otherwise.",
    `- callout: in a few beats, a short sticker that springs in above the speaker: a number from the talk ("1/5", "3x", "90%") or 1–3 key words (at most ${CALLOUT_MAX_CHARS} characters), in the reel's language, where that number or phrase is said. Stay inside the callout budget; not on the first beat (the headline covers it) or the last (the CTA card covers it). Empty otherwise.`,
    '- ending: "cta" when there is a comment keyword (the user gave one, or the speaker asks viewers to comment a word: put that word in keyword); "loop" when the last line can flow back into the first; otherwise "none".',
    '- music: a library track whose mood fits (kind "library", trackId); "ai" with a short English instrumental prompt (genre, mood, tempo) only when no library track fits; "none" for serious or emotional talks.',
    '- sfx: "subtle" by default, "lively" for energetic tips, "off" for serious topics.',
    "- dropReason: for every dropped beat, a short English reason (\"retake of b4\", \"false start\", \"tangent\").",
    "- cutaway: at most one per beat. Use the cutaway budget: plan close to its maximum (about one cutaway every 3 seconds of the finished reel), spread evenly over the kept beats, and use the video clips it allows on the most visual moments. Show what the words talk about; 1–2 s is typical (durationMs 1000–3000), starting atMs after the beat starts, counted after pauses are cut; keep atMs + durationMs inside the beat.",
    '  - "ai_broll": a concrete thing or action the beat names. prompt: one English sentence for a realistic photo (subject, setting, light); never text, screens with words, or logos. media "video" only when the motion matters, otherwise "image".',
    '  - "ai_self": the speaker doing what the beat describes (only when a character is available). prompt in English, calling them "the person".',
    '  - "upload": one of the user\'s uploads whose label fits the beat; uploadId is its x1…x6 id.',
    '  - "diagram": a comparison (template "compare", exactly 2 items), a short list ("list", 2–4 items) or steps ("flow", 2–3 items); items are 1–4 words in the reel\'s language.',
    '  - layout "split" (cutaway on top, speaker below) when the speaker\'s face matters; "full" for punchy visuals.',
    "- Return every beat id exactly once, in the given order.",
  ].join("\n");
}

const sec = (ms: number) => (ms / 1000).toFixed(1);
const LANGUAGE = { he: "Hebrew", en: "English" } as const;

function cutawayBudgetLine(req: FootagePlanRequest): string {
  const b = cutawayBudget(req.settings.targetDurationSec, !!req.character);
  const self = req.character ? `at most ${plural(b.maxSelf, "AI shot", "AI shots")} of the speaker (character "${req.character.name}").` : "no AI shots of the speaker (no character).";
  return `Cutaway budget: at most ${plural(b.max, "cutaway", "cutaways")} (at most ${plural(b.maxVideo, "video clip", "video clips")}); ${self} Plan close to the maximum: about one cutaway every 3 s.`;
}

function uploadLines(extras: FootageExtra[]): string[] {
  if (!extras.length) return ["Uploads from the user: none."];
  return [
    'Uploads from the user (cutaway kind "upload"):',
    ...extras.map((e, i) => `- x${i + 1} (${e.kind === "image" ? "photo" : `clip, ${(e.durationMs / 1000).toFixed(1)} s`}, ${e.width > e.height ? "landscape" : "portrait"}) "${e.label}"`),
  ];
}

export function footageUserPrompt(req: FootagePlanRequest, beats: BeatSpan[]): string {
  const w = req.transcript.words;
  const speechMs = beats.reduce((s, b) => s + (w[b.endWordIdx].endMs - w[b.startWordIdx].startMs), 0);
  const lines = [
    `Reel language: ${LANGUAGE[req.settings.language]}. Target length: ${req.settings.targetDurationSec} seconds. The talk has ${sec(speechMs)} s of speech in ${beats.length} beats.`,
    req.settings.ctaKeyword
      ? `Comment keyword from the user: "${req.settings.ctaKeyword}" (use ending "cta").`
      : 'No comment keyword was given: use "cta" only if the speaker asks viewers to comment a specific word, and put that word in ending.keyword.',
    ...(req.settings.notes ? [`Notes from the user: ${req.settings.notes}`] : []),
    "Background replacement is not available in this version: never mention it.",
    cutawayBudgetLine(req),
    `Callout budget: at most ${plural(calloutBudget(req.settings.targetDurationSec), "callout", "callouts")}.`,
    ...uploadLines(req.source.extras),
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

/** Claude's flat draft cutaway → a schema cutaway (timing clamped to 1–3 s; upload ids x1…x6 mapped to the asset). */
export function draftCutaway(beatId: string, c: DraftCutaway, req: FootagePlanRequest): Cutaway | undefined {
  if (c.kind === "none") return undefined;
  const timing = { layout: c.layout, atMs: Math.max(0, Math.round(c.atMs)), durationMs: Math.min(3000, Math.max(1000, Math.round(c.durationMs))) };
  switch (c.kind) {
    case "ai_broll":
    case "ai_self":
      return { source: { kind: c.kind, prompt: c.prompt.trim(), media: c.media }, ...timing };
    case "upload": {
      const n = /^x([1-6])$/.exec(c.uploadId.trim())?.[1];
      const extra = n ? req.source.extras[Number(n) - 1] : undefined;
      if (!extra) throw new Error(`Beat ${beatId}: uploadId "${c.uploadId}" is not one of the uploads. Use a listed id, or another cutaway kind.`);
      return { source: { kind: "upload", assetId: extra.assetId }, ...timing };
    }
    case "diagram":
      return { source: { kind: "diagram", template: c.template, items: c.items.map((t) => t.trim()).filter(Boolean).slice(0, 4) }, ...timing };
  }
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
  const calloutWarnings: string[] = [];
  const withCutaways = beats.map((b) => {
    const d = byId.get(b.id)!;
    const cutaway = draftCutaway(b.id, d.cutaway, req);
    const text = d.callout.trim();
    const callout = text && CalloutSchema.safeParse({ text }).success ? { text } : undefined;
    if (text && !callout) calloutWarnings.push(`The callout in ${b.id} ("${text}") was removed: a callout is a number or 1–3 words, at most ${CALLOUT_MAX_CHARS} characters.`);
    return {
      id: b.id, startWordIdx: b.startWordIdx, endWordIdx: b.endWordIdx, keep: d.keep,
      ...(!d.keep && d.dropReason.trim() ? { dropReason: d.dropReason.trim().slice(0, 200) } : {}),
      ...(d.emphasisWordIdx >= 0 ? { emphasisWordIdx: d.emphasisWordIdx } : {}),
      ...(d.emoji.trim() ? { emoji: d.emoji.trim() } : {}),
      ...(cutaway ? { cutaway } : {}),
      ...(callout ? { callout } : {}),
    };
  });
  const budgeted = applyCutawayBudget(withCutaways, cutawayBudget(req.settings.targetDurationSec, !!req.character), req.settings.targetDurationSec);
  const withCallouts = applyCalloutBudget(budgeted.beats, calloutBudget(req.settings.targetDurationSec), req.settings.targetDurationSec);
  const brollLeft = withCallouts.beats.some((b) => b.keep && b.cutaway);
  const brollLost = draft.hook.patternBreak === "broll" && !brollLeft;
  const patternBreak = brollLost ? "zoom_hit" : draft.hook.patternBreak;
  const plan = {
    format: "footage",
    version: 1,
    title: draft.title.trim(),
    language: req.settings.language,
    targetDurationSec: req.settings.targetDurationSec,
    source: req.source,
    beats: withCallouts.beats,
    hook: {
      ...(draft.hook.coldOpenBeatId.trim() ? { coldOpenBeatId: draft.hook.coldOpenBeatId.trim() } : {}),
      ...(draft.hook.headlineBig.trim() ? { headline: { small: draft.hook.headlineSmall.trim(), big: draft.hook.headlineBig.trim() } } : {}),
      patternBreak,
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
    ...(req.character ? { character: req.character } : {}),
    warnings: [...req.warnings, ...budgeted.warnings, ...calloutWarnings, ...withCallouts.warnings, ...(brollLost ? ["The B-roll opening had no cutaway left, so it became a zoom hit."] : [])],
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

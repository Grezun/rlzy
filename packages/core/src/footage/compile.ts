import { FPS } from "../assemble";
import { ceilToCent, DEFAULT_COST_TABLE, estimateFootageCost, estimateReelSeconds, type CostTable } from "../cost";
import type { EditPlan } from "../schema/edit-plan";
import type { FaceTrack, Transcript } from "../schema/footage";
import { TimelineSchema, type SfxName, type Timeline, type TimelineClip, type Word } from "../schema/timeline";
import { pageWords, type ReelWord } from "./captions";
import { faceAt } from "./face-track";
import { centerFor, framesToMs, maxScaleFor, msToFrames, planShots, shotCrop } from "./shots";
import type { EditStyle } from "./style";

export type FootageAssets = { videoSrc: string; voiceSrc?: string; musicSrc?: string; sfx: Partial<Record<SfxName, string>> };
export type VoiceSegment = { inMs: number; outMs: number };
export type CompiledFootage = { timeline: Timeline; voiceSegments: VoiceSegment[]; durationMs: number };

export class EmptyEditError extends Error {
  constructor() {
    super("Nothing to show: no kept beat has speech left after cutting pauses and fillers. Keep at least one beat with speech.");
    this.name = "EmptyEditError";
  }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const splitWords = (s: string) => s.trim().split(/\s+/).filter(Boolean);

export function footageDurationMs(plan: Pick<EditPlan, "beats" | "hook" | "ending" | "source">, words: Word[], style: EditStyle): number {
  return framesToMs(planShots(plan, words, style).reduce((n, s) => n + s.frames, 0));
}

/**
 * Fills plan.estimate (spec §5.10): reel length shown to 0.1 s, and generation cost in USD billed on
 * estimateReelSeconds (the same rule music generation uses), rounded up to the cent. Never trusted from a client.
 */
export function withFootageEstimate(plan: EditPlan, words: Word[], style: EditStyle, table: CostTable = DEFAULT_COST_TABLE): EditPlan {
  const durationMs = footageDurationMs(plan, words, style);
  const durationSec = Math.round(durationMs / 100) / 10;
  // Rounded UP to the cent: generation skips music that costs more than the approved estimate.
  const credits = ceilToCent(estimateFootageCost(plan, estimateReelSeconds(durationMs), table));
  return { ...plan, estimate: { durationSec, credits } };
}

/** The edit compiler (spec §5): deterministic, no I/O. Plan 1 ignores cutaways (parseEditPlan already rejects them). */
export function compileFootage(plan: EditPlan, transcript: Transcript, faceTrack: FaceTrack | null, assets: FootageAssets, style: EditStyle): CompiledFootage {
  const words = transcript.words;
  const shots = planShots(plan, words, style);
  if (!shots.length) throw new EmptyEditError();
  const total = shots.reduce((n, s) => n + s.frames, 0);
  const requested = plan.hook.patternBreak === "broll" ? "none" : plan.hook.patternBreak;
  const patternBreak = plan.ending.kind === "loop" && requested === "flash" ? "none" : requested;

  const clips: TimelineClip[] = [];
  const reelWords: ReelWord[] = [];
  const voiceSegments: VoiceSegment[] = [];
  let at = 0;
  shots.forEach((shot, i) => {
    // Source spans come from the shot's frames (never re-derived from word times), keeping planShots' guarantees:
    // no source frame plays twice and no cut word is heard.
    const inMs = framesToMs(shot.inFrame);
    const face = faceTrack ? faceAt(faceTrack, framesToMs(shot.inFrame + shot.speechFrames / 2)) : null;
    let crop = shotCrop(i, framesToMs(shot.frames), face, style);
    if (i === 0 && patternBreak === "zoom_hit") {
      const to = r4(Math.max(1, Math.min(style.zoomHitScale, maxScaleFor(face, style))));
      crop = { ...centerFor(face, to), scaleFrom: 1, scaleTo: to, punchFrames: style.zoomHitFrames };
    }
    clips.push({
      sceneId: shot.id, kind: "speaker", src: assets.videoSrc, fromFrame: at, durationInFrames: shot.frames,
      motion: "none", transitionIn: "cut", source: { inMs: r3(inMs), outMs: r3(framesToMs(shot.inFrame + shot.frames)) }, crop,
    });
    voiceSegments.push({ inMs: r3(inMs), outMs: r3(framesToMs(shot.inFrame + shot.speechFrames)) });
    // Captions (spec §5.6): source time → reel time, clamped to this shot's spoken part.
    const startMs = framesToMs(at);
    const endMs = framesToMs(at + shot.speechFrames);
    for (const idx of shot.wordIdx) {
      const w = words[idx];
      reelWords.push({
        text: w.text, idx, beatId: shot.beatId,
        startMs: Math.round(clampN(startMs + w.startMs - inMs, startMs, endMs)),
        endMs: Math.round(clampN(startMs + w.endMs - inMs, startMs, endMs)),
      });
    }
    at += shot.frames;
  });

  const lastShot = shots[shots.length - 1];
  const speechEndFrame = total - (lastShot.frames - lastShot.speechFrames);
  const beats = new Map(plan.beats.map((b) => [b.id, b]));
  const groups = pageWords(reelWords, style);
  const pages = groups.map((g, i) => {
    const next = groups[i + 1];
    const fromFrame = msToFrames(g[0].startMs);
    const endFrame = next ? msToFrames(next[0].startMs) : speechEndFrame;
    const beat = beats.get(g[0].beatId)!;
    const lastOfBeat = !next || next[0].beatId !== g[0].beatId;
    return {
      fromFrame,
      durationInFrames: Math.max(1, endFrame - fromFrame),
      words: g.map((w) => ({ text: w.text, emphasis: w.idx === beat.emphasisWordIdx })),
      ...(lastOfBeat && beat.emoji ? { emoji: beat.emoji } : {}),
    };
  });

  const headline = plan.hook.headline;
  const hook = {
    patternBreak,
    ...(headline ? { headline: { small: headline.small, big: headline.big, fromFrame: 0, durationInFrames: Math.min(total, msToFrames(style.headlineMs)) } } : {}),
  };
  const ctaFrames = Math.min(total, msToFrames(style.ctaMs));
  const ending =
    plan.ending.kind === "cta"
      ? { kind: "cta" as const, keyword: plan.ending.keyword, fromFrame: total - ctaFrames, durationInFrames: ctaFrames }
      : { kind: plan.ending.kind };

  const cues: { name: SfxName; frame: number; volumeDb: number }[] = [];
  if (plan.sfx !== "off") {
    const whooshes: SfxName[] = ["whoosh1", "whoosh2"];
    const pops: SfxName[] = ["pop1", "pop2"];
    let pop = 0;
    if (patternBreak !== "none" || headline) cues.push({ name: whooshes[0], frame: 0, volumeDb: style.sfxVolumeDb.whoosh });
    if (headline) {
      const small = splitWords(headline.small).length;
      splitWords(headline.big).forEach((_, j) => cues.push({ name: pops[pop++ % 2], frame: (small + j) * style.headlineWordFrames, volumeDb: style.sfxVolumeDb.pop }));
    }
    if (ending.kind === "cta") cues.push({ name: pops[pop++ % 2], frame: ending.fromFrame, volumeDb: style.sfxVolumeDb.pop });
    if (plan.sfx === "lively") {
      clips.forEach((c, i) => {
        if (i === 0 || c.crop!.scaleFrom === clips[i - 1].crop!.scaleFrom) return;
        if (cues.some((q) => Math.abs(q.frame - c.fromFrame) <= 3)) return;
        cues.push({ name: "tick", frame: c.fromFrame, volumeDb: style.sfxVolumeDb.tick });
      });
    }
  }
  const sfx = cues
    .filter((c) => assets.sfx[c.name] && c.frame < total)
    .sort((a, b) => a.frame - b.frame || a.name.localeCompare(b.name))
    .map((c) => ({ ...c, src: assets.sfx[c.name]! }));

  const timeline = TimelineSchema.parse({
    fps: FPS,
    width: 1080,
    height: 1920,
    durationInFrames: total,
    language: plan.language,
    direction: plan.language === "he" ? "rtl" : "ltr",
    style: { captionPreset: "pill", font: "Heebo", palette: ["#FEE80A", "#000000"] },
    audio: { voiceUrl: assets.voiceSrc, musicUrl: assets.musicSrc, musicDuckingDb: style.musicUnderVoiceDb },
    clips,
    captions: { words: reelWords.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })), pages },
    overlays: [],
    hook,
    ending,
    ...(sfx.length ? { sfx } : {}),
  });
  return { timeline, voiceSegments, durationMs: framesToMs(total) };
}

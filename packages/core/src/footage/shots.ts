import { FPS } from "../assemble";
import type { Beat, EditPlan } from "../schema/edit-plan";
import type { FaceBox } from "../schema/footage";
import type { TimelineCrop, Word } from "../schema/timeline";
import type { EditStyle } from "./style";

export const msToFrames = (ms: number) => Math.round((ms * FPS) / 1000);
export const framesToMs = (frames: number) => (frames * 1000) / FPS;

/** First frame of the CTA card (the reel's length when the ending isn't a CTA). The one rule: breaks, cutaway placement, the estimate and compileFootage all call it. */
export function ctaStartFrame(plan: Pick<EditPlan, "ending">, total: number, style: EditStyle): number {
  return plan.ending.kind === "cta" ? total - Math.min(total, msToFrames(style.ctaMs)) : total;
}
const r4 = (v: number) => Math.round(v * 10_000) / 10_000;

const norm = (s: string) =>
  s.normalize("NFC").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase().replace(/(.)\1+/gu, "$1$1");

/** Filler check: punctuation, niqqud and case are ignored, and stretched letters ("אממממ", "hmmm") count as two. */
export function isFiller(text: string, fillers: string[]): boolean {
  const t = norm(text);
  return t.length > 0 && fillers.some((f) => norm(f) === t);
}

/** Kept beats in reel order: the cold-open beat first, then the rest in source order (the cold open is not repeated). */
export function orderedKeptBeats(plan: Pick<EditPlan, "beats" | "hook">): Beat[] {
  const kept = plan.beats.filter((b) => b.keep);
  const cold = kept.find((b) => b.id === plan.hook.coldOpenBeatId);
  return cold ? [cold, ...kept.filter((b) => b !== cold)] : kept;
}

export type PlannedShot = { id: string; beatId: string; inFrame: number; frames: number; speechFrames: number; wordIdx: number[] };

/** Word index runs inside a beat: a gap of cutGapMs or more, or a filler (dropped), starts a new run. */
function speechSpans(beat: Beat, words: Word[], style: EditStyle): number[][] {
  const spans: number[][] = [];
  let current: number[] = [];
  for (let i = beat.startWordIdx; i <= beat.endWordIdx && i < words.length; i++) {
    if (isFiller(words[i].text, style.fillerWords)) {
      if (current.length) spans.push(current);
      current = [];
      continue;
    }
    const prev = current.at(-1);
    if (prev !== undefined && words[i].startMs - words[prev].endMs >= style.cutGapMs) {
      spans.push(current);
      current = [];
    }
    current.push(i);
  }
  if (current.length) spans.push(current);
  return spans;
}

/**
 * Speech cuts (spec §5.2): inside each kept beat, words closer than cutGapMs stay together; every larger gap and every
 * filler is cut. Spans are padded by padMs and snapped to whole source frames so picture and voice cut on the same sample.
 * Padding never overlaps: each span starts no earlier than the previous kept span (in source order, across beats) ends,
 * so no source frame plays twice even when the cold open reorders beats. Padding never reaches into a cut word (a filler
 * or a dropped beat's word): it stops at that word's boundary, and frame snapping rounds toward the kept side.
 * The ending adjusts the last shot: a loop ends on its last word; a CTA continues the picture (not the voice) until
 * the next spoken word or the end of the source, at most ctaMs.
 */
export function planShots(plan: Pick<EditPlan, "beats" | "hook" | "ending" | "source">, words: Word[], style: EditStyle): PlannedShot[] {
  const sourceFrames = Math.floor((plan.source.durationMs * FPS) / 1000);
  const keptBeats = plan.beats.filter((b) => b.keep);
  const spansByBeat = new Map(keptBeats.map((b) => [b.id, speechSpans(b, words, style)]));
  const played = new Set([...spansByBeat.values()].flat(2));
  /** A word that is never played (a filler or a dropped beat's word): padding and frame snapping must stay out of it. */
  const cut = (i: number) => (i >= 0 && i < words.length && !played.has(i) ? words[i] : undefined);
  // First frame at/after a cut word's end, last frame boundary at/before a cut word's start (round toward the kept side).
  const firstFrameAfter = (ms: number) => Math.ceil((ms * FPS) / 1000 - 1e-6);
  const lastFrameBefore = (ms: number) => Math.floor((ms * FPS) / 1000 + 1e-6);

  const byBeat = new Map<string, PlannedShot[]>();
  let usedUntil = 0;
  for (const beat of keptBeats) {
    const shots = spansByBeat.get(beat.id)!.map((span, k): PlannedShot => {
      const first = words[span[0]];
      const last = words[span[span.length - 1]];
      const before = cut(span[0] - 1);
      const after = cut(span[span.length - 1] + 1);
      let inFrame = msToFrames(Math.max(0, first.startMs - style.padMs, before?.endMs ?? 0));
      if (before) inFrame = Math.max(inFrame, firstFrameAfter(before.endMs));
      let outFrame = msToFrames(Math.min(last.endMs + style.padMs, after?.startMs ?? Infinity));
      if (after) outFrame = Math.min(outFrame, lastFrameBefore(after.startMs));
      inFrame = Math.max(usedUntil, inFrame);
      outFrame = Math.min(sourceFrames, outFrame);
      const frames = Math.max(1, outFrame - inFrame);
      usedUntil = inFrame + frames;
      return { id: `${beat.id}-${k + 1}`, beatId: beat.id, inFrame, frames, speechFrames: frames, wordIdx: span };
    });
    byBeat.set(beat.id, shots);
  }
  const shots = orderedKeptBeats(plan).flatMap((b) => byBeat.get(b.id) ?? []);
  const last = shots.at(-1);
  if (!last) return shots;
  const lastWordIdx = last.wordIdx[last.wordIdx.length - 1];
  if (plan.ending.kind === "loop") {
    last.frames = last.speechFrames = Math.max(1, Math.min(last.frames, msToFrames(words[lastWordIdx].endMs) - last.inFrame));
  } else if (plan.ending.kind === "cta") {
    const next = words[lastWordIdx + 1];
    const limit = next ? Math.min(sourceFrames, msToFrames(next.startMs - style.padMs), lastFrameBefore(next.startMs)) : sourceFrames;
    last.frames += Math.max(0, Math.min(msToFrames(style.ctaMs), limit - (last.inFrame + last.frames)));
  }
  return shots;
}

/** The largest zoom that still shows the whole face (with faceMargin); at least 1. */
export function maxScaleFor(face: FaceBox | null, style: EditStyle): number {
  if (!face) return Infinity;
  return Math.max(1, Math.min(1 / (face.w * style.faceMargin), 1 / (face.h * style.faceMargin)));
}

/** Face centre, clamped so the zoomed window (1/scale wide) stays inside the frame. No face: the frame centre. */
export function centerFor(face: FaceBox | null, scale: number): { cx: number; cy: number } {
  if (!face) return { cx: 0.5, cy: 0.5 };
  const half = 1 / (2 * scale);
  const clamp = (v: number) => Math.min(1 - half, Math.max(half, v));
  return { cx: r4(clamp(face.x + face.w / 2)), cy: r4(clamp(face.y + face.h / 2)) };
}

/** Zoom per shot (spec §5.3): repeating zoom steps, centred on the face, push-in on long shots. */
export function shotCrop(index: number, durationMs: number, face: FaceBox | null, style: EditStyle): TimelineCrop {
  const max = maxScaleFor(face, style);
  const scaleFrom = Math.min(style.zoomSteps[index % style.zoomSteps.length], max);
  const scaleTo = durationMs > style.pushInAfterMs ? Math.min(scaleFrom * style.pushInFactor, Math.max(scaleFrom, max)) : scaleFrom;
  return { ...centerFor(face, scaleTo), scaleFrom: r4(scaleFrom), scaleTo: r4(scaleTo) };
}

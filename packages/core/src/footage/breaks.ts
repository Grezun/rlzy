import type { FaceBox } from "../schema/footage";
import type { BreakKind, TimelineClip } from "../schema/timeline";
import { centerFor, maxScaleFor, msToFrames } from "./shots";
import type { EditStyle } from "./style";

export type PickedBreak = { index: number; frame: number; kind: BreakKind };

const r4 = (v: number) => Math.round(v * 10_000) / 10_000;

/**
 * Pattern breaks after the hook: from the last break (or cutaway start, or frame 0), the eligible cut closest to
 * everyMs inside [minMs, maxMs]; when the window has none, the first eligible cut after it. Eligible: not the first
 * shot, at least minShotFrames long, not starting in a blocked range (CTA card, cutaways).
 */
export function pickBreaks(shots: { fromFrame: number; frames: number }[], b: EditStyle["breaks"], blocked: [number, number][], resets: number[]): PickedBreak[] {
  const every = msToFrames(b.everyMs);
  const min = msToFrames(b.minMs);
  const max = msToFrames(b.maxMs);
  const isBlocked = (f: number) => blocked.some(([from, to]) => f >= from && f < to);
  const eligible = shots
    .map((s, index) => ({ ...s, index }))
    .filter((s) => s.index > 0 && s.frames >= b.minShotFrames && !isBlocked(s.fromFrame));
  const sortedResets = [...resets].sort((x, y) => x - y);
  const out: PickedBreak[] = [];
  let last = 0;
  for (;;) {
    const nextReset = sortedResets.find((r) => r > last);
    if (nextReset !== undefined && nextReset <= last + max) {
      last = nextReset;
      continue;
    }
    const inWindow = eligible.filter((s) => s.fromFrame >= last + min && s.fromFrame <= last + max);
    const target = last + every;
    const pick =
      inWindow.reduce<(typeof eligible)[number] | undefined>((best, s) => (!best || Math.abs(s.fromFrame - target) < Math.abs(best.fromFrame - target) ? s : best), undefined) ??
      eligible.find((s) => s.fromFrame > last + max);
    if (!pick) break;
    if (nextReset !== undefined && nextReset <= pick.fromFrame) {
      last = nextReset;
      continue;
    }
    out.push({ index: pick.index, frame: pick.fromFrame, kind: b.kinds[out.length % b.kinds.length] });
    last = pick.fromFrame;
  }
  return out;
}

/**
 * Applies picked breaks to the clips: zoom_hit punches the clip in by hitFactor over zoomHitFrames (a face too big to
 * zoom turns it into zoom_blur); zoom_blur sets the clip's entry; flash is drawn by PatternBreak. Returns the timeline list.
 */
export function applyBreaks(clips: TimelineClip[], picked: PickedBreak[], faces: (FaceBox | null)[], style: EditStyle): { frame: number; kind: BreakKind }[] {
  return picked.map(({ index, frame, kind }) => {
    const clip = clips[index];
    let k = kind;
    if (k === "zoom_hit") {
      const base = clip.crop!.scaleFrom;
      const to = r4(Math.min(maxScaleFor(faces[index], style), base * style.breaks.hitFactor));
      if (to - base >= 0.05) clip.crop = { ...centerFor(faces[index], to), scaleFrom: base, scaleTo: to, punchFrames: style.zoomHitFrames };
      else k = "zoom_blur";
    }
    if (k === "zoom_blur") clip.enter = { kind: "zoom_blur", frames: style.breaks.zoomBlurFrames };
    return { frame, kind: k };
  });
}

/** A cut to a larger zoom step snaps in (unless the clip already punches or has an entry). */
export function addSnaps(clips: TimelineClip[], style: EditStyle): void {
  for (let i = 1; i < clips.length; i++) {
    const c = clips[i];
    const prev = clips[i - 1];
    if (c.enter || c.crop?.punchFrames || !c.crop || !prev.crop) continue;
    if (c.crop.scaleFrom > prev.crop.scaleFrom + 1e-6) c.enter = { kind: "snap", frames: style.snapFrames };
  }
}

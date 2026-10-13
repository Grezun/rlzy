import type { Timeline, TimelineClip, TimelineCrop } from "@reel/core";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);

/** Linear across the clip, or within punchFrames then held (zoom hit). Resets on the next clip. */
export function speakerScale(crop: TimelineCrop, frame: number, durationInFrames: number): number {
  const span = crop.punchFrames ?? Math.max(1, durationInFrames - 1);
  return crop.scaleFrom + (crop.scaleTo - crop.scaleFrom) * clamp01(frame / span);
}

/**
 * CSS transform (applied right to left): move (cx, cy) towards the centre, then zoom about the centre.
 * The centre is clamped per frame to [0.5/s, 1 − 0.5/s] for this frame's scale s, so no frame edge ever shows,
 * even while a push-in or zoom hit is still at its smaller starting scale.
 */
export function speakerTransform(crop: TimelineCrop, frame: number, durationInFrames: number, mult = 1): string {
  const s = Math.max(1, speakerScale(crop, frame, durationInFrames)) * mult;
  const half = 0.5 / s;
  const clamp = (v: number) => Math.min(1 - half, Math.max(half, v));
  return `scale(${s.toFixed(4)}) translate(${((0.5 - clamp(crop.cx)) * 100).toFixed(3)}%, ${((0.5 - clamp(crop.cy)) * 100).toFixed(3)}%)`;
}

const easeOutBack = (p: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};

/** Page pop with a small overshoot (≈ 2 % past full size at from = 0.8). */
export const popBounce = (frame: number, frames: number, from: number) => from + (1 - from) * easeOutBack(clamp01(frame / frames));

/** The spoken word's pulse: 1 → peak over `up` frames, then back to 1 over `down` frames. */
export function wordPulse(frame: number, up: number, down: number, peak: number): number {
  if (frame <= 0) return 1;
  if (frame < up) return 1 + (peak - 1) * easeOutCubic(frame / up);
  return 1 + (peak - 1) * (1 - easeOutCubic(clamp01((frame - up) / down)));
}

/** Emoji: 0 → overshoot over the first 60 %, then back to 1. */
export function emojiScale(frame: number, frames: number, overshoot: number): number {
  if (frame <= 0) return 0;
  const p = frame / frames;
  if (p >= 1) return 1;
  return p < 0.6 ? overshoot * easeOutCubic(p / 0.6) : overshoot + (1 - overshoot) * easeOutCubic((p - 0.6) / 0.4);
}

/** Index of the last word whose start frame has passed (absolute reel frames), or -1. */
export function activeWordIndex(words: { startFrame?: number }[], frame: number): number {
  let idx = -1;
  words.forEach((w, i) => {
    if (w.startFrame !== undefined && w.startFrame <= frame) idx = i;
  });
  return idx;
}

/** A clip's entry: extra zoom multiplier and blur, both easing back to none. */
export function enterEffect(enter: TimelineClip["enter"], frame: number, m: { snapScale: number; zoomBlurScale: number; zoomBlurPx: number }): { scale: number; blurPx: number } {
  if (!enter || frame >= enter.frames) return { scale: 1, blurPx: 0 };
  const rest = 1 - easeOutCubic(clamp01(frame / enter.frames));
  return enter.kind === "snap"
    ? { scale: 1 + (m.snapScale - 1) * rest, blurPx: 0 }
    : { scale: 1 + (m.zoomBlurScale - 1) * rest, blurPx: m.zoomBlurPx * rest };
}

/** Frames where pills give way to bigger text: the hook headline and the CTA card. */
export function captionHideRanges(t: Timeline): [number, number][] {
  const out: [number, number][] = [];
  const h = t.hook?.headline;
  if (h) out.push([h.fromFrame, h.fromFrame + h.durationInFrames]);
  if (t.ending?.kind === "cta") out.push([t.ending.fromFrame, t.ending.fromFrame + t.ending.durationInFrames]);
  return out;
}

/** Each page minus the hidden ranges (its longest visible part); pages left with fewer than minFrames are dropped. */
export function visiblePages<P extends { fromFrame: number; durationInFrames: number }>(pages: P[], hide: [number, number][], minFrames: number): P[] {
  const out: P[] = [];
  for (const p of pages) {
    let parts: [number, number][] = [[p.fromFrame, p.fromFrame + p.durationInFrames]];
    for (const [a, b] of hide) {
      parts = parts.flatMap(([s, e]): [number, number][] => (b <= s || a >= e ? [[s, e]] : [...(a > s ? [[s, a] as [number, number]] : []), ...(b < e ? [[b, e] as [number, number]] : [])]));
    }
    const best = parts.reduce<[number, number] | null>((m, x) => (!m || x[1] - x[0] > m[1] - m[0] ? x : m), null);
    if (best && best[1] - best[0] >= minFrames) out.push({ ...p, fromFrame: best[0], durationInFrames: best[1] - best[0] });
  }
  return out;
}

export const popIn = (frame: number, frames: number, from: number) => from + (1 - from) * easeOutCubic(clamp01(frame / frames));

export const revealedCount = (total: number, frame: number, wordFrames: number) => (frame < 0 ? 0 : Math.min(total, Math.floor(frame / wordFrames) + 1));

export function ctaLines(keyword: string, language: "he" | "en"): { before: string; keyword: string; after: string } {
  return language === "he"
    ? { before: "תכתבו", keyword: `'${keyword}'`, after: "בתגובות" }
    : { before: "Comment", keyword: `'${keyword}'`, after: "" };
}

/**
 * Bottom-half speaker (layout "split"): the inner element is the full source frame, twice the panel's height. Moving it
 * by (0.25 − cy) of its own height puts source y = cy at the panel's centre; clamped to [−50 %, 0] so no edge shows.
 */
export function splitTransform(cy: number): string {
  const t = Math.min(0, Math.max(-0.5, 0.25 - cy));
  return `translateY(${(t * 100).toFixed(3)}%)`;
}

/** Linear zoom from 1 to `to` across the cutaway (spec §6: stills +6 %). */
export const kenBurnsScale = (frame: number, frames: number, to: number) => 1 + (to - 1) * clamp01(frame / Math.max(1, frames - 1));

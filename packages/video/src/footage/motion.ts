import { spring } from "remotion";
import type { CutawayTransition, Timeline, TimelineClip, TimelineCrop } from "@reel/core";

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

const easeInCubic = (p: number) => p * p * p;
const easeOutSine = (p: number) => Math.sin((p * Math.PI) / 2);

/**
 * Still cutaways (look pass): zoom 1 → `to` and drift by `drift` (fractions of the frame), easing out so the motion reads
 * even on a 1 s still. The translate (applied before the scale) is clamped to (1 − 1/s)/2, so no frame edge ever shows.
 */
export function kenBurnsTransform(frame: number, frames: number, to: number, drift: { x: number; y: number } = { x: 0, y: 0 }): string {
  const p = easeOutSine(clamp01(frame / Math.max(1, frames - 1)));
  const s = 1 + (to - 1) * p;
  const limit = (1 - 1 / s) / 2;
  const t = (d: number) => Math.max(-limit, Math.min(limit, d * p)) * 100;
  return `scale(${s.toFixed(4)}) translate(${t(drift.x).toFixed(3)}%, ${t(drift.y).toFixed(3)}%)`;
}

/** The blurred fill behind a misfit upload drifts half as far the other way (parallax). */
export function parallaxFill(frame: number, frames: number, scale: number, drift: { x: number; y: number }): string {
  const p = easeOutSine(clamp01(frame / Math.max(1, frames - 1)));
  return `scale(${scale}) translate(${(-drift.x * 50 * p).toFixed(3)}%, ${(-drift.y * 50 * p).toFixed(3)}%)`;
}

export type SlotMotion = { x: number; y: number; scale: number; blurPx: number; opacity: number };
export type SlotTransitionStyle = { inFrames: number; outFrames: number; whipBlurPx: number; zoomFrom: number; zoomTo: number; zoomBlurPx: number };
const STILL: SlotMotion = { x: 0, y: 0, scale: 1, blurPx: 0, opacity: 1 };

function phase(kind: Exclude<CutawayTransition, "cut">, amount: number, fwd: number, m: SlotTransitionStyle, entering: boolean): SlotMotion {
  switch (kind) {
    case "whip":
      return { x: (entering ? fwd : -fwd) * 100 * amount, y: 0, scale: 1, blurPx: m.whipBlurPx * amount, opacity: 1 };
    case "zoom":
      return { x: 0, y: 0, scale: 1 + ((entering ? m.zoomFrom : m.zoomTo) - 1) * amount, blurPx: m.zoomBlurPx * amount, opacity: 1 - amount };
    case "slide":
      return { x: 0, y: -100 * amount, scale: 1, blurPx: 0, opacity: 1 };
  }
}

/**
 * A cutaway's entry and exit, inside its own frames (the speaker underneath shows as it leaves). x and y are % of the slot.
 * Whips move forward in reading order: LTR content enters from the right and leaves to the left; RTL mirrors it.
 */
export function cutawayMotion(t: { in: CutawayTransition; out: CutawayTransition } | undefined, frame: number, durationInFrames: number, direction: Timeline["direction"], m: SlotTransitionStyle): SlotMotion {
  if (!t) return STILL;
  const fwd = direction === "ltr" ? 1 : -1;
  if (t.in !== "cut" && frame < m.inFrames) return phase(t.in, 1 - easeOutCubic(clamp01((frame + 1) / m.inFrames)), fwd, m, true);
  const outStart = durationInFrames - m.outFrames;
  if (t.out !== "cut" && frame >= outStart) return phase(t.out, easeInCubic(clamp01((frame - outStart + 1) / m.outFrames)), fwd, m, false);
  return STILL;
}

/**
 * A damped spring from 0 to 1 at `fps` (0 at frame <= 0). A thin wrapper over Remotion's pure `spring()` (verified: no
 * Remotion context needed) so components and tests share one call shape. 170/15 overshoots by about 11 % and settles by about 0.6 s.
 */
export const springValue = (frame: number, cfg: { stiffness: number; damping: number }, fps = 30): number => spring({ frame, fps, config: cfg });

/** Diagram text size multiplier: `steps` are [minimum longest-item length (exclusive), scale], longest threshold first; otherwise 1. */
export function diagramFontScale(items: string[], steps: ReadonlyArray<readonly [number, number]>): number {
  const longest = Math.max(0, ...items.map((s) => s.length));
  return steps.find(([over]) => longest > over)?.[1] ?? 1;
}

/** 0 → 1 over `frames`, eased: a line drawing itself (checkmarks, flow connectors). */
export const drawProgress = (frame: number, frames: number) => easeOutCubic(clamp01(frame / frames));

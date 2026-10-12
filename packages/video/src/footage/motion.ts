import type { TimelineCrop } from "@reel/core";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);

/** Linear across the clip, or within punchFrames then held (zoom hit). Resets on the next clip. */
export function speakerScale(crop: TimelineCrop, frame: number, durationInFrames: number): number {
  const span = crop.punchFrames ?? Math.max(1, durationInFrames - 1);
  return crop.scaleFrom + (crop.scaleTo - crop.scaleFrom) * clamp01(frame / span);
}

/** CSS transform (applied right to left): move (cx, cy) to the centre, then zoom about the centre. */
export function speakerTransform(crop: TimelineCrop, frame: number, durationInFrames: number): string {
  const s = speakerScale(crop, frame, durationInFrames);
  return `scale(${s.toFixed(4)}) translate(${((0.5 - crop.cx) * 100).toFixed(3)}%, ${((0.5 - crop.cy) * 100).toFixed(3)}%)`;
}

export const popIn = (frame: number, frames: number, from: number) => from + (1 - from) * easeOutCubic(clamp01(frame / frames));

export const revealedCount = (total: number, frame: number, wordFrames: number) => (frame < 0 ? 0 : Math.min(total, Math.floor(frame / wordFrames) + 1));

export function ctaLines(keyword: string, language: "he" | "en"): { before: string; keyword: string; after: string } {
  return language === "he"
    ? { before: "תכתבו", keyword: `'${keyword}'`, after: "בתגובות" }
    : { before: "Comment", keyword: `'${keyword}'`, after: "" };
}

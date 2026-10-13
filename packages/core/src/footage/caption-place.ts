import type { FaceBox } from "../schema/footage";
import type { TimelineCrop } from "../schema/timeline";
import type { EditStyle } from "./style";

/** One clip's stretch of the reel and where the chin shows on screen (normalised), or null with no face. Split clips use the seam. */
export type FaceSpan = { fromFrame: number; endFrame: number; chinY: number | null; split?: boolean };

const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
const toHalf = (v: number) => Math.round(v * 2) / 2;

/**
 * The lowest on-screen point of the face over the crop's zoom range. Same maths as speakerTransform: zoom by s about
 * the frame centre after moving the clamped centre c there, so a source y shows at 0.5 + (y − c) · s.
 */
export function screenChinY(face: FaceBox | null, crop: TimelineCrop): number | null {
  if (!face) return null;
  let lowest = -Infinity;
  for (const raw of [crop.scaleFrom, crop.scaleTo]) {
    const s = Math.max(1, raw);
    const half = 0.5 / s;
    const c = Math.min(1 - half, Math.max(half, crop.cy));
    lowest = Math.max(lowest, 0.5 + (face.y + face.h - c) * s);
  }
  return r4(lowest);
}

/** A box on screen, normalised (0–1, origin top-left). */
export type ScreenRect = { top: number; bottom: number; left: number; right: number };

/** The face's on-screen box over the crop's zoom range (same maths as screenChinY), for callout placement. */
export function screenFaceRect(face: FaceBox | null, crop: TimelineCrop): ScreenRect | null {
  if (!face) return null;
  const r = { top: Infinity, bottom: -Infinity, left: Infinity, right: -Infinity };
  for (const raw of [crop.scaleFrom, crop.scaleTo]) {
    const s = Math.max(1, raw);
    const half = 0.5 / s;
    const clamp = (v: number) => Math.min(1 - half, Math.max(half, v));
    const cx = clamp(crop.cx);
    const cy = clamp(crop.cy);
    r.top = Math.min(r.top, 0.5 + (face.y - cy) * s);
    r.bottom = Math.max(r.bottom, 0.5 + (face.y + face.h - cy) * s);
    r.left = Math.min(r.left, 0.5 + (face.x - cx) * s);
    r.right = Math.max(r.right, 0.5 + (face.x + face.w - cx) * s);
  }
  return { top: r4(r.top), bottom: r4(r.bottom), left: r4(r.left), right: r4(r.right) };
}

/**
 * The face's box in a split clip: the source is shown 1:1 in the bottom half, shifted up by cy − 0.25 (clamped to
 * 0…0.5), the same maths as the renderer's splitTransform. Clipped to the bottom half.
 */
export function splitFaceRect(face: FaceBox | null, cy: number): ScreenRect | null {
  if (!face) return null;
  const t = Math.min(0, Math.max(-0.5, 0.25 - cy));
  const y = (v: number) => r4(Math.min(1, Math.max(0.5, 0.5 + v + t)));
  return { top: y(face.y), bottom: y(face.y + face.h), left: r4(face.x), right: r4(face.x + face.w) };
}

/**
 * The hook headline's top edge (% of the height), never over the face's on-screen box (which runs to the chin, so the
 * mouth is inside it): the preferred topPct when the face ends above it; else just below the chin when the headline
 * still ends by bottomPct (the caption band's bottom); else just above the head when it starts by topSafePct.
 * Rounded to 0.5 % away from the face. A face too big for either: the top band (over the top of the face rather
 * than the mouth), with clear false. No face: topPct.
 */
export function headlineSpot(face: ScreenRect | null, hasSmall: boolean, p: EditStyle["headline"]): { topPct: number; clear: boolean } {
  if (!face) return { topPct: p.topPct, clear: true };
  const h = hasSmall ? p.heightPct : p.bigOnlyHeightPct;
  const below = Math.max(p.topPct, Math.ceil((face.bottom * 100 + p.gapPct) * 2) / 2);
  if (below + h <= p.bottomPct) return { topPct: below, clear: true };
  const above = Math.floor((face.top * 100 - p.gapPct - h) * 2) / 2;
  if (above >= p.topSafePct) return { topPct: above, clear: true };
  return { topPct: p.topSafePct, clear: false };
}

/**
 * Pill centre per page, in % of the height (spec §6 PillCaptions, tuned by plan 2 Task 1). One value per page, so a
 * page never moves while it shows. Split pages sit on the seam. Small moves (< holdPct) keep the previous position;
 * pages with no face keep the previous page's position (the first known one for leading pages).
 */
export function placeCaptionPages(pages: { fromFrame: number; durationInFrames: number }[], spans: FaceSpan[], p: EditStyle["captionPlacement"]): number[] {
  const raw = pages.map((page): { top: number; seam: boolean } | null => {
    const end = page.fromFrame + page.durationInFrames;
    const over = spans.filter((s) => s.fromFrame < end && s.endFrame > page.fromFrame);
    if (over.some((s) => s.split)) return { top: p.seamTopPct, seam: true };
    const chins = over.flatMap((s) => (s.chinY === null ? [] : [s.chinY]));
    if (!chins.length) return null;
    const top = Math.max(...chins) * 100 + p.chinGapPct + p.pillHalfPct;
    return { top: toHalf(Math.min(p.maxTopPct, Math.max(p.minTopPct, top))), seam: false };
  });
  const firstKnown = raw.find((r) => r && !r.seam)?.top ?? p.noFaceTopPct;
  const out: number[] = [];
  let prev: number | null = null;
  for (const r of raw) {
    if (r?.seam) {
      out.push(r.top);
      continue;
    }
    let top: number = r ? r.top : (prev ?? firstKnown);
    if (prev !== null && Math.abs(top - prev) < p.holdPct) top = prev;
    out.push(top);
    prev = top;
  }
  return out;
}

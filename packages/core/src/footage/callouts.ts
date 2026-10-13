import { plural } from "../plural";
import type { Callout, EditPlan } from "../schema/edit-plan";
import type { Word } from "../schema/timeline";
import type { ScreenRect } from "./caption-place";
import { placeCutaways } from "./cutaways";
import { beatSpans, ctaStartFrame, msToFrames, planShots, type PlannedShot } from "./shots";
import type { EditStyle } from "./style";

export type PlacedCallout = { beatId: string; text: string; fromFrame: number; durationInFrames: number };
export type CalloutPlacement = { placed: PlacedCallout[]; warnings: string[] };
export type CalloutSpot = { topPct: number; align: "center" | "left" | "right" };

const toHalf = (v: number) => Math.round(v * 2) / 2;

/** Spec §4.3 as amended: at most one callout per 5 s of target length. */
export const calloutBudget = (targetSec: number) => Math.floor(targetSec / 5);

/** Counts kept beats in beat order; callouts past max are removed with one warning. Dropped beats keep theirs (they never show). */
export function applyCalloutBudget<B extends { keep: boolean; callout?: Callout }>(beats: B[], max: number, targetSec: number): { beats: B[]; warnings: string[] } {
  let count = 0;
  let removed = 0;
  const out = beats.map((b) => {
    if (!b.callout || !b.keep || ++count <= max) return b;
    removed++;
    const { callout: _drop, ...rest } = b;
    return rest as B;
  });
  return { beats: out, warnings: removed ? [`${plural(removed, "callout was", "callouts were")} removed (at most ${max} for a ${targetSec} s reel).`] : [] };
}

/**
 * Callout timing from the plan alone, so the review page shows the same warnings as generation: the first free stretch
 * of the beat at least minMs long, used for at most durationMs. Not free: the hook headline, the first clearFrames
 * under a zoom_hit or flash hook, the CTA card, and every placed cutaway plus clearFrames after it (its exit).
 * A beat with no free stretch loses its callout, with a warning.
 */
export function placeCallouts(plan: Pick<EditPlan, "beats" | "hook" | "ending">, shots: PlannedShot[], cutaways: { fromFrame: number; durationInFrames: number }[], style: EditStyle): CalloutPlacement {
  const total = shots.reduce((n, s) => n + s.frames, 0);
  const blocked: [number, number][] = [
    ...(plan.hook.headline ? [[0, Math.min(total, msToFrames(style.headlineMs))] as [number, number]] : []),
    // Effects never stack: a hook break on frame 0 keeps the first callout (and its pop) off it.
    ...(plan.hook.patternBreak === "zoom_hit" || plan.hook.patternBreak === "flash" ? [[0, style.callouts.clearFrames] as [number, number]] : []),
    [ctaStartFrame(plan, total, style), total],
    ...cutaways.map((c): [number, number] => [c.fromFrame, c.fromFrame + c.durationInFrames + style.callouts.clearFrames]),
  ];
  const beats = new Map(plan.beats.map((b) => [b.id, b]));
  const minFrames = msToFrames(style.callouts.minMs);
  const maxFrames = msToFrames(style.callouts.durationMs);
  const placed: PlacedCallout[] = [];
  const warnings: string[] = [];
  for (const [id, span] of beatSpans(shots)) {
    const callout = beats.get(id)?.callout;
    if (!callout) continue;
    let free: [number, number][] = [span];
    for (const [a, b] of blocked) {
      free = free.flatMap(([s, e]): [number, number][] => (b <= s || a >= e ? [[s, e]] : [...(a > s ? [[s, a] as [number, number]] : []), ...(b < e ? [[b, e] as [number, number]] : [])]));
    }
    const slot = free.find(([s, e]) => e - s >= minFrames);
    if (!slot) {
      warnings.push(`The callout in ${id} was dropped: the hook headline, a cutaway or the CTA card covers its beat.`);
      continue;
    }
    placed.push({ beatId: id, text: callout.text, fromFrame: slot[0], durationInFrames: Math.min(maxFrames, slot[1] - slot[0]) });
  }
  return { placed, warnings };
}

/** The placement compileFootage makes, for the review page and generation notes. */
export function planCallouts(plan: Pick<EditPlan, "beats" | "hook" | "ending" | "source">, words: Word[], style: EditStyle): CalloutPlacement {
  const shots = planShots(plan, words, style);
  return placeCallouts(plan, shots, placeCutaways(plan, shots, style).placed, style);
}

/**
 * Where the badge goes. Never over the face, and never near the captions, which sit below the face:
 * 1. Centred just above the face when its top edge stays below the top safe area.
 * 2. Otherwise in the top band, on the side with room beside the face.
 * 3. Otherwise nowhere (null).
 * No face: centred at noFaceTopPct.
 */
export function calloutSpot(face: ScreenRect | null, p: EditStyle["callouts"]): CalloutSpot | null {
  if (!face) return { topPct: p.noFaceTopPct, align: "center" };
  const h = p.heightPct / 100;
  const gap = p.gapPct / 100;
  const safe = p.topSafePct / 100;
  const above = face.top - gap - h / 2;
  if (above - h / 2 >= safe) return { topPct: toHalf(above * 100), align: "center" };
  const pad = p.sidePadPct / 100;
  const leftRoom = face.left - gap - pad;
  const rightRoom = 1 - pad - face.right - gap;
  if (Math.max(leftRoom, rightRoom) < p.sideWidthPct / 100) return null;
  return { topPct: toHalf((safe + h / 2) * 100), align: rightRoom >= leftRoom ? "right" : "left" };
}

import type { Cutaway, CutawaySource, EditPlan } from "../schema/edit-plan";
import type { FootageExtra } from "../schema/footage";
import type { Word } from "../schema/timeline";
import { ctaStartFrame, framesToMs, msToFrames, planShots, type PlannedShot } from "./shots";
import type { EditStyle } from "./style";
import { plural } from "../plural";

export type PlacedCutaway = { beatId: string; source: CutawaySource; layout: "full" | "split"; fromFrame: number; durationInFrames: number; pulled: boolean };
export type CutawayPlacement = { placed: PlacedCutaway[]; warnings: string[] };

const secs = (frames: number) => (framesToMs(frames) / 1000).toFixed(1);

/**
 * Spec §5.4–5.5, in reel order (the B-roll break's cutaway first): place at beat start + atMs, clip to the beat,
 * never overlap the previous cutaway, never under the CTA card, full cutaways cover at most (1 − minSpeakerShare) of
 * the reel. Shortened below minMs: dropped. Every trim or drop is a warning.
 */
export function placeCutaways(plan: Pick<EditPlan, "beats" | "hook" | "ending" | "source">, shots: PlannedShot[], style: EditStyle): CutawayPlacement {
  const total = shots.reduce((n, s) => n + s.frames, 0);
  const ctaStart = ctaStartFrame(plan, total, style);
  const spans = new Map<string, [number, number]>();
  let at = 0;
  for (const s of shots) {
    const span = spans.get(s.beatId);
    spans.set(s.beatId, span ? [span[0], at + s.frames] : [at, at + s.frames]);
    at += s.frames;
  }
  const beats = new Map(plan.beats.map((b) => [b.id, b]));
  const order = [...spans.keys()].filter((id) => beats.get(id)?.cutaway);
  const pullId = plan.hook.patternBreak === "broll" ? order[0] : undefined;
  const minFrames = msToFrames(style.cutaways.minMs);
  const maxFull = Math.floor(total * (1 - style.cutaways.minSpeakerShare));
  const share = `at least ${Math.round(style.cutaways.minSpeakerShare * 100)}% of the reel must show you`;
  const placed: PlacedCutaway[] = [];
  const warnings: string[] = [];
  let prevEnd = 0;
  let fullUsed = 0;
  for (const id of order) {
    const c = beats.get(id)!.cutaway!;
    const pulled = id === pullId;
    const [beatStart, beatEnd] = pulled ? [0, total] : spans.get(id)!;
    const wanted = msToFrames(pulled ? style.cutaways.brollBreakMs : c.durationMs);
    const layout = pulled ? "full" : c.layout;
    let from = pulled ? 0 : beatStart + msToFrames(c.atMs);
    let why = "";
    if (from >= beatEnd) why = "it starts after its beat ends once pauses are cut";
    else if (from + wanted > beatEnd) why = "it ran past the end of its beat";
    const extra = c.source.kind === "upload" ? plan.source.extras.find((e) => e.assetId === (c.source as { assetId: string }).assetId) : undefined;
    const clipCap = extra?.kind === "video" ? msToFrames(extra.durationMs) : Infinity;
    let end = Math.min(from + wanted, beatEnd, from + clipCap);
    if (from + clipCap < Math.min(from + wanted, beatEnd)) why = `the uploaded clip is only ${(extra!.durationMs / 1000).toFixed(1)} s long`;
    if (from < prevEnd) {
      from = prevEnd;
      why = "it overlapped the previous cutaway";
    }
    if (end > ctaStart) {
      end = ctaStart;
      why = "it ran under the CTA card";
    }
    if (layout === "full" && fullUsed + (end - from) > maxFull) {
      end = from + Math.max(0, maxFull - fullUsed);
      why = share;
    }
    const len = end - from;
    if (len < minFrames) {
      warnings.push(`The cutaway in ${id} was dropped: ${why || "it is too short"}.`);
      continue;
    }
    if (len < wanted) warnings.push(`The cutaway in ${id} was shortened to ${secs(len)} s: ${why}.`);
    placed.push({ beatId: id, source: c.source, layout, fromFrame: from, durationInFrames: len, pulled });
    prevEnd = end;
    if (layout === "full") fullUsed += len;
  }
  return { placed, warnings };
}

/** Slot shapes: full 1080×1920, split top half 1080×960. AI media is made 9:16 and always covers. */
export function cutawayFit(source: CutawaySource, extras: FootageExtra[], layout: "full" | "split", ratio: number): "cover" | "contain_blur" {
  if (source.kind !== "upload") return "cover";
  const e = extras.find((x) => x.assetId === source.assetId);
  if (!e) return "cover";
  const r = e.width / e.height / (layout === "full" ? 1080 / 1920 : 1080 / 960);
  return r > ratio || r < 1 / ratio ? "contain_blur" : "cover";
}

export function planCutaways(plan: Pick<EditPlan, "beats" | "hook" | "ending" | "source">, words: Word[], style: EditStyle): CutawayPlacement {
  return placeCutaways(plan, planShots(plan, words, style), style);
}

export type CutawayBudget = { max: number; maxVideo: number; maxSelf: number };

/** Spec §4.3 as amended by the look pass: about one cutaway every 3 s and one clip every 7.5 s. Code enforces it with applyCutawayBudget. */
export function cutawayBudget(targetSec: number, hasCharacter: boolean): CutawayBudget {
  return { max: Math.round(targetSec / 3), maxVideo: Math.floor(targetSec / 7.5), maxSelf: hasCharacter ? Math.max(1, Math.floor(targetSec / 20)) : 0 };
}

/**
 * Counts kept beats only, in beat order: AI shots of you past maxSelf go first, then cutaways past max, then clips past
 * maxVideo become stills. Without a character (maxSelf 0) dropped beats lose their AI shots of you too, silently: the
 * schema rejects ai_self on any beat when no character is picked.
 */
export function applyCutawayBudget<B extends { id: string; keep: boolean; cutaway?: Cutaway }>(beats: B[], budget: CutawayBudget, targetSec: number): { beats: B[]; warnings: string[] } {
  const strip = (b: B): B => {
    const { cutaway: _drop, ...rest } = b;
    return rest as B;
  };
  let self = 0;
  let selfRemoved = 0;
  let count = 0;
  let removed = 0;
  let videos = 0;
  let stilled = 0;
  const out = beats.map((b) => {
    const c = b.cutaway;
    if (!c) return b;
    if (!b.keep) return c.source.kind === "ai_self" && budget.maxSelf === 0 ? strip(b) : b;
    if (c.source.kind === "ai_self" && ++self > budget.maxSelf) {
      selfRemoved++;
      return strip(b);
    }
    if (++count > budget.max) {
      removed++;
      return strip(b);
    }
    const s = c.source;
    if ((s.kind === "ai_broll" || s.kind === "ai_self") && s.media === "video" && ++videos > budget.maxVideo) {
      stilled++;
      return { ...b, cutaway: { ...c, source: { ...s, media: "image" as const } } };
    }
    return b;
  });
  const warnings = [
    ...(selfRemoved ? [`${plural(selfRemoved, "AI shot of you was", "AI shots of you were")} removed (${budget.maxSelf === 0 ? "no character is picked" : `at most ${budget.maxSelf} for a ${targetSec} s reel`}).`] : []),
    ...(removed ? [`${plural(removed, "cutaway was", "cutaways were")} removed (at most ${budget.max} for a ${targetSec} s reel).`] : []),
    ...(stilled ? [`${plural(stilled, "video cutaway became a still", "video cutaways became stills")} (at most ${plural(budget.maxVideo, "video clip", "video clips")} for a ${targetSec} s reel).`] : []),
  ];
  return { beats: out, warnings };
}

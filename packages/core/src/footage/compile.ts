import { FPS } from "../assemble";
import { ceilToCent, DEFAULT_COST_TABLE, estimateFootageCost, estimateReelSeconds, type CostTable } from "../cost";
import type { EditPlan } from "../schema/edit-plan";
import type { FaceBox, FaceTrack, Transcript } from "../schema/footage";
import { TimelineSchema, type SfxName, type Timeline, type TimelineClip, type TimelineCrop, type TimelineCutaway, type Word } from "../schema/timeline";
import { placeCaptionPages, screenChinY, type FaceSpan } from "./caption-place";
import { addSnaps, applyBreaks, pickBreaks } from "./breaks";
import { pageWords, type ReelWord } from "./captions";
import { cutawayFit, cutawayTransitions, placeCutaways, type PlacedCutaway } from "./cutaways";
import { faceAt } from "./face-track";
import { centerFor, ctaStartFrame, framesToMs, maxScaleFor, msToFrames, planShots, shotCrop } from "./shots";
import type { EditStyle } from "./style";

export type FootageAssets = { videoSrc: string; voiceSrc?: string; musicSrc?: string; sfx: Partial<Record<SfxName, string>>; cutaways?: Record<string, { kind: "image" | "video"; src: string }> };
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

/** Still drift directions, cycled per still: right, up, left, down. */
const DRIFTS: [number, number][] = [[1, 0], [0, -1], [-1, 0], [0, 1]];

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
  const { placed } = placeCutaways(plan, planShots(plan, words, style), style);
  const credits = ceilToCent(estimateFootageCost(plan, estimateReelSeconds(durationMs), table, placed));
  return { ...plan, estimate: { durationSec, credits } };
}

/** The edit compiler (spec §5): deterministic, no I/O. Cutaways (full, split, B-roll break) are placed by placeCutaways and emitted as timeline layers. */
export function compileFootage(plan: EditPlan, transcript: Transcript, faceTrack: FaceTrack | null, assets: FootageAssets, style: EditStyle): CompiledFootage {
  const words = transcript.words;
  const shots = planShots(plan, words, style);
  if (!shots.length) throw new EmptyEditError();
  const total = shots.reduce((n, s) => n + s.frames, 0);
  const placement = placeCutaways(plan, shots, style);
  // A cutaway whose asset generation skipped is left out: the speaker stays on screen there.
  const shown = placement.placed.filter((c) => c.source.kind === "diagram" || assets.cutaways?.[c.beatId]);
  const wanted = plan.ending.kind === "loop" && plan.hook.patternBreak === "flash" ? "none" : plan.hook.patternBreak;
  // A B-roll opening with its cutaway left out would whoosh over nothing on frame 0: punch in on the speaker instead.
  const patternBreak = wanted === "broll" && !shown.some((c) => c.pulled) ? "zoom_hit" : wanted;

  const clips: TimelineClip[] = [];
  const faces: (FaceBox | null)[] = [];
  const reelWords: ReelWord[] = [];
  const voiceSegments: VoiceSegment[] = [];
  let at = 0;
  shots.forEach((shot, i) => {
    // Source spans come from the shot's frames (never re-derived from word times), keeping planShots' guarantees:
    // no source frame plays twice and no cut word is heard.
    const inMs = framesToMs(shot.inFrame);
    const face = faceTrack ? faceAt(faceTrack, framesToMs(shot.inFrame + shot.speechFrames / 2)) : null;
    faces.push(face);
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

  const ctaStart = ctaStartFrame(plan, total, style);
  const picked = pickBreaks(
    clips.map((c) => ({ fromFrame: c.fromFrame, frames: c.durationInFrames })),
    style.breaks,
    [[ctaStart, total], ...shown.map((c): [number, number] => [c.fromFrame, c.fromFrame + c.durationInFrames])],
    shown.map((c) => c.fromFrame),
  );
  const patternBreaks = applyBreaks(clips, picked, faces, style);
  addSnaps(clips, style);
  const { clips: finalClips, faces: finalFaces } = splitForCutaways(clips, faces, shown.filter((c) => c.layout === "split"));
  const transitions = cutawayTransitions(shown, style);
  let still = 0;
  const drift = (v: number) => (v === 0 ? 0 : r4((v * style.cutaways.driftPct) / 100));
  const cutaways: TimelineCutaway[] = shown.map((c, i) => {
    const media = cutawayMedia(c, plan, assets, style);
    const d = media.kind === "image" ? DRIFTS[still++ % DRIFTS.length] : null;
    return {
      id: c.beatId, fromFrame: c.fromFrame, durationInFrames: c.durationInFrames, layout: c.layout, transition: transitions[i],
      media: d && media.kind === "image" ? { ...media, drift: { x: drift(d[0]), y: drift(d[1]) } } : media,
    };
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
      words: g.map((w) => ({ text: w.text, emphasis: w.idx === beat.emphasisWordIdx, startFrame: msToFrames(w.startMs) })),
      ...(lastOfBeat && beat.emoji ? { emoji: beat.emoji } : {}),
    };
  });

  const spans: FaceSpan[] = finalClips.map((c, i) => ({ fromFrame: c.fromFrame, endFrame: c.fromFrame + c.durationInFrames, chinY: c.layout === "split" ? null : screenChinY(finalFaces[i], c.crop!), split: c.layout === "split" }));
  const tops = placeCaptionPages(pages, spans, style.captionPlacement);
  const placedPages = pages.map((p, i) => ({ ...p, topPct: tops[i] }));

  const headline = plan.hook.headline;
  const hook = {
    patternBreak,
    ...(headline ? { headline: { small: headline.small, big: headline.big, fromFrame: 0, durationInFrames: Math.min(total, msToFrames(style.headlineMs)) } } : {}),
  };
  const ctaFrames = Math.min(total, msToFrames(style.ctaMs));
  const ending =
    plan.ending.kind === "cta"
      ? { kind: "cta" as const, keyword: plan.ending.keyword, fromFrame: ctaStart, durationInFrames: ctaFrames }
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
    patternBreaks.forEach((b, i) => cues.push({ name: whooshes[(i + 1) % 2], frame: b.frame, volumeDb: style.sfxVolumeDb.whoosh }));
    // Look pass: a whoosh on every cutaway that enters with a transition (the B-roll opening shares the hook's).
    shown.forEach((c, i) => {
      if (transitions[i].in === "cut" || cues.some((q) => q.name.startsWith("whoosh") && Math.abs(q.frame - c.fromFrame) <= style.cutaways.backToBackFrames)) return;
      cues.push({ name: i % 2 === 0 ? "whoosh2" : "whoosh1", frame: c.fromFrame, volumeDb: style.cutaways.whooshDb });
    });
    if (ending.kind === "cta") cues.push({ name: pops[pop++ % 2], frame: ending.fromFrame, volumeDb: style.sfxVolumeDb.pop });
    if (plan.sfx === "lively") {
      finalClips.forEach((c, i) => {
        if (i === 0 || c.crop!.scaleFrom === finalClips[i - 1].crop!.scaleFrom) return;
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
    style: { captionPreset: "pill", font: "Heebo", palette: ["#FF3B30", "#FFFFFF"] },
    audio: { voiceUrl: assets.voiceSrc, musicUrl: assets.musicSrc, musicDuckingDb: style.musicUnderVoiceDb },
    clips: finalClips,
    captions: { words: reelWords.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })), pages: placedPages },
    overlays: [],
    hook,
    ending,
    ...(sfx.length ? { sfx } : {}),
    ...(patternBreaks.length ? { patternBreaks } : {}),
    ...(cutaways.length ? { cutaways } : {}),
  });
  return { timeline, voiceSegments, durationMs: framesToMs(total) };
}

function cutawayMedia(c: PlacedCutaway, plan: EditPlan, assets: FootageAssets, style: EditStyle): TimelineCutaway["media"] {
  if (c.source.kind === "diagram") return { kind: "diagram", template: c.source.template, items: c.source.items };
  const a = assets.cutaways![c.beatId];
  const fit = cutawayFit(c.source, plan.source.extras, c.layout, style.cutaways.contentFitRatio);
  return a.kind === "image" ? { kind: "image", src: a.src, fit, kenBurns: style.cutaways.kenBurns } : { kind: "video", src: a.src, fit };
}

/**
 * The crop for a piece covering frames offset..offset+len-1 of a clip that is `frames` long: the clip's zoom
 * (linear over frames - 1, or over punchFrames then held) sampled at the piece's first and last frame, so the zoom
 * is continuous across pieces and no piece squeezes the whole push-in into its shorter length.
 */
function pieceCrop(crop: TimelineCrop, offset: number, len: number, frames: number): TimelineCrop {
  if (offset === 0 && len === frames) return crop;
  const { punchFrames, ...rest } = crop;
  const span = punchFrames ?? Math.max(1, frames - 1);
  const at = (t: number) => r4(crop.scaleFrom + (crop.scaleTo - crop.scaleFrom) * Math.min(1, t / span));
  const scaleFrom = at(offset);
  const scaleTo = offset + len === frames ? crop.scaleTo : at(offset + len - 1);
  if (!punchFrames) return { ...rest, scaleFrom, scaleTo };
  const left = punchFrames - offset;
  return left <= 0 ? { ...rest, scaleFrom: crop.scaleTo, scaleTo: crop.scaleTo } : { ...rest, scaleFrom, scaleTo, punchFrames: Math.min(left, Math.max(1, len - 1)) };
}

/**
 * Cuts speaker clips at split-cutaway boundaries. Pieces under a split cutaway play in the bottom half (layout "split"),
 * cropped 9:8 around the face at scale 1; the other pieces take the clip's zoom over their own span (continuous across pieces). Source spans continue frame-exactly.
 */
function splitForCutaways(clips: TimelineClip[], faces: (FaceBox | null)[], splits: PlacedCutaway[]): { clips: TimelineClip[]; faces: (FaceBox | null)[] } {
  if (!splits.length) return { clips, faces };
  const outClips: TimelineClip[] = [];
  const outFaces: (FaceBox | null)[] = [];
  const inSplit = (f: number) => splits.some((s) => f >= s.fromFrame && f < s.fromFrame + s.durationInFrames);
  clips.forEach((clip, i) => {
    const start = clip.fromFrame;
    const end = start + clip.durationInFrames;
    const cuts = [...new Set(splits.flatMap((s) => [s.fromFrame, s.fromFrame + s.durationInFrames]).filter((f) => f > start && f < end))].sort((a, b) => a - b);
    const bounds = [start, ...cuts, end];
    for (let k = 0; k < bounds.length - 1; k++) {
      const from = bounds[k];
      const len = bounds[k + 1] - from;
      const offset = from - start;
      const inMs = r3(clip.source!.inMs + framesToMs(offset));
      const face = faces[i];
      const piece: TimelineClip = {
        ...clip,
        sceneId: k === 0 ? clip.sceneId : `${clip.sceneId}.${k + 1}`,
        fromFrame: from,
        durationInFrames: len,
        source: { inMs, outMs: r3(inMs + framesToMs(len)) },
      };
      if (offset > 0) delete piece.enter;
      if (inSplit(from)) {
        delete piece.enter;
        piece.layout = "split";
        piece.crop = { cx: 0.5, cy: face ? r4(Math.min(0.75, Math.max(0.25, face.y + face.h / 2))) : 0.5, scaleFrom: 1, scaleTo: 1 };
      } else {
        piece.crop = pieceCrop(clip.crop!, offset, len, clip.durationInFrames);
      }
      outClips.push(piece);
      outFaces.push(face);
    }
  });
  return { clips: outClips, faces: outFaces };
}

import { describe, expect, it } from "vitest";
import { estimateFootageCost, estimateReelSeconds } from "../cost";
import { TimelineSchema } from "../schema/timeline";
import { parseEditPlan, type EditPlan } from "../schema/edit-plan";
import { faceTrackFixture, footageTranscript, testEditStyle, validEditPlan } from "../testing/fixtures";
import { compileFootage, EmptyEditError, footageDurationMs, withFootageEstimate, type FootageAssets } from "./compile";
import { framesToMs, planShots } from "./shots";

const style = testEditStyle();
const transcript = footageTranscript();
const ALL_SFX = { whoosh1: "w1.wav", whoosh2: "w2.wav", pop1: "p1.wav", pop2: "p2.wav", tick: "t.wav", riser: "r.wav", ding: "d.wav", swoosh_out: "s.wav" };
const assets: FootageAssets = { videoSrc: "asset:work.mp4", voiceSrc: "asset:voice.wav", sfx: ALL_SFX };
const plan = (over: Partial<EditPlan> = {}) => parseEditPlan({ ...validEditPlan(), ...over });
const compile = (p = plan(), face = faceTrackFixture()) => compileFootage(p, transcript, face, assets, style);

describe("compileFootage", () => {
  it("lays speaker clips back to back on the planned shots", () => {
    const { timeline, durationMs } = compile();
    expect(TimelineSchema.safeParse(timeline).success).toBe(true);
    expect(timeline.clips.map((c) => [c.sceneId, c.kind, c.fromFrame, c.durationInFrames])).toEqual([
      ["b1-1", "speaker", 0, 26], ["b1-2", "speaker", 26, 63], ["b2-1", "speaker", 89, 57], ["b3-1", "speaker", 146, 72],
    ]);
    expect(timeline.durationInFrames).toBe(218);
    expect(durationMs).toBeCloseTo((218 * 1000) / 30, 6);
    expect(timeline.clips.every((c) => c.src === "asset:work.mp4" && c.layout === undefined)).toBe(true);
    expect(timeline.clips[1].source!.inMs).toBeCloseTo(1466.667, 2);
  });

  it("takes each clip's source span from the planned shot's frames, so no source frame plays twice", () => {
    for (const p of [plan(), plan({ hook: { ...validEditPlan().hook, coldOpenBeatId: "b2" } }), plan({ ending: { kind: "loop" } })]) {
      const shots = planShots(p, transcript.words, style);
      const clips = compileFootage(p, transcript, faceTrackFixture(), assets, style).timeline.clips;
      clips.forEach((c, i) => {
        expect(c.source!.inMs).toBeCloseTo(framesToMs(shots[i].inFrame), 2);
        expect(c.source!.outMs).toBeCloseTo(framesToMs(shots[i].inFrame + shots[i].frames), 2);
        expect(c.source!.outMs - c.source!.inMs).toBeCloseTo(framesToMs(c.durationInFrames), 2);
      });
      for (let i = 0; i < clips.length; i++) {
        for (let j = i + 1; j < clips.length; j++) {
          const [a, b] = [clips[i].source!, clips[j].source!];
          expect(a.outMs <= b.inMs + 1e-6 || b.outMs <= a.inMs + 1e-6).toBe(true);
        }
      }
    }
  });

  it("returns the voice segments for the cut audio, without the CTA extension", () => {
    const segs = compile().voiceSegments.map((s) => [Math.round(s.inMs), Math.round(s.outMs)]);
    expect(segs).toEqual([[0, 867], [1467, 3567], [4167, 6067], [6600, 8267]]);
  });

  it("remaps caption words from source time to reel time", () => {
    const words = compile().timeline.captions.words;
    expect(words.map((w) => w.text)).toEqual(["היי", "חברים,", "היום", "אני", "אראה", "לכם", "טריק.", "זה", "חוסך", "שעות", "עבודה.", "תכתבו", "AI", "בתגובות."]);
    expect(words[2].startMs).toBe(900); // "היום": shot b1-2 starts at reel 866.7 ms and source 1466.7 ms
    expect(words[7].startMs).toBe(3000); // "זה"
    for (let i = 1; i < words.length; i++) expect(words[i].startMs).toBeGreaterThanOrEqual(words[i - 1].startMs);
  });

  it("builds pill caption pages with the red word and the emoji", () => {
    const pages = compile().timeline.captions.pages!;
    expect(pages.map((p) => p.words.map((w) => w.text).join(" "))).toEqual(["היי חברים,", "היום אני אראה", "לכם טריק.", "זה חוסך שעות", "עבודה.", "תכתבו AI בתגובות."]);
    expect(pages[2].words.map((w) => w.emphasis)).toEqual([false, true]);
    expect(pages[4].emoji).toBe("👇");
    expect(pages.filter((p) => p.emoji)).toHaveLength(1);
    for (let i = 0; i < pages.length - 1; i++) expect(pages[i].fromFrame + pages[i].durationInFrames).toBe(pages[i + 1].fromFrame);
    expect(pages.at(-1)!.fromFrame + pages.at(-1)!.durationInFrames).toBe(196); // speech ends 22 frames before the end
  });

  it("adds the hook: headline over 0–2 s and a zoom hit on the first shot", () => {
    const { timeline } = compile();
    expect(timeline.hook).toEqual({ patternBreak: "zoom_hit", headline: { small: "הטריק ש", big: "חוסך שעות", fromFrame: 0, durationInFrames: 60 } });
    expect(timeline.clips[0].crop).toMatchObject({ scaleFrom: 1, scaleTo: 1.3, punchFrames: 6 });
  });

  it("zooms by shot, centred on the face", () => {
    const crops = compile().timeline.clips.map((c) => c.crop!);
    expect(crops.slice(1).map((c) => [c.scaleFrom, c.scaleTo, c.cx, c.cy])).toEqual([[1.15, 1.242, 0.5, 0.4026], [1.25, 1.25, 0.5, 0.4], [1, 1.08, 0.5, 0.463]]);
    const centred = compileFootage(plan(), transcript, null, assets, style).timeline.clips.map((c) => [c.crop!.cx, c.crop!.cy]);
    expect(centred.every(([x, y]) => x === 0.5 && y === 0.5)).toBe(true);
  });

  it("CTA: a 2.5 s card at the end", () => {
    expect(compile().timeline.ending).toEqual({ kind: "cta", keyword: "AI", fromFrame: 143, durationInFrames: 75 });
  });

  it("loop: ends on the last word and drops the flash so the replay flows on", () => {
    const { timeline } = compile(plan({ ending: { kind: "loop" }, hook: { patternBreak: "flash", reason: "" } }));
    expect(timeline.ending).toEqual({ kind: "loop" });
    expect(timeline.hook!.patternBreak).toBe("none");
    expect(timeline.durationInFrames).toBe(26 + 63 + 57 + 48);
  });

  it("subtle and lively sound effects, skipping effects that aren't installed", () => {
    const cues = (p: EditPlan, a = assets) => compileFootage(p, transcript, faceTrackFixture(), a, style).timeline.sfx?.map((c) => `${c.name}@${c.frame}`);
    expect(cues(plan())).toEqual(["whoosh1@0", "pop1@12", "pop2@18", "pop1@143"]);
    expect(cues(plan({ sfx: "lively" }))).toEqual(["whoosh1@0", "pop1@12", "pop2@18", "tick@26", "tick@89", "pop1@143"]);
    expect(cues(plan({ sfx: "off" }))).toBeUndefined();
    expect(cues(plan(), { ...assets, sfx: { pop1: "p1.wav" } })).toEqual(["pop1@12", "pop1@143"]);
  });

  it("uses the music bed level and the pill preset", () => {
    const { timeline } = compileFootage(plan(), transcript, null, { ...assets, musicSrc: "asset:m.wav" }, style);
    expect(timeline.audio).toEqual({ voiceUrl: "asset:voice.wav", musicUrl: "asset:m.wav", musicDuckingDb: -12 });
    expect(timeline.style.captionPreset).toBe("pill");
    expect(timeline.direction).toBe("rtl");
  });

  it("refuses an edit with nothing left to show", () => {
    const fillers = { ...transcript, words: [{ text: "אממ", startMs: 0, endMs: 500 }, { text: "אהה", startMs: 900, endMs: 1600 }] };
    const p = plan({ beats: [{ id: "b1", startWordIdx: 0, endWordIdx: 1, keep: true }], hook: { patternBreak: "none", reason: "" } });
    expect(() => compileFootage(p, fillers, null, assets, style)).toThrow(EmptyEditError);
    expect(() => compileFootage(p, fillers, null, assets, style)).toThrow(/Keep at least one beat with speech/);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(compile())).toBe(JSON.stringify(compile()));
  });
});

describe("estimate", () => {
  it("matches the compiled length and prices AI music per second", () => {
    expect(footageDurationMs(plan(), transcript.words, style)).toBeCloseTo(compile().durationMs, 6);
    expect(withFootageEstimate(plan(), transcript.words, style).estimate).toEqual({ durationSec: 7.3, credits: 0 });
    expect(withFootageEstimate(plan({ music: { kind: "ai", prompt: "calm lo-fi" } }), transcript.words, style).estimate).toEqual({ durationSec: 7.3, credits: 0.08 });
  });

  it("bills music on the shared estimateReelSeconds rule, so generation's check against the estimate agrees", () => {
    const ai = plan({ music: { kind: "ai", prompt: "calm lo-fi" } });
    const ms = footageDurationMs(ai, transcript.words, style);
    expect(withFootageEstimate(ai, transcript.words, style).estimate.credits).toBeCloseTo(estimateFootageCost(ai, estimateReelSeconds(ms)), 9);
  });
});

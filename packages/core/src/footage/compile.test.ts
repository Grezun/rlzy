import { describe, expect, it } from "vitest";
import { ceilToCent, estimateFootageCost, estimateReelSeconds } from "../cost";
import { TimelineSchema } from "../schema/timeline";
import { parseEditPlan, type EditPlan } from "../schema/edit-plan";
import { faceTrackFixture, footageTranscript, lowFaceTrackFixture, testEditStyle, validEditPlan } from "../testing/fixtures";
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
    const cost = estimateFootageCost(ai, estimateReelSeconds(ms));
    const credits = withFootageEstimate(ai, transcript.words, style).estimate.credits;
    // Rounded up to the cent, so generation's "cost > estimate" check never skips approved music.
    expect(credits).toBe(ceilToCent(cost));
    expect(credits).toBeGreaterThanOrEqual(cost);
    expect(credits - cost).toBeLessThan(0.01);
  });

  it("rounds a sub-cent music price up, never down", () => {
    const ai = plan({ music: { kind: "ai", prompt: "calm lo-fi" } });
    // 8 billed seconds × $0.0101 = $0.0808: rounding to nearest would give 0.08 and skip the approved music.
    expect(withFootageEstimate(ai, transcript.words, style, { "elevenlabs/music": { perSecond: 0.0101 } }).estimate.credits).toBe(0.09);
  });
});

describe("pill caption placement and word timing", () => {
  it("keeps the pill at 55 % when the face is high (the reference framing)", () => {
    expect(compile().timeline.captions.pages!.every((p) => p.topPct === 55)).toBe(true);
  });
  it("moves the pill below a low face (camera below the face), within 55–72 %", () => {
    const pages = compile(plan(), lowFaceTrackFixture()).timeline.captions.pages!;
    expect(pages[0].topPct).toBe(72);
    for (const p of pages) {
      expect(p.topPct).toBeGreaterThanOrEqual(55);
      expect(p.topPct).toBeLessThanOrEqual(72);
    }
  });
  it("uses 60 % without a face track", () => {
    expect(compileFootage(plan(), transcript, null, assets, style).timeline.captions.pages!.every((p) => p.topPct === 60)).toBe(true);
  });
  it("gives every caption word its reel start frame", () => {
    expect(compile().timeline.captions.pages![1].words.map((w) => w.startFrame)).toEqual([27, 41, 50]);
  });
});

/** 60 words of 400 ms with 100 ms gaps (no cut inside a beat), 6 beats of 10 words: shots start every 5 s. */
const longTalk = () => ({
  languageCode: "heb", languageProbability: 0.98, events: [],
  words: Array.from({ length: 60 }, (_, i) => ({ text: `מילה${i}`, startMs: i * 500, endMs: i * 500 + 400 })),
});
const longPlan = (over: Partial<EditPlan> = {}) => parseEditPlan({
  ...validEditPlan(),
  source: { ...validEditPlan().source, durationMs: 30_000 },
  beats: Array.from({ length: 6 }, (_, i) => ({ id: `b${i + 1}`, startWordIdx: i * 10, endWordIdx: i * 10 + 9, keep: true })),
  hook: { patternBreak: "none", reason: "" },
  ending: { kind: "none" },
  ...over,
});

describe("motion", () => {
  it("snaps punch-in cuts, never punch-outs or the first shot", () => {
    expect(compile().timeline.clips.map((c) => c.enter?.kind)).toEqual([undefined, "snap", "snap", undefined]);
  });
  it("adds a pattern break about every 10 s with a whoosh each: zoom blur, then zoom hit", () => {
    const { timeline } = compileFootage(longPlan(), longTalk(), null, assets, style);
    expect(timeline.clips.map((c) => c.fromFrame)).toEqual([0, 149, 299, 449, 599, 749]);
    expect(timeline.patternBreaks).toEqual([{ frame: 299, kind: "zoom_blur" }, { frame: 599, kind: "zoom_hit" }]);
    expect(timeline.clips[2].enter).toEqual({ kind: "zoom_blur", frames: 6 });
    expect(timeline.clips[4].crop).toMatchObject({ scaleFrom: 1.15, scaleTo: 1.38, punchFrames: 6 });
    expect(timeline.clips.map((c) => c.enter?.kind)).toEqual([undefined, "snap", "zoom_blur", undefined, undefined, "snap"]);
    expect(timeline.sfx?.map((c) => `${c.name}@${c.frame}`)).toEqual(["whoosh2@299", "whoosh1@599"]);
  });
  it("never breaks under the CTA card", () => {
    // b6 split in two: the cut at word 58 (≈ frame 868) lands in the 8–12 s window after the break at 599 and inside the last 2.5 s.
    const beats = [...longPlan().beats.slice(0, 5), { id: "b6", startWordIdx: 50, endWordIdx: 57, keep: true }, { id: "b7", startWordIdx: 58, endWordIdx: 59, keep: true }];
    const open = compileFootage(longPlan({ beats }), longTalk(), null, assets, style).timeline;
    const lateCut = open.clips.at(-1)!.fromFrame;
    expect(open.patternBreaks!.map((b) => b.frame)).toEqual([299, 599, lateCut]);
    const cta = compileFootage(longPlan({ beats, ending: { kind: "cta", keyword: "AI" } }), longTalk(), null, assets, style).timeline;
    const ctaFrom = cta.ending?.kind === "cta" ? cta.ending.fromFrame : -1;
    expect(lateCut).toBeGreaterThanOrEqual(ctaFrom);
    expect(cta.patternBreaks!.map((b) => b.frame)).toEqual([299, 599]);
  });
  it("a short reel has no breaks", () => {
    expect(compile().timeline.patternBreaks).toBeUndefined();
  });
});

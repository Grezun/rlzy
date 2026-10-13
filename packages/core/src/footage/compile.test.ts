import { describe, expect, it } from "vitest";
import { ceilToCent, estimateFootageCost, estimateReelSeconds } from "../cost";
import { TimelineSchema } from "../schema/timeline";
import { parseEditPlan, type EditPlan } from "../schema/edit-plan";
import { EXTRA_IMG, faceTrackFixture, fixtureExtras, footageTranscript, lowFaceTrackFixture, testEditStyle, validEditPlan } from "../testing/fixtures";
import { cutawayBudget, planCutaways } from "./cutaways";
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
  it("prices a 30 s reel at the full budget: 10 cutaways, 4 of them clips", () => {
    const words = Array.from({ length: 60 }, (_, i) => ({ text: `מילה${i}`, startMs: i * 500, endMs: i * 500 + 400 }));
    const cut = (media: "image" | "video") => ({ source: { kind: "ai_broll" as const, prompt: "laptop", media }, layout: "full" as const, atMs: 0, durationMs: 1500 });
    const budget = cutawayBudget(30, false);
    const p = parseEditPlan({
      ...validEditPlan(),
      targetDurationSec: 30,
      source: { ...validEditPlan().source, durationMs: 30_000 },
      beats: Array.from({ length: budget.max }, (_, i) => ({ id: `b${i + 1}`, startWordIdx: i * 6, endWordIdx: i * 6 + 5, keep: true, cutaway: cut(i % 3 === 0 ? "video" : "image") })),
      hook: { patternBreak: "none", reason: "" },
      ending: { kind: "none" },
    });
    expect(planCutaways(p, words, style).placed).toHaveLength(10);
    // 4 clips × ($0.04 still + 4 billed s × $0.08) + 6 stills × $0.04
    expect(withFootageEstimate(p, words, style).estimate.credits).toBe(1.68);
  });
  it("prices only the cutaways that will be placed", () => {
    const cut = (media: "image" | "video", atMs = 0) => ({ source: { kind: "ai_broll" as const, prompt: "laptop", media }, layout: "full" as const, atMs, durationMs: 2000 });
    const p = plan({ beats: validEditPlan().beats.map((b) => (b.id === "b1" ? { ...b, cutaway: cut("video") } : b.id === "b2" ? { ...b, cutaway: cut("image") } : { ...b, cutaway: cut("video") })) });
    // b3's clip falls under the CTA card and is dropped, so it costs nothing.
    expect(withFootageEstimate(p, transcript.words, style).estimate.credits).toBe(0.4);
  });

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

describe("cutaways", () => {
  const still = (layout: "full" | "split", atMs = 0, durationMs = 1500) => ({ source: { kind: "ai_broll" as const, prompt: "laptop", media: "image" as const }, layout, atMs, durationMs });
  const on = (beatId: string, cutaway: unknown, over: object = {}) => plan({ beats: validEditPlan().beats.map((b) => (b.id === beatId ? { ...b, cutaway } : b)) as EditPlan["beats"], ...over });
  const withArt = { ...assets, cutaways: { b1: { kind: "image" as const, src: "asset:b1.png" }, b2: { kind: "image" as const, src: "asset:b2.png" } } };

  it("full: a cutaway layer over the speaker (who stays underneath), with a whoosh", () => {
    const { timeline } = compileFootage(on("b2", still("full")), transcript, faceTrackFixture(), withArt, style);
    expect(timeline.cutaways).toEqual([{
      id: "b2", fromFrame: 89, durationInFrames: 45, layout: "full", transition: { in: "whip", out: "whip" },
      media: { kind: "image", src: "asset:b2.png", fit: "cover", kenBurns: 1.12, drift: { x: 0.03, y: 0 } },
    }]);
    expect(timeline.clips.map((c) => c.sceneId)).toEqual(["b1-1", "b1-2", "b2-1", "b3-1"]);
    expect(timeline.sfx).toContainEqual({ name: "whoosh2", frame: 89, src: "w2.wav", volumeDb: -14 });
  });

  it("split: the speaker clip is cut at the cutaway's end, the split part is cropped around the face, captions sit on the seam", () => {
    const { timeline, voiceSegments } = compileFootage(on("b2", still("split")), transcript, faceTrackFixture(), withArt, style);
    const [split, rest] = timeline.clips.filter((c) => c.sceneId.startsWith("b2-1"));
    expect([split.sceneId, split.fromFrame, split.durationInFrames, split.layout]).toEqual(["b2-1", 89, 45, "split"]);
    expect(split.crop).toEqual({ cx: 0.5, cy: 0.285, scaleFrom: 1, scaleTo: 1 });
    expect([rest.sceneId, rest.fromFrame, rest.durationInFrames, rest.layout]).toEqual(["b2-1.2", 134, 12, undefined]);
    expect(rest.source!.inMs).toBeCloseTo(split.source!.inMs + 1500, 2);
    expect(rest.source!.outMs).toBeCloseTo(split.source!.inMs + (57 * 1000) / 30, 2);
    expect(timeline.captions.pages![3].topPct).toBe(50);
    expect(voiceSegments).toEqual(compile().voiceSegments); // the voice never changes
    expect(timeline.cutaways![0].transition).toEqual({ in: "slide", out: "slide" });
    expect(timeline.sfx?.map((c) => `${c.name}@${c.frame}`)).toContain("whoosh2@89");
  });

  it("B-roll pattern break: the first cutaway opens the reel, full screen, 1 s, and the first shot doesn't punch", () => {
    const { timeline } = compileFootage(on("b2", still("split"), { hook: { ...validEditPlan().hook, patternBreak: "broll" } }), transcript, faceTrackFixture(), withArt, style);
    expect(timeline.cutaways!.map((c) => [c.id, c.fromFrame, c.durationInFrames, c.layout])).toEqual([["b2", 0, 30, "full"]]);
    expect(timeline.hook!.patternBreak).toBe("broll");
    expect(timeline.clips[0].crop!.punchFrames).toBeUndefined();
    expect(timeline.cutaways![0].transition).toEqual({ in: "cut", out: "whip" });
    expect(timeline.sfx!.filter((c) => c.frame === 0).map((c) => c.name)).toEqual(["whoosh1"]); // the hook's whoosh only, never doubled
  });

  it("drifts each still a different way (right, up, left, down) and never drifts clips", () => {
    const four = plan({
      ending: { kind: "none" }, hook: { patternBreak: "none", reason: "" },
      beats: validEditPlan().beats.map((b) => ({ ...b, cutaway: still("split", 0, 1000) })) as EditPlan["beats"],
    });
    const art = { ...assets, cutaways: { b1: { kind: "image" as const, src: "asset:1.png" }, b2: { kind: "video" as const, src: "asset:2.mp4" }, b3: { kind: "image" as const, src: "asset:3.png" } } };
    const media = compileFootage(four, transcript, faceTrackFixture(), art, style).timeline.cutaways!.map((c) => c.media);
    expect(media.map((m) => (m.kind === "image" ? m.drift : m.kind))).toEqual([{ x: 0.03, y: 0 }, "video", { x: 0, y: -0.03 }]);
  });

  it("B-roll opening whose cutaway was skipped in generation falls back to a zoom hit on the first shot (never a whoosh over nothing)", () => {
    const { timeline } = compileFootage(on("b2", still("split"), { hook: { ...validEditPlan().hook, patternBreak: "broll" } }), transcript, faceTrackFixture(), assets, style);
    expect(timeline.cutaways).toBeUndefined();
    expect(timeline.hook!.patternBreak).toBe("zoom_hit");
    expect(timeline.clips[0].crop).toMatchObject({ scaleFrom: 1, scaleTo: 1.3, punchFrames: 6 });
  });

  it("leaves out a cutaway whose asset is missing (skipped in generation); diagrams need no asset", () => {
    expect(compileFootage(on("b2", still("full")), transcript, null, assets, style).timeline.cutaways).toBeUndefined();
    const diagram = { source: { kind: "diagram", template: "list", items: ["אחת", "שתיים"] }, layout: "full", atMs: 0, durationMs: 1500 };
    expect(compileFootage(on("b2", diagram), transcript, null, assets, style).timeline.cutaways![0].media).toEqual({ kind: "diagram", template: "list", items: ["אחת", "שתיים"] });
  });

  it("fits uploads to their slot and leaves out a cutaway that placement dropped", () => {
    const up = plan({
      source: { ...validEditPlan().source, extras: fixtureExtras() },
      beats: validEditPlan().beats.map((b) => (b.id === "b1" ? { ...b, cutaway: { source: { kind: "upload", assetId: EXTRA_IMG }, layout: "full", atMs: 0, durationMs: 1000 } } : b.id === "b3" ? { ...b, cutaway: still("full") } : b)) as EditPlan["beats"],
    });
    const out = compileFootage(up, transcript, null, { ...assets, cutaways: { b1: { kind: "image", src: "asset:x.png" }, b3: { kind: "image", src: "asset:y.png" } } }, style);
    expect(out.timeline.cutaways![0].media).toMatchObject({ kind: "image", fit: "contain_blur" });
    expect(out.timeline.cutaways!.map((c) => c.id)).toEqual(["b1"]); // b3 ran under the CTA card
  });

  it("zoom stays continuous across the pieces of a clip cut by a split partway in", () => {
    const run = (cutaway?: unknown) => compileFootage(plan({ beats: validEditPlan().beats.map((b) => (cutaway && b.id === "b1" ? { ...b, cutaway } : b)) as EditPlan["beats"], ending: { kind: "none" } }), transcript, faceTrackFixture(), withArt, style).timeline.clips;
    const base = run().find((c) => c.sceneId === "b1-2")!; // frames 26–89, pushes in
    const at = (t: number) => base.crop!.scaleFrom + (base.crop!.scaleTo - base.crop!.scaleFrom) * (t / (base.durationInFrames - 1));
    const pieces = run(still("split", 1000, 1000)).filter((c) => c.sceneId.startsWith("b1-2")); // split at frames 30–60
    expect(pieces.map((c) => [c.sceneId, c.fromFrame, c.durationInFrames, c.layout])).toEqual([["b1-2", 26, 4, undefined], ["b1-2.2", 30, 30, "split"], ["b1-2.3", 60, 29, undefined]]);
    expect(pieces[0].crop!.scaleFrom).toBeCloseTo(at(0), 3);
    expect(pieces[0].crop!.scaleTo).toBeCloseTo(at(3), 3); // not squeezed up to 1.242
    expect(pieces[2].crop!.scaleFrom).toBeCloseTo(at(34), 3);
    expect(pieces[2].crop!.scaleTo).toBeCloseTo(base.crop!.scaleTo, 3);
  });
});

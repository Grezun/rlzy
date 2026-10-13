import { NO_CUTAWAY, parseEditPlan, withFootageEstimate, type DraftCutaway, type EditPlanDraft, type Transcript } from "@reel/core";
import { houseStyle } from "@reel/video/house-style";
import { describe, expect, it, vi } from "vitest";
import { CHARACTER_ID, EXTRA_VID, fixtureExtras, footageTranscript, validEditPlan } from "../../core/src/testing/fixtures";
import { buildEditPlan, createFootagePlanner, footageUserPrompt, transcriptWarnings, type EditDraftModel, type FootagePlanRequest } from "./footage-planner";
import { splitBeats } from "@reel/core";

const style = houseStyle.edit;
const TRACK = "3f2c8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e";
const REQ: FootagePlanRequest = { settings: { language: "he", targetDurationSec: 15, ctaKeyword: "AI" }, source: validEditPlan().source, transcript: footageTranscript(), library: [], warnings: [] };
const draft = (over: Partial<EditPlanDraft> = {}): EditPlanDraft => ({
  title: "טריק שחוסך שעות",
  beats: ["b1", "b2", "b3"].map((id) => ({ id, keep: true, dropReason: "", emphasisWordIdx: id === "b1" ? 7 : -1, emoji: id === "b2" ? "👇" : "", cutaway: NO_CUTAWAY })),
  hook: { coldOpenBeatId: "", headlineSmall: "הטריק ש", headlineBig: "חוסך שעות", patternBreak: "zoom_hit", reason: "A bold promise plus a punch-in." },
  ending: { kind: "cta", keyword: "" },
  music: { kind: "none", trackId: "", prompt: "" },
  sfx: "subtle",
  ...over,
});
const reply = (d: EditPlanDraft | null, stopReason = "end_turn") => ({ stopReason, draft: d, raw: JSON.stringify(d) });

/** 60 words of 300 ms, a sentence every 6 words: ≈ 21 s of speech. */
const longTranscript = (): Transcript => ({
  languageCode: "heb", languageProbability: 0.9, events: [],
  words: Array.from({ length: 60 }, (_, i) => ({ text: i % 6 === 5 ? `מילה${i}.` : `מילה${i}`, startMs: i * 350, endMs: i * 350 + 300 })),
});

describe("buildEditPlan", () => {
  it("turns a draft into the full plan: beat spans, source, keyword, estimate", () => {
    const plan = buildEditPlan(draft(), REQ, splitBeats(REQ.transcript.words), style);
    expect(plan).toEqual(withFootageEstimate(parseEditPlan(validEditPlan()), REQ.transcript.words, style));
    expect(plan.estimate).toEqual({ durationSec: 7.3, credits: 0 });
  });
  it("prices AI music and accepts a library track by id only", () => {
    const beats = splitBeats(REQ.transcript.words);
    expect(buildEditPlan(draft({ music: { kind: "ai", trackId: "", prompt: "calm lo-fi" } }), REQ, beats, style).estimate.credits).toBe(0.08);
    const lib = { ...REQ, library: [{ id: TRACK, title: "Morning", mood: "calm" as const, durationSec: 95 }] };
    expect(buildEditPlan(draft({ music: { kind: "library", trackId: TRACK, prompt: "" } }), lib, beats, style).music).toEqual({ kind: "library", assetId: TRACK });
    expect(() => buildEditPlan(draft({ music: { kind: "library", trackId: "nope", prompt: "" } }), lib, beats, style)).toThrow(/not in the library/);
  });
  it("rejects a non-integer emphasis word (the draft schema sends no integer bounds)", () => {
    const d = draft();
    d.beats[0].emphasisWordIdx = 6.5;
    expect(() => buildEditPlan(d, REQ, splitBeats(REQ.transcript.words), style)).toThrow(/beats\.0\.emphasisWordIdx/);
  });
  it("forces a CTA ending with the user's keyword whatever ending the model chose", () => {
    const beats = splitBeats(REQ.transcript.words);
    for (const kind of ["loop", "none", "cta"] as const) {
      expect(buildEditPlan(draft({ ending: { kind, keyword: "OTHER" } }), REQ, beats, style).ending).toEqual({ kind: "cta", keyword: "AI" });
    }
    const noKeyword = { ...REQ, settings: { language: "he" as const, targetDurationSec: 15 as const } };
    expect(buildEditPlan(draft({ ending: { kind: "loop", keyword: "" } }), noKeyword, beats, style).ending).toEqual({ kind: "loop" });
  });
  it("reports missing and unknown beat ids", () => {
    const d = draft();
    d.beats = [d.beats[0], { ...d.beats[1], id: "b7" }];
    expect(() => buildEditPlan(d, REQ, splitBeats(REQ.transcript.words), style)).toThrow(/missing b2, b3[\s\S]*Unknown beat ids: b7/);
  });
});

describe("footageUserPrompt", () => {
  it("lists beats with word indices, the keyword and the library", () => {
    const u = footageUserPrompt({ ...REQ, library: [{ id: TRACK, title: "Morning", mood: "calm", durationSec: 95 }], settings: { ...REQ.settings, notes: "קצר וקולע" } }, splitBeats(REQ.transcript.words));
    expect(u).toMatch(/Reel language: Hebrew\. Target length: 15 seconds\./);
    expect(u).toMatch(/b1 \(3\.5 s\): 0:היי 1:חברים, 2:אממ 3:היום/);
    expect(u).toMatch(/Comment keyword from the user: "AI"/);
    expect(u).toContain(`- ${TRACK} "Morning" (calm, 95 s)`);
    expect(u).toMatch(/Notes from the user: קצר וקולע/);
    expect(u).toContain("Background replacement is not available in this version: never mention it.");
  });
  it("adds the previous plan and the instruction for a Re-plan", () => {
    const previous = parseEditPlan({ ...validEditPlan(), beats: validEditPlan().beats.map((b) => (b.id === "b2" ? { ...b, keep: false, dropReason: "tangent" } : b)) });
    const u = footageUserPrompt({ ...REQ, previous, instruction: "tighten to 15 s" }, splitBeats(REQ.transcript.words));
    expect(u).toMatch(/Your previous plan: kept b1, b3; dropped b2 \(tangent\)/);
    expect(u).toMatch(/The user asked for this change: tighten to 15 s/);
  });
});

describe("createFootagePlanner", () => {
  it("returns a valid plan from one call", async () => {
    const model = vi.fn<EditDraftModel>(async () => reply(draft()));
    const plan = await createFootagePlanner(model, style).plan(REQ);
    expect(model).toHaveBeenCalledTimes(1);
    expect(plan.beats.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
  });
  it("repairs once with the error, then succeeds", async () => {
    const bad = draft();
    bad.beats[0].emphasisWordIdx = 9;
    const model = vi.fn<EditDraftModel>().mockResolvedValueOnce(reply(bad)).mockResolvedValueOnce(reply(draft()));
    await createFootagePlanner(model, style).plan(REQ);
    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1][0].user).toMatch(/word 9 is outside beat b1/);
  });
  it("throws after two invalid answers", async () => {
    const model = vi.fn<EditDraftModel>(async () => reply(null));
    await expect(createFootagePlanner(model, style).plan(REQ)).rejects.toThrow(/invalid edit plan twice/);
  });
  it("refuses an edit that keeps only fillers", async () => {
    const t = { ...REQ.transcript, words: [{ text: "אממ", startMs: 0, endMs: 900 }, { text: "אהה.", startMs: 1000, endMs: 2400 }] };
    const d = draft({ beats: [{ id: "b1", keep: true, dropReason: "", emphasisWordIdx: -1, emoji: "", cutaway: NO_CUTAWAY }], ending: { kind: "none", keyword: "" }, hook: { ...draft().hook, headlineBig: "" } });
    const model = vi.fn<EditDraftModel>(async () => reply(d));
    await expect(createFootagePlanner(model, style).plan({ ...REQ, transcript: t })).rejects.toThrow(/Keep at least one beat with speech/);
  });
  it("asks once to shorten an over-long plan, then returns it with the length left to the reviewer", async () => {
    const beats = splitBeats(longTranscript().words);
    const keepAll = draft({ beats: beats.map((b) => ({ id: b.id, keep: true, dropReason: "", emphasisWordIdx: -1, emoji: "", cutaway: NO_CUTAWAY })), ending: { kind: "loop", keyword: "" } });
    const model = vi.fn<EditDraftModel>(async () => reply(keepAll));
    const plan = await createFootagePlanner(model, style).plan({ ...REQ, source: { ...REQ.source, durationMs: 21000 }, transcript: longTranscript() });
    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1][0].user).toMatch(/drop the weakest beats/);
    expect(plan.beats.every((b) => b.keep)).toBe(true);
  });
  it("turns a refusal into a plain error", async () => {
    const model = vi.fn<EditDraftModel>(async () => reply(null, "refusal"));
    await expect(createFootagePlanner(model, style).plan(REQ)).rejects.toThrow(/declined to plan this edit/);
  });
});

describe("transcriptWarnings", () => {
  it("warns about a language mismatch and noisy audio, and is quiet otherwise", () => {
    expect(transcriptWarnings(footageTranscript(), REQ.settings, style)).toEqual([]);
    const en = { ...footageTranscript(), languageCode: "eng" };
    expect(transcriptWarnings(en, REQ.settings, style)).toEqual(["You picked Hebrew, but the speech sounds like English. Captions follow what was said."]);
    const noisy = { ...footageTranscript(), words: footageTranscript().words.map((w) => ({ ...w, logprob: -1.5 })) };
    expect(transcriptWarnings(noisy, REQ.settings, style)).toEqual(["The audio sounds noisy or unclear, so some caption words may be wrong."]);
  });
});

const RICH: FootagePlanRequest = { ...REQ, source: { ...REQ.source, extras: fixtureExtras() }, character: { id: CHARACTER_ID, name: "Alex" } };
const withCuts = (cuts: Record<string, Partial<DraftCutaway>>, over: Partial<EditPlanDraft> = {}) =>
  draft({ beats: draft().beats.map((b) => (cuts[b.id] ? { ...b, cutaway: { ...NO_CUTAWAY, ...cuts[b.id] } } : b)), ...over });

describe("cutaways from Claude's draft", () => {
  const beats = splitBeats(REQ.transcript.words);
  it("maps every kind, clamps timing to 1–3 s and trims diagram items", () => {
    const plan = buildEditPlan(withCuts({
      b1: { kind: "ai_broll", media: "video", prompt: " laptop on a desk ", atMs: 200.4, durationMs: 5000 },
      b2: { kind: "upload", uploadId: "x2", layout: "split", durationMs: 1500 },
      b3: { kind: "diagram", template: "list", items: [" אחת ", "", "שתיים"], durationMs: 800 },
    }), RICH, beats, style);
    expect(plan.beats.map((b) => b.cutaway)).toEqual([
      { source: { kind: "ai_broll", prompt: "laptop on a desk", media: "video" }, layout: "full", atMs: 200, durationMs: 3000 },
      { source: { kind: "upload", assetId: EXTRA_VID }, layout: "split", atMs: 0, durationMs: 1500 },
      { source: { kind: "diagram", template: "list", items: ["אחת", "שתיים"] }, layout: "full", atMs: 0, durationMs: 1000 },
    ]);
    expect(plan.character).toEqual({ id: CHARACTER_ID, name: "Alex" });
    expect(plan.warnings).toEqual([]);
  });
  it("sends an unknown upload id back for repair", () => {
    expect(() => buildEditPlan(withCuts({ b1: { kind: "upload", uploadId: "x9" } }), RICH, beats, style)).toThrow('Beat b1: uploadId "x9" is not one of the uploads. Use a listed id, or another cutaway kind.');
  });
  it("removes AI shots of you without a character, and a B-roll opening with no cutaway left becomes a zoom hit", () => {
    const plan = buildEditPlan(withCuts({ b1: { kind: "ai_self", prompt: "the person on a plane" } }, { hook: { ...draft().hook, patternBreak: "broll" } }), REQ, beats, style);
    expect(plan.beats[0].cutaway).toBeUndefined();
    expect(plan.hook.patternBreak).toBe("zoom_hit");
    expect(plan.warnings).toEqual(["1 AI shot of you was removed (no character is picked).", "The B-roll opening had no cutaway left, so it became a zoom hit."]);
  });
  it("tells Claude the budget, the uploads and the character", () => {
    const user = footageUserPrompt(RICH, beats);
    expect(user).toContain('Cutaway budget: at most 3 cutaways (at most 1 video clip); at most 1 AI shot of the speaker (character "Alex").');
    expect(user).toContain('- x1 (photo, landscape) "צילום מסך"');
    expect(user).toContain('- x2 (clip, 2.0 s, portrait) "demo clip"');
    expect(user).toContain("Background replacement is not available in this version: never mention it.");
    expect(footageUserPrompt(REQ, beats)).toContain("no AI shots of the speaker (no character).");
    expect(footageUserPrompt(REQ, beats)).toContain("Uploads from the user: none.");
  });
});

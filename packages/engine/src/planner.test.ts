import { MAX_SCENES, type StoryboardDraft } from "@reel/core";
import { describe, expect, it, vi } from "vitest";
import { buildStoryboard, createPlanner, PlannerRefusedError, ScriptMismatchError, systemPrompt, userPrompt, type DraftModel } from "./planner";
import type { PlanRequest } from "./providers/types";

const REQ: PlanRequest = {
  brief: "3 טיפים לצמיחה בטיקטוק",
  language: "he",
  targetDurationSec: 30,
  pacing: "punchy",
  captionPreset: "bold_pop",
  palette: ["#FFE14D", "#111111"],
  voice: { voiceId: "v1", modelId: "eleven_v4" },
};

const draft = (script = "הוק חזק"): StoryboardDraft => ({
  title: "טיפים",
  scenes: [
    { script, visual: { kind: "image", prompt: "phone on desk, soft light", motion: "zoom_in" }, overlays: [], transitionOut: "whip" },
    { script: "טיפ ראשון", visual: { kind: "graphic", prompt: "  ", motion: "none" }, overlays: [{ text: "טיפ 1", position: "top", animation: "pop" }], transitionOut: "cut" },
  ],
});

const reply = (d: StoryboardDraft | null, stopReason: string = "end_turn") => ({ stopReason, draft: d, raw: JSON.stringify(d) });

describe("buildStoryboard", () => {
  it("fills ids, request settings and drops blank graphic prompts", () => {
    const sb = buildStoryboard(draft(), REQ);
    expect(sb).toMatchObject({ version: 1, language: "he", format: "faceless", aspect: "9:16", targetDurationSec: 30, voice: REQ.voice });
    expect(sb.style).toEqual({ captionPreset: "bold_pop", font: "Heebo", palette: REQ.palette, pacing: "punchy" });
    expect(sb.scenes.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(sb.scenes[1].visual.prompt).toBeUndefined();
  });
});

describe("createPlanner", () => {
  it("returns the storyboard from a valid first answer", async () => {
    const model: DraftModel = vi.fn(async () => reply(draft()));
    const sb = await createPlanner(model).plan(REQ);
    expect(sb.scenes).toHaveLength(2);
    expect(model).toHaveBeenCalledTimes(1);
  });

  it("repairs once, sending the validation errors back", async () => {
    const model = vi.fn<DraftModel>().mockResolvedValueOnce(reply(draft("   "))).mockResolvedValueOnce(reply(draft()));
    const sb = await createPlanner(model).plan(REQ);
    expect(sb.scenes[0].script).toBe("הוק חזק");
    expect(model.mock.calls[1][0].user).toMatch(/scenes\.0\.script/);
  });

  it("repairs when the output did not parse at all", async () => {
    const model = vi.fn<DraftModel>().mockResolvedValueOnce(reply(null)).mockResolvedValueOnce(reply(draft()));
    await createPlanner(model).plan(REQ);
    expect(model.mock.calls[1][0].user).toMatch(/did not match the storyboard schema/);
  });

  it("throws after two invalid answers", async () => {
    const model: DraftModel = async () => reply(draft("   "));
    await expect(createPlanner(model).plan(REQ)).rejects.toThrow(/invalid storyboard twice/);
  });

  it("throws PlannerRefusedError on refusal without retrying", async () => {
    const model = vi.fn<DraftModel>(async () => reply(null, "refusal"));
    await expect(createPlanner(model).plan(REQ)).rejects.toBeInstanceOf(PlannerRefusedError);
    expect(model).toHaveBeenCalledTimes(1);
  });
});

describe("userPrompt", () => {
  it("states language, length and a word budget", () => {
    const p = userPrompt(REQ);
    expect(p).toMatch(/Hebrew/);
    expect(p).toMatch(/30 seconds, about 69 spoken words/);
    expect(p).toMatch(/about 10 scenes/);
  });
});

const longDraft = (): StoryboardDraft => ({
  title: "ארוך",
  scenes: Array.from({ length: 20 }, () => ({
    script: Array.from({ length: 12 }, () => "מילה").join(" "),
    visual: { kind: "graphic", prompt: "", motion: "none" },
    overlays: [],
    transitionOut: "cut",
  })),
});

describe("length enforcement", () => {
  it("asks Claude once to shorten an over-long storyboard and returns the fixed one", async () => {
    const model = vi.fn<DraftModel>().mockResolvedValueOnce(reply(longDraft())).mockResolvedValueOnce(reply(draft()));
    const sb = await createPlanner(model).plan(REQ);
    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1][0].user).toMatch(/at most 12 scenes \(you wrote 20\)/);
    expect(sb.scenes).toHaveLength(2);
  });

  it("returns a still-long second answer instead of failing", async () => {
    const model = vi.fn<DraftModel>(async () => reply(longDraft()));
    const sb = await createPlanner(model).plan(REQ);
    expect(model).toHaveBeenCalledTimes(2);
    expect(sb.scenes).toHaveLength(20);
  });

  it("keeps a long first storyboard when the repair is unusable", async () => {
    const model = vi.fn<DraftModel>().mockResolvedValueOnce(reply(longDraft())).mockResolvedValueOnce(reply(null));
    const sb = await createPlanner(model).plan(REQ);
    expect(model).toHaveBeenCalledTimes(2);
    expect(sb.scenes).toHaveLength(20);
  });

  it("returns a long second storyboard when the first was schema-invalid", async () => {
    const model = vi.fn<DraftModel>().mockResolvedValueOnce(reply(null)).mockResolvedValueOnce(reply(longDraft()));
    const sb = await createPlanner(model).plan(REQ);
    expect(sb.scenes).toHaveLength(20);
  });

  it("states hard limits in the prompt", () => {
    expect(userPrompt(REQ)).toMatch(/Stay within 12 scenes and about 69 spoken words/);
  });
});

const STYLE_REQ = (script?: string): PlanRequest => ({
  ...REQ,
  style: { name: "Myth vs Fact", brief: "Create a clear Hebrew reel… Misconception: X", engineNotes: ['The first scene has an overlay "מיתוס".'], ...(script ? { script } : {}) },
});
const scenesDraft = (scripts: string[]): StoryboardDraft => ({
  title: "t",
  scenes: scripts.map((script) => ({ script, visual: { kind: "graphic", prompt: "", motion: "none" }, overlays: [], transitionOut: "cut" })),
});

describe("style mode", () => {
  it("keeps Custom's system prompt unchanged and adds engine rules only for styles", () => {
    expect(systemPrompt({ style: false })).toBe(systemPrompt());
    expect(systemPrompt({ style: true })).toMatch(/Never invent quotes, numbers, results/);
    expect(systemPrompt()).not.toMatch(/Never invent quotes/);
  });
  it("puts the style brief, engine notes and draft mode into the user prompt", () => {
    const u = userPrompt(STYLE_REQ());
    expect(u).toMatch(/Style brief \(follow its structure, pacing and tone\):\nCreate a clear Hebrew reel/);
    expect(u).toMatch(/Engine notes:\n- The first scene has an overlay "מיתוס"\./);
    expect(u).toMatch(/No script was provided/);
    expect(u).not.toMatch(/^Brief: /m);
  });
  it("custom prompt is unchanged", () => {
    expect(userPrompt(REQ)).toMatch(/^Brief: 3 טיפים/);
  });
});

describe("exact script mode", () => {
  const script = "מיתוס נפוץ: צריך שמונה שעות שינה. האמת? זה משתנה מאדם לאדם.";
  it("accepts a verbatim split in one call and states the mode", async () => {
    const model = vi.fn<DraftModel>(async () => reply(scenesDraft(["מיתוס נפוץ: צריך שמונה שעות שינה.", "האמת? זה משתנה מאדם לאדם."])));
    const sb = await createPlanner(model).plan(STYLE_REQ(script));
    expect(model).toHaveBeenCalledTimes(1);
    expect(model.mock.calls[0][0].user).toMatch(/Exact script mode/);
    expect(sb.scenes.map((s) => s.script)).toEqual(["מיתוס נפוץ: צריך שמונה שעות שינה.", "האמת? זה משתנה מאדם לאדם."]);
  });
  it("repairs once with the diff, then succeeds", async () => {
    const model = vi.fn<DraftModel>()
      .mockResolvedValueOnce(reply(scenesDraft(["מיתוס נפוץ: צריך 8 שעות שינה.", "האמת? זה משתנה מאדם לאדם."])))
      .mockResolvedValueOnce(reply(scenesDraft([script])));
    await createPlanner(model).plan(STYLE_REQ(script));
    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1][0].user).toMatch(/differ from the script/);
  });
  it("throws ScriptMismatchError after two altered answers", async () => {
    const model = vi.fn<DraftModel>(async () => reply(scenesDraft(["משהו אחר לגמרי."])));
    await expect(createPlanner(model).plan(STYLE_REQ(script))).rejects.toBeInstanceOf(ScriptMismatchError);
    expect(model).toHaveBeenCalledTimes(2);
  });
  it("never repairs an over-long exact script (speech length is ignored)", async () => {
    const long = Array.from({ length: 150 }, () => "מילה").join(" ");
    const halves = [long.split(" ").slice(0, 75).join(" "), long.split(" ").slice(75).join(" ")];
    const model = vi.fn<DraftModel>(async () => reply(scenesDraft(halves)));
    const sb = await createPlanner(model).plan({ ...STYLE_REQ(long), targetDurationSec: 15 });
    expect(model).toHaveBeenCalledTimes(1);
    expect(sb.scenes).toHaveLength(2);
  });
  it("still repairs too many scenes, and returns a matching over-count second answer", async () => {
    const words = Array.from({ length: 20 }, (_, i) => `w${i}`);
    const model = vi.fn<DraftModel>(async () => reply(scenesDraft(words)));
    const sb = await createPlanner(model).plan({ ...STYLE_REQ(words.join(" ")), targetDurationSec: 15 });
    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1][0].user).toMatch(/at most 6 scenes \(you wrote 20\)/);
    expect(sb.scenes).toHaveLength(20);
  });
  it("fails with the mismatch message when a single sentence cannot be split validly", async () => {
    const huge = Array.from({ length: 90 }, () => "מילה").join(" "); // one scene would exceed 400 characters
    const model = vi.fn<DraftModel>(async () => reply(scenesDraft([huge.slice(0, 200)])));
    await expect(createPlanner(model).plan(STYLE_REQ(huge))).rejects.toThrow(/Couldn't split your script without changing words/);
  });
});

describe("long exact scripts", () => {
  const long = Array.from({ length: 600 }, () => "מילה").join(" "); // 2999 chars
  const cap = Math.ceil(long.length / 350);
  const chunks = (n: number) => {
    const w = long.split(" ");
    const out: string[] = [];
    for (let i = 0; i < w.length; i += n) out.push(w.slice(i, i + n).join(" "));
    return out;
  };
  it("states the length-derived cap instead of a word target", () => {
    const u = userPrompt({ ...STYLE_REQ(long), targetDurationSec: 15 });
    expect(u).toMatch(new RegExp(`Use at most ${cap} scenes, each under 400 characters`));
    expect(u).toMatch(/the script decides the actual length/);
    expect(u).not.toMatch(/spoken words/);
  });
  it("accepts a valid split into cap scenes in one call", async () => {
    const model = vi.fn<DraftModel>(async () => reply(scenesDraft(chunks(70))));
    const sb = await createPlanner(model).plan({ ...STYLE_REQ(long), targetDurationSec: 15 });
    expect(chunks(70)).toHaveLength(cap);
    expect(sb.scenes).toHaveLength(cap);
    expect(model).toHaveBeenCalledTimes(1);
  });
  it("rejects with ScriptMismatchError when scenes exceed 400 characters twice", async () => {
    const model = vi.fn<DraftModel>(async () => reply(scenesDraft(chunks(90))));
    await expect(createPlanner(model).plan({ ...STYLE_REQ(long), targetDurationSec: 15 })).rejects.toBeInstanceOf(ScriptMismatchError);
    expect(model).toHaveBeenCalledTimes(2);
  });
});

describe("Custom prompts are byte-identical to before reel styles (c9bf3ac)", () => {
  it("pins the system prompt", () => {
    const before = [
      "You write storyboards for short vertical social videos (Instagram Reels, TikTok, YouTube Shorts).",
      "A storyboard is a list of scenes. Each scene has the voiceover line spoken during it, one visual, optional on-screen text overlays, and the transition into the next scene.",
      "",
      "What makes a strong reel:",
      "- Scene 1 is the hook: a bold claim, question, or surprising number within the first 2 seconds. No greetings or channel intros.",
      "- One idea per scene. Voiceover lines are short, spoken, conversational sentences, not written prose.",
      "- End with a clear payoff or call to action.",
      "",
      "Visuals:",
      '- kind "image": a still the editor animates with a slow camera move; set motion to zoom_in, zoom_out, pan_left or pan_right.',
      '- kind "broll_video": a moving shot for action and atmosphere. It costs more, so use it for at most half of the scenes.',
      '- kind "graphic": a plain branded background for text-heavy moments (lists, numbers); put the key text in an overlay and leave prompt empty.',
      "- Write every visual prompt in English, even for Hebrew reels, as a concrete photographic description: subject, setting, lighting, camera angle, vertical 9:16 framing. Never ask for text, captions, logos or watermarks inside the image.",
      "",
      "Overlays: at most 2 per scene, each under 6 words, in the reel's language. Voiceover captions are added automatically, so overlays must not repeat the voiceover.",
      'Transitions: mostly "cut"; use "whip" or "zoom" for energy and "fade" for calm moments.',
    ].join("\n");
    expect(systemPrompt()).toBe(before);
    expect(systemPrompt({ style: false })).toBe(before);
  });
  it("pins the user prompt", () => {
    expect(userPrompt(REQ)).toBe(
      [
        "Brief: 3 טיפים לצמיחה בטיקטוק",
        "Language of the voiceover and overlays: Hebrew.",
        "Target length: 30 seconds, about 69 spoken words in total, about 10 scenes.",
        "Stay within 12 scenes and about 69 spoken words in total.",
        "Pacing: punchy.",
        "Keep each scene's voiceover under 400 characters.",
      ].join("\n"),
    );
  });
});

describe("exact mode build failures", () => {
  const script = "מיתוס נפוץ: צריך שמונה שעות שינה. האמת? זה משתנה מאדם לאדם.";
  it("reports a too-long overlay as a normal planning error, not a script mismatch", async () => {
    const d = scenesDraft([script]);
    d.scenes[0].overlays = [{ text: "x".repeat(81), position: "top", animation: "pop" }];
    const model = vi.fn<DraftModel>(async () => reply(d));
    const err = await createPlanner(model).plan(STYLE_REQ(script)).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ScriptMismatchError);
    expect(String(err)).toMatch(/invalid storyboard twice/);
    expect(model).toHaveBeenCalledTimes(2);
  });
  it("reports an image scene without a prompt as a normal planning error", async () => {
    const d = scenesDraft([script]);
    d.scenes[0].visual = { kind: "image", prompt: "", motion: "zoom_in" };
    const model = vi.fn<DraftModel>(async () => reply(d));
    const err = await createPlanner(model).plan(STYLE_REQ(script)).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ScriptMismatchError);
    expect(String(err)).toMatch(/needs a visual\.prompt/);
  });
  it("reports more scenes than the schema allows as a script mismatch", async () => {
    const words = Array.from({ length: MAX_SCENES + 1 }, (_, i) => `w${i}`);
    const model = vi.fn<DraftModel>(async () => reply(scenesDraft(words)));
    await expect(createPlanner(model).plan(STYLE_REQ(words.join(" ")))).rejects.toBeInstanceOf(ScriptMismatchError);
  });
});

describe("exact-mode scene cap", () => {
  const huge = Array.from({ length: 1600 }, () => "מילה").join(" "); // ~8000 chars, ceil(/350) = 23
  it("never asks for more scenes than the storyboard schema allows", () => {
    expect(Math.ceil(huge.length / 350)).toBeGreaterThan(MAX_SCENES);
    expect(userPrompt({ ...STYLE_REQ(huge), targetDurationSec: 60 })).toMatch(new RegExp(`Use at most ${MAX_SCENES} scenes,`));
  });
});

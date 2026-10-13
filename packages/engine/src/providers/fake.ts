import { NO_CUTAWAY, PermanentProviderError, type EditPlanDraft } from "@reel/core";
import { houseStyle } from "@reel/video/house-style";
import { makeTestImage, makeTestTone, makeTestVideo, probe } from "@reel/media";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createFootagePlanner, type FootagePlanner } from "../footage-planner";
import { buildStoryboard } from "../planner";
import type { Planner, PlanRequest, Providers } from "./types";

const COLORS = ["0x2E86AB", "0xE4572E", "0x76B041", "0xFFC914", "0x7D5BA6"];
const WORD_MS = 350;

/** What the fake transcriber "hears" in any upload: three sentences, a filler and a comment keyword. */
export const FAKE_TALK = "היי חברים, אממ היום אני אראה לכם טריק. זה חוסך שעות עבודה. תכתבו AI בתגובות.";

const FAKE_SCRIPTS = {
  he: ["3 טיפים ל-TikTok שכדאי להכיר", "טיפ ראשון: תפתחו עם הוק חזק", "שמרו ועקבו לעוד טיפים"],
  en: ["3 TikTok tips you should know", "Tip one: open with a strong hook", "Save this and follow for more"],
};

/** Deterministic, free providers backed by lavfi fixtures, for tests and `--fake` runs. */
export function createFakeProviders(opts: { workDir: string; failPromptsContaining?: string }) {
  const calls = { image: 0, selfImage: 0, video: 0, upload: 0, voice: 0, plan: 0, transcribe: 0, music: 0 };
  let n = 0;
  const nextFile = (ext: string) => join(opts.workDir, `fake-${++n}.${ext}`);

  const providers: Providers & { planner: Planner; footagePlanner: FootagePlanner; calls: typeof calls } = {
    calls,
    image: {
      model: "fake/image",
      async generate({ prompt, character }) {
        calls.image++;
        if (character) calls.selfImage++;
        if (opts.failPromptsContaining && prompt.includes(opts.failPromptsContaining)) {
          throw new PermanentProviderError("Higgsfield (fake) was blocked by content moderation", "fake", "fake-req");
        }
        const out = nextFile("png");
        await makeTestImage(out, { color: COLORS[n % COLORS.length] });
        return { url: pathToFileURL(out).href, requestId: `fake-image-${n}` };
      },
    },
    video: {
      model: "fake/video",
      resolution: "fake",
      async imageToVideo({ durationSec }) {
        calls.video++;
        const out = nextFile("mp4");
        await makeTestVideo(out, { durationSec, width: 720, height: 1280, fps: 24 });
        return { url: pathToFileURL(out).href, requestId: `fake-video-${n}` };
      },
    },
    uploader: {
      async upload() {
        calls.upload++;
        return `https://fake.local/upload-${calls.upload}`;
      },
    },
    voice: {
      async synthesize({ text }) {
        calls.voice++;
        const tokens = text.trim().split(/\s+/);
        const words = tokens.map((t, i) => ({ text: t, startMs: i * WORD_MS, endMs: i * WORD_MS + WORD_MS - 50 }));
        const out = nextFile("wav");
        await makeTestTone(out, { durationSec: (tokens.length * WORD_MS) / 1000, volumeDb: -20 });
        return { audio: await readFile(out), ext: "wav", words, timingSource: "alignment" };
      },
    },
    transcriber: {
      model: "fake/scribe",
      async transcribe(audioPath: string) {
        calls.transcribe++;
        const durationMs = Math.round((await probe(audioPath)).durationSec * 1000);
        const tokens = FAKE_TALK.split(" ");
        const slot = durationMs / (tokens.length + 1);
        const words = tokens.map((text, i) => ({ text, startMs: Math.round((i + 0.5) * slot), endMs: Math.round((i + 0.5) * slot + slot * 0.85), logprob: -0.05 }));
        return { transcript: { languageCode: "heb", languageProbability: 0.99, words, events: [] } };
      },
    },
    music: {
      model: "fake/music",
      async compose({ durationMs }: { prompt: string; durationMs: number }) {
        calls.music++;
        const out = nextFile("wav");
        await makeTestTone(out, { durationSec: Math.max(1, durationMs / 1000), volumeDb: -24 });
        return { audio: await readFile(out), ext: "wav" as const };
      },
    },
    planner: {
      async plan(req: PlanRequest) {
        calls.plan++;
        const [hook, tip, cta] = FAKE_SCRIPTS[req.language];
        return buildStoryboard(
          {
            title: req.brief.slice(0, 120),
            scenes: [
              { script: hook, visual: { kind: "image", prompt: "smartphone on a desk, soft morning light", motion: "zoom_in" }, overlays: [], transitionOut: "whip" },
              { script: tip, visual: { kind: "broll_video", prompt: "hands scrolling a phone, close-up", motion: "none" }, overlays: [], transitionOut: "fade" },
              { script: cta, visual: { kind: "graphic", prompt: "", motion: "none" }, overlays: [{ text: req.language === "he" ? "עקבו" : "Follow", position: "center", animation: "pop" }], transitionOut: "cut" },
            ],
          },
          req,
        );
      },
    },
    footagePlanner: createFootagePlanner(async ({ user }) => {
      calls.plan++;
      const ids = [...user.matchAll(/^(b\d+) \(/gm)].map((m) => m[1]);
      const he = /Reel language: Hebrew/.test(user);
      const keyword = user.match(/Comment keyword from the user: "([^"]+)"/)?.[1];
      const trackId = user.match(/^- ([0-9a-f-]{36}) "/m)?.[1];
      const draft: EditPlanDraft = {
        title: he ? "עריכה לדוגמה" : "Sample edit",
        beats: ids.map((id) => ({ id, keep: true, dropReason: "", emphasisWordIdx: -1, emoji: "", cutaway: NO_CUTAWAY })),
        hook: { coldOpenBeatId: "", headlineSmall: he ? "הטריק ש" : "The trick that", headlineBig: he ? "חוסך שעות" : "saves hours", patternBreak: "zoom_hit", reason: "Fake planner: a headline and a punch-in." },
        ending: { kind: keyword ? "cta" : "loop", keyword: keyword ?? "" },
        music: trackId ? { kind: "library", trackId, prompt: "" } : { kind: "ai", trackId: "", prompt: "calm lo-fi beat" },
        sfx: "subtle",
      };
      return { stopReason: "end_turn", draft, raw: JSON.stringify(draft) };
    }, houseStyle.edit),
  };
  return providers;
}

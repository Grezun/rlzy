import type { Transcript } from "../schema/footage";
export const validStoryboard = () => ({
  version: 1,
  title: "3 tips",
  language: "he",
  format: "faceless",
  aspect: "9:16",
  targetDurationSec: 30,
  voice: { voiceId: "voice-1", modelId: "eleven_v4" },
  style: { captionPreset: "bold_pop", font: "Heebo", palette: ["#FFE14D", "#111111"], pacing: "punchy" },
  scenes: [
    {
      id: "s1",
      script: "3 טיפים ל-TikTok!",
      visual: { kind: "image", prompt: "phone on a desk, soft light", motion: "zoom_in" },
      overlays: [{ text: "טיפ 1", position: "top", animation: "pop" }],
      transitionOut: "fade",
    },
    {
      id: "s2",
      script: "Second scene script",
      visual: { kind: "graphic" },
      overlays: [],
      transitionOut: "cut",
    },
  ],
});


export const HASH_A = "a".repeat(64);
export const HASH_B = "b".repeat(64);
export const HASH_C = "c".repeat(64);

const tw = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs, logprob: -0.05 });

/** 15 Hebrew words over a 9 s source: a filler at idx 2, sentence ends at idx 7, 11 and 14, pauses of 700 ms and 650 ms. */
export const footageTranscript = (): Transcript => ({
  languageCode: "heb",
  languageProbability: 0.98,
  words: [
    tw("היי", 0, 300), tw("חברים,", 350, 800), tw("אממ", 1000, 1300), tw("היום", 1500, 1900),
    tw("אני", 1950, 2200), tw("אראה", 2250, 2700), tw("לכם", 2750, 3000), tw("טריק.", 3050, 3500),
    tw("זה", 4200, 4400), tw("חוסך", 4450, 4900), tw("שעות", 4950, 5400), tw("עבודה.", 5450, 6000),
    tw("תכתבו", 6650, 7100), tw("AI", 7150, 7500), tw("בתגובות.", 7550, 8200),
  ],
  events: [],
});

export const validEditPlan = () => ({
  format: "footage" as const,
  version: 1,
  title: "טריק שחוסך שעות",
  language: "he" as const,
  targetDurationSec: 15 as const,
  source: { assetId: HASH_A, durationMs: 9000, transcriptAssetId: HASH_B, faceTrackAssetId: HASH_C },
  beats: [
    { id: "b1", startWordIdx: 0, endWordIdx: 7, keep: true, emphasisWordIdx: 7 },
    { id: "b2", startWordIdx: 8, endWordIdx: 11, keep: true, emoji: "👇" },
    { id: "b3", startWordIdx: 12, endWordIdx: 14, keep: true },
  ],
  hook: { headline: { small: "הטריק ש", big: "חוסך שעות" }, patternBreak: "zoom_hit" as const, reason: "A bold promise plus a punch-in." },
  ending: { kind: "cta" as const, keyword: "AI" },
  background: { mode: "original" as const },
  music: { kind: "none" as const },
  sfx: "subtle" as const,
  estimate: { durationSec: 0, credits: 0 },
  warnings: [] as string[],
});

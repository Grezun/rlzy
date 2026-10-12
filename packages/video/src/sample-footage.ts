import type { CaptionPage, Timeline, TimelineClip } from "@reel/core";

/** A 5 s footage timeline: flash + headline hook, three pill pages, CTA card. Graphic clips unless videoSrc is given. */
export function sampleFootageTimeline(lang: "he" | "en", videoSrc?: string): Timeline {
  const he = lang === "he";
  const texts = he ? [["היי", "חברים,"], ["היום", "אני", "אראה"], ["לכם", "טריק."]] : [["Hey", "friends,"], ["today", "I'll", "show"], ["you", "a trick."]];
  const pages: CaptionPage[] = texts.map((ws, i) => ({
    fromFrame: i * 30,
    durationInFrames: 30,
    words: ws.map((text, j) => ({ text, emphasis: i === 2 && j === ws.length - 1 })),
    ...(i === 2 ? { emoji: "👇" } : {}),
  }));
  const words = texts.flat().map((text, i) => ({ text, startMs: i * 120, endMs: i * 120 + 100 }));
  const clips: TimelineClip[] = videoSrc
    ? [
        { sceneId: "b1-1", kind: "speaker", src: videoSrc, fromFrame: 0, durationInFrames: 45, motion: "none", transitionIn: "cut", source: { inMs: 0, outMs: 1500 }, crop: { cx: 0.5, cy: 0.4, scaleFrom: 1, scaleTo: 1.3, punchFrames: 6 } },
        { sceneId: "b1-2", kind: "speaker", src: videoSrc, fromFrame: 45, durationInFrames: 105, motion: "none", transitionIn: "cut", source: { inMs: 1800, outMs: 5300 }, crop: { cx: 0.5, cy: 0.42, scaleFrom: 1.15, scaleTo: 1.242 } },
      ]
    : [
        { sceneId: "g1", kind: "graphic", fromFrame: 0, durationInFrames: 45, motion: "none", transitionIn: "cut" },
        { sceneId: "g2", kind: "graphic", fromFrame: 45, durationInFrames: 105, motion: "zoom_in", transitionIn: "cut" },
      ];
  return {
    fps: 30, width: 1080, height: 1920, durationInFrames: 150, language: lang, direction: he ? "rtl" : "ltr",
    style: { captionPreset: "pill", font: "Heebo", palette: ["#3A2E5C", "#9F92C3"] },
    audio: { musicDuckingDb: -12 },
    clips,
    captions: { words, pages },
    overlays: [],
    hook: { patternBreak: "flash", headline: { small: he ? "הטריק ש" : "The trick that", big: he ? "חוסך שעות" : "saves hours", fromFrame: 0, durationInFrames: 60 } },
    ending: { kind: "cta", keyword: "AI", fromFrame: 75, durationInFrames: 75 },
  };
}

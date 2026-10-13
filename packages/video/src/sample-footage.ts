import type { CaptionPage, Timeline, TimelineClip } from "@reel/core";

/**
 * A 7 s footage timeline: headline 0–60 (pills hidden), three pill pages with word start frames, a low pill (62 %),
 * a flash break at 100 and a CTA card from 135. Graphic clips unless videoSrc is given.
 */
export function sampleFootageTimeline(lang: "he" | "en", videoSrc?: string): Timeline {
  const he = lang === "he";
  const texts = he ? [["היי", "חברים,"], ["היום", "אני", "אראה"], ["לכם", "טריק."]] : [["Hey", "friends,"], ["today", "I'll", "show"], ["you", "a trick."]];
  const spans = [[0, 30, [0, 15]], [30, 45, [30, 40, 52]], [75, 60, [75, 95]]] as const;
  const pages: CaptionPage[] = texts.map((ws, i) => ({
    fromFrame: spans[i][0],
    durationInFrames: spans[i][1],
    topPct: [58, 58, 62][i],
    words: ws.map((text, j) => ({ text, emphasis: i === 2 && j === ws.length - 1, startFrame: spans[i][2][j] })),
    ...(i === 2 ? { emoji: "👇" } : {}),
  }));
  const words = texts.flat().map((text, i) => ({ text, startMs: i * 400, endMs: i * 400 + 300 }));
  const clips: TimelineClip[] = videoSrc
    ? [
        { sceneId: "b1-1", kind: "speaker", src: videoSrc, fromFrame: 0, durationInFrames: 75, motion: "none", transitionIn: "cut", source: { inMs: 0, outMs: 2500 }, crop: { cx: 0.5, cy: 0.4, scaleFrom: 1, scaleTo: 1.3, punchFrames: 6 } },
        { sceneId: "b1-2", kind: "speaker", src: videoSrc, fromFrame: 75, durationInFrames: 135, motion: "none", transitionIn: "cut", source: { inMs: 2800, outMs: 7300 }, crop: { cx: 0.5, cy: 0.42, scaleFrom: 1.15, scaleTo: 1.242 }, enter: { kind: "zoom_blur", frames: 6 } },
      ]
    : [
        { sceneId: "g1", kind: "graphic", fromFrame: 0, durationInFrames: 75, motion: "none", transitionIn: "cut" },
        { sceneId: "g2", kind: "graphic", fromFrame: 75, durationInFrames: 135, motion: "zoom_in", transitionIn: "cut" },
      ];
  return {
    fps: 30, width: 1080, height: 1920, durationInFrames: 210, language: lang, direction: he ? "rtl" : "ltr",
    style: { captionPreset: "pill", font: "Heebo", palette: ["#3A2E5C", "#9F92C3"] },
    audio: { musicDuckingDb: -12 },
    clips,
    captions: { words, pages },
    overlays: [],
    hook: { patternBreak: "flash", headline: { small: he ? "הטריק ש" : "The trick that", big: he ? "חוסך שעות" : "saves hours", fromFrame: 0, durationInFrames: 60 } },
    patternBreaks: [{ frame: 100, kind: "flash" }],
    ending: { kind: "cta", keyword: "AI", fromFrame: 135, durationInFrames: 75 },
  };
}

/** 4.5 s of cutaways with no media files: a split flow diagram (pill on the seam), then full compare and list cards. */
export function sampleCutawayTimeline(lang: "he" | "en"): Timeline {
  const he = lang === "he";
  const t = he
    ? { flow: ["מקליטים", "מעלים", "מקבלים רילס"], compare: ["עריכה ידנית", "עריכה אוטומטית"], list: ["בלי חיבור", "בחינם", "בלי הגבלה"] }
    : { flow: ["Record", "Upload", "Get a reel"], compare: ["Manual edit", "Auto edit"], list: ["Offline", "Free", "No limits"] };
  return {
    fps: 30, width: 1080, height: 1920, durationInFrames: 135, language: lang, direction: he ? "rtl" : "ltr",
    style: { captionPreset: "pill", font: "Heebo", palette: ["#3A2E5C", "#9F92C3"] },
    audio: { musicDuckingDb: -12 },
    clips: [{ sceneId: "g1", kind: "graphic", fromFrame: 0, durationInFrames: 135, motion: "none", transitionIn: "cut" }],
    captions: { words: [{ text: he ? "ככה" : "Like", startMs: 0, endMs: 300 }], pages: [{ fromFrame: 0, durationInFrames: 45, topPct: 50, words: [{ text: he ? "ככה" : "Like", emphasis: false, startFrame: 0 }, { text: he ? "זה" : "this", emphasis: false, startFrame: 10 }] }] },
    overlays: [],
    cutaways: [
      { id: "b1", fromFrame: 0, durationInFrames: 45, layout: "split", media: { kind: "diagram", template: "flow", items: t.flow } },
      { id: "b2", fromFrame: 45, durationInFrames: 45, layout: "full", media: { kind: "diagram", template: "compare", items: t.compare } },
      { id: "b3", fromFrame: 90, durationInFrames: 45, layout: "full", media: { kind: "diagram", template: "list", items: t.list } },
    ],
  };
}
